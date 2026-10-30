"""Journeys in the AI chat: a draft is written and edited at once, everything that sends, calls, adds people or changes a running journey is only
offered, and the chat can never start one."""
import json

import httpx
import pytest
from sqlalchemy import select

from app.api import lead_assistant as LA
from app.core.tenancy import org_scope
from app.main import app
from app.models.models import EmailCampaign, EmailEnrollment, EmailSequenceStep, JourneyTask, LeadAccount
from app.services import business_records, llm_gateway
from app.services import email_writer as W
from app.services import journeys as J
from tests.conftest import make_user

pytestmark = pytest.mark.db

STEPS = [{"channel": "email", "subject": "Hello {{company}}", "body": "Hi {{first_name}}"},
         {"channel": "call", "delay_days": 2, "condition": "no_reply", "goal": "Ask one question"},
         {"channel": "email", "subject": "", "body": "Following up", "delay_days": 3}]


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def _call(**args):
    return {"id": "c_journeys", "function": {"name": "journeys", "arguments": json.dumps(args)}}


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    state = {"plan": {"success": True, "reply": "", "tool_calls": []}}

    async def plan(**_):
        return state["plan"]

    async def answer(**_):
        return {"success": True, "reply": "Done."}

    async def empty(db, filters, **_):
        return {"total": 0, "total_capped": False, "rows": []}

    async def writer(db, profile, context, *, count=3, personalise=False, instruction="", goal=""):
        return [{"subject": "Idea for {{company}}" if i == 0 else "", "body": f"Email {i + 1} about {goal}", "delay_days": 0 if i == 0 else 3, "warnings": []} for i in range(count)]

    async def allowance(db, org, calls=1):
        return None

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    monkeypatch.setattr(llm_gateway, "call_open_chat_llm", answer)
    monkeypatch.setattr(business_records, "search_filtered", empty)
    monkeypatch.setattr(W, "draft_sequence", writer)
    monkeypatch.setattr(W, "spend_allowance", allowance)
    return state


async def _ask(token, message="go"):
    async with _client(token) as c:
        r = await c.post("/api/leads/assistant/ask", json={"message": message})
    assert r.status_code == 200, r.text
    return r.json()


async def _make(db, org, name="Leeds cafes", status="draft", steps=None):
    with org_scope(org):
        camp = await J.create(db, name=name, goal="Get a reply", steps=steps or STEPS, mailbox_ids=[])
        camp.status = status
        await db.commit()
        return camp.id


async def _steps(db, cid, org):
    db.expire_all()
    with org_scope(org):
        return [(s.channel, s.step_number, s.delay_days) for s in await J.steps_of(db, cid)]


async def _all(db, org, model):
    db.expire_all()
    with org_scope(org):
        return list((await db.execute(select(model))).scalars().all())


async def test_a_draft_is_written_from_the_goal_and_saved_but_nothing_is_sent(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call(action="draft", goal="Win dental practices in Leeds", channels=["call"], emails=3)]}
    _, token = await make_user(db, "ja1", "Admin", org_id="org_ja1")
    r = await _ask(token, "build me a journey for dental practices in Leeds")
    p = r["proposals"][0]
    assert p["kind"] == "journey_open" and p["params"]["journey_id"]
    with org_scope("org_ja1"):
        camp = await db.get(EmailCampaign, p["params"]["journey_id"])
        status, goal = camp.status, camp.goal
    assert status == "draft" and goal == "Win dental practices in Leeds"
    assert [c for c, *_ in await _steps(db, p["params"]["journey_id"], "org_ja1")] == ["email", "voice_call", "email", "email"]  # the call sits after the first email
    assert await _all(db, "org_ja1", EmailEnrollment) == []  # nobody is in it, so nothing can go out
    assert r["steps"][0]["label"] == "Wrote a draft journey"


