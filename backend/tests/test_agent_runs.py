"""Plans made in the chat, and the background runs that carry them out: nothing runs before Run, reads and free saves run on their own, steps that
cost or send wait for the person, a run can be paused, resumed and cancelled, it survives a restart as "interrupted", and it is only ever the maker's."""
import asyncio
import json

import httpx
import pytest
from sqlalchemy import func, select

from app.core import permissions as P
from app.core.tenancy import org_scope
from app.main import app
from app.models.models import AgentRun, BusinessRecord, CallList, LeadAccount
from app.services import agent_runs as AR
from app.services import business_records, llm_gateway
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def _call(name, **args):
    return {"id": f"c_{name}", "function": {"name": name, "arguments": json.dumps(args)}}


STEPS = [
    {"plugin": "leads", "tool": "search_companies", "args": {"sector": ["restaurant"], "towns": ["Leeds"]}, "label": "Find cafes in Leeds"},
    {"plugin": "leads", "tool": "add_to_list", "args": {"list_name": "Leeds cafes", "how_many": 10}, "label": "Save them to a list"},
    {"plugin": "voice", "tool": "call_lists", "args": {}, "label": "Look at my call lists"},
    {"plugin": "voice", "tool": "schedule_calls", "args": {}, "label": "Schedule calls to the list"},
]


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    state = {"plan": {"success": True, "reply": "Hello", "tool_calls": []}}

    async def plan(**kw):
        return state["plan"]

    async def answer(**kw):
        return {"success": True, "reply": "The plan is on screen."}

    async def search(db, filters, **kw):
        rows = [BusinessRecord(id=f"b{i}", identity_hash=f"h{i}", name=n, region="Leeds", sic_text="56101 - Licensed restaurants", status="Active", raw_data={}, sources=[], rank_score=0)
                for i, n in enumerate(["Brew House Ltd", "Corner Cafe Ltd"])]
        return {"total": 2, "total_capped": False, "rows": rows}

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    monkeypatch.setattr(llm_gateway, "call_open_chat_llm", answer)
    monkeypatch.setattr(business_records, "search_filtered", search)
    return state


async def _leads(db, org):
    """How many companies are saved in this company's own records. The transaction is ended so the next read starts in its own company."""
    with org_scope(org):
        n = (await db.execute(select(func.count()).select_from(LeadAccount))).scalar()
        await db.rollback()
    return n


async def _wait(c, run_id, want, tries=80):
    for _ in range(tries):
        run = (await c.get(f"/api/agent/runs/{run_id}")).json()["run"]
        if run["status"] in want:
            return run
        await asyncio.sleep(0.1)
    raise AssertionError(f"run stayed {run['status']}, wanted {want}: {run['steps']}")


async def _plan(c, fakes, steps=None, **extra):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("propose_plan", title="Cafes in Leeds", steps=steps or STEPS, **extra)]}
    r = (await c.post("/api/assistant/voice/ask", json={"message": "find cafes in Leeds, save them and call them"})).json()
    cards = [p for p in r["proposals"] if p["kind"] == "plan_run"]
    assert len(cards) == 1, r
    return cards[0]["params"]["run"]


async def test_a_plan_is_only_a_card_until_the_person_presses_run(db, fakes):
    _, token = await make_user(db, "ag1", "Admin", org_id="org_ag1")
    async with _client(token) as c:
        run = await _plan(c, fakes)
        assert run["status"] == "planned" and [s["kind"] for s in run["steps"]] == ["read", "do", "read", "gate"]
        assert [s["state"] for s in run["steps"]] == ["pending"] * 4
        await asyncio.sleep(0.4)
        assert await _leads(db, "org_ag1") == 0  # nothing happened
        assert (await c.get("/api/agent/runs")).json()["runs"] == []  # a plan nobody ran is not a run yet


