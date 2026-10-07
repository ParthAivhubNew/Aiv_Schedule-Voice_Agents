"""Entitlement & Subscription Guards for OutReach Services.
Verifies whether an organisation has an active plan or positive credit balance
for specific modular services (Voice AI, Lead Gen, Social Scheduler).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import billing as B
from app.services import credits as K

logger = logging.getLogger("entitlement")

# Standard service names mapped to internal wallet keys
SERVICE_TO_WALLET: Dict[str, str] = {
    "voice": "voice",
    "leads": "leadgen",
    "leadgen": "leadgen",
    "social": "scheduler",
    "scheduler": "scheduler",
}

WALLET_TO_LABEL: Dict[str, str] = {
    "voice": "Voice Assistant",
    "leadgen": "Lead Generation",
    "scheduler": "Social Media",
}

# Scope to required service mapping
SCOPE_TO_SERVICE: Dict[str, str] = {
    "voice:calls": "voice",
    "leads:search": "leads",
    "social:publish": "social",
}


LIVE_SUB_STATUSES = ("active", "trialing", "past_due")


def is_platform_exempt(org_id: str) -> bool:
    """Aivhub house accounts and platform staff orgs are exempt from paywalls."""
    from app.core.auth_middleware import platform_org
    from app.core.platform import AIVHUB_ORG

    exempt_ids = {platform_org(), AIVHUB_ORG, "org_default", "org_outreach"}
    return org_id in exempt_ids


async def get_org_entitlements(db: AsyncSession, org_id: str) -> Dict[str, bool]:
    """Returns a dict indicating whether the organisation is entitled to each service:
    {"voice": bool, "leads": bool, "social": bool}
    """
    if is_platform_exempt(org_id):
        return {"voice": True, "leads": True, "social": True}

    wallets_dict = await K.wallets(db)
    sub = await B.subscription_row(db)
    sub_plans = (sub.plans or {}) if (sub and sub.status in LIVE_SUB_STATUSES) else {}

    # Map internal wallet keys (voice, leadgen, scheduler)
    wallet_map = {w.get("key"): w for w in wallets_dict}

    def _is_active(wallet_key: str) -> bool:
        w = wallet_map.get(wallet_key, {})
        has_sub = bool(sub_plans.get(wallet_key))
        has_balance = ((w.get("balance") or 0) + (w.get("held") or 0)) > 0
        return has_sub or has_balance

    return {
        "voice": _is_active("voice"),
        "leads": _is_active("leadgen"),
        "social": _is_active("scheduler"),
    }


async def require_service_entitlement(db: AsyncSession, org_id: str, service: str) -> None:
    """Verifies that the organisation has an active subscription or credit balance
    for the requested service. Raises HTTP 402 Payment Required if not.
    """
    canonical_service = SERVICE_TO_WALLET.get(service.lower(), service.lower())
    entitlements = await get_org_entitlements(db, org_id)

    # Convert to public service key
    pub_key = "leads" if canonical_service == "leadgen" else "social" if canonical_service == "scheduler" else canonical_service

    if not entitlements.get(pub_key, False):
        label = WALLET_TO_LABEL.get(canonical_service, service.capitalize())
        raise HTTPException(
            status_code=402,
            detail={
                "error": "service_not_subscribed",
                "service": pub_key,
                "message": f"Your organisation does not have an active {label} plan or credit balance. Please purchase a {label} subscription or top-up credits in OutReach.",
            },
        )
