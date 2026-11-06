"""The partner programme, from the account admin's side: apply, set up the integration, see who is connected.

Any organisation can ask to become a partner. Staff approve it in the admin portal (see admin_portal.py), which creates the
partner record. The partner then accepts the terms and sets its web addresses, return URLs and webhook address. Separately, any
account admin can see which partners are connected to their account and disconnect one.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api.developer_keys import admin_ctx
from app.database import get_db
from app.models.models import Operator, Organization, Partner, PartnerApplication, PartnerLink
from app.services import partners as PT
from app.services.webhook_dispatcher import url_problem

logger = logging.getLogger("partners")
router = APIRouter(prefix="/partner", tags=["Partner programme"])

LINK_PAGE = 100


class ApplyBody(BaseModel):
    company: str = Field(..., min_length=2, max_length=120)
    product: str = Field("", max_length=200)
    use_case: str = Field("", max_length=2000)
    expected_users: str = Field("", max_length=60)
    contact_name: str = Field("", max_length=120)
    contact_email: str = Field("", max_length=254)
    website: str = Field("", max_length=200)


class SettingsBody(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    allowed_origins: Optional[List[str]] = None
    return_urls: Optional[List[str]] = None
    logo_url: Optional[str] = Field(None, max_length=500)
    accent_color: Optional[str] = Field(None, max_length=20)
    webhook_url: Optional[str] = Field(None, max_length=500)
    welcome_credits: Optional[int] = Field(None, ge=0, le=1000)
    welcome_wallet: Optional[str] = Field(None, max_length=20)


def _who(ctx: Dict[str, Any]) -> str:
    return f"partner:{ctx.get('email') or ctx.get('username') or ctx.get('operator_id') or 'admin'}"


def _application_json(a: PartnerApplication) -> Dict[str, Any]:
    return {"id": a.id, "company": a.company, "product": a.product, "useCase": a.use_case, "expectedUsers": a.expected_users,
            "contactName": a.contact_name, "contactEmail": a.contact_email, "website": a.website, "status": a.status,
            "reviewNote": a.review_note or "", "createdAt": a.created_at.isoformat() if a.created_at else None,
            "reviewedAt": a.reviewed_at.isoformat() if a.reviewed_at else None}


async def _mine(db: AsyncSession, org_id: str) -> Optional[Partner]:
    return (await db.execute(select(Partner).where(Partner.owner_org_id == org_id))).scalars().first()


async def _partner_or_404(db: AsyncSession, org_id: str) -> Partner:
    p = await _mine(db, org_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Your organisation is not a partner yet. Apply first.")
    return p


@router.get("")
async def overview(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = admin_ctx(request)
    partner = await _mine(db, ctx["org_id"])
    apps = (await db.execute(select(PartnerApplication).where(PartnerApplication.owner_org_id == ctx["org_id"])
                             .order_by(PartnerApplication.created_at.desc()).limit(5))).scalars().all()
    out: Dict[str, Any] = {"partner": PT.partner_json(partner) if partner else None, "applications": [_application_json(a) for a in apps],
                           "termsVersion": PT.TERMS_VERSION, "consentVersion": PT.CONSENT_VERSION,
                           "scopeChoices": PT.DEFAULT_SCOPES}
    if partner is not None:
        counts = dict((await db.execute(select(PartnerLink.status, func.count()).where(PartnerLink.partner_id == partner.id)
                                        .group_by(PartnerLink.status))).all())
        out["links"] = {"active": counts.get("active", 0), "revoked": counts.get("revoked", 0)}
        out["termsAccepted"] = bool(partner.terms_accepted_at)
    return out


@router.get("/starter-kit")
async def starter_kit(request: Request, stack: str = "snippet", db: AsyncSession = Depends(get_db)):
    """A zip made for this partner: the files to drop into their project, their publishable key and addresses filled in, and a
    check they run to see what is still missing. The secret key is never in it."""
    from fastapi.responses import Response

    from app.config import settings
    from app.partner_kit import SNIPPET, STACKS, build, build_snippet

    ctx = admin_ctx(request)
    partner = await _partner_or_404(db, ctx["org_id"])
    if stack == SNIPPET:
        data = build_snippet(client_id=partner.client_id, host=(settings.PUBLIC_BASE_URL or "").strip(), company=partner.name or "")
        return Response(content=data, media_type="application/zip",
                        headers={"Content-Disposition": 'attachment; filename="outreach-for-your-product.zip"', "Cache-Control": "no-store"})
    if stack not in STACKS:
        raise HTTPException(status_code=422, detail=f"stack must be one of: {', '.join(STACKS)}")
    data = build(stack, client_id=partner.client_id, host=(settings.PUBLIC_BASE_URL or "").strip(),
                 origin=(partner.allowed_origins or [""])[0], company=partner.name or "")
    return Response(content=data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="outreach-starter-kit-{stack}.zip"', "Cache-Control": "no-store"})


@router.get("/starter-kit/stacks")
async def starter_kit_stacks(request: Request):
    from app.partner_kit import SNIPPET, STACKS

    admin_ctx(request)
    return [{"id": SNIPPET, "label": "One snippet, nothing on your server (recommended)"}] + [{"id": k, "label": v} for k, v in STACKS.items()]


class StartBody(BaseModel):
    name: str = Field("", max_length=120)
    accept_terms: bool = False


@router.post("/start")
async def start(body: StartBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Become a partner in test mode in one step: no application, no waiting. Staff only decide about going live."""
    from app.public_api.core import check_rate

    ctx = admin_ctx(request)
    existing = await _mine(db, ctx["org_id"])
    if existing is not None:
        if not existing.terms_accepted_at:
            if body.accept_terms is not True:
                raise HTTPException(status_code=422, detail="Agree to the partner terms to continue.")
            existing.terms_version, existing.terms_accepted_at = PT.TERMS_VERSION, datetime.utcnow()
            PT.audit(db, existing.id, _who(ctx), "terms_accepted", PT.TERMS_VERSION)
            await db.commit()
        return PT.partner_json(existing)
    if body.accept_terms is not True:
        raise HTTPException(status_code=422, detail="Agree to the partner terms to continue.")
    if check_rate(f"partnerstart:{ctx['org_id']}", True):
        raise HTTPException(status_code=429, detail="Too many tries. Wait a minute and try again.")
    org = (await db.execute(select(Organization.name).where(Organization.id == ctx["org_id"]))).scalar()
    p = await PT.start_partner(db, ctx["org_id"], body.name or org or "", _who(ctx))
    await db.commit()
    logger.info(f"[partners] {p.name} started in test mode ({p.id})")
    await PT.tell_owner(f"New partner started: {p.name}", [f"{p.name} started the partner programme in test mode. Nothing needs doing now.",
                                                          "They can ask to go live later; you will get another email then."])
    return PT.partner_json(p)


