"""Plans the assistants make with a person, and the background runner that carries them out.

A plan is a list of steps, each one tool in one plugin (Leads, Voice or Social). The person agrees the plan in the chat and presses Run;
only then does anything happen. Steps that read run on their own; saving companies to a list (free) runs on its own; a step that costs
credits, sends or places something is a "gate": the run waits there until the person has done it on its screen and says so.

A run is saved, so it carries on when the panel is closed or the page changes. It can be paused, resumed and cancelled. If the server
restarts mid-run the run is marked interrupted and can be resumed; nothing is silently lost.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core import permissions as P
from app.core.tenancy import org_scope
from app.models.models import AgentRun

logger = logging.getLogger("agent_runs")

MAX_STEPS = 12
STEP_TIMEOUT_S = 90
SECTION = {"leads": "leadgen", "voice": "calling", "social": "scheduler"}
PLUGIN_NAME = {"leads": "Leads", "voice": "Voice", "social": "Social"}

# plugin -> tool -> (kind, what it does in a few words). read: only reads. do: changes data but is free. gate: costs credits, sends or places
# something, so the person does it on its screen. go is where the person is taken for a gate.
CATALOG: Dict[str, Dict[str, Dict[str, Any]]] = {
    "leads": {
        "search_companies": {"kind": "read", "does": "search the UK company register with filters (free)"},
        "my_data": {"kind": "read", "does": "read the person's own pipeline, campaigns, replies, mailboxes or follow-ups (topic)"},
        "show_credits": {"kind": "read", "does": "read the credits left"},
        "add_to_list": {"kind": "do", "does": "save the companies of the latest search step into a list (list_name, how_many up to 200); free"},
        "check_list": {"kind": "gate", "does": "check a saved list's websites, phones and emails (costs credits; list_name)", "go": "#/leadgen/lists"},
        "start_campaign": {"kind": "gate", "does": "set up an email campaign to a list (list_name)", "go": "#/leadgen/outreach"},
        "search_web": {"kind": "gate", "does": "search public web pages for more businesses (costs credits; query)", "go": "#/leadgen/find_leads"},
        "journey_draft": {"kind": "do", "does": "write a DRAFT journey of emails, calls and tasks from the business profile (goal, audience, emails, channels); free, nothing is sent"},
        "journey_report": {"kind": "read", "does": "read how one journey is doing (journey)"},
        "journey_people": {"kind": "gate", "does": "add a saved list to a journey (journey, list_name); the person confirms", "go": "#/leadgen/outreach"},
        "journey_run": {"kind": "gate", "does": "start a journey (journey); the person presses Start", "go": "#/leadgen/outreach"},
    },
    "voice": {
        "call_results": {"kind": "read", "does": "read how calls went (days, outcome)"},
        "find_call": {"kind": "read", "does": "find one call and read its summary (query)"},
        "voice_setup": {"kind": "read", "does": "read the phone numbers and the AI caller's state"},
        "call_lists": {"kind": "read", "does": "read the call lists"},
        "call_schedules": {"kind": "read", "does": "read the scheduled calls"},
        "show_credits": {"kind": "read", "does": "read the calling credits left"},
        "schedule_calls": {"kind": "gate", "does": "schedule or start calls to a call list (the person does it on the Meetings and callbacks screen)", "go": "#/voice/schedule"},
    },
    "social": {
        "post_overview": {"kind": "read", "does": "read posts by status and what goes out next"},
        "post_results": {"kind": "read", "does": "read how published posts did (days)"},
        "my_accounts": {"kind": "read", "does": "read the connected social accounts"},
        "show_credits": {"kind": "read", "does": "read the Social credits left"},
        "plan_posts": {"kind": "gate", "does": "plan and write posts in the post planner (request: topic, channels and dates)", "go": "#/scheduler/plan"},
    },
}

AGENT_PROMPT = (
    " When the person wants something to happen automatically every time something else happens (a call ends, someone replies or opens an email, a meeting is booked, a company is saved), "
    "call create_workflow with it: you do not need a campaign or a journey for that, and the person turns it on from the card. "
    "When the person wants a job with several steps, or one that needs more than one plugin, first talk it through: ask what is missing, suggest options and say the plan "
    "in plain words. When they agree (or tell you to go ahead), call propose_plan with the full ordered steps: nothing runs until they press Run on the plan. "
    "A step runs one tool of any plugin. Steps that cost credits, send or place something wait for the person to do them on their screen. "
    "After propose_plan say in one sentence that the plan is on screen and they can ask for changes or press Run. If they ask for a change call propose_plan again with the "
    "revised steps and replace_run_id. If a single answer needs another plugin's data, call use_plugin so they can approve first: the button asks that plugin's assistant and brings its answer back into this chat."
)


def _catalog_text() -> str:
    return " ".join(f"{PLUGIN_NAME[p]}: " + "; ".join(f"{t} = {v['does']}" for t, v in tools.items()) + "." for p, tools in CATALOG.items())


def plan_tools() -> List[Dict[str, Any]]:
    from app.services.assistant_engine import tool

    step = {"type": "object", "properties": {
        "plugin": {"type": "string", "enum": list(CATALOG)}, "tool": {"type": "string"},
        "args": {"type": "object", "description": "the tool's own arguments"}, "label": {"type": "string", "description": "what this step does, in a few plain words"}},
        "required": ["plugin", "tool", "label"]}
    return [
        tool("propose_plan", "USE only after talking the job through with the person and they agree: shows the plan on screen for them to run. Tools by plugin: " + _catalog_text(),
             {"title": {"type": "string"}, "steps": {"type": "array", "items": step}, "replace_run_id": {"type": "string", "description": "when the person asks to change the plan that is on screen, pass \"latest\" so it is replaced instead of added"}},
             ["title", "steps"]),
        tool("use_plugin", "USE when answering needs another plugin's data (for example a Voice question that needs Leads): shows a button asking the person to switch, and the other plugin's assistant answers.",
             {"plugin": {"type": "string", "enum": list(CATALOG)}, "task": {"type": "string", "description": "what to ask that plugin, in plain words"}}, ["plugin", "task"]),
    ]


def run_json(r: AgentRun) -> Dict[str, Any]:
    return {"id": r.id, "title": r.title, "origin": r.origin, "status": r.status, "cursor": r.cursor or 0, "summary": r.summary or "",
            "steps": list(r.steps or []),
            "created_at": r.created_at.isoformat() if r.created_at else None, "updated_at": r.updated_at.isoformat() if r.updated_at else None}


def _need(kind: str) -> str:
    return P.FULL if kind == "do" else P.VIEW


def check_steps(raw: Any, perms: Dict[str, str]) -> tuple[List[Dict[str, Any]], str]:
    """The cleaned steps, or why the plan cannot be used (said to the model, in plain words)."""
    if not isinstance(raw, list) or not raw:
        return [], "A plan needs at least one step."
    if len(raw) > MAX_STEPS:
        return [], f"A plan can have at most {MAX_STEPS} steps. Make it shorter or split it."
    out: List[Dict[str, Any]] = []
    for i, s in enumerate(raw):
        s = s if isinstance(s, dict) else {}
        plugin, name = str(s.get("plugin") or ""), str(s.get("tool") or "")
        spec = CATALOG.get(plugin, {}).get(name)
        if not spec:
            return [], f"Step {i + 1}: there is no tool '{name}' in {PLUGIN_NAME.get(plugin, plugin or 'that plugin')}. Use only the listed tools."
        if not P.allows(perms, SECTION[plugin], _need(spec["kind"])):
            return [], f"Step {i + 1}: this person cannot use {PLUGIN_NAME[plugin]} that way, so leave it out and tell them."
        args = s.get("args") if isinstance(s.get("args"), dict) else {}
        out.append({"i": i, "plugin": plugin, "tool": name, "args": args, "label": str(s.get("label") or name.replace("_", " "))[:120], "kind": spec["kind"],
                    "state": "pending", "result": "", "ms": 0, **({"go": spec["go"]} if spec.get("go") else {})})
    return out, ""


async def make_plan(db: AsyncSession, t: Any, args: Dict[str, Any], origin: str) -> None:
    """The propose_plan tool: saves the plan (a new one, or a changed one) and puts it on screen as a card. Runs nothing."""
    t0 = time.time()
    actor = getattr(t, "actor", None) or {}
    if not actor.get("operator_id"):
        t.notes.append("Plans are not available here.")
        return
    steps, why = check_steps(args.get("steps"), actor.get("perms") or {})
    if why:
        t.notes.append(f"The plan was not made. {why}")
        return
    title = str(args.get("title") or "Plan")[:120]
    run: Optional[AgentRun] = None
    rid = str(args.get("replace_run_id") or "")
    # The model sometimes writes the same plan twice in one answer, worded a little differently: that is one plan, the last wording.
    earlier = next((p for p in t.proposals if p["kind"] == "plan_run"), None)
    if earlier:
        rid = earlier["params"]["run"]["id"]
    if rid:
        old = await db.get(AgentRun, rid)
        if old is None:  # the model does not know the id ("latest", "previous"...): it means the plan that is on screen now
            old = (await db.execute(select(AgentRun).where(AgentRun.operator_id == actor["operator_id"], AgentRun.status == "planned")
                                    .order_by(AgentRun.created_at.desc()).limit(1))).scalars().first()
        if old and old.operator_id == actor["operator_id"] and old.status == "planned":
            run = old
            run.title, run.steps = title, steps
    if run is None:
        run = AgentRun(operator_id=actor["operator_id"], origin=origin, title=title, steps=steps, status="planned", actor={"operator_id": actor["operator_id"], "perms": actor.get("perms") or {}})
        db.add(run)
    await db.commit()
    await db.refresh(run)
    card = {"id": earlier["id"] if earlier else f"p{len(t.proposals)}", "kind": "plan_run", "title": title, "detail": f"{len(steps)} steps. Nothing runs until you press Run.", "params": {"run": run_json(run)}}
    step = {"label": "Wrote a plan for you to run", "detail": f"{title}: {len(steps)} steps", "ms": int((time.time() - t0) * 1000)}
    if earlier:
        t.proposals[t.proposals.index(earlier)] = card
        t.steps[:] = [s for s in t.steps if s["label"] != step["label"]]
    else:
        t.proposals.append(card)
    t.steps.append(step)
    t.notes[:] = [n for n in t.notes if not n.startswith("The plan '")]  # one note, whatever the number of times it was written
    t.notes.append(f"The plan '{title}' with {len(steps)} steps is on screen. Nothing runs until the person presses Run; they can still ask for changes.")


async def make_switch(t: Any, args: Dict[str, Any], origin: str) -> None:
    t0 = time.time()
    plugin, task = str(args.get("plugin") or ""), str(args.get("task") or "").strip()[:500]
    actor = getattr(t, "actor", None) or {}
    if plugin not in CATALOG or plugin == origin or not task:
        t.notes.append("There is nothing to switch to. Answer from what you have, or ask the person what they mean.")
        return
    if not P.allows(actor.get("perms") or {}, SECTION[plugin], P.VIEW):
        t.notes.append(f"This person cannot use {PLUGIN_NAME[plugin]}, so tell them that plainly.")
        return
    if any(p["kind"] == "switch" and p["params"]["plugin"] == plugin for p in t.proposals):
        return  # one button per plugin is enough, however many times it was asked for
    t.proposals.append({"id": f"p{len(t.proposals)}", "kind": "switch", "title": f"This needs {PLUGIN_NAME[plugin]}",
                        "detail": f"Switch and ask the {PLUGIN_NAME[plugin]} assistant: {task}", "params": {"plugin": plugin, "task": task}})
    t.steps.append({"label": f"Needs {PLUGIN_NAME[plugin]}", "detail": task[:80], "ms": int((time.time() - t0) * 1000)})
    t.notes.append(f"A button is on screen. Pressing it asks the {PLUGIN_NAME[plugin]} assistant the question and its answer comes back into this chat; it does not open {PLUGIN_NAME[plugin]}. Say that in one sentence.")


# ── Running a step ──────────────────────────────────────────────────────────
class _Sink:
    """Collects what a plugin tool reports, so the run can keep a short result per step."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.steps: List[Dict[str, Any]] = []
        self.proposals: List[Dict[str, Any]] = []
        self.notes: List[str] = []
        self.actor: Dict[str, Any] = {}
        self.filters: Dict[str, Any] = {}
        self.found: Optional[Dict[str, Any]] = None

    def step(self, label: str, detail: str, t0: float) -> None:
        self.steps.append({"label": label, "detail": detail, "ms": int((time.time() - t0) * 1000)})

    def propose(self, kind: str, title: str, detail: str, params: Dict[str, Any]) -> None:
        self.proposals.append({"id": f"p{len(self.proposals)}", "kind": kind, "title": title, "detail": detail, "params": params})


