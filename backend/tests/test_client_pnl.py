"""Plan 11, step 3: one cost ledger over every provider log, daily exchange rates, and profit and loss per client in pounds."""
from datetime import datetime

import pytest
from sqlalchemy import text

from app.services import fx

ECB = """<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><Cube><Cube time='2026-11-24'>
<Cube currency='USD' rate='1.1000'/><Cube currency='JPY' rate='170.1'/><Cube currency='GBP' rate='0.8800'/></Cube></Cube></gesmes:Envelope>"""


# ---- exchange rates ---------------------------------------------------------------------------------------
def test_the_ecb_file_is_read():
    day, rates = fx.parse_ecb(ECB)
    assert day == "2026-11-24" and rates["USD"] == 1.1 and rates["GBP"] == 0.88 and rates["EUR"] == 1.0
    with pytest.raises(ValueError):
        fx.parse_ecb("<html>maintenance</html>")


@pytest.mark.db
async def test_a_rate_is_the_day_s_or_the_closest_earlier_one_and_says_when_it_is_only_estimated(db):
    from app.services.credits import _put_doc

    r, day, est = await fx.rate(db, "USD", "GBP")
    assert est is True and day == "" and round(r, 3) == round(0.85 / 1.08, 3)  # nothing read yet: the fallback, marked estimated
    await _put_doc(db, fx.RATES_KEY, {"days": {"2026-11-20": {"EUR": 1.0, "USD": 1.10, "GBP": 0.88},
                                               "2026-11-24": {"EUR": 1.0, "USD": 1.00, "GBP": 0.90}}})
    await db.commit()
    from datetime import date

    assert await fx.rate(db, "USD", "GBP", date(2026, 11, 22)) == (pytest.approx(0.8), "2026-11-20", False)
    assert await fx.rate(db, "USD", "GBP", date(2026, 11, 30)) == (pytest.approx(0.9), "2026-11-24", False)
    assert await fx.rate(db, "USD", "GBP", date(2026, 1, 1)) == (pytest.approx(0.8), "2026-11-20", False)  # before every day: the first
    assert await fx.rate(db, "GBP", "GBP") == (1.0, date.today().isoformat(), False)


@pytest.mark.db
async def test_refresh_stores_the_day_and_a_failure_keeps_what_was_there(db, monkeypatch):
    import httpx

    from app.services.credits import _get_doc

    def handler(request):
        return httpx.Response(200, text=ECB)

    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    assert await fx.refresh(db) == "2026-11-24"
    assert (await _get_doc(db, fx.RATES_KEY))["days"]["2026-11-24"] == {"EUR": 1.0, "USD": 1.1, "GBP": 0.88}
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(lambda r: httpx.Response(503)), **kw))
    assert await fx.refresh(db) is None
    assert "2026-11-24" in (await _get_doc(db, fx.RATES_KEY))["days"]


# ---- the ledger and the client report ------------------------------------------------------------------------
async def _seed(db):
    """org_a pays £50 and uses AI, an e-mail finder, web search, number lookups, call minutes and a number; org_b pays nothing but
    uses AI and an unpriced Apollo search; the platform's own account (org_default) does internal web searches."""
    from app.core.tenancy import org_scope, system_scope
    from app.database import engine
    from app.models.models import AiUsage, ApolloCall, ProviderPrice, TavilyCall
    from app.services import cost_ledger
    from app.services.credits import _put_doc

    async with engine.begin() as conn:
        await cost_ledger.create_view(conn)
    when = datetime(2026, 11, 10, 12)
    for org in ("org_a", "org_b"):
        await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES (:o, :n, :o, 'active')"), {"o": org, "n": org.upper()})
    db.add_all([ProviderPrice(id="pp_t", provider="tavily", model="", kind="lookup", price_in_usd=0.008, confirmed=True),
                ProviderPrice(id="pp_n", provider="telnyx_lookup", model="", kind="lookup", price_in_usd=0.003, confirmed=True),
                ProviderPrice(id="pp_h", provider="hunter", model="", kind="lookup", price_in_usd=0.5, confirmed=True),
                AiUsage(id="a1", org_id="org_a", plugin="leadgen", kind="llm", provider="openai", model="m", cost_usd=1.0, priced=True, created_at=when),
                AiUsage(id="b1", org_id="org_b", plugin="leadgen", kind="llm", provider="openai", model="m", cost_usd=0.25, priced=True, created_at=when),
                AiUsage(id="old", org_id="org_a", plugin="leadgen", kind="llm", provider="openai", model="m", cost_usd=99.0, priced=True,
                        created_at=datetime(2026, 10, 30)),  # another month
                TavilyCall(id="t1", for_org="org_a", purpose="search", outcome="found", credits=10, at=when),
                TavilyCall(id="t2", for_org="org_default", purpose="search", outcome="found", credits=1000, at=when),
                ApolloCall(id="ap1", for_org="org_b", purpose="company_by_name", outcome="found", at=when)])
    await db.commit()
    await _put_doc(db, "fx_rates", {"days": {"2026-11-01": {"EUR": 1.0, "USD": 1.10, "GBP": 0.88}}, "source": "ECB"})  # $1 = 80p
    await _put_doc(db, "unit_costs", {"currency": "gbp", "costs": {"voice_minute": 5}})  # 5p a minute, set by staff
    await _put_doc(db, "credits:org_b", {"enforce": False})
    await db.commit()
    with org_scope("org_a"):
        await db.execute(text("INSERT INTO credit_grants (org_id, id, wallet, source, amount, remaining, paid_cents, paid_currency, created_at) "
                              "VALUES ('org_a', 'g1', 'leadgen', 'stripe', 250, 250, 5000, 'gbp', :w)"), {"w": when})
        await db.execute(text("INSERT INTO enrichment_attempts (org_id, id, query, provider, found_email, cost_usd, latency_ms, hit, created_at) "
                              "VALUES ('org_a', 'e1', 'q', 'hunter', 'x@y.com', 0.5, 1, TRUE, :w), "
                              "('org_a', 'e2', 'q', 'cache', 'x@y.com', 0, 1, TRUE, :w)"), {"w": when})
        await db.execute(text("INSERT INTO number_checks (org_id, id, phone, status, checked_at) VALUES ('org_a', 'n1', '+44', 'good', :w), "
                              "('org_a', 'n2', '+44', 'good', :w)"), {"w": when})
        await db.execute(text("INSERT INTO credit_ledger (org_id, id, kind, wallet, item, quantity, amount, created_at) VALUES "
                              "('org_a', 'l1', 'usage', 'voice', 'voice_minute', 10, -10, :w), "
                              "('org_a', 'l2', 'usage', 'voice', 'phone_number_month', 1, -15, :w), "
                              "('org_a', 'l3', 'usage', 'leadgen', 'lead_lookup', 3, -15, :w)"), {"w": when})  # in the ledger already: not estimated
        await db.commit()
    return system_scope


