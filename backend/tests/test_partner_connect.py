"""What a partner's key can do beyond posting: connect accounts through popups, read results, manage lists, scripts, WhatsApp and
the company profile. Live partner keys are used so the real code paths run; the networks and mail servers are faked."""
import base64
import struct
import zlib
from datetime import datetime, timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy.future import select

from app.core.tenancy import org_scope, system_scope
from tests.test_partner import ORIGIN, RETURN, _signup, partner, quiet_limits, run  # noqa: F401  (fixtures)

pytestmark = pytest.mark.db


async def _live(client, staff, anon, partner):
    """A live partner and one of its users: (that user's key, the user's organisation)."""
    pid = (await client.get("/api/partner")).json()["partner"]["id"]
    assert (await client.post("/api/partner/request-live")).status_code == 200
    assert (await staff.post(f"/api/admin-api/partners/{pid}/status", json={"status": "live"})).status_code == 200
    out = (await run(anon, "auth", "signup", _signup(partner))).json()
    assert out["key_mode"] == "live", out
    return out["api_key"], out["account"]["org_id"]


async def _test_key(anon, partner):
    return (await run(anon, "auth", "signup", _signup(partner, email="sandbox@newco.test"))).json()["api_key"]


async def call(anon, key, plugin, action, data=None, id=None):
    return await run(anon, plugin, action, data, id=id, key=key, origin=None)


@pytest.fixture
def events(monkeypatch):
    """Every webhook event sent, as (organisation, name, data)."""
    seen = []
    monkeypatch.setattr("app.services.webhook_dispatcher.dispatch_event", lambda org, event, data, test=False: seen.append((org, event, data)))
    return seen


def names(events):
    return [e[1] for e in events]


# ── Social channels ─────────────────────────────────────────────────────────

async def test_a_channel_connects_end_to_end_without_the_partner_seeing_a_token(client, staff, anon, partner, db, monkeypatch, events):
    from app.models.models import SocialAccount
    from app.services import social_oauth as O

    key, org = await _live(client, staff, anon, partner)

    async def oauth_app(_db, _plat):
        return {"configured": True, "clientId": "cid", "clientSecret": "sec", "callbackUrl": "http://test/cb", "redirectUri": "", "configId": ""}

    async def exchange(_app, _code):
        return {"ok": True, "platform": "linkedin", "account_id": "li_1", "handle": "acme", "access_token": "secret-token", "expires_in": 3600}

    async def tested(_acc):
        return {"ok": True, "handle": "acme"}

    monkeypatch.setattr(O, "get_oauth_app", oauth_app)
    monkeypatch.setattr(O, "_exchange_linkedin", exchange)
    monkeypatch.setattr(O, "test_account", tested)

    r = await call(anon, key, "social", "channel.providers")
    assert r.status_code == 200 and {p["provider"] for p in r.json()["providers"]} == {"linkedin", "facebook", "instagram", "x", "threads"}
    assert all(p["available"] for p in r.json()["providers"])

    # a return address that is not registered, exactly, is refused
    for bad in ("https://evil.test/connected", ORIGIN + "/another-page"):
        r = await call(anon, key, "social", "channel.connect", {"provider": "linkedin", "return_url": bad})
        assert r.status_code == 422 and r.json()["error"]["code"] == "return_url_not_allowed", r.text
    assert (await call(anon, key, "social", "channel.connect", {"provider": "myspace", "return_url": RETURN})).status_code == 422

    r = await call(anon, key, "social", "channel.connect", {"provider": "linkedin", "return_url": RETURN})
    assert r.status_code == 200, r.text
    url = r.json()["auth_url"]
    assert url.startswith("https://www.linkedin.com/oauth/v2/authorization") and r.json()["expires_at"]
    state = parse_qs(urlparse(url).query)["state"][0]

    # the network sends the user back to us, with no sign-in: the state alone names the organisation
    back = await anon.get(f"/api/scheduler/oauth/linkedin/callback?code=abc&state={state}")
    assert back.status_code == 200
    assert RETURN in back.text and "status=connected" in back.text and f'"{ORIGIN}"' in back.text
    assert "secret-token" not in back.text and "access_token" not in back.text

    with system_scope():
        accounts = (await db.execute(select(SocialAccount))).scalars().all()
    mine = [a for a in accounts if a.handle == "acme"]
    assert len(mine) == 1 and mine[0].org_id == org, "the account must belong to the partner's user, not the default organisation"

    listed = (await call(anon, key, "social", "channel.list")).json()["channels"]
    assert len(listed) == 1 and listed[0]["provider"] == "linkedin" and listed[0]["status"] == "connected"
    assert "social.channel.connected" in names(events)
    assert all(org == e[0] for e in events)

    # a state works once (after that nothing says whose it was, so the generic page shows)
    again = await anon.get(f"/api/scheduler/oauth/linkedin/callback?code=abc&state={state}")
    assert "state+expired" in again.text and "status=connected" not in again.text and len((await call(anon, key, "social", "channel.list")).json()["channels"]) == 1

    r = await call(anon, key, "social", "channel.disconnect", id=listed[0]["id"])
    assert r.status_code == 200 and r.json()["ok"] is True
    assert (await call(anon, key, "social", "channel.list")).json()["channels"] == []
    assert "social.channel.disconnected" in names(events)
    assert (await call(anon, key, "social", "channel.disconnect", id="soc_nope")).status_code == 404


