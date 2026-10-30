"""The people job: reading each company's directors from the registry in the background, under its rate limit, without ever recording a
failed call as "this company has no officers"."""
import asyncio
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy.future import select

from app.models.models import BusinessRecord, DataSource, DataSourceRun
from app.services import data_source_connector as connector
from app.services import data_sources as DS

CFG = {"officers_endpoint": "/company/{id}/officers?items_per_page=100", "officers_items_path": "items",
       "officers_field_map": {"name": "name", "role": "officer_role", "nationality": "nationality"},
       "psc_endpoint": "/company/{id}/persons-with-significant-control", "psc_items_path": "items",
       "psc_field_map": {"name": "name", "nature_of_control": "natures_of_control"}}


def test_the_job_leaves_room_for_the_app():
    assert DS.people_interval(75) == pytest.approx(0.6667, rel=1e-3)  # 450 calls in 5 minutes, not 600
    assert DS.people_interval(500) == DS.people_interval(90) and DS.people_interval(1) == DS.people_interval(10)  # never past 90%, never under 10%


def test_the_estimate_counts_two_calls_a_company_when_owners_are_read_too():
    assert DS.people_days(500_000, 75, False) == pytest.approx(500_000 / 129_600, rel=1e-3)
    assert DS.people_days(500_000, 75, True) == pytest.approx(2 * DS.people_days(500_000, 75, False))


def _source(key="k"):
    return SimpleNamespace(base_url="https://api.test", auth_type="api_key_basic", api_key=key, config=CFG, name="Companies House")


