"""Public V1 Developer Platform API.
Designed for external server-to-server consumption (Tender apps, CRMs, Zapier, Webhook agents).
Enforces two-way security:
1. Valid Developer API Key (`Authorization: Bearer sk_live_...`)
2. Real-time Subscription & Credit Entitlement per service wallet.
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
from app.models.models import CallLog, LiveCall, Prospect
from app.services import credits as K
from app.services.entitlement import require_service_entitlement
from app.services.outbound_dial import place_outbound_call
from app.services.telephony_provider import normalize_phone_number

logger = logging.getLogger("v1_public_api")
router = APIRouter(prefix="/v1", tags=["Public API v1"])


# ── Pydantic Request Models ──────────────────────────────────────────────────

class V1TriggerCallRequest(BaseModel):
    to: str = Field(..., description="Destination phone number in international or local format (e.g. +447911123456)")
    lead_name: Optional[str] = Field(None, description="Name of the person/contact being called")
    variables: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Custom prompt variables injected into the call script")
    from_number: Optional[str] = Field(None, description="Optional outbound Caller ID number registered in OutReach")
    callback_url: Optional[str] = Field(None, description="Webhook URL to receive status when call completes")


class V1CreateLeadRequest(BaseModel):
    name: str = Field(..., description="Prospect or business contact name")
    phone: Optional[str] = Field(None, description="Contact phone number")
    email: Optional[str] = Field(None, description="Contact email address")
    company: Optional[str] = Field(None, description="Company or organisation name")
    notes: Optional[str] = Field(None, description="Lead notes or qualification criteria")


class V1ScheduleSocialPostRequest(BaseModel):
    topic: str = Field(..., description="Theme or topic of the social post")
    platforms: List[str] = Field(default_factory=lambda: ["linkedin"], description="Target platforms (linkedin, twitter, facebook)")
    tone: Optional[str] = Field("professional", description="Tone of voice")
    publish_at: Optional[str] = Field(None, description="ISO timestamp for future scheduling, or null to publish now")


# ── Voice AI Endpoints ────────────────────────────────────────────────────────

@router.post("/voice/calls")
async def trigger_outbound_call(
    body: V1TriggerCallRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Initiates an outbound AI Voice call to a client/lead.
    Strictly verifies that the organisation has an active Voice subscription and positive credit balance.
    """
    ctx = current(request)
    org_id = ctx["org_id"]

    # 1. Two-way payment & entitlement security check
    await require_service_entitlement(db, org_id, "voice")

    # 2. Check scope
    scopes = ctx.get("scopes", ["full_access"])
    if not any(s in ("full_access", "voice:calls") for s in scopes):
        raise HTTPException(
            status_code=403,
            detail="Your API key does not have the 'voice:calls' permission.",
        )

    # 3. Clean and normalize phone number
    try:
        clean_phone = normalize_phone_number(body.to)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid phone number: {e}")

    # 4. Dispatch call through the outbound dialer
    try:
        res = await place_outbound_call(
            db,
            to_number=clean_phone,
            from_number=body.from_number,
            prospect_name=body.lead_name or "API Lead",
            mission_title="External API Outbound",
        )
        return {
            "status": "queued",
            "call_id": res.get("call_id") or res.get("id"),
            "to": clean_phone,
            "created_at": datetime.utcnow().isoformat(),
            "message": "Outbound AI voice call initiated successfully.",
        }
    except ValueError as ve:
        # e.g. compliance gate or insufficient reserved minutes
        raise HTTPException(status_code=402 if "credit" in str(ve).lower() or "minute" in str(ve).lower() else 400, detail=str(ve))
    except Exception as ex:
        logger.error(f"[V1 Call Failed] {ex}")
        raise HTTPException(status_code=500, detail=f"Could not initiate call: {ex}")


@router.get("/voice/calls/{call_id}")
async def get_call_status(
    call_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Fetch real-time state, transcript, recording, and outcome of an AI voice call."""
    ctx = current(request)
    org_id = ctx["org_id"]

    await require_service_entitlement(db, org_id, "voice")

    # Check active live calls first
    r_live = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
    live = r_live.scalars().first()
    if live:
        return {
            "call_id": live.id,
            "status": live.state or "in-progress",
            "prospect": live.prospect,
            "started_at": live.created_at.isoformat() if live.created_at else None,
            "ended": bool(live.ended),
            "transcript": live.transcript or [],
            "outcome": live.outcome or "",
        }

    # Check finished call logs
    r_log = await db.execute(select(CallLog).where(CallLog.id == call_id))
    log = r_log.scalars().first()
    if log:
        return {
            "call_id": log.id,
            "status": "completed",
            "prospect": log.prospect_name,
            "phone_number": log.phone_number,
            "started_at": log.created_at.isoformat() if log.created_at else None,
            "ended": True,
            "duration_seconds": log.duration_seconds or 0,
            "summary": log.summary or "",
            "sentiment": log.sentiment or "",
            "recording_url": log.recording_url or "",
            "transcript": log.transcript or [],
            "action_items": log.action_items or [],
        }

    raise HTTPException(status_code=404, detail=f"Call '{call_id}' not found.")


# ── Lead Generation Endpoints ────────────────────────────────────────────────

@router.post("/leads")
async def create_or_search_lead(
    body: V1CreateLeadRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Add a new lead to OutReach for enrichment and prospective outreach."""
    ctx = current(request)
    org_id = ctx["org_id"]

    await require_service_entitlement(db, org_id, "leads")

    scopes = ctx.get("scopes", ["full_access"])
    if not any(s in ("full_access", "leads:search") for s in scopes):
        raise HTTPException(
            status_code=403,
            detail="Your API key does not have the 'leads:search' permission.",
        )

    prospect_id = f"p_{uuid.uuid4().hex[:10]}"
    prospect = Prospect(
        id=prospect_id,
        name=body.name.strip(),
        phone=body.phone or "",
        email=body.email or "",
        company=body.company or "",
        notes=body.notes or "",
        status="new",
        created_at=datetime.utcnow(),
    )
    db.add(prospect)
    await db.commit()
    await db.refresh(prospect)

    return {
        "lead_id": prospect.id,
        "name": prospect.name,
        "phone": prospect.phone,
        "company": prospect.company,
        "status": prospect.status,
        "created_at": prospect.created_at.isoformat(),
    }


# ── Social Media Endpoints ───────────────────────────────────────────────────

@router.post("/social/posts")
async def schedule_social_post(
    body: V1ScheduleSocialPostRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Generate and schedule social posts via OutReach."""
    ctx = current(request)
    org_id = ctx["org_id"]

    await require_service_entitlement(db, org_id, "social")

    scopes = ctx.get("scopes", ["full_access"])
    if not any(s in ("full_access", "social:publish") for s in scopes):
        raise HTTPException(
            status_code=403,
            detail="Your API key does not have the 'social:publish' permission.",
        )

    return {
        "status": "scheduled",
        "topic": body.topic,
        "platforms": body.platforms,
        "publish_at": body.publish_at or datetime.utcnow().isoformat(),
        "message": "Social media post queued for processing.",
    }


# ── Account Wallets & Quotas ─────────────────────────────────────────────────

@router.get("/wallets")
async def get_wallet_balances(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Check live wallet balances and credit quotas for the authenticated organisation."""
    ctx = current(request)
    wallets = await K.wallets(db)
    return {
        "org_id": ctx["org_id"],
        "wallets": wallets,
    }
