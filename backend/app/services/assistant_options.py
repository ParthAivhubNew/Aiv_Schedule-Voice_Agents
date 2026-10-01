"""Everything a client can set on their Telnyx AI Assistant, without opening Telnyx.

- Lists: the models, voices and speech-to-text engines Telnyx offers, read live from Telnyx with
  our platform key and kept in memory for a few hours. "" in any choice means "Telnyx default":
  we leave the field out and Telnyx uses its own; after each sync we read back what it chose.
- MINE (per user, on VoiceAssistant.settings): how their assistant speaks and listens.
- COMPANY (on the company profile's studio["assistant"]): how every call behaves.
- Voice clones: a company's own voices, free. We keep each sample so a clone Telnyx lets expire
  is made again from it before the next call.

Field names follow docs/telnyx-assistant-capabilities.md.
"""
from __future__ import annotations

import logging
import os
import re
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger("assistant_options")

# ── Live lists from Telnyx ──────────────────────────────────────────────────
LIST_TTL = 6 * 3600
VOICE_PROVIDERS = ["telnyx", "aws", "azure", "minimax", "resemble", "xai", "soniox"]  # ElevenLabs needs its own key
_lists: Dict[str, Any] = {"at": 0.0, "data": None}


def _price(pricing: Any) -> str:
    if not isinstance(pricing, dict):
        return ""
    parts = [f"{k} {pricing[k]}" for k in ("prompt", "completion") if pricing.get(k) not in (None, "")]
    unit = " ".join(str(pricing.get(k) or "") for k in ("currency", "unit")).strip()
    return ", ".join(parts) + (f" ({unit})" if parts and unit else "")


def _voice_id(provider: str, raw: str) -> str:
    raw = str(raw or "").strip()
    if not raw or "." in raw:
        return raw  # already the full id, e.g. Telnyx.KokoroTTS.af_heart
    return f"{provider}.{raw}"


async def _fetch() -> Dict[str, list]:
    from app.services.telnyx_client import TelnyxClient, platform_key

    client = TelnyxClient(platform_key())
    out: Dict[str, list] = {"models": [], "voices": [], "stt": []}
    try:
        rows = (await client._req("GET", "/ai/openai/models")).get("data") or []
        rows = [m for m in rows if isinstance(m, dict) and m.get("id") and m.get("task", "text-generation") == "text-generation"]
        if any(m.get("recommended_for_assistants") for m in rows):
            rows = [m for m in rows if m.get("recommended_for_assistants")]
        out["models"] = [{"id": str(m["id"]), "label": str(m["id"]), "price": _price(m.get("pricing")),
                          "tier": str(m.get("tier") or "")} for m in rows]
    except Exception as err:
        logger.warning(f"[assistant-options] models: {err}")
    for provider in VOICE_PROVIDERS:
        try:
            body = await client._req("GET", "/text-to-speech/voices", params={"provider": provider})
            for v in body.get("voices") or body.get("data") or []:
                vid = _voice_id(str(v.get("provider") or provider), v.get("voice_id") or v.get("id"))
                if vid:
                    out["voices"].append({"id": vid, "label": str(v.get("name") or vid), "provider": provider,
                                          "language": str(v.get("language") or ""), "gender": str(v.get("gender") or ""),
                                          "sample": "", "private": False})
        except Exception as err:
            logger.warning(f"[assistant-options] voices {provider}: {err}")
    try:
        body = await client._req("GET", "/speech-to-text/providers", params={"service_type": "ai_assistant"})
        for p in body.get("data") or []:
            model = str(p.get("model") or "")
            if not model:
                continue
            mid = model if "/" in model else f"{p.get('provider')}/{model}"
            langs: List[str] = []
            for st in p.get("service_types") or []:
                if st.get("type") == "ai_assistant":
                    langs = [str(x) for x in st.get("languages") or []]
            out["stt"].append({"id": mid, "label": mid, "languages": langs})
    except Exception as err:
        logger.warning(f"[assistant-options] speech-to-text: {err}")
    return out


async def telnyx_lists(force: bool = False) -> Dict[str, list]:
    """{"models", "voices", "stt"} as Telnyx offers them now. Never raises: on a failure the last
    good lists (or empty ones) come back, and choosing "Telnyx default" always works."""
    fresh = _lists["data"] is not None and time.monotonic() - _lists["at"] < LIST_TTL
    if fresh and not force:
        return _lists["data"]
    try:
        data = await _fetch()
    except Exception as err:  # no platform key yet
        logger.info(f"[assistant-options] lists unavailable: {err}")
        return _lists["data"] or {"models": [], "voices": [], "stt": []}
    if data["models"] or data["voices"] or data["stt"]:
        _lists.update(at=time.monotonic(), data=data)
    return data if data["models"] or data["voices"] or data["stt"] else (_lists["data"] or data)


