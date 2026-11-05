"""POST /v1/run  {"plugin": "auth", "action": ...}: sign-up and login for a partner's own pages, and connecting a user from the
partner's page with only its publishable key (connect, exchange, refresh: see the end of this file).

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

PUBLIC_ACTIONS = ("signup", "login", "resend_verification", "forgot_password", "connect", "exchange", "refresh")
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


async def _partner_for(request: Request, data: Dict[str, Any], page: bool = False) -> Partner:
    """The partner behind this call: known, not paused, called from an allowed address, and not over its limits."""
    client_id = _text(data, "client_id", 80)
    wait = check_rate(f"authip:{_ip(request)}", True) or check_rate(f"authcli:{client_id or '-'}", False)
    if wait:
        raise ApiError(429, "rate_limited", "Too many requests. Slow down and try again shortly.", {"retry_after_seconds": wait},
                       {"Retry-After": str(wait)})
    try:
        partner = PT.usable(await PT.by_client_id(client_id))
        if page:  # a web page with only the publishable key: its address must be there, and listed
            PT.require_origin(partner, request)
        else:
            PT.check_origin(partner, request)
    except PT.PartnerError as err:
        _note_refused(client_id, err)
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


async def admin_operator(request: Request, db: AsyncSession, data: Dict[str, Any]) -> Operator:
    """The account admin who proves they own an Outreach account with its email and password (the same checks as the sign-in page)."""
    from app.api import auth as A
    from app.core.accounts import effective_access

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
    return op


async def login(request: Request, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
    partner = await _partner_for(request, data)
    op = await admin_operator(request, db, data)
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


def _note_refused(client_id: str, err: PT.PartnerError) -> None:
    """Keep a short trace of a page that was turned away, so the partner can see why its screen stayed blank. Never raises."""
    import asyncio

    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    async def _go():
        try:
            partner = await PT.by_client_id(client_id)
            if partner is not None:
                with system_scope():
                    async with AsyncSessionLocal() as s:
                        PT.audit(s, partner.id, "page", "origin_denied", err.message[:200])
                        await s.commit()
        except Exception:
            pass

    if err.code in ("origin_not_allowed", "origin_required") and check_rate(f"authdeny:{client_id or '-'}", False) is None:
        try:
            asyncio.get_running_loop().create_task(_go())
        except RuntimeError:
            pass


# ── Connecting from the partner's page, with only its publishable key ────────────────────────────────────────
# connect   {client_id, component, access?, return_url?} -> {state, origin, expires_at}: show our sign-in at /embed/connect?state=...
#           in a popup, inside your page (an iframe), or as the whole window (then return_url, a page of yours, is where it comes back to)
# exchange  {client_id, code}                   -> {token, ...}: the popup's one-time code, for an embed token
# refresh   {client_id, token}                  -> {token, ...}: a token that is still valid, for a fresh one
def _page_origin(request: Request) -> str:
    return PT.page_origin(request.headers.get("origin") or "")


async def connect(request: Request, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
    from app.services import embed as EM

    partner = await _partner_for(request, data, page=True)
    component, access = _text(data, "component", 30) or "leads", _text(data, "access", 10) or "full"
    if component not in EM.COMPONENTS or access not in EM.ACCESS:
        fail(422, "invalid_request", f"component must be one of: {', '.join(EM.COMPONENTS)}; access is full or view.")
    if EM.account_blocked(partner, component):
        fail(403, "not_enabled", EM.account_blocked(partner, component))
    origin, ret = _page_origin(request), _text(data, "return_url", 500).split("#")[0]
    if ret and not (PT.extension_return_ok(origin, ret) if origin.startswith(PT._EXT_SCHEMES) else PT.page_origin(ret) == origin):
        fail(422, "return_url_not_allowed", "return_url must be a page on the same web address as the page that asked "
                                            "(an extension: its own sign-in return address).")
    state, expires_at = EM.mint_state(partner.id, component, access, origin, ret)
    return {"state": state, "origin": origin, "expires_at": expires_at}


async def exchange(request: Request, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
    from app.core.tenancy import system_scope
    from app.services import embed as EM

    partner = await _partner_for(request, data, page=True)
    claims = EM.take_code(_text(data, "code", 2000), _page_origin(request))
    if claims is None or claims["ptr"] != partner.id:
        fail(401, "code_expired", "That sign-in has expired. Click Connect again.")
    with system_scope():
        link = await db.get(PartnerLink, claims["sub"])
    if link is None or link.status != "active" or link.partner_id != partner.id or link.org_id != claims["org"]:
        fail(401, "code_expired", "That sign-in has expired. Click Connect again.")
    token, expires_at = EM.mint(link.id, partner.id, link.org_id, claims["cmp"], claims["acc"])
    return {"token": token, "expires_at": expires_at, "component": claims["cmp"], "access": claims["acc"], "link_id": link.id}


async def refresh(request: Request, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
    from app.services import embed as EM

    partner = await _partner_for(request, data, page=True)
    ctx = await EM.context(_text(data, "token", 3000))  # still valid, link still active, partner not paused
    if ctx is None or ctx["partner_id"] != partner.id:
        fail(401, "token_expired", "This session has ended. Click Connect again.")
    if ctx["component"] == "account":  # an admin session is never renewed by the page: it ends, and the person signs in again
        fail(401, "token_expired", "The Account screen ended. Click Connect and sign in again.")
    token, expires_at = EM.mint(ctx["link_id"], partner.id, ctx["org_id"], ctx["component"], ctx["access"])
    return {"token": token, "expires_at": expires_at, "component": ctx["component"], "access": ctx["access"], "link_id": ctx["link_id"]}


HANDLERS = {"connect": connect, "exchange": exchange, "refresh": refresh, "signup": signup, "login": login, "resend_verification": resend_verification, "forgot_password": forgot_password,
            "me": me, "disconnect": disconnect}


async def handle(request: Request, db: AsyncSession, action: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return await HANDLERS[action](request, db, data)
