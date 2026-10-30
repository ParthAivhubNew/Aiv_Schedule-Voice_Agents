"""The Voice and Social assistants read only their own plugin's data for the signed-in organisation, show what they did, and only prepare
buttons for the person to press."""
import json
import time
from datetime import datetime, timedelta

import httpx
import pytest

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import CallLog, CallList, OrgPhoneNumber, SocialAccount, SocialPost
from app.services import llm_gateway
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def _call(name, **args):
    return {"id": f"c_{name}", "function": {"name": name, "arguments": json.dumps(args)}}


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    state = {"plan": {"success": True, "reply": "Hello", "tool_calls": []}, "seen": []}

    async def plan(**kw):
        return state["plan"]

    async def answer(**kw):
        state["seen"].append(kw["system_prompt"])
        return {"success": True, "reply": "Here is what I found."}

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    monkeypatch.setattr(llm_gateway, "call_open_chat_llm", answer)
    return state


def _log(i, name, outcome, org_days=1, summary=""):
    now = datetime.utcnow() - timedelta(days=org_days)
    return CallLog(id=f"cl{i}", canonical_name=name, listed_as=name, started_at="10:00", ended_at="10:05", duration="5 min", outcome=outcome, summary=summary,
                   phone="+441130000000", created_at=now)


async def test_voice_reads_my_calls_and_never_another_organisations(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("call_results", days=7)]}
    _, token = await make_user(db, "va1", "Admin", org_id="org_va1")
    with org_scope("org_va1"):
        db.add_all([_log(1, "Brew House", "meeting_booked"), _log(2, "Corner Cafe", "rejected")])
        await db.commit()
    with org_scope("org_other"):
        db.add(_log(3, "Someone Elses Ltd", "meeting_booked"))
        await db.commit()
    async with _client(token) as c:
        r = (await c.post("/api/assistant/voice/ask", json={"message": "how did my calls go?"})).json()
    prompt = fakes["seen"][-1]
    assert "2 finished calls" in prompt and "meeting booked 1" in prompt and "Brew House" in prompt and "Someone Elses" not in prompt
    assert r["reply"] == "Here is what I found." and r["steps"][0]["label"] == "Read your call results" and r["proposals"] == []


async def test_voice_finds_one_call_and_reads_its_summary(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("find_call", query="brew")]}
    _, token = await make_user(db, "va2", "Admin", org_id="org_va2")
    with org_scope("org_va2"):
        db.add(_log(4, "Brew House", "callback_requested", summary="Wants a callback Thursday after 2."))
        await db.commit()
    async with _client(token) as c:
        await c.post("/api/assistant/voice/ask", json={"message": "what happened with Brew House?"})
    assert "Wants a callback Thursday after 2." in fakes["seen"][-1]


async def test_voice_reads_numbers_lists_and_offers_a_button_not_an_action(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("voice_setup"), _call("call_lists"), _call("open_screen", screen="schedule")]}
    _, token = await make_user(db, "va3", "Admin", org_id="org_va3")
    with org_scope("org_va3"):
        db.add_all([OrgPhoneNumber(id="n1", e164="+441134960000", label="Main", status="active", is_default=True),
                    CallList(id="cl_a", name="Leeds cafes", row_count=20, called_count=5)])
        await db.commit()
    async with _client(token) as c:
        r = (await c.post("/api/assistant/voice/ask", json={"message": "set up calls"})).json()
    prompt = fakes["seen"][-1]
    assert "+441134960000" in prompt and "Leeds cafes has 20 people, 5 already called" in prompt
    assert [p["kind"] for p in r["proposals"]] == ["go"] and r["proposals"][0]["params"]["hash"] == "#/voice/schedule"


async def test_voice_refuses_a_screen_it_does_not_have(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("open_screen", screen="billing")]}
    _, token = await make_user(db, "va4", "Admin", org_id="org_va4")
    async with _client(token) as c:
        r = (await c.post("/api/assistant/voice/ask", json={"message": "open billing"})).json()
    assert r["proposals"] == [] and "no screen called 'billing'" in fakes["seen"][-1]


