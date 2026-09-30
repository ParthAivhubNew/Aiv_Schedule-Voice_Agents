"""Credits: ledger, settling usage from call logs and AI posts, stop at zero, staff-only grants."""
from datetime import datetime, timedelta

import httpx
import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


def _as(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


def test_minutes_of_duration_formats():
    from app.services.credits import minutes_of

    assert minutes_of("00:00") == 0
    assert minutes_of("00:01") == 1
    assert minutes_of("03:25") == 4
    assert minutes_of("02:00 min") == 2
    assert minutes_of("4 min") == 4
    assert minutes_of("0 min") == 0
    assert minutes_of("") == 0


async def _call_log(db, cid, duration, created=None):
    from app.models.models import CallLog

    db.add(CallLog(id=cid, canonical_name="Pat", listed_as="Pat", started_at="x", ended_at="y", duration=duration,
                   channel="voice", created_at=created or datetime.utcnow()))
    await db.commit()


async def test_settle_charges_once_and_only_after_tracking_starts(db):
    from app.core.tenancy import org_scope
    from app.services import credits as K

    with org_scope("org_default"):
        await _call_log(db, "cl_old", "05:00", datetime.utcnow() - timedelta(hours=1))
        assert await K.settle(db) == 0  # first run only marks the start
        assert await K.balance(db) == 0
        await _call_log(db, "cl_1", "02:10")
        assert await K.settle(db) == 30  # 3 minutes x 10
        assert await K.settle(db) == 0  # not charged twice
        from app.models.models import CallLog
        from sqlalchemy.future import select

        row = (await db.execute(select(CallLog).where(CallLog.id == "cl_1"))).scalars().first()
        row.duration = "04:00"  # the log was updated with the full length
        await db.commit()
        assert await K.settle(db) == 10  # only the extra minute
        assert await K.balance(db) == -40


async def test_stop_at_zero_only_when_enforced(db):
    from app.core.tenancy import org_scope
    from app.services import credits as K
    from app.services.compliance import check_call_allowed

    with org_scope("org_default"):
        assert (await K.can_start(db, "voice_minute"))[0] is True  # not enforced: never blocks
        await K.set_org_settings(db, {"enforce": True})
        await db.commit()
        ok, why = await K.can_start(db, "voice_minute")
        assert not ok and "Out of credits" in why
        gate = await check_call_allowed(db, "+447700900123")
        assert not gate.allowed and "Out of credits" in gate.reasons[0]
        await K.grant(db, 15, note="test")
        await db.commit()
        assert (await K.can_start(db, "voice_minute"))[0] is True
        assert (await K.can_start(db, "ai_post"))[0] is True


async def test_admin_sees_credits_operator_does_not(client, db):
    r = await client.get("/api/credits")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["balance"] == 0 and "voice_minute" in body["rates"] and body["isPlatformStaff"] is True
    _, tok = await make_user(db, "olly", "Operator")
    async with _as(tok) as c:
        assert (await c.get("/api/credits")).status_code == 403


async def test_only_platform_staff_grant(client, db):
    _, other_admin = await make_user(db, "acme_admin", "Admin", org_id="org_acme")
    async with _as(other_admin) as c:
        assert (await c.post("/api/credits/platform/grant", json={"org_id": "org_acme", "amount": 1000})).status_code == 403
        assert (await c.put("/api/credits/platform/rates", json={"rates": {"voice_minute": 0}})).status_code == 403

    r = await client.post("/api/credits/platform/grant", json={"org_id": "org_acme", "amount": 250, "note": "trial"})
    assert r.status_code == 200 and r.json()["balance"] == 250
    r = await client.put("/api/credits/platform/orgs/org_acme", json={"enforce": True})
    assert r.json()["enforce"] is True
    orgs = {o["id"]: o for o in (await client.get("/api/credits/platform/orgs")).json()}
    assert orgs["org_acme"]["balance"] == 250 and orgs["org_acme"]["enforce"] is True
    assert orgs["org_default"]["balance"] == 0

    async with _as(other_admin) as c:
        mine = (await c.get("/api/credits")).json()
    assert mine["balance"] == 250 and mine["enforce"] is True and mine["isPlatformStaff"] is False
    assert (await client.post("/api/credits/platform/grant", json={"org_id": "nope", "amount": 5})).status_code == 404


async def test_signup_gets_starter_credits_enforced(anon, db, monkeypatch):
    monkeypatch.setenv("ALLOW_SIGNUP", "true")
    monkeypatch.setenv("STARTER_CREDITS", "300")
    monkeypatch.delenv("SYSTEM_MAIL_HOST", raising=False)
    from app.api import signup

    signup._HITS.clear()
    body = {"company": "Cred Co", "name": "Cy", "email": "cy@cred.test", "password": "Cred-pass-2026"}
    assert (await anon.post("/api/auth/signup", json=body)).status_code == 200
    r = await anon.post("/api/auth/login", json={"username": "cy@cred.test", "password": body["password"]})
    async with _as(r.json()["access_token"]) as c:
        mine = (await c.get("/api/credits")).json()
    assert mine["balance"] == 300 and mine["enforce"] is True
