"""Resolve which voice plugins a live call should use from Connections + hub config."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional

from sqlalchemy.future import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.models import Connection

logger = logging.getLogger("voice_plugin_plan")

XAI_BUILTIN_VOICES = {
    "ara", "eve", "rex", "leo", "sal",
    "alloy", "echo", "shimmer", "onyx", "sage", "nova",
}
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)

import os
import json

ACTIVE_STACK_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "active_voice_stack.json")

DEFAULT_ACTIVE_STACK = {
    "engine": "livekit",
    "engine_label": "LiveKit (self-hosted)",
    "tts": "xAI built-in (rex)",
    "llm": "DeepSeek",
    "llm_model": "deepseek-chat",
    "stt": "Deepgram",
    "stt_model": "nova-2",
    "carrier": "Twilio",
}

def get_active_stack() -> Dict[str, str]:
    if os.path.exists(ACTIVE_STACK_FILE):
        try:
            with open(ACTIVE_STACK_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {**DEFAULT_ACTIVE_STACK, **data}
        except Exception:
            pass
    return dict(DEFAULT_ACTIVE_STACK)

def set_active_stack(patch: Dict[str, Any]) -> Dict[str, str]:
    current = get_active_stack()
    for k, v in patch.items():
        if v is not None:
            current[k] = str(v).strip()
    os.makedirs(os.path.dirname(ACTIVE_STACK_FILE), exist_ok=True)
    try:
        with open(ACTIVE_STACK_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
    except Exception as e:
        logger.warning(f"Could not persist active voice stack to {ACTIVE_STACK_FILE}: {e}")
    return current


@dataclass
class PluginCreds:
    provider: str
    api_key: str
    base_url: str = ""
    model: str = ""
    voice_id: str = ""
    extra: Dict[str, Any] = None

    def __post_init__(self):
        if self.extra is None:
            self.extra = {}


@dataclass
class VoicePlan:
    engine: str  # xai | openai | modular | livekit
    voice_name: str
    carrier: str
    stt: Optional[PluginCreds] = None
    tts: Optional[PluginCreds] = None
    llm: Optional[PluginCreds] = None
    s2s_key: str = ""
    note: str = ""
    # True when xAI handles STT+Grok but Cartesia/ElevenLabs speaks the cloned voice
    external_tts: bool = False


def _cfg(conn: Optional[Connection]) -> Dict[str, Any]:
    if conn and isinstance(conn.config, dict):
        return conn.config
    return {}


def _key_from(conn: Optional[Connection]) -> str:
    from app.services.secret_box import config_get_secret
    cfg = _cfg(conn)
    return config_get_secret(cfg, "api_key", "apiKey", "auth_token")


def _norm_engine(name: str, cfg: Dict[str, Any]) -> str:
    eid = str(cfg.get("engine") or "").lower().strip()
    if eid in ("xai", "openai", "modular", "livekit", "vapi", "retell", "custom"):
        return eid
    raw = f"{eid} {name or ''}".lower()
    if "livekit" in raw:
        return "livekit"
    if "vapi" in raw:
        return "vapi"
    if "retell" in raw:
        return "retell"
    if "custom" in raw or "other" in raw:
        return "custom"
    if "openai" in raw:
        return "openai"
    if "modular" in raw:
        return "modular"
    return "xai"


def _match_provider(name: str) -> str:
    n = (name or "").lower()
    if "deepgram" in n:
        return "deepgram"
    if "eleven" in n:
        return "elevenlabs"
    if "cartesia" in n:
        return "cartesia"
    if "whisper" in n:
        return "whisper"
    if "openai" in n or "gpt" in n:
        return "openai"
    if "groq" in n:
        return "groq"
    if "anthropic" in n or "claude" in n:
        return "anthropic"
    if "deepseek" in n:
        return "deepseek"
    if "xai" in n or "grok" in n:
        return "xai"
    return n.split()[0] if n else ""


def looks_like_api_key(vid: str) -> bool:
    """True when a secret/token was pasted where a Voice ID belongs."""
    v = (vid or "").strip().lower()
    if not v:
        return False
    return v.startswith((
        "sk_", "sk-", "sk_car_", "cartesia_", "xai-", "whsec_",
        "api_", "key_", "bearer ", "el_", "eleven_",
    ))


def looks_like_external_voice_id(vid: str) -> bool:
    """True for Cartesia UUID / ElevenLabs IVC ids — not xAI builtins or API keys."""
    v = (vid or "").strip()
    if not v:
        return False
    if looks_like_api_key(v):
        return False
    low = v.lower().replace("-uk", "").replace("_uk", "")
    if low in XAI_BUILTIN_VOICES:
        return False
    if low in ("rachel", "adam", "sonic"):
        return False
    if _UUID_RE.match(v):
        return True
    # ElevenLabs voice ids are typically 20+ alphanumerics (not sk_…)
    if len(v) >= 16 and re.fullmatch(r"[A-Za-z0-9]+", v):
        return True
    return False


def _resolve_llm_model(provider: str, candidate_model: Optional[str], conn_model: Optional[str]) -> str:
    p = (provider or "").lower()
    m = (candidate_model or conn_model or "").strip()
    m_lower = m.lower()

    if "xai" in p or "grok" in p:
        if not m or any(cross in m_lower for cross in ["grok-beta", "grok-2", "deepseek", "llama", "gpt", "claude", "whisper", "nova", "sonic"]):
            return "grok-4.20-0309-non-reasoning"
        return m

    if "deepseek" in p:
        if not m or any(cross in m_lower for cross in ["grok", "llama", "gpt", "claude", "whisper", "nova", "sonic"]):
            return "deepseek-chat"
        return m

    if "groq" in p:
        if not m or any(cross in m_lower for cross in ["grok", "deepseek", "gpt", "claude", "whisper", "nova", "sonic"]):
            return "llama-3.3-70b-versatile"
        return m

    if "openai" in p:
        if not m or any(cross in m_lower for cross in ["grok", "deepseek", "llama", "claude", "whisper", "nova", "sonic"]):
            return "gpt-4o"
        return m

    if "anthropic" in p or "claude" in p:
        if not m or any(cross in m_lower for cross in ["grok", "deepseek", "llama", "gpt", "whisper", "nova", "sonic"]):
            return "claude-3-5-sonnet-20241022"
        return m

    return m or "grok-4.20-0309-non-reasoning"


def _strip_voice(v: Any) -> str:
    return str(v or "").strip()


async def resolve_voice_plan() -> VoicePlan:
    engine_conn = None
    carrier_conn = None
    stt_conn = None
    tts_conn = None
    llm_conn = None
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Connection))
        conns = res.scalars().all()

    active_stack = get_active_stack()
    target_engine = (active_stack.get("engine") or "livekit").lower()
    target_tts = (active_stack.get("tts") or "").lower()
    target_llm = (active_stack.get("llm") or "").lower()
    target_stt = (active_stack.get("stt") or "").lower()
    target_carrier = (active_stack.get("carrier") or "").lower()

    def _pick(group_needles: tuple, current):
        matches = [c for c in conns if any(n in (c.group_name or "").lower() for n in group_needles) and _key_from(c)]
        if not matches:
            return current
        return next((c for c in matches if c.status == "connected"), matches[0])

    # 1. Resolve Engine connection matching active stack
    for c in conns:
        group = (c.group_name or "").lower()
        if "voice orchestration" in group:
            c_name = (c.name or "").lower()
            if target_engine in c_name or (target_engine == "livekit" and "livekit" in c_name) or (target_engine == "xai" and "xai" in c_name):
                engine_conn = c
                break
    if not engine_conn:
        for c in conns:
            if "voice orchestration" in (c.group_name or "").lower():
                engine_conn = c
                break

    # 2. Resolve Carrier connection matching active stack
    for c in conns:
        group = (c.group_name or "").lower()
        if "telephony" in group:
            c_name = (c.name or "").lower()
            if target_carrier and target_carrier.split()[0] in c_name:
                carrier_conn = c
                break
    if not carrier_conn:
        for c in conns:
            if "telephony" in (c.group_name or "").lower():
                carrier_conn = c
                break

    # 3. Resolve LLM connection matching active stack
    for c in conns:
        group = (c.group_name or "").lower()
        if "llm" in group:
            c_name = (c.name or "").lower()
            if target_llm and target_llm.split()[0] in c_name and c.status == "connected":
                llm_conn = c
                break
    if not llm_conn:
        llm_conn = _pick(("llm",), llm_conn)

    # 4. Resolve STT connection matching active stack
    for c in conns:
        group = (c.group_name or "").lower()
        if any(n in group for n in ("speech-to-text", "stt")):
            c_name = (c.name or "").lower()
            if target_stt and target_stt.split()[0] in c_name and c.status == "connected":
                stt_conn = c
                break
    if not stt_conn:
        stt_conn = _pick(("speech-to-text", "stt"), stt_conn)

    # 5. Resolve TTS connection matching active stack
    is_xai_builtin_tts = "xai built-in" in target_tts or target_tts in ("rex", "ara", "eve", "leo")
    if is_xai_builtin_tts:
        tts_conn = None
    elif target_tts:
        for c in conns:
            group = (c.group_name or "").lower()
            if any(n in group for n in ("text-to-speech", "tts")):
                c_name = (c.name or "").lower()
                if any(k in c_name for k in target_tts.split()):
                    tts_conn = c
                    break
    if not tts_conn and not is_xai_builtin_tts:
        tts_conn = _pick(("text-to-speech", "tts"), tts_conn)

    engine_cfg = _cfg(engine_conn)
    engine = target_engine if target_engine in ("livekit", "xai", "vapi", "retell", "openai", "modular") else _norm_engine(engine_conn.name if engine_conn else "", engine_cfg)
    
    # Determine voice name
    voice_name = "rex"
    if is_xai_builtin_tts:
        match_v = re.search(r"\(([^)]+)\)", target_tts)
        if match_v:
            voice_name = match_v.group(1).strip()
    else:
        voice_name = engine_cfg.get("voice_name") or engine_cfg.get("voice") or settings.XAI_VOICE_NAME or "rex"
    voice_name = _strip_voice(voice_name) or "rex"
    carrier = (carrier_conn.name if carrier_conn else "twilio") or "twilio"
    orch_clone = _strip_voice(engine_cfg.get("cloned_voice_id") or "")

    stt = None
    if stt_conn and _key_from(stt_conn):
        stt = PluginCreds(
            provider=_match_provider(stt_conn.name) or "deepgram",
            api_key=_key_from(stt_conn),
            base_url=_cfg(stt_conn).get("base_url") or "",
            model=_cfg(stt_conn).get("model") or "nova-2",
            extra={"display_name": stt_conn.name or ""},
        )
    elif settings.DEEPGRAM_API_KEY:
        stt = PluginCreds(provider="deepgram", api_key=settings.DEEPGRAM_API_KEY.strip(), model="nova-2", extra={"display_name": "Deepgram Nova-2"})

    cartesia_vid = _strip_voice(getattr(settings, "CARTESIA_VOICE_ID", None))
    eleven_vid = _strip_voice(getattr(settings, "ELEVENLABS_VOICE_ID", None))
    # orch_clone already resolved above from Voice Orchestration plugin

    tts = None
    if tts_conn and _key_from(tts_conn):
        tts_cfg = _cfg(tts_conn)
        provider = _match_provider(tts_conn.name) or "elevenlabs"
        vid = _strip_voice(tts_cfg.get("voice_id") or "")
        if not vid:
            if "cartesia" in provider and cartesia_vid:
                vid = cartesia_vid
            elif "eleven" in provider and eleven_vid:
                vid = eleven_vid
            elif "deepgram" in provider:
                vid = "aura-orion-en"
            elif orch_clone and looks_like_external_voice_id(orch_clone):
                vid = orch_clone
            elif looks_like_external_voice_id(voice_name):
                vid = voice_name
        tts = PluginCreds(
            provider=provider,
            api_key=_key_from(tts_conn),
            voice_id=vid,
            model=tts_cfg.get("model") or "",
            extra={"display_name": tts_conn.name or ""},
        )
    elif settings.CARTESIA_API_KEY:
        vid = cartesia_vid or (orch_clone if looks_like_external_voice_id(orch_clone) else "") or (
            voice_name if looks_like_external_voice_id(voice_name) else ""
        )
        tts = PluginCreds(
            provider="cartesia",
            api_key=settings.CARTESIA_API_KEY.strip(),
            voice_id=vid,
            extra={"display_name": "Cartesia"},
        )
    elif settings.ELEVENLABS_API_KEY:
        vid = eleven_vid or (orch_clone if looks_like_external_voice_id(orch_clone) else "") or (
            voice_name if looks_like_external_voice_id(voice_name) else ""
        )
        tts = PluginCreds(
            provider="elevenlabs",
            api_key=settings.ELEVENLABS_API_KEY.strip(),
            voice_id=vid,
            extra={"display_name": "ElevenLabs"},
        )
    elif stt and stt.provider == "deepgram" and stt.api_key:
        tts = PluginCreds(
            provider="deepgram",
            api_key=stt.api_key,
            voice_id="aura-orion-en",
            model="aura-orion-en",
            extra={"display_name": "Deepgram Aura (Auto)"},
        )

    llm = None
    if llm_conn and _key_from(llm_conn):
        llm_provider = _match_provider(llm_conn.name) or "openai"
        resolved_model = _resolve_llm_model(llm_provider, active_stack.get("llm_model"), _cfg(llm_conn).get("model"))
        llm = PluginCreds(
            provider=llm_provider,
            api_key=_key_from(llm_conn),
            base_url=_cfg(llm_conn).get("base_url") or "",
            model=resolved_model,
            extra={"display_name": llm_conn.name or ""},
        )

    openai_key = (engine_cfg.get("api_key") or settings.OPENAI_API_KEY or "").strip()
    xai_key = (engine_cfg.get("api_key") or settings.XAI_API_KEY or "").strip()
    # Voice Orchestration often empty while LLM · xAI is saved — reuse that for S2S.
    if (not xai_key or xai_key.startswith("mock")) and llm and llm.api_key and str(llm.api_key).startswith("xai-"):
        xai_key = llm.api_key.strip()
        logger.info("Using LLM xAI key for voice S2S (Voice Orchestration key empty).")
    if engine == "openai" and openai_key and not openai_key.startswith("xai-"):
        pass
    elif engine == "openai" and (not openai_key or openai_key.startswith("xai-")):
        if settings.OPENAI_API_KEY:
            openai_key = settings.OPENAI_API_KEY.strip()
        else:
            engine = "xai"
            note = "OpenAI engine selected but no OpenAI key — falling back to xAI."
            logger.warning(note)
            return VoicePlan(engine=engine, voice_name=voice_name, carrier=carrier, stt=stt, tts=tts, llm=llm, s2s_key=xai_key, note=note)

    if engine == "modular":
        if not (stt and stt.api_key and tts and tts.api_key):
            if xai_key and xai_key.startswith("xai-"):
                note = "Modular selected but STT/TTS keys missing — falling back to xAI S2S."
                logger.warning(note)
                return VoicePlan(engine="xai", voice_name=voice_name, carrier=carrier, stt=stt, tts=tts, llm=llm, s2s_key=xai_key, note=note)
            note = "Modular selected but STT or TTS plugin has no key."
            logger.warning(note)
            return VoicePlan(engine=engine, voice_name=voice_name, carrier=carrier, stt=stt, tts=tts, llm=llm, note=note)

    if engine == "xai" and (not xai_key or xai_key.startswith("mock")):
        # Log detailed diagnostic info
        logger.error(
            f"[VOICE-PLAN-ERROR] Cannot proceed with call:\n"
            f"  engine={engine}\n"
            f"  xai_key={'MISSING' if not xai_key else 'MOCK_KEY' if xai_key.startswith('mock') else 'PRESENT'}\n"
            f"  voice_name={voice_name}\n"
            f"  carrier={carrier}\n"
            f"  VOICE_ENGINE_MODE={settings.VOICE_ENGINE_MODE}\n"
            f"  XAI_API_KEY env={'MISSING' if not settings.XAI_API_KEY else 'SET'}"
        )
        raise ValueError(
            f"Voice engine cannot operate: engine={engine}, xai_key_present={bool(xai_key)}, "
            f"VOICE_ENGINE_MODE={settings.VOICE_ENGINE_MODE}. "
            f"Configure XAI_API_KEY in .env or add xAI Realtime connection in Connections panel."
        )

    # Hybrid TTS only when the ACTIVE saved voice is an external clone ID.
    # Selecting ara/rex/eve (or other builtins) turns hybrid OFF even if a Cartesia
    # key + old UUID remain on the Text-to-Speech plugin.
    active_voice = _strip_voice(voice_name)
    active_is_clone = looks_like_external_voice_id(active_voice)
    if tts and active_is_clone:
        # Keep plugin key; force speak-id to the active clone selection
        tts.voice_id = active_voice
    elif tts and not active_is_clone:
        # Builtin xAI/OpenAI persona selected — ignore plugin clone id for routing
        pass

    external_tts = bool(
        engine == "xai"
        and active_is_clone
        and tts
        and tts.api_key
    ) or bool(engine == "livekit" and tts and tts.api_key)

    note = ""
    if engine == "xai":
        if external_tts:
            note = f"xAI STT+Grok; external TTS via {tts.provider} clone."
        else:
            note = f"Speech-to-speech via xAI Grok ({active_voice or 'rex'}). External TTS plugins idle."
    elif engine == "openai":
        note = f"Speech-to-speech via OpenAI Realtime ({active_voice or 'alloy'})."
    elif engine == "livekit":
        note = f"LiveKit Agents pipeline: {stt.provider if stt else 'deepgram'} STT -> {llm.provider if llm else 'deepseek'} LLM -> {tts.provider if tts else 'cartesia'} TTS."
    elif engine == "vapi":
        note = "Turnkey voice agent orchestration via Vapi AI."
    elif engine == "retell":
        note = "Conversational voice agent orchestration via Retell AI."
    elif engine == "custom":
        note = "Custom Base URL voice orchestration."
    elif engine == "modular":
        note = f"Modular pipeline: {stt.provider if stt else '?'} STT -> LLM -> {tts.provider if tts else '?'} TTS."

    return VoicePlan(
        engine=engine,
        voice_name=voice_name,
        carrier=carrier,
        stt=stt,
        tts=tts,
        llm=llm,
        s2s_key=openai_key if engine == "openai" else xai_key,
        note=note,
        external_tts=external_tts,
    )
