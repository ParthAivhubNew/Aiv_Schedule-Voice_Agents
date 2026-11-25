"""What a plan includes, and its fair-use cost cap (plan 11, step 5).

Each BillingPlan has `rules`, cleaned by clean_rules():
  {"providers": None | ["icypeas", "hunter", ...],   # None: every provider; a list: only these (app/providers ids)
   "cost_cap_pct": None | 5..100,                    # what our variable cost may reach, as a % of what the client paid this period
   "limits": {"users": n, "exports_month": n, "emails_day": n, "assistant_day": n}}   # each optional; missing: no limit

- **Providers:** a company may use a provider when any of its live plans includes it. A company with no live plan (a trial,
  free credits, an account staff don't charge) is not limited. The e-mail waterfall and the Apollo and Tavily key pools ask
  provider_allowed() first.
- **Cost cap:** the window is the billing period (the 30 days up to the subscription's period end). Paid is what the company
  paid in that window (plan renewals and top-ups, net of VAT when prices include it); before its first payment, the price of its
  capped plans counts instead. Cost is recorded provider cost plus estimated usage (services/revenue.py), in pounds.
  - At 80% the company's admins get the "low credits" e-mail and staff get a CAP-01 alert, once per period.
  - At 100%, paid lookups (CAP_ITEMS) are refused with USR-08 until a top-up raises what was paid, or the period ends.
    Calls in progress, phone rent and everything else carry on.
- **Limits:** a company's limit of a kind is the highest any of its live plans sets; no plan setting it (or no live plan) means
  no limit. Users are counted when one is added (api/auth.py), exports per calendar month (api/exports.py), e-mails per UTC day
  at the credit check of each send (services/credits.py), assistant messages per day (api/lead_assistant.py). A refusal says
  what the plan allows (USR-09).
- Every check never raises. When the rules can't be read, nothing is limited: these are commercial limits, not compliance rules.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import text

logger = logging.getLogger("plan_rules")

CAP_ITEMS = ("lead_lookup", "google_deep_search", "google_view", "lead_social", "check_email", "lead_phone_check", "number_check",
             "lead_tps_check", "tps_check", "ai_image", "ai_video")
WARN_AT, PAUSE_AT = 0.8, 1.0
LIVE_STATUSES = ("active", "trialing", "past_due")
CAP_REFUSED = ("USR-08: Your plan's fair-use limit for this billing period is reached, so paid lookups are paused. "
               "Top up to carry on, or they start again when the period renews.")
LIMITS = {"users": "users", "exports_month": "exports a month", "emails_day": "e-mails a day", "assistant_day": "assistant messages a day"}
_TTL = 60.0
_CACHE: Dict[str, Any] = {}  # org -> (when, {"plans": [...], "cap": {...} or None})


def clean_rules(raw: Any) -> Dict[str, Any]:
    from app.providers import registry

    raw = raw if isinstance(raw, dict) else {}
    out: Dict[str, Any] = {"providers": None, "cost_cap_pct": None, "limits": {}}
    prov = raw.get("providers")
    if isinstance(prov, list):
        known = {p.manifest.id for p in registry.all_providers()}
        out["providers"] = sorted({str(p).strip().lower() for p in prov if str(p).strip().lower() in known})
    lim = raw.get("limits") if isinstance(raw.get("limits"), dict) else {}
    for kind in LIMITS:
        try:
            n = int(float(lim.get(kind))) if lim.get(kind) not in (None, "") else 0
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            out["limits"][kind] = min(n, 10_000_000)
    cap = raw.get("cost_cap_pct")
    if cap not in (None, "", 0, "0"):
        try:
            out["cost_cap_pct"] = max(5, min(100, int(float(cap))))
        except (TypeError, ValueError):
            pass
    return out


def invalidate(org_id: Optional[str] = None) -> None:
    if org_id:
        _CACHE.pop(org_id, None)
    else:
        _CACHE.clear()


async def _live_plans(db, org_id: str) -> List[Dict[str, Any]]:
    """[{id, wallet, kind, price_cents, currency, rules}] of the org's live subscription plans."""
    row = (await db.execute(text("SELECT status, plans, current_period_end FROM billing_subscriptions WHERE id = :o"), {"o": org_id})).first()
    if not row or row[0] not in LIVE_STATUSES or not isinstance(row[1], dict) or not row[1]:
        return []
    ids = [str(v) for v in row[1].values() if v]
    plans = (await db.execute(text("SELECT id, wallet, kind, price_usd_cents, currency, rules FROM billing_plans WHERE id = ANY(:i)"),
                              {"i": ids})).all()
    return [{"id": p[0], "wallet": p[1], "kind": p[2], "price_cents": int(p[3] or 0), "currency": (p[4] or "usd").upper(),
             "rules": clean_rules(p[5]), "period_end": row[2]} for p in plans]


async def _state(org_id: str, db=None) -> Dict[str, Any]:
    hit = _CACHE.get(org_id)
    if hit and time.monotonic() - hit[0] < _TTL:
        return hit[1]
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    with system_scope():
        async with AsyncSessionLocal() as s:
            plans = await _live_plans(s, org_id)
            cap = await _cap(s, org_id, plans) if any(p["rules"]["cost_cap_pct"] for p in plans) else None
    state = {"plans": plans, "cap": cap}
    _CACHE[org_id] = (time.monotonic(), state)
    return state


