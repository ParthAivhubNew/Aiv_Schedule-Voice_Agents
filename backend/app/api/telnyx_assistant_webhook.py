import asyncio
import base64
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, Tuple

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.models.models import CallLog
from app.services.telnyx_signature import verify_telnyx_ed25519_signature
from app.services.process_logger import log_process_event

logger = logging.getLogger("telnyx_assistant_webhook")

router = APIRouter(prefix="/telnyx-assistant", tags=["Telnyx AI Assistant"])

_CALL_END_KEYWORDS = ("ended", "completed", "hangup", "insight", "summary")


async def _read_and_verify(request: Request) -> Tuple[bytes, bool]:
    raw_body = await request.body()
    headers = dict(request.headers)
    from app.services.telnyx_assistant_sync import resolve_telnyx_public_key
    async with AsyncSessionLocal() as key_db:
        public_key = await resolve_telnyx_public_key(key_db)
    is_valid = verify_telnyx_ed25519_signature(raw_body, headers, public_key=public_key)
    return raw_body, is_valid


class DialViaAssistantRequest(BaseModel):
    to: str


@router.post("/dial")
async def dial_via_assistant_endpoint(req: DialViaAssistantRequest, db: AsyncSession = Depends(get_db)):
    """
    Triggers a real outbound call from our software that connects the callee to
    our configured Telnyx AI Assistant, using our saved Telnyx number as caller ID.
    """
    from app.services.telnyx_assistant_dial import dial_via_telnyx_assistant
    result = await dial_via_telnyx_assistant(db, req.to)
    if not result.get("success"):
        return JSONResponse(status_code=400, content=result)
    return result


@router.post("/tool/{tool_name}")
async def handle_telnyx_tool_call(tool_name: str, request: Request):
    """
    Webhook target for a Telnyx AI Assistant "webhook tool". Configure one Telnyx
    tool per booking action (check_availability / book_appointment / ...) in the
    Telnyx portal, each pointed at /api/telnyx-assistant/tool/<tool_name>, with a
    fixed body parameter `caller_phone` set to the Telnyx dynamic variable
    {{telnyx_end_user_target}} so we can resolve the caller against our own
    prospect/company data.

    Executes the same provider-agnostic booking_tools.execute_smart_booking_tool()
    used by our own xAI/modular engine, so bookings made by a Telnyx-hosted
    assistant land in the same calendar/Cal.com/CallLog data as everything else.
    """
    raw_body, is_valid = await _read_and_verify(request)

    if not is_valid:
        logger.error(f"[TELNYX-ASSISTANT] Rejected tool-call for '{tool_name}' — invalid signature.")
        return JSONResponse(status_code=401, content={"error": "Invalid webhook signature"})

    try:
        body = json.loads(raw_body) if raw_body else {}
    except Exception as err:
        logger.error(f"[TELNYX-ASSISTANT] Malformed JSON in tool-call body: {err}")
        return JSONResponse(status_code=400, content={"error": "Malformed JSON payload"})

    if not isinstance(body, dict):
        body = {}

    caller_phone = str(
        body.pop("caller_phone", None)
        or body.pop("telnyx_end_user_target", None)
        or ""
    ).strip()
    args: Dict[str, Any] = dict(body)

    logger.info(f"[TELNYX-ASSISTANT] Tool call: name={tool_name} caller={caller_phone or 'unknown'} args={args}")
    asyncio.create_task(log_process_event(
        subsystem="telephony",
        process_name="telnyx_assistant_tool_call",
        message=f"Telnyx AI Assistant invoked tool '{tool_name}'.",
        level="INFO",
        details={"tool": tool_name, "callerPhone": caller_phone, "args": args},
    ))

    try:
        from app.services.conversation_engine import context_resolver
        from app.services.booking_tools import execute_smart_booking_tool

        async with AsyncSessionLocal() as db:
            call_context = await context_resolver.resolve_inbound(db, caller_phone or "unknown")
            tool_result = await execute_smart_booking_tool(db, tool_name, args, call_context)
    except Exception as err:
        logger.error(f"[TELNYX-ASSISTANT] Tool execution failed for '{tool_name}': {err}")
        return JSONResponse(status_code=200, content={"success": False, "error": str(err)})

    return tool_result


