"""Journeys: a person's path through email, calls and manual tasks, built on the email campaign engine (EmailCampaign, EmailSequenceStep,
EmailEnrollment). The screen and the AI chat both call this module, so neither can do anything the other cannot.

A step is an automatic email, an automatic call (through Voice), or a manual step that becomes a task for a person. A manual step parks
the person until its task is done or skipped. Events end a journey for one person: a reply, a booked meeting, an unsubscribe, "not
interested", "don't call", a stage that means they are no longer a prospect, or silence for a set number of days.
"""
from __future__ import annotations

import hashlib
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.services.form_links import has_bare_tag
from app.models.models import (EmailApproval, EmailCampaign, EmailEnrollment, EmailMessage, EmailSequenceStep, JourneyTask, LeadAccount, Prospect)

logger = logging.getLogger("journeys")

NAME = "Journeys"
TASK_KINDS = {"manual_email": "Write and send an email", "call_task": "Make a call", "task": "Do a task", "social_task": "Do a social task",
              "linkedin_task": "Do a LinkedIn task", "letter_task": "Send a letter"}
EMAIL_LIKE = ("email", "manual_email")
STEP_CHANNELS = ("email", "call", *TASK_KINDS)
CALL_CONDITIONS = ("always", "no_reply", "opened_no_reply")
VOICEMAIL = ("hang_up", "leave_message")
STAGES = ["new", "contacted", "interested", "meeting", "won", "lost", "do_not_contact"]
CALL_WAIT_HOURS = 36  # a call that reports nothing for this long is treated as unanswered and the journey carries on
MAX_STEPS = 12

DEFAULT_RULES: Dict[str, Any] = {
    "on_reply": True, "on_meeting": True, "on_unsubscribe": True,  # always on: a person who answers, books or opts out is never written to again
    "on_not_interested": True,
    "on_form": True,  # a person who returns the form sent in a step is not written to again
    "unresponsive_days": 7,  # days after the last step with no answer before they are marked unresponsive; 0 = never
    "skip_stages": ["won", "lost", "do_not_contact"],
}
LOCKED_RULES = ("on_reply", "on_meeting", "on_unsubscribe")
EXIT_STATUS = {"replied": "replied", "meeting_booked": "booked", "unsubscribed": "unsubscribed", "unresponsive": "unresponsive", "bounced": "bounced", "form_returned": "form_returned"}


class JourneyError(ValueError):
    """Something the person can fix: said in plain words, shown as-is."""


# ── Steps ───────────────────────────────────────────────────────────────────
def _int(value: Any, low: int, high: int, default: int = 0) -> int:
    try:
        return max(low, min(int(value), high))
    except (TypeError, ValueError):
        return default


def clean_steps(raw: Any) -> List[Dict[str, Any]]:
    """Steps in the shape the engine saves, or a JourneyError saying what to fix. Each step keeps a key, so editing a journey never moves people."""
    steps: List[Dict[str, Any]] = []
    for i, s in enumerate(raw or [], 1):
        s = s if isinstance(s, dict) else {}
        ch = str(s.get("channel") or "email")
        if ch not in STEP_CHANNELS:
            raise JourneyError(f"Step {i} is a type we don't have.")
        d = {"key": str(s.get("key") or "").strip()[:40] or f"sk_{uuid.uuid4().hex[:10]}", "channel": ch,
             "delay_days": _int(s.get("delay_days"), 0, 365) if i > 1 else 0, "delay_hours": _int(s.get("delay_hours"), 0, 23) if i > 1 else 0,
             "subject": str(s.get("subject") or "").strip()[:300], "body": str(s.get("body") or "").strip()[:10000],
             "condition": str(s.get("condition") or "always"), "title": str(s.get("title") or "").strip()[:120],
             "notes": str(s.get("notes") or "").strip()[:4000], "goal": str(s.get("goal") or "").strip()[:600],
             "voicemail": str(s.get("voicemail") or "hang_up"), "retries": _int(s.get("retries"), 0, 3),
             "retry_gap_hours": _int(s.get("retry_gap_hours"), 1, 72, 24),
             "subject_b": str(s.get("subject_b") or "").strip()[:300], "body_b": str(s.get("body_b") or "").strip()[:10000]}
        if d["condition"] not in CALL_CONDITIONS:
            raise JourneyError(f"Step {i} has a condition we don't know.")
        if d["voicemail"] not in VOICEMAIL:
            raise JourneyError(f"Step {i} has a voicemail choice we don't know.")
        waits = d["delay_days"] * 24 + d["delay_hours"]
        if ch in ("email", "call") and i > 1 and waits <= 0:
            raise JourneyError(f"Step {i} needs a wait after the step before it.")
        if ch in EMAIL_LIKE and not d["body"]:
            raise JourneyError(f"Step {i} is an email with nothing in it.")
        if ch in EMAIL_LIKE and any(has_bare_tag(t) for t in (d["subject"], d["body"], d["subject_b"], d["body_b"])):
            raise JourneyError(f"Step {i} has a form link with no form chosen. Use Insert form to pick one.")
        if ch in EMAIL_LIKE and i == 1 and not d["subject"]:
            raise JourneyError("The first email needs a subject.")
        if ch in TASK_KINDS and ch != "manual_email" and not d["title"]:
            d["title"] = TASK_KINDS[ch]
        if ch == "manual_email" and not d["title"]:
            d["title"] = d["subject"] or TASK_KINDS[ch]
        if ch != "call":
            d["condition"] = "always"
        steps.append(d)
    if not steps:
        raise JourneyError("Add at least one step.")
    if len(steps) > MAX_STEPS:
        raise JourneyError(f"A journey can have up to {MAX_STEPS} steps.")
    if steps[0]["channel"] == "call":
        raise JourneyError("The first step can't be an automatic call. Start with an email or a task; a call can follow.")
    if len({d["key"] for d in steps}) != len(steps):
        raise JourneyError("Two steps share the same key.")
    return steps


def step_out(s: EmailSequenceStep) -> Dict[str, Any]:
    ch = "call" if s.channel == "voice_call" else s.channel
    return {"key": s.step_key or s.id, "step": s.step_number, "channel": ch, "delay_days": s.delay_days or 0, "delay_hours": s.delay_hours or 0,
            "subject": s.subject or "", "body": s.body_template or "", "condition": s.condition or "always", "title": s.title or "",
            "notes": s.notes or "", "goal": s.goal or "", "voicemail": s.voicemail or "hang_up", "retries": s.retries or 0,
            "retry_gap_hours": s.retry_gap_hours or 24, "subject_b": s.subject_b or "", "body_b": s.body_b or ""}


async def steps_of(db: AsyncSession, campaign_id: str) -> List[EmailSequenceStep]:
    return list((await db.execute(select(EmailSequenceStep).where(EmailSequenceStep.campaign_id == campaign_id)
                                  .order_by(EmailSequenceStep.step_number))).scalars().all())