async def test_social_reads_my_posts_and_accounts(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("post_overview"), _call("my_accounts")]}
    _, token = await make_user(db, "sa1", "Admin", org_id="org_sa1")
    soon = (time.time() + 3600) * 1000
    with org_scope("org_sa1"):
        db.add_all([SocialPost(id="sp1", title="Oat latte launch", copy="x", channels=["linkedin"], status="approved", due_at_ms=soon),
                    SocialPost(id="sp2", title="Old post", copy="x", channels=["x"], status="published"),
                    SocialAccount(id="ac1", platform="linkedin", handle="brewhouse", status="connected"),
                    SocialAccount(id="ac2", platform="x", handle="brew", status="error", last_error="Token expired")])
        await db.commit()
    with org_scope("org_other"):
        db.add(SocialPost(id="sp3", title="Not mine", copy="x", channels=["x"], status="approved", due_at_ms=soon))
        await db.commit()
    async with _client(token) as c:
        r = (await c.post("/api/assistant/social/ask", json={"message": "what is going out?"})).json()
    prompt = fakes["seen"][-1]
    assert "approved 1" in prompt and "published 1" in prompt and "Oat latte launch" in prompt and "Not mine" not in prompt
    assert "x brew is error" in prompt and "Token expired" in prompt
    assert [s["label"] for s in r["steps"]] == ["Read your posts", "Checked your accounts"]


async def test_social_plan_request_becomes_a_button_into_the_planner(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("plan_posts", request="3 LinkedIn posts next week about our oat latte")]}
    _, token = await make_user(db, "sa2", "Admin", org_id="org_sa2")
    async with _client(token) as c:
        r = (await c.post("/api/assistant/social/ask", json={"message": "plan 3 posts about our oat latte"})).json()
    assert [p["kind"] for p in r["proposals"]] == ["plan"] and r["proposals"][0]["params"]["prompt"].startswith("3 LinkedIn posts")
    async with _client(token) as c:
        assert (await c.post("/api/assistant/social/ask", json={"message": "x"})).status_code == 200


async def test_each_plugin_has_its_own_daily_count_and_unknown_plugins_do_not_exist(db, fakes, monkeypatch):
    from app.api import plugin_assistant as PA

    monkeypatch.setattr(PA, "DAILY_MESSAGES", 1)
    _, token = await make_user(db, "va5", "Admin", org_id="org_va5")
    async with _client(token) as c:
        assert (await c.post("/api/assistant/voice/ask", json={"message": "hi"})).status_code == 200
        assert (await c.post("/api/assistant/voice/ask", json={"message": "again"})).status_code == 429
        assert (await c.post("/api/assistant/social/ask", json={"message": "hi"})).status_code == 200  # Social has its own count
        assert (await c.post("/api/assistant/leads/ask", json={"message": "hi"})).status_code == 404


async def test_a_person_without_the_section_cannot_use_that_assistant(db, fakes):
    _, token = await make_user(db, "va6", "Viewer", org_id="org_va6")  # a Viewer cannot change anything, so cannot post to either
    async with _client(token) as c:
        assert (await c.post("/api/assistant/voice/ask", json={"message": "hi"})).status_code == 403
        assert (await c.post("/api/assistant/social/ask", json={"message": "hi"})).status_code == 403


async def test_the_voice_stream_sends_steps_then_the_same_reply(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("show_credits")]}
    _, token = await make_user(db, "va7", "Admin", org_id="org_va7")
    async with _client(token) as c:
        r = await c.post("/api/assistant/voice/ask/stream", json={"message": "credits?"})
    events = [json.loads(line[6:]) for line in r.text.split("\n\n") if line.startswith("data: ")]
    kinds = [e["type"] for e in events]
    assert kinds[0] == "status" and kinds.index("tool") < kinds.index("step") < kinds.index("final")
    assert events[-1]["result"]["steps"][0]["label"] == "Read your credits"


async def test_when_the_ai_is_down_the_person_gets_a_plain_error(db, fakes):
    fakes["plan"] = {"success": False, "error": "boom"}
    _, token = await make_user(db, "va8", "Admin", org_id="org_va8")
    async with _client(token) as c:
        r = await c.post("/api/assistant/voice/ask", json={"message": "hi"})
    assert r.status_code == 502 and "did not answer" in r.json()["detail"]
