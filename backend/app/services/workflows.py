"""Workflows: "when X happens, do Y", across Leads, Voice and Social.

A workflow is an event, optional filters on who it applies to, and a flow of blocks: actions, if/else, waits and stops. It lives in the
organisation's connection settings. The event bus (services/connections.py) hands every call, booking, reply, open and saved company
here; each enabled workflow that matches starts a run on the lead behind the event.

Every run is saved (WorkflowRun) with a line per block, so the person can see what happened and why something did not run. A wait parks
the run until its time; a background loop resumes it. A block that fails stops that run where it is and can be retried. Actions only use
what the person already has (a stage, a list, a note, their own mailbox, their own webhook) and are skipped, with a line in the run, when
a plan or a block says no. Nothing here spends credits.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import org_scope, system_scope
from app.database import AsyncSessionLocal
from app.models.models import LeadAccount, Notification, WorkflowRun
from app.services import connection_handlers as H
from app.services import connections as C

logger = logging.getLogger("workflows")

# event -> what it is called, which plugin it comes from, whether a lead is behind it, and the outcomes it can be filtered on.
CALL_OUTCOMES = ["meeting_booked", "callback_requested", "contacted", "left_voicemail", "no_answer", "rejected", "wrong_number", "do_not_call"]
REPLY_KINDS = ["interested", "question", "not_interested", "unsubscribe"]
EVENT_INFO: Dict[str, Dict[str, Any]] = {
    "call.completed": {"label": "A call finished", "plugin": "voice", "lead": True, "outcomes": CALL_OUTCOMES, "hint": "When a call ends"},
    "call.needs_human": {"label": "A call needs a person", "plugin": "voice", "lead": True, "outcomes": [], "hint": "When the AI asks for a person"},
    "meeting.booked": {"label": "A meeting was booked", "plugin": "voice", "lead": True, "outcomes": [], "hint": "When a meeting is booked"},
    "campaign.reply": {"label": "Someone replied to an email", "plugin": "leads", "lead": True, "outcomes": REPLY_KINDS, "hint": "When someone replies"},
    "email.opened": {"label": "Someone opened an email", "plugin": "leads", "lead": True, "outcomes": [], "hint": "When an email is opened"},
    "lead.created": {"label": "A company was saved", "plugin": "leads", "lead": True, "outcomes": [], "hint": "When a company is saved"},
    "campaign.completed": {"label": "An email campaign finished sending", "plugin": "leads", "lead": False, "outcomes": [], "hint": "When a campaign finishes"},
    "post.published": {"label": "A post went live", "plugin": "social", "lead": False, "outcomes": [], "hint": "When a post goes live"},
}
EVENTS: Dict[str, str] = {k: v["label"] for k, v in EVENT_INFO.items()}

# action -> label; needs_lead: it works on the lead behind the event (and is skipped when an event has none)
ACTION_INFO: Dict[str, Dict[str, Any]] = {
    "set_stage": {"label": "Move the lead to a stage", "needs_lead": True},
    "add_to_list": {"label": "Add the lead to a list", "needs_lead": True},
    "follow_up": {"label": "Plan a follow-up for the lead", "needs_lead": True},
    "notify": {"label": "Send me a notification", "needs_lead": False},
    "send_email": {"label": "Send the lead an email", "needs_lead": True},
    "webhook": {"label": "Send the details to my own web address (webhook)", "needs_lead": False},
    "add_dnc": {"label": "Add the lead to the do-not-contact list", "needs_lead": True},
    "add_note": {"label": "Add a note to the lead's timeline", "needs_lead": True},
}
ACTIONS: Dict[str, str] = {k: v["label"] for k, v in ACTION_INFO.items()}
STAGES = ["new", "contacted", "interested", "meeting", "won", "lost", "do_not_contact"]

# Who a workflow applies to. op "is"/"is_not" compare a choice; "contains" matches part of the text; yes/no for "has" fields.
CONDITION_FIELDS: Dict[str, Dict[str, Any]] = {
    "stage": {"label": "Stage", "ops": ["is", "is_not"], "values": STAGES},
    "industry": {"label": "Industry", "ops": ["contains", "not_contains"]},
    "region": {"label": "Town or area", "ops": ["contains", "not_contains"]},
    "has_email": {"label": "Has an email address", "ops": ["is"], "values": ["yes", "no"]},
    "has_phone": {"label": "Has a phone number", "ops": ["is"], "values": ["yes", "no"]},
    "in_list": {"label": "Is in the list", "ops": ["is", "is_not"]},
}
MAX_RULES = 30
MAX_BLOCKS = 25
MAX_DEPTH = 2
MAX_WAIT_HOURS = 24 * 30
DEFAULT_PER_DAY = 100
KEEP_RUNS_DAYS = 45
DUPLICATE = "duplicate"


# ── Saving a workflow ───────────────────────────────────────────────────────
# What people and models call a comparison, said the way the engine says it.
_OP_WORDS = {"equals": "is", "equal": "is", "==": "is", "=": "is", "eq": "is", "is_equal_to": "is", "not_equals": "is_not", "not_equal": "is_not", "!=": "is_not",
             "ne": "is_not", "isnt": "is_not", "is not": "is_not", "includes": "contains", "has": "contains", "does_not_contain": "not_contains",
             "excludes": "not_contains", "not contains": "not_contains"}


def clean_condition(raw: Any) -> Optional[Dict[str, str]]:
    raw = raw if isinstance(raw, dict) else {}
    field = str(raw.get("field") or "")
    spec = CONDITION_FIELDS.get(field)
    op = _OP_WORDS.get(str(raw.get("op") or "").strip().lower(), str(raw.get("op") or ""))
    value = str(raw.get("value") or "").strip()[:120]
    if not spec or op not in spec["ops"] or not value:
        return None
    if spec.get("values") and value not in spec["values"]:
        return None
    return {"field": field, "op": op, "value": value}


def _clean_blocks(raw: Any, depth: int, count: List[int]) -> Optional[List[Dict[str, Any]]]:
    """The flow in the shape the engine runs, or None when a block is not valid. Old rules (a plain list of actions) read as the same flow."""
    out: List[Dict[str, Any]] = []
    for b in raw if isinstance(raw, list) else []:
        b = b if isinstance(b, dict) else {}
        count[0] += 1
        if count[0] > MAX_BLOCKS:
            return None
        kind = str(b.get("type") or "action")
        if kind == "wait":
            try:
                hours = int(b.get("hours"))
            except (TypeError, ValueError):
                return None
            if not 1 <= hours <= MAX_WAIT_HOURS:
                return None
            out.append({"type": "wait", "hours": hours})
        elif kind == "stop":
            out.append({"type": "stop"})
        elif kind == "if":
            cond = clean_condition(b.get("cond"))
            if cond is None or depth >= MAX_DEPTH:
                return None
            then, other = _clean_blocks(b.get("then"), depth + 1, count), _clean_blocks(b.get("else"), depth + 1, count)
            if then is None or other is None or not (then or other):
                return None
            out.append({"type": "if", "cond": cond, "then": then, "else": other})
        elif kind == "action":
            action = str(b.get("action") or "")
            value = str(b.get("value") or "").strip()[:2000]
            if action not in ACTION_INFO:
                return None
            if action == "set_stage" and value not in STAGES:
                return None
            if action in ("add_to_list", "notify", "send_email", "add_note", "follow_up", "webhook") and not value:
                return None
            step: Dict[str, Any] = {"type": "action", "action": action, "value": value, "subject": str(b.get("subject") or "")[:200]}
            if action == "follow_up":
                try:
                    step["days"] = min(max(int(b.get("days") if b.get("days") is not None else 1), 0), 365)
                except (TypeError, ValueError):
                    return None
            if action == "webhook":
                from app.services.webhook_dispatcher import url_problem

                if url_problem(value) or not value.lower().startswith(("https://", "http://")):
                    return None
            out.append(step)
        else:
            return None
    return out


def clean_workflow(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A workflow in the shape the engine runs, or None when it is not valid."""
    event = str(raw.get("event") or "")
    info = EVENT_INFO.get(event)
    if info is None:
        return None
    when = raw.get("when") or {}
    outcome = str(when.get("outcome") or "")
    if outcome and outcome not in info["outcomes"]:
        return None
    flow = _clean_blocks(raw.get("do"), 0, [0])
    if not flow:
        return None
    conditions = []
    for c in (raw.get("conditions") or [])[:6]:
        cond = clean_condition(c)
        if cond is None:
            return None
        conditions.append(cond)
    lim = raw.get("limits") if isinstance(raw.get("limits"), dict) else {}
    reenroll = str(lim.get("reenroll") or "every")
    if reenroll not in ("every", "once", "days"):
        reenroll = "every"
    try:
        per_day = min(max(int(lim.get("per_day") or DEFAULT_PER_DAY), 1), 1000)
        days = min(max(int(lim.get("days") or 7), 1), 365)
    except (TypeError, ValueError):
        return None
    return {"id": str(raw.get("id") or f"wf_{uuid.uuid4().hex[:8]}"), "name": str(raw.get("name") or "").strip()[:80] or "Untitled workflow",
            "enabled": bool(raw.get("enabled", True)), "event": event, "when": {"outcome": outcome} if outcome else {}, "conditions": conditions,
            "do": flow, "limits": {"reenroll": reenroll, "days": days, "per_day": per_day}}


