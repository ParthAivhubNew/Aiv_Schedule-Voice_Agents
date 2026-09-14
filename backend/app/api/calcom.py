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
    buffer_before: Optional[int] = None
    buffer_after: Optional[int] = None
    auto_email_attendee: Optional[bool] = None
    auto_email_host: Optional[bool] = None

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
    st = await calendar_service.get_or_create_settings(db)
    return {
        "host_email": st.host_email,
        "host_name": st.host_name,
        "api_key": st.api_key,
        "base_url": st.base_url,
        "default_event_type_slug": st.default_event_type_slug,
        "default_duration": st.default_duration,
        "default_platform": st.default_platform,
        "timezone": st.timezone,
        "working_hours_start": st.working_hours_start,
        "working_hours_end": st.working_hours_end,
        "working_days": st.working_days,
        "buffer_before": st.buffer_before,
        "buffer_after": st.buffer_after,
        "auto_email_attendee": st.auto_email_attendee,
        "auto_email_host": st.auto_email_host
    }

@router.post("/settings")
async def update_settings(payload: SettingsPayload, db: AsyncSession = Depends(get_db)):
    data = payload.dict(exclude_unset=True)
    st = await calendar_service.save_settings(db, data)
    return {
        "success": True,
        "settings": {
            "host_email": st.host_email,
            "host_name": st.host_name,
            "api_key": st.api_key,
            "base_url": st.base_url,
            "default_event_type_slug": st.default_event_type_slug,
            "default_duration": st.default_duration,
            "default_platform": st.default_platform,
            "timezone": st.timezone,
            "working_hours_start": st.working_hours_start,
            "working_hours_end": st.working_hours_end,
            "working_days": st.working_days,
            "buffer_before": st.buffer_before,
            "buffer_after": st.buffer_after,
            "auto_email_attendee": st.auto_email_attendee,
            "auto_email_host": st.auto_email_host
        }
    }

@router.post("/test-connection")
async def test_calcom_connection(db: AsyncSession = Depends(get_db)):
    return await calendar_service.check_calcom_status(db)
