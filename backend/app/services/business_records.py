"""The shared, cross-organisation store of public facts about outside companies.

BusinessRecord has no org_id on purpose (see app.models.models.BusinessRecord and
app.core.tenancy.TENANT_TABLES, which deliberately excludes it): this is public data about
businesses out in the world, never anything belonging to one of our own users, so every
organisation reads and contributes to the same rows. Every part of the app that needs facts
about a company goes through find()/upsert() here -- never reads/writes BusinessRecord directly
-- so a lookup done for one organisation benefits every other one afterwards, and nothing outside
BusinessRecord's own schema can ever be written into it (upsert() only accepts fields it knows
about, dropping everything else, which is what keeps an organisation's own private context from
ever landing in a row other organisations can read).
"""
from __future__ import annotations

import hashlib
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import BusinessRecord, DataSource

logger = logging.getLogger("business_records")

# Trust order: a higher-trust source may overwrite a lower-trust source's value for the same
# field; a lower-trust source never overwrites a higher-trust one, and this governs the record's
# overall confidence_tier too, not just one field.
_TRUST = {"verified_registry": 2, "scraped": 1, "llm_fallback": 0}
_FIELDS = ("name", "registration_number", "domain", "website", "phone", "email", "address",
           "industry", "region", "employee_estimate", "description")


def _clean(value: Any, limit: int = 500) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def identity_hash(*, registration_number: str = "", domain: str = "", name: str = "") -> str:
    """A registration number is the real identity when we have one; a domain is the next most
    reliable (same convention LeadAccount already uses to spot duplicates); a normalized name is
    the last resort. Any two sources that resolve to the same key must merge into one row, or the
    same company would show up twice."""
    key = _norm(registration_number) or _norm(domain) or _norm(name)
    if not key:
        raise ValueError("Need at least a registration number, domain or name to identify a business.")
    return hashlib.sha256(key.encode()).hexdigest()


async def find(db: AsyncSession, *, registration_number: str = "", domain: str = "", name: str = "") -> Optional[BusinessRecord]:
    """Cheap, no-network lookup against what the platform already has."""
    try:
        ih = identity_hash(registration_number=registration_number, domain=domain, name=name)
    except ValueError:
        return None
    return (await db.execute(select(BusinessRecord).where(BusinessRecord.identity_hash == ih))).scalars().first()


async def upsert(db: AsyncSession, *, source_id: str, source_type: str, confidence_tier: str, data: Dict[str, Any]) -> BusinessRecord:
    """Merge `data` into the shared record for the company it identifies, adding this source's
    citation. Only columns BusinessRecord actually has are ever read out of `data` -- anything
    else the caller passes (a user's own message text, an org's private notes, etc.) is simply
    never looked at, by construction, not by a check that could be skipped."""
    name = _clean(data.get("name"))
    registration_number = _clean(data.get("registration_number"), 60)
    domain = _clean(data.get("domain"), 200).lower()
    if not (name or registration_number or domain):
        raise ValueError("A business record needs at least a name, domain or registration number.")
    ih = identity_hash(registration_number=registration_number, domain=domain, name=name)
    row = (await db.execute(select(BusinessRecord).where(BusinessRecord.identity_hash == ih))).scalars().first()
    incoming_rank = _TRUST.get(confidence_tier, 0)
    if row is None:
        row = BusinessRecord(id=f"biz_{uuid.uuid4().hex[:16]}", identity_hash=ih, name=name or domain or registration_number,
                              confidence_tier=confidence_tier, sources=[], raw_data={})
        db.add(row)
        current_rank = -1
    else:
        current_rank = _TRUST.get(row.confidence_tier or "llm_fallback", 0)
    for field in _FIELDS:
        value = _clean(data.get(field), 2000 if field == "description" else 300)
        if not value:
            continue
        existing = getattr(row, field, "") or ""
        if not existing or incoming_rank >= current_rank:
            setattr(row, field, value)
    if incoming_rank > current_rank:
        row.confidence_tier = confidence_tier
    raw = dict(row.raw_data or {})
    raw[source_id] = data.get("raw", data)
    row.raw_data = raw
    sources = [s for s in (row.sources or []) if s.get("source_id") != source_id]
    sources.append({"source_id": source_id, "source_type": source_type, "confirmed_at": datetime.utcnow().isoformat()})
    row.sources = sources
    row.fetched_at = row.updated_at = datetime.utcnow()
    if confidence_tier == "verified_registry":
        row.last_verified_at = datetime.utcnow()
    try:
        from app.services.embedding_service import generate_embedding_async

        text = " ".join(filter(None, [row.name, row.industry, row.region, row.description]))
        row.embedding = await generate_embedding_async(text, db=db) if text.strip() else row.embedding
    except Exception as err:  # semantic search is a convenience; a record must still save without it
        logger.debug(f"[business_records] embedding skipped for {row.id}: {err}")
    await db.flush()
    return row


async def lookup_scrape(db: AsyncSession, *, query: str, scope: str = "leadgen") -> Optional[BusinessRecord]:
    """Same idea as lookup()'s api-type fan-out, but for scrape-type sources (no structured API,
    just a URL pattern + LLM extraction -- see data_source_scraper.py)."""
    sources = (await db.execute(
        select(DataSource).where(DataSource.kind == "scrape", DataSource.status == "active")
    )).scalars().all()
    if not sources:
        return None
    from app.services import data_source_scraper

    for source in sources:
        try:
            profile = await data_source_scraper.run_source(db, source, query, scope=scope)
        except Exception as err:
            logger.warning(f"[business_records] scrape source {source.name} failed: {err}")
            continue
        if not profile:
            continue
        trust = (source.config or {}).get("trust_tier", "scraped")
        return await upsert(db, source_id=source.id, source_type="scrape", confidence_tier=trust, data=profile)
    return None