@pytest.mark.db
async def test_the_ledger_holds_every_provider_call_once_with_its_cost(db):
    from app.services import cost_ledger

    system_scope = await _seed(db)
    with system_scope():
        by = await cost_ledger.cost_by_org(db, datetime(2026, 11, 1), datetime(2026, 12, 1))
    a = by["org_a"]
    assert a["calls"] == 5 and a["costUsd"] == pytest.approx(1.0 + 0.5 + 10 * 0.008 + 2 * 0.003)  # AI, finder (cache left out), search, 2 lookups
    assert set(a["bySource"]) == {"ai", "email_finder", "web_search", "number_lookup"}
    assert by["org_b"]["unpricedCalls"] == 1 and by["org_b"]["bySource"]["company_data"]["costUsd"] == 0  # Apollo has no price yet
    assert by["org_default"]["costUsd"] == pytest.approx(8.0)


@pytest.mark.db
async def test_a_company_session_sees_only_its_own_ledger_rows(db):
    from app.core.tenancy import org_scope

    await _seed(db)
    with org_scope("org_b"):
        rows = (await db.execute(text("SELECT DISTINCT source FROM provider_calls WHERE org_id = 'org_a'"))).scalars().all()
        await db.rollback()
    assert "email_finder" not in rows and "number_lookup" not in rows  # org_a's scoped rows stay hidden from org_b


@pytest.mark.db
async def test_profit_per_client_in_pounds_worst_first_with_flags(db):
    from app.services import revenue as R

    system_scope = await _seed(db)
    with system_scope():
        out = await R.client_pnl(db, "2026-11")
    assert out["currency"] == "GBP" and out["fx"]["usdToGbp"] == pytest.approx(0.8) and out["fx"]["estimated"] is False
    rows = {r["orgId"]: r for r in out["clients"]}
    assert set(rows) == {"org_a", "org_b"}  # the platform's own account is left out by default
    a = rows["org_a"]
    recorded = (1.0 + 0.5 + 0.08 + 0.006) * 0.8
    estimated = 10 * 0.05 + 1.00 * 0.8  # call minutes at staff's 5p, a number at Telnyx's $1
    assert a["paid"] == 50.0 and a["recordedCost"] == pytest.approx(recorded, abs=0.01) and a["estimatedCost"] == pytest.approx(estimated, abs=0.01)
    assert a["marginPct"] == pytest.approx(round((50 - recorded - estimated) / 50 * 100, 1)) and a["flags"] == []
    assert "lead_lookup" not in a["estimatedItems"]  # its vendors are in the ledger: never counted twice
    b = rows["org_b"]
    assert b["paid"] == 0 and b["marginPct"] is None and b["notCharged"] is True
    assert set(b["flags"]) == {"unpaid_usage", "unpriced_calls"}
    assert out["clients"][0]["orgId"] == "org_b"  # cost with no payment comes first
    with system_scope():
        internal = await R.client_pnl(db, "2026-11", include_internal=True)
    assert {r["orgId"] for r in internal["clients"]} >= {"org_default"}


@pytest.mark.db
async def test_a_client_under_the_floor_is_flagged(db):
    from app.services import revenue as R

    system_scope = await _seed(db)
    with system_scope():
        out = await R.client_pnl(db, "2026-11", floor_pct=99)
    assert "below_floor" in {r["orgId"]: r for r in out["clients"]}["org_a"]["flags"]


@pytest.mark.db
async def test_only_staff_see_the_client_report(db, staff, anon):
    await _seed(db)
    got = await staff.get("/api/admin-api/revenue/clients", params={"month": "2026-11"})
    assert got.status_code == 200, got.text
    assert {r["orgId"] for r in got.json()["clients"]} == {"org_a", "org_b"}
    assert (await staff.get("/api/admin-api/revenue/clients", params={"month": "nope"})).status_code == 400
    assert (await anon.get("/api/admin-api/revenue/clients")).status_code in (401, 403)
