"""Workflows: events, filters, if/else, waits, runs that can be read, retried and tried without changing anything."""
import json
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import LeadAccount, WorkflowRun
from app.services import llm_gateway
from app.services import workflows as W
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def _rule(**kw):
    base = {"name": "Test", "event": "call.completed", "when": {}, "do": [{"type": "action", "action": "set_stage", "value": "interested"}]}
    base.update(kw)
    return base


async def _lead(db, org, id="la_w1", **kw):
    with org_scope(org):
        db.add(LeadAccount(id=id, name=kw.pop("name", "Kirkgate Dental"), phone=kw.pop("phone", "01134960001"), **kw))
        await db.commit()
        await db.rollback()


async def _fire(org, event, data):
    """What the event bus does: the handler runs inside the company the event belongs to."""
    with org_scope(org):
        await W.on_event(org, event, data)


async def _runs(db, org, **where):
    db.expire_all()  # other sessions changed these rows
    with org_scope(org):
        rows = (await db.execute(select(WorkflowRun).where(*[getattr(WorkflowRun, k) == v for k, v in where.items()]).order_by(WorkflowRun.created_at))).scalars().all()
        out = [(r.status, [(l["label"], l["result"]) for l in r.log], r.workflow_name) for r in rows]
        await db.rollback()
    return out


async def _stage(db, org, id="la_w1"):
    db.expire_all()
    with org_scope(org):
        s = (await db.get(LeadAccount, id)).stage
        await db.rollback()
    return s


async def _save(db, org, *rules):
    with org_scope(org):
        saved = await W.save_workflows(db, list(rules))
        await db.rollback()
    return saved


# ── Saving ──────────────────────────────────────────────────────────────────
def test_old_rules_still_read_and_new_blocks_are_checked():
    old = W.clean_workflow({"name": "Old", "event": "call.completed", "when": {"outcome": "rejected"}, "do": [{"action": "set_stage", "value": "lost"}]})
    assert old and old["do"][0]["type"] == "action" and old["limits"]["reenroll"] == "every" and old["conditions"] == []
    assert W.clean_workflow(_rule(do=[{"type": "wait", "hours": 0}])) is None  # a wait is at least an hour
    assert W.clean_workflow(_rule(do=[{"type": "wait", "hours": 24 * 31}])) is None  # and at most 30 days
    assert W.clean_workflow(_rule(do=[{"type": "wait", "hours": 2}, {"type": "stop"}]))
    assert W.clean_workflow(_rule(do=[{"type": "action", "action": "set_stage", "value": "nonsense"}])) is None
    assert W.clean_workflow(_rule(event="made.up")) is None
    assert W.clean_workflow(_rule(when={"outcome": "interested"})) is None  # that outcome belongs to replies, not calls
    nested = {"type": "if", "cond": {"field": "stage", "op": "is", "value": "new"}, "then": [{"type": "action", "action": "notify", "value": "Hi"}], "else": []}
    assert W.clean_workflow(_rule(do=[nested]))["do"][0]["cond"]["field"] == "stage"
    deep = {"type": "if", "cond": nested["cond"], "then": [dict(nested, then=[dict(nested)])], "else": []}
    assert W.clean_workflow(_rule(do=[deep])) is None  # nesting stops at two levels
    assert W.clean_workflow(_rule(conditions=[{"field": "stage", "op": "is", "value": "bogus"}])) is None
    assert W.clean_workflow(_rule(do=[{"type": "action", "action": "follow_up", "value": "Call", "days": 400}]))["do"][0]["days"] == 365
    assert W.clean_workflow(_rule(do=[{"type": "action", "action": "webhook", "value": "ftp://x.test/hook"}])) is None
    assert W.clean_workflow(_rule(do=[{"type": "action", "action": "set_stage", "value": "won"}] * (W.MAX_BLOCKS + 1))) is None


