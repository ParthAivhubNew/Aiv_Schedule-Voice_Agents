import asyncio
import json
import logging
from typing import Optional
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse

from app.config import settings
from app.services.xai_voice_service import (
    verify_xai_webhook_signature,
    join_xai_call_session
)
from app.services.process_logger import log_process_event

logger = logging.getLogger("sip_webhook")

router = APIRouter(prefix="/sip-webhook", tags=["SIP & Voice Webhooks"])

@router.post("")
@router.post("/")
async def handle_xai_sip_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Ultra-fast (<15ms) webhook handler for xAI Voice Agent Realtime SIP sessions.
    1. Extracts Svix headers (webhook-id, webhook-timestamp, webhook-signature).
    2. Validates HMAC signature against XAI_WEBHOOK_SECRET.
    3. Fires join_xai_call_session as non-blocking background task.
    4. Returns 200 OK immediately so xAI / Telnyx doesn't timeout or retry.
    """
    raw_body = await request.body()
    headers_dict = dict(request.headers)

    # 1. Signature Verification
    active_secret = settings.XAI_WEBHOOK_SECRET
    if not active_secret:
        try:
            from app.database import AsyncSessionLocal
            from app.models.models import Connection
            from sqlalchemy.future import select
            async with AsyncSessionLocal() as db:
                c_res = await db.execute(select(Connection).where(Connection.group_name == "Voice Orchestration"))
                c = c_res.scalars().first()
                if c and c.config and isinstance(c.config, dict):
                    active_secret = c.config.get("signing_secret")
                    if active_secret:
                        settings.XAI_WEBHOOK_SECRET = active_secret
        except Exception as lookup_err:
            logger.warning(f"Could not load signing_secret from database: {lookup_err}")

    is_valid = verify_xai_webhook_signature(
        payload_bytes=raw_body,
        headers=headers_dict,
        secret=active_secret
    )


    if not is_valid:
        await log_process_event(
            subsystem="telephony",
            process_name="webhook_signature_rejected",
            message="Incoming xAI SIP webhook rejected due to invalid Svix signature.",
            level="WARNING",
            details={"headers": {k: v for k, v in headers_dict.items() if "auth" not in k.lower() and "sig" not in k.lower()}}
        )
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # 2. Parse Event Payload
    try:
        data = json.loads(raw_body) if raw_body else {}
    except Exception as err:
        logger.error(f"Malformed JSON in webhook body: {err}")
        return JSONResponse(status_code=400, content={"error": "Malformed JSON payload"})

    # xAI provides call_id or session_id along with caller ('from') and callee ('to')
    call_id = data.get("call_id") or data.get("id") or f"call_{int(asyncio.get_event_loop().time())}"
    event_type = data.get("event") or data.get("type", "call.incoming")
    caller = data.get("from") or data.get("caller") or "+12025550199"
    callee = data.get("to") or data.get("callee") or settings.TELNYX_PHONE_NUMBER or "+18005550100"

    await log_process_event(
        subsystem="telephony",
        process_name="sip_webhook_received",
        message=f"Received verified xAI SIP webhook for call_id={call_id}, event={event_type}.",
        level="INFO",
        details={"callId": call_id, "event": event_type, "caller": caller, "callee": callee}
    )

    # 3. Handle Call Events
    if event_type in ["call.incoming", "call.initiated", "session.start", "call.answered"]:
        # Launch WebSocket session in background (fire-and-forget for instant <15ms 200 response)
        asyncio.create_task(
            join_xai_call_session(
                call_id=call_id,
                caller_number=caller,
                mission_name="Inbound Voice Call"
            )
        )
        return {
            "status": "accepted",
            "call_id": call_id,
            "message": "Call session initiated."
        }

    elif event_type in ["call.ended", "call.completed", "session.ended"]:
        await log_process_event(
            subsystem="telephony",
            process_name="sip_webhook_call_ended",
            message=f"Remote hangup notified via webhook for call_id={call_id}.",
            level="INFO",
            details={"callId": call_id}
        )
        return {"status": "ok", "call_id": call_id, "action": "ended"}

    # Default acknowledgment
    return {"status": "received", "call_id": call_id, "event": event_type}


@router.get("/health")
async def webhook_health_check():
    """Diagnostic endpoint to verify webhook route is accessible externally."""
    return {
        "status": "healthy",
        "route": "/api/sip-webhook",
        "voice_engine": "xAI Realtime API",
        "fqdn": settings.XAI_SIP_FQDN,
        "mode": settings.VOICE_ENGINE_MODE,
        "xai_configured": bool(settings.XAI_API_KEY),
        "secret_configured": bool(settings.XAI_WEBHOOK_SECRET)
    }
