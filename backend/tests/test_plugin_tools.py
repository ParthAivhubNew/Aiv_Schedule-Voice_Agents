"""Tools added to the assistants later: read what was said on a call, search the uploaded documents, draft wording, make a call list from a Leads list,
read one post or one company. They read, draft or prepare a button; nothing is saved until the person presses it."""
import asyncio
import json
import time
from datetime import datetime, timedelta

import httpx
import pytest

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import CallLog, CompanyProfile, LeadAccount, SocialPost
from app.services import llm_gateway
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def _call(tool, **args):
    return {"id": f"c_{tool}", "function": {"name": tool, "arguments": json.dumps(args)}}


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    state = {"plan": {"success": True, "reply": "Hello", "tool_calls": []}, "seen": []}

    async def plan(**kw):
        return state["plan"]

    async def answer(**kw):
        state["seen"].append(kw["system_prompt"] + "\n" + "\n".join(str(m.get("content")) for m in kw["messages"]))
        return {"success": True, "reply": "Here is what I found."}

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    monkeypatch.setattr(llm_gateway, "call_open_chat_llm", answer)
    return state


def _log(i, name, outcome, transcript=None):
    return CallLog(id=f"tl{i}", canonical_name=name, listed_as=name, started_at="10:00", ended_at="10:05", duration="5 min", outcome=outcome, summary="",
                   transcript=transcript or [], phone="+441130000000", created_at=datetime.utcnow() - timedelta(days=1))


async def test_voice_reads_what_was_said_on_a_call_and_only_from_this_company(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("call_transcript", query="brew")]}
    _, token = await make_user(db, "vt1", "Admin", org_id="org_vt1")
    with org_scope("org_vt1"):
        db.add(_log(1, "Brew House", "meeting_booked", [{"who": "ai", "text": "Hi, is this Priya?"}, {"who": "them", "text": "Yes, Thursday at two works."}]))
        await db.commit()
    with org_scope("org_other"):
        db.add(_log(2, "Brew Other Ltd", "rejected", [{"who": "them", "text": "Secret of another company"}]))
        await db.commit()
    async with _client(token) as c:
        r = (await c.post("/api/assistant/voice/ask", json={"message": "what did Brew House say?"})).json()
    prompt = fakes["seen"][-1]
    assert "Thursday at two works" in prompt and "Secret of another company" not in prompt and r["steps"][0]["label"] == "Read the call transcript"


async def test_voice_answers_from_the_uploaded_documents_and_says_so_when_nothing_matches(db, fakes, monkeypatch):
    from app.services import rag_service

    hits = {"v": [{"title": "Price list", "content": "A sample box costs nothing and ships in 3 days.", "score": 0.9}]}

    async def fake_search(db_, query, top_k=3, min_score=0.45):
        return hits["v"]

    monkeypatch.setattr(rag_service, "search_knowledge", fake_search)
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("knowledge_search", question="how much is a sample box?")]}
    _, token = await make_user(db, "vk1", "Admin", org_id="org_vk1")
    async with _client(token) as c:
        r = (await c.post("/api/assistant/voice/ask", json={"message": "how much is a sample box?"})).json()
        assert "From the document “Price list”: A sample box costs nothing" in fakes["seen"][-1] and "1 passage" in r["steps"][0]["detail"]
        hits["v"] = []
        await c.post("/api/assistant/voice/ask", json={"message": "and shipping to Mars?"})
    assert "Nothing in the person's uploaded documents matches" in fakes["seen"][-1]


async def test_drafting_wording_changes_nothing_and_needs_a_filled_in_profile(db, fakes):
    _, token = await make_user(db, "vg1", "Admin", org_id="org_vg1")
    async with _client(token) as c:
        fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("draft_greeting", about="shorter")]}
        await c.post("/api/assistant/voice/ask", json={"message": "write me a better greeting"})
        assert "business profile is not filled in" in fakes["seen"][-1]  # no profile: no generic greeting
        with org_scope("org_vg1"):
            db.add(CompanyProfile(id="default", name="Brew House", pitch="Coffee for offices"))
            await db.commit()
        fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("draft_greeting", about="shorter"), _call("draft_greeting", about="friendlier")]}
        r = (await c.post("/api/assistant/voice/ask", json={"message": "write me a better greeting"})).json()
        assert "shown under your answer word for word" in fakes["seen"][-1]
        assert [s["label"] for s in r["steps"]].count("Drafted greetings") == 1  # asked twice in one message: written once
        assert r["reply"].count("Here is what I found.") == 2 and "\n\n" in r["reply"]  # the model's sentence, then the draft itself, word for word
        fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("write_caption", brief="our new oat latte", channel="linkedin")]}
        r = (await c.post("/api/assistant/social/ask", json={"message": "write a post about the oat latte"})).json()
    assert "A draft linkedin post was written and is shown under your answer" in fakes["seen"][-1] and r["reply"].count("Here is what I found.") == 2 and r["proposals"] == [] and r["steps"][0]["label"] == "Wrote a draft post"


