"""The email outreach background job (every minute, for every active company).

Per mailbox:
- Once a day the warmup engine plans it: today's cap, how many warmup and campaign emails,
  and whether it is still warming, has graduated or must pause (bounces).
- Warmup emails go to the platform mailbox and the company's other warming mailboxes, spread
  over 08:00-18:00 in the company's timezone.
- Campaign emails: leads whose next step is due, inside the campaign's days and hours, at most
  one per mailbox per gap (the campaign's minimum delay), within the mailbox's campaign quota.
  Follow-ups stay on the mailbox that sent step 1 and thread under the previous email.
- Every few minutes its inbox is read: bounces, replies, warmup mail (see inbox_reader).

The platform mailbox, every few minutes: warmup emails it received are marked read, moved
out of spam, and some get a reply, so client mailboxes build a good sending reputation.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import (
    EmailCampaign,
    EmailEnrollment,
    EmailMailbox,
    EmailSendLog,
    EmailSequenceStep,
)
from app.services import mail_transport as T
from app.services.email_dispatcher import day_log, mailbox_settings, send_cold_email
from app.services.email_warmup_engine import DayLog, MailboxState, plan_mailbox_day

logger = logging.getLogger("email_worker")

SENDING = ("warming", "graduated", "active")
WARMUP_HOURS = (8, 18)
INBOX_EVERY = timedelta(minutes=5)
WARMUP_GAP = timedelta(minutes=3)
RETRY_AFTER = timedelta(minutes=30)
PLATFORM_STATE_KEY = "platform_mailbox_state"
REPLY_SHARE = 0.35

WARMUP_LINES = [
    ("Quick question about next week", "Hi,\n\nAre we still on for the catch-up next week? Let me know what day suits you best.\n\nThanks"),
    ("Notes from today", "Hi,\n\nThanks for the chat today. I've put the notes together and will share them by Friday.\n\nBest"),
    ("Following up", "Hello,\n\nJust following up on my last message. No rush at all, whenever you get a moment.\n\nCheers"),
    ("Updated timeline", "Hi,\n\nSmall update: the timeline moved by a couple of days. Everything else stays the same.\n\nKind regards"),
    ("Thanks for the help", "Hi,\n\nThanks again for your help with this. It made things a lot easier on our side.\n\nAll the best"),
    ("Agenda for Thursday", "Hi,\n\nHere's what I'd like to cover on Thursday: progress so far, next steps and any blockers.\n\nThanks"),
]
WARMUP_REPLIES = [
    "Thanks, that works for me.", "Got it, thank you!", "Sounds good, speak soon.",
    "Thanks for the update.", "Perfect, appreciate it.", "Great, thanks for letting me know.",
]


def local_now(tz_name: str, now: Optional[datetime] = None) -> datetime:
    from zoneinfo import ZoneInfo

    now = now or datetime.utcnow()
    try:
        return now.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(tz_name)).replace(tzinfo=None)
    except Exception:
        return now


def in_window(camp: EmailCampaign, local: datetime) -> bool:
    days = camp.days_of_week or [1, 2, 3, 4, 5]
    if local.isoweekday() not in days:
        return False
    hm = local.strftime("%H:%M")
    return (camp.sending_window_start or "09:00") <= hm < (camp.sending_window_end or "17:00")


def render(template: str, enr: EmailEnrollment, booking_link: str = "") -> str:
    values = {"first_name": enr.first_name, "firstname": enr.first_name, "last_name": enr.last_name,
              "lastname": enr.last_name, "company": enr.company, "email": enr.email,
              "personalline": str((getattr(enr, "vars", None) or {}).get("personal_line") or "").strip(),
              "bookinglink": booking_link}

    def sub(m: "re.Match[str]") -> str:
        key = re.sub(r"[^a-z]", "", m.group(1).lower().replace("_", ""))
        key = {"firstname": "first_name", "lastname": "last_name"}.get(key, key)
        return values.get(key, "") or ""
    out = re.sub(r"\{\{\s*([A-Za-z_]+)\s*\}\}", sub, template or "")
    out = re.sub(r"[ \t]+([,.!?])", r"\1", out)
    return re.sub(r"\n{3,}", "\n\n", out)  # an empty {{personal_line}} leaves no gap


async def booking_link_for(db: AsyncSession, org_id: str, enr: EmailEnrollment) -> str:
    """The lead's own booking page, or "" when the organisation has no calendar (the calendar is part of Voice)."""
    from app.public_api import book_page
    from app.services.connection_handlers import entitled

    if not (await entitled(db, org_id)).get("voice"):
        return ""
    return book_page.booking_url(org_id, lead_id=enr.lead_id or "")