def _digest(sink: _Sink) -> str:
    text = "; ".join(f"{s['label']}: {s['detail']}" if s.get("detail") else s["label"] for s in sink.steps) or ""
    notes = " ".join(n for n in sink.notes if not n.startswith("A proposal"))
    return (text + (" | " + notes if notes else ""))[:900]


async def _save_to_list(db: AsyncSession, ctx: Dict[str, Any], args: Dict[str, Any]) -> str:
    from app.api import lead_accounts as LAcc
    from app.services import business_records, lead_filters

    filters = ctx.get("filters") or {}
    if not filters:
        return "There was no search before this step, so nothing was saved."
    how_many = min(max(int(args.get("how_many") or 25), 1), 200)
    name = str(args.get("list_name") or "Assistant list").strip()[:80] or "Assistant list"
    found = await business_records.search_filtered(db, filters, limit=how_many, exclude_ids=[], stats=False)
    rows = [lead_filters.card(r) for r in found["rows"]]
    accounts = [LAcc.AccountIn(name=c.get("name") or "", website=c.get("website") or "", phone=c.get("phone") or "", email=c.get("email") or "", industry=c.get("industry") or "",
                               region=c.get("region") or "", source="scout", business_record_id=c.get("id") or "",
                               notes=" · ".join(str(x) for x in (c.get("registration_number") and f"Reg no. {c['registration_number']}", c.get("status"), c.get("postcode")) if x)) for c in rows]
    if not accounts:
        return "The search found no companies, so nothing was saved."
    res = await LAcc.add_accounts(LAcc.AccountsIn(accounts=accounts, list_name=name), db)
    return f"Saved {res['added']} new companies to “{name}” ({res['matched']} were already saved and were added to the list too)."


