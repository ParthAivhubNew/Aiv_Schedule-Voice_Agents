"""The AI every company's Post scheduler uses, chosen by staff in the admin portal.

Stored once for the whole platform (app_settings "platform_ai"). Every company, Aivhub
included, writes and draws with this choice; no company can see or change it. Keys live only
in the platform record (see llm_gateway / post_writer). Each kind (text, image) has a main
provider and an optional backup: when the main fails and a backup is filled in, the backup is
used straight away; an empty backup means the main alone is used.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple, TypeVar

logger = logging.getLogger("platform_ai")

KEY = "platform_ai"
HEALTH_KEY = "platform_ai_health"
FIELDS = ("textProvider", "textModel", "imageProvider", "imageModel",
          "textBackupProvider", "textBackupModel", "imageBackupProvider", "imageBackupModel")
TEXT_PROVIDERS = ["openai", "anthropic", "deepseek", "groq", "gemini", "xai"]
IMAGE_PROVIDERS = ["openai", "fal", "stability", "pollinations"]
KINDS = ("text", "image")
SLOTS = ("main", "backup")

T = TypeVar("T")


class AIUnavailable(RuntimeError):
    """The chosen AI could not do the work (no key, provider error, empty answer)."""


def _key_for(scope: str) -> str:
    s = (scope or "scheduler").strip().lower()
    return "platform_ai" if s == "scheduler" else f"platform_ai_{s}"


def _health_key_for(scope: str) -> str:
    s = (scope or "scheduler").strip().lower()
    return "platform_ai_health" if s == "scheduler" else f"platform_ai_{s}_health"


async def get(db, scope: str = "scheduler") -> Dict[str, str]:
    from app.services.credits import _get_doc

    stored = await _get_doc(db, _key_for(scope))
    return {f: str(stored.get(f) or "").strip() for f in FIELDS}


async def put(db, patch: Dict[str, Any], scope: str = "scheduler") -> Dict[str, str]:
    from app.services.credits import _put_doc

    current = await get(db, scope)
    for f in FIELDS:
        if f in patch and patch[f] is not None:
            current[f] = str(patch[f]).strip()[:120]
    for f in ("textProvider", "textBackupProvider"):
        if current[f] and current[f] not in TEXT_PROVIDERS:
            raise ValueError("Pick one of the writing providers listed.")
    for f in ("imageProvider", "imageBackupProvider"):
        if current[f] and current[f] not in IMAGE_PROVIDERS:
            raise ValueError("Pick one of the image providers listed.")
    for kind in KINDS:
        if not current[f"{kind}BackupProvider"]:
            current[f"{kind}BackupModel"] = ""
    await _put_doc(db, _key_for(scope), current)
    return current


def _field(kind: str, slot: str, part: str) -> str:
    return f"{kind}{'Backup' if slot == 'backup' else ''}{part}"


async def choice(db, kind: str, slot: str = "main", scope: str = "scheduler") -> Tuple[Optional[str], Optional[str]]:
    """(provider, model) for text or image, main or backup. None = not set."""
    chosen = await get(db, scope)
    return (chosen[_field(kind, slot, "Provider")] or None, chosen[_field(kind, slot, "Model")] or None)


async def has_backup(db, kind: str, scope: str = "scheduler") -> bool:
    return bool((await get(db, scope))[_field(kind, "backup", "Provider")])


# ── Health: the last success and error of each provider slot, for the admin portal ─────────
async def health(db, scope: str = "scheduler") -> Dict[str, Any]:
    from app.services.credits import _get_doc

    return await _get_doc(db, _health_key_for(scope))


async def note(kind: str, slot: str, error: Optional[str] = None, scope: str = "scheduler") -> None:
    """Record how the last call went. Own session: never disturbs the caller's transaction."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services.credits import _get_doc, _put_doc

    try:
        with system_scope():
            async with AsyncSessionLocal() as db:
                doc = await _get_doc(db, _health_key_for(scope))
                row = dict((doc.get(kind) or {}).get(slot) or {})
                now = datetime.utcnow().isoformat(timespec="seconds")
                if error:
                    row.update({"lastError": str(error)[:500], "lastErrorAt": now})
                else:
                    row["lastOkAt"] = now
                doc.setdefault(kind, {})[slot] = row
                await _put_doc(db, _health_key_for(scope), doc)
                await db.commit()
    except Exception as err:  # health is a convenience; the work itself matters more
        logger.warning(f"[platform_ai] could not record health: {err}")
    if error:
        from app.services import ai_errors

        await ai_errors.provider_failed(kind, slot, str(error))


async def run_with_backup(db, kind: str, attempt: Callable[[str], Awaitable[T]], scope: str = "scheduler") -> T:
    """Run attempt("main"); if it fails and a backup is set, run attempt("backup").
    attempt raises (AIUnavailable or anything else) on failure. The last error is re-raised."""
    try:
        out = await attempt("main")
    except Exception as err:
        await note(kind, "main", str(err) or err.__class__.__name__, scope=scope)
        if not await has_backup(db, kind, scope=scope):
            raise
        logger.warning(f"[platform_ai] {scope}/{kind} main failed ({err}); using the backup")
        try:
            out = await attempt("backup")
        except Exception as err2:
            await note(kind, "backup", str(err2) or err2.__class__.__name__, scope=scope)
            raise
        await note(kind, "backup", scope=scope)
        return out
    await note(kind, "main", scope=scope)
    return out


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
    from app.services import assistant_options

    cat = await catalogue(db)
    live = await assistant_options.telnyx_lists()
    voices = [{"id": c["voice"], "label": c["name"], "sample": "", "private": True, "provider": "Your company's voices",
               "engine": "Clone", "language": c["language"], "gender": c["gender"]}
              for c in await assistant_options.clones(db, org_id) if c.get("voice")]
    voices += [{"id": v["id"], "label": v["label"], "sample": v["sample"], "private": bool(v["org"]), "provider": "Picked by OutReach",
                "engine": assistant_options.voice_engine(v["id"]), "language": "", "gender": ""} for v in cat["voices"] if not v["org"] or v["org"] == org_id]
    seen = {v["id"] for v in voices}
    voices += [v for v in live["voices"] if v["id"] not in seen]
    models = list(cat["models"]) + [m for m in live["models"] if m["id"] not in {x["id"] for x in cat["models"]}]
    return {"voices": voices, "models": models, "stt": live["stt"]}


async def put_catalogue(db, voices: Any, models: Any) -> Dict[str, list]:
    from app.services.credits import _put_doc

    data = {"voices": _clean_items(voices, True), "models": _clean_items(models, False)}
    await _put_doc(db, CATALOGUE_KEY, data)
    return data
