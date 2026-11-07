"""A director's work email found with the email finder, kept for the organisation that found it.

The finder's own cache is shared between organisations and charges each one when it answers. What one organisation paid for is
kept here, against the company and the person, so its company page, person page and results drawer show it on load and asking
again for the same person costs nothing. Rows are per organisation (row-level security), never shown to another one."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import BusinessRecord, PersonEmail


def person_key(name: Any) -> str:
    """The register name as a key: 'SMITH, John  Paul' and 'smith, john paul' are the same person at one company."""
    return re.sub(r"\s+", " ", str(name or "")).strip().lower()


def finder_domain(biz: BusinessRecord) -> str:
    """The company's website domain to help the finder, when we know one. Blank is fine: the finder then searches by company name."""
    raw = (biz.domain or "").strip() or (biz.website or "").strip() or str(((biz.raw_data or {}).get("contacts_web") or {}).get("website") or "").strip()
    d = re.sub(r"^https?://", "", raw.lower()).split("/")[0]
    return d[4:] if d.startswith("www.") else d


def shown(row: Optional[PersonEmail]) -> Dict[str, str]:
    """What the screens get: the address and how sure the finder was. Which finder answered is not shown."""
    return {"email": row.email, "status": row.status or ""} if row and row.email else {}


def attach(officers: List[Dict[str, Any]], kept: Dict[str, Dict[str, str]]) -> List[Dict[str, Any]]:
    """Put each officer's kept email on their row as work_email / work_email_status."""
    for o in officers:
        got = kept.get(person_key(o.get("name")))
        if got:
            o["work_email"], o["work_email_status"] = got["email"], got["status"]
    return officers


async def kept_for(db: AsyncSession, business_id: str) -> Dict[str, Dict[str, str]]:
    """person key -> {email, status} for every email this organisation found at this company."""
    from app.core.tenancy import current_org

    rows = (await db.execute(select(PersonEmail).where(PersonEmail.business_id == business_id, PersonEmail.org_id == current_org()))).scalars().all()
    return {r.person_key: shown(r) for r in rows if r.email}


async def kept_one(db: AsyncSession, business_id: str, name: str) -> Optional[PersonEmail]:
    from app.core.tenancy import current_org

    return (await db.execute(select(PersonEmail).where(PersonEmail.business_id == business_id, PersonEmail.person_key == person_key(name),
                                                       PersonEmail.org_id == current_org()))).scalars().first()


async def keep(db: AsyncSession, business_id: str, name: str, first_name: str, last_name: str, email: str, status: str, source: str) -> None:
    """Save (or refresh) the email this organisation found for this person. The caller commits."""
    from app.core.tenancy import current_org

    if not (business_id and person_key(name) and email):
        return
    row = await kept_one(db, business_id, name)
    if row:
        row.email, row.status, row.source = email.strip().lower(), status or "", source or ""
        return
    db.add(PersonEmail(org_id=current_org(), business_id=business_id, person_key=person_key(name), first_name=(first_name or "")[:80],
                       last_name=(last_name or "")[:80], email=email.strip().lower(), status=status or "", source=source or ""))
