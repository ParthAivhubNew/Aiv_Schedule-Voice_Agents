"""The Voice and Social assistants against the real model. Runs only with LIVE_AI=1 (costs a few cents), on the scratch database.

    LIVE_AI=1 TEST_DATABASE_URL=postgresql+asyncpg://.../aiv_live pytest tests/test_live_plugin_assistants.py -s
"""
import json
import os
import time
from datetime import datetime, timedelta

import httpx
import pytest

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import CallList, CallLog, CallSchedule, OrgPhoneNumber, SocialAccount, SocialPost, SocialPostMetric
from tests.conftest import make_user

pytestmark = [pytest.mark.db, pytest.mark.skipif(os.environ.get("LIVE_AI") != "1", reason="set LIVE_AI=1 to call the real model")]


async def ask(c, plugin, message):
    r = await c.post(f"/api/assistant/{plugin}/ask/stream", json={"message": message})
    assert r.status_code == 200, r.text
    events = [json.loads(line[6:]) for line in r.text.split("\n\n") if line.startswith("data: ")]
    assert events[-1]["type"] == "final", events[-1]
    res = events[-1]["result"]
    print(f"\n[{plugin}] {message}\n  steps: {[s['label'] for s in res['steps']]}  buttons: {[(p['kind'], p['title']) for p in res['proposals']]}\n  reply: {res['reply']}")
    return res


@pytest.fixture
async def world(db):
    org = "org_livepa"
    _, token = await make_user(db, "livepa", "Admin", org_id=org)
    now = datetime.utcnow()
    with org_scope(org):
        db.add_all([
            CallLog(id="c1", canonical_name="Brew House", listed_as="Brew House", started_at="10:00", ended_at="10:06", duration="6 min", outcome="meeting_booked",
                    summary="Owner Priya wants a sample box and a meeting on Thursday at 2pm.", phone="+441130000001", created_at=now - timedelta(days=1)),
            CallLog(id="c2", canonical_name="Corner Cafe", listed_as="Corner Cafe", started_at="11:00", ended_at="11:01", duration="1 min", outcome="rejected",
                    summary="Not interested, already has a supplier.", phone="+441130000002", created_at=now - timedelta(days=2)),
            CallLog(id="c3", canonical_name="Roast Lane", listed_as="Roast Lane", started_at="12:00", ended_at="12:03", duration="3 min", outcome="callback_requested",
                    summary="Call back next Monday morning.", phone="+441130000003", created_at=now - timedelta(days=3)),
            OrgPhoneNumber(id="n1", e164="+441134960000", label="Main line", status="active", is_default=True),
            CallList(id="l1", name="Leeds cafes", row_count=40, called_count=3),
            CallSchedule(id="s1", name="Weekday mornings", list_id="l1", times=["10:00"], frequency="recurring", status="active"),
            SocialPost(id="p1", title="Our new oat latte", copy="x", channels=["linkedin"], status="approved", due_at_ms=(time.time() + 86400) * 1000),
            SocialPost(id="p2", title="Meet the roaster", copy="x", channels=["linkedin"], status="published"),
            SocialPostMetric(id="p2:linkedin", post_id="p2", platform="linkedin", published_at=now - timedelta(days=5), reach=1800, likes=64, comments=5, clicks=None),
            SocialAccount(id="a1", platform="linkedin", handle="brewhouse", status="connected"),
            SocialAccount(id="a2", platform="x", handle="brewhouse", status="error", last_error="Token expired"),
        ])
        await db.commit()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=180, headers={"Authorization": f"Bearer {token}"}) as c:
        yield c


async def test_the_real_model_answers_voice_questions_from_the_calls_it_was_given(world):
    r = await ask(world, "voice", "How did my calls go this week?")
    assert "Read your call results" in [s["label"] for s in r["steps"]]
    assert "meeting" in r["reply"].lower() and "3" in r["reply"]

    r = await ask(world, "voice", "What happened with Brew House?")
    assert [s["label"] for s in r["steps"]][0] == "Looked for the call"
    assert "Thursday" in r["reply"] or "sample" in r["reply"].lower()

    r = await ask(world, "voice", "Do I have any calls scheduled, and which numbers do I have?")
    assert "+441134960000" in r["reply"] or "Weekday mornings" in r["reply"]

    r = await ask(world, "voice", "I want to change what the AI caller says in its greeting")
    assert [p["kind"] for p in r["proposals"]] == ["go"]  # a button to the right screen, never a change made by the chat

    r = await ask(world, "voice", "Call everyone on my Leeds cafes list right now")
    assert all(p["kind"] == "go" for p in r["proposals"])  # it cannot place calls itself
    assert "calls" not in [s["label"] for s in r["steps"] if "placed" in s["label"].lower()]


async def test_the_real_model_answers_social_questions_from_the_posts_it_was_given(world):
    r = await ask(world, "social", "What is going out soon?")
    assert "oat latte" in r["reply"].lower()

    r = await ask(world, "social", "How did my posts do?")
    assert "1,800" in r["reply"] or "1800" in r["reply"]

    r = await ask(world, "social", "Are my accounts connected?")
    assert "expired" in r["reply"].lower() or "error" in r["reply"].lower()

    r = await ask(world, "social", "Plan 3 LinkedIn posts for next week about our oat latte")
    assert [p["kind"] for p in r["proposals"]] == ["plan"] and "oat latte" in r["proposals"][0]["params"]["prompt"].lower()

    r = await ask(world, "social", "Post the oat latte one right now")
    assert all(p["kind"] in ("plan", "go") for p in r["proposals"])  # it cannot publish itself

    r = await ask(world, "social", "hi")
    assert r["reply"] and not r["steps"]