async def get_workflows(db: AsyncSession) -> List[Dict[str, Any]]:
    from app.models.models import ConnectionRules

    row = await db.get(ConnectionRules, "default")
    return [w for w in ((row.rules or {}).get("workflows") or []) if isinstance(w, dict)] if row else []


async def save_workflows(db: AsyncSession, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    from app.models.models import ConnectionRules

    clean = [w for w in (clean_workflow(i) for i in items[:MAX_RULES]) if w]
    row = await db.get(ConnectionRules, "default")
    rules = dict(row.rules or {}) if row else {}
    rules["workflows"] = clean
    if row is None:
        db.add(ConnectionRules(id="default", rules=rules))
    else:
        row.rules = rules
    await db.commit()
    return clean


# ── Matching ────────────────────────────────────────────────────────────────
def matches(rule: Dict[str, Any], event: str, data: Dict[str, Any]) -> bool:
    if not rule.get("enabled") or rule.get("event") != event:
        return False
    want = (rule.get("when") or {}).get("outcome")
    if not want:
        return True
    if event == "call.completed":
        return str(data.get("outcome") or "") == want
    if event == "campaign.reply":
        return str((data.get("reply") or {}).get("category") or "") == want
    return True


def _email_of(event: str, data: Dict[str, Any]) -> str:
    if event == "campaign.reply":
        return str((data.get("reply") or {}).get("email") or "")
    if event == "meeting.booked":
        return str((data.get("meeting") or {}).get("email") or "")
    if event == "email.opened":
        return str(data.get("email") or "")
    return ""


async def _list_ids(db: AsyncSession, name: str) -> set:
    from app.api.lead_lists import _load

    want = (name or "").strip().lower()
    return {i for l in await _load(db) if str(l.get("name", "")).strip().lower() == want for i in l.get("ids", [])}


async def check(db: AsyncSession, cond: Dict[str, str], lead: Optional[LeadAccount]) -> bool:
    """Whether one filter holds for this lead. With no lead behind the event, a filter on the lead cannot hold."""
    if lead is None:
        return False
    field, op, value = cond["field"], cond["op"], cond["value"]
    if field == "stage":
        got = (lead.stage or "new") == value
    elif field in ("industry", "region"):
        got = value.lower() in (getattr(lead, field) or "").lower()
        return got if op == "contains" else not got
    elif field in ("has_email", "has_phone"):
        has = bool((lead.email if field == "has_email" else lead.phone) or "")
        return has == (value == "yes")
    elif field == "in_list":
        got = lead.id in await _list_ids(db, value)
    else:
        return False
    return got if op == "is" else not got


def describe_condition(cond: Dict[str, str]) -> str:
    spec = CONDITION_FIELDS.get(cond["field"], {})
    ops = {"is": "is", "is_not": "is not", "contains": "contains", "not_contains": "does not contain"}
    return f"{spec.get('label', cond['field'])} {ops.get(cond['op'], cond['op'])} {cond['value']}"


# ── Doing the blocks ────────────────────────────────────────────────────────
def _fill(text: str, lead: Optional[LeadAccount]) -> str:
    return H.fill(text, lead) if lead is not None else (text or "")


async def run_action(db: AsyncSession, org_id: str, lead: Optional[LeadAccount], step: Dict[str, Any], rule: Dict[str, Any], dry: bool = False,
                     event: str = "", data: Optional[Dict[str, Any]] = None) -> str:
    """One action. Returns a short result for the run. With dry set, nothing is changed: it says what it would do."""
    action, value = step["action"], step["value"]
    if ACTION_INFO[action]["needs_lead"] and lead is None:
        return "skipped: this event has no lead behind it"
    would = "would " if dry else ""
    if action == "set_stage":
        if not dry:
            lead.stage = value
        return f"{would}{'set' if not dry else 'set'} stage to {value.replace('_', ' ')}"
    if action == "add_note":
        if not dry:
            await C.record_event(db, "note", lead_id=lead.id, ref_id=f"{rule['id']}:{uuid.uuid4().hex[:6]}", summary=_fill(value, lead)[:500])
        return f"{would}add a note"
    if action == "notify":
        if not dry:
            db.add(Notification(id=f"n_{uuid.uuid4().hex[:8]}", text=_fill(value, lead)[:300], type="info", time="Just now"))
        return f"{would}send you a notification"
    if action == "follow_up":
        days = int(step.get("days") or 0)
        if not dry:
            lead.next_action = _fill(value, lead)[:200]
            lead.next_action_at = datetime.utcnow() + timedelta(days=days)
        return f"{would}plan a follow-up “{_fill(value, lead)[:60]}” in {days} day{'s' if days != 1 else ''}"
    if action == "add_dnc":
        if not dry:
            await C.add_block(db, phone=lead.phone, email=lead.email, registry_id=lead.registry_id or "", name=lead.name,
                              reason=f"Workflow: {rule['name']}", source="manual")
            lead.stage = "do_not_contact"
        return f"{would}add to do-not-contact"
    if action == "add_to_list":
        if not dry:
            from app.api.lead_lists import put_in_list

            await put_in_list(db, "", value, [lead.id])
        return f"{would}add to the list {value}"
    if action == "send_email":
        if dry:
            return f"would email {lead.email or 'the lead (no address)'}"
        ent = await H.entitled(db, org_id)
        if not ent.get("leads"):
            return "skipped: sending needs the Leads plan"
        res = await H.send_lead_email(db, org_id, lead, step.get("subject") or "Following up", _fill(value, lead), f"workflow:{rule['id']}")
        return "email sent" if res.get("status") == "sent" else f"email skipped: {res.get('why') or res.get('reason') or res.get('status')}"
    if action == "webhook":
        if dry:
            return "would send the details to your web address"
        return await _post_webhook(value, rule, event, lead, data or {})
    return "unknown action"


async def _post_webhook(url: str, rule: Dict[str, Any], event: str, lead: Optional[LeadAccount], data: Dict[str, Any]) -> str:
    import httpx

    from app.services.webhook_dispatcher import url_problem

    problem = await asyncio.get_running_loop().run_in_executor(None, url_problem, url)
    if problem:
        return f"not sent: {problem}"
    body = {"workflow": rule["name"], "event": event, "at": datetime.utcnow().isoformat() + "Z",
            "lead": {"id": lead.id, "name": lead.name, "email": lead.email, "phone": lead.phone, "stage": lead.stage, "industry": lead.industry, "region": lead.region} if lead else None}
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False) as c:
            r = await c.post(url, json=body)
        if r.status_code >= 400:
            raise RuntimeError(f"your address answered {r.status_code}")
        return f"sent to your web address ({r.status_code})"
    except httpx.HTTPError as err:
        raise RuntimeError(f"could not reach your address ({type(err).__name__})")