async def run_step(db: AsyncSession, run: AgentRun, step: Dict[str, Any], actor: Dict[str, Any]) -> str:
    plugin, name, args = step["plugin"], step["tool"], dict(step.get("args") or {})
    ctx = dict(run.ctx or {})
    sink = _Sink(db)
    sink.actor = actor
    if plugin == "leads":
        from app.api import lead_assistant as LA

        if name == "add_to_list":
            return await _save_to_list(db, ctx, args)
        t = LA._Turn(LA.AskIn(message="run"), [])
        t.filters = ctx.get("filters") or {}
        await LA._run_tool(db, t, name, args)
        if t.found:
            ctx["filters"] = t.found["filters"]
            run.ctx = ctx
        sink.steps, sink.notes = t.steps, t.notes
        return _digest(sink)
    from app.api import plugin_assistant as PA
    from app.services.assistant_engine import Turn

    spec = PA.SPECS["voice" if plugin == "voice" else "social"]
    t = Turn(db, "run")
    await spec.handlers[name](t, args)
    sink.steps, sink.notes = t.steps, t.notes
    return _digest(sink)


# ── The runner ──────────────────────────────────────────────────────────────
_tasks: Dict[str, asyncio.Task] = {}


def _with(steps: List[Dict[str, Any]], idx: int, **changes: Any) -> List[Dict[str, Any]]:
    out = [dict(s) for s in steps or []]
    out[idx].update(changes)
    return out