def test_a_comparison_said_another_way_still_reads():
    flow = {"type": "if", "cond": {"field": "stage", "op": "equals", "value": "new"}, "then": [{"action": "add_note", "value": "Chase"}]}
    assert W.clean_workflow(_rule(do=[flow]))["do"][0]["cond"]["op"] == "is"
    assert W.clean_condition({"field": "region", "op": "includes", "value": "leeds"})["op"] == "contains"
    assert W.clean_condition({"field": "stage", "op": "sort of", "value": "new"}) is None


def test_every_template_is_a_valid_workflow_once_its_blanks_are_filled():
    for t in W.TEMPLATES:
        raw = {k: t[k] for k in ("name", "event", "when", "do")}
        raw["do"] = [dict(s, value=s.get("value") or "https://example.com/hook") if s.get("action") == "webhook" else s for s in raw["do"]]
        assert W.clean_workflow(raw), t["id"]


# ── Running ─────────────────────────────────────────────────────────────────
async def test_a_matching_event_runs_the_flow_and_writes_every_line_in_the_run(db):
    org = "org_wf1"
    await _lead(db, org)
    await _save(db, org, _rule(name="Callback", when={"outcome": "callback_requested"}, do=[
        {"type": "action", "action": "set_stage", "value": "interested"},
        {"type": "action", "action": "follow_up", "value": "Call {{company}} back", "days": 1},
        {"type": "action", "action": "notify", "value": "{{company}} asked for a callback."}]))
    await _fire(org, "call.completed", {"lead_id": "la_w1", "outcome": "rejected", "id": "c0"})
    assert await _runs(db, org) == []  # a different outcome: nothing starts
    await _fire(org, "call.completed", {"lead_id": "la_w1", "outcome": "callback_requested", "id": "c1"})
    (status, lines, name), = await _runs(db, org)
    assert status == "done" and name == "Callback" and [l[0] for l in lines] == ["Move the lead to a stage", "Plan a follow-up for the lead", "Send me a notification"]
    assert "stage to interested" in lines[0][1] and "Call Kirkgate Dental back" in lines[1][1]
    assert await _stage(db, org) == "interested"
    with org_scope(org):
        lead = await db.get(LeadAccount, "la_w1")
        assert lead.next_action == "Call Kirkgate Dental back" and lead.next_action_at > datetime.utcnow()
        await db.rollback()


async def test_the_same_event_never_runs_twice_and_filters_decide_who_it_applies_to(db):
    org = "org_wf2"
    await _lead(db, org, id="la_a", name="Leeds Cafe", region="Leeds", email="a@x.test")
    await _lead(db, org, id="la_b", name="York Cafe", region="York")
    await _save(db, org, _rule(name="Leeds only", conditions=[{"field": "region", "op": "contains", "value": "leeds"}, {"field": "has_email", "op": "is", "value": "yes"}]))
    for lead_id, call in (("la_a", "c1"), ("la_a", "c1"), ("la_b", "c2")):
        await _fire(org, "call.completed", {"lead_id": lead_id, "outcome": "contacted", "id": call})
    runs = await _runs(db, org)
    assert [r[0] for r in runs] == ["done", "skipped"]  # the repeat was ignored; York did not match
    assert "did not match: Town or area contains leeds" in runs[1][1][0][1]
    assert await _stage(db, org, "la_a") == "interested" and await _stage(db, org, "la_b") == "new"


async def test_if_else_goes_down_the_branch_that_fits_and_stop_ends_the_flow(db):
    org = "org_wf3"
    await _lead(db, org, id="la_x", industry="Dental")
    branch = {"type": "if", "cond": {"field": "industry", "op": "contains", "value": "dental"},
              "then": [{"type": "action", "action": "add_note", "value": "A dentist"}, {"type": "stop"}], "else": [{"type": "action", "action": "set_stage", "value": "lost"}]}
    await _save(db, org, _rule(do=[branch, {"type": "action", "action": "set_stage", "value": "won"}]))
    await _fire(org, "call.completed", {"lead_id": "la_x", "id": "c1"})
    (status, lines, _), = await _runs(db, org)
    assert status == "done" and [l[0] for l in lines] == ["If Industry contains dental", "Add a note to the lead's timeline", "Stop"]
    assert await _stage(db, org, "la_x") == "new"  # stop came before "won", and the else branch never ran


