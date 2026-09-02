from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import Meeting
from app.schemas.schemas import MeetingSchema
from typing import List, Dict, Any

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
        "duration": m.duration,
        "status": m.status,
        "fit": m.fit,
        "channel": m.channel,
        "format": m.format,
        "platform": m.platform,
        "videoLink": m.video_link,
        "dialIn": m.dial_in,
        "address": m.address,
        "host": m.host,
        "attendee": m.attendee,
        "prep": m.prep,
        "outcome": m.outcome,
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
