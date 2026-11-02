"""Opening registry-held contacts once, and picking between candidates a lookup was not sure about."""
import httpx
import pytest
from sqlalchemy import select

from app.main import app
from app.models.models import BusinessRecord
from app.services import business_records as BR
from tests.conftest import make_user

CAFE = "56102 - Unlicensed restaurants and cafes"


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def _seed(db):
    await BR.bulk_upsert(db, source_id="ds_ch", rows=[{
        "name": "Reveal Cafe Ltd", "registration_number": "RV1", "sic_text": CAFE, "industry": CAFE, "region": "LEEDS", "postcode": "LS1 4AP",
        "status": "Active", "incorporation_date": "01/01/2015", "accounts_category": "SMALL", "company_category": "Private Limited Company",
        "raw": {"CompanyNumber": "RV1"}, "website": "revealcafe.co.uk", "phone": "0113 222 0000", "email": "hi@revealcafe.co.uk"}])
    await db.commit()
    return (await db.execute(select(BusinessRecord).where(BusinessRecord.registration_number == "RV1"))).scalars().first()


async def _search(c):
    from app.api import lead_accounts

    lead_accounts._PAGE_CACHE.clear()
    r = await c.post("/api/leads/search", json={"filters": {"towns": ["Leeds"]}})
    assert r.status_code == 200, r.text
    return r.json()["companies"][0]


@pytest.mark.db
async def test_registry_contacts_stay_hidden_until_this_organisation_opens_them(db):
    biz = await _seed(db)
    _, mine = await make_user(db, "rv1", "Admin", org_id="org_acme")
    _, theirs = await make_user(db, "rv2", "Admin", org_id="org_other")
    async with _client(mine) as c, _client(theirs) as o:
        first = await _search(c)
        assert first["website"] == "" and first["phone"] == "" and first["email"] == ""
        assert first["held"] == {"website": True, "phone": True, "email": True} and first["closed"]["website"] is True
        r = await c.post(f"/api/leads/companies/{biz.id}/reveal", json={"kind": "website"})
        assert r.status_code == 200 and r.json()["company"]["website"]
        again = await c.post(f"/api/leads/companies/{biz.id}/reveal", json={"kind": "website"})
        assert again.status_code == 200  # opening twice is the same as once
        seen = await _search(c)
        assert seen["website"] and seen["phone"] == ""  # website stays open, phone is still closed: each opens on its own
        other = await _search(o)
        assert other["website"] == ""  # another organisation has not opened it
        bad = await c.post(f"/api/leads/companies/{biz.id}/reveal", json={"kind": "linkedin"})
        assert bad.status_code == 404


@pytest.mark.db
async def test_a_pick_must_be_one_of_the_shown_options_and_is_counted_once_per_organisation(db):
    from app.core.tenancy import org_scope
    from app.services import contact_choices as CH
    from app.services import credits as K

    async def fund(org):
        with org_scope(org):
            await K.add_credits(db, "leadgen", 50, source="grant", note="Trial")
            await db.commit()

    biz = await _seed(db)
    biz_id = biz.id
    biz.raw_data = {**(biz.raw_data or {}), "lookup_options": {"website": [{"value": "https://a.com", "score": 60, "label": "Likely", "sources": []}]}}
    await db.commit()
    _, token = await make_user(db, "rv3", "Admin", org_id="org_acme")
    await fund("org_acme")
    async with _client(token) as c:
        no = await c.post(f"/api/leads/companies/{biz.id}/choose", json={"kind": "website", "value": "https://evil.example"})
        assert no.status_code == 422
        ok = await c.post(f"/api/leads/companies/{biz.id}/choose", json={"kind": "website", "value": "https://a.com"})
        assert ok.status_code == 200, ok.text
        assert ok.json()["picked_by"] == 1 and ok.json()["charged"] == 0  # the search was charged; confirming is free
    rows = await CH.rows_for(db, biz.id, "website")
    assert [r.value for r in rows] == ["https://a.com"] and CH.trusted(rows) is None
    for n, org in enumerate(("org_b", "org_c")):
        _, t = await make_user(db, f"rv_x{n}", "Admin", org_id=org)
        await fund(org)
        row = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == biz.id))).scalars().first()
        await db.refresh(row)  # the API changed this row in its own session
        row.raw_data = {**(row.raw_data or {}), "lookup_options": {"website": [{"value": "https://a.com", "score": 60, "label": "Likely", "sources": []}]}}
        await db.commit()
        async with _client(t) as c2:
            assert (await c2.post(f"/api/leads/companies/{biz.id}/choose", json={"kind": "website", "value": "https://a.com"})).status_code == 200
    await db.commit()
    db.expire_all()  # the API wrote the picks in its own sessions
    assert CH.trusted(await CH.rows_for(db, biz_id, "website")) == "https://a.com"  # three organisations agree: trusted for the next person
