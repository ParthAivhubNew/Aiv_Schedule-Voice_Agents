"""The embedded Account screen (users, roles, phone numbers, plans and credits, API keys): off until staff switch it on for a partner, only
for a person who is really an admin of their own account, never renewed by the partner's page, and never through the remembered sign-in."""
import pytest

from app.core.tenancy import system_scope
from app.models.models import PartnerLink
from app.services import embed as EM
from tests.conftest import make_user
from tests.test_embed import ORIGIN, _as, _link, _token, partner, quiet_limits, secret  # noqa: F401

pytestmark = pytest.mark.db


def test_the_account_screen_reaches_what_an_admin_manages_and_nothing_of_the_partners_or_staff():
    ctx = {"component": "account", "access": "full"}
    for method, path in [("GET", "/auth/users"), ("POST", "/auth/users"), ("PUT", "/auth/roles/r1"), ("GET", "/numbers"), ("POST", "/telnyx/numbers/order"),
                         ("POST", "/billing/checkout"), ("POST", "/billing/plan"), ("GET", "/credits/usage"), ("POST", "/developer/keys"),
                         ("DELETE", "/developer/keys/k1"), ("GET", "/email/mailboxes")]:
        assert EM.may_use(ctx, path, method), f"account cannot {method} {path}"
    for method, path in [("POST", "/auth/share"), ("GET", "/partner/links"), ("POST", "/admin-api/partners"), ("POST", "/connections/telephony"),
                         ("PUT", "/credits/rates"), ("GET", "/leads/accounts"), ("POST", "/email/campaigns"), ("POST", "/scheduler/posts")]:
        assert not EM.may_use(ctx, path, method), f"account can {method} {path}"
    for component in ("leads", "leadgen", "campaigns", "mail", "voice", "social", "workspace"):  # no other screen gained any of it
        other = {"component": component, "access": "full"}
        assert not EM.may_use(other, "/auth/users", "POST") and not EM.may_use(other, "/developer/keys", "POST") and not EM.may_use(other, "/billing/checkout", "POST")


def test_a_view_only_account_pass_cannot_change_anything():
    ctx = {"component": "account", "access": "view"}
    assert EM.may_use(ctx, "/auth/users", "GET") and not EM.may_use(ctx, "/auth/users", "POST") and not EM.may_use(ctx, "/developer/keys/k1", "DELETE")


async def test_the_account_screen_is_off_until_staff_switch_it_on(anon, staff, partner, secret):
    _, link_id = await _link(anon, partner)
    r = await anon.post("/api/embed/sessions", json={"link_id": link_id, "component": "account"}, headers={"Authorization": f"Bearer {secret}"})
    assert r.status_code == 403 and "not switched on" in r.json()["detail"]
    # a page asking to connect for it is told the same
    body = {"plugin": "auth", "action": "connect", "data": {"client_id": partner["clientId"], "component": "account"}}
    off = await anon.post("/api/v1/run", json=body, headers={"Origin": ORIGIN})
    assert off.status_code == 403
    assert (await staff.post(f"/api/admin-api/partners/{partner['id']}/admin-screens", json={"enabled": True})).json()["adminScreens"] is True
    assert (await anon.post("/api/v1/run", json=body, headers={"Origin": ORIGIN})).status_code == 200
    assert (await anon.post("/api/embed/sessions", json={"link_id": link_id, "component": "account"}, headers={"Authorization": f"Bearer {secret}"})).status_code == 200


async def test_an_admin_manages_their_own_account_from_the_partners_page_and_only_that(anon, staff, partner, secret):
    await staff.post(f"/api/admin-api/partners/{partner['id']}/admin-screens", json={"enabled": True})
    _, link_id = await _link(anon, partner)
    token = await _token(anon, secret, link_id, "account")
    users = await anon.get("/api/auth/users", headers=_as(token))
    assert users.status_code == 200 and len(users.json()) >= 1
    assert (await anon.get("/api/developer/keys", headers=_as(token))).status_code == 200
    assert (await anon.get("/api/numbers", headers=_as(token))).status_code == 200
    assert (await anon.get("/api/leads/accounts", headers=_as(token))).status_code in (401, 403)  # not part of this screen
    assert (await anon.get("/api/partner/links", headers=_as(token))).status_code in (401, 403)  # a partner's own console stays out of reach


async def test_a_person_who_is_not_an_admin_gets_nothing_even_with_the_switch_on(anon, staff, partner, secret, db):
    await staff.post(f"/api/admin-api/partners/{partner['id']}/admin-screens", json={"enabled": True})
    org_id, link_id = await _link(anon, partner)
    token = await _token(anon, secret, link_id, "account")
    assert (await anon.get("/api/auth/users", headers=_as(token))).status_code == 200
    viewer, _ = await make_user(db, "viewer_acc", "Viewer", org_id=org_id)
    with system_scope():
        link = await db.get(PartnerLink, link_id)
        link.operator_id = viewer.id
        await db.commit()
    EM.forget()
    assert (await anon.get("/api/auth/users", headers=_as(token))).status_code == 401


async def test_switching_it_off_stops_open_account_sessions_at_once(anon, staff, partner, secret):
    await staff.post(f"/api/admin-api/partners/{partner['id']}/admin-screens", json={"enabled": True})
    _, link_id = await _link(anon, partner)
    token = await _token(anon, secret, link_id, "account")
    assert (await anon.get("/api/auth/users", headers=_as(token))).status_code == 200
    await staff.post(f"/api/admin-api/partners/{partner['id']}/admin-screens", json={"enabled": False})
    assert (await anon.get("/api/auth/users", headers=_as(token))).status_code == 401


async def test_the_page_cannot_renew_an_account_session_and_the_remembered_sign_in_is_not_enough(anon, staff, partner, secret):
    await staff.post(f"/api/admin-api/partners/{partner['id']}/admin-screens", json={"enabled": True})
    _, link_id = await _link(anon, partner)
    token = await _token(anon, secret, link_id, "account")
    renew = await anon.post("/api/v1/run", json={"plugin": "auth", "action": "refresh", "data": {"client_id": partner["clientId"], "token": token}},
                            headers={"Origin": ORIGIN})
    assert renew.status_code == 401
    state = (await anon.post("/api/v1/run", json={"plugin": "auth", "action": "connect", "data": {"client_id": partner["clientId"], "component": "account"}},
                             headers={"Origin": ORIGIN})).json()["state"]
    resume = await anon.post("/api/embed/connect/resume", json={"consent": True, "consent_version": "2026-10"}, headers={"Authorization": f"Bearer {state}"})
    assert resume.status_code == 401 and "password" in resume.json()["detail"]
    info = (await anon.get("/api/embed/connect/info", headers={"Authorization": f"Bearer {state}"})).json()
    assert info["component"] == "account" and info["remembered"] is False
