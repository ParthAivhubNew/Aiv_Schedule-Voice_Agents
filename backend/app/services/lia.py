"""The legitimate interests assessment (LIA) a customer keeps on file for emailing companies.

One document per organisation, prefilled with plain wording the customer edits. We store it and print it;
we do not judge it. The doc lives in the settings table like the lists do (key `lia:{org}`).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import current_org
from app.models.models import CompanyProfile
from app.services import credits as credit

FIELDS = ("purpose", "necessity", "balance", "safeguards")
MAX_FIELD = 4000
TITLES = {
    "purpose": "1. Purpose: what we want and why",
    "necessity": "2. Necessity: why contacting them is needed",
    "balance": "3. Balance: how it affects the people we write to",
    "safeguards": "4. Safeguards: what protects them",
}


def _key() -> str:
    return f"lia:{current_org()}"


def prefill(name: str, pitch: str, industry: str) -> Dict[str, str]:
    who = (name or "our company").strip()
    what = (pitch or f"{industry or 'our services'}").strip().rstrip(".")
    return {
        "purpose": f"{who} wants to tell other businesses about {what}. We write to the business address of a company or a named person at it, because they may find it useful.",
        "necessity": "A short email to a business address is a small step compared with ads or cold calls. We write only to companies that look like the kind we help, chosen from public registers and the company's own website.",
        "balance": "The people we write to are acting for their company, not for themselves. They would reasonably expect an offer like this from a supplier. Each email says who we are and why we wrote, and takes one click to stop.",
        "safeguards": "Every email has a working unsubscribe link and our postal address. Anyone who opts out goes on our do-not-email list and is never written to again. We write only to company addresses, we do not email sole traders or partnerships without their agreement, and we stop at once if someone objects.",
    }


async def get(db: AsyncSession) -> Dict[str, Any]:
    doc = await credit._get_doc(db, _key())
    if doc.get("purpose") is not None:
        return {**{f: str(doc.get(f) or "") for f in FIELDS}, "updated_at": doc.get("updated_at") or "", "by": doc.get("by") or "", "saved": True}
    p = (await db.execute(select(CompanyProfile).limit(1))).scalars().first()
    return {**prefill(getattr(p, "name", "") or "", getattr(p, "pitch", "") or "", getattr(p, "industry", "") or ""), "updated_at": "", "by": "", "saved": False}


async def put(db: AsyncSession, body: Dict[str, Any], by: str, now: datetime = None) -> Dict[str, Any]:
    now = now or datetime.utcnow()
    doc = {f: str(body.get(f) or "").strip()[:MAX_FIELD] for f in FIELDS}
    doc.update(updated_at=now.isoformat() + "Z", by=by or "")
    await credit._put_doc(db, _key(), doc)
    await db.commit()
    return {**doc, "saved": True}


def as_text(doc: Dict[str, Any], company: str = "") -> str:
    head = "Legitimate interests assessment" + (f": {company}" if company else "")
    lines = [head, ""]
    for f in FIELDS:
        lines += [TITLES[f], (doc.get(f) or "").strip() or "(not filled in)", ""]
    if doc.get("updated_at"):
        lines.append(f"Last updated {doc['updated_at'][:10]}{' by ' + doc['by'] if doc.get('by') else ''}.")
    return "\n".join(lines).rstrip() + "\n"
