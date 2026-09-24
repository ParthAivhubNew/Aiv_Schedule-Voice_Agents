"""Modular live-call pipeline: Deepgram STT → LLM gateway → ElevenLabs/Cartesia TTS."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import time
import urllib.parse
import uuid
from typing import Any, AsyncGenerator, Optional

import httpx
import websockets

from sqlalchemy.future import select

from app.database import AsyncSessionLocal
from app.models.models import CompanyProfile, LiveCall
from app.services.llm_gateway import call_open_chat_llm, stream_open_chat_llm, call_open_chat_llm_with_tools
from app.services.booking_tools import generate_smart_booking_tools, execute_smart_booking_tool
from app.services.process_logger import log_process_event
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
DEEPGRAM_AURA_VOICES = {
    "asteria": "aura-asteria-en",
    "luna": "aura-luna-en",
    "stella": "aura-stella-en",
    "athena": "aura-athena-en",
    "hera": "aura-hera-en",
    "orion": "aura-orion-en",
    "arcas": "aura-arcas-en",
    "perseus": "aura-perseus-en",
    "angus": "aura-angus-en",
    "helios": "aura-helios-en",
    "zeus": "aura-zeus-en",
    "rex": "aura-orion-en",
    "sam": "aura-orion-en",
    "ara": "aura-asteria-en",
    "eve": "aura-luna-en",
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


def _clean_for_speech(text: str) -> str:
    """Format text for natural, human-sounding speech synthesis."""
    if not text:
        return ""
    # Strip markdown, brackets, URLs, emojis, and code formatting
    t = re.sub(r"[*_`#\[\]\(\)<>]+", " ", text)
    t = re.sub(r"https?://\S+", "", t)
    # Convert em-dashes to commas for natural brief breath pauses
    t = re.sub(r"—|–", ", ", t)
    # Ensure brand name is pronounced clearly as "A.I.V. Hub" so TTS never spells individual letters or mispronounces
    t = re.sub(r"\bAIVHUB\b|\bAivhub\b|\bA\s*I\s*V\s*H\s*U\s*B\b|\bAIV\s*Hub\b", "A.I.V. Hub", t, flags=re.I)
    t = re.sub(r"\bA\s*I\s*V\b", "A.I.V.", t, flags=re.I)
    # Clean spoken email artifacts
    t = re.sub(r"@aivhub\.com", " at aivhub dot com", t, flags=re.I)
    t = re.sub(r"\bat the rate\b|\bat direct\b|\bat the rate of\b|\bat rate\b|\bat grid\b", "at", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _is_hangup_intent(user_text: str, ai_reply: str) -> bool:
    """Detect if caller wants to hang up or if a farewell conversation closing was reached."""
    u = (user_text or "").lower().strip()
    a = (ai_reply or "").lower().strip()
    hangup_user = (
        "cut the call", "cut call", "hang up", "hangup", "end the call", "end call",
        "disconnect", "bye bye", "goodbye", "bye now", "not interested bye",
        "leave me alone", "stop calling", "dont call again", "don't call again",
        "take me off", "i have to go bye", "gotta go bye", "end conversation",
        "please stop", "no thank you bye", "no thanks bye", "cut the phone",
        "cut phone", "finish call", "end it here", "thanks bye", "thank you bye",
    )
    if any(p in u for p in hangup_user):
        return True
    if u in ("bye", "goodbye", "cya", "stop", "no bye", "bye.", "goodbye.", "bye-bye", "bye bye"):
        return True
    # If the AI completed a definitive farewell wrap-up closing
    farewell_phrases = (
        "goodbye", "have a wonderful day", "have a great day", "have a good day",
        "take care, bye", "thanks for your time", "talk soon, bye", "see you then", "bye-bye", "goodbye!",
        "have a lovely day", "have a fantastic day", "thanks, bye", "thank you, bye", "cheers, bye",
        "follow up with you by email", "follow up with an email instead", "thanks so much for your time"
    )
    if any(p in a for p in farewell_phrases):
        return True
    return False


def _split_into_chunks(text_buffer: str, is_first: bool = False) -> tuple[list[str], str]:
    """
    Extracts complete sentences or natural pause clauses from text_buffer.
    - When is_first=True:
        Splits after 2-4 words if there is a natural punctuation pause (comma, dash, colon)
        so the first audio frame begins playing in <100ms.
        If no punctuation, waits for >= 6 words so Cartesia has enough context for natural prosody.
    - When is_first=False:
        Prefers full sentences (.!?\n). Does not split mid-sentence on clauses unless >= 14 words,
        or on a space unless >= 16 words, giving 3-4s of playback runway to eliminate gaps between sentences.
    Returns (list_of_complete_chunks, remaining_unsplit_buffer).
    """
    chunks = []
    current = text_buffer
    
    while current:
        # Match standard sentence ending: punctuation followed by space or end
        match = re.search(r'([.!?\n])(\s+|$)', current)
        if match:
            end_pos = match.end()
            chunk = current[:end_pos].strip()
            if chunk:
                chunks.append(chunk)
            current = current[end_pos:]
            continue
        
        words = current.split()

        # Match early first-chunk clause pause (require 2+ words total)
        if is_first and len(words) >= 2:
            early_match = re.search(r'([,;:]| — )(\s+)', current)
            if early_match and len(current[:early_match.start()].split()) >= 2:
                end_pos = early_match.end()
                chunk = current[:end_pos].strip()
                if chunk:
                    chunks.append(chunk)
                current = current[end_pos:]
                continue

        # For subsequent chunks, only split on a mid-sentence clause if >= 14 words
        clause_threshold = 4 if is_first else 14
        if len(words) >= clause_threshold:
            clause_match = re.search(r'([,;:]| — )(\s+)', current)
            if clause_match and clause_match.start() > 8:
                end_pos = clause_match.end()
                chunk = current[:end_pos].strip()
                if chunk:
                    chunks.append(chunk)
                current = current[end_pos:]
                continue
        
        # Space split fallback if buffer is getting long without punctuation:
        # 3 words for first chunk (if no comma arrived), 16 words for subsequent chunks
        space_threshold = 3 if is_first else 16
        if len(words) >= space_threshold:
            last_space = current.rfind(' ')
            if last_space > 0:
                chunk = current[:last_space].strip()
                if chunk:
                    chunks.append(chunk)
                current = current[last_space:].strip()
                continue

        break
        
    return chunks, current


async def _synthesize_tts_frames(plan: VoicePlan, text: str) -> list[str]:
    tts = plan.tts
    if not tts or not text.strip():
        return []
    clean = _clean_for_speech(text)
    if not clean:
        return []
    if len(clean) > 600:
        clean = clean[:600]
    provider = (tts.provider or "elevenlabs").lower()
    voice_hint = (tts.voice_id or plan.voice_name or "rachel").strip()
    raw = b""
    try:
        use_telnyx = "telnyx" in provider
        use_deepgram = "deepgram" in provider or "aura" in provider
        use_cartesia = "cartesia" in provider or voice_hint.lower() == "sonic" or looks_like_external_voice_id(tts.voice_id) or looks_like_external_voice_id(voice_hint)
        if use_telnyx:
            raw = await _telnyx_ulaw(tts.api_key, voice_hint, clean, tts.voice_id, tts.model)
        elif use_deepgram and "cartesia" not in provider and "eleven" not in provider:
            raw = await _deepgram_ulaw(tts.api_key, voice_hint, clean, tts.voice_id, tts.model)
        elif use_cartesia and "eleven" not in provider:
            raw = await _cartesia_ulaw(tts.api_key, voice_hint, clean, tts.voice_id, tts.model)
        else:
            raw = await _eleven_ulaw(tts.api_key, voice_hint, clean, tts.voice_id, tts.model)
    except Exception as err:
        logger.warning(f"[MODULAR] TTS failed ({provider}): {err}")
        return []
    return list(_ulaw_frames(raw))


async def _play_frames(bridge: BridgedVoiceSession, frames: list[str], on_frame_played: Optional[Any] = None) -> int:
    """
    Streams μ-law audio frames with precise, drift-free 20ms frame pacing.
    """
    if not frames:
        return 0
    played = 0
    loop_start = time.perf_counter()
    frame_duration = 0.020  # 20ms per 160-byte μ-law frame
    for idx, b64 in enumerate(frames):
        if getattr(bridge, "_barge", None) and bridge._barge.is_set():
            break
        await bridge.emit_ai_audio(b64)
        played += 1
        if on_frame_played:
            on_frame_played(1)
        expected_elapsed = (idx + 1) * frame_duration
        actual_elapsed = time.perf_counter() - loop_start
        sleep_needed = expected_elapsed - actual_elapsed
        if sleep_needed > 0.001:
            await asyncio.sleep(sleep_needed)
    return played


async def _speak(bridge: BridgedVoiceSession, plan: VoicePlan, text: str, pace: bool = True) -> list[str]:
    """Synthesizes and dispatches a line. Returns the µ-law frames (20 ms each) it produced."""
    frames = await _synthesize_tts_frames(plan, text)
    if frames and not (getattr(bridge, "_barge", None) and bridge._barge.is_set()):
        if pace and bridge._live and bridge._released:
            await _play_frames(bridge, frames)
        else:
            for b64 in frames:
                await bridge.emit_ai_audio(b64)
    return frames or []


def _is_phantom_noise(text: str) -> bool:
    """Rule 3.2: Detects short noise impulses, coughs, throat clearings (<300ms equivalent or noise words)."""
    cleaned = re.sub(r"[^\w\s]", "", (text or "").lower()).strip()
    if not cleaned or len(cleaned) < 2:
        return True
    noise_tokens = {"ah", "eh", "oh", "um", "uh", "er", "cough", "throat", "grunt", "sigh", "noise", "click"}
    words = cleaned.split()
    if len(words) == 1 and words[0] in noise_tokens:
        return True
    return False


def _is_acoustic_echo(caller_text: str, recent_ai_text: str) -> bool:
    """
    Rule 2.3: Detects if the incoming caller transcript is an acoustic reflection of what the agent just said.
    """
    if not caller_text or not recent_ai_text:
        return False
    c_words = set(re.sub(r"[^\w\s]", "", caller_text.lower()).split())
    a_words = set(re.sub(r"[^\w\s]", "", recent_ai_text.lower()).split())
    if not c_words:
        return False
    overlap = len(c_words.intersection(a_words))
    # If >= 75% of words match the agent's recent speech and length is >= 3 words
    if len(c_words) >= 3 and (overlap / len(c_words)) >= 0.75:
        return True
    return False


def _calculate_spoken_text(chunks_with_frames: list[tuple[str, int]], total_played_frames: int) -> str:
    """
    Rule 3.1: The Speech Meter — Context Truncation Indexing.
    Calculates the exact words spoken up to total_played_frames.
    """
    accumulated_frames = 0
    spoken_parts = []
    
    for text, frame_count in chunks_with_frames:
        if accumulated_frames + frame_count <= total_played_frames:
            spoken_parts.append(text)
            accumulated_frames += frame_count
        else:
            # Partially spoken chunk
            remaining_frames = max(0, total_played_frames - accumulated_frames)
            ratio = min(1.0, remaining_frames / max(1, frame_count))
            words = text.split()
            words_to_keep = max(1, int(len(words) * ratio))
            partial = " ".join(words[:words_to_keep])
            if partial:
                spoken_parts.append(f"{partial}...")
            break
            
    res = " ".join(spoken_parts).strip()
    return res if res else "(interrupted at start)"


# Persistent HTTP client with keep-alive connection pooling to eliminate TLS handshake latency on each turn
_tts_http_client: Optional[httpx.AsyncClient] = None

def _get_tts_client() -> httpx.AsyncClient:
    global _tts_http_client
    if _tts_http_client is None or _tts_http_client.is_closed:
        _tts_http_client = httpx.AsyncClient(
            timeout=15.0,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50, keepalive_expiry=60.0)
        )
    return _tts_http_client


async def _eleven_ulaw(api_key: str, voice_hint: str, text: str, voice_id: str, model: str) -> bytes:
    vid = _resolve_eleven_vid(voice_hint, voice_id)
    model_id = model or "eleven_turbo_v2_5"
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=ulaw_8000"
    client = _get_tts_client()
    res = await client.post(
        url,
        headers={"xi-api-key": api_key, "Accept": "application/octet-stream", "Content-Type": "application/json"},
        json={"text": text, "model_id": model_id, "optimize_streaming_latency": 3},
    )
    res.raise_for_status()
    return res.content


def _detect_speech_language(text: str, fallback_lang: str = "en") -> str:
    """
    Rapid, zero-latency detection of spoken text language.
    Inspects Unicode character scripts and high-frequency colloquial markers
    to set Cartesia TTS synthesis language dynamically.
    """
    if not text:
        return fallback_lang or "en"

    # 1. Non-Latin Unicode script checks (100% deterministic)
    # Devanagari (Hindi, Marathi, Sanskrit)
    if re.search(r"[\u0900-\u097F]", text):
        return "hi"
    # Arabic / Urdu script
    if re.search(r"[\u0600-\u06FF\u0750-\u077F]", text):
        return "ar"
    # Chinese (CJK Unified Ideographs)
    if re.search(r"[\u4E00-\u9FFF]", text):
        return "zh"
    # Japanese (Hiragana / Katakana)
    if re.search(r"[\u3040-\u309F\u30A0-\u30FF]", text):
        return "ja"
    # Korean (Hangul)
    if re.search(r"[\uAC00-\uD7AF\u1100-\u11FF]", text):
        return "ko"
    # Cyrillic (Russian, etc.)
    if re.search(r"[\u0400-\u04FF]", text):
        return "ru"

    lower = text.lower()
    words = set(re.findall(r"\b\w+\b", lower))

    # 2. Hindi / Hinglish Romanized markers
    hinglish_markers = {
        "namaste", "namaskar", "haan", "nahin", "nahi", "kaise", "kya", "bhai",
        "theek", "shukriya", "dhanyawad", "dhanyavad", "karo", "karenge", "karna",
        "baat", "samajh", "aap", "tum", "mera", "meri", "hum", "accha", "achha",
        "bahut", "kripya", "chahiye", "boliye", "batao", "bataiye"
    }
    if any(w in words for w in hinglish_markers) or "theek hai" in lower or "kya haal" in lower or "kaise ho" in lower:
        return "hi"

    # 3. Spanish markers
    spanish_markers = {
        "hola", "gracias", "por favor", "buenos días", "buenas tardes", "buenas noches",
        "cómo estás", "cómo está", "estoy", "amigo", "amiga", "señor", "señora",
        "también", "usted", "mucho", "gusto", "claro", "hablar"
    }
    if "¿" in text or "¡" in text or any(m in lower for m in spanish_markers) or any(w in words for w in {"hola", "gracias", "cómo", "está", "estás", "pero", "para", "buenos", "buenas"}):
        return "es"

    # 4. French markers
    french_markers = {
        "bonjour", "salut", "merci", "s'il vous plaît", "comment allez-vous", "ça va",
        "d'accord", "oui", "bienvenue", "bonne journée", "au revoir"
    }
    if any(m in lower for m in french_markers) or any(w in words for w in {"bonjour", "salut", "merci", "plaît", "avec", "vous", "allez", "c'est"}):
        return "fr"

    # 5. German markers
    german_markers = {
        "guten tag", "guten morgen", "guten abend", "danke", "bitte", "wie geht's",
        "wie geht es", "auf wiedersehen", "tschüss"
    }
    if any(m in lower for m in german_markers) or any(w in words for w in {"hallo", "danke", "bitte", "nicht", "sehr", "tschüss"}):
        return "de"

    # 6. Portuguese markers
    portuguese_markers = {
        "olá", "obrigado", "obrigada", "bom dia", "boa tarde", "boa noite",
        "como vai", "tudo bem", "por favor", "valeu"
    }
    if any(m in lower for m in portuguese_markers) or any(w in words for w in {"olá", "obrigado", "obrigada", "você", "está"}):
        return "pt"

    # 7. Italian markers
    italian_markers = {
        "buongiorno", "buonasera", "grazie", "come va", "per favore", "prego",
        "arriverderci", "va bene"
    }
    if any(m in lower for m in italian_markers) or any(w in words for w in {"ciao", "grazie", "buongiorno", "buonasera", "prego"}):
        return "it"

    if fallback_lang and fallback_lang != "en":
        english_only_markers = {"the", "is", "are", "would", "could", "should", "what", "which", "there", "about"}
        if len(words.intersection(english_only_markers)) >= 2:
            return "en"
        return fallback_lang

    return "en"


async def _cartesia_ulaw(api_key: str, voice_hint: str, text: str, voice_id: str, model: Optional[str] = None, language: str = "en") -> bytes:
    vid = _resolve_cartesia_vid(voice_hint, voice_id)
    # Use the model saved on the Connection if one is configured; otherwise try
    # Cartesia's known model names in order (sonic-2 sunsetted by Cartesia).
    fallback_candidates = ("sonic-3.6", "sonic-3", "sonic-3.5", "sonic-turbo", "sonic-latest")
    configured = (model or "").strip()
    model_candidates = (configured,) + tuple(m for m in fallback_candidates if m != configured) if configured else fallback_candidates
    last_err: Optional[Exception] = None
    client = _get_tts_client()
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
                    "language": language,
                    "output_format": {
                        "container": "raw",
                        "encoding": "pcm_mulaw",
                        "sample_rate": 8000,
                    },
                },
            )
            if res.status_code == 200 and res.content:
                return res.content
            last_err = RuntimeError(f"Cartesia {model_id} HTTP {res.status_code}: {res.text[:180]}")
            if res.status_code in (401, 403):
                raise last_err
        except Exception as err:
            last_err = err
            continue
    raise RuntimeError(f"Cartesia TTS failed for voice {vid[:12]}…: {last_err}")


async def _get_or_create_cartesia_ws(bridge: BridgedVoiceSession, api_key: str) -> Optional[Any]:
    ws = getattr(bridge, "_cartesia_ws", None)
    if ws is not None and getattr(getattr(ws, "state", None), "name", "") == "OPEN":
        return ws
    try:
        url = f"wss://api.cartesia.ai/tts/websocket?api_key={api_key}&cartesia_version=2024-06-10"
        ws = await websockets.connect(
            url,
            additional_headers={
                "X-API-Key": api_key,
                "Cartesia-Version": "2024-06-10",
            },
            ping_interval=20,
            ping_timeout=15,
        )
        bridge._cartesia_ws = ws
        logger.info(f"[CARTESIA-WS] Persistent WebSocket connected for {getattr(bridge, 'call_id', 'unknown')}")
        return ws
    except Exception as e:
        logger.warning(f"[CARTESIA-WS] Connection failed ({e}); using REST fallback.")
        return None


async def _stream_cartesia_frames(
    bridge: BridgedVoiceSession,
    api_key: str,
    voice_hint: str,
    text: str,
    voice_id: Optional[str],
    model: Optional[str] = None,
    language: str = "en",
) -> AsyncGenerator[list[str], None]:
    """
    Streams μ-law audio frames from Cartesia WebSocket as they are generated.
    Yields batches of 20ms μ-law base64 frames.
    Falls back to REST _cartesia_ulaw if WebSocket is unavailable or fails.
    """
    vid = _resolve_cartesia_vid(voice_hint, voice_id)
    ws = await _get_or_create_cartesia_ws(bridge, api_key)

    if ws is not None:
        context_id = f"ctx_{uuid.uuid4().hex[:12]}"
        req = {
            "context_id": context_id,
            "model_id": (model or "").strip() or "sonic-3.6",
            "transcript": text,
            "voice": {
                "mode": "id",
                "id": vid,
            },
            "output_format": {
                "container": "raw",
                "encoding": "pcm_mulaw",
                "sample_rate": 8000,
            },
            "language": language,
            "continue": False,
        }
        got_any_chunk = False
        try:
            await ws.send(json.dumps(req))
            while not (getattr(bridge, "_barge", None) and bridge._barge.is_set()):
                msg_str = await asyncio.wait_for(ws.recv(), timeout=6.0)
                msg = json.loads(msg_str)
                if msg.get("context_id") != context_id:
                    continue
                m_type = msg.get("type")
                if m_type == "chunk":
                    raw_b64 = msg.get("data")
                    if raw_b64:
                        raw_bytes = base64.b64decode(raw_b64)
                        frames = list(_ulaw_frames(raw_bytes))
                        if frames:
                            got_any_chunk = True
                            yield frames
                elif m_type == "done":
                    break
                elif m_type == "error":
                    logger.warning(f"[CARTESIA-WS] Error event: {msg.get('error')}")
                    break
            if got_any_chunk:
                return
        except Exception as ws_err:
            logger.warning(f"[CARTESIA-WS] Streaming error ({ws_err}); closing socket.")
            try:
                await ws.close()
            except Exception:
                pass
            bridge._cartesia_ws = None
            if got_any_chunk:
                # Mid-stream failure: do not restart from REST (avoid repeating speech)
                return

    # Fallback to REST _cartesia_ulaw
    try:
        raw = await _cartesia_ulaw(api_key, voice_hint, text, voice_id, model, language=language)
        if raw:
            yield list(_ulaw_frames(raw))
    except Exception as rest_err:
        logger.warning(f"[CARTESIA] REST fallback failed: {rest_err}")


async def _stream_tts_frames(
    bridge: BridgedVoiceSession,
    plan: VoicePlan,
    text: str
) -> AsyncGenerator[list[str], None]:
    """
    Dispatches sentence text to streaming TTS provider, yielding batches of 20ms frames in real-time.
    """
    tts = plan.tts
    if not tts or not text.strip():
        return
    clean = _clean_for_speech(text)
    if not clean:
        return
    if len(clean) > 600:
        clean = clean[:600]
    provider = (tts.provider or "elevenlabs").lower()
    voice_hint = (tts.voice_id or plan.voice_name or "rachel").strip()

    session_lang = getattr(bridge, "_current_language", "en")
    lang = _detect_speech_language(clean, fallback_lang=session_lang)
    bridge._current_language = lang

    use_deepgram = "deepgram" in provider or "aura" in provider
    use_cartesia = "cartesia" in provider or voice_hint.lower() == "sonic" or looks_like_external_voice_id(tts.voice_id) or looks_like_external_voice_id(voice_hint)

    if "telnyx" in provider:
        raw = await _telnyx_ulaw(tts.api_key, voice_hint, clean, tts.voice_id, tts.model)
        if raw:
            yield list(_ulaw_frames(raw))
    elif use_cartesia and "eleven" not in provider:
        async for frames_batch in _stream_cartesia_frames(bridge, tts.api_key, voice_hint, clean, tts.voice_id, tts.model, language=lang):
            if frames_batch:
                yield frames_batch
    elif use_deepgram and "cartesia" not in provider and "eleven" not in provider:
        raw = await _deepgram_ulaw(tts.api_key, voice_hint, clean, tts.voice_id, tts.model)
        if raw:
            yield list(_ulaw_frames(raw))
    else:
        raw = await _eleven_ulaw(tts.api_key, voice_hint, clean, tts.voice_id, tts.model)
        if raw:
            yield list(_ulaw_frames(raw))


async def _deepgram_ulaw(api_key: str, voice_hint: str, text: str, voice_id: str, model: str) -> bytes:
    raw_v = (voice_id or voice_hint or model or "aura-asteria-en").strip().lower()
    if raw_v.startswith("aura-"):
        model_name = raw_v
    else:
        model_name = DEEPGRAM_AURA_VOICES.get(raw_v, "aura-asteria-en")
    url = f"https://api.deepgram.com/v1/speak?model={model_name}&encoding=mulaw&sample_rate=8000"
    client = _get_tts_client()
    res = await client.post(
        url,
        headers={"Authorization": f"Token {api_key}", "Content-Type": "application/json"},
        json={"text": text},
    )
    res.raise_for_status()
    return res.content


TELNYX_DEFAULT_VOICE = "Telnyx.Ultra.fcaed1d0-d7d5-4466-be0b-5a3e1e61a9a5"

def _resolve_telnyx_vid(voice_hint: str, voice_id: Optional[str]) -> str:
    raw = (voice_id or voice_hint or "").strip()
    if not raw:
        return TELNYX_DEFAULT_VOICE
    if raw.startswith("Telnyx.") or raw.startswith("AWS.") or raw.startswith("Azure.") or raw.startswith("ElevenLabs."):
        return raw
    return TELNYX_DEFAULT_VOICE


async def _telnyx_ulaw(api_key: str, voice_hint: str, text: str, voice_id: str, model: str) -> bytes:
    """Synthesize speech using Telnyx Text-to-Speech API and transcode to 8kHz mu-law."""
    import audioop
    try:
        import miniaudio
    except ImportError:
        miniaudio = None

    url = "https://api.telnyx.com/v2/text-to-speech/speech"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    voice_name = _resolve_telnyx_vid(voice_hint, voice_id)
    payload = {
        "text": text,
        "voice": voice_name,
        "output_type": "binary_output",
    }
    client = _get_tts_client()
    try:
        res = await client.post(url, headers=headers, json=payload, timeout=12.0)
        if res.status_code != 200 and voice_name != TELNYX_DEFAULT_VOICE:
            logger.warning(f"[TELNYX TTS] Voice {voice_name} failed ({res.status_code}); retrying with default {TELNYX_DEFAULT_VOICE}")
            payload["voice"] = TELNYX_DEFAULT_VOICE
            res = await client.post(url, headers=headers, json=payload, timeout=12.0)

        if res.status_code != 200:
            logger.warning(f"[TELNYX TTS] API error {res.status_code}: {res.text[:200]}")
            return b""
        audio_bytes = res.content
        if not audio_bytes:
            return b""
        if miniaudio is not None:
            decoded = miniaudio.decode(
                audio_bytes,
                output_format=miniaudio.SampleFormat.SIGNED16,
                nchannels=1,
                sample_rate=8000,
            )
            return audioop.lin2ulaw(decoded.samples, 2)
        else:
            import io, wave
            with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
                n_channels = wf.getnchannels()
                sampwidth = wf.getsampwidth()
                framerate = wf.getframerate()
                frames = wf.readframes(wf.getnframes())
            if n_channels == 2:
                frames = audioop.tomono(frames, sampwidth, 0.5, 0.5)
            if sampwidth != 2:
                frames = audioop.lin2lin(frames, sampwidth, 2)
            if framerate != 8000:
                frames, _ = audioop.ratecv(frames, 2, 1, framerate, 8000, None)
            return audioop.lin2ulaw(frames, 2)
    except Exception as conv_err:
        logger.warning(f"[TELNYX TTS] Synthesis/conversion error: {conv_err}")
        return b""


async def _telnyx_whisper_transcribe(raw_mulaw_frames: bytes, api_key: str, model: str = "openai/whisper-large-v3") -> str:
    """Transcribes an audio chunk using Telnyx Whisper API."""
    if not raw_mulaw_frames or len(raw_mulaw_frames) < 1600:
        return ""
    import io, wave, audioop
    try:
        lin_pcm = audioop.ulaw2lin(raw_mulaw_frames, 2)
        resampled_pcm, _ = audioop.ratecv(lin_pcm, 2, 1, 8000, 16000, None)
        wav_buf = io.BytesIO()
        with wave.open(wav_buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(resampled_pcm)
        wav_bytes = wav_buf.getvalue()

        url = "https://api.telnyx.com/v2/ai/audio/transcriptions"
        headers = {"Authorization": f"Bearer {api_key}"}
        files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
        data = {"model": model or "openai/whisper-large-v3"}

        client = _get_tts_client()
        res = await client.post(url, headers=headers, data=data, files=files, timeout=12.0)
        if res.status_code == 200:
            return str(res.json().get("text") or "").strip()
        else:
            logger.warning(f"[TELNYX-STT] Whisper error {res.status_code}: {res.text[:200]}")
    except Exception as e:
        logger.warning(f"[TELNYX-STT] Transcription error: {e}")
    return ""



def _mulaw_frames_to_wav16k(raw_mulaw_frames: bytes) -> bytes:
    """Wrap 8 kHz µ-law carrier frames as a 16 kHz mono 16-bit WAV (Whisper-friendly)."""
    import io, wave, audioop
    lin_pcm = audioop.ulaw2lin(raw_mulaw_frames, 2)
    resampled_pcm, _ = audioop.ratecv(lin_pcm, 2, 1, 8000, 16000, None)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(resampled_pcm)
    return buf.getvalue()


async def _whisper_rest_transcribe(raw_mulaw_frames: bytes, api_key: str, model: str, base_url: str) -> str:
    """Transcribes a carrier audio chunk through any OpenAI-compatible Whisper endpoint.

    Works for OpenAI (whisper-1 / gpt-4o-transcribe), Groq (whisper-large-v3-turbo) and
    custom base URLs — so an operator's own Whisper key is a first-class STT plugin.
    """
    if not raw_mulaw_frames or len(raw_mulaw_frames) < 1600:
        return ""
    url = (base_url or "https://api.openai.com/v1").rstrip("/")
    if not url.endswith("/audio/transcriptions"):
        url += "/audio/transcriptions"
    try:
        wav_bytes = _mulaw_frames_to_wav16k(raw_mulaw_frames)
        headers = {"Authorization": f"Bearer {api_key}"}
        files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
        data = {"model": model or "whisper-1", "response_format": "json"}
        client = _get_tts_client()
        res = await client.post(url, headers=headers, data=data, files=files, timeout=15.0)
        if res.status_code == 200:
            return str((res.json() or {}).get("text") or "").strip()
        logger.warning(f"[WHISPER-STT] {url} error {res.status_code}: {res.text[:200]}")
    except Exception as e:
        logger.warning(f"[WHISPER-STT] Transcription error: {e}")
    return ""


async def _greeting_line(is_inbound: bool, prospect_name: Optional[str]) -> str:
    company = "your company"
    rep = "our team"
    opener_template = None
    try:
        async with AsyncSessionLocal() as db:
            prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
            if prof:
                company = getattr(prof, "spoken_name", None) or prof.name or company
                rep = prof.caller_name or rep
                opener_template = getattr(prof, "call_opener", None)
    except Exception:
        pass
    raw = re.sub(r"\(.*?\)", "", prospect_name or "there").strip()
    first = raw.split()[0] if raw else "there"
    if first.lower() in ("prospect", "caller", "there", "unknown"):
        first = "there"
    if is_inbound:
        return f"Hello, thanks for calling {company}! This is {rep}. How can I help you today?"
    if opener_template and opener_template.strip():
        txt = opener_template.replace("{name}", first if first != "there" else "there")
        txt = txt.replace("{caller_name}", rep).replace("{company}", company)
        return txt
    if first != "there":
        return f"Hi {first}, this is {rep} calling from {company} — did I catch you in the middle of something?"
    return f"Hi there, this is {rep} calling from {company} — did I catch you in the middle of something?"


def _is_backchannel(text: str) -> bool:
    """Return True ONLY for non-word sub-vocal murmurs (e.g. 'mhm', 'uh-huh') that carry no semantic instruction."""
    cleaned = re.sub(r"[^\w\s]", "", (text or "").lower()).strip()
    words = cleaned.split()
    if len(words) > 1:
        return False
    return cleaned in ("mhm", "uhhuh", "uh-huh", "mm", "mmm")


_BOOKING_INTENT_RE = re.compile(
    r"\b(book|schedule|meeting|appointment|available|availability|calendar|slot|reschedul\w*|"
    r"tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"morning|afternoon|evening|\d{1,2}\s?(am|pm)|\d{1,2}:\d{2})\b",
    re.IGNORECASE,
)


async def _maybe_execute_booking_tool(
    call_ctx: dict,
    history: list,
    system: str,
    plan: VoicePlan,
    local_id: str,
    latest_utterance: str,
) -> None:
    """
    Lightweight pre-pass: only when the caller's utterance plausibly concerns scheduling,
    give the LLM one non-streaming turn WITH booking tool schemas so it can call
    check_availability/book_appointment. Any tool result is folded back into `history` as
    a system note so the normal streaming reply (which runs right after this) speaks the
    outcome naturally. No-op — zero added latency — on ordinary conversational turns.
    """
    if not call_ctx or not plan.llm or not _BOOKING_INTENT_RE.search(latest_utterance or ""):
        return

    llm = plan.llm
    try:
        tools = generate_smart_booking_tools(call_ctx)
        result = await call_open_chat_llm_with_tools(
            messages=history[-12:],
            tools=tools,
            system_prompt=system,
            api_key=llm.api_key,
            provider=llm.provider,
            model=llm.model,
            base_url=llm.base_url,
            temperature=0.3,
            max_tokens=300,
        )
    except Exception as e:
        logger.warning(f"[MODULAR] Booking tool pre-pass failed: {e}")
        return

    tool_calls = result.get("tool_calls") or []
    if not tool_calls:
        return

    call = tool_calls[0]
    fn = call.get("function") or {}
    name = fn.get("name") or ""
    try:
        args = json.loads(fn.get("arguments") or "{}")
    except Exception:
        args = {}

    try:
        async with AsyncSessionLocal() as tool_db:
            tool_result = await execute_smart_booking_tool(tool_db, name, args, call_ctx)
    except Exception as e:
        logger.warning(f"[MODULAR] Booking tool execution failed ({name}): {e}")
        tool_result = {"success": False, "error": str(e)}

    logger.info(f"[MODULAR] Booking tool '{name}' executed for call {local_id}: {tool_result}")
    asyncio.create_task(call_hub.broadcast("call_tool_executed", {"callId": local_id, "tool": name, "result": tool_result}))

    history.append({
        "role": "system",
        "content": (
            f"[Tool result — {name}]: {json.dumps(tool_result)}. "
            "Use this information to respond to the caller naturally and conversationally "
            "(e.g. read out the actual available times, or confirm the booking you just made). "
            "Never mention tools, functions, or JSON."
        ),
    })


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

    system = ""
    greeting = ""
    call_ctx: dict = {}
    try:
        from app.services.conversation_engine import context_resolver, template_engine, ConversationTemplateEngine
        from app.services.calendar_service import calendar_service
        from app.services.booking_policy import (
            normalize_booking_policy,
            voice_booking_instructions,
            voice_hangup_instructions,
        )
        async with AsyncSessionLocal() as conv_db:
            if is_inbound:
                call_ctx = await context_resolver.resolve_inbound(conv_db, caller_number)
            else:
                call_ctx = await context_resolver.resolve_outbound(
                    conv_db,
                    override_phone=caller_number,
                    override_name=prospect_name
                )
            try:
                setting = await calendar_service.get_or_create_settings(conv_db)
                policy = normalize_booking_policy(getattr(setting, "booking_policy", None))
                call_ctx["booking_policy"] = policy
                call_ctx["policy_booking_instructions"] = voice_booking_instructions(policy)
                call_ctx["policy_hangup_instructions"] = voice_hangup_instructions(policy)
            except Exception as pol_err:
                logger.warning(f"[MODULAR] Booking policy load notice: {pol_err}")

            active_tpl = await template_engine.get_active_template(
                conv_db,
                direction="inbound" if is_inbound else "outbound"
            )
            system = template_engine.render_system_prompt(active_tpl, call_ctx)
            if active_tpl.greeting_template:
                greeting = ConversationTemplateEngine._safe_substitute(active_tpl.greeting_template, call_ctx)
    except Exception as tpl_err:
        logger.warning(f"[MODULAR] Dynamic template resolution notice: {tpl_err}")
        system = await build_xai_system_instructions(caller_number, prospect_name, hold_opening=False)

    history = []

    # Resolve STT credentials: Check for Deepgram or Telnyx Whisper
    stt = plan.stt
    # Determine active STT plugin provider
    stt_provider = (stt.provider if stt else "deepgram").lower().strip()
    stt_key = (stt.api_key if stt else "").strip()
    stt_model = (stt.model if stt and stt.model else "").strip()

    dg_key = ""
    if "deepgram" in stt_provider and stt_key and not stt_key.startswith("KEY"):
        dg_key = stt_key
    elif getattr(settings, "DEEPGRAM_API_KEY", None):
        dg_key = settings.DEEPGRAM_API_KEY.strip()

    telnyx_stt_key = ""
    if "telnyx" in stt_provider or (stt_key and stt_key.startswith("KEY")):
        telnyx_stt_key = stt_key
    elif getattr(settings, "TELNYX_API_KEY", None):
        telnyx_stt_key = settings.TELNYX_API_KEY.strip()
    elif plan.tts and ("telnyx" in (plan.tts.provider or "").lower() or (plan.tts.api_key and plan.tts.api_key.startswith("KEY"))):
        telnyx_stt_key = plan.tts.api_key.strip()
    elif plan.llm and ("telnyx" in (plan.llm.provider or "").lower() or (plan.llm.api_key and plan.llm.api_key.startswith("KEY"))):
        telnyx_stt_key = plan.llm.api_key.strip()

    # OpenAI-compatible Whisper REST (OpenAI / Groq / custom base URL) as a first-class plugin
    whisper_stt_key = ""
    whisper_base = ""
    whisper_model = ""
    if not dg_key and not telnyx_stt_key and stt_key:
        display = str(((stt.extra or {}) if getattr(stt, "extra", None) else {}).get("display_name") or "")
        label = f"{stt_provider} {display} {stt_model}".lower()
        configured_base = (getattr(stt, "base_url", "") or "").strip()
        if configured_base and ("whisper" in label or "openai" in label or "groq" in label):
            whisper_stt_key, whisper_base = stt_key, configured_base
        elif "groq" in label:
            whisper_stt_key, whisper_base = stt_key, "https://api.groq.com/openai/v1"
        elif "whisper" in label or "openai" in label:
            whisper_stt_key, whisper_base = stt_key, "https://api.openai.com/v1"
        if whisper_stt_key:
            whisper_model = stt_model or (
                "whisper-large-v3-turbo" if "groq" in (whisper_base or "").lower() else "whisper-1"
            )
            logger.info(
                f"[MODULAR] STT transport: OpenAI-compatible Whisper REST at {whisper_base} "
                f"(model {whisper_model})"
            )

    if not dg_key and not telnyx_stt_key and not whisper_stt_key:
        # Never run a deaf call: the agent would greet and then hear nothing while the
        # prospect talks into silence. Abort loudly, release the carrier leg, tell the operator.
        logger.error(f"[MODULAR] No STT key for plugin '{stt_provider}' — aborting call {local_id} (no deaf calls)")
        try:
            await _update_call_transcript(
                local_id,
                f"System: Call aborted — STT plugin '{stt_provider}' has no usable API key "
                f"(supported: Deepgram, Telnyx Whisper, or OpenAI-compatible Whisper). "
                f"Configure it in Connections, then retry.",
            )
            await log_process_event(
                subsystem="voice",
                process_name="modular_stt_missing",
                message=f"Modular engine aborted call {local_id}: no usable STT key for '{stt_provider}'.",
                level="ERROR",
                details={"callId": local_id, "sttProvider": stt_provider, "engine": plan.engine},
            )
            async with AsyncSessionLocal() as abort_db:
                from app.models.models import Notification
                abort_db.add(Notification(
                    id=f"n_{uuid.uuid4().hex[:6]}",
                    text=(
                        f"❌ Call aborted — speech-to-text plugin '{stt_provider}' has no usable API key. "
                        f"Add a Deepgram, Telnyx Whisper, or OpenAI-compatible Whisper key in Connections."
                    ),
                    type="alert",
                ))
                await abort_db.commit()
            await call_hub.broadcast("notification_created", {
                "text": f"Call aborted: STT plugin '{stt_provider}' missing a usable API key.",
                "type": "alert",
            })
        except Exception as abort_log_err:
            logger.warning(f"[MODULAR] abort logging failed for {local_id}: {abort_log_err}")
        try:
            await bridge.close()
            from app.services.xai_voice_service import _finalize_call
            from datetime import datetime as _dt
            async with AsyncSessionLocal() as fin_db:
                row = (await fin_db.execute(select(LiveCall).where(LiveCall.id == local_id))).scalars().first()
                if row is not None and not row.ended:
                    started = row.created_at or _dt.utcnow()
                    secs = max(1, int((_dt.utcnow() - started).total_seconds()))
                    await _finalize_call(local_id, f"{secs // 60:02d}:{secs % 60:02d}", list(row.transcript or []))
        except Exception as abort_err:
            logger.warning(f"[MODULAR] abort teardown failed for {local_id}: {abort_err}")
        return

    # Report the working structure that is actually live on this call (also visible in the UI).
    stt_transport = (
        "Deepgram streaming (nova-2)"
        if dg_key
        else ("Telnyx Whisper REST" if telnyx_stt_key else f"Whisper REST ({whisper_base}, {whisper_model})")
    )
    logger.info(f"[MODULAR] {local_id} STT transport live: {stt_transport}")
    try:
        await _update_call_transcript(local_id, f"System: STT transport live — {stt_transport}")
    except Exception:
        pass

    # Fast Energy VAD state for chunking (ultra-low 180ms silence endpointing)
    speech_buffer = bytearray()
    in_speech = False
    silence_frames_count = 0
    speech_frames_count = 0
    import audioop

    async def _process_telnyx_speech_chunk(audio_chunk: bytes):
        nonlocal last_activity_time, silence_nudge_count
        t_model = stt_model or "openai/whisper-large-v3"
        txt = await _telnyx_whisper_transcribe(audio_chunk, telnyx_stt_key, t_model)
        if txt and not bridge.closed.is_set():
            logger.info(f"[TELNYX-STT] Caller said: '{txt}'")
            last_activity_time = time.perf_counter()
            silence_nudge_count = 0
            await handle_final(txt)

    async def _process_whisper_speech_chunk(audio_chunk: bytes):
        nonlocal last_activity_time, silence_nudge_count
        txt = await _whisper_rest_transcribe(audio_chunk, whisper_stt_key, whisper_model, whisper_base)
        if txt and not bridge.closed.is_set():
            logger.info(f"[WHISPER-STT] Caller said: '{txt}'")
            last_activity_time = time.perf_counter()
            silence_nudge_count = 0
            await handle_final(txt)

    # Dynamic caller audio router based on active STT plugin
    # Frames that arrive before the Deepgram socket is live are buffered (and flushed on
    # connect) instead of being dropped — otherwise the prospect's first words are lost
    # while the greeting is still playing.
    pre_stt_frames: list[bytes] = []
    PRE_STT_MAX_FRAMES = 150  # ~3s of 20ms frames

    async def on_caller(b64: str):
        nonlocal speech_buffer, in_speech, silence_frames_count, speech_frames_count
        try:
            raw = base64.b64decode(b64)
            if not raw:
                return
            # If Deepgram WebSocket is active for Deepgram plugin
            dg_ws = getattr(bridge, "_dg_ws", None)
            if dg_ws is not None:
                if pre_stt_frames:
                    for pending in pre_stt_frames:
                        try:
                            await dg_ws.send(pending)
                        except Exception:
                            break
                    pre_stt_frames.clear()
                await dg_ws.send(raw)
            elif dg_key:
                # Deepgram selected but still connecting — keep the audio for the flush above.
                pre_stt_frames.append(raw)
                if len(pre_stt_frames) > PRE_STT_MAX_FRAMES:
                    pre_stt_frames.pop(0)
            # Chunked REST STT plugins (Telnyx Whisper / OpenAI-compatible Whisper)
            elif telnyx_stt_key or whisper_stt_key:
                pcm = audioop.ulaw2lin(raw, 2)
                rms = audioop.rms(pcm, 2)
                if rms > 300:
                    speech_buffer.extend(raw)
                    in_speech = True
                    speech_frames_count += 1
                    silence_frames_count = 0
                else:
                    if in_speech:
                        speech_buffer.extend(raw)
                        silence_frames_count += 1
                        # 9 frames * 20ms = 180ms pause -> immediate speech endpointing
                        if silence_frames_count >= 9:
                            if speech_frames_count >= 6:
                                chunk = bytes(speech_buffer)
                                speech_buffer = bytearray()
                                in_speech = False
                                silence_frames_count = 0
                                speech_frames_count = 0
                                if telnyx_stt_key:
                                    asyncio.create_task(_process_telnyx_speech_chunk(chunk))
                                else:
                                    asyncio.create_task(_process_whisper_speech_chunk(chunk))
                            else:
                                speech_buffer = bytearray()
                                in_speech = False
                                silence_frames_count = 0
                                speech_frames_count = 0
        except Exception:
            pass

    bridge.on_caller_audio = on_caller
    speaking_task: Optional[asyncio.Task] = None

    # Opening-greeting window: the greeting is never cut short, and anything the caller says
    # while the background STT/LLM/TTS connections settle is captured and answered right after.
    greeting_active = True
    pending_during_greeting: list[str] = []

    async def _greeting_window(planned_frames: int):
        nonlocal greeting_active
        deadline = time.perf_counter() + 15.0
        while not (bridge._live and bridge._released) and not bridge.closed.is_set():
            if time.perf_counter() > deadline:
                logger.warning(f"[MODULAR] greeting window: carrier stream never attached for {local_id}")
                break
            await asyncio.sleep(0.05)
        # µ-law frames are 20 ms each; add a small tail so the last word isn't clipped.
        await asyncio.sleep(max(0.6, planned_frames * 0.02 + 0.35))
        greeting_active = False
        if pending_during_greeting and not bridge.closed.is_set():
            merged = " ".join(pending_during_greeting).strip()
            pending_during_greeting.clear()
            if merged:
                logger.info(
                    f"[MODULAR] Greeting finished — answering what the caller said during it: '{merged[:140]}'"
                )
                try:
                    await handle_final(merged)
                except Exception as gw_err:
                    logger.warning(f"[MODULAR] greeting-window answer failed for {local_id}: {gw_err}")

    if not greeting:
        greeting = await _greeting_line(is_inbound, prospect_name)

    await log_process_event(
        subsystem="voice", process_name="greeting_tts_start", level="INFO",
        message=f"[DIAG] Starting greeting TTS synthesis for {local_id} (provider={plan.tts.provider if plan.tts else None})",
        details={"callId": local_id, "ttsProvider": plan.tts.provider if plan.tts else None},
    )
    try:
        greeting_frames = await asyncio.wait_for(_speak(bridge, plan, greeting, pace=False), timeout=15.0) or []
        await log_process_event(
            subsystem="voice", process_name="greeting_tts_done", level="INFO",
            message=f"[DIAG] Greeting TTS finished for {local_id}: {len(greeting_frames)} frames produced",
            details={"callId": local_id, "frameCount": len(greeting_frames)},
        )
    except asyncio.TimeoutError:
        greeting_frames = []
        logger.error(f"[MODULAR] Greeting TTS synthesis TIMED OUT after 15s for {local_id} — proceeding without audio")
        await log_process_event(
            subsystem="voice", process_name="greeting_tts_timeout", level="ERROR",
            message=f"[DIAG] Greeting TTS synthesis TIMED OUT after 15s for {local_id} (provider={plan.tts.provider if plan.tts else None}) — this confirms a hang, not a clean failure",
            details={"callId": local_id, "ttsProvider": plan.tts.provider if plan.tts else None},
        )
    except Exception as greet_err:
        greeting_frames = []
        logger.error(f"[MODULAR] Greeting TTS synthesis raised for {local_id}: {greet_err}")
        await log_process_event(
            subsystem="voice", process_name="greeting_tts_error", level="ERROR",
            message=f"[DIAG] Greeting TTS synthesis raised for {local_id}: {greet_err}",
            details={"callId": local_id, "error": str(greet_err)},
        )
    if not bridge.ready.is_set():
        bridge.ready.set()
    asyncio.create_task(_greeting_window(len(greeting_frames)))
    await _update_call_transcript(local_id, f"AI: {greeting}")
    history.append({"role": "assistant", "content": greeting})
    try:
        await call_hub.broadcast("call_transcript_delta", {"callId": local_id, "who": "ai", "delta": greeting})
    except Exception:
        pass

    dg_model = "nova-2"
    if stt and stt.model and stt.provider == "deepgram":
        dg_model = stt.model
    # LiveKit Turn-Taking & Telephony parameters:
    # 200ms endpointing + smart formatting + keyword boosting for domain, Power BI & email terms
    dg_params = [
        ("encoding", "mulaw"),
        ("sample_rate", "8000"),
        ("channels", "1"),
        ("model", dg_model),
        ("punctuate", "true"),
        ("smart_format", "true"),
        ("endpointing", "200"),
        ("vad_events", "true"),
        ("interim_results", "true"),
        ("language", "multi"),
        ("keywords", "PowerBI:5"),
        ("keywords", "Power BI:5"),
        ("keywords", "aivhub.com:5"),
        ("keywords", "aivhub:5"),
        ("keywords", "phone call:5"),
        ("keywords", "video meeting:5"),
        ("keywords", "in person:5"),
        ("keywords", "email:4"),
    ]
    dg_url = f"wss://api.deepgram.com/v1/listen?{urllib.parse.urlencode(dg_params)}"

    # Watchdog: if no carrier media stream connects within 12s, stop phantom session
    async def stream_watchdog():
        await asyncio.sleep(12)
        if not bridge._live and not bridge.closed.is_set():
            logger.warning(f"[MODULAR] No carrier audio stream connected for {local_id} within 12s. Auto-terminating session.")
            await _update_call_transcript(local_id, "System: Carrier audio stream did not connect (call was disconnected or carrier unreachable). AI session ended.")
            try:
                async with AsyncSessionLocal() as wd_db:
                    c_rec = (await wd_db.execute(select(LiveCall).where(LiveCall.id == local_id))).scalars().first()
                    if c_rec and not c_rec.ended:
                        c_rec.ended = True
                        c_rec.state = "ended"
                        await wd_db.commit()
                        await call_hub.broadcast("call_ended", {"callId": local_id, "id": local_id, "state": "ended"})
            except Exception:
                pass
            await bridge.close()

    watchdog_task = asyncio.create_task(stream_watchdog())

    last_ai_spoken = ""
    last_activity_time = time.perf_counter()
    silence_nudge_count = 0

    async def handle_final(text: str, is_system_prompt: bool = False):
        nonlocal speaking_task, last_ai_spoken, last_activity_time, silence_nudge_count
        if bridge.closed.is_set():
            return
        text = (text or "").strip()
        if not text:
            return

        is_speaking = bool(speaking_task and not speaking_task.done())

        if not is_system_prompt:
            # Caller spoke -> detect language, reset silence nudge count and update activity timestamp
            user_lang = _detect_speech_language(text, fallback_lang=getattr(bridge, "_current_language", "en"))
            bridge._current_language = user_lang
            logger.info(f"[MODULAR] Caller language detected: '{user_lang}' for utterance '{text}'")
            silence_nudge_count = 0
            last_activity_time = time.perf_counter()

            # Rule 2.3: Suppress Acoustic Echo reflection while speaking
            if is_speaking and _is_acoustic_echo(text, last_ai_spoken):
                logger.info(f"[MODULAR] Acoustic reflection / self-echo suppressed ({text}). Continuing speech.")
                return

            # Rule 3.2: Suppress Phantom noise / short non-speech impulses
            if is_speaking and _is_phantom_noise(text):
                logger.info(f"[MODULAR] Phantom noise / impulse suppressed ({text}) while speaking. Continuing playback.")
                return

            # Rule: Adaptive Interruption Handling (1-word backchannels)
            if is_speaking and _is_backchannel(text):
                logger.info(f"[MODULAR] Backchannel acknowledged ({text}) while speaking — continuing playback without interruption.")
                return

            # Opening greeting: never cut it short. Capture what the caller said and answer it
            # the moment the greeting finishes (queue is drained by _greeting_window).
            if is_speaking and greeting_active:
                pending_during_greeting.append(text)
                logger.info(f"[MODULAR] Captured during greeting ({text}) — will answer right after it ends.")
                asyncio.create_task(_update_call_transcript(local_id, f"Prospect: {text}"))
                asyncio.create_task(call_hub.broadcast("call_transcript_delta", {"callId": local_id, "who": "them", "delta": text}))
                return

            # True interruption: caller spoke genuine words
            if is_speaking:
                logger.info(f"[MODULAR] True barge-in detected ({text}) — cancelling active speech.")
                bridge._barge.set()
                speaking_task.cancel()

            # Fire-and-forget transcript & UI update so LLM turn starts with zero delay
            asyncio.create_task(_update_call_transcript(local_id, f"Prospect: {text}"))
            asyncio.create_task(call_hub.broadcast("call_transcript_delta", {"callId": local_id, "who": "them", "delta": text}))
            history.append({"role": "user", "content": text})
        else:
            # System-injected silence re-prompt
            if is_speaking:
                return
            history.append({"role": "user", "content": text})

        t_turn_start = time.perf_counter()
        llm = plan.llm
        bridge._barge = asyncio.Event()

        async def run_streaming_turn():
            nonlocal history, last_ai_spoken
            t_first_token: Optional[float] = None
            t_first_audio: Optional[float] = None
            t_llm_done: Optional[float] = None
            first_chunk_tts_ms: float = 0.0
            first_chunk_text: str = ""
            accumulated_reply = []
            chunks_synthesized: list[tuple[str, int]] = []
            total_frames_played = 0

            sentence_queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
            audio_queue: asyncio.Queue[Optional[tuple[str, list[str]]]] = asyncio.Queue()

            def on_frame_dispatched(n: int = 1):
                nonlocal total_frames_played
                total_frames_played += n

            # Task 1: LLM Token Streamer & Sentence Segmenter
            async def llm_streamer():
                nonlocal t_first_token, t_llm_done
                text_buffer = ""
                token_count = 0
                chunks_dispatched = 0
                try:
                    async for token in stream_open_chat_llm(
                        messages=history[-12:],
                        system_prompt=system,
                        api_key=llm.api_key if llm else None,
                        provider=llm.provider if llm else None,
                        model=llm.model if llm else None,
                        base_url=llm.base_url if llm else None,
                        temperature=0.7,
                        max_tokens=180,
                    ):
                        if bridge._barge.is_set() or bridge.closed.is_set():
                            break
                        if token_count == 0:
                            t_first_token = time.perf_counter()
                        token_count += 1
                        accumulated_reply.append(token)
                        text_buffer += token

                        # Non-blocking broadcast live token delta to UI
                        asyncio.create_task(call_hub.broadcast("call_transcript_delta", {"callId": local_id, "who": "ai", "delta": token}))

                        # Split complete sentences / early clauses to queue for TTS (2-4 words on first clause)
                        ready_chunks, text_buffer = _split_into_chunks(text_buffer, is_first=(chunks_dispatched == 0))
                        for chunk in ready_chunks:
                            if bridge._barge.is_set():
                                break
                            chunks_dispatched += 1
                            await sentence_queue.put(chunk)

                except Exception as stream_err:
                    logger.warning(f"[MODULAR] LLM streaming error: {stream_err}")

                t_llm_done = time.perf_counter()

                # Flush remaining buffer
                if text_buffer.strip() and not bridge._barge.is_set():
                    await sentence_queue.put(text_buffer.strip())

                # If no tokens produced at all (e.g. error), produce fallback
                if token_count == 0 and not bridge._barge.is_set():
                    fallback = "Sorry, I missed that — could you say that again?"
                    accumulated_reply.append(fallback)
                    await sentence_queue.put(fallback)
                    asyncio.create_task(call_hub.broadcast("call_transcript_delta", {"callId": local_id, "who": "ai", "delta": fallback}))

                await sentence_queue.put(None)

            # Task 2: Streaming TTS Synthesizer (Cartesia WebSocket streaming with REST fallback)
            async def tts_worker():
                nonlocal t_first_audio, first_chunk_tts_ms, first_chunk_text
                while not bridge._barge.is_set() and not bridge.closed.is_set():
                    sentence_text = await sentence_queue.get()
                    if sentence_text is None:
                        await audio_queue.put(None)
                        break
                    if bridge._barge.is_set():
                        break

                    t_chunk_tts_start = time.perf_counter()
                    total_sent_frames = 0
                    try:
                        async for frame_batch in _stream_tts_frames(bridge, plan, sentence_text):
                            if bridge._barge.is_set():
                                break
                            if not frame_batch:
                                continue
                            t_now = time.perf_counter()
                            if t_first_audio is None:
                                t_first_audio = t_now
                                first_chunk_tts_ms = round((t_now - t_chunk_tts_start) * 1000, 1)
                                first_chunk_text = sentence_text
                            total_sent_frames += len(frame_batch)
                            await audio_queue.put((sentence_text, frame_batch))
                    except Exception as tts_err:
                        logger.warning(f"[MODULAR] TTS stream error: {tts_err}")

                    if total_sent_frames > 0:
                        chunks_synthesized.append((sentence_text, total_sent_frames))

            # Task 3: Continuous Audio Player with monotonic, drift-free pacing
            async def audio_player():
                loop_start = None
                total_played = 0
                frame_duration = 0.020  # 20ms per μ-law frame
                while not bridge._barge.is_set() and not bridge.closed.is_set():
                    item = await audio_queue.get()
                    if item is None:
                        break
                    if bridge._barge.is_set():
                        break
                    chunk_str, frames = item
                    if loop_start is None:
                        loop_start = time.perf_counter()
                        total_played = 0
                    for b64 in frames:
                        if bridge._barge.is_set():
                            break
                        await bridge.emit_ai_audio(b64)
                        total_played += 1
                        on_frame_dispatched(1)
                        expected_elapsed = total_played * frame_duration
                        actual_elapsed = time.perf_counter() - loop_start
                        sleep_needed = expected_elapsed - actual_elapsed
                        if sleep_needed > 0.001:
                            await asyncio.sleep(sleep_needed)
                    if audio_queue.empty():
                        loop_start = None

            # Run pipeline concurrently
            streamer_t = asyncio.create_task(llm_streamer())
            tts_t = asyncio.create_task(tts_worker())
            player_t = asyncio.create_task(audio_player())

            was_interrupted = False
            try:
                await asyncio.gather(streamer_t, tts_t, player_t)
            except asyncio.CancelledError:
                was_interrupted = True
                streamer_t.cancel()
                tts_t.cancel()
                player_t.cancel()

            full_reply = ""
            # Rule 3.1: The Speech Meter — Context Truncation Indexing
            if was_interrupted:
                if total_frames_played == 0:
                    logger.info(f"[SPEECH-METER] Call {local_id} cancelled before speech playback began (frame 0).")
                    full_reply = ""
                else:
                    spoken_text = _calculate_spoken_text(chunks_synthesized, total_frames_played)
                    full_reply = f"{spoken_text} [interrupted]"
                    last_ai_spoken = spoken_text
                    history.append({"role": "assistant", "content": full_reply})
                    asyncio.create_task(_update_call_transcript(local_id, f"AI: {full_reply}"))
                    logger.info(f"[SPEECH-METER] Call {local_id} interrupted at frame {total_frames_played} (~{round(total_frames_played*0.02, 2)}s). Context truncated to: '{spoken_text}'")
            else:
                full_reply = "".join(accumulated_reply).strip()
                if not full_reply:
                    full_reply = "..."
                last_ai_spoken = full_reply
                history.append({"role": "assistant", "content": full_reply})
                asyncio.create_task(_update_call_transcript(local_id, f"AI: {full_reply}"))

            # Latency profiling calculation
            t_now = time.perf_counter()
            ttft_ms = round(((t_first_token or t_now) - t_turn_start) * 1000, 1)
            ttfa_ms = round(((t_first_audio or t_now) - t_turn_start) * 1000, 1)
            total_llm_stream_ms = round(((t_llm_done or t_now) - t_turn_start) * 1000, 1)
            total_turn_ms = round((t_now - t_turn_start) * 1000, 1)

            llm_name = (llm.provider or "deepseek") if llm else "deepseek"
            tts_name = (plan.tts.provider or "cartesia") if plan.tts else "cartesia"

            # Exact structured speed telemetry log for terminal monitoring
            first_words = len(first_chunk_text.split()) if first_chunk_text else 0
            logger.info(
                f"\n" + "="*84 + "\n"
                f" [SPEED TELEMETRY] Turn Turnaround Profile (Call {local_id}):\n"
                f"   1. STT  (Deepgram):      Endpointing ~700ms | Utterance: '{text}'\n"
                f"   2. LLM  ({llm_name}):    TTFT (First Token): {ttft_ms}ms | Stream Finished: {total_llm_stream_ms}ms\n"
                f"   3. TTS  ({tts_name}):    Chunk 1 ({first_words} words): {first_chunk_tts_ms}ms\n"
                f"   ------------------------------------------------------------------------\n"
                f"   ==> TOTAL TIME-TO-FIRST-AUDIO (TTFA): {ttfa_ms}ms (~{round(ttfa_ms/1000, 2)}s to first voice sound)\n"
                + "="*84
            )

            try:
                await call_hub.broadcast("call_latency_profile", {
                    "callId": local_id,
                    "ttft_ms": ttft_ms,
                    "ttfa_ms": ttfa_ms,
                    "total_ms": total_turn_ms,
                    "llm_ms": ttft_ms,
                    "tts_ms": first_chunk_tts_ms,
                    "llm": f"{llm_name} (streamed)",
                    "tts": f"{tts_name} (streamed)",
                })
            except Exception:
                pass

            hangup_triggered = _is_hangup_intent(text, full_reply)
            if hangup_triggered:
                logger.info(f"[MODULAR] Hangup intent triggered for call {local_id}. Gracefully closing call.")
                # Give 1.5s for the last audio packet buffer to clear to the caller's phone
                await asyncio.sleep(1.5)
                resolved_sid = carrier_sid
                try:
                    async with AsyncSessionLocal() as sid_db:
                        c_row = (await sid_db.execute(select(LiveCall).where(LiveCall.id == local_id))).scalars().first()
                        if c_row:
                            if not resolved_sid:
                                resolved_sid = getattr(c_row, "carrier_sid", None)
                            if not resolved_sid:
                                for line in c_row.transcript or []:
                                    m = re.search(r"\b(CA[0-9a-fA-F]{32})\b", str(line))
                                    if m:
                                        resolved_sid = m.group(1)
                                        break
                            c_row.ended = True
                            c_row.state = "ended"
                            await sid_db.commit()
                            await call_hub.broadcast("call_ended", {"callId": local_id, "id": local_id, "state": "ended"})
                except Exception:
                    pass

                if resolved_sid:
                    try:
                        from app.services.outbound_dial import _resolve_carrier_and_creds
                        from app.services.telephony_provider import carrier_registry
                        async with AsyncSessionLocal() as cr_db:
                            carrier_choice, credentials, _ = await _resolve_carrier_and_creds(cr_db, str(plan.carrier or "twilio").lower(), None, None)
                            adapter = carrier_registry.get_adapter(carrier_choice or "twilio")
                            await adapter.hangup_call(resolved_sid, credentials=credentials)
                            logger.info(f"[MODULAR] Auto-hangup successfully terminated carrier call {resolved_sid} on {carrier_choice}")
                    except Exception as h_err:
                        logger.warning(f"[MODULAR] Carrier hangup: {h_err}")

                await bridge.close()

            last_activity_time = time.perf_counter()

        await _maybe_execute_booking_tool(call_ctx, history, system, plan, local_id, text)

        speaking_task = asyncio.create_task(run_streaming_turn())
        bridge._speaking_task = speaking_task

    async def silence_watchdog():
        nonlocal silence_nudge_count, last_activity_time
        while not bridge.closed.is_set():
            await asyncio.sleep(0.5)
            if bridge.closed.is_set():
                break

            is_speaking = bool(speaking_task and not speaking_task.done())
            if is_speaking:
                continue

            idle_sec = time.perf_counter() - last_activity_time

            # 9.0s silence after AI speech -> gentle 1-sentence check-in
            if idle_sec >= 9.0 and silence_nudge_count == 0:
                silence_nudge_count = 1
                logger.info(f"[MODULAR] Caller silence detected ({round(idle_sec, 1)}s dead air). Prompting caller.")
                await handle_final(
                    "[System Event: The caller has been quiet for 9 seconds. Politely ask a brief 1-sentence check-in to see if they are still there or if they have any questions on what was said.]",
                    is_system_prompt=True,
                )
            # 28.0s prolonged silence -> politely ask for email address
            elif idle_sec >= 28.0 and silence_nudge_count == 1:
                silence_nudge_count = 2
                logger.info(f"[MODULAR] Prolonged silence ({round(idle_sec, 1)}s dead air). Asking for email follow-up.")
                await handle_final(
                    "[System Event: The caller has remained quiet. Say: 'I might have a weak connection. Could you share the best email address so I can send the information directly over to you?' and pause for their answer.]",
                    is_system_prompt=True,
                )
            # 45.0s total silence -> conclude call politely
            elif idle_sec >= 45.0 and silence_nudge_count == 2:
                silence_nudge_count = 3
                logger.info(f"[MODULAR] Final silence timeout ({round(idle_sec, 1)}s dead air). Ending call gracefully.")
                await handle_final(
                    "[System Event: Complete silence for 45 seconds. Say: 'Thanks for your time, I'll send the details over. Have a wonderful day!' and conclude.]",
                    is_system_prompt=True,
                )

    silence_watchdog_task = asyncio.create_task(silence_watchdog())

    try:
        if dg_key:
            async with websockets.connect(
                dg_url,
                additional_headers={"Authorization": f"Token {dg_key}"},
                ping_interval=20,
                ping_timeout=15,
            ) as dg:
                bridge._dg_ws = dg
                logger.info(f"[MODULAR] Deepgram connected for {call_id}")

                async def keepalive():
                    while not bridge.closed.is_set():
                        await asyncio.sleep(4)
                        if bridge.closed.is_set():
                            break
                        try:
                            async with AsyncSessionLocal() as chk_db:
                                c_row = (await chk_db.execute(select(LiveCall).where(LiveCall.id == local_id))).scalars().first()
                                if c_row and c_row.ended:
                                    logger.info(f"[MODULAR] Call {local_id} marked ended in DB. Halting pipeline.")
                                    await bridge.close()
                                    break
                        except Exception:
                            pass
                        try:
                            await dg.send(json.dumps({"type": "KeepAlive"}))
                        except Exception:
                            return

                ka = asyncio.create_task(keepalive())
                accumulated_utterance: list[str] = []
                flush_task: Optional[asyncio.Task] = None

                async def _debounced_flush():
                    await asyncio.sleep(0.2)
                    nonlocal accumulated_utterance
                    if accumulated_utterance:
                        full_text = " ".join(accumulated_utterance).strip()
                        accumulated_utterance = []
                        if full_text:
                            await handle_final(full_text)

                try:
                    async for raw_msg in dg:
                        if bridge.closed.is_set():
                            break
                        if isinstance(raw_msg, bytes):
                            continue
                        try:
                            ev = json.loads(raw_msg)
                        except Exception:
                            continue

                        try:
                            if isinstance(ev, list):
                                ev = ev[0] if (ev and isinstance(ev[0], dict)) else {}
                            if not isinstance(ev, dict):
                                continue

                            msg_type = ev.get("type")
                            if msg_type == "SpeechStarted":
                                logger.debug(f"[MODULAR] Deepgram SpeechStarted event received for {call_id}")
                                last_activity_time = time.perf_counter()
                                silence_nudge_count = 0
                                continue

                            if msg_type == "Metadata":
                                continue

                            if msg_type == "UtteranceEnd":
                                last_activity_time = time.perf_counter()
                                silence_nudge_count = 0
                                if flush_task and not flush_task.done():
                                    flush_task.cancel()
                                if accumulated_utterance:
                                    full_text = " ".join(accumulated_utterance).strip()
                                    accumulated_utterance = []
                                    if full_text:
                                        await handle_final(full_text)
                                continue

                            if msg_type != "Results":
                                continue

                            channel = ev.get("channel")
                            if isinstance(channel, list):
                                channel = channel[0] if (channel and isinstance(channel[0], dict)) else {}
                            elif not isinstance(channel, dict):
                                channels = ev.get("channels")
                                if isinstance(channels, list) and channels and isinstance(channels[0], dict):
                                    channel = channels[0]
                                else:
                                    channel = {}

                            alt = channel.get("alternatives") or []
                            if not isinstance(alt, list) or not alt:
                                continue
                            first_alt = alt[0]
                            if not isinstance(first_alt, dict):
                                continue
                            chunk_text = (first_alt.get("transcript") or "").strip()
                            if not chunk_text:
                                continue

                            last_activity_time = time.perf_counter()
                            silence_nudge_count = 0
                            is_final = bool(ev.get("is_final"))
                            speech_final = bool(ev.get("speech_final"))

                            if is_final:
                                accumulated_utterance.append(chunk_text)
                                if flush_task and not flush_task.done():
                                    flush_task.cancel()
                                flush_task = asyncio.create_task(_debounced_flush())

                            if speech_final:
                                if flush_task and not flush_task.done():
                                    flush_task.cancel()
                                full_text = " ".join(accumulated_utterance).strip()
                                accumulated_utterance = []
                                if full_text:
                                    await handle_final(full_text)
                        except Exception as parse_err:
                            logger.warning(f"[MODULAR] Error handling Deepgram event: {parse_err}")
                            continue
                finally:
                    if flush_task and not flush_task.done():
                        flush_task.cancel()
                    ka.cancel()
        else:
            logger.info(f"[MODULAR] Telnyx Whisper VAD STT active for {call_id}")
            while not bridge.closed.is_set():
                await asyncio.sleep(2)
                if bridge.closed.is_set():
                    break
                try:
                    async with AsyncSessionLocal() as chk_db:
                        c_row = (await chk_db.execute(select(LiveCall).where(LiveCall.id == local_id))).scalars().first()
                        if c_row and c_row.ended:
                            logger.info(f"[MODULAR] Call {local_id} marked ended in DB. Halting pipeline.")
                            await bridge.close()
                            break
                except Exception:
                    pass
    except Exception as err:
        logger.warning(f"[MODULAR] STT session ended for {call_id}: {err}", exc_info=True)
    finally:
        silence_watchdog_task.cancel()
        watchdog_task.cancel()
        if getattr(bridge, "_cartesia_ws", None):
            try:
                await bridge._cartesia_ws.close()
            except Exception:
                pass
            bridge._cartesia_ws = None
        await bridge.close()
        if getattr(bridge, "_dg_ws", None):
            try:
                await bridge._dg_ws.send(json.dumps({"type": "CloseStream"}))
            except Exception:
                pass
        bridge._dg_ws = None
        bridge.on_caller_audio = None
        logger.info(f"[MODULAR] Pipeline finished for {call_id}")
        # Engine stopped (error, STT close, or caller drop): if the row is still open,
        # finalize it and release the carrier leg so the prospect's phone drops with ours.
        try:
            from datetime import datetime as _dt
            from app.services.xai_voice_service import _finalize_call
            async with AsyncSessionLocal() as fin_db:
                row = (await fin_db.execute(select(LiveCall).where(LiveCall.id == local_id))).scalars().first()
                if row is not None and not row.ended:
                    started = row.created_at or _dt.utcnow()
                    secs = max(1, int((_dt.utcnow() - started).total_seconds()))
                    await _finalize_call(local_id, f"{secs // 60:02d}:{secs % 60:02d}", list(row.transcript or []))
        except Exception as fin_err:
            logger.warning(f"[MODULAR] finalize on pipeline end failed for {call_id}: {fin_err}")
