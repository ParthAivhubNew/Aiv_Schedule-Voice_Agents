"""
Live-call lifecycle for calls handled by a Telnyx-hosted AI Assistant.

Telnyx runs STT/LLM/TTS itself, so none of our own media plumbing sees these
calls. This module is what makes them first-class calls in the app anyway:

- one handler for every Call Control event on an Assistant-dialed call, no matter
  which of our webhook URLs Telnyx delivers it to (the per-call webhook_url set at
  dial time, the Call Control App's /api/sip-webhook, or /api/calls/telnyx/voice);
- starts the assistant on call.answered with per-call dynamic variables;
- mirrors the assistant's conversation into LiveCall.transcript while the call is
  up (Telnyx AI Conversations API), so the Live board shows what is being said;
- closes the LiveCall on hangup and writes the Call history row (same
  upsert_call_log_from_live path every other engine uses — one row per call);
- lets booking tool-calls mark the live call as booked.
"""
from __future__ import annotations

import asyncio
import base64
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.future import select

from app.database import AsyncSessionLocal
from app.models.models import LiveCall
from app.services.process_logger import log_process_event
from app.services.telephony_provider import normalize_phone_number

logger = logging.getLogger("telnyx_assistant_calls")

TELNYX_API = "https://api.telnyx.com/v2"
DIAL_MARKER = "telnyx_assistant_outbound"
CARRIER_TAG = "telnyx_assistant"

POLL_INTERVAL_SECS = 2.5
POLL_MAX_SECS = 3 * 60 * 60
POLL_IDLE_STOP_SECS = 15 * 60

# call_control_id -> runtime state for calls this process is tracking
_calls: Dict[str, Dict[str, Any]] = {}
_pollers: Dict[str, asyncio.Task] = {}


# ── client_state marker ──────────────────────────────────────────────────────

def encode_client_state(assistant_id: str, call_id: str, org_id: str = "") -> str:
    raw = f"{DIAL_MARKER}:{assistant_id}:{call_id}" + (f"|{org_id}" if org_id else "")
    return base64.b64encode(raw.encode("utf-8")).decode("ascii")


def decode_client_state(raw: Any) -> Optional[Dict[str, str]]:
    """Returns {"assistant_id", "call_id", "org_id"} for calls we dialed via the assistant, else None.

    Accepts the legacy two-part form "marker:assistant_id" (no call id) too; org_id is "" for
    calls dialed before it was added.
    """
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        decoded = base64.b64decode(s).decode("utf-8", errors="ignore")
    except Exception:
        return None
    if not decoded.startswith(f"{DIAL_MARKER}:"):
        return None
    parts = decoded.split(":", 2)
    call_id, _, org_id = (parts[2] if len(parts) > 2 else "").partition("|")
    return {
        "assistant_id": parts[1] if len(parts) > 1 else "",
        "call_id": call_id,
        "org_id": org_id,
    }


