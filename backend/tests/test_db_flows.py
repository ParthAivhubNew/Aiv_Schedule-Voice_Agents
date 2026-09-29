"""End-to-end flows against PostgreSQL: versions, approval, publishing, schedules, voices."""
import time
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy.future import select

pytestmark = pytest.mark.db


@pytest.fixture
async def client(db):
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def sent_mail(monkeypatch):
    """Capture outgoing email instead of sending it."""
    from app.services import approval_mail

    box = []

    async def fake_send(db, to, subject, html_body, text_body):
        box.append({"to": to, "subject": subject, "text": text_body})
        return {"ok": True, "from": "scheduler@test"}

    monkeypatch.setattr(approval_mail, "_send", fake_send)
    return box


async def _post(client, pid, **kw):
    body = {"id": pid, "title": "T " + pid, "copy": "Copy " + pid, "channels": ["linkedin"],
            "status": "awaiting_approval", "date": "2030-01-10", "time": "09:00", **kw}
    res = await client.post("/api/scheduler/posts/create", json=body)
    assert res.status_code == 200, res.text
    return res.json()["post"]


# ── Manual edits and versions ───────────────────────────────────────────────

async def test_hand_edits_keep_versions_and_undo(client):
    await _post(client, "v2_e1")
    r = await client.patch("/api/scheduler/posts/v2_e1", json={"copy": "Mine"})
    assert r.json()["post"]["editedByUser"] is True
    for i in range(12):
        await client.patch("/api/scheduler/posts/v2_e1", json={"copy": f"edit {i}"})
    versions = (await client.get("/api/scheduler/posts/v2_e1/versions")).json()["versions"]
    assert len(versions) == 10 and versions[0]["copy"] == "edit 11"
    r = await client.post(f"/api/scheduler/posts/v2_e1/versions/{versions[3]['id']}/restore")
    assert r.json()["post"]["copy"] == versions[3]["copy"]
    assert (await client.patch("/api/scheduler/posts/v2_e1", json={"title": " "})).status_code == 400
    assert (await client.patch("/api/scheduler/posts/v2_e1", json={"time": "25:00", "date": "2030-01-10"})).status_code == 400


async def test_live_posts_cannot_be_edited(client, db):
    from app.models.models import SocialPost

    await _post(client, "v2_live")
    post = (await db.execute(select(SocialPost).where(SocialPost.id == "v2_live"))).scalars().first()
    post.status = "published"
    await db.commit()
    assert (await client.patch("/api/scheduler/posts/v2_live", json={"copy": "x"})).status_code == 409


# ── Approval ────────────────────────────────────────────────────────────────

async def test_approval_email_link_and_stale_browser(client, db, sent_mail):
    from app.services import approval_mail
    from app.api.scheduler import _due_ms

    await client.put("/api/profile/org", json={"approverEmails": ["boss@test.local"], "timezone": "UTC"})
    await _post(client, "v2_a1")
    await _post(client, "v2_a2", copy="")  # nothing written yet: not sent for review
    n = await approval_mail.request_approvals(db, time.time() * 1000, lambda p: _due_ms(p, "UTC"), "http://test", force=True)
    assert n == 1 and sent_mail[0]["to"] == "boss@test.local"
    token = sent_mail[0]["text"].split("review?t=")[1].split()[0]

    page = await client.get("/api/scheduler/review", params={"t": token})
    assert "Approve" in page.text  # viewing changes nothing
    assert (await client.get("/api/scheduler/posts")).json()[0]["status"] == "awaiting_approval"

    done = await client.post("/api/scheduler/review", data={"t": token, "post": "v2_a1", "action": "approve"})
    assert "Approved 1 post" in done.text
    replay = await client.post("/api/scheduler/review", data={"t": token, "post": "v2_a1", "action": "approve"})
    assert "Nothing changed" in replay.text

    # A browser tab that still thinks the post is waiting must not undo the approval.
    kept = await _post(client, "v2_a1", knownStatus="awaiting_approval", copy="Copy v2_a1")
    assert kept["status"] == "approved" and kept["approvedBy"] == "boss@test.local"
    # Changing the text after approval sends it back for review.
    back = (await client.patch("/api/scheduler/posts/v2_a1", json={"copy": "new words"})).json()["post"]
    assert back["status"] == "awaiting_approval"