async def save_steps(db: AsyncSession, camp: EmailCampaign, steps: List[Dict[str, Any]], now: Optional[datetime] = None) -> None:
    """Replaces a journey's steps in place by key, then puts every person part-way through back on the step they were on."""
    now = now or datetime.utcnow()
    old = {(r.step_key or r.id): r for r in await steps_of(db, camp.id)}
    old_numbers = {k: r.step_number for k, r in old.items()}
    keep = set()
    for n, d in enumerate(steps, 1):
        is_call = d["channel"] == "call"
        values = dict(step_number=n, channel="voice_call" if is_call else d["channel"], delay_days=d["delay_days"], delay_hours=d["delay_hours"],
                      condition=d["condition"], subject="" if is_call else d["subject"], body_template="" if is_call else d["body"],
                      title=d["title"], notes=d["notes"], goal=d["goal"], voicemail=d["voicemail"], retries=d["retries"],
                      retry_gap_hours=d["retry_gap_hours"], subject_b=d["subject_b"] if d["channel"] in EMAIL_LIKE else "",
                      body_b=d["body_b"] if d["channel"] in EMAIL_LIKE else "")
        row = old.get(d["key"])
        if row:
            for k, v in values.items():
                setattr(row, k, v)
        else:
            db.add(EmailSequenceStep(id=f"st_{uuid.uuid4().hex[:12]}", campaign_id=camp.id, step_key=d["key"], **values))
        keep.add(d["key"])
    for k, row in old.items():
        if k not in keep:
            await db.delete(row)
    await db.flush()
    numbers = {d["key"]: n for n, d in enumerate(steps, 1)}
    by_number = {n: d["key"] for n, d in enumerate(steps, 1)}
    people = (await db.execute(select(EmailEnrollment).where(EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active"))).scalars().all()
    for e in people:
        key = e.current_step_key or next((k for k, n in old_numbers.items() if n == e.current_step), "")
        if key in numbers:
            e.current_step, e.current_step_key = numbers[key], key
            continue
        pos = old_numbers.get(key, e.current_step or 1)  # their step was taken out: carry on at what now sits in its place
        if (e.waiting_on or "").startswith("task:"):
            await cancel_tasks(db, e.id)
            e.waiting_on, e.next_action_at = "", now
        if pos > len(steps):
            e.status, e.next_action_at, e.finish_reason = "completed", None, "finished"
        else:
            e.current_step, e.current_step_key = pos, by_number[pos]


def rules_of(camp: EmailCampaign) -> Dict[str, Any]:
    raw = camp.exit_rules or {}
    r = {**DEFAULT_RULES, **{k: v for k, v in raw.items() if k in DEFAULT_RULES}}
    for k in LOCKED_RULES:
        r[k] = True
    r["on_not_interested"] = bool(r["on_not_interested"])
    r["on_form"] = bool(r["on_form"])
    r["unresponsive_days"] = _int(r["unresponsive_days"], 0, 60, 7)
    r["skip_stages"] = [s for s in dict.fromkeys(r.get("skip_stages") or []) if s in STAGES]
    return r


# ── Ending a journey for one person ─────────────────────────────────────────
async def cancel_tasks(db: AsyncSession, enrollment_id: str) -> int:
    n = 0
    for t in (await db.execute(select(JourneyTask).where(JourneyTask.enrollment_id == enrollment_id, JourneyTask.status == "open"))).scalars().all():
        t.status, t.completed_at = "cancelled", datetime.utcnow()
        n += 1
    return n


async def cancel_queued_calls(db: AsyncSession, enr: EmailEnrollment) -> int:
    if not enr.lead_id:
        return 0
    n = 0
    for p in (await db.execute(select(Prospect).where(Prospect.lead_id == enr.lead_id, Prospect.status == "queued"))).scalars().all():
        p.status, p.note = "cancelled", "The journey ended before this call"
        n += 1
    return n


async def exit_enrollment(db: AsyncSession, enr: EmailEnrollment, reason: str, *, status: str = "", now: Optional[datetime] = None) -> bool:
    """Ends the journey for this person: no more steps, open tasks cancelled, a queued call called off. False when it had already ended."""
    if enr.status not in ("active", "paused"):
        return False
    enr.status = status or EXIT_STATUS.get(reason, "finished")
    enr.finish_reason, enr.next_action_at, enr.waiting_on = reason, None, ""
    enr.last_action_at = now or datetime.utcnow()
    await cancel_tasks(db, enr.id)
    await cancel_queued_calls(db, enr)
    await cancel_approvals(db, enr.id)
    return True


async def exit_for_lead(db: AsyncSession, lead: Optional[LeadAccount], email: str, reason: str, status: str = "") -> int:
    """Ends every active journey for the person behind a lead or an address (a meeting was booked, they asked not to be contacted)."""
    conds = []
    if lead is not None:
        conds.append(EmailEnrollment.lead_id == lead.id)
        if lead.email:
            conds.append(EmailEnrollment.email == lead.email.lower())
    if email:
        conds.append(EmailEnrollment.email == email.lower())
    if not conds:
        return 0
    n = 0
    for enr in (await db.execute(select(EmailEnrollment).where(EmailEnrollment.status == "active", or_(*conds)))).scalars().all():
        if await exit_enrollment(db, enr, reason, status=status):
            n += 1
    return n


async def on_reply(db: AsyncSession, enr: EmailEnrollment, category: str) -> None:
    """A reply ends it. The reason keeps what kind of reply it was."""
    if category == "unsubscribe":
        await exit_enrollment(db, enr, "unsubscribed", status="unsubscribed")
    else:
        await exit_enrollment(db, enr, "not_interested" if category == "not_interested" else "replied", status="replied")


async def on_out_of_office(db: AsyncSession, enr: EmailEnrollment, days: int = 3) -> None:
    """An auto-reply is not an answer: the person is left alone for a few days, then the journey carries on."""
    if enr.status == "active" and enr.next_action_at and not (enr.waiting_on or "").startswith("task:"):
        enr.next_action_at = max(enr.next_action_at, datetime.utcnow() + timedelta(days=days))


async def on_bounce(db: AsyncSession, enr: EmailEnrollment) -> None:
    """The address bounced for good: email steps are skipped. Calls and tasks carry on; with none left, it ends."""
    if enr.status != "active":
        return
    enr.email_blocked = True
    rest = [s for s in await steps_of(db, enr.campaign_id) if s.step_number >= (enr.current_step or 1)]
    if all((("call" if s.channel == "voice_call" else s.channel) in EMAIL_LIKE) for s in rest):
        await exit_enrollment(db, enr, "bounced", status="bounced")
    elif not (enr.waiting_on or "").startswith(("task:", "call")):
        enr.next_action_at = datetime.utcnow()


async def advance(db: AsyncSession, enr: EmailEnrollment, steps: Dict[int, EmailSequenceStep], now: datetime) -> None:
    """On to the next step after its wait, or finished when there is none."""
    enr.waiting_on, enr.retry_count = "", 0
    nxt = steps.get((enr.current_step or 1) + 1)
    if nxt is None:
        enr.status, enr.next_action_at, enr.finish_reason = "completed", None, "finished"
        return
    enr.current_step += 1
    enr.current_step_key = nxt.step_key or nxt.id
    enr.next_action_at = now + timedelta(days=nxt.delay_days or 0, hours=nxt.delay_hours or 0)


# ── Tasks ───────────────────────────────────────────────────────────────────
def _task_out(t: JourneyTask, campaign_name: str = "") -> Dict[str, Any]:
    instead = (t.step_key or "").startswith(SWAP_PREFIX)
    return {"id": t.id, "campaign_id": t.campaign_id, "journey": campaign_name, "enrollment_id": t.enrollment_id, "lead_id": t.lead_id or "",
            "kind": t.kind, "kind_label": TASK_KINDS.get(t.kind, "Task"), "title": t.title, "notes": t.notes, "contact": t.contact,
            "company": t.company, "email": t.email, "phone": t.phone, "due_at": t.due_at.isoformat() + "Z" if t.due_at else None,
            "status": t.status, "outcome": t.outcome, "instead_of_email": instead, "needs_screening": instead and t.kind == "call_task"}


async def _lead(db: AsyncSession, enr: EmailEnrollment) -> Optional[LeadAccount]:
    from app.services import connections as C

    return await C.lead_for(db, lead_id=enr.lead_id or "", email=enr.email or "")


async def make_task(db: AsyncSession, camp: EmailCampaign, enr: EmailEnrollment, *, kind: str, title: str, notes: str = "",
                    step_key: str = "", due: Optional[datetime] = None, park: bool = True, now: Optional[datetime] = None) -> JourneyTask:
    from app.services.identity import lead_phone

    now = now or datetime.utcnow()
    lead = await _lead(db, enr)
    who = f"{enr.first_name} {enr.last_name}".strip() or (lead.contact_name if lead else "") or ""
    task = JourneyTask(id=f"jt_{uuid.uuid4().hex[:12]}", campaign_id=camp.id, enrollment_id=enr.id, lead_id=enr.lead_id or (lead.id if lead else None),
                       step_key=step_key, kind=kind, title=title[:200], notes=notes, contact=who, company=enr.company or (lead.name if lead else ""),
                       email=enr.email or "", phone=lead_phone(lead) if lead else "", due_at=due or now, assignee=camp.owner_id or "")
    db.add(task)
    if park:
        enr.waiting_on, enr.waiting_since, enr.next_action_at, enr.last_action_at = f"task:{task.id}", now, None, now
    return task


async def start_task_step(db: AsyncSession, camp: EmailCampaign, enr: EmailEnrollment, step: EmailSequenceStep, now: datetime) -> JourneyTask:
    """A manual step is due: it becomes a task and the person waits for it."""
    from app.services.email_worker import render

    from app.services import form_links as FL

    kind = step.channel
    notes = render(step.notes or "", enr)
    if kind == "manual_email":
        body = render(await FL.resolve(db, camp.org_id, enr, step.body_template or ""), enr)
        notes = (f"Subject: {render(step.subject or '', enr)}\n\n{body}" + (f"\n\n{notes}" if notes else "")).strip()
    return await make_task(db, camp, enr, kind=kind, title=render(step.title or TASK_KINDS.get(kind, "Task"), enr), notes=notes,
                           step_key=step.step_key or step.id, now=now)


async def list_tasks(db: AsyncSession, *, status: str = "open", campaign_id: str = "", due_before: Optional[datetime] = None, limit: int = 100) -> List[Dict[str, Any]]:
    q = select(JourneyTask, EmailCampaign.name).join(EmailCampaign, EmailCampaign.id == JourneyTask.campaign_id, isouter=True)
    if status:
        q = q.where(JourneyTask.status == status)
    if campaign_id:
        q = q.where(JourneyTask.campaign_id == campaign_id)
    if due_before:
        q = q.where(JourneyTask.due_at <= due_before)
    rows = (await db.execute(q.order_by(JourneyTask.due_at).limit(max(1, min(limit, 500))))).all()
    return [_task_out(t, name or "") for t, name in rows]


async def complete_task(db: AsyncSession, task_id: str, status: str = "done", outcome: str = "", now: Optional[datetime] = None) -> Dict[str, Any]:
    """Done or skipped. The person moves on after the next step's wait, unless a call task's outcome ends or reshapes the journey."""
    now = now or datetime.utcnow()
    if status not in ("done", "skipped"):
        raise JourneyError("A task is either done or skipped.")
    task = await db.get(JourneyTask, task_id)
    if not task:
        raise JourneyError("That task isn't there any more.")
    if task.status != "open":
        return _task_out(task)
    task.status, task.outcome, task.completed_at = status, outcome[:40], now
    enr = await db.get(EmailEnrollment, task.enrollment_id)
    if enr and enr.status == "active" and enr.waiting_on == f"task:{task.id}":
        camp = await db.get(EmailCampaign, enr.campaign_id)
        steps = {s.step_number: s for s in await steps_of(db, enr.campaign_id)}
        enr.waiting_on = ""
        if status == "done" and task.kind == "call_task" and outcome:
            await apply_call_outcome(db, enr, camp, steps, outcome, now, waiting=True)
        else:
            await advance(db, enr, steps, now)
    if status == "done" and task.kind == "manual_email" and task.lead_id:
        try:
            from app.services import connections as C

            await C.record_event(db, "email", lead_id=task.lead_id, ref_id=f"task:{task.id}", summary="Email sent by hand (journey step)")
        except Exception as err:
            logger.debug("journey task event not written: %s", err)
    return _task_out(task)


# ── Calls ───────────────────────────────────────────────────────────────────
async def apply_call_outcome(db: AsyncSession, enr: EmailEnrollment, camp: Optional[EmailCampaign], steps: Dict[int, EmailSequenceStep],
                             outcome: str, now: datetime, *, waiting: bool, callback_at: Optional[datetime] = None) -> str:
    """What a call's result does to the journey. Returns a word for what happened. Outcomes that end it apply whether or not the journey was waiting."""
    rules = rules_of(camp) if camp else dict(DEFAULT_RULES)
    if outcome in ("meeting_booked", "booked"):
        await exit_enrollment(db, enr, "meeting_booked", status="booked", now=now)
        return "ended: meeting booked"
    if outcome == "do_not_call":
        await exit_enrollment(db, enr, "do_not_contact", now=now)
        return "ended: asked not to be contacted"
    if outcome in ("rejected", "not_interested") and rules["on_not_interested"]:
        await exit_enrollment(db, enr, "not_interested", now=now)
        return "ended: not interested"
    if outcome == "interested":
        if camp is not None:
            await make_task(db, camp, enr, kind="task", title=f"Follow up: {enr.company or enr.email} sounded interested on the call",
                            notes="They were interested on the call. The journey has stopped so you can follow up yourself.", park=False, now=now)
        await exit_enrollment(db, enr, "interested", now=now)
        return "ended: interested, follow-up task made"
    if not waiting:
        return "no change"
    step = steps.get(enr.current_step or 1)
    if outcome == "wrong_number":
        enr.call_blocked = True
        await advance(db, enr, steps, now)
        return "wrong number: carries on without calls"
    if outcome == "callback_requested" and camp is not None:
        await make_task(db, camp, enr, kind="call_task", title=f"Call back {enr.company or enr.first_name or enr.email}",
                        notes="They asked for a call back.", step_key=enr.current_step_key or "", due=callback_at or now + timedelta(days=1), now=now)
        return "waiting for the call back"
    if outcome in ("no_answer", "busy", "failed", "canceled") and step is not None and (enr.retry_count or 0) < (step.retries or 0):
        enr.retry_count = (enr.retry_count or 0) + 1
        enr.waiting_on, enr.next_action_at = "", now + timedelta(hours=step.retry_gap_hours or 24)
        return "no answer: trying again"
    await advance(db, enr, steps, now)
    return "carries on"


async def on_call_result(db: AsyncSession, lead: Optional[LeadAccount], phone: str, outcome: str, *, callback_at: Optional[datetime] = None) -> int:
    """A call ended: tell every active journey for that person. Called from the call-finished handler; never raises."""
    try:
        conds = []
        if lead is not None:
            conds.append(EmailEnrollment.lead_id == lead.id)
            if lead.email:
                conds.append(EmailEnrollment.email == lead.email.lower())
        if not conds:
            return 0
        now, n = datetime.utcnow(), 0
        for enr in (await db.execute(select(EmailEnrollment).where(EmailEnrollment.status == "active", or_(*conds)))).scalars().all():
            camp = await db.get(EmailCampaign, enr.campaign_id)
            steps = {s.step_number: s for s in await steps_of(db, enr.campaign_id)}
            await apply_call_outcome(db, enr, camp, steps, outcome, now, waiting=(enr.waiting_on == "call"), callback_at=callback_at)
            n += 1
        return n
    except Exception as err:
        logger.warning("journey call result not applied: %s", err)
        return 0


async def call_brief(db: AsyncSession, enr: EmailEnrollment, step: EmailSequenceStep, lead: Optional[LeadAccount]) -> str:
    """The step layer and the person layer of a journey call's prompt: this call's goal and talking points, what has been emailed, who to ask for,
    and what to do on voicemail. The standing prompt (who we are, tone, compliance, booking) is unchanged and is read first."""
    camp = await db.get(EmailCampaign, enr.campaign_id)
    out = ["This call is one step of an outreach journey. Use only what is written here and never invent anything about them."]
    goal = (step.goal or (camp.goal if camp else "") or "").strip()
    if goal:
        out.append(f"Goal of this call: {goal}")
    if (step.notes or "").strip():
        out.append(f"Talking points: {step.notes.strip()}")
    sent = (await db.execute(select(EmailMessage).where(EmailMessage.enrollment_id == enr.id, EmailMessage.is_warmup.is_(False))
                             .order_by(EmailMessage.sent_at))).scalars().all()
    for m in sent[-3:]:
        state = "replied" if m.status == "replied" else ("opened it" if (m.open_count or 0) > 0 else "has not opened it")
        out.append(f"We emailed them \"{(m.subject or '').strip()[:100]}\" and the person {state}.")
    if not sent:
        out.append("We have not emailed them yet.")
    names = []
    try:
        if lead is not None and lead.business_record_id and not (lead.contact_name or "").strip():
            from app.models.models import BusinessRecord
            from app.services import company_contacts as CC

            biz = await db.get(BusinessRecord, lead.business_record_id)
            names = [f"{o['first_name']} {o['last_name']}".strip() for o in CC.active_officers(getattr(biz, "officers", None))[:2] if o.get("first_name")]
    except Exception as err:
        logger.debug("officers not added to the call brief: %s", err)
    if names:
        out.append("The company register lists these directors: " + ", ".join(names) + ". Ask for one of them if you are not sure who to speak to.")
    out.append("If it goes to voicemail: " + ("leave one short message (under 20 seconds) saying who you are and that you emailed, then end the call."
                                             if step.voicemail == "leave_message" else "do not leave a message; end the call."))
    out.append("If they ask to be called back, ask for a day and time. If they ask not to be contacted, apologise, agree and end the call.")
    return "\n".join(out)


# ── The engine's checks, called from the sender ─────────────────────────────
def pick_version(enr: EmailEnrollment, step: EmailSequenceStep) -> tuple:
    """(subject, body) for this person: the second version when the step has one and the person was given it."""
    if (enr.variant or "a") == "b" and (step.body_b or "").strip():
        return (step.subject_b or step.subject or ""), step.body_b
    return step.subject or "", step.body_template or ""


def variant_for(enrollment_id: str) -> str:
    return "b" if int(hashlib.sha1(enrollment_id.encode()).hexdigest(), 16) % 2 else "a"


async def sent_today(db: AsyncSession, campaign_id: str, now: datetime) -> int:
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return (await db.execute(select(func.count(EmailMessage.id)).where(
        EmailMessage.campaign_id == campaign_id, EmailMessage.is_warmup.is_(False), EmailMessage.sent_at >= start))).scalar() or 0


async def already_sent(db: AsyncSession, enrollment_id: str, step_id: str) -> bool:
    """A step that already went to this person is never sent twice, even if the server restarted before the journey moved on."""
    return bool((await db.execute(select(EmailMessage.id).where(
        EmailMessage.enrollment_id == enrollment_id, EmailMessage.sequence_step_id == step_id,
        EmailMessage.status.in_(("sent", "delivered", "replied", "bounced"))).limit(1))).first())


# ── Who gets email, and the other way for those who don't ───────────────────
SWAP_PREFIX = "swap:"  # step_key of a task made in place of an email
OTHER_WAY_WORDS = {"call_task": "a call", "letter_task": "a letter", "linkedin_task": "a LinkedIn task", "task": "a task to find another way"}


async def email_decision(db: AsyncSession, enr: EmailEnrollment) -> Dict[str, Any]:
    """The send-time answer for one person (see send_readiness): their saved company when there is one, else the company beside them."""
    from app.services import send_readiness as SR

    if enr.lead_id:
        accounts, records = await _eligibility_inputs(db, [{"lead_id": enr.lead_id}])
        acc = accounts.get(enr.lead_id)
        if acc is not None:
            return SR.eligibility(acc, records.get(acc.business_record_id), address=enr.email or "")
    return SR.pasted_person(enr.company)


def other_channel(lead: Optional[LeadAccount]) -> str:
    """How to reach someone who may not be emailed: by phone when there is a number, else by post, else LinkedIn, else a task to find a way."""
    from app.services.identity import lead_phone

    chosen = ((getattr(lead, "eligibility_note", None) or {}).get("channel") or "") if lead is not None else ""
    if chosen in ("call_task", "letter_task", "linkedin_task"):  # the person said how to reach them when they marked them a sole trader
        return chosen
    if lead is not None and lead_phone(lead):
        return "call_task"
    if lead is not None and ((lead.address or "").strip() or (lead.postcode or "").strip()):
        return "letter_task"
    if lead is not None and (lead.linkedin_url or "").strip():
        return "linkedin_task"
    return "task"


def note_timeline(enr: EmailEnrollment, text: str, now: datetime) -> None:
    """A line in this person's journey timeline (kept on the enrolment, newest last, at most 20)."""
    v = dict(enr.vars or {})
    v["timeline"] = [*(v.get("timeline") or []), {"at": now.isoformat() + "Z", "step": enr.current_step, "text": text[:300]}][-20:]
    enr.vars = v


async def reach_other_way(db: AsyncSession, camp: EmailCampaign, enr: EmailEnrollment, step: EmailSequenceStep, steps: Dict[int, EmailSequenceStep],
                          verdict: Dict[str, Any], now: datetime) -> str:
    """This email step is not sent to this person: one task to reach them another way is made (once per person), the journey's
    timeline says so, and the journey carries on to its next step. Returns the task kind."""
    lead = await _lead(db, enr)
    kind = other_channel(lead)
    who = enr.company or (lead.name if lead else "") or enr.first_name or enr.email
    why = verdict.get("reason") or "They may not be emailed without their consent"
    have = (await db.execute(select(JourneyTask.id).where(JourneyTask.enrollment_id == enr.id, JourneyTask.step_key.like(f"{SWAP_PREFIX}%")).limit(1))).first()
    if not have:
        titles = {"call_task": f"Call {who}", "letter_task": f"Send a letter to {who}", "linkedin_task": f"Reach {who} on LinkedIn",
                  "task": f"Find another way to reach {who}"}
        notes = f"Not emailed: {why}."
        if kind == "call_task":
            notes += " Needs screening: check the number against the TPS register before you call."
        elif kind == "letter_task" and lead is not None:
            notes += " Address: " + ", ".join(x for x in ((lead.address or "").strip(), (lead.postcode or "").strip()) if x) + "."
        elif kind == "linkedin_task" and lead is not None:
            notes += f" Profile: {lead.linkedin_url}."
        await make_task(db, camp, enr, kind=kind, title=titles[kind], notes=notes, step_key=f"{SWAP_PREFIX}{step.step_key or step.id}", park=False, now=now)
    text = f"Step {enr.current_step}: email not sent ({why}). {OTHER_WAY_WORDS[kind][0].upper()}{OTHER_WAY_WORDS[kind][1:]} instead."
    note_timeline(enr, text, now)
    if enr.lead_id:
        try:
            from app.services import connections as C

            await C.record_event(db, "note", lead_id=enr.lead_id, ref_id=f"swap:{enr.id}:{step.id}", summary=f"Journey {camp.name}: {text}")
        except Exception as err:
            logger.debug("journey swap event not written: %s", err)
    await advance(db, enr, steps, now)
    return kind


# ── Checking each email before it goes ──────────────────────────────────────
def approval_reason(camp: EmailCampaign, boxes: List[Any]) -> str:
    """Why this journey's emails wait for approval, or "" when they go straight out. A mailbox still warming up always asks."""
    warming = [b.email for b in boxes if getattr(b, "status", "") == "warming" and b.id in (camp.mailbox_ids or [])]
    if warming:
        return f"{warming[0]} is still warming up, so each email waits for you to approve it"
    if camp.approval_required:
        return "You check each email before it goes"
    return ""


def _approval_out(a: EmailApproval, journey: str = "") -> Dict[str, Any]:
    return {"id": a.id, "campaign_id": a.campaign_id, "journey": journey, "enrollment_id": a.enrollment_id, "email": a.email, "company": a.company,
            "subject": a.subject, "body": a.body, "edited": bool(a.edited), "status": a.status,
            "created_at": a.created_at.isoformat() + "Z" if a.created_at else None}


async def approval_for(db: AsyncSession, enrollment_id: str, step_id: str) -> Optional[EmailApproval]:
    return (await db.execute(select(EmailApproval).where(EmailApproval.enrollment_id == enrollment_id, EmailApproval.step_id == step_id,
                                                         EmailApproval.status.in_(("pending", "approved"))).order_by(EmailApproval.created_at.desc()).limit(1))).scalars().first()


async def park_for_approval(db: AsyncSession, camp: EmailCampaign, enr: EmailEnrollment, step: EmailSequenceStep, subject: str, body: str,
                            now: datetime) -> EmailApproval:
    """The email is written now and waits in the queue; the person is held until it is approved."""
    row = EmailApproval(id=f"ap_{uuid.uuid4().hex[:12]}", campaign_id=camp.id, enrollment_id=enr.id, step_id=step.id, email=enr.email or "",
                        company=enr.company or "", subject=subject, body=body, status="pending", created_at=now)
    db.add(row)
    enr.waiting_on, enr.waiting_since, enr.next_action_at = f"approval:{row.id}", now, None
    return row


async def release_parked(db: AsyncSession, camp: EmailCampaign) -> int:
    """Approval was switched off: people parked for it go on at once. Their pending emails stay, so any edit is still the text that goes."""
    now = datetime.utcnow()
    rows = (await db.execute(select(EmailEnrollment).where(EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active",
                                                           EmailEnrollment.waiting_on.like("approval:%")))).scalars().all()
    for e in rows:
        e.waiting_on, e.waiting_since, e.next_action_at = "", None, now
    return len(rows)


async def cancel_approvals(db: AsyncSession, enrollment_id: str) -> int:
    n = 0
    for a in (await db.execute(select(EmailApproval).where(EmailApproval.enrollment_id == enrollment_id, EmailApproval.status.in_(("pending", "approved"))))).scalars().all():
        a.status = "cancelled"
        n += 1
    return n


async def list_approvals(db: AsyncSession, campaign_id: str = "", limit: int = 200) -> List[Dict[str, Any]]:
    q = select(EmailApproval, EmailCampaign.name).join(EmailCampaign, EmailCampaign.id == EmailApproval.campaign_id, isouter=True).where(EmailApproval.status == "pending")
    if campaign_id:
        q = q.where(EmailApproval.campaign_id == campaign_id)
    rows = (await db.execute(q.order_by(EmailApproval.created_at).limit(max(1, min(limit, 500))))).all()
    return [_approval_out(a, name or "") for a, name in rows]


async def _pending(db: AsyncSession, approval_id: str) -> EmailApproval:
    a = await db.get(EmailApproval, approval_id)
    if a is None or a.status != "pending":
        raise JourneyError("That email isn't waiting any more.")
    return a


async def edit_approval(db: AsyncSession, approval_id: str, *, subject: Optional[str] = None, body: Optional[str] = None) -> Dict[str, Any]:
    a = await _pending(db, approval_id)
    if subject is not None:
        a.subject = str(subject).strip()[:300]
    if body is not None:
        if not str(body).strip():
            raise JourneyError("The email can't be empty.")
        a.body = str(body)[:10000]
    a.edited = True
    return _approval_out(a)


async def approve(db: AsyncSession, approval_ids: List[str], *, by: str = "", now: Optional[datetime] = None) -> int:
    """Approved emails go out in the next sending window, exactly as they read in the queue."""
    now = now or datetime.utcnow()
    n = 0
    for aid in approval_ids:
        a = await db.get(EmailApproval, aid)
        if a is None or a.status != "pending":
            continue
        a.status, a.approved_by, a.approved_at = "approved", by or "", now
        enr = await db.get(EmailEnrollment, a.enrollment_id)
        if enr is not None and enr.status == "active" and enr.waiting_on == f"approval:{a.id}":
            enr.waiting_on, enr.next_action_at = "", now
        n += 1
    return n


async def approve_all(db: AsyncSession, campaign_id: str = "", *, by: str = "", now: Optional[datetime] = None) -> int:
    q = select(EmailApproval.id).where(EmailApproval.status == "pending")
    if campaign_id:
        q = q.where(EmailApproval.campaign_id == campaign_id)
    return await approve(db, list((await db.execute(q)).scalars().all()), by=by, now=now)


async def _swap_unpermitted_call(db: AsyncSession, camp: EmailCampaign, enr: EmailEnrollment, step: EmailSequenceStep,
                                 steps: Dict[int, EmailSequenceStep], lead: Optional[LeadAccount], now: datetime) -> bool:
    """An AI call may not be placed to a number with no recorded permission. One task to call by hand is made instead (once per person) and
    the journey carries on. Anything that stops the check leaves the step to the call itself, which is refused there."""
    try:
        from app.services import call_permission as CP
        from app.services.identity import lead_phone

        lead = lead or await _lead(db, enr)
        phone = lead_phone(lead) if lead is not None else ""
        if not phone:
            return False
        if (step.condition or "always") == "opened_no_reply":
            opened = (await db.execute(select(func.count(EmailMessage.id)).where(EmailMessage.enrollment_id == enr.id, EmailMessage.open_count > 0))).scalar() or 0
            if not opened:
                return False
        verdict = await CP.decide(db, phone, "ai")
        if verdict.get("needs") != "ai_consent":
            return False
    except Exception as err:
        logger.debug("call permission check skipped: %s", err)
        return False
    who = enr.company or (lead.name if lead else "") or enr.first_name or enr.email
    key = f"{SWAP_PREFIX}{step.step_key or step.id}"
    have = (await db.execute(select(JourneyTask.id).where(JourneyTask.enrollment_id == enr.id, JourneyTask.step_key == key).limit(1))).first()
    if not have:
        await make_task(db, camp, enr, kind="call_task", title=f"Call {who}", notes="No permission for AI calls recorded. Call yourself. Check TPS first.",
                        step_key=key, park=False, now=now)
    text = f"Step {enr.current_step}: no permission for AI calls recorded. A call for you to make instead."
    note_timeline(enr, text, now)
    if enr.lead_id:
        try:
            from app.services import connections as C

            await C.record_event(db, "note", lead_id=enr.lead_id, ref_id=f"swap:{enr.id}:{step.id}", summary=f"Journey {camp.name}: {text}")
        except Exception as err:
            logger.debug("journey swap event not written: %s", err)
    await advance(db, enr, steps, now)
    return True


async def before_step(db: AsyncSession, camp: EmailCampaign, enr: EmailEnrollment, step: EmailSequenceStep,
                      steps: Dict[int, EmailSequenceStep], rules: Dict[str, Any], now: datetime) -> bool:
    """Everything that can settle a due person without sending: a stage that means stop, a call that never reported back, a skipped channel,
    or a manual step that becomes a task. True when it was dealt with here."""
    ch = "call" if step.channel == "voice_call" else step.channel
    lead = await _lead(db, enr) if rules["skip_stages"] else None
    if lead is not None and (lead.stage or "new") in rules["skip_stages"]:
        await exit_enrollment(db, enr, "stage", now=now)
        return True
    if ch in EMAIL_LIKE and not enr.email_blocked:  # judged again at send time: a check, a choice or a revoked consent since they joined counts
        verdict = await email_decision(db, enr)
        if not verdict["ok"]:  # a closed company or a number that belongs to another: nothing is gained by any step
            await exit_enrollment(db, enr, "not_eligible", now=now)
            return True
        if not verdict["email"] and verdict.get("group") == "quick_choice":
            # Waiting for the one-click choice: nothing is made for them yet. A task to reach them another way is made only once
            # someone is marked a sole trader. They are looked at again later, so the choice takes effect without any restart.
            note = "Waiting for your quick choice. Their emails are on hold."
            if not any(t.get("text") == note for t in ((enr.vars or {}).get("timeline") or [])[-3:]):
                note_timeline(enr, note, now)
            for t in (await db.execute(select(JourneyTask).where(JourneyTask.enrollment_id == enr.id, JourneyTask.status == "open", JourneyTask.kind == "task",
                                                               JourneyTask.step_key.like(f"{SWAP_PREFIX}%")))).scalars().all():
                t.status, t.completed_at = "cancelled", now  # made before the choice was asked for: one item only, the quick choice
            enr.next_action_at = now + timedelta(hours=6)
            return True
        if not verdict["email"]:
            await reach_other_way(db, camp, enr, step, steps, verdict, now)
            return True
    if enr.waiting_on == "call":  # the call reported nothing in time: treat it as unanswered
        await apply_call_outcome(db, enr, camp, steps, "no_answer", now, waiting=True)
        return True
    if ch in EMAIL_LIKE and enr.email_blocked:
        await advance(db, enr, steps, now)
        return True
    if ch == "call" and enr.call_blocked:
        await advance(db, enr, steps, now)
        return True
    if ch == "call" and await _swap_unpermitted_call(db, camp, enr, step, steps, lead, now):
        return True
    if ch in TASK_KINDS:
        await start_task_step(db, camp, enr, step, now)
        return True
    return False


async def sweep_silent(db: AsyncSession, camp: EmailCampaign, now: datetime) -> int:
    """People who finished every step and never answered are marked unresponsive after the journey's number of days."""
    days = rules_of(camp)["unresponsive_days"]
    if not days:
        return 0
    n = 0
    for enr in (await db.execute(select(EmailEnrollment).where(
            EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "completed", EmailEnrollment.last_action_at < now - timedelta(days=days)))).scalars().all():
        enr.status, enr.finish_reason = "unresponsive", "unresponsive"
        n += 1
    return n


# ── Enrolling people ────────────────────────────────────────────────────────
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


async def people_from_list(db: AsyncSession, list_id: str, how_many: int = 200) -> List[Dict[str, Any]]:
    from app.api import lead_lists as LL

    lst = next((l for l in await LL._load(db) if l["id"] == list_id), None)
    if not lst:
        raise JourneyError("That list isn't there any more.")
    ids = (lst.get("ids") or [])[: max(1, min(int(how_many or 200), 5000))]
    rows = (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(ids)))).scalars().all() if ids else []
    out = []
    for a in rows:
        parts = (a.contact_name or "").split()
        out.append({"email": a.email or "", "first_name": parts[0] if parts else "", "last_name": " ".join(parts[1:]), "company": a.name, "lead_id": a.id})
    return out


async def enrol(db: AsyncSession, camp: EmailCampaign, people: List[Dict[str, Any]], org_id: str, *, dry_run: bool = False) -> Dict[str, Any]:
    """Adds people. Skips bad addresses, people already here, people on the do-not-email list, and (unless the journey allows it) people already
    in another running journey. With dry_run nothing is written: the same counts, for a confirmation."""
    from app.services.email_dispatcher import is_email_suppressed

    steps = await steps_of(db, camp.id)
    needs_email = any((("call" if s.channel == "voice_call" else s.channel) in EMAIL_LIKE) for s in steps)
    first = steps[0] if steps else None
    varied = any((s.body_b or "").strip() for s in steps)
    have_email = set((await db.execute(select(EmailEnrollment.email).where(EmailEnrollment.campaign_id == camp.id))).scalars().all())
    have_lead = set((await db.execute(select(EmailEnrollment.lead_id).where(EmailEnrollment.campaign_id == camp.id))).scalars().all())
    busy_elsewhere: set = set()
    if camp.one_at_a_time:
        busy_elsewhere = set((await db.execute(select(EmailEnrollment.email).join(EmailCampaign, EmailCampaign.id == EmailEnrollment.campaign_id).where(
            EmailEnrollment.status == "active", EmailEnrollment.campaign_id != camp.id, EmailCampaign.status == "running"))).scalars().all())
    added, now = 0, datetime.utcnow()
    skipped = {"invalid": 0, "duplicate": 0, "do_not_email": 0, "in_another_journey": 0, "no_contact": 0, "problem": 0, "email_bad": 0}
    excluded: List[Dict[str, Any]] = []  # who was kept out (closed company, address that cannot receive mail), and why
    plan = {"email": 0, "quick_choice": 0, "reach_other_way": 0}  # what happens to the people added: emailed, waiting on a one-click choice, reached another way
    quick: List[Dict[str, Any]] = []
    other: List[Dict[str, Any]] = []
    accounts, records = await _eligibility_inputs(db, people)
    running = camp.status == "running"
    for p in people:
        addr = str(p.get("email") or "").strip().lower()
        lead_id = str(p.get("lead_id") or "") or None
        if needs_email and not _EMAIL.match(addr):
            skipped["invalid"] += 1
            continue
        if not needs_email and not (addr or lead_id):
            skipped["no_contact"] += 1
            continue
        if (addr and addr in have_email) or (lead_id and lead_id in have_lead):
            skipped["duplicate"] += 1
            continue
        if addr and (await is_email_suppressed(db, addr, org_id))[0]:
            skipped["do_not_email"] += 1
            continue
        if addr and addr in busy_elsewhere:
            skipped["in_another_journey"] += 1
            continue
        acc = accounts.get(lead_id) if lead_id else None
        verdict = eligible_person(acc, records, p)
        who = {"email": addr, "company": str(p.get("company") or "")[:160], "lead_id": lead_id or "", "code": verdict["code"], "reason": verdict["reason"]}
        if not verdict["ok"]:
            skipped[verdict["code"]] += 1
            excluded.append(who)
            continue
        if verdict["email"]:
            plan["email"] += 1
        else:
            plan[verdict["group"]] += 1
            (quick if verdict["group"] == "quick_choice" else other).append(who)
        if addr:
            have_email.add(addr)
        if lead_id:
            have_lead.add(lead_id)
        added += 1
        if dry_run:
            continue
        eid = f"en_{uuid.uuid4().hex[:12]}"
        pvars = dict(p.get("vars") or {})
        if acc is not None:
            pvars["source_line"] = source_sentence(acc, records.get(acc.business_record_id) if acc.business_record_id else None)
        db.add(EmailEnrollment(id=eid, campaign_id=camp.id, prospect_id=p.get("prospect_id") or None, lead_id=lead_id, email=addr,
                               first_name=str(p.get("first_name") or "").strip()[:80], last_name=str(p.get("last_name") or "").strip()[:80],
                               company=str(p.get("company") or "").strip()[:160], current_step=1, current_step_key=(first.step_key or first.id) if first else "",
                               status="active", next_action_at=now if running else None, variant=variant_for(eid) if varied else "a", vars=pvars or None))
    if not dry_run:
        await db.flush()
    return {"added": added, "skipped": skipped, "excluded": excluded[:200], "excluded_total": len(excluded), "plan": plan,
            "quick_choices": quick[:200], "other_way": other[:200], "plan_text": plan_text(plan) if needs_email else "", "queued": not running}


CANT_EMAIL_WORDS = {"email_bad": "invalid address", "problem": "closed or wrong company"}


def plan_text(plan: Dict[str, int], other_by: Optional[Dict[str, int]] = None, cant_by: Optional[Dict[str, int]] = None) -> str:
    """"186 get email, 9 need a quick choice, 5 get a call instead": what happens to the people in a journey, never a refusal."""
    def n(k: int, one: str, many: str) -> str:
        return f"{k} {one if k == 1 else many}"

    parts = []
    if plan.get("email"):
        parts.append(n(plan["email"], "gets email", "get email"))
    if plan.get("quick_choice"):
        parts.append(n(plan["quick_choice"], "needs a quick choice", "need a quick choice"))
    if other_by:
        for kind, k in sorted(other_by.items(), key=lambda x: -x[1]):
            if k:
                parts.append(n(k, "gets", "get") + f" {OTHER_WAY_WORDS.get(kind, 'another way')} instead")
    elif plan.get("reach_other_way"):
        parts.append(n(plan["reach_other_way"], "is reached another way", "are reached another way"))
    for code, k in sorted((cant_by or {}).items(), key=lambda x: -x[1]):
        if k:
            parts.append(f"{k} can't be emailed: {CANT_EMAIL_WORDS.get(code, 'not eligible')}")
    return ", ".join(parts)


async def _eligibility_inputs(db: AsyncSession, people: List[Dict[str, Any]]):
    """The saved companies (and their register records) behind these people, loaded once for the whole batch."""
    from app.models.models import BusinessRecord

    ids = {str(p.get("lead_id")) for p in people if p.get("lead_id")}
    accounts = {a.id: a for a in (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(ids)))).scalars().all()} if ids else {}
    biz_ids = {a.business_record_id for a in accounts.values() if a.business_record_id}
    records = {b.id: b for b in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(biz_ids)))).scalars().all()} if biz_ids else {}
    return accounts, records


