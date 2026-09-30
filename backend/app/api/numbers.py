"""Phone numbers of the organisation, and which users may call from each."""
from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.accounts import org_of
from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import Operator, OrgPhoneNumber
from app.services import numbers as N

router = APIRouter(prefix="/numbers", tags=["Phone numbers"])


class NumberBody(BaseModel):
    e164: str
    label: str = ""
    provider: str = "telnyx"
    provider_ref: str = ""
    assistant_id: str = ""
    capabilities: List[str] = ["voice"]
    is_default: bool = False


class NumberPatch(BaseModel):
    label: Optional[str] = None
    assistant_id: Optional[str] = None
    capabilities: Optional[List[str]] = None
    status: Optional[str] = None
    is_default: Optional[bool] = None


class AssignBody(BaseModel):
    operator_ids: List[str] = []


@router.get("")
async def list_numbers(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    await N.seed_from_legacy(db)
    return await N.numbers_json(db, ctx)


async def _get(db: AsyncSession, number_id: str) -> OrgPhoneNumber:
    num = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.id == number_id))).scalars().first()
    if not num:
        raise HTTPException(status_code=404, detail="Number not found.")
    return num


async def _only_default(db: AsyncSession, keep_id: str) -> None:
    await db.execute(update(OrgPhoneNumber).where(OrgPhoneNumber.id != keep_id).values(is_default=False))


@router.post("")
async def add_number(body: NumberBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    e164 = N.normalize(body.e164)
    if len(e164) < 8:
        raise HTTPException(status_code=400, detail="Enter the number in international format, e.g. +44 20 7946 0000.")
    if any(N.normalize(n.e164) == e164 for n in await N.list_numbers(db)):
        raise HTTPException(status_code=400, detail="This number is already saved.")
    first = not await N.list_numbers(db)
    num = OrgPhoneNumber(id=f"num_{uuid.uuid4().hex[:10]}", e164=e164, label=body.label.strip(), provider=body.provider,
                         provider_ref=body.provider_ref, assistant_id=body.assistant_id.strip(),
                         capabilities=body.capabilities or ["voice"], is_default=body.is_default or first)
    db.add(num)
    await db.flush()
    if num.is_default:
        await _only_default(db, num.id)
    await db.commit()
    return await N.numbers_json(db, ctx)


@router.patch("/{number_id}")
async def update_number(number_id: str, body: NumberPatch, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    num = await _get(db, number_id)
    if body.label is not None:
        num.label = body.label.strip()
    if body.assistant_id is not None:
        num.assistant_id = body.assistant_id.strip()
    if body.capabilities is not None:
        num.capabilities = body.capabilities
    if body.status is not None:
        if body.status not in ("active", "disabled", "pending"):
            raise HTTPException(status_code=400, detail="Unknown status.")
        num.status = body.status
    if body.is_default:
        num.is_default = True
        await _only_default(db, num.id)
    await db.commit()
    return await N.numbers_json(db, ctx)


@router.put("/{number_id}/assignments")
async def assign(number_id: str, body: AssignBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    await _get(db, number_id)
    ops = (await db.execute(select(Operator).where(Operator.id.in_(body.operator_ids or [""])))).scalars().all()
    valid = [o.id for o in ops if org_of(o) == ctx["org_id"]]
    if len(valid) != len(set(body.operator_ids or [])):
        raise HTTPException(status_code=400, detail="Unknown user.")
    await N.set_assignments(db, number_id, valid)
    await db.commit()
    return await N.numbers_json(db, ctx)


@router.delete("/{number_id}")
async def remove_number(number_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    num = await _get(db, number_id)
    was_default = num.is_default
    await db.delete(num)
    await db.flush()
    if was_default:
        rest = await N.list_numbers(db)
        if rest:
            rest[0].is_default = True
    await db.commit()
    return await N.numbers_json(db, ctx)
