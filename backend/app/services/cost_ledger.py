"""One ledger of what paid providers cost us (plan 11, step 3).

The view provider_calls puts every per-call log the app keeps into one shape, so "what did provider X cost us for client Y this month"
is one query:

  source         table                cost
  ai             ai_usage             cost_usd stored at call time (LLM, image, video)
  email_finder   enrichment_attempts  cost_usd stored at call time (cached answers are left out)
  web_search     tavily_calls         Tavily credits used x the "tavily" lookup price
  company_data   apollo_calls         the "apollo" lookup price, for a found result (or every search, when its billing says so)
  number_lookup  number_checks        the "telnyx_lookup" lookup price per number checked
  <capability>   provider_call_log    cost_usd stored at call time by the provider wrapper (providers/gateway.py); model holds the op

Columns: source, ref, at, org_id, provider, model, capability, feature, route, units, cost_usd, priced, hit.
- Tavily, Apollo and number lookups are costed at today's price; the other two sources keep the price of the day they ran.
- priced is false when the provider has no price yet, so the cost shown is $0 (see ai_pricing.unpriced_in_use).
- Call minutes, numbers, WhatsApp and TPS screening aren't logged per call. Their cost is estimated from usage in the client
  report (services/revenue.client_pnl). Google Places was too, until it moved onto the wrapper: usage from before its first logged
  call is still estimated (revenue.LOGGED_BY_WRAPPER).
- The view runs with the rights of whoever reads it (security_invoker), so a company's own session sees only its own rows,
  just as with the tables underneath. Staff reports read it under the system scope.

Providers moved onto the wrapper write provider_call_log (plan 11, Part A), and readers of this view don't change. Tavily keeps its
own tavily_calls rows (they say which key was used) and number checks keep their results, but from a provider's first wrapper row on,
its cost is read from provider_call_log only, so nothing is counted twice. The e-mail finders and Apollo are not moved yet.

A migration that changes a column type in one of these tables must first run DROP VIEW IF EXISTS provider_calls. The view is
remade at the next start-up.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import text

VIEW_SQL = """
CREATE OR REPLACE VIEW provider_calls WITH (security_invoker = true) AS
SELECT 'ai'::varchar AS source, u.id::varchar AS ref, u.created_at AS at, coalesce(u.org_id, '')::varchar AS org_id,
       coalesce(u.provider, '')::varchar AS provider, coalesce(u.model, '')::varchar AS model, coalesce(u.kind, '')::varchar AS capability,
       coalesce(u.plugin, '')::varchar AS feature, ''::varchar AS route, 1::float AS units, coalesce(u.cost_usd, 0)::float AS cost_usd,
       coalesce(u.priced, false) AS priced, true AS hit
  FROM ai_usage u
UNION ALL
SELECT 'email_finder', e.id::varchar, e.created_at, coalesce(e.org_id, '')::varchar, coalesce(e.provider, '')::varchar, '', 'email_finder',
       'leadgen', '', 1::float, coalesce(e.cost_usd, 0)::float,
       (coalesce(p.confirmed, false) OR coalesce(p.price_in_usd, 0) > 0), coalesce(e.found_email, '') <> ''
  FROM enrichment_attempts e
  LEFT JOIN provider_prices p ON p.provider = e.provider AND p.kind = 'lookup' AND coalesce(p.model, '') = ''
 WHERE coalesce(e.provider, '') NOT IN ('cache', 'miss_cache')
UNION ALL
SELECT 'web_search', t.id::varchar, t.at, coalesce(t.for_org, '')::varchar, 'tavily', '', 'web_search', coalesce(t.purpose, '')::varchar,
       coalesce(t.route, '')::varchar, coalesce(t.credits, 0)::float, (coalesce(t.credits, 0) * coalesce(p.price_in_usd, 0))::float,
       (coalesce(p.confirmed, false) OR coalesce(p.price_in_usd, 0) > 0), coalesce(t.outcome, '') = 'found'
  FROM tavily_calls t
  LEFT JOIN provider_prices p ON p.provider = 'tavily' AND p.kind = 'lookup' AND coalesce(p.model, '') = ''
 WHERE t.at < coalesce((SELECT min(at) FROM provider_call_log WHERE provider = 'tavily'), 'infinity'::timestamp)
