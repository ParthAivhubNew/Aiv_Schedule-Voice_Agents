"""Phase 2: social posts through the public API: prompt -> preview -> approve (link, email, app or API) -> live,
with the same record behind every door, a preview page that needs no sign-in, reminders and events."""
import re
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy.future import select

pytestmark = pytest.mark.db


def _http(token=None):
    from app.main import app

    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers)


@pytest.fixture(autouse=True)
def fresh_limits():
    from app.public_api import core

    core._WINDOWS.clear()
    yield
    core._WINDOWS.clear()


async def _key(admin_token, scopes=("social:write", "social:approve"), live=True):
    async with _http(admin_token) as c:
        r = await c.post("/api/developer/keys", json={"name": "Social key", "scopes": list(scopes), "live": live})
    assert r.status_code == 200, r.text
    return r.json()["secret"]


async def _ready_company(db):
    """A company that can post: a name, a connected LinkedIn account, one approver."""
    from app.models.models import CompanyProfile, SocialAccount

    db.add(CompanyProfile(id="default", name="Acme Ltd", approver_emails=["boss@acme.test"], timezone="Europe/London"))
    db.add(SocialAccount(id="acc1", platform="linkedin", status="connected", access_token="tok"))
    await db.commit()
    from app.services import credits as K

    await K.add_credits(db, "scheduler", 100, source="grant")
    await db.commit()


async def _written(db, post_id, caption="Hello from Acme", gen_state=None):
    """What the AI queue does when it finishes writing."""
    from app.models.models import SocialPost

    db.expire_all()
    p = (await db.execute(select(SocialPost).where(SocialPost.id == post_id))).scalars().first()
    p.title, p.copy, p.gen_state = "Acme news", caption, gen_state
    await db.commit()


async def test_a_prompt_becomes_a_queued_post_with_a_preview_link(db, admin_token):
    from app.models.models import SocialGenJob, SocialPost

    await _ready_company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/social/posts", json={"prompt": "Announce our new office", "channels": ["LinkedIn"]})
        assert r.status_code == 202, r.text
        post = r.json()
        assert post["id"].startswith("v2_") and post["status"] == "writing" and post["channels"] == ["linkedin"]
        assert post["publish_when_approved"] is True and "/api/p/" in post["preview_url"]
    db.expire_all()
    row = (await db.execute(select(SocialPost))).scalars().one()
    assert row.source == "api" and row.status == "awaiting_approval" and row.asap is True
    job = (await db.execute(select(SocialGenJob))).scalars().one()
    assert job.plan == "Announce our new office" and job.post_ids == [row.id] and job.state == "queued"


async def test_nothing_is_created_when_something_is_missing(db, admin_token):
    from app.models.models import CompanyProfile, SocialPost

    key = await _key(admin_token)
    async with _http(key) as c:
        no_company = await c.post("/v1/social/posts", json={"prompt": "Hello world"})
        assert no_company.status_code == 409 or no_company.status_code == 422  # not connected is checked first
    db.add(CompanyProfile(id="default", name="Acme Ltd"))
    await db.commit()
    async with _http(key) as c:
        r = await c.post("/v1/social/posts", json={"prompt": "Hello world", "channels": ["linkedin"]})
        assert r.status_code == 422 and r.json()["error"]["code"] == "channel_not_connected"
        assert r.json()["error"]["details"]["channels"] == ["linkedin"]
        bad = await c.post("/v1/social/posts", json={"prompt": "Hello world", "channels": ["myspace"]})
        assert bad.json()["error"]["code"] == "invalid_channel"
        past = await c.post("/v1/social/posts", json={"prompt": "Hello world", "publish_at": "2020-01-01T10:00:00Z"})
        assert past.json()["error"]["code"] == "publish_at_in_past"
        img = await c.post("/v1/social/posts", json={"prompt": "Hello world", "image": {"mode": "url", "url": "http://insecure.test/a.png"}})
        assert img.json()["error"]["code"] == "invalid_image_url"
    db.expire_all()
    assert (await db.execute(select(SocialPost))).scalars().all() == []


async def test_approve_through_the_api_is_the_only_way_it_goes_live(db, admin_token):
    from app.models.models import SocialPost

    await _ready_company(db)
    maker, approver = await _key(admin_token, ("social:write",)), await _key(admin_token, ("social:write", "social:approve"))
    async with _http(maker) as c:
        post = (await c.post("/v1/social/posts", json={"prompt": "Announce our new office"})).json()
        await _written(db, post["id"])
        got = (await c.get(f"/v1/social/posts/{post['id']}")).json()
        assert got["status"] == "needs_approval" and got["caption"] == "Hello from Acme"
        assert got["per_channel"] == [{"channel": "linkedin", "caption": "Hello from Acme"}]
        denied = await c.post(f"/v1/social/posts/{post['id']}/decision", json={"decision": "approve"})
        assert denied.status_code == 403 and denied.json()["error"]["code"] == "missing_scope"  # creating is not approving
    async with _http(approver) as c:
        ok = await c.post(f"/v1/social/posts/{post['id']}/decision", json={"decision": "approve"})
        assert ok.status_code == 200 and ok.json()["status"] == "approved" and ok.json()["approved_by"] == "api:Social key"
        again = await c.post(f"/v1/social/posts/{post['id']}/decision", json={"decision": "approve"})
        assert again.json()["status"] == "approved"  # asking twice changes nothing
    db.expire_all()
    row = (await db.execute(select(SocialPost))).scalars().one()
    assert row.status == "approved" and row.approved_by == "api:Social key"  # the app's own record