async def test_run_does_the_reads_and_the_free_save_then_waits_for_the_person_at_the_gate(db, fakes):
    _, token = await make_user(db, "ag2", "Admin", org_id="org_ag2")
    with org_scope("org_ag2"):
        db.add(CallList(id="cl1", name="Leeds cafes", row_count=20, called_count=2))
        await db.commit()
    before = await _leads(db, "org_default")
    async with _client(token) as c:
        run = await _plan(c, fakes)
        assert (await c.post(f"/api/agent/runs/{run['id']}/start")).json()["run"]["status"] == "running"
        waiting = await _wait(c, run["id"], ("waiting",))
        assert [s["state"] for s in waiting["steps"]] == ["done", "done", "done", "waiting"]
        assert "Saved 2 new companies to “Leeds cafes”" in waiting["steps"][1]["result"] and "Leeds cafes has 20 people" in waiting["steps"][2]["result"]
        assert await _leads(db, "org_ag2") == 2  # the free save really happened, in this company's own records
        assert await _leads(db, "org_default") == before  # and none in anyone else's
        r = await c.post(f"/api/agent/runs/{run['id']}/gate", json={"action": "done"})
        assert r.status_code == 200
        done = await _wait(c, run["id"], ("done",))
        assert done["steps"][3]["state"] == "done" and "4 of 4 steps done" in done["summary"]
        assert (await c.get("/api/agent/runs")).json()["runs"][0]["id"] == run["id"]


async def test_skipping_a_gate_ends_the_run_without_doing_it(db, fakes):
    _, token = await make_user(db, "ag3", "Admin", org_id="org_ag3")
    async with _client(token) as c:
        run = await _plan(c, fakes, steps=[STEPS[2], STEPS[3]])
        await c.post(f"/api/agent/runs/{run['id']}/start")
        await _wait(c, run["id"], ("waiting",))
        await c.post(f"/api/agent/runs/{run['id']}/gate", json={"action": "skip"})
        done = await _wait(c, run["id"], ("done",))
        assert done["steps"][1]["state"] == "skipped" and "3 of" not in done["summary"]


async def test_pause_stops_before_the_next_step_and_resume_carries_on(db, fakes, monkeypatch):
    gate = asyncio.Event()
    entered = asyncio.Event()
    real = AR.run_step

    async def slow(db_, run, step, actor):
        if step["i"] == 0:
            entered.set()
            await gate.wait()
        return await real(db_, run, step, actor)

    monkeypatch.setattr(AR, "run_step", slow)
    _, token = await make_user(db, "ag4", "Admin", org_id="org_ag4")
    async with _client(token) as c:
        run = await _plan(c, fakes, steps=[STEPS[2], STEPS[2], STEPS[2]])
        await c.post(f"/api/agent/runs/{run['id']}/start")
        await asyncio.wait_for(entered.wait(), 5)
        assert (await c.post(f"/api/agent/runs/{run['id']}/pause")).json()["run"]["status"] == "paused"
        gate.set()
        await asyncio.sleep(0.8)
        paused = (await c.get(f"/api/agent/runs/{run['id']}")).json()["run"]
        assert paused["status"] == "paused" and [s["state"] for s in paused["steps"]] == ["done", "pending", "pending"]  # the step in progress finished, none after it
        await c.post(f"/api/agent/runs/{run['id']}/resume")
        done = await _wait(c, run["id"], ("done",))
        assert [s["state"] for s in done["steps"]] == ["done"] * 3


async def test_cancel_stops_the_step_in_progress_and_nothing_after_it(db, fakes, monkeypatch):
    entered = asyncio.Event()

    async def hang(db_, run, step, actor):
        entered.set()
        await asyncio.sleep(30)
        return "never"

    monkeypatch.setattr(AR, "run_step", hang)
    _, token = await make_user(db, "ag5", "Admin", org_id="org_ag5")
    async with _client(token) as c:
        run = await _plan(c, fakes, steps=[STEPS[2], STEPS[2]])
        await c.post(f"/api/agent/runs/{run['id']}/start")
        await asyncio.wait_for(entered.wait(), 5)
        r = (await c.post(f"/api/agent/runs/{run['id']}/cancel")).json()["run"]
        assert r["status"] == "cancelled"
        await asyncio.sleep(0.5)
        final = (await c.get(f"/api/agent/runs/{run['id']}")).json()["run"]
        assert final["status"] == "cancelled" and [s["state"] for s in final["steps"]] == ["skipped", "pending"]


async def test_a_step_that_fails_stops_the_run_there_and_can_be_retried(db, fakes, monkeypatch):
    calls = {"n": 0}
    real = AR.run_step

    async def flaky(db_, run, step, actor):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")
        return await real(db_, run, step, actor)

    monkeypatch.setattr(AR, "run_step", flaky)
    _, token = await make_user(db, "ag6", "Admin", org_id="org_ag6")
    async with _client(token) as c:
        run = await _plan(c, fakes, steps=[STEPS[2], STEPS[2]])
        await c.post(f"/api/agent/runs/{run['id']}/start")
        failed = await _wait(c, run["id"], ("failed",))
        assert [s["state"] for s in failed["steps"]] == ["failed", "pending"] and "did not finish" in failed["steps"][0]["result"]
        await c.post(f"/api/agent/runs/{run['id']}/resume")
        assert [s["state"] for s in (await _wait(c, run["id"], ("done",)))["steps"]] == ["done", "done"]


