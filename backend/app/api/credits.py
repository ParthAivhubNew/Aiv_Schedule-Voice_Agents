"""Credits: an organisation's admins see their balance and usage. Platform staff manage credits,
plans and the rate card in the staff admin portal (app/api/admin_portal.py)."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
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
    """The Leads wallet at a glance, for everyone in the organisation (not only admins): what is left,
    what running jobs hold, and what was used today and in the last 30 days."""
    current(request)
    from datetime import datetime, timedelta

    from sqlalchemy import func, select

    from app.models.models import CreditEntry

    wallet = next((w for w in await K.wallets(db) if w["key"] == "leadgen"), {"balance": 0, "held": 0, "low": False, "empty": False})
    day_ago = datetime.utcnow() - timedelta(days=1)
    today = (await db.execute(select(func.coalesce(func.sum(CreditEntry.amount), 0)).where(
        CreditEntry.kind == "usage", CreditEntry.wallet == "leadgen", CreditEntry.created_at >= day_ago))).scalar() or 0
    month = (await db.execute(select(func.coalesce(func.sum(CreditEntry.amount), 0)).where(
        CreditEntry.kind == "usage", CreditEntry.wallet == "leadgen", CreditEntry.created_at >= datetime.utcnow() - timedelta(days=30)))).scalar() or 0
    return {"balance": wallet["balance"], "held": wallet["held"], "low": wallet["low"], "empty": wallet["empty"],
            "used_today": -int(today), "used_30d": -int(month)}


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


@router.get("/usage")
async def my_usage(request: Request, month: str = "", wallet: str = "", db: AsyncSession = Depends(get_db)):
    """One month of the company's credits: use per item and per day, and every line."""
    _admin(request)
    if wallet and wallet not in K.WALLETS:
        raise HTTPException(status_code=400, detail="Unknown app.")
    return await K.usage_month(db, _month(month), wallet)
