"""Staff give credits with several confirmations (preview, approve, retype), every giving leaves
a permanent record with its finance label, and everyone concerned is emailed."""
import asyncio

import pytest
from sqlalchemy import text

from tests.conftest import make_staff, make_user

pytestmark = pytest.mark.db

GIVE = {"wallet": "voice", "amount": 120, "label": "given", "reason": "Trial extension for the pilot"}


async def _org(db):
    await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES ('org_acme', 'Acme Ltd', 'acme', 'active')"))
    await db.commit()


async def test_giving_credits_takes_a_preview_and_a_retype(staff, db, monkeypatch):
    from app.services import credit_awards as A

    sent = []

    async def fake_mail(to, subject, html, text_):
        sent.append((to, subject))
        return {"ok": True}

    monkeypatch.setenv("STAFF_ADMIN_EMAIL", "owner@outreach.test")
    monkeypatch.setattr("app.core.mailer.send_system_email", fake_mail)
    await _org(db)
    boss, _ = await make_user(db, "acme_admin", "Admin", org_id="org_acme")
    op, _ = await make_user(db, "acme_op", "Operator", org_id="org_acme")
    boss.email, op.email = "boss@acme.test", "op@acme.test"
    await db.commit()
    await make_staff(db, "other@outreach.test")

    p = (await staff.post("/api/admin-api/clients/org_acme/credit-awards/preview", json=GIVE)).json()
    assert p["before"] == 0 and p["after"] == 120 and p["labelText"] == "Given (no payment)"
    assert "giving 120 AI Voice (calls and WhatsApp) credits to Acme Ltd" in p["summary"] and "0 → 120" in p["summary"]
    orgs = {o["id"]: o for o in (await staff.get("/api/admin-api/clients")).json()}
    assert orgs["org_acme"]["wallets"]["voice"] == 0  # a preview changes nothing

    bad = await staff.post(f"/api/admin-api/credit-awards/{p['id']}/approve", json={"confirm": "12"})
    assert bad.status_code == 400 and "does not match" in bad.json()["detail"]
    r = await staff.post(f"/api/admin-api/credit-awards/{p['id']}/approve", json={"confirm": "120"})
    assert r.status_code == 200, r.text
    rec = r.json()
    assert (rec["before"], rec["after"], rec["confirmedWith"], rec["label"]) == (0, 120, "amount", "given")
    # Approving twice never gives twice.
    assert (await staff.post(f"/api/admin-api/credit-awards/{p['id']}/approve", json={"confirm": "120"})).status_code == 400
    orgs = {o["id"]: o for o in (await staff.get("/api/admin-api/clients")).json()}
    assert orgs["org_acme"]["wallets"]["voice"] == 120

    await asyncio.gather(*A._tasks)
    to = {t for t, _ in sent}
    assert {"owner@outreach.test", "ops@outreach.test", "other@outreach.test", "boss@acme.test"} <= to
    assert "op@acme.test" not in to  # company admins only

    rows = (await staff.get("/api/admin-api/credit-awards?org_id=org_acme")).json()
    assert [(x["amount"], x["staffName"], x["reason"]) for x in rows] == [(120, "ops", GIVE["reason"])]


async def test_the_record_is_permanent(staff, db):
    from sqlalchemy.exc import DBAPIError

    await _org(db)
    p = (await staff.post("/api/admin-api/clients/org_acme/credit-awards/preview", json=GIVE)).json()
    await staff.post(f"/api/admin-api/credit-awards/{p['id']}/approve", json={"confirm": "Staff-pass-2026"})  # or the password
    for sql in ("UPDATE credit_awards SET amount = 999999", "DELETE FROM credit_awards"):
        with pytest.raises(DBAPIError, match="permanent record"):
            await db.execute(text(sql))
        await db.rollback()
    assert (await db.execute(text("SELECT amount, confirmed_with FROM credit_awards"))).one() == (120, "password")


async def test_paid_credits_need_a_reference_and_count_as_revenue_free_ones_do_not(staff, db):
    await _org(db)
    url = "/api/admin-api/clients/org_acme/credit-awards/preview"
    assert (await staff.post(url, json={**GIVE, "reason": ""})).json()["detail"] == "Enter a reason."
    r = await staff.post(url, json={**GIVE, "label": "offline"})
    assert r.json()["detail"] == "Enter the payment reference."
    paid = {**GIVE, "label": "offline", "paymentRef": "BACS 4471", "paidCents": 5000, "currency": "gbp", "amount": 300}
    p = (await staff.post(url, json=paid)).json()
    assert "paid 50.00 GBP (ref BACS 4471)" in p["summary"]
    await staff.post(f"/api/admin-api/credit-awards/{p['id']}/approve", json={"confirm": "300"})
    p = (await staff.post(url, json=GIVE)).json()
    await staff.post(f"/api/admin-api/credit-awards/{p['id']}/approve", json={"confirm": "120"})

    from datetime import datetime

    rep = (await staff.get(f"/api/admin-api/revenue?month={datetime.utcnow():%Y-%m}")).json()
    assert rep["revenue"]["voice"] == {"gbp": 5000}  # the free 120 are not revenue
    assert rep["given"]["voice"] == 120


async def test_three_wrong_retypes_cancel_and_others_cannot_approve(staff, db):
    import httpx

    from app.main import app

    await _org(db)
    p = (await staff.post("/api/admin-api/clients/org_acme/credit-awards/preview", json=GIVE)).json()
    other = await make_staff(db, "other@outreach.test")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                 headers={"Authorization": f"Bearer {other}"}) as c:
        r = await c.post(f"/api/admin-api/credit-awards/{p['id']}/approve", json={"confirm": "120"})
        assert r.status_code == 400 and "not yours" in r.json()["detail"]
    for _ in range(2):
        await staff.post(f"/api/admin-api/credit-awards/{p['id']}/approve", json={"confirm": "1"})
    r = await staff.post(f"/api/admin-api/credit-awards/{p['id']}/approve", json={"confirm": "1"})
    assert "cancelled" in r.json()["detail"]
    r = await staff.post(f"/api/admin-api/credit-awards/{p['id']}/approve", json={"confirm": "120"})
    assert r.status_code == 400
    assert (await db.execute(text("SELECT count(*) FROM credit_awards"))).scalar() == 0