async def test_missed_approval_and_publish_retry(client, db, sent_mail, monkeypatch):
    from app.api import scheduler
    from app.models.models import SocialPost

    await client.put("/api/profile/org", json={"approverEmails": ["boss@test.local"], "timezone": "UTC"})
    past = (date.today() - timedelta(days=1)).isoformat()
    await _post(client, "v2_miss", date=past)
    await _post(client, "v2_pub", date=past, status="approved")

    async def always_fail(post, accounts, base):
        return {"ok": False, "allOk": False, "results": [{"ok": False, "platform": "linkedin", "error": "token expired"}]}

    monkeypatch.setattr(scheduler, "publish_post_to_accounts", always_fail)
    res = await scheduler.run_publish_due(db)
    assert res["missed"] == ["v2_miss"] and res["retrying"] == ["v2_pub"]
    post = (await db.execute(select(SocialPost).where(SocialPost.id == "v2_pub"))).scalars().first()
    await db.refresh(post)
    assert post.status == "approved" and post.publish_attempts == 1 and post.retry_at_ms > time.time() * 1000

    post.retry_at_ms = time.time() * 1000 - 1000  # the retry is due
    await db.commit()
    res = await scheduler.run_publish_due(db)
    await db.refresh(post)
    assert post.status == "failed" and res["retrying"] == []
    assert any("failed" in m["subject"] for m in sent_mail)


# ── Schedules ───────────────────────────────────────────────────────────────

async def test_schedule_makes_posts_ahead_and_keeps_hand_edits(client, db):
    from app.models.models import SocialPost

    await client.put("/api/profile/org", json={"timezone": "UTC"})
    start = (date.today() + timedelta(days=1)).isoformat()
    res = await client.post("/api/scheduler/schedules", json={
        "name": "Daily tips", "plan": "Tips", "channels": ["linkedin", "x"], "pattern": "daily",
        "startDate": start, "time": "09:00",
    })
    assert res.status_code == 200, res.text
    sched = res.json()["schedule"]
    assert sched["posts"] == 28  # 14 days ahead x 2 channels, not the whole 3 months
    posts = (await db.execute(select(SocialPost).where(SocialPost.schedule_id == sched["id"]))).scalars().all()
    first = sorted(posts, key=lambda p: p.occurrence)[0]
    busy = await client.patch(f"/api/scheduler/posts/{first.id}", json={"copy": "my own words"})
    assert busy.status_code == 409  # still queued for the AI writer
    first.gen_state = None  # the writer finished
    await db.commit()
    edited = await client.patch(f"/api/scheduler/posts/{first.id}", json={"copy": "my own words"})
    assert edited.status_code == 200

    res = await client.put(f"/api/scheduler/schedules/{sched['id']}", json={
        "name": "Weekly tips", "plan": "Tips", "channels": ["linkedin"], "pattern": "weekly",
        "weekdays": ["MO"], "startDate": start, "time": "10:00",
    })
    assert res.json()["replaced"] == 27
    kept = (await db.execute(select(SocialPost).where(SocialPost.id == first.id))).scalars().first()
    await db.refresh(kept)
    assert kept.detached and kept.copy == "my own words"

    res = await client.delete(f"/api/scheduler/schedules/{sched['id']}")
    assert res.status_code == 200
    left = (await db.execute(select(SocialPost).where(SocialPost.schedule_id == sched["id"]))).scalars().all()
    assert [p.id for p in left] == [first.id]


# ── Chat protection of hand-edited posts ────────────────────────────────────

