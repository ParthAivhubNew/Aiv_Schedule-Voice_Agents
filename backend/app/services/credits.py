"""Credits: one wallet per plugin (Voice, Lead generation, Email outreach, Post scheduler).

- Credits arrive in batches (CreditGrant): plan renewals (expire at the next renewal),
  top-ups (never expire: they outlast the plan month and are spent after it) and staff grants
  (optional expiry).
- Usage takes from the batch closest to expiry first, so as little as possible is lost.
- Each wallet warns its admins once at 20% left and stops only its own plugin at zero
  (when the organisation's credits are enforced). A call is capped at the minutes left plus a
  short grace (CALL_GRACE_MIN), so a conversation is not cut off the moment credits reach zero
  and nothing can run far past what was paid for; the grace is taken from the next credits.
- Phone numbers bought through us cost their rate-card price every calendar month (0: free).
- Usage is settled in the background from what actually happened (finished calls, AI posts,
  WhatsApp messages), so billing can never slow down or break a call.
- The original organisation is tracking-only unless enforcement is switched on, so nothing
  that works today stops working. Self-signup organisations start enforced with starter credits.
"""
from __future__ import annotations

import logging
import math
import os
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, or_
from sqlalchemy.future import select

logger = logging.getLogger("credits")

WALLETS: Dict[str, str] = {
    "voice": "AI Voice (calls and WhatsApp)",
    "leadgen": "Lead generation",
    "email": "Email outreach",
    "scheduler": "Post scheduler",
}

# Rate card: credits per unit, and which wallet pays. charged=False: priced but not billed yet.
# A Voice credit is a minute of calls, so calling plans read in minutes (60 credits = 1 hour).
DEFAULT_RATES: Dict[str, Dict[str, Any]] = {
    "voice_minute": {"label": "Voice call minute", "unit": "minute", "credits": 1, "wallet": "voice", "charged": True},
    "whatsapp_message": {"label": "WhatsApp message sent", "unit": "message", "credits": 1, "wallet": "voice", "charged": True},
    "ai_post": {"label": "AI-written social post", "unit": "post", "credits": 2, "wallet": "scheduler", "charged": True},
    "lead_lookup": {"label": "Lead researched", "unit": "lead", "credits": 1, "wallet": "leadgen", "charged": False},
    "email_send": {"label": "Email sent", "unit": "email", "credits": 1, "wallet": "email", "charged": False},
    # Telnyx charges us a monthly rental per number; 0 until staff set our price in the rate card.
    "phone_number_month": {"label": "Phone number, per month", "unit": "number a month", "credits": 0, "wallet": "voice", "charged": True},
}
RATES_KEY = "credit_rates"
SETTLE_LOOKBACK = timedelta(days=3)
STARTER_DAYS = 30  # a free trial, when STARTER_CREDITS is set
LOW_SHARE = 0.20
CALL_GRACE_MIN = 5  # minutes a call may run past the credits left
MAX_CALL_SECS = 14400  # Telnyx's own longest call


def starter_credits() -> int:
    try:
        return max(0, int(os.getenv("STARTER_CREDITS", "0")))
    except ValueError:
        return 0


def wallet_of(item: str) -> str:
    return DEFAULT_RATES.get(item, {}).get("wallet", "voice")


def _org() -> str:
    from app.core.tenancy import current_org

    return current_org()


def _settings_id(org_id: Optional[str] = None) -> str:
    return f"credits:{org_id or _org()}"


# ── Settings and rate card (app_settings documents) ─────────────────────────
async def _get_doc(db, key: str) -> dict:
    from app.models.models import AppSetting

    row = (await db.execute(select(AppSetting).where(AppSetting.id == key))).scalars().first()
    return dict(row.data or {}) if row else {}


async def _put_doc(db, key: str, data: dict) -> None:
    from app.models.models import AppSetting

    row = (await db.execute(select(AppSetting).where(AppSetting.id == key))).scalars().first()
    if row:
        row.data = data
        row.updated_at = datetime.utcnow()
    else:
        db.add(AppSetting(id=key, data=data))
    await db.flush()  # sessions may not autoflush: the next read must see this


