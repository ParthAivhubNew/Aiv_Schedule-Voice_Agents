"""Stripe billing (ready for keys: works as soon as STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET
are set; test keys and live keys work the same way).

- Plans and top-ups are priced in USD. Stripe Adaptive Pricing is switched on for every
  Checkout, so UK clients see and pay in GBP at Stripe's rate.
- One Checkout can hold several plugins: monthly plans become one subscription with one item
  per plugin; top-ups are one-off items (in the same Checkout when plans are bought too).
- Credits are only ever granted from verified Stripe webhooks: top-ups on checkout completion
  (expire after 30 days), plan credits on each paid invoice (expire at the period end).
  Each Stripe event is handled once.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.future import select

logger = logging.getLogger("billing")

STRIPE_API = "https://api.stripe.com/v1"
TOLERANCE_S = 300


def secret_key() -> str:
    return os.getenv("STRIPE_SECRET_KEY", "").strip()


def webhook_secret() -> str:
    return os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()


def publishable_key() -> str:
    return os.getenv("STRIPE_PUBLISHABLE_KEY", "").strip()


def configured() -> bool:
    return bool(secret_key())


def test_mode() -> bool:
    return secret_key().startswith(("sk_test_", "rk_test_"))


class StripeError(Exception):
    pass


def _flatten(data: Any, prefix: str = "") -> List[Tuple[str, str]]:
    """Stripe's form encoding: {"a": {"b": 1}, "c": [{"d": 2}]} -> a[b]=1, c[0][d]=2."""
    out: List[Tuple[str, str]] = []
    if isinstance(data, dict):
        for k, v in data.items():
            out += _flatten(v, f"{prefix}[{k}]" if prefix else str(k))
    elif isinstance(data, (list, tuple)):
        for i, v in enumerate(data):
            out += _flatten(v, f"{prefix}[{i}]")
    elif isinstance(data, bool):
        out.append((prefix, "true" if data else "false"))
    elif data is not None:
        out.append((prefix, str(data)))
    return out


async def stripe(method: str, path: str, data: Optional[Dict[str, Any]] = None, idempotency_key: str = "") -> Dict[str, Any]:
    if not configured():
        raise StripeError("Payments are not set up yet.")
    headers = {"Authorization": f"Bearer {secret_key()}"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    async with httpx.AsyncClient(timeout=20.0) as client:
        if method == "GET":
            r = await client.get(f"{STRIPE_API}{path}", params=_flatten(data or {}), headers=headers)
        else:
            r = await client.request(method, f"{STRIPE_API}{path}", data=_flatten(data or {}), headers=headers)
    body = r.json() if r.content else {}
    if r.status_code >= 400:
        msg = (body.get("error") or {}).get("message") or f"Stripe error ({r.status_code})"
        logger.warning(f"[billing] {method} {path}: {msg}")
        raise StripeError(msg)
    return body


def verify_signature(payload: bytes, header: str, secret: Optional[str] = None, now: Optional[int] = None) -> bool:
    """Stripe-Signature: t=<ts>,v1=<hex hmac of "<ts>.<payload>">; rejects old or wrong ones."""
    secret = secret if secret is not None else webhook_secret()
    if not secret or not header:
        return False
    parts: Dict[str, List[str]] = {}
    for item in header.split(","):
        k, _, v = item.strip().partition("=")
        parts.setdefault(k, []).append(v)
    try:
        ts = int(parts.get("t", ["0"])[0])
    except ValueError:
        return False
    if abs((now or int(time.time())) - ts) > TOLERANCE_S:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in parts.get("v1", []))


# ── Plans (staff) ──────────────────────────────────────────────────────────
async def plans(db, active_only: bool = True) -> List[Any]:
    from app.models.models import BillingPlan

    q = select(BillingPlan)
    if active_only:
        q = q.where(BillingPlan.active.is_(True))
    rows = (await db.execute(q)).scalars().all()
    return sorted(rows, key=lambda p: (p.wallet, p.kind != "plan", p.sort, p.price_usd_cents))


def plan_json(p) -> Dict[str, Any]:
    return {"id": p.id, "wallet": p.wallet, "kind": p.kind, "name": p.name, "description": p.description,
            "priceUsdCents": p.price_usd_cents, "credits": p.credits, "features": p.features or [],
            "active": bool(p.active), "sort": p.sort, "stripePriceId": p.stripe_price_id, "inStripe": bool(p.stripe_price_id)}


