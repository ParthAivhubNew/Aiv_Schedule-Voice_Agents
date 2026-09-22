"""
Vapi Voice AI REST API Router
Provides webhook reception for Vapi live events and browser web call token issuance.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.services.vapi_service import (
    create_vapi_web_call,
    dispatch_vapi_phone_call,
    process_vapi_webhook_event,
    validate_vapi_credentials,
)

logger = logging.getLogger("vapi_router")

router = APIRouter(prefix="/vapi", tags=["Vapi Voice AI"])


class VapiWebCallRequest(BaseModel):
    assistant_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@router.post("/webhook")
async def vapi_webhook(request: Request):
    """
    Receives incoming webhook notifications from Vapi.
    Handles transcript updates, status changes, and end-of-call summaries.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    res = await process_vapi_webhook_event(body)
    return res


@router.post("/web-call")
async def start_vapi_web_call(req: VapiWebCallRequest):
    """
    Creates an interactive web call session on Vapi for browser audio testing.
    """
    try:
        res = await create_vapi_web_call(assistant_id=req.assistant_id, metadata=req.metadata)
        return res
    except Exception as e:
        logger.error("Failed to start Vapi web call: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
