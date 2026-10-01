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


# ── Voices and models clients may pick for their call assistant (Agent Studio) ──────────────
CATALOGUE_KEY = "voice_catalogue"
MAX_ITEMS = 200


def _clean_items(items: Any, with_sample: bool) -> list:
    out, seen = [], set()
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        ident = str(it.get("id") or "").strip()[:160]
        if not ident or ident in seen:
            continue
        seen.add(ident)
        row = {"id": ident, "label": str(it.get("label") or ident).strip()[:80]}
        if with_sample:
            sample = str(it.get("sample") or "").strip()[:500]
            row["sample"] = sample if sample.startswith("https://") else ""
            # A client's own cloned voice: only that organisation sees it ("" = everyone).
            row["org"] = str(it.get("org") or "").strip()[:80]
        out.append(row)
    return out[:MAX_ITEMS]


async def catalogue(db) -> Dict[str, list]:
    """{"voices": [{id, label, sample}], "models": [{id, label}]}: Telnyx voice and model names."""
    from app.services.credits import _get_doc

    stored = await _get_doc(db, CATALOGUE_KEY)
    return {"voices": _clean_items(stored.get("voices"), True), "models": _clean_items(stored.get("models"), False)}


async def catalogue_for_org(db, org_id: str) -> Dict[str, list]:
    """What one organisation may pick: shared voices plus its own private (cloned) ones. Which
    organisation owns a private voice is never shown to clients."""
    cat = await catalogue(db)
    voices = [{"id": v["id"], "label": v["label"], "sample": v["sample"], "private": bool(v["org"])}
              for v in cat["voices"] if not v["org"] or v["org"] == org_id]
    return {"voices": voices, "models": cat["models"]}


async def put_catalogue(db, voices: Any, models: Any) -> Dict[str, list]:
    from app.services.credits import _put_doc

    data = {"voices": _clean_items(voices, True), "models": _clean_items(models, False)}
    await _put_doc(db, CATALOGUE_KEY, data)
    return data
