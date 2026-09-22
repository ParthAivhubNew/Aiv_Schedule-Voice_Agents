"""
LiveKit Voice & WebRTC Orchestration Service (Self-Hosted)
Handles token generation, room lifecycle management, server health probing,
and non-breaking WebRTC browser calling bridged to our AI voice pipeline.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx
import re
from fastapi import Request

from app.config import settings
from app.services.process_logger import log_process_event

logger = logging.getLogger("livekit_service")

# Try importing livekit-api with graceful fallback
try:
    from livekit.api import AccessToken, VideoGrants, LiveKitAPI
    LIVEKIT_API_AVAILABLE = True
except Exception as e:
    logger.warning("livekit-api package not available or failed to import: %s", e)
    AccessToken = None
    VideoGrants = None
    LiveKitAPI = None
    LIVEKIT_API_AVAILABLE = False


def resolve_client_livekit_url(request: Optional[Request] = None) -> str:
    """
    Resolves the external WebSocket URL that the browser client should connect to.
    Prioritizes LIVEKIT_PUBLIC_URL if configured, or infers from the incoming request hostname.
    """
    if settings.LIVEKIT_PUBLIC_URL:
        return settings.LIVEKIT_PUBLIC_URL

    configured_url = settings.LIVEKIT_URL or "ws://localhost:7880"

    # If backend is running inside docker or behind reverse proxy, rewrite internal hostname
    parsed = urlparse(configured_url)
    hostname = parsed.hostname or "localhost"

    # If configured host is an internal docker container name (like 'livekit'), use the request host for the browser
    if hostname in ("livekit", "0.0.0.0", "127.0.0.1", "localhost") and request:
        req_host = request.headers.get("host", "").split(":")[0]
        if req_host and req_host not in ("livekit", "0.0.0.0"):
            scheme = "wss" if request.url.scheme == "https" else "ws"
            port = parsed.port or 7880
            return f"{scheme}://{req_host}:{port}"

    return configured_url


def generate_livekit_token(
    room_name: str,
    identity: str,
    name: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    is_agent: bool = False,
    can_publish: bool = True,
    can_subscribe: bool = True,
    ttl_seconds: int = 7200,
    org_id: Optional[str] = None,
) -> str:
    """
    Generates a secure WebRTC JWT token for a participant joining a LiveKit room.
    
    Multi-tenant: Room names are automatically namespaced by org_id to isolate organizations.
    Each org only sees their own calls in their own room namespace.
    """
    api_key = settings.LIVEKIT_API_KEY or "devkey"
    api_secret = settings.LIVEKIT_API_SECRET or "secret1234567890abcdef1234567890abcdef"
    display_name = name or identity

    # Multi-tenant room isolation: prefix room name with org_id
    # Format: "org_{org_id}_{call_id}" so each organization's calls are isolated
    if org_id:
        isolated_room = f"org_{org_id}_{room_name}"
    else:
        isolated_room = room_name

    meta_dict = metadata or {}
    meta_dict["org_id"] = org_id or "default"
    meta_dict["room"] = room_name  # Original room name for reference
    meta_str = json.dumps(meta_dict)

    from datetime import timedelta

    if LIVEKIT_API_AVAILABLE and AccessToken and VideoGrants:
        grants = VideoGrants(
            room_join=True,
            room=isolated_room,
            can_publish=can_publish,
            can_subscribe=can_subscribe,
            can_publish_data=True,
            room_admin=is_agent,
        )
        token_builder = (
            AccessToken(api_key, api_secret)
            .with_identity(identity)
            .with_name(display_name)
            .with_grants(grants)
            .with_ttl(timedelta(seconds=ttl_seconds))
        )
        if meta_str:
            token_builder.with_metadata(meta_str)
        return token_builder.to_jwt()

    # Fallback JWT builder using PyJWT or python-jose
    try:
        import jwt
        payload = {
            "iss": api_key,
            "sub": identity,
            "name": display_name,
            "nbf": int(time.time()),
            "exp": int(time.time()) + ttl_seconds,
            "video": {
                "roomJoin": True,
                "room": isolated_room,
                "canPublish": can_publish,
                "canSubscribe": can_subscribe,
                "canPublishData": True,
                "roomAdmin": is_agent,
            },
            "metadata": meta_str,
        }
        return jwt.encode(payload, api_secret, algorithm="HS256")
    except Exception as jwt_err:
        logger.error("Failed to generate fallback LiveKit token: %s", jwt_err)
        raise RuntimeError(f"Cannot generate LiveKit token: {jwt_err}")


async def check_livekit_health() -> Dict[str, Any]:
    """
    Probes the LiveKit server HTTP endpoint to verify operational health.
    Returns status, latency, and connection URL.
    """
    base_ws = settings.LIVEKIT_URL or "ws://localhost:7880"
    parsed = urlparse(base_ws)
    scheme = "https" if parsed.scheme == "wss" else "http"
    host = parsed.hostname or "localhost"
    port = parsed.port or 7880
    http_url = f"{scheme}://{host}:{port}"

    start_t = time.time()
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            # LiveKit server root returns 404 or OK on GET /
            resp = await client.get(f"{http_url}/")
            duration_ms = round((time.time() - start_t) * 1000, 1)
            # Any HTTP status code (200, 404) means the server is reachable and running
            return {
                "online": True,
                "url": base_ws,
                "http_url": http_url,
                "latency_ms": duration_ms,
                "status_code": resp.status_code,
                "details": f"LiveKit server is online and reachable ({duration_ms}ms).",
            }
    except Exception as e:
        duration_ms = round((time.time() - start_t) * 1000, 1)
        return {
            "online": False,
            "url": base_ws,
            "http_url": http_url,
            "latency_ms": duration_ms,
            "status_code": None,
            "error": str(e),
            "details": f"LiveKit server is not responding at {http_url}. Run 'docker compose up -d livekit' to start.",
        }


async def process_livekit_webhook_event(event_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Processes asynchronous event notifications from LiveKit server (room started, participant joined/left).
    Safely bridges into live call tracking and subsystem process logs.
    """
    event_type = event_data.get("event") or event_data.get("type", "unknown")
    room_info = event_data.get("room", {})
    participant_info = event_data.get("participant", {})

    room_name = room_info.get("name") or event_data.get("room_name", "")
    participant_identity = participant_info.get("identity") or event_data.get("identity", "")

    logger.info("[LiveKit Webhook] Received event: %s for room: %s, participant: %s", event_type, room_name, participant_identity)

    # Log to subsystem process logger
    try:
        await log_process_event(
            subsystem="voice",
            process_name=f"livekit_{event_type.lower()}",
            message=f"LiveKit WebRTC event: {event_type} in room '{room_name}' (identity: {participant_identity})",
            level="INFO",
            details={
                "event": event_type,
                "room": room_name,
                "identity": participant_identity,
            },
        )
    except Exception as log_err:
        logger.warning("Could not log LiveKit event to process_logger: %s", log_err)

    return {"status": "processed", "event": event_type, "room": room_name}


