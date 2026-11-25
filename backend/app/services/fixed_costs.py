"""Fixed costs and break-even (plan 11, step 5).

A fixed cost (models.FixedCost) is paid whatever the usage. Its monthly charge in pounds is the amount for a monthly cost, a twelfth
of a yearly cost, or a twelfth of a one-off cost spread over the 12 months from its start. A cost counts in a month when it is live
on any day of that month. A cost may belong to one app (voice, leadgen, scheduler) or to the whole platform.

Break-even, per plan on sale: what one subscriber leaves us each month (the plan's net price after VAT and Stripe, less the
average variable cost of its subscribers last month) and how many subscribers would pay the fixed costs. That is the plan's app's
fixed costs plus a share of the platform-wide ones, in proportion to the plans' prices.

Client profit (revenue.client_pnl) shares each month's fixed costs among paying clients by what they paid.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select, text

PERIODS = ("month", "year", "once")
WALLETS = ("", "voice", "leadgen", "scheduler")


def _month_bounds(month: str):
    start = datetime.strptime(month + "-01", "%Y-%m-%d").date()
    end = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
    return start, end


def _live_in(fc, start: date, end: date) -> bool:
    """Live on any day of [start, end). A one-off is spread over the 12 months from its start."""
    stop = fc.ends_on
    if fc.period == "once":
        y, m = fc.starts_on.year + (fc.starts_on.month + 11) // 12, (fc.starts_on.month + 11) % 12 + 1
        stop = min(stop, date(y, m, 1)) if stop else date(y, m, 1)
        return fc.starts_on < end and stop > start
    return fc.starts_on < end and (stop is None or stop >= start)


async def monthly(db, month: str) -> Dict[str, Any]:
    """{"total": £, "byWallet": {wallet or "platform": £}, "items": [...], "estimated": FX was a fallback} for a month."""
    from app.models.models import FixedCost
    from app.services import fx

    start, end = _month_bounds(month)
    rows = (await db.execute(select(FixedCost))).scalars().all()
    total, by, items, est = 0.0, {}, [], False
    for fc in rows:
        if not _live_in(fc, start, end):
            continue
        per = fc.amount_cents / 100.0 / (1 if fc.period == "month" else 12)
        gbp, e = await fx.convert(db, per, (fc.currency or "gbp").upper(), "GBP", start)
        est = est or e
        key = fc.wallet or "platform"
        by[key] = by.get(key, 0.0) + gbp
        total += gbp
        items.append({**view(fc), "monthlyGbp": round(gbp, 2)})
    return {"month": month, "total": round(total, 2), "byWallet": {k: round(v, 2) for k, v in by.items()}, "items": items, "estimated": est}


def view(fc) -> Dict[str, Any]:
    return {"id": fc.id, "vendor": fc.vendor, "description": fc.description or "", "amountCents": fc.amount_cents, "currency": fc.currency or "gbp",
            "period": fc.period, "startsOn": fc.starts_on.isoformat(), "endsOn": fc.ends_on.isoformat() if fc.ends_on else None, "wallet": fc.wallet or ""}


def clean(body: Dict[str, Any]) -> Dict[str, Any]:
    """The fields of a fixed cost, checked; ValueError with a plain message when one is wrong."""
    vendor = str(body.get("vendor") or "").strip()[:80]
    if not vendor:
        raise ValueError("Name the vendor.")
    try:
        cents = int(round(float(body.get("amountCents"))))
    except (TypeError, ValueError):
        raise ValueError("Enter the amount.")
    if cents <= 0:
        raise ValueError("The amount must be more than 0.")
    cur = str(body.get("currency") or "gbp").lower()
    if cur not in ("gbp", "usd", "eur"):
        raise ValueError("Pick GBP, USD or EUR.")
    period = str(body.get("period") or "month")
    if period not in PERIODS:
        raise ValueError("Pick monthly, yearly or one-off.")
    wallet = str(body.get("wallet") or "")
    if wallet not in WALLETS:
        raise ValueError("Pick an app, or the whole platform.")
    try:
        starts = date.fromisoformat(str(body.get("startsOn") or date.today().isoformat()))
        ends = date.fromisoformat(str(body["endsOn"])) if body.get("endsOn") else None
    except ValueError:
        raise ValueError("Dates are YYYY-MM-DD.")
    if ends and ends < starts:
        raise ValueError("The end is before the start.")
    return {"vendor": vendor, "description": str(body.get("description") or "")[:200], "amount_cents": cents, "currency": cur, "period": period,
            "starts_on": starts, "ends_on": ends, "wallet": wallet}


async def break_even(db, month: Optional[str] = None) -> Dict[str, Any]:
    """Per plan on sale: subscribers now, what one leaves us a month, and how many would pay the fixed costs."""
    from app.services import fx, margin_guard as MG
    from app.services import revenue as R

    month = month or datetime.utcnow().strftime("%Y-%m")
    fixed = await monthly(db, month)
    cfg = await MG.settings(db)
    plans = [p for p in await MG._plans(db) if p["kind"] == "plan" and p["active"]]
    # Last full month's variable cost per subscriber of each plan.
    first = datetime.strptime(month + "-01", "%Y-%m-%d")
    prev_end = first
    prev_start = (first - timedelta(days=1)).replace(day=1)
    subs = (await db.execute(text("SELECT id, plans FROM billing_subscriptions WHERE status IN ('active', 'trialing', 'past_due')"))).all()
    on_plan: Dict[str, List[str]] = {}
    for org_id, plan_map in subs:
        if org_id in R.INTERNAL_ORGS:  # the platform's own accounts are not subscribers
            continue
        for pid in (plan_map or {}).values():
            on_plan.setdefault(str(pid), []).append(org_id)
    prices = {}
    for p in plans:
        gross = (await fx.convert(db, p["price_cents"] / 100.0, (p["currency"] or "usd").upper(), "GBP"))[0]
        net = gross / 1.2 if cfg["prices_include_vat"] else gross
        prices[p["id"]] = net - gross * float(cfg["stripe_pct"]) / 100.0 - float(cfg["stripe_fixed_pence"]) / 100.0
    platform = fixed["byWallet"].get("platform", 0.0)
    total_price = sum(prices.values()) or 1.0
    out = []
    for p in plans:
        orgs = on_plan.get(p["id"], [])
        costs = [await R.org_cost_gbp(db, o, prev_start, prev_end) for o in orgs]
        avg_cost = sum(costs) / len(costs) if costs else 0.0
        leaves = prices[p["id"]] - avg_cost
        wallet_fixed = fixed["byWallet"].get(p["wallet"], 0.0)
        wallet_prices = sum(prices[q["id"]] for q in plans if q["wallet"] == p["wallet"]) or 1.0
        share = wallet_fixed * prices[p["id"]] / wallet_prices + platform * prices[p["id"]] / total_price
        needed = math.ceil(share / leaves) if leaves > 0 and share > 0 else (0 if share <= 0 else None)
        out.append({"planId": p["id"], "plan": p["name"], "wallet": p["wallet"], "subscribers": len(orgs), "netPrice": round(prices[p["id"]], 2),
                    "avgVariableCost": round(avg_cost, 2), "leavesPerSubscriber": round(leaves, 2), "fixedShare": round(share, 2),
                    "subscribersNeeded": needed, "coversFixed": needed is not None and len(orgs) >= needed})
    covered = sum(r["subscribers"] * r["leavesPerSubscriber"] for r in out)
    return {"month": month, "fixed": fixed, "plans": out, "monthlyMarginFromSubscribers": round(covered, 2),
            "gap": round(fixed["total"] - covered, 2), "settings": cfg}
