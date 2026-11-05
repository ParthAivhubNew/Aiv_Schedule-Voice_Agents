"""Linking a person to a partner from the embedded connect screen.

POST /embed/connect-sessions       the partner's server, with its secret key, asks for a token that opens the connect screen
GET  /embed/links/{external_id}    the partner's server looks up the account linked to one of its users
GET  /embed/connect/info           the connect screen asks who wants access and what for
POST /embed/connect/login          an existing Outreach account: its admin proves it with email and password, then agrees
POST /embed/connect/signup         a new account made under the partner

Page-only connect (no server of the partner's needed): the partner's page talks to POST /v1/run only (public_api/partner_auth.py:
auth.connect, auth.exchange, auth.refresh). These two are the popup's own calls, from our page to ours:
POST /embed/connect/resume         a person Outreach already knows in this browser connects without a password
POST /embed/connect/forget         'use a different account'

The person types their password into our page only; the partner's software never sees it. A link exists only after the
account's admin has proved ownership and agreed. An email address is never enough to attach a partner to an account.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.future import select

from app.api.embed import _bearer
from app.core.tenancy import system_scope
from app.database import AsyncSessionLocal
from app.models.models import Partner, PartnerLink
from app.public_api.core import ApiError, check_rate
from app.services import embed as EM
from app.services import partners as PT

router = APIRouter(prefix="/embed", tags=["Embed"])


class ConnectSessionBody(BaseModel):
    external_id: str = Field(..., min_length=1, max_length=120)  # the person's id in the partner's own software
    component: str = Field("leads", max_length=30)
    access: str = Field("full", max_length=10)


class ConnectBody(BaseModel):
    email: str = Field("", max_length=254)
    password: str = Field("", max_length=200)
    consent: bool = False
    consent_version: str = Field("", max_length=40)
    company: str = Field("", max_length=120)
    name: str = Field("", max_length=120)
    website: str = Field("", max_length=200)  # a trap field: people leave it empty


async def _partner_by_secret(request: Request) -> Partner:
    if request.headers.get("origin"):
        raise HTTPException(status_code=403, detail="Call this from your server, never from a web page.")
    partner = await EM.partner_for_secret(_bearer(request))
    if partner is None:
        raise HTTPException(status_code=401, detail="Invalid secret key.")
    try:
        PT.usable(partner)
    except PT.PartnerError as err:
        raise HTTPException(status_code=err.status, detail=err.message)
    return partner


async def _link_by_external(db, partner_id: str, external_id: str) -> Optional[PartnerLink]:
    return (await db.execute(select(PartnerLink).where(PartnerLink.partner_id == partner_id, PartnerLink.external_id == external_id,
                                                       PartnerLink.status == "active"))).scalars().first()


def _link_json(link: PartnerLink) -> Dict[str, Any]:
    return {"link_id": link.id, "external_id": link.external_id, "status": link.status,
            "mode": "partner_created" if link.created_account else "existing",
            "connected_at": link.consented_at.isoformat() if link.consented_at else None}


@router.post("/connect-sessions")
async def create_connect_session(body: ConnectSessionBody, request: Request) -> Dict[str, Any]:
    """If the person is already linked there is nothing to connect: the answer says so and carries the link."""
    partner = await _partner_by_secret(request)
    if check_rate(f"embedsess:{partner.id}", False):
        raise HTTPException(status_code=429, detail="Too many requests. Slow down and try again shortly.")
    if body.component not in EM.COMPONENTS or body.access not in EM.ACCESS:
        raise HTTPException(status_code=422, detail=f"component must be one of: {', '.join(EM.COMPONENTS)}; access is full or view.")
    external = body.external_id.strip()
    with system_scope():
        async with AsyncSessionLocal() as db:
            link = await _link_by_external(db, partner.id, external)
    if link is not None:
        return {"linked": True, **_link_json(link)}
    token, expires_at = EM.mint_connect(partner.id, external, body.component, body.access)
    return {"linked": False, "connect_token": token, "expires_at": expires_at}


@router.get("/links/{external_id}")
async def link_of(external_id: str, request: Request) -> Dict[str, Any]:
    partner = await _partner_by_secret(request)
    with system_scope():
        async with AsyncSessionLocal() as db:
            link = await _link_by_external(db, partner.id, external_id.strip())
    if link is None:
        raise HTTPException(status_code=404, detail="No account is linked to that user.")
    return _link_json(link)


@router.post("/links/{external_id}/key")
async def link_key(external_id: str, request: Request) -> Dict[str, Any]:
    """A fresh API key for a linked account, for the partner's server to keep. Shown once; the one issued before stops working."""
    partner = await _partner_by_secret(request)
    if check_rate(f"embedsess:{partner.id}", False):
        raise HTTPException(status_code=429, detail="Too many requests. Slow down and try again shortly.")
    async with AsyncSessionLocal() as db:
        with system_scope():
            link = await _link_by_external(db, partner.id, external_id.strip())
            if link is None:
                raise HTTPException(status_code=404, detail="No account is linked to that user.")
            raw = await PT.issue_key(db, partner, link)
            await db.commit()
    return {"api_key": raw, "key_mode": "test" if raw.startswith("sk_test_") else "live", **_link_json(link)}


