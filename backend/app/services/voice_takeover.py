"""Taking over a managed-assistant call, and handing it back.

Take over: the assistant stops, the user's own phone is rung from the call's number, and when
they answer the two calls are bridged, so they talk to the person directly. Hand back: the
user's leg is hung up and the assistant starts again on the person's call, with the user's note
and without greeting them again. If the user simply hangs up, the call is handed back.

Recordings Telnyx makes (Agent Studio "record calls") are saved next to the app's own.
"""
from __future__ import annotations

import base64
import logging
import os
from typing import Any, Dict, Optional, Tuple

import httpx
from sqlalchemy.future import select

from app.database import AsyncSessionLocal

logger = logging.getLogger("voice_takeover")

LEG_MARKER = "outreach_takeover"
BACK_GREETING = "Thanks for waiting, I'm back with you."


def encode_leg(call_id: str, org_id: str) -> str:
    return base64.b64encode(f"{LEG_MARKER}:{call_id}|{org_id}".encode()).decode("ascii")


def decode_leg(raw: Any) -> Optional[Tuple[str, str]]:
    """(call_id, org_id) for a user's take-over leg, else None."""
    try:
        text = base64.b64decode(str(raw or "")).decode("utf-8", errors="ignore")
    except Exception:
        return None
    if not text.startswith(f"{LEG_MARKER}:"):
        return None
    call_id, _, org_id = text[len(LEG_MARKER) + 1:].partition("|")
    return (call_id, org_id) if call_id and org_id else None


async def _route(db, from_number: str) -> Tuple[str, str]:
    """(API key, Call Control app) to ring the user from the call's number."""
    from app.services import voice_assistants as VA
    from app.services.telnyx_assistant_dial import _resolve_call_control_app_id
    from app.services.telnyx_provisioning import get_setup, outbound_route

    route = await outbound_route(db, from_number)
    if route:
        return route
    key = (await VA._client(db)).api_key
    setup = await get_setup(db)
    app_id = (setup.connection_id if setup is not None and setup.mode == "managed_account" else "") or \
        await _resolve_call_control_app_id(db, key) or ""
    return key, app_id