# ── Settings ────────────────────────────────────────────────────────────────
NOISE = ["", "aicoustics", "krisp", "deepfilternet", "disabled"]
BACKGROUND = ["", "office"]
KEYTERM_MODELS = ("deepgram/nova-3", "deepgram/flux")

MINE: Dict[str, Any] = {
    "voiceSpeed": 1.0,  # 0.25-2.0
    "expressive": False,  # Telnyx Ultra voices: laughs, emotion
    "background": "",  # "" silence, "office"
    "backgroundVolume": 0.5,
    "sttModel": "",  # "" = Telnyx default
    "language": "",  # "" = detect
}
COMPANY: Dict[str, Any] = {
    "speaksFirst": True,  # False: wait for the other person to speak
    "interruptions": True,
    "noGreetingInterrupt": False,
    "idleReplySecs": 10,  # silence before "are you still there?"
    "idleHangupSecs": 0,  # 0 = Telnyx default
    "fallbackNumber": "",  # if the assistant fails, send the call here
    "transfers": [],  # [{name, number}] people the assistant may put the caller through to
    "textCaller": False,  # may send the caller a text during the call
    "keyterms": "",  # words to recognise: names, brands
    "noise": "",  # "" = Telnyx default
    "keepData": True,  # Telnyx keeps the conversation history and insights
}
_E164 = re.compile(r"^\+[1-9]\d{6,14}$")


class OptionError(ValueError):
    pass


def _num(v: Any, lo: float, hi: float, default: float) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return min(max(f, lo), hi)


def _phone(v: Any, what: str) -> str:
    n = re.sub(r"[\s()-]", "", str(v or ""))
    if n and not _E164.match(n):
        raise OptionError(f"{what}: use international format, e.g. +447700900123.")
    return n


