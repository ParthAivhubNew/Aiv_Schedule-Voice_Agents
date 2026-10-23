"""Partners: companies that offer Outreach inside their own software.

A partner's own sign-up and login pages call POST /v1/run (the `auth` plugin) with the partner's `client_id`. We check the
partner is allowed, that the call comes from one of its web addresses, and that the user agreed to share access. The user
always owns a normal Outreach account; the partner gets a scoped API key for it, which works on /v1 only.
"""
from __future__ import annotations

import logging
import re
import secrets
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from fastapi import Request
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.security import generate_api_key
from app.database import AsyncSessionLocal
from app.models.models import ApiKey, Operator, Organization, Partner, PartnerLink, WebhookEndpoint

logger = logging.getLogger("partners")

TERMS_VERSION = "2026-10"  # the version of the partner terms a partner accepts in its dashboard
CONSENT_VERSION = "2026-10"  # the consent text a user must be shown (what the partner can access)
DEFAULT_SCOPES = ["voice:calls", "leads:search", "social:publish", "wallets:read"]
WEBHOOK_TAG = "partner:"  # description of the webhook address we register in a user's account for a partner
KEY_PREFIX = "Partner: "  # name of the API key issued to a partner for one account


class PartnerError(Exception):
    """A refusal the caller can show: status, a stable code and a message."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


async def tell_owner(subject: str, lines: List[str]) -> None:
    """Email the software owner's staff admins about something a partner did that needs a decision. Never raises."""
    import html

    try:
        from app.core.mailer import render_owner, send_system_email
        from app.services.ai_errors import _staff_emails

        msg = render_owner(subject, [html.escape(x) for x in lines], page="partners", button_label="Open Partners")
        for to in await _staff_emails():
            await send_system_email(to, subject, msg["html"], msg["text"])
    except Exception as err:
        logger.warning(f"[partners] owner email '{subject}' failed: {err}")


# ── Finding the partner ─────────────────────────────────────────────────────
def new_client_id() -> str:
    return "pk_" + secrets.token_hex(10)


def new_webhook_secret() -> str:
    return "whsec_" + secrets.token_hex(24)


async def by_client_id(client_id: str) -> Optional[Partner]:
    from app.core.tenancy import system_scope

    cid = (client_id or "").strip()
    if not cid:
        return None
    with system_scope():
        async with AsyncSessionLocal() as db:
            return (await db.execute(select(Partner).where(Partner.client_id == cid))).scalars().first()