async def _action(key: str, call_control_id: str, action: str, body: Optional[Dict[str, Any]] = None) -> None:
    from app.services.telnyx_client import BASE, TelnyxError

    async with httpx.AsyncClient(timeout=12.0) as client:
        r = await client.post(f"{BASE}/calls/{call_control_id}/actions/{action}", json=body or {},
                              headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    if r.status_code >= 400:
        raise TelnyxError(f"Telnyx {action} failed ({r.status_code}): {r.text[:200]}", r.status_code)


async def _note(db, rec, line: str, **fields) -> None:
    from app.websockets.call_hub import call_hub

    rec.transcript = list(rec.transcript or []) + [f"System: {line}"]
    for k, v in fields.items():
        setattr(rec, k, v)
    await db.commit()
    try:
        await call_hub.broadcast("call_updated", {"callId": rec.id, "taken": rec.taken, "state": rec.state, "transcript": rec.transcript})
    except Exception:
        pass


async def take_over(db, rec, operator) -> Dict[str, Any]:
    """Stop the assistant and ring the user. Raises ValueError with a reason to show."""
    from app.core.tenancy import current_org
    from app.services import voice_assistants as VA
    from app.services.telephony_provider import public_http_base

    if rec.ended:
        raise ValueError("This call has ended.")
    if rec.taken:
        raise ValueError("Someone has already taken over this call.")
    if not (operator.phone or "").strip():
        raise ValueError("Add your phone in Agent Studio first: it rings when you take over a call.")
    brief = await VA.brief(db, rec.id)
    if brief is None or not rec.carrier_sid:
        raise ValueError("This call cannot be taken over.")
    from_number = brief.our_number or ""
    key, app_id = await _route(db, from_number)
    if not app_id:
        raise ValueError("No Telnyx call app to ring you from.")
    await _action(key, rec.carrier_sid, "ai_assistant_stop")
    async with httpx.AsyncClient(timeout=12.0) as client:
        from app.services.telnyx_client import BASE

        r = await client.post(f"{BASE}/calls", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json={
            "to": operator.phone, "from": from_number, "connection_id": app_id,
            "client_state": encode_leg(rec.id, current_org()),
            "webhook_url": f"{public_http_base()}/api/telnyx-assistant/call-control", "webhook_url_method": "POST",
        })
    if r.status_code >= 400:
        # The person must never be left with nobody: put the assistant back.
        await _restart(db, rec, brief, key, "")
        raise ValueError(f"Could not ring your phone ({r.status_code}). The assistant carries on.")
    brief.supervisor_leg = str(((r.json() or {}).get("data") or {}).get("call_control_id") or "")
    brief.supervisor_id = operator.id
    await _note(db, rec, f"{operator.name or 'A colleague'} is taking over: ringing their phone. The assistant is paused.",
                taken=True, state="human_review")
    return {"status": "ringing", "taken": True}


async def leg_event(event_type: str, payload: Dict[str, Any], call_id: str) -> Dict[str, Any]:
    """Events of the user's own leg: bridge when they answer, hand back when they hang up."""
    from app.models.models import LiveCall
    from app.services import voice_assistants as VA

    async with AsyncSessionLocal() as db:
        rec = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
        brief = await VA.brief(db, call_id)
        if rec is None or brief is None:
            return {"status": "ignored"}
        if event_type == "call.answered" and not rec.ended:
            key = (await VA._client(db)).api_key
            await _action(key, str(payload.get("call_control_id") or ""), "bridge", {"call_control_id": rec.carrier_sid})
            await _note(db, rec, "Connected: you are now talking to them directly.")
            return {"status": "bridged"}
        if event_type == "call.hangup" and rec.taken and not rec.ended:
            brief.supervisor_leg = ""
            await hand_back(db, rec, "", already_hung_up=True)
            return {"status": "handed_back"}
    return {"status": "ok"}


async def _restart(db, rec, brief, key: str, note: str) -> None:
    from app.services.telnyx_assistant_calls import _post_assistant_start
    from app.models.models import VoiceAssistant

    variables = dict(brief.variables or {})
    lead = ("A colleague from the team just spoke with this person and has handed the call back to you. "
            + (f"Their note: {note}. " if note else "")
            + "Carry on from here. Do not introduce yourself again.\n\n")
    variables["script"] = lead + (variables.get("script") or "")
    variables["greeting"] = BACK_GREETING
    assistant = (await db.execute(select(VoiceAssistant).where(VoiceAssistant.id == brief.assistant_id))).scalars().first()
    if assistant is None:
        raise ValueError("The call's assistant is missing.")
    result = await _post_assistant_start(key, rec.carrier_sid, assistant.telnyx_assistant_id, variables)
    if not result.get("ok"):
        raise ValueError(result.get("error") or "The assistant could not start again.")


async def hand_back(db, rec, note: str, already_hung_up: bool = False) -> Dict[str, Any]:
    from app.services import voice_assistants as VA

    if not rec.taken:
        raise ValueError("This call is not taken over.")
    brief = await VA.brief(db, rec.id)
    if brief is None:
        raise ValueError("This call cannot be handed back.")
    key = (await VA._client(db)).api_key
    if brief.supervisor_leg and not already_hung_up:
        try:
            await _action(key, brief.supervisor_leg, "hangup")
        except Exception as err:  # already gone
            logger.debug(f"[takeover] user leg hangup: {err}")
    brief.supervisor_leg = ""
    note = (note or "").strip()[:500]
    if note:
        brief.notes = ((brief.notes or "") + f"\nHanded back with a note: {note}").strip()
    if rec.ended:
        rec.taken = False
        await db.commit()
        return {"status": "ended", "taken": False}
    await _restart(db, rec, brief, key, note)
    await _note(db, rec, "Handed back to the assistant" + (f" with a note: {note}" if note else "."), taken=False, state="pitching")
    return {"status": "handed_back", "taken": False}


async def end_user_leg(db, call_id: str) -> None:
    """When the person's call ends, the user's own leg (if any) ends too."""
    from app.services import voice_assistants as VA

    brief = await VA.brief(db, call_id)
    if brief is None or not brief.supervisor_leg:
        return
    try:
        await _action((await VA._client(db)).api_key, brief.supervisor_leg, "hangup")
    except Exception:
        pass
    brief.supervisor_leg = ""


# ── Recordings ──────────────────────────────────────────────────────────────
async def save_recording(call_id: str, payload: Dict[str, Any]) -> Optional[str]:
    """Download a recording Telnyx saved for this call (its links expire) and keep it as
    recordings/<call id>.mp3 next to the app's own recordings."""
    from app.services.call_recorder import RECORDINGS_DIR

    urls = payload.get("recording_urls") or payload.get("public_recording_urls") or {}
    url = urls.get("mp3") if isinstance(urls, dict) else None
    safe = "".join(c for c in call_id if c.isalnum() or c in "-_")
    if not url or not safe or not str(url).startswith("https://"):
        return None
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        r = await client.get(url)
    if r.status_code >= 400 or not r.content:
        logger.warning(f"[takeover] recording download for {call_id} failed: {r.status_code}")
        return None
    path = os.path.join(RECORDINGS_DIR, f"{safe}.mp3")
    with open(path, "wb") as fh:
        fh.write(r.content)
    return path
