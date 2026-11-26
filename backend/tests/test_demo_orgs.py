"""Plan 12, B7: demo organisations made by staff, with an end date and an invite link instead of a password."""
from datetime import date, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import select, text

from app.main import app
from app.services import demo_orgs as D
from tests.conftest import make_staff


async def test_staff_make_a_demo_whose_admin_joins_with_an_invite(db, staff, anon):
    from app.models.models import Operator, Organization

    await db.execute(text("INSERT INTO brands (id, name, display_name, status) VALUES ('brd_x', 'X', 'X Ltd', 'active')"))
    await db.commit()
    made = await staff.post("/api/admin-api/demo-orgs", json={"company": "Acme Demo Ltd", "adminName": "Ann Smith", "adminEmail": "ann@acme-demo.test",
                                                              "days": 14, "brandId": "brd_x", "standardRules": True})
    assert made.status_code == 200, made.text
    out = made.json()
    assert out["endsOn"] == (date.today() + timedelta(days=14)).isoformat() and out["emailed"] is False and "/reset-password?t=" in out["inviteLink"]
    org = (await db.execute(select(Organization).where(Organization.id == out["orgId"]))).scalars().first()
    assert org.name == "Acme Demo Ltd" and org.status == "active" and org.brand_id == "brd_x"
    assert org.policy["exclusions"]["sets"] == ["standard_b2b"] and org.policy["exclusions"]["locked"] is False
    # no password: the admin chooses one through the invite link, and can then sign in
    token = parse_qs(urlparse(out["inviteLink"]).query)["t"][0]
    assert (await anon.post("/api/auth/login", json={"username": "ann@acme-demo.test", "password": "Str0ng-pass!"})).status_code == 401
    assert (await anon.post("/api/auth/reset-password", json={"token": token, "password": "Demo-pass-2026!"})).status_code == 200
    signed = await anon.post("/api/auth/login", json={"username": "ann@acme-demo.test", "password": "Demo-pass-2026!"})
    assert signed.status_code == 200 and signed.json()["operator"]["is_admin"] is True
    assert (await anon.post("/api/auth/reset-password", json={"token": token, "password": "Other-pass-2026!"})).status_code == 400  # once only
    listed = (await staff.get("/api/admin-api/demo-orgs")).json()["demos"]
    assert [d["name"] for d in listed] == ["Acme Demo Ltd"] and listed[0]["daysLeft"] == 14


async def test_a_demo_is_refused_when_its_details_are_wrong(db, staff):
    base = {"company": "Acme Demo Ltd", "adminName": "Ann", "adminEmail": "ann@acme-demo.test", "days": 14}
    assert (await staff.post("/api/admin-api/demo-orgs", json={**base, "days": 0})).status_code == 400
    assert (await staff.post("/api/admin-api/demo-orgs", json={**base, "adminEmail": "not-an-email"})).status_code == 400
    assert (await staff.post("/api/admin-api/demo-orgs", json={**base, "brandId": "brd_missing"})).status_code == 400
    assert (await staff.post("/api/admin-api/demo-orgs", json=base)).status_code == 200
    again = await staff.post("/api/admin-api/demo-orgs", json=base)
    assert again.status_code == 400 and "already has an account" in again.text


async def test_only_staff_admins_make_demos(db):
    token = await make_staff(db, email="support@outreach.test", role="staff_support")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as c:
        made = await c.post("/api/admin-api/demo-orgs", json={"company": "A", "adminName": "B", "adminEmail": "b@a.test", "days": 3})
        assert made.status_code == 403


async def test_a_demo_ends_after_its_end_date_and_can_be_brought_back(db, staff):
    from app.models.models import Organization

    out = (await staff.post("/api/admin-api/demo-orgs", json={"company": "Short Demo Ltd", "adminName": "Ann", "adminEmail": "ann@short.test", "days": 1})).json()
    assert await D.end_expired(date.today()) == []  # still running
    assert await D.end_expired(date.today() + timedelta(days=2)) == [out["orgId"]]
    await db.rollback()
    org = (await db.execute(select(Organization).where(Organization.id == out["orgId"]))).scalars().first()
    assert org.status == "suspended"
    assert await D.end_expired(date.today() + timedelta(days=3)) == []  # ended once
    back = await staff.post(f"/api/admin-api/demo-orgs/{out['orgId']}/extend", json={"days": 7})
    assert back.status_code == 200 and back.json()["endedAt"] is None
    await db.rollback()
    await db.refresh(org)
    assert org.status == "active"
    fresh = (await staff.post(f"/api/admin-api/demo-orgs/{out['orgId']}/invite")).json()
    assert "/reset-password?t=" in fresh["inviteLink"]


async def test_a_demo_can_start_with_a_sample_list_found_by_its_own_search(db, staff):
    from app.core.tenancy import org_scope
    from app.models.models import BusinessRecord as B

    def rec(n, name, sic):
        return B(id=f"bs{n}", identity_hash=f"hs{n}", name=name, registration_number=f"0900000{n}", postcode="BN1 1AA", status="Active",
                 company_category="Private Limited Company", sic_codes=sic, sic_text="x", sources=[], rank_score=0, region="Hove", industry="")

    db.add_all([rec(1, "Hove Accountants Ltd", "|69201|"), rec(2, "Brighton Bookkeeping Ltd", "|69202|"), rec(3, "Acme Plumbing Ltd", "|43220|")])
    await db.commit()
    made = (await staff.post("/api/admin-api/demo-orgs", json={"company": "Sample Demo Ltd", "adminName": "Bo Lee", "adminEmail": "bo@sample-demo.test",
                                                               "days": 7, "sampleData": True})).json()
    assert made["sampleSaved"] == 2 and made["sampleList"] == D.SAMPLE_LIST
    await db.commit()  # a new transaction, so the demo's own scope applies to the reads below
    with org_scope(made["orgId"]):
        names = sorted(r[0] for r in (await db.execute(text("SELECT name FROM lead_accounts"))).all())
        assert names == ["Brighton Bookkeeping Ltd", "Hove Accountants Ltd"]  # only the trades the sample asks for
    without = (await staff.post("/api/admin-api/demo-orgs", json={"company": "Plain Demo Ltd", "adminName": "Cy Lee", "adminEmail": "cy@plain-demo.test",
                                                                  "days": 7})).json()
    assert without["sampleSaved"] == 0 and without["sampleList"] == ""
