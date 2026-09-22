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
from app.services.outbound_dial import drain_mission_queue, launch_outbound_mission, place_outbound_call
from app.services.xai_voice_service import (
    _run_simulated_xai_session,
    notify_prospect_answered,
    alias_sip_first_call,
    start_bridged_voice_session,
)
from app.services.process_logger import log_process_event
from app.services.call_names import apply_names_to_log, clean_person_label, resolve_call_people
from app.config import settings
from datetime import datetime, timedelta
import logging
import uuid
import asyncio
import json
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

router = APIRouter(prefix="/calls", tags=["Calls"])
logger = logging.getLogger("calls_api")

@router.get("/live", response_model=list[dict])
async def get_live_calls(include_ended: bool = False, db: AsyncSession = Depends(get_db)):
    """
    Returns live conversations. Auto-purges dead/stale calls older than 10 minutes.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=10)
    # Only purge stale calls older than 10 mins (preserves newly concluded calls)
    await db.execute(
        delete(LiveCall).where(
            ((LiveCall.ended == True) & (LiveCall.created_at < cutoff)) |
            (LiveCall.state.in_(["ended", "failed", "canceled"]) & (LiveCall.created_at < cutoff)) |
            ((LiveCall.state == "calling") & (LiveCall.created_at < cutoff))
        )
    )
    await db.commit()

    if not include_ended:
        result = await db.execute(
            select(LiveCall)
            .where((LiveCall.ended == False) & (~LiveCall.state.in_(["ended", "failed", "canceled"])))
            .order_by(LiveCall.created_at.desc())
        )
    else:
        result = await db.execute(select(LiveCall).order_by(LiveCall.created_at.desc()))
    calls = result.scalars().all()
    
    out_calls = []
    now_utc = datetime.utcnow()
    for c in calls:
        dur = c.duration
        if not c.ended and c.state not in ["ended", "failed", "canceled"] and c.created_at:
            secs = max(0, int((now_utc - c.created_at).total_seconds()))
            dur = f"{secs // 60:02d}:{secs % 60:02d}"
        out_calls.append({
            "id": c.id,
            "missionId": c.mission_id,
            "prospectId": c.prospect_id,
            "prospect": c.prospect,
            "mission": c.mission,
            "state": c.state,
            "channel": c.channel,
            "duration": dur,
            "startedAt": c.created_at.isoformat() + "Z" if c.created_at else None,
            "flag": c.flag,
            "taken": c.taken,
            "listening": c.listening,
            "confirmingEnd": c.confirming_end,
            "ended": c.ended,
            "booked": c.booked,
            "transcript": c.transcript or [],
        })
    return out_calls

async def terminate_live_call(
    call_id: str,
    db: AsyncSession,
    *,
    ended_by: str = "supervisor",
) -> Dict[str, Any]:
    """Hang up carrier + close xAI + mark LiveCall ended + CallLog. Used by End Call API and agent end_call tool."""
    import re

    res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
    call = res.scalars().first()
    if not call:
        res2 = await db.execute(select(LiveCall).where(LiveCall.carrier_sid == call_id))
        call = res2.scalars().first()
    if not call:
        return {"ok": False, "error": "Call not found"}
    if call.ended:
        return {"ok": True, "callId": call.id, "alreadyEnded": True}

    carrier_sid = (call.carrier_sid or "").strip() or None
    if not carrier_sid:
        for line in call.transcript or []:
            m = re.search(r"\b(CA[0-9a-fA-F]{32})\b", str(line))
            if m:
                carrier_sid = m.group(1)
                call.carrier_sid = carrier_sid
                break
    if not carrier_sid and re.match(r"^CA[0-9a-fA-F]{32}$", call_id or ""):
        carrier_sid = call_id

    hung = False
    if carrier_sid:
        try:
            from app.services.outbound_dial import _resolve_carrier_and_creds
            carrier_choice, credentials, _ = await _resolve_carrier_and_creds(db, "twilio", None, None)
            adapter = carrier_registry.get_adapter(carrier_choice or "twilio")
            hung = await adapter.hangup_call(carrier_sid, credentials=credentials)
            if not hung:
                try:
                    hung = await adapter.hangup_call(carrier_sid, credentials=credentials)
                except Exception:
                    pass
            await log_process_event(
                subsystem="telephony",
                process_name="carrier_hangup_dispatched",
                message=(
                    f"Terminated carrier call {carrier_sid} on {carrier_choice} ({ended_by})."
                    if hung
                    else f"Hangup returned false for {carrier_sid} — MicroSIP may stay connected."
                ),
                level="INFO" if hung else "WARN",
                details={"callId": call.id, "carrierSid": carrier_sid, "hungUp": hung, "endedBy": ended_by},
            )
        except Exception as e:
            logger.warning(f"[EndCall] Carrier hangup error for {carrier_sid}: {e}")
    else:
        logger.warning(f"[EndCall] No carrier SID on {call.id} — cannot hang Twilio")

    call.ended = True
    call.state = "ended"
    call.confirming_end = False

    try:
        from app.websockets.media_stream import media_stream_hub
        for key in list(media_stream_hub.twilio_streams.keys()):
            canonical = media_stream_hub.resolve_canonical(key)
            if key in (call.id, carrier_sid, call_id) or canonical in (call.id, carrier_sid):
                ws = media_stream_hub.twilio_streams.pop(key, None)
                if ws:
                    try:
                        await ws.close()
                    except Exception:
                        pass
    except Exception as stream_err:
        logger.debug(f"[EndCall] media stream close: {stream_err}")

    try:
        from app.services.xai_voice_service import active_xai_sessions
        ws = active_xai_sessions.pop(call_id, None) or active_xai_sessions.pop(call.id, None)
        if carrier_sid:
            ws = ws or active_xai_sessions.pop(carrier_sid, None)
        if ws:
            try:
                await ws.send(json.dumps({"type": "response.cancel"}))
            except Exception:
                pass
            try:
                await ws.close()
            except Exception:
                pass
    except Exception:
        pass

    if call.created_at:
        secs = max(1, int((datetime.utcnow() - call.created_at).total_seconds()))
        call.duration = f"{secs // 60:02d}:{secs % 60:02d}"

    who = "agent after wrap-up" if ended_by == "agent" else "supervisor"
    call.transcript = (call.transcript or []) + [
        f"System: Call ended by {who}."
        + ("" if hung or not carrier_sid else " (Twilio hangup may have failed — hang up MicroSIP manually.)")
    ]

    try:
        from app.services.call_log_writer import upsert_call_log_from_live
        await upsert_call_log_from_live(
            db,
            call,
            outcome="completed" if ended_by == "agent" else "canceled",
            duration=call.duration,
            force_outcome=False,
        )
    except Exception as log_err:
        logger.warning(f"Could not write CallLog on end: {log_err}")

    mission_id = call.mission_id
    await db.commit()
    await call_hub.broadcast("call_ended", {"callId": call.id, "endedBy": ended_by})
    await call_hub.broadcast("call_updated", {"callId": call.id, "ended": True, "state": "ended", "duration": call.duration})
    if mission_id:
        asyncio.create_task(drain_mission_queue(mission_id))
    return {"ok": True, "callId": call.id, "duration": call.duration, "hungUp": hung}


@router.post("/live/{call_id}/end")
async def end_live_call(call_id: str, db: AsyncSession = Depends(get_db)):
    """
    Immediately terminates a live call: hangs up carrier leg, closes xAI session, marks ended, and records CallLog.
    """
    result = await terminate_live_call(call_id, db, ended_by="supervisor")
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error") or "Call not found")
    return {"status": "ok", "callId": result.get("callId"), "duration": result.get("duration")}

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
    from app.websockets.media_stream import media_stream_hub
    from app.services.xai_voice_service import notify_xai_takeover_state

    if call.taken:
        media_stream_hub.active_takeovers.add(call_id)
        call.transcript = (call.transcript or []) + [
            "System: ⚠️ SUPERVISOR TAKEOVER ACTIVE. Microphone live — AI voice rep muted."
        ]
        await notify_xai_takeover_state(call_id, taken=True)
    else:
        media_stream_hub.active_takeovers.discard(call_id)
        call.transcript = (call.transcript or []) + [
            "System: Supervisor relinquished control. AI voice rep re-enabled with full context."
        ]
        await notify_xai_takeover_state(call_id, taken=False, recent_transcript=call.transcript)

    await db.commit()
    await call_hub.broadcast("call_updated", {"callId": call_id, "taken": call.taken})
    return {"status": "ok", "taken": call.taken}

@router.post("/live/{call_id}/confirm-booking")
async def confirm_booking_from_call(call_id: str, db: AsyncSession = Depends(get_db)):
    """
    Book from what was actually said on the call (transcript) — not a fake fixed slot.
    Uses real calendar_service.create_booking so invite goes to host_email / attendee email.
    """
    import re
    from app.services.calendar_service import calendar_service, parse_spoken_date, _norm_time
    from app.services.timezone_service import now_in

    res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
    call = res.scalars().first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    raw_lines = call.transcript or []
    text_blob = "\n".join(
        (line if isinstance(line, str) else f"{line.get('who', '')}: {line.get('text', '')}")
        for line in raw_lines
    )

    # Email from transcript (prospect or AI repeating it)
    emails = re.findall(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", text_blob)
    attendee_email = ""
    for e in emails:
        low = e.lower()
        if low.endswith(("@aivhub.io", "@aivhub.com")):
            continue
        attendee_email = e
        break
    if not attendee_email and emails:
        attendee_email = emails[-1]

    setting = await calendar_service.get_or_create_settings(db)
    host_tz = setting.timezone or "Europe/London"
    host_now = now_in(host_tz)

    # Prefer explicit clock times mentioned by prospect ("3 PM", "15:00", "three o'clock")
    time_val = ""
    time_patterns = [
        r"\b(\d{1,2})\s*(?::|\.)\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b",
        r"\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b",
        r"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(a\.?m\.?|p\.?m\.?|o'?clock)\b",
    ]
    word_hour = {
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
        "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    }
    for pat in time_patterns:
        m = re.search(pat, text_blob, re.I)
        if not m:
            continue
        g = m.groups()
        if g[0].isdigit():
            hh = int(g[0])
            mm = int(g[1]) if len(g) > 1 and g[1] and g[1].isdigit() else 0
            ampm = (g[-1] or "").lower() if len(g) > 1 else ""
        else:
            hh = word_hour.get(g[0].lower(), 0)
            mm = 0
            ampm = (g[1] or "").lower()
        if "p" in ampm and hh < 12:
            hh += 12
        if "a" in ampm and hh == 12:
            hh = 0
        if 0 <= hh <= 23 and 0 <= mm <= 59:
            time_val = f"{hh:02d}:{mm:02d}"
            break

    # Date from spoken phrases
    date_hint = "tomorrow"
    low = text_blob.lower()
    if "this afternoon" in low or "today" in low:
        date_hint = "today"
    elif "tomorrow" in low:
        date_hint = "tomorrow"
    elif "monday" in low:
        date_hint = "monday"
    elif "tuesday" in low:
        date_hint = "tuesday"
    elif "wednesday" in low:
        date_hint = "wednesday"
    elif "thursday" in low:
        date_hint = "thursday"
    elif "friday" in low:
        date_hint = "friday"
    elif "next week" in low:
        date_hint = "next monday"

    if not time_val:
        # Fallback helper (legacy) then nearest open slot that day
        extracted = extract_requested_time(
            [line if isinstance(line, str) else str(line.get("text") or "") for line in raw_lines]
        )
        if extracted and extracted.get("time"):
            time_val = _norm_time(extracted.get("time"))
            if extracted.get("day") and "month" not in str(extracted.get("day")).lower():
                date_hint = extracted.get("day")

    target = parse_spoken_date(date_hint, host_now)
    date_iso = target.strftime("%Y-%m-%d")

    if not time_val:
        slots = await calendar_service.get_available_slots(db, date_iso)
        open_slots = [s for s in slots if s.get("available")]
        # Prefer afternoon if they asked for afternoon
        if "afternoon" in low or "3 p" in low or "pm" in low:
            aft = [s for s in open_slots if int(str(s.get("time") or "0").split(":")[0]) >= 12]
            if aft:
                open_slots = aft
        if not open_slots:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No agreed time found in the transcript and no free slots on "
                    f"{target.strftime('%A %d %b')}. "
                    "Have the AI confirm a day/time (and email) on the call, then try again."
                ),
            )
        time_val = open_slots[0]["time"]

    if not attendee_email or "@" not in attendee_email:
        raise HTTPException(
            status_code=400,
            detail=(
                "No email address heard on this call. "
                "Ask the prospect for an email so we can send the invite, then confirm again."
            ),
        )

    booked = await calendar_service.create_booking(
        db,
        prospect_name=call.prospect or "Prospect",
        attendee_email=attendee_email,
        date_str=date_iso,
        time_str=time_val,
        host_email=setting.host_email,
        notes=f"Confirmed from live call {call_id}. Mission: {call.mission or ''}",
        mission_name=call.mission or "Live call booking",
        prospect_phone=getattr(call, "to_number", None) or getattr(call, "phone", None),
        enforce_hours=False,
    )
    if not booked.get("success") and not booked.get("bookingId"):
        raise HTTPException(
            status_code=400,
            detail=booked.get("message") or booked.get("error") or "Could not book that slot on the real calendar.",
        )

    call.booked = True
    call.ended = True
    call.state = "ended"

    if call.prospect_id:
        p_res = await db.execute(select(Prospect).where(Prospect.id == call.prospect_id))
        p = p_res.scalars().first()
        if p:
            p.status = "meeting_booked"
            p.note = f"Meeting booked — {date_iso} {time_val}"

    day_label = target.strftime("%a, %d %b")
    sched = ScheduleItem(
        id=f"s_{uuid.uuid4().hex[:6]}",
        day=day_label,
        time=time_val,
        prospect=call.prospect,
        mission=call.mission,
        window=f"{setting.working_hours_start or '09:00'}–{setting.working_hours_end or '17:30'}",
        status="completed",
    )
    db.add(sched)

    call_trans_objects = []
    for line in raw_lines:
        if isinstance(line, dict):
            call_trans_objects.append({
                "who": "ai" if str(line.get("who") or "").lower() in ("ai", "sam") else "them",
                "text": str(line.get("text") or ""),
            })
            continue
        s = str(line)
        is_ai = s.startswith("AI:") or s.startswith("Sam")
        clean_text = s.replace("AI:", "").replace("Prospect:", "").replace("Them:", "").replace("Sam:", "").strip()
        call_trans_objects.append({"who": "ai" if is_ai else "them", "text": clean_text})

    meeting_id = booked.get("bookingId") or f"mt_{uuid.uuid4().hex[:6]}"
    # create_booking already persisted Meeting — refresh note on call log
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
        requested_follow_up={
            "day": day_label,
            "time": time_val,
            "email": attendee_email,
            "exactWords": text_blob[-280:],
        },
        words_locked=True,
        transcript=call_trans_objects,
    )
    db.add(call_log)

    notif = Notification(
        id=f"n_{uuid.uuid4().hex[:6]}",
        text=f"Meeting booked with {call.prospect} · {day_label} {time_val} → {attendee_email}",
        type="success",
    )
    db.add(notif)

    await db.commit()
    await call_hub.broadcast("booking_confirmed", {
        "callId": call_id,
        "prospect": call.prospect,
        "date": date_iso,
        "time": time_val,
        "email": attendee_email,
        "bookingId": meeting_id,
    })
    return {
        "status": "ok",
        "message": f"Booked {day_label} at {time_val} — invite to {attendee_email}",
        "bookingId": meeting_id,
        "date": date_iso,
        "time": time_val,
        "email": attendee_email,
        "hostEmail": setting.host_email,
    }

@router.get("/logs", response_model=list[dict])
async def get_call_logs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CallLog).order_by(CallLog.created_at.desc()))
    logs = result.scalars().all()
    dirty = False
    payload = []
    for l in logs:
        names = resolve_call_people(
            live_label=l.listed_as,
            transcript=l.transcript,
            existing_person=l.person_listed_as or l.person_canonical,
            existing_company=l.canonical_name,
        )
        if apply_names_to_log(l, names):
            dirty = True
        payload.append({
            "id": l.id,
            "registryId": l.registry_id,
            "canonicalName": names["canonical"],
            "listedAs": names["listed"],
            "personCanonical": names["person"],
            "personListedAs": names["person"],
            "displayName": names["display"],
            "channel": l.channel,
            "mission": l.mission,
            "startedAt": l.started_at,
            "endedAt": l.ended_at,
            "duration": l.duration,
            "outcome": l.outcome,
            "requestedFollowUp": l.requested_follow_up,
            "wordsLocked": l.words_locked,
            "transcript": l.transcript or []
        })
    if dirty:
        await db.commit()
    return payload


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
    media_stream_url: Optional[str] = None
    status_callback_url: Optional[str] = None


class BatchDialProspect(BaseModel):
    to_number: Optional[str] = None
    phone: Optional[str] = None
    prospect_name: Optional[str] = None
    name: Optional[str] = None
    contact: Optional[str] = None
    contact_person: Optional[str] = None
    company: Optional[str] = None
    website: Optional[str] = None


class BatchDialRequest(BaseModel):
    prospects: List[BatchDialProspect] = []
    concurrency: int = 2
    mission_title: Optional[str] = None
    from_number: Optional[str] = None
    carrier: Optional[str] = None
    call_window: Optional[str] = "09:00–17:30"
    timezone: Optional[str] = "Europe/London"
    lunch_start: Optional[str] = "12:00"
    lunch_end: Optional[str] = "13:00"
    account_sid: Optional[str] = None
    api_key: Optional[str] = None


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


async def resolve_outbound_caller_id(db: AsyncSession, from_number: Optional[str] = None) -> str:
    """
    Dynamically resolve the outbound Caller ID without hardcoded numbers:
    1. If from_number is explicitly provided, validate and return normalized E.164.
    2. Check Company Profile (CompanyProfile.caller_id).
    3. Check Connection table (Telephony or Voice Orchestration phoneNumber).
    4. Check environment variables (TWILIO_PHONE_NUMBER or TELNYX_PHONE_NUMBER).
    5. Dynamic Twilio API auto-discovery: query Twilio IncomingPhoneNumbers endpoint
       using stored Twilio credentials, pick first verified number, and auto-persist.
    6. If all sources empty, raise clean HTTP 400 instructing user to configure their line.
    """
    from app.services.secret_box import open_config
    import httpx

    # 1. User/Caller provided from_number
    if from_number and str(from_number).strip():
        cand = normalize_phone_number(str(from_number).strip())
        if cand and len(cand) >= 7 and "79460912" not in cand:
            return cand

    # 2. CompanyProfile
    prof_res = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
    profile = prof_res.scalars().first()
    if profile and profile.caller_id:
        cand = normalize_phone_number(profile.caller_id)
        if cand and len(cand) >= 7 and "79460912" not in cand:
            return cand

    # 3. Connection config (Telephony or Voice Orchestration)
    conns_res = await db.execute(
        select(Connection).where(Connection.group_name.in_(["Telephony", "Voice Orchestration"]))
    )
    conns = conns_res.scalars().all()
    carrier_conn = next((c for c in conns if c.group_name == "Telephony"), None)
    for c in conns:
        if c.config and isinstance(c.config, dict):
            cfg = open_config(c.config)
            num = cfg.get("phoneNumber") or cfg.get("phone_number")
            if num:
                cand = normalize_phone_number(str(num).strip())
                if cand and len(cand) >= 7 and "79460912" not in cand:
                    if profile and not profile.caller_id:
                        profile.caller_id = cand
                        await db.commit()
                    return cand

    # 4. Settings env
    env_num = getattr(settings, "TWILIO_PHONE_NUMBER", None) or getattr(settings, "TELNYX_PHONE_NUMBER", None)
    if env_num:
        cand = normalize_phone_number(env_num)
        if cand and len(cand) >= 7 and "79460912" not in cand:
            return cand

    # 5. Dynamic Twilio API auto-discovery
    tw_sid = None
    tw_token = None
    if carrier_conn and carrier_conn.config and isinstance(carrier_conn.config, dict):
        cfg = open_config(carrier_conn.config)
        tw_sid = (cfg.get("account_sid") or "").strip()
        tw_token = (cfg.get("auth_token") or cfg.get("api_key") or "").strip()
    if not tw_sid:
        tw_sid = getattr(settings, "TWILIO_ACCOUNT_SID", None)
    if not tw_token:
        tw_token = getattr(settings, "TWILIO_AUTH_TOKEN", None)

    if tw_sid and tw_token and tw_sid.startswith("AC") and len(tw_sid) == 34:
        try:
            async with httpx.AsyncClient(timeout=8.0) as tw_client:
                tw_url = f"https://api.twilio.com/2010-04-01/Accounts/{tw_sid}/IncomingPhoneNumbers.json"
                tw_res = await tw_client.get(tw_url, auth=(tw_sid, tw_token))
                if tw_res.status_code == 200:
                    tw_data = tw_res.json()
                    nums = [
                        normalize_phone_number(n.get("phone_number", ""))
                        for n in tw_data.get("incoming_phone_numbers", [])
                        if n.get("phone_number")
                    ]
                    if nums:
                        discovered = nums[0]
                        logger.info(f"Auto-discovered Twilio phone number: {discovered}")
                        if profile:
                            profile.caller_id = discovered
                            await db.commit()
                        return discovered
        except Exception as tw_err:
            logger.warning(f"Could not auto-discover Twilio number: {tw_err}")

    raise HTTPException(
        status_code=400,
        detail="No outbound Caller ID configured. Please configure and auto-register your active phone line under Company Profile or Voice & Telephony Hub before placing calls."
    )


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
    try:
        try:
            await db.rollback()
        except Exception:
            pass

        to_raw = req.to_number.strip()
        if not to_raw or len(to_raw) < 7:
            raise HTTPException(status_code=400, detail="A valid phone number (at least 7 digits) is required.")

        to_clean = normalize_phone_number(to_raw)

        # 1. Determine From / Caller ID number dynamically
        from_clean = await resolve_outbound_caller_id(db, req.from_number)

        # 2. Determine carrier plugin
        carrier_choice = (req.carrier or "").strip().lower()
        conn_res = await db.execute(
            select(Connection).where(
                (Connection.group_name.in_(["Telephony", "Voice Orchestration"]))
                | (Connection.name.ilike("%twilio%"))
                | (Connection.name.ilike("%sipgate%"))
                | (Connection.name.ilike("%telnyx%"))
                | (Connection.name.ilike("%vapi%"))
                | (Connection.name.ilike("%retell%"))
            )
        )
        tele_conns = conn_res.scalars().all()
        tele_conn = None
        for c in tele_conns:
            if carrier_choice and carrier_choice in (c.name or "").lower():
                tele_conn = c
                break
        if not tele_conn:
            for c in tele_conns:
                if c.status == "connected":
                    tele_conn = c
                    break
        if not tele_conn and tele_conns:
            tele_conn = tele_conns[0]

        if not carrier_choice:
            if tele_conn:
                n = (tele_conn.name or "").lower()
                if "sipgate" in n:
                    carrier_choice = "sipgate"
                elif "telnyx" in n:
                    carrier_choice = "telnyx"
                elif "vapi" in n:
                    carrier_choice = "vapi"
                elif "retell" in n:
                    carrier_choice = "retell"
                elif "twilio" in n:
                    carrier_choice = "twilio"
                else:
                    carrier_choice = n
            else:
                carrier_choice = "sipgate" if settings.SIPGATE_SIP_ID else "twilio"

        # 3. Resolve credentials with smart fallback to saved DB vault
        stored_cfg = tele_conn.config if (tele_conn and isinstance(tele_conn.config, dict)) else {}
        try:
            from app.services.secret_box import open_config, seal_config
            stored_cfg = open_config(stored_cfg)
        except Exception:
            seal_config = None  # type: ignore
        req_sid = (req.account_sid or "").strip()
        req_token = (req.api_key or "").strip()

        # If payload provides a valid full 34-char SID, use it; otherwise fallback to DB
        if req_sid and req_sid.startswith("AC") and len(req_sid) == 34:
            sid = req_sid
        else:
            sid = (stored_cfg.get("account_sid") or "").strip() or None

        # If payload provides a valid full 32-char token, use it; otherwise fallback to DB
        if req_token and len(req_token) == 32 and not req_token.startswith("xai-"):
            token = req_token
        else:
            token = (stored_cfg.get("auth_token") or stored_cfg.get("api_key") or "").strip() or None

        # If stored token was mistakenly an xAI key, ignore it
        if token and token.startswith("xai-"):
            token = None

        # Fallback to server env settings if not provided
        if not sid and settings.TWILIO_ACCOUNT_SID:
            sid = settings.TWILIO_ACCOUNT_SID.strip()
        if not token and settings.TWILIO_AUTH_TOKEN:
            token = settings.TWILIO_AUTH_TOKEN.strip()

        # Strict validation for Twilio provider
        if "twilio" in carrier_choice:
            if not sid or not token:
                raise HTTPException(
                    status_code=400,
                    detail="Twilio Account SID (34 characters, starts with 'AC') & Auth Token (32 characters) are required to make real phone calls. Please enter or save your complete credentials."
                )
            if not sid.startswith("AC") or len(sid) != 34:
                raise HTTPException(
                    status_code=400,
                    detail=f"Twilio Account SID is invalid ({len(sid)} characters; expected 34 chars starting with 'AC'). Your input appears truncated. Please copy the full Account SID from console.twilio.com."
                )
            if len(token) != 32:
                raise HTTPException(
                    status_code=400,
                    detail=f"Twilio Auth Token is invalid ({len(token)} characters; expected 32 characters). Your input appears truncated. Please copy the full 32-character Auth Token from console.twilio.com."
                )

        # Auto-save credentials permanently to database ONLY if valid
        if req.account_sid and (req.api_key or req.account_sid):
            if sid and token and len(sid) == 34 and len(token) == 32 and sid.startswith("AC"):
                try:
                    masked = token[:3] + "••••••••" + token[-4:]
                    sealed = {"account_sid": sid, "api_key": token, "auth_token": token}
                    try:
                        from app.services.secret_box import seal_config as _seal
                        sealed = _seal(sealed)
                    except Exception:
                        pass
                    if not tele_conn:
                        tele_conn = Connection(
                            id=f"conn_{uuid.uuid4().hex[:6]}",
                            name="Twilio",
                            group_name="Telephony",
                            status="connected",
                            api_key_masked=masked,
                            config=sealed
                        )
                        db.add(tele_conn)
                    else:
                        existing_cfg = dict(tele_conn.config) if isinstance(tele_conn.config, dict) else {}
                        tele_conn.config = {**existing_cfg, **sealed}
                        tele_conn.status = "connected"
                        tele_conn.api_key_masked = masked
                    await db.commit()
                    logger.info("Persisted Twilio credentials permanently to database Connection table.")
                except Exception as save_err:
                    try:
                        await db.rollback()
                    except Exception:
                        pass
                    logger.warning(f"Could not persist Twilio credentials to DB: {save_err}")

        credentials = {
            "account_sid": sid,
            "api_key": token,
            "auth_token": token,
            "carrier": carrier_choice,
            "connection_id": stored_cfg.get("connection_id") or stored_cfg.get("telnyx_connection_id"),
            "assistant_id": stored_cfg.get("assistant_id") or stored_cfg.get("model"),
            "agent_id": stored_cfg.get("agent_id") or stored_cfg.get("model"),
            "phone_number_id": stored_cfg.get("phone_number_id") or stored_cfg.get("phoneNumberId"),
            "base_url": stored_cfg.get("base_url") or stored_cfg.get("baseUrl"),
        }

        # 4. Resolve bridge SIP URI
        bridge_sip = req.bridge_sip_uri or f"sip:{from_clean}@{settings.XAI_SIP_FQDN};transport=tls"

        # Keep other live lines up. Batch campaigns need concurrent PSTN calls.

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
        try:
            db.add(live_call)
            await db.commit()
        except Exception as live_err:
            try:
                await db.rollback()
            except Exception:
                pass
            logger.warning(f"Could not commit live call record: {live_err}")

        # Register initial alias in media_stream_hub
        try:
            from app.websockets.media_stream import media_stream_hub
            media_stream_hub.register_alias(call_id, call_id)
        except Exception:
            pass

        # Broadcast call started immediately to frontend
        await call_hub.broadcast("call_started", {
            "callId": call_id,
            "id": call_id,
            "caller": from_clean,
            "prospect": prospect_label,
            "mission": mission_label,
            "state": "calling",
            "duration": "00:00",
            "channel": "voice",
            "ended": False,
        })

        # Warm voice bridge in background so UI sees the call without waiting on xAI connect
        background_tasks.add_task(
            start_bridged_voice_session,
            call_id=call_id,
            caller_number=from_clean,
            prospect_name=prospect_label,
            is_inbound=False,
        )

        # 6. Execute Dial via Carrier Plugin
        adapter = carrier_registry.get_adapter(carrier_choice)
        try:
            dial_res = await adapter.dial_outbound(
                to_number=to_clean,
                from_number=from_clean,
                bridge_sip_uri=bridge_sip,
                metadata={
                    "call_id": call_id,
                    "prospect": prospect_label,
                    "media_stream_url": getattr(req, "media_stream_url", None),
                    "status_callback_url": getattr(req, "status_callback_url", None),
                },
                credentials=credentials
            )

            carrier_sid = dial_res.get("call_id")
            if carrier_sid:
                try:
                    alias_sip_first_call(call_id, carrier_sid)
                    live_call.carrier_sid = carrier_sid
                    live_call.transcript = (live_call.transcript or []) + [
                        f"System: Provider Call SID: {carrier_sid}",
                        "System: AI voice pre-warmed. Greeting will start the instant they pick up.",
                    ]
                    await db.commit()
                except Exception as c_err:
                    try:
                        await db.rollback()
                    except Exception:
                        pass
                    logger.warning(f"Could not persist carrier SID on live_call: {c_err}")
                try:
                    from app.websockets.media_stream import media_stream_hub
                    media_stream_hub.register_alias(carrier_sid, call_id)
                except Exception:
                    pass

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
        except HTTPException:
            raise
        except Exception as exc:
            err_msg = str(exc)
            logger.error(f"Outbound dial error: {err_msg}")
            try:
                await db.rollback()
            except Exception:
                pass
            # Mark call as failed in DB safely using a fresh session
            try:
                from app.database import AsyncSessionLocal
                from app.services.call_log_writer import upsert_call_log_from_live
                async with AsyncSessionLocal() as fail_session:
                    res = await fail_session.execute(select(LiveCall).where(LiveCall.id == call_id))
                    rec = res.scalars().first()
                    if rec:
                        rec.state = "failed"
                        rec.ended = True
                        rec.transcript = (rec.transcript or []) + [f"System: Dial failed - {err_msg}"]
                        if rec.created_at:
                            secs = max(0, int((datetime.utcnow() - rec.created_at).total_seconds()))
                            rec.duration = f"{secs // 60:02d}:{secs % 60:02d}"
                        await upsert_call_log_from_live(
                            fail_session,
                            rec,
                            outcome="failed",
                            duration=rec.duration,
                            force_outcome=True,
                        )
                        await fail_session.commit()
            except Exception as update_err:
                logger.warning(f"Could not update failed call state in DB: {update_err}")

            try:
                await call_hub.broadcast("call_ended", {"callId": call_id, "reason": err_msg})
            except Exception:
                pass
            raise HTTPException(status_code=400, detail=err_msg)
    except HTTPException:
        raise
    except Exception as top_exc:
        logger.error(f"Unhandled error in dial_outbound_call: {top_exc}")
        try:
            await db.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"Outbound dial failed: {str(top_exc)}")


@router.post("/outbound/batch")
async def dial_outbound_batch(req: BatchDialRequest, db: AsyncSession = Depends(get_db)):
    """
    Launch as many simultaneous outbound PSTN calls as the operator set,
    using the connected telephony provider. Extra contacts wait for a free line.
    """
    rows = []
    for p in req.prospects or []:
        phone = (p.to_number or p.phone or "").strip()
        person = (p.contact or p.contact_person or p.prospect_name or "").strip()
        company = (p.company or p.name or "").strip()
        rows.append({
            "to_number": phone,
            "phone": phone,
            "prospect_name": person or company,
            "name": company or person,
            "company": company,
            "contact": person or company,
            "website": p.website,
        })
    title = (req.mission_title or "").strip() or f"Outbound list — {len(rows)} contacts"
    try:
        return await launch_outbound_mission(
            db,
            title=title,
            prospects=rows,
            concurrency=req.concurrency,
            from_number=req.from_number,
            carrier=req.carrier,
            call_window=req.call_window or "09:00–17:30",
            timezone=req.timezone or "Europe/London",
            lunch_start=req.lunch_start or "12:00",
            lunch_end=req.lunch_end or "13:00",
            source="manual",
            account_sid=req.account_sid,
            api_key=req.api_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Batch outbound failed: {exc}")
        raise HTTPException(status_code=400, detail=f"Batch outbound failed: {str(exc)}")


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
        from app.services.xai_voice_service import _sip_first_record
        sip_first = bool(_sip_first_record(matched.id, call_sid, matched.carrier_sid))
        if call_status in ["in-progress", "answered"]:
            if sip_first:
                matched.state = "ringing"
                matched.transcript = (matched.transcript or []) + ["System: AI voice engine connected. Ringing the prospect now."]
            else:
                matched.state = "pitching"
                matched.transcript = (matched.transcript or []) + ["System: Call answered by recipient. AI voice representative active."]
            # Media-stream outbound also marks sip_first for warm greeting buffers —
            # still release audio when Twilio says the PSTN leg answered.
            try:
                await notify_prospect_answered(matched.id)
                if matched.carrier_sid:
                    await notify_prospect_answered(matched.carrier_sid)
                if call_sid:
                    await notify_prospect_answered(call_sid)
            except Exception as ans_err:
                logger.warning(f"notify_prospect_answered failed for {call_sid}: {ans_err}")
        elif call_status in ["completed", "canceled", "failed", "no-answer", "busy"]:
            from app.services.call_log_writer import (
                map_carrier_status_to_outcome,
                map_carrier_status_to_state,
                upsert_call_log_from_live,
            )
            matched.state = map_carrier_status_to_state(call_status)
            matched.ended = True
            dur_int = int(duration) if str(duration).isdigit() else 0
            if dur_int <= 0 and matched.created_at:
                dur_int = max(0, int((datetime.utcnow() - matched.created_at).total_seconds()))
            matched.duration = f"{dur_int // 60:02d}:{dur_int % 60:02d}"
            note = f"Call finished ({matched.duration}). Status: {call_status}."
            if sip_code:
                note += f" SIP Code: {sip_code}."
            matched.transcript = (matched.transcript or []) + [f"System: {note}"]
            outcome = map_carrier_status_to_outcome(call_status)
            # completed with no conversation still gets a history row (may refine later in finalize)
            await upsert_call_log_from_live(
                db,
                matched,
                outcome=outcome,
                duration=matched.duration,
                extra_note=None,
                force_outcome=call_status in ("canceled", "failed", "no-answer", "busy"),
            )
        mission_id = matched.mission_id
        call_ended = call_status in ["completed", "canceled", "failed", "no-answer", "busy"]
        await db.commit()
        await call_hub.broadcast("call_updated", {
            "callId": matched.id,
            "state": matched.state,
            "duration": matched.duration,
            "ended": matched.ended
        })
        if call_ended and mission_id:
            asyncio.create_task(drain_mission_queue(mission_id))

    return {"status": "ok"}


@router.post("/twilio/pstn-status")
async def twilio_pstn_leg_status(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Child-leg callbacks for SIP-first outbound: the PSTN prospect ringing/answered.
    This is when we fire the AI greeting — xAI is already hot.
    """
    form = await request.form()
    call_sid = form.get("CallSid", "")
    parent_sid = form.get("ParentCallSid", "")
    call_status = (form.get("CallStatus") or "").lower()
    to_number = form.get("To") or form.get("Called") or ""

    await log_process_event(
        subsystem="telephony",
        process_name="twilio_pstn_leg_status",
        message=f"PSTN leg {call_sid} parent={parent_sid} -> {call_status} (to {to_number})",
        level="INFO",
        details={"callSid": call_sid, "parentSid": parent_sid, "status": call_status, "to": to_number},
    )

    res = await db.execute(select(LiveCall).where(LiveCall.carrier_sid == parent_sid))
    matched = res.scalars().first()
    if not matched:
        res = await db.execute(select(LiveCall).where(LiveCall.carrier_sid == call_sid))
        matched = res.scalars().first()
    if not matched:
        res2 = await db.execute(select(LiveCall).where(LiveCall.ended == False).order_by(LiveCall.created_at.desc()))
        matched = res2.scalars().first()

    if matched and call_status in ["in-progress", "answered"]:
        matched.state = "pitching"
        matched.transcript = (matched.transcript or []) + ["System: Prospect picked up. AI speaking now."]
        await db.commit()
        await call_hub.broadcast("call_updated", {
            "callId": matched.id,
            "state": matched.state,
            "duration": matched.duration,
            "ended": matched.ended,
        })
        try:
            await notify_prospect_answered(matched.id)
            if parent_sid:
                await notify_prospect_answered(parent_sid)
            await notify_prospect_answered(call_sid)
        except Exception as greet_err:
            logger.warning(f"Failed to trigger pickup greeting: {greet_err}")
    elif matched and call_status in ["busy", "no-answer", "failed", "canceled"]:
        from app.services.call_log_writer import (
            map_carrier_status_to_outcome,
            map_carrier_status_to_state,
            upsert_call_log_from_live,
        )
        matched.transcript = (matched.transcript or []) + [f"System: Prospect {call_status}."]
        matched.state = map_carrier_status_to_state(call_status)
        matched.ended = True
        if matched.created_at:
            secs = max(0, int((datetime.utcnow() - matched.created_at).total_seconds()))
            matched.duration = f"{secs // 60:02d}:{secs % 60:02d}"
        await upsert_call_log_from_live(
            db,
            matched,
            outcome=map_carrier_status_to_outcome(call_status),
            duration=matched.duration,
            force_outcome=True,
        )
        mission_id = matched.mission_id
        await db.commit()
        await call_hub.broadcast("call_updated", {
            "callId": matched.id,
            "state": matched.state,
            "duration": matched.duration,
            "ended": True,
        })
        if mission_id:
            asyncio.create_task(drain_mission_queue(mission_id))
        return {"status": "ok"}

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

        # Ensure CallLog entry is created/updated so it appears permanently in Call Logs tab
        try:
            log_id = f"cl_{matched.id.replace('call_', '')}"
            existing_log_res = await db.execute(select(CallLog).where(CallLog.id == log_id))
            existing_log = existing_log_res.scalars().first()

            formatted_transcript = []
            for item in (matched.transcript or []):
                if isinstance(item, dict) and "text" in item and "who" in item:
                    formatted_transcript.append(item)
                elif isinstance(item, str):
                    s = item.strip()
                    if not s:
                        continue
                    if s.startswith("AI:"):
                        formatted_transcript.append({"who": "ai", "text": s[3:].strip()})
                    elif s.startswith("Prospect:") or s.startswith("Them:"):
                        text_val = s.replace("Prospect:", "").replace("Them:", "").strip()
                        formatted_transcript.append({"who": "them", "text": text_val})
                    elif s.startswith("System:"):
                        formatted_transcript.append({"who": "ai", "text": f"[{s[7:].strip()}]"})
                    else:
                        formatted_transcript.append({"who": "ai", "text": s})

            now_str = datetime.utcnow().strftime("%d %b %Y, %H:%M")
            prospect_row = None
            if matched.prospect_id:
                prospect_row = (await db.execute(select(Prospect).where(Prospect.id == matched.prospect_id))).scalars().first()
            names = resolve_call_people(
                prospect=prospect_row,
                live_label=matched.prospect,
                transcript=formatted_transcript,
                existing_person=existing_log.person_listed_as if existing_log else None,
                existing_company=existing_log.canonical_name if existing_log else None,
            )
            if not existing_log:
                new_cl = CallLog(
                    id=log_id,
                    canonical_name=names["canonical"],
                    listed_as=names["listed"],
                    person_canonical=names["person"],
                    person_listed_as=names["person"],
                    channel="voice",
                    mission=matched.mission or "Outbound Voice",
                    started_at=now_str,
                    ended_at=now_str,
                    duration=f"{matched.duration} min",
                    outcome="meeting_booked" if matched.booked else ("contacted" if not error_msg else "failed"),
                    transcript=formatted_transcript
                )
                db.add(new_cl)
            else:
                existing_log.transcript = formatted_transcript
                existing_log.duration = f"{matched.duration} min"
                if matched.booked:
                    existing_log.outcome = "meeting_booked"
                apply_names_to_log(existing_log, names)
            await db.commit()
        except Exception as log_err:
            logger.warning(f"Could not persist CallLog in dial_action: {log_err}")

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


