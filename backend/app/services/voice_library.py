"""Voice library: every voice the organisation can call with, and the one voice calls use.

- Voices live in the `voices` table: many per provider, many providers. A voice spoken by a
  text-to-speech plugin (Cartesia, ElevenLabs, Telnyx, Deepgram, a custom TTS) needs that
  plugin's key in Connections; its key is never stored here.
- Engine built-in voices (xAI Ara/Rex/..., OpenAI Alloy/...) are listed from ENGINE_BUILTINS,
  never stored.
- The call voice is one choice in the active voice stack: voice_kind ("builtin" | "library")
  and voice_ref (the built-in id or the library row id). Picking a library voice also points
  the stack's TTS at that voice's provider, so the two can never disagree.
- This module is the only writer of voice choices. Every screen (Line setup, Calling,
  Company profile, Connections) goes through its API.
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import Connection, Voice
from app.services.key_validator import identify_provider
from app.services.secret_box import config_get_secret, open_config
from app.services.voice_plugin_plan import (
    _strip_voice,
    engine_of_conn,
    get_active_stack,
    is_voice_placeholder,
    looks_like_api_key,
    set_active_stack,
)

logger = logging.getLogger("voice_library")

TTS_GROUP = "Text-to-Speech"

# How each engine speaks: its own voices, through a TTS plugin, either, or set remotely.
ENGINE_MODES = {"xai": "either", "openai": "native", "livekit": "tts", "modular": "tts", "vapi": "remote", "retell": "remote"}
ENGINE_LABELS = {"xai": "xAI", "openai": "OpenAI Realtime", "livekit": "LiveKit", "modular": "Modular pipeline", "vapi": "Vapi", "retell": "Retell"}
ENGINE_BUILTINS: Dict[str, List[Tuple[str, str]]] = {
    "xai": [
        ("ara", "Ara · female"), ("ara-uk", "Ara · female, British"),
        ("eve", "Eve · female"), ("eve-uk", "Eve · female, British"),
        ("rex", "Rex · male"), ("rex-uk", "Rex · male, British"),
        ("leo", "Leo · male"), ("sal", "Sal · neutral"),
    ],
    "openai": [
        ("alloy", "Alloy"), ("ash", "Ash"), ("ballad", "Ballad"), ("coral", "Coral"),
        ("echo", "Echo"), ("sage", "Sage"), ("shimmer", "Shimmer"), ("verse", "Verse"),
    ],
}
# Voices from these providers are spoken by the engine itself (xAI custom voices), not a plugin.
ENGINE_PROVIDERS = ("xai",)
DEEPGRAM_AURA = [
    "aura-asteria-en", "aura-luna-en", "aura-stella-en", "aura-athena-en", "aura-hera-en",
    "aura-orion-en", "aura-arcas-en", "aura-perseus-en", "aura-angus-en", "aura-orpheus-en",
    "aura-helios-en", "aura-zeus-en",
]
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


class VoiceError(ValueError):
    """A message for the user (bad voice, missing key, voice in use)."""


def provider_of(name: str) -> str:
    """Stable provider key for a TTS connection name."""
    pid = identify_provider(name or "")
    if pid != "custom":
        return pid
    return re.sub(r"[^a-z0-9]+", "-", (name or "custom").lower()).strip("-") or "custom"


def _clean_id(voice_id: Any) -> str:
    vid = _strip_voice(voice_id)
    if not vid or len(vid) < 2:
        raise VoiceError("Paste the voice ID.")
    if looks_like_api_key(vid):
        raise VoiceError("That looks like an API key, not a voice ID. Keys belong in Connections; paste only the voice ID here.")
    return vid[:200]


def guess_provider(voice_id: str) -> str:
    """Only for migrating old data that never recorded its provider."""
    v = voice_id.strip()
    if v.lower().startswith("telnyx."):
        return "telnyx"
    if v.lower().startswith("aura-"):
        return "deepgram"
    if _UUID_RE.match(v):
        return "cartesia"
    if len(v) <= 10:
        return "xai"
    return "elevenlabs"


async def tts_connections(db: AsyncSession) -> Dict[str, Dict[str, Any]]:
    """provider -> {name, connected, row}. A provider with several rows uses one with a key."""
    rows = (await db.execute(select(Connection).where(Connection.group_name == TTS_GROUP))).scalars().all()
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        pid = provider_of(r.name)
        if pid in ENGINE_PROVIDERS:
            continue  # an engine's own voices are listed with the engine, not as a TTS plugin
        has_key = bool(config_get_secret(r.config if isinstance(r.config, dict) else {}, "api_key", "auth_token"))
        if pid not in out or (has_key and not out[pid]["connected"]):
            out[pid] = {"provider": pid, "name": r.name, "connected": has_key, "row": r}
    return out


def _active_engine() -> str:
    return (get_active_stack().get("engine") or "").lower()


def _fits(engine: str, kind: str, provider: str) -> bool:
    mode = ENGINE_MODES.get(engine, "tts")
    if mode == "remote":
        return False
    if kind == "builtin":
        return True  # checked against the engine's own list by the caller
    if provider in ENGINE_PROVIDERS:
        return provider == engine
    return mode in ("tts", "either")


def voice_dict(v: Voice, tts: Dict[str, Dict[str, Any]], engine: str, active_ref: str) -> Dict[str, Any]:
    conn = tts.get(v.provider)
    native = v.provider in ENGINE_PROVIDERS
    status = "ok"
    reason = ""
    if not native and not (conn and conn["connected"]):
        status, reason = "key_missing", f"{(conn or {}).get('name') or v.provider.title()} key missing in Connections"
    elif not _fits(engine, "library", v.provider):
        status, reason = "engine_mismatch", f"{ENGINE_LABELS.get(engine, engine)} can't speak with this voice"
    return {
        "id": v.id,
        "kind": "library",
        "provider": v.provider,
        "providerName": (conn or {}).get("name") or ("xAI" if v.provider == "xai" else v.provider.title()),
        "voiceId": v.voice_id,
        "label": v.label or v.voice_id,
        "origin": v.origin,
        "meta": v.meta or {},
        "status": status,
        "reason": reason,
        "active": v.id == active_ref,
    }


async def active_voice(db: AsyncSession) -> Dict[str, Any]:
    """The call voice with its status: ok (green), missing / engine_mismatch (yellow),
    key_missing / invalid (red)."""
    stack = get_active_stack()
    engine = (stack.get("engine") or "").lower()
    kind = stack.get("voice_kind") or ""
    ref = _strip_voice(stack.get("voice_ref"))
    if ENGINE_MODES.get(engine) == "remote":
        return {"kind": "remote", "status": "ok", "label": f"Set on your {ENGINE_LABELS.get(engine, engine)} assistant", "reason": ""}
    if not kind or not ref:
        return {"kind": "", "status": "missing", "label": "", "reason": "No voice picked yet."}
    if kind == "builtin":
        names = dict(ENGINE_BUILTINS.get(engine, []))
        if ref not in names:
            return {"kind": "builtin", "voiceId": ref, "label": ref, "status": "engine_mismatch",
                    "reason": f"{ENGINE_LABELS.get(engine, engine)} has no built-in voice '{ref}'. Pick one of its voices."}
        return {"kind": "builtin", "voiceId": ref, "label": names[ref], "provider": engine, "status": "ok", "reason": ""}
    row = (await db.execute(select(Voice).where(Voice.id == ref))).scalars().first()
    if not row:
        return {"kind": "library", "status": "missing", "label": "", "reason": "The picked voice was removed. Pick another."}
    return voice_dict(row, await tts_connections(db), engine, ref)


async def engine_voice(db: AsyncSession) -> str:
    """The voice the engine itself speaks with: a built-in id (e.g. "ara-uk") or an
    engine-native library voice (xAI custom voice). "" when a TTS plugin speaks instead."""
    stack = get_active_stack()
    ref = _strip_voice(stack.get("voice_ref"))
    if stack.get("voice_kind") == "builtin":
        return ref
    if stack.get("voice_kind") == "library" and ref:
        row = (await db.execute(select(Voice).where(Voice.id == ref))).scalars().first()
        if row and row.provider in ENGINE_PROVIDERS:
            return row.voice_id
    return ""


async def library(db: AsyncSession) -> Dict[str, Any]:
    """Everything a voice picker needs, for the active engine."""
    stack = get_active_stack()
    engine = (stack.get("engine") or "").lower()
    ref = _strip_voice(stack.get("voice_ref"))
    tts = await tts_connections(db)
    rows = (await db.execute(select(Voice).order_by(Voice.created_at.desc()))).scalars().all()
    voices = [voice_dict(v, tts, engine, ref if stack.get("voice_kind") == "library" else "") for v in rows]
    providers = [
        {"provider": p["provider"], "name": p["name"], "connected": p["connected"],
         "canBrowse": p["provider"] in ("cartesia", "elevenlabs", "deepgram")}
        for p in tts.values()
    ]
    if engine == "xai":
        providers.append({"provider": "xai", "name": "xAI custom voices", "connected": True, "canBrowse": True})
    builtin_ref = ref if stack.get("voice_kind") == "builtin" else ""
    return {
        "engine": engine,
        "engineLabel": ENGINE_LABELS.get(engine, engine or "Not configured"),
        "mode": ENGINE_MODES.get(engine, "tts"),
        "builtins": [{"kind": "builtin", "voiceId": vid, "label": label, "active": vid == builtin_ref}
                     for vid, label in ENGINE_BUILTINS.get(engine, [])],
        "providers": providers,
        "voices": voices,
        "active": await active_voice(db),
    }


async def add_voice(db: AsyncSession, provider: str, voice_id: Any, label: str = "", origin: str = "pasted",
                    meta: Optional[Dict[str, Any]] = None) -> Voice:
    """Save a voice (or return the one already saved for this provider + ID). Caller commits."""
    vid = _clean_id(voice_id)
    prov = (provider or "").strip().lower()
    if not prov:
        raise VoiceError("Pick which provider this voice is from.")
    tts = await tts_connections(db)
    if prov not in tts and prov not in ENGINE_PROVIDERS:
        raise VoiceError(f"No '{provider}' text-to-speech connection. Add it in Connections → Text-to-Speech first.")
    existing = (await db.execute(select(Voice).where(Voice.provider == prov, Voice.voice_id == vid))).scalars().first()
    if existing:
        if label and not existing.label:
            existing.label = label[:120]
        return existing
    row = Voice(id=f"v_{uuid.uuid4().hex[:10]}", provider=prov, voice_id=vid, label=(label or vid)[:120],
                origin=origin, meta=meta or {})
    db.add(row)
    await db.flush()
    return row


async def remove_voice(db: AsyncSession, voice_ref: str) -> None:
    stack = get_active_stack()
    if stack.get("voice_kind") == "library" and stack.get("voice_ref") == voice_ref:
        raise VoiceError("This is the call voice. Pick another voice first, then remove it.")
    await db.execute(delete(Voice).where(Voice.id == voice_ref))


async def set_active(db: AsyncSession, kind: str, ref: str) -> Dict[str, Any]:
    """Make a voice the call voice. Library voices also switch the stack's TTS to their provider."""
    engine = _active_engine()
    ref = _strip_voice(ref)
    if not ref or is_voice_placeholder(ref):
        raise VoiceError("Pick a voice first.")
    if ENGINE_MODES.get(engine) == "remote":
        raise VoiceError(f"The voice is set on your {ENGINE_LABELS.get(engine, engine)} assistant, not here.")
    if kind == "builtin":
        if ref not in dict(ENGINE_BUILTINS.get(engine, [])):
            raise VoiceError(f"{ENGINE_LABELS.get(engine, engine or 'This engine')} has no built-in voice '{ref}'.")
        patch = {"voice_kind": "builtin", "voice_ref": ref}
        if engine == "xai":
            patch["tts"] = f"xAI built-in ({ref})"
        await set_active_stack(patch)
        return await active_voice(db)
    row = (await db.execute(select(Voice).where(Voice.id == ref))).scalars().first()
    if not row:
        raise VoiceError("That voice is no longer saved.")
    info = voice_dict(row, await tts_connections(db), engine, ref)
    if info["status"] != "ok":
        raise VoiceError(info["reason"])
    patch = {"voice_kind": "library", "voice_ref": row.id}
    if row.provider not in ENGINE_PROVIDERS:
        conn = (await tts_connections(db)).get(row.provider)
        patch["tts"] = conn["name"]
        model = (open_config(conn["row"].config) if isinstance(conn["row"].config, dict) else {}).get("model")
        if model:
            patch["tts_model"] = model
    await set_active_stack(patch)
    return await active_voice(db)


