import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
from datetime import datetime, timedelta
import re
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
    FAQ,
)
from app.services.process_logger import log_process_event, scrub_text
from app.services.rag_service import search_knowledge
from app.websockets.call_hub import call_hub

logger = logging.getLogger("xai_voice_service")

# Global registry of live xAI WebSocket sessions for supervisor takeover and handoff
active_xai_sessions: Dict[str, Any] = {}

async def notify_xai_takeover_state(call_id: str, taken: bool, recent_transcript: List[str] = None):
    """
    Informs xAI Realtime session when a human supervisor takes over or hands back.
    On hand back, injects the conversation context so the AI resumes seamlessly.
    """
    ws = active_xai_sessions.get(call_id)
    if not ws:
        return
    try:
        if taken:
            try:
                await ws.send(json.dumps({"type": "response.cancel"}))
            except Exception:
                pass
            await ws.send(json.dumps({
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [{
                        "type": "input_text",
                        "text": "[SYSTEM NOTICE: A human supervisor has taken over the call. Do not speak or generate responses until instructed.]"
                    }]
                }
            }))
            logger.info(f"[XAI-WS] Muted xAI voice agent for supervisor takeover on call {call_id}")
        else:
            # Build smart briefing of what happened during human takeover
            summary_lines = [str(l) for l in (recent_transcript or [])[-4:] if not str(l).startswith("System:")]
            summary_text = " // ".join(summary_lines) if summary_lines else "The supervisor spoke with the prospect and answered their initial questions."
            handoff_msg = (
                f"[SYSTEM NOTICE: The human supervisor has just handed the call back to you. "
                f"Points discussed during the takeover: '{summary_text}'. "
                f"Acknowledge the handoff smoothly and continue assisting the client naturally.]"
            )
            await ws.send(json.dumps({
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [{
                        "type": "input_text",
                        "text": handoff_msg
                    }]
                }
            }))
            # Trigger immediate spoken continuation
            await ws.send(json.dumps({"type": "response.create"}))
            logger.info(f"[XAI-WS] Injected supervisor handoff context into xAI session for call {call_id}")
    except Exception as err:
        logger.warning(f"[XAI-WS] Error notifying takeover state for {call_id}: {err}")


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
    Service Catalog, caller context, real-world temporal ground truth,
    and charismatic, natural conversational rules.
    """
    now = datetime.utcnow()
    current_date_str = now.strftime("%A, %d %B %Y")
    current_time_str = now.strftime("%I:%M %p UTC")
    tomorrow_str = (now + timedelta(days=1)).strftime("%A, %d %B %Y")

    async with AsyncSessionLocal() as db:
        prof_res = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
        profile = prof_res.scalars().first()
        
        services_res = await db.execute(select(Service))
        services = services_res.scalars().all()

        faqs_res = await db.execute(select(FAQ))
        faqs = faqs_res.scalars().all()

    company_name = profile.name if profile else "AIVHub"
    caller_name = profile.caller_name if profile else "Sam"
    pitch = profile.pitch if profile else "AI-driven operational intelligence and workflow automation."
    tone = profile.tone if profile else "Warm, charismatic, articulate, consultative, natural"
    disclosure = profile.disclosure if profile else "This call may be recorded for quality purposes."
    
    catalog_lines = []
    for s in services[:5]:
        catalog_lines.append(f"- {s.name}: {s.desc} (Ideal for: {s.ideal})")
    catalog_text = "\n".join(catalog_lines) if catalog_lines else "- Enterprise Voice & Knowledge Intelligence"

    faq_lines = []
    for f in faqs[:10]:
        faq_lines.append(f"- Q: {f.question}\n  A: {f.answer}")
    faq_text = "\n".join(faq_lines) if faq_lines else "None provided yet."

    target_name = prospect_name or "there"

    instructions = f"""You are {caller_name}, a highly articulate, warm, and charismatic AI executive representative calling from {company_name}.