# ---------------------------------------------------------------------------
# LiveKit AI Room Agent Worker
# Automatically joins WebRTC rooms when initiated from browser, speaks to user,
# and bridges LLM conversation + TTS audio directly into the LiveKit SFU.
# ---------------------------------------------------------------------------

active_livekit_agents: Dict[str, Any] = {}

try:
    import livekit.rtc as rtc
    LIVEKIT_RTC_AVAILABLE = True
except Exception as _rtc_err:
    logger.warning("livekit.rtc not available: %s", _rtc_err)
    rtc = None
    LIVEKIT_RTC_AVAILABLE = False


async def synthesize_livekit_pcm(text: str) -> Optional[bytes]:
    """
    Synthesizes speech into raw 24kHz 16-bit linear PCM bytes for LiveKit AudioFrame playback.
    Uses Cartesia, Deepgram Aura, or ElevenLabs from active voice plan.
    """
    if not text or not text.strip():
        return None

    clean = re.sub(r"[*_`#]+", "", text).strip()
    if len(clean) > 500:
        clean = clean[:500]

    try:
        from app.services.voice_plugin_plan import resolve_voice_plan
        plan = await resolve_voice_plan()
        tts = plan.tts
        if not tts or not tts.api_key:
            return None

        provider = (tts.provider or "").lower()
        vid = tts.voice_id or "a0e99841-438c-4a64-b679-ae501e7d6091"

        # 1. Cartesia Sonic -> 24kHz raw PCM
        if "cartesia" in provider or vid.startswith("a0e9"):
            model_candidates = ("sonic-2", "sonic-turbo", "sonic-3", "sonic-latest")
            async with httpx.AsyncClient(timeout=10.0) as client:
                for mid in model_candidates:
                    try:
                        res = await client.post(
                            "https://api.cartesia.ai/tts/bytes",
                            headers={
                                "X-API-Key": tts.api_key,
                                "Cartesia-Version": "2024-06-10",
                                "Content-Type": "application/json",
                            },
                            json={
                                "model_id": mid,
                                "transcript": clean,
                                "voice": {"mode": "id", "id": vid},
                                "output_format": {
                                    "container": "raw",
                                    "encoding": "pcm_s16le",
                                    "sample_rate": 24000,
                                },
                            },
                        )
                        if res.status_code == 200 and len(res.content) > 100:
                            return res.content
                    except Exception:
                        continue

        # 2. Deepgram Aura -> 24kHz linear16 PCM
        if "deepgram" in provider or "aura" in provider:
            url = f"https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=linear16&sample_rate=24000"
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(
                    url,
                    headers={"Authorization": f"Token {tts.api_key}", "Content-Type": "application/json"},
                    json={"text": clean},
                )
                if res.status_code == 200 and len(res.content) > 100:
                    return res.content

        # 3. ElevenLabs -> 24kHz PCM
        if "eleven" in provider:
            el_vid = vid if len(vid) >= 16 else "21m00Tcm4TlvDq8ikWAM"
            url = f"https://api.elevenlabs.io/v1/text-to-speech/{el_vid}?output_format=pcm_24000"
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(
                    url,
                    headers={"xi-api-key": tts.api_key, "Content-Type": "application/json"},
                    json={"text": clean, "model_id": "eleven_turbo_v2_5"},
                )
                if res.status_code == 200 and len(res.content) > 100:
                    return res.content

    except Exception as err:
        logger.warning("synthesize_livekit_pcm failed: %s", err)

    return None


