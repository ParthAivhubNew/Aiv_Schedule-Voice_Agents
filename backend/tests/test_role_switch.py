"""Switching roles and users on and off: payloads, guards, effect on sign-in and live sessions, audit rows, startup step."""
import httpx
import pytest
from sqlalchemy import select, text

from app.core import migrations as M
from app.core.accounts import assign_roles, ensure_system_roles
from app.main import app
from app.models.models import AuditLog, Operator
from tests.conftest import make_user

pytestmark = pytest.mark.db

PW = "Str0ng-pass!"
OFF = "Your access has been switched off. Ask your administrator."


def api(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def put_role(c, role_id, **body):
    return await c.put(f"/api/auth/roles/{role_id}", json=body)


async def role_ids(db, org="org_default"):
    return {n: r.id for n, r in (await ensure_system_roles(db, org)).items()}


async def audit_rows(db, prefix):
    return (await db.execute(select(AuditLog).where(AuditLog.action.like(f"{prefix}%")).order_by(AuditLog.action))).scalars().all()


async def test_role_round_trip_payload_and_audit(db):
    _, adm = await make_user(db, "boss", "Admin")
    ids = await role_ids(db)
    async with api(adm) as c:
        r = await c.post("/api/auth/roles", json={"name": "Senior Management", "levels": {}})
        rid = r.json()["id"]
        roles = {x["name"]: x for x in (await c.get("/api/auth/roles")).json()}
        assert roles["Senior Management"]["is_active"] is True and roles["Admin"]["is_active"] is True
        assert (await put_role(c, rid, is_active=False)).json() == {"ok": True, "is_active": False}
        assert {x["name"]: x for x in (await c.get("/api/auth/roles")).json()}["Senior Management"]["is_active"] is False
        # Name and levels stay as they were: only the switch moved.
        assert (await put_role(c, rid, is_active=True)).status_code == 200
        assert {x["name"]: x for x in (await c.get("/api/auth/roles")).json()}["Senior Management"]["is_active"] is True
        da = (await c.get("/api/org/data-access")).json()
        assert all("is_active" in x for x in da["roles"])
    rows = [r for r in await audit_rows(db, "role.") if r.action in ("role.activated", "role.deactivated")]  # creating the role also writes a row of its own
    assert [(a.action, a.target, a.detail["old"], a.detail["new"], a.actor_id) for a in rows] == [
        ("role.activated", rid, False, True, "op_boss"), ("role.deactivated", rid, True, False, "op_boss")]
    assert ids["Admin"]


async def test_last_admin_and_own_access_guards(db):
    _, adm = await make_user(db, "boss", "Admin")
    ids = await role_ids(db)
    async with api(adm) as c:
        r = await put_role(c, ids["Admin"], is_active=False)
        assert r.status_code == 400 and "Admin role must stay on" in r.json()["detail"]
        # A second admin role held only by the signed-in admin plus nobody else: switching it off would leave no admin.
        rid = (await c.post("/api/auth/roles", json={"name": "Heads", "is_admin": True})).json()["id"]
        _, other = await make_user(db, "other", "Operator")
        o = (await db.execute(select(Operator).where(Operator.id == "op_other"))).scalars().first()
        await assign_roles(db, o, [rid])
        await db.commit()
        # "boss" still holds the system Admin role, "other" only Heads: Heads can go off, the admin stays.
        assert (await put_role(c, rid, is_active=False)).status_code == 200
        assert (await put_role(c, rid, is_active=True)).status_code == 200
        # Only way in: boss holds Heads alone; the other user holds the system Admin role.
        b = (await db.execute(select(Operator).where(Operator.id == "op_boss"))).scalars().first()
        await assign_roles(db, b, [rid])
        await assign_roles(db, o, [ids["Admin"]])
        await db.commit()
        from app.core import auth_middleware

        auth_middleware.forget()
        r = await put_role(c, rid, is_active=False)
        assert r.status_code == 400 and r.json()["detail"] == "You can't switch this off: it is your only way in as an admin."


async def test_no_active_admin_left_is_refused(db):
    _, adm = await make_user(db, "boss", "Admin")
    ids = await role_ids(db)
    async with api(adm) as c:
        rid = (await c.post("/api/auth/roles", json={"name": "Heads", "is_admin": True})).json()["id"]
        b = (await db.execute(select(Operator).where(Operator.id == "op_boss"))).scalars().first()
        await assign_roles(db, b, [rid, ids["Operator"]])
        await db.commit()
        r = await put_role(c, rid, is_active=False)
        assert r.status_code == 400 and r.json()["detail"] == "You can't switch this off: it would leave no active admin."


async def test_admin_only_and_other_organisation_404(db):
    ids = await role_ids(db)
    _, adm = await make_user(db, "boss", "Admin")
    _, mgr = await make_user(db, "mgr", "Manager")
    async with api(adm) as c:
        lead = (await c.post("/api/auth/roles", json={"name": "Team lead", "levels": {"team": "full"}})).json()["id"]
    m = (await db.execute(select(Operator).where(Operator.id == "op_mgr"))).scalars().first()
    await assign_roles(db, m, [lead])
    await db.commit()
    from app.core import auth_middleware

    auth_middleware.forget()
    _, foreign = await make_user(db, "fadm", "Admin", org_id="org_other")
    async with api(mgr) as c:
        r = await put_role(c, ids["Operator"], is_active=False)
        assert r.status_code == 403 and r.json()["detail"] == "Only admins can switch roles on or off."
    async with api(foreign) as c:
        assert (await put_role(c, ids["Operator"], is_active=False)).status_code == 404
    async with api(adm) as c:
        assert (await put_role(c, "role_nope", is_active=False)).status_code == 404


async def test_only_inactive_role_is_switched_off_on_sign_in_and_live_token(db):
    _, adm = await make_user(db, "boss", "Admin")
    _, tok = await make_user(db, "sam", "Operator", password=PW)
    ids = await role_ids(db)
    async with api(tok) as c:
        assert (await c.get("/api/auth/me")).status_code == 200
    async with api(adm) as c:
        assert (await put_role(c, ids["Operator"], is_active=False)).status_code == 200
    async with api(tok) as c:
        r = await c.get("/api/auth/me")
        assert r.status_code == 403 and r.json()["code"] == "access_off" and r.json()["detail"] == OFF
        assert (await c.get("/api/analytics")).json()["code"] == "access_off"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        r = await anon.post("/api/auth/login", json={"username": "sam", "password": PW})
        assert r.status_code == 403 and r.json() == {"detail": OFF, "code": "access_off"}
    async with api(adm) as c:
        assert (await put_role(c, ids["Operator"], is_active=True)).status_code == 200
    async with api(tok) as c:
        assert (await c.get("/api/auth/me")).status_code == 200


async def test_one_active_one_inactive_role_uses_only_the_active_levels(db):
    _, adm = await make_user(db, "boss", "Admin")
    _, tok = await make_user(db, "viv", "Viewer")
    _, solo = await make_user(db, "solo", "Viewer")
    ids = await role_ids(db)
    v = (await db.execute(select(Operator).where(Operator.id == "op_viv"))).scalars().first()
    await assign_roles(db, v, [ids["Viewer"], ids["Manager"]])
    await db.commit()
    async with api(tok) as c:
        with_manager = (await c.get("/api/auth/me")).json()["permissions"]
    async with api(adm) as c:
        assert (await put_role(c, ids["Manager"], is_active=False)).status_code == 200
    async with api(tok) as c:
        me = (await c.get("/api/auth/me")).json()
    async with api(solo) as c:
        viewer_only = (await c.get("/api/auth/me")).json()["permissions"]
    assert me["permissions"] == viewer_only != with_manager
    assert [r["name"] for r in me["roles"]] == ["Viewer"]


async def test_inactive_admin_role_gives_no_admin(db):
    _, adm = await make_user(db, "boss", "Admin")
    _, tok = await make_user(db, "ann", "Operator")
    async with api(adm) as c:
        rid = (await c.post("/api/auth/roles", json={"name": "Heads", "is_admin": True})).json()["id"]
        ids = await role_ids(db)
        a = (await db.execute(select(Operator).where(Operator.id == "op_ann"))).scalars().first()
        await assign_roles(db, a, [rid, ids["Operator"]])
        await db.commit()
        from app.core import auth_middleware

        auth_middleware.forget()
        async with api(tok) as t:
            assert (await t.get("/api/auth/me")).json()["is_admin"] is True
        assert (await put_role(c, rid, is_active=False)).status_code == 200
        async with api(tok) as t:
            assert (await t.get("/api/auth/me")).json()["is_admin"] is False


async def test_user_deactivate_blocks_sign_in_and_live_session_and_guards(db):
    _, adm = await make_user(db, "boss", "Admin")
    _, tok = await make_user(db, "sam", "Operator", password=PW)
    async with api(adm) as c:
        r = await c.patch("/api/auth/users/op_boss", json={"is_active": False})
        assert r.status_code == 400 and r.json()["detail"] == "You cannot disable your own account."
        r = await c.patch("/api/auth/users/op_sam", json={"is_active": False})
        assert r.status_code == 200 and r.json()["is_active"] is False
    async with api(tok) as c:
        assert (await c.get("/api/auth/me")).status_code == 401
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        r = await anon.post("/api/auth/login", json={"username": "sam", "password": PW})
        assert r.status_code == 403 and r.json()["detail"] == "This account is disabled. Ask your admin."
    async with api(adm) as c:
        assert (await c.patch("/api/auth/users/op_sam", json={"is_active": True})).json()["is_active"] is True
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        assert (await anon.post("/api/auth/login", json={"username": "sam", "password": PW})).status_code == 200
    rows = [r for r in await audit_rows(db, "user.") if r.action in ("user.activated", "user.deactivated")]
    assert [(a.action, a.target, a.detail["old"], a.detail["new"]) for a in rows] == [
        ("user.activated", "op_sam", False, True), ("user.deactivated", "op_sam", True, False)]


async def test_last_active_admin_user_cannot_be_deactivated(db):
    _, adm = await make_user(db, "boss", "Admin")
    _, other = await make_user(db, "two", "Admin")
    async with api(adm) as c:
        assert (await c.patch("/api/auth/users/op_two", json={"is_active": False})).status_code == 200
    _, mgr = await make_user(db, "mgr", "Manager")
    async with api(mgr) as c:
        # boss is now the only active admin; a team manager cannot switch an admin off.
        r = await c.patch("/api/auth/users/op_boss", json={"is_active": False})
        assert r.status_code == 403
    async with api(adm) as c:
        r = await c.patch("/api/auth/users/op_boss", json={"is_active": False})
        assert r.status_code == 400 and r.json()["detail"] == "You cannot disable your own account."



async def test_startup_step_is_idempotent_on_a_fresh_database(db):
    from app.database import engine

    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE roles DROP COLUMN IF EXISTS is_active"))
    async with engine.begin() as conn:
        await M._role_is_active(conn)
        await M._role_is_active(conn)
        row = (await conn.execute(text("SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name='roles' AND column_name='is_active'"))).one()
        assert row[0] == "NO" and "true" in row[1].lower()
    assert "2026_12_03_role_is_active" in [s[0] for s in M.STEPS]
