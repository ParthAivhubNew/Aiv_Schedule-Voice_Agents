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


# ── Provero, Telnyx lookup and Tavily on the wrapper ────────────────────────
@pytest.mark.db
async def test_tps_screening_logs_each_number_masked_and_bad_numbers_cost_nothing(db, monkeypatch):
    from app.models.models import ProviderPrice
    from app.services import provero as P

    db.add(ProviderPrice(id="pp_p", provider="provero_tps", model="", kind="lookup", price_in_usd=0.005, billing="per_search", confirmed=True))
    await db.commit()

    async def fake(client, key, number):
        if number.endswith("0"):
            raise P.BadNumber("not UK")
        return {"tps": "clear", "ctps": False}

    monkeypatch.setattr(P, "check_one", fake)
    prov = P.ProveroProvider("k" * 12)
    got = await prov.screen(["+441000000010", "+441000000001"])
    assert list(got) == ["+441000000001"] and prov.error == ""
    rows = (await db.execute(text("SELECT looked_for, outcome, cost_usd FROM provider_call_log WHERE provider = 'provero_tps' ORDER BY outcome"))).all()
    assert sorted((r.looked_for, r.outcome, r.cost_usd) for r in rows) == [("+44…001", "found", 0.005), ("+44…010", "none", 0.0)]


async def test_tps_screening_stops_at_the_cost_cap_and_says_so(monkeypatch):
    from app.services import provero as P

    async def fake(client, key, number):
        raise AssertionError("asked the vendor after the cap was reached")

    monkeypatch.setattr(P, "check_one", fake)
    monkeypatch.setattr("app.services.plan_rules.cap_refusal", lambda items, org_id=None: _value("USR-08: cap"))
    prov = P.ProveroProvider("k" * 12)
    assert await prov.screen(["+441000000001", "+441000000002"]) == {} and prov.error == "cap"


@pytest.mark.db
async def test_number_checks_go_through_the_wrapper_and_retry_a_rate_limit_once(db, monkeypatch):
    import asyncio

    from app.services import number_check as NC
    from app.services.telnyx_client import TelnyxError

    seen = []

    class Carrier:
        api_key = "telnyx-key"

        async def lookup_number(self, phone):
            seen.append(phone)
            if phone == "+447700900404":
                raise TelnyxError("unknown", status=404)
            if phone == "+447700900429" and seen.count(phone) == 1:
                raise TelnyxError("slow down", status=429)
            return {"carrier": {"name": "EE", "type": "mobile"}, "country_code": "GB"}

    gate = asyncio.Semaphore(2)
    unknown = await NC._lookup_one(Carrier(), {"phone": "+447700900404"}, gate)
    slow = await NC._lookup_one(Carrier(), {"phone": "+447700900429"}, gate)
    assert unknown["status"] == "not_working" and slow and slow["answered"] == "1"
    assert seen.count("+447700900429") == 2
    rows = (await db.execute(text("SELECT feature, outcome, status FROM provider_call_log WHERE provider = 'telnyx_lookup' ORDER BY at"))).all()
    assert [(r.outcome, r.status) for r in rows] == [("found", 404), ("error", 429), ("found", 200)] and rows[0].feature == "number_check"


async def test_a_phone_found_on_the_web_is_confirmed_through_the_wrapper(monkeypatch):
    from app.services import enrichment_service as E
    from app.services import telnyx_client as T

    answers = {"+441273000001": {"carrier": {"name": "BT"}}, "+441273000002": T.TelnyxError("unknown", status=404)}

    async def lookup(self, e164):
        a = answers[e164]
        if isinstance(a, Exception):
            raise a
        return a

    monkeypatch.setattr(T, "platform_key", lambda: "telnyx-key")
    monkeypatch.setattr(T.TelnyxClient, "lookup_number", lookup)
    assert await E._telnyx_confirmed_phone("01273 000001") == "+441273000001"
    assert await E._telnyx_confirmed_phone("01273 000002") == ""  # the network denies it: blanked
    monkeypatch.setattr("app.services.plan_rules.cap_refusal", lambda items, org_id=None: _value("USR-08: cap"))
    assert await E._telnyx_confirmed_phone("01273 000001") == "01273 000001"  # not checked: what was found is kept


