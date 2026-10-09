"""Owner-portal report: how well each email-finder provider is doing, and what a good email costs.

Built only from what is already recorded: every provider call (enrichment_attempts) and every
address a provider supplied (person_cache.source), checked against the hard bounces the inboxes
have seen (email_suppressions). A "good" email is one a provider called verified that did not
bounce. The suggested order puts the cheapest cost per good email first; it is a suggestion only --
staff choose the order that is used (saved under ORDER_KEY).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from sqlalchemy import text

from app.services.enrichment_waterfall import LABELS, ORDER_KEY, PROVIDERS, finder_order


async def report(db, days: int = 7) -> Dict[str, Any]:
    days = days if days in (7, 30, 90) else 7
    since = datetime.utcnow() - timedelta(days=days)
    calls = {r[0]: r for r in (await db.execute(text(
        "SELECT provider, count(*), count(*) FILTER (WHERE hit), coalesce(sum(cost_usd), 0), "
        "coalesce(avg(latency_ms), 0) FROM enrichment_attempts WHERE created_at >= :s GROUP BY 1"), {"s": since})).all()}
    supplied = dict((await db.execute(text(
        "SELECT source, count(DISTINCT lower(email)) FROM person_cache "
        "WHERE verified_at >= :s AND email <> '' AND source <> '' GROUP BY 1"), {"s": since})).all())
    bounced = dict((await db.execute(text(
        "SELECT pc.source, count(DISTINCT lower(pc.email)) FROM person_cache pc "
        "JOIN email_suppressions s ON lower(s.email) = lower(pc.email) AND s.reason = 'hard_bounce' "
        "WHERE pc.verified_at >= :s AND pc.source <> '' GROUP BY 1"), {"s": since})).all())

    rows: List[Dict[str, Any]] = []
    for provider in PROVIDERS:
        c = calls.get(provider)
        lookups, verified, spend, latency = (int(c[1]), int(c[2]), float(c[3]), int(c[4])) if c else (0, 0, 0.0, 0)
        bad = int(bounced.get(provider, 0))
        good = max(verified - bad, 0)
        rows.append({
            "provider": provider, "label": LABELS[provider], "lookups": lookups, "verified": verified,
            "hitRate": round(verified / lookups, 3) if lookups else None, "spendUsd": round(spend, 2),
            "bounced": bad, "bounceRate": round(bad / int(supplied.get(provider, 0) or 1), 3) if supplied.get(provider) else None,
            "costPerGoodUsd": round(spend / good, 3) if good else None, "avgLatencyMs": latency,
        })

    measured = sorted((r for r in rows if r["costPerGoodUsd"] is not None), key=lambda r: r["costPerGoodUsd"])
    current = await finder_order()
    suggested = [r["provider"] for r in measured] + [p for p in current if p not in {r["provider"] for r in measured}]
    saved = {r[0]: int(r[1]) for r in (await db.execute(text(
        "SELECT provider, count(*) FROM enrichment_attempts WHERE created_at >= :s AND provider IN ('cache', 'miss_cache') GROUP BY 1"),
        {"s": since})).all()}
    return {"days": days, "providers": rows, "currentOrder": current, "suggestedOrder": suggested,
            "enoughData": len(measured) >= 2, "answeredFromCache": saved.get("cache", 0), "repeatMissesSkipped": saved.get("miss_cache", 0)}


async def save_order(db, order: List[str]) -> List[str]:
    from app.models.models import AppSetting

    clean = [p for p in dict.fromkeys(order or []) if p in PROVIDERS]
    if not clean:
        raise ValueError("Choose at least one provider.")
    row = await db.get(AppSetting, ORDER_KEY)
    if row:
        row.data = {"order": clean}
    else:
        db.add(AppSetting(id=ORDER_KEY, data={"order": clean}))
    return clean + [p for p in PROVIDERS if p not in clean]
