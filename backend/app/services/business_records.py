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
from datetime import datetime, timedelta
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
_DERIVED = ("sic_text", "sic_codes", "postcode", "incorporated_on", "size_band", "accounts_due_on", "last_accounts_on", "confstmt_due_on", "last_confstmt_on")
# Column -> where the register publishes it: the bulk file's header, then the live API's nested path.
REGISTER_DATES = {
    "accounts_due_on": ("Accounts.NextDueDate", ("accounts", "next_due")),
    "last_accounts_on": ("Accounts.LastMadeUpDate", ("accounts", "last_accounts", "made_up_to")),
    "confstmt_due_on": ("ConfStmtNextDueDate", ("confirmation_statement", "next_due")),
    "last_confstmt_on": ("ConfStmtLastMadeUpDate", ("confirmation_statement", "last_made_up_to")),
}

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
    raw = data.get("raw") if isinstance(data.get("raw"), dict) else data
    flat = {str(k).strip(): v for k, v in raw.items()}  # some bulk-file headers carry a stray leading space
    for col, (header, path) in REGISTER_DATES.items():
        nested: Any = raw
        for step in path:
            nested = nested.get(step) if isinstance(nested, dict) else None
        when = parse_date(flat.get(header) or (nested if isinstance(nested, str) else ""))
        if when:
            out[col] = when
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


def own_site(url: Any) -> str:
    """The web address when it can be a company's own site; empty for a rating site, register or social page (never stored as the company's website)."""
    u = str(url or "").strip()
    return "" if u and any(d in u.lower() for d in DIRECTORY_SITES) else u


def tidy_field(field: str, value: str) -> str:
    """The stored form of a value: a register type code becomes its label, a lower-case status gets a capital."""
    from app.services import normalise

    if field == "company_category":
        return normalise.category_label(value)
    if field == "status" and value and value[0].islower() and " " not in value:
        return value[:1].upper() + value[1:]
    return value


def is_rawer(field: str, value: str, existing: str) -> bool:
    """True when `value` is a bare code and `existing` already says the same thing in words."""
    from app.services import normalise

    if field in ("industry", "sic_text"):
        return normalise.sic_is_bare(value) and not normalise.sic_is_bare(existing)
    if field == "company_category":
        return normalise.is_raw_category(value) and not normalise.is_raw_category(existing)
    return False


async def upsert(db: AsyncSession, *, source_id: str, source_type: str, confidence_tier: str, data: Dict[str, Any]) -> BusinessRecord:
    """Merge `data` into the shared record for the company it identifies, adding this source's
    citation. Only columns BusinessRecord actually has are ever read out of `data` -- anything
    else the caller passes (a user's own message text, an org's private notes, etc.) is simply
    never looked at, by construction, not by a check that could be skipped."""
    data = {**data, "website": own_site(data.get("website"))}
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
        value = tidy_field(field, _clean(data.get(field), 2000 if field == "description" else 300))
        if not value:
            continue
        existing = getattr(row, field, "") or ""
        if existing and is_rawer(field, value, existing):
            continue  # a lookup never swaps a clean value for a code ("Private Limited Company" for "ltd")
        if not existing or incoming_rank >= current_rank:
            setattr(row, field, value)
    for field, value in derive_search_fields(data).items():
        existing = getattr(row, field, None)
        if existing and is_rawer(field, value, existing):
            continue
        if not existing or incoming_rank >= current_rank:
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
    try:  # every website, phone, email and page the record now holds is also in the contact list
        from app.services import contact_points

        async with db.begin_nested():
            await contact_points.sync(db, row)
    except Exception as err:
        logger.debug(f"[business_records] contact list not updated for {row.id}: {err}")
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
    rows = [({**r, "website": own_site(r.get("website"))} if r.get("website") else r) for r in rows]
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
    # Only the register publishes filing dates, and they move every year: its newest file always wins, even on a shared row.
    update_cols.update({f: func.coalesce(stmt.excluded[f], table.c[f]) for f in REGISTER_DATES})
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
    new = sum(1 for (inserted,) in (await db.execute(stmt)).all() if inserted)
    try:  # the contacts of this batch go in the contact list too, so a load never leaves companies out of it
        from app.services import contact_points

        async with db.begin_nested():
            await contact_points.bulk_add(db, values)
    except Exception as err:  # the list can always be rebuilt (scripts/sync_contact_points.py): it must never stop an import
        logger.warning(f"[business_records] contact list not updated for a batch: {err}")
    return new


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
               "not_keyword", "not_towns", "not_company_category", "saved", "include_non_business", "include_secondary_activity",
               "company_types", "exclude_charities",
               # Phase 4: radius, register signals; Phase 7d: website signals
               "near", "signals", "site")
COUNT_CAP = 10_000
# A trade search returns companies whose MAIN activity is the trade. When fewer than this many do, the search also takes
# companies that list the trade only as a side activity (a later SIC code), and says so ("broadened").
BROADEN_BELOW = 5
DIRECTORY_SITES = ("food.gov.uk", "facebook.com", "yell.com", "tripadvisor.", "linkedin.com", "instagram.com", "twitter.com", "companieshouse.gov.uk",
                   "company-information.service.gov.uk", "google.com/maps", "192.com", "yelp.")
_NEEDS_ONE_OF = ("keyword", "sector", "sic_codes", "towns", "postcode_prefixes", "name_contains", "near", "signals")
SIGNAL_KEYS = ("new_director", "accounts_due", "filed_late", "new_company")
SITE_KEYS = ("mtd", "hiring", "software")
_DISTRICT = re.compile(r"[A-Z]{1,2}\d[A-Z\d]?")
MAX_DISTRICTS = 120


def _like(term: str, *, prefix_only: bool = False, exact: bool = False) -> str:
    safe = str(term).strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return safe if exact else (f"{safe}%" if prefix_only else f"%{safe}%")


_NUMBER = re.compile(r"[A-Za-z]{0,2}\d{5,8}")


