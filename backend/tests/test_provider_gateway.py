"""The provider wrapper (plan 11, Part A; providers/gateway.py): plan, shared cache, cost cap, circuit breaker, key, one log row."""
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import text

from app.providers import gateway as G
from app.providers import registry
from app.providers.base import Licence, Manifest, Pricing, Provider, ProviderError


class FakeProvider(Provider):
    def __init__(self, pid="fake_data", share=True, cache_days=30, billing="per_find", key="k-123"):
        self.manifest = Manifest(id=pid, name="Fake data", category="company_data", capabilities=("company_data",),
                                 pricing=Pricing(usd=0.02, unit="call", billing=billing),
                                 licence=Licence(cache_days=cache_days, share_across_clients=share), credit_item="lead_lookup")
        self._key = key

    async def saved_key(self):
        return self._key


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    G.reset_breakers()
    yield
    G.reset_breakers()


@pytest.fixture
def fake(monkeypatch):
    """A fake provider in the registry, with nothing else in the way (no plan rules, no cost cap)."""
    providers = {}

    def add(**kw):
        p = FakeProvider(**kw)
        providers[p.manifest.id] = p
        return p

    real_get = registry.get
    monkeypatch.setattr(registry, "get", lambda pid: providers.get(pid) or real_get(pid))
    return add


def asker(*answers):
    """An ask() that returns the given Answers (or raises the given exceptions) in turn, and counts its calls."""
    calls = []

    async def ask(client, key):
        calls.append(key)
        a = answers[min(len(calls), len(answers)) - 1]
        if isinstance(a, Exception):
            raise a
        return a

    ask.calls = calls
    return ask


async def _logged(db, pid):
    return (await db.execute(text("SELECT op, feature, outcome, status, cost_usd, priced, for_org FROM provider_call_log "
                                  "WHERE provider = :p ORDER BY at"), {"p": pid})).all()


# ── Refusals before any call ────────────────────────────────────────────────
async def test_an_unknown_provider_is_refused():
    assert (await G.call_provider("no_such_thing", "x", asker(G.Answer(1)))).outcome == "unknown_provider"


async def test_the_plan_and_the_cost_cap_are_checked_before_the_call(fake, monkeypatch):
    fake()
    ask = asker(G.Answer({"x": 1}))
    monkeypatch.setattr("app.services.plan_rules.provider_allowed", lambda pid, org_id=None: _value(False))
    assert (await G.call_provider("fake_data", "lookup", ask)).outcome == "not_in_plan"
    monkeypatch.setattr("app.services.plan_rules.provider_allowed", lambda pid, org_id=None: _value(True))
    monkeypatch.setattr("app.services.plan_rules.cap_refusal", lambda items, org_id=None: _value("USR-08: cap"))
    assert (await G.call_provider("fake_data", "lookup", ask)).outcome == "cap_reached"
    assert ask.calls == []


async def test_no_key_means_no_call(fake):
    fake(key="")
    ask = asker(G.Answer({"x": 1}))
    res = await G.call_provider("fake_data", "lookup", ask)
    assert res.outcome == "no_key" and res.data is None and ask.calls == []


async def _value(v):
    return v


