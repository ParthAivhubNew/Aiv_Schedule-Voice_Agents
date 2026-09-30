"""Plans & credits for the signed-in organisation, and the Stripe webhook."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
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


@router.get("/overview")
async def overview(request: Request, db: AsyncSession = Depends(get_db)):
    _admin(request)
    sub = await B.subscription_row(db)
    s = await K.org_settings(db)
    return {
        "stripeReady": B.configured(),
        "testMode": B.test_mode(),
        "enforce": s["enforce"],
        "wallets": await K.wallets(db),
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


@router.post("/checkout")
async def checkout(body: CheckoutBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    if not B.configured():
        raise HTTPException(status_code=503, detail="Payments are not switched on yet.")
    try:
        url = await B.create_checkout(db, org_id=ctx["org_id"], email=ctx.get("email") or "",
                                      plan_ids=body.plans, topup_ids=body.topups, base_url=_base())
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except B.StripeError as err:
        raise HTTPException(status_code=502, detail=str(err))
    await db.commit()
    return {"url": url}


@router.post("/portal")
async def portal(request: Request, db: AsyncSession = Depends(get_db)):
    _admin(request)
    if not B.configured():
        raise HTTPException(status_code=503, detail="Payments are not switched on yet.")
    try:
        return {"url": await B.portal_url(db, _base())}
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