async def _cap(db, org_id: str, plans: List[Dict[str, Any]]) -> Dict[str, Any]:
    from app.services import fx, margin_guard, revenue

    now = datetime.utcnow()
    end = max([p["period_end"] for p in plans if p["period_end"]] or [now + timedelta(days=30)])
    start = end - timedelta(days=30)
    vat = (await margin_guard.settings(db))["prices_include_vat"]
    capped = [p for p in plans if p["rules"]["cost_cap_pct"]]
    paid = 0.0
    for cur, cents in (await db.execute(text(
            "SELECT lower(coalesce(nullif(paid_currency, ''), 'usd')), sum(paid_cents) FROM credit_grants "
            "WHERE org_id = :o AND paid_cents > 0 AND created_at >= :s GROUP BY 1"), {"o": org_id, "s": start})).all():
        paid += (await fx.convert(db, float(cents or 0) / 100.0, cur, "GBP"))[0]
    if paid <= 0:  # before the first payment of the period: the price of the capped plans
        for p in capped:
            paid += (await fx.convert(db, p["price_cents"] / 100.0, p["currency"], "GBP"))[0]
    net = paid / 1.2 if vat else paid
    pct = max(p["rules"]["cost_cap_pct"] for p in capped) / 100.0
    cap_gbp = round(net * pct, 2)
    cost = await revenue.org_cost_gbp(db, org_id, start, now)
    used = (cost / cap_gbp) if cap_gbp > 0 else (1.0 if cost > 0 else 0.0)
    return {"capGbp": cap_gbp, "costGbp": round(cost, 2), "used": round(used, 3), "capPct": int(pct * 100), "periodEnd": end.isoformat(),
            "state": "paused" if used >= PAUSE_AT else "warn" if used >= WARN_AT else "ok"}


async def provider_allowed(provider_id: str, org_id: Optional[str] = None) -> bool:
    """False only when the company's live plans all leave this provider out. Never raises."""
    try:
        if not org_id:
            from app.core.tenancy import SYSTEM, current_org

            org_id = current_org()
            if not org_id or org_id == SYSTEM:
                return True
        plans = (await _state(org_id))["plans"]
        if not plans or any(p["rules"]["providers"] is None for p in plans):
            return True
        return any(provider_id in p["rules"]["providers"] for p in plans)
    except Exception as err:
        logger.warning(f"[plan_rules] provider check skipped: {err}")
        return True


async def cap_state(org_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The company's fair-use state ({capGbp, costGbp, used, state: ok | warn | paused, ...}), or None when no plan sets a cap. Never raises."""
    try:
        if not org_id:
            from app.core.tenancy import SYSTEM, current_org

            org_id = current_org()
            if not org_id or org_id == SYSTEM:
                return None
        state = (await _state(org_id))["cap"]
        if state and state["state"] != "ok":
            await _tell_once(org_id, state)
        return state
    except Exception as err:
        logger.warning(f"[plan_rules] cost cap check skipped: {err}")
        return None


async def cap_refusal(items: List[str], org_id: Optional[str] = None) -> str:
    """The refusal for paid lookups when the cap is reached; "" when the work may go ahead."""
    if not any(i in CAP_ITEMS for i in items):
        return ""
    state = await cap_state(org_id)
    return CAP_REFUSED if state and state["state"] == "paused" else ""


async def _tell_once(org_id: str, state: Dict[str, Any]) -> None:
    """The company's admins (low credits e-mail) and staff (CAP-01) hear once per period and state."""
    from app.core.tenancy import org_scope, system_scope
    from app.database import AsyncSessionLocal
    from app.services.credits import _get_doc, _put_doc

    key, mark = f"cost_cap:{org_id}", f"{state['periodEnd'][:10]}:{state['state']}"
    with system_scope():
        async with AsyncSessionLocal() as s:
            doc = await _get_doc(s, key)
            if mark in (doc.get("told") or []):
                return
            await _put_doc(s, key, {"told": ((doc.get("told") or []) + [mark])[-12:]})
            await s.commit()
    from app.core.notify import notify
    from app.services.ai_errors import alert_staff

    paused = state["state"] == "paused"
    with org_scope(org_id):
        await notify("low_credits", "Your plan's fair-use limit is reached" if paused else "You have used most of this period's fair-use allowance",
                     [f"This billing period your account has used {int(state['used'] * 100)}% of its fair-use allowance.",
                      "Paid lookups are paused until you top up or the period renews." if paused
                      else "When it reaches 100%, paid lookups pause until you top up or the period renews."])
    await alert_staff("CAP-01", f"{org_id} is at {int(state['used'] * 100)}% of its fair-use cap (£{state['costGbp']} of £{state['capGbp']}).", org_id=org_id)


async def limit(kind: str, org_id: Optional[str] = None) -> Optional[int]:
    """The company's limit of a kind (LIMITS): the highest its live plans set, or None for no limit. Never raises."""
    try:
        if not org_id:
            from app.core.tenancy import SYSTEM, current_org

            org_id = current_org()
            if not org_id or org_id == SYSTEM:
                return None
        values = [p["rules"]["limits"].get(kind) for p in (await _state(org_id))["plans"]]
        values = [v for v in values if v]
        return max(values) if values else None
    except Exception as err:
        logger.warning(f"[plan_rules] limit check skipped: {err}")
        return None


def limit_message(kind: str, n: int) -> str:
    return f"USR-09: Your plan allows {n:,} {LIMITS.get(kind, kind)}. Upgrade your plan for more."


async def emails_refusal(db, quantity: float = 1) -> str:
    """The refusal for an e-mail over the plan's daily limit (counted from today's e-mail charges, UTC); "" when it may go."""
    n = await limit("emails_day")
    if not n:
        return ""
    from datetime import datetime as _dt

    start = _dt.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    sent = (await db.execute(text("SELECT coalesce(sum(quantity), 0) FROM credit_ledger WHERE kind = 'usage' AND item = 'email_send' AND created_at >= :s"),
                             {"s": start})).scalar() or 0
    return limit_message("emails_day", n) if float(sent) + float(quantity) > n else ""
