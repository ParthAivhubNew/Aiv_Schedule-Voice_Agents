"""OutReach (the platform record) holds the provider keys; Aivhub is a normal paying company."""
import pytest

from tests.conftest import make_staff, make_user

pytestmark = pytest.mark.db


async def _split():
    from app.core.platform import split_platform
    from app.database import engine

    async with engine.begin() as conn:
        await split_platform(conn)


async def test_aivhubs_provider_keys_move_to_the_platform(db):
    from sqlalchemy import text

    from app.core.tenancy import system_scope

    await db.execute(text(
        "INSERT INTO connections (id, org_id, group_name, name, status, config) VALUES "
        "('c_llm', 'org_default', 'LLM', 'OpenAI', 'connected', '{}'), "
        "('c_img', 'org_default', 'IMAGE', 'fal', 'connected', '{}'), "
        "('c_cal', 'org_default', 'Calendar', 'Cal.com', 'connected', '{}')"))
    await db.commit()
    await _split()
    await _split()  # running it again changes nothing
    with system_scope():
        rows = dict((await db.execute(text("SELECT id, org_id FROM connections"))).all())
        orgs = dict((await db.execute(text("SELECT id, status FROM organizations"))).all())
        name = (await db.execute(text("SELECT name FROM organizations WHERE id = 'org_default'"))).scalar()
    assert rows == {"c_llm": "org_outreach", "c_img": "org_outreach", "c_cal": "org_default"}
    assert orgs == {"org_default": "active", "org_outreach": "platform"} and name == "Aivhub"


async def test_aivhub_gets_demo_credits_once_and_its_own_password(db, monkeypatch):
    from sqlalchemy.future import select

    from app.core.platform import ensure_aivhub_ready
    from app.core.security import verify_password
    from app.core.tenancy import org_scope
    from app.models.models import Operator
    from app.services import credits as K

    await _split()
    admin, _ = await make_user(db, "admin", "Admin", must_change=True)
    admin_id = admin.id
    monkeypatch.setenv("AIVHUB_ADMIN_PASSWORD", "Aivhub-Demo-2026!x")
    await ensure_aivhub_ready()
    await ensure_aivhub_ready()  # credits are given once only
    db.expire_all()
    with org_scope("org_default"):
        assert {w: await K.wallet_balance(db, w) for w in K.WALLETS} == {w: 500 for w in K.WALLETS}
        assert (await K.org_settings(db))["enforce"] is True
        op = (await db.execute(select(Operator).where(Operator.id == admin_id))).scalars().first()
    assert verify_password("Aivhub-Demo-2026!x", op.hashed_password) and op.must_change_password is False


async def test_staff_manage_platform_keys_and_clients_never_see_the_platform(db, staff, monkeypatch):
    import httpx

    from app.main import app

    async def ok(*a, **k):
        return {"valid": True, "details": "ok"}

    monkeypatch.setattr("app.api.connections.validate_api_key", ok)
    await _split()
    await make_user(db, "acme_admin", "Admin", org_id="org_acme")

    r = await staff.post("/api/admin-api/platform-keys/save", json={"layer": "LLM", "provider": "OpenAI", "api_key": "sk-test-0123456789abcdef"})
    assert r.status_code == 200, r.text
    got = (await staff.get("/api/admin-api/platform-keys")).json()
    llm = next(g for g in got["groups"] if g["group"] == "LLM")["items"]
    item = next(i for i in llm if i["name"] == "OpenAI")
    assert item["status"] == "connected" and "0123456789abcdef" not in str(got)
    assert any(g["group"] == "IMAGE" for g in got["groups"])
    assert (await staff.post("/api/admin-api/platform-keys/assistant", json={"assistant_id": "asst_1"})).json()["assistantId"] == "asst_1"

    # Support staff can look but not change.
    token = await make_staff(db, "support@outreach.test", "staff_support")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                 headers={"Authorization": f"Bearer {token}"}) as c:
        assert (await c.get("/api/admin-api/platform-keys")).status_code == 200
        assert (await c.post("/api/admin-api/platform-keys/clear", json={"id": item["id"]})).status_code == 403

    # Every company uses the key; the platform is never a client.
    from sqlalchemy.future import select

    from app.core.tenancy import org_scope
    from app.models.models import Connection

    with org_scope("org_acme"):
        seen = (await db.execute(select(Connection).where(Connection.group_name == "LLM"))).scalars().all()
        assert [c.id for c in seen] == [item["id"]]
    await db.rollback()
    ids = [c["id"] for c in (await staff.get("/api/admin-api/clients")).json()]
    assert "org_outreach" not in ids and {"org_default", "org_acme"} <= set(ids)
    assert (await staff.get("/api/admin-api/clients/org_outreach")).status_code == 404

    assert (await staff.post("/api/admin-api/platform-keys/clear", json={"id": item["id"]})).json()["status"] == "not_configured"