def _line(label: str, result: str = "", ok: bool = True) -> Dict[str, Any]:
    return {"at": datetime.utcnow().isoformat() + "Z", "label": label, "result": result, "ok": ok}


def _action_label(step: Dict[str, Any]) -> str:
    return ACTION_INFO.get(step.get("action"), {}).get("label", step.get("action", "Action"))


async def advance(db: AsyncSession, org_id: str, run: WorkflowRun, rule: Dict[str, Any], lead: Optional[LeadAccount], dry: bool = False,
                  event: str = "", data: Optional[Dict[str, Any]] = None) -> None:
    """Carry a run forward from where it stands until it ends, waits or a block fails. The run keeps what is still to do, so a wait or a retry picks up there."""
    queue = [dict(s) for s in (run.queue or [])]
    log = list(run.log or [])
    status = "done"
    while queue:
        step = queue.pop(0)
        kind = step.get("type", "action")
        if kind == "stop":
            log.append(_line("Stop", "The workflow ended here."))
            queue = []
            break
        if kind == "wait":
            hours = int(step["hours"])
            if dry:
                log.append(_line("Wait", f"would wait {hours} hour{'s' if hours != 1 else ''}"))
                continue
            run.resume_at = datetime.utcnow() + timedelta(hours=hours)
            log.append(_line("Wait", f"until {run.resume_at.strftime('%d %b %H:%M')} UTC"))
            status = "waiting"
            break
        if kind == "if":
            yes = await check(db, step["cond"], lead)
            log.append(_line(f"If {describe_condition(step['cond'])}", "yes" if yes else "no"))
            queue = [dict(s) for s in (step["then"] if yes else step["else"])] + queue
            continue
        try:
            log.append(_line(_action_label(step), await run_action(db, org_id, lead, step, rule, dry, event, data)))
        except Exception as err:
            logger.warning("[workflow] %s: %s failed: %s", rule.get("name"), step.get("action"), err)
            log.append(_line(_action_label(step), str(err)[:200] or "it did not finish", ok=False))
            queue.insert(0, step)
            status = "failed"
            break
    run.log, run.queue, run.status = log, queue, status
    if status != "waiting":
        run.resume_at = None
    run.updated_at = datetime.utcnow()


