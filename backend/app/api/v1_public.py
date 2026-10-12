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
from app.public_api.leads import router as leads_router
from app.public_api.email import router as email_router
from app.public_api.meetings import router as meetings_router
from app.public_api.run import router as run_router
from app.database import get_db
from app.models.models import CallLog, LiveCall, Prospect, SocialPost
from app.services import credits as K
from app.services.entitlement import require_service_entitlement
from app.services.outbound_dial import place_outbound_call
from app.services.telephony_provider import normalize_phone_number

logger = logging.getLogger("v1_public_api")
router = APIRouter(prefix="/v1", tags=["Public API v1"], route_class=V1Route)


# ── Pydantic Request Models ──────────────────────────────────────────────────

# ── Account Wallets & Quotas ─────────────────────────────────────────────────

@router.get("/wallets")
async def get_wallet_balances(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Credits left, what each action costs, what is connected and what this key is allowed to do."""
    from app.models.models import EmailMailbox, OrgPhoneNumber, SocialAccount
    from app.public_api import links
    from app.services import billing as B

    ctx = current(request)
    wallets = await K.wallets(db)
    card = await K.rates(db)
    channels = [{"channel": a.platform, "status": a.status, "name": a.label or a.handle or ""}
                for a in (await db.execute(select(SocialAccount))).scalars().all()]
    mailboxes = [{"email": m.email, "status": m.status, "daily_limit": m.daily_cap}
                 for m in (await db.execute(select(EmailMailbox))).scalars().all()]
    numbers = [n.e164 for n in (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.status == "active"))).scalars().all()]
    sub = await B.subscription_row(db)
    setup = [
        {"item": "social_channels", "ok": any(c["status"] == "connected" for c in channels), "needed_for": "social posts",
         "fix_url": links.fix_url("social_accounts")},
        {"item": "mailbox", "ok": any(m["status"] in ("active", "graduated", "warming", "connected") for m in mailboxes),
         "needed_for": "email campaigns", "fix_url": links.fix_url("mailboxes")},
        {"item": "phone_number", "ok": bool(numbers), "needed_for": "phone calls", "fix_url": links.fix_url("numbers")},
    ]
    return {
        "org_id": ctx["org_id"],
        "wallets": wallets,
        "prices": [
            {"item": item, "label": r.get("label", item), "unit": r.get("unit", ""), "credits": r.get("credits", 0),
             "wallet": r.get("wallet", ""), "charged": bool(r.get("charged", True))}
            for item, r in card.items()
        ],
        "plan": {"status": getattr(sub, "status", None) or "none", "services": sorted((getattr(sub, "plans", None) or {}).keys())},
        "connected": {"social_channels": channels, "mailboxes": mailboxes, "phone_numbers": numbers},
        "setup": setup,
        "key": {"id": ctx.get("key_id"), "name": ctx.get("name"), "scopes": ctx.get("scopes") or ["full_access"],
                "test_mode": bool(ctx.get("test"))},
    }


router.include_router(social_router)
router.include_router(voice_router)
router.include_router(leads_router)
router.include_router(email_router)
router.include_router(meetings_router)
router.include_router(run_router)
