"""One day across every app: what is happening for the signed-in company on a given date.

Voice (meetings, booked calls, callbacks), Social (posts going out) and Leads (campaign emails due, sent and replied to) each add their
own items. The app a person is looking at comes first, then the others, so every calendar can show the whole day.
Only apps the company has are included. Times are the company's own.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import EmailCampaign, EmailEnrollment, EmailMessage, LeadAccount, Meeting, ScheduleItem, SocialPost

ORDER = ("leads", "voice", "social")
LABELS = {"leads": "Leads", "voice": "Voice", "social": "Social"}
HREF = {"leads": "#/leadgen/outreach", "voice": "#/voice/schedule", "social": "#/scheduler/plan"}
MEETING_STATUS = {"upcoming": "Upcoming", "needs_outcome": "Needs an outcome", "converted": "Done", "not_fit": "Not a fit"}
POST_STATUS = {"draft": "Draft", "awaiting_approval": "Needs approval", "needs_approval": "Needs approval", "approved": "Approved", "scheduled": "Scheduled",
               "publishing": "Going out now", "published": "Published", "failed": "Failed to publish"}
CHANNEL = {"linkedin": "LinkedIn", "x": "X", "facebook": "Facebook", "instagram": "Instagram", "threads": "Threads", "reddit": "Reddit"}
FORMAT = {"video": "Video meeting", "phone": "Phone call", "in_person": "In-person meeting"}


def window(date_iso: str, tz: str):
    """The day as (start, end) in UTC, without zone info, the way the database keeps times."""
    from app.services.timezone_service import tzinfo
    import zoneinfo

    zone = tzinfo(tz)
    start = datetime.fromisoformat(date_iso).replace(tzinfo=zone)
    end = start + timedelta(days=1)
    utc = zoneinfo.ZoneInfo("UTC")
    return start.astimezone(utc).replace(tzinfo=None), end.astimezone(utc).replace(tzinfo=None)


def _local_hhmm(utc_naive: Optional[datetime], tz: str) -> str:
    from app.services.timezone_service import tzinfo
    import zoneinfo

    if not utc_naive:
        return ""
    return utc_naive.replace(tzinfo=zoneinfo.ZoneInfo("UTC")).astimezone(tzinfo(tz)).strftime("%H:%M")


def _item(plugin: str, kind: str, title: str, *, time: str = "", detail: str = "", status: str = "", id_: str = "", href: str = "") -> Dict[str, Any]:
    return {"plugin": plugin, "kind": kind, "time": time or "", "title": title, "detail": detail, "status": status, "id": id_, "href": href or HREF[plugin]}


async def _voice(db: AsyncSession, date_iso: str, start: datetime, end: datetime, tz: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    meetings = (await db.execute(select(Meeting).where(Meeting.date == date_iso))).scalars().all()
    booked = {m.id for m in meetings}
    for m in meetings:
        what = FORMAT.get((m.format or "video"), "Meeting")
        detail = " · ".join(x for x in (m.mission or "", m.platform if (m.format or "video") == "video" else "") if x)
        out.append(_item("voice", "meeting", f"{what} with {m.prospect}", time=m.time or "", detail=detail,
                         status=MEETING_STATUS.get(m.status or "upcoming", m.status or ""), id_=m.id, href="#/voice/schedule"))
    for s in (await db.execute(select(ScheduleItem).where(ScheduleItem.day == date_iso))).scalars().all():
        if s.meeting_id and s.meeting_id in booked:
            continue  # the same booking, already listed as a meeting
        out.append(_item("voice", "scheduled_call", f"{s.mission}: {s.prospect}", time=s.time or "", detail=(s.kind or "phone").replace("_", " ").title(),
                         status="Done" if s.status == "completed" else "Queued", id_=s.id, href="#/voice/schedule"))
    return out + await _callbacks(db, start, end, tz, True)


async def _callbacks(db: AsyncSession, start: datetime, end: datetime, tz: str, voice_owned: bool) -> List[Dict[str, Any]]:
    """A callback someone asked for belongs to Voice when the company has it; otherwise it is a Leads follow-up."""
    out: List[Dict[str, Any]] = []
    plugin = "voice" if voice_owned else "leads"
    for a in (await db.execute(select(LeadAccount).where(LeadAccount.next_action_at >= start, LeadAccount.next_action_at < end))).scalars().all():
        if (a.stage or "") in ("do_not_contact", "lost"):
            continue
        out.append(_item(plugin, "callback", f"{a.next_action or 'Follow up'}: {a.name}", time=_local_hhmm(a.next_action_at, tz),
                         detail="A callback or follow-up that was asked for", id_=a.id, href="#/voice/list" if voice_owned else "#/leadgen/lists"))
    return out


def _post_title(p: SocialPost) -> str:
    chans = p.channels if isinstance(p.channels, list) and p.channels else ["linkedin"]
    names = " + ".join(CHANNEL.get(str(c).lower(), str(c)) for c in chans[:3])
    return f"{names}: {p.title or 'Post'}"


async def _social(db: AsyncSession, start: datetime, end: datetime, tz: str) -> List[Dict[str, Any]]:
    from app.api.scheduler_insights import is_test

    out: List[Dict[str, Any]] = []
    lo = start.replace(tzinfo=timezone.utc).timestamp() * 1000
    hi = end.replace(tzinfo=timezone.utc).timestamp() * 1000
    posts = (await db.execute(select(SocialPost).where(SocialPost.due_at_ms >= lo, SocialPost.due_at_ms < hi))).scalars().all()
    for p in posts:
        if is_test(p):
            continue
        out.append(_item("social", "post", _post_title(p), time=p.time or "", status=POST_STATUS.get(p.status or "draft", p.status or ""), id_=p.id,
                         href="#/scheduler/plan"))
    return out


async def _leads(db: AsyncSession, start: datetime, end: datetime, tz: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    names = {c.id: c.name for c in (await db.execute(select(EmailCampaign))).scalars().all()}
    due = (await db.execute(select(EmailEnrollment.campaign_id, func.count(EmailEnrollment.id), func.min(EmailEnrollment.next_action_at)).where(
        EmailEnrollment.status == "active", EmailEnrollment.next_action_at >= start, EmailEnrollment.next_action_at < end).group_by(EmailEnrollment.campaign_id))).all()
    for cid, n, first in due:
        out.append(_item("leads", "campaign_emails", f"{n} email{'s' if n != 1 else ''} due: {names.get(cid, 'a campaign')}", time=_local_hhmm(first, tz),
                         detail="Sent inside the campaign's sending window", id_=cid, href="#/leadgen/outreach"))
    base = (EmailMessage.is_warmup.is_(False),)
    sent = (await db.execute(select(func.count(EmailMessage.id)).where(*base, EmailMessage.sent_at >= start, EmailMessage.sent_at < end))).scalar() or 0
    if sent:
        out.append(_item("leads", "emails_sent", f"{sent} campaign email{'s' if sent != 1 else ''} sent", id_="sent", href="#/leadgen/outreach"))
    replies = (await db.execute(select(func.count(EmailMessage.id)).where(*base, EmailMessage.replied_at >= start, EmailMessage.replied_at < end))).scalar() or 0
    if replies:
        out.append(_item("leads", "replies", f"{replies} repl{'ies' if replies != 1 else 'y'} to your campaigns", detail="Read them in Mail", id_="replies", href="#/leadgen/mail"))
    return out


def _order(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Timed items in time order, then the ones that belong to the day without a time."""
    return sorted(items, key=lambda i: (i["time"] == "", i["time"], i["title"]))


