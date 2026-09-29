"""Schedules: post right now, once, or on a repeating pattern.

A schedule never publishes by itself. It creates ordinary posts a little ahead of their date
(HORIZON_DAYS), queues them for the AI writer, and from there they follow the same path as
every other post: approval, then the publish loop. Posts are created ahead, not all at once,
so a three-month daily plan does not write 90 posts on day one.

Editing a schedule replaces its future posts that nobody has approved or changed by hand.
Posts edited or moved by hand are "detached": they keep their changes and the schedule never
replaces them.
"""
from __future__ import annotations

import calendar
import logging
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import SocialPost, SocialSchedule
from app.services.org_settings import clean_emails, org_instant_ms, org_timezone

logger = logging.getLogger("schedule_engine")

HORIZON_DAYS = 14
DEFAULT_RUN_MONTHS = 3
REMINDER_DAYS = 14
MAX_RUN_DAYS = 366
MAX_POSTS_PER_TICK = 90
DEFAULT_RETRY_COUNT = 1
DEFAULT_RETRY_DELAY_MIN = 5

FREQUENCIES = ("now", "once", "recurring")
PATTERNS = ("daily", "weekly", "monthly", "dates")
WEEKDAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
CHANNELS = ("linkedin", "x", "facebook", "instagram", "threads")
OPEN_STATUSES = ("awaiting_approval", "rejected", "approval_missed")

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def parse_date(value: Any) -> Optional[date]:
    try:
        return datetime.strptime(str(value or "").strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _clock(ms: float, tz: str) -> str:
    import zoneinfo

    return datetime.fromtimestamp(ms / 1000.0, zoneinfo.ZoneInfo(tz)).strftime("%H:%M")


def org_today(tz: str) -> date:
    import zoneinfo

    return datetime.now(zoneinfo.ZoneInfo(tz)).date()


def _emails(raw: Any, label: str) -> List[str]:
    items = raw if isinstance(raw, list) else re.split(r"[\s,;]+", str(raw or ""))
    items = [str(x).strip() for x in items if str(x).strip()]
    bad = [x for x in items if not _EMAIL_RE.match(x)]
    if bad:
        raise ValueError(f"{label}: not an email address: {', '.join(bad[:3])}")
    return clean_emails(items)


def clean(payload: Dict[str, Any], today: date, existing: Optional[SocialSchedule] = None) -> Dict[str, Any]:
    """Validate a schedule from the Schedule window. Raises ValueError with a message for the user."""
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Give the schedule a name.")
    plan = str(payload.get("plan") or "").strip()
    channels = []
    for ch in payload.get("channels") or []:
        c = str(ch).strip().lower()
        c = "x" if c in ("twitter", "x.com") else c
        if c not in CHANNELS:
            raise ValueError(f"Unknown channel: {ch}")
        if c not in channels:
            channels.append(c)
    if not channels:
        raise ValueError("Pick at least one channel.")
    frequency = str(payload.get("frequency") or "recurring").lower()
    if frequency not in FREQUENCIES:
        raise ValueError("Frequency must be right now, once or recurring.")
    time_str = str(payload.get("time") or "10:00").strip()
    if frequency != "now" and not _TIME_RE.match(time_str):
        raise ValueError("Time must look like 09:30.")

    out: Dict[str, Any] = {
        "theme": name[:120],
        "focus": plan[:4000],
        "channels": channels,
        "frequency": frequency,
        "time": time_str if frequency != "now" else "00:00",
        "pattern": None,
        "weekday": "",
        "month_day": None,
        "custom_dates": [],
        "date_topics": {},
        "start_date": None,
        "end_date": None,
        "make_image": payload.get("makeImage") is not False,
        "approver_emails": _emails(payload.get("approverEmails"), "Approvers"),
        "result_emails": _emails(payload.get("resultEmails"), "Results email"),
    }
    try:
        retry_count = int(payload.get("retryCount", DEFAULT_RETRY_COUNT))
        retry_delay = int(payload.get("retryDelayMin", DEFAULT_RETRY_DELAY_MIN))
    except (TypeError, ValueError):
        raise ValueError("Retries must be whole numbers.")
    if not 0 <= retry_count <= 3:
        raise ValueError("Retry a failed post at most 3 times.")
    if not 1 <= retry_delay <= 120:
        raise ValueError("Wait between 1 and 120 minutes before a retry.")
    out["retry_count"] = retry_count
    out["retry_delay_min"] = retry_delay

    # Only custom dates can go without a brief, and only when every date has its own topic.
    if not plan and not (frequency == "recurring" and str(payload.get("pattern") or "").lower() == "dates"):
        raise ValueError("Say what the posts should be about.")
    if frequency == "now":
        out["start_date"] = out["end_date"] = today.isoformat()
        return out
    if frequency == "once":
        d = parse_date(payload.get("date") or payload.get("startDate"))
        if not d:
            raise ValueError("Pick the date to post.")
        if d < today:
            raise ValueError("That date has passed. Pick today or later, or use Right now.")
        out["start_date"] = out["end_date"] = d.isoformat()
        return out

    pattern = str(payload.get("pattern") or "weekly").lower()
    if pattern not in PATTERNS:
        raise ValueError("Pattern must be daily, weekly, monthly or custom dates.")
    out["pattern"] = pattern
    if pattern == "dates":
        dates = sorted({d for d in (parse_date(x) for x in payload.get("customDates") or []) if d})
        if not dates:
            raise ValueError("Add at least one date.")
        if dates[0] < today and not existing:
            raise ValueError("Custom dates must be today or later.")
        if (dates[-1] - dates[0]).days > MAX_RUN_DAYS:
            raise ValueError("Keep custom dates within one year.")
        out["custom_dates"] = [d.isoformat() for d in dates]
        raw_topics = payload.get("dateTopics") if isinstance(payload.get("dateTopics"), dict) else {}
        # Each date may have its own topic; dates without one follow the brief.
        topics = {d: str(raw_topics.get(d) or "").strip()[:500] for d in out["custom_dates"]}
        out["date_topics"] = {d: t for d, t in topics.items() if t}
        if not plan and len(out["date_topics"]) < len(out["custom_dates"]):
            raise ValueError("Give every date a topic, or say what the posts should be about.")
        out["start_date"] = dates[0].isoformat()
        out["end_date"] = dates[-1].isoformat()
        return out

    start = parse_date(payload.get("startDate")) or today
    if start < today and not (existing and existing.start_date == start.isoformat()):
        raise ValueError("The start date has passed. Pick today or later.")
    end = parse_date(payload.get("endDate")) or add_months(start, DEFAULT_RUN_MONTHS)
    if end < start:
        raise ValueError("The end date is before the start date.")
    if (end - start).days > MAX_RUN_DAYS:
        raise ValueError("A schedule can run for at most a year. Extend it later when it nears the end.")
    out["start_date"] = start.isoformat()
    out["end_date"] = end.isoformat()
    if pattern == "weekly":
        days = [str(d).upper()[:2] for d in payload.get("weekdays") or []]
        days = [d for d in WEEKDAYS if d in days]
        if not days:
            raise ValueError("Pick the weekdays to post on.")
        out["weekday"] = ",".join(days)
    if pattern == "monthly":
        try:
            md = int(payload.get("monthDay") or start.day)
        except (TypeError, ValueError):
            md = 0
        if not 1 <= md <= 31:
            raise ValueError("Day of the month must be 1 to 31.")
        out["month_day"] = md
    return out


def occurrences(s: SocialSchedule, first: date, last: date) -> List[date]:
    """Dates this schedule posts on between first and last (inclusive)."""
    start = parse_date(s.start_date)
    end = parse_date(s.end_date) or start
    if not start or s.frequency == "now":
        return []
    lo, hi = max(first, start), min(last, end)
    if lo > hi:
        return []
    if s.frequency == "once":
        return [start] if lo <= start <= hi else []
    out: List[date] = []
    weekdays = {WEEKDAYS.index(d) for d in (s.weekday or "").split(",") if d in WEEKDAYS}
    custom = {parse_date(x) for x in s.custom_dates or []}
    d = lo
    while d <= hi:
        if s.pattern == "daily":
            hit = True
        elif s.pattern == "weekly":
            hit = d.weekday() in weekdays
        elif s.pattern == "monthly":
            hit = d.day == min(int(s.month_day or 1), calendar.monthrange(d.year, d.month)[1])
        else:
            hit = d in custom
        if hit:
            out.append(d)
        d += timedelta(days=1)
    return out


def first_open_day(s: SocialSchedule, today: date, tz: str, now_ms: float) -> date:
    """Today, unless today's slot has already passed (then no post is made for today)."""
    due = org_instant_ms(today.isoformat(), s.time or "10:00", tz)
    return today + timedelta(days=1) if s.frequency == "recurring" and due and due <= now_ms else today


def schedule_dict(s: SocialSchedule, first_day: date, post_counts: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    upcoming = occurrences(s, first_day, parse_date(s.end_date) or first_day) if s.status == "active" else []
    return {
        "id": s.id,
        "name": s.theme,
        "plan": s.focus or "",
        "channels": s.channels or [],
        "frequency": s.frequency or "recurring",
        "pattern": s.pattern,
        "time": s.time or "10:00",
        "weekdays": [d for d in (s.weekday or "").split(",") if d],
        "monthDay": s.month_day,
        "customDates": s.custom_dates or [],
        "dateTopics": s.date_topics or {},
        "startDate": s.start_date,
        "endDate": s.end_date,
        "makeImage": s.make_image is not False,
        "approverEmails": s.approver_emails or [],
        "resultEmails": s.result_emails or [],
        "retryCount": DEFAULT_RETRY_COUNT if s.retry_count is None else s.retry_count,
        "retryDelayMin": s.retry_delay_min or DEFAULT_RETRY_DELAY_MIN,
        "status": s.status or "active",
        "endedReason": s.ended_reason,
        "upcoming": [d.isoformat() for d in upcoming[:6]],
        "upcomingCount": len(upcoming),
        "posts": (post_counts or {}).get(s.id, 0),
    }


def retry_policy(s: Optional[SocialSchedule]) -> tuple:
    if not s:
        return DEFAULT_RETRY_COUNT, DEFAULT_RETRY_DELAY_MIN
    count = DEFAULT_RETRY_COUNT if s.retry_count is None else int(s.retry_count)
    return count, int(s.retry_delay_min or DEFAULT_RETRY_DELAY_MIN)


async def remove_open_posts(db: AsyncSession, s: SocialSchedule, today: date) -> int:
    """Delete this schedule's upcoming posts that nobody approved or changed by hand."""
    from app.services import generation_queue
    from app.services.post_versions import delete_versions

    rows = (await db.execute(select(SocialPost).where(SocialPost.schedule_id == s.id))).scalars().all()
    gone = [
        p for p in rows
        if p.status in OPEN_STATUSES and not p.detached and not p.edited_by_user
        and (parse_date(p.occurrence) or today) >= today
    ]
    if not gone:
        return 0
    ids = [p.id for p in gone]
    await generation_queue.cancel_for_posts(db, ids)
    for pid in ids:
        await delete_versions(db, pid)
    await db.execute(delete(SocialPost).where(SocialPost.id.in_(ids)))
    return len(ids)


async def materialize(db: AsyncSession, s: SocialSchedule, today: date, tz: str, now_ms: float, budget: int) -> int:
    """Create the posts due within HORIZON_DAYS that do not exist yet and queue them for writing."""
    from app.services import generation_queue

    if s.status != "active" or budget <= 0:
        return 0
    have = {row[0] for row in (await db.execute(
        select(SocialPost.occurrence).where(SocialPost.schedule_id == s.id)
    )).all()}
    asap = s.frequency == "now"
    if asap:
        dates = [today] if not have else []
    elif s.frequency == "once":
        # A one-off post is made straight away, however far ahead, so it can be approved early.
        dates = [d for d in occurrences(s, today, parse_date(s.start_date) or today) if d.isoformat() not in have]
    else:
        dates = [d for d in occurrences(s, today, today + timedelta(days=HORIZON_DAYS)) if d.isoformat() not in have]
    channels = s.channels or ["linkedin"]
    now_clock = _clock(now_ms, tz)
    earlier = [row[0] for row in (await db.execute(
        select(SocialPost.title).where(SocialPost.schedule_id == s.id, SocialPost.copy != "")
        .order_by(SocialPost.due_at_ms.desc()).limit(12)
    )).all() if row[0]]
    groups = []
    made = 0
    for d in dates:
        if made + len(channels) > budget:
            break
        due = now_ms if asap else org_instant_ms(d.isoformat(), s.time or "10:00", tz)
        if not due or (not asap and due <= now_ms):
            continue  # today's slot already passed when the schedule was made
        ids = []
        for ch in channels:
            pid = f"v2_s{uuid.uuid4().hex[:12]}"
            db.add(SocialPost(
                id=pid, schedule_id=s.id, occurrence=d.isoformat(), asap=asap,
                title=s.theme, copy="", channels=[ch], status="awaiting_approval",
                time=now_clock if asap else (s.time or "10:00"),
                theme=s.theme, due_at_ms=due, slot_date_ms=due, gen_state="queued",
            ))
            ids.append(pid)
        made += len(ids)
        topic = (s.date_topics or {}).get(d.isoformat())
        if topic:
            # The user set this date's topic: write exactly that, with the brief as background.
            plan = topic + (f"\n\nBackground for the series \"{s.theme}\": {s.focus}" if s.focus else "")
        else:
            avoid = ("\nDo not repeat these earlier posts in this series: " + "; ".join(earlier)) if earlier else ""
            plan = (f"{s.focus}\n\nOne post in the series \"{s.theme}\" for {d.strftime('%A %d %B %Y')}. "
                    f"Give it its own topic and angle.{avoid}")
        groups.append({
            "post_ids": ids,
            "plan": plan,
            "headline": (topic or "")[:180],
            "channel": channels[0],
            "date": d.isoformat(),
            "skip_image": s.make_image is False,
        })
    if groups:
        await db.flush()
        await generation_queue.enqueue(db, groups, priority=0)
        logger.info(f"[Schedules] {s.theme}: created {made} post(s) for {len(groups)} date(s).")
    return made


async def tick(db: AsyncSession, now_ms: float, public_base: str) -> int:
    """End finished schedules, send end reminders, and create upcoming posts. Returns posts made."""
    from app.services import approval_mail

    tz = await org_timezone(db)
    today = org_today(tz)
    schedules = (await db.execute(select(SocialSchedule).where(SocialSchedule.status == "active"))).scalars().all()
    budget = MAX_POSTS_PER_TICK
    made = 0
    for s in schedules:
        end = parse_date(s.end_date)
        if s.frequency == "recurring" and end and today > end:
            s.status = "ended"
            s.ended_reason = f"Reached its end date ({end.isoformat()})."
            continue
        start = parse_date(s.start_date)
        if (
            s.frequency == "recurring" and end and start and not s.reminder_sent_at
            and (end - start).days > REMINDER_DAYS and (end - today).days <= REMINDER_DAYS
        ):
            s.reminder_sent_at = datetime.utcnow()
            await approval_mail.send_schedule_reminder(db, s, public_base, tz)
        n = await materialize(db, s, today, tz, now_ms, budget)
        budget -= n
        made += n
    await db.commit()
    return made