def _origin(url: str) -> str:
    u = urlparse((url or "").strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        return ""
    port = f":{u.port}" if u.port else ""
    return f"{u.scheme}://{u.hostname.lower()}{port}"


def split_addresses(values: List[str]) -> List[str]:
    """One address per item, however they were typed: on separate lines, or run together with commas, semicolons or spaces."""
    return [part for v in values or [] for part in re.split(r"[\s,;]+", str(v or "").strip()) if part]


def clean_origins(values: List[str]) -> List[str]:
    return list(dict.fromkeys(o for o in (_origin(v) for v in split_addresses(values)) if o))


def clean_return_urls(values: List[str]) -> List[str]:
    out = []
    for v in split_addresses(values):
        u = urlparse(v)
        if u.scheme in ("http", "https") and u.hostname and not u.fragment:
            out.append(v)
    return list(dict.fromkeys(out))


def unreadable_addresses(values: List[str], return_urls: bool = False) -> List[str]:
    """Entries that could not be read as a web address, so the settings page can say so instead of dropping them silently."""
    ok = set(clean_return_urls(values) if return_urls else [v for v in split_addresses(values) if _origin(v)])
    return [v for v in split_addresses(values) if v not in ok]


def usable(partner: Optional[Partner]) -> Partner:
    """The partner, or the reason it cannot be used."""
    if partner is None:
        raise PartnerError(401, "invalid_client", "Unknown client_id.")
    if partner.status == "suspended":
        raise PartnerError(403, "partner_suspended", "This integration is paused. Contact the software's support.")
    if not partner.terms_accepted_at:
        raise PartnerError(403, "terms_not_accepted", "The partner has not accepted the partner terms yet.")
    return partner


def check_origin(partner: Partner, request: Request) -> None:
    """A browser call must come from one of the partner's web addresses. A call from the partner's own server has no Origin."""
    origin = (request.headers.get("origin") or "").strip()
    if not origin:
        return
    if _origin(origin) not in (partner.allowed_origins or []):
        raise PartnerError(403, "origin_not_allowed", "This web address is not allowed to use this client_id.")


def check_return_url(partner: Partner, url: str) -> str:
    if not url:
        return ""
    # Exact, except that a trailing slash on the path is not a different page ("/connected" and "/connected/").
    asked = url.strip()
    hit = next((u for u in (partner.return_urls or []) if u == asked or (u.rstrip("/") == asked.rstrip("/") and urlparse(u).path not in ("", "/"))), None)
    if hit is None:
        raise PartnerError(422, "return_url_not_allowed", "return_url must match one of the partner's return URLs. Add each address you use in "
                           "Developer API > Partner programme, one per line.")
    return asked


def check_consent(data: Dict[str, Any]) -> str:
    if data.get("consent") is not True:
        raise PartnerError(422, "consent_required", "The user must agree to share access before continuing. Send consent: true.")
    version = str(data.get("consent_version") or "").strip()
    if not version:
        raise PartnerError(422, "consent_version_required", "Send consent_version: the version of the consent text you showed.")
    return version[:40]


# ── Keys ────────────────────────────────────────────────────────────────────
def expand_scopes(scopes: List[str]) -> List[str]:
    from app.api.developer_keys import BUNDLE_SCOPES, FREE_SCOPES

    out: List[str] = []
    for s in scopes or DEFAULT_SCOPES:
        out.extend(BUNDLE_SCOPES.get(s, [s]))
    out.extend(FREE_SCOPES)
    return list(dict.fromkeys(out))


def _forget_keys() -> None:
    from app.core.auth_middleware import forget_api_keys

    forget_api_keys()


async def _drop_key(db: AsyncSession, key_id: str) -> None:
    if not key_id:
        return
    row = await db.get(ApiKey, key_id)
    if row:
        await db.delete(row)


async def issue_key(db: AsyncSession, partner: Partner, link: PartnerLink) -> str:
    """A fresh key for this account, shown once. The one issued before stops working."""
    await _drop_key(db, link.key_id)
    raw, prefix, hashed = generate_api_key(live=partner.status == "live")
    row = ApiKey(id=f"key_{uuid.uuid4().hex[:12]}", org_id=link.org_id, created_by_id=link.operator_id or None,
                 name=(KEY_PREFIX + partner.name)[:100], prefix=prefix, hashed_key=hashed,
                 scopes=expand_scopes(partner.scopes or []), is_active=True, created_at=datetime.utcnow())
    db.add(row)
    link.key_id = row.id
    link.last_login_at = datetime.utcnow()
    await db.flush()
    _forget_keys()
    return raw


# ── Links ───────────────────────────────────────────────────────────────────
async def link_for(db: AsyncSession, partner_id: str, org_id: str) -> Optional[PartnerLink]:
    return (await db.execute(select(PartnerLink).where(PartnerLink.partner_id == partner_id, PartnerLink.org_id == org_id))).scalars().first()


async def connect(db: AsyncSession, partner: Partner, org_id: str, operator_id: str, consent_version: str, created: bool = False) -> PartnerLink:
    """Record that this account is connected to the partner (consent included), and re-open a link the user revoked."""
    link = await link_for(db, partner.id, org_id)
    now = datetime.utcnow()
    if link is None:
        link = PartnerLink(partner_id=partner.id, org_id=org_id, operator_id=operator_id, created_account=created,
                           consent_version=consent_version, consented_at=now, status="active")
        db.add(link)
    else:
        link.status, link.revoked_by, link.revoked_at = "active", "", None
        link.operator_id = operator_id or link.operator_id
        link.consent_version, link.consented_at = consent_version, now
    await db.flush()
    await ensure_webhook(db, partner, org_id, active=True)
    return link


async def revoke(db: AsyncSession, link: PartnerLink, by: str) -> None:
    await _drop_key(db, link.key_id)
    link.key_id, link.status, link.revoked_by, link.revoked_at = "", "revoked", by, datetime.utcnow()
    await ensure_webhook_state(db, link.partner_id, link.org_id, active=False)
    _forget_keys()


async def attach_new_account(db: AsyncSession, partner: Partner, op: Operator) -> PartnerLink:
    """An account created from the partner's sign-up page: remember where it came from, and keep it free for now."""
    from app.core.tenancy import org_scope
    from app.services import credits as K

    org = (await db.execute(select(Organization).where(Organization.id == op.org_id))).scalars().first()
    if org is not None:
        org.referred_by_partner_id = partner.id
    link = await connect(db, partner, op.org_id, op.id, CONSENT_VERSION, created=True)
    await db.commit()
    try:  # no credit gating while the programme is free
        with org_scope(op.org_id):
            async with AsyncSessionLocal() as s:
                await K.set_org_settings(s, {"enforce": False}, op.org_id)
                await s.commit()
    except Exception as err:
        logger.warning(f"[partners] could not switch credit gating off for {op.org_id}: {err}")
    _forget_partner_cache(op.org_id)
    return link


# ── Webhooks to the partner ─────────────────────────────────────────────────
def _tag(partner_id: str) -> str:
    return WEBHOOK_TAG + partner_id


async def ensure_webhook(db: AsyncSession, partner: Partner, org_id: str, active: bool = True) -> None:
    """Register the partner's webhook address in the user's account, so events about that account reach the partner."""
    row = (await db.execute(select(WebhookEndpoint).where(WebhookEndpoint.org_id == org_id,
                                                          WebhookEndpoint.description == _tag(partner.id)))).scalars().first()
    if not partner.webhook_url:
        if row is not None:
            row.is_active = False
        return
    if row is None:
        db.add(WebhookEndpoint(id=f"wh_{uuid.uuid4().hex[:12]}", org_id=org_id, url=partner.webhook_url, secret=partner.webhook_secret,
                               description=_tag(partner.id), events=["all"], is_active=active, created_at=datetime.utcnow()))
    else:
        row.url, row.secret, row.is_active = partner.webhook_url, partner.webhook_secret, active


async def ensure_webhook_state(db: AsyncSession, partner_id: str, org_id: str, active: bool) -> None:
    await db.execute(update(WebhookEndpoint).where(WebhookEndpoint.org_id == org_id, WebhookEndpoint.description == _tag(partner_id))
                     .values(is_active=active))


async def sync_webhooks(db: AsyncSession, partner: Partner) -> int:
    """After the partner changes its webhook address or secret: update every account it is connected to."""
    links = (await db.execute(select(PartnerLink).where(PartnerLink.partner_id == partner.id, PartnerLink.status == "active"))).scalars().all()
    for link in links:
        await ensure_webhook(db, partner, link.org_id, active=True)
    return len(links)


# ── Pausing a partner ───────────────────────────────────────────────────────
async def stop_all_keys(db: AsyncSession, partner_id: str) -> int:
    """Staff paused the partner: every key it holds stops. The accounts and links stay; users get new keys when it is switched on."""
    links = (await db.execute(select(PartnerLink).where(PartnerLink.partner_id == partner_id))).scalars().all()
    for link in links:
        await _drop_key(db, link.key_id)
        link.key_id = ""
        await ensure_webhook_state(db, partner_id, link.org_id, active=False)
    _forget_keys()
    return len(links)


# ── Free for now ────────────────────────────────────────────────────────────
_CACHE: Dict[str, Tuple[float, bool]] = {}
_CACHE_TTL_S = 60.0


def _forget_partner_cache(org_id: str) -> None:
    _CACHE.pop(org_id, None)


async def is_free_account(org_id: str) -> bool:
    """True for an account created through a partner whose integration is not suspended: it needs no plan while the programme is free."""
    from app.core.tenancy import system_scope

    hit = _CACHE.get(org_id)
    now = time.time()
    if hit and hit[0] > now:
        return hit[1]
    free = False
    try:
        with system_scope():
            async with AsyncSessionLocal() as db:
                row = (await db.execute(select(Organization.referred_by_partner_id).where(Organization.id == org_id))).first()
                pid = row[0] if row else None
                if pid:
                    p = await db.get(Partner, pid)
                    free = bool(p and p.status != "suspended")
    except Exception as err:
        logger.debug(f"[partners] free-account check skipped: {err}")
    _CACHE[org_id] = (now + _CACHE_TTL_S, free)
    return free


def forget_free_cache() -> None:
    _CACHE.clear()


# ── What a partner sees ─────────────────────────────────────────────────────
def partner_json(p: Partner, secret: bool = True) -> Dict[str, Any]:
    out = {
        "id": p.id, "clientId": p.client_id, "name": p.name, "status": p.status,
        "allowedOrigins": p.allowed_origins or [], "returnUrls": p.return_urls or [],
        "scopes": p.scopes or DEFAULT_SCOPES, "logoUrl": p.logo_url or "", "accentColor": p.accent_color or "",
        "webhookUrl": p.webhook_url or "", "liveRequestedAt": p.live_requested_at.isoformat() if p.live_requested_at else None,
        "termsVersion": p.terms_version or "", "createdAt": p.created_at.isoformat() if p.created_at else None,
    }
    if secret:
        out["webhookSecret"] = p.webhook_secret or ""
    return out
