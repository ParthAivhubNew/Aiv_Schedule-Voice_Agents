"""
Vapi Voice AI Orchestration Service
Handles live key verification, outbound phone call dispatch via Vapi REST API,
browser web call sessions, and webhook processing (status updates, live transcripts, end of call reports).
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.models import CompanyProfile, Connection, LiveCall
from app.services.call_log_writer import upsert_call_log_from_live
from app.services.process_logger import log_process_event
from app.services.telephony_provider import normalize_phone_number, public_http_base
from app.websockets.call_hub import call_hub

logger = logging.getLogger("vapi_service")

VAPI_BASE_URL = "https://api.vapi.ai"


async def validate_vapi_credentials(api_key: str) -> Dict[str, Any]:
    """Validates Vapi Private API Key by querying Vapi assistants endpoint."""
    key_clean = (api_key or "").strip()
    if not key_clean:
        return {"valid": False, "error": "Vapi Private API Key is required."}

    url = f"{VAPI_BASE_URL}/assistant"
    headers = {"Authorization": f"Bearer {key_clean}"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                assistants = res.json()
                count = len(assistants) if isinstance(assistants, list) else 0
                return {
                    "valid": True,
                    "provider": "Vapi Voice AI",
                    "details": f"Vapi API Key verified successfully ({count} assistants found).",
                }
            elif res.status_code in (401, 403):
                return {"valid": False, "error": "Vapi authentication failed (Invalid Private API Key)."}
            else:
                return {"valid": False, "error": f"Vapi returned status {res.status_code}: {res.text[:150]}"}
    except Exception as e:
        return {"valid": False, "error": f"Failed to connect to Vapi: {str(e)}"}


async def _resolve_vapi_creds(db_session: Optional[Any] = None) -> tuple[str, str, str]:
    """Resolves Vapi API key, assistant_id, and phone_number_id from DB Connection or settings."""
    api_key = getattr(settings, "VAPI_API_KEY", "") or ""
    assistant_id = getattr(settings, "VAPI_ASSISTANT_ID", "") or ""
    phone_number_id = getattr(settings, "VAPI_PHONE_NUMBER_ID", "") or ""

    try:
        from app.services.secret_box import open_config

        async with (db_session or AsyncSessionLocal()) as db:
            res = await db.execute(
                select(Connection).where(
                    (Connection.group_name == "Voice Orchestration")
                    & (Connection.name.ilike("%vapi%"))
                )
            )
            conn = res.scalars().first()
            if conn and conn.config:
                cfg = open_config(conn.config) if isinstance(conn.config, dict) else {}
                api_key = cfg.get("api_key") or cfg.get("auth_token") or api_key
                assistant_id = cfg.get("assistant_id") or cfg.get("model") or assistant_id
                phone_number_id = cfg.get("phone_number_id") or cfg.get("phoneNumberId") or phone_number_id
    except Exception as err:
        logger.warning("Could not read Vapi credentials from database: %s", err)

    return api_key.strip(), assistant_id.strip(), phone_number_id.strip()


async def dispatch_vapi_phone_call(
    to_number: str,
    from_number: Optional[str] = None,
    prospect_name: Optional[str] = None,
    assistant_id: Optional[str] = None,
    phone_number_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    credentials: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Places an outbound phone call via Vapi REST API (POST /call/phone).
    If assistant_id is not provided, constructs an inline assistant spec using CompanyProfile prompt.
    """
    creds = credentials or {}
    key_from_creds = creds.get("api_key") or creds.get("auth_token")
    asst_from_creds = creds.get("assistant_id") or creds.get("model")
    phone_id_from_creds = creds.get("phone_number_id")

    resolved_key, resolved_asst, resolved_phone_id = await _resolve_vapi_creds()
    api_key = (key_from_creds or resolved_key).strip()
    assistant_id = (assistant_id or asst_from_creds or resolved_asst).strip()
    phone_number_id = (phone_number_id or phone_id_from_creds or resolved_phone_id).strip()

    if not api_key:
        raise ValueError("Vapi Private API Key must be configured in Connections or payload.")

    to_clean = normalize_phone_number(to_number)
    from_clean = normalize_phone_number(from_number or "") if from_number else None
    meta = metadata or {}
    internal_call_id = meta.get("call_id") or f"call_{uuid.uuid4().hex[:8]}"
    prospect_label = prospect_name or meta.get("prospect") or f"Prospect ({to_clean[-4:]})"

    server_url = f"{public_http_base()}/api/vapi/webhook"

    payload: Dict[str, Any] = {
        "customer": {
            "number": to_clean,
            "name": prospect_label,
        },
        "serverUrl": server_url,
        "metadata": {
            "internalCallId": internal_call_id,
            "prospect": prospect_label,
            "missionId": meta.get("mission_id") or "m_outbound",
            "orgId": meta.get("org_id") or "org_default",
        },
    }

    if phone_number_id:
        payload["phoneNumberId"] = phone_number_id
    elif from_clean:
        payload["phoneNumber"] = {"twilioPhoneNumber": from_clean}

    if assistant_id:
        payload["assistantId"] = assistant_id
        payload["assistantOverrides"] = {
            "variableValues": {
                "prospectName": prospect_label,
                "customerName": prospect_label,
            }
        }
    else:
        # Build dynamic inline assistant specification
        company_name = "our company"
        caller_name = "AI Representative"
        try:
            async with AsyncSessionLocal() as db:
                prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
                if prof:
                    company_name = getattr(prof, "spoken_name", None) or prof.name or company_name
                    caller_name = prof.caller_name or caller_name
        except Exception:
            pass

        first_msg = f"Hi {prospect_label.split()[0] if prospect_label != 'there' else 'there'}, this is {caller_name} calling from {company_name} — how are you doing today?"
        payload["assistant"] = {
            "firstMessage": first_msg,
            "model": {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            f"You are {caller_name}, an expert outbound sales caller representing {company_name}. "
                            f"You are speaking with {prospect_label}. Your goal is to establish rapport, introduce the service, "
                            "and schedule a quick 15-minute discovery call. Keep your answers conversational, concise, and professional."
                        ),
                    }
                ],
            },
            "voice": {
                "provider": "cartesia",
                "voiceId": "248be419-c632-4f23-adf1-5324ed7dbf10",  # Sonic conversational British
            },
            "serverUrl": server_url,
        }

    url = f"{VAPI_BASE_URL}/call/phone"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    logger.info("Dispatching Vapi outbound call: To=%s (internalCallId=%s)", to_clean, internal_call_id)
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(url, json=payload, headers=headers)
        if res.status_code in (200, 201):
            data = res.json()
            vapi_call_id = data.get("id") or data.get("callId")
            status = data.get("status", "queued")

            await log_process_event(
                subsystem="voice",
                process_name="vapi_outbound_dispatch",
                message=f"Vapi call dispatched to {to_clean} (Vapi SID: {vapi_call_id})",
                level="SUCCESS",
                details={"vapiCallId": vapi_call_id, "to": to_clean, "status": status},
            )

            return {
                "success": True,
                "call_id": vapi_call_id,
                "internal_call_id": internal_call_id,
                "status": status,
                "to": to_clean,
                "from": from_clean or "Vapi Line",
                "carrier": "Vapi Voice AI",
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
                process_name="vapi_outbound_failed",
                message=f"Vapi call dispatch failed for {to_clean}: {err_msg}",
                level="ERROR",
                details={"status_code": res.status_code, "error": err_msg},
            )
            raise RuntimeError(f"Vapi API Error ({res.status_code}): {err_msg}")


