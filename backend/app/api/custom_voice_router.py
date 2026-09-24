"""
Custom Voice Orchestration Router & Dispatcher
Enables connecting any proprietary or third-party voice AI server using a custom Base URL.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.models import LiveCall
from app.services.call_log_writer import upsert_call_log_from_live
from app.services.process_logger import log_process_event
from app.services.telephony_provider import normalize_phone_number, public_http_base
from app.websockets.call_hub import call_hub

logger = logging.getLogger("custom_voice_router")

router = APIRouter(prefix="/custom-voice", tags=["Custom Voice Orchestration"])


async def dispatch_custom_voice_call(
    to_number: str,
    from_number: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    prospect_name: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Dispatches an outbound call request to a custom Voice AI server endpoint.
    Sends standard JSON payload to {base_url}/call or {base_url}.
    """
    clean_base = (base_url or "").strip().rstrip("/")
    if not clean_base:
        raise ValueError("Custom Voice Engine requires a valid Base URL.")

    target_url = f"{clean_base}/call" if not clean_base.endswith("/call") else clean_base
    to_clean = normalize_phone_number(to_number)
    from_clean = normalize_phone_number(from_number or "") if from_number else None
    meta = metadata or {}
    internal_call_id = meta.get("call_id") or f"call_{uuid.uuid4().hex[:8]}"
    prospect_label = prospect_name or meta.get("prospect") or f"Prospect ({to_clean[-4:]})"

    callback_url = f"{public_http_base()}/api/custom-voice/webhook"

    payload = {
        "call_id": internal_call_id,
        "to": to_clean,
        "from": from_clean,
        "prospect": prospect_label,
        "webhook_url": callback_url,
        "metadata": meta,
    }

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key.strip()}"

    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(target_url, json=payload, headers=headers)
        if res.status_code in (200, 201, 202):
            try:
                data = res.json()
            except Exception:
                data = {"raw": res.text}
            ext_call_id = data.get("call_id") or data.get("id") or internal_call_id

            await log_process_event(
                subsystem="voice",
                process_name="custom_voice_dispatch",
                message=f"Custom voice call dispatched to {to_clean} via {target_url}",
                level="SUCCESS",
                details={"callId": ext_call_id, "to": to_clean},
            )

            return {
                "success": True,
                "call_id": ext_call_id,
                "internal_call_id": internal_call_id,
                "status": "ringing",
                "to": to_clean,
                "from": from_clean or "Custom Line",
                "carrier": "Custom Voice Engine",
                "raw": data,
            }
        else:
            err_msg = res.text[:200]
            raise RuntimeError(f"Custom voice endpoint failed ({res.status_code}): {err_msg}")


@router.post("/webhook")
async def custom_voice_webhook(request: Request):
    """
    Universal webhook for custom voice engines.
    Accepts:
    {
      "call_id": "...",
      "status": "pitching" | "ended",
      "who": "ai" | "them",
      "text": "...",
      "summary": "...",
      "recording_url": "..."
    }
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    call_id = body.get("call_id") or body.get("callId")
    status = body.get("status") or body.get("state")
    text = body.get("text") or body.get("transcript") or body.get("message")
    who = body.get("who") or body.get("role", "ai")
    summary = body.get("summary")
    rec_url = body.get("recording_url") or body.get("recordingUrl")

    if not call_id:
        return {"ok": False, "error": "call_id required"}

    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(LiveCall).where((LiveCall.id == call_id) | (LiveCall.carrier_sid == call_id))
        )
        call_obj = res.scalars().first()
        if not call_obj:
            return {"ok": False, "error": f"Call {call_id} not found"}

        if text:
            prefix = "AI: " if who in ("ai", "assistant") else "Prospect: "
            call_obj.transcript = (call_obj.transcript or []) + [f"{prefix}{text}"]
            await call_hub.broadcast("call_transcript_delta", {
                "callId": call_obj.id,
                "who": who,
                "delta": text,
            })

        if status:
            if status in ("ended", "completed", "failed"):
                call_obj.ended = True
                call_obj.state = "ended" if status != "failed" else "failed"
                if summary:
                    call_obj.transcript = (call_obj.transcript or []) + [f"System: Summary: {summary}"]
                await upsert_call_log_from_live(db, call_obj, recording_url=rec_url)
                await call_hub.broadcast("call_ended", {"callId": call_obj.id, "reason": status})
            else:
                call_obj.state = status
                await call_hub.broadcast("call_updated", {"callId": call_obj.id, "state": status})

        await db.commit()

    return {"ok": True, "call_id": call_id}