def next_window(camp: EmailCampaign, local: datetime) -> Tuple[bool, str]:
    """(open now, when the next sending window opens in words). Emails only go out inside the campaign's days and hours."""
    if in_window(camp, local):
        return True, ""
    days = camp.days_of_week or [1, 2, 3, 4, 5]
    start = camp.sending_window_start or "09:00"
    for i in range(8):
        d = local.date() + timedelta(days=i)
        if d.isoweekday() not in days:
            continue
        if i == 0 and local.strftime("%H:%M") >= start:
            continue  # today's hours are over
        return False, f"{'today' if i == 0 else 'tomorrow' if i == 1 else d.strftime('%A')} at {start}"
    return False, ""


# ── Daily plan ──────────────────────────────────────────────────────────────
async def plan_day(db: AsyncSession, mb: EmailMailbox, today: str) -> None:
    if mb.plan_date == today or mb.status not in SENDING:
        return
    since = (date.fromisoformat(today) - timedelta(days=7)).isoformat()
    rows = (await db.execute(select(EmailSendLog).where(EmailSendLog.mailbox_id == mb.id, EmailSendLog.date >= since,
                                                          EmailSendLog.date < today).order_by(EmailSendLog.date))).scalars().all()
    logs = [DayLog(date=r.date, sent_count=r.sent_count or 0, bounced_count=r.bounced_count or 0) for r in rows]
    state = MailboxState(id=mb.id, email=mb.email, status=mb.status, daily_cap=mb.daily_cap or 5,
                         max_daily_target=mb.max_daily_target or 40, consecutive_healthy_days=mb.consecutive_healthy_days or 0)
    plan = plan_mailbox_day(state, logs, today)
    mb.plan_date = today
    mb.bounce_rate_7d = plan["bounce_rate_7d"]
    mb.consecutive_healthy_days = plan["consecutive_healthy_days"]
    mb.daily_cap = plan["daily_cap"]
    mb.warmup_quota = plan["warmup_sends"]
    mb.campaign_quota = plan["campaign_sends"]
    if plan["action"] == "pause":
        mb.status = "paused"
        mb.pause_reason = plan["pause_reason"]
    elif plan["new_status"] in ("graduated", "active"):
        if mb.status == "warming":
            mb.graduated_at = datetime.utcnow()
        mb.status = "active"


# ── Warmup sending ──────────────────────────────────────────────────────────
async def send_warmup(db: AsyncSession, org_id: str, mb: EmailMailbox, partners: List[str], local: datetime,
                      now: datetime) -> bool:
    if not partners or not mb.warmup_quota:
        return False
    start, end = WARMUP_HOURS
    if not (start <= local.hour < end):
        return False
    if mb.last_sent_at and now - mb.last_sent_at < WARMUP_GAP:
        return False
    log = await day_log(db, mb.id)
    elapsed = ((local.hour - start) * 60 + local.minute + 1) / ((end - start) * 60)
    due = min(mb.warmup_quota, math.ceil(mb.warmup_quota * elapsed))
    if (log.warmup_sent_count or 0) >= due:
        return False
    subject, body = random.choice(WARMUP_LINES)
    res = await send_cold_email(db, org_id, mb, random.choice(partners), subject, body,
                                is_warmup=True, warmup_id=uuid.uuid4().hex[:16])
    return res["status"] == "sent"


