"""Credits: an organisation's admins see their balance and usage; platform staff (admins of the
platform organisation) add credits, switch enforcement on or off and set the rate card."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
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
    out["isPlatformStaff"] = ctx["org_id"] == platform_org()
    return out


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
                            "wallets": {w["key"]: w["balance"] for w in await K.wallets(db)}, "enforce": s["enforce"]})
    return out


class GrantBody(BaseModel):
    org_id: str
    amount: int
    wallet: str = "voice"
    expires_in_days: Optional[int] = None  # None = never expires
    note: str = ""


@router.post("/platform/grant")
async def platform_grant(body: GrantBody, request: Request):
    from datetime import datetime, timedelta

    from app.core.tenancy import org_scope

    ctx = _staff(request)
    if not body.amount or abs(body.amount) > 10_000_000:
        raise HTTPException(status_code=400, detail="Enter a non-zero amount.")
    if body.wallet not in K.WALLETS:
        raise HTTPException(status_code=400, detail="Unknown wallet.")
    await _org_exists(body.org_id)
    expires = datetime.utcnow() + timedelta(days=body.expires_in_days) if body.expires_in_days else None
    with org_scope(body.org_id):
        async with AsyncSessionLocal() as db:
            bal = await K.grant(db, body.amount, note=body.note or "Added by OutReach", by=ctx.get("name", ""),
                                wallet=body.wallet, expires_at=expires)
            await db.commit()
    return {"org_id": body.org_id, "wallet": body.wallet, "balance": bal}


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


# ── Plans and top-ups (staff) ──────────────────────────────────────────────
class PlanBody(BaseModel):
    wallet: str
    kind: str = "plan"
    name: str
    description: str = ""
    priceUsdCents: int
    credits: int
    features: list = []
    active: bool = True
    sort: int = 0


def _check_plan(body: PlanBody) -> None:
    if body.wallet not in K.WALLETS or body.kind not in ("plan", "topup"):
        raise HTTPException(status_code=400, detail="Pick an app and plan or top-up.")
    if body.priceUsdCents < 50 or body.credits <= 0 or not body.name.strip():
        raise HTTPException(status_code=400, detail="Name, a price of at least $0.50 and credits are required.")


@router.get("/platform/plans")
async def list_plans(request: Request, db: AsyncSession = Depends(get_db)):
    from app.services import billing as B

    _staff(request)
    return [B.plan_json(p) for p in await B.plans(db, active_only=False)]


@router.post("/platform/plans")
async def create_plan(body: PlanBody, request: Request, db: AsyncSession = Depends(get_db)):
    import uuid

    from app.models.models import BillingPlan
    from app.services import billing as B

    _staff(request)
    _check_plan(body)
    p = BillingPlan(id=f"plan_{uuid.uuid4().hex[:10]}", wallet=body.wallet, kind=body.kind, name=body.name.strip()[:80],
                    description=body.description[:300], price_usd_cents=body.priceUsdCents, credits=body.credits,
                    features=body.features[:12], active=body.active, sort=body.sort)
    db.add(p)
    await db.commit()
    return B.plan_json(p)


@router.put("/platform/plans/{plan_id}")
async def update_plan(plan_id: str, body: PlanBody, request: Request, db: AsyncSession = Depends(get_db)):
    from sqlalchemy.future import select

    from app.models.models import BillingPlan
    from app.services import billing as B

    _staff(request)
    _check_plan(body)
    p = (await db.execute(select(BillingPlan).where(BillingPlan.id == plan_id))).scalars().first()
    if not p:
        raise HTTPException(status_code=404, detail="Plan not found.")
    if (p.price_usd_cents != body.priceUsdCents or p.kind != body.kind) and p.stripe_price_id:
        p.stripe_price_id = ""  # a new Stripe price is needed; existing subscribers keep theirs
    p.wallet, p.kind, p.name, p.description = body.wallet, body.kind, body.name.strip()[:80], body.description[:300]
    p.price_usd_cents, p.credits, p.features, p.active, p.sort = body.priceUsdCents, body.credits, body.features[:12], body.active, body.sort
    await db.commit()
    return B.plan_json(p)


@router.get("/platform/stripe-prices")
async def stripe_prices(request: Request, db: AsyncSession = Depends(get_db)):
    """Prices made in the Stripe Dashboard that are not on sale here yet. Opening this also
    refreshes the names and descriptions of the ones on sale from Stripe."""
    from app.services import billing as B

    _staff(request)
    try:
        prices = await B.unlinked_prices(db)
    except B.StripeError as err:
        raise HTTPException(status_code=502, detail=str(err))
    await db.commit()
    return prices


class StripePriceBody(BaseModel):
    priceId: str = Field(pattern=r"^price_\w+$")
    wallet: str
    credits: int


@router.post("/platform/plans/from-stripe")
async def plan_from_stripe(body: StripePriceBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Put a price that already exists in Stripe on sale: staff say which plugin it is for and
    how many credits it gives; name, amount, currency and monthly/one-off come from Stripe."""
    from sqlalchemy.future import select

    from app.models.models import BillingPlan
    from app.services import billing as B

    _staff(request)
    if body.wallet not in K.WALLETS or body.credits <= 0:
        raise HTTPException(status_code=400, detail="Pick an app and how many credits it gives.")
    if (await db.execute(select(BillingPlan).where(BillingPlan.stripe_price_id == body.priceId))).scalars().first():
        raise HTTPException(status_code=400, detail="That price is already on sale.")
    try:
        p = await B.plan_from_price(body.priceId, body.wallet, body.credits)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except B.StripeError as err:
        raise HTTPException(status_code=502, detail=str(err))
    db.add(p)
    await db.commit()
    return B.plan_json(p)


@router.get("/platform/telnyx-costs")
async def telnyx_costs(request: Request, month: str = ""):
    """Per organisation on our Telnyx account: Telnyx's cost for its billing group this month,
    the minutes we billed, what it paid us, and the margin."""
    import re
    from datetime import datetime

    from app.services import telnyx_usage
    from app.services.telnyx_client import TelnyxError, platform_key

    _staff(request)
    month = month or datetime.utcnow().strftime("%Y-%m")
    if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="Pick a month like 2026-09.")
    if not platform_key():
        raise HTTPException(status_code=503, detail="Telnyx is not connected on the platform yet.")
    try:
        return await telnyx_usage.margin_report(month)
    except TelnyxError as err:
        raise HTTPException(status_code=502, detail=str(err))


@router.post("/platform/plans/{plan_id}/sync-stripe")
async def sync_plan(plan_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    from sqlalchemy.future import select

    from app.models.models import BillingPlan
    from app.services import billing as B

    _staff(request)
    p = (await db.execute(select(BillingPlan).where(BillingPlan.id == plan_id))).scalars().first()
    if not p:
        raise HTTPException(status_code=404, detail="Plan not found.")
    try:
        await B.sync_plan_to_stripe(p)
    except B.StripeError as err:
        raise HTTPException(status_code=502, detail=str(err))
    await db.commit()
    return B.plan_json(p)