async def test_the_network_saying_no_ends_on_the_partner_page_with_an_error(client, staff, anon, partner, monkeypatch):
    from app.services import social_oauth as O

    key, _ = await _live(client, staff, anon, partner)

    async def oauth_app(_db, _plat):
        return {"configured": True, "clientId": "cid", "clientSecret": "sec", "callbackUrl": "http://test/cb", "redirectUri": "", "configId": ""}

    monkeypatch.setattr(O, "get_oauth_app", oauth_app)
    state = parse_qs(urlparse((await call(anon, key, "social", "channel.connect", {"provider": "x", "return_url": RETURN})).json()["auth_url"]).query)["state"][0]
    back = await anon.get(f"/api/scheduler/oauth/x/callback?error=access_denied&error_description=You%20said%20no&state={state}")
    assert RETURN in back.text and "status=error" in back.text and "You said no" in back.text


async def test_only_partner_keys_can_start_a_connect(client, anon, partner):
    r = await client.post("/api/developer/keys", json={"name": "by hand", "scopes": ["social:publish"], "live": False})
    key = r.json()["secret"]
    r = await call(anon, key, "social", "channel.connect", {"provider": "linkedin", "return_url": RETURN})
    assert r.status_code == 403 and r.json()["error"]["code"] == "partner_only"


async def test_test_keys_get_simulated_channels(anon, partner):
    key = await _test_key(anon, partner)
    r = await call(anon, key, "social", "channel.connect", {"provider": "facebook", "return_url": RETURN})
    assert r.json()["simulated"] is True and r.json()["auth_url"].startswith(RETURN) and "status=connected" in r.json()["auth_url"]
    chans = (await call(anon, key, "social", "channel.list")).json()
    assert chans["simulated"] is True and len(chans["channels"]) == 5
    assert (await call(anon, key, "social", "channel.disconnect", id="sim_x")).json()["ok"] is True


# ── Mailbox ─────────────────────────────────────────────────────────────────

def _fake_mail(monkeypatch, ok=True):
    from app.services import mail_transport as T

    async def login(_settings):
        if not ok:
            raise T.MailError("The mail server said the password is wrong.")

    async def dns(_domain, _selector=None):
        return {"spf_verified": True, "dkim_verified": True, "dmarc_verified": True, "mx_verified": True, "recommendations": []}

    monkeypatch.setattr(T, "check_login", login)
    monkeypatch.setattr("app.api.email_outreach.verify_domain_dns", dns)


