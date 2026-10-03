import asyncio
import hashlib
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.models.models import CallLog
from app.services.telnyx_signature import verify_telnyx_ed25519_signature
from app.services.process_logger import log_process_event
from app.services.org_settings import org_timezone
from app.services.timezone_service import tzinfo

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
    prospect_name: Optional[str] = None
    mission_title: Optional[str] = None
    prospect_id: Optional[str] = None
    mission_id: Optional[str] = None
    from_number: Optional[str] = None
    accept_capped: bool = False  # the user saw the low-minutes warning and calls anyway


@router.post("/dial")
async def dial_via_assistant_endpoint(req: DialViaAssistantRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Triggers a real outbound call from our software that connects the callee to
    our configured Telnyx AI Assistant, using our saved Telnyx number as caller ID.
    """
    from app.services.numbers import pick_caller_id
    from app.services.telnyx_assistant_dial import dial_via_telnyx_assistant

    picked, number_err = await pick_caller_id(db, getattr(request.state, "auth", None), req.from_number)
    if number_err:
        return JSONResponse(status_code=403, content={"success": False, "error": number_err})
    if not req.accept_capped:
        from app.services.credits import short_call_warning

        warning = await short_call_warning(db)
        if warning:
            return JSONResponse(status_code=409, content={"success": False, "error": warning["message"], **warning})
    result = await dial_via_telnyx_assistant(
        db,
        req.to,
        from_number_override=picked,
        prospect_name=req.prospect_name,
        mission_title=req.mission_title,
        prospect_id=req.prospect_id,
        mission_id=req.mission_id,
        operator_id=(getattr(request.state, "auth", None) or {}).get("operator_id", ""),
    )
    if not result.get("success"):
        return JSONResponse(status_code=400, content=result)
    return result


@router.post("/call-control")
async def handle_assistant_call_control(request: Request):
    """
    Per-call webhook_url for calls placed by /dial: Call Control events
    (call.initiated / call.answered / call.hangup) for Assistant-dialed calls.
    """
    raw_body, is_valid = await _read_and_verify(request)
    if not is_valid:
        logger.error("[TELNYX-ASSISTANT] Rejected call-control webhook — invalid signature.")
        return JSONResponse(status_code=401, content={"error": "Invalid webhook signature"})
    try:
        body = json.loads(raw_body) if raw_body else {}
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Malformed JSON payload"})

    from app.core.tenancy import org_scope
    from app.services.telnyx_assistant_calls import tagged_event, handle_call_control_event

    # The user's own phone while they take over a call.
    from app.services.voice_takeover import decode_leg, leg_event
    envelope = body.get("data") if isinstance(body, dict) and isinstance(body.get("data"), dict) else {}
    event_type = str(envelope.get("event_type") or "")
    payload_data = envelope.get("payload") if isinstance(envelope.get("payload"), dict) else {}
    logger.info(f"[TELNYX-CALL-EVENT] {event_type}: hangup_cause={payload_data.get('hangup_cause')}, sip_code={payload_data.get('sip_hangup_cause')}, to={payload_data.get('to')}, from={payload_data.get('from')}")
    leg_payload = payload_data
    leg = decode_leg(leg_payload.get("client_state"))
    if leg:
        with org_scope(leg[1]):
            try:
                return await leg_event(str(envelope.get("event_type") or ""), leg_payload, leg[0])
            except Exception as err:
                logger.error(f"[TELNYX-ASSISTANT] take-over leg handling failed: {err}")
                return {"status": "error", "error": str(err)}

    tagged = tagged_event(body if isinstance(body, dict) else {})
    if not tagged:
        # A call coming in on one of our numbers (its Call Control app points here).
        from app.services.voice_inbound import handle_incoming
        try:
            return await handle_incoming(body if isinstance(body, dict) else {})
        except Exception as err:
            logger.error(f"[TELNYX-ASSISTANT] inbound handling failed: {err}")
            return {"status": "error", "error": str(err)}
    try:
        if tagged["state"].get("org_id"):  # calls dialed for an organisation carry it
            with org_scope(tagged["state"]["org_id"]):
                return await handle_call_control_event(tagged["event_type"], tagged["payload"], tagged["state"])
        return await handle_call_control_event(tagged["event_type"], tagged["payload"], tagged["state"])
    except Exception as err:
        logger.error(f"[TELNYX-ASSISTANT] call-control handling failed: {err}")
        return {"status": "error", "error": str(err)}


@router.post("/tools/{tool_name}")
async def managed_assistant_tool(tool_name: str, request: Request):
    """Tools of our managed assistants (see voice_assistants.shell_tools). Telnyx signs the
    request; the call's signed reference (?ref=) says which organisation and call it is for, so
    a tool can only ever touch that call's own data."""
    raw_body, is_valid = await _read_and_verify(request)
    if not is_valid:
        logger.error(f"[TELNYX-ASSISTANT] Rejected managed tool call '{tool_name}' — invalid signature.")
        return JSONResponse(status_code=401, content={"error": "Invalid webhook signature"})
    try:
        body = json.loads(raw_body) if raw_body else {}
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Malformed JSON payload"})
    if not isinstance(body, dict):
        body = {}
    from app.core.tenancy import org_scope
    from app.services import voice_assistants as VA
    from app.services.voice_tools import run

    ref = request.query_params.get("ref") or request.headers.get("x-call-ref") or str(body.pop("call_ref", "") or "")
    found = VA.read_ref(ref)
    if not found:
        return {"success": False, "error": "This call is not recognised."}
    org_id, call_id = found
    with org_scope(org_id):
        try:
            return await run(tool_name, call_id, body)
        except Exception as err:
            logger.error(f"[TELNYX-ASSISTANT] managed tool '{tool_name}' failed: {err}")
            return {"success": False, "error": "That did not work. Offer to have someone follow up."}


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

    if "book" in tool_name.lower() and isinstance(tool_result, dict) and tool_result.get("success"):
        try:
            from app.services.telnyx_assistant_calls import mark_booked_for_phone
            await mark_booked_for_phone(caller_phone)
        except Exception as mark_err:
            logger.debug(f"[TELNYX-ASSISTANT] Could not flag live call as booked: {mark_err}")

    return tool_result


async def _org_of_call(call_control_id: str) -> str:
    """Which organisation a signed Telnyx call id belongs to, looked up outside any org scope
    (the webhook arrives with no org context of its own). "" when the call isn't ours."""
    if not call_control_id:
        return ""
    from sqlalchemy.future import select as _select

    from app.core.tenancy import system_scope
    from app.models.models import LiveCall
    with system_scope():
        async with AsyncSessionLocal() as db:
            row = (await db.execute(_select(LiveCall.org_id).where(LiveCall.carrier_sid == call_control_id))).first()
    return row[0] if row else ""


async def _brief_variables(call_control_id: str) -> Optional[Dict[str, Any]]:
    if not call_control_id:
        return None
    from sqlalchemy.future import select as _select

    from app.core.tenancy import org_scope, system_scope
    from app.models.models import LiveCall
    from app.services import voice_assistants as VA
    # Telnyx's call id comes from a signed webhook; find the call in whichever organisation it
    # belongs to, then read its brief inside that organisation.
    with system_scope():
        async with AsyncSessionLocal() as db:
            row = (await db.execute(_select(LiveCall.id, LiveCall.org_id).where(LiveCall.carrier_sid == call_control_id))).first()
    if not row:
        return None
    with org_scope(row[1]):
        async with AsyncSessionLocal() as db:
            found = await VA.brief(db, row[0])
            return dict(found.variables or {}) if found else None


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

        # A call with a brief (managed assistants): give Telnyx exactly what that call was set up with.
        from app.services import voice_assistants as VA
        from app.services.telnyx_assistant_calls import call_control_id_from_assistant_payload
        call_control_id = call_control_id_from_assistant_payload(payload)
        if VA.enabled_for_org(await _org_of_call(call_control_id)):
            known_vars = await _brief_variables(call_control_id)
            if known_vars:
                return {"dynamic_variables": known_vars}

        # Calls we dialed ourselves (telnyx_assistant_dial.py) tag the call at
        # dial time with a base64 client_state marker so the sip_webhook.py
        # handler knows to fire ai_assistant_start on call.answered. Telnyx
        # echoes client_state back on this event too (same call_control_id),
        # so we reuse the same marker here to tell outbound from inbound —
        # there is no dial-time "call_direction" field on the plain
        # POST /v2/calls flow this app uses, so this is the only reliable signal.
        call_direction = "inbound"
        from app.services.telnyx_assistant_calls import decode_client_state, is_tracked, call_control_id_from_assistant_payload
        if decode_client_state(payload.get("client_state")) or is_tracked(call_control_id_from_assistant_payload(payload)):
            call_direction = "outbound"

        try:
            from app.services.conversation_engine import context_resolver
            async with AsyncSessionLocal() as db:
                call_context = await context_resolver.resolve_inbound(db, caller_phone or "unknown")
            prospect = call_context.get("prospect") or {}
            company = call_context.get("company") or {}
            if call_direction == "inbound":
                from app.services.telnyx_assistant_calls import call_control_id_from_assistant_payload, track_inbound
                ccid = call_control_id_from_assistant_payload(payload)
                if ccid:
                    asyncio.create_task(track_inbound(ccid, caller_phone, prospect.get("name") or ""))
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
        from app.services.telnyx_assistant_calls import call_control_id_from_assistant_payload, finish_call, is_tracked
        summary = str(payload.get("summary") or payload.get("conversation_summary") or "").strip()
        ccid = call_control_id_from_assistant_payload(payload)

        if ccid:
            # Our own LiveCall for this call (outbound dial or tracked inbound) —
            # close it / enrich its Call history row, never write a second one.
            from sqlalchemy.future import select as _select
            from app.models.models import LiveCall
            async with AsyncSessionLocal() as db:
                known = (await db.execute(_select(LiveCall).where(LiveCall.carrier_sid == ccid))).scalars().first()
            if known or is_tracked(ccid):
                try:
                    await finish_call(ccid, {}, summary=summary)
                except Exception as err:
                    logger.warning(f"[TELNYX-ASSISTANT] Could not finish tracked call {ccid}: {err}")
                return {"status": "received", "event": event_type}

        caller_phone = str(payload.get("telnyx_end_user_target") or payload.get("from") or "").strip()
        transcript_raw = payload.get("transcript") or payload.get("messages") or []
        duration_secs = payload.get("call_duration_secs") or payload.get("duration") or 0
        async with AsyncSessionLocal() as tz_db:
            org_tz = tzinfo(await org_timezone(tz_db))
        now_str = datetime.now(org_tz).strftime("%d %b %Y, %H:%M")

        transcript = []
        for m in transcript_raw if isinstance(transcript_raw, list) else []:
            if isinstance(m, dict):
                role = str(m.get("role") or "").lower()
                text = str(m.get("text") or m.get("content") or "").strip()
                if text and role in ("user", "assistant"):
                    transcript.append({"who": "ai" if role == "assistant" else "them", "text": text})
        if not transcript and transcript_raw and not isinstance(transcript_raw, list):
            transcript.append({"who": "system", "text": str(transcript_raw)})
        if summary:
            transcript.append({"who": "system", "text": f"Summary: {summary}"})

        # Deterministic id so Telnyx retries / several end events update one row.
        key = ccid or str(payload.get("conversation_id") or inner.get("id") or data.get("id") or uuid.uuid4().hex)
        log_id = "cl_tx_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
        try:
            secs = int(float(duration_secs or 0))
        except Exception:
            secs = 0
        try:
            async with AsyncSessionLocal() as db:
                await db.merge(CallLog(
                    id=log_id,
                    canonical_name=caller_phone or "Unknown caller",
                    listed_as=caller_phone or "Unknown caller",
                    channel="voice",
                    mission="Telnyx AI Assistant — inbound",
                    started_at=now_str,
                    ended_at=now_str,
                    duration=f"{secs // 60:02d}:{secs % 60:02d} min",
                    outcome="contacted",
                    transcript=transcript,
                ))
                await db.commit()
            from app.websockets.call_hub import call_hub
            await call_hub.broadcast("call_ended", {"callId": log_id, "endedBy": "remote"})
        except Exception as err:
            logger.warning(f"[TELNYX-ASSISTANT] Failed to persist CallLog for event '{event_type}': {err}")

    return {"status": "received", "event": event_type}
