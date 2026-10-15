"""What happens in one plugin when something happens in another.

Called from the places where a call ends, a meeting is booked, a campaign gets a reply or a post
draws engagement. Every function here is safe to run twice, never raises into the caller, and
checks the organisation's plan and its Settings -> Connections switches before it acts.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import (
    CallLog,
    EmailEnrollment,
    EmailMailbox,
    LeadAccount,
    LiveCall,
    Meeting,
    Notification,
    NumberCheck,
    Prospect,
)
from app.services import connections as C

logger = logging.getLogger("connection_handlers")

SENDING = ("warming", "graduated", "active")


def _first_name(lead: LeadAccount) -> str:
    name = (lead.contact_name or "").strip()
    return name.split()[0] if name else ""


def fill(template: str, lead: LeadAccount) -> str:
    """{{first_name}} and {{company}} in a template, the way the campaign writer fills them."""
    values = {"firstname": _first_name(lead), "company": lead.name or "", "email": lead.email or ""}

    def sub(m: "re.Match[str]") -> str:
        return values.get(re.sub(r"[^a-z]", "", m.group(1).lower()), "")
    out = re.sub(r"\{\{\s*([A-Za-z_]+)\s*\}\}", sub, template or "")
    return re.sub(r"[ \t]+([,.!?])", r"\1", out)


async def entitled(db: AsyncSession, org_id: str) -> Dict[str, bool]:
    from app.services.entitlement import get_org_entitlements

    return await get_org_entitlements(db, org_id)


def _notify(db: AsyncSession, text: str, kind: str = "info") -> None:
    db.add(Notification(id=f"n_{uuid.uuid4().hex[:8]}", text=text[:300], type=kind, time="Just now"))


# ── Sending one email to a lead from the organisation's own mailbox ─────────
async def send_lead_email(db: AsyncSession, org_id: str, lead: LeadAccount, subject: str, body: str,
                          reason: str) -> Dict[str, Any]:
    """One plain email to a lead. Refuses when the lead opted out, has no address, or no mailbox is ready."""
    if not lead.email:
        return {"status": "skipped", "why": "no email"}
    if await C.block_for(db, email=lead.email, registry_id=lead.registry_id or "", channel="email"):
        return {"status": "skipped", "why": "do not contact"}
    boxes = (await db.execute(select(EmailMailbox))).scalars().all()
    mb = next((m for m in boxes if m.status in SENDING), None)
    if mb is None:
        return {"status": "skipped", "why": "no mailbox ready"}
    from app.services.email_dispatcher import send_cold_email
    from app.services.enrichment_waterfall import classify_pecr_entity

    res = await send_cold_email(db, org_id, mb, lead.email, subject, body,
                                entity_type=classify_pecr_entity(lead.name, lead.email))
    if res.get("status") == "sent":
        await C.record_event(db, "email", lead_id=lead.id, registry_id=lead.registry_id or "",
                             ref_id=res.get("message_id", "") or uuid.uuid4().hex[:12], summary=f"Email sent: {subject}"[:200],
                             detail={"reason": reason, "subject": subject})
        lead.last_contact_at = datetime.utcnow()
    return res


# ── A call step inside an email campaign ────────────────────────────────────
async def run_call_step(db: AsyncSession, org_id: str, enr: EmailEnrollment, step: Any, now: datetime):
    """Ring the lead behind an enrolment. Returns (outcome, why) where outcome is "called", "skipped" or "deferred"
    (outside calling hours). Skipping never stops the sequence: the next step still runs."""
    from sqlalchemy import func

    from app.models.models import EmailMessage
    from app.services import lead_calls as LC

    try:
        ent = await entitled(db, org_id)
        if not (ent.get("voice") and ent.get("leads")):
            return "skipped", "needs the Voice plan"
        lead = await C.lead_for(db, lead_id=enr.lead_id or "", email=enr.email)
        if lead is None:
            return "skipped", "not a saved company"
        cond = getattr(step, "condition", "always") or "always"
        if cond == "opened_no_reply":
            opened = (await db.execute(select(func.count(EmailMessage.id)).where(
                EmailMessage.enrollment_id == enr.id, EmailMessage.open_count > 0))).scalar() or 0
            if not opened:
                await C.record_event(db, "note", lead_id=lead.id, ref_id=f"callskip:{enr.id}:{step.id}", summary="Planned call skipped: the email was not opened")
                return "skipped", "not opened"
        if lead.stage in ("meeting", "won", "lost", "do_not_contact"):
            return "skipped", f"already {lead.stage.replace('_', ' ')}"
        plan = await LC.plan_calls(db, [lead], override_recontact=True)
        if lead.id in plan["skipped"]["outside_hours"]:
            return "deferred", "outside calling hours"
        if not plan["callable"]:
            why = next((LC.SKIP_WORDS[k] for k, v in plan["skipped"].items() if v), "cannot be called")
            await C.record_event(db, "note", lead_id=lead.id, ref_id=f"callskip:{enr.id}:{step.id}", summary=f"Planned call skipped: {why}")
            return "skipped", why
        await LC.start_calls(db, [lead], title=f"Campaign call: {lead.name}", concurrency=1)
        return "called", ""
    except Exception as err:
        logger.warning(f"[connections] call step for {getattr(enr, 'id', '?')} failed: {err}")
        return "skipped", str(err)[:120]


# ── A call has ended ────────────────────────────────────────────────────────
async def on_call_finished(db: AsyncSession, call: LiveCall, log: CallLog, prospect: Optional[Prospect],
                           final_outcome: str, transcript: List[Dict[str, Any]]) -> None:
    """Write the result back to the lead: stage, last call, timeline, suggestions, wrong numbers,
    do-not-call, callbacks and the optional follow-up emails. Never raises."""
    try:
        async with db.begin_nested():
            await _call_finished(db, call, log, prospect, final_outcome, transcript)
    except Exception as err:
        logger.warning(f"[connections] call result for {getattr(call, 'id', '?')} not written to the lead: {err}")


async def _call_finished(db: AsyncSession, call: LiveCall, log: CallLog, prospect: Optional[Prospect],
                         final_outcome: str, transcript: List[Dict[str, Any]]) -> None:
    from app.core.tenancy import current_org

    phone = prospect.phone if prospect else ""
    lead = await C.lead_for(db, lead_id=getattr(call, "lead_id", None) or (prospect.lead_id if prospect else "") or "",
                            phone=phone, registry_id=log.registry_id or "")
    sig = C.detect_signals(transcript)
    from app.models.models import CallBrief

    brief = await db.get(CallBrief, call.id)  # what the assistant itself reported at the end
    if brief is not None:
        if brief.outcome in ("wrong_number", "do_not_call"):
            sig[brief.outcome] = True
        elif brief.outcome == "interested" and final_outcome in ("contacted", "operator_ended"):
            final_outcome = "interested"
        for k, v in (brief.captured or {}).items():  # fields it captured, in its own words
            key = {"email": "email", "contact_name": "contact_name", "name": "contact_name", "best_time": "best_time",
                   "best_time_to_call": "best_time"}.get(str(k).lower().replace(" ", "_"))
            if key and v and not sig.get(key):
                sig[key] = str(v)
    outcome = C.effective_outcome(final_outcome, sig)
    word = C.OUTCOME_WORD.get(outcome, outcome.replace("_", " ").capitalize())
    now = datetime.utcnow()

    if lead is None:
        await C.record_event(db, "call", registry_id=log.registry_id or "", ref_id=log.id, summary=word,
                             detail={"call_id": call.id, "outcome": outcome, "mission": call.mission})
        if outcome == "do_not_call" and phone:
            await C.add_block(db, phone=phone, name=getattr(prospect, "name", "") if prospect else "", reason="Asked on a call", source="call")
        return

    log.lead_id = lead.id
    call.lead_id = lead.id
    if not log.registry_id and lead.registry_id:
        log.registry_id = lead.registry_id
    rules = await C.get_rules(db)
    org = current_org()

    if rules["update_lead_after_call"] and outcome not in ("failed", "canceled"):
        lead.last_call_outcome = outcome
        lead.last_called_at = now
        lead.last_contact_at = now
        lead.stage = C.stage_for_outcome(lead.stage or "new", outcome)
    await C.record_event(db, "call", lead_id=lead.id, registry_id=lead.registry_id or "", ref_id=log.id, summary=word,
                         detail={"call_id": call.id, "log_id": log.id, "outcome": outcome, "duration": log.duration,
                                 "mission": call.mission, "booked": bool(call.booked), "notes": (getattr(brief, "notes", "") or "")[:500]})

    if outcome == "wrong_number" and (lead.phone or phone):
        await mark_wrong_number(db, lead, lead.phone or phone)
    if outcome == "do_not_call":
        await C.add_block(db, phone=lead.phone or phone, email=lead.email or "", registry_id=lead.registry_id or "",
                          name=lead.name, reason="Asked on a call", source="call")
        lead.stage = "do_not_contact"
        _notify(db, f"{lead.name} asked not to be contacted. They are on your do-not-contact list.", "warning")
    if outcome == "callback_requested":
        await schedule_callback(db, lead, log)

    await add_suggestions(db, lead, sig, call.id, auto=rules["auto_apply_suggestions"])

    # Optional follow-ups. Each needs the Leads plan (the email is paid from its wallet).
    ent = await entitled(db, org)
    if not ent.get("leads") or outcome in ("do_not_call", "wrong_number"):
        return
    if outcome in ("callback_requested", "interested") and rules["interested_email"] and rules["interested_template"].strip():
        await send_lead_email(db, org, lead, "Following up on our call", fill(rules["interested_template"], lead), "interested")
    elif outcome == "no_answer" and rules["no_answer_email"]:
        misses = await count_no_answers(db, lead.id)
        if misses >= max(1, int(rules["no_answer_after"])) and not await already_sent(db, lead.id, "missed_you"):
            body = f"Hi {_first_name(lead) or 'there'},\n\nSorry I missed you. I tried to ring about {lead.name}. " \
                   "Reply here with a good time and we will call you back.\n\nThanks"
            res = await send_lead_email(db, org, lead, "Sorry I missed you", body, "missed_you")
            if res.get("status") == "sent":
                await C.record_event(db, "note", lead_id=lead.id, ref_id="missed_you", summary="Missed-you email sent")


async def count_no_answers(db: AsyncSession, lead_id: str) -> int:
    from app.models.models import ContactEvent

    rows = (await db.execute(select(ContactEvent.ref_id).where(
        ContactEvent.lead_id == lead_id, ContactEvent.kind == "call", ContactEvent.summary == C.OUTCOME_WORD["no_answer"]))).scalars().all()
    return len(set(rows))


async def already_sent(db: AsyncSession, lead_id: str, marker: str) -> bool:
    from app.models.models import ContactEvent

    return (await db.execute(select(ContactEvent.id).where(
        ContactEvent.lead_id == lead_id, ContactEvent.ref_id == marker).limit(1))).first() is not None


async def mark_wrong_number(db: AsyncSession, lead: LeadAccount, phone: str) -> None:
    """The number is wrong: the lead's phone check says so, and the number-check cache remembers it for 30 days,
    so nobody pays to call or check it again."""
    from app.services.timezone_service import normalize_phone

    e164 = normalize_phone(phone)
    if e164:
        row = (await db.execute(select(NumberCheck).where(NumberCheck.phone == e164).limit(1))).scalars().first()
        if row:
            row.status, row.checked_at = "not_working", datetime.utcnow()
        else:
            db.add(NumberCheck(id=f"nc_{uuid.uuid4().hex[:12]}", phone=e164, status="not_working", checked_at=datetime.utcnow()))
    ver = dict(lead.verification or {})
    ver["phone"] = {"state": "invalid", "verified": False, "note": "Reported as a wrong number on a call"}
    lead.verification = ver
    lead.last_call_outcome = "wrong_number"


async def next_free_slot(db: AsyncSession) -> Optional[datetime]:
    """The next time that is free in the owner's calendar, from tomorrow on, as a naive UTC moment. So a call back
    never lands on top of a meeting."""
    try:
        from datetime import timezone

        from app.services.calendar_service import calendar_service
        from app.services.org_settings import org_timezone
        from app.services.timezone_service import combine_local, now_in

        tz = await org_timezone(db)
        start = now_in(tz) + timedelta(days=1)
        for day in await calendar_service.get_week_availability(db, start, days=3):
            for slot in day.get("open") or []:
                moment = combine_local(day["date"], slot.get("hostTime") or slot["time"], tz)
                return moment.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception as err:
        logger.debug(f"[connections] no free slot found for the call back: {err}")
    return None


async def schedule_callback(db: AsyncSession, lead: LeadAccount, log: CallLog) -> None:
    follow = log.requested_follow_up or {}
    when = (parse_follow_up(follow.get("day"), follow.get("time")) or await next_free_slot(db)
            or (datetime.utcnow() + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0))
    lead.next_action = "Call back"
    lead.next_action_at = when
    await C.record_event(db, "note", lead_id=lead.id, ref_id=f"cb:{log.id}", summary=f"Callback planned for {when:%a %d %b %H:%M}")
    _notify(db, f"Call {lead.name} back on {when:%a %d %b at %H:%M}.", "info")


def parse_follow_up(day: Any, time_val: Any) -> Optional[datetime]:
    """'Thursday' + '15:00' (or '3pm') -> the next such moment, else None."""
    if not day:
        return None
    names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    text = str(day).strip().lower()
    today = datetime.utcnow()
    base: Optional[datetime] = None
    if text in ("today",):
        base = today
    elif text == "tomorrow":
        base = today + timedelta(days=1)
    else:
        for i, n in enumerate(names):
            if text.startswith(n[:3]):
                base = today + timedelta(days=((i - today.weekday()) % 7) or 7)
                break
    if base is None:
        return None
    hour, minute = 10, 0
    m = re.search(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", str(time_val or ""), re.I)
    if m:
        hour, minute = int(m.group(1)), int(m.group(2) or 0)
        if m.group(3) and m.group(3).lower() == "pm" and hour < 12:
            hour += 12
        if m.group(3) and m.group(3).lower() == "am" and hour == 12:
            hour = 0
    return base.replace(hour=min(hour, 23), minute=min(minute, 59), second=0, microsecond=0)


# ── Suggested updates to a lead ─────────────────────────────────────────────
SUGGEST_FIELDS = {"email": "Email", "contact_name": "Contact", "best_time": "Best time to call"}


async def add_suggestions(db: AsyncSession, lead: LeadAccount, sig: Dict[str, Any], call_id: str, auto: bool = False) -> int:
    """Facts the other person gave on the call, offered to the user (or applied when they switched that on)."""
    pending = list(lead.suggestions or [])
    added = 0
    for field in SUGGEST_FIELDS:
        value = str(sig.get(field) or "").strip()
        if not value or str(getattr(lead, field, "") or "").strip().lower() == value.lower():
            continue
        if any(s.get("field") == field and str(s.get("value", "")).lower() == value.lower() for s in pending):
            continue
        if auto:
            setattr(lead, field, value)
            await C.record_event(db, "note", lead_id=lead.id, ref_id=f"upd:{call_id}:{field}", summary=f"{SUGGEST_FIELDS[field]} updated to {value}")
            continue
        pending.append({"id": f"sg_{uuid.uuid4().hex[:8]}", "field": field, "value": value, "from": "call", "call_id": call_id,
                        "at": datetime.utcnow().isoformat() + "Z"})
        added += 1
    lead.suggestions = pending or None
    return added


async def resolve_suggestion(db: AsyncSession, lead: LeadAccount, suggestion_id: str, accept: bool) -> bool:
    pending = list(lead.suggestions or [])
    hit = next((s for s in pending if s.get("id") == suggestion_id), None)
    if not hit:
        return False
    if accept and hit["field"] in SUGGEST_FIELDS:
        setattr(lead, hit["field"], hit["value"])
        await C.record_event(db, "note", lead_id=lead.id, ref_id=f"upd:{suggestion_id}", summary=f"{SUGGEST_FIELDS[hit['field']]} updated to {hit['value']}")
    lead.suggestions = [s for s in pending if s.get("id") != suggestion_id] or None
    return True


# ── Inbound call from someone we do not know ────────────────────────────────
async def lead_for_inbound(db: AsyncSession, org_id: str, phone: str, name: str = "") -> Optional[str]:
    """The lead for an incoming caller. An unknown caller becomes a lead (source "Inbound call") when the
    organisation has the Leads plan. Returns the lead id, or None."""
    if not phone:
        return None
    try:
        lead = await C.lead_for(db, phone=phone)
        if lead:
            return lead.id
        if not (await entitled(db, org_id)).get("leads"):
            return None
        from app.services.timezone_service import normalize_phone

        lead = LeadAccount(id=f"la_{uuid.uuid4().hex[:12]}", name=(name or f"Caller {normalize_phone(phone)[-4:]}")[:120],
                           phone=normalize_phone(phone), source="inbound_call", stage="contacted", last_contact_at=datetime.utcnow())
        db.add(lead)
        await db.flush()
        await C.record_event(db, "note", lead_id=lead.id, ref_id="inbound", summary="Called in. Added as a new lead.")
        return lead.id
    except Exception as err:
        logger.warning(f"[connections] inbound caller not linked to a lead: {err}")
        return None


# ── A meeting was booked ────────────────────────────────────────────────────
async def on_meeting_booked(db: AsyncSession, meeting: Meeting) -> None:
    """Link the meeting to its lead and call, move the lead to "Meeting", and stop the rest of the sequence."""
    try:
        async with db.begin_nested():
            await _meeting_booked(db, meeting)
    except Exception as err:
        logger.warning(f"[connections] meeting {getattr(meeting, 'id', '?')} not linked: {err}")


async def _meeting_booked(db: AsyncSession, meeting: Meeting) -> None:
    lead = await C.lead_for(db, lead_id=meeting.lead_id or "", email=meeting.attendee_email or "")
    if lead is None and meeting.prospect:
        wanted = meeting.prospect.strip().lower()
        for cand in (await db.execute(select(LeadAccount).where(LeadAccount.stage != "lost"))).scalars().all():
            if wanted in ((cand.name or "").lower(), (cand.contact_name or "").lower()):
                lead = cand
                break
    if lead is None:
        return
    meeting.lead_id = lead.id
    meeting.registry_id = meeting.registry_id or lead.registry_id
    if not meeting.call_id:
        since = datetime.utcnow() - timedelta(hours=3)
        recent = (await db.execute(select(LiveCall).where(LiveCall.lead_id == lead.id, LiveCall.booked.is_(True),
                                                          LiveCall.created_at >= since).order_by(LiveCall.created_at.desc()).limit(1))).scalars().first()
        if recent:
            meeting.call_id = recent.id
    lead.stage = C.stage_for_outcome(lead.stage or "new", "meeting_booked")
    lead.last_contact_at = datetime.utcnow()
    await C.record_event(db, "meeting", lead_id=lead.id, registry_id=lead.registry_id or "", ref_id=meeting.id,
                         summary=f"Meeting booked for {meeting.date} {meeting.time}",
                         detail={"meeting_id": meeting.id, "call_id": meeting.call_id, "date": meeting.date, "time": meeting.time,
                                 "join_url": meeting.video_link})
    rules = await C.get_rules(db)
    if rules["stop_on_booking"]:
        await stop_sequences(db, lead)


async def stop_sequences(db: AsyncSession, lead: LeadAccount) -> int:
    """The lead booked: remaining emails and queued calls to them stop."""
    n = 0
    if lead.email:
        for enr in (await db.execute(select(EmailEnrollment).where(
                EmailEnrollment.email == lead.email.lower(), EmailEnrollment.status == "active"))).scalars().all():
            enr.status, enr.next_action_at = "booked", None
            n += 1
    for p in (await db.execute(select(Prospect).where(Prospect.lead_id == lead.id, Prospect.status == "queued"))).scalars().all():
        p.status, p.note = "meeting_booked", "Booked a meeting, so this call was cancelled"
        n += 1
    if n:
        await C.record_event(db, "note", lead_id=lead.id, ref_id=f"stop:{lead.id}:{n}", summary="Booked a meeting. Planned emails and calls stopped.")
    return n


# ── A campaign email got a reply ────────────────────────────────────────────
async def on_reply(db: AsyncSession, org_id: str, email: str, subject: str = "", positive: Optional[bool] = None) -> None:
    try:
        async with db.begin_nested():
            lead = await C.lead_for(db, email=email)
            if not lead:
                return
            lead.last_contact_at = datetime.utcnow()
            lead.stage = C.stage_for_outcome(lead.stage or "new", "contacted")
            if positive:
                lead.stage = C.stage_for_outcome(lead.stage, "callback_requested")
            await C.record_event(db, "email", lead_id=lead.id, registry_id=lead.registry_id or "",
                                 ref_id=f"reply:{email}:{subject[:40]}", summary=f"Replied: {subject}"[:200] if subject else "Replied")
            if positive:
                _notify(db, f"{lead.name} replied and sounds interested.", "success")
    except Exception as err:
        logger.warning(f"[connections] reply not linked: {err}")