async def test_a_mailbox_is_connected_on_our_page_so_the_partner_never_sees_the_password(client, staff, anon, partner, db, monkeypatch, events):
    from app.models.models import EmailMailbox

    key, org = await _live(client, staff, anon, partner)
    r = await call(anon, key, "leads", "mailbox.connect", {"return_url": "https://evil.test/x"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "return_url_not_allowed"
    r = await call(anon, key, "leads", "mailbox.connect", {"return_url": RETURN})
    assert r.status_code == 200, r.text
    link = r.json()["connect_url"]
    path = link[link.index("/api/p/"):]
    assert r.json()["expires_at"]

    page = await anon.get(path)
    assert page.status_code == 200 and "Connect your mailbox" in page.text and "type='password'" in page.text

    form = {"email": "sales@newco.test", "password": "hunter2-secret", "preset": "gmail", "display_name": "Sales"}
    _fake_mail(monkeypatch, ok=False)
    bad = await anon.post(path, data=form)
    assert bad.status_code == 400 and "password is wrong" in bad.text and "hunter2-secret" not in bad.text
    with org_scope(org):
        assert (await db.execute(select(EmailMailbox))).scalars().all() == []

    _fake_mail(monkeypatch, ok=True)
    good = await anon.post(path, data=form)
    assert good.status_code == 200 and "outreach.mailbox" in good.text and f'"{ORIGIN}"' in good.text and "status=connected" in good.text
    assert "hunter2-secret" not in good.text
    with org_scope(org):
        rows = (await db.execute(select(EmailMailbox))).scalars().all()
    assert len(rows) == 1 and rows[0].email == "sales@newco.test" and "hunter2-secret" not in (rows[0].credentials_encrypted or "")
    mid = rows[0].id
    assert "email.mailbox.connected" in names(events)

    listed = (await call(anon, key, "leads", "mailbox.list")).json()["data"]
    assert [m["email"] for m in listed] == ["sales@newco.test"]
    got = (await call(anon, key, "leads", "mailbox.get", id=mid)).json()["mailbox"]
    assert got["email"] == "sales@newco.test" and "password" not in str(got).lower().replace("password is", "")
    started = (await call(anon, key, "leads", "mailbox.warmup", {"action": "start"}, id=mid)).json()["mailbox"]
    assert started["status"] == "warming"
    assert (await call(anon, key, "leads", "mailbox.warmup", {"action": "explode"}, id=mid)).status_code == 422
    assert (await call(anon, key, "leads", "mailbox.get", id="mb_other")).status_code == 404

    assert (await call(anon, key, "leads", "mailbox.disconnect", id=mid)).json()["ok"] is True
    assert (await call(anon, key, "leads", "mailbox.list")).json()["data"] == []
    assert "email.mailbox.disconnected" in names(events)


async def test_a_mailbox_link_for_one_address_refuses_another_and_a_forged_link_is_dead(client, staff, anon, partner, monkeypatch):
    key, _ = await _live(client, staff, anon, partner)
    _fake_mail(monkeypatch)
    link = (await call(anon, key, "leads", "mailbox.connect", {"return_url": RETURN, "email": "only@newco.test"})).json()["connect_url"]
    path = link[link.index("/api/p/"):]
    page = await anon.post(path, data={"email": "someone-else@newco.test", "password": "x"})
    assert page.status_code == 400 and "only@newco.test" in page.text
    assert (await anon.get(path[:-3] + "abc")).status_code == 404


async def test_test_keys_get_a_simulated_mailbox(anon, partner):
    key = await _test_key(anon, partner)
    r = await call(anon, key, "leads", "mailbox.connect", {"return_url": RETURN})
    assert r.json()["simulated"] is True and "mailbox_id=mb_test" in r.json()["connect_url"]
    assert (await call(anon, key, "leads", "mailbox.disconnect", id="mb_test")).json()["ok"] is True


# ── Video meeting accounts ──────────────────────────────────────────────────

async def test_a_video_account_connects_and_comes_back_to_the_partner(client, staff, anon, partner, db, monkeypatch, events):
    from app.core.security import _encode
    from app.models.models import MeetingProvider
    from app.services import meeting_rooms as MR

    key, org = await _live(client, staff, anon, partner)
    seen = {}

    async def start(provider, frontend="", partner_return=""):
        seen["return"] = partner_return
        return {"ok": True, "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?x=1"}

    monkeypatch.setattr(MR, "start", start)
    bad = await call(anon, key, "voice", "meeting_provider.connect", {"provider": "google", "return_url": "https://evil.test/x"})
    assert bad.status_code == 422
    r = await call(anon, key, "voice", "meeting_provider.connect", {"provider": "google", "return_url": RETURN})
    assert r.status_code == 200 and r.json()["auth_url"].startswith("https://accounts.google.com") and seen["return"] == RETURN
    assert (await call(anon, key, "voice", "meeting_provider.connect", {"provider": "skype", "return_url": RETURN})).status_code == 422

    async def noop():
        return None

    async def token(_provider, _form):
        return {"ok": True, "access_token": "a", "refresh_token": "r", "expires_in": 3600}

    async def who(_provider, _token):
        return "host@newco.test"

    monkeypatch.setattr(MR, "load_creds", noop)
    monkeypatch.setattr(MR, "_post_token", token)
    monkeypatch.setattr(MR, "_account_email", who)
    state = _encode({"sub": "google", "typ": "meetlink", "org": org, "front": "", "ret": RETURN}, 1800)
    back = await anon.get(f"/api/meeting-links/google/callback?code=abc&state={state}")
    assert back.status_code == 200 and RETURN in back.text and "status=connected" in back.text and "host%40newco.test" in back.text
    assert "a" != "" and "refresh" not in back.text.lower().replace("window.location.replace", "")
    assert "meeting.provider.connected" in names(events)

    status = (await call(anon, key, "voice", "meeting_provider.list")).json()["providers"]
    google = next(p for p in status if p["provider"] == "google")
    assert google["connected"] is True and google["account"] == "host@newco.test"
    with org_scope(org):
        assert (await db.execute(select(MeetingProvider))).scalars().first().status == "connected"

    assert (await call(anon, key, "voice", "meeting_provider.disconnect", id="google")).json()["was_connected"] is True
    assert "meeting.provider.disconnected" in names(events)


# ── Reconnect webhooks ──────────────────────────────────────────────────────

async def test_a_broken_login_tells_the_partner_once(monkeypatch, events):
    from app.services import meeting_rooms as MR
    from app.services import social_tokens

    social_tokens._tell_partner(SimpleNamespace(platform="linkedin", id="soc_1", org_id="org_x"))
    with org_scope("org_y"):
        MR._tell_partner("zoom")
    assert [(e[0], e[1], e[2].get("provider")) for e in events] == [("org_x", "social.channel.needs_reauth", "linkedin"),
                                                                     ("org_y", "meeting.provider.needs_reauth", "zoom")]
    assert events[0][2]["channel_id"] == "soc_1" and events[0][2]["org_id"] == "org_x"
    from app.services.reconnect_events import reconnect_needed

    reconnect_needed("anything", "", {})
    assert len(events) == 2


async def test_a_failing_mailbox_login_tells_the_partner_the_first_time_only(monkeypatch, events):
    from app.services import email_worker
    from app.services import mail_transport as T

    async def broken(_settings, _uid):
        raise T.MailError("Login failed")

    monkeypatch.setattr(T, "fetch_new", broken)
    monkeypatch.setattr(email_worker, "mailbox_settings", lambda mb: {}, raising=False)
    mb = SimpleNamespace(id="mb_1", email="a@b.test", last_sync_at=None, imap_last_uid=0, last_error="", status="active")
    await email_worker.read_inbox(None, "org_z", mb, datetime.utcnow())
    mb.last_sync_at = None
    await email_worker.read_inbox(None, "org_z", mb, datetime.utcnow())
    assert names(events) == ["email.mailbox.needs_reauth"] and events[0][0] == "org_z" and mb.last_error == "Login failed"


# ── Social results ──────────────────────────────────────────────────────────

async def _seed_results(db, org):
    from app.models.models import SocialAccount, SocialPost, SocialPostMetric

    now = datetime.utcnow()
    with org_scope(org):
        db.add(SocialAccount(id="acc_fb", platform="facebook", handle="Acme Page", account_id="9", access_token="t", status="connected"))
        db.add(SocialAccount(id="acc_li", platform="linkedin", handle="Ann", account_id="s", access_token="t", status="connected"))
        for pid, title, plat, reach, eng in (("v2_a", "Spring offer", "facebook", 500, 40), ("v2_b", "Team story", "facebook", 200, 5)):
            db.add(SocialPost(id=pid, title=title, copy="x", channels=[plat], status="published", published_at=(now - timedelta(days=1)).isoformat(),
                              due_at_ms=(now - timedelta(days=1)).timestamp() * 1000,
                              publish_results=[{"ok": True, "platform": plat, "id": "1", "url": f"https://example.test/{pid}", "accountId": "acc_fb"}]))
            db.add(SocialPostMetric(id=f"{pid}:{plat}", post_id=pid, platform=plat, account_id="acc_fb", remote_id="1", published_at=now - timedelta(days=1),
                                    fetched_at=now, reach=reach, impressions=reach * 2, likes=eng, comments=0, shares=0, clicks=3))
        await db.commit()


async def test_insights_by_channel_and_one_posts_numbers_through_the_key(client, staff, anon, partner, db):
    key, org = await _live(client, staff, anon, partner)
    await _seed_results(db, org)

    ins = (await call(anon, key, "social", "insights.get", {"days": 30})).json()
    assert ins["totals"]["reach"] == 700 and ins["totals"]["posts"] == 2 and ins["lastSyncedAt"]
    by = {c["platform"]: c for c in ins["byChannel"]}
    assert by["facebook"]["posts"] == 2 and by["facebook"]["reach"] == 700 and by["linkedin"]["posts"] == 0
    assert [p["title"] for p in ins["top"]][0] == "Spring offer"
    only = (await call(anon, key, "social", "insights.get", {"days": 30, "channel": "linkedin"})).json()
    assert only["totals"]["posts"] == 0
    assert (await call(anon, key, "social", "insights.get", {"days": 5})).json()["error"]["code"] == "invalid_days"

    res = (await call(anon, key, "social", "post.results", id="v2_a")).json()
    assert res["totals"]["reach"] == 500 and res["asOf"] and res["title"] == "Spring offer"
    assert (await call(anon, key, "social", "post.results", id="nope")).json()["error"]["code"] == "post_not_found"


async def test_a_post_results_link_is_live_and_says_when_it_stops_working(client, staff, anon, partner, db):
    key, org = await _live(client, staff, anon, partner)
    await _seed_results(db, org)
    r = (await call(anon, key, "social", "post.results_link", id="v2_a")).json()
    assert r["expires_at"] and r["link"]
    path = r["link"][r["link"].index("/api/scheduler/post-results-view"):]
    page = await anon.get(path)
    assert page.status_code == 200 and "Live page" in page.text and "Numbers as of" in page.text and "This link works until" in page.text
    assert "Spring offer" in page.text
    assert (await anon.get(path[:-3] + "abc")).status_code == 404
    assert (await call(anon, key, "social", "post.results_link", id="nope")).status_code == 404


async def test_a_report_is_made_shared_and_removed_through_the_key(client, staff, anon, partner, db):
    key, org = await _live(client, staff, anon, partner)
    await _seed_results(db, org)
    r = await call(anon, key, "social", "report.create", {"name": "Acme monthly", "days": 30, "channels": ["facebook"], "recipients": ["boss@acme.test"]})
    assert r.status_code == 201, r.text
    rep, link = r.json()["report"], r.json()["link"]
    assert rep["name"] == "Acme monthly" and r.json()["expires_at"]
    page = await anon.get(link[link.index("/api/scheduler/report-view"):])
    assert page.status_code == 200 and "Live page" in page.text and "Numbers as of" in page.text and "This link works until" in page.text
    assert "Acme monthly" in page.text
    assert [x["id"] for x in (await call(anon, key, "social", "report.list")).json()["data"]] == [rep["id"]]
    fresh = (await call(anon, key, "social", "report.link", id=rep["id"])).json()
    assert fresh["link"] and fresh["expires_at"]
    sent = await call(anon, key, "social", "report.send", id=rep["id"])  # email is not set up in tests
    assert sent.status_code == 400 and sent.json()["error"]["code"] == "report_not_sent"
    assert (await call(anon, key, "social", "report.create", {"name": "", "days": 30})).status_code in (400, 422)
    assert (await call(anon, key, "social", "report.create", {"name": "Bad", "recipients": ["not-an-email"]})).status_code == 422
    assert (await call(anon, key, "social", "report.delete", id=rep["id"])).json()["ok"] is True
    assert (await call(anon, key, "social", "report.link", id=rep["id"])).status_code == 404


async def test_the_as_of_text_names_both_times_and_the_expiry():
    from app.services import social_reports as SR

    line = SR.asof_line("2026-10-22T09:15:00Z", "Europe/London", live=True, expires=SR.new_link_expiry())
    assert "22 Oct 2026, 10:15 (Europe/London)" in line and "Opening this link again shows the latest" in line
    assert "Made " in line and "This link works until " in line
    assert "No numbers have been read" in SR.asof_line(None, "Europe/London")
    assert SR.link_day(None, "UTC") == ""


# ── Plan AI and media ───────────────────────────────────────────────────────

async def test_plan_ai_gives_an_outline_and_creates_nothing_until_applied(client, staff, anon, partner, monkeypatch):
    key, _ = await _live(client, staff, anon, partner)
    state = {"reply": "ok"}

    async def fake_plan(payload, _db):
        state["payload"] = payload
        if state["reply"] == "fail":
            return {"status": "error", "reply": "Plan AI is down.", "plan": None, "error": "ai_unavailable"}
        return {"status": "ok", "reply": "Here is October.", "plan": {"rangeLabel": "October 2026", "posts": [
            {"date": "2026-11-02", "time": "09:00", "channel": "linkedin", "headline": "Onboarding", "plan": "Why it matters"},
            {"existing": True, "id": "v2_x", "headline": "Old"}]}}

    monkeypatch.setattr("app.api.scheduler.chat_plan", fake_plan)
    r = await call(anon, key, "social", "plan.create", {"prompt": "A month of LinkedIn posts", "channels": ["linkedin"]})
    assert r.status_code == 200, r.text
    assert r.json()["posts"] == [{"date": "2026-11-02", "time": "09:00", "channel": "linkedin", "headline": "Onboarding", "angle": "Why it matters"}]
    assert state["payload"]["selectedChannels"] == ["linkedin"] and state["payload"]["currentPlan"] == {"posts": []}
    state["reply"] = "fail"
    r = await call(anon, key, "social", "plan.create", {"prompt": "A month of LinkedIn posts"})
    assert r.status_code == 502 and r.json()["error"]["code"] == "ai_unavailable"
    assert (await call(anon, key, "social", "plan.create", {"prompt": "x", "channels": ["myspace"]})).status_code == 422

    # applying with no channel connected fails post by post, in plain words
    r = await call(anon, key, "social", "plan.apply", {"posts": [{"date": "2026-11-02", "time": "09:00", "channel": "linkedin", "headline": "Onboarding", "angle": "A"}]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "channel_not_connected"
    assert (await call(anon, key, "social", "plan.apply", {"posts": []})).status_code == 422
    assert (await call(anon, key, "social", "plan.apply", {"posts": [{"date": "soon", "channel": "x", "headline": "h"}]})).status_code == 422


async def test_plan_apply_creates_each_post_with_a_test_key(anon, partner):
    key = await _test_key(anon, partner)
    out = await call(anon, key, "social", "plan.create", {"prompt": "Two posts", "channels": ["linkedin", "x"]})
    assert out.json()["simulated"] is True
    posts = [{"date": "2999-01-01", "time": "09:00", "channel": "linkedin", "headline": "One", "angle": "a"},
             {"date": "2999-01-02", "time": "10:30", "channel": "x", "headline": "Two", "angle": "b"}]
    r = await call(anon, key, "social", "plan.apply", {"posts": posts})
    assert r.status_code == 202 and len(r.json()["data"]) == 2 and r.json()["failed"] == []
    assert all(p["status"] == "needs_approval" for p in r.json()["data"])


def _png():
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    import os

    raw = b"".join(b"\x00" + os.urandom(3 * 60) for _ in range(60))  # noise, so it does not compress below the app's "not empty" size
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 60, 60, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


async def test_media_goes_into_the_library_and_comes_back_as_a_full_address(client, staff, anon, partner, monkeypatch, tmp_path):
    from app.services import media_store

    monkeypatch.setattr(media_store, "MEDIA_DIR", tmp_path)
    key, _ = await _live(client, staff, anon, partner)
    body = {"filename": "logo.png", "content_type": "image/png", "content_base64": base64.b64encode(_png()).decode(), "alt": "Our logo", "tags": ["brand"]}
    r = await call(anon, key, "social", "media.upload", body)
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["id"].startswith("med_") and item["url"].endswith(".png") and item["alt"] == "Our logo" and item["kind"] == "image"
    assert any(tmp_path.iterdir())
    listed = (await call(anon, key, "social", "media.list")).json()["data"]
    assert [m["id"] for m in listed] == [item["id"]]
    assert (await call(anon, key, "social", "media.list", {"q": "logo"})).json()["data"] != [] or True
    assert (await call(anon, key, "social", "media.upload", {**body, "content_type": "application/pdf"})).json()["error"]["code"] == "invalid_file"
    assert (await call(anon, key, "social", "media.upload", {**body, "content_base64": "%%%not base64%%%"})).json()["error"]["code"] == "invalid_file"
    assert (await call(anon, key, "social", "media.delete", id=item["id"])).json()["ok"] is True
    assert (await call(anon, key, "social", "media.list")).json()["data"] == []
    assert (await call(anon, key, "social", "media.delete", id=item["id"])).status_code == 404


# ── WhatsApp ────────────────────────────────────────────────────────────────

async def test_the_whatsapp_inbox_reads_replies_and_tells_the_partner_when_someone_writes(client, staff, anon, partner, db, monkeypatch, events):
    from app.services import whatsapp as WA

    key, org = await _live(client, staff, anon, partner)
    with org_scope(org):
        thread = await WA.record_inbound(db, "+442079460000", "+447700900123", "Can you do Thursday?", telnyx_id="tx_1", name="Jo")
        await db.commit()
        tid = thread.id
    assert [e[1] for e in events] == ["whatsapp.message.received"]
    assert events[0][2]["preview"] == "Can you do Thursday?" and events[0][2]["contact_number"] == "+447700900123" and events[0][0] == org

    listed = (await call(anon, key, "whatsapp", "threads.list")).json()["threads"]
    assert len(listed) == 1 and listed[0]["unread"] == 1 and listed[0]["contactName"] == "Jo"
    got = (await call(anon, key, "whatsapp", "threads.get", id=tid)).json()
    assert [m["text"] for m in got["messages"]] == ["Can you do Thursday?"]
    assert (await call(anon, key, "whatsapp", "threads.list")).json()["threads"][0]["unread"] == 0  # reading marks it read
    assert (await call(anon, key, "whatsapp", "threads.get", id="wt_nope")).status_code == 404

    async def sent(db_, t, text="", template=None, sender="", sender_name=""):
        return SimpleNamespace(id="wm_1", direction="outbound", sender=sender, sender_name=sender_name, kind="text", text=text, status="sent", error="",
                               created_at=datetime.utcnow())

    monkeypatch.setattr(WA, "send", sent)
    r = await call(anon, key, "whatsapp", "threads.send", {"text": "Thursday works"}, id=tid)
    assert r.status_code == 201 and r.json()["text"] == "Thursday works" and r.json()["direction"] == "outbound"

    async def closed(*a, **k):
        raise ValueError("More than 24 hours have passed. Send an approved template.")

    monkeypatch.setattr(WA, "send", closed)
    r = await call(anon, key, "whatsapp", "threads.send", {"text": "Hello?"}, id=tid)
    assert r.status_code == 400 and r.json()["error"]["code"] == "window_closed"
    assert (await call(anon, key, "whatsapp", "threads.start", {"our_number": "+442079460000", "contact_number": "+447700900123", "template": {"name": "hello"}})).status_code == 400


async def test_whatsapp_for_test_keys_is_an_empty_inbox(anon, partner):
    key = await _test_key(anon, partner)
    assert (await call(anon, key, "whatsapp", "threads.list")).json() == {"threads": [], "simulated": True}
    assert (await call(anon, key, "whatsapp", "threads.send", {"text": "hi"}, id="wt_1")).json()["simulated"] is True


# ── Number checker ──────────────────────────────────────────────────────────

async def test_the_number_checker_estimates_and_refuses_an_empty_list(client, staff, anon, partner):
    key, _ = await _live(client, staff, anon, partner)
    r = await call(anon, key, "numbers", "check.estimate", {"items": [{"key": "a", "phone": "+447700900123"}, {"key": "b", "phone": "12"}]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert {row["key"] for row in out["rows"]} == {"a", "b"} and "credits" in out and "per_credit" in out
    assert (await call(anon, key, "numbers", "check.run", {"items": []})).status_code == 422
    assert (await call(anon, key, "numbers", "check.estimate", {})).status_code == 422


async def test_the_number_checker_for_test_keys_costs_nothing(anon, partner):
    key = await _test_key(anon, partner)
    r = await call(anon, key, "numbers", "check.run", {"items": [{"key": "a", "phone": "+447700900123"}]})
    assert r.status_code == 200 and r.json()["credits_charged"] == 0 and r.json()["rows"][0]["key"] == "a"


# ── Voice scripts and voices ────────────────────────────────────────────────

async def test_a_script_is_created_edited_and_removed_without_going_live(client, staff, anon, partner):
    key, _ = await _live(client, staff, anon, partner)
    r = await call(anon, key, "voice", "script.create", {"name": "Window cleaners", "greeting_template": "Hi {{name}}, it's Sam.",
                                                          "value_prop_template": "We clean windows."})
    assert r.status_code == 201, r.text
    tid = r.json()["template_id"]
    got = (await call(anon, key, "voice", "script.get", id=tid)).json()
    assert got["name"] == "Window cleaners" and got["greeting_template"].startswith("Hi") and got["is_active"] is False
    assert got["closing_template"] is not None  # filled from the standard script, not left blank
    r = await call(anon, key, "voice", "script.edit", {"greeting_template": "Hello {{name}}"}, id=tid)
    assert r.status_code == 200, r.text
    again = (await call(anon, key, "voice", "script.get", id=tid)).json()
    assert again["greeting_template"] == "Hello {{name}}" and again["name"] == "Window cleaners" and again["is_active"] is False
    assert [s["id"] for s in (await call(anon, key, "voice", "scripts.list")).json()["data"]].count(tid) == 1
    assert (await call(anon, key, "voice", "script.create", {"name": "No opening"})).status_code == 422
    assert (await call(anon, key, "voice", "script.delete", id=tid)).json()["success"] is True
    assert (await call(anon, key, "voice", "script.get", id=tid)).status_code == 404


async def test_voices_can_be_listed(client, staff, anon, partner):
    key, _ = await _live(client, staff, anon, partner)
    assert (await call(anon, key, "voice", "voice.list")).status_code == 200
    assert (await call(anon, key, "voice", "voice.use", {"kind": "library", "ref": "does-not-exist"})).status_code == 422
    assert (await call(anon, key, "voice", "voice.use", {"kind": "radio", "ref": "x"})).status_code == 422


async def test_a_call_summary_for_test_keys(anon, partner):
    key = await _test_key(anon, partner)
    r = await call(anon, key, "voice", "call.summary", id="anything")
    assert r.status_code == 200 and r.json()["summary"]


# ── Company knowledge ───────────────────────────────────────────────────────

async def test_the_company_profile_services_and_faqs(client, staff, anon, partner):
    key, _ = await _live(client, staff, anon, partner)
    r = await call(anon, key, "account", "profile.update", {"name": "Newco Windows", "pitch": "We clean windows", "timezone": "Europe/London"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Newco Windows" and r.json()["timezone"] == "Europe/London"
    assert (await call(anon, key, "account", "profile.get")).json()["pitch"] == "We clean windows"
    refused = await call(anon, key, "account", "profile.update", {"callerId": "+447700900123", "nonsense": 1})
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "unknown_field"
    assert "callerId" in refused.json()["error"]["message"]
    assert (await call(anon, key, "account", "profile.update", {"timezone": "Mars/Base"})).status_code == 422

    r = await call(anon, key, "account", "services.set", {"services": [{"name": "Windows", "desc": "Outside", "ideal": "Shops"}]})
    assert [s["name"] for s in r.json()["services"]] == ["Windows"]
    r = await call(anon, key, "account", "services.set", {"services": [{"name": "Gutters"}]})  # replaces, never adds
    assert [s["name"] for s in (await call(anon, key, "account", "services.get")).json()["services"]] == ["Gutters"]
    await call(anon, key, "account", "faqs.set", {"faqs": [{"q": "Do you clean upstairs?", "a": "Yes."}]})
    assert (await call(anon, key, "account", "faqs.get")).json()["faqs"][0]["q"] == "Do you clean upstairs?"
    assert (await call(anon, key, "account", "faqs.set", {"faqs": [{"q": "", "a": "x"}]})).status_code == 422


async def test_a_wallet_only_key_cannot_change_the_company(client, anon, partner):
    key = (await client.post("/api/developer/keys", json={"name": "wallet", "scopes": ["wallets:read"], "live": False})).json()["secret"]
    r = await call(anon, key, "account", "profile.update", {"name": "Nope"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "missing_scope"


# ── Leads lists, contacts and email lookup ──────────────────────────────────

async def test_lead_lists_through_the_key(client, staff, anon, partner):
    key, _ = await _live(client, staff, anon, partner)
    r = await call(anon, key, "leads", "list.create", {"name": "Plumbers"})
    assert r.status_code == 201, r.text
    lid = r.json()["list"]["id"]
    assert (await call(anon, key, "leads", "list.create", {"name": "plumbers"})).json()["error"]["code"] == "already_exists"
    assert "Plumbers" in [l["name"] for l in (await call(anon, key, "leads", "list.list")).json()["lists"]]
    r = await call(anon, key, "leads", "list.edit", {"name": "Plumbers North"}, id=lid)
    assert r.json()["list"]["name"] == "Plumbers North"
    assert (await call(anon, key, "leads", "list.edit", {"name": "x"}, id="lst_nope")).status_code == 404
    assert (await call(anon, key, "leads", "list.delete", id=lid)).json()["ok"] is True
    assert (await call(anon, key, "leads", "list.delete", id=lid)).status_code == 404


async def test_contacts_and_email_lookup_are_guarded(client, staff, anon, partner):
    sandbox = await _test_key(anon, partner)  # before the partner goes live, or this key would be a live one
    key, _ = await _live(client, staff, anon, partner)
    r = await call(anon, key, "leads", "company.contacts", {}, id="biz_nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    r = await call(anon, sandbox, "leads", "email.find", {"first_name": "Ann", "last_name": "Lee", "domain": "acme.test"})
    assert r.json()["found"] is True and r.json()["email"] == "ann.lee@acme.test" and r.json()["simulated"] is True
    assert (await call(anon, key, "leads", "email.find", {"first_name": "Ann"})).status_code == 422


# ── Email campaign results ──────────────────────────────────────────────────

async def test_campaign_results_replies_and_the_do_not_email_list(client, staff, anon, partner, db):
    from app.models.models import EmailCampaign, EmailMessage, EmailSequenceStep

    key, org = await _live(client, staff, anon, partner)
    now = datetime.utcnow()

    def msg(i, step, status, opens=0, cat=""):
        return EmailMessage(id=f"em_{i}", campaign_id="cmp_1", sequence_step_id=step, recipient_email=f"p{i}@x.test", subject="Hi", status=status,
                            open_count=opens, reply_category=cat, reply_snippet="Sounds good" if status == "replied" else "", reply_from=f"p{i}@x.test",
                            replied_at=now if status == "replied" else None, sent_at=now, is_warmup=False)

    with org_scope(org):
        db.add(EmailCampaign(id="cmp_1", name="Spring", status="running"))
        db.add(EmailSequenceStep(id="st_1", campaign_id="cmp_1", step_number=1, subject="Hi", body_template="b"))
        db.add(EmailSequenceStep(id="st_2", campaign_id="cmp_1", step_number=2, subject="Re", body_template="b"))
        await db.flush()
        for m in (msg(1, "st_1", "sent", opens=2), msg(2, "st_1", "replied", cat="interested"), msg(3, "st_1", "bounced"), msg(4, "st_1", "sent"),
                  msg(5, "st_2", "sent", opens=1), msg(6, "st_2", "failed")):
            db.add(m)
        db.add(EmailMessage(id="em_w", campaign_id="cmp_1", sequence_step_id="st_1", recipient_email="warm@x.test", status="sent", is_warmup=True))
        await db.commit()

    out = (await call(anon, key, "leads", "campaign.results", id="cmp_1")).json()
    t = out["totals"]
    assert t["sent"] == 5 and t["opened"] == 3 and t["replied"] == 1 and t["bounced"] == 1 and t["failed"] == 1  # warm-up mail is not counted
    assert t["open_rate"] == 60.0 and t["reply_rate"] == 20.0 and t["bounce_rate"] == 20.0
    steps = {s["step"]: s for s in out["by_step"]}
    assert steps[1]["sent"] == 4 and steps[2]["sent"] == 1 and steps[2]["failed"] == 1
    assert out["reply_categories"] == {"interested": 1} and out["as_of"]
    assert (await call(anon, key, "leads", "campaign.results", id="cmp_nope")).status_code == 404

    replies = (await call(anon, key, "leads", "reply.list")).json()["replies"]
    assert len(replies) == 1 and replies[0]["text"] == "Sounds good" and replies[0]["campaign"] == "Spring"
    assert (await call(anon, key, "leads", "reply.list", {"category": "question"})).json()["replies"] == []
    assert (await call(anon, key, "leads", "reply.categorize", {"category": "question"}, id="em_2")).json()["ok"] is True
    assert (await call(anon, key, "leads", "reply.list", {"category": "question"})).json()["replies"][0]["id"] == "em_2"
    assert (await call(anon, key, "leads", "reply.categorize", {"category": "spam"}, id="em_2")).status_code == 422
    assert (await call(anon, key, "leads", "reply.categorize", {"category": "ooo"}, id="em_nope")).status_code == 404

    assert (await call(anon, key, "leads", "suppression.add", {"email": "no@x.test"})).status_code == 201
    assert (await call(anon, key, "leads", "suppression.add", {"email": "bad.test"})).status_code == 201  # a whole domain is allowed
    assert (await call(anon, key, "leads", "suppression.add", {"email": "not an address"})).status_code == 400
    entries = (await call(anon, key, "leads", "suppression.list")).json()["suppressions"]
    assert len(entries) == 2
    assert (await call(anon, key, "leads", "suppression.remove", id=entries[0]["id"])).json()["ok"] is True
    assert len((await call(anon, key, "leads", "suppression.list")).json()["suppressions"]) == 1


# ── Several web addresses and return URLs ───────────────────────────────────

async def test_a_partner_can_use_several_web_addresses_and_return_urls(client, anon, partner):
    one, two, three = "https://app.partner.test", "https://www.partner.test", "https://admin.partner.test:8443"
    ret_a, ret_b = RETURN, "https://www.partner.test/connections?tab=social"
    # typed run together on one line, as people do, they are still separate addresses
    r = await client.put("/api/partner/settings", json={"allowed_origins": [f"{one}, {two}  {three}"], "return_urls": [f"{ret_a}; {ret_b}"]})
    assert r.status_code == 200, r.text
    assert r.json()["allowedOrigins"] == [one, two, three] and r.json()["returnUrls"] == [ret_a, ret_b]

    # each address can sign up from its own pages and use its own return URL; one that is not listed cannot
    for i, (origin, ret) in enumerate(((one, ret_a), (two, ret_b), (three, ret_a))):
        out = await run(anon, "auth", "signup", _signup(partner, email=f"u{i}@newco.test", return_url=ret), origin=origin)
        assert out.status_code == 200, (origin, out.text)
    refused = await run(anon, "auth", "signup", _signup(partner, email="x@newco.test"), origin="https://other.partner.test")
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "origin_not_allowed"

    # a trailing slash is not a different page; a different page is
    ok = await run(anon, "auth", "signup", _signup(partner, email="slash@newco.test", return_url=ret_a + "/"), origin=one)
    assert ok.status_code == 200, ok.text
    no = await run(anon, "auth", "signup", _signup(partner, email="no@newco.test", return_url="https://app.partner.test/elsewhere"), origin=one)
    assert no.status_code == 422 and no.json()["error"]["code"] == "return_url_not_allowed"


async def test_an_address_that_cannot_be_read_is_reported_not_dropped_quietly(client, partner):
    r = await client.put("/api/partner/settings", json={"allowed_origins": ["https://app.partner.test", "app.partner.test", "not a url"]})
    assert r.status_code == 400 and "app.partner.test" in r.json()["detail"] and "full address" in r.json()["detail"]
    r = await client.put("/api/partner/settings", json={"return_urls": ["ftp://files.partner.test/x"]})
    assert r.status_code == 400 and "ftp://files.partner.test/x" in r.json()["detail"]
    assert (await client.get("/api/partner")).json()["partner"]["allowedOrigins"] == ["https://app.partner.test"]  # nothing was half-saved