def _number_forms(term: str) -> List[str]:
    """A typed company number as the forms it can be stored in: Companies House pads to 8 characters (1234567 is 01234567; SC123456 stays)."""
    t = str(term).strip().replace(" ", "")
    if not _NUMBER.fullmatch(t):
        return []
    return [t.zfill(8)] if t.isdigit() else [t.upper()]


_SHORT_WORD = re.compile(r"[A-Za-z]{2,5}")


def _whole_word(term: str, col: Any) -> Any:
    """A short word must be a word on its own: "tax" is not "Stax" or "Taxi". A longer plain word must start a word ("dental"
    is "Dental care" and "Dentalcare", not "Accidental Films"). Anything else (spaces, digits, hyphens) keeps the contains match."""
    t = str(term).strip()
    if _SHORT_WORD.fullmatch(t):
        return col.op("~*")(r"\m" + t + r"\M")
    if re.fullmatch(r"[A-Za-z]{6,}", t):
        return col.op("~*")(r"\m" + t)
    return col.ilike(_like(term), escape="\\")


def _by_name_or_number(term: str, *cols: Any, words: bool = False) -> Any:
    """The term in any of these columns, or, when it is a company number, the register's number exactly (uses the index).
    With `words`, a short term must match whole words in every column ("tax" is not "Taxi operation")."""
    hits = [(_whole_word(term, c) if words else c.ilike(_like(term), escape="\\")) for c in cols]
    forms = _number_forms(term)
    if forms:
        hits.append(BusinessRecord.registration_number.in_(forms))
    return or_(*hits)


def _as_list(value: Any) -> List[str]:
    if not value:
        return []
    items = value if isinstance(value, (list, tuple)) else [value]
    return [str(v).strip() for v in items if str(v).strip()]


def normalize_filters(filters: Dict[str, Any]) -> Dict[str, Any]:
    """Keeps only the filter keys we know, in a predictable shape, so a model-written filter dict
    can never inject anything else into the query."""
    out: Dict[str, Any] = {}
    from app.services.fit_score import COMPANY_TYPES

    for key in ("keyword", "sector", "sic_codes", "towns", "postcode_prefixes", "size_bands", "not_keyword", "not_towns", "not_company_category",
                "company_types"):
        values = _as_list((filters or {}).get(key))
        if key == "sic_codes":
            values = [re.sub(r"\D", "", v) for v in values if re.sub(r"\D", "", v)]
        if key == "size_bands":
            values = [v for v in values if v in {"micro", "small", "medium_large", "dormant"}]
        if key == "company_types":
            values = [v for v in dict.fromkeys(values) if v in COMPANY_TYPES]
        if key in ("keyword", "sector", "not_keyword"):
            values = [v for v in values if len(re.sub(r"[^0-9A-Za-z]", "", v)) >= 2]
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
    for key in ("has_website", "has_email", "has_phone", "include_non_business", "include_secondary_activity", "name_whole_word", "complete_commercial", "complete_first",
                "exclude_charities"):
        if (filters or {}).get(key):
            out[key] = True
    # Phase 4: "within N miles of a postcode" arrives as the districts inside the radius (see icp._districts_within)
    near = (filters or {}).get("near")
    if isinstance(near, dict):
        districts = list(dict.fromkeys(d for d in (str(x).strip().upper() for x in (near.get("districts") or [])) if _DISTRICT.fullmatch(d)))[:MAX_DISTRICTS]
        try:
            miles = min(50.0, max(0.5, float(near.get("miles"))))
        except (TypeError, ValueError):
            miles = 0.0
        if districts and miles:
            out["near"] = {"postcode": str(near.get("postcode") or "").strip().upper()[:10], "miles": miles, "districts": districts}
    for key, allowed in (("signals", SIGNAL_KEYS), ("site", SITE_KEYS)):
        picked = [v for v in dict.fromkeys(_as_list((filters or {}).get(key))) if v in allowed]
        if picked:
            out[key] = picked
    if str((filters or {}).get("saved") or "") in ("only", "exclude"):  # your own lists: only companies already in one, or none of them
        out["saved"] = str(filters["saved"])
    # Exactly "Active" unless the caller deliberately asks for something else or "any".
    out["status"] = out.get("status") or "Active"
    return out


_NB_INDUSTRY = r"(school|college|university|nursery|pre-school|preschool|childcare|caring premises|care home|hospital|community|church|place of worship|chapel|mosque|temple|charity|food ?bank)"
_NB_NAME = r"\m(school|academy|church|nursery|college|community centre|food ?bank|primary|chapel|mosque)\M"
_NB_WORDS = re.compile(r"school|college|university|nursery|childcare|care|hospital|community|church|charity|food ?bank|academy|chapel|mosque|temple|place of worship", re.I)


def _wants_non_business(f: Dict[str, Any]) -> bool:
    """Schools, churches and community places are left out unless the person asks for them, or searches for one of those words."""
    if f.get("include_non_business"):
        return True
    typed = " ".join(list(f.get("keyword") or []) + list(f.get("sector") or []) + [str(f.get("name_contains") or "")])
    return bool(_NB_WORDS.search(typed))


def _postcode_match(prefix: str) -> Any:
    """LS1 means the LS1 district (LS1 4AB), never LS10 to LS19; EC1 still takes EC1A to EC1Y, which are letters, not other districts.
    A prefix with a space, or ending in a letter (LS, LS1 4), is read as typed."""
    p = prefix.strip().upper()
    like = BusinessRecord.postcode.like(_like(p, prefix_only=True), escape="\\")
    if " " not in p and p[-1:].isdigit():
        return and_(like, ~BusinessRecord.postcode.op("~")("^" + re.escape(p) + "[0-9]"))
    return like


