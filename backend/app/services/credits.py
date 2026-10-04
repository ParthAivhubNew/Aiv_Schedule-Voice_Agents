"""Credits: one wallet per plugin (Voice, Lead generation, Email outreach, Post scheduler).

- Credits arrive in batches (CreditGrant): plan renewals (expire at the next renewal),
  top-ups (never expire: they outlast the plan month and are spent after it) and staff grants
  (optional expiry).
- Usage takes from the batch closest to expiry first, so as little as possible is lost.
- Each wallet warns its admins once at 20% left and stops only its own plugin at zero
  (when the organisation's credits are enforced).
- AI work is held before it starts (hold), at the price of that moment, and charged when it
  succeeds (confirm) or given back when it fails or times out (release). A hold that would take
  a wallet below zero by even one credit is refused, so work stops before it overspends. A held
  credit is not spendable twice: the balance shown is what is left after holds.
- Never fail closed: if the credit check itself errors, the work runs anyway and is charged
  when it finishes; a charge that cannot be written is kept and charged with the next run.
- A call holds the voice minutes left (reserve_call) and Telnyx ends it when they run out, with
  a wrap-up line a minute before; no grace, so a call never runs past what was paid for. Before
  a call whose minutes left are below the company's average call, the user is warned and may
  accept the shorter call. At zero, call lists pause and the numbers stop taking calls
  (voice_access) until a top-up.
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
    "voice": "Voice",
    "leadgen": "Leads",
    "scheduler": "Social",
}

# Rate card: credits per unit, and which wallet pays. charged=False: priced but not billed yet.
# A Voice credit is a minute of calls, so calling plans read in minutes (60 credits = 1 hour).
DEFAULT_RATES: Dict[str, Dict[str, Any]] = {
    "voice_minute": {"label": "Voice call minute", "unit": "minute", "credits": 1, "wallet": "voice", "charged": True},
    "whatsapp_message": {"label": "WhatsApp message sent", "unit": "message", "credits": 1, "wallet": "voice", "charged": True},
    "ai_post": {"label": "AI-written social post", "unit": "post", "credits": 2, "wallet": "scheduler", "charged": True},
    "ai_image": {"label": "AI image redraw", "unit": "image", "credits": 1, "wallet": "scheduler", "charged": True},
    "lead_lookup": {"label": "Lead researched", "unit": "lead", "credits": 1, "wallet": "leadgen", "charged": True},
    "email_send": {"label": "Email sent", "unit": "email", "credits": 1, "wallet": "leadgen", "charged": True},
    # Telnyx charges us a monthly rental per number; 0 until staff set our price in the rate card.
    "phone_number_month": {"label": "Phone number, per month", "unit": "number a month", "credits": 1, "wallet": "voice", "charged": True},
    "number_setup": {"label": "Number setup", "unit": "number", "credits": 5, "wallet": "voice", "charged": True},
}
RATES_KEY = "credit_rates"

# Sensible real-world starting points for "our cost per unit" (admin portal > Revenue), in minor
# currency units (cents/pence — the admin UI's own convention, matching paid_cents elsewhere), so
# margin doesn't start from a lying zero. Telnyx's own USD list prices, researched 2026-10: a real
# vendor cost, not a guess — only applied when the admin has the rate card set to USD, since
# converting to GBP/EUR would need an exchange rate that goes stale and could quietly mislead
# margin instead of just being blank. Items priced by whichever AI provider the organisation
# configured (ai_post, ai_image, email_send, and the AI side of lead_lookup) are left out on
# purpose — there's no one true market price for "an LLM call," so a made-up number there would
# be actively misleading. Staff can still override any of these; stored values always win.
DEFAULT_UNIT_COSTS_USD_CENTS: Dict[str, float] = {
    "phone_number_month": 100.0,   # Telnyx US local number rental ($1.00)
    "number_setup": 0.0,           # Telnyx charges no activation fee on standard local numbers
    "whatsapp_message": 2.5,       # Meta's own per-message fee ($0.025, US marketing-template
                                    # ceiling); Telnyx's BSP markup on top isn't published, check
                                    # your invoice
    "lead_lookup": 1.1,             # Telnyx Number Lookup ($0.003) + one Tavily search ($0.008
                                     # pay-as-you-go) that finds/enriches the lead; the LLM step
                                     # riding alongside it costs whatever provider the org
                                     # configured, left out above
}


def default_voice_minute_cost_usd_cents() -> float:
    """Telnyx's own real cost for a call minute, in US cents: the managed Voice AI Assistant's
    all-in rate (STT+LLM+TTS) if that's switched on, else the raw Call Control + SIP carrier leg."""
    from app.services import voice_assistants as VA

    return 5.6 if VA.enabled() else 0.9
