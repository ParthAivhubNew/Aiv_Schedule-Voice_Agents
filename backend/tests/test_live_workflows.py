"""The assistants write workflows with the real model. Runs only with LIVE_AI=1 (costs a few cents), on the scratch database.

    LIVE_AI=1 TEST_DATABASE_URL=postgresql+asyncpg://.../aiv_live pytest tests/test_live_workflows.py -s
"""
import os

import httpx
import pytest

from app.main import app
from app.services import workflows as W
from tests.conftest import make_user

pytestmark = [pytest.mark.db, pytest.mark.skipif(os.environ.get("LIVE_AI") != "1", reason="set LIVE_AI=1 to call the real model")]


async def ask(c, path, message):
    r = await c.post(path, json={"message": message})
    assert r.status_code == 200, r.text
    res = r.json()
    cards = [p for p in res["proposals"] if p["kind"] == "workflow"]
    print(f"\n> {message}\n  cards: {[(p['title'], p['params']['rule']['event'], p['params']['rule']['when'], [b.get('action') or b['type'] for b in p['params']['rule']['do']]) for p in cards]}\n  reply: {res['reply']}")
    return res, cards


@pytest.fixture
async def chat(db):
    _, token = await make_user(db, "livewf", "Admin", org_id="org_livewf")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=180, headers={"Authorization": f"Bearer {token}"}) as c:
        yield c


async def test_the_real_model_turns_a_sentence_into_a_valid_workflow_and_saves_nothing(chat):
    res, cards = await ask(chat, "/api/assistant/voice/ask", "Whenever a call ends and they asked for a callback, plan a follow-up for the next day and tell me.")
    assert len(cards) == 1
    rule = cards[0]["params"]["rule"]
    assert rule["event"] == "call.completed" and rule["when"] == {"outcome": "callback_requested"} and W.clean_workflow(rule)
    assert {"follow_up", "notify"} <= {b.get("action") for b in rule["do"]}

    res, cards = await ask(chat, "/api/leads/assistant/ask", "If someone opens my email, wait a day, and if they are still a new lead, add a note saying to chase them.")
    assert len(cards) == 1
    rule = cards[0]["params"]["rule"]
    assert rule["event"] == "email.opened" and any(b["type"] == "wait" for b in rule["do"]) and any(b["type"] == "if" for b in rule["do"])

    res, cards = await ask(chat, "/api/assistant/social/ask", "Tell me every time a post goes live.")
    assert len(cards) == 1 and cards[0]["params"]["rule"]["event"] == "post.published"

    assert (await chat.get("/api/together/workflows")).json()["workflows"] == []  # asked for, shown, not saved