# ── The call and its log row ────────────────────────────────────────────────
@pytest.mark.db
async def test_each_call_is_logged_with_its_cost_at_today_s_price(db, fake):
    from app.core.tenancy import org_scope
    from app.models.models import ProviderPrice

    fake()
    fake(pid="fake_search", billing="per_search")
    db.add_all([ProviderPrice(id="pp_f", provider="fake_data", model="", kind="lookup", price_in_usd=0.5, billing="per_find", confirmed=True),
                ProviderPrice(id="pp_s", provider="fake_search", model="", kind="lookup", price_in_usd=0.1, billing="per_search", confirmed=True)])
    await db.commit()
    with org_scope("org_a"):
        found = await G.call_provider("fake_data", "lookup", asker(G.Answer({"phone": "1"}, status=200)), feature="test", looked_for="Acme")
        none = await G.call_provider("fake_data", "lookup", asker(G.Answer(None, outcome="none", status=200)))
        searched = await G.call_provider("fake_search", "lookup", asker(G.Answer(None, outcome="none", status=200)))
    assert found.ok and found.data == {"phone": "1"} and found.cost_usd == 0.5
    assert none.outcome == "none" and none.cost_usd == 0  # a per-find provider charges only for a find
    assert searched.cost_usd == pytest.approx(0.1)  # a per-search provider charges every time
    rows = await _logged(db, "fake_data")
    assert [(r.op, r.outcome, r.status, r.cost_usd, r.priced, r.for_org) for r in rows] == [
        ("lookup", "found", 200, 0.5, True, "org_a"), ("lookup", "none", 200, 0.0, True, "org_a")]
    assert rows[0].feature == "test"


@pytest.mark.db
async def test_an_unpriced_provider_costs_nothing_and_says_so(db, fake):
    fake(pid="fake_new")
    await G.call_provider("fake_new", "lookup", asker(G.Answer({"x": 1}, status=200)))
    (row,) = await _logged(db, "fake_new")
    assert row.cost_usd == 0 and row.priced is False


@pytest.mark.db
async def test_the_cost_ledger_view_includes_the_wrapper_s_calls(db, fake):
    from app.core.tenancy import org_scope, system_scope
    from app.database import engine
    from app.models.models import ProviderPrice
    from app.services import cost_ledger

    async with engine.begin() as conn:
        await cost_ledger.create_view(conn)
    fake(billing="per_search")
    db.add(ProviderPrice(id="pp_v", provider="fake_data", model="", kind="lookup", price_in_usd=0.04, billing="per_search", confirmed=True))
    await db.commit()
    with org_scope("org_v"):
        await G.call_provider("fake_data", "place_details", asker(G.Answer({"x": 1}, status=200)))
    with system_scope():
        by = await cost_ledger.cost_by_provider(db, datetime.utcnow() - timedelta(hours=1), datetime.utcnow() + timedelta(hours=1), "org_v")
    assert by == [{"provider": "fake_data", "model": "place_details", "source": "company_data", "calls": 1, "costUsd": 0.04, "unpricedCalls": 0}]


# ── Circuit breaker ─────────────────────────────────────────────────────────
@pytest.mark.db
async def test_five_failures_in_a_row_pause_the_provider_and_staff_hear_once(db, fake, monkeypatch):
    fake()
    alerts = []

    async def alert(code, detail, **kw):
        alerts.append(code)

    monkeypatch.setattr("app.services.ai_errors.alert_staff", alert)
    now = [1_000_000.0]
    monkeypatch.setattr(G, "_clock", lambda: now[0])
    failing = asker(G.Answer(outcome="error", status=503))
    for _ in range(G.BREAK_AFTER):
        assert (await G.call_provider("fake_data", "lookup", failing)).outcome == "error"
    assert alerts == ["PRV-01"]
    assert (await G.call_provider("fake_data", "lookup", failing)).outcome == "paused"
    assert len(failing.calls) == G.BREAK_AFTER  # paused: the vendor wasn't asked
    assert G.breakers()["fake_data"]["paused"] is True

    now[0] += G.PAUSE_FIRST_S + 1  # the pause is over: the next call tests whether it is back
    working = asker(G.Answer({"x": 1}, status=200))
    assert (await G.call_provider("fake_data", "lookup", working)).ok
    assert "fake_data" not in G.breakers()  # one success clears it


@pytest.mark.db
async def test_each_pause_is_twice_as_long_up_to_fifteen_minutes(db, fake, monkeypatch):
    fake()
    monkeypatch.setattr("app.services.ai_errors.alert_staff", lambda *a, **k: _value(None))
    now = [1_000_000.0]
    monkeypatch.setattr(G, "_clock", lambda: now[0])
    failing = asker(ProviderError("key rejected"))
    pauses = []
    for _ in range(6):
        for _ in range(G.BREAK_AFTER):
            await G.call_provider("fake_data", "lookup", failing)
        state = G.breakers()["fake_data"]
        assert state["lastError"] == "key rejected"
        pauses.append(state["pausedFor"])
        now[0] += pauses[-1] + 1
    assert pauses == [60, 120, 240, 480, 900, 900]