def tagged_event(body: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """If a Telnyx Call Control webhook body belongs to an Assistant-dialed call,
    returns {"event_type", "payload", "state"}; otherwise None."""
    envelope = body.get("data") if isinstance(body.get("data"), dict) else {}
    payload = envelope.get("payload") if isinstance(envelope.get("payload"), dict) else {}
    state = decode_client_state(payload.get("client_state"))
    if not state:
        return None
    return {"event_type": str(envelope.get("event_type") or ""), "payload": payload, "state": state}


def register_outbound(call_control_id: str, *, call_id: str, to_number: str, prospect: str, assistant_id: str) -> None:
    if not call_control_id:
        return
    _calls[call_control_id] = {
        "call_id": call_id,
        "to": normalize_phone_number(to_number) if to_number else "",
        "prospect": prospect,
        "assistant_id": assistant_id,
        "answered": False,
        "conversation_id": None,
        "base_lines": [],
        "convo_lines": [],
        "last_change": datetime.utcnow(),
    }


# ── helpers ──────────────────────────────────────────────────────────────────

async def _api_key() -> Optional[str]:
    """The key for the current organisation's calls: its Telnyx setup (its managed account, or
    our pay-as-you-go account) when it has one, else the key saved in AI config."""
    from app.services.telnyx_assistant_sync import _resolve_telnyx_api_key
    async with AsyncSessionLocal() as db:
        try:
            from app.services.telnyx_provisioning import client_for, get_setup

            setup = await get_setup(db)
            if setup is not None and setup.status == "ready":
                return client_for(setup).api_key
        except Exception:
            pass
        return await _resolve_telnyx_api_key(db)


async def _broadcast(event: str, data: Dict[str, Any]) -> None:
    try:
        from app.websockets.call_hub import call_hub
        await call_hub.broadcast(event, data)
    except Exception:
        pass


async def _find_live_call(db, call_control_id: str, call_id: str = "") -> Optional[LiveCall]:
    if call_id:
        rec = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
        if rec:
            return rec
    if call_control_id:
        return (await db.execute(select(LiveCall).where(LiveCall.carrier_sid == call_control_id))).scalars().first()
    return None


def _real_name(label: str) -> str:
    """LiveCall.prospect minus our placeholder labels like 'Prospect (1234)'."""
    s = (label or "").strip()
    if not s or s.startswith("Prospect (") or s.startswith("Caller (") or s.startswith("+"):
        return ""
    return s


def _message_lines(messages: List[Dict[str, Any]]) -> List[str]:
    rows = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        text = str(m.get("text") or "").strip()
        role = str(m.get("role") or "").lower()
        if not text or role not in ("user", "assistant"):
            continue
        rows.append((str(m.get("created_at") or m.get("sent_at") or ""), role, text))
    rows.sort(key=lambda r: r[0])
    return [f"{'AI' if role == 'assistant' else 'Prospect'}: {text}" for _, role, text in rows]


async def _fetch_conversation_lines(api_key: str, call_control_id: str, state: Dict[str, Any]) -> Optional[List[str]]:
    """Current transcript lines for this call from Telnyx AI Conversations, or None if unavailable."""
    headers = {"Authorization": f"Bearer {api_key}"}
    async with httpx.AsyncClient(timeout=8.0) as client:
        conv_id = state.get("conversation_id")
        if not conv_id:
            res = await client.get(
                f"{TELNYX_API}/ai/conversations",
                params={"metadata->call_control_id": f"eq.{call_control_id}", "limit": 1},
                headers=headers,
            )
            if res.status_code != 200:
                return None
            data = (res.json() or {}).get("data") or []
            if not data:
                return None
            conv_id = data[0].get("id")
            state["conversation_id"] = conv_id
        if not conv_id:
            return None
        messages: List[Dict[str, Any]] = []
        for page in range(1, 11):
            res = await client.get(
                f"{TELNYX_API}/ai/conversations/{conv_id}/messages",
                params={"page[size]": 100, "page[number]": page},
                headers=headers,
            )
            if res.status_code != 200:
                return _message_lines(messages) if messages else None
            body = res.json() or {}
            messages.extend(body.get("data") or [])
            total_pages = ((body.get("meta") or {}).get("total_pages")) or 1
            if page >= int(total_pages):
                break
        return _message_lines(messages)


async def _sync_transcript(call_control_id: str) -> bool:
    """Pulls the conversation into LiveCall.transcript. Returns True when it changed."""
    state = _calls.get(call_control_id)
    if not state:
        return False
    api_key = await _api_key()
    if not api_key:
        return False
    try:
        lines = await _fetch_conversation_lines(api_key, call_control_id, state)
    except Exception as err:
        logger.debug(f"[TELNYX-ASSISTANT] Transcript fetch failed for {call_control_id}: {err}")
        return False
    if lines is None or lines == state.get("convo_lines"):
        return False
    state["convo_lines"] = lines
    state["last_change"] = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        rec = await _find_live_call(db, call_control_id, state.get("call_id", ""))
        if not rec:
            return False
        rec.transcript = list(state.get("base_lines") or []) + lines
        await db.commit()
        await _broadcast("call_updated", {"callId": rec.id, "transcript": rec.transcript, "state": rec.state})
    return True


async def _poll_transcript(call_control_id: str) -> None:
    started = datetime.utcnow()
    try:
        while call_control_id in _calls:
            await asyncio.sleep(POLL_INTERVAL_SECS)
            state = _calls.get(call_control_id)
            if not state:
                break
            await _sync_transcript(call_control_id)
            now = datetime.utcnow()
            if (now - started).total_seconds() > POLL_MAX_SECS:
                break
            if (now - state.get("last_change", now)).total_seconds() > POLL_IDLE_STOP_SECS:
                break
    except asyncio.CancelledError:
        pass
    except Exception as err:
        logger.warning(f"[TELNYX-ASSISTANT] Transcript poller stopped for {call_control_id}: {err}")
    finally:
        _pollers.pop(call_control_id, None)


def _start_poller(call_control_id: str) -> None:
    if call_control_id in _pollers:
        return
    _pollers[call_control_id] = asyncio.create_task(_poll_transcript(call_control_id))


def _stop_poller(call_control_id: str) -> None:
    task = _pollers.pop(call_control_id, None)
    if task and not task.done():
        task.cancel()


def _hangup_outcome(cause: str, answered: bool) -> str:
    c = (cause or "").strip().lower()
    if answered:
        return "contacted"
    if c in ("originator_cancel",):
        return "canceled"
    if c in ("user_busy", "busy", "timeout", "no_answer", "call_rejected", "unallocated_number") or not c:
        return "no_answer"
    return "failed"


def _duration(payload: Dict[str, Any], rec: LiveCall) -> str:
    start = payload.get("start_time")
    end = payload.get("end_time")
    secs = None
    try:
        if start and end:
            s = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
            e = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
            secs = int((e - s).total_seconds())
    except Exception:
        secs = None
    if secs is None and rec.created_at:
        secs = int((datetime.utcnow() - rec.created_at).total_seconds())
    secs = max(0, secs or 0)
    return f"{secs // 60:02d}:{secs % 60:02d}"


# ── event handling ───────────────────────────────────────────────────────────

async def _start_assistant(call_control_id: str, assistant_id: str, state: Dict[str, Any]) -> Dict[str, Any]:
    # Managed assistants: this call's brief holds everything Telnyx needs, made when it was dialed.
    from app.services import voice_assistants as VA

    async with AsyncSessionLocal() as db:
        call_brief = await VA.brief(db, state.get("call_id", ""))
        if call_brief is not None:
            try:
                brief_key = (await VA._client(db)).api_key
            except Exception as key_err:
                return {"ok": False, "error": str(key_err)}
    if call_brief is not None:
        return await _post_assistant_start(brief_key, call_control_id, assistant_id, dict(call_brief.variables or {}))

    api_key = await _api_key()
    if not api_key:
        return {"ok": False, "error": "No Telnyx API key configured."}

    name = _real_name(state.get("prospect", ""))
    dynamic = {"call_direction": "outbound"}
    if name:
        dynamic["customer_name"] = name
        dynamic["caller_name"] = name
    try:
        from app.services.conversation_engine import context_resolver
        async with AsyncSessionLocal() as db:
            ctx = await context_resolver.resolve_inbound(db, state.get("to") or "unknown")
        company = ctx.get("company") or {}
        if company.get("name"):
            dynamic["company_name"] = company.get("name")
        if company.get("agent_name"):
            dynamic["agent_name"] = company.get("agent_name")
        prospect = ctx.get("prospect") or {}
        if not name and prospect.get("name"):
            dynamic["customer_name"] = dynamic["caller_name"] = prospect["name"]
    except Exception as ctx_err:
        logger.debug(f"[TELNYX-ASSISTANT] Context resolve skipped: {ctx_err}")

    return await _post_assistant_start(api_key, call_control_id, assistant_id, dynamic)


async def _post_assistant_start(api_key: str, call_control_id: str, assistant_id: str, dynamic: Dict[str, Any]) -> Dict[str, Any]:
    body = {"assistant": {"id": assistant_id, "dynamic_variables": dynamic}}
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(
            f"{TELNYX_API}/calls/{call_control_id}/actions/ai_assistant_start",
            json=body,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        if res.status_code == 422 and "dynamic_variables" in res.text:
            # Older API revisions reject inline dynamic variables — start plain.
            res = await client.post(
                f"{TELNYX_API}/calls/{call_control_id}/actions/ai_assistant_start",
                json={"assistant": {"id": assistant_id}},
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
    if res.status_code in (200, 201):
        data = (res.json() or {}).get("data") or {}
        return {"ok": True, "conversation_id": data.get("conversation_id")}
    return {"ok": False, "error": f"Telnyx HTTP {res.status_code}: {res.text[:200]}"}


async def _hangup(call_control_id: str) -> None:
    api_key = await _api_key()
    if not api_key:
        return
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            await client.post(
                f"{TELNYX_API}/calls/{call_control_id}/actions/hangup",
                json={},
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
    except Exception:
        pass


async def handle_call_control_event(event_type: str, payload: Dict[str, Any], state_marker: Dict[str, str]) -> Dict[str, Any]:
    """Single handler for every Call Control event on an Assistant-dialed call."""
    call_control_id = str(payload.get("call_control_id") or "")
    if not call_control_id:
        return {"status": "ignored", "reason": "no call_control_id"}

    state = _calls.get(call_control_id)
    if state is None:
        # Process restarted between dial and this event — rebuild from the DB row.
        async with AsyncSessionLocal() as db:
            rec = await _find_live_call(db, call_control_id, state_marker.get("call_id", ""))
        register_outbound(
            call_control_id,
            call_id=(rec.id if rec else state_marker.get("call_id", "")),
            to_number=str(payload.get("to") or ""),
            prospect=(rec.prospect if rec else ""),
            assistant_id=state_marker.get("assistant_id", ""),
        )
        state = _calls[call_control_id]
        if rec:
            state["base_lines"] = [l for l in (rec.transcript or []) if isinstance(l, str) and l.startswith("System:")]
            state["answered"] = rec.state in ("pitching", "negotiating", "human_review")
            if state["answered"] and not rec.ended:
                _start_poller(call_control_id)

    if event_type in ("call.initiated", "call.ringing"):
        return {"status": "ok", "event": event_type}

    if event_type == "call.answered":
        if state.get("answered"):
            return {"status": "ok", "event": event_type, "note": "duplicate"}
        state["answered"] = True
        assistant_id = state_marker.get("assistant_id") or state.get("assistant_id")
        result = await _start_assistant(call_control_id, assistant_id, state)
        async with AsyncSessionLocal() as db:
            rec = await _find_live_call(db, call_control_id, state.get("call_id", ""))
            if rec:
                lines = list(rec.transcript or [])
                if result.get("ok"):
                    lines.append("System: Answered — Telnyx AI Assistant connected.")
                    rec.state = "pitching"
                else:
                    lines.append(f"System: Answered, but the Telnyx AI Assistant could not start ({result.get('error')}).")
                    rec.state = "failed"
                rec.transcript = lines
                state["base_lines"] = lines
                await db.commit()
                await _broadcast("call_updated", {"callId": rec.id, "state": rec.state, "transcript": rec.transcript})
        await log_process_event(
            subsystem="telephony",
            process_name="telnyx_assistant_start",
            message=(
                f"Telnyx AI Assistant started on {call_control_id}."
                if result.get("ok") else f"Telnyx AI Assistant failed to start on {call_control_id}: {result.get('error')}"
            ),
            level="SUCCESS" if result.get("ok") else "ERROR",
            details={"callControlId": call_control_id, "assistantId": assistant_id, **result},
        )
        if result.get("ok"):
            state["conversation_id"] = result.get("conversation_id") or None
            _start_poller(call_control_id)
        else:
            # Never leave a real person on a silent line.
            await _hangup(call_control_id)
        return {"status": "assistant_started" if result.get("ok") else "assistant_failed", "call_control_id": call_control_id}

    if event_type == "call.hangup":
        await finish_call(call_control_id, payload)
        return {"status": "ok", "event": event_type}

    return {"status": "ignored", "event": event_type}


async def finish_call(call_control_id: str, payload: Optional[Dict[str, Any]] = None, *, summary: str = "") -> None:
    """Close the LiveCall and write/refresh its Call history row. Safe to call twice."""
    payload = payload or {}
    _stop_poller(call_control_id)
    state = _calls.get(call_control_id) or {}
    if state.get("answered"):
        await _sync_transcript(call_control_id)

    from app.services.call_log_writer import upsert_call_log_from_live
    async with AsyncSessionLocal() as db:
        rec = await _find_live_call(db, call_control_id, state.get("call_id", ""))
        if not rec:
            _calls.pop(call_control_id, None)
            return
        cause = str(payload.get("hangup_cause") or "")
        # "ended" is only ever set on answered calls; needed once _calls has dropped this call.
        answered = bool(state.get("answered")) or rec.state in ("pitching", "negotiating", "human_review", "ended")
        outcome = _hangup_outcome(cause, answered)
        brief_note = None
        if answered:
            outcome, brief_note = await _reported(db, rec.id, outcome)
        already_ended = bool(rec.ended)
        if not already_ended:
            rec.duration = _duration(payload, rec)
            rec.ended = True
            rec.state = "ended" if answered else ("canceled" if outcome == "canceled" else "failed")
            ending = f"System: Call ended ({cause.replace('_', ' ')})." if cause else "System: Call ended."
            rec.transcript = list(rec.transcript or []) + [ending]
        await upsert_call_log_from_live(
            db, rec,
            outcome=outcome,
            duration=rec.duration,
            extra_note="\n".join(n for n in [f"Summary: {summary}" if summary else "", brief_note or ""] if n) or None,
        )
        await db.commit()
        call_id = rec.id
        await _broadcast("call_ended", {"callId": call_id, "endedBy": "remote", "state": rec.state})
        await _broadcast("call_updated", {"callId": call_id, "ended": True, "state": rec.state, "duration": rec.duration})

    if answered and not summary and not already_ended:
        # Telnyx can finish writing the last turns a moment after hangup.
        asyncio.create_task(_late_transcript_refresh(call_control_id, call_id))
    else:
        _calls.pop(call_control_id, None)


async def _reported(db, call_id: str, outcome: str):
    """(outcome, note) for Call history from what a managed assistant reported in this call
    (save_outcome, a booking, request_human); unchanged for calls without a brief."""
    from app.services import voice_assistants as VA
    from app.services.voice_tools import HISTORY_OUTCOME

    call_brief = await VA.brief(db, call_id)
    if call_brief is None:
        return outcome, None
    parts = [f"Outcome: {call_brief.outcome.replace('_', ' ')}" if call_brief.outcome else "",
             call_brief.notes or "",
             "; ".join(f"{k}: {v}" for k, v in (call_brief.captured or {}).items())]
    return HISTORY_OUTCOME.get(call_brief.outcome or "", outcome), ("\n".join(p for p in parts if p) or None)


async def _late_transcript_refresh(call_control_id: str, call_id: str) -> None:
    try:
        await asyncio.sleep(6)
        state = _calls.get(call_control_id)
        if not state:
            return
        before = list(state.get("convo_lines") or [])
        api_key = await _api_key()
        if not api_key:
            return
        lines = await _fetch_conversation_lines(api_key, call_control_id, state)
        if not lines or lines == before:
            return
        from app.services.call_log_writer import upsert_call_log_from_live
        async with AsyncSessionLocal() as db:
            rec = await _find_live_call(db, call_control_id, call_id)
            if not rec:
                return
            tail = [l for l in (rec.transcript or []) if isinstance(l, str) and l.startswith("System: Call ended")]
            rec.transcript = list(state.get("base_lines") or []) + lines + tail
            outcome, brief_note = await _reported(db, rec.id, "contacted")
            await upsert_call_log_from_live(db, rec, outcome=outcome, duration=rec.duration, extra_note=brief_note)
            await db.commit()
    except Exception as err:
        logger.debug(f"[TELNYX-ASSISTANT] Late transcript refresh skipped: {err}")
    finally:
        _calls.pop(call_control_id, None)


# ── called from the assistant's own webhooks ─────────────────────────────────

def call_control_id_from_assistant_payload(payload: Dict[str, Any]) -> str:
    meta = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    return str(payload.get("call_control_id") or meta.get("call_control_id") or "").strip()


def is_tracked(call_control_id: str) -> bool:
    return bool(call_control_id) and call_control_id in _calls


async def track_inbound(call_control_id: str, caller_phone: str, prospect_label: str) -> Optional[str]:
    """Inbound call answered by the Telnyx-hosted assistant: show it on the Live board."""
    if not call_control_id or call_control_id in _calls:
        return None
    import uuid
    call_id = f"call_{uuid.uuid4().hex[:8]}"
    caller_clean = normalize_phone_number(caller_phone) if caller_phone else ""
    label = prospect_label or (f"Caller ({caller_clean[-4:]})" if caller_clean else "Inbound caller")
    base = [f"System: Inbound call from {caller_clean or 'unknown number'} answered by Telnyx AI Assistant."]
    async with AsyncSessionLocal() as db:
        existing = await _find_live_call(db, call_control_id)
        if existing:
            return existing.id
        db.add(LiveCall(
            id=call_id,
            carrier_sid=call_control_id,
            mission_id="m_inbound",
            prospect=label,
            mission="Telnyx AI Assistant — inbound",
            state="pitching",
            carrier=CARRIER_TAG,
            channel="voice",
            duration="00:00",
            transcript=base,
        ))
        await db.commit()
    register_outbound(call_control_id, call_id=call_id, to_number=caller_phone, prospect=label, assistant_id="")
    _calls[call_control_id]["answered"] = True
    _calls[call_control_id]["base_lines"] = base
    await _broadcast("call_started", {"callId": call_id, "id": call_id, "prospect": label, "state": "pitching",
                                      "mission": "Telnyx AI Assistant — inbound", "channel": "voice", "ended": False})
    _start_poller(call_control_id)
    return call_id


async def mark_booked_for_phone(caller_phone: str) -> None:
    """A booking tool succeeded on a Telnyx Assistant call — flag the matching live call."""
    target = normalize_phone_number(caller_phone) if caller_phone else ""
    if not target:
        return
    for ccid, st in list(_calls.items()):
        if st.get("to") and st.get("to") == target:
            async with AsyncSessionLocal() as db:
                rec = await _find_live_call(db, ccid, st.get("call_id", ""))
                if rec and not rec.booked:
                    rec.booked = True
                    rec.transcript = list(rec.transcript or []) + ["System: Meeting booked by the assistant."]
                    st["base_lines"] = list(st.get("base_lines") or []) + ["System: Meeting booked by the assistant."]
                    await db.commit()
                    await _broadcast("booking_confirmed", {"callId": rec.id})
            return