def _claims(request: Request) -> Dict[str, Any]:
    claims = EM.read_connect(_bearer(request))
    if claims is None:
        raise HTTPException(status_code=401, detail="This connect link has expired. Start again from the partner's page.")
    return claims


@router.get("/connect/info")
async def connect_info(request: Request) -> Dict[str, Any]:
    claims = _claims(request)
    with system_scope():
        async with AsyncSessionLocal() as db:
            partner = await db.get(Partner, claims["sub"])
    if partner is None or partner.status == "suspended":
        raise HTTPException(status_code=403, detail="This integration is paused.")
    return {"partner": {"name": partner.name, "logoUrl": partner.logo_url or "", "accentColor": partner.accent_color or ""},
            "component": claims["cmp"], "access": claims["acc"], "consentVersion": PT.CONSENT_VERSION, "test": partner.status != "live",
            "origin": claims.get("pop") or "",
            "remembered": bool(claims.get("pop") and EM.read_remember(request.cookies.get(EM.REMEMBER_COOKIE, "")))}


def _guard(request: Request, claims: Dict[str, Any], body: ConnectBody) -> str:
    """Rate limit by address and by partner, and require consent. Returns the consent version."""
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?")
    wait = check_rate(f"embedconnip:{ip}", True) or check_rate(f"embedconn:{claims['sub']}", False)
    if wait:
        raise HTTPException(status_code=429, detail="Too many attempts. Try again shortly.", headers={"Retry-After": str(wait)})
    try:
        return PT.check_consent({"consent": body.consent, "consent_version": body.consent_version})
    except PT.PartnerError as err:
        raise HTTPException(status_code=err.status, detail=err.message)


async def _partner(db, claims: Dict[str, Any]) -> Partner:
    with system_scope():
        partner = await db.get(Partner, claims["sub"])
    try:
        return PT.usable(partner)
    except PT.PartnerError as err:
        raise HTTPException(status_code=err.status, detail=err.message)


def _identity(claims: Dict[str, Any], op, current: Optional[PartnerLink]) -> str:
    """The id this person has in the partner's software. A partner's server names it. In page-only connect the page cannot be
    trusted to, so it is ours: the Outreach sign-in, or the id the partner's server gave this account earlier."""
    if not claims.get("pop"):
        return claims["ext"]
    return (current.external_id if current is not None and current.status == "active" and current.external_id else "") or f"outreach:{op.id}"


def _remember(response: Response, request: Request, op) -> None:
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "") == "https"
    response.set_cookie(EM.REMEMBER_COOKIE, EM.mint_remember(op.id, op.org_id), max_age=EM.REMEMBER_TTL_S, httponly=True, secure=secure,
                        samesite="lax", path="/api/embed/connect")


async def _finish(db, partner: Partner, claims: Dict[str, Any], op, version: str, created: bool,
                  response: Optional[Response] = None, request: Optional[Request] = None) -> Dict[str, Any]:
    current = await PT.link_for(db, partner.id, op.org_id)
    ext = _identity(claims, op, current)
    taken = await _link_by_external(db, partner.id, ext)
    if taken is not None and taken.org_id != op.org_id:
        raise HTTPException(status_code=409, detail="This user is already linked to a different Outreach account. Disconnect it first.")
    if current is not None and current.status == "active" and current.external_id and current.external_id != ext:
        raise HTTPException(status_code=409, detail="This Outreach account is already connected to a different user of this app.")
    link = await PT.connect(db, partner, op.org_id, op.id, version, created=created)
    link.external_id = ext
    link.last_login_at = datetime.utcnow()
    await db.commit()
    EM.forget()
    if created:
        from app.services import partner_credits as PC

        await PC.welcome(partner, link)
    if claims.get("pop"):  # the popup hands a one-time code to the page that opened it; no token is shown to any script of ours
        if response is not None and request is not None:
            _remember(response, request, op)
        return {"ok": True, "verify_email": False, **_link_json(link), "origin": claims["pop"], "return_url": claims.get("ret", ""),
                "code": EM.mint_code(link.id, partner.id, link.org_id, claims["cmp"], claims["acc"], claims["pop"])}
    token, expires_at = EM.mint(link.id, partner.id, link.org_id, claims["cmp"], claims["acc"])
    return {"ok": True, "verify_email": False, **_link_json(link),
            "session": {"token": token, "expires_at": expires_at, "component": claims["cmp"], "access": claims["acc"]}}


