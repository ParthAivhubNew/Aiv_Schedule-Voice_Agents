from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import LiveCall, CallLog, Meeting, ScheduleItem, Notification, Prospect, ContactRegistry
from app.services.call_simulator import extract_requested_time
from app.services.identity import find_identity_match
from app.websockets.call_hub import call_hub
from datetime import datetime
import uuid

router = APIRouter(prefix="/calls", tags=["Calls"])

@router.get("/live", response_model=list[dict])
async def get_live_calls(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LiveCall))
    calls = result.scalars().all()
    
    return [{
        "id": c.id,
        "missionId": c.mission_id,
        "prospectId": c.prospect_id,
        "prospect": c.prospect,
        "mission": c.mission,
        "state": c.state,
        "channel": c.channel,
        "duration": c.duration,
        "flag": c.flag,
        "taken": c.taken,
        "listening": c.listening,
        "confirmingEnd": c.confirming_end,
        "ended": c.ended,
        "booked": c.booked,
        "transcript": c.transcript or [],
    } for c in calls]

@router.post("/live/{call_id}/listen")
async def toggle_listen(call_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
    call = res.scalars().first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
        
    call.listening = not call.listening
    await db.commit()
    await call_hub.broadcast("call_updated", {"callId": call_id, "listening": call.listening})
    return {"status": "ok", "listening": call.listening}

@router.post("/live/{call_id}/takeover")
async def toggle_takeover(call_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
    call = res.scalars().first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
        
    call.taken = not call.taken
    await db.commit()
    await call_hub.broadcast("call_updated", {"callId": call_id, "taken": call.taken})
    return {"status": "ok", "taken": call.taken}

@router.post("/live/{call_id}/confirm-booking")
async def confirm_booking_from_call(call_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
    call = res.scalars().first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
        
    call.booked = True
    call.ended = True
    call.state = "ended"
    
    # 1. Update prospect status
    if call.prospect_id:
        p_res = await db.execute(select(Prospect).where(Prospect.id == call.prospect_id))
        p = p_res.scalars().first()
        if p:
            p.status = "meeting_booked"
            p.note = "Meeting booked — Thu 2:00 PM"
            
    # 2. Add to Schedule
    sched = ScheduleItem(
        id=f"s_{uuid.uuid4().hex[:6]}",
        day="Thu, 3 Sep",
        time="14:00",
        prospect=call.prospect,
        mission=call.mission,
        window="09:00–17:30",
        status="completed"
    )
    db.add(sched)
    
    # 3. Add to Meetings with transcript conversion
    call_trans_objects = []
    for line in (call.transcript or []):
        is_ai = line.startswith("AI:")
        clean_text = line.replace("AI:", "").replace("Prospect:", "").strip()
        call_trans_objects.append({"who": "ai" if is_ai else "them", "text": clean_text})
        
    meeting = Meeting(
        id=f"mt_{uuid.uuid4().hex[:6]}",
        prospect=call.prospect,
        mission=call.mission,
        date="Thu 3 Sep",
        time="14:00",
        duration="15 min",
        status="upcoming",
        fit=92,
        channel=call.channel,
        format="video",
        platform="Google Meet",
        video_link="meet.google.com/aiv-booked-demo",
        host="Jitendra S.",
        attendee="Ops Lead",
        prep=f"Meeting confirmed directly from live outreach session on {call.mission}.",
        call_transcript=call_trans_objects
    )
    db.add(meeting)
    
    # 4. Append to Call Log
    call_log = CallLog(
        id=f"cl_{uuid.uuid4().hex[:6]}",
        canonical_name=call.prospect,
        listed_as=call.prospect,
        channel=call.channel,
        mission=call.mission,
        started_at=datetime.utcnow().strftime("%d %b %Y, %H:%M"),
        ended_at=datetime.utcnow().strftime("%d %b %Y, %H:%M"),
        duration=call.duration,
        outcome="meeting_booked",
        requested_follow_up={"day": "Thu 3 Sep", "time": "14:00", "exactWords": "Thursday afternoon works fine."},
        words_locked=True,
        transcript=call_trans_objects
    )
    db.add(call_log)
    
    # 5. Add Notification
    notif = Notification(
        id=f"n_{uuid.uuid4().hex[:6]}",
        text=f"Meeting booked with {call.prospect} — added to Schedule & Meetings",
        type="success"
    )
    db.add(notif)
    
    await db.commit()
    
    await call_hub.broadcast("booking_confirmed", {"callId": call_id, "prospect": call.prospect})
    return {"status": "ok", "message": "Meeting booked successfully"}

@router.get("/logs", response_model=list[dict])
async def get_call_logs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CallLog).order_by(CallLog.created_at.desc()))
    logs = result.scalars().all()
    
    return [{
        "id": l.id,
        "registryId": l.registry_id,
        "canonicalName": l.canonical_name,
        "listedAs": l.listed_as,
        "personCanonical": l.person_canonical,
        "personListedAs": l.person_listed_as,
        "channel": l.channel,
        "mission": l.mission,
        "startedAt": l.started_at,
        "endedAt": l.ended_at,
        "duration": l.duration,
        "outcome": l.outcome,
        "requestedFollowUp": l.requested_follow_up,
        "wordsLocked": l.words_locked,
        "transcript": l.transcript or []
    } for l in logs]