async def test_a_wait_parks_the_run_until_its_time_and_then_carries_on(db):
    org = "org_wf4"
    await _lead(db, org, id="la_w")
    await _save(db, org, _rule(do=[{"type": "wait", "hours": 24}, {"type": "if", "cond": {"field": "stage", "op": "is", "value": "new"},
                                                                     "then": [{"type": "action", "action": "set_stage", "value": "contacted"}], "else": []}]))
    await _fire(org, "call.completed", {"lead_id": "la_w", "id": "c1"})
    (status, lines, _), = await _runs(db, org)
    assert status == "waiting" and lines[0][0] == "Wait" and await _stage(db, org, "la_w") == "new"
    assert await W.resume_due() == 0  # not yet
    with org_scope(org):
        run = (await db.execute(select(WorkflowRun))).scalars().first()
        run.resume_at = datetime.utcnow() - timedelta(minutes=1)
        await db.commit()
    assert await W.resume_due() == 1
    (status, lines, _), = await _runs(db, org)
    assert status == "done" and [l[0] for l in lines][-1] == "Move the lead to a stage" and await _stage(db, org, "la_w") == "contacted"


async def test_a_wait_stops_if_the_workflow_was_turned_off_or_the_company_deleted(db):
    org = "org_wf5"
    await _lead(db, org, id="la_gone")
    await _save(db, org, _rule(do=[{"type": "wait", "hours": 1}, {"type": "action", "action": "set_stage", "value": "won"}]))
    await _fire(org, "call.completed", {"lead_id": "la_gone", "id": "c1"})
    with org_scope(org):
        run = (await db.execute(select(WorkflowRun))).scalars().first()
        run.resume_at = datetime.utcnow() - timedelta(minutes=1)
        await db.delete(await db.get(LeadAccount, "la_gone"))
        await db.commit()
    await W.resume_due()
    (status, lines, _), = await _runs(db, org)
    assert status == "stopped" and lines[-1] == ("Stopped", "The company was deleted.")


async def test_a_failing_block_stops_the_run_there_and_a_retry_carries_on(db, monkeypatch):
    org = "org_wf6"
    await _lead(db, org, id="la_f")
    await _save(db, org, _rule(do=[{"type": "action", "action": "set_stage", "value": "contacted"}, {"type": "action", "action": "notify", "value": "Hi"},
                                   {"type": "action", "action": "set_stage", "value": "won"}]))
    real = W.run_action
    calls = {"n": 0}

    async def flaky(db_, org_id, lead, step, rule, dry=False, event="", data=None):
        calls["n"] += 1
        if step["action"] == "notify" and calls["n"] == 2:
            raise RuntimeError("the notification service is down")
        return await real(db_, org_id, lead, step, rule, dry, event, data)

    monkeypatch.setattr(W, "run_action", flaky)
    await _fire(org, "call.completed", {"lead_id": "la_f", "id": "c1"})
    (status, lines, _), = await _runs(db, org)
    assert status == "failed" and lines[-1] == ("Send me a notification", "the notification service is down") and await _stage(db, org, "la_f") == "contacted"
    _, token = await make_user(db, "wf6", "Admin", org_id=org)
    async with _client(token) as c:
        run_id = (await c.get("/api/together/workflow-runs?status=failed")).json()["runs"][0]["id"]
        assert (await c.post(f"/api/together/workflow-runs/{run_id}/retry")).json()["run"]["status"] == "done"
    assert await _stage(db, org, "la_f") == "won"


