"""Meetings in the public API: open times, book, list (including meetings the AI booked on calls), cancel and move.

These use the app's own calendar, so a meeting made here appears in the app and the other way round.
"""
from __future__ import annotations

import logging
import re
import time
import uuid
from datetime import date as _date, datetime, timedelta
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.models import Meeting, PublicObject
from app.public_api.core import V1Route, authorize, fail, is_test, page_args, page_of

logger = logging.getLogger("public_api.meetings")
router = APIRouter(prefix="/meetings", tags=["Meetings"], route_class=V1Route)

SANDBOX = "mtg_test_"
MAX_DAYS = 14
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_STATUS = {"upcoming": "scheduled", "cancelled": "cancelled"}


class BookIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120, description="Who is meeting you")
    email: str = Field(..., min_length=3, max_length=200, description="Their email: the invitation goes here")
    date: str = Field(..., description="YYYY-MM-DD")
    time: str = Field(..., description="HH:MM, 24 hour")
    timezone: Optional[str] = Field(None, description="Their timezone (e.g. America/New_York) if date and time are theirs. Default: your own time.")
    event_type: str = Field("15-min-discovery", description="Which kind of meeting")
    duration_minutes: Optional[int] = Field(None, ge=5, le=480)
    phone: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=2000)
    format: Literal["video", "phone", "in_person"] = "video"
    lead_id: Optional[str] = Field(None, max_length=80, description="A company you saved in Lead Gen: the meeting is saved against it.")


class ChangeIn(BaseModel):
    action: Literal["cancel", "reschedule"]
    reason: Optional[str] = Field(None, max_length=500)
    date: Optional[str] = Field(None, description="reschedule: YYYY-MM-DD")
    time: Optional[str] = Field(None, description="reschedule: HH:MM")


def booked_payload(m: Meeting) -> Dict[str, Any]:
    """A meeting as customers see it (also sent with the meeting.booked event)."""
    source = "ai_call" if (m.channel or "") == "voice" else ("api" if (m.mission or "") == "API" else "app")
    return {
        "id": m.id, "name": m.prospect, "email": m.attendee_email or "", "status": _STATUS.get(m.status or "", "held"),
        "date": m.date, "time": m.time, "timezone": m.host_timezone or "Europe/London",
        "starts_at": (m.starts_at_utc.strftime("%Y-%m-%dT%H:%M:%SZ") if m.starts_at_utc else None),
        "their_date": m.prospect_date or m.date, "their_time": m.prospect_time or m.time,
        "their_timezone": m.prospect_timezone or m.host_timezone or "Europe/London",
        "duration_minutes": int(re.sub(r"\D", "", m.duration or "") or 0) or None, "event_type": m.event_type_slug or "",
        "format": m.format or "video", "platform": m.platform or "", "video_link": m.video_link or None, "dial_in": m.dial_in or None,
        "booked_by": source, "cancellation_reason": m.cancellation_reason or None,
        "lead_id": m.lead_id or None, "call_id": m.call_id or None, "contact_id": m.registry_id or None,
        "created_at": (m.created_at.isoformat() + "Z") if m.created_at else None,
    }


async def _meeting(db: AsyncSession, meeting_id: str) -> Meeting:
    m = (await db.execute(select(Meeting).where(Meeting.id == meeting_id))).scalars().first()
    if not m:
        fail(404, "not_found", f"Meeting '{meeting_id}' not found.")
    return m


def _check_when(day: str, at: str) -> None:
    if not _DATE.match(day or ""):
        fail(422, "invalid_date", "date must look like 2026-10-21.")
    if not _TIME.match(at or ""):
        fail(422, "invalid_time", "time must look like 14:30 (24 hour).")


# ── Routes ───────────────────────────────────────────────────────────────────
@router.get("/slots")
async def slots(request: Request, date: str = Query(..., description="First day, YYYY-MM-DD"), days: int = Query(1, ge=1, le=MAX_DAYS),
                event_type: str = Query("15-min-discovery"), timezone: Optional[str] = Query(None, description="Also show times in this zone"),
                db: AsyncSession = Depends(get_db)):
    """Open times for each day, for an event type."""
    ctx = await authorize(request, db, "calendar:book")
    if not _DATE.match(date):
        fail(422, "invalid_date", "date must look like 2026-10-21.")
    start = _date.fromisoformat(date)
    out: List[Dict[str, Any]] = []
    if is_test(ctx):
        for i in range(days):
            d = (start + timedelta(days=i)).isoformat()
            out.append({"date": d, "slots": [{"time": t, "their_time": t if not timezone else None} for t in ("09:00", "10:30", "14:00", "15:30")]})
        return {"event_type": event_type, "data": out, "test": True}
    from app.services.calendar_service import calendar_service
    from app.services.org_settings import org_timezone

    for i in range(days):
        d = (start + timedelta(days=i)).isoformat()
        try:
            found = await calendar_service.get_available_slots(db, date_str=d, event_type_slug=event_type, prospect_tz=timezone)
        except Exception as err:
            logger.warning(f"[public-api] slots for {d} failed: {err}")
            found = []
        out.append({"date": d, "slots": [{"time": s["time"], "their_time": s.get("prospect_time") or s.get("prospectTime")}
                                         for s in found if s.get("available")]})
    return {"event_type": event_type, "timezone": await org_timezone(db), "data": out}


