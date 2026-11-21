"""The live Google block on a company: shown from Google at the moment it is opened, never stored, charged once a day."""
import pytest
from sqlalchemy.future import select

from app.core.tenancy import org_scope
from app.models.models import BusinessRecord, CreditEntry
from app.services import business_records, credits as K
from tests.conftest import make_user

pytestmark = pytest.mark.db

DETAILS = {"name": "Kirkgate Dental", "address": "1 Kirkgate, Leeds LS1 1AA", "phone": "+44 113 496 0000",
           "website": "https://kirkgate.example", "rating": 4.6, "rating_count": 88, "business_status": "OPERATIONAL",
           "hours": ["Monday: 9:00 AM to 5:00 PM"], "maps_url": "https://maps.google.com/?cid=1"}


@pytest.fixture(autouse=True)
def _fresh_limit():
    from app.api import lead_accounts as LA

    LA._GOOGLE_VIEW_HITS.clear()
    yield
    LA._GOOGLE_VIEW_HITS.clear()


@pytest.fixture
def google(monkeypatch):
    """A fake Google: counts calls, never touches the network."""
    calls = {"details": 0, "search": 0, "result": dict(DETAILS)}

    async def details(place_id):
        calls["details"] += 1
        return dict(calls["result"]) if calls["result"] else None

    async def search(query, *, name="", postcode=""):
        calls["search"] += 1
        return {"name": name, "place_id": "ChIJfound12345"}

    monkeypatch.setattr("app.services.enrichment_service.google_place_details", details)
    monkeypatch.setattr("app.api.lead_accounts.search_google_places", search)
    return calls


async def _company(db, with_place=True):
    biz = await business_records.upsert(db, source_id="ch:0001", source_type="companies_house", confidence_tier="official",
                                        data={"name": "Kirkgate Dental Ltd", "registration_number": "00000001", "postcode": "LS1 1AA"})
    if with_place:
        await business_records.upsert(db, source_id="google_places:ChIJstored12345", source_type="google_places", confidence_tier="scraped",
                                      data={"name": "Kirkgate Dental Ltd", "registration_number": "00000001", "postcode": "LS1 1AA", "raw": {"place_id": "ChIJstored12345"}})
    await db.commit()
    return biz.id


async def _fund(db, amount=50):
    with org_scope("org_default"):
        await K.add_credits(db, "leadgen", amount)
        await db.commit()


async def _usage(db):
    with org_scope("org_default"):
        return (await db.execute(select(CreditEntry).where(CreditEntry.item == "google_view"))).scalars().all()


async def test_details_are_returned_live_and_not_stored(client, db, google):
    await _fund(db)
    cid = await _company(db)
    r = await client.get(f"/api/leads/companies/{cid}/google-view")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["found"] and body["details"] == DETAILS and body["attribution"] == "Google" and body["credits_charged"] == 1
    assert r.headers["cache-control"] == "no-store"
    db.expire_all()
    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == cid))).scalars().first()
    stored = str([biz.raw_data, biz.sources, biz.phone, biz.website, biz.address, biz.description])
    for secret in ("496 0000", "kirkgate.example", "1 Kirkgate", "maps.google", "9:00 AM"):
        assert secret not in stored
    notes = [e.note for e in await _usage(db)]
    assert notes == ["Google details view"]


async def test_place_id_fallback_stores_only_the_id(client, db, google):
    await _fund(db)
    cid = await _company(db, with_place=False)
    r = await client.get(f"/api/leads/companies/{cid}/google-view")
    assert r.status_code == 200 and r.json()["found"]
    assert google["search"] == 1
    db.expire_all()
    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == cid))).scalars().first()
    assert (biz.raw_data or {}).get("google_places:ChIJfound12345") == {"place_id": "ChIJfound12345"}
    assert "496 0000" not in str(biz.raw_data) and "kirkgate.example" not in str(biz.raw_data)


async def test_fallback_can_be_switched_off(client, db, google, monkeypatch):
    await _fund(db)
    monkeypatch.setattr("app.api.lead_accounts.GOOGLE_VIEW_FALLBACK_SEARCH", False)
    cid = await _company(db, with_place=False)
    r = await client.get(f"/api/leads/companies/{cid}/google-view")
    assert r.json() == {**r.json(), "found": False, "details": None, "credits_charged": 0}
    assert google["search"] == 0 and google["details"] == 0


async def test_policy_refusal(client, db, google, monkeypatch):
    await _fund(db)

    async def no(org, source, db=None):
        return False

    monkeypatch.setattr("app.api.lead_accounts.TP.source_allowed", no)
    cid = await _company(db)
    r = await client.get(f"/api/leads/companies/{cid}/google-view")
    assert r.status_code == 403 and google["details"] == 0


async def test_charged_once_a_day_and_never_when_nothing_found(client, db, google):
    await _fund(db)
    cid = await _company(db)
    google["result"] = None
    r = await client.get(f"/api/leads/companies/{cid}/google-view")
    assert r.json()["found"] is False and r.json()["credits_charged"] == 0 and await _usage(db) == []
    google["result"] = dict(DETAILS)
    assert (await client.get(f"/api/leads/companies/{cid}/google-view")).json()["credits_charged"] == 1
    again = (await client.get(f"/api/leads/companies/{cid}/google-view")).json()
    assert again["found"] and again["credits_charged"] == 0
    assert len(await _usage(db)) == 1


async def test_refused_when_credits_are_short(client, db, google):
    cid = await _company(db)  # no credits granted
    r = await client.get(f"/api/leads/companies/{cid}/google-view")
    assert r.status_code == 402 and r.json()["detail"] and google["details"] == 0


async def test_hourly_limit(client, db, google, monkeypatch):
    await _fund(db)
    monkeypatch.setattr("app.api.lead_accounts.GOOGLE_VIEW_PER_HOUR", 2)
    cid = await _company(db)
    assert [(await client.get(f"/api/leads/companies/{cid}/google-view")).status_code for _ in range(3)] == [200, 200, 429]


async def test_unknown_company_and_other_organisations_account_are_404(client, db, google):
    await _fund(db)
    _, other = await make_user(db, "rival", "Admin", org_id="org_rival")
    import httpx

    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {other}"}) as rival:
        acc = (await rival.post("/api/leads/accounts", json={"accounts": [{"name": "Rival Co"}]})).json()["accounts"][0]["id"]
    assert (await client.get(f"/api/leads/companies/{acc}/google-view")).status_code == 404
    assert (await client.get("/api/leads/companies/nope/google-view")).status_code == 404
    assert google["details"] == 0 and google["search"] == 0
