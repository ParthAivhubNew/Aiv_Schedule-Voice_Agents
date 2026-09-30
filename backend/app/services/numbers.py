"""The organisation's phone numbers and who may call from which.

Rules
- Numbers belong to an organisation (row-level security keeps them apart).
- A number with no assigned users is shared: anyone with Calling access may use it.
  A number with assigned users is used only by them (admins can use every number).
- When a call names no number, the caller's own number is used (first assigned), then the
  organisation's default number.
- An organisation with no numbers saved yet keeps the old behaviour (the caller ID saved in
  Connections / Company profile), so nothing that works today stops working.
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import OrgPhoneNumber, PhoneNumberAssignment


def normalize(e164: str) -> str:
    from app.services.timezone_service import normalize_phone

    return normalize_phone(e164)


async def list_numbers(db: AsyncSession) -> List[OrgPhoneNumber]:
    return list((await db.execute(select(OrgPhoneNumber).order_by(OrgPhoneNumber.is_default.desc(), OrgPhoneNumber.created_at))).scalars().all())


async def assignments(db: AsyncSession, number_ids: List[str]) -> Dict[str, List[str]]:
    if not number_ids:
        return {}
    rows = (await db.execute(select(PhoneNumberAssignment).where(PhoneNumberAssignment.number_id.in_(number_ids)))).scalars().all()
    out: Dict[str, List[str]] = {n: [] for n in number_ids}
    for r in rows:
        out.setdefault(r.number_id, []).append(r.operator_id)
    return out


def usable_by(num: OrgPhoneNumber, assigned: List[str], operator_id: Optional[str], is_admin: bool) -> bool:
    if (num.status or "active") != "active":
        return False
    if is_admin or not assigned:
        return True
    return bool(operator_id) and operator_id in assigned


async def numbers_json(db: AsyncSession, ctx: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    nums = await list_numbers(db)
    asg = await assignments(db, [n.id for n in nums])
    me = (ctx or {}).get("operator_id")
    admin = bool((ctx or {}).get("is_admin"))
    return [
        {
            "id": n.id, "e164": n.e164, "label": n.label or "", "provider": n.provider or "telnyx",
            "assistantId": n.assistant_id or "", "capabilities": n.capabilities or ["voice"], "status": n.status or "active",
            "isDefault": bool(n.is_default), "assignedTo": asg.get(n.id, []), "shared": not asg.get(n.id),
            "usableByMe": usable_by(n, asg.get(n.id, []), me, admin),
        }
        for n in nums
    ]


async def seed_from_legacy(db: AsyncSession) -> Optional[OrgPhoneNumber]:
    """First visit: turn the caller ID already saved in Connections into the default number."""
    if await list_numbers(db):
        return None
    legacy = None
    try:
        from app.services.telnyx_assistant_dial import _resolve_telnyx_from_number

        legacy = await _resolve_telnyx_from_number(db)
    except Exception:
        legacy = None
    if not legacy:
        return None
    num = OrgPhoneNumber(id=f"num_{uuid.uuid4().hex[:10]}", e164=normalize(legacy), label="Main line",
                         provider="telnyx", is_default=True, capabilities=["voice"])
    db.add(num)
    await db.commit()
    return num


async def pick_caller_id(db: AsyncSession, ctx: Optional[Dict[str, Any]], requested: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """(number to call from, error). (None, None) = no numbers saved: use the old caller ID."""
    nums = await list_numbers(db)
    if not nums:
        return None, None
    asg = await assignments(db, [n.id for n in nums])
    me = (ctx or {}).get("operator_id")
    admin = bool((ctx or {}).get("is_admin"))
    usable = [n for n in nums if usable_by(n, asg.get(n.id, []), me, admin)]
    if requested and str(requested).strip():
        want = normalize(str(requested))
        match = next((n for n in nums if normalize(n.e164) == want), None)
        if not match:
            # Not one of the organisation's numbers: leave the old behaviour to decide.
            return None, None
        if match not in usable:
            return None, f"You are not allowed to call from {match.e164}. Ask an admin to assign it to you."
        return match.e164, None
    mine = [n for n in usable if me and me in asg.get(n.id, [])]
    if mine:
        return mine[0].e164, None
    default = next((n for n in usable if n.is_default), None) or (usable[0] if usable else None)
    if default:
        return default.e164, None
    return None, "No phone number is available to you. Ask an admin to assign one."


async def set_assignments(db: AsyncSession, number_id: str, operator_ids: List[str]) -> None:
    await db.execute(delete(PhoneNumberAssignment).where(PhoneNumberAssignment.number_id == number_id))
    for oid in dict.fromkeys(operator_ids or []):
        db.add(PhoneNumberAssignment(number_id=number_id, operator_id=oid))


async def org_for_numbers(*candidates: str) -> Optional[str]:
    """Which organisation owns any of these numbers (for incoming webhooks). Cross-org lookup."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    wanted = [normalize(c) for c in candidates if c]
    wanted = [w for w in wanted if w]
    if not wanted:
        return None
    with system_scope():
        async with AsyncSessionLocal() as db:
            row = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.e164.in_(wanted)))).scalars().first()
            return row.org_id if row else None
