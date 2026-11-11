"""Recorded permission to call a number with AI-voiced calls, and the TPS status of a number (see services/call_permission.py).

GET  /voice/call-permissions?number=      this number: active permission, TPS status, and whether an AI call or a person's call may go
GET  /voice/call-permissions/list         every permission recorded, newest first
POST /voice/call-permissions              record one (the exact wording is stored with it)
POST /voice/call-permissions/{id}/withdraw
GET  /voice/call-permissions/wording?company=&number=&product=   the wording the person agrees to
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import get_db
from app.services import call_permission as CP

router = APIRouter(prefix="/voice/call-permissions", tags=["Voice"])


@router.get("/wording")
async def wording_preview(company: str = "", number: str = "", product: str = "") -> Dict[str, Any]:
    return {"wording": CP.wording(company, number or "(their number)", product), "version": CP.WORDING_VERSION,
            "methods": [{"id": k, "label": v} for k, v in CP.METHODS.items()]}


@router.get("/list")
async def listing(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    return {"permissions": await CP.list_consents(db)}


@router.get("")
async def one_number(number: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ai = await CP.decide(db, number, "ai")
    human = await CP.decide(db, number, "human")
    return {"number": CP.normalize_phone(number), "permission": await CP.active_consent(db, number), "screening": await CP.status(db, number),
            "ai": ai, "human": human}


class RecordIn(BaseModel):
    number: str
    company: str
    person: str = ""
    product: str = ""
    method: str = "verbal_recorded"
    evidence_ref: str = ""
    lead_id: str = ""


@router.post("")
async def record(body: RecordIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = current(request)
    try:
        out = await CP.record_consent(db, number=body.number, company=body.company, person=body.person, product=body.product, method=body.method,
                                      evidence_ref=body.evidence_ref, lead_id=body.lead_id,
                                      recorded_by=str(ctx.get("name") or ctx.get("email") or ctx.get("operator_id") or ""))
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    await db.commit()
    return {"permission": out}


class WithdrawIn(BaseModel):
    method: str = ""


@router.post("/{consent_id}/withdraw")
async def withdraw(consent_id: str, body: WithdrawIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = current(request)
    try:
        out = await CP.withdraw_consent(db, consent_id, by=str(ctx.get("name") or ctx.get("email") or ""), method=body.method)
    except LookupError as err:
        raise HTTPException(status_code=404, detail=str(err))
    await db.commit()
    return {"permission": out}