async def stream_pcm_frames_to_source(source: Any, pcm_bytes: bytes, sample_rate: int = 24000) -> None:
    """Streams 24kHz 16-bit linear PCM into LiveKit AudioSource in smooth 20ms frames with jitter buffer priming."""
    if not source or not pcm_bytes or not LIVEKIT_RTC_AVAILABLE:
        return
    import time
    samples_per_frame = int(sample_rate * 0.02)  # 480 samples = 20ms at 24kHz
    bytes_per_frame = samples_per_frame * 2      # 16-bit = 2 bytes/sample -> 960 bytes

    start_t = time.perf_counter()
    frame_interval = 0.020
    offsets = list(range(0, len(pcm_bytes), bytes_per_frame))

    # Pre-fill 3 frames (60ms jitter buffer) to prevent initial WebRTC playback underrun
    burst_count = min(3, len(offsets))
    for i in range(burst_count):
        chunk = pcm_bytes[offsets[i]:offsets[i] + bytes_per_frame]
        if len(chunk) < bytes_per_frame:
            chunk = chunk + b"\x00" * (bytes_per_frame - len(chunk))
        try:
            frame = rtc.AudioFrame(chunk, sample_rate, 1, samples_per_frame)
            await source.capture_frame(frame)
        except Exception:
            return

    for idx, offset in enumerate(offsets[burst_count:], start=1):
        chunk = pcm_bytes[offset:offset + bytes_per_frame]
        if len(chunk) < bytes_per_frame:
            chunk = chunk + b"\x00" * (bytes_per_frame - len(chunk))
        try:
            frame = rtc.AudioFrame(chunk, sample_rate, 1, samples_per_frame)
            await source.capture_frame(frame)
            expected_time = idx * frame_interval
            actual_time = time.perf_counter() - start_t
            sleep_needed = expected_time - actual_time
            if sleep_needed > 0.002:
                await asyncio.sleep(sleep_needed)
        except Exception as frame_err:
            logger.debug("LiveKit frame push error: %s", frame_err)
            break


