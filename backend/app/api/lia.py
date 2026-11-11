"""The customer's legitimate interests assessment: read, edit, download as text."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import CompanyProfile
from app.services import lia as L

router = APIRouter(prefix="/leads/lia", tags=["Leads"])


class LiaIn(BaseModel):
    purpose: Optional[str] = ""
    necessity: Optional[str] = ""
    balance: Optional[str] = ""
    safeguards: Optional[str] = ""


@router.get("")
async def get_lia(db: AsyncSession = Depends(get_db)):
    return await L.get(db)


@router.put("")
async def put_lia(body: LiaIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    return await L.put(db, body.model_dump(), by=str(ctx.get("email") or ctx.get("operator_id") or ""))


@router.get(".txt")
async def lia_text(db: AsyncSession = Depends(get_db)):
    p = (await db.execute(select(CompanyProfile).limit(1))).scalars().first()
    body = L.as_text(await L.get(db), getattr(p, "name", "") or "")
    return Response(body, media_type="text/plain; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="legitimate-interests-assessment.txt"'})
