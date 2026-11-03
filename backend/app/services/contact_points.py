"""Every way to reach or find a company that any source gave us, in one searchable list (see CompanyContactPoint).

A company record already keeps what each source published, in `raw_data` and the profile (`shared_research`). The register and bulk files, the web
lookup (`contacts_web`), LinkedIn and the other social pages, a research run, and Apollo and Google answers are all in there. This module reads
all of those, and writes one row per website, phone, email and page (LinkedIn, Facebook, X, Instagram, YouTube, TikTok), each in a comparable form.
Nothing is stored only here: the list can be rebuilt from the records at any time (`sync`, and scripts/sync_contact_points.py for every company).
Its use is to find the same contact on two records (the same LinkedIn page, phone or email), to filter by it, and to show everything we know.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

logger = logging.getLogger("contact_points")

KINDS = ("website", "phone", "email", "linkedin", "facebook", "x", "instagram", "youtube", "tiktok")
PAGE_KINDS = ("linkedin", "facebook", "x", "instagram", "youtube", "tiktok")
_PAGE_HOSTS = {
    "linkedin.com": "linkedin", "facebook.com": "facebook", "fb.com": "facebook", "x.com": "x", "twitter.com": "x",
    "instagram.com": "instagram", "youtube.com": "youtube", "youtu.be": "youtube", "tiktok.com": "tiktok",
}
_NETWORK_NAMES = {"linkedin": "linkedin", "facebook": "facebook", "fb": "facebook", "x": "x", "twitter": "x", "instagram": "instagram",
                  "youtube": "youtube", "tiktok": "tiktok"}
_EMAIL = re.compile(r"^[A-Za-z0-9._%+\-']+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

# Keys of a source's own record that hold a contact (lower-cased). Nothing else is read from a source record: a column such as
# "Location URL" belongs to the register, not to the company.
_SOURCE_KEYS: Dict[str, str] = {
    "website": "website", "website_url": "website", "service's website (if available)": "website", "web": "website", "domain": "website",
    "phone": "phone", "phone number": "phone", "phone_number": "phone", "telephone": "phone",
    "email": "email", "email address": "email", "email_address": "email",
    "linkedin": "linkedin", "linkedin_url": "linkedin", "facebook_url": "facebook", "facebook": "facebook",
    "twitter_url": "x", "x_url": "x", "twitter": "x", "instagram_url": "instagram", "instagram": "instagram",
    "youtube_url": "youtube", "tiktok_url": "tiktok",
}


# ── Comparable forms ─────────────────────────────────────────────────────────
def phone_key(value: Any) -> str:
    """A phone number as digits only, in one form, so "0113 496 0101" and "+44 113 496 0101" are the same number. "" when too short to mean anything."""
    d = re.sub(r"\D", "", str(value or ""))
    if d.startswith("0044"):
        d = d[4:]
    elif d.startswith("44") and len(d) >= 11:
        d = d[2:]
    d = d.lstrip("0")
    return d if len(d) >= 9 else ""


def _host_and_path(url: str) -> Tuple[str, str]:
    raw = str(url or "").strip()
    if not raw or " " in raw:
        return "", ""
    p = urlparse(raw if "://" in raw else "https://" + raw)
    host = (p.netloc or "").lower().split("@")[-1].split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    return host, (p.path or "").strip("/").lower()


def page_kind(url: str) -> str:
    """Which network a page address is on, or "" when it is not one of them."""
    host, _ = _host_and_path(url)
    for known, kind in _PAGE_HOSTS.items():
        if host == known or host.endswith("." + known):
            return kind
    return ""


def norm(kind: str, value: Any) -> str:
    """The value in one form, so the same contact written two ways compares equal. "" when it is not a usable value of that kind."""
    v = str(value or "").strip()
    if not v:
        return ""
    if kind == "phone":
        return phone_key(v)
    if kind == "email":
        v = v.lower()
        return v if _EMAIL.match(v) else ""
    host, path = _host_and_path(v)
    if not host or "." not in host:
        return ""
    if kind == "website":
        return host
    if kind in PAGE_KINDS:
        if page_kind(v) != kind:
            return ""
        parts = [x for x in path.split("/") if x]
        if kind == "linkedin":
            parts = parts[:2]  # company/acme, in/jane-doe: anything after is a sub-page
        elif kind in ("facebook", "x", "instagram", "tiktok"):
            parts = parts[:1]
        elif kind == "youtube":
            parts = parts[:2]
        if not parts:
            return ""
        return f"{kind}/" + "/".join(parts)
    return ""


def _point(kind: str, value: Any, source: str, confidence: str = "found", owner: str = "") -> Optional[Dict[str, str]]:
    value = str(value or "").strip()[:500]
    n = norm(kind, value)
    if not n:
        return None
    return {"kind": kind, "value": value, "norm": n, "source": source, "confidence": confidence, "owner": (owner or "")[:120]}


def _strings(items: Any) -> List[str]:
    """A list of values that may be plain text or {value / phone / email / number: ...}."""
    out: List[str] = []
    for it in items if isinstance(items, (list, tuple, set)) else []:
        if isinstance(it, str):
            out.append(it)
        elif isinstance(it, dict):
            for k in ("value", "phone", "email", "number", "address", "url"):
                if isinstance(it.get(k), str) and it[k].strip():
                    out.append(it[k])
                    break
    return out


def _source_name(key: str) -> str:
    head = key.split(":")[0]
    if head in ("google_places", "apollo"):
        return head
    return "register"


def points_of(biz: Any) -> List[Dict[str, str]]:
    """Every contact point the company record holds, from every place it keeps one. No database access."""
    out: List[Dict[str, str]] = []

    def add(kind: str, value: Any, source: str, confidence: str = "found", owner: str = "") -> None:
        p = _point(kind, value, source, confidence, owner)
        if p:
            out.append(p)

    register = (getattr(biz, "confidence_tier", "") or "") == "verified_registry"
    add("website", getattr(biz, "website", "") or getattr(biz, "domain", ""), "record", "register" if register else "found")
    add("phone", getattr(biz, "phone", ""), "record", "register" if register else "found")
    add("email", getattr(biz, "email", ""), "record", "register" if register else "found")
    raw = getattr(biz, "raw_data", None) or {}

    cw = raw.get("contacts_web") if isinstance(raw.get("contacts_web"), dict) else {}
    conf = "picked" if cw.get("by") == "pick" else "found"
    add("website", cw.get("website"), "web", conf)
    for ph in _strings(cw.get("phones")):
        add("phone", ph, "web", conf)
    for em in _strings(cw.get("emails")):
        add("email", em, "web", conf)
    for person in cw.get("team") or []:
        if isinstance(person, dict):
            add("phone", person.get("phone"), "web", conf, person.get("name", ""))
            add("email", person.get("email"), "web", conf, person.get("name", ""))

    li = raw.get("linkedin") if isinstance(raw.get("linkedin"), dict) else {}
    if isinstance(li.get("company"), dict):
        add("linkedin", li["company"].get("url"), "linkedin", "picked" if li["company"].get("by") == "users" else "found")
    for who, entry in (li.get("people") or {}).items() if isinstance(li.get("people"), dict) else []:
        if isinstance(entry, dict):
            add("linkedin", entry.get("url"), "linkedin", "picked" if entry.get("by") == "users" else "found", who)

    socials = raw.get("socials") if isinstance(raw.get("socials"), dict) else {}
    for network, entry in socials.items():
        kind = _NETWORK_NAMES.get(str(network).lower(), "")
        url = entry.get("url") if isinstance(entry, dict) else entry
        if kind:
            add(kind, url, "social", "picked" if isinstance(entry, dict) and entry.get("by") in ("pick", "users") else "found")

    research = getattr(biz, "shared_research", None)
    if isinstance(research, dict):
        for ph in _strings(research.get("phones")):
            add("phone", ph, "research")
        for em in _strings(research.get("emails")):
            add("email", em, "research")
        rs = research.get("socials")
        if isinstance(rs, dict):
            for network, url in rs.items():
                kind = _NETWORK_NAMES.get(str(network).lower(), "") or page_kind(url if isinstance(url, str) else "")
                if kind:
                    add(kind, url if isinstance(url, str) else (url or {}).get("url"), "research")
        for person in research.get("team") or research.get("people") or []:
            if isinstance(person, dict):
                add("phone", person.get("phone"), "research", "found", person.get("name", ""))
                add("email", person.get("email"), "research", "found", person.get("name", ""))
                add("linkedin", person.get("linkedin") or person.get("linkedin_url"), "research", "found", person.get("name", ""))

    # What each source published about the company itself: the register and bulk files, and the Apollo and Google answers.
    skip = {"contacts_web", "linkedin", "socials", "lookups_missed", "lookup_options"}
    for key, rec in raw.items():
        if key in skip or not isinstance(rec, dict):
            continue
        source = _source_name(str(key))
        confidence = "register" if source == "register" else "found"
        for field, value in rec.items():
            kind = _SOURCE_KEYS.get(str(field).strip().lower())
            if kind and isinstance(value, str):
                add(kind, value, source, confidence)
    # one row per (kind, comparable value): the first, strongest claim wins
    order = {"register": 0, "picked": 1, "confirmed": 2, "found": 3}
    seen: Dict[Tuple[str, str], Dict[str, str]] = {}
    for p in out:
        k = (p["kind"], p["norm"])
        if k not in seen or order.get(p["confidence"], 9) < order.get(seen[k]["confidence"], 9):
            seen[k] = p
    return list(seen.values())


# ── The table ────────────────────────────────────────────────────────────────
async def sync(db: Any, biz: Any) -> int:
    """Make the list match what the record holds now. Adds what is missing; never removes (a contact a source once gave is still a claim). Returns how many were added."""
    from sqlalchemy import select

    from app.models.models import CompanyContactPoint as P

    wanted = points_of(biz)
    if not wanted:
        return 0
    have = set((await db.execute(select(P.kind, P.norm).where(P.business_record_id == biz.id))).all())
    added = 0
    now = datetime.utcnow()
    for p in wanted:
        if (p["kind"], p["norm"]) in have:
            continue
        db.add(P(id=f"cp_{uuid.uuid4().hex[:16]}", business_record_id=biz.id, kind=p["kind"], value=p["value"], norm=p["norm"], owner=p["owner"],
                 source=p["source"], confidence=p["confidence"], found_at=now, last_seen_at=now))
        added += 1
    if added:
        await db.flush()
    return added


def rows_for_bulk(values: List[Dict[str, Any]], ids: Dict[str, str], now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """The contact rows for a batch of company rows as the bulk loader built them (see business_records.bulk_upsert). `ids` maps each row's
    identity hash to the id of the stored company, whether the row was new or refreshed an existing one. No database access."""
    now = now or datetime.utcnow()
    out: List[Dict[str, Any]] = []
    for v in values:
        biz_id = ids.get(v.get("identity_hash") or "")
        if not biz_id:
            continue
        like = type("Row", (), {"id": biz_id, "website": v.get("website") or "", "domain": v.get("domain") or "", "phone": v.get("phone") or "",
                                "email": v.get("email") or "", "confidence_tier": v.get("confidence_tier") or "", "raw_data": v.get("raw_data"),
                                "shared_research": None})()
        for p in points_of(like):
            out.append({"id": f"cp_{uuid.uuid4().hex[:16]}", "business_record_id": biz_id, "kind": p["kind"], "value": p["value"], "norm": p["norm"],
                        "owner": p["owner"], "source": p["source"], "confidence": p["confidence"], "found_at": now, "last_seen_at": now})
    return out


async def bulk_add(db: Any, values: List[Dict[str, Any]]) -> int:
    """List the contacts of a batch the bulk loader just wrote, in a few statements. Only adds what is missing. Returns how many were added."""
    from sqlalchemy import select
    from sqlalchemy.dialects.postgresql import insert

    from app.models.models import BusinessRecord, CompanyContactPoint as P

    hashes = [v["identity_hash"] for v in values if v.get("identity_hash")]
    if not hashes:
        return 0
    ids = {h: i for i, h in (await db.execute(select(BusinessRecord.id, BusinessRecord.identity_hash).where(BusinessRecord.identity_hash.in_(hashes)))).all()}
    rows = rows_for_bulk(values, ids)
    added = 0
    for i in range(0, len(rows), 2000):
        res = await db.execute(insert(P).values(rows[i:i + 2000]).on_conflict_do_nothing(constraint="uq_contact_point"))
        added += res.rowcount or 0
    return added


async def sync_safely(db: Any, biz: Any) -> None:
    """`sync`, committed, and never raising: a problem here must not turn a successful lookup into an error."""
    try:
        async with db.begin_nested():
            await sync(db, biz)
        await db.commit()
    except Exception as err:
        logger.warning("contact points not updated for %s: %s", getattr(biz, "id", "?"), err)
        try:
            await db.rollback()
        except Exception:
            pass


async def for_company(db: Any, biz_id: str) -> List[Dict[str, Any]]:
    from sqlalchemy import select

    from app.models.models import CompanyContactPoint as P

    rows = (await db.execute(select(P).where(P.business_record_id == biz_id).order_by(P.kind, P.found_at))).scalars().all()
    return [{"id": r.id, "kind": r.kind, "value": r.value, "owner": r.owner or "", "source": r.source or "", "confidence": r.confidence or "found",
             "found_at": r.found_at.isoformat() + "Z" if r.found_at else None} for r in rows]


async def shared_with(db: Any, biz_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Other company records that hold the same phone, email or page (a website is not counted: branches and franchises share one).
    Two records for one company usually show up here."""
    from sqlalchemy import select

    from app.models.models import BusinessRecord, CompanyContactPoint as P

    mine = (await db.execute(select(P.kind, P.norm, P.value).where(P.business_record_id == biz_id, P.kind != "website"))).all()
    if not mine:
        return []
    out: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for kind, n, value in mine:
        others = (await db.execute(
            select(BusinessRecord.id, BusinessRecord.name, BusinessRecord.postcode)
            .join(P, P.business_record_id == BusinessRecord.id)
            .where(P.kind == kind, P.norm == n, BusinessRecord.id != biz_id).limit(limit))).all()
        if others:
            out[(kind, n)] = {"kind": kind, "value": value, "records": [{"id": i, "name": nm, "postcode": pc or ""} for i, nm, pc in others]}
    return list(out.values())
