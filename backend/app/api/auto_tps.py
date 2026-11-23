"""The organisation's switch for automatic TPS and CTPS screening of saved phone numbers.

GET /org/auto-tps   {enabled, notice, price}   the switch (on unless an admin turned it off) and the last problem found
PUT /org/auto-tps   {enabled}                  turn it on or off; every change writes an audit row

Admins only, checked in each handler. The work itself is services/auto_tps.py.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import get_db
from app.services import audit
from app.services import auto_tps as AT
from app.services import credits as K

router = APIRouter(prefix="/org/auto-tps", tags=["Phone screening"])


class SwitchIn(BaseModel):
    enabled: bool


def _admin(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if ctx.get("type") == "api_key" or not ctx.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only an account admin can change phone screening.")
    return ctx


async def _out(db: AsyncSession, org: str) -> Dict[str, Any]:
    st = await AT.load(db, org)
    rate = (await K.rates(db)).get(AT.ITEM, {}).get("credits", 2)
    return {"enabled": st["enabled"], "notice": st["notice"], "credits_per_five": rate}


@router.get("")
async def read(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = _admin(request)
    return await _out(db, ctx["org_id"])


@router.put("")
async def change(body: SwitchIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = _admin(request)
    org = ctx["org_id"]
    old = (await AT.load(db, org))["enabled"]
    if old != body.enabled:
        await AT.set_enabled(db, org, body.enabled)
        await audit.record(db, "auto_tps.updated", target=org, detail={"old": old, "new": body.enabled},
                           actor_id=ctx.get("operator_id") or "", actor_name=str(ctx.get("name") or ctx.get("username") or ""))
    await db.commit()
    return await _out(db, org)
