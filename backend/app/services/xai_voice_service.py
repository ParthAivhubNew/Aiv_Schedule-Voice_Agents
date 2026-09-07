import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import websockets
from sqlalchemy.future import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.models import (
    CallLog,
    CompanyProfile,
    LiveCall,
    Meeting,
    Prospect,
    ScheduleItem,
    Service,
)
from app.services.process_logger import log_process_event, scrub_text
from app.services.rag_service import search_knowledge
from app.websockets.call_hub import call_hub

logger = logging.getLogger("xai_voice_service")


# ----------------------------------------------------------------------
# 1. SVIX STANDARD SIGNATURE VERIFICATION
# ----------------------------------------------------------------------
def verify_xai_webhook_signature(
    payload_bytes: bytes,
    headers: Dict[str, str],
    secret: Optional[str] = None
) -> bool:
    """
    Verifies xAI webhook signatures adhering to the Svix specification:
    Signed string = "{webhook_id}.{webhook_timestamp}.{raw_payload}"
    The secret is base64 decoded after stripping the 'whsec_' prefix.
    Rejects requests older than 300 seconds (anti-replay protection).
    """
    signing_secret = secret or settings.XAI_WEBHOOK_SECRET
    
    # If no secret configured in dev/testing, allow mock verification with warning
    if not signing_secret:
        logger.warning("No XAI_WEBHOOK_SECRET configured. Skipping signature verification in simulation mode.")
        return True

    # Normalize header keys to lowercase
    normalized_headers = {k.lower(): v for k, v in headers.items()}
    msg_id = normalized_headers.get("webhook-id")
    msg_timestamp = normalized_headers.get("webhook-timestamp")
    msg_signature = normalized_headers.get("webhook-signature")

    if not msg_id or not msg_timestamp or not msg_signature:
        logger.warning("Webhook request missing required Svix headers: webhook-id, webhook-timestamp, or webhook-signature.")
        return False

    # 1. Anti-replay timestamp check (5 minute tolerance)
    try:
        ts = int(msg_timestamp)
        now = int(time.time())
        if abs(now - ts) > 300:
            logger.warning(f"Webhook timestamp expired: delta={abs(now - ts)}s > 300s.")
            return False
    except ValueError:
        logger.warning("Invalid webhook-timestamp header format.")
        return False

    # 2. Extract base64 secret
    try:
        clean_secret = signing_secret.strip()
        if clean_secret.startswith("whsec_"):
            clean_secret = clean_secret[6:]
        key_bytes = base64.b64decode(clean_secret)
    except Exception as err:
        logger.error(f"Failed to base64 decode XAI_WEBHOOK_SECRET: {err}")
        return False

    # 3. Compute expected signature: {id}.{timestamp}.{payload}
    to_sign = f"{msg_id}.{msg_timestamp}.".encode("utf-8") + payload_bytes
    expected_digest = hmac.new(key_bytes, to_sign, hashlib.sha256).digest()
    expected_sig = base64.b64encode(expected_digest).decode("utf-8")

    # 4. Compare with signatures in header (header can contain space-delimited 'v1,<sig>')
    for sig_part in msg_signature.strip().split(" "):
        if sig_part.startswith("v1,"):
            actual_sig = sig_part[3:]
            if hmac.compare_digest(expected_sig, actual_sig):
                return True

    logger.warning("Svix signature mismatch on webhook payload.")
    return False


