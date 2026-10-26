"""Embedded screens: a partner's server mints a token for one linked account, and the token reaches only its component."""
from datetime import datetime

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
    from app.api import auth as A
    from app.api import signup as S
    from app.public_api import core

    S._HITS.clear()
    A._FAILS.clear()
    core._WINDOWS.clear()
    monkeypatch.setattr("app.core.mailer.configured", lambda: False)


@pytest.fixture
async def partner(client, staff):
    r = await client.post("/api/partner/apply", json={"company": "Acme CRM", "contact_email": "dev@acme.test"})
    assert (await staff.post(f"/api/admin-api/partners/applications/{r.json()['id']}/approve", json={})).status_code == 200
    assert (await client.post("/api/partner/accept-terms")).status_code == 200
    r = await client.put("/api/partner/settings", json={"allowed_origins": [ORIGIN], "return_urls": [RETURN]})
    assert r.status_code == 200
    return (await client.get("/api/partner")).json()["partner"]


@pytest.fixture
async def secret(client, partner):
    r = await client.post("/api/partner/secret/rotate")
    assert r.status_code == 200 and r.json()["secretKey"].startswith("psk_test_") and r.json()["mode"] == "test"
    return r.json()["secretKey"]


async def _link(anon, partner, email="nia@newco.test", company="Newco"):
    """A partner-created account: returns (org_id, link_id)."""
    body = {"plugin": "auth", "action": "signup", "data": {"client_id": partner["clientId"], "company": company, "name": "Nia New",
                                                            "email": email, "password": PW, "consent": True, "consent_version": "2026-10",
                                                            "return_url": RETURN}}
    r = await anon.post("/api/v1/run", json=body, headers={"Origin": ORIGIN})
    assert r.status_code == 200, r.text
    return r.json()["account"]["org_id"], r.json()["link_id"]


def _server(key):
    return {"Authorization": f"Bearer {key}"}


async def _token(anon, key, link_id, component="leads", **over):
    r = await anon.post("/api/embed/sessions", json={"link_id": link_id, "component": component, **over}, headers=_server(key))
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _as(token):
    return {"Authorization": f"Bearer {token}"}


async def test_the_secret_key_is_shown_once_and_a_new_one_replaces_it(client, partner, secret):
    assert (await client.get("/api/partner")).json()["partner"]["secretKeyPrefix"] == secret[:16]
    assert "secretKey" not in (await client.get("/api/partner")).json()["partner"]
    new = (await client.post("/api/partner/secret/rotate")).json()["secretKey"]
    assert new != secret


async def test_only_a_server_with_a_valid_secret_gets_a_token(anon, partner, secret):
    _, link_id = await _link(anon, partner)
    body = {"link_id": link_id, "component": "leads"}
    assert (await anon.post("/api/embed/sessions", json=body)).status_code == 401
    assert (await anon.post("/api/embed/sessions", json=body, headers=_server("psk_test_nope"))).status_code == 401
    assert (await anon.post("/api/embed/sessions", json=body, headers=_server("sk_test_" + "0" * 40))).status_code == 401
    # A web page must not hold the secret key: any call with an Origin is refused, even with the right key.
    r = await anon.post("/api/embed/sessions", json=body, headers={**_server(secret), "Origin": ORIGIN})
    assert r.status_code == 403
    assert (await anon.post("/api/embed/sessions", json={**body, "component": "admin"}, headers=_server(secret))).status_code == 422
    assert (await anon.post("/api/embed/sessions", json={**body, "access": "root"}, headers=_server(secret))).status_code == 422
    assert (await anon.post("/api/embed/sessions", json={**body, "link_id": "plink_nope"}, headers=_server(secret))).status_code == 404


async def test_a_token_reaches_its_component_and_nothing_else(anon, partner, secret):
    org_id, link_id = await _link(anon, partner)
    token = await _token(anon, secret, link_id, "leads")
    me = await anon.get("/api/embed/session", headers=_as(token))
    assert me.status_code == 200 and me.json()["component"] == "leads" and me.json()["company"] == "Newco" and me.json()["test"] is True
    assert (await anon.get("/api/leads/accounts", headers=_as(token))).status_code == 200
    assert (await anon.get("/api/credits/wallet/leadgen", headers=_as(token))).status_code == 200
    for path in ("/api/credits", "/api/credits/usage", "/api/calls/live", "/api/scheduler/accounts", "/api/auth/me", "/api/auth/users", "/api/connections/ai-keys", "/api/billing/plans",
                 "/api/partner", "/api/developer/keys", "/api/v1/run", "/api/team/users", "/api/profile/org/members"):
        r = await anon.get(path, headers=_as(token))
        assert r.status_code in (403, 404, 405), (path, r.status_code)
        assert r.status_code != 200, path
    r = await anon.get("/api/calls/live", headers=_as(token))
    assert r.status_code == 403 and r.json()["code"] == "embed_scope"
    # Token tricks: it is not a key, not usable in the query string, not a staff token
    assert (await anon.get(f"/api/leads/accounts?access_token={token}")).status_code == 401
    assert (await anon.get("/api/admin-api/partners", headers=_as(token))).status_code == 401