# ── Campaign sending ────────────────────────────────────────────────────────
async def _steps(db: AsyncSession, campaign_id: str) -> Dict[int, EmailSequenceStep]:
    rows = (await db.execute(select(EmailSequenceStep).where(EmailSequenceStep.campaign_id == campaign_id))).scalars().all()
    return {s.step_number: s for s in rows}


def _has_room(mb: EmailMailbox, log: EmailSendLog, camp: EmailCampaign, now: datetime) -> bool:
    if mb.status not in SENDING or (log.campaign_sent_count or 0) >= (mb.campaign_quota or 0):
        return False
    return not mb.last_sent_at or (now - mb.last_sent_at).total_seconds() >= (camp.min_delay_seconds or 60)


async def run_campaign(db: AsyncSession, org_id: str, camp: EmailCampaign, boxes: Dict[str, EmailMailbox],
                       local: datetime, now: datetime) -> int:
    if not in_window(camp, local):
        return 0
    pool = [boxes[i] for i in (camp.mailbox_ids or []) if i in boxes]
    if not pool:
        return 0
    from app.services import journeys as J

    steps = await _steps(db, camp.id)
    rules = J.rules_of(camp)
    cap_left = (camp.daily_cap - await J.sent_today(db, camp.id, now)) if camp.daily_cap else None  # the journey's own daily cap, on top of each mailbox's
    due = (await db.execute(select(EmailEnrollment).where(
        EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active",
        EmailEnrollment.next_action_at <= now).order_by(EmailEnrollment.next_action_at).limit(len(pool) * 2))).scalars().all()
    sent = 0
    for enr in due:
        step = steps.get(enr.current_step)
        if step is None:
            enr.status = "completed"
            enr.next_action_at = None
            continue
        if await J.before_step(db, camp, enr, step, steps, rules, now):  # a stage that means stop, a manual step, a skipped channel, a call that never reported
            continue
        if step.channel != "email":  # a call step: ring the lead through Voice when the plans and the condition allow it
            from app.services.connection_handlers import run_call_step

            outcome, _why = await run_call_step(db, org_id, enr, step, now)
            if outcome == "deferred":  # outside calling hours: try again later, nothing is lost
                enr.next_action_at = now + timedelta(minutes=30)
                continue
            enr.last_action_at = now
            if outcome == "called":  # the journey waits for the call's result, and carries on by itself if none comes
                enr.waiting_on, enr.waiting_since, enr.next_action_at = "call", now, now + timedelta(hours=J.CALL_WAIT_HOURS)
                continue
            await _advance(enr, steps, now)
            continue
        if await J.already_sent(db, enr.id, step.id):  # it went out before a restart: never twice
            await _advance(enr, steps, now)
            continue
        if cap_left is not None and cap_left <= 0:  # the journey's daily cap is reached: the rest waits for tomorrow
            continue
        # A follow-up goes from the mailbox that sent the first email. If that one is blocked, paused or
        # failing, any other ready mailbox in the campaign takes over, so one bad mailbox never stalls the list.
        sticky = boxes.get(enr.mailbox_id)
        candidates = [sticky] if sticky is not None and sticky.status in SENDING else pool
        link = ""
        if re.search(r"\{\{\s*booking_?link\s*\}\}", (step.body_template or "") + (step.subject or ""), re.I):
            link = await booking_link_for(db, org_id, enr)  # empty without the Voice plan, so no broken link goes out
        subject_tpl, body_tpl = J.pick_version(enr, step)
        subject = render(subject_tpl, enr, link).strip() or (f"Re: {enr.last_subject}" if enr.last_subject else "")
        body = render(body_tpl, enr, link)
        from app.services.enrichment_waterfall import classify_pecr_entity

        res, mb = None, None
        for c in candidates:
            if not _has_room(c, await day_log(db, c.id), camp, now):
                continue
            mb = c
            res = await send_cold_email(db, org_id, c, enr.email, subject, body, campaign_id=camp.id,
                                        sequence_step_id=step.id, enrollment_id=enr.id, prospect_id=enr.prospect_id or "",
                                        entity_type=classify_pecr_entity(enr.company, enr.email),
                                        in_reply_to=enr.last_message_id if enr.current_step > 1 else "",
                                        from_alias=(camp.alias_map or {}).get(c.id, ""))
            if res["status"] != "failed":
                break  # sent, or stopped for a reason another mailbox wouldn't change; a failed send tries the next mailbox
        if res is None or mb is None:
            continue
        enr.last_action_at = now
        if res["status"] == "sent":
            sent += 1
            cap_left = None if cap_left is None else cap_left - 1
            enr.mailbox_id = mb.id
            enr.last_message_id = res["message_id"]
            enr.last_subject = enr.last_subject or subject
            await _advance(enr, steps, now)
        elif res["status"] in ("suppressed", "blocked_pecr"):
            enr.status = "suppressed" if res["status"] == "suppressed" else "blocked"
            enr.next_action_at, enr.finish_reason = None, res["status"]
        else:
            enr.next_action_at = now + RETRY_AFTER
    await J.sweep_silent(db, camp, now)
    return sent


