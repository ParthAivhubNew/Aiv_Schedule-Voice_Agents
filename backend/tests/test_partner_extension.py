"""The one-snippet zip and the Chrome extension inside it."""
import base64
import hashlib
import io
import json
import re
import zipfile

import pytest

from app.partner_kit import build_snippet
from app.services import embed as EM
from app.services import partners as PT


def _zip(**over):
    args = {"client_id": "pk_abc123", "host": "https://outreach.example.test", "company": "Acme & Co"}
    return zipfile.ZipFile(io.BytesIO(build_snippet(**{**args, **over})))


def _text(z, name):
    return z.read(name).decode("utf-8")


def test_the_zip_holds_the_snippet_a_test_page_and_the_extension_and_no_secret():
    z = _zip()
    names = set(z.namelist())
    assert {"START-HERE.txt", "snippet.html", "outreach-test.html", "extension/manifest.json", "extension/sidepanel.js"} <= names
    for name in names:
        if name.endswith(".png"):
            continue
        text = _text(z, name)
        assert "psk_" not in text and "whsec_" not in text and "sk_live_" not in text and "sk_test_" not in text, name
        assert not re.search(r"\{\{[A-Z_]+\}\}", text), f"{name} still has a placeholder"
        assert not re.search(r"telnyx|xai|apollo|google|twilio|deepseek", text, re.I), f"{name} names a supplier"
    assert 'data-key="pk_abc123"' in _text(z, "snippet.html") and "https://outreach.example.test/embed.js" in _text(z, "snippet.html")
    assert "Acme &amp; Co" in _text(z, "outreach-test.html")  # a company name cannot break the page
    assert json.loads(_text(z, "extension/config.json"))["clientId"] == "pk_abc123"


def test_the_snippet_is_two_lines_and_leaves_the_look_to_the_saved_settings():
    lines = [x for x in _text(_zip(), "snippet.html").splitlines() if x.strip() and not x.startswith("<!--")]
    assert len(lines) == 2
    assert "data-key=" in lines[0]
    assert not any(f"data-{a}=" in lines[0] for a in ("accent", "radius", "font"))  # a colour on the tag would override the Look tab


def test_the_extension_asks_for_little_and_has_a_fixed_id():
    manifest = json.loads(_text(_zip(), "extension/manifest.json"))
    assert manifest["manifest_version"] == 3
    assert set(manifest["permissions"]) == {"sidePanel", "storage", "identity", "activeTab", "scripting"}  # activeTab: the page you click on, once
    assert not any(k in manifest for k in ("host_permissions", "optional_host_permissions", "content_scripts"))  # no standing access to any site
    assert "unsafe-eval" not in json.dumps(manifest) and "unsafe-inline" not in json.dumps(manifest)
    der = base64.b64decode(manifest["key"])
    derived = "".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(der).hexdigest()[:32])
    assert derived == PT.EXTENSION_ID  # the id the server trusts is the id this key makes
    for size, path in manifest["icons"].items():
        assert _zip().read("extension/" + path)[:4] == b"\x89PNG"


def test_the_extension_never_loads_code_from_elsewhere():
    z = _zip()
    html = _text(z, "extension/sidepanel.html")
    assert not re.search(r"<script[^>]+src=[\"']https?:", html) and "<script>" not in html
    assert "eval(" not in _text(z, "extension/sidepanel.js")


def test_only_our_extension_is_recognised_as_a_caller():
    assert PT.page_origin(f"chrome-extension://{PT.EXTENSION_ID}") == f"chrome-extension://{PT.EXTENSION_ID}"
    assert PT.page_origin("chrome-extension://" + "a" * 32) == ""  # some other extension
    assert PT.page_origin("https://app.partner.test/path") == "https://app.partner.test"
    assert PT.page_origin("null") == "" and PT.page_origin("") == ""


def test_the_frame_rule_lets_the_side_panel_in_only_when_asked():
    ext = f"chrome-extension://{PT.EXTENSION_ID}"
    assert ext in EM.frame_ancestors(["https://a.test"], extension=True)
    assert ext not in EM.frame_ancestors(["https://a.test"])
    assert EM.frame_ancestors([]) == "frame-ancestors 'none'"