async def test_a_draft_is_changed_at_once_and_a_running_journey_is_only_offered_the_change(db, fakes):
    _, token = await make_user(db, "ja2", "Admin", org_id="org_ja2")
    draft = await _make(db, "org_ja2")
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call(action="edit", journey="Leeds cafes", changes=[
        {"op": "add_step", "after": 1, "channel": "task", "title": "Look at their website", "wait_days": 1}, {"op": "set_wait", "step": 3, "wait_days": 5}])]}
    r = await _ask(token, "add a task after the first email and make the call wait 5 days")
    assert r["proposals"][0]["kind"] == "journey_open"
    got = await _steps(db, draft, "org_ja2")
    assert [c for c, *_ in got] == ["email", "task", "voice_call", "email"] and got[2][2] == 5
    # the same change to a journey that is running is not applied: the person confirms it on screen
    live = await _make(db, "org_ja2", name="Live one", status="running")
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call(action="edit", journey="Live one", changes=[{"op": "remove_step", "step": 2}])]}
    r = await _ask(token, "drop the call from Live one")
    p = r["proposals"][0]
    assert p["kind"] == "journey_edit" and p["params"] == {"journey_id": live, "changes": [{"op": "remove_step", "step": 2}]}
    assert len(await _steps(db, live, "org_ja2")) == 3
    async with _client(token) as c:  # confirming on screen applies it, through the same service
        done = await c.post(f"/api/journeys/{live}/changes", json={"changes": p["params"]["changes"]})
    assert done.status_code == 200 and [s["channel"] for s in done.json()["journey"]["steps"]] == ["email", "email"]


async def test_a_change_that_cannot_work_changes_nothing_and_says_why(db, fakes):
    _, token = await make_user(db, "ja3", "Admin", org_id="org_ja3")
    cid = await _make(db, "org_ja3")
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call(action="edit", journey="Leeds cafes", changes=[
        {"op": "set_wait", "step": 1, "wait_days": 2}, {"op": "remove_step", "step": 9}])]}
    r = await _ask(token)
    assert r["proposals"] == [] and len(await _steps(db, cid, "org_ja3")) == 3  # the first change was valid, but nothing half-applies
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call(action="edit", journey="No such journey", changes=[{"op": "remove_step", "step": 1}])]}
    assert (await _ask(token))["proposals"] == []


async def test_adding_people_is_offered_with_the_numbers_and_nobody_is_added(db, fakes):
    from app.api import lead_lists as LL

    _, token = await make_user(db, "ja4", "Admin", org_id="org_ja4")
    cid = await _make(db, "org_ja4")
    with org_scope("org_ja4"):
        ids = []
        for i, e in enumerate(["a@x.com", "b@x.com", "bad", "a@x.com"]):
            db.add(LeadAccount(id=f"ld_ja4_{i}", name=f"Co {i}", email=e, contact_name="Sam Lee"))
            ids.append(f"ld_ja4_{i}")
        await db.commit()
        await LL.put_in_list(db, "", "Leeds cafes", ids)
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call(action="add_people", journey="Leeds cafes", list_name="leeds cafes")]}
    r = await _ask(token)
    p = r["proposals"][0]
    assert p["kind"] == "journey_people" and "Add 2 people" in p["title"] and "invalid" in p["detail"] and "duplicate" in p["detail"]
    assert await _all(db, "org_ja4", EmailEnrollment) == []
    async with _client(token) as c:  # confirming on screen adds them
        done = await c.post(f"/api/journeys/{cid}/people", json={"list_id": p["params"]["list_id"], "how_many": p["params"]["how_many"]})
    assert done.json()["added"] == 2


