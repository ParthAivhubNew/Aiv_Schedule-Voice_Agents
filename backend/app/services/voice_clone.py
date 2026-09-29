"""The call engine's settings row and xAI custom voices.

Voices themselves live in the voice library (services/voice_library.py)."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.models.models import Connection

logger = logging.getLogger("voice_clone")


async def _orchestration_conn(db: AsyncSession) -> Optional[Connection]:
    """The engine row for the active engine (same pick as the live call plan)."""
    from app.services.voice_plugin_plan import get_active_stack, pick_engine_conn

    res = await db.execute(select(Connection).where(Connection.group_name == "Voice Orchestration"))
    return pick_engine_conn(list(res.scalars().all()), get_active_stack().get("engine") or "")


def _cfg(conn: Optional[Connection]) -> Dict[str, Any]:
    if conn and isinstance(conn.config, dict):
        return dict(conn.config)
    return {}


def xai_api_key(conn: Optional[Connection] = None) -> str:
    from app.services.secret_box import config_get_secret
    cfg = _cfg(conn)
    return (config_get_secret(cfg, "api_key", "apiKey", "auth_token") or settings.XAI_API_KEY or "").strip()


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
