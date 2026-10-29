"""The partner programme: apply, approval, sign-up and login from a partner's own pages, keys, revoking, sandbox, free accounts."""
import base64

import httpx
import pytest
from sqlalchemy.future import select

from tests.conftest import make_user

pytestmark = pytest.mark.db

ORIGIN = "https://app.partner.test"
RETURN = "https://app.partner.test/connected"
PW = "Str0ng-pass-2026!"


@pytest.fixture(autouse=True)
def quiet_limits(monkeypatch):
    """Sign-up and API limits are per address in memory; every test starts fresh, and no real email goes out."""
    from app.api import auth as A
    from app.api import signup as S
    from app.public_api import core

    S._HITS.clear()
    A._FAILS.clear()
    core._WINDOWS.clear()
    monkeypatch.setattr("app.core.mailer.configured", lambda: False)


async def run(client, plugin, action, data=None, id=None, origin=ORIGIN, key=None):
    headers = {}
    if origin:
        headers["Origin"] = origin
    if key:
        headers["Authorization"] = f"Bearer {key}"
    body = {"plugin": plugin, "action": action}
    if data is not None:
        body["data"] = data
    if id:
        body["id"] = id
    return await client.post("/api/v1/run", json=body, headers=headers)


@pytest.fixture
async def partner(client, staff):
    """An approved partner in the sandbox that accepted the terms and set its addresses: returns its client_id."""
    r = await client.post("/api/partner/apply", json={"company": "Acme CRM", "product": "Acme CRM", "use_case": "Calls from our CRM",
                                                       "contact_email": "dev@acme.test"})
    assert r.status_code == 200, r.text
    r = await staff.post(f"/api/admin-api/partners/applications/{r.json()['id']}/approve", json={"note": "ok"})
    assert r.status_code == 200, r.text
    info = (await client.get("/api/partner")).json()["partner"]
    assert info["status"] == "sandbox" and info["clientId"].startswith("pk_")
    assert (await client.post("/api/partner/accept-terms")).status_code == 200
    r = await client.put("/api/partner/settings", json={"allowed_origins": [ORIGIN + "/path-is-dropped"], "return_urls": [RETURN]})
    assert r.status_code == 200 and r.json()["allowedOrigins"] == [ORIGIN]
    return info["clientId"]


def _signup(cid, **over):
    return {"client_id": cid, "company": "Newco", "name": "Nia New", "email": "nia@newco.test", "password": PW,
            "consent": True, "consent_version": "2026-10", "return_url": RETURN, **over}


# ── Applying and approval ───────────────────────────────────────────────────

async def test_apply_approve_and_terms(client, staff):
    r = await client.post("/api/partner/apply", json={"company": "Acme CRM"})
    assert r.status_code == 200 and r.json()["status"] == "pending"
    assert (await client.post("/api/partner/apply", json={"company": "Acme again"})).status_code == 409  # one waiting at a time
    assert (await client.get("/api/partner")).json()["partner"] is None
    listing = (await staff.get("/api/admin-api/partners")).json()
    assert listing["pending"] == 1
    app_id = listing["applications"][0]["id"]
    assert (await staff.post(f"/api/admin-api/partners/applications/{app_id}/approve", json={})).status_code == 200
    assert (await staff.post(f"/api/admin-api/partners/applications/{app_id}/approve", json={})).status_code == 409
    p = (await client.get("/api/partner")).json()["partner"]
    assert p["status"] == "sandbox" and p["webhookSecret"].startswith("whsec_")
    assert (await client.post("/api/partner/request-live")).status_code == 409  # terms first
    assert (await client.put("/api/partner/settings", json={"accent_color": "red"})).status_code == 400


async def test_rejected_application_can_apply_again(client, staff):
    app_id = (await client.post("/api/partner/apply", json={"company": "Acme CRM"})).json()["id"]
    assert (await staff.post(f"/api/admin-api/partners/applications/{app_id}/reject", json={"note": "not now"})).status_code == 200
    assert (await client.post("/api/partner/apply", json={"company": "Acme CRM"})).status_code == 200


