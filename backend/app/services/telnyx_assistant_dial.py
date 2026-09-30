import logging
import uuid
from typing import Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.models.models import Connection, LiveCall
from app.services.secret_box import open_config
from app.services.telephony_provider import normalize_phone_number, public_http_base
from app.services.telnyx_assistant_sync import (
    _resolve_telnyx_api_key,
    resolve_telnyx_assistant_id,
)
from app.services.telnyx_assistant_calls import (
    CARRIER_TAG,
    DIAL_MARKER,
    encode_client_state,
    register_outbound,
)
from app.services.process_logger import log_process_event
from app.websockets.call_hub import call_hub

logger = logging.getLogger("telnyx_assistant_dial")

# Kept for callers that import the marker from here.
TELNYX_ASSISTANT_DIAL_MARKER = DIAL_MARKER

PREFERRED_APP_NAME = "AIVHub Voice AI"


async def _telnyx_telephony_config(db: AsyncSession) -> dict:
    res = await db.execute(select(Connection).where(Connection.group_name == "Telephony"))
    for c in res.scalars().all():
        if "telnyx" in (c.name or "").lower():
            return open_config(c.config if isinstance(c.config, dict) else {})
    return {}


async def _resolve_telnyx_from_number(db: AsyncSession) -> Optional[str]:
    """
    Our Telnyx caller ID: the saved Telnyx Telephony connection's phone first
    ("phone" from the Connections card, "phoneNumber" from Line setup), then
    TELNYX_PHONE_NUMBER — same order as get_telephony_hub_status().
    """
    cfg = await _telnyx_telephony_config(db)
    phone = (cfg.get("phone") or cfg.get("phoneNumber") or "").strip()
    if phone:
        return phone
    return (getattr(settings, "TELNYX_PHONE_NUMBER", None) or "").strip() or None