def _finish(run: AgentRun, status: str) -> None:
    run.status = status
    run.finished_at = datetime.utcnow()
    done = [s for s in run.steps or [] if s["state"] == "done"]
    run.summary = (f"{len(done)} of {len(run.steps or [])} steps done. " + " ".join(f"{s['label']}: {s['result'][:160]}" for s in done if s.get("result")))[:1500]


async def _drive(run_id: str, org_id: str) -> None:
    from app.database import AsyncSessionLocal

    with org_scope(org_id):
        async with AsyncSessionLocal() as db:
            try:
                while True:
                    run = await db.get(AgentRun, run_id)
                    if run is None:
                        return
                    await db.refresh(run)
                    if run.status != "running":
                        return
                    steps = [dict(s) for s in run.steps or []]
                    if (run.cursor or 0) >= len(steps):
                        _finish(run, "done")
                        await db.commit()
                        return
                    idx = run.cursor
                    step = steps[idx]
                    if step["kind"] == "gate":
                        step["state"] = "waiting"
                        run.steps, run.status = steps, "waiting"
                        await db.commit()
                        return
                    step["state"] = "running"
                    run.steps = steps
                    await db.commit()
                    t0 = time.time()
                    outcome, failed = "", False
                    try:
                        outcome = await asyncio.wait_for(run_step(db, run, step, run.actor or {}), STEP_TIMEOUT_S)
                    except asyncio.CancelledError:
                        await db.rollback()
                        run = await db.get(AgentRun, run_id)
                        run.steps = _with(run.steps, idx, state="skipped", result="Stopped before it finished.")
                        await db.commit()
                        raise
                    except Exception as err:  # one step failing stops the run where it is, so nothing after it happens on a wrong footing
                        logger.warning("agent run %s step %s failed: %s", run_id, step["tool"], err)
                        await db.rollback()
                        run = await db.get(AgentRun, run_id)
                        outcome, failed = f"This step did not finish ({type(err).__name__}).", True
                    # new lists each time: a list that was already saved and is then changed in place looks unchanged to the database layer
                    run.steps = _with(run.steps, idx, state="failed" if failed else "done", result=outcome, ms=int((time.time() - t0) * 1000))
                    await db.refresh(run, attribute_names=["status"])
                    if failed:
                        run.status = "failed"
                        run.finished_at = datetime.utcnow()
                    else:
                        run.cursor = idx + 1
                    await db.commit()
                    if failed:
                        return
            except asyncio.CancelledError:
                raise
            except Exception as err:
                logger.error("agent run %s crashed: %s", run_id, err)
            finally:
                _tasks.pop(run_id, None)


