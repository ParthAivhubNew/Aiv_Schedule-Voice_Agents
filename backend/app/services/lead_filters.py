"""Turns what a user types in the Find Leads chat into the same structured filters the filter
panel uses, so the chat and the panel are one search, not two. The model only ever fills in the
filter shape (see business_records.normalize_filters, which drops anything else); the companies
that come back are always read from the company store, never written by the model.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import business_records, llm_gateway

logger = logging.getLogger("lead_filters")

_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["search", "remove", "chat"],
                   "description": "'search' = find companies, or change/narrow the current search. 'remove' = drop "
                                  "named companies from the current results. 'chat' = anything else (advice, a "
                                  "question, small talk) -- no search should run."},
        "keyword": {"type": "array", "items": {"type": "string"},
                    "description": "Only carry over the current 'keyword' filter unchanged; never set it yourself."},
        "sector": {"type": "array", "items": {"type": "string"},
                   "description": "Words that appear in an official industry (SIC) description: the sector AND its "
                                  "close synonyms, e.g. accountants -> ['accounting', 'bookkeeping', 'tax']; "
                                  "restaurants -> ['restaurant', 'cafe']. Singular stems, lower-case."},
        "sic_codes": {"type": "array", "items": {"type": "string"}, "description": "Only if the user gave SIC codes."},
        "towns": {"type": "array", "items": {"type": "string"},
                  "description": "UK towns/cities exactly as the registry spells them (London, Manchester). "
                                 "Expand a region only if the user named one (e.g. 'Greater Manchester')."},
        "postcode_prefixes": {"type": "array", "items": {"type": "string"}, "description": "e.g. EC1, M1, SW"},
        "status": {"type": "string", "description": "Leave empty for Active. 'any' only if the user asks to include "
                                                     "closed/dissolved companies."},
        "company_category": {"type": "string", "description": "e.g. 'Private Limited Company', 'PLC', 'LLP'"},
        "size_bands": {"type": "array", "items": {"type": "string", "enum": ["micro", "small", "medium_large", "dormant"]},
                       "description": "From the company's filed accounts. 'small business' -> micro+small."},
        "min_age_years": {"type": "number", "description": "'established', 'for 10+ years' -> 10"},
        "max_age_years": {"type": "number", "description": "'new', 'startups', 'recently founded' -> 2"},
        "name_contains": {"type": "string"},
        "has_website": {"type": "boolean"}, "has_email": {"type": "boolean"}, "has_phone": {"type": "boolean"},
        "remove_names": {"type": "array", "items": {"type": "string"},
                         "description": "For action 'remove': the company names the user wants gone."},
    },
    "required": ["action"],
}

_SYSTEM = (
    "You convert a message in a UK B2B lead-search chat into search filters. You are given the filters "
    "currently applied. When the user changes or narrows the search, return the FULL updated set of filters "
    "(keep every current filter they did not change; replace the ones they did). Fill a field only with what "
    "the user said or clearly implied -- never invent a town, a sector or a number. If the message is not about "
    "finding or removing companies, return action 'chat' and no filters."
)

_SEARCH_HINT = re.compile(
    r"\b(find|search|show|list|get|give|look(ing)? for|need|want|only|exclude|remove|drop|without|"
    r"narrow|add|also|instead|in|near|around|older|newer|micro|small|startup|established)\b", re.I)


async def interpret(db: AsyncSession, message: str, current: Optional[Dict[str, Any]] = None, *, scope: str = "leadgen") -> Dict[str, Any]:
    """-> {"action": "search"|"remove"|"chat", "filters": {...normalised...}, "remove_names": [...]}.
    Never raises: if the model can't be reached the answer is 'chat', so the user simply gets a
    conversational reply rather than an error or a made-up search."""
    current = business_records.normalize_filters(current or {}) if current else {}
    if not (message or "").strip() or not _SEARCH_HINT.search(message):
        return {"action": "chat", "filters": current, "remove_names": []}
    try:
        data = await llm_gateway.extract_structured(
            system_prompt=_SYSTEM, user_text=f"Current filters: {current or 'none'}\n\nMessage: {message}",
            schema=_SCHEMA, tool_name="set_lead_filters", db=db, scope=scope, max_tokens=500,
        )
    except Exception as err:
        logger.warning(f"[lead_filters] couldn't parse '{message[:80]}': {err}")
        data = None
    if not data:
        return {"action": "chat", "filters": current, "remove_names": []}
    action = data.get("action") if data.get("action") in ("search", "remove", "chat") else "chat"
    if action == "chat":
        return {"action": "chat", "filters": current, "remove_names": []}
    remove_names = [str(n).strip() for n in (data.get("remove_names") or []) if str(n).strip()]
    if action == "remove":
        return {"action": "remove", "filters": current, "remove_names": remove_names}
    filters = business_records.normalize_filters({k: v for k, v in data.items() if k in business_records.FILTER_KEYS})
    # "any status" is a deliberate ask; a blank status from the model must never widen the search.
    return {"action": "search", "filters": filters, "remove_names": []}


def card(biz) -> Dict[str, Any]:
    """One company as the Find Leads table shows it. Every field is copied from the stored record
    (nothing computed by a model), and `tier` says how far to trust it."""
    sic_first = (biz.sic_text or biz.industry or "").split(" | ")[0]
    return {
        "id": biz.id, "name": biz.name, "registration_number": biz.registration_number or "",
        "status": biz.status or "", "industry": sic_first, "sic_text": biz.sic_text or "",
        "region": biz.region or "", "postcode": biz.postcode or "", "address": biz.address or "",
        "company_category": biz.company_category or "", "incorporation_date": biz.incorporation_date or "",
        "size_band": biz.size_band or "", "website": biz.website or biz.domain or "", "phone": biz.phone or "",
        "email": biz.email or "", "tier": biz.confidence_tier or "scraped", "source_count": len(biz.sources or []),
        "has_officers": bool(biz.officers),
    }


def describe(filters: Dict[str, Any]) -> List[str]:
    """Plain-English chips for the filters actually applied, shown to the user so nothing is hidden."""
    chips: List[str] = []
    if filters.get("keyword"):
        chips.append("Name or sector: " + ", ".join(filters["keyword"]))
    if filters.get("sector"):
        chips.append("Sector: " + ", ".join(filters["sector"]))
    if filters.get("sic_codes"):
        chips.append("SIC: " + ", ".join(filters["sic_codes"]))
    if filters.get("towns"):
        chips.append("Town: " + ", ".join(t.title() for t in filters["towns"]))
    if filters.get("postcode_prefixes"):
        chips.append("Postcode: " + ", ".join(p.upper() for p in filters["postcode_prefixes"]))
    chips.append("Status: " + ("any" if str(filters.get("status", "")).lower() == "any" else filters.get("status", "Active")))
    if filters.get("company_category"):
        chips.append("Type: " + filters["company_category"])
    if filters.get("size_bands"):
        chips.append("Size (filed accounts): " + ", ".join(filters["size_bands"]))
    if filters.get("min_age_years") is not None:
        chips.append(f"Age: {filters['min_age_years']:g}+ years")
    if filters.get("max_age_years") is not None:
        chips.append(f"Age: under {filters['max_age_years']:g} years")
    if filters.get("name_contains"):
        chips.append("Name has: " + filters["name_contains"])
    for key, label in (("has_website", "Has website"), ("has_email", "Has email"), ("has_phone", "Has phone")):
        if filters.get(key):
            chips.append(label)
    return chips
