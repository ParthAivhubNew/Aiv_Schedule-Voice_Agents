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

    # --- DEBUG: Log every incoming webhook hit with full details ---
    safe_headers = {k: v for k, v in headers_dict.items()
                    if "auth" not in k.lower() and "secret" not in k.lower()}
    try:
        body_preview = raw_body[:2000].decode("utf-8", errors="replace")
    except Exception:
        body_preview = f"<binary {len(raw_body)} bytes>"

    logger.info(
        f"[SIP-WEBHOOK] Incoming POST received. "
        f"Body length: {len(raw_body)} bytes. "
        f"Headers: {json.dumps(safe_headers, default=str)}"
    )
    logger.info(f"[SIP-WEBHOOK] Body preview: {body_preview}")

    await log_process_event(
        subsystem="telephony",
        process_name="sip_webhook_hit",
        message=f"xAI SIP webhook endpoint received a POST ({len(raw_body)} bytes).",
        level="INFO",
        details={
            "bodyLength": len(raw_body),
            "bodyPreview": body_preview[:500],
            "headers": safe_headers,
            "hasWebhookId": "webhook-id" in headers_dict or "Webhook-Id" in headers_dict,
            "hasWebhookSig": "webhook-signature" in headers_dict or "Webhook-Signature" in headers_dict,
        }
    )

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
                        logger.info(f"[SIP-WEBHOOK] Loaded signing secret from DB (starts with: {active_secret[:10]}...)")
        except Exception as lookup_err:
            logger.warning(f"Could not load signing_secret from database: {lookup_err}")

    logger.info(f"[SIP-WEBHOOK] Signature verification: secret configured={bool(active_secret)}")

    is_valid = verify_xai_webhook_signature(
        payload_bytes=raw_body,
        headers=headers_dict,
        secret=active_secret
    )

    if not is_valid:
        await log_process_event(
            subsystem="telephony",
            process_name="webhook_signature_rejected",
            message="Incoming xAI SIP webhook REJECTED — invalid Svix signature. Check signing secret.",
            level="ERROR",
            details={
                "headers": safe_headers,
                "secretConfigured": bool(active_secret),
                "secretPrefix": active_secret[:12] + "..." if active_secret else "NONE",
            }
        )
        logger.error(
            f"[SIP-WEBHOOK] SIGNATURE REJECTED. "
            f"Secret configured: {bool(active_secret)}. "
            f"Secret prefix: {active_secret[:12] + '...' if active_secret else 'NONE'}"
        )
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    logger.info("[SIP-WEBHOOK] Signature verification PASSED ✓")

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

    logger.info(
        f"[SIP-WEBHOOK] Parsed event: type={event_type}, call_id={call_id}, "
        f"caller={caller}, callee={callee}"
    )

    await log_process_event(
        subsystem="telephony",
        process_name="sip_webhook_received",
        message=f"Verified xAI SIP webhook: call_id={call_id}, event={event_type}, caller={caller}.",
        level="SUCCESS",
        details={"callId": call_id, "event": event_type, "caller": caller, "callee": callee, "fullPayload": data}
    )

    # 3. Handle Call Events
    if event_type in ["call.incoming", "call.initiated", "session.start", "call.answered",
                       "realtime.call.incoming", "realtime.session.start"]:
        logger.info(f"[SIP-WEBHOOK] Launching join_xai_call_session for call_id={call_id}...")
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

    elif event_type in ["call.ended", "call.completed", "session.ended",
                         "realtime.call.ended", "realtime.session.ended"]:
        await log_process_event(
            subsystem="telephony",
            process_name="sip_webhook_call_ended",
            message=f"Remote hangup notified via webhook for call_id={call_id}.",
            level="INFO",
            details={"callId": call_id}
        )
        return {"status": "ok", "call_id": call_id, "action": "ended"}

    # Default acknowledgment
    logger.info(f"[SIP-WEBHOOK] Unhandled event type: {event_type} — acknowledged.")
    return {"status": "received", "call_id": call_id, "event": event_type}


@router.post("/test")
async def webhook_test_endpoint(request: Request):
    """
    Diagnostic endpoint that accepts any POST and logs it.
    Use to verify the server is externally reachable from xAI / Twilio.
    """
    raw_body = await request.body()
    headers_dict = dict(request.headers)
    safe_headers = {k: v for k, v in headers_dict.items()
                    if "auth" not in k.lower() and "secret" not in k.lower()}
    try:
        body_str = raw_body[:1000].decode("utf-8", errors="replace")
    except Exception:
        body_str = f"<binary {len(raw_body)} bytes>"

    logger.info(f"[SIP-WEBHOOK-TEST] Received test POST: {body_str}")
    await log_process_event(
        subsystem="telephony",
        process_name="webhook_test_hit",
        message=f"Webhook test endpoint received a POST ({len(raw_body)} bytes).",
        level="INFO",
        details={"body": body_str, "headers": safe_headers}
    )
    return {
        "status": "reachable",
        "received_bytes": len(raw_body),
        "body_preview": body_str,
        "message": "This endpoint is externally reachable."
    }


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