def clean_mine(patch: Dict[str, Any], current: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    out = {**MINE, **{k: v for k, v in (current or {}).items() if k in MINE}}
    p = patch or {}
    if "voiceSpeed" in p:
        out["voiceSpeed"] = round(_num(p["voiceSpeed"], 0.25, 2.0, 1.0), 2)
    if "expressive" in p:
        out["expressive"] = bool(p["expressive"])
    if "background" in p:
        out["background"] = p["background"] if p["background"] in BACKGROUND else ""
    if "backgroundVolume" in p:
        out["backgroundVolume"] = round(_num(p["backgroundVolume"], 0.1, 1.0, 0.5), 2)
    for k in ("sttModel", "language"):
        if k in p:
            out[k] = str(p[k] or "").strip()[:80]
    return out


def clean_company(patch: Dict[str, Any], current: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    out = {**COMPANY, **{k: v for k, v in (current or {}).items() if k in COMPANY}}
    p = patch or {}
    for k in ("speaksFirst", "interruptions", "noGreetingInterrupt", "textCaller", "keepData"):
        if k in p:
            out[k] = bool(p[k])
    if "idleReplySecs" in p:
        out["idleReplySecs"] = int(_num(p["idleReplySecs"], 0, 600, 10))
    if "idleHangupSecs" in p:
        secs = int(_num(p["idleHangupSecs"], 0, 14400, 0))
        out["idleHangupSecs"] = 0 if secs == 0 else max(secs, 10)
    if "fallbackNumber" in p:
        out["fallbackNumber"] = _phone(p["fallbackNumber"], "Fallback number")
    if "transfers" in p:
        rows = p["transfers"] if isinstance(p["transfers"], list) else []
        out["transfers"] = [{"name": str(r.get("name") or "").strip()[:60] or "Team",
                             "number": _phone(r.get("number"), "Transfer number")}
                            for r in rows[:10] if isinstance(r, dict) and str(r.get("number") or "").strip()]
    if "keyterms" in p:
        out["keyterms"] = ", ".join(t.strip()[:60] for t in str(p["keyterms"] or "").split(",") if t.strip())[:1000]
    if "noise" in p:
        out["noise"] = p["noise"] if p["noise"] in NOISE else ""
    return out


def company_of(studio: Any) -> Dict[str, Any]:
    return clean_company({}, (studio or {}).get("assistant") if isinstance(studio, dict) else {})


# ── What goes to Telnyx ─────────────────────────────────────────────────────
def apply(payload: Dict[str, Any], voice: str, mine: Dict[str, Any], company: Dict[str, Any]) -> Dict[str, Any]:
    """Adds the user's and company's choices to an assistant payload. Anything left at "Telnyx
    default" is left out, so Telnyx picks."""
    mine, company = clean_mine({}, mine), clean_company({}, company)
    if voice:
        vs: Dict[str, Any] = {"voice": voice}
        if mine["voiceSpeed"] != 1.0:
            vs["voice_speed"] = mine["voiceSpeed"]
        if mine["expressive"] and voice.startswith("Telnyx.Ultra."):
            vs["expressive_mode"] = True
        if mine["background"]:
            vs["background_audio"] = {"type": "predefined_media", "value": mine["background"], "volume": mine["backgroundVolume"]}
        payload["voice_settings"] = vs
    tr: Dict[str, Any] = {}
    if mine["sttModel"]:
        tr["model"] = mine["sttModel"]
    if mine["language"]:
        tr["language"] = mine["language"]
    if company["keyterms"] and mine["sttModel"] in KEYTERM_MODELS:
        tr["settings"] = {"keyterm": company["keyterms"]}
    if tr:
        payload["transcription"] = tr
    if not company["speaksFirst"]:
        payload["greeting"] = ""
    payload["interruption_settings"] = {"enable": company["interruptions"],
                                        "disable_greeting_interruption": company["noGreetingInterrupt"]}
    tel = payload.setdefault("telephony_settings", {})
    tel["user_idle_reply_secs"] = company["idleReplySecs"]
    if company["idleHangupSecs"]:
        tel["user_idle_timeout_secs"] = company["idleHangupSecs"]
    if company["fallbackNumber"]:
        tel["fallback_destination"] = company["fallbackNumber"]
    if company["noise"]:
        tel["noise_suppression"] = company["noise"]
    payload["privacy_settings"] = {"data_retention": company["keepData"]}
    tools = payload.setdefault("tools", [])
    if company["transfers"]:
        tools.append({"type": "transfer", "transfer": {
            "from": "{{telnyx_agent_target}}",  # the number this call is on
            "targets": [{"name": t["name"], "to": t["number"]} for t in company["transfers"]]}})
    if company["textCaller"]:
        tools.append({"type": "send_message", "send_message": {}})
    return payload


def effective(assistant: Dict[str, Any]) -> Dict[str, str]:
    """What Telnyx is really using, read back from the assistant (fills in "Telnyx default")."""
    a = assistant if isinstance(assistant, dict) else {}
    return {"model": str(a.get("model") or ""),
            "voice": str((a.get("voice_settings") or {}).get("voice") or ""),
            "sttModel": str((a.get("transcription") or {}).get("model") or "")}


# ── Voice clones (free) ─────────────────────────────────────────────────────
CLONE_TYPES = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".ogg": "audio/ogg", ".m4a": "audio/mp4"}
CLONE_MAX_BYTES = 5 * 1024 * 1024
MAX_CLONES = 20
GENDERS = ("male", "female", "neutral")


def _clones_key(org_id: str) -> str:
    return f"voice_clones:{org_id}"


def _sample_dir() -> str:
    return os.getenv("VOICE_SAMPLE_DIR", os.path.join("data", "voice_samples"))


async def clones(db, org_id: str) -> List[Dict[str, Any]]:
    from app.services.credits import _get_doc

    return list((await _get_doc(db, _clones_key(org_id))).get("items") or [])


async def _save_clones(db, org_id: str, items: List[Dict[str, Any]]) -> None:
    from app.services.credits import _put_doc

    await _put_doc(db, _clones_key(org_id), {"items": items})


def _clone_voice_id(made: Dict[str, Any]) -> str:
    pid = str(made.get("provider_voice_id") or made.get("id") or "")
    return f"Telnyx.Qwen3TTS.{pid}" if pid else ""


async def _upload(client, item: Dict[str, Any], content: bytes) -> Dict[str, Any]:
    ext = os.path.splitext(item["file"])[1].lower()
    files = {"audio_file": (f"sample{ext}", content, CLONE_TYPES.get(ext, "application/octet-stream"))}
    fields = {"name": item["name"], "language": item["language"], "gender": item["gender"], "provider": "telnyx"}
    if item.get("refText"):
        fields["ref_text"] = item["refText"]
    body = await client._req("POST", "/voice_clones/from_upload", files=files, data=fields)
    return body.get("data", body) if isinstance(body, dict) else {}


async def add_clone(db, client, org_id: str, *, name: str, language: str, gender: str, filename: str,
                    content: bytes, consent: bool, ref_text: str = "", by: str = "") -> Dict[str, Any]:
    if not consent:
        raise OptionError("Confirm the speaker agreed to have their voice cloned.")
    name, language, gender = name.strip()[:80], language.strip().lower()[:5], gender.strip().lower()
    if not name:
        raise OptionError("Give the voice a name.")
    if not re.match(r"^[a-z]{2}$", language):
        raise OptionError("Pick the language the sample is spoken in.")
    if gender not in GENDERS:
        raise OptionError("Pick male, female or neutral.")
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in CLONE_TYPES:
        raise OptionError("Upload a WAV, MP3, FLAC, OGG or M4A file.")
    if not content or len(content) > CLONE_MAX_BYTES:
        raise OptionError("The sample must be under 5 MB (5-10 seconds of clear speech is best).")
    items = await clones(db, org_id)
    if len(items) >= MAX_CLONES:
        raise OptionError(f"You can keep up to {MAX_CLONES} voices. Delete one first.")
    cid = f"vc_{uuid.uuid4().hex[:12]}"
    folder = os.path.join(_sample_dir(), org_id)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{cid}{ext}")
    with open(path, "wb") as f:
        f.write(content)
    item = {"id": cid, "name": name, "language": language, "gender": gender, "file": path,
            "refText": ref_text.strip()[:1000], "by": by, "createdAt": datetime.utcnow().isoformat()}
    try:
        made = await _upload(client, item, content)
    except Exception:
        os.remove(path)
        raise
    item.update(telnyxId=str(made.get("id") or ""), voice=_clone_voice_id(made), status=str(made.get("status") or "active"))
    if not item["voice"]:
        os.remove(path)
        raise OptionError("Telnyx did not return the new voice. Try again.")
    await _save_clones(db, org_id, [*items, item])
    return item


async def delete_clone(db, client, org_id: str, clone_id: str) -> Optional[str]:
    """Removes a clone; returns its voice id (so assistants using it can go back to default)."""
    items = await clones(db, org_id)
    item = next((c for c in items if c["id"] == clone_id), None)
    if item is None:
        return None
    if item.get("telnyxId"):
        try:
            await client._req("DELETE", f"/voice_clones/{item['telnyxId']}")
        except Exception as err:
            logger.warning(f"[assistant-options] could not delete clone {item['telnyxId']} on Telnyx: {err}")
    try:
        os.remove(item["file"])
    except OSError:
        pass
    await _save_clones(db, org_id, [c for c in items if c["id"] != clone_id])
    return item.get("voice") or ""


async def keep_alive(db, client, org_id: str, voice: str) -> str:
    """Before an assistant syncs: if its voice is one of our clones that Telnyx no longer has
    (expired, failed or gone), make it again from the saved sample. Returns the voice id to use
    (a new one after a remake). Never raises."""
    if not voice.startswith("Telnyx.Qwen3TTS."):
        return voice
    try:
        items = await clones(db, org_id)
        item = next((c for c in items if c.get("voice") == voice), None)
        if item is None or not item.get("telnyxId"):
            return voice
        try:
            body = await client._req("GET", f"/voice_clones/{item['telnyxId']}")
            status = str((body.get("data", body) or {}).get("status") or "")
        except Exception as err:
            if getattr(err, "status", 0) != 404:
                return voice  # Telnyx unreachable: keep what we have
            status = "gone"
        if status not in ("expired", "failed", "gone"):
            return voice
        with open(item["file"], "rb") as f:
            made = await _upload(client, item, f.read())
        new_voice = _clone_voice_id(made)
        if not new_voice:
            return voice
        item.update(telnyxId=str(made.get("id") or ""), voice=new_voice, status=str(made.get("status") or "active"),
                    remadeAt=datetime.utcnow().isoformat())
        await _save_clones(db, org_id, items)
        from sqlalchemy import update

        from app.models.models import VoiceAssistant

        await db.execute(update(VoiceAssistant).where(VoiceAssistant.voice == voice).values(voice=new_voice))
        logger.info(f"[assistant-options] remade expired clone {item['id']} for {org_id}")
        return new_voice
    except Exception as err:
        logger.warning(f"[assistant-options] keep-alive for {voice}: {err}")
        return voice
