"""Phase 2: opening many held contacts at once (free), and a list that records who made it."""
import httpx
import pytest
from sqlalchemy import func, select

from app.main import app
from app.models.models import BusinessRecord, ContactReveal
from app.services import business_records as BR
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def _seed(db, n=2):
    rows = [{"name": f"Many Cafe {i} Ltd", "registration_number": f"MN{i}", "sic_text": "56102 - Cafes", "industry": "56102 - Cafes", "region": "LEEDS",
             "postcode": "LS1 4AP", "status": "Active", "incorporation_date": "01/01/2015", "accounts_category": "SMALL",
             "company_category": "Private Limited Company", "raw": {"CompanyNumber": f"MN{i}"}, "website": f"many{i}.co.uk", "phone": f"0113 222 000{i}",
             "email": f"hi@many{i}.co.uk"} for i in range(n)]
    await BR.bulk_upsert(db, source_id="ds_ch", rows=rows)
    await db.commit()
    return (await db.execute(select(BusinessRecord).where(BusinessRecord.registration_number.like("MN%")))).scalars().all()


async def test_reveal_many_opens_every_held_kind_once_and_is_free(db):
    from app.core.tenancy import org_scope
    from app.services import credits as credit

    bizs = await _seed(db)
    _, token = await make_user(db, "rm1", "Admin", org_id="org_rm1")
    ids = [b.id for b in bizs]
    with org_scope("org_rm1"):
        await credit.add_credits(db, "leadgen", 50, source="grant", note="Trial")
        await db.commit()
        before = await credit.wallet_balance(db, "leadgen")
    async with _client(token) as c:
        r = await c.post("/api/leads/companies/reveal-many", json={"ids": ids})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["opened"] == 6 and len(body["companies"]) == 2
        assert all(x["website"] and x["phone"] and x["email"] and x["closed"] == {} for x in body["companies"])
        again = await c.post("/api/leads/companies/reveal-many", json={"ids": ids})
        assert again.json()["opened"] == 0
    with org_scope("org_rm1"):
        assert await credit.wallet_balance(db, "leadgen") == before == 50
        assert (await db.execute(select(func.count()).select_from(ContactReveal).where(ContactReveal.business_id.in_(ids)))).scalar() == 6


async def test_reveal_many_caps_at_500(db):
    _, token = await make_user(db, "rm2", "Admin", org_id="org_rm2")
    async with _client(token) as c:
        ok = await c.post("/api/leads/companies/reveal-many", json={"ids": [f"x{i}" for i in range(500)]})
        assert ok.status_code == 200 and ok.json()["opened"] == 0
        r = await c.post("/api/leads/companies/reveal-many", json={"ids": [f"x{i}" for i in range(501)]})
        assert r.status_code == 400


async def test_new_list_records_its_owner(db):
    _, token = await make_user(db, "rm3", "Admin", org_id="org_rm3")
    async with _client(token) as c:
        made = (await c.post("/api/leads/lists", json={"name": "Owned"})).json()["list"]
        assert made["owner"]
        listed = (await c.get("/api/leads/lists")).json()["lists"]
        assert next(l for l in listed if l["id"] == made["id"])["owner"] == made["owner"]