async def query_livekit_agent_llm(
    history: List[Dict[str, str]],
    prospect_name: str,
    company_name: str,
) -> str:
    """Queries connected LLM to generate spoken conversational responses."""
    system_prompt = (
        f"You are the voice AI assistant for {company_name}, speaking live with {prospect_name} over WebRTC. "
        "Keep your answers concise, natural, polite, and spoken in 1 to 2 clear sentences. "
        "Never output markdown, bullet points, asterisks, or formatting."
    )
    from app.services.voice_modular import _call_llm, _call_deepseek, _call_openai
    from app.services.voice_plugin_plan import resolve_voice_plan
    plan = await resolve_voice_plan()
    llm = plan.llm

    msgs = [{"role": "system", "content": system_prompt}] + history[-8:]
    try:
        if llm and llm.api_key:
            prov = (llm.provider or "").lower()
            if "deepseek" in prov:
                ans = await _call_deepseek(llm.api_key, msgs, llm.model or "deepseek-chat")
                if ans:
                    return ans.strip()
            elif "openai" in prov:
                ans = await _call_openai(llm.api_key, msgs, llm.model or "gpt-4o-mini")
                if ans:
                    return ans.strip()
        # Fallback to general modular LLM caller
        ans = await _call_llm(plan, msgs)
        if ans:
            return ans.strip()
    except Exception as llm_err:
        logger.warning("LiveKit LLM query error: %s", llm_err)

    # Clean default conversational response
    last_user = history[-1]["content"] if history else ""
    return f"I understand you're asking about {last_user[:40] if last_user else 'our services'}. How can we best help you with that today?"