async def _advance(enr: EmailEnrollment, steps: Dict[int, EmailSequenceStep], now: datetime) -> None:
    enr.waiting_on, enr.retry_count = "", 0
    nxt = steps.get(enr.current_step + 1)
    if nxt is None:
        enr.status = "completed"
        enr.next_action_at, enr.finish_reason = None, "finished"
        return
    enr.current_step += 1
    enr.current_step_key = nxt.step_key or nxt.id
    enr.next_action_at = now + timedelta(days=nxt.delay_days or 0, hours=nxt.delay_hours or 0)


# ── Inbox ───────────────────────────────────────────────────────────────────
async def read_inbox(db: AsyncSession, org_id: str, mb: EmailMailbox, now: datetime) -> None:
    if mb.last_sync_at and now - mb.last_sync_at < INBOX_EVERY:
        return
    from app.services import inbox_reader

    mb.last_sync_at = now
    try:
        messages, newest = await T.fetch_new(mailbox_settings(mb), mb.imap_last_uid or 0)
    except T.MailError as err:
        if not mb.last_error:
            from app.services.reconnect_events import reconnect_needed

            reconnect_needed("email.mailbox.needs_reauth", org_id, {"mailbox_id": mb.id, "email": mb.email, "error": str(err)[:200]})
        mb.last_error = str(err)
        return
    out = await inbox_reader.process(db, org_id, mb, messages)
    mb.imap_last_uid = newest
    if mb.status in SENDING:
        await T.rescue_warmup(mailbox_settings(mb), out["warmup_uids"])


async def refresh_mail(db: AsyncSession, org_id: str, mb: EmailMailbox, now: datetime) -> None:
    """Keeps the Mail screen's copy fresh for mailboxes someone has opened there (it is first read when they open it)."""
    if not mb.mail_state or (mb.mail_synced_at and now - mb.mail_synced_at < INBOX_EVERY):
        return
    from app.services import mail_sync

    try:
        await mail_sync.sync_mailbox(db, org_id, mb, mailbox_settings(mb))
    except Exception as err:
        mb.mail_synced_at = now
        logger.debug(f"mail screen copy not refreshed for {mb.email}: {err}")


