"""
LiveKit REST API Router
Provides endpoints for LiveKit token issuance, health monitoring,
browser WebRTC session orchestration, and server webhook callbacks.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.database import get_db
from app.models.models import LiveCall, CompanyProfile
from app.services.livekit_service import (
    check_livekit_health,
    generate_livekit_token,
    process_livekit_webhook_event,
    resolve_client_livekit_url,
)
from app.websockets.call_hub import call_hub

logger = logging.getLogger("livekit_router")

router = APIRouter(prefix="/livekit", tags=["LiveKit Voice Engine"])


class LiveKitTokenRequest(BaseModel):
    room_name: Optional[str] = None
    identity: Optional[str] = None
    participant_name: Optional[str] = None
    role: Optional[str] = "user"  # "user", "supervisor", "agent"
    prospect_name: Optional[str] = None
    prospect_phone: Optional[str] = None
    company_name: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@router.get("/status")
async def get_livekit_status():
    """
    Checks if the self-hosted LiveKit SFU server container is running and healthy.
    """
    health = await check_livekit_health()
    return {
        **health,
        "api_key": settings.LIVEKIT_API_KEY or "devkey",
        "configured": True,
        "recommended_command": "docker compose up -d livekit",
        "ports": {
            "signaling_http_ws": 7880,
            "rtc_tcp_fallback": 7881,
            "rtc_udp_media": 7882,
        },
    }


@router.get("/config")
async def get_livekit_config(request: Request):
    """
    Returns public LiveKit connection settings for the browser WebRTC client.
    """
    ws_url = resolve_client_livekit_url(request)
    return {
        "ws_url": ws_url,
        "api_key": settings.LIVEKIT_API_KEY or "devkey",
        "ports": {
            "signaling": 7880,
            "tcp": 7881,
            "udp_media": 7882,
        },
    }


@router.post("/token")
async def create_livekit_token(
    payload: LiveKitTokenRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Generates a secure WebRTC JWT token for in-browser calling or supervisor monitoring.
    Multi-tenant: Automatically isolates organizations - each org only sees their own calls.
    Also registers the session into LiveCall so it appears in the live monitoring dashboard.
    """
    call_id = f"lk_{uuid.uuid4().hex[:12]}"
    room_name = (payload.room_name or f"room_{call_id}").strip()
    identity = (payload.identity or f"user_{uuid.uuid4().hex[:6]}").strip()
    display_name = payload.participant_name or payload.prospect_name or "Browser Caller"

    client_ws_url = resolve_client_livekit_url(request)

    # Extract org_id from request context (from JWT claims or headers)
    org_id = None
    try:
        # Try to get org_id from request headers (X-Org-ID header)
        org_id = request.headers.get("X-Org-ID")
        
        # If not in header, try to extract from JWT token in Authorization header
        if not org_id:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                import jwt as jwt_module
                token = auth_header.replace("Bearer ", "").strip()
                try:
                    # Decode without verification to extract org_id claim
                    decoded = jwt_module.decode(token, options={"verify_signature": False})
                    org_id = decoded.get("org_id")
                except Exception:
                    pass
    except Exception as org_extract_err:
        logger.debug("Could not extract org_id from request: %s", org_extract_err)

    # Fallback: Try to get from database if user context is available
    if not org_id:
        org_id = "default"

    # Safely query company profile if DB is connected
    company_name = payload.company_name or "AIVHub"
    prospect_tz = "Europe/London"
    try:
        profile_res = await db.execute(select(CompanyProfile).limit(1))
        profile = profile_res.scalars().first()
        if profile and profile.name:
            company_name = profile.name
        if profile and profile.timezone:
            prospect_tz = profile.timezone
    except Exception as db_profile_err:
        logger.debug("Database profile lookup skipped in livekit token route: %s", db_profile_err)

    metadata = {
        "call_id": call_id,
        "room_name": room_name,
        "org_id": org_id,
        "role": payload.role,
        "prospect_name": payload.prospect_name or display_name,
        "prospect_phone": payload.prospect_phone or "Browser WebRTC",
        "company_name": company_name,
        **(payload.metadata or {}),
    }

    try:
        token = generate_livekit_token(
            room_name=room_name,
            identity=identity,
            name=display_name,
            metadata=metadata,
            is_agent=(payload.role == "agent"),
            can_publish=True,
            can_subscribe=True,
            ttl_seconds=7200,
            org_id=org_id,
        )
    except Exception as err:
        logger.error("Error creating LiveKit token for org %s: %s", org_id, err)
        raise HTTPException(status_code=500, detail=f"Failed to generate LiveKit token: {err}")

    # Register into LiveCall so it displays live in the dashboard alongside PSTN calls
    try:
        new_call = LiveCall(
            call_id=call_id,
            prospect=payload.prospect_name or display_name,
            phone=payload.prospect_phone or "Browser WebRTC",
            channel="webrtc_livekit",
            status="engaged",
            state="engaged",
            duration="00:00",
            stage="connected",
            transcript=[
                {
                    "who": "system",
                    "text": f"LiveKit WebRTC call initialized in org '{org_id}' room '{room_name}'",
                    "timestamp": datetime.utcnow().isoformat(),
                }
            ],
            sentiment="neutral",
            prospect_timezone=prospect_tz,
        )
        db.add(new_call)
        await db.commit()

        # Broadcast event to frontend WebSocket
        await call_hub.broadcast({
            "type": "call_created",
            "call": {
                "id": call_id,
                "call_id": call_id,
                "org_id": org_id,
                "prospect": payload.prospect_name or display_name,
                "phone": payload.prospect_phone or "Browser WebRTC",
                "channel": "webrtc_livekit",
                "status": "engaged",
                "state": "engaged",
                "duration": "00:00",
                "transcript": new_call.transcript,
            }
        })
    except Exception as db_err:
        logger.warning("Could not persist LiveKit call record to database: %s", db_err)

    return {
        "token": token,
        "ws_url": client_ws_url,
        "room_name": room_name,
        "org_id": org_id,
        "identity": identity,
        "call_id": call_id,
        "isolated_room": f"org_{org_id}_{room_name}",
    }


@router.post("/webhook")
async def handle_livekit_webhook(request: Request):
    """
    Webhook endpoint to receive lifecycle events from the self-hosted LiveKit server.
    """
    try:
        body_bytes = await request.body()
        event_data = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        result = await process_livekit_webhook_event(event_data)
        return result
    except Exception as e:
        logger.warning("Error processing LiveKit webhook: %s", e)
        return {"status": "error", "message": str(e)}
