"""Contacts on demand for one company in the store -- layered by how much each layer can be trusted,
and every layer labelled with where it came from, so a user never mistakes a web guess for a
registry fact:

  1. Officers (directors/secretary) straight from the registry API -- verified, free.
  2. Website / phone / email already stored on the record, with the record's own trust tier.
  3. A live web lookup, only when asked, cached on the record and always labelled as web.

Email addresses for a named officer are NOT guessed here: that is the paid finder
(enrichment_waterfall.lookup_person_waterfall, 1 credit only on a verified hit), called per person.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import BusinessRecord, DataSource
from app.services import business_records
from app.services import data_source_connector as connector

logger = logging.getLogger("company_contacts")

_ROLE_KEEP = re.compile(r"director|secretary|member|partner|manager|owner|proprietor|trustee", re.I)


def split_officer_name(name: str) -> Dict[str, str]:
    """Registry officer names come as 'SURNAME, Forename Middle' (companies) -- turn that into the
    first/last pair the email finder needs. A name with no comma is read as 'First ... Last'."""
    raw = re.sub(r"\s+", " ", str(name or "")).strip()
    if "," in raw:
        last, rest = [p.strip() for p in raw.split(",", 1)]
        first = rest.split(" ")[0] if rest else ""
    else:
        parts = raw.split(" ")
        first, last = (parts[0], parts[-1]) if len(parts) > 1 else (raw, "")
    return {"first_name": first.title(), "last_name": last.title()}


def active_officers(officers: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    out = []
    for o in officers or []:
        if not isinstance(o, dict) or not o.get("name") or o.get("resigned_on"):
            continue
        role = str(o.get("role") or "")
        if role and not _ROLE_KEEP.search(role.replace("-", " ")):
            continue
        out.append({"name": o["name"], "role": role.replace("-", " ").title(), "appointed_on": o.get("appointed_on") or "",
                    **split_officer_name(o["name"]), "source": "registry", "verified": True})
    return out


async def refresh_from_registry(db: AsyncSession, biz: BusinessRecord) -> bool:
    """Fetch officers/controllers live from the registry source for this exact company number.
    Only accepts a search hit whose id equals the company's own registration number -- a near match
    is ignored, never merged in. Returns whether the record was updated."""
    reg = business_records._norm(biz.registration_number)
    if not reg:
        return False
    sources = (await db.execute(select(DataSource).where(DataSource.kind == "api", DataSource.status == "active"))).scalars().all()
    for source in sources:
        cfg = source.config or {}
        if not cfg.get("officers_endpoint") or cfg.get("trust_tier") != "verified_registry":
            continue
        try:
            hits = await connector.search(source, biz.registration_number, limit=5)
        except Exception as err:
            logger.warning(f"[company_contacts] {source.name} search failed: {err}")
            continue
        id_field = cfg.get("id_field_from_search", "id")
        hit = next((h for h in hits if business_records._norm(connector._dig(h, id_field)) == reg), None)
        if not hit:
            continue
        try:
            profile = await connector.fetch_profile(source, hit)
        except Exception as err:
            logger.warning(f"[company_contacts] {source.name} profile failed: {err}")
            continue
        profile.setdefault("registration_number", biz.registration_number)
        await business_records.upsert(db, source_id=source.id, source_type=source.kind, confidence_tier="verified_registry", data=profile)
        await db.refresh(biz)
        return True
    return False


async def web_contacts(db: AsyncSession, biz: BusinessRecord, *, refresh: bool = False) -> Dict[str, Any]:
    """A live web lookup for the company's website, phones and named team. Stored on the record
    under raw_data['contacts_web'] -- NOT in the verified columns -- so a web guess never sits in a
    field the registry tier vouches for, and the next person to ask gets it without another search."""
    cached = (biz.raw_data or {}).get("contacts_web")
    if cached and not refresh:
        return {**cached, "cached": True}
    from app.services.enrichment_service import enrich_prospect_intelligence

    data = await enrich_prospect_intelligence(name=biz.name, company=biz.name, domain=biz.domain or None,
                                              place=biz.region or None, db=db)
    team = [{"name": t.get("name") or "", "title": t.get("title") or "", "phone": t.get("phone") or "", "email": (t.get("email") or "").lower()}
            for t in (data.get("team") or []) if t.get("name")][:10]
    found = {
        "website": data.get("domain") or "", "phones": (data.get("phones") or [])[:5], "emails": (data.get("emails") or [])[:5],
        "team": team, "sources": (data.get("citations") or [])[:8],
        "source": "web", "verified": False, "fetched_at": datetime.utcnow().isoformat() + "Z",
    }
    if not (found["website"] or found["phones"] or found["emails"] or team):
        return {**found, "found": False, "cached": False}
    raw = dict(biz.raw_data or {})
    raw["contacts_web"] = found
    biz.raw_data = raw
    await db.flush()
    return {**found, "found": True, "cached": False}