async def search(db: AsyncSession, *, keywords: Optional[List[str]] = None, region: str = "", limit: int = 20) -> List[BusinessRecord]:
    """Plain keyword/region filter over what's already in the shared store -- the Phase 1
    stand-in for "indirect business" matching (semantic_search below does the real thing once a
    record has an embedding); always run both and merge, since not every record has one yet."""
    stmt = select(BusinessRecord)
    if region:
        stmt = stmt.where(BusinessRecord.region.ilike(f"%{region}%"))
    if keywords:
        stmt = stmt.where(or_(*[
            or_(BusinessRecord.industry.ilike(f"%{k}%"), BusinessRecord.description.ilike(f"%{k}%"),
                BusinessRecord.name.ilike(f"%{k}%"))
            for k in keywords if k
        ]))
    rows = (await db.execute(stmt.order_by(BusinessRecord.updated_at.desc()).limit(limit))).scalars().all()
    return list(rows)


async def semantic_search(db: AsyncSession, query_text: str, *, limit: int = 10, min_score: float = 0.35) -> List[Tuple[BusinessRecord, float]]:
    """Finds businesses whose stored facts are *about* `query_text` even when no field matches
    it literally -- "anything related to logistics, even indirectly" style asks. Same pgvector-
    with-Python-fallback pattern as app.services.rag_service.search_knowledge."""
    if not query_text.strip():
        return []
    from app.services.embedding_service import generate_embedding_async

    query_embedding = await generate_embedding_async(query_text.strip(), db=db)
    try:
        stmt = (
            select(BusinessRecord, (1 - BusinessRecord.embedding.cosine_distance(query_embedding)).label("score"))
            .where(BusinessRecord.embedding.isnot(None))
            .order_by(BusinessRecord.embedding.cosine_distance(query_embedding))
            .limit(limit)
        )
        rows = (await db.execute(stmt)).all()
        return [(row, float(score)) for row, score in rows if score is not None and float(score) >= min_score]
    except Exception as err:
        logger.debug(f"[business_records] pgvector search fallback to in-memory: {err}")
    import math

    def cosine(a: List[float], b: List[float]) -> float:
        if not a or not b or len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(y * y for y in b))
        return dot / (na * nb) if na and nb else 0.0

    all_rows = (await db.execute(select(BusinessRecord).where(BusinessRecord.embedding.isnot(None)))).scalars().all()
    scored = [(r, cosine(query_embedding, r.embedding)) for r in all_rows]
    scored = [(r, s) for r, s in scored if s >= min_score]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]


async def lookup(db: AsyncSession, *, name: str = "", domain: str = "", registration_number: str = "", scope: str = "leadgen") -> Optional[BusinessRecord]:
    """The one entry point for "what do we know about this company": checks the shared store
    first (instant, free); then every active api-type DataSource; then every active scrape-type
    DataSource. Stops at the first hit and saves it for everyone else who asks next. The caller
    (business_lookup.py / lead_accounts.py) still falls back to the general-LLM web search when
    even this returns nothing."""
    cached = await find(db, registration_number=registration_number, domain=domain, name=name)
    if cached:
        return cached
    query = registration_number or domain or name
    if not query:
        return None
    sources = (await db.execute(
        select(DataSource).where(DataSource.kind == "api", DataSource.status == "active")
    )).scalars().all()
    from app.services import data_source_connector as connector

    for source in sources:
        if not (source.provides_fields or source.config):
            continue
        try:
            hits = await connector.search(source, query)
        except Exception as err:  # a misbehaving source must never break the lookup for the rest
            logger.warning(f"[business_records] {source.name} search failed: {err}")
            continue
        if not hits:
            continue
        try:
            profile = await connector.fetch_profile(source, hits[0])
        except Exception as err:
            logger.warning(f"[business_records] {source.name} profile fetch failed: {err}")
            continue
        if not profile.get("name") and not profile.get("registration_number"):
            continue
        # A source's own config says how much to trust it (a government registry API vs. some
        # other structured API aren't the same reliability) -- never assumed from `kind` alone.
        trust = (source.config or {}).get("trust_tier", "scraped")
        return await upsert(db, source_id=source.id, source_type=source.kind, confidence_tier=trust, data=profile)
    return await lookup_scrape(db, query=query, scope=scope)


def as_dict(row: BusinessRecord) -> Dict[str, Any]:
    return {
        "id": row.id, "name": row.name, "registration_number": row.registration_number or "",
        "domain": row.domain or "", "website": row.website or "", "phone": row.phone or "",
        "email": row.email or "", "address": row.address or "", "industry": row.industry or "",
        "region": row.region or "", "employee_estimate": row.employee_estimate or "",
        "description": row.description or "", "confidence_tier": row.confidence_tier or "scraped",
        "sources": row.sources or [], "needs_review": bool(row.needs_review),
        "fetched_at": row.fetched_at.isoformat() + "Z" if row.fetched_at else None,
    }