async def test_only_staff_admins_decide(client, db):
    from tests.conftest import make_staff

    app_id = (await client.post("/api/partner/apply", json={"company": "Acme CRM"})).json()["id"]
    token = await make_staff(db, "support@outreach.test", role="staff_support")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=__import__("app.main", fromlist=["app"]).app), base_url="http://test",
                                 headers={"Authorization": f"Bearer {token}"}) as support:
        assert (await support.post(f"/api/admin-api/partners/applications/{app_id}/approve", json={})).status_code == 403
        assert (await support.get("/api/admin-api/partners")).status_code == 200


async def test_not_a_partner_before_approval(anon, client):
    r = await run(anon, "auth", "signup", _signup("pk_unknown"))
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_client"


# ── Signing up from the partner's page ──────────────────────────────────────

async def test_signup_gives_a_sandbox_key_and_a_free_account(anon, db, partner):
    from app.models.models import Organization, PartnerLink, WebhookEndpoint

    r = await run(anon, "auth", "signup", _signup(partner))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["api_key"].startswith("sk_test_") and out["key_mode"] == "test" and out["account"]["company"] == "Newco"
    org = (await db.execute(select(Organization).where(Organization.id == out["account"]["org_id"]))).scalars().first()
    assert org.referred_by_partner_id
    link = (await db.execute(select(PartnerLink).where(PartnerLink.org_id == org.id))).scalars().first()
    assert link.status == "active" and link.created_account and link.consent_version == "2026-10"
    # The key works on /v1 and only reaches its own account
    me = await run(anon, "auth", "me", key=out["api_key"], origin=None)
    assert me.status_code == 200 and me.json()["account"]["org_id"] == org.id and me.json()["key_mode"] == "test"
    assert (await run(anon, "account", "wallet", key=out["api_key"], origin=None)).status_code == 200
    # No webhook address set yet: nothing registered
    assert not (await db.execute(select(WebhookEndpoint).where(WebhookEndpoint.org_id == org.id))).scalars().all()