def check_filters(filters: Dict[str, Any]) -> None:
    """Refuses a search that could only hang or mislead, with words the person can act on. Raises ValueError."""
    raw = filters or {}
    for key in ("keyword", "name_contains", "sector"):
        given = _as_list(raw.get(key))
        if given and not [t for t in given if len(re.sub(r"[^0-9A-Za-z]", "", t)) >= 2]:
            raise ValueError("Type at least two letters or digits to search.")
    lo, hi = raw.get("min_age_years"), raw.get("max_age_years")
    for v in (lo, hi):
        try:
            if v not in (None, "") and float(v) < 0:
                raise ValueError("A company's age can't be negative.")
        except (TypeError, ValueError) as err:
            if "negative" in str(err):
                raise
    try:
        if lo not in (None, "") and hi not in (None, "") and float(lo) > float(hi):
            raise ValueError("The youngest age is above the oldest. Swap them.")
    except (TypeError, ValueError) as err:
        if "youngest" in str(err):
            raise


def can_broaden(f: Dict[str, Any]) -> bool:
    """A trade was asked for and side activities were not already included, so a thin result may take them in."""
    return bool((f.get("keyword") or f.get("sector") or f.get("sic_codes")) and not f.get("include_secondary_activity"))


def _main_part(col: Any) -> Any:
    """The main activity of a trade text: sic_text and industry list activities as "69201 - Accounting | 45112 - Sale of used cars",
    main one first."""
    return func.split_part(func.coalesce(col, ""), " | ", 1)


def _trade_text(term: str, col: Any, any_activity: bool) -> Any:
    """The trade word in the main activity, or in any listed activity. The whole-column match stays first so the
    trigram index still finds the rows; the main-part test only rechecks them."""
    hit = _whole_word(term, col)
    return hit if any_activity else and_(hit, _whole_word(term, _main_part(col)))


def _sic_code(code: str, any_activity: bool) -> Any:
    """sic_codes is "|45112|69201|", main code first: the main code is the one right after the opening bar."""
    c = _like(code, exact=True)
    return BusinessRecord.sic_codes.like(f"%|{c}%" if any_activity else f"|{c}%", escape="\\")


def _trade_conditions(f: Dict[str, Any], any_activity: bool) -> list:
    """The keyword, sector and SIC code boxes. By default each matches a company's MAIN activity (first SIC code, or the
    first entry of its trade text) or its name; `any_activity` also takes companies that list the trade as a side activity."""
    from app.services import search_synonyms

    B = BusinessRecord
    conds = []
    if f.get("keyword"):  # the panel's single box: a word may be part of the name or of the main trade
        clauses = []
        for typed in f["keyword"]:
            words, sics = search_synonyms.expand(typed)  # accountancy = accounting = accountants = the accounting SIC codes
            for w in words:
                clauses.append(_by_name_or_number(w, B.name, words=True))
                clauses += [_trade_text(w, B.sic_text, any_activity), _trade_text(w, B.industry, any_activity)]
            clauses += [_sic_code(c, any_activity) for c in sics]
        conds.append(or_(*clauses))
    if f.get("sector"):
        clauses = []
        for typed in f["sector"]:
            words, sics = search_synonyms.expand(typed)  # the same trade words and SIC codes as the keyword box
            for w in words:
                clauses += [_whole_word(w, B.name), _trade_text(w, B.sic_text, any_activity), _trade_text(w, B.industry, any_activity)]
            clauses += [_sic_code(c, any_activity) for c in sics]
        conds.append(or_(*clauses))
    if f.get("sic_codes"):
        conds.append(or_(*[_sic_code(c, any_activity) for c in f["sic_codes"]]))
    return conds


def _filter_conditions(f: Dict[str, Any], any_activity: bool = False) -> list:
    B = BusinessRecord
    any_activity = any_activity or bool(f.get("include_secondary_activity"))
    conds = []
    if f["status"].lower() != "any":
        conds.append(func.lower(B.status) == f["status"].lower())
    conds += _trade_conditions(f, any_activity)
    if f.get("towns"):
        conds.append(or_(*[B.region.ilike(_like(t, exact=True), escape="\\") for t in f["towns"]]))
    if f.get("postcode_prefixes"):
        conds.append(or_(*[_postcode_match(p) for p in f["postcode_prefixes"]]))
    if f.get("company_category"):
        conds.append(B.company_category.ilike(_like(f["company_category"]), escape="\\"))
    if f.get("size_bands"):
        conds.append(B.size_band.in_(f["size_bands"]))
    if f.get("company_types"):
        conds.append(or_(*[_type_match(t) for t in f["company_types"]]))
    if f.get("exclude_charities"):
        conds.append(~_charity())
    today = datetime.utcnow().date()

    def years_ago(years: float):
        whole = int(years)
        try:
            base = today.replace(year=today.year - whole)
        except ValueError:  # 29 Feb in a non-leap year
            base = today.replace(year=today.year - whole, day=28)
        return base - timedelta(days=round((years - whole) * 365.25))  # 2.5 years is two years and half a year, not two

    if f.get("min_age_years") is not None:  # at least this old
        conds.append(B.incorporated_on <= years_ago(f["min_age_years"]))
    if f.get("max_age_years") is not None:  # no older than this
        conds.append(B.incorporated_on >= years_ago(f["max_age_years"]))
    if f.get("name_contains"):
        conds.append(_by_name_or_number(f["name_contains"], B.name, words=bool(f.get("name_whole_word"))))
    for key, col in (("has_email", B.email), ("has_phone", B.phone)):
        if f.get(key):
            conds.append(func.coalesce(col, "") != "")
    if f.get("has_website"):  # the same rule the rank and the card use: the stored website, else the company's domain
        site = func.coalesce(func.nullif(B.website, ""), B.domain, "")
        conds.append(site != "")
        # a rating site, register or social page saved as the "website" is not the company's own
        conds.append(~or_(*[site.ilike(f"%{h}%") for h in DIRECTORY_SITES]))
    # "Is none of": the same columns and the same main-activity rule as the include filters, negated.
    if f.get("not_keyword"):
        conds.append(~or_(*[or_(_whole_word(t, B.name), _trade_text(t, func.coalesce(B.sic_text, ""), any_activity),
                                _trade_text(t, func.coalesce(B.industry, ""), any_activity)) for t in f["not_keyword"]]))
    if f.get("not_towns"):
        conds.append(~or_(*[func.coalesce(B.region, "").ilike(_like(t, exact=True), escape="\\") for t in f["not_towns"]]))
    if f.get("not_company_category"):
        conds.append(~or_(*[func.coalesce(B.company_category, "").ilike(_like(t), escape="\\") for t in f["not_company_category"]]))
    if f.get("complete_commercial"):  # the first half of the opening list (see complete_ids)
        conds.append(func.coalesce(_complete_commercial(), False))
    if not _wants_non_business(f):  # a school, nursery, church or community place without a company number is not a business lead
        conds.append(~and_(func.coalesce(B.registration_number, "") == "",
                           or_(func.coalesce(B.industry, "").op("~*")(_NB_INDUSTRY), B.name.op("~*")(_NB_NAME))))
    if f.get("near"):
        conds.append(or_(*[_postcode_match(d) for d in f["near"]["districts"]]))
    if f.get("signals"):
        conds.append(or_(*[_signal_condition(k, today) for k in f["signals"]]))
    if f.get("site"):  # reads a JSON field with no index: only sensible behind a narrowing filter
        conds.append(or_(*[_site_condition(k) for k in f["site"]]))
    if f.get("saved"):
        from app.models.models import LeadAccount

        mine = select(LeadAccount.id).where(LeadAccount.business_record_id == B.id).exists()
        conds.append(mine if f["saved"] == "only" else ~mine)
    return conds