async def test_a_restart_marks_a_running_run_interrupted_and_it_can_be_resumed(db, fakes):
    _, token = await make_user(db, "ag7", "Admin", org_id="org_ag7")
    async with _client(token) as c:
        run = await _plan(c, fakes, steps=[STEPS[2]])
        with org_scope("org_ag7"):
            row = await db.get(AgentRun, run["id"])
            await db.refresh(row)
            row.status = "running"  # as if the server stopped mid-run
            await db.commit()
        assert await AR.mark_interrupted() >= 1
        assert (await c.get(f"/api/agent/runs/{run['id']}")).json()["run"]["status"] == "interrupted"
        await c.post(f"/api/agent/runs/{run['id']}/resume")
        assert (await _wait(c, run["id"], ("done",)))["steps"][0]["state"] == "done"


async def test_a_plan_is_only_ever_its_makers_and_a_started_plan_cannot_be_started_twice(db, fakes):
    _, mine = await make_user(db, "ag8", "Admin", org_id="org_ag8")
    _, theirs = await make_user(db, "ag9", "Admin", org_id="org_ag9")
    async with _client(mine) as c:
        run = await _plan(c, fakes, steps=[STEPS[2]])
        assert (await c.post(f"/api/agent/runs/{run['id']}/start")).status_code == 200
        assert (await c.post(f"/api/agent/runs/{run['id']}/start")).status_code == 409
    async with _client(theirs) as c:
        for verb in ("start", "pause", "resume", "cancel"):
            assert (await c.post(f"/api/agent/runs/{run['id']}/{verb}")).status_code == 404
        assert (await c.get(f"/api/agent/runs/{run['id']}")).status_code == 404 and (await c.get("/api/agent/runs")).json()["runs"] == []


async def test_a_changed_plan_replaces_the_planned_one_instead_of_adding_another(db, fakes):
    _, token = await make_user(db, "ag10", "Admin", org_id="org_ag10")
    async with _client(token) as c:
        first = await _plan(c, fakes)
        second = await _plan(c, fakes, steps=STEPS[:2], replace_run_id=first["id"])
        assert second["id"] == first["id"] and len(second["steps"]) == 2
    with org_scope("org_ag10"):
        assert (await db.execute(select(func.count()).select_from(AgentRun))).scalar() == 1


def test_a_plan_cannot_use_tools_that_do_not_exist_or_plugins_the_person_may_not_use():
    allowed = {"leadgen": P.FULL, "calling": P.FULL, "scheduler": P.FULL}
    assert AR.check_steps([{"plugin": "voice", "tool": "place_call", "label": "x"}], allowed)[1].startswith("Step 1: there is no tool 'place_call'")
    assert AR.check_steps([{"plugin": "leads", "tool": "my_data", "label": "x"}], {"calling": P.FULL})[1].startswith("Step 1: this person cannot use Leads")
    assert AR.check_steps([{"plugin": "leads", "tool": "add_to_list", "label": "x"}], {"leadgen": P.VIEW})[1].startswith("Step 1: this person cannot use Leads")  # saving needs full access
    assert AR.check_steps([{"plugin": "leads", "tool": "my_data", "label": "x"}], {"leadgen": P.VIEW})[1] == ""
    assert AR.check_steps([], allowed)[1] and AR.check_steps([{"plugin": "voice", "tool": "call_lists", "label": "x"}] * (AR.MAX_STEPS + 1), allowed)[1]


async def test_someone_who_lost_access_after_the_plan_cannot_start_it(db, fakes):
    op, token = await make_user(db, "ag11", "Admin", org_id="org_ag11")
    async with _client(token) as c:
        run = await _plan(c, fakes, steps=[STEPS[0]])
    from app.core import auth_middleware as AM

    ctx = await AM.load_context(op.id, next(iter((AM._CTX_CACHE.get(op.id) or (0, {"_sessions": {""}}))[1]["_sessions"])))
    ctx["perms"] = {"calling": P.FULL}  # Leads taken away
    async with _client(token) as c:
        AM._CTX_CACHE[op.id] = (10 ** 12, ctx)
        r = await c.post(f"/api/agent/runs/{run['id']}/start")
    AM.forget(op.id)
    assert r.status_code == 403 and "cannot use Leads" in r.json()["detail"]


