"""The newer assistant tools with the real model. Runs only with LIVE_AI=1 (costs a few cents), on the scratch database.

    LIVE_AI=1 TEST_DATABASE_URL=postgresql+asyncpg://.../aiv_live pytest tests/test_live_tools.py -s
"""
import os
import time
from datetime import datetime, timedelta

import httpx
import pytest

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import CallLog, CompanyProfile, LeadAccount, SocialPost
from tests.conftest import make_user

pytestmark = [pytest.mark.db, pytest.mark.skipif(os.environ.get("LIVE_AI") != "1", reason="set LIVE_AI=1 to call the real model")]


async def ask(c, path, message):
    r = await c.post(path, json={"message": message})
    assert r.status_code == 200, r.text
    res = r.json()
    print(f"\n> {message}\n  steps: {[s['label'] for s in res['steps']]}  cards: {[(p['kind'], p['title']) for p in res['proposals']]}\n  reply: {res['reply']}")
    return res


@pytest.fixture
async def world(db):
    org = "org_livetools"
    _, token = await make_user(db, "livetools", "Admin", org_id=org)
    with org_scope(org):
        db.add_all([
            CompanyProfile(id="default", name="Brew House", pitch="We roast coffee and supply oat milk to offices and cafes across Yorkshire.", caller_name="Sam"),
            CallLog(id="lc1", canonical_name="Corner Cafe", listed_as="Corner Cafe", started_at="10:00", ended_at="10:04", duration="4 min", outcome="callback_requested", summary="",
                    transcript=[{"who": "ai", "text": "Hi, is this the owner of Corner Cafe?"}, {"who": "them", "text": "Yes, but I am busy. Ring me back on Monday morning after nine."},
                                {"who": "ai", "text": "Of course, I will call Monday after nine."}], phone="+441130000009", created_at=datetime.utcnow() - timedelta(days=1)),
            SocialPost(id="sp1", title="Meet the roaster", copy="Meet Dan, who roasts every batch by hand in Leeds.", channels=["linkedin"], status="published", due_at_ms=(time.time() - 86400 * 3) * 1000),
            LeadAccount(id="l1", name="Roast Lane Ltd", stage="interested", contact_name="Mia Hall", contact_title="Owner", phone="01130000007", notes="Asked for a price list"),
        ])
        await db.commit()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=180, headers={"Authorization": f"Bearer {token}"}) as c:
        yield c


async def test_the_real_model_uses_the_new_tools_for_the_right_questions(world):
    r = await ask(world, "/api/assistant/voice/ask", "What exactly did Corner Cafe say to the AI caller?")
    assert "Read the call transcript" in [s["label"] for s in r["steps"]] and "Monday" in r["reply"]

    r = await ask(world, "/api/assistant/voice/ask", "Write me two better opening lines for the AI caller, shorter and friendlier.")
    assert "Drafted greetings" in [s["label"] for s in r["steps"]] and "1" in r["reply"] and "2" in r["reply"]

    r = await ask(world, "/api/assistant/social/ask", "Show me the full text of the roaster post.")
    assert "Read the post" in [s["label"] for s in r["steps"]] and "Dan" in r["reply"]

    r = await ask(world, "/api/assistant/social/ask", "Write me a LinkedIn post announcing our oat latte for offices.")
    assert "Wrote a draft post" in [s["label"] for s in r["steps"]] and r["proposals"] == [] and "oat" in r["reply"].lower()

    r = await ask(world, "/api/leads/assistant/ask", "Tell me everything about Roast Lane.")
    assert "Read the company" in [s["label"] for s in r["steps"]] and "Mia" in r["reply"]