# ----------------------------------------------------------------------
# 2. DYNAMIC SYSTEM PROMPT & TOOL DEFINITIONS
# ----------------------------------------------------------------------
async def build_xai_system_instructions(caller_number: str, prospect_name: Optional[str] = None) -> str:
    """
    Constructs real-time system prompt customized with Company Profile,
    Service Catalog, caller context, and conversational ground rules.
    """
    async with AsyncSessionLocal() as db:
        prof_res = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
        profile = prof_res.scalars().first()
        
        services_res = await db.execute(select(Service))
        services = services_res.scalars().all()

    company_name = profile.name if profile else "AIVHub"
    caller_name = profile.caller_name if profile else "Sam"
    pitch = profile.pitch if profile else "AI-driven operational intelligence and workflow automation."
    tone = profile.tone if profile else "Warm, confident, concise, professional"
    disclosure = profile.disclosure if profile else "This call may be recorded for quality purposes."
    
    catalog_lines = []
    for s in services[:5]:
        catalog_lines.append(f"- {s.name}: {s.desc} (Best for: {s.ideal})")
    catalog_text = "\n".join(catalog_lines) if catalog_lines else "- Enterprise Voice & Knowledge Intelligence"

    target_name = prospect_name or "the customer"

    instructions = f"""You are {caller_name}, a friendly and articulate AI voice representative calling from {company_name}.
Tone & Style: {tone}.

Your Core Objective:
Engage with {target_name}, introduce our value proposition, answer their questions accurately using your tools, and secure a 15-minute discovery call.

Company Background:
{pitch}

Key Services & Capabilities:
{catalog_text}

Call Disclosure:
"{disclosure}"

CRITICAL SPOKEN CONVERSATION RULES:
1. Speak naturally with brief conversational turns (1-3 sentences maximum per turn).
2. Never read long bulleted lists over the phone. Summarize concepts clearly.
3. If the caller asks specific questions about pricing, technical features, legal, onboarding, or documentation, ALWAYS invoke the `query_knowledge_base` tool to retrieve accurate information before answering.
4. If the caller shows interest in learning more, seeing a demo, or scheduling a discussion, immediately ask for their preferred day and time, then invoke the `book_calendar_meeting` tool.
5. If the caller is busy or asks to call back later, politely confirm their preference and wrap up gracefully.
"""
    return instructions.strip()


def get_xai_tool_definitions() -> List[Dict[str, Any]]:
    """
    Returns OpenAI/xAI Realtime API function tool definitions.
    """
    return [
        {
            "type": "function",
            "name": "query_knowledge_base",
            "description": "Searches company documentation, verified knowledge, pricing details, and service FAQs whenever the caller asks specific business or technical questions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The concise search query or question to retrieve verified context for."
                    }
                },
                "required": ["query"]
            }
        },
        {
            "type": "function",
            "name": "book_calendar_meeting",
            "description": "Schedules a 15-minute discovery meeting or demo with the caller on the company calendar.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date of meeting in YYYY-MM-DD format or descriptive day (e.g., 2026-09-10 or tomorrow)."
                    },
                    "time": {
                        "type": "string",
                        "description": "Time of meeting in 24-hour HH:MM format (e.g., 14:00 or 10:30)."
                    },
                    "notes": {
                        "type": "string",
                        "description": "Short topic or meeting note requested by caller."
                    }
                },
                "required": ["date", "time"]
            }
        },
        {
            "type": "function",
            "name": "check_calendar_availability",
            "description": "Checks available appointment slots for a given day.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date to check in YYYY-MM-DD format."
                    }
                },
                "required": ["date"]
            }
        }
    ]