async def sync_plan_to_stripe(p) -> None:
    """Create the product and USD price in Stripe (prices can't change there: a new price is
    made when ours changes)."""
    if not p.stripe_product_id:
        prod = await stripe("POST", "/products", {"name": f"OutReach {p.name}", "metadata": {"plan_id": p.id, "wallet": p.wallet}},
                            idempotency_key=f"prod-{p.id}")
        p.stripe_product_id = prod["id"]
    price: Dict[str, Any] = {"product": p.stripe_product_id, "currency": "usd", "unit_amount": p.price_usd_cents,
                             "metadata": {"plan_id": p.id, "wallet": p.wallet, "credits": p.credits, "kind": p.kind}}
    if p.kind == "plan":
        price["recurring"] = {"interval": "month"}
    made = await stripe("POST", "/prices", price, idempotency_key=f"price-{p.id}-{p.price_usd_cents}-{p.kind}")
    p.stripe_price_id = made["id"]


# ── Checkout and portal ────────────────────────────────────────────────────
async def subscription_row(db, create: bool = False):
    from app.core.tenancy import current_org
    from app.models.models import BillingSubscription

    row = (await db.execute(select(BillingSubscription).where(BillingSubscription.id == current_org()))).scalars().first()
    if row is None and create:
        row = BillingSubscription(id=current_org(), status="none", plans={})
        db.add(row)
        await db.flush()
    return row


async def create_checkout(db, *, org_id: str, email: str, plan_ids: List[str], topup_ids: List[str], base_url: str) -> str:
    from app.models.models import BillingPlan

    wanted = list(dict.fromkeys(plan_ids + topup_ids))
    if not wanted:
        raise ValueError("Pick at least one plan or top-up.")
    rows = {p.id: p for p in (await db.execute(select(BillingPlan).where(BillingPlan.id.in_(wanted), BillingPlan.active.is_(True)))).scalars().all()}
    chosen_plans = [rows[i] for i in plan_ids if i in rows and rows[i].kind == "plan"]
    chosen_topups = [rows[i] for i in topup_ids if i in rows and rows[i].kind == "topup"]
    if len(chosen_plans) + len(chosen_topups) != len(wanted):
        raise ValueError("One of those plans is no longer available. Reload and try again.")
    if len({p.wallet for p in chosen_plans}) != len(chosen_plans):
        raise ValueError("Pick one plan per plugin.")
    missing = [p.name for p in chosen_plans + chosen_topups if not p.stripe_price_id]
    if missing:
        raise ValueError(f"Not ready for sale yet: {', '.join(missing)}.")

    sub = await subscription_row(db, create=True)
    if chosen_plans and sub.stripe_subscription_id and sub.status in ("active", "past_due", "trialing"):
        raise ValueError("You already have a subscription. Change plans from Manage billing.")
    meta = {"org_id": org_id, "plans": ",".join(p.id for p in chosen_plans), "topups": ",".join(p.id for p in chosen_topups)}
    params: Dict[str, Any] = {
        "mode": "subscription" if chosen_plans else "payment",
        "line_items": [{"price": p.stripe_price_id, "quantity": 1} for p in chosen_plans + chosen_topups],
        "success_url": f"{base_url}/?billing=success",
        "cancel_url": f"{base_url}/?billing=cancelled",
        "client_reference_id": org_id,
        "metadata": meta,
        "adaptive_pricing": {"enabled": True},  # UK clients pay in GBP at Stripe's rate
        "allow_promotion_codes": True,
    }
    if sub.stripe_customer_id:
        params["customer"] = sub.stripe_customer_id
    elif email:
        params["customer_email"] = email
    if chosen_plans:
        params["subscription_data"] = {"metadata": meta}
    else:
        params["payment_intent_data"] = {"metadata": meta}
        params["customer_creation"] = "always" if not sub.stripe_customer_id else None
    session = await stripe("POST", "/checkout/sessions", params, idempotency_key=f"co-{org_id}-{uuid.uuid4().hex}")
    return session["url"]


async def portal_url(db, base_url: str) -> str:
    sub = await subscription_row(db)
    if not sub or not sub.stripe_customer_id:
        raise ValueError("No billing account yet: buy a plan or top-up first.")
    s = await stripe("POST", "/billing_portal/sessions", {"customer": sub.stripe_customer_id, "return_url": f"{base_url}/"})
    return s["url"]


# ── Webhook events ─────────────────────────────────────────────────────────
def _meta_org(obj: Dict[str, Any]) -> str:
    meta = obj.get("metadata") or {}
    if meta.get("org_id"):
        return meta["org_id"]
    for path in (("subscription_details",), ("parent", "subscription_details")):
        cur: Any = obj
        for key in path:
            cur = (cur or {}).get(key) or {}
        if (cur.get("metadata") or {}).get("org_id"):
            return cur["metadata"]["org_id"]
    return obj.get("client_reference_id") or ""


async def _org_for_customer(customer_id: str) -> str:
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import BillingSubscription

    if not customer_id:
        return ""
    with system_scope():
        async with AsyncSessionLocal() as db:
            row = (await db.execute(select(BillingSubscription).where(BillingSubscription.stripe_customer_id == customer_id))).scalars().first()
            return row.org_id if row else ""