@pytest.mark.db
async def test_tavily_searches_keep_their_key_pool_and_are_logged_once_with_their_credits(db, monkeypatch):
    from app.models.models import ProviderPrice
    from app.services import tavily_pool as TP

    db.add(ProviderPrice(id="pp_tv", provider="tavily", model="", kind="lookup", price_in_usd=0.008, billing="per_search", confirmed=True))
    await db.commit()
    responses = [httpx.Response(200, json={"results": [{"url": "https://acme.test"}], "usage": {"credits": 2}}),
                 httpx.Response(432, json={"detail": "used up"})]

    class Pool:
        async def run(self, send, judge, purpose, looked_for):
            return responses.pop(0)

    monkeypatch.setattr(TP, "_pool", lambda: Pool())
    async with httpx.AsyncClient() as client:
        hit = await TP.search(client, {"query": "acme plumbers", "search_depth": "advanced"}, purpose="search_advanced")
        refused = await TP.search(client, {"query": "acme"}, purpose="search")
    assert hit.status_code == 200 and refused.status_code == 432  # the caller still sees why it failed
    rows = (await db.execute(text("SELECT op, outcome, status, units, cost_usd FROM provider_call_log WHERE provider = 'tavily' ORDER BY at"))).all()
    assert [(r.op, r.outcome, r.status, r.units, r.cost_usd) for r in rows] == [
        ("search_advanced", "found", 200, 2.0, pytest.approx(0.016)), ("search", "error", 432, 0.0, 0.0)]


@pytest.mark.db
async def test_old_logs_count_only_until_the_wrapper_takes_over_so_nothing_is_counted_twice(db):
    from app.core.tenancy import org_scope, system_scope
    from app.database import engine
    from app.models.models import ProviderCallLog, ProviderPrice, TavilyCall
    from app.services import cost_ledger

    async with engine.begin() as conn:
        await cost_ledger.create_view(conn)
    cut = datetime(2026, 11, 20, 12)
    before, after = cut - timedelta(days=1), cut + timedelta(days=1)
    db.add_all([ProviderPrice(id="pp_t2", provider="tavily", model="", kind="lookup", price_in_usd=0.01, confirmed=True),
                TavilyCall(id="tv_before", for_org="org_c", purpose="search", outcome="found", credits=1, at=before),
                TavilyCall(id="tv_after", for_org="org_c", purpose="search", outcome="found", credits=1, at=after),
                ProviderCallLog(id="gw_tv", provider="tavily", capability="web_search", op="search", for_org="org_c", outcome="found",
                                units=1, cost_usd=0.01, priced=True, at=after)])
    await db.commit()
    with org_scope("org_c"):
        await db.execute(text("INSERT INTO number_checks (org_id, id, phone, status, checked_at) VALUES "
                              "('org_c', 'nc_b', '+44', 'good', :b), ('org_c', 'nc_a', '+44', 'good', :a)"), {"b": before, "a": after})
        await db.commit()
    with system_scope():
        refs = {r.ref for r in (await db.execute(text("SELECT ref FROM provider_calls WHERE org_id = 'org_c'"))).all()}
    # Tavily: the old row before the switch, the wrapper's after it. Number checks: no wrapper row yet, so both old rows count.
    assert refs == {"tv_before", "gw_tv", "nc_b", "nc_a"}


# ── E-mail finders and Apollo on the wrapper ────────────────────────────────
@pytest.mark.db
async def test_each_email_finder_is_asked_through_the_wrapper_and_a_paused_one_is_skipped(db, monkeypatch):
    from app.core.tenancy import org_scope
    from app.models.models import ProviderPrice
    from app.services import enrichment_waterfall as W

    db.add(ProviderPrice(id="pp_h2", provider="hunter", model="", kind="lookup", price_in_usd=0.03, billing="per_find", confirmed=True))
    await db.commit()
    asked = []

    def finder(name, answer):
        async def find(client, key, p):
            asked.append(name)
            return answer
        return find

    async def keys():
        return {"icypeas": "k1", "hunter": "k2"}

    monkeypatch.setattr(W, "finder_keys", keys)
    monkeypatch.setitem(W.ADAPTERS, "icypeas", finder("icypeas", ("", "")))
    monkeypatch.setitem(W.ADAPTERS, "hunter", finder("hunter", ("ann@acme.co.uk", "verified")))
    with org_scope("org_w"):
        out = await W.lookup_person_waterfall(db, "org_w", "Ann", "Lee", "Acme Ltd", "acme.co.uk", bill=False)
    assert out["found"] is True and asked == ["icypeas", "hunter"]
    rows = (await db.execute(text("SELECT provider, op, feature, looked_for, outcome, cost_usd FROM provider_call_log ORDER BY at"))).all()
    assert [(r.provider, r.op, r.feature, r.looked_for, r.outcome) for r in rows] == [
        ("icypeas", "find_email", "email_finder", "acme.co.uk", "none"), ("hunter", "find_email", "email_finder", "acme.co.uk", "found")]
    assert rows[1].cost_usd == pytest.approx(0.03)  # the person's name never goes into the platform-wide log
    from app.core.tenancy import system_scope

    await db.commit()  # a new transaction, so the company scope below applies to the read
    with system_scope():
        attempts = dict((await db.execute(text("SELECT provider, cost_usd FROM enrichment_attempts WHERE org_id = 'org_w'"))).all())
    assert attempts == {"icypeas": 0.0, "hunter": pytest.approx(0.03)}  # the company's own history has the same cost

    # Icypeas keeps failing: the wrapper pauses it, and the next search goes straight to Hunter.
    monkeypatch.setattr("app.services.ai_errors.alert_staff", lambda *a, **k: _value(None))

    async def broken(client, key, p):
        asked.append("icypeas")
        raise ProviderError("Icypeas: HTTP 500")

    monkeypatch.setitem(W.ADAPTERS, "icypeas", broken)
    for i in range(G.BREAK_AFTER):
        with org_scope("org_w"):
            await W.lookup_person_waterfall(db, "org_w", "Bo", f"Smith{i}", "Acme Ltd", "acme.co.uk", bill=False)
    asked.clear()
    with org_scope("org_w"):
        await W.lookup_person_waterfall(db, "org_w", "Cy", "Jones", "Acme Ltd", "acme.co.uk", bill=False)
    assert asked == ["hunter"]


