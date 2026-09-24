"""
Retell AI Voice Orchestration Service
Handles live API key verification, outbound phone call dispatch via Retell REST API,
browser web call sessions, and webhook processing (call lifecycle, live transcripts, post-call analysis).
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.models import Connection, LiveCall
from app.services.call_log_writer import upsert_call_log_from_live
from app.services.process_logger import log_process_event
from app.services.telephony_provider import normalize_phone_number, public_http_base
from app.websockets.call_hub import call_hub

logger = logging.getLogger("retell_service")

RETELL_BASE_URL = "https://api.retellai.com"


async def validate_retell_credentials(api_key: str) -> Dict[str, Any]:
    """Validates Retell AI Key by querying agents list endpoint."""
    key_clean = (api_key or "").strip()
    if not key_clean:
        return {"valid": False, "error": "Retell API Key is required."}

    url = f"{RETELL_BASE_URL}/list-agents"
    headers = {"Authorization": f"Bearer {key_clean}"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                agents = res.json()
                count = len(agents) if isinstance(agents, list) else 0
                return {
                    "valid": True,
                    "provider": "Retell AI",
                    "details": f"Retell API Key verified successfully ({count} agents registered).",
                }
            elif res.status_code in (401, 403):
                return {"valid": False, "error": "Retell authentication failed (Invalid API Key)."}
            else:
                return {"valid": False, "error": f"Retell returned status {res.status_code}: {res.text[:150]}"}
    except Exception as e:
        return {"valid": False, "error": f"Failed to connect to Retell: {str(e)}"}


async def _resolve_retell_creds(db_session: Optional[Any] = None) -> tuple[str, str, str]:
    """Resolves Retell API key, agent_id, and phone number from DB Connection or settings."""
    api_key = getattr(settings, "RETELL_API_KEY", "") or ""
    agent_id = getattr(settings, "RETELL_AGENT_ID", "") or ""
    from_number = getattr(settings, "RETELL_FROM_NUMBER", "") or ""

    try:
        from app.services.secret_box import open_config

        async with (db_session or AsyncSessionLocal()) as db:
            res = await db.execute(
                select(Connection).where(
                    (Connection.group_name == "Voice Orchestration")
                    & (Connection.name.ilike("%retell%"))
                )
            )
            conn = res.scalars().first()
            if conn and conn.config:
                cfg = open_config(conn.config) if isinstance(conn.config, dict) else {}
                api_key = cfg.get("api_key") or cfg.get("auth_token") or api_key
                agent_id = cfg.get("agent_id") or cfg.get("model") or agent_id
                from_number = cfg.get("from_number") or cfg.get("phoneNumber") or from_number
    except Exception as err:
        logger.warning("Could not read Retell credentials from database: %s", err)

    return api_key.strip(), agent_id.strip(), from_number.strip()


async def dispatch_retell_phone_call(
    to_number: str,
    from_number: Optional[str] = None,
    agent_id: Optional[str] = None,
    prospect_name: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    credentials: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Places an outbound phone call via Retell REST API (POST /v2/create-phone-call).
    """
    creds = credentials or {}
    key_from_creds = creds.get("api_key") or creds.get("auth_token")
    agent_from_creds = creds.get("agent_id") or creds.get("model")
    from_from_creds = creds.get("from_number")

    resolved_key, resolved_agent, resolved_from = await _resolve_retell_creds()
    api_key = (key_from_creds or resolved_key).strip()
    agent_id = (agent_id or agent_from_creds or resolved_agent).strip()
    from_number = (from_number or from_from_creds or resolved_from).strip()

    if not api_key:
        raise ValueError("Retell API Key must be configured in Connections or payload.")
    if not agent_id:
        raise ValueError("Retell Agent ID is required to dispatch calls. Configure it in Connections under Retell AI.")

    to_clean = normalize_phone_number(to_number)
    from_clean = normalize_phone_number(from_number) if from_number else None
    if not from_clean:
        raise ValueError("Retell outbound requires a configured From phone number registered with Retell.")

    meta = metadata or {}
    internal_call_id = meta.get("call_id") or f"call_{uuid.uuid4().hex[:8]}"
    prospect_label = prospect_name or meta.get("prospect") or f"Prospect ({to_clean[-4:]})"

    url = f"{RETELL_BASE_URL}/v2/create-phone-call"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload: Dict[str, Any] = {
        "from_number": from_clean,
        "to_number": to_clean,
        "override_agent_id": agent_id,
        "retell_llm_dynamic_variables": {
            "customer_name": prospect_label,
            "internal_call_id": internal_call_id,
        },
        "metadata": {
            "internalCallId": internal_call_id,
            "prospect": prospect_label,
            "missionId": meta.get("mission_id") or "m_outbound",
            "orgId": meta.get("org_id") or "org_default",
        },
    }

    logger.info("Dispatching Retell outbound call: To=%s From=%s (agent=%s)", to_clean, from_clean, agent_id)
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(url, json=payload, headers=headers)
        if res.status_code in (200, 201):
            data = res.json()
            retell_call_id = data.get("call_id") or data.get("id")
            status = data.get("call_status", "registered")

            await log_process_event(
                subsystem="voice",
                process_name="retell_outbound_dispatch",
                message=f"Retell call dispatched to {to_clean} (Retell ID: {retell_call_id})",
                level="SUCCESS",
                details={"retellCallId": retell_call_id, "to": to_clean, "status": status},
            )

            return {
                "success": True,
                "call_id": retell_call_id,
                "internal_call_id": internal_call_id,
                "status": status,
                "to": to_clean,
                "from": from_clean,
                "carrier": "Retell AI",
                "raw": data,
            }
        else:
            err_msg = res.text[:250]
            try:
                err_json = res.json()
                err_msg = err_json.get("message") or err_json.get("error") or err_msg
            except Exception:
                pass

            await log_process_event(
                subsystem="voice",
                process_name="retell_outbound_failed",
                message=f"Retell call dispatch failed for {to_clean}: {err_msg}",
                level="ERROR",
                details={"status_code": res.status_code, "error": err_msg},
            )
            raise RuntimeError(f"Retell API Error ({res.status_code}): {err_msg}")