def eligible_person(acc: Optional[LeadAccount], records: Dict[str, Any], person: Dict[str, Any]) -> Dict[str, Any]:
    """May this person be written to? A saved company is judged by its check; a pasted person by the company named beside them."""
    from app.services import company_check as CC
    from app.services import send_readiness as SR

    address = str(person.get("email") or "").strip()
    if address and not CC.email_shape(address)[0]:  # for example a trailing dot: it would bounce
        return {"ok": False, "email": False, "code": "email_bad", "reason": "Its email address can't receive mail", "group": ""}
    if acc is not None:
        return SR.eligibility(acc, records.get(acc.business_record_id), address=address)
    return SR.pasted_person(person.get("company"))


# ── Where we found them ────────────────────────────────────────────────────
def source_parts(lead: Optional[LeadAccount], rec: Any = None) -> tuple:
    """("the Companies House register" | a website host | "", the day we found them as a date or None). Imported and typed-in companies have no outside source."""
    from urllib.parse import urlparse

    if lead is None:
        return "", None
    created = lead.created_at.date() if getattr(lead, "created_at", None) else None
    for src in (getattr(rec, "sources", None) or []):
        key = f"{src.get('source_type', '')} {src.get('source_id', '')}".lower()
        if "companies" in key or src.get("source_type") == "bulk_csv":
            try:
                return "the Companies House register", datetime.fromisoformat(str(src.get("confirmed_at") or "")[:10]).date()
            except ValueError:
                return "the Companies House register", created
    if (lead.source or "") in ("web", "research"):
        host = urlparse(lead.source_url or "").netloc.removeprefix("www.")
        if host:
            return host, created
    return "", None