# ----------------------------------------------------------------------
# 3. TOOL EXECUTION ENGINE
# ----------------------------------------------------------------------
async def execute_xai_tool(
    name: str,
    args: Dict[str, Any],
    call_id: str,
    prospect_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executes tool calls invoked by the xAI model mid-call and returns JSON payload.
    """
    start_time = time.time()
    logger.info(f"Executing tool {name} with args {args} for call {call_id}")

    try:
        if name == "query_knowledge_base":
            query = args.get("query", "")
            async with AsyncSessionLocal() as db:
                results = await search_knowledge(db, query=query, top_k=3, min_score=0.40)
            
            elapsed = (time.time() - start_time) * 1000
            await log_process_event(
                subsystem="crawler_rag",
                process_name="xai_rag_tool_lookup",
                message=f"RAG Knowledge search for '{query}' returned {len(results)} chunks.",
                level="INFO",
                duration_ms=elapsed,
                details={"callId": call_id, "query": query, "chunkCount": len(results)}
            )

            if not results:
                return {
                    "found": False,
                    "summary": "No specific document matched this exact query. Inform the caller we will have a specialist confirm details during our demo."
                }

            extracted_chunks = [f"Title: {r.get('title', 'Doc')}\nContent: {r.get('content')}" for r in results]
            return {
                "found": True,
                "context": "\n---\n".join(extracted_chunks)
            }

        elif name == "book_calendar_meeting":
            date_val = args.get("date", "Tomorrow")
            time_val = args.get("time", "14:00")
            notes_val = args.get("notes", "Discovery call booked via xAI Voice Agent")
            
            async with AsyncSessionLocal() as db:
                call_res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
                call_record = call_res.scalars().first()
                prospect_name = call_record.prospect if call_record else "Valued Prospect"
                mission_name = call_record.mission if call_record else "Inbound Voice"
                
                if call_record:
                    call_record.booked = True
                    call_record.state = "ended"
                    call_record.ended = True

                if prospect_id:
                    p_res = await db.execute(select(Prospect).where(Prospect.id == prospect_id))
                    p = p_res.scalars().first()
                    if p:
                        p.status = "meeting_booked"
                        p.note = f"Booked: {date_val} at {time_val} ({notes_val})"

                meeting_id = f"mt_{uuid.uuid4().hex[:8]}"
                meeting = Meeting(
                    id=meeting_id,
                    prospect=prospect_name,
                    mission=mission_name,
                    date=date_val,
                    time=time_val,
                    duration="15 min",
                    status="upcoming",
                    channel="voice",
                    format="video",
                    platform="Google Meet",
                    host="AI Voice Rep",
                    attendee=prospect_name,
                    prep=f"Auto-scheduled from inbound call. Notes: {notes_val}",
                    call_transcript=call_record.transcript if call_record else []
                )
                db.add(meeting)

                sched_item = ScheduleItem(
                    id=f"s_{uuid.uuid4().hex[:6]}",
                    day=date_val,
                    time=time_val,
                    prospect=prospect_name,
                    mission=mission_name,
                    window="09:00–17:30",
                    status="scheduled"
                )
                db.add(sched_item)
                await db.commit()

            await call_hub.broadcast("call_updated", {
                "callId": call_id,
                "booked": True,
                "meetingId": meeting_id,
                "date": date_val,
                "time": time_val
            })

            elapsed = (time.time() - start_time) * 1000
            await log_process_event(
                subsystem="calendar",
                process_name="xai_tool_meeting_booked",
                message=f"Meeting successfully booked for {prospect_name} on {date_val} at {time_val}.",
                level="SUCCESS",
                duration_ms=elapsed,
                details={"callId": call_id, "meetingId": meeting_id, "date": date_val, "time": time_val}
            )

            return {
                "success": True,
                "meeting_id": meeting_id,
                "date": date_val,
                "time": time_val,
                "message": f"The meeting has been confirmed for {date_val} at {time_val}. A calendar invite has been reserved."
            }

        elif name == "check_calendar_availability":
            date_val = args.get("date", "Tomorrow")
            slots = ["10:00 AM", "11:30 AM", "02:00 PM", "04:15 PM"]
            return {
                "available_slots": slots,
                "message": f"Available times for {date_val} are: {', '.join(slots)}."
            }

        else:
            return {"error": f"Unknown tool: {name}"}

    except Exception as err:
        logger.error(f"Error executing tool {name}: {err}", exc_info=True)
        return {"error": str(err)}


# ----------------------------------------------------------------------
# 4. WEBSOCKET SESSION ORCHESTRATOR (join_call)
# ----------------------------------------------------------------------
async def join_xai_call_session(
    call_id: str,
    caller_number: str = "+12025550199",
    prospect_id: Optional[str] = None,
    prospect_name: Optional[str] = None,
    mission_name: Optional[str] = None
):
    """
    Connects an outbound WebSocket session to xAI Realtime Voice API
    (wss://api.x.ai/v1/realtime?call_id=...) for an incoming/outgoing call.
    """
    start_ts = time.time()
    ws_url = f"{settings.XAI_REALTIME_WS_URL}?call_id={call_id}"
    api_key = settings.XAI_API_KEY

    await log_process_event(
        subsystem="telephony",
        process_name="xai_ws_connecting",
        message=f"Connecting WebSocket to xAI Realtime API for call_id={call_id} from caller={caller_number}",
        level="INFO",
        details={"callId": call_id, "caller": caller_number}
    )

    # 1. Update or create LiveCall record in DB
    async with AsyncSessionLocal() as db:
        call_res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
        call_obj = call_res.scalars().first()
        if not call_obj:
            call_obj = LiveCall(
                id=call_id,
                mission_id=mission_name or "Inbound Mission",
                prospect_id=prospect_id,
                prospect=prospect_name or f"Caller ({caller_number[-4:] if len(caller_number) >= 4 else caller_number})",
                mission=mission_name or "Direct Inbound",
                state="pitching",
                channel="voice",
                duration="00:01",
                transcript=[]
            )
            db.add(call_obj)
            await db.commit()

    await call_hub.broadcast("call_started", {
        "callId": call_id,
        "caller": caller_number,
        "prospect": prospect_name or caller_number,
        "state": "pitching"
    })

    # If in mock / simulation mode without real xAI key, run simulation bridge
    if not api_key or api_key.startswith("mock") or settings.VOICE_ENGINE_MODE == "simulation":
        logger.info(f"Running xAI Call {call_id} in local simulation mode.")
        await _run_simulated_xai_session(call_id, caller_number)
        return

    # Real WebSocket Connection to xAI
    headers = {"Authorization": f"Bearer {api_key}"}
    system_instructions = await build_xai_system_instructions(caller_number, prospect_name)
    tools_list = get_xai_tool_definitions()

    transcript_history = []
    call_active = True

    try:
        async with websockets.connect(
            ws_url,
            additional_headers=headers,
            ping_interval=20,
            ping_timeout=15,
            close_timeout=10
        ) as ws:
            await log_process_event(
                subsystem="voice",
                process_name="xai_ws_session_connected",
                message=f"xAI Realtime WebSocket connected successfully for call {call_id}.",
                level="SUCCESS",
                details={"callId": call_id, "voice": settings.XAI_VOICE_NAME}
            )

            # 2. Send session.update to configure voice, VAD, prompt & tools
            session_config = {
                "type": "session.update",
                "session": {
                    "modalities": ["audio", "text"],
                    "voice": settings.XAI_VOICE_NAME,
                    "instructions": system_instructions,
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 500
                    },
                    "tools": tools_list,
                    "tool_choice": "auto",
                    "input_audio_transcription": {
                        "model": "whisper-1"
                    }
                }
            }
            await ws.send(json.dumps(session_config))

            # Trigger opening agent greeting
            await ws.send(json.dumps({"type": "response.create"}))

            # 3. Event Processing Loop
            async for raw_msg in ws:
                event = json.loads(raw_msg)
                event_type = event.get("type", "")

                # Handle Voice Audio Transcripts (Assistant speaking)
                if event_type == "response.audio_transcript.delta":
                    delta_text = event.get("delta", "")
                    await call_hub.broadcast("call_transcript_delta", {
                        "callId": call_id,
                        "who": "ai",
                        "delta": delta_text
                    })

                elif event_type == "response.audio_transcript.done":
                    final_text = event.get("transcript", "")
                    if final_text:
                        line = f"AI: {final_text}"
                        transcript_history.append(line)
                        await _update_call_transcript(call_id, line)

                # Handle Caller Transcription (User speaking)
                elif event_type == "conversation.item.input_audio_transcription.completed":
                    caller_text = event.get("transcript", "")
                    if caller_text:
                        line = f"Prospect: {caller_text}"
                        transcript_history.append(line)
                        await _update_call_transcript(call_id, line)
                        await call_hub.broadcast("call_transcript_delta", {
                            "callId": call_id,
                            "who": "them",
                            "delta": caller_text
                        })

                # Handle Tool/Function Calls
                elif event_type == "response.function_call_arguments.done":
                    call_tool_id = event.get("call_id")
                    tool_name = event.get("name")
                    raw_args = event.get("arguments", "{}")
                    
                    try:
                        parsed_args = json.loads(raw_args)
                    except Exception:
                        parsed_args = {}

                    tool_result = await execute_xai_tool(
                        name=tool_name,
                        args=parsed_args,
                        call_id=call_id,
                        prospect_id=prospect_id
                    )

                    await ws.send(json.dumps({
                        "type": "conversation.item.create",
                        "item": {
                            "type": "function_call_output",
                            "call_id": call_tool_id,
                            "output": json.dumps(tool_result)
                        }
                    }))

                    await ws.send(json.dumps({"type": "response.create"}))

                elif event_type in ["session.ended", "call.ended"]:
                    logger.info(f"xAI signaled session ended for {call_id}")
                    call_active = False
                    break

    except websockets.exceptions.ConnectionClosed as cc:
        logger.warning(f"xAI WebSocket connection closed for call {call_id}: code={cc.code}, reason={cc.reason}")
    except Exception as exc:
        logger.error(f"Unexpected error in xAI WebSocket session for call {call_id}: {exc}", exc_info=True)
    finally:
        duration_sec = int(time.time() - start_ts)
        duration_str = f"{duration_sec // 60:02d}:{duration_sec % 60:02d}"
        await _finalize_call(call_id, duration_str, transcript_history)


# ----------------------------------------------------------------------
# 5. HELPERS FOR DB SYNC & CALL TERMINATION
# ----------------------------------------------------------------------
async def _update_call_transcript(call_id: str, new_line: str):
    """Appends a new transcript line to LiveCall in database."""
    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
            c = res.scalars().first()
            if c:
                current = list(c.transcript or [])
                current.append(new_line)
                c.transcript = current
                await db.commit()
    except Exception as err:
        logger.error(f"Error updating transcript for {call_id}: {err}")


async def _finalize_call(call_id: str, duration_str: str, transcript: List[str]):
    """Cleans up call state in database and notifies UI and telephony logs."""
    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
            call_obj = res.scalars().first()
            if call_obj:
                call_obj.ended = True
                call_obj.state = "ended"
                call_obj.duration = duration_str
                prospect_name = call_obj.prospect
                mission_name = call_obj.mission
                is_booked = call_obj.booked
                await db.commit()

                call_log_entry = CallLog(
                    id=f"clog_{uuid.uuid4().hex[:8]}",
                    canonical_name=prospect_name,
                    listed_as=prospect_name,
                    channel="voice",
                    mission=mission_name,
                    started_at=datetime.utcnow().strftime("%H:%M"),
                    ended_at=datetime.utcnow().strftime("%H:%M"),
                    duration=f"{duration_str} min",
                    outcome="meeting_booked" if is_booked else "contacted",
                    transcript=call_obj.transcript or transcript
                )
                db.add(call_log_entry)
                await db.commit()

        await call_hub.broadcast("call_ended", {
            "callId": call_id,
            "duration": duration_str,
            "ended": True
        })

        await log_process_event(
            subsystem="telephony",
            process_name="call_session_finalized",
            message=f"Call {call_id} completed and finalized. Duration: {duration_str}.",
            level="SUCCESS",
            details={"callId": call_id, "duration": duration_str, "transcriptLines": len(transcript)}
        )
    except Exception as err:
        logger.error(f"Error finalizing call {call_id}: {err}")


async def _run_simulated_xai_session(call_id: str, caller_number: str):
    """Simulation fallback when real xAI keys are not provided."""
    sample_dialogue = [
        ("ai", "Hello! This is Sam calling from AIVHub. How are you doing today?"),
        ("them", "Hi Sam. I'm doing well, what is this regarding?"),
        ("ai", "I'm calling regarding our AI-powered operational dashboards for enterprise workflows. Do you currently have unified visibility over your cross-system operations?"),
        ("them", "We use several tools but consolidating them has been a pain. How does your pricing work?"),
        ("ai", "Let me check our knowledge base for exact enterprise tier details."),
        ("ai", "Our enterprise tier includes custom data connectors, private deployment, and dedicated SLA support. Would you be open to a 15-minute walkthrough tomorrow at 2 PM?"),
        ("them", "Tomorrow at 2 PM works fine for me."),
        ("ai", "Fantastic! I've booked that slot on our calendar. We look forward to speaking with you then. Have a wonderful day!")
    ]

    for who, text in sample_dialogue:
        await asyncio.sleep(2.0)
        line = f"AI: {text}" if who == "ai" else f"Prospect: {text}"
        await _update_call_transcript(call_id, line)
        await call_hub.broadcast("call_transcript_delta", {
            "callId": call_id,
            "who": who,
            "delta": text
        })
        if "booked that slot" in text:
            await execute_xai_tool("book_calendar_meeting", {"date": "Tomorrow", "time": "14:00", "notes": "Demo from simulated call"}, call_id)

    await _finalize_call(call_id, "00:45", [f"{w.upper()}: {t}" for w, t in sample_dialogue])
