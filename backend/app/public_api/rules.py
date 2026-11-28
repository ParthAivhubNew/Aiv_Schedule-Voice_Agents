"""What an organisation leaves out and who may see which areas, in the public API.

The same records the Administration screens edit: the organisation's exclusion list (Administration > Exclusions) and each person's postcode
areas (Administration > Data access). Every call runs the app's own handler, so the checks, the audit rows and the rules that apply to every
search are exactly the same as in the app. A key needs `company:write` (it comes with each of Voice, Leads and Social); a test key reads and
writes nothing real.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.public_api.core import V1Route, authorize, fail, is_test

router = APIRouter(tags=["Exclusions and areas"], route_class=V1Route)

SCOPE = "company:write"
MAX_ITEMS = 500


class RuleIn(BaseModel):
    kind: str = Field(..., max_length=40, description="sic, company_type, name_word, category, postcode, company_number, charity_register, status_only or ch_number_only")
    value: str = Field("", max_length=80)
    mode: str = Field("exclude", description="exclude, or keep (only for name_word)")
    label: str = Field("", max_length=120)


class ExclusionsIn(BaseModel):
    items: List[str] = Field(default_factory=list, max_length=MAX_ITEMS,
                             description='What to leave out, as typed in the app: "85200", "church", "Charity register", "keep: driving school"')
    rules: List[RuleIn] = Field(default_factory=list, max_length=MAX_ITEMS)


class ExclusionChange(BaseModel):
    value: Optional[str] = Field(None, max_length=80)
    label: Optional[str] = Field(None, max_length=120)
    enabled: Optional[bool] = None
    updated_at: Optional[str] = Field(None, description="The rule's updated_at as you read it: a changed rule is refused (409)")


class ExclusionPreviewIn(BaseModel):
    add_items: List[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    remove: List[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    toggle: Dict[str, bool] = Field(default_factory=dict)


class AccessChange(BaseModel):
    districts: Optional[List[str]] = Field(None, max_length=200, description="Postcode districts such as BN1, or a whole area such as LS. An empty list means all postcodes")
    allow_export: Optional[bool] = None
    allow_google: Optional[bool] = None
    role_id: Optional[str] = Field(None, max_length=80)


class AreasIn(BaseModel):
    districts: List[str] = Field(default_factory=list, max_length=200)


def _as_admin(request: Request, ctx: Dict[str, Any]) -> Any:
    """The request an app handler expects: the key's own account, acting as its admin (the key was made by one, and `company:write` was checked)."""
    return SimpleNamespace(state=SimpleNamespace(auth={**ctx, "type": "session", "is_admin": True}), headers=request.headers)


def _refuse(err: HTTPException) -> None:
    code = {400: "invalid_request", 404: "not_found", 409: "conflict", 413: "too_large", 422: "invalid_request"}.get(err.status_code, "invalid_request")
    fail(err.status_code if err.status_code in (400, 404, 409, 413, 422) else 422, code, str(err.detail))


async def _call(coro):
    """Run one of the app's handlers. Its plain-words refusals become this API's errors, and its list of unusable items rides along."""
    try:
        out = await coro
    except HTTPException as err:
        _refuse(err)
    if isinstance(out, JSONResponse):  # the app's 422 with the items it could not use
        body = json.loads(out.body)
        fail(out.status_code, "invalid_request", body.get("detail") or "Some of that can't be used.", rejected=body.get("rejected") or [])
    return out


# ── The exclusion list ──────────────────────────────────────────────
@router.get("/exclusions")
async def exclusions_get(request: Request, db: AsyncSession = Depends(get_db)):
    """The organisation's exclusion list: every rule, with a plain sentence for each. Every search, count and export of every person in it follows the rules that are on."""
    from app.api import org_exclusions as OE

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"rules": [], "max": OE.org_rules.MAX_RULES, "enabled": 0, "simulated": True}
    return await _call(OE.list_rules(_as_admin(request, ctx), db))


@router.post("/exclusions")
async def exclusions_add(body: ExclusionsIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Add rules. Send `items` as typed in the app, or `rules` with an explicit kind. If any item cannot be used nothing is added and each one is named in `rejected`."""
    from app.api import org_exclusions as OE

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"added": len(body.items) + len(body.rules), "skipped": 0, "rules": [], "simulated": True}
    return await _call(OE.add_rules(OE.AddIn(items=body.items, rules=[OE.RuleIn(**r.model_dump()) for r in body.rules]), _as_admin(request, ctx), db))


@router.post("/exclusions/preview")
async def exclusions_preview(body: ExclusionPreviewIn, request: Request, db: AsyncSession = Depends(get_db)):
    """How many companies the list leaves out now and after an edit you have not saved: `all` (no rules), `before`, `after` and `leavesOut`. A number is null when counting took too long."""
    from app.api import org_exclusions as OE

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"all": 0, "before": 0, "after": 0, "leavesOut": 0, "simulated": True}
    return await _call(OE.preview(OE.PreviewIn(add_items=body.add_items, remove=body.remove, toggle=body.toggle), _as_admin(request, ctx), db))


@router.patch("/exclusions/{rule_id}")
async def exclusions_change(rule_id: str, body: ExclusionChange, request: Request, db: AsyncSession = Depends(get_db)):
    """Change a rule's value or note, or switch it on or off."""
    from app.api import org_exclusions as OE

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"id": rule_id, "enabled": body.enabled is not False, "simulated": True}
    return await _call(OE.change_rule(rule_id, OE.PatchIn(**body.model_dump()), _as_admin(request, ctx), db))


@router.delete("/exclusions/{rule_id}")
async def exclusions_delete(rule_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Delete a rule."""
    from app.api import org_exclusions as OE

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"id": rule_id, "deleted": True, "simulated": True}
    return await _call(OE.delete_rule(rule_id, _as_admin(request, ctx), db))


# ── Who may see which areas ─────────────────────────────────────────
@router.get("/access")
async def access_get(request: Request, db: AsyncSession = Depends(get_db)):
    """Every person in the account with their postcode areas and their export and live-Google switches, and the roles you can give. Admins always see everything."""
    from app.api import data_access as DAPI

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"districts_allowed": [], "roles": [], "users": [], "simulated": True}
    return await _call(DAPI.overview(_as_admin(request, ctx), db))


@router.post("/access/preview")
async def access_preview(body: AreasIn, request: Request, db: AsyncSession = Depends(get_db)):
    """How many companies a list of areas would reach, for someone not saved yet or for areas not saved yet. An empty list means all postcodes."""
    from app.api import data_access as DAPI

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"companies": 0, "districts": body.districts, "simulated": True}
    return await _call(DAPI.preview_areas(DAPI.DraftAreas(districts=body.districts), _as_admin(request, ctx), db))


@router.put("/access/{user_id}")
async def access_set(user_id: str, body: AccessChange, request: Request, db: AsyncSession = Depends(get_db)):
    """Set one person's postcode areas, export and live-Google switches, or their one non-admin role. Send only what changes. An admin's access cannot be limited."""
    from app.api import data_access as DAPI

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"id": user_id, "districts": body.districts or [], "simulated": True}
    return await _call(DAPI.change(user_id, DAPI.AccessPatch(**body.model_dump()), _as_admin(request, ctx), db))
