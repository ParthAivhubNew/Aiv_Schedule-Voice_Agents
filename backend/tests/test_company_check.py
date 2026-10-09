"""Check companies: the decision rules, the pricing, and a whole run through the API."""
import asyncio

import httpx
import pytest

from app.main import app
from app.services import company_check as cc
from app.services import company_check_job as job
from app.services import credits as K
from tests.conftest import make_user


# ── rules (no database) ─────────────────────────────────────────────────────────────────────────
def test_names_match_through_ltd_and_punctuation():
    assert cc.name_score("Acme Ltd", "ACME LIMITED") == 1.0
    assert cc.name_score("Smith & Sons Ltd.", "Smith and Sons Limited") == 1.0
    assert cc.name_score("Acme Ltd", "Zenith Plumbing Ltd") < cc.NAME_MATCH_MIN
    assert cc.name_score("", "Acme") == 0.0


def test_status_words_are_read_the_same_across_registers():
    assert cc.status_class("Active") == "active" and cc.status_class("Registered") == "active"
    for dead in ("Dissolved", "In Administration", "Removed", "liquidation", "Closed"):
        assert cc.status_class(dead) == "dead"
    assert cc.status_class("") == "" and cc.status_class("pending") == ""


def test_best_hit_prefers_the_closest_name_then_an_active_company():
    hits = [{"name": "Acme Trading Ltd", "status": "Active"}, {"name": "Acme Ltd", "status": "Dissolved"},
            {"name": "Acme Ltd", "status": "Active", "registration_number": "01234567"}]
    hit, score = cc.best_hit(hits, "ACME LIMITED")
    assert score == 1.0 and hit["status"] == "Active" and hit["registration_number"] == "01234567"
    assert cc.best_hit([{"name": "Totally Different Co"}], "Acme Ltd")[0] is None


def test_email_and_phone_shapes():
    assert cc.email_shape("Jo.Bloggs@Acme.co.uk") == (True, "acme.co.uk")
    assert cc.email_shape("not-an-email")[0] is False and cc.email_shape("a@b")[0] is False
    assert cc.phone_shape("") == "none"
    assert cc.phone_shape("0113 496 0412") == "ok" and cc.phone_shape("+44 113 496 0412") == "ok"
    assert cc.phone_shape("12345") == "invalid" and cc.phone_shape("0000000000") == "invalid"


def test_website_helpers():
    assert cc.is_parked("<h1>This domain is for sale</h1>") and not cc.is_parked("<h1>Welcome to Acme</h1>")
    assert cc.name_on_page("Acme Plumbing Ltd", "<title>Acme Plumbing - Leeds</title>")
    assert not cc.name_on_page("Acme Plumbing Ltd", "<title>Hello world</title>")


def _decide(**ev):
    return cc.decide({"website": {"state": "live", "name_seen": True}, **ev})


def test_verdicts():
    active = {"found": True, "status": "Active"}
    dead = {"found": True, "status": "Dissolved"}
    assert _decide(registry=active)["verdict"] == "verified"
    assert _decide(registry=dead)["verdict"] == "problem"
    assert _decide(store={"status": "Active", "ago": "3 days ago"})["verdict"] == "verified"
    # the live register is newer than our stored copy, so it decides
    out = _decide(store={"status": "Active"}, registry=dead)
    assert out["verdict"] == "problem" and any("register is newer" in r for r in out["reasons"])
    # nothing knows the company: the deep web search decides
    assert _decide(deep={"found": True, "business_status": "OPERATIONAL"})["verdict"] == "looks_ok"
    assert _decide(deep={"found": True, "business_status": "CLOSED_PERMANENTLY"})["verdict"] == "problem"
    # no deep search match but the website is live and shows the name
    assert _decide(deep={"found": False})["verdict"] == "looks_ok"
    assert cc.decide({"deep": {"found": False}, "website": {"state": "none"}})["verdict"] == "not_found"
    assert cc.decide({"registry": {"state": "pending"}, "website": {"state": "none"}})["verdict"] == "unclear"
    assert cc.decide({"registry": {"state": "off"}, "deep": {"state": "off"}, "website": {"state": "none"}})["verdict"] == "unclear"
    # a dead website is mentioned but doesn't undo a register match
    out = cc.decide({"registry": active, "website": {"state": "dead"}})
    assert out["verdict"] == "verified" and any("Website isn't working" in r for r in out["reasons"])


def test_no_supplier_names_reach_the_reasons():
    out = _decide(registry={"found": True, "status": "Active"}, store={"status": "Active"}, deep={"found": True})
    text = " ".join(out["reasons"]).lower()
    for banned in ("companies house", "google", "telnyx", "hunter", "icypeas"):
        assert banned not in text


