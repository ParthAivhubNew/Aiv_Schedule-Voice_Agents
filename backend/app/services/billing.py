"""Stripe billing (ready for keys: works as soon as STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET
are set; test keys and live keys work the same way).

- Plans and top-ups are either made here (USD) and created in Stripe, or made in the Stripe
  Dashboard (any currency) and put on sale here. Stripe Adaptive Pricing is switched on for
  every Checkout, so clients abroad see and pay in their own currency at Stripe's rate.
- One Checkout can hold several plugins: monthly plans become one subscription with one item
  per plugin; top-ups are one-off items (in the same Checkout when plans are bought too).
  A plugin bought later gets its own subscription, so each can be changed or cancelled alone.
- Credits are only ever granted from verified Stripe webhooks: top-ups on checkout completion
  (never expire), plan credits on each paid invoice (expire at the period end).
  Each Stripe event is handled once.
- Admins manage a plugin's plan on its Subscription page: a dearer plan starts at once (the
  difference is charged and only the extra credits are added), a cheaper one at the next renewal
  with nothing refunded, so switching plans can never refill a wallet for free.
- STRIPE_AUTOMATIC_TAX=true lets Stripe Tax add VAT/sales tax and collect VAT numbers.
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
MAX_TOPUP_QUANTITY = 99


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


def automatic_tax() -> bool:
    return os.getenv("STRIPE_AUTOMATIC_TAX", "").strip().lower() in ("1", "true", "yes")


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
            # A dict: httpx only form-encodes mappings (a list of pairs is sent as raw content and fails).
            r = await client.request(method, f"{STRIPE_API}{path}", data=dict(_flatten(data or {})), headers=headers)
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
            "priceUsdCents": p.price_usd_cents, "currency": p.currency or "usd", "credits": p.credits, "features": p.features or [],
            "active": bool(p.active), "sort": p.sort, "stripePriceId": p.stripe_price_id, "inStripe": bool(p.stripe_price_id)}


async def sync_plan_to_stripe(p) -> None:
    """Create the product and USD price in Stripe (prices can't change there: a new price is
    made when ours changes)."""
    if not p.stripe_product_id:
        prod = await stripe("POST", "/products", {"name": f"OutReach {p.name}", "metadata": {"plan_id": p.id, "wallet": p.wallet}},
                            idempotency_key=f"prod-{p.id}")
        p.stripe_product_id = prod["id"]
    price: Dict[str, Any] = {"product": p.stripe_product_id, "currency": p.currency or "usd", "unit_amount": p.price_usd_cents,
                             "metadata": {"plan_id": p.id, "wallet": p.wallet, "credits": p.credits, "kind": p.kind}}
    if p.kind == "plan":
        price["recurring"] = {"interval": "month"}
    made = await stripe("POST", "/prices", price, idempotency_key=f"price-{p.id}-{p.price_usd_cents}-{p.kind}")
    p.stripe_price_id = made["id"]


def _sellable(price: Dict[str, Any]) -> bool:
    """A fixed amount, paid once or monthly (what a top-up or a plan is here)."""
    recurring = price.get("recurring")
    return bool(price.get("active") and price.get("unit_amount") and (not recurring or recurring.get("interval") == "month"))


async def unlinked_prices(db) -> List[Dict[str, Any]]:
    """Prices made in the Stripe Dashboard that are not on sale here yet. Also brings the name
    and description of the ones already on sale up to date: those are edited in Stripe
    (the credits a plan gives are set here). Caller commits."""
    from app.models.models import BillingPlan

    linked = {p.stripe_price_id: p for p in (await db.execute(select(BillingPlan))).scalars().all() if p.stripe_price_id}
    found = await stripe("GET", "/prices", {"active": True, "limit": 100, "expand": ["data.product"]})
    for pr in found.get("data") or []:
        p, product = linked.get(pr["id"]), pr["product"]
        if p and not (product.get("metadata") or {}).get("plan_id"):  # plans made here keep the name given here
            p.name, p.description = product["name"][:80], (product.get("description") or "")[:300]
    return [{"priceId": pr["id"], "name": pr["product"]["name"], "description": pr["product"].get("description") or "",
             "kind": "plan" if pr.get("recurring") else "topup", "priceCents": pr["unit_amount"], "currency": pr["currency"]}
            for pr in found.get("data") or [] if pr["id"] not in linked and _sellable(pr) and pr["product"].get("active")]


async def plan_from_price(price_id: str, wallet: str, credits: int):
    """A plan (monthly price) or top-up (one-off price) for a price that already exists in Stripe."""
    from app.models.models import BillingPlan

    pr = await stripe("GET", f"/prices/{price_id}", {"expand": ["product"]})
    if not _sellable(pr):
        raise ValueError("Only active prices with a fixed amount, paid once or monthly, can be sold here.")
    product = pr["product"]
    return BillingPlan(id=f"plan_{uuid.uuid4().hex[:10]}", wallet=wallet, kind="plan" if pr.get("recurring") else "topup",
                       name=product["name"][:80], description=(product.get("description") or "")[:300],
                       price_usd_cents=pr["unit_amount"], currency=pr["currency"], credits=credits,
                       stripe_product_id=product["id"], stripe_price_id=pr["id"])


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


async def create_checkout(db, *, org_id: str, email: str, plan_ids: List[str], topup_ids: List[str], base_url: str,
                          back: str = "/", quantities: Optional[Dict[str, int]] = None) -> str:
    """back: the page of the app to return to afterwards (the hub, or a plugin's Subscription page).
    quantities: how many of each top-up (by id) to buy; 1 when not given."""
    from app.models.models import BillingPlan
    from app.services.credits import WALLETS

    wanted = list(dict.fromkeys(plan_ids + topup_ids))
    if not wanted:
        raise ValueError("Pick at least one plan or top-up.")
    rows = {p.id: p for p in (await db.execute(select(BillingPlan).where(BillingPlan.id.in_(wanted), BillingPlan.active.is_(True)))).scalars().all()}
    chosen_plans = [rows[i] for i in plan_ids if i in rows and rows[i].kind == "plan"]
    chosen_topups = [rows[i] for i in topup_ids if i in rows and rows[i].kind == "topup"]
    if len(chosen_plans) + len(chosen_topups) != len(wanted):
        raise ValueError("One of those plans is no longer available. Reload and try again.")
    if len({p.wallet for p in chosen_plans}) != len(chosen_plans):
        raise ValueError("Pick one plan per app.")
    if len({p.wallet for p in chosen_plans + chosen_topups}) > 1:
        raise ValueError("Each app is paid for on its own. Buy from that app's Subscription page.")
    missing = [p.name for p in chosen_plans + chosen_topups if not p.stripe_price_id]
    if missing:
        raise ValueError(f"Not ready for sale yet: {', '.join(missing)}.")
    if len({p.currency or "usd" for p in chosen_plans + chosen_topups}) > 1:
        raise ValueError("Those are priced in different currencies: buy them separately.")
    qty = {p.id: (quantities or {}).get(p.id, 1) for p in chosen_topups}
    if any(not 1 <= n <= MAX_TOPUP_QUANTITY for n in qty.values()):
        raise ValueError(f"Buy between 1 and {MAX_TOPUP_QUANTITY} of a top-up at a time.")

    sub = await subscription_row(db, create=True)
    held = (sub.plans or {}) if sub.status in ("active", "past_due", "trialing") else {}
    again = [WALLETS[p.wallet] for p in chosen_plans if p.wallet in held]
    if again:
        raise ValueError(f"You already have a plan for {', '.join(again)}. Change it on its Subscription page.")
    # topups: "id" or "id:quantity" each; the webhook grants credits from this.
    meta = {"org_id": org_id, "plans": ",".join(p.id for p in chosen_plans),
            "topups": ",".join(p.id if qty[p.id] == 1 else f"{p.id}:{qty[p.id]}" for p in chosen_topups)}
    params: Dict[str, Any] = {
        "mode": "subscription" if chosen_plans else "payment",
        "line_items": [{"price": p.stripe_price_id, "quantity": qty.get(p.id, 1)} for p in chosen_plans + chosen_topups],
        "success_url": f"{base_url}{back}?billing=success",
        "cancel_url": f"{base_url}{back}?billing=cancelled",
        "client_reference_id": org_id,
        "metadata": meta,
        "adaptive_pricing": {"enabled": True},  # clients abroad pay in their own currency at Stripe's rate
        "allow_promotion_codes": True,
    }
    if sub.stripe_customer_id:
        params["customer"] = sub.stripe_customer_id
    elif email:
        params["customer_email"] = email
    if automatic_tax():
        params["automatic_tax"] = {"enabled": True}
        params["tax_id_collection"] = {"enabled": True}
        if sub.stripe_customer_id:  # keep the address and business name entered at Checkout
            params["customer_update"] = {"address": "auto", "name": "auto"}
    if chosen_plans:
        params["subscription_data"] = {"metadata": meta}
    else:
        params["payment_intent_data"] = {"metadata": meta}
        params["customer_creation"] = "always" if not sub.stripe_customer_id else None
        params["invoice_creation"] = {"enabled": True, "invoice_data": {"metadata": meta}}  # top-ups get an invoice too
    session = await stripe("POST", "/checkout/sessions", params, idempotency_key=f"co-{org_id}-{uuid.uuid4().hex}")
    return session["url"]


async def portal_url(db, base_url: str, back: str = "/") -> str:
    sub = await subscription_row(db)
    if not sub or not sub.stripe_customer_id:
        raise ValueError("No billing account yet: buy a plan or top-up first.")
    s = await stripe("POST", "/billing_portal/sessions", {"customer": sub.stripe_customer_id, "return_url": f"{base_url}{back}"})
    return s["url"]


# ── Managing a plugin's plan (the Subscription page inside each plugin) ─────
async def live_plans(db) -> Dict[str, Dict[str, Any]]:
    """Each plugin's plan as Stripe has it right now: what the Subscription pages show and change."""
    sub = await subscription_row(db)
    if not sub or not sub.stripe_customer_id:
        return {}
    found = await stripe("GET", "/subscriptions", {"customer": sub.stripe_customer_id, "limit": 100})
    out: Dict[str, Dict[str, Any]] = {}
    for s in found.get("data") or []:
        if s.get("status") in ("incomplete", "incomplete_expired"):
            continue
        items = (s.get("items") or {}).get("data") or []
        for it in items:
            p = await _plan_by_price(db, ((it.get("price") or {}).get("id")) or "")
            if not p:
                continue
            end = _ts(it.get("current_period_end") or s.get("current_period_end"))
            out[p.wallet] = {"planId": p.id, "status": s.get("status"), "periodEnd": end.isoformat() if end else None,
                             "ending": bool(s.get("cancel_at_period_end") or s.get("cancel_at")), "alone": len(items) == 1,
                             "subscription": s["id"], "item": it["id"]}
    return out


async def change_plan(db, plan_id: str) -> Optional[str]:
    """Move a plugin's subscription to another of its plans.
    - A dearer plan starts now: the difference for the rest of the period is charged, and the
      webhook adds the extra credits. If the bank wants the payment confirmed, the plan only
      changes once it is paid: the Stripe page to pay on is returned.
    - A cheaper plan starts at the next renewal: nothing is refunded and this period's credits stay."""
    from app.models.models import BillingPlan

    rows = (await db.execute(select(BillingPlan).where(BillingPlan.kind == "plan"))).scalars().all()
    new = next((p for p in rows if p.id == plan_id and p.active and p.stripe_price_id), None)
    if not new:
        raise ValueError("That plan is no longer available. Reload and try again.")
    live = (await live_plans(db)).get(new.wallet)
    if not live:
        raise ValueError("There is no plan to change yet: subscribe first.")
    old = next((p for p in rows if p.id == live["planId"]), None)
    if not old or old.id == new.id:
        raise ValueError("That is already your plan.")
    if (old.currency or "usd") != (new.currency or "usd"):
        raise ValueError("That plan is priced in another currency: cancel this one and subscribe to it instead.")
    data: Dict[str, Any] = {"items": [{"id": live["item"], "price": new.stripe_price_id}], "proration_behavior": "none"}
    if automatic_tax():  # a plan bought before tax was switched on pays VAT from this change on
        data["automatic_tax"] = {"enabled": True}
    if new.price_usd_cents > old.price_usd_cents:
        data.update(proration_behavior="always_invoice", payment_behavior="pending_if_incomplete")
    changed = await stripe("POST", f"/subscriptions/{live['subscription']}", data)
    if changed.get("pending_update") and changed.get("latest_invoice"):
        invoice = await stripe("GET", f"/invoices/{changed['latest_invoice']}")
        return invoice.get("hosted_invoice_url")
    return None


async def set_ending(db, wallet: str, ending: bool) -> None:
    """Stop a plugin's plan at the end of the period already paid for (or keep it after all)."""
    live = (await live_plans(db)).get(wallet)
    if not live:
        raise ValueError("There is no plan to cancel.")
    if not live["alone"]:
        raise ValueError("This plan was bought together with another plugin's: cancel it from Card & invoices.")
    await stripe("POST", f"/subscriptions/{live['subscription']}", {"cancel_at_period_end": ending})


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


def _line_price(line: Dict[str, Any]) -> str:
    """An invoice line's price id. Older API versions: line.price.id; since 2025-03-31:
    line.pricing.price_details.price."""
    price = line.get("price") or (line.get("pricing") or {}).get("price_details") or {}
    return ((price.get("id") or price.get("price")) if isinstance(price, dict) else price) or ""


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

    org_id = _meta_org(obj) or await _org_for_customer(obj.get("customer") or "")
    if not org_id:
        logger.warning(f"[billing] {etype} {event_id}: no organisation found")
        return "no_org"

    with org_scope(org_id):
        async with AsyncSessionLocal() as db:
            # Recorded in the same transaction as its effects: if anything below fails, nothing
            # is saved and Stripe's retry applies the event (instead of finding it "done").
            db.add(StripeEvent(id=event_id, type=etype))
            sub = await subscription_row(db, create=True)
            if obj.get("customer") and not sub.stripe_customer_id:
                sub.stripe_customer_id = obj["customer"]
            done = "ignored"

            # async_payment_succeeded: bank debits (e.g. Bacs) are paid days after Checkout completes.
            if etype in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
                if obj.get("subscription"):
                    sub.stripe_subscription_id = obj["subscription"]
                    sub.status = "active"
                    ids = [i for i in ((obj.get("metadata") or {}).get("plans") or "").split(",") if i]
                    rows = (await db.execute(select(BillingPlan).where(BillingPlan.id.in_(ids)))).scalars().all() if ids else []
                    sub.plans = {**(sub.plans or {}), **{p.wallet: p.id for p in rows}}
                done = "checkout"
                if obj.get("payment_status") in ("paid", "no_payment_required"):
                    for item in [i for i in ((obj.get("metadata") or {}).get("topups") or "").split(",") if i]:
                        pid, _, n = item.partition(":")
                        p = (await db.execute(select(BillingPlan).where(BillingPlan.id == pid))).scalars().first()
                        if p:
                            n = int(n or 1)
                            await K.add_credits(db, p.wallet, p.credits * n, source="topup", expires_at=None,
                                                note=f"Top-up: {p.name}" + (f" × {n}" if n > 1 else ""), ref=f"{obj.get('id')}:{p.id}",
                                                paid_cents=p.price_usd_cents * n, paid_currency=p.currency or "usd")
                            done = "topup"

            elif etype == "invoice.paid":
                lines = [(line, await _plan_by_price(db, _line_price(line))) for line in (obj.get("lines") or {}).get("data") or []]
                # A plan change mid-period: the old plan's unused time comes back as a negative line.
                replaced = {p.wallet: p for line, p in lines if p and (line.get("amount") or 0) < 0}
                for line, p in lines:
                    if not p or p.kind != "plan" or (line.get("amount") or 0) < 0:
                        continue
                    period_end = _ts((line.get("period") or {}).get("end")) or datetime.utcnow() + timedelta(days=31)
                    ref = f"{obj.get('id')}:{p.id}"
                    from app.models.models import CreditGrant

                    old = replaced.get(p.wallet)
                    # What was paid for this app's plan on this invoice (a plan change: net of the refund).
                    paid = sum(int(ln.get("amount") or 0) for ln, lp in lines if lp and lp.wallet == p.wallet)
                    currency = str(obj.get("currency") or p.currency or "usd")
                    if (await db.execute(select(CreditGrant).where(CreditGrant.ref == ref))).scalars().first():
                        pass
                    elif old:
                        # Only the difference, so switching plans back and forth never refills the wallet.
                        if p.credits > old.credits:
                            await K.add_credits(db, p.wallet, p.credits - old.credits, source="plan", expires_at=period_end,
                                                note=f"Plan upgrade: {p.name}", ref=ref, paid_cents=max(paid, 0), paid_currency=currency)
                    else:
                        await K.expire_plan_batches(db, p.wallet)
                        await K.add_credits(db, p.wallet, p.credits, source="plan", expires_at=period_end,
                                            note=f"Plan: {p.name}", ref=ref, paid_cents=max(paid, 0), paid_currency=currency)
                    sub.current_period_end = period_end
                    sub.status = "active"
                    done = "renewal"

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
                ended = etype.endswith("deleted") or obj.get("status") == "canceled"
                items = (obj.get("items") or {}).get("data") or []
                mapping = {}
                for it in items:
                    p = await _plan_by_price(db, ((it.get("price") or {}).get("id")) or "")
                    if p:
                        mapping[p.wallet] = p.id
                # Plugins on another subscription of this organisation keep their plans.
                others = {w: i for w, i in (sub.plans or {}).items() if w not in mapping}
                if not ended:
                    sub.stripe_subscription_id = obj.get("id") or sub.stripe_subscription_id
                    sub.status = obj.get("status") or sub.status
                    sub.plans = {**others, **mapping}
                else:
                    sub.plans = others
                    if not others:
                        sub.status = "canceled"
                sub.current_period_end = _ts(obj.get("current_period_end")) or sub.current_period_end
                done = "subscription"

            await db.commit()
            if done in ("checkout", "topup", "renewal"):
                from app.services import voice_access

                voice_access.kick(org_id)  # calls back on straight away after a top-up
            return done
