"""Revenue and cost breakdown for staff (admin portal), from data the app already keeps:

- what clients paid: each credit batch bought through Stripe records the amount (paid_cents);
- what they used: the usage ledger, per rate-card item (minutes, posts, leads, messages);
- what that cost us: units used x "our cost per unit", which staff enter per item (Telnyx's real
  cost per client is in the separate Telnyx margin report);
- subscriptions: how many are live or behind on payment, and the monthly total of live plans.
Amounts stay in their own currency; nothing is converted.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Dict

from sqlalchemy import text

UNIT_COSTS_KEY = "unit_costs"
CURRENCIES = ("gbp", "usd", "eur")


def month_range(month: str):
    start = datetime.strptime(month + "-01", "%Y-%m-%d")
    end = datetime(start.year + (start.month == 12), start.month % 12 + 1, 1)
    return start, end


async def unit_costs(db) -> Dict[str, Any]:
    from app.services.credits import DEFAULT_RATES, DEFAULT_UNIT_COSTS_USD_CENTS, _get_doc, default_voice_minute_cost_usd_cents

    stored = await _get_doc(db, UNIT_COSTS_KEY)
    costs = stored.get("costs") if isinstance(stored.get("costs"), dict) else {}
    currency = stored.get("currency") if stored.get("currency") in CURRENCIES else "gbp"
    # Telnyx's researched defaults are USD prices; only used as a fallback on a USD rate card —
    # converting to GBP/EUR pence would need an exchange rate that goes stale and could quietly
    # mislead margin, which is worse than just staying blank until staff enters their own number.
    defaults = {**DEFAULT_UNIT_COSTS_USD_CENTS, "voice_minute": default_voice_minute_cost_usd_cents()} if currency == "usd" else {}
    return {"currency": currency,
            "costs": {k: float(costs[k]) if k in costs else defaults.get(k, 0.0) for k in DEFAULT_RATES}}


async def set_unit_costs(db, currency: str, costs: Dict[str, Any]) -> Dict[str, Any]:
    from app.services.credits import DEFAULT_RATES, _put_doc

    if currency not in CURRENCIES:
        raise ValueError("Pick GBP, USD or EUR.")
    clean = {}
    for k, v in (costs or {}).items():
        if k in DEFAULT_RATES:
            try:
                clean[k] = max(0.0, round(float(v), 4))
            except (TypeError, ValueError):
                raise ValueError(f"Enter a number for {DEFAULT_RATES[k]['label']}.")
    await _put_doc(db, UNIT_COSTS_KEY, {"currency": currency, "costs": clean})
    return await unit_costs(db)


async def vendor_spend(db, month: str) -> Dict[str, Any]:
    """Real dollars actually spent this month at the pay-as-you-go data vendors behind Leadgen
    (the email finders in the waterfall, plus Tavily web search and Telnyx number lookup) — not
    revenue, not margin, just "how much should be funded in each of those accounts". The 5 email
    finders are exact (every attempt is logged with its real cost); Tavily/Telnyx are a call-count
    estimate at their known per-call price, since those calls aren't logged per-attempt. No auto
    top-up — staff still fund each account by hand on that provider's own site."""
    from app.services.ai_pricing import price_per_call
    from app.services.credits import _get_doc
    from app.services.enrichment_waterfall import LABELS, OTHER_VENDOR_LABELS

    start, end = month_range(month)
    rows = (await db.execute(text(
        "SELECT provider, count(*), sum(cost_usd) FROM enrichment_attempts "
        "WHERE created_at >= :s AND created_at < :e GROUP BY 1"), {"s": start, "e": end})).all()
    providers = []
    for provider, calls, spent in rows:
        if provider not in LABELS:
            continue
        providers.append({"provider": provider, "label": LABELS[provider], "calls": int(calls or 0),
                           "costUsd": round(float(spent or 0.0), 2), "exact": True})
    counted = {p["provider"] for p in providers}
    for p in LABELS:
        if p not in counted:
            providers.append({"provider": p, "label": LABELS[p], "calls": 0, "costUsd": 0.0, "exact": True})

    calls_doc = await _get_doc(db, f"vendor_calls:{month}")
    for provider, label in OTHER_VENDOR_LABELS.items():
        calls = int(calls_doc.get(provider, 0) or 0)
        price = await price_per_call(db, provider)
        providers.append({"provider": provider, "label": label, "calls": calls,
                           "costUsd": round(calls * price, 2), "exact": False})
    providers.sort(key=lambda p: -p["costUsd"])
    return {"month": month, "providers": providers, "totalUsd": round(sum(p["costUsd"] for p in providers), 2)}


