"""Saved Call lists: the tables of people the Voice app calls, kept per organisation so they follow the user to any device.

The Call list screen edits a list as a whole (headers and rows), so a list is stored whole too. The cards on the
lists view only need the summary, which is what the list endpoint returns.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import CallList

router = APIRouter(prefix="/call-lists", tags=["Call lists"])

MAX_LISTS = 200
MAX_ROWS = 20000
MAX_NAME = 80


class ListIn(BaseModel):
    name: str = ""
    headers: List[Any] = []
    rows: List[Dict[str, Any]] = []


class ListPatch(BaseModel):
    name: Optional[str] = None
    headers: Optional[List[Any]] = None
    rows: Optional[List[Dict[str, Any]]] = None


class ImportIn(BaseModel):
    lists: List[ListIn] = []


def _name(raw: str) -> str:
    name = " ".join((raw or "").split())[:MAX_NAME]
    if not name:
        raise HTTPException(status_code=400, detail="Give the list a name.")
    return name


def _called(rows: List[Dict[str, Any]]) -> int:
    def done(r: Dict[str, Any]) -> bool:
        try:
            return int(r.get("callTimes") or 0) > 0
        except (TypeError, ValueError):
            return False

    return sum(1 for r in rows if done(r))


def _check_rows(rows: List[Dict[str, Any]]) -> None:
    if len(rows) > MAX_ROWS:
        raise HTTPException(status_code=400, detail=f"A list can hold up to {MAX_ROWS:,} contacts.")


def _summary(l: CallList) -> Dict[str, Any]:
    return {"id": l.id, "name": l.name, "count": l.row_count or 0, "called": l.called_count or 0,
            "created_at": l.created_at.isoformat() + "Z" if l.created_at else None,
            "updated_at": l.updated_at.isoformat() + "Z" if l.updated_at else None}


def _full(l: CallList) -> Dict[str, Any]:
    return {**_summary(l), "headers": l.headers or [], "rows": l.rows or []}


def _who(request: Request) -> str:
    auth = getattr(request.state, "auth", None) or {}
    return str(auth.get("name") or auth.get("email") or "")


async def _all(db: AsyncSession) -> List[CallList]:
    return list((await db.execute(select(CallList).order_by(CallList.updated_at.desc()))).scalars().all())


async def _get(db: AsyncSession, list_id: str) -> CallList:
    hit = (await db.execute(select(CallList).where(CallList.id == list_id))).scalars().first()
    if not hit:
        raise HTTPException(status_code=404, detail="That list doesn't exist any more.")
    return hit


def _clash(lists: List[CallList], name: str, own: str = "") -> bool:
    return any(l.name.lower() == name.lower() and l.id != own for l in lists)


def _fill(l: CallList, headers: List[Any], rows: List[Dict[str, Any]]) -> None:
    l.headers, l.rows = list(headers), list(rows)
    l.row_count, l.called_count = len(rows), _called(rows)


@router.get("")
async def all_lists(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    return {"lists": [_summary(l) for l in await _all(db)]}


@router.get("/{list_id}")
async def one(list_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    return {"list": _full(await _get(db, list_id))}


@router.post("")
async def create(body: ListIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Save a list. A list with the same name is replaced, so saving again updates it."""
    name, lists = _name(body.name), await _all(db)
    _check_rows(body.rows)
    hit = next((l for l in lists if l.name.lower() == name.lower()), None)
    if not hit:
        if len(lists) >= MAX_LISTS:
            raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_LISTS} lists. Delete one first.")
        hit = CallList(id=f"cl_{uuid.uuid4().hex[:12]}", name=name, created_by=_who(request))
        db.add(hit)
    hit.name = name
    _fill(hit, body.headers, body.rows)
    hit.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(hit)
    return {"list": _full(hit)}


@router.post("/import")
async def import_many(body: ImportIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Bring in lists a browser had saved before lists lived on the server. Names that already exist are left alone."""
    lists = await _all(db)
    taken = {l.name.lower() for l in lists}
    added = 0
    for item in body.lists:
        name = " ".join((item.name or "").split())[:MAX_NAME]
        if not name or name.lower() in taken or len(item.rows) > MAX_ROWS or len(lists) + added >= MAX_LISTS:
            continue
        made = CallList(id=f"cl_{uuid.uuid4().hex[:12]}", name=name, created_by=_who(request))
        _fill(made, item.headers, item.rows)
        db.add(made)
        taken.add(name.lower())
        added += 1
    await db.commit()
    return {"added": added, "lists": [_summary(l) for l in await _all(db)]}


@router.put("/{list_id}")
async def change(list_id: str, body: ListPatch, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    hit = await _get(db, list_id)
    if body.name is not None:
        name = _name(body.name)
        if _clash(await _all(db), name, list_id):
            raise HTTPException(status_code=409, detail=f"You already have a list called {name}.")
        hit.name = name
    if body.rows is not None:
        _check_rows(body.rows)
        _fill(hit, body.headers if body.headers is not None else (hit.headers or []), body.rows)
    elif body.headers is not None:
        hit.headers = list(body.headers)
    hit.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(hit)
    return {"list": _summary(hit)}


@router.post("/{list_id}/duplicate")
async def duplicate(list_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    src, lists = await _get(db, list_id), await _all(db)
    if len(lists) >= MAX_LISTS:
        raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_LISTS} lists. Delete one first.")
    name, n = f"{src.name[:MAX_NAME - 7]} (copy)", 2
    while _clash(lists, name):
        name, n = f"{src.name[:MAX_NAME - 10]} (copy {n})", n + 1
    made = CallList(id=f"cl_{uuid.uuid4().hex[:12]}", name=name, created_by=_who(request))
    _fill(made, src.headers or [], src.rows or [])
    db.add(made)
    await db.commit()
    await db.refresh(made)
    return {"list": _summary(made)}


@router.delete("/{list_id}")
async def delete(list_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    await db.delete(await _get(db, list_id))
    await db.commit()
    return {"ok": True}