async def day(db: AsyncSession, date_iso: str, focus: str, entitled: Dict[str, Any], tz: str) -> Dict[str, Any]:
    """Every owned app's items for the date, grouped, with `focus` first."""
    start, end = window(date_iso, tz)
    voice_owned = bool(entitled.get("voice"))
    found: Dict[str, List[Dict[str, Any]]] = {p: [] for p in ORDER}
    if voice_owned:
        found["voice"] += await _voice(db, date_iso, start, end, tz)
    elif entitled.get("leads"):
        found["leads"] += await _callbacks(db, start, end, tz, False)
    if entitled.get("social"):
        found["social"] += await _social(db, start, end, tz)
    if entitled.get("leads"):
        found["leads"] += await _leads(db, start, end, tz)
    first = focus if focus in ORDER else "leads"
    order = [first] + [p for p in ORDER if p != first]
    groups = [{"plugin": p, "label": LABELS[p], "items": _order(found[p])} for p in order if entitled.get(p)]
    return {"date": date_iso, "timezone": tz, "groups": groups, "total": sum(len(g["items"]) for g in groups), "focus": first}


async def month(db: AsyncSession, month_iso: str, entitled: Dict[str, Any], tz: str) -> Dict[str, Any]:
    """How many things each app has on each day of a month, so a calendar grid can mark the other apps' days.
    Days with nothing are left out."""
    import calendar

    year, mon = int(month_iso[:4]), int(month_iso[5:7])
    days: Dict[str, Dict[str, int]] = {}
    for d in range(1, calendar.monthrange(year, mon)[1] + 1):
        iso = f"{year:04d}-{mon:02d}-{d:02d}"
        counts = {g["plugin"]: len(g["items"]) for g in (await day(db, iso, "", entitled, tz))["groups"] if g["items"]}
        if counts:
            days[iso] = counts
    return {"month": month_iso, "timezone": tz, "days": days}
