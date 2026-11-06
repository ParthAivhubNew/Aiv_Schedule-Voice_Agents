"""Credits: an organisation's admins see their balance and usage. Platform staff manage credits,
plans and the rate card in the staff admin portal (app/api/admin_portal.py)."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import get_db
from app.services import credits as K

router = APIRouter(prefix="/credits", tags=["Credits"])


def _admin(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can see credits.")
    return ctx


async def _summary(db: AsyncSession) -> Dict[str, Any]:
    s = await K.org_settings(db)
    return {
        "balance": await K.balance(db),
        "wallets": await K.wallets(db),
        "enforce": s["enforce"],
        "rates": await K.rates(db),
        "usage30d": await K.usage_by_item(db, 30),
        "history": await K.history(db, 100),
    }


@router.get("/leads")
async def leads_credits(request: Request, db: AsyncSession = Depends(get_db)):
    """The Leads wallet at a glance (see wallet_glance)."""
    current(request)
    return await _glance(db, "leadgen")


@router.get("/wallet/{wallet}")
async def wallet_glance(wallet: str, request: Request, db: AsyncSession = Depends(get_db)):
    """One app's wallet at a glance, for everyone in the organisation (not only admins): what is left,
    what running jobs hold, and what was used today and in the last 30 days."""
    current(request)
    if wallet not in K.WALLETS:
        raise HTTPException(status_code=400, detail="Unknown app.")
    return await _glance(db, wallet)


async def _glance(db: AsyncSession, key: str):
    from datetime import datetime, timedelta

    from sqlalchemy import func, select

    from app.models.models import CreditEntry

    wallet = next((w for w in await K.wallets(db) if w["key"] == key), {"balance": 0, "held": 0, "low": False, "empty": False})
    day_ago = datetime.utcnow() - timedelta(days=1)
    today = (await db.execute(select(func.coalesce(func.sum(CreditEntry.amount), 0)).where(
        CreditEntry.kind == "usage", CreditEntry.wallet == key, CreditEntry.created_at >= day_ago))).scalar() or 0
    month = (await db.execute(select(func.coalesce(func.sum(CreditEntry.amount), 0)).where(
        CreditEntry.kind == "usage", CreditEntry.wallet == key, CreditEntry.created_at >= datetime.utcnow() - timedelta(days=30)))).scalar() or 0
    # What each Leads action costs, as this organisation is charged (the rate card can be edited), so the app can
    # show people the price before they press the button.
    prices = {k: {"label": v["label"], "unit": v["unit"], "credits": v["credits"]}
              for k, v in (await K.rates(db)).items() if v.get("wallet") == key and v.get("charged")}
    return {"balance": wallet["balance"], "held": wallet["held"], "low": wallet["low"], "empty": wallet["empty"],
            "used_today": -int(today), "used_30d": -int(month), "rates": prices}


@router.get("")
async def my_credits(request: Request, db: AsyncSession = Depends(get_db)):
    _admin(request)
    return await _summary(db)


def _month(month: str) -> str:
    import re
    from datetime import datetime

    month = month or datetime.utcnow().strftime("%Y-%m")
    if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="Pick a month like 2026-09.")
    return month


@router.get("/people")
async def people(request: Request, days: int = 30, user_id: str = "", db: AsyncSession = Depends(get_db)):
    """Who used how many credits. Everyone: the organisation's total and their own share and detail. Admins: every person,
    and any person's detail (?user_id=)."""
    ctx = current(request)
    days = max(1, min(int(days or 30), 365))
    return await K.people_usage(db, ctx["operator_id"], bool(ctx["is_admin"]), days, user_id if ctx["is_admin"] else "")


class CapIn(BaseModel):
    monthly_cap: Optional[int] = Field(None, ge=0, le=10_000_000)  # None removes the limit


@router.put("/people/{user_id}/cap")
async def set_cap(user_id: str, body: CapIn, request: Request, db: AsyncSession = Depends(get_db)):
    """An admin sets (or clears) the most credits one person may use per calendar month. Written to the credit history."""
    from app.models.models import Operator

    ctx = _admin(request)
    op = await db.get(Operator, user_id)  # row security: only this organisation's people can be found
    if not op:
        raise HTTPException(status_code=404, detail="That person isn't in your team.")
    before = op.monthly_cap
    op.monthly_cap = body.monthly_cap
    db.add(K._entry("adjust", 0, "voice", note=f"Monthly limit for {op.name or op.username}: {before if before is not None else 'none'} -> {body.monthly_cap if body.monthly_cap is not None else 'none'}",
                    by=str(ctx.get("name") or ctx.get("email") or ctx["operator_id"])))
    await db.commit()
    return {"userId": op.id, "monthlyCap": op.monthly_cap}


@router.get("/usage")
async def my_usage(request: Request, month: str = "", wallet: str = "", db: AsyncSession = Depends(get_db)):
    """One month of the company's credits: use per item and per day, and every line."""
    _admin(request)
    if wallet and wallet not in K.WALLETS:
        raise HTTPException(status_code=400, detail="Unknown app.")
    return await K.usage_month(db, _month(month), wallet)
