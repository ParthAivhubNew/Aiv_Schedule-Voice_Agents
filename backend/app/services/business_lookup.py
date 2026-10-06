"""The chat / "Data Find" orchestrator: turns an open-ended prompt about businesses into either
one company's facts or a list of matches, direct or indirect -- checking the shared store first,
then live sources, then the open web -- and saves whatever it finds back into the shared store
for the next person who asks something similar. See business_records.py for why that store has
no org_id, and lead_accounts.py's research_account for the single-company version of this same
cascade (this generalizes it to open-ended, multi-result asks too).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import BusinessRecord
from app.services import business_records, llm_gateway

logger = logging.getLogger("business_lookup")

_INTENT_SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": ["lookup", "search"],
                   "description": "'lookup' = asking about one specific, named company. 'search' = an "
                                   "open-ended ask that wants a list of matching businesses, direct or indirect."},
        "name": {"type": "string", "description": "The specific company name, for 'lookup'."},
        "domain": {"type": "string"},
        "industry": {"type": "string", "description": "The kind of business being searched for."},
        "region": {"type": "string"},
        "keywords": {"type": "array", "items": {"type": "string"},
                     "description": "A handful of words/synonyms covering direct AND indirect matches for this request."},
        "search_query": {"type": "string", "description": "A short web-search phrase capturing the request, for 'search' intent."},
    },
    "required": ["intent"],
}

_PARSE_SYSTEM = (
    "You turn a user's message about businesses into a structured search. Pull out ONLY what "
    "company/industry/region they're asking about -- never include anything about the person "
    "asking, their own organisation, or any other context from the message."
)

_ANSWER_SYSTEM = (
    "Answer the user's question about businesses using ONLY the facts listed below -- never add "
    "anything not present in them. State plainly when a fact came from a verified registry versus "
    "a general web search (less certain); never present a web-search guess with registry-level "
    "confidence. If nothing relevant was found, say so instead of guessing."
)


async def parse_query(db: AsyncSession, prompt: str, *, scope: str = "leadgen") -> Dict[str, Any]:
    """Extracts only the target of the search -- never forwards the user's full message into
    anything that writes to the shared store or calls an external search, which is what keeps an
    organisation's own private context out of public, cross-organisation data."""
    data = await llm_gateway.extract_structured(
        system_prompt=_PARSE_SYSTEM, user_text=prompt, schema=_INTENT_SCHEMA,
        tool_name="parse_business_query", db=db, scope=scope,
    )
    return data or {"intent": "search", "keywords": [], "search_query": prompt}


async def _lookup_one(db: AsyncSession, intent: Dict[str, Any], *, scope: str) -> List[BusinessRecord]:
    name, domain = intent.get("name") or "", intent.get("domain") or ""
    record = await business_records.lookup(db, name=name, domain=domain, scope=scope)
    if record:
        return [record]
    # Same general web-search fallback lead_accounts.py's research_account already uses for one
    # saved company -- generalized here so the chat window gets it for any company asked about.
    from app.services.enrichment_service import enrich_prospect_intelligence

    try:
        data = await enrich_prospect_intelligence(name=name or domain, company=name or None, domain=domain or None)
    except Exception as err:
        logger.warning(f"[business_lookup] fallback research failed for {name or domain}: {err}")
        return []
    if not (data.get("phones") or data.get("emails") or data.get("overview")):
        return []
    try:
        record = await business_records.upsert(
            db, source_id="llm_web_search", source_type="llm_fallback", confidence_tier="llm_fallback",
            data={"name": name or data.get("company") or domain, "domain": domain or (data.get("domain") or ""),
                  "phone": (data.get("phones") or [""])[0], "email": (data.get("emails") or [""])[0],
                  "description": data.get("overview") or ""},
        )
    except ValueError:
        return []
    return [record]


async def _search_many(db: AsyncSession, intent: Dict[str, Any], *, scope: str, limit: int = 10) -> List[BusinessRecord]:
    keywords = [k for k in (intent.get("keywords") or []) if k]
    if intent.get("industry"):
        keywords.append(intent["industry"])
    region = intent.get("region") or ""
    keyword_hits = await business_records.search(db, keywords=keywords, region=region, limit=limit)
    semantic_hits = await business_records.semantic_search(db, intent.get("search_query") or " ".join(keywords), limit=limit)
    seen = {r.id for r in keyword_hits}
    merged = list(keyword_hits) + [r for r, _ in semantic_hits if r.id not in seen]
    if len(merged) >= 3:
        return merged[:limit]
    # Not enough in the shared store yet -- find some on the open web and save them for next time.
    query = intent.get("search_query") or " ".join(keywords + ([region] if region else []))
    if not query.strip():
        return merged
    from app.services.enrichment_service import search_open_web

    try:
        hits = await search_open_web(query, max_results=limit)
    except Exception as err:
        logger.warning(f"[business_lookup] open-web search failed for '{query}': {err}")
        return merged
    from app.services import data_source_scraper

    existing_ids = {r.id for r in merged}
    for hit in hits:
        url = hit.get("url") or ""
        if not url or len(merged) >= limit:
            continue
        try:
            profile = await data_source_scraper.scrape_url(db, url, scope=scope)
        except Exception as err:
            logger.debug(f"[business_lookup] couldn't read {url}: {err}")
            continue
        if not profile:
            continue
        try:
            record = await business_records.upsert(db, source_id=f"web:{url}"[:120], source_type="llm_fallback",
                                                     confidence_tier="llm_fallback", data=profile)
        except ValueError:
            continue
        if record.id not in existing_ids:
            merged.append(record)
            existing_ids.add(record.id)
    return merged


def _fact_line(r: BusinessRecord) -> str:
    return (f"- {r.name} [{r.confidence_tier}]: industry={r.industry or '?'}, region={r.region or '?'}, "
            f"phone={r.phone or '?'}, email={r.email or '?'}, website={r.website or r.domain or '?'}, "
            f"notes={(r.description or '')[:300]}")


async def answer(db: AsyncSession, prompt: str, *, scope: str = "leadgen") -> Dict[str, Any]:
    """The one entry point for the chat / Data Find window. Parses the prompt, searches the
    shared store, live sources and (if needed) the open web, and returns a grounded answer plus
    the records it was built from -- every one of which is now saved for the next person who
    asks something similar."""
    intent = await parse_query(db, prompt, scope=scope)
    if intent.get("intent") == "lookup" and (intent.get("name") or intent.get("domain")):
        records = await _lookup_one(db, intent, scope=scope)
    else:
        records = await _search_many(db, intent, scope=scope)
    facts = "\n".join(_fact_line(r) for r in records) or "(nothing found)"
    result = await llm_gateway.call_open_chat_llm(
        messages=[{"role": "user", "content": f"Request: {prompt}\n\nFacts found:\n{facts}"}],
        system_prompt=_ANSWER_SYSTEM, scope=scope, db=db, temperature=0.2, max_tokens=700,
    )
    return {
        "answer": result.get("reply") or "I couldn't put together an answer right now.",
        "results": [business_records.as_dict(r) for r in records],
    }
