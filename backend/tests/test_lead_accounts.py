"""Leads saved accounts: stored per company, no duplicates, research fills gaps and pays per find."""
import httpx
import pytest

from app.core.tenancy import org_scope
from app.main import app
from app.services import credits as K
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


async def test_saved_accounts_are_kept_without_copies_and_can_be_edited(db):
    _, token = await make_user(db, "la", "Admin", org_id="org_acme")
    async with _client(token) as c:
        r = await c.post("/api/leads/accounts", json={"accounts": [
            {"name": "Kirkgate Dental", "website": "www.kirkgatedental.co.uk", "phone": "0113 496 0412", "source": "scout"},
            {"name": "Headrow Lettings"},
            {"name": "Kirkgate Dental Studio", "website": "https://kirkgatedental.co.uk/contact"},  # same site
            {"name": "headrow lettings"},  # same name, no site
            {"name": ""},  # nothing to save
        ]})
        assert r.status_code == 200, r.text
        assert r.json()["added"] == 2 and r.json()["skipped"] == 3
        saved = {a["name"]: a for a in r.json()["accounts"]}
        assert saved["Kirkgate Dental"]["domain"] == "kirkgatedental.co.uk"
        assert saved["Kirkgate Dental"]["website"] == "https://www.kirkgatedental.co.uk"
        assert saved["Kirkgate Dental"]["source"] == "scout"
        # nothing made up for what was not given
        assert saved["Headrow Lettings"]["phone"] == "" and saved["Headrow Lettings"]["contact_name"] == ""

        listed = (await c.get("/api/leads/accounts")).json()["accounts"]
        assert sorted(a["name"] for a in listed) == ["Headrow Lettings", "Kirkgate Dental"]

        hid = saved["Headrow Lettings"]["id"]
        r = await c.patch(f"/api/leads/accounts/{hid}", json={"contact_name": "Tom Barker", "website": "headrowlettings.example"})
        assert r.status_code == 200 and r.json()["contact_name"] == "Tom Barker" and r.json()["domain"] == "headrowlettings.example"
        assert (await c.patch(f"/api/leads/accounts/{hid}", json={"name": "  "})).status_code == 400

        assert (await c.delete(f"/api/leads/accounts/{hid}")).status_code == 200
        assert [a["name"] for a in (await c.get("/api/leads/accounts")).json()["accounts"]] == ["Kirkgate Dental"]
        assert (await c.delete(f"/api/leads/accounts/{hid}")).status_code == 404


async def test_each_company_sees_only_its_own_accounts(db):
    _, token_a = await make_user(db, "la_a", "Admin", org_id="org_acme")
    _, token_b = await make_user(db, "la_b", "Admin", org_id="org_beta")
    async with _client(token_a) as a, _client(token_b) as b:
        mine = (await a.post("/api/leads/accounts", json={"accounts": [{"name": "Acme Only Ltd"}]})).json()["accounts"][0]
        assert (await b.get("/api/leads/accounts")).json()["accounts"] == []
        assert (await b.patch(f"/api/leads/accounts/{mine['id']}", json={"phone": "1"})).status_code == 404
        assert (await b.delete(f"/api/leads/accounts/{mine['id']}")).status_code == 404
        # the same company may be saved by another organisation: duplicates are per company
        assert (await b.post("/api/leads/accounts", json={"accounts": [{"name": "Acme Only Ltd"}]})).json()["added"] == 1


async def test_research_fills_only_empty_fields_and_pays_per_find(db, monkeypatch):
    calls = []

    async def fake_research(name, company=None, domain=None, person=None, place=None, page_url=None, **_):
        calls.append((company, place, page_url))
        if company == "Nothing Online Ltd":
            return {"phones": [], "emails": [], "keyPeople": [], "socials": {}, "overview": "No detailed summary found."}
        return {"domain": "https://briggateoptics.example", "phones": ["0113 496 0377"], "primaryPhone": "0113 496 0377",
                "emails": ["hello@briggateoptics.example"], "primaryEmail": "hello@briggateoptics.example",
                "otherOffices": [{"town": "York", "phone": "01904 496 0000"}],
                "overview": "Independent opticians in Leeds.", "openingHook": "pitch about voice AI",
                "keyPeople": [{"name": "Marcus Reid", "roleHint": "Owner", "source": "https://x.example"}],
                "socials": {}, "citations": [{"title": "Briggate Opticians", "url": "https://briggateoptics.example"}]}

    monkeypatch.setattr("app.api.lead_accounts.enrich_prospect_intelligence", fake_research)
    _, token = await make_user(db, "lr", "Admin", org_id="org_acme")
    with org_scope("org_acme"):
        await K.add_credits(db, "leadgen", 5, source="grant", note="Trial")
        await K.set_org_settings(db, {"enforce": True})
        await db.commit()
    async with _client(token) as c:
        accs = (await c.post("/api/leads/accounts", json={"accounts": [
            {"name": "Briggate Opticians", "phone": "0113 496 0100", "region": "Leeds", "source": "scout",
             "source_url": "https://briggateoptics.example/leeds"}, {"name": "Nothing Online Ltd"}]})).json()["accounts"]
        brig = next(a for a in accs if a["name"] == "Briggate Opticians")
        none = next(a for a in accs if a["name"] == "Nothing Online Ltd")

        # nothing found: nothing filled, nothing charged
        r = await c.post(f"/api/leads/accounts/{none['id']}/research")
        assert r.status_code == 200 and r.json()["research"]["overview"] == "" and r.json()["phone"] == ""
        with org_scope("org_acme"):
            assert await K.wallet_balance(db, "leadgen") == 5

        r = await c.post(f"/api/leads/accounts/{brig['id']}/research")
        assert r.status_code == 200, r.text
        got = r.json()
        assert got["phone"] == "0113 496 0100"  # the saved number is kept
        assert got["email"] == "hello@briggateoptics.example" and got["domain"] == "briggateoptics.example"
        assert got["contact_name"] == "Marcus Reid" and got["contact_title"] == "Owner"
        assert got["research"]["overview"] == "Independent opticians in Leeds."
        # researched for its town, from the page it was found on; another office's number kept apart
        assert calls[-1] == ("Briggate Opticians", "Leeds", "https://briggateoptics.example/leeds")
        assert got["research"]["other_offices"] == [{"town": "York", "phone": "01904 496 0000"}]
        assert "pitch" not in str(got["research"])  # the Voice sales line is not kept
        assert got["researched_at"]
        with org_scope("org_acme"):
            assert await K.wallet_balance(db, "leadgen") == 0

        # out of credits: refused before any search runs
        before = len(calls)
        r = await c.post(f"/api/leads/accounts/{brig['id']}/research")
        assert r.status_code == 402 and "Leads" in r.json()["detail"]
        assert len(calls) == before