@router.post("/connect/login")
async def connect_login(body: ConnectBody, request: Request, response: Response) -> Dict[str, Any]:
    from app.public_api import partner_auth as PA

    claims = _claims(request)
    version = _guard(request, claims, body)
    async with AsyncSessionLocal() as db:
        partner = await _partner(db, claims)
        try:
            op = await PA.admin_operator(request, db, {"email": body.email, "password": body.password})
        except ApiError as err:
            raise HTTPException(status_code=err.status, detail={"message": err.message, "code": err.code}, headers=err.headers or None)
        return await _finish(db, partner, claims, op, version, created=False, response=response, request=request)


@router.post("/connect/signup")
async def connect_signup(body: ConnectBody, request: Request, response: Response) -> Dict[str, Any]:
    """A new account under the partner. It needs no plan while the programme is free (see partners.attach_new_account)."""
    from app.api import signup as S

    claims = _claims(request)
    version = _guard(request, claims, body)
    async with AsyncSessionLocal() as db:
        partner = await _partner(db, claims)
        out = await S.register(db, request, company=body.company, name=body.name, email=body.email, password=body.password,
                               website=body.website, partner=partner)
        if out["verifyEmail"]:  # usable once the email link is followed; the person then connects again
            link = await PT.link_for(db, partner.id, out["operator"].org_id)
            link.external_id = _identity(claims, out["operator"], None)
            await db.commit()
            return {"ok": True, "verify_email": True, "emailed": out["emailed"]}
        return await _finish(db, partner, claims, out["operator"], version, created=True, response=response, request=request)


def _client_ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?")


@router.post("/connect/resume")
async def connect_resume(body: ConnectBody, request: Request, response: Response) -> Dict[str, Any]:
    """A person this browser already signed in through our popup connects again with no password. The consent they gave
    before still stands; a person connecting to a new partner is asked to agree first."""
    claims = _claims(request)
    if not claims.get("pop"):
        raise HTTPException(status_code=400, detail="This is for the popup opened from a web page.")
    seen = EM.read_remember(request.cookies.get(EM.REMEMBER_COOKIE, ""))
    if seen is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    wait = check_rate(f"embedconnip:{_client_ip(request)}", True) or check_rate(f"embedconn:{claims['sub']}", False)
    if wait:
        raise HTTPException(status_code=429, detail="Too many attempts. Try again shortly.", headers={"Retry-After": str(wait)})
    from app.api import auth as A
    from app.core.accounts import effective_access
    from app.models.models import Operator

    async with AsyncSessionLocal() as db:
        partner = await _partner(db, claims)
        with system_scope():
            op = await db.get(Operator, seen["sub"])
            current = await PT.link_for(db, partner.id, op.org_id) if op is not None else None
            is_admin = False
            if op is not None and op.org_id == seen["org"]:
                try:
                    await A.assert_can_sign_in(db, op)
                    is_admin = bool((await effective_access(db, op))[0])
                except HTTPException:
                    is_admin = False
        if op is None or not is_admin:
            raise HTTPException(status_code=401, detail="Sign in to continue.")
        if current is not None and current.status == "active":
            version = current.consent_version or PT.CONSENT_VERSION
        else:
            try:
                version = PT.check_consent({"consent": body.consent, "consent_version": body.consent_version})
            except PT.PartnerError as err:
                raise HTTPException(status_code=err.status, detail=err.message)
        return await _finish(db, partner, claims, op, version, created=False, response=response, request=request)


@router.post("/connect/forget")
async def connect_forget(response: Response) -> Dict[str, Any]:
    """'Use a different account': drop the remembered sign-in on this browser."""
    response.delete_cookie(EM.REMEMBER_COOKIE, path="/api/embed/connect")
    return {"ok": True}
