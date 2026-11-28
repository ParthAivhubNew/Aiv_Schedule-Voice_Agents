"""White-label brands: the staff screen's API, and the look the sign-in page and the app read.

Staff (admin-api, staff_admin changes, any staff reads):
  GET    /admin-api/brands                                   every brand with its domains and how many organisations follow it
  POST   /admin-api/brands                                   create
  GET    /admin-api/brands/{id}
  PATCH  /admin-api/brands/{id}                              look, status; send only what changes
  DELETE /admin-api/brands/{id}                              refused while an organisation still follows it
  PUT    /admin-api/brands/{id}/policy                       replace the policy (cleaned; the cleaned policy is returned)
  POST   /admin-api/brands/{id}/domains                      {host, verified?}
  DELETE /admin-api/brands/{id}/domains/{domain_id}
  GET    /admin-api/brand-organizations                      every organisation with the brand it follows
  PUT    /admin-api/brands/{id}/organizations/{org_id}       an organisation follows this brand
  DELETE /admin-api/brands/{id}/organizations/{org_id}       and stops following it

Public look: GET /api/brand?host=  (no sign-in; never returns policy)   Signed in: GET /api/me/brand
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select, text

from app.api.admin_portal import _admin_only, _who
from app.core.tenancy import org_scope
from app.database import AsyncSessionLocal
from app.models.models import Brand, BrandDomain
from app.services import audit
from app.services import tenant_policy as TP

logger = logging.getLogger(__name__)
staff_router = APIRouter(prefix="/admin-api", tags=["Admin portal"])
public_router = APIRouter(tags=["Brand"])

_HOST = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _host(value: str) -> str:
    h = re.sub(r"^[a-z]+://", "", str(value or "").strip().lower()).split("/")[0].split(":")[0].strip(".")
    if not _HOST.match(h):
        raise HTTPException(status_code=400, detail="Enter a web address like outreach.example.com (no https://, no path).")
    return h


def _colour(value: Any) -> str:
    v = str(value or "").strip()
    if v and not _COLOUR.match(v):
        raise HTTPException(status_code=400, detail="The accent colour is a hex colour like #1f6feb.")
    return v


def _logo(value: Any) -> str:
    v = str(value or "").strip()[:500]
    if v and not re.match(r"^(https://|/)", v):
        raise HTTPException(status_code=400, detail="The logo is an https:// address or a path starting with /.")
    return v


def _theme(value: Any) -> Dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict) or len(json.dumps(value, default=str)) > 4000:
        raise HTTPException(status_code=400, detail="The theme is a small JSON object.")
    return value


def look(b: Brand, signin: Optional[Dict[str, bool]] = None) -> Dict[str, Any]:
    out = {"name": b.name or "", "displayName": b.display_name or b.name or "", "logoUrl": b.logo_url or "", "accent": b.accent_color or "",
           "theme": b.theme or {}, "poweredBy": bool(b.powered_by)}
    out["signin"] = signin or TP.clean_policy(b.policy)["signin"]
    return out


def _brand_json(b: Brand, domains: List[BrandDomain], org_count: int) -> Dict[str, Any]:
    return {"id": b.id, "name": b.name, "displayName": b.display_name or "", "logoUrl": b.logo_url or "", "accent": b.accent_color or "",
            "theme": b.theme or {}, "poweredBy": bool(b.powered_by), "hideCredits": bool(b.hide_credits), "status": b.status or "active",
            "policy": TP.clean_policy(b.policy), "orgCount": org_count,
            "domains": [{"id": d.id, "host": d.host, "verified": bool(d.verified)} for d in domains],
            "createdAt": b.created_at.isoformat() + "Z" if b.created_at else None, "updatedAt": b.updated_at.isoformat() + "Z" if b.updated_at else None}


async def _full(db, b: Brand) -> Dict[str, Any]:
    doms = (await db.execute(select(BrandDomain).where(BrandDomain.brand_id == b.id).order_by(BrandDomain.host))).scalars().all()
    n = (await db.execute(text("SELECT count(*) FROM organizations WHERE brand_id = :b"), {"b": b.id})).scalar() or 0
    return _brand_json(b, list(doms), int(n))


async def _get(db, brand_id: str) -> Brand:
    b = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalars().first()
    if not b:
        raise HTTPException(status_code=404, detail="Brand not found.")
    return b


async def _audit(db, staff: Dict[str, Any], action: str, brand_id: str, detail: Dict[str, Any], *, to_orgs: bool = False) -> None:
    """One row in the platform's log, and (for a change of policy) one in each organisation that follows the brand, so each can prove it."""
    name = staff.get("email") or staff.get("name") or "staff"
    await audit.record(db, action, target=brand_id, detail=detail, actor_id=str(staff.get("id") or name), actor_name=name)
    if not to_orgs:
        return
    org_ids = (await db.execute(text("SELECT id FROM organizations WHERE brand_id = :b"), {"b": brand_id})).scalars().all()
    for oid in org_ids:
        with org_scope(oid):
            async with AsyncSessionLocal() as odb:
                await audit.record(odb, action, target=brand_id, detail=detail, actor_id=str(staff.get("id") or name), actor_name=name)
                await odb.commit()