@pytest.mark.db
async def test_the_extension_can_ask_to_connect_and_a_stranger_cannot(anon, client):
    from tests.test_embed import quiet_limits  # noqa: F401

    r = await client.post("/api/partner/start", json={"name": "Acme", "accept_terms": True})
    pk = r.json()["clientId"]
    body = {"plugin": "auth", "action": "connect", "data": {"client_id": pk, "component": "voice"}}
    ok = await anon.post("/api/v1/run", json=body, headers={"Origin": f"chrome-extension://{PT.EXTENSION_ID}"})
    assert ok.status_code == 200 and ok.json()["origin"] == f"chrome-extension://{PT.EXTENSION_ID}"
    other = await anon.post("/api/v1/run", json=body, headers={"Origin": "chrome-extension://" + "b" * 32})
    assert other.status_code == 403
    policy = await anon.get("/api/embed/frame-policy", headers={"X-Original-URI": f"/embed/voice?client_id={pk}&ext=1"})
    assert f"chrome-extension://{PT.EXTENSION_ID}" in policy.headers["x-frame-policy"]
    plain = await anon.get("/api/embed/frame-policy", headers={"X-Original-URI": f"/embed/voice?client_id={pk}"})
    assert "chrome-extension" not in plain.headers["x-frame-policy"]


def test_the_firefox_build_is_the_same_panel_with_its_own_manifest_and_no_wider_access():
    z = _zip()
    ff = json.loads(_text(z, "extension-firefox/manifest.json"))
    chrome = json.loads(_text(z, "extension/manifest.json"))
    assert ff["manifest_version"] == 3 and ff["sidebar_action"]["default_panel"] == "sidepanel.html"
    assert "key" not in ff and "side_panel" not in ff and ff["browser_specific_settings"]["gecko"]["id"]
    assert set(ff["permissions"]) <= set(chrome["permissions"])
    assert not any(k in ff for k in ("host_permissions", "optional_host_permissions", "content_scripts"))
    assert _text(z, "extension-firefox/sidepanel.js") == _text(z, "extension/sidepanel.js")  # one panel for every browser
    assert "browser.sidebarAction.open" in _text(z, "extension-firefox/background.js") and "sidePanel" not in _text(z, "extension-firefox/background.js")


def test_the_toolbar_click_reads_only_a_few_facts_and_nothing_leaves_the_browser_from_there():
    js = _text(_zip(), "extension/background.js")
    assert "fetch(" not in js and "XMLHttpRequest" not in js and "sendBeacon" not in js
    assert "chrome.action.onClicked" in js and "executeScript" in js
    assert "cookie" not in js.lower() and "localStorage" not in js


def test_an_extension_may_only_be_sent_back_to_its_own_sign_in_address():
    cid = PT.EXTENSION_ID
    ok = f"https://{cid}.chromiumapp.org/cb"
    assert PT.extension_return_ok(f"chrome-extension://{cid}", ok)
    assert not PT.extension_return_ok(f"chrome-extension://{cid}", "https://evil.test/cb")
    assert not PT.extension_return_ok(f"chrome-extension://{cid}", "https://" + "a" * 32 + ".chromiumapp.org/cb")  # another extension's address
    assert not PT.extension_return_ok("https://app.partner.test", ok)
    moz = "moz-extension://12345678-1234-1234-1234-123456789abc"
    assert PT.extension_return_ok(moz, "https://" + "a" * 40 + ".extensions.allizom.org/")
    assert not PT.extension_return_ok(moz, "https://evil.test/")


def test_a_firefox_extension_is_not_trusted_until_it_is_switched_on(monkeypatch):
    from app.config import settings

    moz = "moz-extension://12345678-1234-1234-1234-123456789abc"
    monkeypatch.setattr(settings, "ALLOW_FIREFOX_EXTENSION", False)
    assert PT.page_origin(moz) == ""
    monkeypatch.setattr(settings, "ALLOW_FIREFOX_EXTENSION", True)
    assert PT.page_origin(moz) == moz
    assert "moz-extension:" in EM.frame_ancestors(["https://a.test"], extension=True)
    monkeypatch.setattr(settings, "ALLOW_FIREFOX_EXTENSION", False)
    assert "moz-extension" not in EM.frame_ancestors(["https://a.test"], extension=True)


@pytest.mark.db
async def test_the_extension_signs_in_back_to_its_own_address_only(anon, client):
    from tests.test_embed import quiet_limits  # noqa: F401

    pk = (await client.post("/api/partner/start", json={"name": "Acme", "accept_terms": True})).json()["clientId"]
    origin = {"Origin": f"chrome-extension://{PT.EXTENSION_ID}"}

    def body(ret):
        return {"plugin": "auth", "action": "connect", "data": {"client_id": pk, "component": "leads", "return_url": ret}}

    good = await anon.post("/api/v1/run", json=body(f"https://{PT.EXTENSION_ID}.chromiumapp.org/cb"), headers=origin)
    assert good.status_code == 200
    for bad in ("https://evil.test/cb", "https://app.partner.test/x", f"https://{'b' * 32}.chromiumapp.org/cb"):
        assert (await anon.post("/api/v1/run", json=body(bad), headers=origin)).status_code == 422, bad


def test_the_campaigns_screen_can_reach_the_journeys_it_shows():
    ctx = {"component": "campaigns", "access": "full"}
    assert "outreach" in EM.VIEWS["campaigns"]  # the Journeys page
    assert EM.may_use(ctx, "/journeys", "GET") and EM.may_use(ctx, "/journeys/j1", "POST")
    assert not EM.may_use({"component": "leads", "access": "full"}, "/journeys", "POST")


