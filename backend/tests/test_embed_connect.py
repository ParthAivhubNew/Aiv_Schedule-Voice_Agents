"""Linking a person to a partner from the embedded connect screen, and stamping the credit lines it causes."""
from datetime import datetime

import pytest
from sqlalchemy.future import select

from tests.conftest import make_user
from tests.test_embed import _as, _server, partner, quiet_limits, secret  # noqa: F401  (shared fixtures)

pytestmark = pytest.mark.db

PW = "Str0ng-pass!"


async def _connect_token(anon, key, external="user-42", component="leads", **over):
    r = await anon.post("/api/embed/connect-sessions", json={"external_id": external, "component": component, **over}, headers=_server(key))
    assert r.status_code == 200, r.text
    return r.json()


def _agree(**over):
    return {"consent": True, "consent_version": "2026-10", **over}


async def _second_partner(db, name="Other CRM"):
    """A second approved partner, made directly: returns (partner, secret key)."""
    from app.models.models import Partner
    from app.services import embed as EM

    org = (await make_user(db, f"owner_{name[:3].lower()}", "Admin", org_id=f"org_owner_{name[:3].lower()}"))[0].org_id
    raw, prefix, hashed = EM.new_secret(live=False)
    p = Partner(owner_org_id=org, client_id=f"pk_{name[:3].lower()}", name=name, status="sandbox", terms_accepted_at=datetime.utcnow(),
                allowed_origins=["https://other.test"], secret_hash=hashed, secret_prefix=prefix)
    db.add(p)
    await db.commit()
    return p, raw


async def test_connect_sessions_are_for_the_partners_server_only(anon, partner, secret):
    body = {"external_id": "user-42", "component": "leads"}
    assert (await anon.post("/api/embed/connect-sessions", json=body)).status_code == 401
    assert (await anon.post("/api/embed/connect-sessions", json=body, headers={**_server(secret), "Origin": "https://app.partner.test"})).status_code == 403
    assert (await anon.post("/api/embed/connect-sessions", json={**body, "component": "admin"}, headers=_server(secret))).status_code == 422
    out = await _connect_token(anon, secret)
    assert out["linked"] is False and out["connect_token"]
    info = await anon.get("/api/embed/connect/info", headers=_as(out["connect_token"]))
    assert info.status_code == 200 and info.json()["partner"]["name"] == "Acme CRM" and info.json()["component"] == "leads"
    assert (await anon.get("/api/embed/connect/info", headers=_as("not-a-token"))).status_code == 401
    # A connect token is not a way to use the app, and an embed session is not a way to connect
    assert (await anon.get("/api/leads/accounts", headers=_as(out["connect_token"]))).status_code == 401


async def test_an_existing_account_connects_after_proving_it_and_agreeing(anon, db, partner, secret):
    op, _ = await make_user(db, "nia", "Admin", org_id="org_nia")
    token = (await _connect_token(anon, secret))["connect_token"]
    login = lambda **d: anon.post("/api/embed/connect/login", json=d, headers=_as(token))  # noqa: E731
    assert (await login(email="nia", password="wrong", **_agree())).status_code == 401
    assert (await login(email="nia", password=PW)).status_code == 422  # no consent
    r = await login(email="nia", password=PW, **_agree())
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["mode"] == "existing" and out["external_id"] == "user-42" and out["session"]["component"] == "leads"
    # The new session works for that account only
    me = await anon.get("/api/embed/session", headers=_as(out["session"]["token"]))
    assert me.status_code == 200 and me.json()["company"] == "org_nia"
    # The partner's server finds the link by its own user id, and now has nothing left to connect
    assert (await anon.get("/api/embed/links/user-42", headers=_server(secret))).json()["link_id"] == out["link_id"]
    again = await _connect_token(anon, secret)
    assert again["linked"] is True and again["link_id"] == out["link_id"]
    # and can mint by that id
    r = await anon.post("/api/embed/sessions", json={"external_id": "user-42", "component": "mail"}, headers=_server(secret))
    assert r.status_code == 200
    assert (await anon.post("/api/embed/sessions", json={"external_id": "user-42", "link_id": out["link_id"], "component": "mail"},
                            headers=_server(secret))).status_code == 422


