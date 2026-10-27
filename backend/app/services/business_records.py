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

from sqlalchemy import JSON, String, and_, case, cast, func, literal, literal_column, or_, select, text
from sqlalchemy.dialects.postgresql import JSONB, insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import BusinessRecord, DataSource

logger = logging.getLogger("business_records")

# Trust order: a higher-trust source may overwrite a lower-trust source's value for the same
# field; a lower-trust source never overwrites a higher-trust one, and this governs the record's
# overall confidence_tier too, not just one field.
_TRUST = {"verified_registry": 2, "scraped": 1, "llm_fallback": 0}
_FIELDS = ("name", "registration_number", "domain", "website", "phone", "email", "address",
           "industry", "region", "employee_estimate", "description", "status", "company_category",
           "incorporation_date")
_LIST_FIELDS = ("officers", "significant_control")  # JSON lists, fetched per-company only -- see fetch_profile
_DERIVED = ("sic_text", "sic_codes", "postcode", "incorporated_on", "size_band")

# What a company's filed-accounts category tells us about its size. This is the accounts regime it
# files under, NOT headcount: "micro" means it meets the micro-entity thresholds (turnover under
# ~GBP 1M / under 10 staff), and so on. Anything not listed here stays unclassified (NULL) rather
# than being guessed. The backfill job (scripts/backfill_business_records.py) builds its SQL CASE
# from this same dict, so imports and the backfill can never disagree.
SIZE_BANDS = {
    "MICRO ENTITY": "micro",
    "SMALL": "small", "TOTAL EXEMPTION SMALL": "small", "TOTAL EXEMPTION FULL": "small", "UNAUDITED ABRIDGED": "small",
    "FULL": "medium_large", "GROUP": "medium_large",
    "DORMANT": "dormant",
}
# How Find Leads orders companies: the most filled-in profiles first, and within each group the biggest and
# best-known first. One stored number (BusinessRecord.rank_score) so a search can sort millions of rows.
#   rank_score = tier * 10000 + prominence * 10 + filled
# `filled` counts the six things that make a profile useful (website, phone, email, description, people on the
# registry, a researched dossier); tier is Full (4+), Partial (2-3) or Basic (0-1). Prominence only uses what we
# hold: a large-accounts filer, a PLC, how many more sources than the first confirm it, a known website, and (optional, added by the
# backfill job) how high the company's own site ranks in a public popularity list.
TIER_STEP = 10000
TIER_NAMES = {2: "full", 1: "partial", 0: "basic"}


def filled_count(*, website="", phone="", email="", description="", has_officers=False, has_dossier=False) -> int:
    return sum(1 for v in (website, phone, email, description, has_officers, has_dossier) if v)


def prominence_points(*, size_band="", company_category="", source_count=0, has_site=False) -> int:
    points = 40 if size_band == "medium_large" else 0
    category = str(company_category or "").lower()
    if "public limited" in category or re.search(r"\bplc\b", category):
        points += 20
    return points + 5 * min(max(int(source_count or 0) - 1, 0), 3) + (5 if has_site else 0)


def rank_score_of(*, filled: int, prominence: int) -> int:
    tier = 2 if filled >= 4 else 1 if filled >= 2 else 0
    return tier * TIER_STEP + min(max(int(prominence), 0), 99) * 10 + min(max(int(filled), 0), 9)