async def test_the_chat_can_offer_to_start_a_journey_but_never_starts_it(db, fakes, monkeypatch):
    _, token = await make_user(db, "ja5", "Admin", org_id="org_ja5")
    cid = await _make(db, "org_ja5")
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call(action="start", journey="Leeds cafes")]}
    blocked = await _ask(token, "start it")
    assert blocked["proposals"] == []  # nobody is in it, so there is nothing to offer: it says what to fix

    async def ready(db_, camp, org):
        return [{"level": "green", "text": "Ready.", "fix": ""}]

    monkeypatch.setattr(J, "preflight", ready)
    r = await _ask(token, "start it")
    p = r["proposals"][0]
    assert p["kind"] == "journey_control" and p["params"] == {"journey_id": cid, "action": "start"} and p["title"] == "Start “Leeds cafes”"
    assert [c.status for c in await _all(db, "org_ja5", EmailCampaign)] == ["draft"]  # the chat did not start it
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call(action="stop", journey="Leeds cafes")]}
    assert (await _ask(token, "stop it"))["proposals"][0]["params"]["action"] == "stop"


async def test_open_tasks_are_offered_for_done_or_skip_and_not_changed(db, fakes):
    _, token = await make_user(db, "ja6", "Admin", org_id="org_ja6")
    cid = await _make(db, "org_ja6")
    with org_scope("org_ja6"):
        for i, kind in enumerate(["call_task", "call_task", "task"]):
            db.add(JourneyTask(id=f"jt_ja6_{i}", campaign_id=cid, enrollment_id=f"en_{i}", kind=kind, title=f"Task {i}", contact="Sam", status="open"))
        await db.commit()
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call(action="tasks_done", kind="call_task")]}
    r = await _ask(token, "mark my call tasks as done")
    p = r["proposals"][0]
    assert p["kind"] == "journey_tasks" and p["params"]["action"] == "done" and sorted(p["params"]["task_ids"]) == ["jt_ja6_0", "jt_ja6_1"]
    assert {t.status for t in await _all(db, "org_ja6", JourneyTask)} == {"open"}


async def test_the_chat_reads_a_journeys_numbers_and_advice_and_the_my_data_topics_list_journeys_and_tasks(db, fakes):
    _, token = await make_user(db, "ja7", "Admin", org_id="org_ja7")
    await _make(db, "org_ja7")
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call(action="report", journey="Leeds cafes")]}
    r = await _ask(token, "how is it doing?")
    assert r["steps"][0]["label"] == "Read a journey's results" and r["proposals"] == []
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [{"id": "c1", "function": {"name": "my_data", "arguments": json.dumps({"topic": "journeys"})}},
                                                                   {"id": "c2", "function": {"name": "my_data", "arguments": json.dumps({"topic": "tasks"})}}]}
    r = await _ask(token, "what journeys do I have?")
    assert [s["label"] for s in r["steps"]] == ["Read your journeys", "Read your tasks"]


async def test_a_saved_plan_can_draft_a_journey_on_its_own_and_stops_at_the_steps_that_need_the_person(db, fakes):
    from app.services import agent_runs as AR

    cat = AR.CATALOG["leads"]
    assert cat["journey_draft"]["kind"] == "do" and cat["journey_report"]["kind"] == "read"
    assert cat["journey_people"]["kind"] == "gate" and cat["journey_run"]["kind"] == "gate"  # adding people and starting wait for the person
    _, token = await make_user(db, "ja8", "Admin", org_id="org_ja8")
    turn = LA._Turn(LA.AskIn(message="run"), [])
    turn.actor = {"operator_id": "op_ja8", "perms": {}}
    with org_scope("org_ja8"):
        await LA._run_tool(db, turn, "journey_draft", {"goal": "Fill an open day", "emails": 2})
    assert turn.proposals[0]["kind"] == "journey_open"
    assert await _all(db, "org_ja8", EmailSequenceStep)


def test_the_assistants_tool_set_stays_small_with_journeys_in_it():
    names = [t["function"]["name"] for t in LA.TOOLS]
    assert "journeys" in names and len(names) <= 9  # the work itself, planning, switching, journeys and writing a workflow
    assert all(t["function"]["description"].startswith("USE") for t in LA.TOOLS)