async def _resolve_call_control_app_id(db: AsyncSession, api_key: str, use_saved: bool = True) -> Optional[str]:
    """
    Which Call Control Application to dial through. A saved connection_id on the
    Telnyx Telephony connection wins; otherwise the app we auto-create
    ("AIVHub Voice AI"); otherwise the only/first app on the account.
    """
    cfg = await _telnyx_telephony_config(db)
    saved = str(cfg.get("connection_id") or cfg.get("call_control_app_id") or "").strip()
    if use_saved and saved and saved.lower() not in ("default", "none", "null"):
        return saved
    async with httpx.AsyncClient(timeout=8.0) as client:
        try:
            res = await client.get(
                "https://api.telnyx.com/v2/call_control_applications",
                params={"page[size]": 100},
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if res.status_code == 200:
                apps = [a for a in (res.json().get("data") or []) if str(a.get("id") or "").strip()]
                preferred = next((a for a in apps if (a.get("application_name") or "") == PREFERRED_APP_NAME), None)
                chosen = preferred or (apps[0] if apps else None)
                if chosen:
                    return str(chosen["id"]).strip()
        except Exception as e:
            logger.warning(f"[TELNYX-ASSISTANT-DIAL] Could not list call control applications: {e}")
    return None


async def dial_via_telnyx_assistant(
    db: AsyncSession,
    to_number: str,
    prospect_name: Optional[str] = None,
    mission_title: Optional[str] = None,
    prospect_id: Optional[str] = None,
    mission_id: Optional[str] = None,
    from_number_override: Optional[str] = None,
) -> dict:
    """
    Places a real outbound call that connects the callee to our configured Telnyx
    AI Assistant. Telnyx does not attach an assistant at dial time, so we dial
    normally via POST /v2/calls with a client_state marker and a per-call
    webhook_url; telnyx_assistant_calls.handle_call_control_event() starts the
    assistant on call.answered and tracks the call until hangup.
    """
    assistant_id = await resolve_telnyx_assistant_id(db)
    if not assistant_id:
        return {"success": False, "error": "No Telnyx Assistant ID saved. Add it in AI config → Connections → Telnyx AI Assistant."}

    api_key = await _resolve_telnyx_api_key(db)
    if not api_key:
        return {"success": False, "error": "No Telnyx API key saved. Add it in AI config → Connections → Telephony → Telnyx."}

    # The organisation's chosen number when it has numbers saved; else the saved Telnyx number.
    from_number = from_number_override or await _resolve_telnyx_from_number(db)
    if not from_number:
        return {"success": False, "error": "No Telnyx phone number saved (AI config → Connections → Telephony → Telnyx)."}

    # A number can have its own assistant (e.g. a sales line and a support line).
    try:
        from app.models.models import OrgPhoneNumber
        from app.services.numbers import normalize as _norm_number

        line = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.e164 == _norm_number(from_number)))).scalars().first()
        if line and (line.assistant_id or "").strip():
            assistant_id = line.assistant_id.strip()
    except Exception as line_err:
        logger.debug(f"[TELNYX-ASSISTANT-DIAL] number lookup skipped: {line_err}")

    connection_id = await _resolve_call_control_app_id(db, api_key)
    if not connection_id:
        return {"success": False, "error": "No Telnyx Call Control Application found on this account. Run Line setup once to create it."}

    to_clean = normalize_phone_number(to_number)
    from_clean = normalize_phone_number(from_number)

    # UK calling rules: opted-out numbers are refused; out-of-hours calls are refused or
    # warned about depending on the compliance mode.
    from app.services.compliance import check_call_allowed

    gate = await check_call_allowed(db, to_clean)
    if not gate.allowed:
        return {"success": False, "error": " ".join(gate.reasons), "compliance": {"blocked": True, "reasons": gate.reasons}}
    compliance_warnings = list(gate.warnings)

    call_id = f"call_{uuid.uuid4().hex[:8]}"
    label = (prospect_name or "").strip() or f"Prospect ({to_clean[-4:]})"
    mission = (mission_title or "").strip() or "Telnyx AI Assistant — outbound"

    payload = {
        "to": to_clean,
        "from": from_clean,
        "connection_id": connection_id,
        "client_state": encode_client_state(assistant_id, call_id),
        # Route this call's events straight to the Assistant handler, whatever
        # webhook the Call Control App itself is configured with.
        "webhook_url": f"{public_http_base()}/api/telnyx-assistant/call-control",
        "webhook_url_method": "POST",
    }

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=12.0) as client:
        res = await client.post("https://api.telnyx.com/v2/calls", json=payload, headers=headers)
        if res.status_code == 422 and ("10015" in res.text or "connection" in res.text.lower()):
            # A saved id that is a SIP connection, not a Call Control App — discover the app.
            discovered = await _resolve_call_control_app_id(db, api_key, use_saved=False)
            if discovered and discovered != connection_id:
                payload["connection_id"] = discovered
                res = await client.post("https://api.telnyx.com/v2/calls", json=payload, headers=headers)

    if res.status_code not in (200, 201):
        err_text = res.text[:300]
        logger.error(f"[TELNYX-ASSISTANT-DIAL] Dial failed ({res.status_code}): {err_text}")
        await log_process_event(
            subsystem="telephony",
            process_name="telnyx_assistant_outbound_dial",
            message=f"Telnyx Assistant dial to {to_clean} failed (HTTP {res.status_code}).",
            level="ERROR",
            details={"to": to_clean, "from": from_clean, "error": err_text},
        )
        return {"success": False, "error": f"Telnyx HTTP {res.status_code}: {err_text}"}

    data = (res.json() or {}).get("data") or {}
    call_control_id = data.get("call_control_id")
    logger.info(f"[TELNYX-ASSISTANT-DIAL] Dispatched {to_clean} via assistant {assistant_id} (call_control_id={call_control_id})")

    register_outbound(call_control_id, call_id=call_id, to_number=to_clean, prospect=label, assistant_id=assistant_id)

    live_call = LiveCall(
        id=call_id,
        carrier_sid=call_control_id,
        mission_id=mission_id or "m_outbound",
        prospect_id=prospect_id,
        prospect=label,
        mission=mission,
        state="calling",
        carrier=CARRIER_TAG,
        channel="voice",
        duration="00:00",
        transcript=[f"System: Calling {to_clean} from {from_clean} — Telnyx AI Assistant will answer."],
    )
    db.add(live_call)
    await db.commit()
    await call_hub.broadcast("call_started", {
        "callId": call_id,
        "id": call_id,
        "prospect": label,
        "state": "calling",
        "duration": "00:00",
        "mission": mission,
        "channel": "voice",
        "ended": False,
    })
    await log_process_event(
        subsystem="telephony",
        process_name="telnyx_assistant_outbound_dial",
        message=f"Outbound call to {to_clean} dispatched via Telnyx Assistant {assistant_id}.",
        level="SUCCESS",
        details={"to": to_clean, "from": from_clean, "assistantId": assistant_id, "callControlId": call_control_id, "callId": call_id},
    )
    return {"success": True, "callId": call_id, "to": to_clean, "from": from_clean, "call_control_id": call_control_id,
            "complianceWarnings": compliance_warnings}
