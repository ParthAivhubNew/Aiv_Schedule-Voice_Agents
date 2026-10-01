"""The AI every client organisation's Post scheduler uses, chosen by staff in the admin portal.

Stored once for the whole platform (app_settings "platform_ai"). An empty field keeps the old
behaviour ("auto": the first key saved by OutReach). OutReach's own organisation keeps its own
choice in its Post scheduler settings.
"""
from __future__ import annotations

from typing import Any, Dict

KEY = "platform_ai"
FIELDS = ("textProvider", "textModel", "imageProvider", "imageModel")
TEXT_PROVIDERS = ["openai", "anthropic", "deepseek", "groq", "gemini", "xai"]
IMAGE_PROVIDERS = ["openai", "fal", "stability", "pollinations"]


async def get(db) -> Dict[str, str]:
    from app.services.credits import _get_doc

    stored = await _get_doc(db, KEY)
    return {f: str(stored.get(f) or "").strip() for f in FIELDS}


async def put(db, patch: Dict[str, Any]) -> Dict[str, str]:
    from app.services.credits import _put_doc

    current = await get(db)
    for f in FIELDS:
        if f in patch and patch[f] is not None:
            current[f] = str(patch[f]).strip()[:120]
    if current["textProvider"] and current["textProvider"] not in TEXT_PROVIDERS:
        raise ValueError("Pick one of the writing providers listed.")
    if current["imageProvider"] and current["imageProvider"] not in IMAGE_PROVIDERS:
        raise ValueError("Pick one of the image providers listed.")
    await _put_doc(db, KEY, current)
    return current


def applies_here() -> bool:
    """True for client organisations (the platform's choice is theirs)."""
    from app.core.auth_middleware import platform_org
    from app.core.tenancy import current_org

    return current_org() != platform_org()
