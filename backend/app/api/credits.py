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
        "enforce": s["enforce"],
        "lowAt": s["low_at"],
        "rates": await K.rates(db),
        "usage30d": await K.usage_by_item(db, 30),
        "history": await K.history(db, 100),
    }


@router.get("")
async def my_credits(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    out = await _summary(db)
    out["isPlatformStaff"] = ctx["org_id"] == platform_org()
    return out


class OrgSettingsBody(BaseModel):
    lowAt: Optional[int] = None


@router.put("/settings")
async def set_my_settings(body: OrgSettingsBody, request: Request, db: AsyncSession = Depends(get_db)):
    _admin(request)
    if body.lowAt is not None:
        await K.set_org_settings(db, {"low_at": body.lowAt})
    await db.commit()
    return await _summary(db)


# ── Platform staff ──────────────────────────────────────────────────────────
@router.get("/platform/orgs")
async def platform_orgs(request: Request):
    from app.core.tenancy import org_scope, system_scope

    _staff(request)
    with system_scope():
        async with AsyncSessionLocal() as db:
            orgs = (await db.execute(text("SELECT id, name, status FROM organizations ORDER BY name"))).all()
    out = []
    for org_id, name, status in orgs:
        with org_scope(org_id):
            async with AsyncSessionLocal() as db:
                s = await K.org_settings(db, org_id)
                out.append({"id": org_id, "name": name, "status": status, "balance": await K.balance(db),
                            "enforce": s["enforce"]})
    return out


class GrantBody(BaseModel):
    org_id: str
    amount: int
    note: str = ""


@router.post("/platform/grant")
async def platform_grant(body: GrantBody, request: Request):
    from app.core.tenancy import org_scope

    ctx = _staff(request)
    if not body.amount or abs(body.amount) > 10_000_000:
        raise HTTPException(status_code=400, detail="Enter a non-zero amount.")
    await _org_exists(body.org_id)
    with org_scope(body.org_id):
        async with AsyncSessionLocal() as db:
            bal = await K.grant(db, body.amount, note=body.note or "Added by OutReach", by=ctx.get("name", ""))
            await db.commit()
    return {"org_id": body.org_id, "balance": bal}


class EnforceBody(BaseModel):
    enforce: bool


@router.put("/platform/orgs/{org_id}")
async def platform_enforce(org_id: str, body: EnforceBody, request: Request):
    from app.core.tenancy import org_scope

    _staff(request)
    await _org_exists(org_id)
    with org_scope(org_id):
        async with AsyncSessionLocal() as db:
            s = await K.set_org_settings(db, {"enforce": body.enforce}, org_id)
            await db.commit()
    return {"org_id": org_id, "enforce": s["enforce"]}


class RatesBody(BaseModel):
    rates: Dict[str, int]


@router.put("/platform/rates")
async def platform_rates(body: RatesBody, request: Request, db: AsyncSession = Depends(get_db)):
    _staff(request)
    out = await K.set_rates(db, body.rates)
    await db.commit()
    return out


async def _org_exists(org_id: str) -> None:
    from app.core.tenancy import system_scope

    with system_scope():
        async with AsyncSessionLocal() as db:
            found = (await db.execute(text("SELECT 1 FROM organizations WHERE id = :i"), {"i": org_id})).first()
    if not found:
        raise HTTPException(status_code=404, detail="Organisation not found.")