def _signal_condition(key: str, today: Any) -> Any:
    """One "reason to get in touch now", on the same windows fit_score.signals uses. Closed companies never match."""
    from app.services import fit_score as FS

    B = BusinessRecord
    if key == "accounts_due":
        return B.accounts_due_on.between(today, today + timedelta(days=FS.DUE_SOON_DAYS))
    if key == "filed_late":
        return and_(func.lower(func.coalesce(B.status, "")) == "active", or_(B.accounts_due_on < today, B.confstmt_due_on < today))
    if key == "new_company":
        return B.incorporated_on > today - timedelta(days=FS.NEW_COMPANY_DAYS)
    # new_director: officers is a JSON list filled per company, so only companies whose directors were already read can match.
    # Dates are ISO strings, so a string comparison is exact and needs no cast.
    since = (today - timedelta(days=FS.NEW_DIRECTOR_DAYS)).isoformat()
    return text(
        "EXISTS (SELECT 1 FROM json_array_elements(CASE WHEN json_typeof(business_records.officers) = 'array' "
        "THEN business_records.officers ELSE '[]'::json END) o "
        "WHERE o->>'resigned_on' IS NULL AND o->>'appointed_on' >= :nd_since)"
    ).bindparams(nd_since=since)


def _site_condition(key: str) -> Any:
    """What the company's own website said when we last read it (see site_signals)."""
    col = func.json_extract_path_text(BusinessRecord.raw_data, "site_signals", "software" if key == "software" else key)
    if key == "software":
        return and_(col.isnot(None), col != "[]", col != "")
    return col == "true"


def _type_match(key: str) -> Any:
    """The same company-type rule as fit_score.type_of, on the category column."""
    from app.services.fit_score import COMPANY_TYPES

    _, want, never = COMPANY_TYPES[key]
    cat = func.coalesce(BusinessRecord.company_category, "")
    return and_(or_(*[cat.ilike(f"%{w}%") for w in want]), *[~cat.ilike(f"%{n}%") for n in never])


def _charity() -> Any:
    """The same rule as fit_score.is_charity: the register type says charity, a charity-register number, or the charity register is a source."""
    B = BusinessRecord
    return or_(func.coalesce(B.company_category, "").ilike("%charit%"), func.coalesce(B.registration_number, "").like("CC-%"),
               cast(B.sources, String).like('%"ds_charity_commission"%'))


SORTS = ("best", "newest", "name", "fit")


def fit_order(icp: Dict[str, Any], weights: Dict[str, int], today=None) -> Any:
    """The fit score as one SQL number, so "Best fit" can order a whole search before a page is read. It mirrors
    fit_score.fit on the stored columns; the reasons and the exact score shown come from fit_score.fit on each row of the
    page. Two parts only the full row can answer are counted from what the column holds: any director on file, and an
    email a register itself published (the charity register) (an email checked for this organisation is in the shown score, not in the order)."""
    from app.services import fit_score as FS

    B = BusinessRecord
    today = today or datetime.utcnow().date()
    w = weights or FS.DEFAULT_WEIGHTS
    pts: List[Any] = []
    want_sic, want_types = icp.get("sic_codes") or [], icp.get("company_types") or []
    if want_sic or want_types:
        share = w["type_sic"] / (2 if want_sic and want_types else 1)
        if want_sic:
            pts.append(case((or_(*[B.sic_codes.like(f"%|{c}%") for c in want_sic]), share), else_=0))
        if want_types:
            pts.append(case((or_(*[_type_match(t) for t in want_types]), share), else_=0))
    if icp.get("size_bands"):
        pts.append(case((B.size_band.in_(icp["size_bands"]), w["size"]), else_=0))
    prefixes = FS.area_prefixes(icp)
    if prefixes:
        pts.append(case((or_(*[_postcode_match(p) for p in prefixes]), w["area"]), else_=0))
    has_director = and_(B.officers.isnot(None), cast(B.officers, String).ilike('%director%'))
    pts.append(case((has_director, w["director"]), else_=0))
    pts.append(case((and_(B.confidence_tier == "verified_registry", func.coalesce(B.email, "") != "", cast(B.sources, String).like('%"ds_charity_commission"%')), w["email"]), else_=0))
    soon = today + timedelta(days=FS.DUE_SOON_DAYS)
    n_signals = (case((B.accounts_due_on.between(today, soon), 1), else_=0) + case((B.confstmt_due_on.between(today, soon), 1), else_=0)
                 + case((B.incorporated_on > today - timedelta(days=FS.NEW_COMPANY_DAYS), 1), else_=0))
    pts.append(case((n_signals >= 2, w["signals"]), (n_signals == 1, w["signals"] * 0.7), else_=0))
    total = pts[0]
    for p in pts[1:]:
        total = total + p
    return total


