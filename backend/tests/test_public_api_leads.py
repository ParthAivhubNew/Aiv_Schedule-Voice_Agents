"""Phase 4: finding, contacting and checking leads through the public API (one job, cost shown first)."""
import asyncio
from datetime import date

import httpx
import pytest
from sqlalchemy.future import select

pytestmark = pytest.mark.db


def _http(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    """No network: the registry, the email finders and the carrier are all stand-ins."""
    from app.public_api import core
    from app.services import company_check_job as CCJ
    from app.services import company_contacts as CC

    core._WINDOWS.clear()

    async def ready():
        return {"sources": [], "registry": True, "deep": False, "email": True}

    async def no_registry(db, biz):
        return False

    monkeypatch.setattr(CCJ, "readiness", ready)
    monkeypatch.setattr(CC, "refresh_from_registry", no_registry)
    yield
    core._WINDOWS.clear()


async def _key(admin_token, scopes=("leads:search",), live=True):
    async with _http(admin_token) as c:
        r = await c.post("/api/developer/keys", json={"name": "Leads key", "scopes": list(scopes), "live": live})
    assert r.status_code == 200, r.text
    return r.json()["secret"]


async def _companies(db):
    from app.models.models import BusinessRecord

    db.add_all([
        BusinessRecord(id="biz_1", identity_hash="h1", name="Smile Dental Ltd", sic_text="86230 - Dental practice activities", industry="Dental",
                       status="Active", region="LEEDS", postcode="LS1 1AA", registration_number="01234567", incorporated_on=date(2020, 1, 1),
                       confidence_tier="verified_registry", website="smile.example", phone="+441132000001",
                       officers=[{"name": "Jo Smile", "role": "director"}, {"name": "Old Hand", "role": "director", "resigned_on": "2019-01-01"}]),
        BusinessRecord(id="biz_2", identity_hash="h2", name="Bright Dental Care", sic_text="86230 - Dental practice activities", industry="Dental",
                       status="Active", region="LEEDS", postcode="LS2 2BB", registration_number="07654321", incorporated_on=date(2019, 1, 1),
                       confidence_tier="verified_registry"),
        BusinessRecord(id="biz_3", identity_hash="h3", name="Corner Cafe", sic_text="56102 - Cafes", industry="Cafes", status="Active",
                       region="LEEDS", incorporated_on=date(2018, 1, 1), confidence_tier="verified_registry"),
    ])
    await db.commit()


async def _credits(db, amount=500, wallet="leadgen"):
    from app.services import credits as K

    await K.add_credits(db, wallet, amount, source="grant")
    await db.commit()


async def _wait_done(c, search_id, tries=100):
    for _ in range(tries):
        body = (await c.get(f"/v1/leads/searches/{search_id}")).json()
        if body["status"] != "running":
            return body
        await asyncio.sleep(0.1)
    raise AssertionError("the job never finished")


async def test_the_cost_is_shown_first_and_nothing_starts(db, admin_token):
    from app.models.models import PublicObject

    await _credits(db, 500)
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/leads/searches", json={"sector": "dental", "limit": 40, "contacts": "web", "checks": ["company", "email"], "estimate_only": True})
        assert r.status_code == 202 or r.status_code == 200
        est = r.json()["estimate"]
        b = est["breakdown"]
        assert b["web_contacts"] == 200 and b["company_check"] == 40 and b["email_check"] == 100  # 40 x 5, 40 x 1, 40 x 2.5
        assert est["credits_at_most"] == 340 and est["can_afford"] is True and est["balance"] == 500
    db.expire_all()
    assert (await db.execute(select(PublicObject).where(PublicObject.kind == "lead_job"))).scalars().all() == []


async def test_a_search_needs_something_to_search_for_and_a_sensible_area(db, admin_token):
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/leads/searches", json={"limit": 10})
        assert r.status_code == 422 and r.json()["error"]["code"] == "need_a_filter"
        r = await c.post("/v1/leads/searches", json={"area": [[51.5, -0.1], [51.6, -0.1]]})
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_area"
        r = await c.post("/v1/leads/searches", json={"sector": "dental", "limit": 500})
        assert r.status_code == 422


async def test_find_companies_with_their_registered_contacts(db, admin_token):
    from app.models.models import LeadAccount

    await _companies(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/leads/searches", json={"sector": "dental", "towns": ["Leeds"], "limit": 10})
        assert r.status_code == 202, r.text
        done = await _wait_done(c, r.json()["id"])
        assert done["status"] == "done" and done["found"] == 2
        names = {x["name"]: x for x in done["results"]["data"]}
        assert set(names) == {"Smile Dental Ltd", "Bright Dental Care"}
        smile = names["Smile Dental Ltd"]
        assert smile["contacts"] == [{"name": "Jo Smile", "role": "Director", "source": "registry"}]  # the resigned director is left out
        assert smile["registration_number"] == "01234567" and smile["checks"] == {} and smile["id"] is None
    db.expire_all()
    assert (await db.execute(select(LeadAccount))).scalars().all() == []  # nothing saved unless asked


async def test_checks_save_the_companies_and_report_each_one(db, admin_token, monkeypatch):
    from app.models.models import LeadAccount
    from app.services import company_check_job as CCJ

    await _companies(db)
    await _credits(db, 500)
    seen = {}

    async def start(db_, accounts, include_email):
        seen["names"] = sorted(a.name for a in accounts)
        seen["email"] = include_email
        for a in accounts:
            a.verification = {"verdict": "verified" if a.name.startswith("Smile") else "not_found", "reasons": ["Seen on the register"],
                              "email": {"state": "found", "found": "jo@smile.example", "note": "Found"}, "website": {"state": "ok"},
                              "phone": {"state": "ok"}}
        await db_.commit()
        return {"job": {"job_id": "chk_1"}}

    async def get_job(job_id):
        return {"status": "done", "done": 2, "total": 2, "charged": {"total": 4}}

    monkeypatch.setattr(CCJ, "start", start)
    monkeypatch.setattr(CCJ, "get_job", get_job)
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/leads/searches", json={"sector": "dental", "limit": 10, "checks": ["company", "email"]})
        assert r.status_code == 202, r.text
        done = await _wait_done(c, r.json()["id"])
        assert done["status"] == "done" and done["credits_charged"] == 4
        by = {x["name"]: x for x in done["results"]["data"]}
        assert by["Smile Dental Ltd"]["checks"]["company"] == {"result": "verified", "reasons": ["Seen on the register"]}
        assert by["Smile Dental Ltd"]["checks"]["email"]["address"] == "jo@smile.example"
        assert by["Bright Dental Care"]["checks"]["company"]["result"] == "not_found"
        assert by["Smile Dental Ltd"]["id"].startswith("acc_")
    assert seen == {"names": ["Bright Dental Care", "Smile Dental Ltd"], "email": True}  # the email check implies the officers' names
    db.expire_all()
    assert len((await db.execute(select(LeadAccount))).scalars().all()) == 2
    async with _http(key) as c:
        saved = (await c.get("/v1/leads")).json()
        assert len(saved["data"]) == 2 and saved["next_cursor"] is None
        assert [x["name"] for x in (await c.get("/v1/leads?q=bright")).json()["data"]] == ["Bright Dental Care"]


async def test_not_enough_credits_stops_before_anything_starts(db, admin_token):
    from app.models.models import PublicObject

    await _companies(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/leads/searches", json={"sector": "dental", "limit": 50, "checks": ["company"]})
        assert r.status_code == 402 and r.json()["error"]["code"] == "insufficient_credits"
        assert r.json()["error"]["details"]["estimate"]["can_afford"] is False
    db.expire_all()
    assert (await db.execute(select(PublicObject).where(PublicObject.kind == "lead_job"))).scalars().all() == []


async def test_web_contacts_are_charged_the_apps_way_and_capped_by_credits(db, admin_token, monkeypatch):
    from app.api import enrichment
    from app.services import company_contacts as CC

    await _companies(db)
    await _credits(db, 50)
    charged = []

    async def web(db_, biz, refresh=False):
        return {"found": True, "cached": False, "team": [{"name": "Pat Web", "title": "Owner", "phone": "", "email": "pat@x.test"}],
                "website": "x.test", "phones": ["+441130000000"]}

    async def charge(db_, n, what):
        charged.append((n, what))

    monkeypatch.setattr(CC, "web_contacts", web)
    monkeypatch.setattr(enrichment, "_charge_leads", charge)
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/leads/searches", json={"sector": "dental", "limit": 10, "contacts": "web"})
        assert r.status_code == 202, r.text
        done = await _wait_done(c, r.json()["id"])
        smile = next(x for x in done["results"]["data"] if x["name"] == "Smile Dental Ltd")
        assert {"name": "Pat Web", "role": "Owner", "source": "web", "email": "pat@x.test", "phone": None} in smile["contacts"]
        assert any(x.get("phone") == "+441130000000" for x in smile["contacts"])
    assert len(charged) == 2 and charged[0][0] == 1  # one lead lookup per company, through the app's own charge


async def test_you_can_bring_your_own_leads_and_the_original_single_form_still_works(db, admin_token):
    from app.models.models import Prospect

    key = await _key(admin_token)
    async with _http(key) as c:
        one = await c.post("/v1/leads", json={"name": "Jo Bloggs", "phone": "+447700900123", "company": "Bloggs Ltd", "notes": "Hot"})
        assert one.status_code == 200 and one.json()["lead_id"].startswith("p_") and one.json()["company"] == "Bloggs Ltd"
        many = await c.post("/v1/leads", json={"leads": [{"name": "Acme Ltd", "website": "acme.test", "phone": "+441130000001"},
                                                          {"name": "Beta Ltd", "email": "hi@beta.test"}]})
        assert many.status_code == 200 and many.json()["added"] == 2
        again = await c.post("/v1/leads", json={"leads": [{"name": "Acme Ltd", "website": "acme.test"}]})
        assert again.json()["added"] == 0 and again.json()["skipped"] == 1  # no copies
        bad = await c.post("/v1/leads", json={})
        assert bad.status_code == 422
        assert len((await c.get("/v1/leads")).json()["data"]) == 2
    db.expire_all()
    assert len((await db.execute(select(Prospect))).scalars().all()) == 1


async def test_a_list_you_bring_can_be_phone_checked_for_the_same_price_as_the_app(db, admin_token, monkeypatch):
    from app.services import number_check as NC

    await _credits(db, 100, "voice")
    asked = []

    async def look_up(rows, client=None):
        asked.extend(r["phone"] for r in rows)
        for r in rows:
            r.update(status="valid", line_type="mobile", carrier="Test Net", country="GB", found_name="", match="", checked_on="today", cached=False)
        return len(rows)

    async def remember(db_, rows):
        return None

    monkeypatch.setattr(NC, "look_up", look_up)
    monkeypatch.setattr(NC, "remember", remember)
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/leads", json={"leads": [{"name": "Acme Ltd", "phone": "+447700900123"}, {"name": "Beta Ltd", "phone": "+447700900124"}],
                                            "checks": ["phone"]})
        assert r.status_code == 202, r.text
        done = await _wait_done(c, r.json()["id"])
        assert done["status"] == "done"
        phones = {x["name"]: x["checks"]["phone"] for x in done["results"]["data"]}
        assert phones["Acme Ltd"]["state"] == "valid" and phones["Acme Ltd"]["line_type"] == "mobile"
    assert sorted(asked) == ["+447700900123", "+447700900124"]


async def test_a_job_that_stalls_is_reported_not_left_running_forever(db, admin_token):
    from datetime import datetime, timedelta

    from app.models.models import PublicObject

    key = await _key(admin_token)
    db.add(PublicObject(id="lsearch_old", kind="lead_job", data={"status": "running", "stage": "searching"}))
    await db.commit()
    old = await db.get(PublicObject, "lsearch_old")
    old.updated_at = datetime.utcnow() - timedelta(hours=2)
    await db.commit()
    async with _http(key) as c:
        r = await c.get("/v1/leads/searches/lsearch_old")
        assert r.json()["status"] == "failed" and "stopped" in r.json()["message"]
        assert (await c.get("/v1/leads/searches/lsearch_none")).status_code == 404


async def test_test_keys_get_sample_companies_free(db, admin_token, monkeypatch):
    from app.services import webhook_dispatcher as W

    sent = []
    monkeypatch.setattr(W, "dispatch_event", lambda org, event, data, test=False: sent.append((event, test)))
    key = await _key(admin_token, live=False)
    async with _http(key) as c:
        r = await c.post("/v1/leads/searches", json={"sector": "plumbing", "towns": ["Leeds"], "limit": 3, "checks": ["company", "email", "phone"]})
        assert r.status_code == 202
        body = r.json()
        assert body["status"] == "done" and body["test"] is True and len(body["results"]["data"]) == 3
        first = body["results"]["data"][0]
        assert first["checks"]["company"]["result"] == "verified" and first["checks"]["phone"]["carrier"] == "Test Carrier"
        got = (await c.get(f"/v1/leads/searches/{body['id']}?limit=2")).json()
        assert len(got["results"]["data"]) == 2 and got["results"]["next_cursor"]
        free = await c.post("/v1/leads/searches", json={"sector": "plumbing", "estimate_only": True})
        assert free.json()["estimate"]["credits_at_most"] == 0
    assert sent == [("leads.ready", True)]