async def test_view_access_cannot_change_anything(anon, partner, secret):
    _, link_id = await _link(anon, partner)
    token = await _token(anon, secret, link_id, "leads", access="view")
    assert (await anon.get("/api/leads/accounts", headers=_as(token))).status_code == 200
    r = await anon.post("/api/leads/accounts", json={}, headers=_as(token))
    assert r.status_code == 403 and r.json()["code"] == "embed_scope"


async def test_a_token_only_sees_its_own_account(anon, db, partner, secret):
    """Two linked accounts: each token reads its own organisation's data."""
    from app.core.tenancy import org_scope
    from app.models.models import LeadAccount

    org_a, link_a = await _link(anon, partner, "a@a.test", "Alpha")
    org_b, link_b = await _link(anon, partner, "b@b.test", "Beta")
    for org, name in ((org_a, "Alpha lead"), (org_b, "Beta lead")):
        with org_scope(org):
            db.add(LeadAccount(id=f"la_{org}", org_id=org, name=name))
            await db.commit()
    seen = {}
    for link, org in ((link_a, org_a), (link_b, org_b)):
        token = await _token(anon, secret, link, "leads")
        r = await anon.get("/api/leads/accounts", headers=_as(token))
        assert r.status_code == 200, r.text
        seen[org] = r.text
    assert "Alpha lead" in seen[org_a] and "Beta lead" not in seen[org_a]
    assert "Beta lead" in seen[org_b] and "Alpha lead" not in seen[org_b]


async def test_another_partner_cannot_mint_for_this_partners_link(anon, db, partner, secret):
    from app.models.models import Partner
    from app.services import embed as EM

    _, link_id = await _link(anon, partner)
    other_org = (await make_user(db, "other", "Admin", org_id="org_other"))[0].org_id
    raw, prefix, hashed = EM.new_secret(live=False)
    db.add(Partner(owner_org_id=other_org, client_id="pk_other", name="Other", status="sandbox", terms_accepted_at=datetime.utcnow(),
                   allowed_origins=["https://other.test"], secret_hash=hashed, secret_prefix=prefix))
    await db.commit()
    r = await anon.post("/api/embed/sessions", json={"link_id": link_id, "component": "leads"}, headers=_server(raw))
    assert r.status_code == 404


async def test_revoking_the_link_stops_the_token_at_once(anon, client, partner, secret):
    _, link_id = await _link(anon, partner)
    token = await _token(anon, secret, link_id, "leads")
    assert (await anon.get("/api/embed/session", headers=_as(token))).status_code == 200
    assert (await client.delete(f"/api/partner/links/{link_id}")).status_code == 200
    assert (await anon.get("/api/embed/session", headers=_as(token))).status_code == 401
    r = await anon.post("/api/embed/sessions", json={"link_id": link_id, "component": "leads"}, headers=_server(secret))
    assert r.status_code == 404  # and no new token for a revoked link


async def test_the_user_disconnecting_stops_the_token(anon, db, partner, secret):
    org_id, link_id = await _link(anon, partner)
    token = await _token(anon, secret, link_id, "leads")
    _, admin = await make_user(db, "nia", "Admin", org_id=org_id)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=anon._transport.app), base_url="http://test", headers=_as(admin)) as mine:
        assert (await mine.delete(f"/api/partner/connections/{link_id}")).status_code == 200
    assert (await anon.get("/api/embed/session", headers=_as(token))).status_code == 401


async def test_pausing_the_partner_stops_every_token_and_secret(anon, staff, partner, secret):
    _, link_id = await _link(anon, partner)
    token = await _token(anon, secret, link_id, "leads")
    assert (await staff.post(f"/api/admin-api/partners/{partner['id']}/status", json={"status": "suspended"})).status_code == 200
    assert (await anon.get("/api/embed/session", headers=_as(token))).status_code == 401
    r = await anon.post("/api/embed/sessions", json={"link_id": link_id, "component": "leads"}, headers=_server(secret))
    assert r.status_code in (401, 403)