@pytest.mark.db
async def test_apollo_requests_keep_their_key_pool_and_are_logged_once(db, monkeypatch):
    from app.models.models import ProviderPrice
    from app.services import apollo_pool as AP

    db.add(ProviderPrice(id="pp_ap", provider="apollo", model="", kind="lookup", price_in_usd=0.02, billing="per_find", confirmed=True))
    await db.commit()
    responses = [httpx.Response(200, json={"organization": {"name": "Acme"}}), httpx.Response(200, json={"organization": None}),
                 httpx.Response(422, text="Insufficient credits")]

    class Pool:
        async def run(self, send, judge, purpose, looked_for, lead="", skip_scopes=None):
            return responses.pop(0)

    monkeypatch.setattr(AP, "_pool", lambda: Pool())
    found = lambda j: bool((j or {}).get("organization"))  # noqa: E731
    async with httpx.AsyncClient() as client:
        got = [await AP.call(client, "get", "https://api.apollo.io/x", purpose="company_by_website", looked_for="acme.co.uk", found=found)
               for _ in range(3)]
    assert [r.status_code for r in got] == [200, 200, 422]
    rows = (await db.execute(text("SELECT op, outcome, status, cost_usd FROM provider_call_log WHERE provider = 'apollo' ORDER BY at"))).all()
    assert [(r.op, r.outcome, r.status, r.cost_usd) for r in rows] == [
        ("company_by_website", "found", 200, pytest.approx(0.02)), ("company_by_website", "none", 200, 0.0),
        ("company_by_website", "error", 422, 0.0)]


@pytest.mark.db
async def test_each_finder_and_apollo_count_from_the_old_logs_only_until_their_own_switch(db):
    from app.core.tenancy import org_scope, system_scope
    from app.database import engine
    from app.models.models import ApolloCall, ProviderCallLog, ProviderPrice
    from app.services import cost_ledger

    async with engine.begin() as conn:
        await cost_ledger.create_view(conn)
    cut = datetime(2026, 11, 20, 12)
    before, after = cut - timedelta(days=1), cut + timedelta(days=1)
    db.add_all([ProviderPrice(id="pp_ap2", provider="apollo", model="", kind="lookup", price_in_usd=0.02, confirmed=True),
                ApolloCall(id="ap_before", for_org="org_e", purpose="email_lookup", outcome="found", at=before),
                ApolloCall(id="ap_after", for_org="org_e", purpose="email_lookup", outcome="found", at=after),
                ProviderCallLog(id="gw_h", provider="hunter", capability="email_finder", op="find_email", for_org="org_e", outcome="found",
                                cost_usd=0.03, priced=True, at=after),
                ProviderCallLog(id="gw_ap", provider="apollo", capability="company_data", op="email_lookup", for_org="org_e", outcome="found",
                                cost_usd=0.02, priced=True, at=after)])
    await db.commit()
    with org_scope("org_e"):
        await db.execute(text("INSERT INTO enrichment_attempts (org_id, id, query, provider, found_email, cost_usd, latency_ms, hit, created_at) VALUES "
                              "('org_e', 'h_before', 'q', 'hunter', 'a@b.c', 0.03, 1, TRUE, :b), ('org_e', 'h_after', 'q', 'hunter', 'a@b.c', 0.03, 1, TRUE, :a), "
                              "('org_e', 'i_after', 'q', 'icypeas', 'a@b.c', 0.01, 1, TRUE, :a), ('org_e', 'ap_e', 'q', 'apollo', 'a@b.c', 0.02, 1, TRUE, :a)"),
                         {"b": before, "a": after})
        await db.commit()
    with system_scope():
        refs = {r.ref for r in (await db.execute(text("SELECT ref FROM provider_calls WHERE org_id = 'org_e'"))).all()}
    # Hunter and Apollo switched: their old rows count only before. Icypeas hasn't: its old row still counts.
    assert refs == {"h_before", "gw_h", "i_after", "ap_before", "gw_ap"}
