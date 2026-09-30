"""Credits: an organisation's admins see their balance and usage; platform staff (admins of the
platform organisation) add credits, switch enforcement on or off and set the rate card."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import AsyncSessionLocal, get_db
from app.services import credits as K

router = APIRouter(prefix="/credits", tags=["Credits"])


def platform_org() -> str:
    return os.getenv("PLATFORM_ORG_ID", "org_default").strip() or "org_default"


def _admin(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can see credits.")
    return ctx


def _staff(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if not (ctx["is_admin"] and ctx["org_id"] == platform_org()):
        raise HTTPException(status_code=403, detail="Only OutReach platform staff can do this.")
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
    ctx = _admin(request)
    out = await _summary(db)
    return out