def _key(rule: Dict[str, Any], event: str, data: Dict[str, Any], lead: Optional[LeadAccount]) -> str:
    return f"{rule['id']}:{event}:{data.get('id') or data.get('call_id') or ''}:{lead.id if lead else ''}"[:240]


async def _blocked_why(db: AsyncSession, rule: Dict[str, Any], lead: Optional[LeadAccount], key: str) -> str:
    """Why this workflow should not start for this lead now, or ''."""
    if (await db.execute(select(func.count()).select_from(WorkflowRun).where(WorkflowRun.event_key == key))).scalar():
        return DUPLICATE
    lim = rule.get("limits") or {}
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    started = (await db.execute(select(func.count()).select_from(WorkflowRun).where(WorkflowRun.workflow_id == rule["id"], WorkflowRun.created_at >= today,
                                                                                      WorkflowRun.status != "skipped"))).scalar() or 0
    if started >= int(lim.get("per_day") or DEFAULT_PER_DAY):
        return f"today's limit of {lim.get('per_day') or DEFAULT_PER_DAY} runs was reached"
    if lead is not None and lim.get("reenroll") in ("once", "days"):
        q = select(func.count()).select_from(WorkflowRun).where(WorkflowRun.workflow_id == rule["id"], WorkflowRun.lead_id == lead.id, WorkflowRun.status != "skipped")
        if lim["reenroll"] == "days":
            q = q.where(WorkflowRun.created_at >= datetime.utcnow() - timedelta(days=int(lim.get("days") or 7)))
        if (await db.execute(q)).scalar():
            return "this lead already went through it" if lim["reenroll"] == "once" else f"this lead went through it in the last {lim.get('days')} days"
    return ""