async def report(db, month: str, include_aivhub: bool = False) -> Dict[str, Any]:
    """Every organisation (run with all organisations visible). Aivhub's own house account is
    excluded by default: it's never a paying customer, and counting its internally-granted
    credits/subscription as revenue would skew every margin number here."""
    from app.services.credits import DEFAULT_RATES, WALLETS, wallet_of

    start, end = month_range(month)
    window = {"s": start, "e": end}
    costs = await unit_costs(db)
    names = dict((await db.execute(text("SELECT id, name FROM organizations"))).all())
    org_excl = "" if include_aivhub else "AND org_id <> 'org_default' "
    id_excl = "" if include_aivhub else "AND id <> 'org_default' "

    # What clients paid, per app and currency, and per client.
    paid = (await db.execute(text(
        "SELECT org_id, wallet, lower(coalesce(nullif(paid_currency, ''), 'usd')), sum(paid_cents), count(*) FROM credit_grants "
        f"WHERE paid_cents > 0 {org_excl}AND created_at >= :s AND created_at < :e GROUP BY 1, 2, 3"), window)).all()
    by_app: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    payments = 0
    clients: Dict[str, Dict[str, Any]] = {}

    def client(org_id: str) -> Dict[str, Any]:
        return clients.setdefault(org_id, {"orgId": org_id, "name": names.get(org_id, org_id), "paid": defaultdict(int),
                                           "credits": 0, "cost": 0.0})

    for org_id, wallet, cur, cents, n in paid:
        by_app[wallet][cur] += int(cents or 0)
        client(org_id)["paid"][cur] += int(cents or 0)
        payments += int(n or 0)

    # Credits staff gave free of charge (never revenue), per app.
    given = dict((await db.execute(text(
        f"SELECT wallet, sum(amount) FROM credit_grants WHERE source = 'given' {org_excl}AND created_at >= :s AND created_at < :e "
        "GROUP BY 1"), window)).all())

    # What they used, and what that cost us.
    used = (await db.execute(text(
        "SELECT org_id, item, sum(quantity), -sum(amount) FROM credit_ledger "
        f"WHERE kind = 'usage' {org_excl}AND created_at >= :s AND created_at < :e GROUP BY 1, 2"), window)).all()
    items: Dict[str, Dict[str, float]] = {}
    for org_id, item, qty, credits in used:
        row = items.setdefault(item, {"units": 0.0, "credits": 0, "cost": 0.0})
        unit = costs["costs"].get(item, 0.0)
        row["units"] += float(qty or 0)
        row["credits"] += int(credits or 0)
        row["cost"] += float(qty or 0) * unit
        c = client(org_id)
        c["credits"] += int(credits or 0)
        c["cost"] += float(qty or 0) * unit

    # Subscriptions and the monthly value of live plans.
    subs = dict((await db.execute(text(f"SELECT status, count(*) FROM billing_subscriptions WHERE 1=1 {id_excl}GROUP BY 1"))).all())
    plan_rows = dict((p[0], (p[1], (p[2] or "usd").lower())) for p in (await db.execute(text(
        "SELECT id, price_usd_cents, currency FROM billing_plans"))).all())
    monthly: Dict[str, int] = defaultdict(int)
    for (plans,) in (await db.execute(text(
            f"SELECT plans FROM billing_subscriptions WHERE status IN ('active', 'trialing', 'past_due') {id_excl}"))).all():
        for plan_id in (plans or {}).values():
            if plan_id in plan_rows:
                cents, cur = plan_rows[plan_id]
                monthly[cur] += int(cents or 0)
    # stripe_events has no org_id column (real Stripe webhooks only; Aivhub's manually-inserted
    # subscription row never generates one of these), so no exclusion is needed here.
    failed = (await db.execute(text(
        "SELECT count(*) FROM stripe_events WHERE type = 'invoice.payment_failed' AND created_at >= :s AND created_at < :e"),
        window)).scalar() or 0

    cur = costs["currency"]
    # Margin per app: what was paid for it against what its usage cost us.
    apps = []
    for w in WALLETS:
        cost = sum(v["cost"] for k, v in items.items() if wallet_of(k) == w)
        credits_used = sum(v["credits"] for k, v in items.items() if wallet_of(k) == w)
        paid_here = dict(by_app.get(w, {}))
        if not paid_here and not credits_used:
            continue
        margin = paid_here.get(cur, 0) - round(cost) if set(paid_here) <= {cur} else None
        apps.append({"wallet": w, "name": WALLETS[w], "paid": paid_here, "credits": credits_used,
                     "given": int(given.get(w, 0) or 0), "costCents": round(cost), "marginCents": margin})
    out_clients = []
    for c in clients.values():
        paid_here = dict(c["paid"])
        cost_cents = round(c["cost"])
        margin = paid_here.get(cur, 0) - cost_cents if set(paid_here) <= {cur} else None
        out_clients.append({"orgId": c["orgId"], "name": c["name"], "paid": paid_here, "credits": c["credits"],
                            "costCents": cost_cents, "marginCents": margin})
    out_clients.sort(key=lambda r: (-(sum(r["paid"].values())), -r["credits"]))
    return {
        "month": month,
        "includeAivhub": include_aivhub,
        "currency": cur,
        "revenue": {w: dict(v) for w, v in by_app.items()},
        "appNames": WALLETS,
        "payments": payments,
        "given": {w: int(v or 0) for w, v in given.items()},
        "apps": apps,
        "failedPayments": int(failed),
        "subscriptions": {k or "none": int(v) for k, v in subs.items()},
        "monthlyPlans": dict(monthly),
        "usage": [{"item": k, "label": DEFAULT_RATES.get(k, {}).get("label", k), "units": round(v["units"], 2),
                   "credits": v["credits"], "unitCost": costs["costs"].get(k, 0.0), "costCents": round(v["cost"])}
                  for k, v in sorted(items.items())],
        "clients": out_clients,
        "costsSet": any(costs["costs"].values()),
    }