async def follow_tts_switch(db: AsyncSession, tts_name: str) -> None:
    """The stack's TTS provider was changed elsewhere: use that provider's most recent voice,
    or leave the pick for the user (the pill turns yellow)."""
    prov = provider_of(tts_name or "")
    stack = get_active_stack()
    if stack.get("voice_kind") == "library":
        cur = (await db.execute(select(Voice).where(Voice.id == stack.get("voice_ref")))).scalars().first()
        if cur and cur.provider == prov:
            return
    latest = (await db.execute(
        select(Voice).where(Voice.provider == prov).order_by(Voice.created_at.desc()).limit(1)
    )).scalars().first()
    if latest:
        try:
            await set_active(db, "library", latest.id)
            return
        except VoiceError:
            pass
    if stack.get("voice_kind") == "library":
        await set_active_stack({"voice_kind": "", "voice_ref": ""})


async def catalog(db: AsyncSession, provider: str) -> List[Dict[str, Any]]:
    """Voices available at the provider, to add to the library. Needs the provider's key."""
    prov = (provider or "").lower()
    if prov == "deepgram":
        return [{"voiceId": v, "label": v.replace("aura-", "").replace("-en", "").title() + " (Aura)"} for v in DEEPGRAM_AURA]
    if prov == "xai":
        from app.services.voice_clone import _orchestration_conn, list_xai_custom_voices, xai_api_key

        remote, err = await list_xai_custom_voices(xai_api_key(await _orchestration_conn(db)))
        if err and not remote:
            raise VoiceError(f"Could not list xAI voices: {err}")
        return [{"voiceId": v.get("voice_id"), "label": v.get("name") or v.get("voice_id")} for v in remote if v.get("voice_id")]
    conn = (await tts_connections(db)).get(prov)
    key = config_get_secret(conn["row"].config, "api_key", "auth_token") if conn and isinstance(conn["row"].config, dict) else ""
    if not key:
        raise VoiceError(f"Save your {(conn or {}).get('name') or prov.title()} key in Connections first.")
    async with httpx.AsyncClient(timeout=12.0) as client:
        if prov == "cartesia":
            res = await client.get("https://api.cartesia.ai/voices", headers={"X-API-Key": key, "Cartesia-Version": "2024-11-13"})
            res.raise_for_status()
            data = res.json()
            items = data.get("data") if isinstance(data, dict) else data
            return [{"voiceId": v.get("id"), "label": v.get("name") or v.get("id"),
                     "meta": {"language": v.get("language"), "description": (v.get("description") or "")[:120]}}
                    for v in (items or []) if isinstance(v, dict) and v.get("id")]
        if prov == "elevenlabs":
            res = await client.get("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": key})
            res.raise_for_status()
            return [{"voiceId": v.get("voice_id"), "label": v.get("name") or v.get("voice_id"),
                     "meta": {k: (v.get("labels") or {}).get(k) for k in ("gender", "accent", "age")}}
                    for v in (res.json().get("voices") or []) if v.get("voice_id")]
    raise VoiceError("This provider has no voice list here. Paste the voice ID instead.")


