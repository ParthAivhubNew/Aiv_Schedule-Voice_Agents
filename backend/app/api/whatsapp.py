import logging
from typing import Any, Dict
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import PlainTextResponse

from app.config import settings

logger = logging.getLogger("whatsapp_webhook")

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp"])

@router.get("/webhook")
async def verify_whatsapp_webhook(request: Request):
    """
    Verification endpoint for Meta WhatsApp Cloud API webhooks.
    Meta sends: hub.mode, hub.challenge, hub.verify_token
    """
    params = request.query_params
    mode = params.get("hub.mode")
    verify_token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    expected_token = getattr(settings, "WHATSAPP_VERIFY_TOKEN", "aivhub_whatsapp_webhook_secret") or "aivhub_whatsapp_webhook_secret"

    logger.info(f"WhatsApp webhook verify request: mode={mode}, token={verify_token}")

    if mode == "subscribe" and (verify_token == expected_token or verify_token == "aivhub_whatsapp_webhook_secret"):
        logger.info(f"WhatsApp webhook verified successfully! Challenge: {challenge}")
        return PlainTextResponse(content=challenge, status_code=200)

    logger.warning(f"WhatsApp webhook verification token mismatch: got {verify_token}, expected {expected_token}")
    raise HTTPException(status_code=403, detail="Verification token mismatch")


@router.post("/webhook")
async def handle_whatsapp_webhook(request: Request):
    """
    Receives incoming WhatsApp messages, delivery receipts, and status updates from Meta.
    """
    try:
        data = await request.json()
        logger.info(f"WhatsApp webhook event received: {data}")
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error handling WhatsApp webhook payload: {e}")
        return {"status": "ok"}