async def test_an_event_with_no_lead_still_runs_the_actions_that_need_none(db):
    org = "org_wf7"
    await _save(db, org, _rule(name="Post live", event="post.published", do=[{"type": "action", "action": "notify", "value": "A post went live."},
                                                                             {"type": "action", "action": "set_stage", "value": "won"}]))
    await _fire(org, "post.published", {"id": "p1"})
    (status, lines, _), = await _runs(db, org)
    assert status == "done" and lines[0][1] == "send you a notification" and lines[1][1] == "skipped: this event has no lead behind it"


async def test_re_enrolment_and_the_daily_limit_hold_runs_back_and_say_why(db):
    org = "org_wf8"
    await _lead(db, org, id="la_r")
    await _save(db, org, _rule(name="Once", limits={"reenroll": "once", "per_day": 100}), _rule(name="Capped", limits={"reenroll": "every", "per_day": 2}, id="wf_cap"))
    for n in range(4):
        await _fire(org, "call.completed", {"lead_id": "la_r", "id": f"c{n}"})
    once = await _runs(db, org, workflow_name="Once")
    capped = await _runs(db, org, workflow_name="Capped")
    assert [r[0] for r in once] == ["done", "skipped", "skipped", "skipped"] and "already went through it" in once[1][1][0][1]
    assert [r[0] for r in capped] == ["done", "done", "skipped", "skipped"] and "limit of 2 runs" in capped[2][1][0][1]


async def test_a_webhook_step_posts_the_lead_details_and_a_bad_address_is_never_called(db, monkeypatch):
    org = "org_wf9"
    await _lead(db, org, id="la_h", email="h@x.test")
    posted = []

    class Resp:
        status_code = 200

    class Client:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None): posted.append((url, json)); return Resp()

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    monkeypatch.setattr("app.services.webhook_dispatcher.url_problem", lambda u: None)
    await _save(db, org, _rule(do=[{"type": "action", "action": "webhook", "value": "https://hooks.example.com/in"}]))
    await _fire(org, "call.completed", {"lead_id": "la_h", "id": "c1"})
    assert posted[0][0] == "https://hooks.example.com/in" and posted[0][1]["lead"]["email"] == "h@x.test" and posted[0][1]["event"] == "call.completed"
    monkeypatch.setattr("app.services.webhook_dispatcher.url_problem", lambda u: "That address points inside a private network, which is not allowed.")
    assert W.clean_workflow(_rule(do=[{"type": "action", "action": "webhook", "value": "http://10.0.0.5/x"}])) is None
    assert len(posted) == 1


async def test_trying_a_workflow_changes_nothing_and_says_what_each_block_would_do(db):
    org = "org_wf10"
    await _lead(db, org, id="la_t", email="t@x.test")
    _, token = await make_user(db, "wf10", "Admin", org_id=org)
    rule = _rule(conditions=[{"field": "has_email", "op": "is", "value": "yes"}], do=[{"type": "action", "action": "set_stage", "value": "won"},
                                                                                       {"type": "wait", "hours": 48}, {"type": "action", "action": "send_email", "value": "Hello", "subject": "Hi"}])
    async with _client(token) as c:
        r = (await c.post("/api/together/workflows/test", json={"workflow": rule, "lead_id": "la_t"})).json()
        assert r["lead"]["name"] == "Kirkgate Dental"
        assert [l["result"] for l in r["log"]] == ["yes", "would set stage to won", "would wait 48 hours", "would email t@x.test"]
        assert (await c.post("/api/together/workflows/test", json={"workflow": {"event": "x"}, "lead_id": "la_t"})).status_code == 400
    assert await _stage(db, org, "la_t") == "new" and await _runs(db, org) == []


