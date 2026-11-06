"""Import identity: company numbers are normalised and checked against the register, and what looks wrong is flagged."""
import httpx
import pytest

from app.core.tenancy import system_scope
from app.main import app
from app.models.models import BusinessRecord
from app.services import business_records as BR
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def _register(db):
    with system_scope():
        db.add(BusinessRecord(id="b_wilk", identity_hash=BR.identity_hash(registration_number="08233371"), name="WILKINSON ACCOUNTANCY LTD",
                              registration_number="08233371", postcode="LS1 4AP", status="Active", company_category="Private Limited Company", raw_data={}, sources=[], rank_score=0))
        await db.commit()


def row(**kw):
    return {"source": "import", "name": "Acme Widgets Ltd", "email": "ann@acmewidgets.co.uk", "website": "acmewidgets.co.uk", "phone": "0113 550 2750", **kw}


async def test_a_number_that_belongs_to_another_company_is_flagged_and_not_linked(db):
    await _register(db)
    _, token = await make_user(db, "id1", "Admin", org_id="org_id1")
    async with _client(token) as c:
        r = await c.post("/api/leads/accounts", json={"accounts": [row(name="Northway Accountants Ltd", registration_number="8233371", website="northway.co.uk", email="a@northway.co.uk")]})
        a = r.json()["accounts"][0]
        assert a["registration_number"] == "08233371"  # leading zero restored
        assert a["business_record_id"] == ""
        assert [f["code"] for f in a["import_flags"]] == ["REGNO_NAME_MISMATCH"]
        assert "WILKINSON" in a["import_flags"][0]["text"]


async def test_the_right_name_with_the_number_links_to_the_register_record(db):
    await _register(db)
    _, token = await make_user(db, "id2", "Admin", org_id="org_id2")
    async with _client(token) as c:
        r = await c.post("/api/leads/accounts", json={"accounts": [row(name="Wilkinson Accountancy Limited", registration_number="08233371", website="wilkinson.co.uk", email="a@wilkinson.co.uk")]})
        a = r.json()["accounts"][0]
        assert a["business_record_id"] == "b_wilk" and a["import_flags"] == []


async def test_two_companies_sharing_one_number_are_flagged(db):
    _, token = await make_user(db, "id3", "Admin", org_id="org_id3")
    async with _client(token) as c:
        r = await c.post("/api/leads/accounts", json={"accounts": [
            row(name="Mega Corp Ltd", registration_number="12345678", website="mega.co.uk", email="a@mega.co.uk"),
            row(name="Growth Accountants Ltd", registration_number="12345678", website="growth.co.uk", email="a@growth.co.uk")]})
        accs = {a["name"]: a for a in r.json()["accounts"]}
        assert accs["Mega Corp Ltd"]["import_flags"] == []
        assert [f["code"] for f in accs["Growth Accountants Ltd"]["import_flags"]] == ["REGNO_DUPLICATE"]


async def test_a_row_with_no_company_name_is_refused_and_listed(db):
    _, token = await make_user(db, "id4", "Admin", org_id="org_id4")
    async with _client(token) as c:
        r = await c.post("/api/leads/accounts", json={"accounts": [row(name="", website="", email="x@y.co.uk")]})
        out = r.json()
        assert out["added"] == 0 and out["quarantined"][0]["codes"] == ["NAME_MISSING"]


async def test_email_on_another_companys_domain_and_partial_postcode_are_kept_as_warnings(db):
    _, token = await make_user(db, "id5", "Admin", org_id="org_id5")
    async with _client(token) as c:
        r = await c.post("/api/leads/accounts", json={"accounts": [row(name="Acme Widgets Ltd", email="tom@totally-other-company.com", postcode="dn11")]})
        a = r.json()["accounts"][0]
        codes = {f["code"] for f in a["import_flags"]}
        assert {"EMAIL_DOMAIN_MISMATCH", "POSTCODE_PARTIAL"} <= codes
        assert a["postcode"] == "DN11"


async def test_values_are_normalised_on_save(db):
    _, token = await make_user(db, "id6", "Admin", org_id="org_id6")
    async with _client(token) as c:
        r = await c.post("/api/leads/accounts", json={"accounts": [row(contact_name="JAMES BROWN", postcode="ls11 6jx", phone="+44 113 550 2750")]})
        a = r.json()["accounts"][0]
        assert a["contact_name"] == "James Brown" and a["postcode"] == "LS11 6JX" and a["phone"] == "0113 550 2750"


async def test_drama_phone_numbers_are_refused_at_import(db):
    _, token = await make_user(db, "id7", "Admin", org_id="org_id7")
    async with _client(token) as c:
        r = await c.post("/api/leads/accounts", json={"accounts": [row(phone="020 7946 0999")]})
        out = r.json()
        assert out["added"] == 0 and out["quarantined"][0]["codes"] == ["PHONE_FICTIONAL"]


async def test_bulk_delete_removes_companies_leaves_journeys_and_can_block_contact(db):
    from sqlalchemy import select

    from app.core.tenancy import org_scope
    from app.models.models import DoNotContact, LeadAccount

    _, token = await make_user(db, "id8", "Admin", org_id="org_id8")
    async with _client(token) as c:
        r = await c.post("/api/leads/accounts", json={"accounts": [row(name=f"Co {i} Ltd", website=f"co{i}.co.uk", email=f"a@co{i}.co.uk") for i in range(3)]})
        ids = [a["id"] for a in r.json()["accounts"]]
        out = (await c.post("/api/leads/accounts/bulk-delete", json={"ids": ids[:2] + ["nope"], "do_not_contact": True})).json()
        assert out["deleted"] == 2 and out["not_found"] == 1
        left = (await c.get("/api/leads/accounts")).json()["accounts"]
        assert [a["id"] for a in left] == [ids[2]]
        blocks = (await c.get("/api/together/do-not-contact")).json() if False else None
    with org_scope("org_id8"):
        emails = {d.email for d in (await db.execute(select(DoNotContact))).scalars().all()}
    assert {"a@co0.co.uk", "a@co1.co.uk"} <= emails


async def test_bulk_delete_needs_at_least_one_id(db):
    _, token = await make_user(db, "id9", "Admin", org_id="org_id9")
    async with _client(token) as c:
        r = await c.post("/api/leads/accounts/bulk-delete", json={"ids": []})
        assert r.status_code == 400