async def start_livekit_room_agent(
    room_name: str,
    call_id: str,
    prospect_name: Optional[str] = "Browser Caller",
    company_name: Optional[str] = "AIVHub",
    org_id: Optional[str] = "default",
) -> None:
    """
    Launches an AI voice assistant participant directly into the LiveKit WebRTC room.
    The agent publishes an audio track, sends live transcripts over data channel,
    and converses naturally with the human participant.
    """
    if not LIVEKIT_RTC_AVAILABLE or not rtc:
        logger.warning("Cannot start LiveKit agent: livekit.rtc is not available.")
        return

    # Isolate room namespace matching token generation
    isolated_room = f"org_{org_id}_{room_name}" if org_id and not room_name.startswith("org_") else room_name
    agent_identity = f"agent_{call_id[:8]}"
    agent_name = f"{company_name} AI Assistant"

    try:
        agent_token = generate_livekit_token(
            room_name=room_name,
            identity=agent_identity,
            name=agent_name,
            is_agent=True,
            can_publish=True,
            can_subscribe=True,
            org_id=org_id,
        )
    except Exception as tok_err:
        logger.error("Failed to generate agent token for room %s: %s", isolated_room, tok_err)
        return

    ws_url = settings.LIVEKIT_URL or "ws://localhost:7880"
    room = rtc.Room()
    active_livekit_agents[call_id] = room

    conversation_history: List[Dict[str, str]] = []
    agent_audio_source = rtc.AudioSource(24000, 1)
    speaking_task: Optional[asyncio.Task] = None
    barge_event = asyncio.Event()

    def _is_livekit_backchannel(text: str) -> bool:
        cleaned = re.sub(r"[^\w\s]", "", (text or "").lower()).strip()
        words = cleaned.split()
        return len(words) <= 1 and cleaned in (
            "yeah", "yep", "mhm", "uhhuh", "uh-huh", "right", "ok", "okay",
            "sure", "gotcha", "yup", "yes", "ah", "oh", "cool", "alright",
        )

    async def speak_text(reply_text: str):
        """Sends data channel transcript and plays synthesized audio into the room."""
        # 1. Publish data packet transcript for instant visual feedback
        try:
            payload = json.dumps({"who": "ai", "text": reply_text}).encode("utf-8")
            await room.local_participant.publish_data(payload, reliable=True)
        except Exception as pub_err:
            logger.debug("Failed to publish AI data packet: %s", pub_err)

        # 2. Persist to LiveCall in database
        try:
            from sqlalchemy import select
            from app.database import AsyncSessionLocal
            from app.models.models import LiveCall
            from app.websockets.call_hub import call_hub
            from datetime import datetime
            async with AsyncSessionLocal() as db:
                rec = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
                if rec:
                    t_list = list(rec.transcript or [])
                    t_list.append({"who": "ai", "text": reply_text, "timestamp": datetime.utcnow().isoformat()})
                    rec.transcript = t_list
                    await db.commit()
                    await call_hub.broadcast({
                        "type": "call_transcript_delta",
                        "call_id": call_id,
                        "who": "ai",
                        "text": reply_text,
                    })
        except Exception:
            pass

        # 3. Synthesize and push PCM audio into room track
        pcm_bytes = await synthesize_livekit_pcm(reply_text)
        if pcm_bytes and not barge_event.is_set():
            await stream_pcm_frames_to_source(agent_audio_source, pcm_bytes, 24000)

    # Event: Incoming data messages (from browser Web Speech API or chat)
    @room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        nonlocal speaking_task
        try:
            raw_text = data_packet.data.decode("utf-8")
            data = json.loads(raw_text)
            user_text = data.get("text") or data.get("message")
            if user_text and user_text.strip():
                logger.info("[LiveKit-Agent] User spoke via data channel: %s", user_text)

                is_speaking = bool(speaking_task and not speaking_task.done())
                # If agent is speaking and caller gives a 1-word backchannel, do not cancel speech
                if is_speaking and _is_livekit_backchannel(user_text):
                    logger.info("[LiveKit-Agent] Backchannel acknowledged: %s", user_text)
                    return

                # True interruption: cancel speech and clear buffer
                if is_speaking:
                    logger.info("[LiveKit-Agent] Barge-in detected (%s). Cancelling speech.", user_text)
                    barge_event.set()
                    speaking_task.cancel()

                barge_event.clear()
                conversation_history.append({"role": "user", "content": user_text.strip()})

                # Spawn async preemptive response handler
                async def handle_response():
                    ai_reply = await query_livekit_agent_llm(
                        conversation_history,
                        prospect_name=prospect_name or "Caller",
                        company_name=company_name or "AIVHub",
                    )
                    conversation_history.append({"role": "assistant", "content": ai_reply})
                    await speak_text(ai_reply)

                speaking_task = asyncio.create_task(handle_response())
        except Exception as data_err:
            logger.debug("Error parsing incoming LiveKit data packet: %s", data_err)

    # Event: Remote participant leaves -> shut down agent
    @room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        logger.info("[LiveKit-Agent] Participant %s left room %s", participant.identity, isolated_room)
        asyncio.create_task(shutdown_agent())

    async def shutdown_agent():
        active_livekit_agents.pop(call_id, None)
        try:
            await room.disconnect()
        except Exception:
            pass

    try:
        # 1. Connect to the LiveKit SFU
        logger.info("[LiveKit-Agent] Connecting agent to %s (room: %s)...", ws_url, isolated_room)
        await room.connect(ws_url, agent_token)
        logger.info("[LiveKit-Agent] Agent connected successfully to room %s", isolated_room)

        # 2. Publish audio track for microphone speech
        local_track = rtc.LocalAudioTrack.create_audio_track("agent_mic", agent_audio_source)
        track_opts = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await room.local_participant.publish_track(local_track, track_opts)

        # 3. Wait a moment for browser user to finish establishing connection
        await asyncio.sleep(1.0)

        # 4. Speak initial welcoming greeting
        greeting = f"Hello {prospect_name or 'there'}! I am your {company_name or 'AIVHub'} voice assistant on LiveKit WebRTC. How can I help you today?"
        conversation_history.append({"role": "assistant", "content": greeting})
        await speak_text(greeting)

        # 5. Keep alive while user is in room (max 30 minutes)
        for _ in range(360):
            if room.connection_state != rtc.ConnectionState.CONN_CONNECTED:
                break
            # If no remote participants remain after 15 seconds, exit
            if len(room.remote_participants) == 0 and _ > 2:
                logger.info("[LiveKit-Agent] No participants left in room %s. Disconnecting.", isolated_room)
                break
            await asyncio.sleep(5)

    except Exception as run_err:
        logger.error("[LiveKit-Agent] Error during room agent session: %s", run_err)
    finally:
        await shutdown_agent()
