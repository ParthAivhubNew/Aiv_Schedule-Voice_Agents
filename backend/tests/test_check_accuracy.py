"""A check never writes a directory page as a company's website, never guesses an email, never treats a person as a company,
and says what it is doing while it runs."""
import asyncio
from types import SimpleNamespace

import httpx
import pytest

from app.core.tenancy import org_scope
from app.main import app
from app.services import company_check as cc
from app.services import check_fixes
from app.services import credits as K
from app.services.person_record import is_person, is_role_inbox
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def test_a_person_is_a_record_named_for_them_with_no_company_behind_it():
    assert is_person("Mayur Doshi", "mayur  doshi", "", "", "")
    assert not is_person("AIVHUB LTD", "Hemant Mehta", "", "", "")
    assert not is_person("Mayur Doshi", "Mayur Doshi", "aivhub.com", "", "")
    assert not is_person("Mayur Doshi", "Mayur Doshi", "", "", "rec_1")
    assert is_role_inbox("support@aivhub.com") and is_role_inbox("careers@aivhub.com") and not is_role_inbox("hemant@aivhub.com")


def test_a_directory_page_is_never_set_as_the_website():
    acc = SimpleNamespace(name="AIVHUB LTD", website="", domain="")
    check_fixes.set_field(acc, "website", "https://open.endole.co.uk/insight/company/123")
    check_fixes.set_field(acc, "website", "ch.zonebourse.com")
    assert acc.website == "" and acc.domain == ""
    check_fixes.set_field(acc, "website", "https://aivhub.com")
    assert acc.domain == "aivhub.com"


def test_the_deep_search_website_is_dropped_when_it_is_a_directory():
    row = {"name": "AIVHUB LTD", "phone": "", "website": "", "domain": ""}
    fixes = cc.build_fixes(row, {"found": True, "website": "https://open.endole.co.uk/x", "phone": ""}, {}, "")
    assert not [f for f in fixes if f["field"] == "website"]


async def test_only_a_verified_email_counts_never_a_catch_all_guess(monkeypatch):
    async def fake(db, org, first, last, company, domain, bill=False):
        return {"found": True, "email": "hemant@aivhub.com", "verification_status": status[0]}

    status = ["catch_all"]
    monkeypatch.setattr("app.services.enrichment_waterfall.lookup_person_waterfall", fake)
    ctx = SimpleNamespace(org_id="o", email_sem=asyncio.Semaphore(1))
    row = {"name": "AIVHUB LTD", "contact_name": "Hemant Mehta", "domain": ""}
    assert await cc._find_email(row, ctx) == ""
    status[0] = "verified"
    assert await cc._find_email(row, ctx) == "hemant@aivhub.com"


async def test_a_person_is_checked_for_phone_and_email_only_and_the_screen_hears_what_it_is_doing():
    said = []
    ctx = SimpleNamespace(job_id="j", check_phones=False, web_sem=asyncio.Semaphore(1), dns_sem=asyncio.Semaphore(1),
                          report=lambda row, step: said.append(step), registry_sources=[{"never": "asked"}])
    row = {"id": "a", "name": "Mayur Doshi", "contact_name": "Mayur Doshi", "phone": "+447587200616", "email": "", "website": "", "domain": "", "business_record_id": ""}
    out = await cc.check_row(row, ctx)
    assert out["verdict"] == "person" and out["website"] == {"state": "none"}
    assert "registry" not in out["stages"] and out["spent"]["registry"] == 0 and out["spent"]["deep"] == 0
    assert said and "person" in said[0].lower()


async def test_research_ignores_a_directory_page_a_role_inbox_and_a_person(db, monkeypatch):
    async def fake(name, company=None, domain=None, person=None, place=None, page_url=None, **_):
        return {"domain": "https://open.endole.co.uk/insight/company/9", "phones": [], "emails": ["support@aivhub.com"], "primaryEmail": "support@aivhub.com",
                "keyPeople": [], "socials": {}, "overview": "An IT consultancy.", "citations": []}

    monkeypatch.setattr("app.api.lead_accounts.enrich_prospect_intelligence", fake)
    _, token = await make_user(db, "acc1", "Admin", org_id="org_acc1")
    with org_scope("org_acc1"):
        await K.add_credits(db, "leadgen", 20, source="grant", note="Trial")
        await db.commit()
    async with _client(token) as c:
        accs = (await c.post("/api/leads/accounts", json={"accounts": [
            {"name": "AIVHUB LTD", "contact_name": "Jitendra Mehta", "phone": "0113 000 0000"},
            {"name": "Mayur Doshi", "contact_name": "Mayur Doshi", "phone": "+447587200616"}]})).json()["accounts"]
        co = next(a for a in accs if a["name"] == "AIVHUB LTD")
        person = next(a for a in accs if a["name"] == "Mayur Doshi")
        assert person["kind"] == "person" and co["kind"] == "company"

        got = (await c.post(f"/api/leads/accounts/{co['id']}/research")).json()
        assert got["website"] == "" and got["domain"] == ""  # the directory page was not taken as the website
        assert got["email"] == ""  # a company inbox is not Jitendra's email

        got = (await c.post(f"/api/leads/accounts/{person['id']}/research")).json()
        assert got["website"] == "" and got["email"] == "" and got["research"] is None  # nothing about a company was searched for a person
        with org_scope("org_acc1"):
            assert await K.wallet_balance(db, "leadgen") == 15  # only the company lookup (5 credits) was charged; the person cost nothing