SETTLE_LOOKBACK = timedelta(days=3)
STARTER_DAYS = 30  # a free trial, when STARTER_CREDITS is set
LOW_SHARE = 0.20
MAX_CALL_SECS = 14400  # Telnyx's own longest call
WRAP_UP_SECS = 60  # the call is told to wrap up this long before its minutes run out
DEFAULT_CALL_MIN = 3  # average call length assumed before a company has any calls
CALL_HOLD = "callhold:"
HOLD_TTL = timedelta(hours=6)  # holds left by work that never finished are given back


def starter_credits() -> int:
    try:
        val = os.getenv("STARTER_CREDITS")
        return int(val) if val is not None else 0
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
    # Every company pays for what it uses: stop at zero unless staff switch it off for one.
    return {"enforce": bool(doc.get("enforce", True)), "debt": dict(doc.get("debt") or {}),
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


async def _lock(db, org_id: Optional[str] = None) -> None:
    """Lock this organisation's credit document until the caller commits, so holds and charges
    for one organisation happen one at a time (two requests can never spend the same credit)."""
    from app.models.models import AppSetting

    key = _settings_id(org_id)
    q = select(AppSetting.id).where(AppSetting.id == key).with_for_update()
    if (await db.execute(q)).first() is None:
        db.add(AppSetting(id=key, data={}))
        await db.flush()
        await db.execute(q)


def _holds(doc: dict) -> Dict[str, dict]:
    h = doc.get("holds")
    return dict(h) if isinstance(h, dict) else {}


async def held(db, wallet: str) -> int:
    doc = await _get_doc(db, _settings_id())
    return sum(int(h.get("credits", 0)) for h in _holds(doc).values() if h.get("wallet") == wallet)


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
    """Credits left to spend: batches, less overdraw, less credits held by work in progress."""
    total = sum(g.remaining for g in await _batches(db, wallet, now))
    debt = int((await org_settings(db))["debt"].get(wallet, 0))
    return int(total - debt - await held(db, wallet))


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
        on_hold = await held(db, key)
        bal = int(total - int(s["debt"].get(key, 0)) - on_hold)
        soon = [b for b in batches if b.expires_at]
        out.append({
            "key": key, "label": label, "balance": bal, "held": on_hold,
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
    return await _charge_cost(db, item, quantity, cost, ref, note)


async def _charge_cost(db, item: str, quantity: float, cost: int, ref: str, note: str = "") -> int:
    wallet = wallet_of(item)
    await _take(db, wallet, cost)
    db.add(_entry("usage", -cost, wallet, item, quantity, ref, note))
    await db.flush()
    return cost


async def _already_charged(db, ref: str, item: str) -> bool:
    from app.models.models import CreditEntry

    return (await db.execute(select(CreditEntry.id).where(
        CreditEntry.kind == "usage", CreditEntry.ref == ref, CreditEntry.item == item).limit(1))).first() is not None


# ── Holds: price fixed when work starts, charged only if it succeeds ──────
# A part is one thing to charge: {"ref", "item", "quantity", "note"}. ref is unique per thing
# (e.g. "gen:<job>" for a written post, "genimg:<job>" for its image), so it is charged once.
async def hold(db, parts: List[Dict[str, Any]]) -> Tuple[bool, str]:
    """Hold credits for these parts, all or nothing, at today's prices. Parts already held stay
    held (safe to call again on a retry). Refused when the wallet would go below zero by even
    one credit and the organisation's credits are enforced. Never raises: if the check itself
    fails the work may run, and is charged when it is confirmed. Caller commits."""
    try:
        await pay_owed(db)
        await _lock(db)
        s = await org_settings(db)
        doc = await _get_doc(db, _settings_id())
        holds = _holds(doc)
        card = await rates(db)
        new: Dict[str, dict] = {}
        need: Dict[str, int] = {}
        for p in parts:
            item, qty = p["item"], float(p.get("quantity", 1))
            if p["ref"] in holds or item not in card or qty <= 0:
                continue
            cost = int(math.ceil(qty * card[item]["credits"]))
            if cost <= 0 or await _already_charged(db, p["ref"], item):
                continue
            wallet = card[item]["wallet"]
            new[p["ref"]] = {"item": item, "quantity": qty, "credits": cost, "wallet": wallet,
                             "note": str(p.get("note") or card[item]["label"])[:200], "at": datetime.utcnow().isoformat()}
            need[wallet] = need.get(wallet, 0) + cost
        if not new:
            return True, ""
        if s["enforce"]:
            for wallet, cost in need.items():
                if await wallet_balance(db, wallet) < cost:
                    return False, out_of_credits(wallet)
        holds.update(new)
        await _patch_doc(db, {"holds": holds})
        return True, ""
    except Exception as err:
        logger.warning(f"[credits] hold skipped, work runs and is charged when it finishes: {err}")
        try:
            await db.rollback()
        except Exception:
            pass
        return True, ""


def out_of_credits(wallet: str) -> str:
    return f"USR-01: Out of {WALLETS[wallet]} credits. Top up to carry on; nothing more is charged until you do."


async def confirm(db, ref: str, item: str, quantity: float = 1, note: str = "") -> int:
    """The held work succeeded: charge what was held (the price when it started). With no hold
    (the check failed earlier, or the hold expired) it is charged at today's price. Charged once
    per ref. Returns credits charged. Caller commits."""
    await _lock(db)
    doc = await _get_doc(db, _settings_id())
    holds = _holds(doc)
    h = holds.pop(ref, None)
    if h is not None:
        await _patch_doc(db, {"holds": holds})
    if await _already_charged(db, ref, item):
        return 0
    if h is not None:
        return await _charge_cost(db, h["item"], h["quantity"], int(h["credits"]), ref, note or h.get("note", ""))
    return await charge(db, item, quantity, ref, note)


async def release(db, refs: List[str]) -> int:
    """The held work failed, timed out or was cancelled: give the held credits back. Returns the
    credits released. Never raises. Caller commits."""
    try:
        await _lock(db)
        doc = await _get_doc(db, _settings_id())
        holds = _holds(doc)
        freed = sum(int(holds.pop(r, {}).get("credits", 0)) for r in refs)
        if freed or any(r in _holds(doc) for r in refs):
            await _patch_doc(db, {"holds": holds})
        return freed
    except Exception as err:
        logger.warning(f"[credits] release skipped (expires on its own): {err}")
        return 0


async def drop_stale_holds(db, now: Optional[datetime] = None) -> int:
    """Give back holds left by work that never finished (e.g. a server restart mid-job)."""
    now = now or datetime.utcnow()
    doc = await _get_doc(db, _settings_id())
    holds = _holds(doc)
    stale = [r for r, h in holds.items() if datetime.fromisoformat(h.get("at") or now.isoformat()) < now - HOLD_TTL]
    for r in stale:
        holds.pop(r)
    if stale:
        await _patch_doc(db, {"holds": holds})
    return len(stale)


# Charges that could not be written (the database was briefly unavailable), per organisation.
# They are charged together with the organisation's next run; settle() also re-finds AI posts.
_OWED: Dict[str, List[Dict[str, Any]]] = {}


async def confirm_safely(db, ref: str, item: str, quantity: float = 1, note: str = "") -> None:
    """confirm() and commit; if that fails, keep the charge for the next run. Never raises."""
    try:
        await confirm(db, ref, item, quantity, note)
        await db.commit()
    except Exception as err:
        logger.warning(f"[credits] charge {ref} kept for the next run: {err}")
        try:
            await db.rollback()
        except Exception:
            pass
        _OWED.setdefault(_org(), []).append({"ref": ref, "item": item, "quantity": quantity, "note": note})


async def pay_owed(db) -> int:
    """Charge what earlier runs could not. Caller commits."""
    owed = _OWED.pop(_org(), [])
    total = 0
    for i, o in enumerate(owed):
        try:
            total += await confirm(db, o["ref"], o["item"], o["quantity"], o["note"])
        except Exception:
            _OWED.setdefault(_org(), []).extend(owed[i:])
            raise
    return total


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


async def can_start(db, item: str, quantity: float = 1, extra: Optional[List[Tuple[str, float]]] = None) -> Tuple[bool, str]:
    """Whether the organisation can afford quantity units of item now (plus extra items that
    come with it, e.g. a post's image). Never raises."""
    try:
        if not (await org_settings(db))["enforce"]:
            return True, ""
        card = await rates(db)
        need: Dict[str, int] = {}
        for it, qty in [(item, quantity), *(extra or [])]:
            rate = card.get(it, {})
            wallet = rate.get("wallet", "voice")
            need[wallet] = need.get(wallet, 0) + int(math.ceil(qty * rate.get("credits", 0)))
        for wallet, cost in need.items():
            if cost > 0 and await wallet_balance(db, wallet) < cost:
                return False, out_of_credits(wallet)
        return True, ""
    except Exception as err:
        logger.warning(f"[credits] check skipped: {err}")
        return True, ""


async def average_call_minutes(db, days: int = 30) -> float:
    """The company's average answered voice call over the last days, in minutes (rounded up per
    call, as charged); DEFAULT_CALL_MIN before it has any."""
    from app.models.models import CallLog

    since = datetime.utcnow() - timedelta(days=days)
    rows = (await db.execute(select(CallLog.duration).where(CallLog.channel == "voice", CallLog.created_at >= since)
                             .order_by(CallLog.created_at.desc()).limit(500))).scalars().all()
    mins = [m for m in (minutes_of(d) for d in rows) if m > 0]
    return round(sum(mins) / len(mins), 1) if mins else float(DEFAULT_CALL_MIN)


async def minutes_left(db) -> Optional[int]:
    """Whole voice minutes the organisation can still pay for (after what live calls hold).
    None when its credits are not enforced or minutes are free."""
    if not (await org_settings(db))["enforce"]:
        return None
    per_minute = (await rates(db))["voice_minute"]["credits"]
    if per_minute <= 0:
        return None
    return max(await wallet_balance(db, "voice"), 0) // per_minute


async def short_call_warning(db, calls: int = 1) -> Optional[Dict[str, Any]]:
    """A warning to show before calling when the minutes left are below the company's average
    call (times the number of calls on a list); None when there is enough. Never raises."""
    try:
        left = await minutes_left(db)
        if left is None:
            return None
        avg = await average_call_minutes(db)
        if left >= avg * max(calls, 1):
            return None
        if calls > 1:
            msg = (f"{left} call minutes left; your calls average {avg:g} minutes, so this list will pause when the "
                   f"minutes run out (about {int(left // avg) if avg else 0} of {calls} calls). Each call ends when its minutes run out.")
        else:
            msg = (f"Only {left} call minute{'s' if left != 1 else ''} left; your calls average {avg:g} minutes. "
                   f"This call will end after {left} minute{'s' if left != 1 else ''}, with a wrap-up a minute before.")
        return {"code": "LOW_MINUTES", "message": msg + " Top up for longer calls, or call anyway.",
                "minutesLeft": left, "averageMinutes": avg}
    except Exception as err:
        logger.warning(f"[credits] short-call check skipped: {err}")
        return None


async def reserve_call(db, call_id: str) -> Tuple[bool, str, Optional[int]]:
    """Hold the voice minutes left for this call: (allowed, why not, longest it may last in
    seconds, or None for no cap). The hold keeps other calls from spending the same minutes and
    is charged by what the call really used when it ends (charge_finished_call). Never raises:
    if the check fails the call goes ahead uncapped and is charged when it ends. Caller commits."""
    try:
        left = await minutes_left(db)
        if left is None:
            return True, "", None
        if left < 1:
            return False, out_of_credits("voice"), None
        minutes = min(left, MAX_CALL_SECS // 60)
        ok, why = await hold(db, [{"ref": f"{CALL_HOLD}{call_id}", "item": "voice_minute", "quantity": minutes,
                                   "note": "Call in progress"}])
        if not ok:
            return False, why, None
        return True, "", minutes * 60
    except Exception as err:
        logger.warning(f"[credits] call reserve skipped: {err}")
        return True, "", None


async def charge_finished_call(db, call_id: str, duration: str, label: str = "") -> None:
    """A call ended: charge the minutes it used and give back the rest of its hold, so the next
    call sees the real balance straight away. Never raises; settle() charges anything missed."""
    from app.services.call_log_writer import log_id_for_call

    try:
        ref = f"call:{log_id_for_call(call_id)}"
        used = minutes_of(duration) - (await _charged(db, [ref])).get(ref, 0)
        if used > 0:
            await charge(db, "voice_minute", used, ref, f"Call with {label}" if label else "Call")
        await release(db, [f"{CALL_HOLD}{call_id}"])
        await db.commit()
    except Exception as err:
        logger.warning(f"[credits] call {call_id} charged on the next settle: {err}")
        try:
            await db.rollback()
        except Exception:
            pass


async def _release_ended_call_holds(db) -> None:
    """Holds of calls that have ended (their minutes are charged from the call log)."""
    from app.models.models import LiveCall

    refs = [r for r in _holds(await _get_doc(db, _settings_id())) if r.startswith(CALL_HOLD)]
    if not refs:
        return
    ids = [r[len(CALL_HOLD):] for r in refs]
    live = {c.id: c.ended for c in (await db.execute(select(LiveCall).where(LiveCall.id.in_(ids)))).scalars().all()}
    done = [f"{CALL_HOLD}{i}" for i in ids if live.get(i, True)]
    if done:
        await release(db, done)


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
    await drop_stale_holds(db, now)
    # Usage from before credits were switched on for this organisation is never charged.
    doc = await _get_doc(db, _settings_id())
    if not doc.get("tracking_since"):
        await _patch_doc(db, {"tracking_since": now.isoformat()})
        await db.commit()
        return 0
    since = max(now - SETTLE_LOOKBACK, datetime.fromisoformat(doc["tracking_since"]))
    total = await pay_owed(db)

    logs = (await db.execute(select(CallLog).where(CallLog.created_at >= since, CallLog.channel == "voice"))).scalars().all()
    done = await _charged(db, [f"call:{c.id}" for c in logs])
    for c in logs:
        extra = minutes_of(c.duration) - done.get(f"call:{c.id}", 0)
        if extra > 0:
            total += await charge(db, "voice_minute", extra, f"call:{c.id}", f"Call with {c.listed_as}")
    await _release_ended_call_holds(db)

    # Finished AI posts whose charge was never written (normally charged the moment they finish).
    # One written post (shared by the channels it was written for) and its image.
    jobs = (await db.execute(select(SocialGenJob).where(
        SocialGenJob.updated_at >= since, SocialGenJob.state == "done", SocialGenJob.error.is_(None)))).scalars().all()
    for j in jobs:
        if (j.options or {}).get("billing") != 2:
            continue  # queued before holds existed: charged the old way, already settled
        for ref, item, note in ((f"gen:{j.id}", "ai_post", "AI-written post"), (f"genimg:{j.id}", "ai_image", "AI image")):
            if item == "ai_image" and j.skip_image:
                continue
            if not await _already_charged(db, ref, item):
                total += await confirm(db, ref, item, 1, note)

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

    # Rental unpaid: release every one of this org's numbers immediately, same "stop at zero, no
    # grace" rule calls already follow. No separate billing loop for this on purpose: this reuses
    # the monthly charge above (ref-deduped per calendar month) instead of charging twice.
    if numbers and await wallet_balance(db, "voice") < 0:
        from app.api.telnyx_numbers import _release_number

        for n in numbers:
            try:
                await _release_number(db, n)
            except Exception as rel_err:
                logger.warning(f"[settle] could not release {n.e164} for unpaid rental: {rel_err}")
        from app.core.notify import notify

        await notify("numbers", "Numbers released for unpaid rental",
                     ["Your phone numbers were released: monthly rental couldn't be paid from your balance."])

    if total:
        await _warn_low(db)
    await db.commit()
    from app.services import voice_access

    await voice_access.sync(db)  # at zero minutes the numbers stop taking calls; back on after a top-up
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


async def usage_month(db, month: str, wallet: str = "") -> Dict[str, Any]:
    """A company's credits for one calendar month (UTC): what it used per item, added, expired,
    each day's use, and every ledger line (newest first)."""
    from app.models.models import CreditEntry
    from app.services.revenue import month_range

    start, end = month_range(month)
    q = select(CreditEntry).where(CreditEntry.created_at >= start, CreditEntry.created_at < end)
    if wallet:
        q = q.where(CreditEntry.wallet == wallet)
    rows = (await db.execute(q.order_by(CreditEntry.created_at.desc()))).scalars().all()
    items: Dict[str, Dict[str, Any]] = {}
    days: Dict[str, Dict[str, int]] = {}
    totals = {"used": 0, "added": 0, "expired": 0, "adjusted": 0}
    for r in rows:
        if r.kind == "usage":
            it = items.setdefault(r.item or "other", {"item": r.item or "other", "wallet": r.wallet,
                                                        "label": DEFAULT_RATES.get(r.item, {}).get("label", r.item or "Other"),
                                                        "unit": DEFAULT_RATES.get(r.item, {}).get("unit", ""),
                                                        "units": 0.0, "credits": 0})
            it["units"] += float(r.quantity or 0)
            it["credits"] -= int(r.amount)
            totals["used"] -= int(r.amount)
            day = r.created_at.strftime("%Y-%m-%d") if r.created_at else ""
            days.setdefault(day, {}).setdefault(r.wallet, 0)
            days[day][r.wallet] -= int(r.amount)
        elif r.kind == "grant":
            totals["added"] += int(r.amount)
        elif r.kind == "expire":
            totals["expired"] -= int(r.amount)
        else:
            totals["adjusted"] += int(r.amount)
    return {
        "month": month, "wallet": wallet or None, "totals": totals,
        "items": sorted(({**v, "units": round(v["units"], 2)} for v in items.values()), key=lambda v: -v["credits"]),
        "days": [{"day": d, "byWallet": w, "credits": sum(w.values())} for d, w in sorted(days.items())],
        "entries": [{"id": r.id, "kind": r.kind, "wallet": r.wallet, "item": r.item, "quantity": r.quantity, "amount": r.amount,
                     "note": r.note, "by": r.by, "at": r.created_at.isoformat() if r.created_at else None} for r in rows],
    }


# Kept for callers from before wallets (staff grants without a wallet go to Voice).
async def grant(db, amount: int, note: str = "", by: str = "", wallet: str = "voice",
                expires_at: Optional[datetime] = None) -> int:
    if amount > 0:
        return await add_credits(db, wallet, amount, source="grant", expires_at=expires_at, note=note, by=by)
    if amount < 0:
        return await remove_credits(db, wallet, -amount, note=note, by=by)
    raise ValueError("Amount cannot be zero.")
