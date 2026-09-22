"""
LiveKit Voice & WebRTC Orchestration Service (Self-Hosted)
Handles token generation, room lifecycle management, server health probing,
and non-breaking WebRTC browser calling bridged to our AI voice pipeline.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx
from fastapi import Request

from app.config import settings
from app.services.process_logger import log_process_event

logger = logging.getLogger("livekit_service")

# Try importing livekit-api with graceful fallback
try:
    from livekit.api import AccessToken, VideoGrants, LiveKitAPI
    LIVEKIT_API_AVAILABLE = True
except Exception as e:
    logger.warning("livekit-api package not available or failed to import: %s", e)
    AccessToken = None
    VideoGrants = None
    LiveKitAPI = None
    LIVEKIT_API_AVAILABLE = False


def resolve_client_livekit_url(request: Optional[Request] = None) -> str:
    """
    Resolves the external WebSocket URL that the browser client should connect to.
    Prioritizes LIVEKIT_PUBLIC_URL if configured, or infers from the incoming request hostname.
    """
    if settings.LIVEKIT_PUBLIC_URL:
        return settings.LIVEKIT_PUBLIC_URL

    configured_url = settings.LIVEKIT_URL or "ws://localhost:7880"

    # If backend is running inside docker or behind reverse proxy, rewrite internal hostname
    parsed = urlparse(configured_url)
    hostname = parsed.hostname or "localhost"

    # If configured host is an internal docker container name (like 'livekit'), use the request host for the browser
    if hostname in ("livekit", "0.0.0.0", "127.0.0.1", "localhost") and request:
        req_host = request.headers.get("host", "").split(":")[0]
        if req_host and req_host not in ("livekit", "0.0.0.0"):
            scheme = "wss" if request.url.scheme == "https" else "ws"
            port = parsed.port or 7880
            return f"{scheme}://{req_host}:{port}"

    return configured_url


def generate_livekit_token(
    room_name: str,
    identity: str,
    name: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    is_agent: bool = False,
    can_publish: bool = True,
    can_subscribe: bool = True,
    ttl_seconds: int = 7200,
) -> str:
    """
    Generates a secure WebRTC JWT token for a participant joining a LiveKit room.
    """
    api_key = settings.LIVEKIT_API_KEY or "devkey"
    api_secret = settings.LIVEKIT_API_SECRET or "secret1234567890abcdef1234567890abcdef"
    display_name = name or identity

    meta_str = json.dumps(metadata) if metadata else ""

    from datetime import timedelta

    if LIVEKIT_API_AVAILABLE and AccessToken and VideoGrants:
        grants = VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=can_publish,
            can_subscribe=can_subscribe,
            can_publish_data=True,
            room_admin=is_agent,
        )
        token_builder = (
            AccessToken(api_key, api_secret)
            .with_identity(identity)
            .with_name(display_name)
            .with_grants(grants)
            .with_ttl(timedelta(seconds=ttl_seconds))
        )
        if meta_str:
            token_builder.with_metadata(meta_str)
        return token_builder.to_jwt()

    # Fallback JWT builder using PyJWT or python-jose
    try:
        import jwt
        payload = {
            "iss": api_key,
            "sub": identity,
            "name": display_name,
            "nbf": int(time.time()),
            "exp": int(time.time()) + ttl_seconds,
            "video": {
                "roomJoin": True,
                "room": room_name,
                "canPublish": can_publish,
                "canSubscribe": can_subscribe,
                "canPublishData": True,
                "roomAdmin": is_agent,
            },
        }
        if meta_str:
            payload["metadata"] = meta_str
        return jwt.encode(payload, api_secret, algorithm="HS256")
    except Exception as jwt_err:
        logger.error("Failed to generate fallback LiveKit token: %s", jwt_err)
        raise RuntimeError(f"Cannot generate LiveKit token: {jwt_err}")


async def check_livekit_health() -> Dict[str, Any]:
    """
    Probes the LiveKit server HTTP endpoint to verify operational health.
    Returns status, latency, and connection URL.
    """
    base_ws = settings.LIVEKIT_URL or "ws://localhost:7880"
    parsed = urlparse(base_ws)
    scheme = "https" if parsed.scheme == "wss" else "http"
    host = parsed.hostname or "localhost"
    port = parsed.port or 7880
    http_url = f"{scheme}://{host}:{port}"

    start_t = time.time()
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            # LiveKit server root returns 404 or OK on GET /
            resp = await client.get(f"{http_url}/")
            duration_ms = round((time.time() - start_t) * 1000, 1)
            # Any HTTP status code (200, 404) means the server is reachable and running
            return {
                "online": True,
                "url": base_ws,
                "http_url": http_url,
                "latency_ms": duration_ms,
                "status_code": resp.status_code,
                "details": f"LiveKit server is online and reachable ({duration_ms}ms).",
            }
    except Exception as e:
        duration_ms = round((time.time() - start_t) * 1000, 1)
        return {
            "online": False,
            "url": base_ws,
            "http_url": http_url,
            "latency_ms": duration_ms,
            "status_code": None,
            "error": str(e),
            "details": f"LiveKit server is not responding at {http_url}. Run 'docker compose up -d livekit' to start.",
        }


async def process_livekit_webhook_event(event_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Processes asynchronous event notifications from LiveKit server (room started, participant joined/left).
    Safely bridges into live call tracking and subsystem process logs.
    """
    event_type = event_data.get("event") or event_data.get("type", "unknown")
    room_info = event_data.get("room", {})
    participant_info = event_data.get("participant", {})

    room_name = room_info.get("name") or event_data.get("room_name", "")
    participant_identity = participant_info.get("identity") or event_data.get("identity", "")

    logger.info("[LiveKit Webhook] Received event: %s for room: %s, participant: %s", event_type, room_name, participant_identity)

    # Log to subsystem process logger
    try:
        await log_process_event(
            subsystem="voice",
            process_name=f"livekit_{event_type.lower()}",
            message=f"LiveKit WebRTC event: {event_type} in room '{room_name}' (identity: {participant_identity})",
            level="INFO",
            details={
                "event": event_type,
                "room": room_name,
                "identity": participant_identity,
            },
        )
    except Exception as log_err:
        logger.warning("Could not log LiveKit event to process_logger: %s", log_err)

    return {"status": "processed", "event": event_type, "room": room_name}
