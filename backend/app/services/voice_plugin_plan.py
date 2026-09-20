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
    engine: str  # xai | openai | modular | simulation
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
    if eid in ("xai", "openai", "modular", "simulation"):
        return eid
    raw = f"{eid} {name or ''}".lower()
    if "openai" in raw:
        return "openai"
    if "modular" in raw:
        return "modular"
    if "sim" in raw:
        return "simulation"
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

    def _pick(group_needles: tuple, current):
        matches = [c for c in conns if any(n in (c.group_name or "").lower() for n in group_needles) and _key_from(c)]
        if not matches:
            return current
        return next((c for c in matches if c.status == "connected"), matches[0])

    for c in conns:
        group = (c.group_name or "").lower()
        if "voice orchestration" in group:
            engine_conn = c
        elif group == "telephony" or group.startswith("telephony"):
            carrier_conn = c
    stt_conn = _pick(("speech-to-text", "stt"), stt_conn)
    tts_conn = _pick(("text-to-speech", "tts"), tts_conn)
    llm_conn = _pick(("llm",), llm_conn)

    engine_cfg = _cfg(engine_conn)
    engine = _norm_engine(engine_conn.name if engine_conn else "", engine_cfg)
    voice_name = engine_cfg.get("voice_name") or engine_cfg.get("voice") or settings.XAI_VOICE_NAME or "rex"
    voice_name = _strip_voice(voice_name) or "rex"
    carrier = (carrier_conn.name if carrier_conn else "twilio") or "twilio"
    orch_clone = _strip_voice(engine_cfg.get("cloned_voice_id") or "")
    # Prefer TTS plugin that matches the active clone provider (plugin mix & match)
    tts_matches = [
        c for c in conns
        if any(n in (c.group_name or "").lower() for n in ("text-to-speech", "tts")) and _key_from(c)
    ]
    if tts_matches:
        preferred = None
        clone_hint = orch_clone or (voice_name if looks_like_external_voice_id(voice_name) else "")
        custom = engine_cfg.get("custom_voices") or []
        clone_provider = ""
        for v in custom:
            if isinstance(v, dict) and str(v.get("voice_id") or "") == clone_hint:
                clone_provider = str(v.get("provider") or "").lower()
                break
        if not clone_provider and clone_hint:
            clone_provider = "cartesia" if _UUID_RE.match(clone_hint) else "elevenlabs"
        for c in tts_matches:
            name = (c.name or "").lower()
            if clone_provider and clone_provider in name:
                preferred = c
                break
        if preferred is None:
            preferred = next((c for c in tts_matches if c.status == "connected"), tts_matches[0])
        tts_conn = preferred

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

    llm = None
    if llm_conn and _key_from(llm_conn):
        llm = PluginCreds(
            provider=_match_provider(llm_conn.name) or "openai",
            api_key=_key_from(llm_conn),
            base_url=_cfg(llm_conn).get("base_url") or "",
            model=_cfg(llm_conn).get("model") or "",
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
            return VoicePlan(engine="modular", voice_name=voice_name, carrier=carrier, stt=stt, tts=tts, llm=llm, note=note)

    if engine == "simulation" or (engine == "xai" and (not xai_key or xai_key.startswith("mock"))):
        if engine != "modular" and engine != "openai":
            if not xai_key or xai_key.startswith("mock"):
                if engine != "simulation":
                    logger.info("No live xAI key — voice engine simulation")

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
    )

    note = ""
    if engine == "xai":
        if external_tts:
            note = f"xAI STT+Grok; external TTS via {tts.provider} clone."
        else:
            note = f"Speech-to-speech via xAI Grok ({active_voice or 'rex'}). External TTS plugins idle."
    elif engine == "openai":
        note = f"Speech-to-speech via OpenAI Realtime ({active_voice or 'alloy'})."
    elif engine == "modular":
        note = f"Modular pipeline: {stt.provider if stt else '?'} STT → LLM → {tts.provider if tts else '?'} TTS."

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
