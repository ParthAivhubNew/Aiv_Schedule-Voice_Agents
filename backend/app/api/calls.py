from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from app.database import get_db
from app.models.models import LiveCall, CallLog, Meeting, ScheduleItem, Notification, Prospect, ContactRegistry, Connection, CompanyProfile
from app.services.call_simulator import extract_requested_time
from app.services.identity import find_identity_match
from app.websockets.call_hub import call_hub
from app.services.telephony_provider import carrier_registry, normalize_phone_number
from app.services.xai_voice_service import _run_simulated_xai_session
from app.services.process_logger import log_process_event
from app.config import settings
from datetime import datetime, timedelta
import uuid
import asyncio
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

router = APIRouter(prefix="/calls", tags=["Calls"])

@router.get("/live", response_model=list[dict])
async def get_live_calls(include_ended: bool = False, db: AsyncSession = Depends(get_db)):
    """
    Returns only active live conversations. Auto-purges dead/stale calls
    (calls that ended or stuck in dialing > 10 mins).
    """
    cutoff = datetime.utcnow() - timedelta(minutes=10)
    # Purge stale dead calls
    await db.execute(
        delete(LiveCall).where(
            (LiveCall.ended == True) |
            (LiveCall.state.in_(["ended", "failed", "canceled"])) |
            ((LiveCall.state == "calling") & (LiveCall.created_at < cutoff))
        )
    )
    await db.commit()

    result = await db.execute(select(LiveCall).order_by(LiveCall.created_at.desc()))
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

@router.delete("/live/{call_id}")
async def delete_live_call(call_id: str, db: AsyncSession = Depends(get_db)):
    """Deletes a dead or stale live call from the database."""
    await db.execute(delete(LiveCall).where(LiveCall.id == call_id))
    await db.commit()
    await call_hub.broadcast("call_removed", {"callId": call_id})
    return {"status": "ok", "deleted": call_id}

@router.post("/live/clear")
@router.delete("/live")
async def clear_dead_calls(db: AsyncSession = Depends(get_db)):
    """Purges all ended, failed, or stale calls from the Live Activity board."""
    await db.execute(delete(LiveCall))
    await db.commit()
    await call_hub.broadcast("calls_cleared", {})
    return {"status": "ok", "message": "All calls purged from Live Activity."}


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


# ----------------------------------------------------------------------
# PLUGGABLE OUTBOUND CALLING ENGINE
# ----------------------------------------------------------------------

class OutboundDialRequest(BaseModel):
    to_number: str
    from_number: Optional[str] = None
    prospect_name: Optional[str] = None
    mission_id: Optional[str] = None
    mission_title: Optional[str] = None
    carrier: Optional[str] = None
    account_sid: Optional[str] = None
    api_key: Optional[str] = None
    bridge_sip_uri: Optional[str] = None


@router.get("/outbound/carriers")
async def get_outbound_carriers(db: AsyncSession = Depends(get_db)):
    """Returns available telephony carrier plugins and the active configured carrier."""
    c_res = await db.execute(select(Connection).where(Connection.group_name == "Telephony"))
    conn = c_res.scalars().first()
    active_carrier = conn.name.lower() if conn else "twilio"
    return {
        "active_carrier": active_carrier,
        "carriers": carrier_registry.list_carriers()
    }