@pytest.mark.db
async def test_a_bug_or_a_dropped_connection_never_reaches_the_caller(db, fake):
    fake()
    assert (await G.call_provider("fake_data", "lookup", asker(KeyError("oops")))).outcome == "error"
    assert (await G.call_provider("fake_data", "lookup", asker(httpx.ConnectTimeout("slow")))).outcome == "error"
    rows = await _logged(db, "fake_data")
    assert [(r.outcome, r.status, r.cost_usd) for r in rows] == [("error", None, 0.0), ("error", None, 0.0)]


# ── Shared cache ────────────────────────────────────────────────────────────
@pytest.mark.db
async def test_a_shareable_answer_is_bought_once_for_every_client(db, fake):
    from app.core.tenancy import org_scope

    fake(share=True)
    ask = asker(G.Answer({"site": "acme.co.uk"}, status=200))
    with org_scope("org_a"):
        first = await G.call_provider("fake_data", "website", ask, cache_key="acme ltd")
    with org_scope("org_b"):
        again = await G.call_provider("fake_data", "website", ask, cache_key="acme ltd")
    assert first.outcome == "found" and again.outcome == "cached" and again.data == {"site": "acme.co.uk"} and again.cost_usd == 0
    assert len(ask.calls) == 1


@pytest.mark.db
async def test_an_answer_the_licence_keeps_to_one_client_is_not_shared(db, fake):
    from app.core.tenancy import org_scope

    fake(share=False)
    ask = asker(G.Answer({"site": "acme.co.uk"}, status=200))
    with org_scope("org_a"):
        await G.call_provider("fake_data", "website", ask, cache_key="acme ltd")
        assert (await G.call_provider("fake_data", "website", ask, cache_key="acme ltd")).outcome == "cached"
    with org_scope("org_b"):
        assert (await G.call_provider("fake_data", "website", ask, cache_key="acme ltd")).outcome == "found"
    assert len(ask.calls) == 2


@pytest.mark.db
async def test_no_cache_without_a_cache_key_or_licence_days_and_nothing_found_is_kept_a_week(db, fake):
    fake(pid="fake_nocache", cache_days=0)
    ask = asker(G.Answer({"x": 1}, status=200))
    await G.call_provider("fake_nocache", "x", ask, cache_key="k")
    await G.call_provider("fake_nocache", "x", ask, cache_key="k")
    fake()
    await G.call_provider("fake_data", "x", ask)
    await G.call_provider("fake_data", "x", ask)
    assert len(ask.calls) == 4
    await G.call_provider("fake_data", "x", asker(G.Answer(None, outcome="none", status=200)), cache_key="nobody")
    (days,) = (await db.execute(text("SELECT expires_at - created_at FROM provider_cache WHERE provider = 'fake_data'"))).one()
    assert days == timedelta(days=G.NONE_CACHE_DAYS)


@pytest.mark.db
async def test_the_plan_still_applies_to_a_cached_answer(db, fake, monkeypatch):
    fake()
    ask = asker(G.Answer({"x": 1}, status=200))
    await G.call_provider("fake_data", "x", ask, cache_key="k")
    monkeypatch.setattr("app.services.plan_rules.provider_allowed", lambda pid, org_id=None: _value(False))
    assert (await G.call_provider("fake_data", "x", ask, cache_key="k")).outcome == "not_in_plan"


