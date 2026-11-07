"""A director's work email found with the email finder: searched without a website when there is none, kept for the organisation that
found it, shown again on load, and free to ask for a second time."""
import pytest
from fastapi import HTTPException

from app.api import lead_accounts as LA
from app.models.models import BusinessRecord, PersonEmail
from app.services import enrichment_waterfall as EW
from app.services import person_emails as PE


def _biz(**kw):
    return BusinessRecord(id=kw.pop("id", "br_pe1"), identity_hash=kw.pop("hash", "hpe1"), name=kw.pop("name", "BRIGHT CAFE LIMITED"),
                          registration_number="00445790", status="Active", confidence_tier="verified_registry", **kw)


# ── no database ─────────────────────────────────────────────────────────────
def test_the_same_register_name_is_one_person_whatever_the_spacing_or_case():
    assert PE.person_key("SMITH,  John Paul ") == PE.person_key("smith, john paul") == "smith, john paul"
    assert PE.person_key(None) == ""


def test_the_finder_gets_the_website_when_we_know_one_and_nothing_when_we_do_not():
    assert PE.finder_domain(_biz(domain="bright.co.uk")) == "bright.co.uk"
    assert PE.finder_domain(_biz(website="https://www.bright.co.uk/contact")) == "bright.co.uk"
    assert PE.finder_domain(_biz(raw_data={"contacts_web": {"website": "http://brightcafe.com"}})) == "brightcafe.com"
    assert PE.finder_domain(_biz()) == ""


def test_a_kept_email_is_put_on_the_officer_and_the_finder_is_not_named():
    officers = [{"name": "SMITH, John"}, {"name": "LEE, Ann"}]
    PE.attach(officers, {"smith, john": {"email": "john@bright.co.uk", "status": "verified"}})
    assert officers[0]["work_email"] == "john@bright.co.uk" and officers[0]["work_email_status"] == "verified"
    assert "work_email" not in officers[1]
    row = PersonEmail(email="john@bright.co.uk", status="catch_all", source="hunter")
    assert PE.shown(row) == {"email": "john@bright.co.uk", "status": "catch_all"} and PE.shown(None) == {}


class _Result:
    def __init__(self, row):
        self.row = row

    def scalars(self):
        return self

    def first(self):
        return self.row


class _Db:
    def __init__(self, biz):
        self.biz, self.commits = biz, 0

    async def execute(self, _q):
        return _Result(self.biz)

    async def commit(self):
        self.commits += 1


def _wire(monkeypatch, kept=None, answer=None):
    calls = {"finder": [], "kept": []}

    async def kept_one(db, business_id, name):
        return kept

    async def keep(db, business_id, name, first, last, email, status, source):
        calls["kept"].append((business_id, name, email, status))

    async def finder(**kw):
        calls["finder"].append(kw)
        return answer or {"found": False}

    monkeypatch.setattr(PE, "kept_one", kept_one)
    monkeypatch.setattr(PE, "keep", keep)
    monkeypatch.setattr(EW, "lookup_person_waterfall", finder)
    return calls


async def test_a_company_with_no_website_is_searched_by_its_name(monkeypatch):
    calls = _wire(monkeypatch, answer={"found": True, "email": "john@bright.co.uk", "verification_status": "verified", "source": "hunter"})
    body = LA.PersonEmailIn(name="SMITH, John", first_name="John", last_name="Smith")
    r = await LA.find_person_email("br_pe1", body, _Db(_biz()))
    assert calls["finder"][0]["company_name"] == "BRIGHT CAFE LIMITED" and calls["finder"][0]["domain"] == ""
    assert r["found"] and r["email"] == "john@bright.co.uk" and r["charged"] == 1 and "source" not in r
    assert calls["kept"] == [("br_pe1", "SMITH, John", "john@bright.co.uk", "verified")]


async def test_asking_again_for_the_same_person_is_free_and_does_not_search(monkeypatch):
    calls = _wire(monkeypatch, kept=PersonEmail(email="john@bright.co.uk", status="verified", source="hunter"))
    r = await LA.find_person_email("br_pe1", LA.PersonEmailIn(name="SMITH, John", first_name="John", last_name="Smith"), _Db(_biz()))
    assert r == {"found": True, "email": "john@bright.co.uk", "status": "verified", "verification_status": "verified", "kept": True, "charged": 0}
    assert calls["finder"] == []


async def test_nothing_found_is_said_plainly_and_nothing_is_kept_or_invented(monkeypatch):
    calls = _wire(monkeypatch, answer={"found": False, "detail": "No verified email found for this person."})
    r = await LA.find_person_email("br_pe1", LA.PersonEmailIn(name="SMITH, John", first_name="John", last_name="Smith"), _Db(_biz()))
    assert r == {"found": False, "charged": 0} and calls["kept"] == []


async def test_out_of_credits_is_refused_before_anything_is_kept(monkeypatch):
    _wire(monkeypatch, answer={"found": False, "error": "insufficient_credits", "detail": "Not enough credits."})
    with pytest.raises(HTTPException) as err:
        await LA.find_person_email("br_pe1", LA.PersonEmailIn(name="SMITH, John", first_name="John", last_name="Smith"), _Db(_biz()))
    assert err.value.status_code == 402


# ── database ────────────────────────────────────────────────────────────────
@pytest.mark.db
async def test_a_found_email_shows_on_reload_for_its_organisation_only(db, monkeypatch):
    import httpx

    from app.main import app
    from tests.conftest import make_user

    answers = []

    async def finder(**kw):
        answers.append(kw)
        return {"found": True, "email": "john@bright.co.uk", "verification_status": "verified", "source": "cache", "cost_credits": 1}

    monkeypatch.setattr(EW, "lookup_person_waterfall", finder)
    db.add(_biz(officers=[{"name": "SMITH, John", "role": "director", "appointed_on": "2020-01-01", "v": 2}]))
    await db.commit()
    _, mine = await make_user(db, "pe_one", "Admin", org_id="org_pe_one")
    _, other = await make_user(db, "pe_two", "Admin", org_id="org_pe_two")
    body = {"name": "SMITH, John", "first_name": "John", "last_name": "Smith"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {mine}"}) as c:
        first = (await c.post("/api/leads/companies/br_pe1/person-email", json=body)).json()
        again = (await c.post("/api/leads/companies/br_pe1/person-email", json=body)).json()
        page = (await c.get("/api/leads/companies/br_pe1/profile")).json()["company"]
        drawer = (await c.post("/api/leads/companies/br_pe1/contacts", json={})).json()
    assert first["charged"] == 1 and again["charged"] == 0 and again["kept"] and len(answers) == 1
    assert page["people"]["officers"][0]["work_email"] == "john@bright.co.uk"
    assert drawer["officers"][0]["work_email"] == "john@bright.co.uk"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {other}"}) as c:
        theirs = (await c.get("/api/leads/companies/br_pe1/profile")).json()["company"]
    assert "work_email" not in theirs["people"]["officers"][0]