async def create_vapi_web_call(
    assistant_id: Optional[str] = None,
    api_key: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Creates a browser web call via Vapi (POST /call/web). Returns call tokens for client."""
    resolved_key, resolved_asst, _ = await _resolve_vapi_creds()
    key = (api_key or resolved_key).strip()
    asst_id = (assistant_id or resolved_asst).strip()

    if not key:
        raise ValueError("Vapi API key required for Web Call.")

    server_url = f"{public_http_base()}/api/vapi/webhook"
    url = f"{VAPI_BASE_URL}/call/web"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload: Dict[str, Any] = {
        "serverUrl": server_url,
        "metadata": metadata or {},
    }
    if asst_id:
        payload["assistantId"] = asst_id

    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(url, json=payload, headers=headers)
        if res.status_code in (200, 201):
            return res.json()
        raise RuntimeError(f"Failed to create Vapi web call: {res.text[:200]}")


async def process_vapi_webhook_event(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handles webhook events pushed by Vapi to /api/vapi/webhook.
    Updates LiveCall state, writes transcripts, and broadcasts deltas to CallHub.
    """
    message = body.get("message", {}) or body
    event_type = message.get("type") or body.get("type", "unknown")
    call_data = message.get("call") or body.get("call", {})
    vapi_call_id = call_data.get("id") or message.get("callId") or body.get("callId")

    meta = call_data.get("metadata", {}) or message.get("metadata", {})
    internal_call_id = meta.get("internalCallId") or vapi_call_id

    logger.info("[VAPI WEBHOOK] Event: %s (call: %s / %s)", event_type, vapi_call_id, internal_call_id)

    async with AsyncSessionLocal() as db:
        call_obj = None
        if internal_call_id:
            res = await db.execute(select(LiveCall).where(LiveCall.id == internal_call_id))
            call_obj = res.scalars().first()
        if not call_obj and vapi_call_id:
            res2 = await db.execute(select(LiveCall).where(LiveCall.carrier_sid == vapi_call_id))
            call_obj = res2.scalars().first()

        # 1. Transcript / Speech updates
        if event_type in ("transcript", "speech-update", "model-output"):
            role = message.get("role") or ("ai" if message.get("type") == "model-output" else "them")
            text = (message.get("transcript") or message.get("text") or "").strip()
            if text and call_obj:
                prefix = "AI: " if role in ("assistant", "ai") else "Prospect: "
                formatted_line = f"{prefix}{text}"
                call_obj.transcript = (call_obj.transcript or []) + [formatted_line]
                call_obj.state = "pitching" if role in ("assistant", "ai") else "listening"
                await db.commit()

                await call_hub.broadcast("call_transcript_delta", {
                    "callId": call_obj.id,
                    "who": "ai" if role in ("assistant", "ai") else "them",
                    "delta": text,
                })

        # 2. Status update
        elif event_type == "status-update":
            status = message.get("status") or call_data.get("status")
            if call_obj and status:
                if status in ("in-progress", "forwarding"):
                    call_obj.state = "pitching"
                elif status in ("ended", "completed", "failed", "busy", "no-answer"):
                    call_obj.state = "ended" if status in ("ended", "completed") else "failed"
                    call_obj.ended = True
                await db.commit()

                await call_hub.broadcast("call_updated", {
                    "callId": call_obj.id,
                    "state": call_obj.state,
                    "ended": call_obj.ended,
                })

        # 3. End of call report
        elif event_type == "end-of-call-report":
            if call_obj:
                call_obj.ended = True
                call_obj.state = "ended"
                summary = message.get("summary") or call_data.get("summary")
                rec_url = message.get("recordingUrl") or call_data.get("recordingUrl")
                if summary:
                    call_obj.transcript = (call_obj.transcript or []) + [f"System: Call Summary: {summary}"]
                await db.commit()

                try:
                    await upsert_call_log_from_live(
                        db,
                        call_obj,
                        outcome="completed" if message.get("endedReason") != "customer-busy" else "busy",
                        recording_url=rec_url,
                    )
                except Exception as log_err:
                    logger.warning("Could not write CallLog for Vapi call: %s", log_err)

                await call_hub.broadcast("call_ended", {
                    "callId": call_obj.id,
                    "reason": message.get("endedReason", "completed"),
                })

    return {"status": "ok", "event": event_type}