# ── Profit and loss per client (plan 11, step 3) ───────────────────────────────
REPORT_CURRENCY = "GBP"
MARGIN_FLOOR_PCT = 60  # below this a client is flagged (plan 11, decision 1: the suggested floor)
INTERNAL_ORGS = ("org_default", "org_outreach", "*", "")  # the platform's own accounts and work that belongs to no client
# Usage whose vendor cost is not logged per call (see services/cost_ledger.py): its cost is estimated from the units used.
ESTIMATED_ITEMS = ("voice_minute", "voice_minute_premium", "call_transcript", "whatsapp_message", "phone_number_month", "number_setup",
                   "tps_check", "lead_tps_check", "google_view", "google_deep_search")


async def _estimate_unit_costs(db) -> Dict[str, Any]:
    """{item: (cost per unit, currency)} for the estimated items: what staff set on the rate card's cost column, else the researched
    USD default; an item with neither has no entry (its units are reported as cost unknown)."""
    from app.services.credits import DEFAULT_UNIT_COSTS_USD_CENTS, _get_doc, default_voice_minute_cost_usd_cents

    stored = await _get_doc(db, UNIT_COSTS_KEY)
    cur = (stored.get("currency") if stored.get("currency") in CURRENCIES else "gbp").upper()
    set_by_staff = {k: float(v) for k, v in (stored.get("costs") or {}).items() if isinstance(v, (int, float)) and v > 0}
    defaults = {**DEFAULT_UNIT_COSTS_USD_CENTS, "voice_minute": default_voice_minute_cost_usd_cents(),
                "call_transcript": 0.0}  # the transcript's speech-to-text is in the AI ledger
    out: Dict[str, Any] = {}
    for item in ESTIMATED_ITEMS:
        if item in set_by_staff:
            out[item] = (set_by_staff[item] / 100.0, cur)  # stored in minor units (pence / cents)
        elif item in defaults:
            out[item] = (float(defaults[item]) / 100.0, "USD")
    return out


