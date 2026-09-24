from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import Meeting
from app.schemas.schemas import MeetingSchema
from typing import List, Dict, Any
from datetime import datetime
import re

def _resolve_meeting_status(m: Meeting) -> str:
    raw = (m.status or "upcoming").lower()
    if raw in ("completed", "done", "converted", "not_fit", "cancelled", "canceled"):
        return m.status
    try:
        import dateutil.parser
        d_str = str(m.date or m.prospect_date or "").strip()
        t_str = str(m.time or m.prospect_time or "").strip()
        combo = f"{d_str} {t_str}".strip()
        if combo:
            mtg_dt = dateutil.parser.parse(combo, fuzzy=True)
            if mtg_dt < datetime.now():
                return "completed"
    except Exception:
        pass
    return m.status or "upcoming"

router = APIRouter(prefix="/meetings", tags=["Meetings"])

@router.get("", response_model=list[dict])
async def list_meetings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Meeting).order_by(Meeting.created_at.desc()))
    meetings = result.scalars().all()
    
    return [{
        "id": m.id,
        "prospect": m.prospect,
        "mission": m.mission,
        "date": m.date,
        "time": m.time,
        "hostTimezone": m.host_timezone or "Europe/London",
        "prospectTimezone": m.prospect_timezone or m.host_timezone or "Europe/London",
        "prospectDate": m.prospect_date or m.date,
        "prospectTime": m.prospect_time or m.time,
        "duration": m.duration,
        "status": _resolve_meeting_status(m),
        "fit": m.fit,
        "channel": m.channel,
        "format": m.format,
        "platform": m.platform,
        "videoLink": m.video_link,
        "dialIn": m.dial_in,
        "address": m.address,
        "host": m.host,
        "attendee": m.attendee,
        "attendeeEmail": m.attendee_email or "",
        "prep": m.prep,
        "outcome": m.outcome,
        "cancellationReason": m.cancellation_reason or "",
        "callTranscript": m.call_transcript or [],
        "meetingTranscript": m.meeting_transcript
    } for m in meetings]

@router.post("/{meeting_id}/outcome")
async def log_meeting_outcome(meeting_id: str, payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = res.scalars().first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
        
    meeting.status = payload.get("status", meeting.status)
    meeting.outcome = payload.get("outcome", meeting.outcome)
    await db.commit()
    return {"status": "ok", "meetingId": meeting_id}

@router.post("/{meeting_id}/transcript")
async def save_meeting_transcript(meeting_id: str, payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = res.scalars().first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
        
    transcript = payload.get("transcript", [])
    meeting.meeting_transcript = transcript
    await db.commit()
    return {"status": "ok", "savedLines": len(transcript)}
