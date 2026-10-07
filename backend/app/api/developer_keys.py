"""Developer API Key management (CRUD for external partner API access)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current, forget_api_keys
from app.core.security import generate_api_key
from app.database import get_db
from app.models.models import ApiKey
from app.services.entitlement import get_org_entitlements, SCOPE_TO_SERVICE

router = APIRouter(prefix="/developer/keys", tags=["Developer API"])

AVAILABLE_SCOPES = [
    {"id": "voice:calls", "label": "Voice Assistant", "desc": "Can trigger outbound calls, fetch recordings and transcripts", "service": "voice"},
    {"id": "leads:search", "label": "Lead Generation", "desc": "Can search and enrich company and contact leads", "service": "leads"},
    {"id": "social:publish", "label": "Social Scheduler", "desc": "Can generate copy and schedule/publish social posts", "service": "social"},
    {"id": "wallets:read", "label": "Wallets & Usage", "desc": "Can check remaining balances and credit quotas", "service": "any"},
    {"id": "full_access", "label": "Full Access", "desc": "Full access to all subscribed services", "service": "all"},
]


class CreateApiKeyRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, description="Friendly label for the API key")
    scopes: List[str] = Field(default_factory=lambda: ["voice:calls"], description="Allowed API capabilities")
    live: bool = Field(default=True, description="True for live key (sk_live_), False for test key (sk_test_)")


class UpdateApiKeyRequest(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    scopes: Optional[List[str]] = None


def _format_key(key: ApiKey) -> Dict[str, Any]:
    return {
        "id": key.id,
        "name": key.name,
        "prefix": key.prefix,
        "scopes": key.scopes or ["full_access"],
        "is_active": bool(key.is_active),
        "last_used_at": key.last_used_at.isoformat() if key.last_used_at else None,
        "created_at": key.created_at.isoformat() if key.created_at else None,
        "expires_at": key.expires_at.isoformat() if key.expires_at else None,
    }


@router.get("")
async def list_api_keys(request: Request, db: AsyncSession = Depends(get_db)):
    """List all developer API keys for the current organization along with entitlement status."""
    ctx = current(request)
    entitlements = await get_org_entitlements(db, ctx["org_id"])
    has_any = any(entitlements.values())

    stmt = select(ApiKey).where(ApiKey.org_id == ctx["org_id"]).order_by(ApiKey.created_at.desc())
    keys = (await db.execute(stmt)).scalars().all()

    # Decorate scopes with locked/unlocked status
    decorated_scopes = []
    for sc in AVAILABLE_SCOPES:
        svc = sc["service"]
        if svc == "all":
            unlocked = all(entitlements.values())
        elif svc == "any":
            unlocked = has_any
        else:
            unlocked = bool(entitlements.get(svc))
        decorated_scopes.append({**sc, "unlocked": unlocked})

    return {
        "keys": [_format_key(k) for k in keys],
        "available_scopes": decorated_scopes,
        "entitlements": entitlements,
        "has_any_subscription": has_any,
    }


@router.post("")
async def create_api_key(
    body: CreateApiKeyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Generate a new developer API key. Rejects if the organization has no active subscription or credits."""
    ctx = current(request)
    entitlements = await get_org_entitlements(db, ctx["org_id"])
    has_any = any(entitlements.values())

    if not has_any:
        raise HTTPException(
            status_code=402,
            detail="Subscription required. You must subscribe to at least one service (Voice, Leads, or Social) before generating API keys."
        )

    # Validate that every requested scope belongs to an active subscribed service
    clean_scopes = []
    for s in body.scopes:
        if s == "full_access":
            if not all(entitlements.values()):
                # Auto-downgrade to only the scopes for services they actually own
                for svc, is_on in entitlements.items():
                    if is_on:
                        if svc == "voice": clean_scopes.append("voice:calls")
                        elif svc == "leads": clean_scopes.append("leads:search")
                        elif svc == "social": clean_scopes.append("social:publish")
                continue
            clean_scopes.append("full_access")
        elif s == "wallets:read":
            clean_scopes.append(s)
        elif s in SCOPE_TO_SERVICE:
            svc_needed = SCOPE_TO_SERVICE[s]
            if not entitlements.get(svc_needed):
                label = svc_needed.capitalize()
                raise HTTPException(
                    status_code=402,
                    detail=f"Subscription required. You must purchase a {label} plan or credits to generate a key with the '{s}' permission."
                )
            clean_scopes.append(s)

    clean_scopes = list(dict.fromkeys(clean_scopes))  # remove duplicates preserving order
    if not clean_scopes:
        # Default to first active service
        if entitlements.get("voice"): clean_scopes = ["voice:calls"]
        elif entitlements.get("leads"): clean_scopes = ["leads:search"]
        elif entitlements.get("social"): clean_scopes = ["social:publish"]
        else: clean_scopes = ["wallets:read"]

    raw_key, prefix, hashed_key = generate_api_key(live=body.live)
    key_id = f"key_{uuid.uuid4().hex[:12]}"

    row = ApiKey(
        id=key_id,
        org_id=ctx["org_id"],
        created_by_id=ctx.get("operator_id"),
        name=body.name.strip(),
        prefix=prefix,
        hashed_key=hashed_key,
        scopes=clean_scopes,
        is_active=True,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    forget_api_keys()

    return {
        "key": _format_key(row),
        "secret": raw_key,
        "message": "Store this secret key safely. You will not be able to see it again.",
    }


@router.patch("/{key_id}")
async def update_api_key(
    key_id: str,
    body: UpdateApiKeyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Enable/disable a key, or change its name or scopes."""
    ctx = current(request)
    stmt = select(ApiKey).where(ApiKey.id == key_id, ApiKey.org_id == ctx["org_id"])
    row = (await db.execute(stmt)).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="API key not found.")

    if body.name is not None and body.name.strip():
        row.name = body.name.strip()
    if body.is_active is not None:
        row.is_active = bool(body.is_active)
    if body.scopes is not None:
        clean = [s for s in body.scopes if any(a["id"] == s for a in AVAILABLE_SCOPES)]
        if clean:
            row.scopes = clean

    await db.commit()
    forget_api_keys()
    return _format_key(row)


@router.delete("/{key_id}")
async def revoke_api_key(
    key_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete / revoke an API key."""
    ctx = current(request)
    stmt = select(ApiKey).where(ApiKey.id == key_id, ApiKey.org_id == ctx["org_id"])
    row = (await db.execute(stmt)).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="API key not found.")

    await db.delete(row)
    await db.commit()
    forget_api_keys()
    return {"revoked": True, "id": key_id}