# ── The page's data, and who can see it ─────────────────────────────────────
async def test_the_page_gets_every_event_action_filter_and_template_and_each_workflows_numbers(db):
    org = "org_wf11"
    await _lead(db, org)
    _, token = await make_user(db, "wf11", "Admin", org_id=org)
    async with _client(token) as c:
        saved = (await c.put("/api/together/workflows", json={"workflows": [_rule(name="Mine")]})).json()["workflows"]
        await _fire(org, "call.completed", {"lead_id": "la_w1", "id": "c1"})
        meta = (await c.get("/api/together/workflows")).json()
    assert set(meta["event_info"]) >= {"call.completed", "meeting.booked", "campaign.reply", "email.opened", "lead.created", "post.published"}
    assert {"follow_up", "webhook", "send_email"} <= set(meta["action_info"]) and "in_list" in meta["condition_fields"] and len(meta["templates"]) >= 10
    assert meta["workflows"][0]["id"] == saved[0]["id"] and meta["workflows"][0]["stats"]["runs"] == 1 and meta["workflows"][0]["stats"]["last"].endswith("Z")


async def test_one_company_never_sees_or_runs_anothers_workflows(db):
    await _lead(db, "org_wf12a", id="la_o")
    await _save(db, "org_wf12a", _rule(name="A's rule"))
    await _fire("org_wf12b", "call.completed", {"lead_id": "la_o", "id": "c1"})
    assert await _runs(db, "org_wf12a") == [] and await _runs(db, "org_wf12b") == []
    _, token = await make_user(db, "wf12", "Admin", org_id="org_wf12b")
    async with _client(token) as c:
        assert (await c.get("/api/together/workflows")).json()["workflows"] == []


async def test_a_viewer_can_look_but_not_change_a_workflow(db):
    _, token = await make_user(db, "wf13", "Viewer", org_id="org_wf13")
    async with _client(token) as c:
        assert (await c.get("/api/together/workflows")).status_code == 200 and (await c.get("/api/together/workflow-runs")).status_code == 200
        assert (await c.put("/api/together/workflows", json={"workflows": [_rule()]})).status_code == 403


# ── The assistants ──────────────────────────────────────────────────────────
@pytest.fixture
def chat_fakes(monkeypatch):
    state = {"plan": {"success": True, "reply": "", "tool_calls": []}}

    async def plan(**kw):
        return state["plan"]

    async def answer(**kw):
        return {"success": True, "reply": "It is on screen."}

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    monkeypatch.setattr(llm_gateway, "call_open_chat_llm", answer)
    return state


async def test_the_chat_writes_a_workflow_as_a_card_and_saves_nothing_until_it_is_turned_on(db, chat_fakes):
    org = "org_wf14"
    _, token = await make_user(db, "wf14", "Admin", org_id=org)
    call = {"id": "c", "function": {"name": "create_workflow", "arguments": json.dumps({
        "name": "Callback follow-up", "event": "call.completed", "outcome": "callback_requested",
        "steps": [{"action": "follow_up", "value": "Call back", "days": 1}, {"action": "notify", "value": "A callback was asked for"}]})}}
    bad = {"id": "d", "function": {"name": "create_workflow", "arguments": json.dumps({"name": "Bad", "event": "call.completed", "steps": [{"action": "set_stage", "value": "nonsense"}]})}}
    async with _client(token) as c:
        chat_fakes["plan"] = {"success": True, "reply": "", "tool_calls": [call]}
        for path in ("/api/assistant/voice/ask", "/api/assistant/social/ask", "/api/leads/assistant/ask"):
            r = (await c.post(path, json={"message": "when someone wants a callback, plan one"})).json()
            cards = [p for p in r["proposals"] if p["kind"] == "workflow"]
            assert len(cards) == 1 and cards[0]["params"]["rule"]["when"] == {"outcome": "callback_requested"} and cards[0]["params"]["rule"]["do"][0]["days"] == 1
        assert (await c.get("/api/together/workflows")).json()["workflows"] == []  # nothing saved
        chat_fakes["plan"] = {"success": True, "reply": "", "tool_calls": [bad]}
        r = (await c.post("/api/assistant/voice/ask", json={"message": "x"})).json()
        assert [p for p in r["proposals"] if p["kind"] == "workflow"] == []