async def test_the_partners_server_can_get_a_key_for_a_linked_account(anon, db, partner, secret):
    from app.models.models import ApiKey

    await make_user(db, "kim", "Admin", org_id="org_kim")
    path = "/api/embed/links/user-42/key"
    assert (await anon.post(path, headers=_server(secret))).status_code == 404  # not linked yet
    token = (await _connect_token(anon, secret))["connect_token"]
    assert (await anon.post("/api/embed/connect/login", json={"email": "kim", "password": PW, **_agree()}, headers=_as(token))).status_code == 200
    assert (await anon.post(path)).status_code == 401
    assert (await anon.post(path, headers={**_server(secret), "Origin": "https://app.partner.test"})).status_code == 403
    first = (await anon.post(path, headers=_server(secret))).json()
    assert first["api_key"].startswith("sk_") and first["external_id"] == "user-42"
    second = (await anon.post(path, headers=_server(secret))).json()
    assert second["api_key"] != first["api_key"]
    keys = (await db.execute(select(ApiKey).where(ApiKey.org_id == "org_kim"))).scalars().all()
    assert len(keys) == 1  # the first key was replaced


async def test_only_an_admin_with_the_right_password_can_connect(anon, db, partner, secret):
    await make_user(db, "carl", "Admin", org_id="org_acme")
    await make_user(db, "sam", "Operator", org_id="org_acme")
    token = (await _connect_token(anon, secret))["connect_token"]
    r = await anon.post("/api/embed/connect/login", json={"email": "sam", "password": PW, **_agree()}, headers=_as(token))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_required"
    assert (await anon.get("/api/embed/links/user-42", headers=_server(secret))).status_code == 404  # nothing was linked
    # An email address alone, or someone else's account, never links
    r = await anon.post("/api/embed/connect/login", json={"email": "carl", "password": "", **_agree()}, headers=_as(token))
    assert r.status_code == 401


async def test_one_person_cannot_be_linked_to_two_accounts(anon, db, partner, secret):
    await make_user(db, "nia", "Admin", org_id="org_nia")
    await make_user(db, "omar", "Admin", org_id="org_omar")
    token = (await _connect_token(anon, secret))["connect_token"]
    assert (await anon.post("/api/embed/connect/login", json={"email": "nia", "password": PW, **_agree()}, headers=_as(token))).status_code == 200
    r = await anon.post("/api/embed/connect/login", json={"email": "omar", "password": PW, **_agree()}, headers=_as(token))
    assert r.status_code == 409


async def test_a_new_account_is_made_under_the_partner(anon, db, partner, secret):
    from app.models.models import Organization, PartnerLink

    token = (await _connect_token(anon, secret, "user-77"))["connect_token"]
    body = {"email": "kim@newco.test", "password": "Str0ng-pass-2026!", "company": "Newco", "name": "Kim New", **_agree()}
    assert (await anon.post("/api/embed/connect/signup", json={**body, "website": "spam.test"}, headers=_as(token))).status_code == 400
    r = await anon.post("/api/embed/connect/signup", json=body, headers=_as(token))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["mode"] == "partner_created" and out["external_id"] == "user-77"
    org = (await db.execute(select(Organization).where(Organization.name == "Newco"))).scalars().first()
    assert org.referred_by_partner_id == partner["id"]
    link = (await db.execute(select(PartnerLink).where(PartnerLink.org_id == org.id))).scalars().first()
    assert link.created_account and link.status == "active" and link.external_id == "user-77"
    assert (await anon.get("/api/embed/session", headers=_as(out["session"]["token"]))).json()["company"] == "Newco"


async def test_an_account_unconfirmed_by_email_cannot_use_an_embed(anon, db, partner, secret, monkeypatch):
    monkeypatch.setattr("app.core.mailer.configured", lambda: True)
    monkeypatch.setattr("app.api.signup._send_verification", lambda *a, **k: _done(True))
    token = (await _connect_token(anon, secret, "user-88"))["connect_token"]
    body = {"email": "lee@lee.test", "password": "Str0ng-pass-2026!", "company": "Leeco", "name": "Lee", **_agree()}
    r = await anon.post("/api/embed/connect/signup", json=body, headers=_as(token))
    assert r.status_code == 200 and r.json()["verify_email"] is True and "session" not in r.json()
    # The link exists but is not usable: no session can be made until the email is confirmed
    r = await anon.post("/api/embed/sessions", json={"external_id": "user-88", "component": "leads"}, headers=_server(secret))
    assert r.status_code == 200
    assert (await anon.get("/api/embed/session", headers=_as(r.json()["token"]))).status_code == 401


async def _done(value):
    return value