async def migrate_legacy(db: AsyncSession) -> None:
    """One-time: fold the old per-screen voice fields into the library and the stack.
    Runs at startup; does nothing once the stack has a voice choice."""
    from app.config import settings

    stack = get_active_stack()
    if "voice_kind" in stack:
        return
    rows = (await db.execute(select(Connection))).scalars().all()
    tts = await tts_connections(db)
    engine = (stack.get("engine") or "").lower()
    added: Dict[str, Voice] = {}

    async def _add(provider: str, vid: Any, label: str = "") -> Optional[Voice]:
        vid = _strip_voice(vid)
        if not vid or looks_like_api_key(vid) or vid.lower().replace("-uk", "") in dict(ENGINE_BUILTINS["xai"]):
            return None
        prov = provider if (provider in tts or provider in ENGINE_PROVIDERS) else guess_provider(vid)
        if prov not in tts and prov not in ENGINE_PROVIDERS:
            return None
        try:
            row = await add_voice(db, prov, vid, label, origin="migrated")
        except VoiceError:
            return None
        added[vid] = row
        return row

    for r in rows:
        cfg = open_config(r.config) if isinstance(r.config, dict) else {}
        if r.group_name == TTS_GROUP:
            await _add(provider_of(r.name), cfg.get("voice_id"), cfg.get("voice_name") or "")
        if r.group_name == "Voice Orchestration":
            for v in cfg.get("custom_voices") or []:
                if isinstance(v, dict):
                    await _add(str(v.get("provider") or "").lower(), v.get("voice_id") or v.get("id"), v.get("name") or "")
            await _add("", cfg.get("cloned_voice_id"), cfg.get("cloned_voice_label") or "")
    await _add("cartesia", getattr(settings, "CARTESIA_VOICE_ID", None))
    await _add("elevenlabs", getattr(settings, "ELEVENLABS_VOICE_ID", None))

    engine_row = next((r for r in rows if r.group_name == "Voice Orchestration" and engine_of_conn(r) == engine), None)
    engine_cfg = open_config(engine_row.config) if engine_row is not None and isinstance(engine_row.config, dict) else {}
    legacy = _strip_voice(engine_cfg.get("voice_name"))
    tts_label = stack.get("tts") or ""
    m = re.search(r"xai built-in \(([^)]+)\)", tts_label, re.I)
    if engine == "xai" and m and not legacy:
        legacy = m.group(1).strip()
    patch = {"voice_kind": "", "voice_ref": ""}
    if legacy and legacy.lower() in dict(ENGINE_BUILTINS.get(engine, [])):
        patch = {"voice_kind": "builtin", "voice_ref": legacy.lower()}
    elif legacy and legacy in added:
        patch = {"voice_kind": "library", "voice_ref": added[legacy].id}
    elif ENGINE_MODES.get(engine) == "tts":
        # A plugin-only engine spoke with its TTS row's voice: keep that one.
        prov = provider_of(tts_label)
        same = [v for v in added.values() if v.provider == prov]
        if same:
            patch = {"voice_kind": "library", "voice_ref": same[0].id}
    await db.commit()
    await set_active_stack(patch)
    logger.info(f"[VoiceLibrary] Migrated {len(added)} saved voice(s); call voice {patch or 'not set'}.")
