"""Call preview: who in a Lead Gen list can be called, and why the rest can't."""
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import ContactRegistry, LeadAccount
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


def _always_open(monkeypatch):
    """Calling hours and minutes are checked by their own tests; here the clock must not decide the result."""
    from app.services import compliance

    async def allowed(db, number, now_utc=None):
        return compliance.CallGate(allowed=True)
    monkeypatch.setattr(compliance, "check_call_allowed", allowed)


async def test_preview_sorts_companies_by_why_they_can_or_cannot_be_called(db, monkeypatch):
    _always_open(monkeypatch)
    _, token = await make_user(db, "cp", "Admin", org_id="org_default")  # the house organisation owns every plugin
    async with _client(token) as c:
        saved = (await c.post("/api/leads/accounts", json={"accounts": [
            {"name": "Ready Dental", "phone": "0113 496 0001"},
            {"name": "No Number Ltd"},
            {"name": "Optout Lettings", "phone": "0113 496 0002"},
            {"name": "Recent Plumbing", "phone": "0113 496 0003"},
            {"name": "Researched Cafe", "phone": "0113 496 0004"},
        ]})).json()["accounts"]
        by_name = {a["name"]: a["id"] for a in saved}
        with org_scope("org_default"):
            db.add(ContactRegistry(id="reg_optout", canonical_name="Optout Lettings", phones=["0113 496 0002"], do_not_call=True))
            row = (await db.execute(select(LeadAccount).where(LeadAccount.id == by_name["Recent Plumbing"]))).scalar_one()
            row.last_called_at = datetime.utcnow() - timedelta(days=2)
            row.last_contact_at = row.last_called_at
            await db.commit()

        made = (await c.post("/api/leads/lists", json={"name": "Leeds", "ids": list(by_name.values())})).json()["list"]
        r = await c.post(f"/api/leads/lists/{made['id']}/call-preview", json={})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["total"] == 5
        assert set(out["callable"]) == {by_name["Ready Dental"], by_name["Researched Cafe"]}
        assert out["skipped"]["no_phone"] == [by_name["No Number Ltd"]]
        assert out["skipped"]["do_not_call"] == [by_name["Optout Lettings"]]
        assert out["skipped"]["recently_called"] == [by_name["Recent Plumbing"]]
        assert "no phone number" in out["skipped_text"]
        assert out["cost"]["calls"] == 2

        # choosing to include recent contacts brings that company back
        again = (await c.post(f"/api/leads/lists/{made['id']}/call-preview", json={"override_recontact": True})).json()
        assert by_name["Recent Plumbing"] in again["callable"]

        with org_scope("org_default"):
            linked = (await db.execute(select(LeadAccount.registry_id).where(LeadAccount.id == by_name["Optout Lettings"]))).scalar_one()
        assert linked == "reg_optout"

        assert (await c.post("/api/leads/lists/nope/call-preview", json={})).status_code == 404
        assert (await c.post("/api/leads/lists/all/call-preview", json={})).json()["total"] == 5


async def test_calling_needs_the_voice_plan_and_names_what_is_missing(db):
    _, token = await make_user(db, "nop", "Admin", org_id="org_noplans")  # a client with nothing bought
    async with _client(token) as c:
        r = await c.post("/api/leads/lists/all/call-preview", json={})
        assert r.status_code == 402
        assert r.json()["detail"]["service"] == "leads"
        links = (await c.get("/api/together/availability")).json()
        assert links["plugins"] == {"voice": False, "leads": False, "social": False}
        assert links["links"]["call_leads"]["available"] is False
        assert "Lead Gen" in links["links"]["call_leads"]["reason"]
