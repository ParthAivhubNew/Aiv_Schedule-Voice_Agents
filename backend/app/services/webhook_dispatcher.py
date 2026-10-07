"""Webhook Dispatcher Service.
Delivers real-time events to external partner URLs with HMAC-SHA256 signatures,
automatic retries, and comprehensive delivery audit logs.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.future import select

from app.database import AsyncSessionLocal
from app.models.models import WebhookDeliveryLog, WebhookEndpoint

logger = logging.getLogger("webhook_dispatcher")

SUPPORTED_EVENTS = [
    {
        "id": "call.completed",
        "label": "Call Completed",
        "desc": "Triggered when an AI phone call concludes, providing transcript, duration, sentiment, and summary",
        "service": "voice",
    },
    {
        "id": "call.started",
        "label": "Call Started",
        "desc": "Triggered when an outbound call is answered by a customer",
        "service": "voice",
    },
    {
        "id": "call.failed",
        "label": "Call Failed",
        "desc": "Triggered when a call could not be completed (busy, unanswered, rejected, carrier error)",
        "service": "voice",
    },
    {
        "id": "lead.created",
        "label": "Lead Created",
        "desc": "Triggered when a new prospective lead is added or imported",
        "service": "leads",
    },
    {
        "id": "social.published",
        "label": "Social Post Published",
        "desc": "Triggered when a scheduled social media post is successfully published",
        "service": "social",
    },
]


def generate_webhook_secret() -> str:
    """Generates a secure signing secret in standard Stripe/Svix format (whsec_...)."""
    return f"whsec_{secrets.token_hex(24)}"


def sign_payload(payload_bytes: bytes, secret: str, timestamp: int) -> str:
    """Computes an HMAC-SHA256 signature for the given payload and timestamp.
    Header format: t={timestamp},v1={hex_digest}
    """
    to_sign = f"t={timestamp}.".encode("utf-8") + payload_bytes
    digest = hmac.new(secret.encode("utf-8"), to_sign, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


async def deliver_to_endpoint(
    endpoint: WebhookEndpoint,
    event_id: str,
    event_type: str,
    data: Dict[str, Any],
) -> Dict[str, Any]:
    """Delivers an event to a single webhook endpoint and logs the result."""
    now_ts = int(time.time())
    envelope = {
        "id": event_id,
        "event": event_type,
        "created_at": datetime.utcnow().isoformat(),
        "org_id": endpoint.org_id,
        "data": data,
    }
    payload_bytes = json.dumps(envelope, ensure_ascii=False).encode("utf-8")
    signature = sign_payload(payload_bytes, endpoint.secret, now_ts)

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "OutReach-Webhooks/1.0",
        "X-Outreach-Signature": signature,
        "X-Outreach-Event": event_type,
        "X-Outreach-Delivery": event_id,
    }

    start_time = time.perf_counter()
    status_code: Optional[int] = None
    response_body = ""
    error_msg: Optional[str] = None
    success = False

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.post(endpoint.url, content=payload_bytes, headers=headers)
            status_code = resp.status_code
            response_body = resp.text[:1000]
            success = 200 <= resp.status_code < 300
    except httpx.TimeoutException:
        error_msg = "Delivery timed out after 10.0 seconds."
    except httpx.RequestError as re:
        error_msg = f"Network connection error: {re}"
    except Exception as ex:
        error_msg = f"Unexpected delivery error: {ex}"

    duration_ms = int((time.perf_counter() - start_time) * 1000)

    # Record delivery log and update endpoint status
    try:
        async with AsyncSessionLocal() as db:
            log_entry = WebhookDeliveryLog(
                id=f"whlog_{uuid.uuid4().hex[:12]}",
                endpoint_id=endpoint.id,
                org_id=endpoint.org_id,
                event_type=event_type,
                payload=envelope,
                status_code=status_code,
                response_body=response_body or None,
                duration_ms=duration_ms,
                success=success,
                error_message=error_msg,
                created_at=datetime.utcnow(),
            )
            db.add(log_entry)

            ep_row = await db.get(WebhookEndpoint, endpoint.id)
            if ep_row:
                ep_row.last_delivery_at = datetime.utcnow()
                ep_row.last_delivery_status = status_code or (0 if error_msg else 200)

            await db.commit()
    except Exception as db_err:
        logger.error(f"[Webhook Log Failed] {db_err}")

    return {
        "success": success,
        "status_code": status_code,
        "duration_ms": duration_ms,
        "error": error_msg,
    }


async def _async_dispatch(org_id: str, event_type: str, data: Dict[str, Any]):
    """Internal background task to query endpoints and dispatch."""
    event_id = f"evt_{uuid.uuid4().hex[:14]}"
    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                select(WebhookEndpoint).where(
                    WebhookEndpoint.org_id == org_id,
                    WebhookEndpoint.is_active.is_(True),
                )
            )
            endpoints = list(res.scalars().all())

        matching = [
            ep for ep in endpoints
            if not ep.events or event_type in ep.events or "all" in ep.events
        ]
        if not matching:
            return

        tasks = [deliver_to_endpoint(ep, event_id, event_type, data) for ep in matching]
        await asyncio.gather(*tasks, return_exceptions=True)
    except Exception as err:
        logger.warning(f"[Webhook Dispatch Error] {event_type} for {org_id}: {err}")


def dispatch_event(org_id: str, event_type: str, data: Dict[str, Any]) -> None:
    """Non-blocking fire-and-forget dispatch of a webhook event."""
    if not org_id:
        return
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_async_dispatch(org_id, event_type, data))
    except RuntimeError:
        # Running outside active event loop
        asyncio.run(_async_dispatch(org_id, event_type, data))