async def client_pnl(db, month: str, include_internal: bool = False, floor_pct: int = MARGIN_FLOOR_PCT) -> Dict[str, Any]:
    """Each organisation's month in pounds: what it paid (Stripe purchases), what its usage cost us (the cost ledger, plus an
    estimate for usage not logged per call), and the margin. Worst margin first. Run under the system scope to see every organisation.

    - Paid is cash taken in the month, before VAT and Stripe fees (prices may include VAT: plan 11, decision 4).
    - Recorded cost comes from services/cost_ledger.provider_calls; estimated cost is units x cost per unit (_estimate_unit_costs).
    - Fixed costs (the TPS licence, bought data) are not shared out yet (plan 11, step 5).
    - Flags: below_floor, unpaid_usage (cost but no payment: a trial, free credits or an organisation that is not charged),
      unpriced_calls (provider calls counted as $0), unknown_cost (estimated items with no cost per unit), fx_estimated."""
    from datetime import timedelta

    from app.services import cost_ledger, fx
    from app.services.credits import DEFAULT_RATES, _get_doc

    start, end = month_range(month)
    window = {"s": start, "e": end}
    on = min(end - timedelta(days=1), datetime.utcnow()).date()  # the month's last day, or today for the current month
    to = REPORT_CURRENCY
    names = dict((await db.execute(text("SELECT id, name FROM organizations"))).all())
    fx_estimated = False

    async def gbp(amount: float, cur: str) -> float:
        nonlocal fx_estimated
        value, est = await fx.convert(db, amount, cur, to, on)
        fx_estimated = fx_estimated or est
        return value

    rows: Dict[str, Dict[str, Any]] = {}

    def row(org_id: str) -> Dict[str, Any]:
        return rows.setdefault(org_id, {"orgId": org_id, "name": names.get(org_id, "Platform (no client)" if org_id in ("*", "") else org_id),
                                        "paid": 0.0, "recordedCost": 0.0, "estimatedCost": 0.0, "calls": 0, "unpricedCalls": 0,
                                        "unknownUnits": 0.0, "bySource": {}, "estimatedItems": {}})

    for org_id, cur, cents in (await db.execute(text(
            "SELECT org_id, lower(coalesce(nullif(paid_currency, ''), 'usd')), sum(paid_cents) FROM credit_grants "
            "WHERE paid_cents > 0 AND created_at >= :s AND created_at < :e GROUP BY 1, 2"), window)).all():
        row(org_id)["paid"] += await gbp(float(cents or 0) / 100.0, cur)

    for org_id, c in (await cost_ledger.cost_by_org(db, start, end)).items():
        r = row(org_id)
        r["recordedCost"] += await gbp(c["costUsd"], "USD")
        r["calls"] += c["calls"]
        r["unpricedCalls"] += c["unpricedCalls"]
        r["bySource"] = {k: {"calls": v["calls"], "cost": round(await gbp(v["costUsd"], "USD"), 2)} for k, v in c["bySource"].items()}

    unit = await _estimate_unit_costs(db)
    for org_id, item, qty in (await db.execute(text(
            "SELECT org_id, item, sum(quantity) FROM credit_ledger WHERE kind = 'usage' AND created_at >= :s AND created_at < :e "
            "AND item = ANY(:items) GROUP BY 1, 2"), {**window, "items": list(ESTIMATED_ITEMS)})).all():
        r, qty = row(org_id), float(qty or 0)
        if item in unit:
            cost = await gbp(qty * unit[item][0], unit[item][1])
            r["estimatedCost"] += cost
            r["estimatedItems"][item] = {"label": DEFAULT_RATES.get(item, {}).get("label", item), "units": round(qty, 2), "cost": round(cost, 2)}
        else:
            r["unknownUnits"] += qty
            r["estimatedItems"][item] = {"label": DEFAULT_RATES.get(item, {}).get("label", item), "units": round(qty, 2), "cost": None}

    not_charged = set()  # organisations staff switched charging off for (credits:<org> enforce false)
    for key, data in (await db.execute(text("SELECT id, data FROM app_settings WHERE id LIKE 'credits:%'"))).all():
        doc = data if isinstance(data, dict) else {}
        if isinstance(data, str):
            import json as _json

            try:
                doc = _json.loads(data)
            except ValueError:
                doc = {}
        if doc.get("enforce") is False:
            not_charged.add(key.split(":", 1)[1])
    out, totals = [], {"paid": 0.0, "cost": 0.0}
    for org_id, r in rows.items():
        internal = org_id in INTERNAL_ORGS
        if internal and not include_internal:
            continue
        cost = r["recordedCost"] + r["estimatedCost"]
        margin = r["paid"] - cost
        pct = round(margin / r["paid"] * 100, 1) if r["paid"] > 0 else None
        flags = []
        if pct is not None and pct < floor_pct:
            flags.append("below_floor")
        if r["paid"] <= 0 and cost > 0:
            flags.append("unpaid_usage")
        if r["unpricedCalls"]:
            flags.append("unpriced_calls")
        if r["unknownUnits"]:
            flags.append("unknown_cost")
        out.append({"orgId": org_id, "name": r["name"], "internal": internal, "notCharged": org_id in not_charged,
                    "paid": round(r["paid"], 2), "recordedCost": round(r["recordedCost"], 2), "estimatedCost": round(r["estimatedCost"], 2),
                    "cost": round(cost, 2), "margin": round(margin, 2), "marginPct": pct, "calls": r["calls"],
                    "unpricedCalls": r["unpricedCalls"], "unknownUnits": round(r["unknownUnits"], 2), "flags": flags,
                    "bySource": r["bySource"], "estimatedItems": r["estimatedItems"]})
        totals["paid"] += r["paid"]
        totals["cost"] += cost
    # Worst first: below the floor (lowest margin first), then cost with no payment, then the rest by margin.
    out.sort(key=lambda x: (x["marginPct"] is None and x["cost"] <= 0, x["marginPct"] if x["marginPct"] is not None else -1e9, x["margin"]))
    usd_gbp, fx_day, est = await fx.rate(db, "USD", to, on)
    margin_total = totals["paid"] - totals["cost"]
    return {"month": month, "currency": to, "floorPct": floor_pct, "includeInternal": include_internal,
            "fx": {"usdToGbp": round(usd_gbp, 5), "day": fx_day, "estimated": est or fx_estimated,
                   "source": (await _get_doc(db, fx.RATES_KEY)).get("source") or ""},
            "clients": out,
            "totals": {"paid": round(totals["paid"], 2), "cost": round(totals["cost"], 2), "margin": round(margin_total, 2),
                       "marginPct": round(margin_total / totals["paid"] * 100, 1) if totals["paid"] > 0 else None},
            "notes": ["Paid is before VAT and Stripe fees.", "Fixed costs (TPS licence, bought data) are not shared out yet.",
                      "Tavily, Apollo and number lookups are costed at today's price."]}


