"""Resolve which voice plugins a live call should use from Connections + hub config."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from sqlalchemy.future import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.models import Connection

logger = logging.getLogger("voice_plugin_plan")


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


def _cfg(conn: Optional[Connection]) -> Dict[str, Any]:
    if conn and isinstance(conn.config, dict):
        return conn.config
    return {}


def _key_from(conn: Optional[Connection]) -> str:
    cfg = _cfg(conn)
    return (cfg.get("api_key") or cfg.get("apiKey") or cfg.get("auth_token") or "").strip()


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
    carrier = (carrier_conn.name if carrier_conn else "twilio") or "twilio"

    stt = None
    if stt_conn and _key_from(stt_conn):
        stt = PluginCreds(
            provider=_match_provider(stt_conn.name) or "deepgram",
            api_key=_key_from(stt_conn),
            base_url=_cfg(stt_conn).get("base_url") or "",
            model=_cfg(stt_conn).get("model") or "nova-2",
        )
    elif settings.DEEPGRAM_API_KEY:
        stt = PluginCreds(provider="deepgram", api_key=settings.DEEPGRAM_API_KEY.strip(), model="nova-2")

    tts = None
    if tts_conn and _key_from(tts_conn):
        tts = PluginCreds(
            provider=_match_provider(tts_conn.name) or "elevenlabs",
            api_key=_key_from(tts_conn),
            voice_id=_cfg(tts_conn).get("voice_id") or "",
            model=_cfg(tts_conn).get("model") or "",
        )
    elif settings.ELEVENLABS_API_KEY:
        tts = PluginCreds(provider="elevenlabs", api_key=settings.ELEVENLABS_API_KEY.strip())
    elif settings.CARTESIA_API_KEY:
        tts = PluginCreds(provider="cartesia", api_key=settings.CARTESIA_API_KEY.strip())

    llm = None
    if llm_conn and _key_from(llm_conn):
        llm = PluginCreds(
            provider=_match_provider(llm_conn.name) or "openai",
            api_key=_key_from(llm_conn),
            base_url=_cfg(llm_conn).get("base_url") or "",
            model=_cfg(llm_conn).get("model") or "",
        )

    openai_key = (engine_cfg.get("api_key") or settings.OPENAI_API_KEY or "").strip()
    xai_key = (engine_cfg.get("api_key") or settings.XAI_API_KEY or "").strip()
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

    note = ""
    if engine == "xai":
        note = "Speech-to-speech via xAI Grok. STT/TTS plugins unused."
    elif engine == "openai":
        note = "Speech-to-speech via OpenAI Realtime. STT/TTS plugins unused."
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
    )
