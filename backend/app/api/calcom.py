from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from app.database import get_db
from app.models.models import Meeting, MeetingEventType, CalcomSetting
from app.services.calendar_service import calendar_service

router = APIRouter(prefix="/calcom", tags=["Calcom Scheduler"])

class EventTypePayload(BaseModel):
    id: Optional[str] = None
    title: str
    slug: Optional[str] = None
    length: int = 15
    description: Optional[str] = ""
    locationType: Optional[str] = "google_meet"
    color: Optional[str] = "#10B981"
    isActive: Optional[bool] = True

class BookMeetingPayload(BaseModel):
    prospectName: str
    attendeeEmail: str
    date: str
    time: str
    hostEmail: Optional[str] = None
    eventTypeSlug: Optional[str] = "15-min-discovery"
    durationMinutes: Optional[int] = None
    notes: Optional[str] = ""
    missionName: Optional[str] = "Meeting Scheduler"
    platform: Optional[str] = "Google Meet"
    format: Optional[str] = "video"

class CancelBookingPayload(BaseModel):
    reason: Optional[str] = "Cancelled by host/attendee"

class SettingsPayload(BaseModel):
    host_email: Optional[str] = None
    host_name: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    default_event_type_slug: Optional[str] = None
    default_duration: Optional[int] = None
    default_platform: Optional[str] = None
    timezone: Optional[str] = None
    working_hours_start: Optional[str] = None
    working_hours_end: Optional[str] = None
    working_days: Optional[List[str]] = None
    working_hours_by_day: Optional[Dict[str, Any]] = None
    slot_step_minutes: Optional[int] = None
    flex_minutes: Optional[int] = None
    buffer_before: Optional[int] = None
    buffer_after: Optional[int] = None
    auto_email_attendee: Optional[bool] = None
    auto_email_host: Optional[bool] = None
    prospect_timezone_override: Optional[str] = None

@router.get("/overview")
async def get_overview(db: AsyncSession = Depends(get_db)):
    return await calendar_service.get_overview_stats(db)

@router.get("/event-types")
async def list_event_types(db: AsyncSession = Depends(get_db)):
    return await calendar_service.get_event_types(db)

@router.post("/event-types")
async def create_or_update_event_type(payload: EventTypePayload, db: AsyncSession = Depends(get_db)):
    return await calendar_service.create_or_update_event_type(db, payload.dict())

@router.delete("/event-types/{event_id}")
async def delete_event_type(event_id: str, db: AsyncSession = Depends(get_db)):
    success = await calendar_service.delete_event_type(db, event_id)
    return {"success": success, "deletedId": event_id}

@router.get("/slots")
async def get_slots(
    date: str = Query(..., description="YYYY-MM-DD"),
    event_type_slug: str = Query("15-min-discovery"),
    db: AsyncSession = Depends(get_db)
):
    slots = await calendar_service.get_available_slots(db, date_str=date, event_type_slug=event_type_slug)
    return {"date": date, "eventTypeSlug": event_type_slug, "slots": slots}

@router.get("/bookings")
async def list_bookings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Meeting).order_by(Meeting.created_at.desc()))
    meetings = result.scalars().all()
    return [{
        "id": m.id,
        "prospect": m.prospect,
        "attendeeEmail": m.attendee_email or "",
        "host": m.host,
        "hostEmail": m.host_email or "",
        "mission": m.mission,
        "date": m.date,
        "time": m.time,
        "hostTimezone": m.host_timezone or "Europe/London",
        "prospectTimezone": m.prospect_timezone or m.host_timezone or "Europe/London",
        "prospectDate": m.prospect_date or m.date,
        "prospectTime": m.prospect_time or m.time,
        "duration": m.duration,
        "status": m.status,
        "fit": m.fit,
        "channel": m.channel,
        "format": m.format,
        "platform": m.platform,
        "videoLink": m.video_link,
        "dialIn": m.dial_in,
        "calcomBookingId": m.calcom_booking_id,
        "eventTypeSlug": m.event_type_slug,
        "prep": m.prep,
        "cancellationReason": m.cancellation_reason,
        "createdAt": m.created_at.isoformat() if m.created_at else None
    } for m in meetings]

@router.post("/book")
async def book_meeting(payload: BookMeetingPayload, db: AsyncSession = Depends(get_db)):
    if not payload.prospectName or not payload.attendeeEmail:
        raise HTTPException(status_code=400, detail="prospectName and attendeeEmail are required")
    if not payload.date or not payload.time:
        raise HTTPException(status_code=400, detail="date and time are required")
        
    res = await calendar_service.create_booking(
        db=db,
        prospect_name=payload.prospectName,
        attendee_email=payload.attendeeEmail,
        date_str=payload.date,
        time_str=payload.time,
        host_email=payload.hostEmail,
        event_type_slug=payload.eventTypeSlug or "15-min-discovery",
        duration_minutes=payload.durationMinutes,
        notes=payload.notes or "",
        mission_name=payload.missionName or "Meeting Scheduler",
        format_type=payload.format or "video",
        platform=payload.platform or "Google Meet"
    )
    return res

@router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: str, payload: CancelBookingPayload, db: AsyncSession = Depends(get_db)):
    res = await calendar_service.cancel_booking(db, booking_id, reason=payload.reason or "User requested cancellation")
    if not res.get("success"):
        raise HTTPException(status_code=404, detail=res.get("error", "Booking not found"))
    return res