def source_sentence(lead: Optional[LeadAccount], rec: Any = None) -> str:
    where, when = source_parts(lead, rec)
    if not where:
        return ""
    day = f" on {when.day} {when:%b %Y}" if when else ""
    return f"We found {lead.name} on {where}{day}."


async def source_line(db: AsyncSession, lead: Optional[LeadAccount]) -> str:
    """The sentence that tells a person where we got their details (UK GDPR Article 14), or "" when the company came from the user's own files."""
    if lead is None:
        return ""
    rec = None
    if lead.business_record_id:
        from app.models.models import BusinessRecord

        rec = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == lead.business_record_id))).scalars().first()
    return source_sentence(lead, rec)


async def ensure_source_line(db: AsyncSession, enr: EmailEnrollment) -> str:
    """The enrolment's {{source_line}}, filled the first time it is needed for people who joined before it existed."""
    v = dict(enr.vars or {})
    if "source_line" not in v:
        v["source_line"] = await source_line(db, await _lead(db, enr)) if enr.lead_id else ""
        enr.vars = v
    return v["source_line"]


SOURCE_TAG = re.compile(r"\{\{\s*source_?line\s*\}\}", re.I)


async def preview(db: AsyncSession, camp: EmailCampaign, enrollment_id: str = "", step_key: str = "") -> Dict[str, Any]:
    """An email exactly as one real person in this journey would get it, footer included. Nothing is saved or sent."""
    from types import SimpleNamespace

    from app.config import settings
    from app.models.models import EmailMailbox
    from app.services import form_links as FL
    from app.services.email_dispatcher import _sender_line
    from app.services.email_worker import booking_link_for, render

    q = select(EmailEnrollment).where(EmailEnrollment.campaign_id == camp.id)
    enr = (await db.execute(q.where(EmailEnrollment.id == enrollment_id))).scalars().first() if enrollment_id else None
    if enr is None:
        enr = (await db.execute(q.order_by((EmailEnrollment.status == "active").desc(), EmailEnrollment.created_at).limit(1))).scalars().first()
    if enr is None:
        raise JourneyError("Add people to this journey first, then you can preview an email with one of them.")
    steps = await steps_of(db, camp.id)
    step = next((x for x in steps if (x.step_key or x.id) == step_key or str(x.step_number) == step_key), None) if step_key else None
    step = step or next((x for x in steps if x.channel == "email"), None)
    if step is None or step.channel != "email":
        raise JourneyError("Pick an email step to preview.")
    subject_tpl, body_tpl = pick_version(enr, step)
    subject_tpl, body_tpl = await FL.resolve(db, camp.org_id, enr, subject_tpl), await FL.resolve(db, camp.org_id, enr, body_tpl)
    vars_ = dict(enr.vars or {})
    if "source_line" not in vars_:
        vars_["source_line"] = await source_line(db, await _lead(db, enr)) if enr.lead_id else ""
    shown = SimpleNamespace(first_name=enr.first_name, last_name=enr.last_name, company=enr.company, email=enr.email, vars=vars_)
    link = await booking_link_for(db, camp.org_id, enr)
    why = f"{settings.PUBLIC_BASE_URL.rstrip('/')}/api/legal/business-data"
    sender = await _sender_line(db)
    footer = (f"{sender}\n\n" if sender else "") + f"Not interested? Unsubscribe: (unsubscribe link)\nWhy you got this, and where we found your details: {why}"
    boxes = list((await db.execute(select(EmailMailbox))).scalars().all())
    return {"to": enr.email, "person": f"{enr.first_name} {enr.last_name}".strip() or enr.company or enr.email, "step_key": step.step_key or step.id,
            "subject": render(subject_tpl, shown, link).strip(), "body_text": render(body_tpl, shown, link), "footer_text": footer,
            "approval_note": approval_reason(camp, boxes)}


