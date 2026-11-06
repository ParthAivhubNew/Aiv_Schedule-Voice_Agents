"""Connecting from a partner's page with only its publishable key: POST /v1/run auth.connect / exchange / refresh and our popup."""
import pytest
from sqlalchemy.future import select

from tests.conftest import make_user
from tests.test_embed import quiet_limits  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.db

PW = "Str0ng-pass!"
PAGE = "https://app.partner.test"


async def _run(anon, action, data, origin=PAGE):
    headers = {"Origin": origin} if origin else {}
    return await anon.post("/api/v1/run", json={"plugin": "auth", "action": action, "data": data}, headers=headers)


def _as(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def started(client):
    """A partner made in one step, with one web address."""
    r = await client.post("/api/partner/start", json={"name": "Acme CRM", "accept_terms": True})
    assert r.status_code == 200, r.text
    assert (await client.put("/api/partner/settings", json={"allowed_origins": [PAGE]})).status_code == 200
    return (await client.get("/api/partner")).json()["partner"]


async def _popup_code(anon, db, started, component="leads", origin=PAGE, user="nia", org="org_nia"):
    """The whole popup trip: page asks, person signs in, popup returns a code. Returns (code, login response)."""
    await make_user(db, user, "Admin", org_id=org)
    state = (await _run(anon, "connect", {"client_id": started["clientId"], "component": component}, origin)).json()["state"]
    r = await anon.post("/api/embed/connect/login", json={"email": user, "password": PW, "consent": True, "consent_version": "2026-10"},
                        headers=_as(state))
    assert r.status_code == 200, r.text
    return r.json()["code"], r


async def test_one_click_start_needs_no_approval_and_no_return_url(client):
    assert (await client.post("/api/partner/start", json={"name": "Acme", "accept_terms": False})).status_code == 422
    r = await client.post("/api/partner/start", json={"name": "Acme", "accept_terms": True})
    assert r.status_code == 200 and r.json()["status"] == "sandbox" and r.json()["clientId"].startswith("pk_")
    again = await client.post("/api/partner/start", json={"name": "Acme", "accept_terms": True})
    assert again.status_code == 200 and again.json()["clientId"] == r.json()["clientId"]  # asking twice changes nothing
    assert (await client.get("/api/partner")).json()["termsAccepted"] is True


async def test_pages_must_say_where_they_are_and_be_listed(anon, started):
    data = {"client_id": started["clientId"], "component": "leads"}
    assert (await _run(anon, "connect", data, origin="")).status_code == 403  # no Origin: refused, not let through
    assert (await _run(anon, "connect", data, origin="https://evil.test")).status_code == 403
    assert (await _run(anon, "connect", {**data, "client_id": "pk_nope"})).status_code in (401, 403)
    assert (await _run(anon, "connect", {**data, "component": "admin"})).status_code == 422
    ok = await _run(anon, "connect", data)
    assert ok.status_code == 200 and ok.json()["origin"] == PAGE and ok.json()["state"]


async def test_localhost_works_while_testing_but_not_once_live(anon, client, started, db):
    local = "http://localhost:5173"
    assert (await _run(anon, "connect", {"client_id": started["clientId"]}, origin=local)).status_code == 200
    from app.models.models import Partner

    p = (await db.execute(select(Partner).where(Partner.client_id == started["clientId"]))).scalars().first()
    p.status = "live"
    await db.commit()
    assert (await _run(anon, "connect", {"client_id": started["clientId"]}, origin=local)).status_code == 403
    assert (await _run(anon, "connect", {"client_id": started["clientId"]}, origin=PAGE)).status_code == 200


async def test_popup_trip_gives_a_one_time_code_for_that_page_only(anon, db, started):
    code, login = await _popup_code(anon, db, started)
    assert login.json()["origin"] == PAGE and "session" not in login.json()  # no token is handed to our own popup page
    assert login.json()["external_id"].startswith("outreach:")  # set by us, never by the page
    data = {"client_id": started["clientId"], "code": code}
    assert (await _run(anon, "exchange", data, origin="https://evil.test")).status_code == 403
    assert (await _run(anon, "exchange", data, origin="")).status_code == 403
    out = await _run(anon, "exchange", data)
    assert out.status_code == 200 and out.json()["token"] and out.json()["component"] == "leads"
    assert (await _run(anon, "exchange", data)).status_code == 401  # a code works once
    sess = await anon.get("/api/embed/session", headers=_as(out.json()["token"]))
    assert sess.status_code == 200 and sess.json()["component"] == "leads"


async def test_the_page_cannot_choose_who_the_person_is(anon, db, started):
    """Two people on the same page get their own identity; nobody can pre-claim another's."""
    a, la = await _popup_code(anon, db, started, user="ann", org="org_ann")
    b, lb = await _popup_code(anon, db, started, user="bob", org="org_bob")
    assert la.json()["external_id"] != lb.json()["external_id"]
    ta = (await _run(anon, "exchange", {"client_id": started["clientId"], "code": a})).json()["token"]
    tb = (await _run(anon, "exchange", {"client_id": started["clientId"], "code": b})).json()["token"]
    assert (await anon.get("/api/embed/session", headers=_as(ta))).json()["operator"]["org_id"] == "org_ann"
    assert (await anon.get("/api/embed/session", headers=_as(tb))).json()["operator"]["org_id"] == "org_bob"


async def test_a_code_made_for_one_partner_is_useless_to_another(anon, client, db, started):
    from tests.test_embed_connect import _second_partner

    other, _ = await _second_partner(db)
    code, _ = await _popup_code(anon, db, started)
    r = await _run(anon, "exchange", {"client_id": other.client_id, "code": code}, origin="https://other.test")
    assert r.status_code == 401


async def test_refresh_gives_a_fresh_token_only_to_the_partners_page(anon, db, started):
    code, _ = await _popup_code(anon, db, started)
    token = (await _run(anon, "exchange", {"client_id": started["clientId"], "code": code})).json()["token"]
    fresh = await _run(anon, "refresh", {"client_id": started["clientId"], "token": token})
    assert fresh.status_code == 200 and fresh.json()["token"]
    assert (await _run(anon, "refresh", {"client_id": started["clientId"], "token": token}, origin="https://evil.test")).status_code == 403
    assert (await _run(anon, "refresh", {"client_id": started["clientId"], "token": "junk"})).status_code == 401


async def test_a_returning_browser_connects_without_the_password(anon, db, started):
    code, login = await _popup_code(anon, db, started)
    assert "outreach_popup" in login.headers.get("set-cookie", "") and "HttpOnly" in login.headers["set-cookie"]
    state = (await _run(anon, "connect", {"client_id": started["clientId"]})).json()["state"]
    info = await anon.get("/api/embed/connect/info", headers=_as(state))
    assert info.json()["remembered"] is True and info.json()["origin"] == PAGE
    back = await anon.post("/api/embed/connect/resume", json={"consent": False, "consent_version": "2026-10"}, headers=_as(state))
    assert back.status_code == 200 and back.json()["code"]
    # no remembered browser, no way in
    anon.cookies.clear()
    assert (await anon.post("/api/embed/connect/resume", json={}, headers=_as(state))).status_code == 401


async def test_a_popup_state_is_not_a_way_to_use_the_app(anon, started):
    state = (await _run(anon, "connect", {"client_id": started["clientId"]})).json()["state"]
    assert (await anon.get("/api/leads/accounts", headers=_as(state))).status_code == 401


async def test_the_popup_page_cannot_be_framed(anon):
    r = await anon.get("/api/embed/frame-policy", headers={"X-Original-URI": "/embed/connect?state=abc"})
    assert r.headers["x-frame-policy"] == "frame-ancestors 'none'"


async def test_sandbox_partners_do_not_give_free_accounts(anon, db, started):
    """A test-mode partner is open to anyone, so an account made through it pays like any other."""
    from app.services import partners as PT

    code, _ = await _popup_code(anon, db, started, user="zed", org="org_zed")
    PT._CACHE.clear()
    assert await PT.is_free_account("org_zed") is False


async def test_testing_pages_on_localhost_may_frame_the_screen(anon, started):
    r = await anon.get("/api/embed/frame-policy", headers={"X-Original-URI": f"/embed/leads?client_id={started['clientId']}"})
    policy = r.headers["x-frame-policy"]
    assert PAGE in policy and "http://localhost:*" in policy


async def test_the_whole_window_sign_in_comes_back_only_to_the_page_that_asked(anon, db, started):
    pk = started["clientId"]
    ok = await _run(anon, "connect", {"client_id": pk, "component": "leads", "return_url": f"{PAGE}/crm/leads?tab=2#x"})
    assert ok.status_code == 200
    for bad in ("https://evil.test/steal", "javascript:alert(1)", "http://app.partner.test/crm"):
        r = await _run(anon, "connect", {"client_id": pk, "component": "leads", "return_url": bad})
        assert r.status_code == 422, bad
    await make_user(db, "rita", "Admin", org_id="org_rita")
    done = await anon.post("/api/embed/connect/login", json={"email": "rita", "password": PW, "consent": True, "consent_version": "2026-10"},
                           headers=_as(ok.json()["state"]))
    assert done.status_code == 200 and done.json()["return_url"] == f"{PAGE}/crm/leads?tab=2"  # no fragment: the code is added on arrival
    exch = await _run(anon, "exchange", {"client_id": pk, "code": done.json()["code"]})
    assert exch.status_code == 200
    # a popup or an in-page sign-in has nowhere to return to
    plain = await _run(anon, "connect", {"client_id": pk})
    assert plain.status_code == 200


async def test_the_extension_cannot_ask_for_a_return_page(anon, started):
    r = await _run(anon, "connect", {"client_id": started["clientId"], "return_url": "https://app.partner.test/x"},
                   origin="chrome-extension://nojmlpmpnfjoilhajkdpdbobcjajbmca")
    assert r.status_code == 422


async def _fund(org_id, wallet, amount):
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.services import credits as K

    async with AsyncSessionLocal() as s:
        with org_scope(org_id):
            await K.add_credits(s, wallet, amount, source="grant", note="test")
            await s.commit()


async def _balance(org_id, wallet):
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.services import credits as K

    async with AsyncSessionLocal() as s:
        with org_scope(org_id):
            return await K.wallet_balance(s, wallet)


async def _owner_org(db, started):
    from app.models.models import Partner

    return (await db.execute(select(Partner.owner_org_id).where(Partner.client_id == started["clientId"]))).scalar()


async def test_a_partner_shares_credits_from_its_own_wallet(anon, client, db, started):
    owner = await _owner_org(db, started)
    _, login = await _popup_code(anon, db, started, user="gina", org="org_gina")
    link = login.json()["link_id"]
    before = await _balance("org_gina", "leadgen")
    r = await client.post(f"/api/partner/links/{link}/credits", json={"wallet": "leadgen", "amount": 25})
    assert r.status_code == 402 and "Top it up" in r.json()["detail"]  # nothing to give yet, and nothing moved
    assert await _balance("org_gina", "leadgen") == before
    await _fund(owner, "leadgen", 100)
    r = await client.post(f"/api/partner/links/{link}/credits", json={"wallet": "leadgen", "amount": 25})
    assert r.status_code == 200 and r.json()["given"] == 25, r.text
    assert await _balance(owner, "leadgen") == 75  # 100 funded, 25 moved: the credits left one wallet and arrived in the other
    assert await _balance("org_gina", "leadgen") == before + 25
    wallet = (await client.get("/api/partner/wallet")).json()
    assert next(w for w in wallet["wallets"] if w["key"] == "leadgen")["balance"] == await _balance(owner, "leadgen")
    assert (await client.post(f"/api/partner/links/{link}/credits", json={"wallet": "nope", "amount": 5})).status_code == 422
    assert (await client.post(f"/api/partner/links/{link}/credits", json={"wallet": "leadgen", "amount": 0})).status_code == 422
    assert (await client.post("/api/partner/links/plink_unknown/credits", json={"wallet": "leadgen", "amount": 5})).status_code == 404


async def test_a_partner_cannot_give_credits_to_an_account_it_is_not_connected_to(anon, client, db, started):
    owner = await _owner_org(db, started)
    await _fund(owner, "leadgen", 50)
    _, login = await _popup_code(anon, db, started, user="hal", org="org_hal")
    link = login.json()["link_id"]
    assert (await client.delete(f"/api/partner/links/{link}")).status_code == 200  # disconnected
    r = await client.post(f"/api/partner/links/{link}/credits", json={"wallet": "leadgen", "amount": 5})
    assert r.status_code == 409
    assert await _balance("org_hal", "leadgen") == 0 and await _balance(owner, "leadgen") == 50  # nothing moved


async def test_the_welcome_gift_comes_from_the_partners_wallet_and_never_overdraws(anon, client, db, started):
    from app.models.models import Partner, PartnerLink
    from app.services import partner_credits as PC

    owner = await _owner_org(db, started)
    assert (await client.put("/api/partner/settings", json={"welcome_credits": 10, "welcome_wallet": "leadgen"})).status_code == 200
    assert (await client.put("/api/partner/settings", json={"welcome_wallet": "nope"})).status_code == 400
    _, login = await _popup_code(anon, db, started, user="ivy", org="org_ivy")
    partner = (await db.execute(select(Partner).where(Partner.client_id == started["clientId"]))).scalars().first()
    link = (await db.execute(select(PartnerLink).where(PartnerLink.id == login.json()["link_id"]))).scalars().first()
    start = await _balance("org_ivy", "leadgen")
    await PC.welcome(partner, link)  # nothing in the partner's wallet: skipped, no error, nothing created from nowhere
    assert await _balance("org_ivy", "leadgen") == start
    await _fund(owner, "leadgen", 10)
    await PC.welcome(partner, link)
    assert await _balance("org_ivy", "leadgen") == start + 10
    assert await _balance(owner, "leadgen") == 0  # exactly what was given, taken from the partner


# ── A connected person's page calling POST /v1/run with its short pass ────────────────────────────────────────
async def _pass(anon, db, started, component="leadgen", user="ned", org="org_ned", access="full"):
    await make_user(db, user, "Admin", org_id=org)
    state = (await _run(anon, "connect", {"client_id": started["clientId"], "component": component, "access": access})).json()["state"]
    r = await anon.post("/api/embed/connect/login", json={"email": user, "password": PW, "consent": True, "consent_version": "2026-10"}, headers=_as(state))
    assert r.status_code == 200, r.text
    out = await _run(anon, "exchange", {"client_id": started["clientId"], "code": r.json()["code"]})
    return out.json()["token"], r.json()["link_id"]


def _api(anon, token, plugin, action, data=None, origin=PAGE, id=None):
    body = {"plugin": plugin, "action": action, "data": data or {}, **({"id": id} if id else {})}
    return anon.post("/api/v1/run", json=body, headers={**_as(token), **({"Origin": origin} if origin else {})})


async def _go_live(db, started):
    from app.models.models import Partner
    from app.services import embed as EM

    p = (await db.execute(select(Partner).where(Partner.client_id == started["clientId"]))).scalars().first()
    p.status = "live"
    await db.commit()
    EM.forget()


async def test_a_page_can_put_its_own_records_into_the_users_account_and_the_screens_show_them(anon, db, started):
    await _go_live(db, started)  # in test mode the same call is simulated and saves nothing (see the simulated-results test)
    token, _ = await _pass(anon, db, started)
    await _fund("org_ned", "leadgen", 100)  # a live account needs a Leads plan or credits, as for any API key
    r = await _api(anon, token, "leads", "lead.add", {"leads": [
        {"name": "Acme Plumbing Ltd", "email": "jo@acme.test", "phone": "+441135500001", "contact_name": "Jo Acme", "industry": "plumbing"},
        {"name": "Bright Accounts", "website": "https://bright.test", "region": "Leeds"}]})
    assert r.status_code in (200, 201), r.text
    made = await _api(anon, token, "leads", "list.list")
    assert made.status_code == 200, made.text
    seen = await anon.get("/api/leads/accounts", headers=_as(token))  # the same pass shows them in the embedded Leads screen
    assert seen.status_code == 200 and "Acme Plumbing Ltd" in seen.text and "Bright Accounts" in seen.text


async def test_the_pass_only_works_from_the_partners_own_pages(anon, db, started):
    token, _ = await _pass(anon, db, started)
    for origin, code in (("https://evil.test", 403), ("", 403)):
        r = await _api(anon, token, "leads", "list.list", origin=origin)
        assert r.status_code == code and r.json()["code"] == "embed_run_refused", (origin, r.text)
    assert (await _api(anon, token, "leads", "list.list", origin="http://localhost:3000")).status_code == 200  # testing on your own computer


async def test_a_pass_reaches_only_the_actions_of_its_own_app(anon, db, started):
    leads, _ = await _pass(anon, db, started, "leadgen", user="oli", org="org_oli")
    voice, _ = await _pass(anon, db, started, "voice", user="pam", org="org_pam")
    r = await _api(anon, leads, "voice", "call.list")
    assert r.status_code == 403 and r.json()["error"]["code"] == "missing_scope", r.text
    r = await _api(anon, voice, "leads", "list.list")
    assert r.status_code == 403 and r.json()["error"]["code"] == "missing_scope", r.text
    assert (await _api(anon, voice, "voice", "call.list")).status_code == 200


async def test_a_view_only_pass_cannot_make_changes_through_the_endpoint(anon, db, started):
    token, _ = await _pass(anon, db, started, user="quin", org="org_quin", access="view")
    r = await _api(anon, token, "leads", "lead.add", {"name": "Nope Ltd"})
    assert r.status_code == 403 and r.json()["code"] == "embed_run_refused"


async def test_a_disconnected_user_stops_working_at_once(anon, client, db, started):
    token, link = await _pass(anon, db, started, user="ruth", org="org_ruth")
    assert (await _api(anon, token, "leads", "list.list")).status_code == 200
    assert (await client.delete(f"/api/partner/links/{link}")).status_code == 200
    assert (await _api(anon, token, "leads", "list.list")).status_code in (401, 403)


async def test_a_partner_in_test_mode_gets_simulated_results_not_real_ones(anon, db, started):
    token, _ = await _pass(anon, db, started, "voice", user="sid", org="org_sid")
    r = await _api(anon, token, "voice", "call.start", {"to": "+441135500002"})
    assert r.status_code in (200, 201, 202), r.text
    assert "test" in r.text.lower() or "simulated" in r.text.lower() or r.json().get("test_mode") is True, r.text


async def test_no_other_endpoint_is_opened_by_the_pass(anon, db, started):
    token, _ = await _pass(anon, db, started, user="tess", org="org_tess")
    for path in ("/api/billing/checkout", "/api/auth/users", "/api/partner/links"):
        r = await anon.post(path, json={}, headers={**_as(token), "Origin": PAGE})
        assert r.status_code in (401, 403, 404, 405), (path, r.status_code)


async def test_one_api_pass_runs_the_actions_of_every_plugin_but_opens_no_screen(anon, db, started):
    token, _ = await _pass(anon, db, started, "api", user="uma", org="org_uma")
    for plugin, action in (("leads", "list.list"), ("voice", "call.list"), ("social", "post.list"), ("account", "wallet")):
        r = await _api(anon, token, plugin, action)
        assert r.status_code == 200, (plugin, action, r.text)
    assert (await anon.get("/api/leads/accounts", headers=_as(token))).json()["code"] == "embed_scope"  # it is a pass for code, not a screen
    assert (await anon.get("/api/embed/session", headers=_as(token))).json()["views"] == []


async def test_the_api_pass_asks_for_what_it_will_do_in_words_the_person_sees(anon, db, started):
    state = (await _run(anon, "connect", {"client_id": started["clientId"], "component": "api"})).json()["state"]
    info = await anon.get("/api/embed/connect/info", headers=_as(state))
    assert info.status_code == 200 and info.json()["component"] == "api"