def test_a_run_is_priced_per_step_and_rounded_up_once():
    rates = {"check_registry": {"credits": 1}, "google_deep_search": {"credits": 2}, "check_email": {"credits": 2.5}}
    p = cc.price_parts(rates, 1000, 3, registry=True, deep=True, email=True)
    assert p == {"registry": 1000, "deep": 2000, "email": 8, "total": 3008}  # 3 emails x 2.5 = 7.5 -> 8
    assert cc.price_parts(rates, 10, 10, registry=False, deep=False, email=False)["total"] == 0


# ── a whole run through the API ─────────────────────────────────────────────────────────────────
db_only = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


async def _wait(c, status="running", tries=100):
    for _ in range(tries):
        j = (await c.get("/api/leads/checks/latest")).json()["job"]
        if j and j["status"] != status:
            return j
        await asyncio.sleep(0.1)
    raise AssertionError("the check never finished")


@pytest.fixture
def fake_world(monkeypatch):
    """No network: one register that knows Acme (active) and Gone Ltd (dissolved), a web search that
    knows Cafe Nero Local, and websites that load unless they contain 'dead'."""
    calls = {"registry": 0, "deep": 0, "email": 0}

    async def readiness():
        from types import SimpleNamespace
        return {"sources": [SimpleNamespace(id="ds_x", config={})], "registry": True, "deep": True, "email": True}

    async def registry(sources, paces, name):
        calls["registry"] += 1
        known = {"acme ltd": {"found": True, "status": "Active", "name": "Acme Ltd", "score": 1.0, "_source": "ds_x", "_tier": "verified_registry",
                              "registration_number": "01234567"},
                 "gone ltd": {"found": True, "status": "Dissolved", "name": "Gone Ltd", "score": 1.0, "_source": "ds_x", "_tier": "verified_registry",
                              "registration_number": "07654321"}}
        return known.get(name.lower(), {"found": False, "asked": True})

    async def web(url, name):
        return {"state": "dead"} if "dead" in (url or "") else {"state": "live" if url else "none", "name_seen": True}

    async def mx(domain):
        return "invalid" if domain.startswith("nomail") else "ok"

    async def places(query):
        calls["deep"] += 1
        return {"name": "Cafe Nero Local", "business_status": "OPERATIONAL", "phone": "", "website": "", "place_id": "p1", "rating": 4} if "Nero" in query else None

    async def find_email(row, ctx):
        calls["email"] += 1
        return "tom.barker@acme.co.uk" if row["name"] == "Acme Ltd" else ""

    async def save(db, reg, store):
        return None

    monkeypatch.setattr(job, "readiness", readiness)
    monkeypatch.setattr(cc, "live_registry", registry)
    monkeypatch.setattr(cc, "website_state", web)
    monkeypatch.setattr(cc, "email_domain_state", mx)
    monkeypatch.setattr(cc, "_find_email", find_email)
    monkeypatch.setattr(cc, "save_register_answer", save)
    monkeypatch.setattr("app.services.enrichment_service.search_google_places", places)
    return calls


