import base64
import logging
from typing import Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.models.models import Connection
from app.services.secret_box import open_config
from app.services.telephony_provider import normalize_phone_number, public_http_base
from app.services.telnyx_assistant_sync import (
    _resolve_telnyx_api_key,
    resolve_telnyx_assistant_id,
)
from app.services.process_logger import log_process_event

logger = logging.getLogger("telnyx_assistant_dial")

TELNYX_ASSISTANT_DIAL_MARKER = "telnyx_assistant_outbound"


async def _resolve_telnyx_from_number(db: AsyncSession) -> Optional[str]:
    """
    Our Telnyx caller ID. Checks the saved Telnyx Telephony connection's own
    phone field first, then falls back to TELNYX_PHONE_NUMBER — same resolution
    order as get_telephony_hub_status() (connections.py), so this and the
    "What Calling uses" summary never disagree about which number is active.
    """
    res = await db.execute(select(Connection).where(Connection.group_name == "Telephony"))
    for c in res.scalars().all():
        if "telnyx" in (c.name or "").lower():
            cfg = open_config(c.config if isinstance(c.config, dict) else {})
            # Two save paths use two different keys for this same field: the
            # generic Connections card flow writes "phone", the Line-setup
            # provisioning flow writes "phoneNumber" — check both, same as
            # get_telephony_hub_status() already does.
            phone = (cfg.get("phone") or cfg.get("phoneNumber") or "").strip()
            if phone:
                return phone
    return (getattr(settings, "TELNYX_PHONE_NUMBER", None) or "").strip() or None


async def _resolve_call_control_app_id(api_key: str) -> Optional[str]:
    """Finds the existing auto-created Call Control Application ("AIVHub Voice AI")."""
    async with httpx.AsyncClient(timeout=8.0) as client:
        try:
            res = await client.get(
                "https://api.telnyx.com/v2/call_control_applications",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if res.status_code == 200:
                apps = res.json().get("data") or []
                for app in apps:
                    app_id = str(app.get("id") or "").strip()
                    if app_id:
                        return app_id
        except Exception as e:
            logger.warning(f"[TELNYX-ASSISTANT-DIAL] Could not list call control applications: {e}")
    return None


async def dial_via_telnyx_assistant(db: AsyncSession, to_number: str) -> dict:
    """
    Places a real outbound call that connects the callee to our configured Telnyx
    AI Assistant. Telnyx does not attach an assistant at dial time — this dials
    normally via POST /v2/calls with a client_state marker, then the SIP webhook
    handler (sip_webhook.py) watches for that marker on the call.answered event
    and fires the separate ai_assistant_start action at that point.
    """
    assistant_id = await resolve_telnyx_assistant_id(db)
    if not assistant_id:
        return {"success": False, "error": "No Telnyx Assistant ID saved in Connections or .env."}

    api_key = await _resolve_telnyx_api_key(db)
    if not api_key:
        return {"success": False, "error": "No Telnyx API key saved in Connections or .env."}

    from_number = await _resolve_telnyx_from_number(db)
    if not from_number:
        return {"success": False, "error": "No Telnyx phone number saved in Connections (Telephony -> Telnyx)."}

    connection_id = await _resolve_call_control_app_id(api_key)
    if not connection_id:
        return {"success": False, "error": "Could not find a Telnyx Call Control Application on this account."}

    to_clean = normalize_phone_number(to_number)
    from_clean = normalize_phone_number(from_number)
    client_state = base64.b64encode(
        f"{TELNYX_ASSISTANT_DIAL_MARKER}:{assistant_id}".encode("utf-8")
    ).decode("ascii")

    payload = {
        "to": to_clean,
        "from": from_clean,
        "connection_id": connection_id,
        "client_state": client_state,
    }

    async with httpx.AsyncClient(timeout=12.0) as client:
        res = await client.post(
            "https://api.telnyx.com/v2/calls",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )

    if res.status_code in (200, 201):
        data = (res.json() or {}).get("data") or {}
        call_control_id = data.get("call_control_id")
        logger.info(f"[TELNYX-ASSISTANT-DIAL] Dispatched outbound call to {to_clean} via assistant {assistant_id} (call_control_id={call_control_id})")
        await log_process_event(
            subsystem="telephony",
            process_name="telnyx_assistant_outbound_dial",
            message=f"Outbound call to {to_clean} dispatched via Telnyx Assistant {assistant_id}.",
            level="SUCCESS",
            details={"to": to_clean, "from": from_clean, "assistantId": assistant_id, "callControlId": call_control_id},
        )
        return {"success": True, "to": to_clean, "from": from_clean, "call_control_id": call_control_id}

    err_text = res.text[:300]
    logger.error(f"[TELNYX-ASSISTANT-DIAL] Dial failed ({res.status_code}): {err_text}")
    return {"success": False, "error": f"Telnyx HTTP {res.status_code}: {err_text}"}