async def test_an_expired_or_forged_token_is_refused(anon, db, partner, secret):
    from app.core.security import _encode
    from app.services import embed as EM

    org_id, link_id = await _link(anon, partner)
    claims = {"sub": link_id, "ptr": partner["id"], "org": org_id, "cmp": "leads", "acc": "full", "typ": EM.TOKEN_TYPE}
    assert (await anon.get("/api/embed/session", headers=_as(_encode(claims, -30)))).status_code == 401
    # Right link, wrong organisation or partner in the claims
    assert (await anon.get("/api/embed/session", headers=_as(_encode({**claims, "org": "org_default"}, 600)))).status_code == 401
    assert (await anon.get("/api/embed/session", headers=_as(_encode({**claims, "ptr": "ptr_other"}, 600)))).status_code == 401
    assert (await anon.get("/api/embed/session", headers=_as(_encode({**claims, "cmp": "admin"}, 600)))).status_code == 401
    # A real sign-in token has no component and is not an embed token
    assert (await anon.get("/api/embed/session", headers=_as(_encode({"sub": link_id, "typ": "access"}, 600)))).status_code == 401
    # Unsigned
    assert (await anon.get("/api/embed/session", headers=_as(_encode(claims, 600)[:-3] + "abc"))).status_code == 401


async def test_the_frame_rule_names_only_the_partners_own_addresses(anon, partner):
    r = await anon.get("/api/embed/frame-policy", headers={"X-Original-URI": f"/embed/leads?client_id={partner['clientId']}&x=1"})
    assert r.status_code == 200 and r.headers["x-frame-policy"] == f"frame-ancestors {ORIGIN}"
    for uri in ("/embed/leads", "/embed/leads?client_id=pk_unknown", "/embed/leads?client_id="):
        r = await anon.get("/api/embed/frame-policy", headers={"X-Original-URI": uri})
        assert r.status_code == 200 and r.headers["x-frame-policy"] == "frame-ancestors 'none'"


async def test_a_screen_may_read_but_not_change_the_other_half_of_its_app(anon, partner, secret):
    """The Leads app loads its lists and its mail together: each screen can read what the other holds, never change it."""
    _, link_id = await _link(anon, partner)
    leads = await _token(anon, secret, link_id, "leads")
    mail = await _token(anon, secret, link_id, "mail")
    assert (await anon.get("/api/email/campaigns", headers=_as(leads))).status_code == 200
    r = await anon.post("/api/email/campaigns", json={}, headers=_as(leads))
    assert r.status_code == 403 and r.json()["code"] == "embed_scope"
    assert (await anon.get("/api/leads/accounts", headers=_as(mail))).status_code == 200
    r = await anon.post("/api/leads/accounts", json={}, headers=_as(mail))
    assert r.status_code == 403 and r.json()["code"] == "embed_scope"
    # A voice token reads leads (to call a list) but cannot reach mail at all, and social reaches neither
    voice = await _token(anon, secret, link_id, "voice")
    social = await _token(anon, secret, link_id, "social")
    assert (await anon.get("/api/leads/accounts", headers=_as(voice))).status_code == 200
    assert (await anon.get("/api/email/campaigns", headers=_as(voice))).json()["code"] == "embed_scope"
    assert (await anon.get("/api/leads/accounts", headers=_as(social))).json()["code"] == "embed_scope"
    assert (await anon.get("/api/email/campaigns", headers=_as(social))).json()["code"] == "embed_scope"


async def test_the_session_tells_the_page_what_to_show_and_how(anon, client, partner, secret):
    _, link_id = await _link(anon, partner)
    r = await client.put("/api/partner/theme", json={"variables": {"colorPrimary": "#0F766E", "fontFamily": "serif", "borderRadius": 12}})
    assert r.status_code == 200 and r.json()["theme"]["variables"] == {"colorPrimary": "#0f766e", "fontFamily": "serif", "borderRadius": 12}
    token = await _token(anon, secret, link_id, "campaigns")
    s = (await anon.get("/api/embed/session", headers=_as(token))).json()
    assert s["views"] == ["lists", "outreach", "mailboxes"]
    assert s["appearance"]["variables"]["colorPrimary"] == "#0f766e"
    op = s["operator"]
    assert op["is_admin"] is False and op["is_platform_org"] is False and op["permissions"]["leadgen"] == "full" and op["permissions"]["team"] == "none"
    assert "hashed" not in str(s).lower() and "secret" not in str(s).lower()


async def test_a_theme_with_bad_values_is_refused_not_trimmed(client, partner):
    for bad in ({"colorPrimary": "red"}, {"colorText": "#fff; } body { display:none"}, {"fontFamily": "Comic Sans"}, {"borderRadius": 99}, {"x": 1}):
        r = await client.put("/api/partner/theme", json={"variables": bad})
        assert r.status_code == 400, bad
    assert (await client.get("/api/partner")).json()["partner"]["theme"] == {"variables": {}}


async def test_only_an_account_admin_can_save_the_theme(anon, partner):
    assert (await anon.put("/api/partner/theme", json={"variables": {}})).status_code == 401