# What each whole app may reach once embedded: the pages and actions of the plugin, and nothing that belongs to the account's admin.
_REACH = {
    "leadgen": [("POST", "/inbound/forms"), ("POST", "/journeys"), ("POST", "/meetings/from-lead"), ("POST", "/call-lists"), ("POST", "/email/campaigns"),
                ("POST", "/leads/lists"), ("PUT", "/profile/org"), ("GET", "/analytics/calling"), ("POST", "/enrichment/chats/lead_assistant"),
                ("POST", "/leads/assistant/ask/stream"), ("POST", "/assistant/feedback"), ("POST", "/human-calls/start"), ("GET", "/human-calls/mine")],
    "voice": [("POST", "/human-calls/calls"), ("GET", "/wa/threads"), ("POST", "/telnyx/numbers/order"), ("DELETE", "/telnyx/numbers/n1"), ("GET", "/analytics/calling"),
              ("POST", "/profile/sources"), ("POST", "/number-check/run"), ("POST", "/diagnostics/run"), ("POST", "/calls/live/c1/end"), ("GET", "/connections/hub"),
              ("POST", "/leads/lists"), ("GET", "/contacts/timeline"), ("POST", "/assistant/voice/ask/stream"), ("POST", "/assistant/feedback"), ("POST", "/human-calls/start")],
    "social": [("POST", "/scheduler/posts"), ("POST", "/social/posts/p1/engagers"), ("POST", "/profile/sources"), ("GET", "/calcom/event-types"), ("GET", "/leads/lists"),
               ("GET", "/enrichment/chats/social_assistant"), ("PUT", "/enrichment/chats/social_assistant_memory"),
               ("POST", "/assistant/social/ask/stream"), ("POST", "/assistant/feedback")],
}
_NEVER = [("POST", "/billing/checkout"), ("POST", "/auth/users"), ("POST", "/auth/share"), ("GET", "/partner/links"), ("POST", "/developer/keys"),
          ("POST", "/admin-api/partners"), ("POST", "/connections/telephony"), ("PUT", "/credits/rates")]


@pytest.mark.parametrize("component", sorted(_REACH))
def test_each_whole_app_reaches_its_pages_and_actions(component):
    ctx = {"component": component, "access": "full"}
    for method, path in _REACH[component]:
        assert EM.may_use(ctx, path, method), f"{component} cannot {method} {path}"


@pytest.mark.parametrize("component", sorted(EM.COMPONENTS))
def test_no_screen_reaches_what_belongs_to_the_account_admin(component):
    ctx = {"component": component, "access": "full"}
    mine = {("POST", "/billing/checkout"), ("POST", "/auth/users"), ("POST", "/developer/keys")} if component == "account" else set()  # the Account screen is for exactly these
    for method, path in _NEVER:
        if (method, path) in mine:
            continue
        assert not EM.may_use(ctx, path, method), f"{component} can {method} {path}"


def test_each_app_reaches_only_its_own_assistant_and_the_browser_phone_stays_in_voice_and_leads():
    social, voice, leads = {"component": "social", "access": "full"}, {"component": "voice", "access": "full"}, {"component": "leads", "access": "full"}
    assert not EM.may_use(social, "/assistant/voice/ask", "POST") and not EM.may_use(social, "/human-calls/start", "POST")
    assert not EM.may_use(voice, "/assistant/social/ask", "POST")
    assert not EM.may_use(leads, "/human-calls/start", "POST") and EM.may_use(leads, "/assistant/feedback", "POST")  # a rating is allowed everywhere; the phone is not in the small Leads slices


def test_a_view_only_pass_cannot_change_anything_in_any_app():
    for component in EM.COMPONENTS:
        ctx = {"component": component, "access": "view"}
        for method, path in [("POST", "/journeys"), ("POST", "/calls/live/c1/end"), ("POST", "/scheduler/posts"), ("DELETE", "/telnyx/numbers/n1")]:
            assert not EM.may_use(ctx, path, method)


def test_the_whole_leads_app_is_a_screen_and_shows_every_page():
    assert "leadgen" in EM.COMPONENTS and EM.VIEWS["leadgen"] == []


def test_voice_and_social_still_cannot_read_mail_or_every_lead():
    voice, social = {"component": "voice", "access": "full"}, {"component": "social", "access": "full"}
    assert not EM.may_use(voice, "/email/campaigns", "GET") and not EM.may_use(social, "/email/campaigns", "GET")
    assert not EM.may_use(social, "/leads/accounts", "GET") and EM.may_use(social, "/leads/lists", "GET")
    assert EM.may_use(voice, "/leads/accounts", "GET")  # Voice calls from a list
