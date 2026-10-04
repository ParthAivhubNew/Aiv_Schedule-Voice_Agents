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
    from app.services.credits import _get_doc
    from app.services.enrichment_waterfall import COST_USD, LABELS, OTHER_VENDOR_COST_USD, OTHER_VENDOR_LABELS

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
        providers.append({"provider": provider, "label": label, "calls": calls,
                           "costUsd": round(calls * OTHER_VENDOR_COST_USD[provider], 2), "exact": False})
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
