"""Lists: named groups of saved companies. Build one in Saved Accounts, enrich it, then run a campaign on it.

A list only holds company ids (the companies themselves stay in Saved Accounts), kept in one small
settings document per organisation.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import current_org
from app.database import get_db
from app.models.models import LeadAccount
from app.services import credits as credit

router = APIRouter(prefix="/leads/lists", tags=["Leads"])

MAX_LISTS = 200
MAX_NAME = 80


class ListIn(BaseModel):
    name: str = ""
    ids: List[str] = []


class ListPatch(BaseModel):
    name: Optional[str] = None
    add: List[str] = []
    remove: List[str] = []


def _key() -> str:
    return f"leadlists:{current_org()}"


async def _load(db: AsyncSession) -> List[Dict[str, Any]]:
    return list((await credit._get_doc(db, _key())).get("lists") or [])


async def _save(db: AsyncSession, lists: List[Dict[str, Any]]) -> None:
    await credit._put_doc(db, _key(), {"lists": lists})
    await db.commit()


async def _existing(db: AsyncSession, ids: List[str]) -> List[str]:
    """Only ids that are really saved accounts of this organisation, in the order given, no repeats."""
    if not ids:
        return []
    found = set((await db.execute(select(LeadAccount.id).where(LeadAccount.id.in_(ids)))).scalars().all())
    seen: List[str] = []
    for i in ids:
        if i in found and i not in seen:
            seen.append(i)
    return seen


async def _clean(db: AsyncSession, lists: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Drop ids of companies removed since (so counts are always true)."""
    every = [i for l in lists for i in l["ids"]]
    alive = set(await _existing(db, every))
    return [{**l, "ids": [i for i in l["ids"] if i in alive]} for l in lists]


async def _checking() -> set:
    from app.services import company_check_job

    return await company_check_job.locked_ids()


def _name(raw: str) -> str:
    name = " ".join((raw or "").split())[:MAX_NAME]
    if not name:
        raise HTTPException(status_code=400, detail="Give the list a name.")
    return name


async def put_in_list(db: AsyncSession, list_id: str, list_name: str, ids: List[str]) -> Dict[str, Any]:
    """Add companies to a list by id, or by name (an existing list with that name, else a new one).
    Used when saving a search or an imported file straight into a list."""
    lists = await _load(db)
    hit = next((l for l in lists if l["id"] == list_id), None) if list_id else None
    if not hit and list_name.strip():
        name = _name(list_name)
        hit = next((l for l in lists if l["name"].lower() == name.lower()), None)
        if not hit:
            if len(lists) >= MAX_LISTS:
                raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_LISTS} lists. Delete one first.")
            hit = {"id": f"lst_{uuid.uuid4().hex[:10]}", "name": name, "ids": [], "created_at": datetime.utcnow().isoformat() + "Z"}
            lists.insert(0, hit)
    if not hit:
        raise HTTPException(status_code=404, detail="That list doesn't exist any more.")
    hit["ids"] = await _existing(db, hit["ids"] + ids)
    hit["updated_at"] = datetime.utcnow().isoformat() + "Z"
    await _save(db, lists)
    return {"id": hit["id"], "name": hit["name"], "count": len(hit["ids"])}


UNSORTED = "Unsorted"


async def _adopt_loose(db: AsyncSession, lists: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Every saved company belongs to a list. Ones saved before lists existed, or taken out of their
    last list, are gathered into "Unsorted" (made if needed) so they can be renamed, moved and used."""
    placed = {i for l in lists for i in l["ids"]}
    every = (await db.execute(select(LeadAccount.id).order_by(LeadAccount.created_at))).scalars().all()
    loose = [i for i in every if i not in placed]
    if not loose:
        return lists
    hit = next((l for l in lists if l["name"].lower() == UNSORTED.lower()), None)
    if not hit:
        if len(lists) >= MAX_LISTS:
            return lists
        hit = {"id": f"lst_{uuid.uuid4().hex[:10]}", "name": UNSORTED, "ids": [], "created_at": datetime.utcnow().isoformat() + "Z"}
        lists = lists + [hit]
    hit["ids"] = hit["ids"] + loose
    await _save(db, lists)
    return lists


@router.get("")
async def all_lists(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    lists = await _clean(db, await _load(db))
    return {"lists": await _adopt_loose(db, lists)}


@router.post("")
async def create(body: ListIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    lists = await _load(db)
    if len(lists) >= MAX_LISTS:
        raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_LISTS} lists. Delete one first.")
    name = _name(body.name)
    if any(l["name"].lower() == name.lower() for l in lists):
        raise HTTPException(status_code=409, detail=f"You already have a list called {name}.")
    made = {"id": f"lst_{uuid.uuid4().hex[:10]}", "name": name, "ids": await _existing(db, body.ids),
            "created_at": datetime.utcnow().isoformat() + "Z"}
    await _save(db, [made] + lists)
    return {"list": made}


@router.patch("/{list_id}")
async def change(list_id: str, body: ListPatch, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    lists = await _load(db)
    hit = next((l for l in lists if l["id"] == list_id), None)
    if not hit:
        raise HTTPException(status_code=404, detail="That list doesn't exist any more.")
    if body.name is not None:
        name = _name(body.name)
        if any(l["name"].lower() == name.lower() and l["id"] != list_id for l in lists):
            raise HTTPException(status_code=409, detail=f"You already have a list called {name}.")
        hit["name"] = name
    gone = set(body.remove)
    if gone & await _checking():
        raise HTTPException(status_code=409, detail="Some of these companies are being checked right now. Take them out of the list when the check has finished.")
    hit["ids"] = await _existing(db, [i for i in hit["ids"] if i not in gone] + body.add)
    hit["updated_at"] = datetime.utcnow().isoformat() + "Z"
    await _save(db, lists)
    return {"list": hit}


@router.delete("/{list_id}")
async def delete(list_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    lists = await _load(db)
    keep = [l for l in lists if l["id"] != list_id]
    if len(keep) == len(lists):
        raise HTTPException(status_code=404, detail="That list doesn't exist any more.")
    mine = next((l for l in lists if l["id"] == list_id), {})
    if set(mine.get("ids") or []) & await _checking():
        raise HTTPException(status_code=409, detail="Companies in this list are being checked right now. Delete the list when the check has finished.")
    await _save(db, keep)
    return {"ok": True}
