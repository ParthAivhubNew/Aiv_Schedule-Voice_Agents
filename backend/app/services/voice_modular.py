"""Modular live-call pipeline: Deepgram STT → LLM gateway → ElevenLabs/Cartesia TTS."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from typing import Optional

import httpx
import websockets

from sqlalchemy.future import select

from app.database import AsyncSessionLocal
from app.models.models import CompanyProfile, LiveCall
from app.services.llm_gateway import call_open_chat_llm
from app.services.voice_plugin_plan import VoicePlan, looks_like_external_voice_id
from app.services.xai_voice_service import (
    BridgedVoiceSession,
    _update_call_transcript,
    build_xai_system_instructions,
)
from app.websockets.call_hub import call_hub

logger = logging.getLogger("voice_modular")

FRAME_BYTES = 160  # 20ms of 8kHz μ-law
ELEVEN_VOICES = {
    "rachel": "21m00Tcm4TlvDq8ikWAM",
    "ara": "21m00Tcm4TlvDq8ikWAM",
    "eve": "EXAVITQu4vr4xnSDxMaL",
    "adam": "pNInz6obpgDQGcFmaJgB",
    "rex": "pNInz6obpgDQGcFmaJgB",
    "leo": "pNInz6obpgDQGcFmaJgB",
}
CARTESIA_VOICES = {
    "sonic": "79a125e8-cd45-4c13-8a67-188112f4dd22",
    "rachel": "79a125e8-cd45-4c13-8a67-188112f4dd22",
    "ara": "79a125e8-cd45-4c13-8a67-188112f4dd22",
    "adam": "a0e99841-438c-4a64-b679-ae501e7d6091",
    "rex": "a0e99841-438c-4a64-b679-ae501e7d6091",
}


def _ulaw_frames(raw: bytes):
    for i in range(0, len(raw), FRAME_BYTES):
        chunk = raw[i : i + FRAME_BYTES]
        if len(chunk) < FRAME_BYTES:
            chunk = chunk + b"\xff" * (FRAME_BYTES - len(chunk))
        yield base64.b64encode(chunk).decode("ascii")


def _resolve_cartesia_vid(voice_hint: str, voice_id: Optional[str]) -> str:
    """Prefer explicit clone UUID; never drop a custom id for the default sonic voice."""
    explicit = (voice_id or "").strip()
    if explicit:
        return explicit
    hint = (voice_hint or "").strip()
    if not hint:
        return CARTESIA_VOICES["sonic"]
    mapped = CARTESIA_VOICES.get(hint.lower())
    if mapped:
        return mapped
    if looks_like_external_voice_id(hint):
        return hint
    return CARTESIA_VOICES["sonic"]


def _resolve_eleven_vid(voice_hint: str, voice_id: Optional[str]) -> str:
    explicit = (voice_id or "").strip()
    if explicit:
        return explicit
    hint = (voice_hint or "").strip()
    if not hint:
        return ELEVEN_VOICES["rachel"]
    mapped = ELEVEN_VOICES.get(hint.lower())
    if mapped:
        return mapped
    if looks_like_external_voice_id(hint):
        return hint
    return ELEVEN_VOICES["rachel"]


async def _speak(bridge: BridgedVoiceSession, plan: VoicePlan, text: str, pace: bool = False) -> None:
    tts = plan.tts
    if not tts or not text.strip():
        return
    clean = re.sub(r"[*_`#]+", "", text).strip()
    if len(clean) > 600:
        clean = clean[:600]
    provider = (tts.provider or "elevenlabs").lower()
    voice_hint = (tts.voice_id or plan.voice_name or "rachel").strip()
    raw = b""
    try:
        use_cartesia = "cartesia" in provider or voice_hint.lower() == "sonic"
        if use_cartesia and "eleven" not in provider:
            raw = await _cartesia_ulaw(tts.api_key, voice_hint, clean, tts.voice_id)
        else:
            raw = await _eleven_ulaw(tts.api_key, voice_hint, clean, tts.voice_id, tts.model)
    except Exception as err:
        logger.warning(f"[MODULAR] TTS failed ({provider}): {err}")
        return
    for b64 in _ulaw_frames(raw):
        if getattr(bridge, "_barge", None) and bridge._barge.is_set():
            break
        await bridge.emit_ai_audio(b64)
        if pace:
            await asyncio.sleep(0.018)


async def _eleven_ulaw(api_key: str, voice_hint: str, text: str, voice_id: str, model: str) -> bytes:
    vid = _resolve_eleven_vid(voice_hint, voice_id)
    model_id = model or "eleven_turbo_v2_5"
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=ulaw_8000"
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(
            url,
            headers={"xi-api-key": api_key, "Accept": "application/octet-stream", "Content-Type": "application/json"},
            json={"text": text, "model_id": model_id, "optimize_streaming_latency": 3},
        )
        res.raise_for_status()
        return res.content


async def _cartesia_ulaw(api_key: str, voice_hint: str, text: str, voice_id: str) -> bytes:
    vid = _resolve_cartesia_vid(voice_hint, voice_id)
    # sonic-english / sonic are sunset; sonic-2 still serves mulaw telephony today.
    model_candidates = ("sonic-2", "sonic-turbo", "sonic-3", "sonic-3.5", "sonic-latest")
    last_err: Optional[Exception] = None
    async with httpx.AsyncClient(timeout=20.0) as client:
        for model_id in model_candidates:
            try:
                res = await client.post(
                    "https://api.cartesia.ai/tts/bytes",
                    headers={
                        "X-API-Key": api_key,
                        "Cartesia-Version": "2024-06-10",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model_id": model_id,
                        "transcript": text,
                        "voice": {"mode": "id", "id": vid},
                        "language": "en",
                        "output_format": {
                            "container": "raw",
                            "encoding": "pcm_mulaw",
                            "sample_rate": 8000,
                        },
                    },
                )
                if res.status_code == 200 and res.content:
                    logger.info(
                        f"[MODULAR] Cartesia TTS ok model_id={model_id} bytes={len(res.content)} voice={vid[:12]}…"
                    )
                    return res.content
                last_err = RuntimeError(f"Cartesia {model_id} HTTP {res.status_code}: {res.text[:180]}")
                # Sunset / bad model → try next; auth errors stop early
                if res.status_code in (401, 403):
                    raise last_err
            except Exception as err:
                last_err = err
                continue
    raise RuntimeError(f"Cartesia TTS failed for voice {vid[:12]}…: {last_err}")


async def _greeting_line(is_inbound: bool, prospect_name: Optional[str]) -> str:
    company = "AIVHub"
    rep = "Sam"
    try:
        async with AsyncSessionLocal() as db:
            prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
            if prof:
                company = prof.name or company
                rep = prof.caller_name or rep
    except Exception:
        pass
    raw = re.sub(r"\(.*?\)", "", prospect_name or "there").strip()
    first = raw.split()[0] if raw else "there"
    if first.lower() in ("prospect", "caller", "there"):
        first = "there"
    if is_inbound:
        return f"Hello, thanks for calling {company}! This is {rep}. How can I help you today?"
    if first != "there":
        return f"Hi {first}, this is {rep} calling from {company}. How's your day going?"
    return f"Hi there, this is {rep} calling from {company}. How's your day going?"


async def run_modular_pipeline(
    bridge: BridgedVoiceSession,
    call_id: str,
    caller_number: str,
    prospect_name: Optional[str],
    plan: VoicePlan,
    is_inbound: bool = False,
    carrier_sid: Optional[str] = None,
) -> None:
    bridge._barge = asyncio.Event()
    local_id = call_id
    logger.info(f"[MODULAR] Starting pipeline for {call_id}: {plan.note}")

    try:
        async with AsyncSessionLocal() as db:
            call_obj = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
            if call_obj:
                local_id = call_obj.id
                call_obj.state = "pitching"
                call_obj.transcript = (call_obj.transcript or []) + [f"System: Modular voice engine live — {plan.note}"]
                await db.commit()
    except Exception as err:
        logger.warning(f"[MODULAR] LiveCall link failed: {err}")

    system = await build_xai_system_instructions(caller_number, prospect_name, hold_opening=False)
    system += "\n\nKeep spoken replies short: 1-3 sentences unless they ask for detail. No markdown."
    history = []

    greeting = await _greeting_line(is_inbound, prospect_name)
    await _speak(bridge, plan, greeting, pace=False)
    if not bridge.ready.is_set():
        bridge.ready.set()
    await _update_call_transcript(local_id, f"AI: {greeting}")
    history.append({"role": "assistant", "content": greeting})
    try:
        await call_hub.broadcast("call_transcript_delta", {"callId": local_id, "who": "ai", "delta": greeting})
    except Exception:
        pass

    stt = plan.stt
    if not stt or not stt.api_key:
        logger.error("[MODULAR] No STT key — greeting only")
        return

    dg_model = stt.model or "nova-2"
    dg_url = (
        f"wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000"
        f"&channels=1&model={dg_model}&punctuate=true&interim_results=false&endpointing=400"
    )

    async def on_caller(b64: str):
        try:
            raw = base64.b64decode(b64)
            if raw and getattr(bridge, "_dg_ws", None):
                await bridge._dg_ws.send(raw)
        except Exception:
            pass

    bridge.on_caller_audio = on_caller
    speaking_task: Optional[asyncio.Task] = None

    async def handle_final(text: str):
        nonlocal speaking_task
        text = (text or "").strip()
        if not text:
            return
        bridge._barge.set()
        if speaking_task and not speaking_task.done():
            speaking_task.cancel()
        await _update_call_transcript(local_id, f"Prospect: {text}")
        try:
            await call_hub.broadcast("call_transcript_delta", {"callId": local_id, "who": "them", "delta": text})
        except Exception:
            pass
        history.append({"role": "user", "content": text})
        llm = plan.llm
        result = await call_open_chat_llm(
            messages=history[-12:],
            system_prompt=system,
            api_key=llm.api_key if llm else None,
            provider=llm.provider if llm else None,
            model=llm.model if llm else None,
            base_url=llm.base_url if llm else None,
            temperature=0.7,
            max_tokens=180,
        )
        reply = (result.get("reply") or "").strip()
        if not reply or reply.startswith("⚠️"):
            reply = "Sorry, I missed that — could you say that again?"
        history.append({"role": "assistant", "content": reply})
        await _update_call_transcript(local_id, f"AI: {reply}")
        try:
            await call_hub.broadcast("call_transcript_delta", {"callId": local_id, "who": "ai", "delta": reply})
        except Exception:
            pass
        bridge._barge = asyncio.Event()

        async def speak_reply():
            await _speak(bridge, plan, reply, pace=True)

        speaking_task = asyncio.create_task(speak_reply())

    try:
        async with websockets.connect(
            dg_url,
            additional_headers={"Authorization": f"Token {stt.api_key}"},
            ping_interval=20,
            ping_timeout=15,
        ) as dg:
            bridge._dg_ws = dg
            logger.info(f"[MODULAR] Deepgram connected for {call_id}")

            async def keepalive():
                while True:
                    await asyncio.sleep(8)
                    try:
                        await dg.send(json.dumps({"type": "KeepAlive"}))
                    except Exception:
                        return

            ka = asyncio.create_task(keepalive())
            try:
                async for raw_msg in dg:
                    if isinstance(raw_msg, bytes):
                        continue
                    try:
                        ev = json.loads(raw_msg)
                    except Exception:
                        continue
                    alt = (ev.get("channel") or {}).get("alternatives") or []
                    if not alt:
                        continue
                    transcript = (alt[0].get("transcript") or "").strip()
                    if not transcript:
                        continue
                    is_final = bool(ev.get("is_final") or ev.get("speech_final"))
                    if is_final:
                        await handle_final(transcript)
            finally:
                ka.cancel()
    except Exception as err:
        logger.warning(f"[MODULAR] Deepgram session ended for {call_id}: {err}")
    finally:
        bridge._dg_ws = None
        bridge.on_caller_audio = None
        logger.info(f"[MODULAR] Pipeline finished for {call_id}")
