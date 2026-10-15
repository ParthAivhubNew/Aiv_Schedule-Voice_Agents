"""The background job behind the connections: meeting reminders, callbacks that fall due, calls to confirm a
meeting, follow-ups after a no-show, and the weekly summary. Runs every minute for every active organisation.
Each action is written once (a marker on the timeline), so a restart or an overlap never sends twice.
"""
from __future__ import annotations

import asyncio
import html
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import ContactEvent, LeadAccount, Meeting, Notification
from app.services import connection_handlers as H
from app.services import connections as C

logger = logging.getLogger("connection_jobs")

WINDOWS = (("rem24", timedelta(hours=24), timedelta(minutes=30)), ("rem1", timedelta(hours=1), timedelta(minutes=20)))


async def marked(db: AsyncSession, ref: str) -> bool:
    return (await db.execute(select(ContactEvent.id).where(ContactEvent.ref_id == ref).limit(1))).first() is not None


async def mark(db: AsyncSession, ref: str, lead_id: str, summary: str) -> None:
    db.add(ContactEvent(id=f"ev_{uuid.uuid4().hex[:12]}", lead_id=lead_id or None, kind="note", ref_id=ref, summary=summary))
    await db.flush()


def due_window(start: Optional[datetime], now: datetime, ahead: timedelta, slack: timedelta) -> bool:
    """True when `start` is about `ahead` from now (within slack either side)."""
    return bool(start) and (ahead - slack) <= (start - now) <= (ahead + slack)


def reminder_text(meeting: Meeting, when_label: str, kind: str) -> Dict[str, str]:
    first = (meeting.prospect or "there").strip().split()[0]
    soon = "tomorrow" if kind == "rem24" else "in about an hour"
    link = f"\nJoin: {meeting.video_link}" if meeting.video_link else ""
    text = f"Hi {first},\n\nA reminder: your meeting is {soon} ({when_label}).{link}\n\nSee you then."
    page = (f"<p>Hi {html.escape(first)},</p><p>A reminder: your meeting is {soon} (<b>{html.escape(when_label)}</b>).</p>" +
            (f'<p><a href="{html.escape(meeting.video_link)}">Join the meeting</a></p>' if meeting.video_link else "") + "<p>See you then.</p>")
    return {"subject": f"Reminder: your meeting {soon}", "text": text, "html": page}


async def send_reminders(db: AsyncSession, now: datetime) -> int:
    from app.services.calendar_service import _pretty_datetime, calendar_service

    sent = 0
    for m in (await db.execute(select(Meeting).where(Meeting.status == "upcoming", Meeting.starts_at_utc.is_not(None), Meeting.attendee_email.is_not(None)))).scalars().all():
        for kind, ahead, slack in WINDOWS:
            ref = f"{kind}:{m.id}"
            if not due_window(m.starts_at_utc, now, ahead, slack) or await marked(db, ref):
                continue
            tz = m.prospect_timezone or m.host_timezone or "Europe/London"
            label = _pretty_datetime(m.prospect_date or m.date, m.prospect_time or m.time, tz)
            body = reminder_text(m, label, kind)
            res = await calendar_service.send_outbound_email(db, m.attendee_email, body["subject"], body["html"], text_body=body["text"])
            await mark(db, ref, m.lead_id or "", "Reminder sent" if res.get("ok") else "Reminder could not be sent")
            sent += 1 if res.get("ok") else 0
    return sent


async def callbacks_due(db: AsyncSession, now: datetime) -> int:
    n = 0
    for a in (await db.execute(select(LeadAccount).where(LeadAccount.next_action_at.is_not(None), LeadAccount.next_action_at <= now))).scalars().all():
        ref = f"cbdue:{a.id}:{int(a.next_action_at.timestamp())}"
        if await marked(db, ref):
            continue
        db.add(Notification(id=f"n_{uuid.uuid4().hex[:10]}", text=f"Time to {(a.next_action or 'follow up').lower()}: {a.name}.", type="info", time="Just now"))
        await mark(db, ref, a.id, "Follow-up is due")
        n += 1
    return n


async def reminder_calls(db: AsyncSession, org_id: str, now: datetime, rules: Dict[str, Any]) -> int:
    """The AI rings the lead an hour before to confirm the meeting (off unless switched on)."""
    from app.services import lead_calls as LC

    n = 0
    for m in (await db.execute(select(Meeting).where(Meeting.status == "upcoming", Meeting.lead_id.is_not(None), Meeting.starts_at_utc.is_not(None)))).scalars().all():
        ref = f"remcall:{m.id}"
        if not due_window(m.starts_at_utc, now, timedelta(hours=1), timedelta(minutes=20)) or await marked(db, ref):
            continue
        lead = await db.get(LeadAccount, m.lead_id)
        if not lead:
            continue
        plan = await LC.plan_calls(db, [lead], override_recontact=True)
        if not plan["callable"]:
            await mark(db, ref, lead.id, "Confirmation call skipped")
            continue
        hook = (f"You are ringing to confirm their meeting at {m.prospect_time or m.time} today. Ask if it still suits them. "
                "If they need another time, find one and move the meeting with reschedule_appointment.")
        await LC.start_calls(db, [lead], title=f"Confirm meeting: {lead.name}", hooks={lead.id: hook}, concurrency=1)
        await mark(db, ref, lead.id, "Confirmation call placed")
        n += 1
    return n