# ── Video-meeting accounts (Google Meet, Microsoft Teams, Zoom) ──────────────────────────────────
class ProviderConnectIn(BaseModel):
    provider: Literal["google", "microsoft", "zoom"]
    return_url: str = Field(..., max_length=2000, description="One of your registered return URLs. The popup ends here.")


@router.get("/providers")
async def providers(request: Request, db: AsyncSession = Depends(get_db)):
    """Which video-meeting accounts are connected. Without one, meetings still book; they just get no video room."""
    from app.services import meeting_rooms as MR

    ctx = await authorize(request, db, "calendar:book")
    if is_test(ctx):
        return {"providers": [{"provider": p, "label": MR.LABELS[p], "configured": True, "connected": p == "google", "account": "test@example.com" if p == "google" else "", "error": ""}
                              for p in MR.PROVIDERS], "simulated": True}
    return await MR.status(db)


@router.post("/providers/connect")
async def provider_connect(body: ProviderConnectIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Start connecting a video-meeting account. Open `auth_url` in a popup; it ends at your return_url with ?status=&provider=&account=."""
    from app.public_api.social import _partner_of
    from app.services import meeting_rooms as MR
    from app.services import partners as PT

    ctx = await authorize(request, db, "calendar:book")
    partner = await _partner_of(db, ctx)
    if not partner:
        fail(403, "partner_only", "Connecting an account from your own page is for keys issued through the partner program.")
    try:
        url = PT.check_return_url(partner, body.return_url)
    except PT.PartnerError as err:
        fail(err.status, err.code, err.message)
    if PT._origin(url) not in (partner.allowed_origins or []):
        fail(422, "return_url_origin_not_allowed", "The return_url's web address must also be one of your allowed web addresses.")
    expires = datetime.utcfromtimestamp(time.time() + 1800).isoformat() + "Z"
    if is_test(ctx):
        sep = "&" if "?" in url else "?"
        return {"auth_url": f"{url}{sep}status=connected&provider={body.provider}&account=test@example.com", "expires_at": expires, "simulated": True}
    res = await MR.start(body.provider, partner_return=url)
    if not res.get("ok"):
        fail(503, "provider_unavailable", res.get("error") or "That account cannot be connected right now.")
    return {"auth_url": res["authUrl"], "expires_at": expires}


@router.delete("/providers/{provider}")
async def provider_disconnect(provider: Literal["google", "microsoft", "zoom"], request: Request, db: AsyncSession = Depends(get_db)):
    from app.core.tenancy import current_org
    from app.services import meeting_rooms as MR
    from app.services.webhook_dispatcher import dispatch_event

    ctx = await authorize(request, db, "calendar:book")
    if is_test(ctx):
        return {"ok": True, "simulated": True}
    gone = await MR.disconnect(db, provider)
    if gone:
        dispatch_event(current_org(), "meeting.provider.disconnected", {"provider": provider, "org_id": current_org()})
    return {"ok": True, "was_connected": bool(gone)}


@router.post("", status_code=201)
async def book(body: BookIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Book a meeting. The invitation is emailed; the time must be one of the open slots."""
    ctx = await authorize(request, db, "calendar:book")
    _check_when(body.date, body.time)
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", body.email.strip()):
        fail(422, "invalid_email", "That email address does not look right.")
    if is_test(ctx):
        o = PublicObject(id=f"{SANDBOX}{uuid.uuid4().hex[:10]}", kind="sandbox_meeting", data={
            "id": None, "name": body.name, "email": body.email, "status": "scheduled", "date": body.date, "time": body.time,
            "timezone": body.timezone or "Europe/London", "duration_minutes": body.duration_minutes or 15, "event_type": body.event_type,
            "format": body.format, "platform": "Test", "video_link": "https://meet.example.test/abc", "booked_by": "api",
            "created_at": datetime.utcnow().isoformat() + "Z"})
        o.data = {**o.data, "id": o.id}
        db.add(o)
        await db.commit()
        from app.services.webhook_dispatcher import dispatch_event

        dispatch_event(ctx["org_id"], "meeting.booked", {"meeting": o.data}, test=True)
        return {**o.data, "test": True}
    from app.services.calendar_service import calendar_service

    res = await calendar_service.create_booking(
        db=db, prospect_name=body.name.strip(), attendee_email=body.email.strip(), date_str=body.date, time_str=body.time,
        event_type_slug=body.event_type, duration_minutes=body.duration_minutes, notes=body.notes or "", mission_name="API",
        format_type=body.format, prospect_timezone=body.timezone, prospect_phone=body.phone, time_is_prospect_local=bool(body.timezone))
    if not res.get("success"):
        if res.get("error") == "outside_hours_or_taken":
            fail(409, "slot_unavailable", "That time is not free. Pick one of the open times.", available_times=res.get("availableSlots", []))
        fail(502, "could_not_book", res.get("message") or res.get("error") or "The meeting could not be booked.")
    meeting = await _meeting(db, res["bookingId"])
    if body.lead_id:
        from app.services.connection_handlers import on_meeting_booked
        from app.services.connections import resolve_lead_id

        found = await resolve_lead_id(db, body.lead_id)
        if found:
            meeting.lead_id = found
            await on_meeting_booked(db, meeting)
            await db.commit()
    return booked_payload(meeting)


@router.get("")
async def list_meetings(request: Request, when: Literal["all", "upcoming", "past"] = "all", status: Optional[str] = None,
                        booked_by: Optional[Literal["api", "ai_call", "app"]] = None, limit: int = 20, cursor: str = "",
                        db: AsyncSession = Depends(get_db)):
    """Your meetings, newest first, including ones booked by AI calls."""
    ctx = await authorize(request, db, "calendar:book")
    lim, off = page_args(limit, cursor)
    if is_test(ctx):
        rows = (await db.execute(select(PublicObject).where(PublicObject.kind == "sandbox_meeting").order_by(PublicObject.created_at.desc())
                                 .offset(off).limit(lim + 1))).scalars().all()
        return page_of([{**o.data, "test": True} for o in rows], lim, off)
    q = select(Meeting).order_by(Meeting.created_at.desc())
    rows = (await db.execute(q.offset(off).limit((lim + 1) * (3 if (when != "all" or status or booked_by) else 1)))).scalars().all()
    items = [booked_payload(m) for m in rows]
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    when_of = lambda i: i["starts_at"] or f'{i["date"]}T{i["time"]}:00Z'  # noqa: E731
    if when == "upcoming":
        items = [i for i in items if when_of(i) >= now and i["status"] == "scheduled"]
    elif when == "past":
        items = [i for i in items if when_of(i) < now]
    if status:
        items = [i for i in items if i["status"] == status]
    if booked_by:
        items = [i for i in items if i["booked_by"] == booked_by]
    return page_of(items, lim, off)


@router.get("/{meeting_id}")
async def get_one(meeting_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await authorize(request, db, "calendar:book")
    if meeting_id.startswith(SANDBOX):
        o = await db.get(PublicObject, meeting_id)
        if not o:
            fail(404, "not_found", f"Meeting '{meeting_id}' not found.")
        return {**o.data, "test": True}
    return booked_payload(await _meeting(db, meeting_id))


@router.patch("/{meeting_id}")
async def change(meeting_id: str, body: ChangeIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Cancel a meeting, or move it to another open time."""
    ctx = await authorize(request, db, "calendar:book")
    if body.action == "reschedule":
        if not body.date or not body.time:
            fail(422, "invalid_request", "reschedule needs `date` and `time`.")
        _check_when(body.date, body.time)
    if meeting_id.startswith(SANDBOX):
        o = await db.get(PublicObject, meeting_id)
        if not o:
            fail(404, "not_found", f"Meeting '{meeting_id}' not found.")
        d = dict(o.data)
        if body.action == "cancel":
            d.update(status="cancelled", cancellation_reason=body.reason or "Cancelled")
        else:
            d.update(date=body.date, time=body.time, status="scheduled")
        o.data = d
        await db.commit()
        return {**d, "test": True}
    from app.services.calendar_service import calendar_service

    m = await _meeting(db, meeting_id)
    if body.action == "cancel":
        if m.status == "cancelled":
            return booked_payload(m)
        res = await calendar_service.cancel_booking(db, m.id, reason=body.reason or "Cancelled through the API")
    else:
        if m.status == "cancelled":
            fail(409, "cancelled", "This meeting was cancelled. Book a new one.")
        res = await calendar_service.reschedule_booking(db, m.id, new_date=body.date, new_time=body.time, reason=body.reason or "")
    if not res.get("success"):
        if res.get("error") == "outside_hours_or_taken":
            fail(409, "slot_unavailable", "That time is not free. Pick one of the open times.", available_times=res.get("availableSlots", []))
        fail(502, "could_not_change", res.get("message") or res.get("error") or "The meeting could not be changed.")
    await db.refresh(m)
    return booked_payload(m)