@router.post("/apply")
async def apply(body: ApplyBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = admin_ctx(request)
    if await _mine(db, ctx["org_id"]) is not None:
        raise HTTPException(status_code=409, detail="Your organisation is already a partner.")
    pending = (await db.execute(select(PartnerApplication).where(PartnerApplication.owner_org_id == ctx["org_id"],
                                                                 PartnerApplication.status == "pending"))).scalars().first()
    if pending is not None:
        raise HTTPException(status_code=409, detail="You already have an application waiting for review.")
    email = (body.contact_email or ctx.get("email") or "").strip()
    app_row = PartnerApplication(owner_org_id=ctx["org_id"], company=body.company.strip(), product=body.product.strip(),
                                 use_case=body.use_case.strip(), expected_users=body.expected_users.strip(),
                                 contact_name=(body.contact_name or ctx.get("name") or "").strip(), contact_email=email,
                                 website=body.website.strip(), status="pending")
    db.add(app_row)
    await db.commit()
    logger.info(f"[partners] {app_row.company} applied to become a partner ({app_row.id})")
    await PT.tell_owner(f"New partner application: {app_row.company}", [
        f"{app_row.company} has applied to join the partner programme and is waiting for your review.",
        f"Product: {app_row.product}", f"Use: {app_row.use_case}", f"Expected users: {app_row.expected_users or 'not said'}",
        f"Contact: {app_row.contact_name} {app_row.contact_email}".strip(), f"Website: {app_row.website or 'not given'}"])
    return _application_json(app_row)


@router.post("/accept-terms")
async def accept_terms(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    p.terms_version, p.terms_accepted_at = PT.TERMS_VERSION, datetime.utcnow()
    PT.audit(db, p.id, _who(ctx), "terms_accepted", PT.TERMS_VERSION)
    await db.commit()
    return PT.partner_json(p)


@router.put("/settings")
async def settings(body: SettingsBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    if body.name is not None and body.name.strip():
        p.name = body.name.strip()
    for label, values, is_return in (("web addresses", body.allowed_origins, False), ("return URLs", body.return_urls, True)):
        bad = PT.unreadable_addresses(values, is_return) if values is not None else []
        if bad:  # say so, instead of quietly keeping only the ones that happened to parse
            raise HTTPException(status_code=400, detail=f"These {label} could not be read: {', '.join(bad[:5])}. "
                                                        "Write each as a full address like https://app.yourproduct.com, one per line.")
    if body.allowed_origins is not None:
        p.allowed_origins = PT.clean_origins(body.allowed_origins)
    if body.return_urls is not None:
        p.return_urls = PT.clean_return_urls(body.return_urls)
    if body.logo_url is not None:
        p.logo_url = body.logo_url.strip()
    if body.accent_color is not None:
        color = body.accent_color.strip()
        if color and not (color.startswith("#") and len(color) in (4, 7) and all(c in "0123456789abcdefABCDEF" for c in color[1:])):
            raise HTTPException(status_code=400, detail="Colour must look like #3457D5.")
        p.accent_color = color
    if body.welcome_wallet is not None:
        from app.services.credits import WALLETS

        if body.welcome_wallet not in WALLETS:
            raise HTTPException(status_code=400, detail=f"welcome_wallet must be one of: {', '.join(WALLETS)}.")
        p.welcome_wallet = body.welcome_wallet
    if body.welcome_credits is not None:
        p.welcome_credits = body.welcome_credits
    changed = [n for n, v in (("name", body.name), ("web addresses", body.allowed_origins), ("return URLs", body.return_urls),
                              ("logo", body.logo_url), ("accent colour", body.accent_color), ("webhook address", body.webhook_url),
                              ("welcome credits", body.welcome_credits)) if v is not None]
    if changed:
        PT.audit(db, p.id, _who(ctx), "settings_changed", ", ".join(changed))
    resync = False
    if body.webhook_url is not None:
        url = body.webhook_url.strip()
        if url:
            problem = await asyncio.get_running_loop().run_in_executor(None, url_problem, url)
            if problem:
                raise HTTPException(status_code=400, detail=problem)
        if url != (p.webhook_url or ""):
            p.webhook_url, resync = url, True
            if url and not p.webhook_secret:
                p.webhook_secret = PT.new_webhook_secret()
    await db.commit()
    if resync:
        await PT.sync_webhooks(db, p)
        await db.commit()
    return PT.partner_json(p)


@router.post("/webhook-secret/rotate")
async def rotate_webhook_secret(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    p.webhook_secret = PT.new_webhook_secret()
    PT.audit(db, p.id, _who(ctx), "webhook_secret_rotated")
    await PT.sync_webhooks(db, p)
    await db.commit()
    return PT.partner_json(p)


@router.post("/secret/rotate")
async def rotate_secret(request: Request, db: AsyncSession = Depends(get_db)):
    """A new secret key for the partner's server (it asks for embed tokens with it). Shown once; the old one stops working."""
    from app.services import embed as EM

    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    if p.status == "suspended":
        raise HTTPException(status_code=403, detail="Your integration is paused. Contact the Outreach team.")
    raw, prefix, hashed = EM.new_secret(live=p.status == "live")
    p.secret_hash, p.secret_prefix = hashed, prefix
    PT.audit(db, p.id, _who(ctx), "secret_key_rotated", f"{'live' if p.status == 'live' else 'test'} key {prefix}")
    await db.commit()
    return {"secretKey": raw, "prefix": prefix, "mode": "live" if p.status == "live" else "test"}


class ThemeBody(BaseModel):
    variables: Dict[str, Any] = Field(default_factory=dict)


@router.put("/theme")
async def save_theme(body: ThemeBody, request: Request, db: AsyncSession = Depends(get_db)):
    """The default look of the partner's embedded screens. Anything that is not a valid value is refused, not quietly dropped."""
    from app.services import embed_theme as TH

    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    bad = TH.problems({"variables": body.variables})
    if bad:
        raise HTTPException(status_code=400, detail="These could not be used: " + "; ".join(bad[:6]) + ".")
    p.theme = TH.clean_appearance({"variables": body.variables})
    PT.audit(db, p.id, _who(ctx), "theme_saved")
    await db.commit()
    return PT.partner_json(p)


@router.post("/request-live")
async def request_live(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    if p.status == "live":
        raise HTTPException(status_code=409, detail="Your integration is already live.")
    if p.status == "suspended":
        raise HTTPException(status_code=403, detail="Your integration is paused. Contact the Outreach team.")
    if not p.terms_accepted_at:
        raise HTTPException(status_code=409, detail="Accept the partner terms first.")
    if not p.allowed_origins:
        raise HTTPException(status_code=409, detail="Add at least one web address (the page where Outreach will show) before going live.")
    p.live_requested_at = datetime.utcnow()
    PT.audit(db, p.id, _who(ctx), "live_requested")
    await db.commit()
    logger.info(f"[partners] {p.name} asks to go live ({p.id})")
    await PT.tell_owner(f"{p.name} is asking to go live", [
        f"{p.name} has finished testing in the sandbox and is asking to go live.",
        "Until you switch it to live, its users keep getting test keys that only simulate calls and posts.",
        f"Web addresses: {', '.join(p.allowed_origins or []) or 'none'}", f"Return URLs: {', '.join(p.return_urls or []) or 'none'}",
        "Open Partners, check the integration, and set the status to live."])
    return PT.partner_json(p)


async def _credits_used(partner_id: str, org_ids: List[str], days: int = 30) -> Dict[str, int]:
    """Credits each linked account used in the last `days` days through this partner's screens (only lines stamped with the partner)."""
    from datetime import timedelta

    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import CreditEntry

    if not org_ids:
        return {}
    since = datetime.utcnow() - timedelta(days=days)
    with system_scope():
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(select(CreditEntry.org_id, func.sum(-CreditEntry.amount)).where(
                CreditEntry.partner_id == partner_id, CreditEntry.kind == "usage", CreditEntry.created_at >= since,
                CreditEntry.org_id.in_(org_ids)).group_by(CreditEntry.org_id))).all()
    return {org: int(total or 0) for org, total in rows}


@router.get("/activity")
async def activity(request: Request, offset: int = 0, db: AsyncSession = Depends(get_db)):
    """What changed on this integration, newest first."""
    from app.models.models import PartnerAudit

    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    rows = (await db.execute(select(PartnerAudit).where(PartnerAudit.partner_id == p.id)
                             .order_by(PartnerAudit.created_at.desc()).offset(max(0, offset)).limit(LINK_PAGE))).scalars().all()
    return {"activity": PT.audit_json(rows)}


@router.get("/links")
async def links(request: Request, status: str = "", offset: int = 0, db: AsyncSession = Depends(get_db)):
    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    q = select(PartnerLink, Organization.name).join(Organization, Organization.id == PartnerLink.org_id, isouter=True) \
        .where(PartnerLink.partner_id == p.id)
    if status in ("active", "revoked"):
        q = q.where(PartnerLink.status == status)
    rows = (await db.execute(q.order_by(PartnerLink.created_at.desc()).offset(max(0, offset)).limit(LINK_PAGE))).all()
    used = await _credits_used(p.id, [l.org_id for l, _ in rows])
    return {"links": [{"id": l.id, "creditsUsed30d": used.get(l.org_id, 0), "orgId": l.org_id, "company": name or "", "status": l.status, "createdAccount": bool(l.created_account),
                       "consentVersion": l.consent_version, "externalId": l.external_id or "", "connectedAt": l.consented_at.isoformat() if l.consented_at else None,
                       "lastLoginAt": l.last_login_at.isoformat() if l.last_login_at else None,
                       "revokedBy": l.revoked_by or "", "revokedAt": l.revoked_at.isoformat() if l.revoked_at else None}
                      for l, name in rows]}


@router.get("/links/{link_id}/usage")
async def link_usage(link_id: str, request: Request, days: int = 30, user_id: str = "", db: AsyncSession = Depends(get_db)):
    """One client's credit use through this partner's screens, per person: by area, action and day, and the latest lines.
    The client comes from the partner's own link (never from the browser), and only while the link is active."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services import credits as K

    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    link = (await db.execute(select(PartnerLink).where(PartnerLink.id == link_id, PartnerLink.partner_id == p.id))).scalars().first()
    if not link:
        raise HTTPException(status_code=404, detail="That account isn't connected to you.")
    if link.status != "active":
        raise HTTPException(status_code=403, detail="This account is disconnected, so its usage is no longer shown.")
    with system_scope():
        async with AsyncSessionLocal() as s:
            data = await K.people_usage(s, "", True, max(1, min(int(days or 30), 365)), user_id, org_ids=[link.org_id], partner_id=p.id)
    return {"company": (await db.get(Organization, link.org_id)).name if link.org_id else "", **data}


class GiftBody(BaseModel):
    wallet: str = Field("leadgen", max_length=20)
    amount: int = Field(..., ge=1, le=100000)


@router.get("/wallet")
async def partner_wallet(request: Request, db: AsyncSession = Depends(get_db)):
    """What the partner has to share: its own wallets (top them up like any Outreach account) and its welcome gift."""
    from app.services import credits as K

    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    return {"wallets": [{"key": w["key"], "label": w["label"], "balance": w["balance"]} for w in await K.wallets(db)],
            "welcomeCredits": int(p.welcome_credits or 0), "welcomeWallet": p.welcome_wallet or "leadgen"}


@router.post("/links/{link_id}/credits")
async def give_credits(link_id: str, body: GiftBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Give a connected account credits from the partner's own wallet."""
    from app.services import partner_credits as PC

    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    link = (await db.execute(select(PartnerLink).where(PartnerLink.id == link_id, PartnerLink.partner_id == p.id))).scalars().first()
    if link is None:
        raise HTTPException(status_code=404, detail="That account is not connected to you.")
    try:
        return await PC.gift(p, link, body.wallet, body.amount, by=_who(ctx))
    except PC.GiftError as err:
        raise HTTPException(status_code=err.status, detail=err.message)


@router.delete("/links/{link_id}")
async def partner_disconnect(link_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """The partner stops acting for one account."""
    ctx = admin_ctx(request)
    p = await _partner_or_404(db, ctx["org_id"])
    link = (await db.execute(select(PartnerLink).where(PartnerLink.id == link_id, PartnerLink.partner_id == p.id))).scalars().first()
    if link is None:
        raise HTTPException(status_code=404, detail="That account is not connected to you.")
    await PT.revoke(db, link, "partner")
    await db.commit()
    return {"ok": True}


# ── The user's side: which partners are connected to my account ─────────────
@router.get("/connections")
async def connections(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = admin_ctx(request)
    rows = (await db.execute(select(PartnerLink, Partner).join(Partner, Partner.id == PartnerLink.partner_id)
                             .where(PartnerLink.org_id == ctx["org_id"], PartnerLink.status == "active"))).all()
    return {"connections": [{"id": l.id, "partner": p.name, "connectedAt": l.consented_at.isoformat() if l.consented_at else None,
                             "createdAccount": bool(l.created_account), "consentVersion": l.consent_version} for l, p in rows]}


@router.delete("/connections/{link_id}")
async def disconnect(link_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """The account's admin disconnects a partner: its key stops working at once."""
    ctx = admin_ctx(request)
    link = (await db.execute(select(PartnerLink).where(PartnerLink.id == link_id, PartnerLink.org_id == ctx["org_id"]))).scalars().first()
    if link is None or link.status != "active":
        raise HTTPException(status_code=404, detail="That connection was not found.")
    await PT.revoke(db, link, "user")
    await db.commit()
    return {"ok": True}
