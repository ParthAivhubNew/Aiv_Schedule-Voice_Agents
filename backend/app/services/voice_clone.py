"""Clone and persist custom voices for the live voice plugin (xAI Grok + ElevenLabs)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.models.models import Connection

logger = logging.getLogger("voice_clone")

XAI_BUILTIN = {"ara", "eve", "rex", "leo", "sal", "leo"}


async def _orchestration_conn(db: AsyncSession) -> Optional[Connection]:
    res = await db.execute(select(Connection).where(Connection.group_name == "Voice Orchestration"))
    return res.scalars().first()


def _cfg(conn: Optional[Connection]) -> Dict[str, Any]:
    if conn and isinstance(conn.config, dict):
        return dict(conn.config)
    return {}


def xai_api_key(conn: Optional[Connection] = None) -> str:
    from app.services.secret_box import config_get_secret
    cfg = _cfg(conn)
    return (config_get_secret(cfg, "api_key", "apiKey", "auth_token") or settings.XAI_API_KEY or "").strip()


async def elevenlabs_api_key(db: AsyncSession) -> str:
    from app.services.secret_box import config_get_secret
    if settings.ELEVENLABS_API_KEY:
        return settings.ELEVENLABS_API_KEY.strip()
    res = await db.execute(select(Connection))
    for c in res.scalars().all():
        group = (c.group_name or "").lower()
        name = (c.name or "").lower()
        if "text-to-speech" in group or "eleven" in name:
            key = config_get_secret(_cfg(c), "api_key", "apiKey")
            if key:
                return key
    return ""


def stored_custom_voices(conn: Optional[Connection]) -> List[Dict[str, Any]]:
    voices = _cfg(conn).get("custom_voices") or []
    return [v for v in voices if isinstance(v, dict) and v.get("voice_id")]


async def save_orchestration_config(db: AsyncSession, updates: Dict[str, Any]) -> Dict[str, Any]:
    from app.services.secret_box import seal_config
    conn = await _orchestration_conn(db)
    cfg = _cfg(conn)
    cfg.update({k: v for k, v in updates.items() if v is not None})
    cfg = seal_config(cfg)
    if conn:
        conn.config = cfg
        conn.status = "connected"
    else:
        import uuid
        conn = Connection(
            id=f"conn_{uuid.uuid4().hex[:6]}",
            group_name="Voice Orchestration",
            name="xAI Realtime",
            status="connected",
            config=cfg,
        )
        db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return cfg


def upsert_voice_list(existing: List[Dict[str, Any]], voice: Dict[str, Any]) -> List[Dict[str, Any]]:
    vid = str(voice.get("voice_id") or "")
    out = [v for v in existing if str(v.get("voice_id")) != vid]
    out.insert(0, voice)
    return out[:40]


async def list_xai_custom_voices(api_key: str) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    if not api_key or not api_key.startswith("xai-"):
        return [], None
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            res = await client.get(
                "https://api.x.ai/v1/custom-voices",
                headers={"Authorization": f"Bearer {api_key}"},
                params={"limit": 50},
            )
        if res.status_code == 200:
            data = res.json() if res.content else {}
            raw = data.get("voices") if isinstance(data, dict) else data
            voices = []
            for v in raw or []:
                if isinstance(v, dict) and v.get("voice_id"):
                    voices.append({
                        "voice_id": v["voice_id"],
                        "name": v.get("name") or v["voice_id"],
                        "provider": "xai",
                        "created_at": v.get("created_at"),
                    })
            return voices, None
        return [], f"xAI list failed HTTP {res.status_code}: {res.text[:180]}"
    except Exception as err:
        logger.warning(f"xAI custom-voices list failed: {err}")
        return [], str(err)


async def clone_on_xai(
    api_key: str,
    audio: bytes,
    filename: str,
    content_type: str,
    name: str,
) -> Dict[str, Any]:
    files = {"file": (filename or "reference.webm", audio, content_type or "application/octet-stream")}
    data = {
        "name": name or "My voice",
        "language": "en",
        "use_case": "conversational",
        "tone": "warm",
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        res = await client.post(
            "https://api.x.ai/v1/custom-voices",
            headers={"Authorization": f"Bearer {api_key}"},
            files=files,
            data=data,
        )
    if res.status_code not in (200, 201):
        raise RuntimeError(f"xAI clone HTTP {res.status_code}: {res.text[:400]}")
    body = res.json() if res.content else {}
    voice_id = body.get("voice_id")
    if not voice_id:
        raise RuntimeError(f"xAI clone returned no voice_id: {body}")
    return {
        "voice_id": voice_id,
        "name": body.get("name") or name,
        "provider": "xai",
        "created_at": body.get("created_at") or datetime.now(timezone.utc).isoformat(),
    }


async def clone_on_elevenlabs(api_key: str, audio: bytes, filename: str, content_type: str, name: str) -> Dict[str, Any]:
    files = {"files": (filename or "reference.webm", audio, content_type or "application/octet-stream")}
    data = {"name": name or "My voice", "description": "AIVHub cloned operator voice"}
    async with httpx.AsyncClient(timeout=90.0) as client:
        res = await client.post(
            "https://api.elevenlabs.io/v1/voices/add",
            headers={"xi-api-key": api_key},
            files=files,
            data=data,
        )
    if res.status_code not in (200, 201):
        raise RuntimeError(f"ElevenLabs clone HTTP {res.status_code}: {res.text[:400]}")
    body = res.json() if res.content else {}
    voice_id = body.get("voice_id")
    if not voice_id:
        raise RuntimeError(f"ElevenLabs clone returned no voice_id: {body}")
    return {
        "voice_id": voice_id,
        "name": name or "My voice",
        "provider": "elevenlabs",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