async def on_event(org_id: str, event: str, data: Dict[str, Any]) -> None:
    """The bus handler: start a run of every matching workflow, on the lead behind the event."""
    async with AsyncSessionLocal() as db:
        rules = [r for r in await get_workflows(db) if matches(r, event, data)]
        if not rules:
            return
        lead = None
        if EVENT_INFO.get(event, {}).get("lead"):
            lead = await C.lead_for(db, lead_id=str(data.get("lead_id") or (data.get("meeting") or {}).get("lead_id") or ""), phone=str(data.get("to") or ""), email=_email_of(event, data))
            if lead is None:
                return
        for rule in rules:
            key = _key(rule, event, data, lead)
            why = await _blocked_why(db, rule, lead, key)
            if why == DUPLICATE:  # the same event again (a retry on our side): it already ran, so there is nothing to record
                continue
            if not why:
                for cond in rule.get("conditions") or []:
                    if not await check(db, cond, lead):
                        why = f"it did not match: {describe_condition(cond)}"
                        break
            run = WorkflowRun(workflow_id=rule["id"], workflow_name=rule["name"], event=event, event_key=key, lead_id=lead.id if lead else "",
                              lead_name=(lead.name if lead else "")[:200], status="skipped" if why else "running", queue=[] if why else list(rule["do"]),
                              log=[_line("Skipped", why, ok=True)] if why else [])
            db.add(run)
            await db.flush()
            if not why:
                await advance(db, org_id, run, rule, lead, event=event, data=data)
        await db.commit()