@router.post("/outbound/dial")
async def dial_outbound_call(
    req: OutboundDialRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Modular outbound dialing engine:
    1. Normalizes destination and caller numbers.
    2. Resolves selected or active carrier adapter (Twilio, Telnyx, Generic SIP, Simulation).
    3. Retrieves carrier credentials from DB Connection or payload or settings.
    4. Creates a LiveCall record immediately in SQLite so the frontend tracks it.
    5. Dispatches outbound call via carrier plugin with TwiML SIP bridge to xAI.
    6. Broadcasts call_started event to CallHub WebSockets.
    """
    to_raw = req.to_number.strip()
    if not to_raw or len(to_raw) < 7:
        raise HTTPException(status_code=400, detail="A valid phone number (at least 7 digits) is required.")

    to_clean = normalize_phone_number(to_raw)

    # 1. Determine From / Caller ID number
    from_clean = req.from_number.strip() if req.from_number else None
    if not from_clean:
        prof_res = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
        profile = prof_res.scalars().first()
        if profile and profile.caller_id:
            from_clean = profile.caller_id
        else:
            conn_res = await db.execute(select(Connection).where(Connection.group_name == "Telephony"))
            tele_conn = conn_res.scalars().first()
            if tele_conn and tele_conn.config and isinstance(tele_conn.config, dict):
                from_clean = tele_conn.config.get("phoneNumber")

    if not from_clean:
        from_clean = settings.TWILIO_PHONE_NUMBER or "+447307216767"
    from_clean = normalize_phone_number(from_clean)

    # 2. Determine carrier plugin
    carrier_choice = (req.carrier or "").strip().lower()
    conn_res = await db.execute(select(Connection).where(Connection.group_name == "Telephony"))
    tele_conn = conn_res.scalars().first()

    if not carrier_choice:
        if tele_conn:
            carrier_choice = tele_conn.name.lower()
        else:
            carrier_choice = "twilio"

    # 3. Resolve credentials
    stored_cfg = tele_conn.config if (tele_conn and isinstance(tele_conn.config, dict)) else {}
    sid = req.account_sid or stored_cfg.get("account_sid") or settings.TWILIO_ACCOUNT_SID
    token = req.api_key or stored_cfg.get("api_key") or settings.TWILIO_AUTH_TOKEN

    credentials = {
        "account_sid": sid,
        "api_key": token,
        "auth_token": token,
        "carrier": carrier_choice
    }

    # If twilio requested but credentials missing and not explicitly simulation,
    # prompt user clearly with the exact resolution
    if "twilio" in carrier_choice and (not sid or not token):
        if not req.carrier or carrier_choice == "twilio":
            raise HTTPException(
                status_code=400,
                detail="Twilio Account SID & Auth Token are not yet configured. Please enter them or select 'Local Testing Simulator' to test the flow immediately."
            )

    # 4. Resolve bridge SIP URI
    bridge_sip = req.bridge_sip_uri or f"sip:{from_clean}@{settings.XAI_SIP_FQDN};transport=tls"

    # 5. Create LiveCall entry
    prospect_label = req.prospect_name.strip() if req.prospect_name else f"Prospect ({to_clean[-4:]})"
    mission_label = req.mission_title or "Direct Outbound Outreach"
    call_id = f"call_{uuid.uuid4().hex[:8]}"

    live_call = LiveCall(
        id=call_id,
        mission_id=req.mission_id or "m_outbound",
        prospect_id=None,
        prospect=prospect_label,
        mission=mission_label,
        state="calling",
        channel="voice",
        duration="00:01",
        listening=False,
        taken=False,
        confirming_end=False,
        ended=False,
        booked=False,
        transcript=[
            f"AI: [Outbound call initiated via {carrier_choice.upper()} to {to_clean}]",
            f"System: Ringing {to_clean} from {from_clean}..."
        ]
    )
    db.add(live_call)
    await db.commit()

    # Broadcast call started immediately to frontend
    await call_hub.broadcast("call_started", {
        "callId": call_id,
        "caller": from_clean,
        "prospect": prospect_label,
        "state": "calling",
        "duration": "00:01"
    })

    # 6. Execute Dial via Carrier Plugin
    adapter = carrier_registry.get_adapter(carrier_choice)
    try:
        dial_res = await adapter.dial_outbound(
            to_number=to_clean,
            from_number=from_clean,
            bridge_sip_uri=bridge_sip,
            metadata={"call_id": call_id, "prospect": prospect_label},
            credentials=credentials
        )

        carrier_sid = dial_res.get("call_id")
        if carrier_sid:
            live_call.carrier_sid = carrier_sid
            live_call.transcript = (live_call.transcript or []) + [f"System: Provider Call SID: {carrier_sid}"]
            await db.commit()

        # If simulation mode, launch the simulated conversation session in background
        if dial_res.get("simulated") or "sim" in carrier_choice:
            background_tasks.add_task(_run_simulated_xai_session, call_id, to_clean)

        return {
            "success": True,
            "call_id": call_id,
            "carrier_call_id": carrier_sid,
            "carrier": adapter.display_name,
            "status": dial_res.get("status", "ringing"),
            "to": to_clean,
            "from": from_clean,
            "bridge_sip_uri": bridge_sip,
            "message": f"Outbound call initiated to {to_clean} via {adapter.display_name}."
        }
    except Exception as exc:
        live_call.state = "failed"
        live_call.ended = True
        live_call.transcript = (live_call.transcript or []) + [f"System: Dial failed - {str(exc)}"]
        await db.commit()
        await call_hub.broadcast("call_ended", {"callId": call_id, "reason": str(exc)})
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/twilio/status-callback")
async def twilio_status_callback(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Receives real-time call lifecycle events from Twilio (ringing, answered, completed, failed)
    and broadcasts updates to the Live Activity dashboard.
    """
    form = await request.form()
    call_sid = form.get("CallSid", "")
    call_status = form.get("CallStatus", "").lower()
    duration = form.get("CallDuration") or form.get("Duration") or "0"
    sip_code = form.get("SipResponseCode")
    dial_status = form.get("DialCallStatus")

    await log_process_event(
        subsystem="telephony",
        process_name="twilio_status_callback",
        message=f"Twilio status: {call_sid} -> {call_status} (duration: {duration}s, sip: {sip_code}, dial: {dial_status})",
        level="INFO",
        details={"callSid": call_sid, "status": call_status, "duration": duration, "sipCode": sip_code, "dialStatus": dial_status}
    )

    # Try to match by carrier_sid first (most reliable), then fallback to transcript search
    res = await db.execute(select(LiveCall).where(LiveCall.carrier_sid == call_sid))
    matched = res.scalars().first()

    if not matched:
        # Fallback: search all recent calls
        res2 = await db.execute(select(LiveCall).order_by(LiveCall.created_at.desc()))
        calls = res2.scalars().all()
        for c in calls:
            if c.id == call_sid or (c.transcript and any(call_sid in str(t) for t in c.transcript)):
                matched = c
                break
        if not matched and calls:
            for c in calls:
                if not c.ended:
                    matched = c
                    break

    if matched:
        if call_status in ["in-progress", "answered"]:
            matched.state = "pitching"
            matched.transcript = (matched.transcript or []) + ["System: Call answered by recipient. AI voice representative active."]
        elif call_status in ["completed", "canceled", "failed", "no-answer", "busy"]:
            matched.state = "ended"
            matched.ended = True
            dur_int = int(duration) if duration.isdigit() else 1
            matched.duration = f"{dur_int//60:02d}:{dur_int%60:02d}"
            note = f"Call finished ({matched.duration}). Status: {call_status}."
            if sip_code:
                note += f" SIP Code: {sip_code}."
            matched.transcript = (matched.transcript or []) + [f"System: {note}"]
        await db.commit()
        await call_hub.broadcast("call_updated", {
            "callId": matched.id,
            "state": matched.state,
            "duration": matched.duration,
            "ended": matched.ended
        })

    return {"status": "ok"}


@router.post("/twilio/dial-action")
async def twilio_dial_action(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Called by Twilio when the <Dial><Sip> bridge attempt finishes (completed, failed, busy, no-answer).
    If SIP failed, logs exact error and SIP response code without playing false fallbacks.
    """
    form = await request.form()
    call_sid = form.get("CallSid", "")
    dial_call_status = form.get("DialCallStatus", "").lower()
    dial_duration = form.get("DialCallDuration", "0")
    sip_code = form.get("DialCallSipResponseCode") or form.get("SipResponseCode")
    dial_call_sid = form.get("DialCallSid")

    error_msg = None
    if dial_call_status != "completed":
        if sip_code == "403":
            error_msg = "xAI SIP bridge rejected call (SIP 403 Forbidden). The phone number is not registered or authenticated on xAI."
        elif sip_code == "404":
            error_msg = "xAI SIP bridge destination not found (SIP 404 Not Found). Destination trunk or number not found on xAI."
        elif sip_code:
            error_msg = f"xAI SIP bridge failed with SIP Code {sip_code} ({dial_call_status})."
        else:
            error_msg = f"Twilio SIP dial attempt failed with status: {dial_call_status}."

    await log_process_event(
        subsystem="telephony",
        process_name="twilio_dial_action",
        message=error_msg or f"Twilio dial action finished successfully ({dial_call_status}, duration: {dial_duration}s)",
        level="ERROR" if error_msg else "SUCCESS",
        details={
            "callSid": call_sid,
            "dialCallSid": dial_call_sid,
            "dialStatus": dial_call_status,
            "sipCode": sip_code,
            "duration": dial_duration,
            "error": error_msg
        }
    )

    # Try to match by carrier_sid first (most reliable), then fallback
    res = await db.execute(select(LiveCall).where(LiveCall.carrier_sid == call_sid))
    matched = res.scalars().first()

    if not matched:
        res2 = await db.execute(select(LiveCall).order_by(LiveCall.created_at.desc()))
        calls = res2.scalars().all()
        for c in calls:
            if c.id == call_sid or (c.transcript and any(call_sid in str(t) for t in c.transcript)):
                matched = c
                break
        if not matched and calls:
            for c in calls:
                if not c.ended:
                    matched = c
                    break

    if matched:
        if error_msg:
            matched.state = "failed"
            matched.ended = True
            matched.transcript = (matched.transcript or []) + [f"System Crash: {error_msg}"]
        else:
            matched.state = "ended"
            matched.ended = True
            dur_int = int(dial_duration) if dial_duration.isdigit() else 0
            matched.duration = f"{dur_int//60:02d}:{dur_int%60:02d}"
            matched.transcript = (matched.transcript or []) + [f"System: Call concluded ({matched.duration})."]

        await db.commit()
        await call_hub.broadcast("call_updated", {
            "callId": matched.id,
            "state": matched.state,
            "duration": matched.duration,
            "ended": matched.ended,
            "error": error_msg
        })

    # Return clean hangup - no false fallback
    twiml_response = "<Response><Hangup/></Response>"
    return Response(content=twiml_response, media_type="application/xml")