def _answer(monkeypatch, handler):
    monkeypatch.setattr(connector, "_client", lambda source: httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://api.test"))


async def test_officers_are_mapped_and_a_company_the_register_has_none_for_is_empty(monkeypatch):
    def handler(request):
        if "00000404" in request.url.path:
            return httpx.Response(404)
        return httpx.Response(200, json={"items": [{"name": "MURPHY, Ken", "officer_role": "director", "nationality": "Irish"}]})

    _answer(monkeypatch, handler)
    got = await connector.fetch_people(_source(), "00445790")
    assert got == {"officers": [{"name": "MURPHY, Ken", "role": "director", "nationality": "Irish"}]}
    assert await connector.fetch_people(_source(), "00000404") == {"officers": []}


async def test_owners_are_read_only_when_asked(monkeypatch):
    seen = []

    def handler(request):
        seen.append(request.url.path)
        return httpx.Response(200, json={"items": [{"name": "Jo", "natures_of_control": ["ownership-of-shares-25-to-50-percent"]}]})

    _answer(monkeypatch, handler)
    await connector.fetch_people(_source(), "00445790")
    assert len(seen) == 1
    got = await connector.fetch_people(_source(), "00445790", owners=True)
    assert len(seen) == 3 and got["significant_control"][0]["nature_of_control"] == "ownership-of-shares-25-to-50-percent"


async def test_a_busy_registry_a_refused_key_and_an_outage_are_errors_not_empty_answers(monkeypatch):
    _answer(monkeypatch, lambda r: httpx.Response(429, headers={"Retry-After": "30"}))
    with pytest.raises(connector.RateLimited) as busy:
        await connector.fetch_people(_source(), "00445790")
    assert busy.value.wait == 30
    _answer(monkeypatch, lambda r: httpx.Response(401))
    with pytest.raises(connector.KeyRejected):
        await connector.fetch_people(_source(), "00445790")
    _answer(monkeypatch, lambda r: httpx.Response(503))
    with pytest.raises(connector.ConnectorError):
        await connector.fetch_people(_source(), "00445790")
    with pytest.raises(connector.KeyRejected):
        await connector.fetch_people(_source(key=""), "00445790")


# ── the loop, on a real database ─────────────────────────────────────────────────────────────────────
def _company(number, name, rank, status="Active", tier="verified_registry"):
    return BusinessRecord(id=f"br_{number}", identity_hash=f"h_{number}", name=name, registration_number=number, status=status,
                          confidence_tier=tier, rank_score=rank)


async def _setup(db, companies):
    db.add(DataSource(id="ds_companies_house", name="Companies House (UK)", kind="api", base_url="https://api.test", auth_type="api_key_basic",
                      api_key="k", config=CFG, run_state="idle", status="active"))
    for c in companies:
        db.add(c)
    await db.commit()


async def _start(db, **kw):
    source = (await db.execute(select(DataSource).where(DataSource.id == "ds_companies_house"))).scalars().first()
    run = await DS.start_people_run(db, source, **kw)
    await db.commit()
    return run.id


@pytest.mark.db
async def test_the_job_reads_best_ranked_first_and_skips_what_it_should(db, monkeypatch):
    await _setup(db, [_company("00000001", "Low", 10), _company("00000002", "High", 900), _company("00000003", "Mid", 500),
                      _company("00000004", "Closed Ltd", 999, status="Dissolved"), _company("CC-100200", "A Charity", 998),
                      _company("00000005", "Broken", 700), _company("00000006", "Nobody", 600)])
    order = []

    async def fake(source, number, *, owners=False):
        order.append(number)
        if number == "00000005":
            raise connector.ConnectorError("503 from the registry")
        return {"officers": [] if number == "00000006" else [{"name": f"A, {number}", "role": "director"}]}

    monkeypatch.setattr(connector, "fetch_people", fake)
    monkeypatch.setattr(DS, "people_interval", lambda share: 0)
    run_id = await _start(db, limit=100)
    await DS.run_people(run_id)

    assert order == ["00000002", "00000005", "00000006", "00000003", "00000001"]  # best first; no dissolved company, no charity number
    db.expire_all()
    rows = {r.registration_number: r for r in (await db.execute(select(BusinessRecord))).scalars().all()}
    assert rows["00000002"].officers == [{"name": "A, 00000002", "role": "director", "v": 2}] and rows["00000002"].people_checked_at
    assert rows["00000006"].officers == [] and rows["00000006"].people_checked_at  # had none: read, so not asked again
    assert rows["00000005"].people_checked_at is None and rows["00000005"].officers is None  # a failed call is not "no officers"
    assert rows["00000004"].people_checked_at is None and rows["CC-100200"].people_checked_at is None
    run = (await db.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
    assert run.status == "done" and (run.records_found, run.records_new, run.records_updated) == (4, 3, 1) and run.cursor["failed"] == 1


@pytest.mark.db
async def test_the_job_stops_at_the_number_asked_for_and_picks_up_where_it_left_off(db, monkeypatch):
    await _setup(db, [_company(f"0000000{i}", f"Co {i}", 100 - i) for i in range(1, 6)])
    seen = []

    async def fake(source, number, *, owners=False):
        seen.append(number)
        return {"officers": [{"name": "A, B", "role": "director"}]}

    monkeypatch.setattr(connector, "fetch_people", fake)
    monkeypatch.setattr(DS, "people_interval", lambda share: 0)
    await DS.run_people(await _start(db, limit=2))
    assert seen == ["00000001", "00000002"]
    await DS.run_people(await _start(db, limit=2))
    assert seen == ["00000001", "00000002", "00000003", "00000004"]  # the next run starts at the next unread company


@pytest.mark.db
async def test_a_busy_registry_makes_the_job_wait_and_then_carry_on(db, monkeypatch):
    await _setup(db, [_company("00000001", "One", 50), _company("00000002", "Two", 40)])
    calls = {"n": 0}
    waited = []

    async def fake(source, number, *, owners=False):
        calls["n"] += 1
        if calls["n"] == 1:
            raise connector.RateLimited(7)
        return {"officers": [{"name": "A, B", "role": "director"}]}

    real_sleep = asyncio.sleep

    async def sleep(seconds):
        waited.append(seconds)
        await real_sleep(0)

    monkeypatch.setattr(connector, "fetch_people", fake)
    monkeypatch.setattr(DS, "people_interval", lambda share: 0)
    monkeypatch.setattr(DS.asyncio, "sleep", sleep)
    run_id = await _start(db, limit=10)
    await DS.run_people(run_id)
    assert 7 in waited
    db.expire_all()
    run = (await db.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
    assert run.status == "done" and run.records_found == 2  # the company that hit the limit was read after the wait, not lost


@pytest.mark.db
async def test_a_refused_key_ends_the_run_with_the_reason(db, monkeypatch):
    await _setup(db, [_company("00000001", "One", 50)])

    async def fake(source, number, *, owners=False):
        raise connector.KeyRejected("401: the API key was rejected")

    monkeypatch.setattr(connector, "fetch_people", fake)
    monkeypatch.setattr(DS, "people_interval", lambda share: 0)
    run_id = await _start(db, limit=10)
    await DS.run_people(run_id)
    db.expire_all()
    run = (await db.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
    source = (await db.execute(select(DataSource).where(DataSource.id == "ds_companies_house"))).scalars().first()
    assert run.status == "error" and "rejected" in run.error_message and source.run_state == "error"


@pytest.mark.db
async def test_a_stopped_run_does_not_read_any_more(db, monkeypatch):
    await _setup(db, [_company("00000001", "One", 50)])
    monkeypatch.setattr(connector, "fetch_people", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not be called")))
    run_id = await _start(db, limit=10)
    source = (await db.execute(select(DataSource).where(DataSource.id == "ds_companies_house"))).scalars().first()
    await DS.stop_run(db, source)
    await db.commit()
    await DS.run_people(run_id)


@pytest.mark.db
async def test_the_job_will_not_start_without_a_key_a_sensible_size_or_while_another_run_is_active(db):
    await _setup(db, [_company("00000001", "One", 50)])
    source = (await db.execute(select(DataSource).where(DataSource.id == "ds_companies_house"))).scalars().first()
    with pytest.raises(ValueError, match="from 1 to"):
        await DS.start_people_run(db, source, limit=0)
    await DS.start_people_run(db, source, limit=5)
    await db.commit()
    with pytest.raises(ValueError, match="already"):
        await DS.start_people_run(db, source, limit=5)
    source.api_key = ""
    with pytest.raises(ValueError, match="API key"):
        await DS.start_people_run(db, source, limit=5)


@pytest.mark.db
async def test_the_admin_screen_reports_how_many_are_read_and_how_many_are_waiting(db, staff):
    await _setup(db, [_company("00000001", "Read", 50), _company("00000002", "Waiting", 40), _company("00000003", "Also waiting", 30)])
    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.registration_number == "00000001"))).scalars().first()
    from datetime import datetime

    biz.people_checked_at, biz.officers = datetime.utcnow(), [{"name": "A, B", "role": "director"}]
    await db.commit()
    r = await staff.get("/api/admin-api/data-sources/ds_companies_house/people-status")
    assert r.status_code == 200, r.text
    assert r.json() == {"read": 1, "withPeople": 1, "waiting": 2}
    bad = await staff.post("/api/admin-api/data-sources/ds_companies_house/start", json={"job": "people", "limit": 0})
    assert bad.status_code == 400