async def create_retell_web_call(
    agent_id: Optional[str] = None,
    api_key: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Creates a browser web call session on Retell (POST /v2/create-web-call)."""
    resolved_key, resolved_agent, _ = await _resolve_retell_creds()
    key = (api_key or resolved_key).strip()
    agent = (agent_id or resolved_agent).strip()

    if not key or not agent:
        raise ValueError("Retell API key and Agent ID are required for Web Call.")

    url = f"{RETELL_BASE_URL}/v2/create-web-call"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload: Dict[str, Any] = {
        "agent_id": agent,
        "metadata": metadata or {},
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(url, json=payload, headers=headers)
        if res.status_code in (200, 201):
            return res.json()
        raise RuntimeError(f"Failed to create Retell web call: {res.text[:200]}")


async def process_retell_webhook_event(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handles webhook events from Retell AI.
    Updates LiveCall state, parses transcripts, and triggers call log persistence.
    """
    event_type = body.get("event") or body.get("type", "unknown")
    call_data = body.get("call", {}) or body
    retell_call_id = call_data.get("call_id") or body.get("call_id")
    meta = call_data.get("metadata", {})
    internal_call_id = meta.get("internalCallId") or retell_call_id

    logger.info("[RETELL WEBHOOK] Event: %s (call: %s / %s)", event_type, retell_call_id, internal_call_id)

    async with AsyncSessionLocal() as db:
        call_obj = None
        if internal_call_id:
            res = await db.execute(select(LiveCall).where(LiveCall.id == internal_call_id))
            call_obj = res.scalars().first()
        if not call_obj and retell_call_id:
            res2 = await db.execute(select(LiveCall).where(LiveCall.carrier_sid == retell_call_id))
            call_obj = res2.scalars().first()

        if event_type == "call_started":
            if call_obj:
                call_obj.state = "pitching"
                await db.commit()
                await call_hub.broadcast("call_updated", {"callId": call_obj.id, "state": "pitching"})

        elif event_type in ("call_ended", "call_analyzed"):
            if call_obj:
                call_obj.ended = True
                call_obj.state = "ended"

                transcript_obj = call_data.get("transcript_object") or []
                formatted_lines = []
                for entry in transcript_obj:
                    role = entry.get("role", "user")
                    content = entry.get("content", "")
                    prefix = "AI: " if role in ("agent", "assistant") else "Prospect: "
                    formatted_lines.append(f"{prefix}{content}")

                if formatted_lines:
                    call_obj.transcript = formatted_lines

                call_analysis = call_data.get("call_analysis", {})
                summary = call_analysis.get("call_summary")
                rec_url = call_data.get("recording_url")
                if summary:
                    call_obj.transcript = (call_obj.transcript or []) + [f"System: Call Summary: {summary}"]

                await db.commit()

                try:
                    await upsert_call_log_from_live(
                        db,
                        call_obj,
                        outcome="completed" if call_data.get("disconnection_reason") != "user_hung_up" else "hung_up",
                        recording_url=rec_url,
                    )
                except Exception as log_err:
                    logger.warning("Could not write CallLog for Retell call: %s", log_err)

                await call_hub.broadcast("call_ended", {
                    "callId": call_obj.id,
                    "reason": call_data.get("disconnection_reason", "completed"),
                })

    return {"status": "ok", "event": event_type}