class BrandIn(BaseModel):
    name: Optional[str] = None
    displayName: Optional[str] = None
    logoUrl: Optional[str] = None
    accent: Optional[str] = None
    theme: Optional[Dict[str, Any]] = None
    poweredBy: Optional[bool] = None
    hideCredits: Optional[bool] = None
    status: Optional[str] = None
    policy: Optional[Dict[str, Any]] = None


class DomainIn(BaseModel):
    host: str
    verified: bool = False


@staff_router.get("/brands")
async def list_brands(request: Request):
    _who(request)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Brand).order_by(Brand.created_at))).scalars().all()
        return {"brands": [await _full(db, b) for b in rows]}


@staff_router.post("/brands")
async def create_brand(body: BrandIn, request: Request):
    staff = _admin_only(request)
    name = (body.name or "").strip()[:120]
    if not name:
        raise HTTPException(status_code=400, detail="A brand needs a name.")
    if body.status not in (None, "active", "suspended"):
        raise HTTPException(status_code=400, detail="Status is active or suspended.")
    async with AsyncSessionLocal() as db:
        b = Brand(name=name, display_name=(body.displayName or "").strip()[:120], logo_url=_logo(body.logoUrl), accent_color=_colour(body.accent),
                  theme=_theme(body.theme), powered_by=True if body.poweredBy is None else body.poweredBy, hide_credits=bool(body.hideCredits),
                  status=body.status or "active", policy=TP.clean_policy(body.policy))
        db.add(b)
        await db.flush()
        await _audit(db, staff, "brand.created", b.id, {"name": name})
        await db.commit()
        TP.invalidate()
        return await _full(db, b)


@staff_router.get("/brands/{brand_id}")
async def get_brand(brand_id: str, request: Request):
    _who(request)
    async with AsyncSessionLocal() as db:
        return await _full(db, await _get(db, brand_id))