@router.get("/settings")
async def get_settings(db: AsyncSession = Depends(get_db)):
    from app.services.secret_box import mask_secret, open_secret
    st = await calendar_service.get_or_create_settings(db)
    plain = open_secret(st.api_key) if st.api_key else ""
    return {
        "host_email": st.host_email,
        "host_name": st.host_name,
        "api_key": mask_secret(plain) if plain else None,
        "has_api_key": bool(plain or st.api_key),
        "base_url": st.base_url,
        "default_event_type_slug": st.default_event_type_slug,
        "default_duration": st.default_duration,
        "default_platform": st.default_platform,
        "timezone": st.timezone,
        "working_hours_start": st.working_hours_start,
        "working_hours_end": st.working_hours_end,
        "working_days": st.working_days,
        "working_hours_by_day": st.working_hours_by_day or {},
        "slot_step_minutes": st.slot_step_minutes or 15,
        "flex_minutes": st.flex_minutes or 0,
        "buffer_before": st.buffer_before,
        "buffer_after": st.buffer_after,
        "auto_email_attendee": st.auto_email_attendee,
        "auto_email_host": st.auto_email_host,
        "prospect_timezone_override": st.prospect_timezone_override or "",
    }

@router.post("/settings")
async def update_settings(payload: SettingsPayload, db: AsyncSession = Depends(get_db)):
    from app.services.secret_box import mask_secret, open_secret
    data = payload.dict(exclude_unset=True)
    st = await calendar_service.save_settings(db, data)
    plain = open_secret(st.api_key) if st.api_key else ""
    return {
        "success": True,
        "settings": {
            "host_email": st.host_email,
            "host_name": st.host_name,
            "api_key": mask_secret(plain) if plain else None,
            "has_api_key": bool(plain or st.api_key),
            "base_url": st.base_url,
            "default_event_type_slug": st.default_event_type_slug,
            "default_duration": st.default_duration,
            "default_platform": st.default_platform,
            "timezone": st.timezone,
            "working_hours_start": st.working_hours_start,
            "working_hours_end": st.working_hours_end,
            "working_days": st.working_days,
            "working_hours_by_day": st.working_hours_by_day or {},
            "slot_step_minutes": st.slot_step_minutes or 15,
            "flex_minutes": st.flex_minutes or 0,
            "buffer_before": st.buffer_before,
            "buffer_after": st.buffer_after,
            "auto_email_attendee": st.auto_email_attendee,
            "auto_email_host": st.auto_email_host,
            "prospect_timezone_override": st.prospect_timezone_override or "",
        }
    }

@router.post("/test-connection")
async def test_calcom_connection(db: AsyncSession = Depends(get_db)):
    return await calendar_service.check_calcom_status(db)


from fastapi.responses import Response

class RescheduleBookingPayload(BaseModel):
    date: str
    time: str
    reason: Optional[str] = ""

@router.post("/bookings/{booking_id}/reschedule")
async def reschedule_booking(booking_id: str, payload: RescheduleBookingPayload, db: AsyncSession = Depends(get_db)):
    res = await calendar_service.reschedule_booking(db, booking_id, new_date=payload.date, new_time=payload.time, reason=payload.reason or "")
    if not res.get("success"):
        raise HTTPException(status_code=404, detail=res.get("error", "Booking not found"))
    return res

@router.get("/bookings/{booking_id}/ics")
async def download_booking_ics(booking_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Meeting).where(Meeting.id == booking_id))
    meeting = result.scalars().first()
    if not meeting:
        res2 = await db.execute(select(Meeting).where(Meeting.calcom_booking_id == booking_id))
        meeting = res2.scalars().first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
        
    ics_text = calendar_service.generate_ics(meeting)
    return Response(
        content=ics_text,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="meeting-{meeting.id}.ics"'}
    )


class CommunicationAccountPayload(BaseModel):
    id: Optional[str] = None
    provider: str = "google"  # google, outlook, smtp, zoom
    name: Optional[str] = None
    status: Optional[str] = "connected"
    email: Optional[str] = None
    senderName: Optional[str] = None
    apiKey: Optional[str] = None
    password: Optional[str] = None
    config: Optional[Dict[str, Any]] = None

@router.get("/accounts")
async def list_communication_accounts(db: AsyncSession = Depends(get_db)):
    return await calendar_service.get_communication_accounts(db)

@router.post("/accounts")
async def save_communication_account(payload: CommunicationAccountPayload, db: AsyncSession = Depends(get_db)):
    data = payload.dict()
    cfg = data.get("config") or {}
    if payload.email:
        cfg["email"] = payload.email
    if payload.senderName:
        cfg["sender_name"] = payload.senderName
    cfg["provider"] = payload.provider
    data["config"] = cfg
    return await calendar_service.save_communication_account(db, data)

@router.delete("/accounts/{account_id}")
async def delete_communication_account(account_id: str, db: AsyncSession = Depends(get_db)):
    success = await calendar_service.delete_communication_account(db, account_id)
    return {"success": success, "accountId": account_id}

@router.post("/accounts/{account_id}/test")
async def test_communication_account(account_id: str, db: AsyncSession = Depends(get_db)):
    return await calendar_service.test_communication_account(db, account_id)