async def rates(db) -> Dict[str, Dict[str, Any]]:
    stored = await _get_doc(db, RATES_KEY)
    out = {k: dict(v) for k, v in DEFAULT_RATES.items()}
    for k, v in stored.items():
        if k in out and isinstance(v, (int, float)) and v >= 0:
            out[k]["credits"] = int(v)
    return out


async def set_rates(db, patch: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    stored = await _get_doc(db, RATES_KEY)
    for k, v in (patch or {}).items():
        if k in DEFAULT_RATES:
            stored[k] = max(0, int(v))
    await _put_doc(db, RATES_KEY, stored)
    return await rates(db)


async def org_settings(db, org_id: Optional[str] = None) -> dict:
    doc = await _get_doc(db, _settings_id(org_id))
    return {"enforce": bool(doc.get("enforce", False)), "debt": dict(doc.get("debt") or {}),
            "low_notified": dict(doc.get("low_notified") or {}) if isinstance(doc.get("low_notified"), dict) else {}}


async def _patch_doc(db, patch: dict, org_id: Optional[str] = None) -> dict:
    doc = await _get_doc(db, _settings_id(org_id))
    doc.update(patch)
    await _put_doc(db, _settings_id(org_id), doc)
    return doc


async def set_org_settings(db, patch: dict, org_id: Optional[str] = None) -> dict:
    clean = {}
    if "enforce" in patch:
        clean["enforce"] = bool(patch["enforce"])
    await _patch_doc(db, clean, org_id)
    return await org_settings(db, org_id)


# ── Wallet balances ─────────────────────────────────────────────────────────
def _live(now: datetime):
    from app.models.models import CreditGrant

    return [CreditGrant.remaining > 0, or_(CreditGrant.expires_at.is_(None), CreditGrant.expires_at > now)]


async def _batches(db, wallet: str, now: Optional[datetime] = None) -> List[Any]:
    """Unexpired batches with credits left, closest to expiry first (never-expiring last)."""
    from app.models.models import CreditGrant

    now = now or datetime.utcnow()
    rows = (await db.execute(select(CreditGrant).where(CreditGrant.wallet == wallet, *_live(now)))).scalars().all()
    return sorted(rows, key=lambda g: (g.expires_at is None, g.expires_at or datetime.max, g.created_at or datetime.min))


async def wallet_balance(db, wallet: str, now: Optional[datetime] = None) -> int:
    total = sum(g.remaining for g in await _batches(db, wallet, now))
    debt = int((await org_settings(db))["debt"].get(wallet, 0))
    return int(total - debt)


async def balance(db, wallet: Optional[str] = None) -> int:
    """One wallet's balance, or all wallets together."""
    if wallet:
        return await wallet_balance(db, wallet)
    return sum([await wallet_balance(db, w) for w in WALLETS])


async def wallets(db, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    now = now or datetime.utcnow()
    s = await org_settings(db)
    out = []
    for key, label in WALLETS.items():
        batches = await _batches(db, key, now)
        total = sum(g.remaining for g in batches)
        size = sum(g.amount for g in batches)
        bal = int(total - int(s["debt"].get(key, 0)))
        soon = [b for b in batches if b.expires_at]
        out.append({
            "key": key, "label": label, "balance": bal,
            "low": bool(s["enforce"] and size and bal <= size * LOW_SHARE),
            "empty": bool(s["enforce"] and bal <= 0),
            "nextExpiry": {"amount": soon[0].remaining, "at": soon[0].expires_at.isoformat()} if soon else None,
            "batches": [{"source": b.source, "remaining": b.remaining, "amount": b.amount,
                         "expiresAt": b.expires_at.isoformat() if b.expires_at else None} for b in batches],
        })
    return out


# ── Ledger ──────────────────────────────────────────────────────────────────
def _entry(kind: str, amount: int, wallet: str, item: str = "", quantity: float = 0, ref: Optional[str] = None,
           note: str = "", by: str = ""):
    from app.models.models import CreditEntry

    return CreditEntry(id=f"cr_{uuid.uuid4().hex[:14]}", kind=kind, wallet=wallet, item=item, quantity=quantity,
                       amount=int(amount), ref=ref, note=note[:300], by=by[:120])


async def add_credits(db, wallet: str, amount: int, *, source: str = "grant", expires_at: Optional[datetime] = None,
                      note: str = "", by: str = "", ref: str = "", paid_cents: int = 0, paid_currency: str = "") -> int:
    """Add a batch of credits to a wallet. Pays off any overdraw first. Idempotent per ref.
    paid_*: what the customer paid for it (Stripe), for margin reports. Returns the wallet
    balance. Caller commits."""
    from app.models.models import CreditGrant

    if wallet not in WALLETS:
        raise ValueError("Unknown wallet.")
    if amount <= 0:
        raise ValueError("Amount must be above zero.")
    if ref and (await db.execute(select(CreditGrant).where(CreditGrant.ref == ref, CreditGrant.wallet == wallet))).scalars().first():
        return await wallet_balance(db, wallet)
    s = await org_settings(db)
    debt = int(s["debt"].get(wallet, 0))
    paid = min(debt, amount)
    if paid:
        s["debt"][wallet] = debt - paid
    lows = s["low_notified"]
    lows.pop(wallet, None)
    await _patch_doc(db, {"debt": s["debt"], "low_notified": lows})
    db.add(CreditGrant(id=f"cg_{uuid.uuid4().hex[:14]}", wallet=wallet, source=source, amount=amount,
                       remaining=amount - paid, expires_at=expires_at, ref=ref, note=note[:200],
                       paid_cents=int(paid_cents or 0), paid_currency=(paid_currency or "").lower()))
    db.add(_entry("grant", amount, wallet, ref=ref or None, note=note or source, by=by))
    await db.flush()
    return await wallet_balance(db, wallet)


async def _take(db, wallet: str, cost: int, now: Optional[datetime] = None) -> None:
    """Take credits from the batches closest to expiry; anything missing becomes overdraw."""
    left = cost
    for g in await _batches(db, wallet, now):
        if left <= 0:
            break
        used = min(g.remaining, left)
        g.remaining -= used
        left -= used
    if left > 0:
        s = await org_settings(db)
        s["debt"][wallet] = int(s["debt"].get(wallet, 0)) + left
        await _patch_doc(db, {"debt": s["debt"]})


async def charge(db, item: str, quantity: float, ref: str, note: str = "") -> int:
    """Charge usage of a rate-card item to its wallet. Returns credits charged. Caller commits."""
    card = await rates(db)
    rate = card.get(item)
    if not rate or quantity <= 0:
        return 0
    cost = int(math.ceil(quantity * rate["credits"]))
    if cost <= 0:
        return 0
    wallet = rate["wallet"]
    await _take(db, wallet, cost)
    db.add(_entry("usage", -cost, wallet, item, quantity, ref, note))
    await db.flush()
    return cost


async def remove_credits(db, wallet: str, amount: int, note: str = "", by: str = "") -> int:
    await _take(db, wallet, amount)
    db.add(_entry("adjust", -amount, wallet, note=note, by=by))
    await db.flush()
    return await wallet_balance(db, wallet)


async def expire(db, now: Optional[datetime] = None) -> int:
    """Record and zero batches that have expired. Returns credits expired. Caller commits."""
    from app.models.models import CreditGrant

    now = now or datetime.utcnow()
    rows = (await db.execute(select(CreditGrant).where(
        CreditGrant.remaining > 0, CreditGrant.expires_at.is_not(None), CreditGrant.expires_at <= now))).scalars().all()
    total = 0
    for g in rows:
        db.add(_entry("expire", -g.remaining, g.wallet, ref=g.id, note=f"{g.source.title()} credits expired"))
        total += g.remaining
        g.remaining = 0
    if rows:
        await db.flush()
    return total


async def expire_plan_batches(db, wallet: str) -> None:
    """A renewal replaces last period's plan credits (unused plan credits do not roll over)."""
    from app.models.models import CreditGrant

    rows = (await db.execute(select(CreditGrant).where(
        CreditGrant.wallet == wallet, CreditGrant.source == "plan", CreditGrant.remaining > 0))).scalars().all()
    for g in rows:
        db.add(_entry("expire", -g.remaining, wallet, ref=g.id, note="Plan credits replaced at renewal"))
        g.remaining = 0
    if rows:
        await db.flush()


async def can_start(db, item: str) -> Tuple[bool, str]:
    """Whether the organisation may start one more unit of item. Never raises."""
    try:
        if not (await org_settings(db))["enforce"]:
            return True, ""
        rate = (await rates(db)).get(item, {})
        cost = rate.get("credits", 0)
        if cost <= 0:
            return True, ""
        wallet = rate.get("wallet", "voice")
        if await wallet_balance(db, wallet) < cost:
            return False, f"Out of {WALLETS[wallet]} credits. Top up or wait for your plan to renew."
        return True, ""
    except Exception as err:
        logger.warning(f"[credits] check skipped: {err}")
        return True, ""


async def call_time_limit(db) -> Optional[int]:
    """Longest a new call may last, in seconds: the voice minutes left plus the grace. None when
    the organisation's credits are not enforced (no cap). Never raises."""
    try:
        if not (await org_settings(db))["enforce"]:
            return None
        per_minute = (await rates(db))["voice_minute"]["credits"]
        if per_minute <= 0:
            return None
        minutes = max(await wallet_balance(db, "voice"), 0) // per_minute + CALL_GRACE_MIN
        return int(max(60, min(MAX_CALL_SECS, minutes * 60)))
    except Exception as err:
        logger.warning(f"[credits] call limit skipped: {err}")
        return None


# ── Settling usage from what happened ───────────────────────────────────────
_MMSS = re.compile(r"^\s*(\d+):(\d{1,2})")
_MIN = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*min")


def minutes_of(duration: str) -> int:
    """Billable whole minutes from a call log duration ("03:25", "03:25 min", "4 min"); rounds up."""
    d = str(duration or "")
    m = _MMSS.match(d)
    if m:
        secs = int(m.group(1)) * 60 + int(m.group(2))
        return math.ceil(secs / 60) if secs > 0 else 0
    m = _MIN.match(d)
    if m:
        return math.ceil(float(m.group(1)))
    return 0


async def _charged(db, refs: List[str]) -> Dict[str, float]:
    from app.models.models import CreditEntry

    if not refs:
        return {}
    rows = (await db.execute(
        select(CreditEntry.ref, func.sum(CreditEntry.quantity))
        .where(CreditEntry.kind == "usage", CreditEntry.ref.in_(refs)).group_by(CreditEntry.ref)
    )).all()
    return {r: float(q or 0) for r, q in rows}


async def settle(db, now: Optional[datetime] = None) -> int:
    """Expire old batches and charge usage not yet charged in the current organisation.
    Returns credits charged. Safe to run repeatedly: each thing is charged once (a longer call
    later charges only the difference)."""
    from app.models.models import CallLog, SocialGenJob, WhatsappMessage

    now = now or datetime.utcnow()
    await expire(db, now)
    # Usage from before credits were switched on for this organisation is never charged.
    doc = await _get_doc(db, _settings_id())
    if not doc.get("tracking_since"):
        await _patch_doc(db, {"tracking_since": now.isoformat()})
        await db.commit()
        return 0
    since = max(now - SETTLE_LOOKBACK, datetime.fromisoformat(doc["tracking_since"]))
    total = 0

    logs = (await db.execute(select(CallLog).where(CallLog.created_at >= since, CallLog.channel == "voice"))).scalars().all()
    done = await _charged(db, [f"call:{c.id}" for c in logs])
    for c in logs:
        extra = minutes_of(c.duration) - done.get(f"call:{c.id}", 0)
        if extra > 0:
            total += await charge(db, "voice_minute", extra, f"call:{c.id}", f"Call with {c.listed_as}")

    jobs = (await db.execute(select(SocialGenJob).where(
        SocialGenJob.updated_at >= since, SocialGenJob.state == "done", SocialGenJob.error.is_(None)))).scalars().all()
    done = await _charged(db, [f"gen:{j.id}" for j in jobs])
    for j in jobs:
        extra = (len(j.post_ids or []) or 1) - done.get(f"gen:{j.id}", 0)
        if extra > 0:
            total += await charge(db, "ai_post", extra, f"gen:{j.id}", "AI-written post")

    msgs = (await db.execute(select(WhatsappMessage).where(
        WhatsappMessage.created_at >= since, WhatsappMessage.direction == "outbound",
        WhatsappMessage.status.in_(["sent", "delivered", "read"])))).scalars().all()
    done = await _charged(db, [f"wa:{m.id}" for m in msgs])
    for m in msgs:
        if not done.get(f"wa:{m.id}"):
            total += await charge(db, "whatsapp_message", 1, f"wa:{m.id}", "WhatsApp message")

    # Numbers bought through us: once per calendar month each, from the month they became active.
    from app.models.models import OrgPhoneNumber

    numbers = (await db.execute(select(OrgPhoneNumber).where(
        OrgPhoneNumber.status == "active", OrgPhoneNumber.provider == "telnyx", OrgPhoneNumber.provider_ref != ""))).scalars().all()
    month = now.strftime("%Y-%m")
    done = await _charged(db, [f"num:{n.id}:{month}" for n in numbers])
    for n in numbers:
        if not done.get(f"num:{n.id}:{month}"):
            total += await charge(db, "phone_number_month", 1, f"num:{n.id}:{month}", f"Number {n.e164}, {now:%B %Y}")

    if total:
        await _warn_low(db)
    await db.commit()
    return total


async def _warn_low(db) -> None:
    s = await org_settings(db)
    if not s["enforce"]:
        return
    lows = s["low_notified"]
    for w in await wallets(db):
        if not w["low"] or lows.get(w["key"]):
            continue
        lows[w["key"]] = True
        try:
            from app.core.notify import notify

            await notify("low_credits", f"{w['label']}: credits running low",
                         [f"<b>{max(w['balance'], 0)}</b> {w['label']} credits left (20% or less).",
                          "This app pauses at zero; your other apps keep working. Top up in Plans &amp; credits."])
        except Exception:
            pass
    await _patch_doc(db, {"low_notified": lows})


async def settle_all_orgs() -> None:
    from app.core.orgs import active_org_ids
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal

    for org_id in await active_org_ids():
        try:
            with org_scope(org_id):
                async with AsyncSessionLocal() as db:
                    charged = await settle(db)
            if charged:
                logger.info(f"[credits] {org_id}: charged {charged} credits")
        except Exception as err:
            logger.warning(f"[credits] settle {org_id} failed: {err}")


async def history(db, limit: int = 100) -> List[dict]:
    from app.models.models import CreditEntry

    rows = (await db.execute(select(CreditEntry).order_by(CreditEntry.created_at.desc()).limit(limit))).scalars().all()
    return [{"id": r.id, "kind": r.kind, "wallet": r.wallet, "item": r.item, "quantity": r.quantity, "amount": r.amount,
             "note": r.note, "by": r.by, "at": r.created_at.isoformat() if r.created_at else None} for r in rows]


async def usage_by_item(db, days: int = 30) -> Dict[str, dict]:
    from app.models.models import CreditEntry

    since = datetime.utcnow() - timedelta(days=days)
    rows = (await db.execute(
        select(CreditEntry.item, func.sum(CreditEntry.quantity), func.sum(CreditEntry.amount))
        .where(CreditEntry.kind == "usage", CreditEntry.created_at >= since).group_by(CreditEntry.item)
    )).all()
    return {item: {"quantity": float(q or 0), "credits": -int(a or 0)} for item, q, a in rows}


# Kept for callers from before wallets (staff grants without a wallet go to Voice).
async def grant(db, amount: int, note: str = "", by: str = "", wallet: str = "voice",
                expires_at: Optional[datetime] = None) -> int:
    if amount > 0:
        return await add_credits(db, wallet, amount, source="grant", expires_at=expires_at, note=note, by=by)
    if amount < 0:
        return await remove_credits(db, wallet, -amount, note=note, by=by)
    raise ValueError("Amount cannot be zero.")
