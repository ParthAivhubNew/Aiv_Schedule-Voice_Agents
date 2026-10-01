"""Staff admin portal (/api/admin-api): its own sign-in with two-factor, client tokens never
accepted, support staff read-only, suspending a client, WhatsApp switch-on, and clients kept
away from provider settings."""
import httpx
import pytest

from tests.conftest import make_staff, make_user

pytestmark = pytest.mark.db


def _as(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"} if token else {})


@pytest.fixture(autouse=True)
def _fresh_limits():
    from app.api import admin_portal

    admin_portal._FAILS.clear()
    yield
    admin_portal._FAILS.clear()


async def test_first_sign_in_sets_up_two_factor_then_asks_for_the_code(anon, db):
    from app.core.security import hash_password
    from app.core.staff import totp_now
    from app.models.models import StaffUser

    db.add(StaffUser(id="stf_new", email="new@outreach.test", name="New", role="staff_admin",
                     hashed_password=hash_password("Staff-pass-2026")))
    await db.commit()
    creds = {"email": "New@Outreach.test", "password": "Staff-pass-2026"}

    assert (await anon.post("/api/admin-api/login", json={**creds, "password": "wrong"})).status_code == 401
    setup = (await anon.post("/api/admin-api/login", json=creds)).json()
    assert setup["setup"] is True and setup["otpauth"].startswith("otpauth://totp/")
    assert (await anon.post("/api/admin-api/2fa/confirm", json={"ticket": setup["ticket"], "code": "000000"})).status_code == 401
    r = await anon.post("/api/admin-api/2fa/confirm", json={"ticket": setup["ticket"], "code": totp_now(setup["secret"])})
    assert r.status_code == 200 and r.json()["staff"]["role"] == "staff_admin"
    token = r.json()["token"]

    # From now on the password alone is not enough, and the secret is never shown again.
    assert (await anon.post("/api/admin-api/login", json=creds)).json() == {"codeRequired": True}
    assert (await anon.post("/api/admin-api/login", json={**creds, "code": "123456"})).status_code == 401
    r = await anon.post("/api/admin-api/login", json={**creds, "code": totp_now(setup["secret"])})
    assert r.status_code == 200 and r.json()["token"]
    async with _as(token) as c:
        assert (await c.get("/api/admin-api/me")).json()["email"] == "new@outreach.test"


async def test_wrong_codes_are_rate_limited(anon, db):
    from app.core.security import hash_password
    from app.models.models import StaffUser

    db.add(StaffUser(id="stf_rl", email="rl@outreach.test", hashed_password=hash_password("Staff-pass-2026"), totp_enabled=True,
                     totp_secret_sealed=""))
    await db.commit()
    for _ in range(6):
        await anon.post("/api/admin-api/login", json={"email": "rl@outreach.test", "password": "nope"})
    r = await anon.post("/api/admin-api/login", json={"email": "rl@outreach.test", "password": "Staff-pass-2026"})
    assert r.status_code == 429


async def test_client_tokens_never_open_the_admin_portal_and_staff_tokens_never_open_the_app(admin_token, staff, anon, db):
    assert (await anon.get("/api/admin-api/dashboard")).status_code == 401
    async with _as(admin_token) as c:  # even the platform organisation's own admin
        assert (await c.get("/api/admin-api/dashboard")).status_code == 401
        assert (await c.get("/api/admin-api/clients")).status_code == 401
    token = staff.headers["authorization"][7:]
    async with _as(token) as c:
        assert (await c.get("/api/auth/me")).status_code == 401
        assert (await c.get("/api/credits")).status_code == 401
    dash = (await staff.get("/api/admin-api/dashboard")).json()
    assert dash["clients"] >= 1 and "pendingVerifications" in dash
    assert set((await staff.get("/api/admin-api/platform")).json()) >= {"telnyx", "stripe", "mail"}


async def test_switched_off_staff_and_reset_two_factor_lose_access(staff, db):
    token = await make_staff(db, "helper@outreach.test", "staff_support")
    async with _as(token) as c:
        assert (await c.get("/api/admin-api/clients")).status_code == 200
    rows = {s["email"]: s for s in (await staff.get("/api/admin-api/staff")).json()}
    helper = rows["helper@outreach.test"]["id"]
    assert (await staff.patch(f"/api/admin-api/staff/{helper}", json={"reset2fa": True})).status_code == 200
    async with _as(token) as c:
        assert (await c.get("/api/admin-api/clients")).status_code == 401
    me_id = rows["ops@outreach.test"]["id"]
    assert (await staff.patch(f"/api/admin-api/staff/{me_id}", json={"active": False})).status_code == 400


async def test_support_staff_can_look_but_not_change(db):
    await make_user(db, "acme_admin", "Admin", org_id="org_acme")
    token = await make_staff(db, "support@outreach.test", "staff_support")
    async with _as(token) as c:
        assert (await c.get("/api/admin-api/clients/org_acme")).status_code == 200
        assert (await c.get("/api/admin-api/verifications")).status_code == 200
        assert (await c.get("/api/admin-api/plans")).status_code == 200
        assert (await c.get("/api/admin-api/logs")).status_code == 200
        for verb, url, body in [
            ("post", "/api/admin-api/clients/org_acme/status", {"status": "suspended"}),
            ("post", "/api/admin-api/clients/org_acme/credits", {"wallet": "voice", "amount": 100}),
            ("put", "/api/admin-api/clients/org_acme/enforce", {"enforce": False}),
            ("put", "/api/admin-api/rates", {"rates": {"voice_minute": 1}}),
            ("post", "/api/admin-api/plans", {"wallet": "voice", "name": "x", "priceUsdCents": 100, "credits": 1}),
            ("post", "/api/admin-api/staff", {"email": "x@outreach.test", "password": "Staff-pass-2026"}),
        ]:
            assert (await getattr(c, verb)(url, json=body)).status_code == 403, url


async def test_suspending_a_client_signs_everyone_out(staff, anon, db):
    _, token = await make_user(db, "acme_admin", "Admin", org_id="org_acme", password="Acme-pass-2026")
    async with _as(token) as c:
        assert (await c.get("/api/auth/me")).status_code == 200
    r = await staff.post("/api/admin-api/clients/org_acme/status", json={"status": "suspended"})
    assert r.json() == {"id": "org_acme", "status": "suspended"}
    async with _as(token) as c:
        assert (await c.get("/api/auth/me")).status_code == 401
    r = await anon.post("/api/auth/login", json={"username": "acme_admin", "password": "Acme-pass-2026"})
    assert r.status_code == 403
    clients = {o["id"]: o for o in (await staff.get("/api/admin-api/clients")).json()}
    assert clients["org_acme"]["status"] == "suspended"

    assert (await staff.post("/api/admin-api/clients/org_acme/status", json={"status": "active"})).status_code == 200
    async with _as(token) as c:
        assert (await c.get("/api/auth/me")).status_code == 200
    assert (await staff.post("/api/admin-api/clients/nope/status", json={"status": "active"})).status_code == 404


async def test_whatsapp_request_reaches_staff_and_is_switched_on(staff, db):
    from app.core.tenancy import org_scope
    from app.models.models import OrgPhoneNumber

    _, token = await make_user(db, "acme_admin", "Admin", org_id="org_acme")
    with org_scope("org_acme"):
        db.add(OrgPhoneNumber(id="num_wa", e164="+442071230000", provider="telnyx", provider_ref="pn_wa", status="active", capabilities=["voice"]))
        await db.commit()
    async with _as(token) as c:
        assert (await c.post("/api/wa/numbers/num_wa/request")).status_code == 200
    queue = (await staff.get("/api/admin-api/verifications")).json()
    assert [w["numberId"] for w in queue["whatsappRequests"]] == ["num_wa"]
    r = await staff.post("/api/admin-api/clients/org_acme/numbers/num_wa/whatsapp", json={"enabled": True})
    assert r.json()["capabilities"] == ["voice", "whatsapp"]
    assert (await staff.get("/api/admin-api/verifications")).json()["whatsappRequests"] == []
    assert (await staff.post("/api/admin-api/clients/org_acme/numbers/missing/whatsapp", json={"enabled": True})).status_code == 404


async def test_client_organisations_cannot_change_provider_settings(client, db):
    _, token = await make_user(db, "acme_admin", "Admin", org_id="org_acme")
    async with _as(token) as c:
        r = await c.post("/api/connections/test", json={})
        assert r.status_code == 403 and r.json()["code"] == "managed_by_outreach"
        assert (await c.get("/api/connections/telephony-hub/status")).status_code == 403
        assert (await c.post("/api/scheduler/ai-settings", json={"textProvider": "openai"})).status_code == 403
        assert (await c.post("/api/scheduler/ai-settings/test")).status_code == 403
        me = (await c.get("/api/auth/me")).json()
    assert me["is_platform_org"] is False
    assert (await client.get("/api/auth/me")).json()["is_platform_org"] is False  # Aivhub is a normal client company now


async def test_staff_choose_the_post_scheduler_ai_for_every_company(staff, db):
    from app.api.scheduler import _load_ai_settings, _resolve_image_prefs
    from app.core.tenancy import org_scope

    got = (await staff.get("/api/admin-api/platform-ai")).json()
    assert got["chosen"]["textProvider"] == "" and got["chosen"]["textBackupProvider"] == ""
    assert "openai" in got["textProviders"] and "fal" in got["imageProviders"]
    assert (await staff.put("/api/admin-api/platform-ai", json={"textProvider": "nope"})).status_code == 400
    assert (await staff.put("/api/admin-api/platform-ai", json={"imageBackupProvider": "nope"})).status_code == 400
    r = await staff.put("/api/admin-api/platform-ai", json={
        "textProvider": "openai", "textModel": "gpt-test", "imageProvider": "fal",
        "textBackupProvider": "deepseek", "textBackupModel": "deepseek-chat"})
    assert r.status_code == 200 and r.json()["imageProvider"] == "fal" and r.json()["textBackupProvider"] == "deepseek"
    support = await make_staff(db, "support2@outreach.test", "staff_support")
    async with _as(support) as c:
        assert (await c.put("/api/admin-api/platform-ai", json={"imageProvider": "openai"})).status_code == 403
        assert (await c.post("/api/admin-api/platform-ai/test", json={"kind": "text"})).status_code == 403

    await make_user(db, "acme_admin", "Admin", org_id="org_acme")
    with org_scope("org_acme"):  # a client: staff's choice, whatever the request asks for
        prefs = await _load_ai_settings(db)
        assert (prefs["textProvider"], prefs["textModel"], prefs["imageProvider"]) == ("openai", "gpt-test", "fal")
        assert (await _load_ai_settings(db, "backup"))["textProvider"] == "deepseek"
        img = await _resolve_image_prefs(db, {"image_provider": "pollinations", "image_api_key": "sk-x",
                                              "image_base_url": "https://evil.example", "aspectRatio": "1:1"})
        assert img["provider"] == "fal" and img["api_key"] is None and img["base_url"] is None
        assert img["aspect_ratio"] == "1:1"  # the look is the company's own
    # Aivhub and OutReach itself use the very same choice: there is one AI stack.
    assert (await _load_ai_settings(db))["textProvider"] == "openai"
    with org_scope("org_outreach"):
        assert (await _load_ai_settings(db))["textProvider"] == "openai"

    # Clearing the backup provider clears its model too.
    r = await staff.put("/api/admin-api/platform-ai", json={"textBackupProvider": ""})
    assert r.json()["textBackupModel"] == ""
    r = await staff.post("/api/admin-api/platform-ai/test", json={"kind": "text", "slot": "backup"})
    assert r.json() == {"ok": False, "error": "No backup is set."}


