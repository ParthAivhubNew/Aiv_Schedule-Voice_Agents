"""Linking a person to a partner from the embedded connect screen.

POST /embed/connect-sessions       the partner's server, with its secret key, asks for a token that opens the connect screen
GET  /embed/links/{external_id}    the partner's server looks up the account linked to one of its users
GET  /embed/connect/info           the connect screen asks who wants access and what for
POST /embed/connect/login          an existing Outreach account: its admin proves it with email and password, then agrees
POST /embed/connect/signup         a new account made under the partner

The person types their password into our page only; the partner's software never sees it. A link exists only after the
account's admin has proved ownership and agreed. An email address is never enough to attach a partner to an account.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
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
            "component": claims["cmp"], "access": claims["acc"], "consentVersion": PT.CONSENT_VERSION, "test": partner.status != "live"}


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


async def _finish(db, partner: Partner, claims: Dict[str, Any], op, version: str, created: bool) -> Dict[str, Any]:
    taken = await _link_by_external(db, partner.id, claims["ext"])
    if taken is not None and taken.org_id != op.org_id:
        raise HTTPException(status_code=409, detail="This user is already linked to a different Outreach account. Disconnect it first.")
    current = await PT.link_for(db, partner.id, op.org_id)
    if current is not None and current.status == "active" and current.external_id and current.external_id != claims["ext"]:
        raise HTTPException(status_code=409, detail="This Outreach account is already connected to a different user of this app.")
    link = await PT.connect(db, partner, op.org_id, op.id, version, created=created)
    link.external_id = claims["ext"]
    link.last_login_at = datetime.utcnow()
    await db.commit()
    EM.forget()
    token, expires_at = EM.mint(link.id, partner.id, link.org_id, claims["cmp"], claims["acc"])
    return {"ok": True, "verify_email": False, **_link_json(link),
            "session": {"token": token, "expires_at": expires_at, "component": claims["cmp"], "access": claims["acc"]}}


@router.post("/connect/login")
async def connect_login(body: ConnectBody, request: Request) -> Dict[str, Any]:
    from app.public_api import partner_auth as PA

    claims = _claims(request)
    version = _guard(request, claims, body)
    async with AsyncSessionLocal() as db:
        partner = await _partner(db, claims)
        try:
            op = await PA.admin_operator(request, db, {"email": body.email, "password": body.password})
        except ApiError as err:
            raise HTTPException(status_code=err.status, detail={"message": err.message, "code": err.code}, headers=err.headers or None)
        return await _finish(db, partner, claims, op, version, created=False)


@router.post("/connect/signup")
async def connect_signup(body: ConnectBody, request: Request) -> Dict[str, Any]:
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
            link.external_id = claims["ext"]
            await db.commit()
            return {"ok": True, "verify_email": True, "emailed": out["emailed"]}
        return await _finish(db, partner, claims, out["operator"], version, created=True)
