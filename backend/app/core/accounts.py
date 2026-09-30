"""Users, roles and effective permissions (database side)."""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.permissions import SYSTEM_ROLES, merge
from app.models.models import Operator, OperatorGrant, OperatorRole, Role

DEFAULT_ORG = "org_default"


def org_of(op: Operator) -> str:
    org = (op.org_id or "").strip()
    return DEFAULT_ORG if org in ("", "default") else org


async def ensure_system_roles(db: AsyncSession, org_id: str = DEFAULT_ORG) -> Dict[str, Role]:
    """Create any missing starter role for this organisation. Returns name -> Role."""
    rows = (await db.execute(select(Role).where(Role.org_id == org_id))).scalars().all()
    by_name = {r.name: r for r in rows}
    changed = False
    for name, spec in SYSTEM_ROLES.items():
        if name in by_name:
            continue
        suffix = "default" if org_id == DEFAULT_ORG else org_id
        role = Role(
            id=f"role_{suffix}_{name.lower()}",
            org_id=org_id,
            name=name,
            description=spec["description"],
            is_admin=spec["is_admin"],
            is_system=True,
            levels=dict(spec["levels"]),
        )
        db.add(role)
        by_name[name] = role
        changed = True
    if changed:
        await db.flush()
    return by_name


async def roles_of(db: AsyncSession, operator_id: str) -> List[Role]:
    q = select(Role).join(OperatorRole, OperatorRole.role_id == Role.id).where(OperatorRole.operator_id == operator_id)
    return list((await db.execute(q)).scalars().all())


async def grants_of(db: AsyncSession, operator_id: str) -> Dict[str, str]:
    rows = (await db.execute(select(OperatorGrant).where(OperatorGrant.operator_id == operator_id))).scalars().all()
    return {g.section: g.level for g in rows}


async def assign_roles(db: AsyncSession, operator: Operator, role_ids: List[str]) -> None:
    await db.execute(delete(OperatorRole).where(OperatorRole.operator_id == operator.id))
    for rid in dict.fromkeys(role_ids):
        db.add(OperatorRole(operator_id=operator.id, role_id=rid))
    await db.flush()


async def ensure_role_for(db: AsyncSession, operator: Operator) -> None:
    """Give a user with no role the starter role matching their old role label."""
    if await roles_of(db, operator.id):
        return
    roles = await ensure_system_roles(db, org_of(operator))
    name = (operator.role or "").strip().title()
    role = roles.get(name) or roles["Operator"]
    db.add(OperatorRole(operator_id=operator.id, role_id=role.id))
    await db.flush()


async def effective_access(db: AsyncSession, operator: Operator) -> Tuple[bool, Dict[str, str], List[Role]]:
    """(is_admin, section levels, roles) for this user."""
    roles = await roles_of(db, operator.id)
    is_admin = any(r.is_admin for r in roles)
    grants = await grants_of(db, operator.id)
    perms = merge([r.levels or {} for r in roles] + [grants], is_admin=is_admin)
    return is_admin, perms, roles


async def admins_in(db: AsyncSession, org_id: str, exclude: Optional[str] = None) -> List[Operator]:
    """Active users holding an admin role in the organisation."""
    q = (
        select(Operator)
        .join(OperatorRole, OperatorRole.operator_id == Operator.id)
        .join(Role, Role.id == OperatorRole.role_id)
        .where(Role.is_admin.is_(True), Role.org_id == org_id)
    )
    ops = (await db.execute(q)).scalars().unique().all()
    return [o for o in ops if o.is_active is not False and o.id != exclude]