# ── Reading a journey ───────────────────────────────────────────────────────
STATUS_GROUPS = {"in_progress": ("active",), "replied": ("replied",), "booked": ("booked",), "finished": ("completed", "finished"),
                 "unresponsive": ("unresponsive",), "bounced": ("bounced",), "opted_out": ("unsubscribed", "suppressed", "blocked")}


async def step_results(db: AsyncSession, camp: EmailCampaign) -> List[Dict[str, Any]]:
    """One row per step: what went out and what came of it. A booking or an opt-out belongs to the step whose message the person last
    received before it happened. Opens are a minimum: a mail app that blocks the tracking picture hides them."""
    steps = await steps_of(db, camp.id)
    by_id = {st.id: st for st in steps}
    msgs = (await db.execute(select(EmailMessage).where(EmailMessage.campaign_id == camp.id, EmailMessage.is_warmup.is_(False)))).scalars().all()
    status_of = dict((await db.execute(select(EmailEnrollment.id, EmailEnrollment.status).where(EmailEnrollment.campaign_id == camp.id))).all())
    sent_msgs = [m for m in msgs if m.status not in ("queued", "failed")]
    last: Dict[str, EmailMessage] = {}
    for m in sorted(sent_msgs, key=lambda x: x.sent_at or x.created_at or datetime.min):
        if m.enrollment_id:
            last[m.enrollment_id] = m
    booked: Dict[str, int] = {}
    opted: Dict[str, int] = {}
    counted = set()
    for eid, m in last.items():
        if m.sequence_step_id not in by_id:
            continue
        if status_of.get(eid) == "booked":
            booked[m.sequence_step_id] = booked.get(m.sequence_step_id, 0) + 1
        if status_of.get(eid) in ("unsubscribed", "suppressed"):
            opted[m.sequence_step_id] = opted.get(m.sequence_step_id, 0) + 1
            counted.add(eid)
    for m in sent_msgs:  # an unsubscribe reply counts even when the person's status was set another way
        if m.reply_category == "unsubscribe" and m.enrollment_id not in counted and m.sequence_step_id in by_id:
            opted[m.sequence_step_id] = opted.get(m.sequence_step_id, 0) + 1
            counted.add(m.enrollment_id)
    out = []
    for st in steps:
        rows = [m for m in msgs if m.sequence_step_id == st.id]
        sent = [m for m in rows if m.status not in ("queued", "failed")]
        n = len(sent)
        replied = sum(1 for m in sent if m.status == "replied")
        bounced = sum(1 for m in sent if m.status == "bounced")
        opened = sum(1 for m in sent if (m.open_count or 0) > 0 or m.status == "replied")
        pct = lambda v: round(100 * v / n, 1) if n else None
        out.append({"step": st.step_number, "step_key": st.step_key or st.id, "channel": "call" if st.channel == "voice_call" else st.channel,
                    "sent": n, "delivered": n - bounced, "opened": opened, "replied": replied, "booked": booked.get(st.id, 0), "bounced": bounced,
                    "opted_out": opted.get(st.id, 0), "failed": sum(1 for m in rows if m.status == "failed"),
                    "open_rate": pct(opened), "reply_rate": pct(replied), "bounce_rate": pct(bounced)})
    return out


async def results(db: AsyncSession, camp: EmailCampaign) -> Dict[str, Any]:
    status = dict((await db.execute(select(EmailEnrollment.status, func.count(EmailEnrollment.id)).where(
        EmailEnrollment.campaign_id == camp.id).group_by(EmailEnrollment.status))).all())
    waiting = (await db.execute(select(func.count(EmailEnrollment.id)).where(
        EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active", EmailEnrollment.waiting_on != "",
        ~EmailEnrollment.waiting_on.like("approval:%")))).scalar() or 0
    for_approval = (await db.execute(select(func.count(EmailApproval.id)).where(
        EmailApproval.campaign_id == camp.id, EmailApproval.status == "pending"))).scalar() or 0
    msgs = dict((await db.execute(select(EmailMessage.status, func.count(EmailMessage.id)).where(
        EmailMessage.campaign_id == camp.id, EmailMessage.is_warmup.is_(False)).group_by(EmailMessage.status))).all())
    opened = (await db.execute(select(func.count(EmailMessage.id)).where(
        EmailMessage.campaign_id == camp.id, EmailMessage.is_warmup.is_(False), EmailMessage.open_count > 0))).scalar() or 0
    sent = sum(msgs.values())
    people = {g: sum(status.get(s, 0) for s in sts) for g, sts in STATUS_GROUPS.items()}
    variants = {}
    rows = (await db.execute(select(EmailEnrollment.variant, EmailMessage.status, func.count(EmailMessage.id)).join(
        EmailEnrollment, EmailEnrollment.id == EmailMessage.enrollment_id).where(
        EmailMessage.campaign_id == camp.id, EmailMessage.is_warmup.is_(False)).group_by(EmailEnrollment.variant, EmailMessage.status))).all()
    for v, st, n in rows:
        d = variants.setdefault(v or "a", {"sent": 0, "replied": 0})
        d["sent"] += n
        d["replied"] += n if st == "replied" else 0
    for d in variants.values():
        d["reply_rate"] = round(100 * d["replied"] / d["sent"], 1) if d["sent"] else 0.0
    from app.services.connections import get_rules

    by_step = await step_results(db, camp)
    return {"people": sum(status.values()), "in_progress": people["in_progress"], "waiting_on_a_task": waiting, "waiting_for_approval": for_approval, "by_status": people,
            "sent": sent, "opened": opened, "replied": msgs.get("replied", 0), "bounced": msgs.get("bounced", 0),
            "delivered": sent - msgs.get("bounced", 0), "booked": sum(r["booked"] for r in by_step), "opted_out": sum(r["opted_out"] for r in by_step),
            "by_step": by_step, "opens_tracked": bool((await get_rules(db)).get("warm_lead_prompt")),
            "reply_rate": round(100 * msgs.get("replied", 0) / sent, 1) if sent else 0.0,
            "bounce_rate": round(100 * msgs.get("bounced", 0) / sent, 1) if sent else 0.0,
            "variants": variants if len(variants) > 1 else {}}


