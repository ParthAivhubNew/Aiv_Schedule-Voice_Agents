"""Plans & credits for the signed-in organisation, and the Stripe webhook."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import get_db
from app.services import billing as B
from app.services import credits as K

logger = logging.getLogger("billing_api")
router = APIRouter(prefix="/billing", tags=["Billing"])


def _admin(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can see plans and credits.")
    return ctx


def _base() -> str:
    from app.config import settings

    return (settings.PUBLIC_BASE_URL or "").rstrip("/")


LIVE_SUB_STATUSES = ("active", "trialing", "past_due")


def _is_aivhub_org(org_id: str) -> bool:
    """Aivhub's own organisation, under whichever id it's known by. Same identifiers the
    Telnyx/managed-assistant exclusion already uses (voice_assistants.enabled_for_org) —
    Aivhub's house account is never a paying customer and must never be paywalled."""
    from app.core.auth_middleware import platform_org
    from app.core.platform import AIVHUB_ORG

    return org_id in (platform_org(), AIVHUB_ORG, "org_default", "org_outreach")


async def _has_active_plan(db: AsyncSession, wallets_dict: List[Dict[str, Any]], org_id: str = "") -> Dict[str, bool]:
    """Per-wallet: does the org's subscription cover it with a live status. Shared by /access
    (any operator) and /overview (admin-only) so the "what counts as active" rule lives in one
    place. Aivhub's own org always counts as covered, on every wallet, regardless of whether a
    subscription row exists for it."""
    if _is_aivhub_org(org_id):
        return {w["key"]: True for w in wallets_dict}
    sub = await B.subscription_row(db)
    sub_plans = (sub.plans or {}) if (sub and sub.status in LIVE_SUB_STATUSES) else {}
    return {w["key"]: bool(sub_plans.get(w["key"])) for w in wallets_dict}


@router.get("/access")
async def access(request: Request, db: AsyncSession = Depends(get_db)):
    """Lightweight, non-admin-safe check for whether each wallet has an active plan.

    Used by PluginAccessGate to decide whether to lock a plugin's tabs for any logged-in
    operator, not just admins (/billing/overview is admin-only and leaks plan/usage detail).
    """
    ctx = current(request)
    wallets_dict = await K.wallets(db)
    return {"has_active_plan": await _has_active_plan(db, wallets_dict, ctx.get("org_id", ""))}


@router.get("/overview")
async def overview(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    sub = await B.subscription_row(db)
    s = await K.org_settings(db)
    wallets_dict = await K.wallets(db)
    has_active_plan = await _has_active_plan(db, wallets_dict, ctx.get("org_id", ""))
    return {
        "stripeReady": B.configured(),
        "testMode": B.test_mode(),
        "taxAdded": B.automatic_tax(),  # prices exclude tax: Stripe adds VAT at Checkout
        "enforce": s["enforce"],
        "wallets": wallets_dict,
        "has_active_plan": has_active_plan,
        "hasActivePlan": has_active_plan,
        "plans": [B.plan_json(p) for p in await B.plans(db)],
        "subscription": {
            "status": sub.status if sub else "none",
            "plans": (sub.plans or {}) if sub else {},
            "renewsAt": sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
            "hasCustomer": bool(sub and sub.stripe_customer_id),
        },
        "rates": await K.rates(db),
        "usage30d": await K.usage_by_item(db, 30),
        "history": await K.history(db, 100),
    }


class CheckoutBody(BaseModel):
    plans: List[str] = []
    topups: List[str] = []
    back: str = Field("/", pattern=r"^/[a-z/]*$")  # page of the app to return to after paying
    quantities: Dict[str, int] = {}  # top-up id -> how many (1 when missing)


@router.post("/checkout")
async def checkout(body: CheckoutBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    if not B.configured():
        raise HTTPException(status_code=503, detail="Payments are not switched on yet.")
    try:
        url = await B.create_checkout(db, org_id=ctx["org_id"], email=ctx.get("email") or "",
                                      plan_ids=body.plans, topup_ids=body.topups, base_url=_base(), back=body.back,
                                      quantities=body.quantities)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except B.StripeError as err:
        raise HTTPException(status_code=502, detail=str(err))
    await db.commit()
    return {"url": url}


# ── A plugin's plan, managed from its Subscription page ────────────────────
@router.get("/subscriptions")
async def subscriptions(request: Request, db: AsyncSession = Depends(get_db)):
    """Each plugin's plan as Stripe has it now: which plan, when it renews, whether it is ending."""
    _admin(request)
    if not B.configured():
        return {}
    try:
        live = await B.live_plans(db)
    except B.StripeError as err:
        raise HTTPException(status_code=502, detail=str(err))
    return {w: {k: v[k] for k in ("planId", "status", "periodEnd", "ending", "alone")} for w, v in live.items()}


class PlanBody(BaseModel):
    plan: str


@router.post("/plan")
async def change_plan(body: PlanBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Switch a plugin to another of its plans. url is set when the bank wants the upgrade
    payment confirmed on Stripe's page first."""
    _admin(request)
    if not B.configured():
        raise HTTPException(status_code=503, detail="Payments are not switched on yet.")
    try:
        return {"url": await B.change_plan(db, body.plan)}
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except B.StripeError as err:
        raise HTTPException(status_code=502, detail=str(err))


class CancelBody(BaseModel):
    wallet: str
    cancel: bool = True  # False: keep the plan after all


@router.post("/cancel")
async def cancel_plan(body: CancelBody, request: Request, db: AsyncSession = Depends(get_db)):
    _admin(request)
    if not B.configured():
        raise HTTPException(status_code=503, detail="Payments are not switched on yet.")
    try:
        await B.set_ending(db, body.wallet, body.cancel)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except B.StripeError as err:
        raise HTTPException(status_code=502, detail=str(err))
    return {"wallet": body.wallet, "ending": body.cancel}


class PortalBody(BaseModel):
    back: str = Field("/", pattern=r"^/[a-z/]*$")


@router.post("/portal")
async def portal(request: Request, body: Optional[PortalBody] = None, db: AsyncSession = Depends(get_db)):
    _admin(request)
    if not B.configured():
        raise HTTPException(status_code=503, detail="Payments are not switched on yet.")
    try:
        return {"url": await B.portal_url(db, _base(), body.back if body else "/")}
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except B.StripeError as err:
        raise HTTPException(status_code=502, detail=str(err))


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Public. Only signed Stripe events are accepted; each is handled once."""
    raw = await request.body()
    if not B.verify_signature(raw, request.headers.get("stripe-signature", "")):
        raise HTTPException(status_code=400, detail="Bad signature")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad payload")
    result = await B.handle_event(event)
    logger.info(f"[billing] {event.get('type')} {event.get('id')}: {result}")
    return {"received": True, "result": result}