async def test_bulk_chat_rewrite_skips_hand_edited_posts(client, db):
    from app.api.scheduler import _protect_hand_edits

    for pid in ("v2_c1", "v2_c2"):
        await _post(client, pid)
    await client.patch("/api/scheduler/posts/v2_c2", json={"title": "Our hiring story"})
    plan = {"posts": [{"id": "v2_c1", "existing": True, "revision": "shorter"},
                      {"id": "v2_c2", "existing": True, "revision": "shorter"}]}
    assert await _protect_hand_edits(db, plan, "", "make all shorter") == 1
    assert "revision" not in plan["posts"][1]
    plan["posts"][1]["revision"] = "shorter"
    assert await _protect_hand_edits(db, plan, "", "shorter, including our hiring story") == 0


# ── Voice library ───────────────────────────────────────────────────────────

async def _tts(db, name, key="sk_test_key_123456"):
    from app.models.models import Connection

    db.add(Connection(id="c_" + name.lower(), group_name="Text-to-Speech", name=name,
                      status="connected" if key else "not_configured", config={"api_key": key} if key else {}))
    await db.commit()


async def test_voice_library_picks_and_guards(client, db):
    from app.services.voice_plugin_plan import get_active_stack, set_active_stack

    set_active_stack({"engine": "livekit", "voice_kind": "", "voice_ref": ""})
    await _tts(db, "Cartesia")
    lib = (await client.get("/api/voices/library")).json()
    assert lib["active"]["status"] == "missing" and lib["builtins"] == []

    assert (await client.post("/api/voices/active", json={"kind": "builtin", "ref": "ara"})).status_code == 400
    bad = await client.post("/api/voices", json={"provider": "cartesia", "voiceId": "sk_car_abcdef123"})
    assert "API key" in bad.json()["detail"]

    lib = (await client.post("/api/voices", json={"provider": "cartesia", "voiceId": "a0e99841-438c-4a64-b679-ae501e7d6091", "label": "Sarah", "useForCalls": True})).json()
    assert lib["active"]["status"] == "ok" and lib["active"]["label"] == "Sarah"
    assert get_active_stack()["tts"] == "Cartesia"
    vid = lib["active"]["id"]
    assert (await client.delete(f"/api/voices/{vid}")).status_code == 400  # the call voice

    set_active_stack({"engine": "xai"})
    lib = (await client.post("/api/voices/active", json={"kind": "builtin", "ref": "ara-uk"})).json()
    assert lib["active"]["status"] == "ok" and get_active_stack()["tts"] == "xAI built-in (ara-uk)"


async def test_call_plan_uses_the_picked_voice_and_fails_clearly_without_its_key(client, db):
    from app.models.models import Connection
    from app.services.voice_plugin_plan import resolve_voice_plan, set_active_stack

    db.add(Connection(id="c_twilio", group_name="Telephony", name="Twilio", status="connected",
                      config={"api_key": "0123456789abcdef0123456789abcdef", "account_sid": "AC" + "0" * 32}))
    db.add(Connection(id="c_xai", group_name="Voice Orchestration", name="xAI Voice Agent", status="connected",
                      config={"api_key": "xai-test"}))
    # A Deepgram key could stand in as TTS; it must never speak in place of the picked voice.
    db.add(Connection(id="c_dg", group_name="Speech-to-Text", name="Deepgram", status="connected",
                      config={"api_key": "dg-test"}))
    await db.commit()
    await _tts(db, "Cartesia")
    set_active_stack({"engine": "xai", "carrier": "Twilio"})
    lib = (await client.post("/api/voices", json={"provider": "cartesia", "voiceId": "a0e99841-438c-4a64-b679-ae501e7d6091", "useForCalls": True})).json()
    plan = await resolve_voice_plan()
    assert plan.external_tts and plan.tts.provider == "cartesia" and plan.tts.voice_id.startswith("a0e99841")

    await client.post("/api/connections/clear-key", json={"layer": "Text-to-Speech", "provider": "Cartesia"})
    with pytest.raises(ValueError, match="no cartesia key"):
        await resolve_voice_plan()
    assert (await client.get("/api/voices/library")).json()["active"]["status"] == "key_missing"

    await client.post("/api/voices/active", json={"kind": "builtin", "ref": "rex"})
    plan = await resolve_voice_plan()
    assert plan.voice_name == "rex" and not plan.external_tts
    assert lib["active"]["id"]
