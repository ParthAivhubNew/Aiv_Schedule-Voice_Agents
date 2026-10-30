"""Every other AI chat in the app against the real model: Social's Plan AI, the general chat used by Voice, Leads and Social, and the live
call summary. Runs only with LIVE_AI=1 (it costs a few cents), against the scratch database. See test_live_ai_chat.py for the Leads chat.

    LIVE_AI=1 TEST_DATABASE_URL=postgresql+asyncpg://.../aiv_live pytest tests/test_live_ai_all.py -s
"""
import os

import httpx
import pytest

from app.main import app
from app.services import call_summary
from tests.conftest import make_user

pytestmark = [pytest.mark.db, pytest.mark.skipif(os.environ.get("LIVE_AI") != "1", reason="set LIVE_AI=1 to call the real model")]


@pytest.fixture
async def chat(db):
    _, token = await make_user(db, "live2", "Admin", org_id="org_live2")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=180,
                                 headers={"Authorization": f"Bearer {token}"}) as c:
        yield c


async def test_social_plan_chat_answers_a_question_and_builds_a_plan(chat):
    q = await chat.post("/api/scheduler/chat-plan", json={"text": "When is a good time to post on LinkedIn for a coffee shop?", "companyName": "Brew House"})
    q = q.json()
    print("\n[social question]", q.get("status"), "|", (q.get("reply") or "")[:300], "| posts:", len(q.get("posts") or []))
    assert q["status"] == "ok" and q["reply"].strip()

    p = await chat.post("/api/scheduler/chat-plan", json={
        "text": "Plan 3 LinkedIn posts for next week for Brew House, a coffee shop in Leeds. One about our new oat latte.",
        "companyName": "Brew House", "companyPitch": "Independent coffee shop in Leeds", "selectedChannels": ["linkedin"]})
    p = p.json()
    print("[social plan]", p.get("status"), "|", (p.get("reply") or "")[:300], "| posts:", [(x.get("date"), (x.get("title") or x.get("headline") or "")[:50]) for x in p.get("posts") or []])
    assert p["status"] == "ok" and p["reply"].strip()
    assert 1 <= len(p["posts"]) <= 6


@pytest.mark.parametrize("plugin", ["voice", "leadgen", "scheduler"])
async def test_the_general_chat_answers_for_each_plugin(chat, plugin):
    r = await chat.post("/api/enrichment/copilot-chat", json={"message": "In two sentences, what is a good opening line for a cold call to a dentist?", "plugin": plugin})
    body = r.json()
    print(f"\n[general chat · {plugin}]", r.status_code, "|", str(body.get("reply") or body)[:300])
    assert r.status_code == 200 and str(body.get("reply") or "").strip()


async def test_the_live_call_summary_reads_a_transcript(db):
    lines = [{"who": "ai", "text": "Hi, this is Sam from Brew House. Is this a good time?"},
             {"who": "them", "text": "Yes, go ahead."},
             {"who": "ai", "text": "We supply oat milk to cafes. Would you like a free sample box?"},
             {"who": "them", "text": "Sure, send it to 12 High Street, Leeds, and call me back Thursday after 2."},
             {"who": "ai", "text": "Great, sample box to 12 High Street and a call Thursday after 2pm."},
             {"who": "them", "text": "Perfect, thanks."}]
    text = await call_summary.summarize(db, lines, final=True)
    print("\n[call summary]", text)
    assert text.strip() and "Thursday" in text