async def _handler(org_id: str, event: str, data: Dict[str, Any]) -> None:
    await on_event(org_id, event, data)


def register() -> None:
    for ev in EVENT_INFO:
        C.subscribe(ev, _handler)


# ── Waiting runs, retries, and trying a workflow without changing anything ─────
async def _rule_of(db: AsyncSession, run: WorkflowRun) -> Optional[Dict[str, Any]]:
    return next((r for r in await get_workflows(db) if r["id"] == run.workflow_id), None)


async def continue_run(db: AsyncSession, run: WorkflowRun) -> None:
    """Resume a waiting run, or retry a failed one, from the block it stopped at."""
    rule = await _rule_of(db, run)
    if rule is None or not rule.get("enabled"):
        run.status, run.queue, run.resume_at = "stopped", [], None
        run.log = list(run.log or []) + [_line("Stopped", "The workflow was turned off or deleted.")]
        return
    lead = await db.get(LeadAccount, run.lead_id) if run.lead_id else None
    if run.lead_id and lead is None:
        run.status, run.queue, run.resume_at = "stopped", [], None
        run.log = list(run.log or []) + [_line("Stopped", "The company was deleted.")]
        return
    run.status = "running"
    await advance(db, run.org_id or "", run, rule, lead)


async def resume_due(limit: int = 50) -> int:
    """Runs whose wait is over, across every organisation (called by the background loop)."""
    with system_scope():
        async with AsyncSessionLocal() as db:
            due = (await db.execute(select(WorkflowRun.id, WorkflowRun.org_id).where(WorkflowRun.status == "waiting", WorkflowRun.resume_at <= datetime.utcnow())
                                    .order_by(WorkflowRun.resume_at).limit(limit))).all()
    done = 0
    for run_id, org in due:
        try:
            with org_scope(org):
                async with AsyncSessionLocal() as db:
                    run = await db.get(WorkflowRun, run_id)
                    if run is not None and run.status == "waiting":
                        await continue_run(db, run)
                        await db.commit()
                        done += 1
        except Exception as err:
            logger.warning("[workflow] could not resume run %s: %s", run_id, err)
    return done


async def prune() -> None:
    with system_scope():
        async with AsyncSessionLocal() as db:
            from sqlalchemy import delete

            await db.execute(delete(WorkflowRun).where(WorkflowRun.created_at < datetime.utcnow() - timedelta(days=KEEP_RUNS_DAYS), WorkflowRun.status.notin_(["waiting", "running"])))
            await db.commit()