def _primary_trade_first(f: Dict[str, Any]) -> list:
    """A company whose first (main) SIC code is the trade searched for comes before one that only lists it as a side activity."""
    from app.services import search_synonyms

    codes: List[str] = [re.sub(r"\D", "", c) for c in (f.get("sic_codes") or [])]
    for t in list(f.get("keyword") or []) + list(f.get("sector") or []):
        codes += search_synonyms.expand(t)[1]
    codes = [c for c in dict.fromkeys(codes) if c]
    if not codes:
        return []
    return [case((or_(*[BusinessRecord.sic_codes.like(f"|{c}%") for c in codes]), 0), else_=1)]


def _order(sort: str, f: Optional[Dict[str, Any]] = None, broadened: bool = False, fit: Optional[Tuple[Dict[str, Any], Dict[str, int]]] = None) -> list:
    """Best match: filled-in, well-known companies first (see rank_score_of); the others re-order the same results.
    A broadened search lists the companies whose main activity is the trade before the side-activity ones.
    Best fit (needs the organisation's ICP in `fit`): highest fit first, the best match order breaking ties."""
    B = BusinessRecord
    if sort == "fit" and fit:
        return [fit_order(*fit).desc(), B.rank_score.desc().nullslast(), B.incorporated_on.desc().nullslast(), B.id]
    if sort == "name":
        return [func.lower(B.name), B.id]
    first = _primary_trade_first(f or {})
    if broadened:
        first = [case((and_(*_trade_conditions(f or {}, False)), 0), else_=1)] + first
    if sort == "newest":
        # Plain DESC (empty dates first, there are almost none) is the order the existing date index can walk; NULLS LAST is not,
        # and would read and sort every company.
        return first + [B.incorporated_on.desc(), B.id]  # also while the rank index is missing: main trade first
    if first:
        # Fullest profiles first even inside a trade search: the tier (Full / Partial / Basic) leads, so each tier is one block
        # under one divider, and the main-activity companies come first within it.
        tier = func.floor(func.coalesce(B.rank_score, 0) / TIER_STEP).desc()
        return [tier] + first + [B.rank_score.desc().nullslast(), B.incorporated_on.desc().nullslast(), B.id]
    return first + [B.rank_score.desc().nullslast(), B.incorporated_on.desc().nullslast(), B.id]


async def _count_upto(db: AsyncSession, where, n: int = BROADEN_BELOW) -> int:
    """How many match, stopping at n: enough to know whether a trade search is thin."""
    capped = select(BusinessRecord.id).where(where).limit(n).subquery()
    return int((await db.execute(select(func.count()).select_from(capped))).scalar() or 0)


async def matching(db: AsyncSession, f: Dict[str, Any], extra: Optional[list] = None, *, count=None, broaden: bool = True):
    """(where, count, broadened): the one place that decides which companies a set of filters means, so every list, count
    and summary agrees. A trade matches by main activity; when fewer than BROADEN_BELOW do, side activities are taken in too.
    `count(db, where)` is the count the caller needs anyway (the capped total), so the usual case costs no extra query."""
    count = count or _count_upto
    extra = list(extra or [])
    strict = and_(*_filter_conditions(f), *extra)
    n = await count(db, strict)
    if not broaden or n >= BROADEN_BELOW or not can_broaden(f):
        return strict, n, False
    wide = and_(*_filter_conditions(f, any_activity=True), *extra)
    m = await count(db, wide)
    return (wide, m, True) if m > n else (strict, n, False)


NARROWING = ("keyword", "sector", "sic_codes", "towns", "postcode_prefixes", "name_contains", "near", "signals")
# Main SIC divisions that are not trading: education, health, social work, membership and religious bodies, public bodies, dormant and non-trading.
NON_COMMERCIAL_SIC = r"^(84|85|86|87|88|91|94|97|98|99|74990)"
NON_COMMERCIAL_CATEGORY = r"(charit|community interest|industrial|unincorporated|royal charter)"


def has_narrowing(f: Dict[str, Any]) -> bool:
    """Whether the filters name a trade, place or company. Without one the search is the opening list of the whole register."""
    return any(f.get(k) for k in NARROWING) or f.get("saved") == "only"  # "only my saved companies" is already a small, chosen list


