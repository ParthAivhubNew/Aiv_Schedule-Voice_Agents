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


@router.get("")
async def my_credits(request: Request, db: AsyncSession = Depends(get_db)):
    _admin(request)
    return await _summary(db)
