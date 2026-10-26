"""Embedded Outreach: the calls a partner's server and the embedded page make.

POST /embed/sessions   the partner's server, with its secret key, asks for a token for one linked account
GET  /embed/session    the embedded page, with that token, asks what it is showing and how it is themed
GET  /embed/frame-policy   the web server asks which sites may frame an embed page (see frontend/nginx.conf)
"""
from __future__ import annotations

from typing import Any, Dict
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.future import select

from app.core.tenancy import system_scope
from app.database import AsyncSessionLocal
from app.models.models import Organization, Partner, PartnerLink
from app.public_api.core import check_rate
from app.services import embed as EM
from app.services import partners as PT

router = APIRouter(prefix="/embed", tags=["Embed"])


class SessionBody(BaseModel):
    link_id: str = Field("", max_length=60)
    external_id: str = Field("", max_length=120)  # or the person's id in the partner's own software
    component: str = Field(..., max_length=30)
    access: str = Field("full", max_length=10)
    ttl_seconds: int = Field(EM.TOKEN_TTL_S, ge=60, le=3600)


def _bearer(request: Request) -> str:
    v = (request.headers.get("authorization") or "").strip()
    return v[7:].strip() if v.lower().startswith("bearer ") else v


@router.post("/sessions")
async def create_session(body: SessionBody, request: Request) -> Dict[str, Any]:
    """Server to server only: a browser call (it carries an Origin) is refused, so a secret key never has to sit in a web page."""
    if request.headers.get("origin"):
        raise HTTPException(status_code=403, detail="Create embed sessions from your server, never from a web page.")
    partner = await EM.partner_for_secret(_bearer(request))
    if partner is None:
        raise HTTPException(status_code=401, detail="Invalid secret key.")
    try:
        PT.usable(partner)
    except PT.PartnerError as err:
        raise HTTPException(status_code=err.status, detail=err.message)
    wait = check_rate(f"embedsess:{partner.id}", False)
    if wait:
        raise HTTPException(status_code=429, detail="Too many requests. Slow down and try again shortly.", headers={"Retry-After": str(wait)})
    if body.component not in EM.COMPONENTS:
        raise HTTPException(status_code=422, detail=f"component must be one of: {', '.join(EM.COMPONENTS)}.")
    if body.access not in EM.ACCESS:
        raise HTTPException(status_code=422, detail="access must be full or view.")
    if bool(body.link_id) == bool(body.external_id.strip()):
        raise HTTPException(status_code=422, detail="Send either link_id or external_id.")
    q = select(PartnerLink).where(PartnerLink.partner_id == partner.id)
    q = q.where(PartnerLink.id == body.link_id) if body.link_id else q.where(PartnerLink.external_id == body.external_id.strip())
    with system_scope():
        async with AsyncSessionLocal() as db:
            link = (await db.execute(q.where(PartnerLink.status == "active"))).scalars().first()
    if link is None or link.status != "active":
        raise HTTPException(status_code=404, detail="That account is not connected to you.")
    token, expires_at = EM.mint(link.id, partner.id, link.org_id, body.component, body.access, body.ttl_seconds)
    return {"token": token, "expires_at": expires_at, "component": body.component, "access": body.access, "link_id": link.id}


@router.get("/session")
async def session(request: Request) -> Dict[str, Any]:
    ctx = getattr(request.state, "auth", None) or {}
    if ctx.get("type") != "embed":
        raise HTTPException(status_code=403, detail="This is only for embedded pages.")
    with system_scope():
        async with AsyncSessionLocal() as db:
            org = (await db.execute(select(Organization.name).where(Organization.id == ctx["org_id"]))).scalar()
            partner = await db.get(Partner, ctx["partner_id"])
    from app.services import embed_theme as TH

    name = org or ""
    return {"component": ctx["component"], "access": ctx["access"], "test": ctx["test"], "company": name,
            "views": EM.VIEWS[ctx["component"]],
            "appearance": TH.clean_appearance(partner.theme if partner else None),
            "operator": {"id": ctx["operator_id"], "name": name, "username": ctx["username"], "email": "", "org_name": name, "org_id": ctx["org_id"],
                         "role": "Embedded", "roles": [], "is_admin": False, "is_platform_org": False, "permissions": ctx["perms"],
                         "grants": {}, "is_active": True, "must_change_password": False, "profile": {}},
            "partner": {"name": partner.name if partner else "", "logoUrl": (partner.logo_url if partner else "") or "",
                        "accentColor": (partner.accent_color if partner else "") or ""}}


@router.get("/frame-policy")
async def frame_policy(request: Request, response: Response) -> Dict[str, Any]:
    """Which sites may put an embed page in a frame. The web server reads the header and sets it on the page itself.

    It is asked for the page being opened (X-Original-URI), which names the partner by client_id. An unknown partner, or one
    with no web addresses, gets 'none': nobody may frame it.
    """
    original = request.headers.get("x-original-uri") or request.url.path
    client_id = (parse_qs(urlparse(original).query).get("client_id") or [""])[0]
    partner = await PT.by_client_id(client_id)
    origins = partner.allowed_origins if partner is not None and partner.status != "suspended" else []
    response.headers["X-Frame-Policy"] = EM.frame_ancestors(origins)
    return {"ok": True}