# ── One company ─────────────────────────────────────────────────────────────
async def run_org(db: AsyncSession, org_id: str, now: Optional[datetime] = None) -> Dict[str, int]:
    from app.services import platform_mailbox
    from app.services.org_settings import org_timezone

    now = now or datetime.utcnow()
    today = now.date().isoformat()
    local = local_now(await org_timezone(db), now)
    boxes = {m.id: m for m in (await db.execute(select(EmailMailbox))).scalars().all()}
    platform_addr = (await platform_mailbox.get()).get("email", "")
    stats = {"warmup": 0, "campaign": 0}

    for mb in boxes.values():
        await plan_day(db, mb, today)
    for mb in boxes.values():
        if mb.status in SENDING:
            partners = [p for p in [platform_addr, *(o.email for o in boxes.values() if o.id != mb.id and o.status in SENDING)] if p]
            if await send_warmup(db, org_id, mb, partners, local, now):
                stats["warmup"] += 1
    camps = (await db.execute(select(EmailCampaign).where(EmailCampaign.status == "running"))).scalars().all()
    for camp in camps:
        stats["campaign"] += await run_campaign(db, org_id, camp, boxes, local, now)
        left = (await db.execute(select(EmailEnrollment.id).where(EmailEnrollment.campaign_id == camp.id,
                                                                   EmailEnrollment.status == "active").limit(1))).first()
        anyone = (await db.execute(select(EmailEnrollment.id).where(EmailEnrollment.campaign_id == camp.id).limit(1))).first()
        if anyone and not left:
            camp.status = "completed"
    for mb in boxes.values():
        if mb.status not in ("disabled",):
            await read_inbox(db, org_id, mb, now)
            await refresh_mail(db, org_id, mb, now)
    await db.commit()
    return stats


# ── The platform mailbox as warmup partner ──────────────────────────────────
_platform_checked: Optional[datetime] = None


async def platform_partner(now: Optional[datetime] = None) -> int:
    """Marks warmup mail read, rescues it from spam and answers some of it. Returns replies sent."""
    global _platform_checked
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services import platform_mailbox
    from app.services.credits import _get_doc, _put_doc

    now = now or datetime.utcnow()
    if _platform_checked and now - _platform_checked < INBOX_EVERY:
        return 0
    _platform_checked = now
    saved = await platform_mailbox.get()
    if not saved:
        return 0
    settings = saved["settings"]
    with system_scope():
        async with AsyncSessionLocal() as db:
            state = await _get_doc(db, PLATFORM_STATE_KEY)
            # Start from new mail only: a mailbox seen for the first time is not replied to backwards.
            last = int(state.get("last_uid") or 0) if state.get("email") == saved["email"] else 0
            try:
                messages, newest = await T.fetch_new(settings, last)
            except T.MailError as err:
                logger.warning(f"[Email] platform mailbox not read: {err}")
                return 0
            await _put_doc(db, PLATFORM_STATE_KEY, {"email": saved["email"], "last_uid": newest})
            await db.commit()
    warm = [m for m in messages if m.warmup_id and m.from_addr != saved["email"]]
    await T.rescue_warmup(settings, [m.uid for m in warm])
    replies = 0
    for m in warm:
        if random.random() >= REPLY_SHARE:
            continue
        from email.message import EmailMessage as Mime
        from email.utils import formataddr, formatdate, make_msgid

        msg = Mime()
        msg["From"] = formataddr((saved.get("from_name") or "", saved["email"]))
        msg["To"] = m.from_addr
        msg["Subject"] = m.subject if m.subject.lower().startswith("re:") else f"Re: {m.subject}"
        msg["Date"] = formatdate(usegmt=True)
        msg["Message-ID"] = make_msgid(domain=saved["email"].split("@")[-1])
        if m.message_id:
            msg["In-Reply-To"] = m.message_id
            msg["References"] = m.message_id
        msg[T.WARMUP_HEADER] = m.warmup_id
        msg.set_content(random.choice(WARMUP_REPLIES))
        try:
            await T.send(settings, msg)
            replies += 1
        except T.MailError as err:
            logger.warning(f"[Email] warmup reply failed: {err}")
            break
    return replies


async def run_all() -> None:
    from app.core.orgs import active_org_ids
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal

    for org_id in await active_org_ids():
        try:
            with org_scope(org_id):
                async with AsyncSessionLocal() as db:
                    if (await db.execute(select(EmailMailbox.id).limit(1))).first() is None:
                        continue
                    await run_org(db, org_id)
        except Exception as err:
            logger.warning(f"[Email] {org_id}: cycle failed: {err}")
    try:
        await platform_partner()
    except Exception as err:
        logger.warning(f"[Email] platform mailbox cycle failed: {err}")


async def email_loop() -> None:
    while True:
        try:
            await asyncio.sleep(60)
            await run_all()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.warning(f"[Email] cycle failed: {err}")
