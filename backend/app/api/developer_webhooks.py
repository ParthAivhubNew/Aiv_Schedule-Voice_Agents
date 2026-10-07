"""Developer Webhook Configuration API.
Allows external partners to configure target webhook URLs, select event subscriptions,
obtain signing secrets, and trigger test ping deliveries.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import WebhookDeliveryLog, WebhookEndpoint
from app.services.webhook_dispatcher import (
    SUPPORTED_EVENTS,
    deliver_to_endpoint,
    generate_webhook_secret,
)

logger = logging.getLogger("developer_webhooks")
router = APIRouter(prefix="/developer/webhooks", tags=["Developer Webhooks"])


class CreateWebhookRequest(BaseModel):
    url: str = Field(..., description="HTTPS endpoint URL to receive webhook POST requests")
    description: Optional[str] = Field("", description="Optional label e.g. 'Tender Lead CRM Hook'")
    events: List[str] = Field(
        default_factory=lambda: ["call.completed", "call.failed"],
        description="Subscribed event types",
    )


class UpdateWebhookRequest(BaseModel):
    url: Optional[str] = None
    description: Optional[str] = None
    events: Optional[List[str]] = None
    is_active: Optional[bool] = None


def _format_endpoint(ep: WebhookEndpoint) -> Dict[str, Any]:
    return {
        "id": ep.id,
        "url": ep.url,
        "secret": ep.secret,
        "description": ep.description or "",
        "events": ep.events or ["call.completed"],
        "is_active": bool(ep.is_active),
        "last_delivery_at": ep.last_delivery_at.isoformat() if ep.last_delivery_at else None,
        "last_delivery_status": ep.last_delivery_status,
        "created_at": ep.created_at.isoformat() if ep.created_at else None,
    }


@router.get("")
async def list_webhooks(request: Request, db: AsyncSession = Depends(get_db)):
    """List all webhook endpoints configured for the authenticated organisation."""
    ctx = current(request)
    stmt = (
        select(WebhookEndpoint)
        .where(WebhookEndpoint.org_id == ctx["org_id"])
        .order_by(WebhookEndpoint.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "endpoints": [_format_endpoint(ep) for ep in rows],
        "supported_events": SUPPORTED_EVENTS,
    }


@router.post("")
async def create_webhook(
    body: CreateWebhookRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Register a new webhook endpoint URL with a generated signing secret."""
    ctx = current(request)
    url = body.url.strip()

    if not url.startswith("https://") and not (url.startswith("http://localhost") or url.startswith("http://127.0.0.1")):
        raise HTTPException(
            status_code=400,
            detail="Webhook URLs must use HTTPS (or localhost for development).",
        )

    # Filter events to known supported events
    clean_events = [e for e in body.events if any(se["id"] == e for se in SUPPORTED_EVENTS)]
    if not clean_events:
        clean_events = ["call.completed", "call.failed"]

    secret = generate_webhook_secret()
    ep_id = f"wh_{uuid.uuid4().hex[:12]}"

    endpoint = WebhookEndpoint(
        id=ep_id,
        org_id=ctx["org_id"],
        url=url,
        secret=secret,
        description=body.description or "",
        events=clean_events,
        is_active=True,
        created_at=datetime.utcnow(),
    )
    db.add(endpoint)
    await db.commit()
    await db.refresh(endpoint)

    return {
        "endpoint": _format_endpoint(endpoint),
        "message": "Webhook endpoint registered successfully. Use the signing secret to verify signatures.",
    }


@router.patch("/{endpoint_id}")
async def update_webhook(
    endpoint_id: str,
    body: UpdateWebhookRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update URL, description, events, or active status of a webhook."""
    ctx = current(request)
    ep = await db.get(WebhookEndpoint, endpoint_id)
    if not ep or ep.org_id != ctx["org_id"]:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found.")

    if body.url is not None:
        url = body.url.strip()
        if not url.startswith("https://") and not (url.startswith("http://localhost") or url.startswith("http://127.0.0.1")):
            raise HTTPException(status_code=400, detail="Webhook URLs must use HTTPS.")
        ep.url = url
    if body.description is not None:
        ep.description = body.description.strip()
    if body.events is not None:
        ep.events = [e for e in body.events if any(se["id"] == e for se in SUPPORTED_EVENTS)] or ["call.completed"]
    if body.is_active is not None:
        ep.is_active = body.is_active

    await db.commit()
    await db.refresh(ep)
    return {"endpoint": _format_endpoint(ep)}


@router.delete("/{endpoint_id}")
async def delete_webhook(
    endpoint_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a webhook endpoint."""
    ctx = current(request)
    ep = await db.get(WebhookEndpoint, endpoint_id)
    if not ep or ep.org_id != ctx["org_id"]:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found.")

    await db.delete(ep)
    await db.commit()
    return {"status": "deleted", "id": endpoint_id}


@router.post("/{endpoint_id}/test")
async def send_test_webhook(
    endpoint_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Send a real-time synthetic test event to verify the endpoint is reachable."""
    ctx = current(request)
    ep = await db.get(WebhookEndpoint, endpoint_id)
    if not ep or ep.org_id != ctx["org_id"]:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found.")

    test_data = {
        "event_id": f"evt_test_{uuid.uuid4().hex[:8]}",
        "type": "ping",
        "message": "This is a test notification from OutReach Developer Webhooks.",
        "sample_call": {
            "call_id": "call_sample_9841",
            "to": "+447911123456",
            "duration_seconds": 78,
            "sentiment": "positive",
            "summary": "Customer confirmed interest in tender proposal.",
        },
    }

    result = await deliver_to_endpoint(
        ep,
        event_id=f"evt_ping_{uuid.uuid4().hex[:10]}",
        event_type="test.ping",
        data=test_data,
    )
    return {
        "result": result,
        "endpoint": _format_endpoint(ep),
    }


@router.get("/{endpoint_id}/logs")
async def get_webhook_logs(
    endpoint_id: str,
    request: Request,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Fetch recent delivery attempts for an endpoint."""
    ctx = current(request)
    ep = await db.get(WebhookEndpoint, endpoint_id)
    if not ep or ep.org_id != ctx["org_id"]:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found.")

    stmt = (
        select(WebhookDeliveryLog)
        .where(WebhookDeliveryLog.endpoint_id == endpoint_id)
        .order_by(WebhookDeliveryLog.created_at.desc())
        .limit(min(100, max(1, limit)))
    )
    logs = (await db.execute(stmt)).scalars().all()
    return {
        "logs": [
            {
                "id": l.id,
                "event_type": l.event_type,
                "status_code": l.status_code,
                "success": bool(l.success),
                "duration_ms": l.duration_ms,
                "error_message": l.error_message,
                "created_at": l.created_at.isoformat() if l.created_at else None,
            }
            for l in logs
        ]
    }