async def test_signup_checks(anon, partner):
    base = _signup(partner)
    r = await run(anon, "auth", "signup", {**base, "consent": False})
    assert r.status_code == 422 and r.json()["error"]["code"] == "consent_required"
    r = await run(anon, "auth", "signup", {**base, "consent_version": ""})
    assert r.json()["error"]["code"] == "consent_version_required"
    r = await run(anon, "auth", "signup", {**base, "return_url": "https://evil.test/steal"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "return_url_not_allowed"
    r = await run(anon, "auth", "signup", base, origin="https://evil.test")
    assert r.status_code == 403 and r.json()["error"]["code"] == "origin_not_allowed"
    r = await run(anon, "auth", "signup", {**base, "password": "short"})
    assert r.status_code == 400
    r = await run(anon, "auth", "signup", {**base, "website": "bot"})
    assert r.status_code == 400  # the honeypot
    assert (await run(anon, "auth", "signup", base)).status_code == 200
    r = await run(anon, "auth", "signup", base)  # the same email again
    assert r.status_code == 400 and r.json()["error"]["code"] == "account_exists"
    # A call from the partner's own server has no Origin and is allowed
    assert (await run(anon, "auth", "signup", _signup(partner, email="b@newco.test"), origin=None)).status_code == 200


async def test_signup_waits_for_the_email_link_then_returns_to_the_partner(anon, partner, monkeypatch):
    sent = []

    async def fake_send(op, ret="", partner_name=""):
        sent.append((op.email, ret, partner_name))
        return True

    monkeypatch.setattr("app.core.mailer.configured", lambda: True)
    monkeypatch.setattr("app.api.signup._send_verification", fake_send)
    r = await run(anon, "auth", "signup", _signup(partner))
    assert r.status_code == 200 and r.json()["verify_email"] is True and "api_key" not in r.json()
    assert sent == [("nia@newco.test", RETURN, "Acme CRM")]
    # Not confirmed yet: login says so
    r = await run(anon, "auth", "login", {"client_id": partner, "email": "nia@newco.test", "password": PW, "consent": True, "consent_version": "2026-10"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "email_not_verified"
    # The confirmation link sends the user back to the partner's address
    from app.api import signup as S
    from app.models.models import Operator

    op = await _operator(anon, "nia@newco.test")
    token = S._sign({"typ": "verify_email", "sub": op.id, "email": "nia@newco.test", "ret": RETURN}, 600)
    res = await anon.get(f"/api/auth/verify-email?t={token}")
    assert res.status_code == 303 and res.headers["location"] == RETURN + "?verified=1"
    r = await run(anon, "auth", "login", {"client_id": partner, "email": "nia@newco.test", "password": PW, "consent": True, "consent_version": "2026-10"})
    assert r.status_code == 200 and r.json()["api_key"].startswith("sk_test_")


async def _operator(_client, email):
    from sqlalchemy import func

    from app.database import AsyncSessionLocal
    from app.models.models import Operator

    async with AsyncSessionLocal() as s:
        return (await s.execute(select(Operator).where(func.lower(Operator.email) == email))).scalars().first()


# ── Logging in with an account that already exists ──────────────────────────

async def test_login_links_an_existing_account(anon, db, partner):
    from app.models.models import PartnerLink

    await make_user(db, "owner@shop.test", "Admin", password=PW, org_id="org_shop")
    base = {"client_id": partner, "email": "owner@shop.test", "password": PW}
    r = await run(anon, "auth", "login", base)
    assert r.status_code == 422 and r.json()["error"]["code"] == "consent_required"  # the first connection needs consent
    r = await run(anon, "auth", "login", {**base, "password": "wrong"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "bad_credentials"
    r = await run(anon, "auth", "login", {**base, "consent": True, "consent_version": "2026-10"})
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["account"]["org_id"] == "org_shop" and first["key_mode"] == "test"
    link = (await db.execute(select(PartnerLink).where(PartnerLink.org_id == "org_shop"))).scalars().first()
    assert link.status == "active" and not link.created_account
    # Logging in again needs no new consent, and the earlier key stops working
    r = await run(anon, "auth", "login", base)
    assert r.status_code == 200 and r.json()["api_key"] != first["api_key"]
    assert (await run(anon, "auth", "me", key=first["api_key"], origin=None)).status_code == 401
    assert (await run(anon, "auth", "me", key=r.json()["api_key"], origin=None)).status_code == 200


async def test_only_an_admin_can_connect_an_account(anon, db, partner):
    await make_user(db, "boss@shop.test", "Admin", password=PW, org_id="org_shop")
    await make_user(db, "intern@shop.test", "Operator", password=PW, org_id="org_shop")
    r = await run(anon, "auth", "login", {"client_id": partner, "email": "intern@shop.test", "password": PW, "consent": True, "consent_version": "2026-10"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "admin_required"


async def test_login_locks_after_failed_attempts(anon, db, partner):
    await make_user(db, "owner@shop.test", "Admin", password=PW, org_id="org_shop")
    for _ in range(8):
        await run(anon, "auth", "login", {"client_id": partner, "email": "owner@shop.test", "password": "nope"})
    r = await run(anon, "auth", "login", {"client_id": partner, "email": "owner@shop.test", "password": PW, "consent": True, "consent_version": "2026-10"})
    assert r.status_code == 429


# ── Revoking ────────────────────────────────────────────────────────────────

async def test_the_user_can_disconnect_the_partner(db, anon, partner):
    _, token = await make_user(db, "owner@shop.test", "Admin", password=PW, org_id="org_shop")
    key = (await run(anon, "auth", "login", {"client_id": partner, "email": "owner@shop.test", "password": PW,
                                              "consent": True, "consent_version": "2026-10"})).json()["api_key"]
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as owner:
        conns = (await owner.get("/api/partner/connections")).json()["connections"]
        assert [c["partner"] for c in conns] == ["Acme CRM"]
        assert (await owner.delete(f"/api/partner/connections/{conns[0]['id']}")).status_code == 200
        assert (await owner.get("/api/partner/connections")).json()["connections"] == []
    assert (await run(anon, "auth", "me", key=key, origin=None)).status_code == 401
    # A different account's admin cannot disconnect it
    assert (await run(anon, "auth", "login", {"client_id": partner, "email": "owner@shop.test", "password": PW})).status_code == 422


async def test_the_partner_can_disconnect_an_account(client, anon, partner):
    out = (await run(anon, "auth", "signup", _signup(partner))).json()
    links = (await client.get("/api/partner/links")).json()["links"]
    assert len(links) == 1 and links[0]["status"] == "active" and links[0]["createdAccount"]
    assert (await client.delete(f"/api/partner/links/{links[0]['id']}")).status_code == 200
    assert (await client.get("/api/partner/links?status=revoked")).json()["links"][0]["revokedBy"] == "partner"
    assert (await run(anon, "auth", "me", key=out["api_key"], origin=None)).status_code == 401


async def test_the_key_can_disconnect_itself(anon, partner):
    out = (await run(anon, "auth", "signup", _signup(partner))).json()
    assert (await run(anon, "auth", "disconnect", key=out["api_key"], origin=None)).json()["status"] == "revoked"
    assert (await run(anon, "auth", "me", key=out["api_key"], origin=None)).status_code == 401


# ── Pausing and going live ──────────────────────────────────────────────────

async def test_suspending_a_partner_stops_its_keys_and_new_sign_ups(client, staff, anon, partner):
    key = (await run(anon, "auth", "signup", _signup(partner))).json()["api_key"]
    pid = (await client.get("/api/partner")).json()["partner"]["id"]
    r = await staff.post(f"/api/admin-api/partners/{pid}/status", json={"status": "suspended"})
    assert r.status_code == 200 and r.json()["keysStopped"] == 1
    assert (await run(anon, "auth", "me", key=key, origin=None)).status_code == 401
    r = await run(anon, "auth", "signup", _signup(partner, email="other@newco.test"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "partner_suspended"
    assert (await staff.post(f"/api/admin-api/partners/{pid}/status", json={"status": "paused"})).status_code == 400


async def test_live_partners_get_live_keys_that_work_without_a_plan(client, staff, anon, partner):
    pid = (await client.get("/api/partner")).json()["partner"]["id"]
    assert (await client.post("/api/partner/request-live")).status_code == 200
    assert (await staff.post(f"/api/admin-api/partners/{pid}/status", json={"status": "live"})).status_code == 200
    out = (await run(anon, "auth", "signup", _signup(partner))).json()
    assert out["api_key"].startswith("sk_live_") and out["key_mode"] == "live"
    # The programme is free: a new account needs no plan for the Voice features
    r = await run(anon, "voice", "scripts.list", key=out["api_key"], origin=None)
    assert r.status_code != 402, r.text


# ── The one endpoint stays closed to everything else ────────────────────────

async def test_without_a_key_only_the_public_auth_actions_work(anon, partner):
    assert (await run(anon, "mail", "mailboxes.list", origin=None)).status_code == 401
    assert (await run(anon, "account", "wallet", origin=None)).status_code == 401
    assert (await run(anon, "auth", "me", origin=None)).status_code == 401
    assert (await run(anon, "auth", "disconnect", origin=None)).status_code == 401
    assert (await run(anon, "auth", "nothing", {"client_id": partner})).status_code == 401  # not public, so it never gets in


async def test_a_login_token_does_not_open_the_partner_actions(client):
    assert (await client.post("/api/v1/run", json={"plugin": "auth", "action": "me"})).status_code in (401, 403)


async def test_auth_actions_cannot_be_read_as_links(anon, partner):
    r = await anon.get(f"/api/v1/run?plugin=auth&action=login&client_id={partner}")
    assert r.status_code == 401


# ── Webhooks and numbers ────────────────────────────────────────────────────

async def test_events_reach_the_partner_webhook(client, db, anon, partner):
    from app.models.models import WebhookEndpoint

    r = await client.put("/api/partner/settings", json={"webhook_url": "http://localhost:9/hook"})
    assert r.status_code == 200, r.text
    secret = r.json()["webhookSecret"]
    out = (await run(anon, "auth", "signup", _signup(partner))).json()
    eps = (await db.execute(select(WebhookEndpoint).where(WebhookEndpoint.org_id == out["account"]["org_id"]))).scalars().all()
    assert len(eps) == 1 and eps[0].url == "http://localhost:9/hook" and eps[0].secret == secret and eps[0].is_active
    rotated = (await client.post("/api/partner/webhook-secret/rotate")).json()["webhookSecret"]
    await db.refresh(eps[0])
    assert rotated != secret and eps[0].secret == rotated
    await run(anon, "auth", "disconnect", key=out["api_key"], origin=None)
    await db.refresh(eps[0])
    assert eps[0].is_active is False


async def test_a_private_webhook_address_is_refused(client, partner):
    r = await client.put("/api/partner/settings", json={"webhook_url": "http://10.0.0.5/hook"})
    assert r.status_code == 400


async def test_numbers_in_the_sandbox(anon, partner):
    key = (await run(anon, "auth", "signup", _signup(partner))).json()["api_key"]
    r = await run(anon, "numbers", "search", {"country": "GB"}, key=key, origin=None)
    assert r.status_code == 200 and r.json()["test"] is True and len(r.json()["data"]) == 3
    r = await run(anon, "numbers", "order", {"phone_number": "+442030001001"}, key=key, origin=None)
    assert r.json()["status"] == "pending"
    assert (await run(anon, "numbers", "release", key=key, origin=None)).status_code == 422  # needs the number's id
    assert (await run(anon, "numbers", "release", id="num_1", key=key, origin=None)).json()["ok"] is True
    assert (await run(anon, "numbers", "nothing", key=key, origin=None)).status_code == 422
    doc = {"filename": "reg.pdf", "content_type": "application/pdf", "content_base64": base64.b64encode(b"%PDF-1").decode()}
    r = await run(anon, "numbers", "verification.submit", {"country": "GB", "documents": {"proof": doc}}, key=key, origin=None)
    assert r.status_code == 200 and r.json()["status"] == "approved"


async def test_numbers_need_the_voice_permission(db, anon, partner, client):
    await client.put("/api/partner/settings", json={})
    from app.models.models import ApiKey
    from app.core.security import generate_api_key

    raw, prefix, hashed = generate_api_key(live=False)
    db.add(ApiKey(id="key_social", org_id="org_default", name="social only", prefix=prefix, hashed_key=hashed, scopes=["social:publish"]))
    await db.commit()
    r = await run(anon, "numbers", "search", {}, key=raw, origin=None)
    assert r.status_code == 403 and r.json()["error"]["code"] == "missing_scope"


async def test_the_public_page_needs_no_sign_in(anon):
    r = await anon.get("/build-with-outreach")
    assert r.status_code == 200 and "Build with Outreach" in r.text
    for supplier in ("Telnyx", "xAI", "Stripe"):
        assert supplier not in r.text


async def test_the_owner_is_emailed_when_a_partner_applies_and_when_it_asks_to_go_live(client, monkeypatch):
    sent = []

    async def staff_emails():
        return ["owner@outreach.test"]

    async def send(to, subject, html, text, reply_to=None):
        sent.append((to, subject, html))
        return {"ok": True}

    monkeypatch.setattr("app.services.ai_errors._staff_emails", staff_emails)
    monkeypatch.setattr("app.core.mailer.send_system_email", send)
    r = await client.post("/api/partner/apply", json={"company": "Acme <b>CRM</b>", "product": "Acme", "use_case": "Calls", "contact_email": "a@acme.test"})
    assert r.status_code == 200
    assert [s[:2] for s in sent] == [("owner@outreach.test", "New partner application: Acme <b>CRM</b>")]
    assert "<b>CRM</b>" not in sent[0][2] and "&lt;b&gt;CRM" in sent[0][2]  # what the applicant typed is shown as text, never as markup


# ── Activity record ─────────────────────────────────────────────────────────

async def test_admin_changes_are_recorded_and_no_secret_is_in_them(anon, client, staff, partner):
    out = (await run(anon, "auth", "signup", _signup(partner))).json()
    key = (await client.post("/api/partner/secret/rotate")).json()["secretKey"]
    assert (await client.post("/api/partner/webhook-secret/rotate")).status_code == 200
    assert (await client.put("/api/partner/settings", json={"logo_url": "https://app.partner.test/l.png"})).status_code == 200
    link = (await client.get("/api/partner/links")).json()["links"][0]
    assert (await client.delete(f"/api/partner/links/{link['id']}")).status_code == 200
    rows = (await client.get("/api/partner/activity")).json()["activity"]
    actions = [r["action"] for r in rows]
    for want in ("application_approved", "terms_accepted", "settings_changed", "secret_key_rotated", "webhook_secret_rotated",
                 "account_connected", "account_disconnected"):
        assert want in actions, (want, actions)
    assert rows[0]["at"] and rows[0]["actor"]
    assert key not in str(rows) and out["api_key"] not in str(rows)
    pid = (await client.get("/api/partner")).json()["partner"]["id"]
    seen = (await staff.get(f"/api/admin-api/partners/{pid}/activity")).json()["activity"]
    assert len(seen) == len(rows)
    assert (await staff.post(f"/api/admin-api/partners/{pid}/status", json={"status": "live"})).status_code == 200
    seen = (await staff.get(f"/api/admin-api/partners/{pid}/activity")).json()["activity"]
    assert seen[0]["action"] == "status_changed" and seen[0]["detail"] == "sandbox -> live" and seen[0]["actor"].startswith("staff:")


async def test_a_past_webhook_delivery_can_be_replayed_with_the_same_event_id(client, db, monkeypatch):
    from app.models.models import WebhookDeliveryLog, WebhookEndpoint
    from app.services import webhook_dispatcher as W

    sent = []

    async def fake(ep, event_id, event_type, data, test=False):
        sent.append((event_id, event_type, data))
        return {"success": True, "status_code": 200, "duration_ms": 1, "error": None, "blocked": False}

    monkeypatch.setattr("app.api.developer_webhooks.deliver_to_endpoint", fake)
    monkeypatch.setattr(W, "url_problem", lambda *a, **k: "")
    monkeypatch.setattr("app.api.developer_webhooks.url_problem", lambda *a, **k: "")
    made = await client.post("/api/developer/webhooks", json={"url": "https://hooks.partner.test/in", "events": ["call.completed"]})
    assert made.status_code in (200, 201), made.text
    ep = made.json().get("endpoint") or made.json()
    db.add(WebhookDeliveryLog(id="whlog_t1", endpoint_id=ep["id"], org_id=(await db.get(WebhookEndpoint, ep["id"])).org_id,
                              event_type="call.completed", success=False, status_code=500,
                              payload={"id": "evt_abc", "event": "call.completed", "livemode": True, "data": {"call_id": "c1"}}))
    await db.commit()
    r = await client.post(f"/api/developer/webhooks/{ep['id']}/logs/whlog_t1/replay")
    assert r.status_code == 200 and sent == [("evt_abc", "call.completed", {"call_id": "c1"})]
    assert (await client.post(f"/api/developer/webhooks/{ep['id']}/logs/nope/replay")).status_code == 404