async def workflow_loop() -> None:
    n = 0
    while True:
        try:
            await resume_due()
            n += 1
            if n % 120 == 0:  # about hourly
                await prune()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.warning("[workflow] loop error: %s", err)
        await asyncio.sleep(30)


async def test_run(db: AsyncSession, org_id: str, rule: Dict[str, Any], lead: LeadAccount) -> List[Dict[str, Any]]:
    """What the workflow would do for this lead, line by line. Nothing is changed, sent or saved."""
    cleaned = clean_workflow(rule)
    if cleaned is None:
        raise ValueError("This workflow is not complete yet.")
    probe = WorkflowRun(workflow_id=cleaned["id"], workflow_name=cleaned["name"], event=cleaned["event"], lead_id=lead.id, lead_name=lead.name, queue=list(cleaned["do"]), log=[])
    for cond in cleaned["conditions"]:
        ok = await check(db, cond, lead)
        probe.log = list(probe.log) + [_line(f"Only if {describe_condition(cond)}", "yes" if ok else "no, so it would not run")]
        if not ok:
            return probe.log
    await advance(db, org_id, probe, cleaned, lead, dry=True)
    return probe.log


# ── Ready-made workflows ────────────────────────────────────────────────────
def _a(action: str, value: str = "", **kw: Any) -> Dict[str, Any]:
    return {"type": "action", "action": action, "value": value, **kw}


TEMPLATES: List[Dict[str, Any]] = [
    {"id": "t_meeting", "name": "Meeting booked: move the lead and plan the prep", "about": "Moves the lead to Meeting and reminds you to prepare the day before.",
     "event": "meeting.booked", "when": {}, "do": [_a("set_stage", "meeting"), _a("follow_up", "Prepare for the meeting with {{company}}", days=1), _a("notify", "A meeting was booked with {{company}}.")]},
    {"id": "t_interested", "name": "Interested reply: tell me and plan a follow-up", "about": "When someone replies interested, you are told at once and a follow-up is planned.",
     "event": "campaign.reply", "when": {"outcome": "interested"}, "do": [_a("set_stage", "interested"), _a("notify", "{{company}} replied and is interested."), _a("follow_up", "Reply to {{company}}", days=1)]},
    {"id": "t_notinterested", "name": "Not interested: close the lead", "about": "Moves a lead who said no to Lost and leaves a note.",
     "event": "campaign.reply", "when": {"outcome": "not_interested"}, "do": [_a("set_stage", "lost"), _a("add_note", "Replied: not interested.")]},
    {"id": "t_unsub", "name": "Unsubscribe: never contact again", "about": "Puts anyone who unsubscribes on the do-not-contact list.",
     "event": "campaign.reply", "when": {"outcome": "unsubscribe"}, "do": [_a("add_dnc", "Unsubscribed")]},
    {"id": "t_callback", "name": "Callback requested: plan the call back", "about": "Plans a callback for tomorrow and tells you.",
     "event": "call.completed", "when": {"outcome": "callback_requested"}, "do": [_a("follow_up", "Call {{company}} back", days=1), _a("notify", "{{company}} asked for a callback.")]},
    {"id": "t_noanswer", "name": "No answer: try again later", "about": "Plans another try in two days.",
     "event": "call.completed", "when": {"outcome": "no_answer"}, "do": [_a("follow_up", "Try {{company}} again", days=2)]},
    {"id": "t_dnc", "name": "Asked not to be called: stop contacting", "about": "Adds them to the do-not-contact list.",
     "event": "call.completed", "when": {"outcome": "do_not_call"}, "do": [_a("add_dnc", "Asked not to be called")]},
    {"id": "t_open", "name": "Email opened: tell me", "about": "A notification when a lead opens your email, so you can follow up quickly.",
     "event": "email.opened", "when": {}, "do": [_a("notify", "{{company}} opened your email.")]},
    {"id": "t_newlead", "name": "New company saved: add it to a list", "about": "Every company you save also goes into the list you choose.",
     "event": "lead.created", "when": {}, "do": [_a("add_to_list", "New leads")]},
    {"id": "t_followup", "name": "Meeting booked: check in the next day", "about": "Waits a day, and if the lead is still at Meeting, plans a check-in. Shows a wait and an if/else.",
     "event": "meeting.booked", "when": {}, "do": [{"type": "wait", "hours": 24},
                                                 {"type": "if", "cond": {"field": "stage", "op": "is", "value": "meeting"}, "then": [_a("follow_up", "Check in with {{company}} after the meeting", days=0)], "else": []}]},
    {"id": "t_post", "name": "Post went live: tell me", "about": "A notification when a scheduled post is published.",
     "event": "post.published", "when": {}, "do": [_a("notify", "A scheduled post just went live.")]},
    {"id": "t_crm", "name": "Meeting booked: send it to my own system", "about": "Posts the lead's details to a web address you give (your CRM or a Zapier hook).",
     "event": "meeting.booked", "when": {}, "do": [_a("webhook", "")]},
]