def with_default_browse(filters: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
    """(filters, applied). The opening list with nothing asked for is the whole register, and it starts with the trading
    companies that have the fullest records (see opening_page); any filter the person sets wins."""
    if has_narrowing(normalize_filters(filters)):
        return filters, False
    return {**(filters or {}), "complete_first": True}, True


def _complete_commercial() -> Any:
    """A trading company with a full record: top tier, a trade code that is not education, health, social work, membership,
    religious, public, dormant or non-trading, a company type that is not a charity, and its own website."""
    B = BusinessRecord
    main_sic = func.split_part(func.btrim(func.coalesce(B.sic_codes, ""), "|"), "|", 1)
    site = func.coalesce(func.nullif(B.website, ""), B.domain, "")
    return and_(B.rank_score >= 2 * TIER_STEP, main_sic != "", ~main_sic.op("~")(NON_COMMERCIAL_SIC),
                ~func.coalesce(B.company_category, "").op("~*")(NON_COMMERCIAL_CATEGORY),
                site != "", ~or_(*[site.ilike(f"%{h}%") for h in DIRECTORY_SITES]))


COMPLETE_CAP = 5000  # how many complete companies lead the opening list; their ids are kept so the page never has to search for them again
_COMPLETE: List[Any] = [0.0, []]  # [when read, ids best first]
_COMPLETE_TTL = 1200.0


async def complete_ids(db: AsyncSession) -> List[str]:
    """The ids of the best complete trading companies (see _complete_commercial), best first, read once in a while with its own short
    time limit. [] when it can't be read in time: the opening list then runs as the plain whole register instead of failing."""
    import time

    if time.monotonic() - _COMPLETE[0] < _COMPLETE_TTL:
        return list(_COMPLETE[1])
    ids: List[str] = []
    ttl_back = 0.0
    try:
        async with db.begin_nested():
            if db.get_bind().dialect.name == "postgresql":
                await db.execute(text("SET LOCAL statement_timeout = '20s'"))
            where = and_(*_filter_conditions(normalize_filters({"complete_commercial": True})))
            ids = [r[0] for r in (await db.execute(select(BusinessRecord.id).where(where)
                                                    .order_by(BusinessRecord.rank_score.desc().nullslast()).limit(COMPLETE_CAP))).all()]
    except Exception as err:
        logger.warning(f"[business_records] complete companies could not be read: {err}")
        ttl_back = _COMPLETE_TTL - 60  # try again in a minute, not in twenty
    _COMPLETE[0], _COMPLETE[1] = time.monotonic() - ttl_back, ids
    return list(ids)


async def opening_page(db: AsyncSession, filters: Dict[str, Any], *, limit: int = 25, offset: int = 0, sort: str = "best",
                       exclude_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """The whole register as one list: first the trading companies with full records, then every other company, best first.
    A page that runs past the end of the first group carries on into the second, so no company is shown twice or left out."""
    base = {k: v for k, v in (filters or {}).items() if k != "complete_first"}
    offset = max(0, int(offset or 0))
    skip = set(exclude_ids or [])
    ids = [i for i in (await complete_ids(db) if sort == "best" else []) if i not in skip]
    if not ids:  # another sort, or the complete companies are not ready: the whole register in the order asked
        out = await search_filtered(db, base, limit=limit, offset=offset, sort=sort, stats=False, exclude_ids=exclude_ids, broaden=False)
        return {**out, "filters": normalize_filters(filters)}
    page = ids[offset:offset + limit]
    rows: List[Any] = []
    if page:
        got = {r.id: r for r in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(page)))).scalars().all()}
        rows = [got[i] for i in page if i in got]
    need = limit - len(rows)
    rest = await search_filtered(db, base, limit=max(need, 1), offset=max(0, offset - len(ids)), sort=sort, stats=False,
                                 exclude_ids=list(skip | set(ids)), broaden=False)
    if need > 0:
        rows += rest["rows"][:need]
    total = len(ids) + rest["total"]
    return {**rest, "rows": rows, "total": min(total, COUNT_CAP), "total_capped": total > COUNT_CAP or rest["total_capped"],
            "filters": normalize_filters(filters)}


# Filters given up one step at a time, least important first, when nothing matches all of them. The trade (keyword, sector,
# SIC code) and the status are never given up, so every row shown is still a real company of the kind asked for.
RELAX_STEPS = (
    ("must-have email, phone and website", ("has_email", "has_phone", "has_website")),
    ("leave-out filters", ("not_keyword", "not_towns", "not_company_category")),
    ("company age", ("min_age_years", "max_age_years")),
    ("company size and type", ("size_bands", "company_category")),
    ("postcode", ("postcode_prefixes",)),
    ("the full company name", ("name_contains",)),
    ("town", ("towns",)),
)
_NAME_NOISE = {"the", "and", "ltd", "limited", "plc", "llp", "uk", "co", "company", "group", "services", "holdings"}


def _first_name_word(name: str) -> str:
    words = [w for w in re.findall(r"[0-9A-Za-z]+", name) if w.lower() not in _NAME_NOISE and len(w) >= 2]
    return words[0] if words else ""


def _is_set(value: Any) -> bool:
    """A filter that was given. A max age of 0 counts; an empty list, empty text, None and False do not."""
    return not (value is None or value is False or value == "" or value == [])


async def closest_match(filters: Dict[str, Any], run, *, seconds: float = 20.0) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    """When a search finds nothing, correct a misspelt town, then give up the least important filters one step at a time, and
    return the first search that finds companies with the names of what was changed so the person is told. (None, []) when even
    the bare trade finds nothing: an empty answer is then the true one. `run(filters)` is the search itself. Nothing is invented:
    every row is a stored company. Stops after `seconds`, so a slow register never makes the screen wait for every step."""
    import time

    from app.services import search_towns

    started = time.monotonic()
    f = normalize_filters(filters)
    dropped: List[str] = []

    async def attempt() -> Optional[Dict[str, Any]]:
        if not has_narrowing(f) or time.monotonic() - started > seconds:
            return None
        out = await run(f)
        return out if out.get("total") else None

    fix = search_towns.suggest(f.get("towns") or [])
    if fix:
        f = {**f, "towns": [fix.get(t, t) for t in f["towns"]]}
        dropped.append("the town spelling (" + ", ".join(f"{a} read as {b}" for a, b in fix.items()) + ")")
        out = await attempt()
        if out:
            return out, dropped
    for label, keys in RELAX_STEPS:
        if not any(_is_set(f.get(k)) for k in keys):
            continue
        if label == "the full company name":
            typed = str(f.get("name_contains") or "").strip()
            first = _first_name_word(typed)
            if not first or first.lower() == typed.lower():
                continue  # one word already: nothing shorter to try, and the name stays a requirement
            f = {**f, "name_contains": first, "name_whole_word": True}  # a whole word: "Acme" is not "Placme"
            label = "the words after the first in the company name"
        else:
            f = {k: v for k, v in f.items() if k not in keys}
        dropped.append(label)
        if not has_narrowing(f):
            return None, []  # nothing left to search on: never open the whole register as an "answer"
        out = await attempt()
        if out:
            return out, dropped
    return None, []


