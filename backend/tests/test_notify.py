"""Profile, per-user email notification choices, and who gets which email."""
import httpx
import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


def _as(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


async def test_defaults_admin_gets_all_operator_only_security(client, db):
    r = await client.get("/api/auth/me/notifications")
    assert r.status_code == 200, r.text
    assert all(e["on"] for e in r.json()["events"])

    _, tok = await make_user(db, "olly", "Operator")
    async with _as(tok) as c:
        ev = {e["key"]: e["on"] for e in (await c.get("/api/auth/me/notifications")).json()["events"]}
    assert ev["security"] is True and ev["meeting_booked"] is False


async def test_save_choices_and_ignore_unknown_keys(client):
    r = await client.put("/api/auth/me/notifications", json={"events": {"meeting_booked": False, "bogus": True}})
    assert r.status_code == 200, r.text
    ev = {e["key"]: e["on"] for e in r.json()["events"]}
    assert ev["meeting_booked"] is False and "bogus" not in ev
    ev = {e["key"]: e["on"] for e in (await client.get("/api/auth/me/notifications")).json()["events"]}
    assert ev["meeting_booked"] is False and ev["security"] is True


async def test_update_own_profile(client):
    r = await client.patch("/api/auth/me", json={"name": "Big Boss", "email": "boss@example.com"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Big Boss" and r.json()["email"] == "boss@example.com"
    assert (await client.patch("/api/auth/me", json={"email": "not an email"})).status_code == 400
    assert (await client.patch("/api/auth/me", json={"name": "  "})).status_code == 400


async def test_recipients_respect_prefs_org_and_email(db):
    from app.core.notify import recipients
    from app.core.tenancy import org_scope

    boss, _ = await make_user(db, "boss2", "Admin")
    olly, _ = await make_user(db, "olly2", "Operator")
    other, _ = await make_user(db, "outsider", "Admin", org_id="org_other")
    boss.email, olly.email, other.email = "boss@x.com", "olly@x.com", "out@y.com"
    await db.commit()

    with org_scope("org_default"):
        assert await recipients(db, "meeting_booked") == ["boss@x.com"]
        assert sorted(await recipients(db, "security")) == ["boss@x.com", "olly@x.com"]
        assert await recipients(db, "security", only_ids=[olly.id]) == ["olly@x.com"]

    boss.notify_prefs = {"meeting_booked": False}
    await db.commit()
    with org_scope("org_default"):
        assert await recipients(db, "meeting_booked") == []


async def test_temporary_password_user_can_reach_notification_settings(db):
    _, tok = await make_user(db, "newbie", "Operator", must_change=True)
    async with _as(tok) as c:
        assert (await c.get("/api/auth/me/notifications")).status_code == 200
        assert (await c.get("/api/analytics/overview")).status_code == 403
