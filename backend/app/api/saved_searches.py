"""Saved searches: Find Leads searches kept as lists that fill themselves.

GET    /leads/saved-searches
POST   /leads/saved-searches            save the current filters, run once, make the list
PATCH  /leads/saved-searches/{id}       rename, or switch the weekly top-up
DELETE /leads/saved-searches/{id}       forget the search (its list stays)
POST   /leads/saved-searches/{id}/run   add the companies it has not shown before
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import get_db
from app.services import saved_searches as SS

router = APIRouter(prefix="/leads/saved-searches", tags=["Leads"])


class SearchIn(BaseModel):
    name: str = ""
    filters: Dict[str, Any] = {}
    list_name: str = ""
    weekly: bool = False


class SearchPatch(BaseModel):
    name: Optional[str] = None
    weekly: Optional[bool] = None


@router.get("")
async def list_searches(db: AsyncSession = Depends(get_db)):
    return {"searches": [SS.public(s) for s in await SS.load(db)]}


@router.post("")
async def create_search(body: SearchIn, request: Request, db: AsyncSession = Depends(get_db)):
    who = current(request)
    try:
        s = await SS.create(db, body.name, body.filters, body.list_name, body.weekly, who.get("name") or who.get("username") or "")
    except SS.SavedSearchError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return SS.public(s)


@router.patch("/{search_id}")
async def update_search(search_id: str, body: SearchPatch, db: AsyncSession = Depends(get_db)):
    searches = await SS.load(db)
    s = next((x for x in searches if x["id"] == search_id), None)
    if not s:
        raise HTTPException(status_code=404, detail="That saved search doesn't exist any more.")
    if body.name is not None:
        name = " ".join(body.name.split())[:SS.MAX_NAME]
        if not name:
            raise HTTPException(status_code=400, detail="Give the search a name.")
        s["name"] = name
    if body.weekly is not None:
        s["weekly"] = body.weekly
    await SS._save(db, searches)
    return SS.public(s)


@router.delete("/{search_id}")
async def delete_search(search_id: str, db: AsyncSession = Depends(get_db)):
    searches = await SS.load(db)
    kept = [x for x in searches if x["id"] != search_id]
    if len(kept) == len(searches):
        raise HTTPException(status_code=404, detail="That saved search doesn't exist any more.")
    await SS._save(db, kept)
    return {"ok": True}


@router.post("/{search_id}/run")
async def run_search(search_id: str, db: AsyncSession = Depends(get_db)):
    try:
        s = await SS.run_by_id(db, search_id)
    except SS.SavedSearchError as err:
        raise HTTPException(status_code=404, detail=str(err))
    return SS.public(s)