_NAME_ORDER: List[Any] = [0.0, True]  # [when checked, ready]


async def name_sort_ready(db: AsyncSession) -> bool:
    """Whether A to Z can walk an index over the whole register. Without ix_business_records_name_order, sorting millions of names
    for the opening list would hit the time limit, so that one case is shown newest-first and says so. Build it ahead without
    blocking the app: CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_name_order ON business_records (lower(name), id);"""
    import time

    if time.monotonic() - _NAME_ORDER[0] < 60:
        return bool(_NAME_ORDER[1])
    ready = True
    if db.get_bind().dialect.name == "postgresql":
        small = (await db.execute(text("SELECT COALESCE(MAX(reltuples), 0) < 200000 FROM pg_class WHERE relname = 'business_records'"))).scalar()
        indexed = (await db.execute(text(
            "SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid "
            "WHERE c.relname = 'ix_business_records_name_order' AND i.indisvalid AND i.indisready)"))).scalar()
        ready = bool(small or indexed)
    _NAME_ORDER[0], _NAME_ORDER[1] = time.monotonic(), ready
    return ready


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
            "WHERE c.relname = 'ix_business_records_rank_order' AND i.indisvalid AND i.indisready)"))).scalar()
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
    if full is None or partial is None:
        out["tiers"] = None
    else:
        full, partial = min(full, COUNT_CAP), min(partial, COUNT_CAP)
        # Past the cap the three counts are each "at least": Basic can't be worked out by subtraction, so it is left out (None).
        capped = total >= COUNT_CAP
        out["tiers"] = {"full": full, "partial": partial, "basic": None if capped else max(total - full - partial, 0), "capped": capped}
    return out


_TOTALS: Dict[str, Any] = {}  # filters -> (when, count); the shared store changes slowly, so a big count is made once in a while
_TOTALS_TTL = 600.0


async def exact_total(db: AsyncSession, where, f: Dict[str, Any], exclude_ids: Optional[List[str]] = None) -> Optional[int]:
    """The real number of matches when there are more than COUNT_CAP (so the screen can say 5.7 million, not 10,000+).
    Counted with its own short time limit and remembered for a few minutes; None when it takes too long, and the
    screen then shows the capped number as before."""
    import json
    import time

    if exclude_ids or f.get("saved"):
        return None  # a count that depends on this organisation's own lists is never shared through the cache
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
                          exclude_ids: Optional[List[str]] = None, sort: str = "best", stats: bool = True,
                          broaden: bool = True, fit: Optional[Tuple[Dict[str, Any], Dict[str, int]]] = None) -> Dict[str, Any]:
    """The Apollo-style structured search over the shared store: every filter is an exact,
    explainable condition on a real column (nothing fuzzy or semantic), so the same filters always
    return the same companies and each result can be traced to the field that matched. Needs at
    least one narrowing filter (sector, SIC code, town, postcode or name) -- "every active company
    in the UK" is not a search. Returns the page, the (capped) total, and the normalised filters
    actually applied, so the caller can show them back to the user. `broadened` is True when too few companies have
    the trade as their main activity and the side-activity ones were taken in too (see matching)."""
    check_filters(filters)
    f = normalize_filters(filters)
    extra = [BusinessRecord.id.notin_(list(exclude_ids))] if exclude_ids else []
    limit = max(1, min(int(limit or 25), 250))
    if db.get_bind().dialect.name == "postgresql":  # a runaway filter must never tie up the database
        await db.execute(text("SET LOCAL statement_timeout = '25s'"))
    import time

    t0 = time.monotonic()
    ranked = await ranking_ready(db)
    asked = sort
    if sort == "fit" and not (fit and has_narrowing(f)):
        sort = "best"  # no ICP, or the whole register: scoring every company is not a search, so the best match order stands in
    used = sort if ranked or sort != "best" else "newest"  # fit scores the narrowed set itself; it needs no rank index
    if used == "name" and not has_narrowing(f) and not await name_sort_ready(db):
        used = "newest"  # A to Z over the whole register needs its index: shown newest-first rather than timing out
    t1 = time.monotonic()
    where, total, broadened = await matching(db, f, extra, count=_capped_count, broaden=broaden)
    t2 = time.monotonic()
    rows = (await db.execute(
        select(BusinessRecord).where(where).order_by(*_order(used, f, broadened, fit))
        .limit(limit).offset(max(0, int(offset or 0)))
    )).scalars().all()
    t3 = time.monotonic()
    timing = {"ready": int((t1 - t0) * 1000), "count": int((t2 - t1) * 1000), "page": int((t3 - t2) * 1000)}
    if t3 - t0 > 3:
        logger.warning(f"[business_records] slow search {timing} ranked={ranked} sort={sort} filters={f}")
    out = {"rows": list(rows), "total": min(total, COUNT_CAP), "total_capped": total > COUNT_CAP, "filters": f, "ranked": ranked,
           "timing_ms": timing, "broadened": broadened, "sort_used": used, "sort_asked": asked}
    if stats and ranked:
        out.update(await result_stats(db, where, out["total"]))
    elif stats:
        out.update({"tiers": None, "saved_total": None})
    return out


