"""Sign-in, route protection, roles and sharing a section."""
import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


async def test_every_private_route_needs_sign_in(anon):
    for path in ("/api/calls/live", "/api/auth/users", "/api/connections", "/api/scheduler/posts", "/api/analytics"):
        r = await anon.get(path)
        assert r.status_code == 401, (path, r.status_code)
    assert (await anon.post("/api/calls/outbound/dial", json={})).status_code == 401
    # A made-up or tampered token is refused.
    r = await anon.get("/api/calls/live", headers={"Authorization": "Bearer aivhub_token_op_admin"})
    assert r.status_code == 401


async def test_public_routes_stay_open(anon):
    assert (await anon.get("/health")).status_code == 200
    # Carrier webhooks are reachable (they check their own signatures).
    r = await anon.post("/api/sip-webhook/test", content=b"{}")
    assert r.status_code != 401
    r = await anon.post("/api/telnyx-assistant/call-event", json={})
    assert r.status_code != 401
    r = await anon.get("/api/scheduler/review?t=bad")
    assert r.status_code == 200 and "no longer valid" in r.text


async def test_login_hashes_and_no_master_password(anon, db):
    from sqlalchemy.future import select

    from app.models.models import Operator

    await make_user(db, "sam", "Operator", password="Correct-horse-9")
    assert (await anon.post("/api/auth/login", json={"username": "sam", "password": "password"})).status_code == 401
    assert (await anon.post("/api/auth/login", json={"username": "admin", "password": "password"})).status_code == 401
    r = await anon.post("/api/auth/login", json={"username": "SAM", "password": "Correct-horse-9"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"] and body["refresh_token"] and body["operator"]["username"] == "sam"
    op = (await db.execute(select(Operator).where(Operator.username == "sam"))).scalars().first()
    assert op.hashed_password.startswith("$2")
    me = await anon.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["permissions"]["calling"] == "full"


async def test_legacy_plain_password_is_upgraded_and_must_change(anon, db):
    from app.models.models import Operator, Organization

    db.add(Operator(id="op_old", org_id="org_default", username="old", name="Old", role="Admin", hashed_password="password"))
    await db.commit()
    r = await anon.post("/api/auth/login", json={"username": "old", "password": "password"})
    assert r.status_code == 200
    tok = r.json()["access_token"]
    assert r.json()["operator"]["must_change_password"] is True
    h = {"Authorization": f"Bearer {tok}"}
    # Blocked until the password is changed.
    blocked = await anon.get("/api/calls/live", headers=h)
    assert blocked.status_code == 403 and blocked.json()["code"] == "password_change_required"
    bad = await anon.post("/api/auth/change-password", json={"current_password": "password", "new_password": "short"}, headers=h)
    assert bad.status_code == 400
    ok = await anon.post("/api/auth/change-password", json={"current_password": "password", "new_password": "A-much-better-1"}, headers=h)
    assert ok.status_code == 200 and ok.json()["must_change_password"] is False
    assert (await anon.get("/api/calls/live", headers=h)).status_code == 200


async def test_refresh_rotates_and_logout_revokes(anon, db):
    await make_user(db, "rita", "Operator", password="Rita-pass-123")
    r = (await anon.post("/api/auth/login", json={"username": "rita", "password": "Rita-pass-123"})).json()
    r2 = await anon.post("/api/auth/refresh", json={"refresh_token": r["refresh_token"]})
    assert r2.status_code == 200
    # The old refresh token no longer works after rotation.
    assert (await anon.post("/api/auth/refresh", json={"refresh_token": r["refresh_token"]})).status_code == 401
    h = {"Authorization": f"Bearer {r2.json()['access_token']}"}
    assert (await anon.post("/api/auth/logout", headers=h)).status_code == 200
    assert (await anon.get("/api/calls/live", headers=h)).status_code == 401


async def test_lockout_after_repeated_failures(anon, db):
    from app.api import auth as auth_api

    auth_api._FAILS.clear()
    await make_user(db, "lock", "Operator", password="Lock-pass-123")
    for _ in range(auth_api.FAIL_LIMIT):
        await anon.post("/api/auth/login", json={"username": "lock", "password": "nope"})
    r = await anon.post("/api/auth/login", json={"username": "lock", "password": "Lock-pass-123"})
    assert r.status_code == 429
    auth_api._FAILS.clear()


async def test_sections_are_enforced_per_role(anon, db):
    _, viewer = await make_user(db, "vic", "Viewer")
    h = {"Authorization": f"Bearer {viewer}"}
    assert (await anon.get("/api/calls/live", headers=h)).status_code == 200  # view
    r = await anon.post("/api/calls/outbound/dial", json={"to": "+441234567890"}, headers=h)
    assert r.status_code == 403 and r.json()["section"] == "calling"
    assert (await anon.get("/api/auth/users", headers=h)).status_code == 403
    # Analytics starts admin-only.
    assert (await anon.get("/api/analytics", headers=h)).status_code == 403


async def test_admin_shares_analytics_with_one_user(client, anon, db):
    op, tok = await make_user(db, "ana", "Operator")
    h = {"Authorization": f"Bearer {tok}"}
    assert (await anon.get("/api/analytics", headers=h)).status_code == 403
    r = await client.put("/api/auth/share", json={"section": "analytics", "user_levels": {op.id: "view"}})
    assert r.status_code == 200
    assert (await anon.get("/api/analytics", headers=h)).status_code == 200
    state = (await client.get("/api/auth/share/analytics")).json()
    assert next(u for u in state if u["id"] == op.id)["level"] == "view"
    await client.put("/api/auth/share", json={"section": "analytics", "user_levels": {op.id: "none"}})
    assert (await anon.get("/api/analytics", headers=h)).status_code == 403


async def test_admin_manages_users_and_keeps_one_admin(client, anon, db):
    roles = (await client.get("/api/auth/roles")).json()
    by = {r["name"]: r["id"] for r in roles}
    r = await client.post("/api/auth/users", json={"username": "newbie", "name": "New Bie", "role_ids": [by["Manager"]]})
    assert r.status_code == 200, r.text
    new = r.json()
    assert new["temporary_password"] and new["must_change_password"] is True
    login = await anon.post("/api/auth/login", json={"username": "newbie", "password": new["temporary_password"]})
    assert login.status_code == 200
    # Disabling signs the user out.
    await client.patch(f"/api/auth/users/{new['id']}", json={"is_active": False})
    h = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await anon.get("/api/auth/me", headers=h)).status_code == 401
    # The only admin cannot lose admin.
    me = (await client.get("/api/auth/me")).json()
    r = await client.patch(f"/api/auth/users/{me['id']}", json={"role_ids": [by["Viewer"]]})
    assert r.status_code == 400
    # Custom role with a section grid.
    r = await client.post("/api/auth/roles", json={"name": "Analyst", "levels": {"analytics": "view", "calling": "view"}})
    assert r.status_code == 200
    roles = (await client.get("/api/auth/roles")).json()
    analyst = next(x for x in roles if x["name"] == "Analyst")
    assert analyst["levels"]["analytics"] == "view" and analyst["levels"]["team"] == "none"


async def _ws(path, query=b""):
    """Run a WebSocket connect through the auth middleware; returns what it sent back."""
    from app.core.auth_middleware import AuthMiddleware

    reached = []

    async def inner(scope, receive, send):
        reached.append(scope["path"])

    sent = []

    async def receive():
        return {"type": "websocket.connect"}

    async def send(msg):
        sent.append(msg)

    await AuthMiddleware(inner)({"type": "websocket", "path": path, "query_string": query, "headers": []}, receive, send)
    return reached, sent


async def test_websockets_need_a_token(db, admin_token):
    reached, sent = await _ws("/ws/listen/call_x")
    assert not reached and sent[0]["code"] == 4401
    reached, _ = await _ws("/ws/listen/call_x", f"access_token={admin_token}".encode())
    assert reached == ["/ws/listen/call_x"]
    _, v = await make_user(db, "wv", "Viewer")
    reached, sent = await _ws("/ws/listen/call_x", f"access_token={v}".encode())
    assert not reached and sent[0]["code"] == 4403  # listening/takeover needs Calling: full
    reached, _ = await _ws("/ws/media-stream")
    assert reached == ["/ws/media-stream"]  # carrier stream stays open


async def test_startup_migration_hashes_old_passwords_and_gives_roles(db):
    from sqlalchemy import text
    from sqlalchemy.future import select

    from app.core.accounts import effective_access
    from app.core.migrations import run_migrations
    from app.database import engine
    from app.models.models import Operator, Organization

    db.add(Operator(id="op_a", org_id="org_default", username="a", name="A", role="Admin", hashed_password="password"))
    db.add(Operator(id="op_b", org_id="org_default", username="b", name="B", role="Operator", hashed_password="S3cret-strong"))
    await db.commit()
    async with engine.begin() as conn:
        await conn.execute(text("DROP TABLE IF EXISTS schema_migrations"))
        await run_migrations(conn)
        await run_migrations(conn)  # runs once only
    db.expire_all()
    a = (await db.execute(select(Operator).where(Operator.id == "op_a"))).scalars().first()
    b = (await db.execute(select(Operator).where(Operator.id == "op_b"))).scalars().first()
    assert a.hashed_password.startswith("$2") and a.must_change_password is True
    assert b.hashed_password.startswith("$2") and b.must_change_password is False
    assert (await effective_access(db, a))[0] is True
    is_admin, perms, _ = await effective_access(db, b)
    assert not is_admin and perms["calling"] == "full" and perms["analytics"] == "none"


async def test_new_user_gets_an_email_when_the_mailbox_is_set(client, monkeypatch, db):
    from app.core import mailer

    sent = []
    monkeypatch.setenv("SYSTEM_MAIL_HOST", "smtp.test")
    monkeypatch.setenv("SYSTEM_MAIL_USER", "notify@aivhub.com")
    monkeypatch.setenv("SYSTEM_MAIL_PASSWORD", "x")
    monkeypatch.setattr(mailer, "_send_sync", lambda msg: sent.append(msg))
    roles = {r["name"]: r["id"] for r in (await client.get("/api/auth/roles")).json()}
    r = await client.post("/api/auth/users", json={"username": "mia", "name": "Mia", "email": "mia@example.com", "role_ids": [roles["Viewer"]]})
    assert r.json()["emailed"] is True
    assert sent and sent[0]["To"] == "mia@example.com" and "Outreach by Aivhub" in sent[0]["From"]
    body = sent[0].get_body(("plain",)).get_content()
    assert r.json()["temporary_password"] in body and "mia" in body


async def test_mail_problems_never_break_the_action(client, monkeypatch):
    from app.core import mailer

    monkeypatch.delenv("SYSTEM_MAIL_HOST", raising=False)
    roles = {r["name"]: r["id"] for r in (await client.get("/api/auth/roles")).json()}
    r = await client.post("/api/auth/users", json={"username": "noemail", "name": "N", "email": "n@example.com", "role_ids": [roles["Viewer"]]})
    assert r.status_code == 200 and r.json()["emailed"] is False

    def boom(msg):
        raise OSError("smtp down")

    monkeypatch.setenv("SYSTEM_MAIL_HOST", "smtp.test")
    monkeypatch.setenv("SYSTEM_MAIL_USER", "u@x.com")
    monkeypatch.setenv("SYSTEM_MAIL_PASSWORD", "x")
    monkeypatch.setattr(mailer, "_send_sync", boom)
    r = await client.post(f"/api/auth/users/{r.json()['id']}/reset-password")
    assert r.status_code == 200 and r.json()["emailed"] is False
