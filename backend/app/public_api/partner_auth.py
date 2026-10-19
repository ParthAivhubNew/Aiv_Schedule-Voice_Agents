"""POST /v1/run  {"plugin": "auth", "action": ...}: sign-up and login for a partner's own pages.

signup, login, resend_verification and forgot_password work without a key; they need the partner's `client_id` and, from a
browser, one of its allowed web addresses. me and disconnect need the account's key. Signing up or logging in returns a scoped
API key for the user's account, shown once. Nothing here is a new way to sign in: it runs the same checks as the Outreach
sign-in page (password rules, lock after failed attempts, email confirmation).
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import HTTPException, Request
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.models.models import Operator, Organization, Partner, PartnerLink
from app.public_api.core import ApiError, check_rate, fail
from app.services import partners as PT

PUBLIC_ACTIONS = ("signup", "login", "resend_verification", "forgot_password")
KEY_ACTIONS = ("me", "disconnect")
ACTIONS = PUBLIC_ACTIONS + KEY_ACTIONS


def _ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else "?")


def _text(data: Dict[str, Any], name: str, limit: int = 300) -> str:
    v = data.get(name)
    return v.strip()[:limit] if isinstance(v, str) else ""


def _refuse(err: PT.PartnerError) -> None:
    fail(err.status, err.code, err.message)


def _from_http(err: HTTPException) -> None:
    """The sign-in code speaks HTTP errors; the API speaks {code, message}."""
    d = err.detail
    message = d.get("message") if isinstance(d, dict) else str(d)
    code = (d.get("code") if isinstance(d, dict) else None) or {400: "bad_request", 401: "bad_credentials", 403: "forbidden",
                                                                  404: "not_found", 429: "rate_limited"}.get(err.status_code, "error")
    raise ApiError(err.status_code, code, message or "Something went wrong.")


async def _partner_for(request: Request, data: Dict[str, Any]) -> Partner:
    """The partner behind this call: known, not paused, called from an allowed address, and not over its limits."""
    client_id = _text(data, "client_id", 80)
    wait = check_rate(f"authip:{_ip(request)}", True) or check_rate(f"authcli:{client_id or '-'}", False)
    if wait:
        raise ApiError(429, "rate_limited", "Too many requests. Slow down and try again shortly.", {"retry_after_seconds": wait},
                       {"Retry-After": str(wait)})
    try:
        partner = PT.usable(await PT.by_client_id(client_id))
        PT.check_origin(partner, request)
    except PT.PartnerError as err:
        _refuse(err)
    return partner


def _account(org: Optional[Organization], op: Operator) -> Dict[str, Any]:
    return {"org_id": op.org_id, "company": org.name if org else "", "user": {"id": op.id, "name": op.name, "email": op.email}}


async def _org(db: AsyncSession, org_id: str) -> Optional[Organization]:
    return (await db.execute(select(Organization).where(Organization.id == org_id))).scalars().first()


async def _with_key(db: AsyncSession, partner: Partner, op: Operator, consent_version: str, created: bool = False) -> Dict[str, Any]:
    link = await PT.connect(db, partner, op.org_id, op.id, consent_version, created=created)
    raw = await PT.issue_key(db, partner, link)
    await db.commit()
    return {"api_key": raw, "key_mode": "test" if raw.startswith("sk_test_") else "live", "link_id": link.id,
            "account": _account(await _org(db, op.org_id), op)}


async def signup(request: Request, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
    from app.api import signup as S

    partner = await _partner_for(request, data)
    try:
        version = PT.check_consent(data)
        ret = PT.check_return_url(partner, _text(data, "return_url", 500))
    except PT.PartnerError as err:
        _refuse(err)
    try:
        out = await S.register(db, request, company=_text(data, "company", 120), name=_text(data, "name", 120), email=_text(data, "email", 254),
                               password=data.get("password") if isinstance(data.get("password"), str) else "",
                               website=_text(data, "website"), partner=partner, return_url=ret)
    except HTTPException as err:
        _from_http(err)
    op: Operator = out["operator"]
    if out["verifyEmail"]:  # the account waits for the email link; the partner logs the user in afterwards
        return {"ok": True, "verify_email": True, "emailed": out["emailed"], "key_mode": "test" if partner.status != "live" else "live"}
    return {"ok": True, "verify_email": False, **(await _with_key(db, partner, op, version, created=True))}


async def login(request: Request, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
    from app.api import auth as A
    from app.core.accounts import effective_access

    partner = await _partner_for(request, data)
    try:
        op = await A.check_credentials(db, _text(data, "email", 254), data.get("password") if isinstance(data.get("password"), str) else "", request)
        await A.assert_can_sign_in(db, op)
    except HTTPException as err:
        await db.rollback()
        _from_http(err)
    if op.must_change_password:
        fail(403, "password_change_required", "Sign in to Outreach once to choose a new password, then try again.")
    is_admin, _, _ = await effective_access(db, op)
    if not is_admin:
        fail(403, "admin_required", "Only an admin of the Outreach account can connect it. Ask your admin.")
    existing = await PT.link_for(db, partner.id, op.org_id)
    if existing is not None and existing.status == "active" and data.get("consent") is not True:
        version = existing.consent_version or PT.CONSENT_VERSION
    else:
        try:
            version = PT.check_consent(data)
        except PT.PartnerError as err:
            _refuse(err)
    return {"ok": True, **(await _with_key(db, partner, op, version))}


async def resend_verification(request: Request, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
    from app.api import signup as S

    partner = await _partner_for(request, data)
    try:
        ret = PT.check_return_url(partner, _text(data, "return_url", 500))
        S._limit("resend", request)
    except PT.PartnerError as err:
        _refuse(err)
    except HTTPException as err:
        _from_http(err)
    email = _text(data, "email", 254).lower()
    op = (await db.execute(select(Operator).where(func.lower(Operator.email) == email))).scalars().first() if email else None
    if op is not None and not op.email_verified:
        link = await PT.link_for(db, partner.id, op.org_id)
        org = await _org(db, op.org_id)
        if link is not None and org is not None and org.status == S.PENDING:  # only for accounts this partner created
            await S._send_verification(op, ret=ret, partner_name=partner.name)
    return {"ok": True}  # the same answer either way: it does not reveal who has an account


async def forgot_password(request: Request, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
    from app.api import signup as S

    await _partner_for(request, data)
    try:
        return await S.forgot_password(S.ForgotBody(email=_text(data, "email", 254)), request, db)
    except HTTPException as err:
        _from_http(err)


def _key_ctx(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if ctx.get("type") != "api_key":
        fail(401, "key_required", "This action needs the account's API key.")
    return ctx


async def _link_of_key(db: AsyncSession, ctx: Dict[str, Any]) -> PartnerLink:
    link = (await db.execute(select(PartnerLink).where(PartnerLink.key_id == ctx.get("key_id")))).scalars().first()
    if link is None:
        fail(403, "not_a_partner_key", "This key was not issued through a partner sign-in.")
    return link


async def me(request: Request, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
    ctx = _key_ctx(request)
    link = await _link_of_key(db, ctx)
    org = await _org(db, ctx["org_id"])
    partner = await db.get(Partner, link.partner_id)
    return {"account": {"org_id": ctx["org_id"], "company": org.name if org else ""}, "partner": partner.name if partner else "",
            "link": {"id": link.id, "status": link.status, "created_account": bool(link.created_account),
                     "consent_version": link.consent_version, "connected_at": link.consented_at.isoformat() if link.consented_at else None},
            "key_mode": "test" if ctx.get("test") else "live", "scopes": ctx.get("scopes") or []}


async def disconnect(request: Request, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
    ctx = _key_ctx(request)
    link = await _link_of_key(db, ctx)
    await PT.revoke(db, link, "partner")
    await db.commit()
    return {"ok": True, "status": "revoked"}


HANDLERS = {"signup": signup, "login": login, "resend_verification": resend_verification, "forgot_password": forgot_password,
            "me": me, "disconnect": disconnect}


async def handle(request: Request, db: AsyncSession, action: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return await HANDLERS[action](request, db, data)