def profile_of(rank: Optional[int]) -> str:
    """full / partial / basic, from a stored rank_score."""
    return TIER_NAMES[min(2, max(0, int(rank or 0) // TIER_STEP))]


def _prominence_part(rank: Optional[int]) -> int:
    return (int(rank or 0) % TIER_STEP) // 10


def row_rank(row: Any, previous: Optional[int] = None) -> int:
    """The rank of a stored company, never lowering a prominence bonus the backfill job added earlier."""
    raw = row.raw_data or {}
    filled = filled_count(website=row.website or row.domain, phone=row.phone, email=row.email, description=row.description,
                          has_officers=bool(row.officers), has_dossier=bool(row.shared_research or raw.get("contacts_web")))
    prominence = prominence_points(size_band=row.size_band or "", company_category=row.company_category or "",
                                   source_count=len(row.sources or []), has_site=bool(row.website or row.domain))
    return rank_score_of(filled=filled, prominence=max(prominence, _prominence_part(previous)))


def refresh_rank(row: Any) -> int:
    """Call after anything that adds a website, phone, email, officers or a dossier to a record."""
    row.rank_score = row_rank(row, row.rank_score)
    return row.rank_score


_SIC_CODE_RE = re.compile(r"(?<!\d)(\d{4,5})(?!\d)\s*-")
_DATE_FORMATS = ("%d/%m/%Y", "%Y-%m-%d")


def parse_date(value: Any):
    text_value = str(value or "").strip()[:10]
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text_value, fmt).date()
        except ValueError:
            continue
    return None


def derive_search_fields(data: Dict[str, Any]) -> Dict[str, Any]:
    """The filterable columns, worked out from what the source actually published -- only what's
    present, nothing inferred beyond the explicit mappings above."""
    out: Dict[str, Any] = {}
    sic_text = re.sub(r"\s+", " ", str(data.get("sic_text") or data.get("industry") or "")).strip()[:1000]
    if sic_text:
        out["sic_text"] = sic_text
        codes = list(dict.fromkeys(_SIC_CODE_RE.findall(sic_text)))
        if codes:
            out["sic_codes"] = "|" + "|".join(codes) + "|"
    postcode = re.sub(r"\s+", " ", str(data.get("postcode") or "")).strip().upper()[:12]
    if postcode:
        out["postcode"] = postcode
    born = parse_date(data.get("incorporation_date"))
    if born:
        out["incorporated_on"] = born
    band = SIZE_BANDS.get(str(data.get("accounts_category") or "").strip().upper())
    if band:
        out["size_band"] = band
    return out


def _clean(value: Any, limit: int = 500) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def identity_hash(*, registration_number: str = "", domain: str = "", name: str = "", postcode: str = "") -> str:
    """A registration number is the real identity when we have one; a domain is the next most
    reliable (same convention LeadAccount already uses to spot duplicates); a normalized name is
    the last resort -- and then the postcode is part of it, because a name alone is not a place
    (two hundred shops share a chain's name; a care home and a food-hygiene entry for the SAME
    premises share name AND postcode, and that is how two sources merge into one row). Any two
    sources that resolve to the same key must merge into one row, or the same company would show
    up twice."""
    key = _norm(registration_number) or _norm(domain) or (_norm(name) + ("|" + _norm(postcode) if _norm(postcode) else ""))
    if not key:
        raise ValueError("Need at least a registration number, domain or name to identify a business.")
    return hashlib.sha256(key.encode()).hexdigest()


async def find(db: AsyncSession, *, registration_number: str = "", domain: str = "", name: str = "", postcode: str = "") -> Optional[BusinessRecord]:
    """Cheap, no-network lookup against what the platform already has."""
    try:
        ih = identity_hash(registration_number=registration_number, domain=domain, name=name, postcode=postcode)
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
    ih = identity_hash(registration_number=registration_number, domain=domain, name=name, postcode=derive_search_fields(data).get("postcode", ""))
    from app.services.optouts import strip_blocked

    data = dict(data)
    await strip_blocked(db, [data])  # a person who opted out is never put back by a later lookup
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
    for field, value in derive_search_fields(data).items():
        if not getattr(row, field, None) or incoming_rank >= current_rank:
            setattr(row, field, value)
    for field in _LIST_FIELDS:
        value = data.get(field)
        if not value:
            continue
        if not getattr(row, field, None) or incoming_rank >= current_rank:
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
    refresh_rank(row)
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


async def bulk_upsert(db: AsyncSession, *, source_id: str, rows: List[Dict[str, Any]]) -> int:
    """Returns how many rows were genuinely NEW (inserted); rows that matched an existing company
    and just refreshed it are not counted, so a re-run of the same file reports ~0 new.

    The fast path for a bulk, single-source import (a government registry's own monthly
    download, not a per-term search) -- hundreds of rows in one statement instead of one
    upsert() call per row, which would be far too slow at real scale. Every row here is trusted
    at verified_registry tier (only ever called for authoritative registry files, never scraped/
    LLM data), so there's no trust-tier comparison to make, only "don't blank out a field another
    source already found." Skips the per-record embedding upsert() computes -- doing that for
    millions of rows one at a time isn't viable; semantic search still works for any of these
    records once something else (a live lookup, a chat answer) re-confirms them normally."""
    if not rows:
        return 0
    from app.services.optouts import strip_blocked

    await strip_blocked(db, rows)  # a person who opted out is never put back by a later import
    now = datetime.utcnow()
    values_by_hash: Dict[str, Dict[str, Any]] = {}  # one row per company per statement (Postgres rejects the same key twice)
    for data in rows:
        name = _clean(data.get("name"))
        registration_number = _clean(data.get("registration_number"), 60)
        domain = _clean(data.get("domain"), 200).lower()
        if not (name or registration_number or domain):
            continue
        derived = derive_search_fields(data)
        try:
            ih = identity_hash(registration_number=registration_number, domain=domain, name=name, postcode=derived.get("postcode", ""))
        except ValueError:
            continue
        row: Dict[str, Any] = {
            "id": f"biz_{uuid.uuid4().hex[:16]}", "identity_hash": ih, "confidence_tier": "verified_registry",
            "sources": [{"source_id": source_id, "source_type": "bulk_csv", "confirmed_at": now.isoformat()}],
            # The FULL original row (every column the source published), not just what we mapped
            # to a dedicated field -- nothing the source publishes is thrown away, even for a
            # field that has no column of its own yet.
            "raw_data": {source_id: data.get("raw", data)}, "fetched_at": now, "last_verified_at": now,
            "created_at": now, "updated_at": now,
        }
        for field in _FIELDS:
            row[field] = _clean(data.get(field), 2000 if field == "description" else 300)
        for field in _DERIVED:
            row[field] = derived.get(field)
        rank = rank_score_of(
            filled=filled_count(website=row.get("website") or row.get("domain"), phone=row.get("phone"), email=row.get("email"), description=row.get("description")),
            prominence=prominence_points(size_band=derived.get("size_band") or "", company_category=row.get("company_category"),
                                         source_count=1, has_site=bool(row.get("website") or row.get("domain"))))
        row["rank_score"] = rank or None
        values_by_hash[ih] = row
    values = list(values_by_hash.values())
    if not values:
        return 0
    table = BusinessRecord.__table__
    stmt = pg_insert(table).values(values)
    sid = literal(source_id, String)
    sources_jsonb = cast(table.c.sources, JSONB)
    seen_by_this_source = func.coalesce(func.jsonb_path_exists(
        sources_jsonb, literal_column("'$[*] ? (@.source_id == $sid)'::jsonpath"), func.jsonb_build_object("sid", sid)), False)
    # A row only this source has ever described is refreshed freely (a monthly re-import must be
    # able to change a company's status). Once ANOTHER source has also described it, this source
    # only fills what is still empty -- so a charity register can add a charity's phone and website
    # to its Companies House row without ever overwriting the registry's name, status or address.
    only_this_source = func.coalesce(~func.jsonb_path_exists(
        sources_jsonb, literal_column("'$[*] ? (@.source_id != $sid)'::jsonpath"), func.jsonb_build_object("sid", sid)), True)
    update_cols = {f: case((only_this_source, func.coalesce(func.nullif(stmt.excluded[f], ""), table.c[f])),
                           else_=func.coalesce(func.nullif(table.c[f], ""), stmt.excluded[f])) for f in _FIELDS}
    update_cols.update({f: case((only_this_source, func.coalesce(stmt.excluded[f], table.c[f])),
                                else_=func.coalesce(table.c[f], stmt.excluded[f])) for f in _DERIVED})
    update_cols.update({
        "rank_score": func.greatest(table.c.rank_score, stmt.excluded.rank_score),  # ignores NULL; never lowers what a lookup earned
        "confidence_tier": "verified_registry",
        # Every source that has described the company is listed once, and its full original row is
        # kept under its own source id -- adding a second source never loses the first.
        "sources": case((seen_by_this_source, table.c.sources),
                        else_=cast(func.coalesce(sources_jsonb, literal_column("'[]'::jsonb")).op("||")(cast(stmt.excluded.sources, JSONB)), JSON)),
        "raw_data": case((func.coalesce(func.jsonb_exists(cast(table.c.raw_data, JSONB), sid), False), table.c.raw_data),
                         else_=cast(func.coalesce(cast(table.c.raw_data, JSONB), literal_column("'{}'::jsonb")).op("||")(cast(stmt.excluded.raw_data, JSONB)), JSON)),
        "fetched_at": stmt.excluded.fetched_at, "last_verified_at": stmt.excluded.last_verified_at,
        "updated_at": stmt.excluded.updated_at,
    })
    # xmax = 0 is how Postgres marks a row this very statement inserted (vs. one it updated).
    stmt = stmt.on_conflict_do_update(index_elements=["identity_hash"], set_=update_cols).returning(literal_column("(xmax = 0)"))
    return sum(1 for (inserted,) in (await db.execute(stmt)).all() if inserted)


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


FILTER_KEYS = ("keyword", "sector", "sic_codes", "towns", "postcode_prefixes", "status", "company_category", "size_bands",
               "min_age_years", "max_age_years", "name_contains", "has_website", "has_email", "has_phone",
               "not_keyword", "not_towns", "not_company_category", "saved")
COUNT_CAP = 10_000
_NEEDS_ONE_OF = ("keyword", "sector", "sic_codes", "towns", "postcode_prefixes", "name_contains")


def _like(term: str, *, prefix_only: bool = False, exact: bool = False) -> str:
    safe = str(term).strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return safe if exact else (f"{safe}%" if prefix_only else f"%{safe}%")


def _as_list(value: Any) -> List[str]:
    if not value:
        return []
    items = value if isinstance(value, (list, tuple)) else [value]
    return [str(v).strip() for v in items if str(v).strip()]


def normalize_filters(filters: Dict[str, Any]) -> Dict[str, Any]:
    """Keeps only the filter keys we know, in a predictable shape, so a model-written filter dict
    can never inject anything else into the query."""
    out: Dict[str, Any] = {}
    for key in ("keyword", "sector", "sic_codes", "towns", "postcode_prefixes", "size_bands", "not_keyword", "not_towns", "not_company_category"):
        values = _as_list((filters or {}).get(key))
        if key == "sic_codes":
            values = [re.sub(r"\D", "", v) for v in values if re.sub(r"\D", "", v)]
        if key == "size_bands":
            values = [v for v in values if v in {"micro", "small", "medium_large", "dormant"}]
        if values:
            out[key] = values
    for key in ("status", "company_category", "name_contains"):
        value = str((filters or {}).get(key) or "").strip()
        if value:
            out[key] = value
    for key in ("min_age_years", "max_age_years"):
        try:
            value = float((filters or {}).get(key))
        except (TypeError, ValueError):
            continue
        if value >= 0:
            out[key] = value
    for key in ("has_website", "has_email", "has_phone"):
        if (filters or {}).get(key):
            out[key] = True
    if str((filters or {}).get("saved") or "") in ("only", "exclude"):  # your own lists: only companies already in one, or none of them
        out["saved"] = str(filters["saved"])
    # Exactly "Active" unless the caller deliberately asks for something else or "any".
    out["status"] = out.get("status") or "Active"
    return out


def _filter_conditions(f: Dict[str, Any]) -> list:
    B = BusinessRecord
    conds = []
    if f["status"].lower() != "any":
        conds.append(func.lower(B.status) == f["status"].lower())
    if f.get("keyword"):  # the panel's single box: a word may be part of the name or of the sector
        conds.append(or_(*[or_(B.name.ilike(_like(t), escape="\\"), B.sic_text.ilike(_like(t), escape="\\"),
                               B.industry.ilike(_like(t), escape="\\")) for t in f["keyword"]]))
    if f.get("sector"):
        conds.append(or_(*[or_(B.sic_text.ilike(_like(t), escape="\\"), B.industry.ilike(_like(t), escape="\\"))
                           for t in f["sector"]]))
    if f.get("sic_codes"):
        conds.append(or_(*[B.sic_codes.like(f"%|{_like(c, exact=True)}%", escape="\\") for c in f["sic_codes"]]))
    if f.get("towns"):
        conds.append(or_(*[B.region.ilike(_like(t, exact=True), escape="\\") for t in f["towns"]]))
    if f.get("postcode_prefixes"):
        conds.append(or_(*[B.postcode.like(_like(p.upper(), prefix_only=True), escape="\\") for p in f["postcode_prefixes"]]))
    if f.get("company_category"):
        conds.append(B.company_category.ilike(_like(f["company_category"]), escape="\\"))
    if f.get("size_bands"):
        conds.append(B.size_band.in_(f["size_bands"]))
    today = datetime.utcnow().date()

    def years_ago(years: float):
        target_year = today.year - int(years)
        try:
            return today.replace(year=target_year)
        except ValueError:  # 29 Feb in a non-leap year
            return today.replace(year=target_year, day=28)

    if f.get("min_age_years") is not None:  # at least this old
        conds.append(B.incorporated_on <= years_ago(f["min_age_years"]))
    if f.get("max_age_years") is not None:  # no older than this
        conds.append(B.incorporated_on >= years_ago(f["max_age_years"]))
    if f.get("name_contains"):
        conds.append(B.name.ilike(_like(f["name_contains"]), escape="\\"))
    for key, col in (("has_website", B.website), ("has_email", B.email), ("has_phone", B.phone)):
        if f.get(key):
            conds.append(func.coalesce(col, "") != "")
    # "Is none of": the same columns as the matching include filters, negated.
    if f.get("not_keyword"):
        conds.append(~or_(*[or_(B.name.ilike(_like(t), escape="\\"), func.coalesce(B.sic_text, "").ilike(_like(t), escape="\\"),
                                func.coalesce(B.industry, "").ilike(_like(t), escape="\\")) for t in f["not_keyword"]]))
    if f.get("not_towns"):
        conds.append(~or_(*[func.coalesce(B.region, "").ilike(_like(t, exact=True), escape="\\") for t in f["not_towns"]]))
    if f.get("not_company_category"):
        conds.append(~or_(*[func.coalesce(B.company_category, "").ilike(_like(t), escape="\\") for t in f["not_company_category"]]))
    if f.get("saved"):
        from app.models.models import LeadAccount

        mine = select(LeadAccount.id).where(LeadAccount.business_record_id == B.id).exists()
        conds.append(mine if f["saved"] == "only" else ~mine)
    return conds


SORTS = ("best", "newest", "name")


def _order(sort: str) -> list:
    """Best match: filled-in, well-known companies first (see rank_score_of); the others re-order the same results."""
    B = BusinessRecord
    if sort == "name":
        return [func.lower(B.name), B.id]
    if sort == "newest":
        return [B.incorporated_on.desc().nullslast(), B.id]
    return [B.rank_score.desc().nullslast(), B.incorporated_on.desc().nullslast(), B.id]


_RANKING: List[Any] = [0.0, True]  # [when checked, ready]


async def ranking_ready(db: AsyncSession) -> bool:
    """Whether "best match" can be used: the rank index exists (scripts/rank_business_records.py builds it), or the
    store is small enough not to need one. Without it, sorting millions of rows by rank would hit the time limit,
    so the search falls back to newest-first and skips the Full/Partial/Basic counts until the job has run."""
    import time

    if time.monotonic() - _RANKING[0] < 60:
        return bool(_RANKING[1])
    ready = True
    if db.get_bind().dialect.name == "postgresql":
        small = (await db.execute(text("SELECT COALESCE(MAX(reltuples), 0) < 200000 FROM pg_class WHERE relname = 'business_records'"))).scalar()
        indexed = (await db.execute(text(
            "SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid "
            "WHERE c.relname = 'ix_business_records_rank_score' AND i.indisvalid AND i.indisready)"))).scalar()
        ready = bool(small or indexed)
    _RANKING[0], _RANKING[1] = time.monotonic(), ready
    return ready


async def _guarded_count(db: AsyncSession, where, seconds: int = 6) -> Optional[int]:
    """A capped count with its own short limit; None when it does not finish, so one slow figure never sinks the page."""
    try:
        async with db.begin_nested():
            if db.get_bind().dialect.name == "postgresql":
                await db.execute(text(f"SET LOCAL statement_timeout = '{int(seconds)}s'"))
            return await _capped_count(db, where)
    except Exception as err:
        if "statement timeout" in str(err).lower():
            return None
        raise


async def _capped_count(db: AsyncSession, where) -> int:
    capped = select(BusinessRecord.id).where(where).limit(COUNT_CAP + 1).subquery()
    return int((await db.execute(select(func.count()).select_from(capped))).scalar() or 0)


async def result_stats(db: AsyncSession, where, total: int) -> Dict[str, Any]:
    """What sits behind the first page: how many results are Full, Partial or Basic profiles, and how many are
    already in this organisation's lists. Counted up to COUNT_CAP each, like the total."""
    B = BusinessRecord
    full = await _guarded_count(db, and_(where, B.rank_score >= 2 * TIER_STEP))
    partial = await _guarded_count(db, and_(where, B.rank_score >= TIER_STEP, B.rank_score < 2 * TIER_STEP))
    from app.models.models import LeadAccount

    mine = select(LeadAccount.business_record_id).where(LeadAccount.business_record_id.isnot(None))
    saved = await _guarded_count(db, and_(where, B.id.in_(mine)))
    out: Dict[str, Any] = {"saved_total": None if saved is None else min(saved, total)}
    out["tiers"] = None if full is None or partial is None else {"full": full, "partial": partial, "basic": max(total - full - partial, 0)}
    return out


_TOTALS: Dict[str, Any] = {}  # filters -> (when, count); the shared store changes slowly, so a big count is made once in a while
_TOTALS_TTL = 600.0


async def exact_total(db: AsyncSession, where, f: Dict[str, Any], exclude_ids: Optional[List[str]] = None) -> Optional[int]:
    """The real number of matches when there are more than COUNT_CAP (so the screen can say 5.7 million, not 10,000+).
    Counted with its own short time limit and remembered for a few minutes; None when it takes too long, and the
    screen then shows the capped number as before."""
    import json
    import time

    if exclude_ids:
        return None
    key = json.dumps(f, sort_keys=True, default=str)
    hit = _TOTALS.get(key)
    if hit and time.monotonic() - hit[0] < _TOTALS_TTL:
        return hit[1]
    try:
        async with db.begin_nested():
            if db.get_bind().dialect.name == "postgresql":
                await db.execute(text("SET LOCAL statement_timeout = '8s'"))
            n = int((await db.execute(select(func.count()).select_from(BusinessRecord).where(where))).scalar() or 0)
    except Exception as err:
        if "statement timeout" in str(err).lower():
            return None
        raise
    if len(_TOTALS) > 300:
        _TOTALS.clear()
    _TOTALS[key] = (time.monotonic(), n)
    return n


async def saved_ids(db: AsyncSession, ids: List[str]) -> set:
    """Which of these companies this organisation already has in a list (row-level security limits it to their own)."""
    from app.models.models import LeadAccount

    if not ids:
        return set()
    rows = (await db.execute(select(LeadAccount.business_record_id).where(LeadAccount.business_record_id.in_(ids)))).all()
    return {r[0] for r in rows}


async def search_filtered(db: AsyncSession, filters: Dict[str, Any], *, limit: int = 25, offset: int = 0,
                          exclude_ids: Optional[List[str]] = None, sort: str = "best", stats: bool = True) -> Dict[str, Any]:
    """The Apollo-style structured search over the shared store: every filter is an exact,
    explainable condition on a real column (nothing fuzzy or semantic), so the same filters always
    return the same companies and each result can be traced to the field that matched. Needs at
    least one narrowing filter (sector, SIC code, town, postcode or name) -- "every active company
    in the UK" is not a search. Returns the page, the (capped) total, and the normalised filters
    actually applied, so the caller can show them back to the user."""
    f = normalize_filters(filters)
    conds = _filter_conditions(f)
    if exclude_ids:
        conds.append(BusinessRecord.id.notin_(list(exclude_ids)))
    where = and_(*conds)
    limit = max(1, min(int(limit or 25), 250))
    if db.get_bind().dialect.name == "postgresql":  # a runaway filter must never tie up the database
        await db.execute(text("SET LOCAL statement_timeout = '25s'"))
    ranked = await ranking_ready(db)
    total = await _capped_count(db, where)
    rows = (await db.execute(
        select(BusinessRecord).where(where).order_by(*_order(sort if ranked or sort != "best" else "newest")).limit(limit).offset(max(0, int(offset or 0)))
    )).scalars().all()
    out = {"rows": list(rows), "total": min(total, COUNT_CAP), "total_capped": total > COUNT_CAP, "filters": f, "ranked": ranked}
    if stats and ranked:
        out.update(await result_stats(db, where, out["total"]))
    elif stats:
        out.update({"tiers": None, "saved_total": None})
        if out["total_capped"]:
            out["total_all"] = await exact_total(db, where, f, exclude_ids)
    return out


async def search_people(db: AsyncSession, filters: Dict[str, Any], *, title: str = "", limit: int = 25, offset: int = 0,
                        sort: str = "best") -> Dict[str, Any]:
    """The People tab: the people the registry lists for the companies that match the same filters. Only companies
    whose officers have been read are in it (they are read on demand, see company_contacts), so `fill_ids` names
    the best-ranked matching companies still to read, for the "find people" step. Names are public registry
    facts; emails and phones are never here, they are found (and charged) per person."""
    from app.services import company_contacts as CC

    f = normalize_filters(filters)
    B = BusinessRecord
    base = and_(*_filter_conditions(f))
    with_people = and_(base, B.officers.isnot(None))
    word = str(title or "").strip().lower()[:60]
    if word:  # a cheap pre-filter on the stored JSON text; the exact role match is made below
        with_people = and_(with_people, cast(B.officers, String).ilike(_like(word), escape="\\"))
    limit = max(1, min(int(limit or 25), 100))
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SET LOCAL statement_timeout = '25s'"))
    ranked = await ranking_ready(db)
    order = _order(sort if ranked or sort != "best" else "newest")
    total = await _capped_count(db, with_people)
    rows = (await db.execute(select(B).where(with_people).order_by(*order).limit(limit).offset(max(0, int(offset or 0))))).scalars().all()
    people = []
    for biz in rows:
        for o in CC.active_officers(biz.officers):
            if word and word not in (o["role"] or "").lower() and word not in o["name"].lower():
                continue
            people.append({**o, "company": biz})
    fill = (await db.execute(select(B.id).where(and_(base, B.officers.is_(None))).order_by(*order).limit(25))).scalars().all()
    return {"people": people, "companies_total": min(total, COUNT_CAP), "total_capped": total > COUNT_CAP, "filters": f, "fill_ids": list(fill)}


_DISTRICTS: Dict[str, Any] = {}  # town -> (when, rows); the shared store changes slowly, so a town is counted once in a while
_DISTRICTS_TTL = 600.0
_OUTCODE = "^[A-Za-z]{1,2}[0-9][0-9A-Za-z]?"


def _natural(code: str):
    """LS2 before LS10: letters, then the number, then any trailing letter."""
    m = re.match(r"^([A-Z]+)(\d+)([A-Z]?)$", code)
    return (m.group(1), int(m.group(2)), m.group(3)) if m else (code, 0, "")


async def districts_for_town(db: AsyncSession, town: str, include_closed: bool = False) -> List[Dict[str, Any]]:
    """The postcode districts (LS1, LS6...) of the companies in one town and how many each has, for the
    picker next to the Town box. Counts only -- never the companies. Same town match as the search."""
    import time

    name = re.sub(r"\s+", " ", str(town or "")).strip()[:60]
    if len(name) < 2:
        raise ValueError("Type a town first.")
    key = f"{name.lower()}|{int(bool(include_closed))}"
    hit = _DISTRICTS.get(key)
    if hit and time.monotonic() - hit[0] < _DISTRICTS_TTL:
        return hit[1]
    B = BusinessRecord
    code = func.upper(func.substring(B.postcode, _OUTCODE))
    where = [B.region.ilike(_like(name, exact=True), escape="\\"), code.isnot(None)]
    if not include_closed:
        where.append(func.lower(B.status) == "active")
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SET LOCAL statement_timeout = '15s'"))
    rows = (await db.execute(select(code, func.count()).where(*where).group_by(code))).all()
    out = [{"district": d, "count": int(n)} for d, n in sorted(rows, key=lambda r: _natural(r[0])) if d]
    if len(_DISTRICTS) > 500:
        _DISTRICTS.clear()
    _DISTRICTS[key] = (time.monotonic(), out)
    return out


AREA_CHUNK = 1500  # companies read per step from the postcode districts an area touches, before the shape is applied
AREA_COUNT_CAP = 100_000


async def _area_conditions(db: AsyncSession, filters: Dict[str, Any], poly, exclude_ids: Optional[List[str]] = None):
    """The filter conditions plus 'in one of the districts this shape touches'; None when it touches none."""
    from app.services import geocoding

    f = normalize_filters(filters)
    outcodes = await geocoding.outcodes_for_area(poly)
    if not outcodes:
        return f, None
    conds = _filter_conditions(f)
    conds.append(or_(*[BusinessRecord.postcode.like(f"{oc} %") for oc in outcodes]))
    if exclude_ids:
        conds.append(BusinessRecord.id.notin_(list(exclude_ids)))
    return f, and_(*conds)


async def area_candidates(db: AsyncSession, filters: Dict[str, Any], area: Any) -> Dict[str, Any]:
    """How many companies sit in the postcode districts a drawn area touches (an upper bound: the
    shape itself is applied as they are read). Cheap, so the user can choose how many to see."""
    from app.services import geocoding

    poly = geocoding.clean_polygon(area)
    f, where = await _area_conditions(db, filters, poly)
    if where is None:
        return {"candidates": 0, "capped": False, "filters": f}
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SET LOCAL statement_timeout = '25s'"))
    capped = select(BusinessRecord.id).where(where).limit(AREA_COUNT_CAP + 1).subquery()
    n = int((await db.execute(select(func.count()).select_from(capped))).scalar() or 0)
    return {"candidates": min(n, AREA_COUNT_CAP), "capped": n > AREA_COUNT_CAP, "filters": f}


async def search_in_area(db: AsyncSession, filters: Dict[str, Any], area: Any, *, scan: int = 0, chunk: int = AREA_CHUNK,
                         exclude_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """The same filters as search_filtered, but only companies whose postcode centre lies inside the
    drawn area (a list of [lat, lng] corners). The area narrows the search by itself, so no
    sector/town is required. Reads one step of `chunk` companies from the postcode districts the
    shape touches (newest first, starting at `scan`), geocodes their postcodes (cached, see
    geocoding.py) and keeps the ones inside the shape. `next_scan` is where the next step starts,
    or None when every company has been read -- the caller keeps asking until it has as many as the
    user wanted."""
    from app.services import geocoding

    poly = geocoding.clean_polygon(area)
    f, where = await _area_conditions(db, filters, poly, exclude_ids)
    if where is None:
        return {"rows": [], "points": {}, "total": 0, "next_scan": None, "filters": f}
    scan = max(0, int(scan or 0))
    chunk = max(1, min(int(chunk or AREA_CHUNK), AREA_CHUNK))
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SET LOCAL statement_timeout = '25s'"))
    rows = (await db.execute(
        select(BusinessRecord).where(where)
        .order_by(*_order("best" if await ranking_ready(db) else "newest")).offset(scan).limit(chunk + 1)
    )).scalars().all()
    more = len(rows) > chunk
    rows = rows[:chunk]
    coords = await geocoding.geocode(db, [r.postcode for r in rows])
    inside, points = [], {}
    for r in rows:
        pt = coords.get(geocoding.norm_postcode(r.postcode))
        if pt and geocoding.point_in_polygon(pt[0], pt[1], poly):
            inside.append(r)
            points[r.id] = [pt[0], pt[1]]
    return {"rows": inside, "points": points, "total": len(inside), "next_scan": scan + chunk if more else None, "filters": f}


def _admin_search_filter(q: str):
    term = q.strip()
    if not term:
        return None
    like = f"%{term}%"
    return or_(
        BusinessRecord.name.ilike(like), BusinessRecord.domain.ilike(like),
        BusinessRecord.registration_number.ilike(like), BusinessRecord.industry.ilike(like),
        BusinessRecord.region.ilike(like), BusinessRecord.email.ilike(like), BusinessRecord.phone.ilike(like),
    )


async def admin_search(db: AsyncSession, q: str = "", *, limit: int = 100, offset: int = 0) -> List[BusinessRecord]:
    """For the staff Data Sources screen's "what's actually in the store" table -- plain
    substring match across every field someone might search by (GIN trigram-indexed, see
    migrations.py, so this stays fast well past millions of rows), so staff can check whether a
    company a user asked about is in there without needing to know which exact field it's in."""
    stmt = select(BusinessRecord)
    cond = _admin_search_filter(q)
    if cond is not None:
        stmt = stmt.where(cond)
    rows = (await db.execute(stmt.order_by(BusinessRecord.updated_at.desc()).limit(limit).offset(max(0, offset)))).scalars().all()
    return list(rows)


async def admin_count(db: AsyncSession, q: str = "") -> int:
    """How many rows admin_search(q) matches in total, for "showing X-Y of Z" pagination --
    counted separately since the page itself is always capped at `limit`."""
    stmt = select(func.count()).select_from(BusinessRecord)
    cond = _admin_search_filter(q)
    if cond is not None:
        stmt = stmt.where(cond)
    return int((await db.execute(stmt)).scalar() or 0)


def as_dict(row: BusinessRecord) -> Dict[str, Any]:
    return {
        "id": row.id, "name": row.name, "registration_number": row.registration_number or "",
        "domain": row.domain or "", "website": row.website or "", "phone": row.phone or "",
        "email": row.email or "", "address": row.address or "", "industry": row.industry or "",
        "region": row.region or "", "employee_estimate": row.employee_estimate or "",
        "description": row.description or "", "confidence_tier": row.confidence_tier or "scraped",
        "status": row.status or "", "company_category": row.company_category or "",
        "incorporation_date": row.incorporation_date or "", "sic_text": row.sic_text or "",
        "postcode": row.postcode or "", "size_band": row.size_band or "", "rank_score": row.rank_score or 0, "officers": row.officers or [],
        "significant_control": row.significant_control or [],
        "sources": row.sources or [], "needs_review": bool(row.needs_review),
        "fetched_at": row.fetched_at.isoformat() + "Z" if row.fetched_at else None,
    }
