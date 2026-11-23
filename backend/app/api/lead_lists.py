"""Lists: named groups of saved companies. Build one in Saved Accounts, enrich it, then run a campaign on it.

A list only holds company ids (the companies themselves stay in Saved Accounts), kept in one small
settings document per organisation.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import current_org
from app.database import get_db
from app.models.models import LeadAccount
from app.services import credits as credit

router = APIRouter(prefix="/leads/lists", tags=["Leads"])

MAX_LISTS = 200
MAX_NAME = 80
MAX_IDS = 5000
CHUNK = 500
VIRTUAL_ID = "lst_unsorted"


class ListIn(BaseModel):
    name: str = ""
    ids: List[str] = Field(default_factory=list, max_length=MAX_IDS)


class ListPatch(BaseModel):
    name: Optional[str] = None
    add: List[str] = Field(default_factory=list, max_length=MAX_IDS)
    remove: List[str] = Field(default_factory=list, max_length=MAX_IDS)


def _key() -> str:
    return f"leadlists:{current_org()}"


async def _lock(db: AsyncSession) -> None:
    """Hold this organisation's lists document until the caller commits, so two requests never
    load the same copy and overwrite each other (same pattern as credits._lock)."""
    from app.models.models import AppSetting

    q = select(AppSetting.id).where(AppSetting.id == _key()).with_for_update()
    if (await db.execute(q)).first() is None:
        db.add(AppSetting(id=_key(), data={}))
        await db.flush()
        await db.execute(q)


async def _load(db: AsyncSession) -> List[Dict[str, Any]]:
    return list((await credit._get_doc(db, _key())).get("lists") or [])


async def _save(db: AsyncSession, lists: List[Dict[str, Any]]) -> None:
    await credit._put_doc(db, _key(), {"lists": lists})
    await db.commit()


async def _existing(db: AsyncSession, ids: List[str]) -> List[str]:
    """Only ids that are really saved accounts of this organisation, in the order given, no repeats."""
    if not ids:
        return []
    found: set = set()
    uniq = list(dict.fromkeys(ids))
    for n in range(0, len(uniq), CHUNK):
        found |= set((await db.execute(select(LeadAccount.id).where(LeadAccount.id.in_(uniq[n:n + CHUNK])))).scalars().all())
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


async def put_in_list(db: AsyncSession, list_id: str, list_name: str, ids: List[str], owner: str = "") -> Dict[str, Any]:
    """Add companies to a list by id, or by name (an existing list with that name, else a new one).
    Used when saving a search or an imported file straight into a list."""
    await _lock(db)
    lists = await _load(db)
    hit = next((l for l in lists if l["id"] == list_id), None) if list_id else None
    if not hit and list_name.strip():
        name = _name(list_name)
        hit = next((l for l in lists if l["name"].lower() == name.lower()), None)
        if not hit:
            if len(lists) >= MAX_LISTS:
                raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_LISTS} lists. Delete one first.")
            hit = {"id": f"lst_{uuid.uuid4().hex[:10]}", "name": name, "ids": [], "owner": owner, "created_at": datetime.utcnow().isoformat() + "Z"}
            lists.insert(0, hit)
    if not hit:
        raise HTTPException(status_code=404, detail="That list doesn't exist any more.")
    hit["ids"] = await _existing(db, hit["ids"] + ids)
    hit["updated_at"] = datetime.utcnow().isoformat() + "Z"
    await _save(db, lists)
    return {"id": hit["id"], "name": hit["name"], "count": len(hit["ids"])}


UNSORTED = "Unsorted"


async def _loose(db: AsyncSession, lists: List[Dict[str, Any]]) -> List[str]:
    """Saved companies that are in no list."""
    placed = {i for l in lists for i in l["ids"]}
    every = (await db.execute(select(LeadAccount.id).order_by(LeadAccount.created_at))).scalars().all()
    return [i for i in every if i not in placed]


async def _with_unsorted(db: AsyncSession, lists: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """"Unsorted" is a view, never stored: the saved companies that are in no list. Taking a company out of
    its last list, or deleting a list, therefore sticks; nothing is written by reading."""
    loose = await _loose(db, lists)
    if not loose:
        return lists
    taken = any(l["name"].lower() == UNSORTED.lower() for l in lists)
    return lists + [{"id": VIRTUAL_ID, "name": "Not in any list" if taken else UNSORTED, "ids": loose, "virtual": True}]


async def _within_areas(db: AsyncSession, lists: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    """The lists as this person may see them: companies outside their own areas are left out (and counted). Nothing changes for a person
    with no personal area limit. The stored lists are never altered, only the copy that is returned."""
    from app.services import data_access as DA

    if not (await DA.current_scope(db)).limited:
        return lists, 0
    every = list(dict.fromkeys(i for l in lists for i in l.get("ids", [])))
    kept, _ = await DA.visible_account_ids(db, every)
    keep = set(kept)
    out, dropped = [], 0
    for l in lists:
        shown = [i for i in l.get("ids", []) if i in keep]
        dropped += len(l.get("ids", [])) - len(shown)
        out.append({**l, "ids": shown})
    return out, dropped


@router.get("")
async def all_lists(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.services import data_access as DA

    lists = await _clean(db, await _load(db))
    shown, dropped = await _within_areas(db, await _with_unsorted(db, lists))
    return {"lists": shown, **({"access_notice": DA.OUTSIDE_NOTICE} if dropped else {})}


@router.post("")
async def create(body: ListIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    await _lock(db)
    lists = await _load(db)
    if len(lists) >= MAX_LISTS:
        raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_LISTS} lists. Delete one first.")
    name = _name(body.name)
    if any(l["name"].lower() == name.lower() for l in lists):
        raise HTTPException(status_code=409, detail=f"You already have a list called {name}.")
    from app.core.auth_middleware import current

    ctx = current(request) or {}
    made = {"id": f"lst_{uuid.uuid4().hex[:10]}", "name": name, "ids": await _existing(db, body.ids), "owner": ctx.get("name") or ctx.get("username") or "",
            "created_at": datetime.utcnow().isoformat() + "Z"}
    await _save(db, [made] + lists)
    wanted = list(dict.fromkeys(body.ids))
    return {"list": made, "added": len(made["ids"]), "already": 0, "missing": len(wanted) - len(made["ids"])}


@router.patch("/{list_id}")
async def change(list_id: str, body: ListPatch, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    await _lock(db)
    lists = await _load(db)
    hit = next((l for l in lists if l["id"] == list_id), None)
    if not hit and list_id == VIRTUAL_ID:
        # Renaming or adding to the "not in any list" view makes it a real list holding those companies.
        loose = await _loose(db, lists)
        if loose and (body.name is not None or body.add):
            if len(lists) >= MAX_LISTS:
                raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_LISTS} lists. Delete one first.")
            hit = {"id": f"lst_{uuid.uuid4().hex[:10]}", "name": UNSORTED, "ids": loose, "created_at": datetime.utcnow().isoformat() + "Z"}
            lists = [hit] + lists
        elif loose:
            return {"list": {"id": VIRTUAL_ID, "name": UNSORTED, "ids": loose, "virtual": True}, "added": 0, "already": 0, "missing": 0, "already_items": []}
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
    before = set(hit["ids"]) - gone
    wanted = list(dict.fromkeys(body.add))
    real = set(await _existing(db, wanted))
    hit["ids"] = await _existing(db, [i for i in hit["ids"] if i not in gone] + body.add)
    hit["updated_at"] = datetime.utcnow().isoformat() + "Z"
    await _save(db, lists)
    # What really happened, so the screen never says "added 36" when 11 were already there and 2 are not saved companies.
    already_ids = [i for i in wanted if i in real and i in before]
    shown = already_ids[:300]
    rows = {r.id: r for r in (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(shown)))).scalars().all()} if shown else {}
    already_items = [{"id": i, "name": rows[i].name, "website": rows[i].website or "", "phone": rows[i].phone or "", "email": rows[i].email or "",
                      "contact": rows[i].contact_name or "", "place": rows[i].region or ""} for i in shown if i in rows]
    from app.services import data_access as DA

    shown_list, dropped = await _within_areas(db, [hit])
    hit = shown_list[0]
    return {"list": hit, **({"access_notice": DA.OUTSIDE_NOTICE} if dropped else {}), "added": len([i for i in wanted if i in real and i not in before]),
            "already": len(already_ids), "missing": len([i for i in wanted if i not in real]), "already_items": already_items}


@router.delete("/{list_id}")
async def delete(list_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    if list_id == VIRTUAL_ID:
        return {"ok": True}  # a view of companies in no list: there is nothing stored to delete
    await _lock(db)
    lists = await _load(db)
    keep = [l for l in lists if l["id"] != list_id]
    if len(keep) == len(lists):
        raise HTTPException(status_code=404, detail="That list doesn't exist any more.")
    mine = next((l for l in lists if l["id"] == list_id), {})
    if set(mine.get("ids") or []) & await _checking():
        raise HTTPException(status_code=409, detail="Companies in this list are being checked right now. Delete the list when the check has finished.")
    await _save(db, keep)
    return {"ok": True}