# ── Google Places, the first provider on the wrapper ────────────────────────
@pytest.mark.db
async def test_google_places_goes_through_the_wrapper_and_is_never_cached(db, monkeypatch):
    from app.services import enrichment_service as E

    async def key():
        return "g-key"

    monkeypatch.setattr(E, "google_places_key", key)
    monkeypatch.setattr(E, "_source_allowed", lambda source: _value(True))
    seen = []

    def handler(request):
        seen.append(request.url.path)
        if request.url.path.endswith(":searchText"):
            return httpx.Response(200, json={"places": [{"id": "p1", "displayName": {"text": "Acme Ltd"}, "formattedAddress": "1 High St, BN1 1AA"}]})
        return httpx.Response(200, json={"displayName": {"text": "Acme Ltd"}, "internationalPhoneNumber": "+44 1273 000000"})

    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    for _ in range(2):
        assert (await E.search_google_places("Acme Ltd", name="Acme Ltd", postcode="BN1 1AA"))["place_id"] == "p1"
        assert (await E.google_place_details("ChIJabc123"))["phone"] == "+44 1273 000000"
    assert len(seen) == 4  # asked every time: Google's terms don't allow keeping its answers
    rows = await _logged(db, "google_places")
    assert [(r.op, r.feature, r.outcome) for r in rows] == [("text_search", "deep_search", "found"), ("place_details", "google_view", "found")] * 2


@pytest.mark.db
async def test_a_refused_google_key_counts_towards_the_breaker_but_a_bad_query_does_not(db, monkeypatch):
    from app.services import enrichment_service as E

    async def key():
        return "g-key"

    monkeypatch.setattr(E, "google_places_key", key)
    monkeypatch.setattr(E, "_source_allowed", lambda source: _value(True))
    status = [400]
    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(lambda r: httpx.Response(status[0], text="no")), **kw))
    assert await E.search_google_places("??") is None
    assert "google_places" not in G.breakers()
    status[0] = 403
    assert await E.search_google_places("Acme") is None
    assert G.breakers()["google_places"]["failures"] == 1


# ── The client report doesn't count Google twice ────────────────────────────
@pytest.mark.db
async def test_google_usage_is_estimated_only_until_its_calls_are_logged(db):
    from app.core.tenancy import org_scope
    from app.models.models import ProviderCallLog
    from app.services.revenue import _still_estimated

    cutover = datetime(2026, 11, 15, 12)
    with org_scope("org_g"):
        await db.execute(text("INSERT INTO credit_ledger (org_id, id, kind, wallet, item, quantity, amount, created_at) VALUES "
                              "('org_g', 'g_before', 'usage', 'leadgen', 'google_view', 4, -4, :b), "
                              "('org_g', 'g_after', 'usage', 'leadgen', 'google_view', 6, -6, :a), "
                              "('org_g', 'v_after', 'usage', 'voice', 'voice_minute', 3, -3, :a)"),
                         {"b": cutover - timedelta(days=1), "a": cutover + timedelta(days=1)})
        await db.commit()

        async def estimated():
            return dict((await db.execute(text(f"SELECT id, quantity FROM credit_ledger WHERE org_id = 'org_g' AND {_still_estimated()}"))).all())

        assert set(await estimated()) == {"g_before", "g_after", "v_after"}  # nothing logged yet: all estimated
    db.add(ProviderCallLog(provider="google_places", capability="company_data", op="place_details", for_org="org_g", outcome="found", at=cutover))
    await db.commit()
    with org_scope("org_g"):
        assert set(await estimated()) == {"g_before", "v_after"}  # after the first logged call, Google's cost is in the ledger


def test_google_s_calls_pass_no_cache_key_and_its_answers_stay_with_one_client():
    """Google's terms: what is shown is fetched live and never kept (the test above shows it is asked every time)."""
    import inspect

    from app.services import enrichment_service as E

    m = registry.get("google_places").manifest
    assert m.licence.share_across_clients is False and m.credit_item == "google_view"
    for fn in (E.search_google_places, E.google_place_details):
        src = inspect.getsource(fn)
        assert "call_provider(\"google_places\"" in src and "cache_key" not in src
