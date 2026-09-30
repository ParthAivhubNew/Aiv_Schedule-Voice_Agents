"""Credits: each organisation's prepaid balance, kept as a ledger (no payments yet).

- Grants add credits (platform staff only), usage takes them away. Balance = sum of amounts.
- The rate card says what one unit of each billable thing costs.
- Usage is settled in the background from what actually happened (finished call logs,
  finished AI posts), so billing can never slow down or break a call.
- When an organisation's credits are enforced and its balance cannot cover one unit, new
  calls and new AI writing are refused ("stop at zero"). Calls already running continue.
- Enforcement is per organisation. Self-signup organisations start enforced with starter
  credits; the original organisation is not enforced unless switched on, so nothing that
  works today stops working.
"""
from __future__ import annotations

import logging
import math
import os
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.future import select

logger = logging.getLogger("credits")

# key: (label, unit, credits per unit)
DEFAULT_RATES: Dict[str, Dict[str, Any]] = {
    "voice_minute": {"label": "Voice call minute", "unit": "minute", "credits": 10},
    "ai_post": {"label": "AI-written social post", "unit": "post", "credits": 2},
}
RATES_KEY = "credit_rates"
SETTLE_LOOKBACK = timedelta(days=3)


def starter_credits() -> int:
    try:
        return max(0, int(os.getenv("STARTER_CREDITS", "500")))
    except ValueError:
        return 500


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
    return {"enforce": bool(doc.get("enforce", False)), "low_at": int(doc.get("low_at", 100)),
            "low_notified": bool(doc.get("low_notified", False))}


async def set_org_settings(db, patch: dict, org_id: Optional[str] = None) -> dict:
    doc = await _get_doc(db, _settings_id(org_id))
    if "enforce" in patch:
        doc["enforce"] = bool(patch["enforce"])
    if "low_at" in patch:
        doc["low_at"] = max(0, int(patch["low_at"]))
    if "low_notified" in patch:
        doc["low_notified"] = bool(patch["low_notified"])
    await _put_doc(db, _settings_id(org_id), doc)
    return await org_settings(db, org_id)


# ── Ledger ──────────────────────────────────────────────────────────────────
async def balance(db) -> int:
    from app.models.models import CreditEntry

    return int((await db.execute(select(func.coalesce(func.sum(CreditEntry.amount), 0)))).scalar() or 0)


def _entry(kind: str, amount: int, item: str = "", quantity: float = 0, ref: Optional[str] = None,
           note: str = "", by: str = ""):
    from app.models.models import CreditEntry

    return CreditEntry(id=f"cr_{uuid.uuid4().hex[:14]}", kind=kind, item=item, quantity=quantity,
                       amount=int(amount), ref=ref, note=note[:300], by=by[:120])


async def grant(db, amount: int, note: str = "", by: str = "") -> int:
    """Add (or with a negative amount, remove) credits in the current organisation. Caller commits."""
    if not amount:
        raise ValueError("Amount cannot be zero.")
    db.add(_entry("grant" if amount > 0 else "adjust", amount, note=note, by=by))
    await db.flush()
    if amount > 0:
        await set_org_settings(db, {"low_notified": False})
    return await balance(db)


async def can_start(db, item: str) -> Tuple[bool, str]:
    """Whether the organisation may start one more unit of item. Never raises."""
    try:
        settings = await org_settings(db)
        if not settings["enforce"]:
            return True, ""
        cost = (await rates(db)).get(item, {}).get("credits", 0)
        if cost <= 0:
            return True, ""
        if await balance(db) < cost:
            return False, "Out of credits. Ask your OutReach contact to add more."
        return True, ""
    except Exception as err:
        logger.warning(f"[credits] check skipped: {err}")
        return True, ""


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
    """Charge for usage not yet charged in the current organisation. Returns credits charged.
    Safe to run repeatedly: each thing is charged once (a longer call later charges the difference)."""
    from app.models.models import CallLog, SocialGenJob

    now = now or datetime.utcnow()
    # Usage from before credits were switched on for this organisation is never charged.
    doc = await _get_doc(db, _settings_id())
    if not doc.get("tracking_since"):
        doc["tracking_since"] = now.isoformat()
        await _put_doc(db, _settings_id(), doc)
        await db.commit()
        return 0
    since = max(now - SETTLE_LOOKBACK, datetime.fromisoformat(doc["tracking_since"]))
    card = await rates(db)
    total = 0

    logs = (await db.execute(select(CallLog).where(CallLog.created_at >= since, CallLog.channel == "voice"))).scalars().all()
    done = await _charged(db, [f"call:{c.id}" for c in logs])
    for c in logs:
        mins = minutes_of(c.duration)
        extra = mins - done.get(f"call:{c.id}", 0)
        if extra > 0:
            cost = int(extra * card["voice_minute"]["credits"])
            db.add(_entry("usage", -cost, "voice_minute", extra, f"call:{c.id}", f"Call with {c.listed_as}"[:300]))
            total += cost

    jobs = (await db.execute(select(SocialGenJob).where(
        SocialGenJob.updated_at >= since, SocialGenJob.state == "done", SocialGenJob.error.is_(None)))).scalars().all()
    done = await _charged(db, [f"gen:{j.id}" for j in jobs])
    for j in jobs:
        posts = len(j.post_ids or []) or 1
        if done.get(f"gen:{j.id}", 0) < posts:
            extra = posts - done.get(f"gen:{j.id}", 0)
            cost = int(extra * card["ai_post"]["credits"])
            db.add(_entry("usage", -cost, "ai_post", extra, f"gen:{j.id}", "AI-written post"))
            total += cost

    if total:
        await db.flush()
        await _maybe_warn_low(db)
    await db.commit()
    return total


async def _maybe_warn_low(db) -> None:
    s = await org_settings(db)
    if not s["enforce"] or s["low_notified"]:
        return
    bal = await balance(db)
    if bal > s["low_at"]:
        return
    await set_org_settings(db, {"low_notified": True})
    try:
        from app.core.notify import notify

        await notify("low_credits", "Your OutReach credits are running low",
                     [f"Your organisation has <b>{max(bal, 0)}</b> credits left.",
                      "Calls and AI writing stop when credits run out. Ask your OutReach contact to add more."])
    except Exception:
        pass


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
    return [{"id": r.id, "kind": r.kind, "item": r.item, "quantity": r.quantity, "amount": r.amount,
             "note": r.note, "by": r.by, "at": r.created_at.isoformat() if r.created_at else None} for r in rows]


async def usage_by_item(db, days: int = 30) -> Dict[str, dict]:
    from app.models.models import CreditEntry

    since = datetime.utcnow() - timedelta(days=days)
    rows = (await db.execute(
        select(CreditEntry.item, func.sum(CreditEntry.quantity), func.sum(CreditEntry.amount))
        .where(CreditEntry.kind == "usage", CreditEntry.created_at >= since).group_by(CreditEntry.item)
    )).all()
    return {item: {"quantity": float(q or 0), "credits": -int(a or 0)} for item, q, a in rows}