UNION ALL
SELECT 'company_data', a.id::varchar, a.at, coalesce(a.for_org, '')::varchar, 'apollo', '', 'company_data', coalesce(a.purpose, '')::varchar,
       coalesce(a.route, '')::varchar, 1::float,
       (CASE WHEN coalesce(a.outcome, '') = 'found'
                  OR (coalesce(p.billing, 'per_find') = 'per_search' AND coalesce(a.outcome, '') NOT IN ('rate_limited', 'refused', 'key_exhausted'))
             THEN coalesce(p.price_in_usd, 0) ELSE 0 END)::float,
       (coalesce(p.confirmed, false) OR coalesce(p.price_in_usd, 0) > 0), coalesce(a.outcome, '') = 'found'
  FROM apollo_calls a
  LEFT JOIN provider_prices p ON p.provider = 'apollo' AND p.kind = 'lookup' AND coalesce(p.model, '') = ''
UNION ALL
SELECT 'number_lookup', n.id::varchar, n.checked_at, coalesce(n.org_id, '')::varchar, 'telnyx_lookup', '', 'number_lookup', 'voice', '',
       1::float, coalesce(p.price_in_usd, 0)::float, (coalesce(p.confirmed, false) OR coalesce(p.price_in_usd, 0) > 0), true
  FROM number_checks n
  LEFT JOIN provider_prices p ON p.provider = 'telnyx_lookup' AND p.kind = 'lookup' AND coalesce(p.model, '') = ''
 WHERE n.checked_at < coalesce((SELECT min(at) FROM provider_call_log WHERE provider = 'telnyx_lookup'), 'infinity'::timestamp)
UNION ALL
SELECT coalesce(nullif(g.capability, ''), 'other')::varchar, g.id::varchar, g.at, coalesce(g.for_org, '')::varchar, coalesce(g.provider, '')::varchar,
       coalesce(g.op, '')::varchar, coalesce(g.capability, '')::varchar, coalesce(g.feature, '')::varchar, coalesce(g.route, '')::varchar,
       coalesce(g.units, 0)::float, coalesce(g.cost_usd, 0)::float, coalesce(g.priced, false), coalesce(g.outcome, '') = 'found'
  FROM provider_call_log g
"""


async def create_view(conn) -> None:
    """Creates or replaces the view and lets the app's database role read it (row-level security still applies, see above).
    Called at every start-up and by the tests (create_all makes tables, not views)."""
    from app.core.tenancy import APP_ROLE

    await conn.execute(text(VIEW_SQL))
    await conn.execute(text(f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN "
                            f"GRANT SELECT ON provider_calls TO {APP_ROLE}; END IF; END $$;"))


async def cost_by_org(db, start: datetime, end: datetime) -> Dict[str, Dict[str, Any]]:
    """{org_id: {costUsd, calls, unpricedCalls, bySource: {source: {calls, costUsd}}}} for calls in [start, end).
    Read it under the system scope to see every organisation."""
    rows = (await db.execute(text(
        "SELECT org_id, source, count(*), sum(cost_usd), sum(CASE WHEN priced THEN 0 ELSE 1 END) FROM provider_calls "
        "WHERE at >= :s AND at < :e GROUP BY 1, 2"), {"s": start, "e": end})).all()
    out: Dict[str, Dict[str, Any]] = {}
    for org_id, source, calls, cost, unpriced in rows:
        o = out.setdefault(org_id or "", {"costUsd": 0.0, "calls": 0, "unpricedCalls": 0, "bySource": {}})
        o["costUsd"] += float(cost or 0)
        o["calls"] += int(calls or 0)
        o["unpricedCalls"] += int(unpriced or 0)
        o["bySource"][source] = {"calls": int(calls or 0), "costUsd": round(float(cost or 0), 4)}
    for o in out.values():
        o["costUsd"] = round(o["costUsd"], 4)
    return out


async def cost_by_provider(db, start: datetime, end: datetime, org_id: Optional[str] = None) -> list:
    """[{provider, model, source, calls, costUsd, unpricedCalls}] for the period, most expensive first; one organisation when given."""
    where, params = "at >= :s AND at < :e", {"s": start, "e": end}
    if org_id is not None:
        where += " AND org_id = :o"
        params["o"] = org_id
    rows = (await db.execute(text(
        f"SELECT provider, model, source, count(*), sum(cost_usd), sum(CASE WHEN priced THEN 0 ELSE 1 END) FROM provider_calls "
        f"WHERE {where} GROUP BY 1, 2, 3 ORDER BY 5 DESC NULLS LAST"), params)).all()
    return [{"provider": p, "model": m, "source": s, "calls": int(n or 0), "costUsd": round(float(c or 0), 4), "unpricedCalls": int(u or 0)}
            for p, m, s, n, c, u in rows]