@db_only
async def test_a_selected_list_is_checked_charged_once_and_nothing_saved_is_overwritten(db, fake_world):
    _, token = await make_user(db, "chk", "Admin", org_id="org_acme")
    from app.core.tenancy import org_scope

    with org_scope("org_acme"):
        await K.add_credits(db, "leadgen", 500, note="test")
        await db.commit()
    async with _client(token) as c:
        saved = (await c.post("/api/leads/accounts", json={"accounts": [
            {"name": "Acme Ltd", "website": "acme.co.uk", "email": "info@acme.co.uk", "phone": "0113 496 0412", "contact_name": "Tom Barker"},
            {"name": "Gone Ltd", "website": "dead-gone.co.uk", "email": "x@nomail-gone.co.uk"},
            {"name": "Cafe Nero Local", "website": "nerolocal.co.uk", "phone": "123"},
            {"name": "Mystery Co", "website": ""},
            {"name": "Not Picked Ltd"},
        ]})).json()["accounts"]
        ids = [a["id"] for a in saved[:4]]

        est = (await c.post("/api/leads/checks/estimate", json={"ids": ids, "include_email": True})).json()
        assert est["companies"] == 4 and est["with_contact"] == 1
        assert est["max_credits"] == {"registry": 4, "deep": 8, "email": 3, "total": 15}  # 1 email x 2.5 -> 3

        started = await c.post("/api/leads/checks", json={"ids": ids, "include_email": True})
        assert started.status_code == 200, started.text
        # a second run can't start while one is going
        assert (await c.post("/api/leads/checks", json={"ids": ids})).status_code == 409
        done = await _wait(c)
        assert done["status"] == "done" and done["done"] == 4
        assert done["counts"]["verified"] == 1 and done["counts"]["problem"] == 1 and done["counts"]["looks_ok"] == 1 and done["counts"]["not_found"] == 1
        # 4 register questions at 1; two web searches but only Cafe Nero found anything (2); one email found, 2.5 -> 3
        assert done["charged"]["registry"] == 4 and done["charged"]["deep"] == 2 and done["charged"]["email"] == 3
        assert fake_world["email"] == 1

        listed = {a["name"]: a for a in (await c.get("/api/leads/accounts")).json()["accounts"]}
        acme = listed["Acme Ltd"]["verification"]
        assert acme["verdict"] == "verified" and acme["email"]["state"] == "found" and acme["email"]["found"] == "tom.barker@acme.co.uk" and acme["phone"]["state"] == "ok"
        assert listed["Gone Ltd"]["verification"]["verdict"] == "problem"
        assert listed["Gone Ltd"]["verification"]["email"]["state"] == "invalid"
        assert listed["Gone Ltd"]["verification"]["website"]["state"] == "dead"
        assert listed["Cafe Nero Local"]["verification"]["verdict"] == "looks_ok"
        assert listed["Cafe Nero Local"]["verification"]["phone"]["state"] == "invalid"
        assert listed["Mystery Co"]["verification"]["verdict"] == "not_found"
        assert listed["Not Picked Ltd"]["verification"] is None
        # what the user saved is untouched
        assert listed["Acme Ltd"]["email"] == "info@acme.co.uk" and listed["Gone Ltd"]["website"].endswith("dead-gone.co.uk")

    with org_scope("org_acme"):
        assert await K.wallet_balance(db, "leadgen") == 500 - (4 + 2 + 3)
        assert await K.held(db, "leadgen") == 0


@db_only
async def test_select_all_cancel_and_the_credit_hold(db, fake_world):
    _, token = await make_user(db, "chk2", "Admin", org_id="org_acme")
    from app.core.tenancy import org_scope

    with org_scope("org_acme"):
        await K.add_credits(db, "leadgen", 3, note="test")
        await db.commit()
    async with _client(token) as c:
        await c.post("/api/leads/accounts", json={"accounts": [{"name": f"Co {i} Ltd"} for i in range(5)]})
        # 5 companies could cost 5 + 10 credits at most; the wallet has 3
        r = await c.post("/api/leads/checks", json={"all": True})
        assert r.status_code == 402, r.text
        assert (await c.post("/api/leads/checks", json={"ids": []})).status_code == 400
        assert (await c.get("/api/leads/checks/chk_nope")).status_code == 404

    with org_scope("org_acme"):
        assert await K.held(db, "leadgen") == 0 and await K.wallet_balance(db, "leadgen") == 3


@db_only
async def test_a_company_only_sees_its_own_checks(db, fake_world):
    _, token_a = await make_user(db, "chk3a", "Admin", org_id="org_acme")
    _, token_b = await make_user(db, "chk3b", "Admin", org_id="org_beta")
    from app.core.tenancy import org_scope

    with org_scope("org_acme"):
        await K.add_credits(db, "leadgen", 100, note="test")
        await db.commit()
    async with _client(token_a) as a, _client(token_b) as b:
        await a.post("/api/leads/accounts", json={"accounts": [{"name": "Acme Ltd"}]})
        started = (await a.post("/api/leads/checks", json={"all": True})).json()["job"]
        await _wait(a)
        assert (await b.get(f"/api/leads/checks/{started['job_id']}")).status_code == 404
        assert (await b.get("/api/leads/checks/latest")).json()["job"] is None


@db_only
async def test_our_records_match_by_link_site_or_one_exact_registry_name(db):
    from datetime import datetime, timedelta

    from app.models.models import BusinessRecord

    def rec(i, name, **kw):
        return BusinessRecord(id=f"biz_{i}", identity_hash=f"h{i}", name=name, confidence_tier=kw.pop("tier", "verified_registry"), **kw)

    db.add_all([
        rec(1, "Acme Plumbing Ltd", status="Active", registration_number="01111111", last_verified_at=datetime.utcnow() - timedelta(days=3)),
        rec(2, "Twin Name Ltd", status="Active", last_verified_at=datetime.utcnow()),
        rec(3, "Twin Name Ltd", status="Dissolved", last_verified_at=datetime.utcnow()),
        rec(4, "Old Records Ltd", status="Active", last_verified_at=datetime.utcnow() - timedelta(days=90)),
        rec(5, "Site Match Ltd", status="Active", domain="sitematch.co.uk", last_verified_at=datetime.utcnow()),
    ])
    await db.commit()
    row = lambda **kw: {"name": "", "domain": "", "business_record_id": "", **kw}  # noqa: E731

    one = await cc.store_check(db, row(name="ACME PLUMBING LIMITED"))
    assert one["status"] == "Active" and one["strong"] and one["fresh"] and one["registration_number"] == "01111111"
    twin = await cc.store_check(db, row(name="Twin Name Ltd"))
    assert twin and not twin["strong"]  # two records share the name: not solid enough to skip the live register
    old = await cc.store_check(db, row(name="Old Records Ltd"))
    assert old["strong"] and not old["fresh"]  # solid, but the monthly copy is too old to trust alone
    assert (await cc.store_check(db, row(name="Site Match Limited", domain="sitematch.co.uk")))["id"] == "biz_5"
    assert await cc.store_check(db, row(name="Unrelated Name Ltd", domain="sitematch.co.uk")) is None  # a shared website alone is not enough
    assert (await cc.store_check(db, row(name="Whatever Ltd", business_record_id="biz_4")))["id"] == "biz_4"
    assert await cc.store_check(db, row(name="Nobody Knows Ltd")) is None


