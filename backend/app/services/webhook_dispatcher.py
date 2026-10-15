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
import os
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
    # Voice AI & Calendar
    {"id": "call.completed", "label": "Call completed", "service": "voice",
     "desc": "An AI phone call finished. Includes the outcome, answers, transcript and any booked meeting."},
    {"id": "call.failed", "label": "Call failed", "service": "voice",
     "desc": "A call could not be completed (busy, unanswered, rejected, carrier error)."},
    {"id": "call.needs_human", "label": "Call needs a person", "service": "voice",
     "desc": "The AI asked for a person to step in, or the caller asked for one. Take over from the live call page."},
    {"id": "meeting.booked", "label": "Meeting booked", "service": "voice",
     "desc": "A meeting was booked, by the API or by an AI call."},
    # Lead Gen & Email Outreach
    {"id": "leads.ready", "label": "Lead search finished", "service": "leads",
     "desc": "A lead search (and any checks you asked for) is done."},
    {"id": "campaign.ready", "label": "Campaign ready to approve", "service": "leads",
     "desc": "An email campaign was drafted and is waiting for approval. Includes the preview link."},
    {"id": "campaign.approved", "label": "Campaign approved", "service": "leads",
     "desc": "An email campaign was approved and started sending."},
    {"id": "campaign.reply", "label": "Campaign reply", "service": "leads",
     "desc": "Someone replied to a campaign email."},
    {"id": "campaign.completed", "label": "Campaign finished", "service": "leads",
     "desc": "Every email in the campaign has been sent."},
    # Social Media Automation
    {"id": "post.ready", "label": "Post ready to approve", "service": "social",
     "desc": "A post was written and is waiting for approval. Includes the preview link."},
    {"id": "post.approved", "label": "Post approved", "service": "social",
     "desc": "A post was approved (by link, email, the app or the API) and is scheduled."},
    {"id": "post.published", "label": "Post published", "service": "social",
     "desc": "A post went live on its channels."},
    {"id": "post.rejected", "label": "Post rejected or cancelled", "service": "social",
     "desc": "A post was rejected or cancelled and will not go live."},
    {"id": "post.failed", "label": "Post failed", "service": "social",
     "desc": "A post could not be written or published. Includes the reason."},
]
API_VERSION = "2026-10"
# A failed delivery is tried again after each of these waits (seconds). Kept in memory:
# a restart drops retries that are still waiting.
RETRY_DELAYS = (10, 60)


def url_problem(url: str) -> Optional[str]:
    """Why a webhook address is not allowed, or None. Only the customer's own servers: never our network."""
    import ipaddress
    import socket
    from urllib.parse import urlparse

    u = urlparse((url or "").strip())
    host = (u.hostname or "").lower()
    if u.scheme not in ("https", "http") or not host:
        return "Webhook URLs must start with https://."
    if host in ("localhost", "127.0.0.1", "::1"):
        allowed = os.getenv("ALLOW_LOCAL_WEBHOOKS", "true").lower() in ("1", "true", "yes")
        return None if allowed else "That address is not allowed."
    allow_http = os.getenv("ALLOW_HTTP_WEBHOOKS", "true").lower() in ("1", "true", "yes")
    if u.scheme != "https" and not allow_http:
        return "Webhook URLs must use HTTPS."
    try:
        infos = socket.getaddrinfo(host, u.port or 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return "We could not find that address. Check the URL."
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return "That address points inside a private network, which is not allowed."
    return None


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
    test: bool = False,
) -> Dict[str, Any]:
    """Delivers an event to a single webhook endpoint and logs the result."""
    now_ts = int(time.time())
    envelope = {
        "id": event_id,
        "event": event_type,
        "api_version": API_VERSION,
        "livemode": not test,
        "created_at": datetime.utcnow().isoformat() + "Z",
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
    blocked = False

    try:
        problem = await asyncio.get_running_loop().run_in_executor(None, url_problem, endpoint.url)
        if problem:
            blocked = True
            raise PermissionError(problem)
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            resp = await client.post(endpoint.url, content=payload_bytes, headers=headers)
            status_code = resp.status_code
            response_body = resp.text[:1000]
            success = 200 <= resp.status_code < 300
    except PermissionError as refused:
        error_msg = str(refused)
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
        "blocked": blocked,
    }


async def _deliver_with_retries(ep: WebhookEndpoint, event_id: str, event_type: str, data: Dict[str, Any], test: bool) -> None:
    for wait in (0, *RETRY_DELAYS):
        if wait:
            await asyncio.sleep(wait)
        result = await deliver_to_endpoint(ep, event_id, event_type, data, test)
        # A refused address or a "no" from their server will not change by asking again.
        if result["success"] or result["blocked"] or (result.get("status_code") or 0) in (400, 401, 403, 404, 410):
            return


async def _async_dispatch(org_id: str, event_type: str, data: Dict[str, Any], test: bool = False):
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

        tasks = [_deliver_with_retries(ep, event_id, event_type, data, test) for ep in matching]
        await asyncio.gather(*tasks, return_exceptions=True)
    except Exception as err:
        logger.warning(f"[Webhook Dispatch Error] {event_type} for {org_id}: {err}")


_PENDING: set = set()


def dispatch_event(org_id: str, event_type: str, data: Dict[str, Any], test: bool = False) -> None:
    """Non-blocking fire-and-forget dispatch of a webhook event."""
    if not org_id:
        return
    if not test:  # other plugins in this app hear about it too (see services/connections.py)
        try:
            from app.services import connections

            connections.emit(org_id, event_type, data, str(data.get("id") or data.get("call_id") or ""))
        except Exception:
            pass
    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(_async_dispatch(org_id, event_type, data, test))
        _PENDING.add(task)  # keep a reference so the task is not dropped before it finishes
        task.add_done_callback(_PENDING.discard)
    except RuntimeError:
        # Running outside active event loop
        asyncio.run(_async_dispatch(org_id, event_type, data, test))