@router.api_route("/twilio/inbound", methods=["GET", "POST"])
@router.api_route("/twilio/voice", methods=["GET", "POST"])
async def twilio_inbound_voice(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Twilio Inbound Voice Webhook.
    Fires when any prospect or customer dials the configured Twilio phone number.
    1. Extracts caller info (From, To, CallSid).
    2. Identifies caller against Prospect / ContactRegistry.
    3. Spawns an active LiveCall card with state='pitching' on the supervisor dashboard.
    4. Registers aliases in media_stream_hub for live audio streaming.
    5. Returns TwiML bridging caller directly to xAI Realtime Voice Agent (Sam).
    """
    params = dict(request.query_params)
    if request.method == "POST":
        try:
            form = await request.form()
            params.update(dict(form))
        except Exception:
            pass

    call_sid = params.get("CallSid", f"CA_{uuid.uuid4().hex[:16]}")
    from_number = params.get("From", "")
    to_number = params.get("To", getattr(settings, "TWILIO_PHONE_NUMBER", None) or "")

    # Match caller against existing contacts / prospects
    caller_clean = normalize_phone_number(from_number)
    prospect_label = f"Caller ({caller_clean[-4:] if len(caller_clean) >= 4 else caller_clean})"
    matched_prospect_id = None
    matched_mission_id = "m_inbound"
    matched_mission_title = "Inbound Customer Call"

    try:
        from app.models.models import ContactRegistry, Prospect
        reg_res = await db.execute(select(ContactRegistry))
        registries = reg_res.scalars().all()
        for r in registries:
            if r.phone and normalize_phone_number(r.phone) == caller_clean:
                prospect_label = r.canonical_name or r.name or prospect_label
                break

        if prospect_label.startswith("Caller"):
            pros_res = await db.execute(select(Prospect).where(Prospect.phone == caller_clean))
            p = pros_res.scalars().first()
            if p:
                prospect_label = clean_person_label(p.contact_person) or clean_person_label(p.name) or prospect_label
                matched_prospect_id = p.id
                matched_mission_id = p.mission_id or matched_mission_id
    except Exception as e:
        pass

    internal_call_id = f"call_{uuid.uuid4().hex[:8]}"

    live_call = LiveCall(
        id=internal_call_id,
        carrier_sid=call_sid,
        mission_id=matched_mission_id,
        prospect_id=matched_prospect_id,
        prospect=prospect_label,
        mission=matched_mission_title,
        state="pitching",
        channel="voice",
        duration="00:00",
        listening=False,
        taken=False,
        confirming_end=False,
        ended=False,
        booked=False,
        transcript=[
            f"System: Inbound call from {from_number} received on {to_number}.",
            f"AI: Connecting caller to Sam from AIVHub..."
        ]
    )
    db.add(live_call)
    await db.commit()

    # Register in media_stream_hub for live audio streaming / listening
    try:
        from app.websockets.media_stream import media_stream_hub
        media_stream_hub.register_alias(internal_call_id, internal_call_id)
        media_stream_hub.register_alias(call_sid, internal_call_id)
    except Exception:
        pass

    # Broadcast new call to dashboard WebSockets
    try:
        await call_hub.broadcast("call_created", {
            "id": internal_call_id,
            "prospect": prospect_label,
            "mission": matched_mission_title,
            "state": "pitching",
            "channel": "voice",
            "duration": "00:00",
            "carrierSid": call_sid
        })
    except Exception:
        pass

    # Log process event
    await log_process_event(
        subsystem="telephony",
        process_name="inbound_call_connected",
        message=f"Inbound call from {from_number} ({prospect_label}) bridged to xAI voice agent.",
        level="SUCCESS",
        details={
            "callId": internal_call_id,
            "carrierSid": call_sid,
            "caller": from_number,
            "prospect": prospect_label,
            "to": to_number
        }
    )

    # Keep the caller ringing until greeting audio is buffered, then answer with a live stream.
    # They hear ring (normal), never post-answer dead air.
    try:
        sess = await start_bridged_voice_session(
            call_id=internal_call_id,
            caller_number=from_number,
            prospect_name=prospect_label,
            is_inbound=True,
            carrier_sid=call_sid,
        )
        got_audio = await sess.wait_ready(timeout=2.8)
        live_call.transcript = (live_call.transcript or []) + [
            "System: AI greeting ready — answering now." if got_audio else "System: Answering now (greeting still spinning up)."
        ]
        await db.commit()
    except Exception as bridge_err:
        logger.warning(f"Inbound xAI pre-warm failed: {bridge_err}")

    from app.services.telephony_provider import public_wss_base
    media_stream_url = f"{public_wss_base()}/ws/media-stream"
    twiml = (
        f"<Response>"
        f"<Connect>"
        f"<Stream url=\"{media_stream_url}\">"
        f"<Parameter name=\"internalCallId\" value=\"{internal_call_id}\" />"
        f"</Stream>"
        f"</Connect>"
        f"</Response>"
    )
    return Response(content=twiml, media_type="application/xml")