@router.post("/call-event")
async def handle_telnyx_assistant_call_event(request: Request):
    """
    Webhook target for the Telnyx AI Assistant's general event webhook:
    - `assistant.initialization` fires before the assistant speaks, so it can be
      given real prospect/company data as dynamic variables.
    - post-call / insights events fire once the call ends, for logging.

    Telnyx does not publish a fixed schema for the post-call payload, so this
    parses defensively (several candidate field names) and always logs the raw
    body via process_logger for inspection rather than failing the request —
    an unrecognized event still returns 200 so Telnyx never retries/backs off.
    """
    raw_body, is_valid = await _read_and_verify(request)

    if not is_valid:
        logger.error("[TELNYX-ASSISTANT] Rejected call-event webhook — invalid signature.")
        return JSONResponse(status_code=401, content={"error": "Invalid webhook signature"})

    try:
        data = json.loads(raw_body) if raw_body else {}
    except Exception as err:
        logger.error(f"[TELNYX-ASSISTANT] Malformed JSON in call-event body: {err}")
        return JSONResponse(status_code=400, content={"error": "Malformed JSON payload"})

    inner = data.get("data") if isinstance(data.get("data"), dict) else {}
    event_type = str(inner.get("event_type") or data.get("event_type") or "unknown")
    payload = inner.get("payload") if isinstance(inner.get("payload"), dict) else {}

    asyncio.create_task(log_process_event(
        subsystem="telephony",
        process_name="telnyx_assistant_call_event",
        message=f"Telnyx AI Assistant event received: {event_type}",
        level="INFO",
        details={"eventType": event_type, "payload": payload},
    ))

    if event_type == "assistant.initialization":
        caller_phone = str(payload.get("telnyx_end_user_target") or "").strip()

        # Calls we dialed ourselves (telnyx_assistant_dial.py) tag the call at
        # dial time with a base64 client_state marker so the sip_webhook.py
        # handler knows to fire ai_assistant_start on call.answered. Telnyx
        # echoes client_state back on this event too (same call_control_id),
        # so we reuse the same marker here to tell outbound from inbound —
        # there is no dial-time "call_direction" field on the plain
        # POST /v2/calls flow this app uses, so this is the only reliable signal.
        call_direction = "inbound"
        raw_client_state = str(payload.get("client_state") or "").strip()
        if raw_client_state:
            try:
                from app.services.telnyx_assistant_dial import TELNYX_ASSISTANT_DIAL_MARKER
                decoded = base64.b64decode(raw_client_state).decode("utf-8", errors="ignore")
                if decoded.startswith(TELNYX_ASSISTANT_DIAL_MARKER):
                    call_direction = "outbound"
            except Exception:
                pass

        try:
            from app.services.conversation_engine import context_resolver
            async with AsyncSessionLocal() as db:
                call_context = await context_resolver.resolve_inbound(db, caller_phone or "unknown")
            prospect = call_context.get("prospect") or {}
            company = call_context.get("company") or {}
            return {
                "dynamic_variables": {
                    "caller_name": prospect.get("name") or "there",
                    "customer_name": prospect.get("name") or "there",
                    "company_name": company.get("name") or "",
                    "agent_name": company.get("agent_name") or "",
                    "call_direction": call_direction,
                }
            }
        except Exception as err:
            logger.warning(f"[TELNYX-ASSISTANT] Dynamic variable resolution failed: {err}")
            return {"dynamic_variables": {"call_direction": call_direction}}

    if any(kw in event_type.lower() for kw in _CALL_END_KEYWORDS):
        caller_phone = str(payload.get("telnyx_end_user_target") or payload.get("from") or "").strip()
        transcript_raw = payload.get("transcript") or payload.get("messages") or []
        summary = payload.get("summary") or payload.get("conversation_summary") or ""
        duration_secs = payload.get("call_duration_secs") or payload.get("duration") or 0
        now_iso = datetime.utcnow().isoformat()

        transcript = transcript_raw if isinstance(transcript_raw, list) else ([{"note": str(transcript_raw)}] if transcript_raw else [])
        if summary:
            transcript = transcript + [{"role": "system", "content": f"Summary: {summary}"}]

        try:
            async with AsyncSessionLocal() as db:
                db.add(CallLog(
                    id=f"cl_{uuid.uuid4().hex[:6]}",
                    canonical_name=caller_phone or "Unknown caller",
                    listed_as=caller_phone or "Unknown caller",
                    channel="voice",
                    mission="Telnyx AI Assistant",
                    started_at=now_iso,
                    ended_at=now_iso,
                    duration=f"{int(duration_secs)}s" if duration_secs else "0 min",
                    outcome="contacted",
                    transcript=transcript,
                ))
                await db.commit()
        except Exception as err:
            logger.warning(f"[TELNYX-ASSISTANT] Failed to persist CallLog for event '{event_type}': {err}")

    return {"status": "received", "event": event_type}