async def test_live_register_reads_a_hit_and_slows_down_when_told(monkeypatch):
    from types import SimpleNamespace

    from app.services import data_source_connector as connector

    src = SimpleNamespace(id="ds_x", config={"trust_tier": "verified_registry", "search_field_map": {
        "name": "title", "registration_number": "company_number", "status": "company_status"}}, min_delay_ms=0)
    monkeypatch.setattr(cc, "REGISTRY_MIN_GAP_S", 0)
    answers = [[{"title": "Other Co", "company_number": "1", "company_status": "active"},
                {"title": "ACME LTD", "company_number": "01234567", "company_status": "dissolved"}]]

    async def search(source, query, limit=10):
        if not answers:
            raise connector.ConnectorError("429: slow down")
        return answers.pop()

    monkeypatch.setattr(connector, "_raw_search", search)
    paces = {"ds_x": cc.Pace()}
    hit = await cc.live_registry([src], paces, "Acme Ltd")
    assert hit["found"] and hit["registration_number"] == "01234567" and hit["status"] == "dissolved" and hit["_tier"] == "verified_registry"
    slow = await cc.live_registry([src], paces, "Acme Ltd")
    assert slow == {"state": "pending"}  # it told us to slow down: the row moves on, flagged pending
    assert await cc.live_registry([src], paces, "Acme Ltd") == {"state": "pending"}  # and isn't asked again for a minute


async def test_a_register_that_cannot_be_reached_is_not_charged_for(monkeypatch):
    from types import SimpleNamespace

    from app.services import data_source_connector as connector

    async def broken(source, query, limit=10):
        raise connector.ConnectorError("No API key saved for this source yet.")

    monkeypatch.setattr(connector, "_raw_search", broken)
    monkeypatch.setattr(cc, "REGISTRY_MIN_GAP_S", 0)
    src = SimpleNamespace(id="ds_x", config={"search_field_map": {"name": "title"}}, min_delay_ms=0)
    assert await cc.live_registry([src], {"ds_x": cc.Pace()}, "Acme Ltd") == {"state": "off"}


async def test_the_live_search_settings_are_added_without_touching_staff_edits():
    import json

    from sqlalchemy import text

    from app.core import migrations
    from app.database import Base, engine
    import app.models.models  # noqa: F401

    if "sqlite" in str(engine.url):
        pytest.skip("needs the test database")
    async with engine.begin() as conn:
        for sid, cfg in (("ds_companies_house", {"search_endpoint": "/search/companies", "search_field_map": {"name": "custom"}}),
                         ("ds_food_hygiene", {"headers": {"x-api-version": "2"}})):
            await conn.execute(text("DELETE FROM data_sources WHERE id = :i"), {"i": sid})
            await conn.execute(text("INSERT INTO data_sources (id, name, kind, config, run_state, status) VALUES (:i, :i, 'api', CAST(:c AS JSON), 'idle', 'active')"),
                               {"i": sid, "c": json.dumps(cfg)})
        await migrations._live_registry_check_config(conn)
        got = {r[0]: r[1] for r in (await conn.execute(text("SELECT id, config FROM data_sources WHERE id IN ('ds_companies_house','ds_food_hygiene')"))).all()}
        await conn.execute(text("DELETE FROM data_sources WHERE id IN ('ds_companies_house','ds_food_hygiene')"))
    assert got["ds_companies_house"]["search_field_map"] == {"name": "custom"}  # staff's own mapping is kept
    assert got["ds_food_hygiene"]["search_endpoint"] == "/Establishments" and got["ds_food_hygiene"]["headers"] == {"x-api-version": "2"}
    assert got["ds_food_hygiene"]["search_defaults"] == {"status": "Active"}