async def audience(db: AsyncSession, camp: EmailCampaign, *, with_choices: bool = True, choice_limit: int = 10) -> Dict[str, Any]:
    """Who of the people still in it gets email, who needs a one-click choice and who is reached another way (and how), with the
    choices to make inline. Free: our own data only."""
    from app.services import eligibility as EL

    enrs = (await db.execute(select(EmailEnrollment).where(EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active").limit(5000))).scalars().all()
    accounts, records = await _eligibility_inputs(db, [{"lead_id": e.lead_id} for e in enrs if e.lead_id])
    plan = {"email": 0, "quick_choice": 0, "reach_other_way": 0, "cant_email": 0}
    other_by: Dict[str, int] = {}
    cant_by: Dict[str, int] = {}
    choices: List[Dict[str, Any]] = []
    for e in enrs:
        acc = accounts.get(e.lead_id) if e.lead_id else None
        d = eligible_person(acc, records, {"company": e.company, "email": e.email})
        if not d["ok"]:
            plan["cant_email"] += 1  # counted, so the summary adds up to everyone in the journey
            cant_by[d["code"]] = cant_by.get(d["code"], 0) + 1
            continue
        if d["email"]:
            plan["email"] += 1
            continue
        if d["group"] == "quick_choice":
            plan["quick_choice"] += 1
            if with_choices and acc is not None and len(choices) < choice_limit:
                choices.append({"lead_id": acc.id, "name": acc.name, "email": e.email, "reason": d["reason"], "candidates": await EL.candidates(db, acc)})
            continue
        plan["reach_other_way"] += 1
        kind = other_channel(acc)
        other_by[kind] = other_by.get(kind, 0) + 1
    return {**plan, "other_by": other_by, "cant_by": cant_by, "choices": choices, "text": plan_text(plan, other_by, cant_by)}


async def preflight(db: AsyncSession, camp: EmailCampaign, org_id: str, aud: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """What stands between this journey and starting, in plain words: red must be fixed, amber will clear or is a heads-up, green is fine.
    `aud` is the audience when the caller already worked it out (the journey summary does), so it is not read twice."""
    from app.api import email_outreach as EO
    from app.models.models import EmailMailbox
    from app.services import credits as credit

    out: List[Dict[str, Any]] = []

    def add(level: str, text: str, fix: str = "") -> None:
        out.append({"level": level, "text": text, "fix": fix})

    steps = await steps_of(db, camp.id)
    kinds = [("call" if s.channel == "voice_call" else s.channel) for s in steps]
    n_people = (await db.execute(select(func.count(EmailEnrollment.id)).where(EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active"))).scalar() or 0
    if not steps:
        add("red", "There are no steps yet.", "steps")
    total_people = (await db.execute(select(func.count(EmailEnrollment.id)).where(EmailEnrollment.campaign_id == camp.id))).scalar() or 0
    if not n_people:
        add("red", "Nobody is waiting to start: everyone in it has finished or left." if total_people else "Nobody is in this journey yet.", "people")
    if steps and kinds[0] == "email" and not SOURCE_TAG.search(steps[0].body_template or ""):
        add("amber", "Step 1 does not say where you found them. Add {{source_line}} so people know (UK GDPR Article 14).", "steps")
    if any(k == "email" for k in kinds):
        from app.models.models import CompanyProfile

        prof = (await db.execute(select(CompanyProfile).limit(1))).scalars().first()
        if not prof or not (prof.legal_name or "").strip() or not (getattr(prof, "postal_address", "") or "").strip():
            add("red", "Add your business name and postal address in About your business. UK law requires them in every marketing email.", "business")
    if any(k in EMAIL_LIKE for k in kinds) and any(k == "email" for k in kinds):
        boxes = [m for m in (await db.execute(select(EmailMailbox))).scalars().all() if m.id in (camp.mailbox_ids or [])]
        if not boxes:
            add("red", "No email account is chosen to send from.", "settings")
        for mb in boxes:
            if mb.status not in ("warming", "active", "graduated"):
                add("red", f"{mb.email} can't send yet: {', '.join(EO._sending_blockers(mb)) or mb.status}.", "mailboxes")
        ok, why = await credit.can_start(db, "email_send")
        if not ok:
            add("red", f"Not enough credits to send. {why}", "credits")
    if "call" in kinds:
        from app.services import lead_calls as LC
        from app.services.connection_handlers import entitled

        ent = await entitled(db, org_id)
        calls = n_people * kinds.count("call")
        if not (ent.get("voice") and ent.get("leads")):
            add("red", "A call step needs the Voice plan. Add Voice, or change the step to a call task.", "voice")
        elif calls:
            cp = await LC.cost_preview(db, calls)
            if cp.get("enough") is False:
                add("red", f"Up to {calls} calls could use about {cp['minutes_needed']} minutes and you have {cp['minutes_left']} left.", "voice")
            else:
                add("amber", f"Up to {calls} calls may be placed, only inside calling hours and only to people with a number that passed the check.")
    if n_people and any(k in EMAIL_LIKE for k in kinds):
        aud = aud or await audience(db, camp, with_choices=False)
        if aud["text"]:
            add("amber" if aud["quick_choice"] or aud["reach_other_way"] else "green", aud["text"] + ".", "quick_choice" if aud["quick_choice"] else "")
    if any(k == "email" for k in kinds):
        boxes = (await db.execute(select(EmailMailbox))).scalars().all()
        why = approval_reason(camp, boxes)
        if why:
            add("amber", f"{why}. They wait under Emails waiting for you.")
    manual = [k for k in kinds if k in TASK_KINDS]
    if manual:
        add("amber", f"{len(manual)} step{'s' if len(manual) != 1 else ''} will make tasks for you to do by hand. They show under Needs you today.")
    if not any(o["level"] == "red" for o in out):
        add("green", "Ready. Press Start and the first step goes out in the next sending window.")
    return out


def _clock(hm: str) -> int:
    h, _, m = (hm or "00:00").partition(":")
    return int(h or 0) * 60 + int(m or 0)


def plan_schedule(*, days: List[int], start: str, end: str, tz: str, local: datetime, boxes: List[Dict[str, Any]], min_delay_s: int, daily_cap: int,
                  waiting: int, steps: List[Dict[str, Any]]) -> Dict[str, Any]:
    """When the emails go out, in words a customer can follow. Pure: `boxes` is [{email, status, quota}] for the journey's mailboxes.
    It is an estimate: warming mailboxes send a few a day and the daily plan can change it."""
    from app.services.email_worker import SENDING, next_window

    names = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}
    days = sorted(set(days or [1, 2, 3, 4, 5]))
    day_text = "every day" if len(days) == 7 else "Mon to Fri" if days == [1, 2, 3, 4, 5] else ", ".join(names[d] for d in days)
    gap = max(30, int(min_delay_s or 60))
    window_s = max(0, (_clock(end) - _clock(start)) * 60)
    ready = [b for b in boxes if b["status"] in SENDING]
    per_box = [min(b["quota"], window_s // gap) for b in ready]
    per_day = sum(per_box)
    if daily_cap:
        per_day = min(per_day, daily_cap)
    cap_ok = per_day > 0
    camp_like = type("C", (), {"days_of_week": days, "sending_window_start": start, "sending_window_end": end})()
    open_now, opens = next_window(camp_like, local)  # same rule the sender uses
    out: Dict[str, Any] = {"timezone": tz, "days_text": day_text, "window": f"{start} to {end}", "open_now": open_now, "next_opens": opens,
                           "gap_seconds": gap, "per_day": per_day, "mailboxes_ready": len(ready), "waiting": waiting, "days_needed": 0, "finish": ""}
    if cap_ok and waiting:
        need = -(-waiting // per_day)
        out["days_needed"] = need
        d, n = local.date(), 0
        left = need
        while left > 0 and n < 400:
            if d.isoweekday() in days and not (d == local.date() and local.strftime("%H:%M") >= end):
                left -= 1
                if left == 0:
                    break
            d += timedelta(days=1)
            n += 1
        out["finish"] = "today" if d == local.date() else "tomorrow" if d == local.date() + timedelta(days=1) else d.strftime("%A %d %B")
    lines = [f"Emails go out {day_text}, {start} to {end} ({tz}). Nothing is sent outside those hours."]
    lines.append("Sending is open now." if open_now else (f"Next sending window opens {opens}." if opens else "No sending day is switched on."))
    if not ready:
        lines.append("No mailbox is ready to send yet, so nothing can go out. Pick a sender under Rules.")
    elif cap_ok:
        lines.append(f"Pace: about one email every {gap // 60 if gap >= 120 else gap} {'minutes' if gap >= 120 else 'seconds'}, up to {per_day} a day"
                     f"{' (your daily limit)' if daily_cap and per_day == daily_cap else ''}. New or warming mailboxes start small and send more each week.")
    if out["finish"] and waiting:
        lines.append(f"{waiting} {'person is' if waiting == 1 else 'people are'} waiting: the first email to everyone should be out by {out['finish']}.")
    waits = []
    for st in steps[1:]:
        gap_txt = (f"{st['delay_days']} day{'s' if st['delay_days'] != 1 else ''}" if st["delay_days"] else "") + (f" {st['delay_hours']}h" if st["delay_hours"] else "")
        waits.append(f"step {st['step']} {gap_txt.strip() or 'right away'} after the one before")
    if waits:
        lines.append("Follow-ups: " + "; ".join(waits) + ". A follow-up is skipped for anyone who replies, and still waits for a sending window.")
    out["lines"] = lines
    return out


async def schedule(db: AsyncSession, camp: EmailCampaign, steps: List[Dict[str, Any]]) -> Dict[str, Any]:
    from app.models.models import EmailMailbox
    from app.services.email_worker import local_now
    from app.services.org_settings import org_timezone

    tz = await org_timezone(db)
    ids = camp.mailbox_ids or []
    rows = (await db.execute(select(EmailMailbox).where(EmailMailbox.id.in_(ids)))).scalars().all() if ids else []
    boxes = [{"email": m.email, "status": m.status, "quota": (m.campaign_quota or m.daily_cap or 5)} for m in rows]
    waiting = (await db.execute(select(func.count(EmailEnrollment.id)).where(
        EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active", EmailEnrollment.waiting_on == "",
        EmailEnrollment.current_step == 1))).scalar() or 0
    return plan_schedule(days=camp.days_of_week or [1, 2, 3, 4, 5], start=camp.sending_window_start or "09:00", end=camp.sending_window_end or "17:00", tz=tz,
                         local=local_now(tz), boxes=boxes, min_delay_s=camp.min_delay_seconds or 60, daily_cap=camp.daily_cap or 0, waiting=waiting, steps=steps)


async def summary(db: AsyncSession, camp: EmailCampaign, org_id: str, *, full: bool = True) -> Dict[str, Any]:
    out = {"id": camp.id, "name": camp.name, "goal": camp.goal or "", "status": camp.status, "template_key": camp.template_key or "",
           "created_at": camp.created_at.isoformat() + "Z" if camp.created_at else None}
    out["results"] = await results(db, camp)
    out["tasks_open"] = (await db.execute(select(func.count(JourneyTask.id)).where(JourneyTask.campaign_id == camp.id, JourneyTask.status == "open"))).scalar() or 0
    out["step_count"] = (await db.execute(select(func.count(EmailSequenceStep.id)).where(EmailSequenceStep.campaign_id == camp.id))).scalar() or 0
    if not full:
        return out
    out["steps"] = [step_out(s) for s in await steps_of(db, camp.id)]
    out["settings"] = {"mailbox_ids": camp.mailbox_ids or [], "aliases": camp.alias_map or {}, "sending_window_start": camp.sending_window_start,
                       "sending_window_end": camp.sending_window_end, "days_of_week": camp.days_of_week or [], "min_delay_seconds": camp.min_delay_seconds,
                       "daily_cap": camp.daily_cap or 0, "rules": rules_of(camp), "one_at_a_time": bool(camp.one_at_a_time),
                       "approval_required": bool(camp.approval_required)}
    from app.models.models import EmailMailbox

    out["approval"] = {"reason": approval_reason(camp, (await db.execute(select(EmailMailbox))).scalars().all())}
    out["approvals"] = await list_approvals(db, camp.id, limit=50)
    out["audience"] = await audience(db, camp)
    out["preflight"] = await preflight(db, camp, org_id, aud=out["audience"])
    out["schedule"] = await schedule(db, camp, out["steps"])
    out["tasks"] = await list_tasks(db, campaign_id=camp.id, limit=20)
    shown_enrs = (await db.execute(select(EmailEnrollment).where(EmailEnrollment.campaign_id == camp.id).order_by(EmailEnrollment.created_at.desc()).limit(200))).scalars().all()
    accts, recs = await _eligibility_inputs(db, [{"lead_id": e.lead_id} for e in shown_enrs if e.lead_id])

    def on_hold(e: EmailEnrollment) -> bool:  # still waiting for the one-click choice, so its emails are held
        if e.status != "active":
            return False
        d = eligible_person(accts.get(e.lead_id) if e.lead_id else None, recs, {"company": e.company, "email": e.email})
        return bool(d["ok"] and not d["email"] and d["group"] == "quick_choice")

    def bad_address(e: EmailEnrollment) -> bool:  # an address that would bounce: it is never written to
        if e.status != "active":
            return False
        return eligible_person(accts.get(e.lead_id) if e.lead_id else None, recs, {"company": e.company, "email": e.email}).get("code") == "email_bad"

    out["people"] = [{"id": e.id, "email": e.email, "name": f"{e.first_name} {e.last_name}".strip(), "company": e.company, "status": e.status, "step": e.current_step,
                      "finish_reason": e.finish_reason or "", "waiting": e.waiting_on or "", "next_at": e.next_action_at.isoformat() + "Z" if e.next_action_at else None,
                      "on_hold": on_hold(e), "bad_address": bad_address(e), "lead_id": e.lead_id or "", "timeline": ((e.vars or {}).get("timeline") or [])[-5:]}
                     for e in shown_enrs]
    return out


async def list_journeys(db: AsyncSession, org_id: str) -> List[Dict[str, Any]]:
    camps = (await db.execute(select(EmailCampaign).order_by(EmailCampaign.created_at.desc()))).scalars().all()
    return [await summary(db, c, org_id, full=False) for c in camps]


# ── Starting, pausing, stopping ─────────────────────────────────────────────
async def set_status(db: AsyncSession, camp: EmailCampaign, status: str, org_id: str) -> None:
    if status == "running":
        reds = [o["text"] for o in await preflight(db, camp, org_id) if o["level"] == "red"]
        if reds:
            raise JourneyError(reds[0])
        camp.status = "running"
        now = datetime.utcnow()
        for e in (await db.execute(select(EmailEnrollment).where(
                EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active", EmailEnrollment.next_action_at.is_(None),
                EmailEnrollment.waiting_on == ""))).scalars().all():
            e.next_action_at = now
        try:
            from app.public_api.email import note_started_in_app

            note_started_in_app(camp.id)
        except Exception:
            pass
    elif status == "paused":
        camp.status = "paused"
    elif status == "stopped":
        camp.status = "completed"
        for e in (await db.execute(select(EmailEnrollment).where(EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active"))).scalars().all():
            await exit_enrollment(db, e, "stopped", status="finished")
    else:
        raise JourneyError("Say running, paused or stopped.")


async def clone(db: AsyncSession, camp: EmailCampaign, name: str = "") -> EmailCampaign:
    """A copy with the same steps and settings, no people, as a draft. Step keys are new so the two journeys never share them."""
    new = EmailCampaign(id=f"cp_{uuid.uuid4().hex[:12]}", name=(name or f"{camp.name} (copy)")[:120], status="draft", mailbox_ids=list(camp.mailbox_ids or []),
                        alias_map=dict(camp.alias_map or {}), timezone_policy=camp.timezone_policy, sending_window_start=camp.sending_window_start,
                        sending_window_end=camp.sending_window_end, days_of_week=list(camp.days_of_week or []), min_delay_seconds=camp.min_delay_seconds,
                        max_delay_seconds=camp.max_delay_seconds, goal=camp.goal or "", daily_cap=camp.daily_cap or 0, exit_rules=dict(camp.exit_rules or {}),
                        owner_id=camp.owner_id or "", tags=list(camp.tags or []), one_at_a_time=camp.one_at_a_time, template_key=camp.template_key or "",
                        approval_required=bool(camp.approval_required))
    db.add(new)
    await db.flush()
    steps = []
    for s in await steps_of(db, camp.id):
        d = step_out(s)
        d.pop("key", None)
        steps.append(d)
    await save_steps(db, new, clean_steps(steps))
    return new


APPROVAL_DEFAULT_FROM = datetime(2026, 11, 11)


async def _approval_default(db: AsyncSession, prof: Any) -> bool:
    """Whether a new journey asks for approval when nothing was said: the company's own setting, else on for organisations made from the
    day the approval step shipped (older ones keep sending straight away)."""
    if prof is not None:
        return bool(getattr(prof, "send_approval", False))
    from app.core.tenancy import current_org
    from app.models.models import Organization

    org = await db.get(Organization, current_org())
    made = getattr(org, "created_at", None)
    return bool(made and made >= APPROVAL_DEFAULT_FROM)


async def create(db: AsyncSession, *, name: str, goal: str = "", steps: List[Dict[str, Any]], mailbox_ids: Optional[List[str]] = None,
                 settings: Optional[Dict[str, Any]] = None, template_key: str = "", owner_id: str = "") -> EmailCampaign:
    """A new draft journey. Mailboxes default to every account that can send."""
    from app.models.models import EmailMailbox

    s = settings or {}
    clean = clean_steps(steps)
    if not (name or "").strip():
        raise JourneyError("Give the journey a name.")
    have = set((await db.execute(select(EmailMailbox.id))).scalars().all())
    from app.models.models import CompanyProfile

    prof = (await db.execute(select(CompanyProfile).limit(1))).scalars().first()
    if mailbox_ids is None:
        boxes = (await db.execute(select(EmailMailbox))).scalars().all()
        mailbox_ids = [m.id for m in boxes if m.status in ("warming", "active", "graduated")]
    camp = EmailCampaign(id=f"cp_{uuid.uuid4().hex[:12]}", name=name.strip()[:120], status="draft", mailbox_ids=[m for m in dict.fromkeys(mailbox_ids) if m in have],
                         timezone_policy="org", sending_window_start=s.get("sending_window_start") or "09:00", sending_window_end=s.get("sending_window_end") or "17:00",
                         days_of_week=sorted(set(s.get("days_of_week") or [1, 2, 3, 4, 5])), min_delay_seconds=max(30, int(s.get("min_delay_seconds") or 120)),
                         max_delay_seconds=max(30, int(s.get("min_delay_seconds") or 120)), goal=(goal or "").strip()[:600], daily_cap=_int(s.get("daily_cap"), 0, 5000),
                         exit_rules=s.get("rules") or None, owner_id=owner_id, one_at_a_time=bool(s.get("one_at_a_time", True)), template_key=template_key,
                         approval_required=bool(s["approval_required"]) if "approval_required" in s else await _approval_default(db, prof))
    db.add(camp)
    await db.flush()
    await save_steps(db, camp, clean)
    return camp


_HM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


async def update_settings(db: AsyncSession, camp: EmailCampaign, s: Dict[str, Any]) -> None:
    from app.models.models import EmailMailbox

    if "name" in s and str(s["name"]).strip():
        camp.name = str(s["name"]).strip()[:120]
    if "goal" in s:
        camp.goal = str(s["goal"] or "").strip()[:600]
    start, end = s.get("sending_window_start", camp.sending_window_start), s.get("sending_window_end", camp.sending_window_end)
    if not (_HM.match(start or "") and _HM.match(end or "")) or start >= end:
        raise JourneyError("Sending hours must be like 09:00 to 17:00.")
    camp.sending_window_start, camp.sending_window_end = start, end
    if "days_of_week" in s:
        days = sorted({d for d in s["days_of_week"] if d in range(1, 8)})
        if not days:
            raise JourneyError("Pick at least one sending day.")
        camp.days_of_week = days
    if "mailbox_ids" in s:
        have = set((await db.execute(select(EmailMailbox.id))).scalars().all())
        camp.mailbox_ids = [m for m in dict.fromkeys(s["mailbox_ids"]) if m in have]
        camp.alias_map = {k: v for k, v in (camp.alias_map or {}).items() if k in camp.mailbox_ids}
    if "daily_cap" in s:
        camp.daily_cap = _int(s["daily_cap"], 0, 5000)
    if "one_at_a_time" in s:
        camp.one_at_a_time = bool(s["one_at_a_time"])
    if "approval_required" in s:
        was, camp.approval_required = bool(camp.approval_required), bool(s["approval_required"])
        if was and not camp.approval_required:
            await release_parked(db, camp)
    if "rules" in s:
        merged = {**(camp.exit_rules or {}), **{k: v for k, v in (s["rules"] or {}).items() if k in DEFAULT_RULES}}
        camp.exit_rules = merged
    if "min_delay_seconds" in s:
        camp.min_delay_seconds = camp.max_delay_seconds = max(30, _int(s["min_delay_seconds"], 30, 3600, 120))


# ── Ready-made journeys ─────────────────────────────────────────────────────
def _e(subject: str, body: str, days: int = 0, **extra: Any) -> Dict[str, Any]:
    return {"channel": "email", "subject": subject, "body": body, "delay_days": days, **extra}


TEMPLATES: List[Dict[str, Any]] = [
    {"key": "intro_follow_up", "name": "Introduce and follow up", "goal": "Start a conversation with a new contact.", "best_for": "Any list of companies you have not contacted before.",
     "steps": [_e("Quick idea for {{company}}", "Hi {{first_name}},\n\nI help businesses like {{company}} with [what you do]. Is that something worth a quick chat?\n\nThanks"),
               _e("", "Hi {{first_name}}, one more thought: [a useful angle in one line]. Worth a short call?", 3),
               _e("", "Hi {{first_name}}, I'll leave it there. If the timing changes, just reply and I'll pick it up.", 4)]},
    {"key": "email_then_call", "name": "Email, then call", "goal": "Reach a decision maker by email first, then by phone if they have not replied.", "best_for": "Companies with a phone number on file.",
     "steps": [_e("Question about {{company}}", "Hi {{first_name}},\n\nI wanted to ask how {{company}} handles [the problem you solve]. A short reply is plenty.\n\nThanks"),
               {"channel": "call", "delay_days": 2, "condition": "no_reply", "goal": "Ask the one question from the email and offer a short follow-up.", "voicemail": "leave_message", "retries": 1},
               _e("", "Hi {{first_name}}, I tried you by phone as well. Would a quick chat this week suit you?", 2)]},
    {"key": "new_company", "name": "Newly registered company", "goal": "Welcome a company that has just been set up.", "best_for": "Companies registered in the last few months. Find them under Find Leads.",
     "steps": [_e("Congratulations on setting up {{company}}", "Hi {{first_name}},\n\nCongratulations on getting {{company}} started. Many new businesses need [what you offer] early on. Can I send you a short overview?\n\nThanks"),
               _e("", "Hi {{first_name}}, just checking you saw my note. Happy to keep it to a few lines if that's easier.", 4),
               {"channel": "call_task", "delay_days": 3, "title": "Call {{company}}", "notes": "A friendly welcome call. Ask how the set-up is going and offer help."}]},
    {"key": "accounts_due", "name": "Accounts coming due", "goal": "Offer help to a company whose accounts are due soon.", "best_for": "Companies whose year-end accounts are due soon.",
     "steps": [_e("Year-end support for {{company}}", "Hi {{first_name}},\n\nI work with companies at year-end on [what you offer]. If it's useful, I can send a short checklist.\n\nThanks"),
               _e("", "Hi {{first_name}}, a quick follow-up on year-end. Would the checklist help?", 5)]},
    {"key": "new_director", "name": "New director appointed", "goal": "Reach a company where the leadership has just changed.", "best_for": "Companies with a recent director change.",
     "steps": [_e("A note for the new leadership at {{company}}", "Hi {{first_name}},\n\nCongratulations on the new role. Newly appointed leaders often look at [the area you help with] in the first months. Would a short intro be useful?\n\nThanks"),
               {"channel": "call", "delay_days": 3, "condition": "no_reply", "goal": "Congratulate them and ask if a short intro would be useful.", "voicemail": "hang_up"},
               _e("", "Hi {{first_name}}, I'll keep this short: happy to share how others in your position approach this.", 3)]},
    {"key": "accountants", "name": "Accountancy practices", "goal": "Offer a useful service to accountancy firms.", "best_for": "Accountants and bookkeepers found on the register.",
     "steps": [_e("A question for {{company}}", "Hi {{first_name}},\n\n{{source_line}} I help practices like yours with [what you offer]. Would a short overview be useful?\n\nThanks"),
               _e("", "Hi {{first_name}}, one more thought for {{company}}: [a useful angle in one line]. Worth a short call?", 4),
               {"channel": "call_task", "delay_days": 3, "title": "Call {{company}}", "notes": "Ask who looks after [the area you help with] and offer a short overview."}]},
    {"key": "ltd_companies", "name": "Limited companies", "goal": "Start a conversation with small limited companies.", "best_for": "Small limited companies found on the register.",
     "steps": [_e("Quick question for {{company}}", "Hi {{first_name}},\n\n{{source_line}} I help small companies with [what you offer]. Is that something worth a quick chat?\n\nThanks"),
               _e("", "Hi {{first_name}}, a short follow-up. If [the problem you solve] is on your list, I can send a one-page summary.", 4),
               {"channel": "call_task", "delay_days": 3, "title": "Call {{company}}", "notes": "Ask the one question from the first email. Keep it under two minutes."}]},
    {"key": "landlords", "name": "Property landlords", "goal": "Reach landlords and property companies.", "best_for": "Property letting and holding companies found on the register.",
     "steps": [_e("Rental property at {{company}}", "Hi {{first_name}},\n\n{{source_line}} I help landlords with [what you offer]. Can I send a short note on how it works?\n\nThanks"),
               _e("", "Hi {{first_name}}, checking you saw my note. Happy to keep it to a few lines.", 4),
               {"channel": "call_task", "delay_days": 3, "title": "Call {{company}}", "notes": "Ask how many properties they manage and whether [your service] would help."}]},
    {"key": "win_back", "name": "Win back", "goal": "Reopen a conversation that went quiet.", "best_for": "People you spoke to before who stopped replying.",
     "steps": [_e("Still relevant for {{company}}?", "Hi {{first_name}},\n\nWe spoke a while ago about [topic]. Is it still on your list, or has it moved on?\n\nThanks"),
               _e("", "Hi {{first_name}}, last note from me. If it's not a priority I'll close this off.", 5),
               {"channel": "social_task", "delay_days": 2, "title": "Look at {{company}}'s latest post", "notes": "Like or comment on a recent post if there is something genuine to say."}]},
    {"key": "rebook_no_show", "name": "Re-book a missed meeting", "goal": "Get a rescheduled meeting after a no-show.", "best_for": "People who booked a meeting and did not attend.",
     "steps": [_e("Sorry we missed each other", "Hi {{first_name}},\n\nWe missed each other earlier. Here is my booking link to pick a new time: {{booking_link}}\n\nThanks"),
               {"channel": "call", "delay_days": 1, "condition": "no_reply", "goal": "Offer a new time for the missed meeting.", "voicemail": "leave_message", "retries": 1},
               _e("", "Hi {{first_name}}, if now isn't a good time, tell me and I'll check back later.", 3)]},
    {"key": "call_first", "name": "Call first", "goal": "Start with a phone call, then back it up by email.", "best_for": "Companies where a phone call is the natural way in.",
     "steps": [{"channel": "call_task", "title": "Call {{company}}", "notes": "Introduce yourself in one sentence and ask the one question you want answered."},
               _e("Following our call, {{company}}", "Hi {{first_name}},\n\nThanks for taking my call (or sorry I missed you). A short summary: [one line]. Happy to answer anything.\n\nThanks", 1),
               {"channel": "call_task", "delay_days": 3, "title": "Second call to {{company}}", "notes": "Only if they have not replied."}]},
    {"key": "event_invite", "name": "Event invitation", "goal": "Fill a place at an event.", "best_for": "Any list you want to invite to an event, open day or webinar.",
     "steps": [_e("You're invited, {{first_name}}", "Hi {{first_name}},\n\nWe're holding [event] on [date]. It's free, and I think {{company}} would find it useful. Reply if you'd like a place.\n\nThanks"),
               _e("", "Hi {{first_name}}, places are going. Shall I hold one for you?", 4),
               _e("", "Hi {{first_name}}, a final reminder about [event] on [date].", 3)]},
]


def templates() -> List[Dict[str, Any]]:
    return [{"key": t["key"], "name": t["name"], "goal": t["goal"], "best_for": t["best_for"],
             "channels": sorted({("call" if s["channel"] == "call" else s["channel"]) for s in t["steps"]}), "steps": len(t["steps"])} for t in TEMPLATES]


async def from_template(db: AsyncSession, key: str, *, name: str = "", owner_id: str = "") -> EmailCampaign:
    t = next((x for x in TEMPLATES if x["key"] == key), None)
    if not t:
        raise JourneyError("We don't have a ready-made journey called that.")
    return await create(db, name=name or t["name"], goal=t["goal"], steps=[dict(s) for s in t["steps"]], template_key=key, owner_id=owner_id)


# ── Drafting with the AI ────────────────────────────────────────────────────
async def ai_draft(db: AsyncSession, ctx: Dict[str, Any], *, goal: str, audience: str = "", channels: Optional[List[str]] = None, count: int = 3,
                   name: str = "", owner_id: str = "") -> EmailCampaign:
    """A draft journey written from the About your business profile and the goal. Facts are limited to the profile; nothing is invented.
    Channels may include "call" and "task": a call step (if no reply) and a manual task are added between the emails."""
    from app.api import email_outreach as EO
    from app.services import email_writer as W

    goal = (goal or "").strip()
    if not goal:
        raise JourneyError("Say what the journey is for, in one sentence.")
    profile = await EO._profile(db, ctx, need=False)
    await W.spend_allowance(db, ctx["org_id"])  # writing is free but limited each day, the same as the email writer
    drafted = await W.draft_sequence(db, profile, audience or "A list of UK businesses.", count=max(1, min(5, count)), goal=goal)
    steps: List[Dict[str, Any]] = []
    channels = channels or []
    for i, d in enumerate(drafted):
        steps.append({"channel": "email", "subject": d["subject"], "body": d["body"], "delay_days": 0 if i == 0 else d["delay_days"]})
        if i == 0 and "call" in channels:
            steps.append({"channel": "call", "delay_days": 2, "condition": "no_reply", "goal": goal, "voicemail": "leave_message", "retries": 1})
        if i == 0 and "task" in channels:
            steps.append({"channel": "task", "delay_days": 1, "title": "Look at their website before the follow-up", "notes": "Note one specific thing to mention."})
    return await create(db, name=name or goal[:60], goal=goal, steps=steps, owner_id=owner_id)


def suggestions_from(res: Dict[str, Any], steps: List[Dict[str, Any]]) -> List[str]:
    """Plain, rule-based advice from a journey's own numbers. Nothing here needs the AI, so it works when the AI is unavailable."""
    out: List[str] = []
    if res["sent"] >= 50 and res["reply_rate"] < 2:
        out.append("Fewer than 2 in 100 emails got a reply. Try a shorter first email with one clear question, and a subject that names their company.")
    if res["bounce_rate"] >= 4:
        out.append(f"{res['bounce_rate']}% of emails bounced. Check the addresses in your list before sending more, so your sender reputation stays safe.")
    if res["sent"] >= 50 and res["opened"] / max(res["sent"], 1) < 0.2:
        out.append("Few emails were opened. The subject line may be the problem: try asking a question or naming their business.")
    if res["people"] and res["by_status"].get("unresponsive", 0) / res["people"] > 0.5:
        out.append("Over half of the people never answered. Consider adding a call step after the first email, or a different angle in the follow-up.")
    if not any(s["channel"] == "call" for s in steps) and res["sent"] >= 30:
        out.append("There is no call step. A short call two days after the first email often lifts replies.")
    v = res.get("variants") or {}
    if "a" in v and "b" in v and v["a"]["sent"] >= 30 and v["b"]["sent"] >= 30 and abs(v["a"]["reply_rate"] - v["b"]["reply_rate"]) >= 2:
        best = "a" if v["a"]["reply_rate"] > v["b"]["reply_rate"] else "b"
        out.append(f"Version {best.upper()} is getting more replies ({v[best]['reply_rate']}%). Make it the only version.")
    return out or ["Nothing stands out yet. Give it more sends before changing anything."]


# ── Changing a journey from words (the chat) or from the screen ─────────────
SETTING_NAMES = ("name", "goal", "daily_cap", "sending_window_start", "sending_window_end", "days_of_week", "one_at_a_time", "unresponsive_days", "on_not_interested")
STEP_FIELDS = ("channel", "subject", "body", "title", "notes", "goal", "condition", "voicemail", "retries", "retry_gap_hours", "subject_b", "body_b")


def changed_steps(current: List[Dict[str, Any]], changes: List[Dict[str, Any]]) -> tuple:
    """(steps, settings) after a list of changes, without writing anything, so they can be checked or shown first. A change is one of
    add_step (after, channel, ...), remove_step (step), set_step (step, fields), set_wait (step, wait_days, wait_hours) or set_setting (setting, value).
    Steps are counted from 1. Existing steps keep their keys."""
    steps = [dict(s) for s in current]
    settings: Dict[str, Any] = {}

    def at(n: Any) -> int:
        try:
            i = int(n)
        except (TypeError, ValueError):
            raise JourneyError("Say which step, as a number.")
        if not 1 <= i <= len(steps):
            raise JourneyError(f"There is no step {i}. This journey has {len(steps)}.")
        return i - 1

    for c in changes or []:
        op = str(c.get("op") or "")
        if op == "add_step":
            pos = len(steps) if c.get("after") in (None, "") else max(0, min(int(c.get("after") or 0), len(steps)))
            new = {k: c[k] for k in STEP_FIELDS if k in c}
            new.setdefault("channel", "email")
            new["delay_days"], new["delay_hours"] = int(c.get("wait_days") or 0), int(c.get("wait_hours") or 0)
            if new["channel"] in ("email", "call") and pos > 0 and not (new["delay_days"] or new["delay_hours"]):
                new["delay_days"] = 2  # an email or call straight after another needs a wait: two days unless they said
            steps.insert(pos, new)
        elif op == "remove_step":
            steps.pop(at(c.get("step")))
        elif op == "set_step":
            i = at(c.get("step"))
            for k in STEP_FIELDS:
                if k in c:
                    steps[i][k] = c[k]
        elif op == "set_wait":
            i = at(c.get("step"))
            steps[i]["delay_days"], steps[i]["delay_hours"] = int(c.get("wait_days") or 0), int(c.get("wait_hours") or 0)
        elif op == "set_setting":
            name = str(c.get("setting") or "")
            if name not in SETTING_NAMES:
                raise JourneyError(f"I can't change '{name}'. I can change: {', '.join(SETTING_NAMES)}.")
            settings[name] = c.get("value")
        else:
            raise JourneyError(f"I don't know the change '{op}'.")
    return steps, settings


async def apply_changes(db: AsyncSession, camp: EmailCampaign, changes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Applies a list of changes (see changed_steps): the steps first, then the settings. People part-way through keep their place."""
    steps, settings = changed_steps([step_out(s) for s in await steps_of(db, camp.id)], changes)
    clean = clean_steps(steps)
    rules = {k: settings.pop(k) for k in ("unresponsive_days", "on_not_interested") if k in settings}
    if rules:
        settings["rules"] = rules
    await save_steps(db, camp, clean)
    if settings:
        await update_settings(db, camp, settings)
    return {"steps": len(clean), "settings": sorted(settings)}


def describe_steps(steps: List[Dict[str, Any]]) -> str:
    """The steps in one plain line each, for the chat to read back."""
    out = []
    for i, s in enumerate(steps, 1):
        wait = f"after {s['delay_days']} day{'s' if s['delay_days'] != 1 else ''}" if s.get("delay_days") else ("after a few hours" if s.get("delay_hours") else "first")
        what = {"email": f"email \"{s.get('subject') or '(reply in the same thread)'}\"", "call": f"call ({s.get('goal') or 'no goal set'})",
                "manual_email": f"write an email by hand: {s.get('title')}"}.get(s["channel"], f"{TASK_KINDS.get(s['channel'], 'task').lower()}: {s.get('title')}")
        out.append(f"{i}. {wait}: {what}")
    return "; ".join(out)