async def org_cost_gbp(db, org_id: str, start: datetime, end: datetime) -> float:
    """One organisation's variable cost in [start, end), in pounds: recorded provider calls (cost ledger) plus estimated usage not logged
    per call (ESTIMATED_ITEMS). The fair-use cap reads it (services/plan_rules.py). Run under the system scope."""
    from app.services import fx

    total = 0.0
    try:
        async with db.begin_nested():
            usd = (await db.execute(text("SELECT coalesce(sum(cost_usd), 0) FROM provider_calls WHERE org_id = :o AND at >= :s AND at < :e"),
                                    {"o": org_id, "s": start, "e": end})).scalar()
        total += (await fx.convert(db, float(usd or 0), "USD", REPORT_CURRENCY))[0]
    except Exception:  # no cost ledger view yet: the estimate below still counts
        pass
    unit = await _estimate_unit_costs(db)
    for item, qty in (await db.execute(text(
            "SELECT item, sum(quantity) FROM credit_ledger WHERE org_id = :o AND kind = 'usage' AND created_at >= :s AND created_at < :e "
            "AND item = ANY(:items) GROUP BY 1"), {"o": org_id, "s": start, "e": end, "items": list(ESTIMATED_ITEMS)})).all():
        if item in unit:
            total += (await fx.convert(db, float(qty or 0) * unit[item][0], unit[item][1], REPORT_CURRENCY))[0]
    return total