async def test_the_chat_can_ask_to_switch_plugins_and_only_to_a_different_one(db, fakes):
    _, token = await make_user(db, "ag12", "Admin", org_id="org_ag12")
    async with _client(token) as c:
        fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("use_plugin", plugin="leads", task="How many saved companies have a phone number?")]}
        r = (await c.post("/api/assistant/voice/ask", json={"message": "who can I call?"})).json()
        sw = [p for p in r["proposals"] if p["kind"] == "switch"]
        assert len(sw) == 1 and sw[0]["params"] == {"plugin": "leads", "task": "How many saved companies have a phone number?"} and "Leads" in sw[0]["title"]
        fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("use_plugin", plugin="voice", task="x")]}
        r = (await c.post("/api/assistant/voice/ask", json={"message": "again"})).json()
        assert [p for p in r["proposals"] if p["kind"] == "switch"] == []  # already in Voice


async def test_the_leads_assistant_can_plan_too(db, fakes):
    _, token = await make_user(db, "ag13", "Admin", org_id="org_ag13")
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("propose_plan", title="Leeds", steps=STEPS[:2])]}
    async with _client(token) as c:
        r = (await c.post("/api/leads/assistant/ask", json={"message": "find cafes and save them"})).json()
    card = [p for p in r["proposals"] if p["kind"] == "plan_run"]
    assert len(card) == 1 and card[0]["params"]["run"]["origin"] == "leads" and r["steps"][0]["label"] == "Wrote a plan for you to run"


async def test_asking_for_the_same_plan_or_switch_twice_in_one_answer_gives_one_card(db, fakes):
    _, token = await make_user(db, "ag14", "Admin", org_id="org_ag14")
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [
        _call("propose_plan", title="Cafes", steps=STEPS[:2]), _call("propose_plan", title="Cafes in Leeds", steps=STEPS),
        _call("use_plugin", plugin="leads", task="how many have a phone?"), _call("use_plugin", plugin="leads", task="how many have a phone number")]}
    async with _client(token) as c:
        r = (await c.post("/api/assistant/voice/ask", json={"message": "plan it"})).json()
        assert [p["kind"] for p in r["proposals"]] == ["plan_run", "switch"]
        assert r["proposals"][0]["title"] == "Cafes in Leeds" and len(r["proposals"][0]["params"]["run"]["steps"]) == 4  # the last wording
        assert [s["label"] for s in r["steps"]].count("Wrote a plan for you to run") == 1
    with org_scope("org_ag14"):
        assert (await db.execute(select(func.count()).select_from(AgentRun))).scalar() == 1


async def test_a_change_that_says_latest_replaces_the_plan_on_screen_and_stray_tool_markup_never_reaches_the_person(db, fakes, monkeypatch):
    from app.services.assistant_engine import clean_reply

    leaked = "Done, the plan is updated.\n\n<｜｜DSML｜｜ function_calls>\n<invoke name='propose_plan'>"
    assert clean_reply(leaked) == "Done, the plan is updated."
    assert clean_reply("A normal answer about <b>bold</b> text.") == "A normal answer about <b>bold</b> text."
    _, token = await make_user(db, "ag15", "Admin", org_id="org_ag15")
    async with _client(token) as c:
        first = await _plan(c, fakes)
        second = await _plan(c, fakes, steps=STEPS[:2], replace_run_id="latest")
        assert second["id"] == first["id"] and len(second["steps"]) == 2
    with org_scope("org_ag15"):
        assert (await db.execute(select(func.count()).select_from(AgentRun))).scalar() == 1


async def test_when_the_model_says_nothing_the_person_still_gets_a_plain_line_about_the_plan(db, fakes, monkeypatch):
    async def empty(**kw):
        return {"success": True, "reply": ""}

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm", empty)
    _, token = await make_user(db, "ag16", "Admin", org_id="org_ag16")
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("propose_plan", title="Cafes", steps=STEPS[:2])]}
    async with _client(token) as c:
        r = (await c.post("/api/assistant/voice/ask", json={"message": "plan it"})).json()
    assert r["reply"] == "The plan “Cafes” is on screen. Press Run when you are ready, or tell me what to change."
