"""The changes made around the Leads chat, Social results, sign-in limits and web contacts: private chat history, cut-off posts,
DeepSeek search, session limits, web data that must belong to the company, and the share links with their dates."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


def _as(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


# ── Chat history: private to each person, kept until deleted ────────────────

def _chat(i, **over):
    return {"id": f"c_{i}", "title": f"Accountants {i}", "at": i, "filters": {"towns": ["leeds"]},
            "chat": [{"id": "m1", "role": "user", "text": "accountants in Leeds"}, {"id": "m2", "role": "assistant", "text": "Found 8.", "found": 8}], **over}


async def test_find_leads_chat_history_is_private_and_can_be_deleted(client, db):
    _, bob = await make_user(db, "bob_chat", "Operator")  # same company, another person
    r = await client.put("/api/enrichment/leads-chats", json=_chat(1))
    assert r.status_code == 200 and r.json()["saved"] is True
    mine = (await client.get("/api/enrichment/leads-chats")).json()["chats"]
    assert len(mine) == 1 and mine[0]["chat"][1]["found"] == 8 and mine[0]["filters"] == {"towns": ["leeds"]}

    async with _as(bob) as other:
        assert (await other.get("/api/enrichment/leads-chats")).json()["chats"] == []
        await other.delete("/api/enrichment/leads-chats/c_1")  # their own list has nothing to delete
    assert len((await client.get("/api/enrichment/leads-chats")).json()["chats"]) == 1

    # saving the same chat again updates it; it does not add a copy
    await client.put("/api/enrichment/leads-chats", json=_chat(1, title="Renamed"))
    mine = (await client.get("/api/enrichment/leads-chats")).json()["chats"]
    assert [c["title"] for c in mine] == ["Renamed"]

    # a conversation with no message from the person is not worth keeping
    empty = _chat(2, chat=[{"id": "m", "role": "assistant", "text": "Hello"}])
    assert (await client.put("/api/enrichment/leads-chats", json=empty)).json()["saved"] is False

    assert (await client.delete("/api/enrichment/leads-chats/c_1")).json()["deleted"] is True
    assert (await client.get("/api/enrichment/leads-chats")).json()["chats"] == []


async def test_chat_history_keeps_the_latest_thirty_and_each_plugin_has_its_own(client):
    for i in range(33):
        await client.put("/api/enrichment/leads-chats", json=_chat(i))
    chats = (await client.get("/api/enrichment/leads-chats")).json()["chats"]
    assert len(chats) == 30 and chats[0]["id"] == "c_32"  # newest first, the oldest were dropped

    voice = {"id": "v_1", "title": "Call list", "chat": [{"id": "a", "who": "user", "text": "find plumbers"}, {"id": "b", "who": "ai", "text": "Added 5."}]}
    assert (await client.put("/api/enrichment/chats/voice", json=voice)).json()["saved"] is True
    saved = (await client.get("/api/enrichment/chats/voice")).json()["chats"]
    assert [c["id"] for c in saved] == ["v_1"] and [m["who"] for m in saved[0]["chat"]] == ["user", "ai"]
    assert "v_1" not in [c["id"] for c in (await client.get("/api/enrichment/leads-chats")).json()["chats"]]
    assert (await client.get("/api/enrichment/chats/email")).status_code == 404
    assert (await client.delete("/api/enrichment/chats/voice/v_1")).json()["deleted"] is True


async def test_chat_history_needs_a_sign_in(anon):
    assert (await anon.get("/api/enrichment/leads-chats")).status_code == 401


async def test_the_reply_when_the_ai_is_unreachable_still_explains_the_list():
    from app.api.enrichment import _registry_fallback

    big = _registry_fallback("Town: Leeds", {"total": 1609, "capped": False, "leads": [{}] * 25})
    assert "1,609" in big and "first 25" in big and "Contacts" in big and "narrow" in big
    small = _registry_fallback("Town: Leeds", {"total": 3, "capped": False, "leads": [{}] * 3})
    assert "narrow" not in small


# ── Plan chats in Social are private to their owner ─────────────────────────

async def test_saved_plan_chats_belong_to_the_person_who_started_them(client, db):
    from app.models.models import PlanChatThread

    _, bob = await make_user(db, "bob_plan", "Operator")
    msgs = [{"id": "u1", "who": "user", "text": "Plan May"}]
    assert (await client.put("/api/scheduler/chat-threads/t_mine", json={"title": "May plan", "messages": msgs})).status_code == 200
    db.add(PlanChatThread(id="t_old", title="Before the rule", messages=[], created_by="", created_by_name=""))  # an old chat has no owner
    await db.commit()

    async with _as(bob) as other:
        titles = [t["title"] for t in (await other.get("/api/scheduler/chat-threads")).json()]
        assert titles == ["Before the rule"], "another person must not see it; only the old, ownerless chat stays open to the team"
        assert (await other.put("/api/scheduler/chat-threads/t_mine", json={"title": "Hijacked", "messages": msgs})).status_code == 404
        assert (await other.delete("/api/scheduler/chat-threads/t_mine")).status_code == 404
    mine = (await client.get("/api/scheduler/chat-threads")).json()
    assert {t["id"] for t in mine} == {"t_mine", "t_old"} and next(t for t in mine if t["id"] == "t_mine")["title"] == "May plan"


# ── Posts that stop in the middle of a sentence ─────────────────────────────

def test_a_cut_off_post_is_noticed_and_trimmed_to_its_last_full_sentence():
    from app.services.post_writer import looks_cut_off, trim_to_sentence

    cut = "Reports should prove value. Most teams cannot prove before"
    assert looks_cut_off(cut) and not looks_cut_off("Reports should prove value.")
    assert not looks_cut_off("Read more at https://example.com/post") and not looks_cut_off("Done. #reporting #ops")
    assert looks_cut_off("We help, and") and not looks_cut_off("")
    assert trim_to_sentence(cut) == "Reports should prove value."
    assert trim_to_sentence("No full stop here") == "No full stop here"


# ── DeepSeek web search ─────────────────────────────────────────────────────

def _fake_http(monkeypatch, status, payload, sent):
    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            sent.append({"url": url, "headers": headers, "json": json})
            return SimpleNamespace(status_code=status, json=lambda: payload)

    monkeypatch.setattr("app.services.enrichment_service.httpx.AsyncClient", Client)


async def test_deepseek_search_is_off_until_ticked_and_billed_only_when_it_finds_something(monkeypatch):
    from app.services import enrichment_service as ES

    sent, billed = [], []

    async def bump(name):
        billed.append(name)

    async def key():
        return "ds-key"

    monkeypatch.setattr(ES, "_bump_vendor_call", bump)
    monkeypatch.setattr(ES, "deepseek_key", key)
    results = {"results": [{"title": "Acme Ltd", "url": "https://acme.test", "summary": "Plumbers in Leeds"},
                           {"title": "Social page", "url": "https://www.facebook.com/acme", "snippet": "page"}]}
    _fake_http(monkeypatch, 200, results, sent)

    async def off():
        return False

    monkeypatch.setattr(ES, "deepseek_search_enabled", off)
    assert await ES.search_deepseek("plumbers in Leeds") == [] and sent == []  # unticked: no request at all

    async def on():
        return True

    monkeypatch.setattr(ES, "deepseek_search_enabled", on)
    out = await ES.search_deepseek("x" * 300, max_results=5)
    assert sent[0]["url"].endswith("/v1/tools/search") and len(sent[0]["json"]["query"]) == 128
    assert sent[0]["headers"]["Authorization"] == "Bearer ds-key"
    assert [r["url"] for r in out] == ["https://acme.test"] and out[0]["snippet"] == "Plumbers in Leeds"  # a social page is not a result
    assert billed == ["deepseek_search"]

    sent.clear()
    billed.clear()
    _fake_http(monkeypatch, 200, {"results": []}, sent)
    assert await ES.search_deepseek("nothing") == [] and billed == []  # an empty answer is not billed
    _fake_http(monkeypatch, 500, {}, sent)
    assert await ES.search_deepseek("broken") == [] and billed == []


async def test_staff_can_tick_the_deepseek_box(db):
    from app.services.credits import _get_doc, _put_doc

    await _put_doc(db, "web_search_settings", {"deepseek": True})
    await db.commit()
    from app.services.enrichment_service import deepseek_search_enabled

    assert await deepseek_search_enabled() is True
    await _put_doc(db, "web_search_settings", {"deepseek": False})
    await db.commit()
    assert await deepseek_search_enabled() is False
    assert (await _get_doc(db, "web_search_settings")) == {"deepseek": False}


# ── Web data must belong to the company ─────────────────────────────────────

async def test_web_contacts_drop_directory_sites_foreign_numbers_and_other_companies_emails(monkeypatch):
    from app.services import company_contacts as CC

    flushed = []

    async def flush():
        flushed.append(1)

    db = SimpleNamespace(flush=flush)
    biz = SimpleNamespace(name="PNP ENTERPRISES LTD", domain="", region="Leeds", raw_data={})

    async def wrong(**k):  # what an unfiltered search brought back for this name
        return {"domain": "https://www.yell.com/biz/pnp", "phones": ["+27 11 555 0100", "0113 555 0101"],
                "emails": ["info@pnp.co.za"], "team": [{"name": "A. Person", "title": "Owner", "email": "a@pnp.co.za", "phone": "+27 82 000 0000"}],
                "citations": ["https://www.yell.com/biz/pnp"]}

    monkeypatch.setattr("app.services.enrichment_service.enrich_prospect_intelligence", wrong)
    out = await CC.web_contacts(db, biz)
    assert out["website"] == "" and out["emails"] == [] and out["phones"] == ["0113 555 0101"]  # the +27 number and the foreign emails are gone
    assert out["team"][0]["email"] == "" and out["team"][0]["phone"] == ""  # the person stays, their foreign details do not

    async def nothing(**k):
        return {"domain": "", "phones": ["+27 11 555 0100"], "emails": ["x@y.co.za"], "team": []}

    monkeypatch.setattr("app.services.enrichment_service.enrich_prospect_intelligence", nothing)
    biz2 = SimpleNamespace(name="Empty Ltd", domain="", region="", raw_data={})
    miss = await CC.web_contacts(db, biz2)
    assert miss["found"] is False and "contacts_web" not in biz2.raw_data  # nothing that belongs to it: nothing is shown or saved

    async def good(**k):
        return {"domain": "https://www.acme-plumbing.test/about", "phones": ["+44 113 555 0102"], "emails": ["hello@acme-plumbing.test", "x@gmail.com"],
                "team": [], "citations": []}

    monkeypatch.setattr("app.services.enrichment_service.enrich_prospect_intelligence", good)
    biz3 = SimpleNamespace(name="Acme Plumbing Ltd", domain="", region="Leeds", raw_data={})
    ok = await CC.web_contacts(db, biz3)
    assert ok["found"] is True and ok["emails"] == ["hello@acme-plumbing.test"] and ok["phones"] == ["+44 113 555 0102"]
    assert biz3.raw_data["contacts_web"]["website"].endswith("acme-plumbing.test/about") or "acme-plumbing.test" in biz3.raw_data["contacts_web"]["website"]


# ── Sign-in limits ──────────────────────────────────────────────────────────

def test_session_limits_are_clamped_to_sensible_ranges():
    from app.services import session_policy as SP

    assert SP.normalise({"idle_minutes": 1, "max_hours": 9999}) == {"idle_minutes": 5, "max_hours": 168}
    assert SP.normalise({"idle_minutes": "abc", "max_hours": None})["idle_minutes"] == SP.DEFAULT_IDLE_MINUTES
    assert SP.normalise(None)["max_hours"] >= 1


async def test_a_company_can_make_the_limits_stricter_but_never_looser(client, db):
    from app.services import session_policy as SP

    await SP.save_policy(db, 60, 24)
    await db.commit()
    assert (await SP.get_policy(db, "org_default")) == {"idle_minutes": 60, "max_hours": 24}
    await SP.save_org_choice(db, "org_default", 20, 8)
    await db.commit()
    assert (await SP.get_policy(db, "org_default")) == {"idle_minutes": 20, "max_hours": 8}
    await SP.save_org_choice(db, "org_default", 300, 100)  # looser than the platform: held at the platform's
    await db.commit()
    assert (await SP.get_policy(db, "org_default")) == {"idle_minutes": 60, "max_hours": 24}

    got = (await client.get("/api/auth/session-policy")).json()
    assert got["idle_minutes"] == 60 and got["platform"]["max_hours"] == 24 and got["can_edit"] is True
    put = await client.put("/api/auth/session-policy", json={"idle_minutes": 15, "max_hours": 4})
    assert put.status_code == 200 and put.json()["idle_minutes"] == 15 and put.json()["max_hours"] == 4
    assert (await client.put("/api/auth/session-policy", json={})).json()["idle_minutes"] == 60  # emptied: back to the platform's


async def test_only_an_admin_can_change_the_company_limits(db):
    _, op = await make_user(db, "plain_user", "Operator")
    async with _as(op) as c:
        assert (await c.get("/api/auth/session-policy")).json()["can_edit"] is False
        assert (await c.put("/api/auth/session-policy", json={"idle_minutes": 10})).status_code == 403


async def test_staff_set_the_platform_limits(staff):
    r = await staff.put("/api/admin-api/session-policy", json={"idle_minutes": 45, "max_hours": 10})
    assert r.status_code == 200, r.text
    got = (await staff.get("/api/admin-api/session-policy")).json()
    assert got["idle_minutes"] == 45 and got["max_hours"] == 10


# ── Insights by channel, several channels at once, and the share dates ──────

async def _seed(db):
    from app.models.models import SocialAccount, SocialPost, SocialPostMetric

    now = datetime.utcnow()
    db.add(SocialAccount(id="acc_fb", platform="facebook", handle="Acme", account_id="9", access_token="t", status="connected"))
    db.add(SocialAccount(id="acc_li", platform="linkedin", handle="Ann", account_id="s", access_token="t", status="connected"))
    db.add(SocialAccount(id="acc_ig", platform="instagram", handle="acme_ig", account_id="i", access_token="t", status="connected"))
    for pid, title, plat, reach, eng in (("v2_a", "Spring offer", "facebook", 500, 40), ("v2_b", "Team story", "linkedin", 200, 5)):
        db.add(SocialPost(id=pid, title=title, copy="x", channels=[plat], status="published", published_at=(now - timedelta(days=1)).isoformat(),
                          due_at_ms=(now - timedelta(days=1)).timestamp() * 1000,
                          publish_results=[{"ok": True, "platform": plat, "id": "1", "url": f"https://example.test/{pid}", "accountId": f"acc_{plat[:2]}"}]))
        db.add(SocialPostMetric(id=f"{pid}:{plat}", post_id=pid, platform=plat, account_id=f"acc_{plat[:2]}", remote_id="1", published_at=now - timedelta(days=1),
                                fetched_at=now, reach=reach, impressions=reach * 2, likes=eng, comments=0, shares=0, clicks=3))
    await db.commit()


async def test_insights_split_by_network_and_accept_a_chosen_mix(client, db):
    await _seed(db)
    ins = (await client.get("/api/scheduler/insights?days=30")).json()
    by = {c["platform"]: c for c in ins["byChannel"]}
    assert set(by) == {"facebook", "linkedin", "instagram"} and by["instagram"]["posts"] == 0  # a connected network with no posts still has a row
    assert by["facebook"]["reach"] == 500 and by["linkedin"]["reach"] == 200 and ins["totals"]["reach"] == 700
    assert by["facebook"]["engagementRate"] is not None
    mix = (await client.get("/api/scheduler/insights?days=30&channel=facebook,linkedin")).json()
    assert {c["platform"] for c in mix["byChannel"]} == {"facebook", "linkedin"} and mix["totals"]["reach"] == 700
    one = (await client.get("/api/scheduler/insights?days=30&channel=linkedin")).json()
    assert [c["platform"] for c in one["byChannel"]] == ["linkedin"] and one["totals"]["reach"] == 200
    assert [p["id"] for p in one["top"]] == ["v2_b"]
    assert "perChannel" in ins["top"][0] and ins["top"][0]["channels"] == ["facebook"]
    assert (await client.get("/api/scheduler/insights?days=5")).status_code == 400


async def test_post_results_are_shared_by_link_and_by_email_with_their_dates(client, anon, db, monkeypatch):
    await _seed(db)
    link = (await client.post("/api/scheduler/posts/v2_a/results/link")).json()
    assert link["link"] and (await anon.get(link["link"][link["link"].index("/api/scheduler/post-results-view"):])).status_code == 200

    assert (await client.post("/api/scheduler/posts/v2_a/results/send", json={"to": ""})).status_code == 400  # nobody to send to
    assert (await client.post("/api/scheduler/posts/v2_a/results/send", json={"to": "boss@acme.test"})).status_code == 400  # email is not set up

    sent = []

    async def deliver(to, subject, html, text, reply_to=None):
        sent.append((to, subject, html, text))
        return {"ok": True}

    monkeypatch.setattr("app.core.mailer.configured", lambda: True)
    monkeypatch.setattr("app.core.mailer.send_system_email", deliver)
    r = await client.post("/api/scheduler/posts/v2_a/results/send", json={"to": "boss@acme.test, cfo@acme.test", "note": "Good month"})
    assert r.status_code == 200 and r.json()["sent"] == 2
    to, subject, html, text = sent[0]
    assert "Spring offer" in subject and "Good month" in html and "Numbers as of" in html and "This link works until" in html
    assert "Open the live results" in html


async def test_a_reports_email_says_when_its_numbers_are_from_and_when_the_link_ends(client, db, monkeypatch):
    await _seed(db)
    rep = (await client.post("/api/scheduler/reports", json={"name": "Acme monthly", "days": 30, "channels": [], "recipients": ["boss@acme.test"],
                                                              "frequency": "none"})).json()["report"]
    sent = []

    async def deliver(to, subject, html, text, reply_to=None):
        sent.append(html)
        return {"ok": True}

    monkeypatch.setattr("app.core.mailer.configured", lambda: True)
    monkeypatch.setattr("app.core.mailer.send_system_email", deliver)
    r = await client.post(f"/api/scheduler/reports/{rep['id']}/send", json={})
    assert r.status_code == 200 and r.json()["sent"] == 1
    assert "Numbers as of" in sent[0] and "This link works until" in sent[0] and "Open the full report" in sent[0]
    assert "Spring offer" in sent[0] and "Team story" in sent[0]


# ── The same-day meeting default ────────────────────────────────────────────

async def test_the_invite_preview_answers(client):
    r = await client.get("/api/calcom/invite-preview?role=attendee")
    assert r.status_code == 200 and r.json()