async def search_summary(db: AsyncSession, filters: Dict[str, Any], exclude_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """The figures that sit beside a page of results but are slower to count: the real total (past 10,000), how many are Full,
    Partial and Basic, and how many are already in this organisation's lists. Asked for after the page is on screen, with the
    filters the search actually ran (see /search "query_filters"), so the figures describe the list that is shown."""
    check_filters(filters)
    f = normalize_filters(filters)
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SET LOCAL statement_timeout = '25s'"))
    extra = [BusinessRecord.id.notin_(list(exclude_ids))] if exclude_ids else []
    where, total, broadened = await matching(db, f, extra, count=_capped_count)
    out: Dict[str, Any] = {"total": min(total, COUNT_CAP), "total_capped": total > COUNT_CAP, "tiers": None, "saved_total": None, "total_all": None,
                           "broadened": broadened}
    if await ranking_ready(db):
        out.update(await result_stats(db, where, out["total"]))
    if out["total_capped"]:
        out["total_all"] = await exact_total(db, where, {**f, "_broadened": broadened}, exclude_ids)
    return out


async def search_people(db: AsyncSession, filters: Dict[str, Any], *, title: str = "", limit: int = 25, offset: int = 0,
                        sort: str = "best") -> Dict[str, Any]:
    """The People tab: the people the registry lists for the companies that match the same filters. Only companies
    whose officers have been read are in it (they are read on demand, see company_contacts), so `fill_ids` names
    the best-ranked matching companies still to read, for the "find people" step. Names are public registry
    facts; emails and phones are never here, they are found (and charged) per person."""
    from app.services import company_contacts as CC

    check_filters(filters)
    f = normalize_filters(filters)
    B = BusinessRecord
    limit = max(1, min(int(limit or 25), 100))
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SET LOCAL statement_timeout = '25s'"))
    base, _, broadened = await matching(db, f)  # the same companies as the Companies tab
    with_people = and_(base, B.officers.isnot(None), cast(B.officers, String) != "[]")  # a company read and found to have no officers is not a result
    word = str(title or "").strip().lower()[:60]
    if word:  # a cheap pre-filter on the stored JSON text; the exact role match is made below
        with_people = and_(with_people, cast(B.officers, String).ilike(_like(word), escape="\\"))
    ranked = await ranking_ready(db)
    order = _order(sort if ranked or sort != "best" else "newest", f, broadened)
    total = await _capped_count(db, with_people)
    matching_total = await _capped_count(db, base)  # all matching companies, so the screen can say "people at 50 of 503"
    rows = (await db.execute(select(B).where(with_people).order_by(*order).limit(limit).offset(max(0, int(offset or 0))))).scalars().all()
    people = []
    for biz in rows:
        for o in CC.active_officers(biz.officers):
            if word and not re.search(r"\b" + re.escape(word) + r"\b", (o["role"] or "").lower()) and word not in o["name"].lower():  # a whole word: "cto" is not "Director"
                continue
            people.append({**o, "company": biz})
    # Only companies the registry can still be asked about: not yet read, and with a company number to ask by. One that was read
    # and had no officers is marked as read, so "find people" moves on to new companies each time instead of repeating itself.
    unread = and_(base, B.officers.is_(None), B.people_checked_at.is_(None), func.coalesce(B.registration_number, "") != "")
    fill = (await db.execute(select(B.id).where(unread).order_by(*order).limit(25))).scalars().all()
    return {"people": people, "companies_total": min(total, COUNT_CAP), "companies_matching": min(matching_total, COUNT_CAP), "total_capped": total > COUNT_CAP, "filters": f, "fill_ids": list(fill),
            "broadened": broadened}


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
        await db.execute(text("SET LOCAL statement_timeout = '6s'"))
    rows = (await db.execute(select(code, func.count()).where(*where).group_by(code))).all()
    out = [{"district": d, "count": int(n)} for d, n in sorted(rows, key=lambda r: _natural(r[0])) if d]
    if len(_DISTRICTS) > 500:
        _DISTRICTS.clear()
    _DISTRICTS[key] = (time.monotonic(), out)
    return out


AREA_CHUNK = 1500  # companies read per step from the postcode districts an area touches, before the shape is applied
AREA_COUNT_CAP = 100_000


async def _area_conditions(db: AsyncSession, filters: Dict[str, Any], poly, exclude_ids: Optional[List[str]] = None):
    """(filters, where, broadened): the filter conditions plus 'in one of the districts this shape touches'; where is None
    when it touches none. The main-activity rule and its broadening are decided on the area, as for a list (see matching)."""
    from app.services import geocoding

    check_filters(filters)
    f = normalize_filters(filters)
    outcodes = await geocoding.outcodes_for_area(poly)
    if not outcodes:
        return f, None, False
    extra = [or_(*[BusinessRecord.postcode.like(f"{oc} %") for oc in outcodes])]
    if exclude_ids:
        extra.append(BusinessRecord.id.notin_(list(exclude_ids)))
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SET LOCAL statement_timeout = '25s'"))
    where, _, broadened = await matching(db, f, extra)
    return f, where, broadened


async def area_candidates(db: AsyncSession, filters: Dict[str, Any], area: Any) -> Dict[str, Any]:
    """How many companies sit in the postcode districts a drawn area touches (an upper bound: the
    shape itself is applied as they are read). Cheap, so the user can choose how many to see."""
    from app.services import geocoding

    poly = geocoding.clean_polygon(area)
    f, where, broadened = await _area_conditions(db, filters, poly)
    if where is None:
        return {"candidates": 0, "capped": False, "filters": f, "broadened": False}
    capped = select(BusinessRecord.id).where(where).limit(AREA_COUNT_CAP + 1).subquery()
    n = int((await db.execute(select(func.count()).select_from(capped))).scalar() or 0)
    return {"candidates": min(n, AREA_COUNT_CAP), "capped": n > AREA_COUNT_CAP, "filters": f, "broadened": broadened}


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
    f, where, broadened = await _area_conditions(db, filters, poly, exclude_ids)
    if where is None:
        return {"rows": [], "points": {}, "total": 0, "next_scan": None, "filters": f, "broadened": False}
    scan = max(0, int(scan or 0))
    chunk = max(1, min(int(chunk or AREA_CHUNK), AREA_CHUNK))
    rows = (await db.execute(
        select(BusinessRecord).where(where)
        .order_by(*_order("best" if await ranking_ready(db) else "newest", f, broadened)).offset(scan).limit(chunk + 1)
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
    return {"rows": inside, "points": points, "total": len(inside), "next_scan": scan + chunk if more else None, "filters": f,
            "broadened": broadened}


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
