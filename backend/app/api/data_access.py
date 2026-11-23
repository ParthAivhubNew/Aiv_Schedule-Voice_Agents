"""An admin sets what each person in their organisation can see and do with company data.

GET /org/data-access                          the areas the organisation can use, its roles, and every user with their areas and switches
PUT /org/data-access/{operator_id}            change one person's areas (districts), export and Google switches, or their one non-admin role
GET /org/data-access/{operator_id}/preview    how many companies that person can reach, counted through the same search path they use

Admins only, checked in each handler. Never crosses organisations (an id from another organisation is 404). Admins are never narrowed.
Every change writes an audit row with the old and new values.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.core.tenancy import scope_actor
from app.database import get_db
from app.models.models import Operator, OperatorDataScope, OperatorRole, Role
from app.services import audit
from app.services import data_access as DA
from app.services import tenant_policy as TP

router = APIRouter(prefix="/org/data-access", tags=["Data access"])


class AccessPatch(BaseModel):
    districts: Optional[List[str]] = None
    allow_export: Optional[bool] = None
    allow_google: Optional[bool] = None
    role_id: Optional[str] = None


def _admin(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if ctx.get("type") == "api_key" or not ctx.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only an account admin can manage data access.")
    return ctx


async def _lock(db: AsyncSession, org_id: str) -> List[str]:
    return (await TP.org_effective(db, org_id)).geo_districts


async def _operator(db: AsyncSession, org_id: str, operator_id: str) -> Operator:
    op = (await db.execute(select(Operator).where(Operator.id == operator_id, Operator.org_id == org_id))).scalars().first()
    if not op:
        raise HTTPException(status_code=404, detail="That user isn't in your organisation.")
    return op


async def _roles_by_operator(db: AsyncSession, org_id: str) -> Dict[str, List[Role]]:
    rows = (await db.execute(select(OperatorRole.operator_id, Role).join(Role, Role.id == OperatorRole.role_id).where(Role.org_id == org_id))).all()
    out: Dict[str, List[Role]] = {}
    for op_id, role in rows:
        out.setdefault(op_id, []).append(role)
    return out


def _user(op: Operator, roles: List[Role], scope: Optional[OperatorDataScope]) -> Dict[str, Any]:
    return {"id": op.id, "name": op.name, "username": op.username, "email": op.email or "", "is_admin": any(r.is_admin for r in roles),
            "active": op.is_active is not False, "roles": [{"id": r.id, "name": r.name} for r in roles],
            "districts": list(scope.districts or []) if scope else [], "allow_export": scope.allow_export is not False if scope else True,
            "allow_google": scope.allow_google is not False if scope else True}


async def _scope_row(db: AsyncSession, operator_id: str, org_id: str) -> Optional[OperatorDataScope]:
    return (await db.execute(select(OperatorDataScope).where(OperatorDataScope.operator_id == operator_id, OperatorDataScope.org_id == org_id))).scalars().first()


@router.get("")
async def overview(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = _admin(request)
    org = ctx["org_id"]
    ops = (await db.execute(select(Operator).where(Operator.org_id == org).order_by(Operator.name))).scalars().all()
    roles = (await db.execute(select(Role).where(Role.org_id == org).order_by(Role.name))).scalars().all()
    by_op = await _roles_by_operator(db, org)
    scopes = {s.operator_id: s for s in (await db.execute(select(OperatorDataScope).where(OperatorDataScope.org_id == org))).scalars().all()}
    return {"districts_allowed": await _lock(db, org), "roles": [{"id": r.id, "name": r.name, "is_admin": bool(r.is_admin)} for r in roles],
            "users": [_user(o, by_op.get(o.id, []), scopes.get(o.id)) for o in ops]}


@router.put("/{operator_id}")
async def change(operator_id: str, body: AccessPatch, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = _admin(request)
    org = ctx["org_id"]
    op = await _operator(db, org, operator_id)
    roles = (await _roles_by_operator(db, org)).get(op.id, [])
    target_is_admin = any(r.is_admin for r in roles)
    if target_is_admin:
        raise HTTPException(status_code=400, detail="Admins always see everything, so their access can't be limited or their role changed here.")
    districts: Optional[List[str]] = None
    if body.districts is not None:
        try:
            districts = DA.clean_districts(body.districts)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
        lock = await _lock(db, org)
        if lock and any(not DA.within(d, lock) for d in districts):
            raise HTTPException(status_code=400, detail=DA.OUT_OF_LOCK)
    new_role: Optional[Role] = None
    if body.role_id is not None:
        new_role = (await db.execute(select(Role).where(Role.id == body.role_id, Role.org_id == org))).scalars().first()
        if not new_role:
            raise HTTPException(status_code=404, detail="That role isn't in your organisation.")
        if new_role.is_admin:
            raise HTTPException(status_code=400, detail="To make someone an admin, use Users & roles.")
    row = await _scope_row(db, op.id, org)
    old = {"districts": list(row.districts or []) if row else [], "allow_export": row.allow_export is not False if row else True,
           "allow_google": row.allow_google is not False if row else True, "roles": [r.name for r in roles]}
    if row is None:
        row = OperatorDataScope(operator_id=op.id, org_id=org, districts=[], allow_export=True, allow_google=True)
        db.add(row)
    if districts is not None:
        row.districts = districts
    if body.allow_export is not None:
        row.allow_export = bool(body.allow_export)
    if body.allow_google is not None:
        row.allow_google = bool(body.allow_google)
    row.updated_by = ctx.get("operator_id") or ""
    from datetime import datetime

    row.updated_at = datetime.utcnow()
    if new_role is not None:
        from sqlalchemy import delete

        await db.execute(delete(OperatorRole).where(OperatorRole.operator_id == op.id))
        db.add(OperatorRole(operator_id=op.id, role_id=new_role.id))
    await db.flush()
    new = {"districts": list(row.districts or []), "allow_export": row.allow_export is not False, "allow_google": row.allow_google is not False,
           "roles": [new_role.name] if new_role is not None else old["roles"]}
    await audit.record(db, "data_access.changed", target=op.id, detail={"user": op.username, "old": old, "new": new},
                       actor_id=ctx.get("operator_id") or "", actor_name=str(ctx.get("name") or ctx.get("username") or ""))
    await db.commit()
    TP.invalidate(org)  # every count and page remembered under the old limits is dropped
    from app.core import auth_middleware

    auth_middleware.forget(op.id)  # a role change applies at once
    roles_now = (await _roles_by_operator(db, org)).get(op.id, [])
    return _user(op, roles_now, await _scope_row(db, op.id, org))


@router.get("/{operator_id}/preview")
async def preview(operator_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = _admin(request)
    org = ctx["org_id"]
    op = await _operator(db, org, operator_id)
    from app.services import business_records as BR

    with scope_actor(op.id):  # the same policy path that person's own searches take
        scope = await DA.current_scope(db)
        where, capped, _ = await BR.matching(db, BR.normalize_filters({}), count=BR._capped_count, broaden=False)
        exact = await BR.exact_total(db, where, {"_preview": True})
    return {"companies": int(exact if exact is not None else capped), "districts": list(scope.districts)}
