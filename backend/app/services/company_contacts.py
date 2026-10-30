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


PEOPLE_V = 2  # officers saved with nationality, occupation and the rest carry this mark; older saves are read again when the company is opened


def _year_of(stamp: Any) -> int:
    m = re.match(r"(\d{4})", str(stamp or ""))
    return int(m.group(1)) if m else 0


def _officer_id(link: Any) -> str:
    m = re.search(r"/officers/([^/]+)/appointments", str(link or ""))
    return m.group(1) if m else ""


def active_officers(officers: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    out = []
    this_year = datetime.utcnow().year
    for o in officers or []:
        if not isinstance(o, dict) or not o.get("name") or o.get("resigned_on"):
            continue
        role = str(o.get("role") or "")
        if role and not _ROLE_KEEP.search(role.replace("-", " ")):
            continue
        since = _year_of(o.get("appointed_on"))
        out.append({"name": o["name"], "role": role.replace("-", " ").title(), "appointed_on": o.get("appointed_on") or "",
                    "years_in_role": max(this_year - since, 0) if since else None,
                    "nationality": o.get("nationality") or "", "occupation": o.get("occupation") or "",
                    "country_of_residence": o.get("country_of_residence") or "", "born_year": o.get("born_year") or "",
                    "officer_id": _officer_id(o.get("appointments_link")),
                    **split_officer_name(o["name"]), "source": "registry", "verified": True})
    return out


def recent_leavers(officers: Optional[List[Dict[str, Any]]], days: int = 365) -> List[Dict[str, Any]]:
    """Directors and secretaries who resigned in the last year: a change at the top is a reason to get in touch."""
    out = []
    for o in officers or []:
        if not isinstance(o, dict) or not o.get("name") or not o.get("resigned_on"):
            continue
        role = str(o.get("role") or "")
        if role and not _ROLE_KEEP.search(role.replace("-", " ")):
            continue
        if _age_days(str(o["resigned_on"])[:10] + "T00:00:00") <= days:
            out.append({"name": o["name"], "role": role.replace("-", " ").title(), "resigned_on": o["resigned_on"]})
    return sorted(out, key=lambda x: x["resigned_on"], reverse=True)


_SHARES = re.compile(r"(ownership-of-shares|ownership-of-voting-rights|voting-rights)-(more-than-)?(\d+)(?:-to-(\d+))?-percent")


def _nature_words(code: str) -> str:
    """'ownership-of-shares-25-to-50-percent' -> 'Owns 25 to 50% of the shares'."""
    code = code.strip()
    m = _SHARES.match(code)
    if m:
        share = f"{'more than ' if m.group(2) else ''}{m.group(3)}{' to ' + m.group(4) if m.group(4) else ''}%"
        words = f"Owns {share} of the shares" if m.group(1) == "ownership-of-shares" else f"Holds {share} of the votes"
        return words + (" (through a trust)" if "-as-trust" in code else " (through a firm)" if "-as-firm" in code else "")
    return code.replace("-", " ").capitalize()


def controllers(psc: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """The people and companies that own or control this one and still do (not ceased), with what they control in plain words."""
    out = []
    for p in psc or []:
        if not isinstance(p, dict) or not p.get("name") or p.get("ceased_on"):
            continue
        natures = [_nature_words(n) for n in str(p.get("nature_of_control") or "").split(", ") if n.strip()]
        out.append({"name": p["name"], "kind": str(p.get("kind") or "").replace("-", " ").replace("persons with significant control", "").strip(),
                    "controls": natures, "since": p.get("notified_on") or "", "nationality": p.get("nationality") or "",
                    "country_of_residence": p.get("country_of_residence") or "", "born_year": p.get("born_year") or ""})
    return out


def people_stale(biz: BusinessRecord) -> bool:
    """True when the officers still need reading: none saved yet, or saved before nationality, occupation and the rest were kept."""
    saved = biz.officers
    if not saved:
        return getattr(biz, "people_checked_at", None) is None  # read before and it had none: leave it
    return any(isinstance(o, dict) and o.get("v") != PEOPLE_V for o in saved)


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
        for o in profile.get("officers") or []:
            if isinstance(o, dict):
                o["v"] = PEOPLE_V
        profile.setdefault("registration_number", biz.registration_number)
        await business_records.upsert(db, source_id=source.id, source_type=source.kind, confidence_tier="verified_registry", data=profile)
        await db.refresh(biz)
        biz.people_checked_at = datetime.utcnow()
        return True
    return False


def is_uk_phone(p: str) -> bool:
    """A UK number as it is really built: 0 or +44, then 9 or 10 digits that start 1, 2, 3, 5, 7 or 8. Premium (09), the 04 and 06 ranges
    and anything with the wrong length are dropped, so a stray number from a web page never reaches a customer as the company's phone."""
    digits = re.sub(r"[^\d+]", "", p or "")
    if digits.startswith("+44"):
        national = digits[3:]
        if national.startswith("0"):
            national = national[1:]
    elif digits.startswith("0") and not digits.startswith("00"):
        national = digits[1:]
    else:
        return False
    return national.isdigit() and len(national) in (9, 10) and national[0] in "123578" and len(set(national)) > 2


CACHE_DAYS = 90        # a lookup is reused for this long; after that the next ask searches again
AUDIT_DAYS = 365       # the audit of what a lookup weighed is kept for this long, then dropped


def _age_days(stamp: Any) -> float:
    try:
        return (datetime.utcnow() - datetime.fromisoformat(str(stamp).rstrip("Z"))).total_seconds() / 86400
    except (TypeError, ValueError):
        return 1e9


async def web_contacts(db: AsyncSession, biz: BusinessRecord, *, refresh: bool = False, want: str = "all") -> Dict[str, Any]:
    """A live web lookup for the company's website, phone and email. Stored on the record under raw_data['contacts_web'] -- NOT in the
    verified columns -- so a web finding never sits in a field the registry tier vouches for.

    The lookup is the guardrail's: web_harness searches with one recipe, and only a candidate that passes the hard rules and scores
    over the threshold is kept, one value per field. A saved lookup is reused for CACHE_DAYS; one saved before the guardrail existed
    (no `guardrail` mark) is stale at once, because its phones and emails were never checked."""
    cached = (biz.raw_data or {}).get("contacts_web")
    fresh = bool(cached) and bool(cached.get("guardrail")) and _age_days(cached.get("fetched_at")) <= CACHE_DAYS
    if cached and not refresh and fresh:
        if cached.get("audit") and _age_days(cached.get("fetched_at")) > AUDIT_DAYS:
            raw = dict(biz.raw_data or {})
            raw["contacts_web"] = {k: v for k, v in cached.items() if k != "audit"}
            biz.raw_data = raw
            await db.flush()
        return {**cached, "cached": True}
    from app.services import web_harness

    facts = {"address": biz.address, "postcode": biz.postcode, "industry": (biz.sic_text or biz.industry or "").split(" | ")[0],
             "company_number": biz.registration_number, "website": biz.website or biz.domain, "phone": biz.phone, "email": biz.email,
             "status": biz.status}
    try:
        got = await web_harness.find_company(db, name=biz.name, place=biz.region or "", facts=facts, want=want)
    except Exception as err:
        logger.warning("web lookup failed for %s: %s", biz.name, err)
        raise
    stamp = datetime.utcnow().isoformat() + "Z"
    if got.get("ledger", {}).get("outcome") == "closed":
        return {"website": "", "phones": [], "emails": [], "team": [], "sources": [], "source": "web", "verified": False, "found": False, "cached": False,
                "closed": True, "reason": got.get("reason", ""), "fetched_at": stamp}
    found = {"website": got["website"], "phones": got["phones"][:1], "emails": got["emails"][:1], "team": [], "sources": got["sources"][:8],
             "source": "web", "verified": False, "guardrail": True, "confidence": got["confidence"], "audit": got["audit"], "ledger": got["ledger"],
             "fetched_at": stamp}
    if cached and cached.get("guardrail"):  # a refresh adds to what an earlier checked lookup found; it never throws that away
        found["website"] = found["website"] or cached.get("website") or ""
        found["phones"] = found["phones"] or list(cached.get("phones") or [])[:1]
        found["emails"] = found["emails"] or list(cached.get("emails") or [])[:1]
    elif cached:
        # A lookup from before the guardrail: its website was only checked for looking like the company's, and its phones and emails
        # were never checked. They are retired here, so nothing unchecked is shown again.
        found["website"] = found["website"] or (cached.get("website") or "")
    if not (found["website"] or found["phones"] or found["emails"]):
        if cached and not cached.get("guardrail"):
            raw = dict(biz.raw_data or {})
            raw["contacts_web"] = {**found, "website": "", "phones": [], "emails": []}
            biz.raw_data = raw
            business_records.refresh_rank(biz)
            await db.flush()
        return {**found, "found": False, "cached": False, "reason": got.get("reason", "")}
    raw = dict(biz.raw_data or {})
    raw["contacts_web"] = found
    biz.raw_data = raw
    business_records.refresh_rank(biz)
    await db.flush()
    return {**found, "found": True, "cached": False}