async def test_one_account_can_work_through_two_partners_and_each_can_leave_alone(anon, client, db, partner, secret):
    await make_user(db, "nia", "Admin", org_id="org_nia")
    other, other_key = await _second_partner(db)
    sessions = {}
    for key, name in ((secret, "acme"), (other_key, "other")):
        token = (await _connect_token(anon, key, "same-person"))["connect_token"]
        r = await anon.post("/api/embed/connect/login", json={"email": "nia", "password": PW, **_agree()}, headers=_as(token))
        assert r.status_code == 200, r.text
        sessions[name] = r.json()
    assert sessions["acme"]["link_id"] != sessions["other"]["link_id"]
    for out in sessions.values():
        assert (await anon.get("/api/embed/session", headers=_as(out["session"]["token"]))).json()["company"] == "org_nia"
    # The first partner leaves: only its token stops
    assert (await client.delete(f"/api/partner/links/{sessions['acme']['link_id']}")).status_code == 200
    assert (await anon.get("/api/embed/session", headers=_as(sessions["acme"]["session"]["token"]))).status_code == 401
    assert (await anon.get("/api/embed/session", headers=_as(sessions["other"]["session"]["token"]))).status_code == 200
    # A partner's secret cannot reach the other partner's link
    assert (await anon.get("/api/embed/links/same-person", headers=_server(secret))).status_code == 404
    r = await anon.post("/api/embed/sessions", json={"link_id": sessions["other"]["link_id"], "component": "leads"}, headers=_server(secret))
    assert r.status_code == 404


async def test_credit_lines_name_who_used_and_who_pays_and_the_partner(db):
    from app.core.tenancy import org_scope
    from app.models.models import CreditEntry
    from app.services import credits as K
    from app.services import embed as EM

    with org_scope("org_default"):
        await K.add_credits(db, "leadgen", 50, note="direct")
        with EM.partner_scope("ptr_acme"):
            await K.add_credits(db, "leadgen", 20, note="through a partner screen", ref="g2")
        await db.commit()
        rows = {r.note: r for r in (await db.execute(select(CreditEntry))).scalars().all()}
    assert rows["direct"].partner_id is None and rows["direct"].payer_org_id == "org_default"
    assert rows["through a partner screen"].partner_id == "ptr_acme" and rows["through a partner screen"].payer_org_id == "org_default"


async def test_an_account_already_linked_to_one_user_cannot_be_linked_to_another(anon, db, partner, secret):
    """One Outreach account stands behind one user of a partner: a second user cannot take it over."""
    await make_user(db, "nia", "Admin", org_id="org_nia")
    first = (await _connect_token(anon, secret, "user-1"))["connect_token"]
    assert (await anon.post("/api/embed/connect/login", json={"email": "nia", "password": PW, **_agree()}, headers=_as(first))).status_code == 200
    second = (await _connect_token(anon, secret, "user-2"))["connect_token"]
    r = await anon.post("/api/embed/connect/login", json={"email": "nia", "password": PW, **_agree()}, headers=_as(second))
    assert r.status_code == 409
    assert (await anon.get("/api/embed/links/user-1", headers=_server(secret))).status_code == 200  # still user-1's
    assert (await anon.get("/api/embed/links/user-2", headers=_server(secret))).status_code == 404


async def test_the_partner_sees_credits_used_through_its_screens_per_account(anon, client, db, partner, secret):
    import uuid

    from app.core.tenancy import org_scope
    from app.models.models import CreditEntry

    org_a, _ = await _link_user(anon, partner, "a@a.test", "Alpha")
    org_b, _ = await _link_user(anon, partner, "b@b.test", "Beta")
    for org, partner_id, amount in ((org_a, partner["id"], -7), (org_a, partner["id"], -3), (org_b, None, -50)):  # Beta's use was not through the partner
        with org_scope(org):
            db.add(CreditEntry(id=f"cr_{uuid.uuid4().hex[:12]}", kind="usage", wallet="leadgen", item="x", quantity=1, amount=amount,
                               partner_id=partner_id, payer_org_id=org))
            await db.commit()
    rows = {l["orgId"]: l for l in (await client.get("/api/partner/links")).json()["links"]}
    assert rows[org_a]["creditsUsed30d"] == 10 and rows[org_b]["creditsUsed30d"] == 0


async def _link_user(anon, partner, email, company):
    from tests.test_embed import _link

    return await _link(anon, partner, email, company)