@staff_router.patch("/brands/{brand_id}")
async def edit_brand(brand_id: str, body: BrandIn, request: Request):
    staff = _admin_only(request)
    sent = body.model_dump(exclude_unset=True) if hasattr(body, "model_dump") else body.dict(exclude_unset=True)
    async with AsyncSessionLocal() as db:
        b = await _get(db, brand_id)
        if "name" in sent:
            if not (sent["name"] or "").strip():
                raise HTTPException(status_code=400, detail="A brand needs a name.")
            b.name = sent["name"].strip()[:120]
        if "displayName" in sent:
            b.display_name = (sent["displayName"] or "").strip()[:120]
        if "logoUrl" in sent:
            b.logo_url = _logo(sent["logoUrl"])
        if "accent" in sent:
            b.accent_color = _colour(sent["accent"])
        if "theme" in sent:
            b.theme = _theme(sent["theme"])
        if "poweredBy" in sent and sent["poweredBy"] is not None:
            b.powered_by = bool(sent["poweredBy"])
        if "hideCredits" in sent and sent["hideCredits"] is not None:
            b.hide_credits = bool(sent["hideCredits"])
        if "status" in sent:
            if sent["status"] not in ("active", "suspended"):
                raise HTTPException(status_code=400, detail="Status is active or suspended.")
            b.status = sent["status"]
        if "policy" in sent and sent["policy"] is not None:
            b.policy = TP.clean_policy(sent["policy"])
        await _audit(db, staff, "brand.edited", b.id, {"fields": ",".join(sorted(sent))}, to_orgs="policy" in sent)
        await db.commit()
        TP.invalidate()
        return await _full(db, b)


@staff_router.delete("/brands/{brand_id}")
async def delete_brand(brand_id: str, request: Request):
    staff = _admin_only(request)
    async with AsyncSessionLocal() as db:
        b = await _get(db, brand_id)
        n = (await db.execute(text("SELECT count(*) FROM organizations WHERE brand_id = :b"), {"b": b.id})).scalar() or 0
        if n:
            raise HTTPException(status_code=409, detail=f"{n} organisation(s) still follow this brand. Unlink them first, so none loses its policy by accident.")
        await db.execute(text("DELETE FROM brand_domains WHERE brand_id = :b"), {"b": b.id})
        await db.delete(b)
        await _audit(db, staff, "brand.deleted", brand_id, {"name": b.name})
        await db.commit()
    TP.invalidate()
    return {"id": brand_id, "deleted": True}


@staff_router.put("/brands/{brand_id}/policy")
async def set_policy(brand_id: str, body: Dict[str, Any], request: Request):
    staff = _admin_only(request)
    async with AsyncSessionLocal() as db:
        b = await _get(db, brand_id)
        before = TP.clean_policy(b.policy)
        b.policy = TP.clean_policy(body)
        await _audit(db, staff, "policy.changed", b.id,
                     {"exclusion_sets": ",".join(b.policy["exclusions"]["sets"]), "exclusions_locked": b.policy["exclusions"]["locked"],
                      "extra_exclusions": len(b.policy["exclusions"]["extra"]), "member_suppression": b.policy["member_suppression"],
                      "geo_districts": len(b.policy["geo"]["districts"]), "restricted": ",".join(s for s, v in b.policy["restricted_sources"].items() if v),
                      "signin": ",".join(k for k, v in b.policy["signin"].items() if v), "changed": before != b.policy}, to_orgs=True)
        await db.commit()
        TP.invalidate()
        return {"id": b.id, "policy": b.policy}


@staff_router.post("/brands/{brand_id}/domains")
async def add_domain(brand_id: str, body: DomainIn, request: Request):
    staff = _admin_only(request)
    host = _host(body.host)
    async with AsyncSessionLocal() as db:
        b = await _get(db, brand_id)
        if (await db.execute(select(BrandDomain).where(BrandDomain.host == host))).scalars().first():
            raise HTTPException(status_code=409, detail="That address already belongs to a brand.")
        d = BrandDomain(host=host, brand_id=b.id, verified=bool(body.verified))
        db.add(d)
        await db.flush()
        await _audit(db, staff, "brand.domain_added", b.id, {"host": host})
        await db.commit()
        return {"id": d.id, "host": d.host, "verified": bool(d.verified)}


@staff_router.delete("/brands/{brand_id}/domains/{domain_id}")
async def remove_domain(brand_id: str, domain_id: str, request: Request):
    staff = _admin_only(request)
    async with AsyncSessionLocal() as db:
        d = (await db.execute(select(BrandDomain).where(BrandDomain.id == domain_id, BrandDomain.brand_id == brand_id))).scalars().first()
        if not d:
            raise HTTPException(status_code=404, detail="Address not found.")
        host = d.host
        await db.delete(d)
        await _audit(db, staff, "brand.domain_removed", brand_id, {"host": host})
        await db.commit()
        return {"id": domain_id, "deleted": True}