def spawn(run: AgentRun) -> None:
    if run.id in _tasks and not _tasks[run.id].done():
        return
    _tasks[run.id] = asyncio.get_running_loop().create_task(_drive(run.id, run.org_id or ""))


async def start(db: AsyncSession, run: AgentRun) -> None:
    run.status = "running"
    run.finished_at = None
    await db.commit()
    spawn(run)


async def pause(db: AsyncSession, run: AgentRun) -> None:
    if run.status in ("running", "waiting"):
        run.status = "paused"  # the loop sees this before its next step; the step in progress finishes first
        await db.commit()


async def cancel(db: AsyncSession, run: AgentRun) -> None:
    if run.status in ("done", "cancelled"):
        return
    run.status = "cancelled"
    run.finished_at = datetime.utcnow()
    await db.commit()
    task = _tasks.get(run.id)
    if task and not task.done():
        task.cancel()


async def resolve_gate(db: AsyncSession, run: AgentRun, action: str) -> None:
    steps = [dict(s) for s in run.steps or []]
    if run.cursor >= len(steps) or steps[run.cursor]["state"] != "waiting":
        return
    steps[run.cursor]["state"] = "done" if action == "done" else "skipped"
    steps[run.cursor]["result"] = "You did this one." if action == "done" else "You skipped this one."
    run.steps, run.cursor = steps, run.cursor + 1
    await start(db, run)


async def resume(db: AsyncSession, run: AgentRun) -> None:
    steps = [dict(s) for s in run.steps or []]
    if run.cursor < len(steps) and steps[run.cursor]["state"] in ("failed", "running", "skipped") and steps[run.cursor]["kind"] != "gate":
        steps[run.cursor]["state"], steps[run.cursor]["result"] = "pending", ""
        run.steps = steps
    await start(db, run)


async def mark_interrupted() -> int:
    """At startup: a run that was mid-step when the server stopped is not running any more. It can be resumed."""
    from sqlalchemy import update

    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    with system_scope():
        async with AsyncSessionLocal() as db:
            res = await db.execute(update(AgentRun).where(AgentRun.status == "running").values(status="interrupted"))
            await db.commit()
            return res.rowcount or 0