async def _leads_list(db, org, ids, name="Leeds cafes"):
    from app.api import lead_lists

    with org_scope(org):
        await lead_lists._save(db, [{"id": f"lst_{org}", "name": name, "ids": ids}])
        await db.rollback()


async def test_a_call_list_is_made_from_a_leads_list_only_with_people_who_have_a_phone_and_only_when_pressed(db, fakes):
    org = "org_vc1"
    _, token = await make_user(db, "vc1", "Admin", org_id=org)
    with org_scope(org):
        db.add_all([LeadAccount(id="lc1", name="Brew House", phone="01130000001", contact_name="Priya"), LeadAccount(id="lc2", name="No Phone Cafe"), LeadAccount(id="lc3", name="Roast Lane", phone="01130000003")])
        await db.commit()
    await _leads_list(db, org, ["lc1", "lc2", "lc3"])
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("build_call_list", leads_list="leeds cafes", call_list_name="Leeds calls")]}
    async with _client(token) as c:
        r = (await c.post("/api/assistant/voice/ask", json={"message": "make a call list from my Leeds cafes"})).json()
        card = [p for p in r["proposals"] if p["kind"] == "call_list"][0]
        assert card["params"]["name"] == "Leeds calls" and [x["Company name"] for x in card["params"]["rows"]] == ["Brew House", "Roast Lane"] and card["params"]["left_out"] == 1
        assert card["params"]["rows"][0]["Lead ID"] == "lc1" and "left out" in card["detail"]
        assert (await c.get("/api/call-lists")).json()["lists"] == []  # a card only: nothing was made
        fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("build_call_list", leads_list="no such list")]}
        r = (await c.post("/api/assistant/voice/ask", json={"message": "again"})).json()
        assert [p for p in r["proposals"] if p["kind"] == "call_list"] == [] and "No Leads list is called" in fakes["seen"][-1]


async def test_a_plan_can_make_the_call_list_itself_once_the_person_pressed_run(db, fakes):
    org = "org_vc2"
    _, token = await make_user(db, "vc2", "Admin", org_id=org)
    with org_scope(org):
        db.add_all([LeadAccount(id="ld1", name="Brew House", phone="01130000001"), LeadAccount(id="ld2", name="Roast Lane", phone="01130000003")])
        await db.commit()
    await _leads_list(db, org, ["ld1", "ld2"])
    steps = [{"plugin": "voice", "tool": "build_call_list", "args": {"leads_list": "Leeds cafes", "call_list_name": "Leeds calls"}, "label": "Make the call list"}]
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("propose_plan", title="Call the Leeds cafes", steps=steps)]}
    async with _client(token) as c:
        plan = [p for p in (await c.post("/api/assistant/voice/ask", json={"message": "plan it"})).json()["proposals"] if p["kind"] == "plan_run"][0]["params"]["run"]
        assert plan["steps"][0]["kind"] == "do" and (await c.get("/api/call-lists")).json()["lists"] == []
        await c.post(f"/api/agent/runs/{plan['id']}/start")
        run = {}
        for _ in range(60):
            run = (await c.get(f"/api/agent/runs/{plan['id']}")).json()["run"]
            if run["status"] in ("done", "failed"):
                break
            await asyncio.sleep(0.2)
        lists = (await c.get("/api/call-lists")).json()["lists"]
    assert run["status"] == "done" and "Made the call list “Leeds calls” with 2 people" in run["steps"][0]["result"] and lists[0]["count"] == 2


async def test_social_reads_one_post_in_full_and_leads_reads_one_company(db, fakes):
    org = "org_vp1"
    _, token = await make_user(db, "vp1", "Admin", org_id=org)
    with org_scope(org):
        db.add_all([SocialPost(id="spx", title="Our new oat latte", copy="Oat latte is here, come and try it.", channels=["linkedin"], status="published", due_at_ms=(time.time() - 86400) * 1000),
                    LeadAccount(id="lx1", name="Brew House Ltd", stage="interested", contact_name="Priya Shah", contact_title="Owner", phone="01130000001", last_call_outcome="callback_requested", notes="Wants samples")])
        await db.commit()
    async with _client(token) as c:
        fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("post_details", query="oat latte")]}
        r = (await c.post("/api/assistant/social/ask", json={"message": "show me the oat latte post"})).json()
        assert "Oat latte is here, come and try it." in fakes["seen"][-1] and r["steps"][0]["label"] == "Read the post"
        fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("company_details", name="brew house")]}
        r = (await c.post("/api/leads/assistant/ask", json={"message": "tell me about Brew House"})).json()
    assert "stage interested; contact Priya Shah (Owner)" in fakes["seen"][-1] and "last call callback_requested" in fakes["seen"][-1] and r["steps"][0]["label"] == "Read the company"