async def test_approval_closes_after_the_publish_time(db, admin_token):
    from app.models.models import SocialPost

    await _ready_company(db)
    key = await _key(admin_token)
    soon = (datetime.now(timezone.utc) + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    async with _http(key) as c:
        post = (await c.post("/v1/social/posts", json={"prompt": "Announce our new office", "publish_at": soon})).json()
        assert post["publish_when_approved"] is False and post["publish_at"].startswith(soon[:13])
        await _written(db, post["id"])
        db.expire_all()
        row = (await db.execute(select(SocialPost))).scalars().one()
        row.due_at_ms = time.time() * 1000 - 3600_000  # the slot passed an hour ago
        await db.commit()
        late = await c.post(f"/v1/social/posts/{post['id']}/decision", json={"decision": "approve"})
        assert late.status_code == 409 and late.json()["error"]["code"] == "approval_closed"
        later = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        reopened = await c.post(f"/v1/social/posts/{post['id']}/decision", json={"decision": "approve", "publish_at": later})
        assert reopened.status_code == 200 and reopened.json()["status"] == "approved"


async def test_reject_cancel_and_editing_send_a_post_back_for_approval(db, admin_token):
    await _ready_company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        a = (await c.post("/v1/social/posts", json={"prompt": "Announce our new office"})).json()
        await _written(db, a["id"])
        rej = (await c.post(f"/v1/social/posts/{a['id']}/decision", json={"decision": "reject", "note": "Too salesy"})).json()
        assert rej["status"] == "rejected" and "Too salesy" in rej["note"]
        approve_rejected = await c.post(f"/v1/social/posts/{a['id']}/decision", json={"decision": "approve"})
        assert approve_rejected.json()["error"]["code"] == "rejected"
        edited = (await c.patch(f"/v1/social/posts/{a['id']}", json={"caption": "A friendlier caption", "headline": "Office news"})).json()
        assert edited["status"] == "needs_approval" and edited["caption"] == "A friendlier caption"  # edit reopens it

        await c.post(f"/v1/social/posts/{a['id']}/decision", json={"decision": "approve"})
        changed = (await c.patch(f"/v1/social/posts/{a['id']}", json={"caption": "Changed after approval"})).json()
        assert changed["status"] == "needs_approval"  # approval covers what was reviewed, not what came after
        gone = (await c.post(f"/v1/social/posts/{a['id']}/decision", json={"decision": "cancel"})).json()
        assert gone["status"] == "canceled"

        empty = await c.patch(f"/v1/social/posts/{a['id']}", json={})
        assert empty.json()["error"]["code"] == "nothing_to_change"
        listed = (await c.get("/v1/social/posts?status=canceled")).json()
        assert [p["id"] for p in listed["data"]] == [a["id"]] and listed["next_cursor"] is None


async def test_asking_the_ai_to_redo_a_post_queues_work_the_app_charges_for(db, admin_token):
    from app.models.models import SocialGenJob

    async def pending():
        db.expire_all()
        jobs = (await db.execute(select(SocialGenJob))).scalars().all()
        return [(j.state, j.revision_note, j.skip_image) for j in jobs if j.error != "superseded"]

    await _ready_company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        p = (await c.post("/v1/social/posts", json={"prompt": "Announce our new office"})).json()
        busy = await c.patch(f"/v1/social/posts/{p['id']}", json={"regenerate": "text", "instruction": "shorter"})
        assert busy.status_code == 409 and busy.json()["error"]["code"] == "still_writing"
        await _written(db, p["id"])
        text = (await c.patch(f"/v1/social/posts/{p['id']}", json={"regenerate": "text", "instruction": "shorter"})).json()
        assert text["status"] == "writing"
        assert ("queued", "shorter", True) in await pending()  # a rewrite of the text only
        await _written(db, p["id"])
        image = (await c.patch(f"/v1/social/posts/{p['id']}", json={"image": {"mode": "ai", "instruction": "a sunny office"}})).json()
        assert image["status"] == "writing"
        assert [s[0] for s in await pending()] == ["image_queued"]  # a picture only; the writer is skipped


async def test_the_preview_page_needs_no_sign_in_and_acts_on_the_same_post(db, admin_token):
    from app.models.models import SocialPost
    from app.public_api import links

    await _ready_company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        p = (await c.post("/v1/social/posts", json={"prompt": "Announce our new office"})).json()
    await _written(db, p["id"], "We moved into a bigger office!")
    path = "/api/p/" + p["preview_url"].split("/api/p/")[1]
    async with _http() as anon:  # no Authorization header at all
        page = await anon.get(path)
        assert page.status_code == 200 and "We moved into a bigger office!" in page.text and "Approve" in page.text
        saved = await anon.post(path, data={"action": "save", "headline": "Bigger office", "caption": "Edited on the page", "publish_at": ""})
        assert "Saved" in saved.text and "Edited on the page" in saved.text
        approved = await anon.post(path, data={"action": "approve"})
        assert "Approved" in approved.text
        bad = await anon.get("/api/p/not-a-real-token")
        assert bad.status_code == 404
        expired = links.make_token("post", p["id"], "org_default", ttl_s=-5)
        assert (await anon.get(f"/api/p/{expired}")).status_code == 404
        other_kind = links.make_token("campaign", p["id"], "org_default")
        assert (await anon.get(f"/api/p/{other_kind}")).status_code == 404
    db.expire_all()
    row = (await db.execute(select(SocialPost))).scalars().one()
    assert row.status == "approved" and row.approved_by == "preview link" and row.copy == "Edited on the page"
    async with _http(key) as c:
        assert (await c.get(f"/v1/social/posts/{p['id']}")).json()["status"] == "approved"  # the API sees the page's decision


async def test_events_are_sent_once_and_approvers_get_one_reminder(db, admin_token, monkeypatch):
    from app.models.models import SocialPost
    from app.public_api import social_events as E
    from app.services import webhook_dispatcher as W

    await _ready_company(db)
    sent, mails = [], []
    monkeypatch.setattr(W, "dispatch_event", lambda org, event, data, test=False: sent.append(event))

    async def fake_send(db_, to, subject, html_body, text_body):
        mails.append((to, subject))
        return {"ok": True}

    monkeypatch.setattr("app.services.approval_mail._send", fake_send)
    key = await _key(admin_token)
    soon = (datetime.now(timezone.utc) + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    async with _http(key) as c:
        p = (await c.post("/v1/social/posts", json={"prompt": "Announce our new office", "publish_at": soon})).json()
    now = time.time() * 1000
    due_of = lambda post: post.due_at_ms  # noqa: E731
    await E.tick(db, now, due_of)
    assert sent == []  # still being written
    await _written(db, p["id"])
    await E.tick(db, now, due_of)
    await E.tick(db, now, due_of)
    assert sent == ["post.ready"]  # once, however many rounds
    assert len(mails) == 1 and mails[0][0] == "boss@acme.test" and "unless it is approved" in mails[0][1]  # due in 30 min: one reminder
    async with _http(key) as c:
        await c.post(f"/v1/social/posts/{p['id']}/decision", json={"decision": "approve"})
    await E.tick(db, now, due_of)
    assert sent == ["post.ready", "post.approved"]
    db.expire_all()
    row = (await db.execute(select(SocialPost))).scalars().one()
    row.status = "published"
    await db.commit()
    await E.tick(db, now, due_of)
    assert sent[-1] == "post.published" and len(mails) == 1


async def test_test_keys_get_a_full_pretend_flow_and_nothing_real_happens(db, admin_token, monkeypatch):
    from app.models.models import SocialGenJob, SocialPost
    from app.services import webhook_dispatcher as W

    events = []
    monkeypatch.setattr(W, "dispatch_event", lambda org, event, data, test=False: events.append((event, test)))
    key = await _key(admin_token, live=False)
    assert key.startswith("sk_test_")
    async with _http(key) as c:
        p = (await c.post("/v1/social/posts", json={"prompt": "Announce our new office", "channels": ["linkedin", "x"]})).json()
        assert p["id"].startswith("v2_test_") and p["status"] == "needs_approval" and p["test"] is True
        assert p["caption"].startswith("[Test post]") and len(p["per_channel"]) == 2
        done = (await c.post(f"/v1/social/posts/{p['id']}/decision", json={"decision": "approve"})).json()
        assert done["status"] == "published" and done["results"][0]["ok"] is True
        assert (await c.get(f"/v1/social/posts/{p['id']}")).json()["status"] == "published"
        assert (await c.get("/v1/social/posts")).json()["data"][0]["id"] == p["id"]
    assert events == [("post.ready", True), ("post.approved", True), ("post.published", True)]  # webhooks marked as test
    db.expire_all()
    assert (await db.execute(select(SocialPost))).scalars().all() == []
    assert (await db.execute(select(SocialGenJob))).scalars().all() == []  # no AI work, no charge
    path = "/api/p/" + p["preview_url"].split("/api/p/")[1]
    async with _http() as anon:
        assert "Test post" in (await anon.get(path)).text


async def test_you_only_see_your_own_companys_posts(db, admin_token):
    from tests.conftest import make_user

    await _ready_company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        p = (await c.post("/v1/social/posts", json={"prompt": "Announce our new office"})).json()
    _, other_admin = await make_user(db, "rival", "Admin", org_id="org_rival")
    async with _http(other_admin) as c:
        other_key = (await c.post("/api/developer/keys", json={"name": "Rival key", "scopes": ["social:write"], "live": False})).json()["secret"]
    async with _http(other_key) as c:
        assert (await c.get(f"/v1/social/posts/{p['id']}")).status_code == 404
        assert (await c.get("/v1/social/posts")).json()["data"] == []
