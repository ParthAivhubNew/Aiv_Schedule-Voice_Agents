"""A monthly budget per supplier (plan 11, C.2; services/provider_budgets.py)."""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

from app.providers import gateway as G
from app.services import provider_budgets as PB

NOW = datetime.utcnow()


async def _spend(db, provider, usd, at=None, capability="email_finder"):
    from app.core.tenancy import system_scope
    from app.database import engine
    from app.models.models import ProviderCallLog
    from app.services import cost_ledger

    async with engine.begin() as conn:
        await cost_ledger.create_view(conn)
    with system_scope():
        db.add(ProviderCallLog(provider=provider, capability=capability, op="x", for_org="org_a", outcome="found", cost_usd=usd, priced=True,
                               at=at or NOW))
        await db.commit()


@pytest.mark.db
async def test_this_month_s_spend_comes_from_the_cost_ledger(db):
    await _spend(db, "hunter", 30.0)
    await _spend(db, "hunter", 12.5)
    await _spend(db, "hunter", 99.0, at=PB.month_start(NOW) - timedelta(days=2))  # last month
    assert (await PB.spent_this_month(db))["hunter"] == pytest.approx(42.5)


@pytest.mark.db
async def test_staff_hear_at_80_and_100_percent_once_a_month(db, monkeypatch):
    from app.core.tenancy import system_scope

    alerts = []

    async def alert(code, detail, **kw):
        alerts.append((code, detail))

    monkeypatch.setattr("app.services.ai_errors.alert_staff", alert)
    with system_scope():
        await PB.save(db, "hunter", 100, pause=False)
        await db.commit()
    await _spend(db, "hunter", 50)
    assert await PB.check() == []
    await _spend(db, "hunter", 35)
    assert await PB.check() == ["hunter:80"]
    assert await PB.check() == []  # once
    await _spend(db, "hunter", 20)
    assert await PB.check() == ["hunter:100"]
    assert [c for c, _ in alerts] == ["BUD-01", "BUD-01"]
    assert "$105.00 of its $100.00" in alerts[1][1] and "Nothing is paused" in alerts[1][1]
    nxt = PB.month_start(NOW) + timedelta(days=40)  # a new month starts from nothing
    assert await PB.check(now=nxt) == []


@pytest.mark.db
async def test_with_pause_on_the_wrapper_stops_calling_a_supplier_at_its_budget(db):
    from app.core.tenancy import system_scope

    calls = []

    async def ask(client, key):
        calls.append(1)
        return G.Answer({"x": 1}, status=200)

    await _spend(db, "tavily", 10.0, capability="web_search")
    with system_scope():
        await PB.save(db, "tavily", 10, pause=False)
        await db.commit()
    assert (await G.call_provider("tavily", "search", ask, key="k")).outcome == "found"  # over, but only alerts
    with system_scope():
        await PB.save(db, "tavily", 10, pause=True)
        await db.commit()
    res = await G.call_provider("tavily", "search", ask, key="k")
    assert res.outcome == "over_budget" and len(calls) == 1
    with system_scope():
        await PB.save(db, "tavily", 50, pause=True)  # raised: calls go out again
        await db.commit()
    assert (await G.call_provider("tavily", "search", ask, key="k")).outcome == "found"


async def test_nothing_is_paused_when_the_budgets_cannot_be_read(monkeypatch):
    async def broken():
        raise RuntimeError("database away")

    monkeypatch.setattr(PB, "_state", broken)
    assert await PB.paused("tavily") is False


@pytest.mark.db
async def test_staff_see_every_supplier_s_month_and_only_admins_set_budgets(db, staff):
    await _spend(db, "openai", 4.2, capability="llm")  # an AI model: alerts only, it doesn't go through the wrapper
    r = await staff.put("/api/admin-api/provider-budgets/hunter", json={"usd": 25, "pause": True})
    assert r.status_code == 200 and r.json()["budget"] == {"usd": 25.0, "pause": True}
    rows = {p["id"]: p for p in (await staff.get("/api/admin-api/provider-budgets")).json()["providers"]}
    assert rows["hunter"]["budgetUsd"] == 25.0 and rows["hunter"]["pause"] is True and rows["hunter"]["state"] == "ok"
    assert rows["openai"]["spentUsd"] == 4.2 and rows["openai"]["throughWrapper"] is False
    assert (await staff.put("/api/admin-api/provider-budgets/hunter", json={"usd": -5})).status_code == 400
    assert (await staff.put("/api/admin-api/provider-budgets/hunter", json={"usd": 0})).json()["budget"] == {}  # removed