@staff_router.get("/brand-organizations")
async def organizations_with_brand(request: Request, brand_id: str = ""):
    _who(request)
    where = "WHERE coalesce(o.status, 'active') <> 'platform'" + (" AND o.brand_id = :b" if brand_id else "")
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT o.id, o.name, o.slug, o.status, o.brand_id, b.name FROM organizations o LEFT JOIN brands b ON b.id = o.brand_id "
            f"{where} ORDER BY o.name"), {"b": brand_id} if brand_id else {})).all()
    return {"organizations": [{"id": r[0], "name": r[1], "slug": r[2], "status": r[3] or "active", "brandId": r[4], "brandName": r[5]} for r in rows]}


async def _link(brand_id: str, org_id: str, request: Request, on: bool) -> Dict[str, Any]:
    staff = _admin_only(request)
    async with AsyncSessionLocal() as db:
        await _get(db, brand_id)
        org = (await db.execute(text("SELECT brand_id FROM organizations WHERE id = :i AND coalesce(status, 'active') <> 'platform'"), {"i": org_id})).first()
        if not org:
            raise HTTPException(status_code=404, detail="Organisation not found.")
        if not on and org[0] != brand_id:
            raise HTTPException(status_code=409, detail="That organisation does not follow this brand.")
        await db.execute(text("UPDATE organizations SET brand_id = :b, updated_at = now() WHERE id = :i"), {"b": brand_id if on else None, "i": org_id})
        await db.commit()
    TP.invalidate(org_id)
    with org_scope(org_id):  # the organisation's own log shows when it came under, or left, a brand's policy
        async with AsyncSessionLocal() as odb:
            await audit.record(odb, "brand.linked" if on else "brand.unlinked", target=brand_id, detail={"org": org_id},
                               actor_id=str(staff.get("id") or staff.get("email") or ""), actor_name=staff.get("email") or staff.get("name") or "staff")
            await odb.commit()
    return {"orgId": org_id, "brandId": brand_id if on else None}


@staff_router.put("/brands/{brand_id}/organizations/{org_id}")
async def link_org(brand_id: str, org_id: str, request: Request):
    return await _link(brand_id, org_id, request, True)


@staff_router.delete("/brands/{brand_id}/organizations/{org_id}")
async def unlink_org(brand_id: str, org_id: str, request: Request):
    return await _link(brand_id, org_id, request, False)


# ── What the sign-in page and the app read ──────────────────────────────────
@public_router.get("/brand")
async def brand_for_host(request: Request, response: Response, host: str = ""):
    """The look for a host name; {} when the host has no brand. Never returns policy: only the sign-in methods the page may offer."""
    async with AsyncSessionLocal() as db:
        b, _dom = await TP.brand_for_host(db, host or request.headers.get("host", ""))
    response.headers["Cache-Control"] = "public, max-age=60"
    return look(b) if b else {}


@public_router.get("/me/brand")
async def my_brand(request: Request):
    from app.core.auth_middleware import current

    ctx = current(request)
    org_id = ctx.get("org_id") or ""
    async with AsyncSessionLocal() as db:
        bid = (await db.execute(text("SELECT brand_id FROM organizations WHERE id = :i"), {"i": org_id})).scalar()
        b = (await db.execute(select(Brand).where(Brand.id == bid))).scalars().first() if bid else None
    if not b:
        return {}
    pol = await TP.effective(None, org_id)
    s = pol.summary()
    return {**look(b), "hideCredits": bool(b.hide_credits), "standingExclusions": s["standingExclusions"], "geoDistricts": s["geoDistricts"],
            "restrictedSources": s["restrictedSources"]}
