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
from app.public_api.core import V1Route, authorize
from app.public_api.social import router as social_router
from app.public_api.voice import router as voice_router
from app.database import get_db
from app.models.models import CallLog, LiveCall, Prospect, SocialPost
from app.services import credits as K
from app.services.entitlement import require_service_entitlement
from app.services.outbound_dial import place_outbound_call
from app.services.telephony_provider import normalize_phone_number

logger = logging.getLogger("v1_public_api")
router = APIRouter(prefix="/v1", tags=["Public API v1"], route_class=V1Route)


# ── Pydantic Request Models ──────────────────────────────────────────────────

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


# ── Lead Generation Endpoints ────────────────────────────────────────────────

@router.post("/leads")
async def create_or_search_lead(
    body: V1CreateLeadRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Add a new lead to OutReach for enrichment and prospective outreach."""
    await authorize(request, db, "leads:search", "leads")

    prospect_id = f"p_{uuid.uuid4().hex[:10]}"
    note = "\n".join(x for x in ((f"Company: {body.company.strip()}" if body.company else ""), (body.notes or "").strip()) if x)
    prospect = Prospect(
        id=prospect_id,
        name=body.name.strip(),
        phone=body.phone or "",
        email=body.email or "",
        note=note,
        status="queued",
        created_at=datetime.utcnow(),
    )
    db.add(prospect)
    await db.commit()
    await db.refresh(prospect)

    return {
        "lead_id": prospect.id,
        "name": prospect.name,
        "phone": prospect.phone,
        "company": body.company or "",
        "status": prospect.status,
        "created_at": prospect.created_at.isoformat(),
    }


# ── Account Wallets & Quotas ─────────────────────────────────────────────────

@router.get("/wallets")
async def get_wallet_balances(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Credits left, what each action costs, and what this key is allowed to do."""
    ctx = current(request)
    wallets = await K.wallets(db)
    card = await K.rates(db)
    return {
        "org_id": ctx["org_id"],
        "wallets": wallets,
        "prices": [
            {"item": item, "label": r.get("label", item), "unit": r.get("unit", ""), "credits": r.get("credits", 0),
             "wallet": r.get("wallet", ""), "charged": bool(r.get("charged", True))}
            for item, r in card.items()
        ],
        "key": {"id": ctx.get("key_id"), "name": ctx.get("name"), "scopes": ctx.get("scopes") or ["full_access"],
                "test_mode": bool(ctx.get("test"))},
    }


router.include_router(social_router)
router.include_router(voice_router)