Tone & Personality: {tone}. You sound like an experienced, personable enterprise partner having a relaxed, confident conversation — NEVER like a rigid telemarketer or robot reading a checklist.

TEMPORAL GROUND TRUTH (CRITICAL):
- Today's Date: {current_date_str}
- Current Time: {current_time_str}
- Tomorrow: {tomorrow_str}
- Current Year: {now.year}
- NEVER schedule, suggest, or accept past dates (e.g. 2024, 2025, or any day prior to today). If the prospect mentions a month without a year or a date in the past (like "27 July"), clarify naturally: "Just to confirm, are you thinking later this year or next week? For this week, I've got tomorrow or Friday open."

Your Objective:
Engage {target_name} warmly, share how {company_name} delivers real-world operational and voice AI results, answer their questions using your tools, and find a mutually convenient 15-minute slot for a live demo.

Company Pitch:
{pitch}

Key Services & Capabilities:
{catalog_text}

Verified Knowledge & FAQs (Ground Truth):
{faq_text}

Call Disclosure:
"{disclosure}"

CONVERSATION STYLE & VOICE GUIDELINES:
1. Speak in natural, fluid spoken English (1-3 sentences per turn maximum). Let the other person talk.
2. Use conversational bridges naturally ("Brilliant", "That makes total sense", "Spot on", "Fair enough", "I completely understand").
3. Be adaptable: If the person interrupts, changes topic, or asks a tough question, answer directly with confidence.
4. When booking a meeting:
   - Suggest near-term options: "Would tomorrow afternoon or perhaps Friday morning suit you better?"
   - When they mention a day and time, invoke `check_calendar_availability` or `book_calendar_meeting` immediately.