# ── The assistants can write one, for the person to turn on ──────────────────
def workflow_tool() -> Dict[str, Any]:
    from app.services.assistant_engine import tool

    ev = "; ".join(f"{k} = {v['label']}" + (f" (outcome one of {', '.join(v['outcomes'])})" if v["outcomes"] else "") for k, v in EVENT_INFO.items())
    act = "; ".join(f"{k} = {v['label']}" for k, v in ACTION_INFO.items())
    return tool("create_workflow", "USE when the person wants something to happen automatically every time something else happens (\"when a call ends with a callback, plan a follow-up\"). "
                "It shows the workflow on screen for them to turn on; nothing runs until they do. Events: " + ev + ". Actions: " + act + ". "
                "Each step is {action, value, days?} (set_stage value is a stage: " + ", ".join(STAGES) + "; follow_up value is the text and days the wait; webhook value is a web address), "
                "{type:'wait', hours}, {type:'stop'} or {type:'if', cond:{field,op,value}, then:[...], else:[...]}. Conditions: {field, op, value} with field one of stage, industry, region, has_email, has_phone, in_list and op one of is, is_not, contains, not_contains (has_email and has_phone take value yes or no).",
                {"name": {"type": "string"}, "event": {"type": "string", "enum": list(EVENT_INFO)}, "outcome": {"type": "string", "description": "only for the events that list outcomes"},
                 "conditions": {"type": "array", "items": {"type": "object"}}, "steps": {"type": "array", "items": {"type": "object"}}}, ["name", "event", "steps"])


async def make_workflow_card(t: Any, args: Dict[str, Any]) -> None:
    import time as _time

    t0 = _time.time()
    raw = {"name": args.get("name"), "event": args.get("event"), "when": {"outcome": args.get("outcome") or ""}, "conditions": args.get("conditions") or [],
           "do": args.get("steps") or [], "enabled": True}
    rule = clean_workflow(raw)
    if rule is None:
        logger.warning("[workflow] the assistant wrote a workflow that was not valid: %s", args)
        t.notes.append("That workflow was not valid: check the event, its outcome, and that every step has what it needs (a stage, a list name, a web address). Fix it and try again, or ask the person.")
        return
    t.proposals[:] = [p for p in t.proposals if p["kind"] != "workflow"]  # asked twice in one answer: the last wording wins
    t.proposals.append({"id": f"p{len(t.proposals)}", "kind": "workflow", "title": rule["name"], "detail": "Turns on only when you press the button.", "params": {"rule": rule}})
    t.steps.append({"label": "Wrote a workflow for you to turn on", "detail": rule["name"], "ms": int((_time.time() - t0) * 1000)})
    t.notes[:] = [n for n in t.notes if not n.startswith("A workflow ")]
    t.notes.append(f"A workflow '{rule['name']}' is on screen. It runs only once the person presses Turn on. Say in one sentence what it does.")
