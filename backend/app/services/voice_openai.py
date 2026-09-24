"""OpenAI Realtime speech-to-speech over the same μ-law media socket as xAI."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Optional
import zoneinfo

import websockets
from sqlalchemy.future import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.models import LiveCall
from app.services.voice_plugin_plan import VoicePlan
from app.services.xai_voice_service import (
    BridgedVoiceSession,
    _update_call_transcript,
    build_xai_system_instructions,
    execute_xai_tool,
    get_xai_tool_definitions,
)
from app.websockets.call_hub import call_hub

logger = logging.getLogger("voice_openai")

OPENAI_VOICES = {
    "alloy": "alloy",
    "echo": "echo",
    "shimmer": "shimmer",
    "ash": "ash",
    "ballad": "ballad",
    "coral": "coral",
    "sage": "sage",
    "verse": "verse",
    "ara": "sage",
    "eve": "shimmer",
    "rex": "ash",
    "leo": "ash",
    "onyx": "ash",
    "rachel": "coral",
    "adam": "ash",
    "sonic": "verse",
}


async def run_openai_realtime(
    bridge: BridgedVoiceSession,
    call_id: str,
    caller_number: str,
    prospect_name: Optional[str],
    plan: VoicePlan,
    is_inbound: bool = False,
    carrier_sid: Optional[str] = None,
    prospect_id: Optional[str] = None,
) -> None:
    api_key = (plan.s2s_key or settings.OPENAI_API_KEY or "").strip()
    if not api_key or api_key.startswith("xai-"):
        logger.warning("[OPENAI] Missing OpenAI key — aborting realtime session")
        return

    voice = OPENAI_VOICES.get((plan.voice_name or "sage").lower(), "sage")
    local_id = call_id
    try:
        async with AsyncSessionLocal() as db:
            call_obj = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
            if call_obj:
                local_id = call_obj.id
                call_obj.state = "pitching"
                call_obj.transcript = (call_obj.transcript or []) + [
                    f"System: OpenAI Realtime voice engine connected (voice={voice})"
                ]
                await db.commit()
    except Exception as err:
        logger.warning(f"[OPENAI] LiveCall link failed: {err}")

    instructions = await build_xai_system_instructions(
        caller_number, prospect_name, hold_opening=False, prospect_id=None, call_id=local_id
    )
    ws_url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "OpenAI-Beta": "realtime=v1",
    }

    target_raw = prospect_name or "there"
    target_clean = re.sub(r"\(.*?\)", "", target_raw).strip()
    first = target_clean.split()[0] if target_clean else "there"
    if first.lower() in ("prospect", "caller"):
        first = "there"

    current_ai_text = ""
    greeting_dispatched = False
    greeting_audio_started = False

    async def commit_ai():
        nonlocal current_ai_text
        text = current_ai_text.strip()
        if not text:
            return
        await _update_call_transcript(local_id, f"AI: {text}")
        current_ai_text = ""

    async def dispatch_greeting(ws):
        nonlocal greeting_dispatched
        if greeting_dispatched:
            return
        greeting_dispatched = True
        try:
            london_tz = zoneinfo.ZoneInfo("Europe/London")
            now = datetime.now(london_tz)
        except Exception:
            now = datetime.utcnow() + timedelta(hours=1)
        clock = now.strftime("%I:%M %p").lstrip("0")
        day = now.strftime("%A, %d %B %Y")
        if is_inbound:
            line = (
                f"Speak FIRST immediately. It is {clock} on {day}. "
                f"Say warmly: 'Hello, thanks for calling! How can I help you today?' Do not mention timezones."
            )
        else:
            hi = f"Hi {first}" if first != "there" else "Hi there"
            line = (
                f"The person just picked up. Speak FIRST immediately. It is {clock} on {day}. "
                f"Say warmly: '{hi}, this is me calling. How's your day going?' Do not mention timezones."
            )
        await ws.send(json.dumps({
            "type": "response.create",
            "response": {"modalities": ["audio", "text"], "instructions": line},
        }))
        logger.info(f"[OPENAI] Greeting dispatched for {call_id} inbound={is_inbound}")

    try:
        async with websockets.connect(
            ws_url,
            additional_headers=headers,
            ping_interval=20,
            ping_timeout=15,
            close_timeout=10,
        ) as ws:
            bridge.ws = ws
            logger.info(f"[OPENAI] Realtime WS connected for {call_id}")
            session_body = {
                "modalities": ["audio", "text"],
                "voice": voice,
                "instructions": instructions,
                "temperature": 0.8,
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.5,
                    "prefix_padding_ms": 180,
                    "silence_duration_ms": 380,
                },
                "input_audio_format": "g711_ulaw",
                "output_audio_format": "g711_ulaw",
                "input_audio_transcription": {"model": "whisper-1"},
                "tools": get_xai_tool_definitions(),
                "tool_choice": "auto",
            }
            await ws.send(json.dumps({"type": "session.update", "session": session_body}))
            if not is_inbound:
                bridge.ready.set()

            async for raw_msg in ws:
                event = json.loads(raw_msg)
                et = event.get("type", "")
                if et in ("session.created", "session.updated"):
                    if not is_inbound:
                        bridge.ready.set()
                    await dispatch_greeting(ws)
                elif et in (
                    "response.audio.delta",
                    "response.output_audio.delta",
                    "response.audio.started",
                    "output_audio_buffer.started",
                ):
                    greeting_audio_started = True
                    delta = event.get("delta") or event.get("audio")
                    if delta:
                        await bridge.emit_ai_audio(delta)
                elif et == "error":
                    logger.error(f"[OPENAI] error for {call_id}: {event.get('error')}")
                elif et in ("response.audio_transcript.delta", "response.text.delta"):
                    delta_text = event.get("delta", "")
                    if delta_text:
                        current_ai_text += delta_text
                        await call_hub.broadcast("call_transcript_delta", {
                            "callId": local_id, "who": "ai", "delta": delta_text,
                        })
                elif et in ("response.audio_transcript.done", "response.text.done", "response.done"):
                    final_text = event.get("transcript") or event.get("text") or ""
                    if final_text:
                        current_ai_text = final_text
                    await commit_ai()
                elif et in (
                    "conversation.item.input_audio_transcription.completed",
                    "conversation.item.input_audio_transcription",
                ):
                    await commit_ai()
                    caller_text = event.get("transcript", "")
                    if caller_text:
                        await _update_call_transcript(local_id, f"Prospect: {caller_text}")
                        await call_hub.broadcast("call_transcript_delta", {
                            "callId": local_id, "who": "them", "delta": caller_text,
                        })
                elif et == "response.function_call_arguments.done":
                    tool_call_id = event.get("call_id")
                    tool_name = event.get("name")
                    try:
                        parsed_args = json.loads(event.get("arguments", "{}"))
                    except Exception:
                        parsed_args = {}
                    tool_result = await execute_xai_tool(
                        name=tool_name,
                        args=parsed_args,
                        call_id=local_id,
                        prospect_id=prospect_id,
                    )
                    await ws.send(json.dumps({
                        "type": "conversation.item.create",
                        "item": {
                            "type": "function_call_output",
                            "call_id": tool_call_id,
                            "output": json.dumps(tool_result),
                        },
                    }))
                    await ws.send(json.dumps({"type": "response.create"}))
    except Exception as err:
        logger.warning(f"[OPENAI] session ended for {call_id}: {err}")
    finally:
        bridge.ws = None
        logger.info(f"[OPENAI] session closed for {call_id}")
        _ = greeting_audio_started
        # Engine stopped: if the row is still open, finalize it and release the carrier
        # leg so the prospect's phone drops at the same moment as ours.
        try:
            from app.services.xai_voice_service import _finalize_call
            async with AsyncSessionLocal() as fin_db:
                row = (await fin_db.execute(select(LiveCall).where(LiveCall.id == local_id))).scalars().first()
                if row is not None and not row.ended:
                    started = row.created_at or datetime.utcnow()
                    secs = max(1, int((datetime.utcnow() - started).total_seconds()))
                    await _finalize_call(local_id, f"{secs // 60:02d}:{secs % 60:02d}", list(row.transcript or []))
        except Exception as fin_err:
            logger.warning(f"[OPENAI] finalize on session end failed for {call_id}: {fin_err}")
