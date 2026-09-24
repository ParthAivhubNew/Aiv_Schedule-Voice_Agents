"""
Retell AI REST API Router
Provides webhook reception for Retell live events and browser web call token issuance.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.retell_service import (
    create_retell_web_call,
    dispatch_retell_phone_call,
    process_retell_webhook_event,
    validate_retell_credentials,
)

logger = logging.getLogger("retell_router")

router = APIRouter(prefix="/retell", tags=["Retell AI"])


class RetellWebCallRequest(BaseModel):
    agent_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@router.post("/webhook")
async def retell_webhook(request: Request):
    """
    Receives incoming webhook notifications from Retell AI.
    Handles call started, ended, and post-call analysis.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    res = await process_retell_webhook_event(body)
    return res


@router.post("/web-call")
async def start_retell_web_call(req: RetellWebCallRequest):
    """
    Creates an interactive web call session on Retell for browser audio testing.
    """
    try:
        res = await create_retell_web_call(agent_id=req.agent_id, metadata=req.metadata)
        return res
    except Exception as e:
        logger.error("Failed to start Retell web call: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