async def after_no_show(db: AsyncSession, org_id: str, meeting: Meeting) -> Dict[str, bool]:
    """A meeting was marked as not attended: the follow-ups the user switched on."""
    from app.public_api import book_page
    from app.services import lead_calls as LC
    from app.services.calendar_service import calendar_service

    done = {"email": False, "call": False}
    ref = f"noshow:{meeting.id}"
    if await marked(db, ref):  # follow-ups already ran for this meeting
        return done
    rules = await C.get_rules(db)
    lead = await C.lead_for(db, lead_id=meeting.lead_id or "", email=meeting.attendee_email or "")
    await mark(db, ref, lead.id if lead else "", "Did not attend the meeting")
    if rules["no_show_email"] and meeting.attendee_email and not await C.block_for(db, email=meeting.attendee_email, channel="email"):
        link = book_page.booking_url(org_id, lead_id=lead.id if lead else "")
        first = (meeting.prospect or "there").split()[0]
        res = await calendar_service.send_outbound_email(
            db, meeting.attendee_email, "Sorry we missed you",
            f"<p>Hi {html.escape(first)},</p><p>Sorry we missed you. Pick a new time that suits you: <a href=\"{html.escape(link)}\">choose a time</a>.</p>",
            text_body=f"Hi {first},\n\nSorry we missed you. Pick a new time that suits you: {link}\n")
        done["email"] = bool(res.get("ok"))
    ent = await H.entitled(db, org_id)
    if rules["no_show_call"] and lead and ent.get("voice") and ent.get("leads"):
        plan = await LC.plan_calls(db, [lead], override_recontact=True)
        if plan["callable"]:
            hook = "They missed the meeting. Be kind, ask if they still want to talk and offer a new time with check_availability and book_appointment."
            await LC.start_calls(db, [lead], title=f"Rebook: {lead.name}", hooks={lead.id: hook}, concurrency=1)
            done["call"] = True
    return done


async def weekly_summary(db: AsyncSession, org_id: str, now: datetime, rules: Dict[str, Any]) -> bool:
    """Monday morning, once a week, to the people who asked for it."""
    from app.core.notify import notify
    from app.api.connected_home import weekly_numbers

    if not rules["weekly_summary"] or now.weekday() != 0 or now.hour < 7:
        return False
    ref = f"weekly:{now.isocalendar()[0]}-{now.isocalendar()[1]}"
    if await marked(db, ref):
        return False
    ent = await H.entitled(db, org_id)
    nums = await weekly_numbers(db)
    labels = [("new_leads", "New companies saved", "leads"), ("emails_sent", "Emails sent", "leads"), ("replies", "Replies", "leads"),
              ("calls", "Calls made", "voice"), ("conversations", "Conversations", "voice"), ("meetings", "Meetings booked", "voice"),
              ("posts", "Posts published", "social")]
    lines = [f"<b>{nums[k]}</b> {label.lower()}" for k, label, plugin in labels if ent.get(plugin)]
    await mark(db, ref, "", "Weekly summary sent")
    if lines:
        await notify("weekly_summary", "Your week across Outreach", lines, None)
    return True


_LAST_ENGAGEMENT: Dict[str, datetime] = {}
ENGAGEMENT_EVERY = timedelta(hours=1)
ENGAGEMENT_WINDOW = timedelta(days=14)


async def refresh_engagement(db: AsyncSession, org_id: str, now: datetime) -> int:
    """Once an hour, read who engaged with posts from the last two weeks. People the networks hide are simply not found."""
    from app.models.models import SocialPost
    from app.services import social_engagement as SE

    if org_id in _LAST_ENGAGEMENT and now - _LAST_ENGAGEMENT[org_id] < ENGAGEMENT_EVERY:
        return 0
    _LAST_ENGAGEMENT[org_id] = now
    since = now - ENGAGEMENT_WINDOW
    new = 0
    for post in (await db.execute(select(SocialPost).where(SocialPost.status.in_(("published", "posted")), SocialPost.created_at >= since).limit(30))).scalars().all():
        if not any(r.get("ok") and r.get("id") for r in (post.publish_results or [])):
            continue
        try:
            new += (await SE.refresh_post(db, post)).get("new", 0)
        except Exception as err:
            logger.debug(f"[connections] engagement for {post.id} not read: {err}")
    return new


async def run_org(db: AsyncSession, org_id: str, now: Optional[datetime] = None) -> Dict[str, int]:
    now = now or datetime.utcnow()
    rules = await C.get_rules(db)
    ent = await H.entitled(db, org_id)
    out = {"reminders": 0, "callbacks": 0, "reminder_calls": 0, "engagers": 0}
    if ent.get("social"):
        out["engagers"] = await refresh_engagement(db, org_id, now)
    if ent.get("voice") and rules["booking_reminders"]:  # the calendar belongs to Voice
        out["reminders"] = await send_reminders(db, now)
    if ent.get("leads") and ent.get("voice") and rules["reminder_call"]:
        out["reminder_calls"] = await reminder_calls(db, org_id, now, rules)
    if ent.get("leads"):
        out["callbacks"] = await callbacks_due(db, now)
    await weekly_summary(db, org_id, now, rules)
    await db.commit()
    return out


async def run_all() -> None:
    from app.core.orgs import active_org_ids
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal

    for org_id in await active_org_ids():
        try:
            with org_scope(org_id):
                async with AsyncSessionLocal() as db:
                    await run_org(db, org_id)
        except Exception as err:
            logger.warning(f"[connections] {org_id}: cycle failed: {err}")


async def connections_loop() -> None:
    while True:
        try:
            await asyncio.sleep(60)
            await run_all()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.warning(f"[connections] cycle failed: {err}")