async def _plan_by_price(db, price_id: str):
    from app.models.models import BillingPlan

    return (await db.execute(select(BillingPlan).where(BillingPlan.stripe_price_id == price_id))).scalars().first()


def _ts(v: Any) -> Optional[datetime]:
    try:
        return datetime.utcfromtimestamp(int(v)) if v else None
    except (TypeError, ValueError):
        return None


async def handle_event(event: Dict[str, Any]) -> str:
    """Apply one verified Stripe event. Returns what was done (for logs and tests)."""
    from app.core.tenancy import org_scope, system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import BillingPlan, StripeEvent
    from app.services import credits as K

    event_id, etype = event.get("id") or "", event.get("type") or ""
    obj = (event.get("data") or {}).get("object") or {}
    with system_scope():
        async with AsyncSessionLocal() as db:
            if (await db.execute(select(StripeEvent).where(StripeEvent.id == event_id))).scalars().first():
                return "duplicate"
            db.add(StripeEvent(id=event_id, type=etype))
            await db.commit()

    org_id = _meta_org(obj) or await _org_for_customer(obj.get("customer") or "")
    if not org_id:
        logger.warning(f"[billing] {etype} {event_id}: no organisation found")
        return "no_org"

    with org_scope(org_id):
        async with AsyncSessionLocal() as db:
            sub = await subscription_row(db, create=True)
            if obj.get("customer") and not sub.stripe_customer_id:
                sub.stripe_customer_id = obj["customer"]
            done = "ignored"

            if etype == "checkout.session.completed":
                if obj.get("subscription"):
                    sub.stripe_subscription_id = obj["subscription"]
                    sub.status = "active"
                    ids = [i for i in ((obj.get("metadata") or {}).get("plans") or "").split(",") if i]
                    rows = (await db.execute(select(BillingPlan).where(BillingPlan.id.in_(ids)))).scalars().all() if ids else []
                    sub.plans = {p.wallet: p.id for p in rows}
                done = "checkout"
                if obj.get("payment_status") in ("paid", "no_payment_required"):
                    for pid in [i for i in ((obj.get("metadata") or {}).get("topups") or "").split(",") if i]:
                        p = (await db.execute(select(BillingPlan).where(BillingPlan.id == pid))).scalars().first()
                        if p:
                            await K.add_credits(db, p.wallet, p.credits, source="topup",
                                                expires_at=datetime.utcnow() + timedelta(days=K.TOPUP_DAYS),
                                                note=f"Top-up: {p.name}", ref=f"{obj.get('id')}:{p.id}")
                            done = "topup"

            elif etype == "invoice.paid":
                for line in (obj.get("lines") or {}).get("data") or []:
                    price = line.get("price") or (line.get("pricing") or {}).get("price_details") or {}
                    price_id = price.get("id") if isinstance(price, dict) else price
                    p = await _plan_by_price(db, price_id or "")
                    if not p or p.kind != "plan":
                        continue
                    period_end = _ts((line.get("period") or {}).get("end")) or datetime.utcnow() + timedelta(days=31)
                    ref = f"{obj.get('id')}:{p.id}"
                    from app.models.models import CreditGrant

                    if not (await db.execute(select(CreditGrant).where(CreditGrant.ref == ref))).scalars().first():
                        await K.expire_plan_batches(db, p.wallet)
                        await K.add_credits(db, p.wallet, p.credits, source="plan", expires_at=period_end,
                                            note=f"Plan: {p.name}", ref=ref)
                    sub.current_period_end = period_end
                    done = "renewal"
                sub.status = "active"

            elif etype == "invoice.payment_failed":
                sub.status = "past_due"
                done = "payment_failed"
                try:
                    from app.core.notify import notify

                    await notify("low_credits", "Your OutReach payment did not go through",
                                 ["Stripe could not take your subscription payment. Update your card in Plans & credits → Manage billing."])
                except Exception:
                    pass

            elif etype in ("customer.subscription.updated", "customer.subscription.deleted"):
                sub.stripe_subscription_id = obj.get("id") or sub.stripe_subscription_id
                sub.status = "canceled" if etype.endswith("deleted") else (obj.get("status") or sub.status)
                items = (obj.get("items") or {}).get("data") or []
                mapping = {}
                for it in items:
                    p = await _plan_by_price(db, ((it.get("price") or {}).get("id")) or "")
                    if p:
                        mapping[p.wallet] = p.id
                if sub.status != "canceled":
                    sub.plans = mapping
                else:
                    sub.plans = {}
                sub.current_period_end = _ts(obj.get("current_period_end")) or sub.current_period_end
                done = "subscription"

            await db.commit()
            return done