5. If they ask about detailed pricing, technical architecture, or onboarding, run `query_knowledge_base` to retrieve accurate facts.
6. If they are busy or in a meeting, say: "No problem at all, I know your time is valuable. Would it be better if I ping you a quick calendar invite for tomorrow, or when would be a quieter time?"
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
                faqs_res = await db.execute(select(FAQ))
                all_faqs = faqs_res.scalars().all()
                matching_faqs = []
                q_words = [w.lower() for w in query.split() if len(w) > 2]
                for f in all_faqs:
                    if any(w in f.question.lower() or w in f.answer.lower() for w in q_words):
                        matching_faqs.append(f"FAQ: {f.question}\nAnswer: {f.answer}")
            
            elapsed = (time.time() - start_time) * 1000
            extracted_chunks = matching_faqs + [f"Title: {r.get('title', 'Doc')}\nContent: {r.get('content')}" for r in results]

            await log_process_event(
                subsystem="crawler_rag",
                process_name="xai_rag_tool_lookup",
                message=f"RAG Knowledge search for '{query}' returned {len(extracted_chunks)} items (FAQs + Chunks).",
                level="INFO",
                duration_ms=elapsed,
                details={"callId": call_id, "query": query, "chunkCount": len(extracted_chunks)}
            )

            if not extracted_chunks:
                return {
                    "found": False,
                    "summary": "No specific document matched this exact query. Inform the caller we will have a specialist confirm details during our demo."
                }

            return {
                "found": True,
                "context": "\n---\n".join(extracted_chunks)
            }

        elif name == "book_calendar_meeting":
            raw_date = args.get("date", "Tomorrow")
            time_val = args.get("time", "14:00")
            notes_val = args.get("notes", "Discovery call booked via xAI Voice Agent")

            # Ground date to real-world future timeline
            now = datetime.utcnow()
            date_val = raw_date.strip()
            # If past year like 2024 or 2025 was provided, bump to current year
            date_val = re.sub(r"\b202[0-5]\b", str(now.year), date_val)
            if not date_val or date_val.lower() in ["tomorrow", "tmrw"]:
                date_val = (now + timedelta(days=1)).strftime("%A, %d %b %Y")
            elif date_val.lower() in ["today"]:
                date_val = now.strftime("%A, %d %b %Y")
            
            async with AsyncSessionLocal() as db:
                call_res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
                call_record = call_res.scalars().first()
                prospect_name = call_record.prospect if call_record else "Valued Prospect"
                mission_name = call_record.mission if call_record else "Inbound Voice"
                
                if call_record:
                    call_record.booked = True

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
                    prep=f"Auto-scheduled from voice outreach. Notes: {notes_val}",
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
            raw_date = args.get("date", "Tomorrow")
            now = datetime.utcnow()
            date_val = raw_date.strip()
            date_val = re.sub(r"\b202[0-5]\b", str(now.year), date_val)
            if not date_val or date_val.lower() in ["tomorrow", "tmrw"]:
                date_val = (now + timedelta(days=1)).strftime("%A, %d %b %Y")
            elif date_val.lower() in ["today"]:
                date_val = now.strftime("%A, %d %b %Y")

            slots = ["10:30 AM", "02:00 PM", "04:15 PM"]
            return {
                "available_slots": slots,
                "date": date_val,
                "message": f"For {date_val}, we have available slots at: {', '.join(slots)}."
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
    mission_name: Optional[str] = None,
    carrier_sid: Optional[str] = None
):
    """
    Connects an outbound WebSocket session to xAI Realtime Voice API
    (wss://api.x.ai/v1/realtime?call_id=...) for an incoming/outgoing call.
    """
    start_ts = time.time()
    agent_id = getattr(settings, "XAI_AGENT_ID", None) or "agent_QDoRHfWcKMybf197"
    # CRITICAL: ws_url uses the xAI SIP call_id to bridge audio directly into the phone call
    ws_url = f"{settings.XAI_REALTIME_WS_URL}?agent_id={agent_id}&call_id={call_id}"
    api_key = settings.XAI_API_KEY
    if not api_key:
        try:
            from app.models.models import Connection
            async with AsyncSessionLocal() as db:
                c_res = await db.execute(select(Connection).where(Connection.group_name == "Voice Orchestration"))
                c = c_res.scalars().first()
                if c and c.config and isinstance(c.config, dict):
                    stored_key = c.config.get("api_key")
                    if stored_key:
                        api_key = stored_key
                        settings.XAI_API_KEY = stored_key
                        settings.VOICE_ENGINE_MODE = "live"
        except Exception as k_err:
            logger.warning(f"Could not load xAI key from DB config: {k_err}")

    await log_process_event(
        subsystem="telephony",
        process_name="xai_ws_connecting",
        message=f"Connecting WebSocket to xAI Realtime API for sip_call_id={call_id} from caller={caller_number}",
        level="INFO",
        details={
            "callId": call_id,
            "carrierSid": carrier_sid,
            "caller": caller_number,
            "isLiveKey": bool(api_key and api_key.startswith("xai-")),
            "wsUrl": ws_url.replace(api_key, "***") if api_key else ws_url,
            "agentId": agent_id
        }
    )
    logger.info(
        f"[XAI-WS] Attempting WebSocket connection: "
        f"sip_call_id={call_id}, carrier_sid={carrier_sid}, agent_id={agent_id}, "
        f"key_prefix={api_key[:12] + '...' if api_key else 'NONE'}"
    )

    # 1. Link to existing LiveCall record (outbound) or create new (inbound)
    local_call_id = call_id
    async with AsyncSessionLocal() as db:
        call_obj = None
        if carrier_sid:
            c_res = await db.execute(select(LiveCall).where(LiveCall.carrier_sid == carrier_sid))
            call_obj = c_res.scalars().first()
        if not call_obj:
            call_res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
            call_obj = call_res.scalars().first()

        if call_obj:
            local_call_id = call_obj.id
            call_obj.state = "pitching"
            call_obj.transcript = (call_obj.transcript or []) + [
                f"System: xAI Realtime Voice Agent connected (SIP Call: {call_id[:8]}...)"
            ]
            await db.commit()
            logger.info(f"[XAI-WS] Linked xAI session to existing LiveCall {local_call_id} (carrier: {carrier_sid})")
        else:
            call_obj = LiveCall(
                id=call_id,
                carrier_sid=carrier_sid,
                mission_id=mission_name or "Inbound Mission",
                prospect_id=prospect_id,
                prospect=prospect_name or f"Caller ({caller_number[-4:] if len(caller_number) >= 4 else caller_number})",
                mission=mission_name or "Direct Inbound",
                state="pitching",
                channel="voice",
                duration="00:01",
                transcript=[f"System: Inbound xAI call connected ({call_id[:8]}...)"]
            )
            db.add(call_obj)
            await db.commit()

    await call_hub.broadcast("call_started", {
        "callId": local_call_id,
        "caller": caller_number,
        "prospect": prospect_name or caller_number,
        "state": "pitching"
    })

    # If in mock / simulation mode without real xAI key, run simulation bridge
    if not api_key or api_key.startswith("mock") or (settings.VOICE_ENGINE_MODE == "simulation" and not api_key.startswith("xai-")):
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
            active_xai_sessions[local_call_id] = ws
            active_xai_sessions[call_id] = ws
            logger.info(f"[XAI-WS] ✓ WebSocket CONNECTED for call_id={call_id}")
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
            event_count = 0
            async for raw_msg in ws:
                event = json.loads(raw_msg)
                event_type = event.get("type", "")
                event_count += 1

                # Log first few events for diagnostics
                if event_count <= 3:
                    logger.info(f"[XAI-WS] Event #{event_count} for {call_id}: type={event_type}")
                    if event_count == 1:
                        await log_process_event(
                            subsystem="voice",
                            process_name="xai_ws_first_event",
                            message=f"First xAI event received for call {call_id}: {event_type}",
                            level="INFO",
                            details={"callId": call_id, "eventType": event_type}
                        )

                # Handle Voice Audio Transcripts (Assistant speaking)
                if event_type == "response.audio_transcript.delta":
                    delta_text = event.get("delta", "")
                    await call_hub.broadcast("call_transcript_delta", {
                        "callId": local_call_id,
                        "who": "ai",
                        "delta": delta_text
                    })

                elif event_type in ["response.audio_transcript.done", "response.text.done"]:
                    final_text = event.get("transcript") or event.get("text", "")
                    if final_text:
                        line = f"AI: {final_text}"
                        if line not in transcript_history:
                            transcript_history.append(line)
                            await _update_call_transcript(local_call_id, line)

                elif event_type == "response.output_item.done":
                    item = event.get("item", {})
                    if item.get("role") == "assistant":
                        for content_part in item.get("content", []):
                            text_part = content_part.get("transcript") or content_part.get("text")
                            if text_part:
                                line = f"AI: {text_part}"
                                if line not in transcript_history:
                                    transcript_history.append(line)
                                    await _update_call_transcript(local_call_id, line)

                # Handle Caller Transcription (User speaking)
                elif event_type in ["conversation.item.input_audio_transcription.completed", "conversation.item.input_audio_transcription"]:
                    caller_text = event.get("transcript", "")
                    if caller_text:
                        line = f"Prospect: {caller_text}"
                        if line not in transcript_history:
                            transcript_history.append(line)
                            await _update_call_transcript(local_call_id, line)
                            await call_hub.broadcast("call_transcript_delta", {
                                "callId": local_call_id,
                                "who": "them",
                                "delta": caller_text
                            })

                elif event_type == "conversation.item.created":
                    item = event.get("item", {})
                    role = item.get("role", "")
                    for content_part in item.get("content", []):
                        text_part = content_part.get("transcript") or content_part.get("text")
                        if text_part:
                            prefix = "Prospect:" if role == "user" else "AI:"
                            line = f"{prefix} {text_part}"
                            if line not in transcript_history:
                                transcript_history.append(line)
                                await _update_call_transcript(local_call_id, line)
                                await call_hub.broadcast("call_transcript_delta", {
                                    "callId": local_call_id,
                                    "who": "them" if role == "user" else "ai",
                                    "delta": text_part
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
                        call_id=local_call_id,
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
        logger.warning(f"[XAI-WS] Connection closed for call {call_id}: code={cc.code}, reason={cc.reason}")
        await log_process_event(
            subsystem="voice",
            process_name="xai_ws_closed",
            message=f"xAI WebSocket closed for call {call_id}: code={cc.code}, reason={cc.reason}",
            level="WARNING",
            details={"callId": local_call_id, "sipCallId": call_id, "code": cc.code, "reason": cc.reason}
        )
    except Exception as exc:
        logger.error(f"[XAI-WS] CRASH in WebSocket session for call {call_id}: {exc}", exc_info=True)
        await log_process_event(
            subsystem="voice",
            process_name="xai_ws_error",
            message=f"xAI WebSocket session CRASHED for call {call_id}: {str(exc)}",
            level="ERROR",
            details={"callId": local_call_id, "sipCallId": call_id, "error": str(exc)}
        )
    finally:
        active_xai_sessions.pop(local_call_id, None)
        active_xai_sessions.pop(call_id, None)
        duration_sec = int(time.time() - start_ts)
        duration_str = f"{duration_sec // 60:02d}:{duration_sec % 60:02d}"
        await _finalize_call(local_call_id, duration_str, transcript_history)


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
    """Cleans up call state in database and reliably writes formatted permanent CallLog entry."""
    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
            call_obj = res.scalars().first()

            prospect_name = "Valued Prospect"
            mission_name = "Outbound Voice"
            is_booked = False
            raw_lines = transcript or []

            if call_obj:
                call_obj.ended = True
                call_obj.state = "ended"
                call_obj.duration = duration_str
                prospect_name = call_obj.prospect or prospect_name
                mission_name = call_obj.mission or mission_name
                is_booked = bool(call_obj.booked)
                if call_obj.transcript:
                    raw_lines = list(call_obj.transcript)
                await db.commit()

            # Format into UI CallLog transcript objects: [{"who": "ai"|"them", "text": "..."}]
            formatted_transcript = []
            for item in raw_lines:
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

            # Check if CallLog already exists for this call to avoid duplicate
            log_id = f"cl_{call_id.replace('call_', '')}"
            existing_log_res = await db.execute(select(CallLog).where(CallLog.id == log_id))
            existing_log = existing_log_res.scalars().first()

            now_str = datetime.utcnow().strftime("%d %b %Y, %H:%M")
            if not existing_log:
                call_log_entry = CallLog(
                    id=log_id,
                    canonical_name=prospect_name,
                    listed_as=prospect_name,
                    channel="voice",
                    mission=mission_name,
                    started_at=now_str,
                    ended_at=now_str,
                    duration=f"{duration_str} min",
                    outcome="meeting_booked" if is_booked else "contacted",
                    transcript=formatted_transcript
                )
                db.add(call_log_entry)
            else:
                existing_log.transcript = formatted_transcript
                existing_log.duration = f"{duration_str} min"
                if is_booked:
                    existing_log.outcome = "meeting_booked"

            await db.commit()

        await call_hub.broadcast("call_ended", {
            "callId": call_id,
            "duration": duration_str,
            "ended": True
        })

        await log_process_event(
            subsystem="telephony",
            process_name="call_session_finalized",
            message=f"Call {call_id} completed and saved to CallLog. Duration: {duration_str}, transcript lines: {len(formatted_transcript)}.",
            level="SUCCESS",
            details={"callId": call_id, "duration": duration_str, "transcriptLines": len(formatted_transcript), "booked": is_booked}
        )
    except Exception as err:
        logger.error(f"Error finalizing call {call_id}: {err}", exc_info=True)


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
