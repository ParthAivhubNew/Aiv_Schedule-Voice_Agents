"""The ideal customer (ICP) with the database: load and save it on the company profile, the staff-set fit weights, the SIC
picker, drafting an ICP from the customer's own website, and putting fit scores and signal tags on companies for the screens.

The scoring rules themselves are in fit_score.py (pure).
"""
from __future__ import annotations

import math
import logging
import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import AppSetting, BusinessRecord, CompanyProfile, PersonEmail
from app.services import fit_score as FS

logger = logging.getLogger("icp")

WEIGHTS_KEY = "fit_weights"


class IcpError(ValueError):
    """Something the person can fix, in plain words."""


# ── ICP on the company profile ──────────────────────────────────────────────
async def _profile(db: AsyncSession) -> Optional[CompanyProfile]:
    return (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()


async def load(db: AsyncSession) -> Dict[str, Any]:
    cp = await _profile(db)
    try:
        return FS.clean_icp(getattr(cp, "icp", None) or {})
    except ValueError:  # a stored ICP from an older shape: shown as far as it still reads
        return FS.clean_icp({k: v for k, v in (getattr(cp, "icp", None) or {}).items() if k != "areas"})


async def _districts_within(postcode: str, miles: float) -> List[str]:
    """The postcode districts whose centre is within `miles` of this postcode, from the free public postcode service."""
    from app.services import geocoding

    pc = geocoding.norm_postcode(postcode)
    if not pc:
        raise IcpError(f"{postcode} isn't a full UK postcode. Type one like LS1 4AP.")
    try:
        centre = (await geocoding._get(f"/postcodes/{pc.replace(' ', '')}", {})).get("result") or {}
        lat, lng = centre.get("latitude"), centre.get("longitude")
        if lat is None or lng is None:
            raise IcpError(f"{pc} wasn't found.")
        # Every district the ring itself touches, not only those whose centre is inside it: the same lookup a drawn area uses.
        # (The one-call "districts near a point" service stops at 100 results and about 15 miles, which lost districts at both ends.)
        km = miles * 1.609344
        d_lat = km / 111.32
        d_lng = km / (111.32 * max(0.2, math.cos(math.radians(lat))))
        ring = [(lat + d_lat * math.sin(2 * math.pi * i / 36), lng + d_lng * math.cos(2 * math.pi * i / 36)) for i in range(36)]
        found = [str(c).upper() for c in await geocoding.outcodes_for_area(ring)]
    except IcpError:
        raise
    except ValueError as err:
        raise IcpError(str(err))
    except Exception as err:
        logger.warning("[icp] district lookup failed for %s: %s", pc, err)
        raise IcpError("The postcode lookup didn't answer just now. Try again in a moment, or add postcode areas instead.")
    own = pc.split(" ")[0]
    return list(dict.fromkeys([own] + found))


async def save(db: AsyncSession, raw: Dict[str, Any]) -> Dict[str, Any]:
    """Cleans and stores the ICP. A radius around a postcode is turned into the postcode districts inside it, once, here, so
    the search and the score use the same districts and the person can see which they are. The caller commits."""
    try:
        icp = FS.clean_icp(raw)
    except ValueError as err:
        raise IcpError(str(err))
    old = {(a["postcode"], a["radius_miles"]): a.get("districts") or [] for a in (await load(db)).get("areas") or []}
    for a in icp["areas"]:
        known = old.get((a["postcode"], a["radius_miles"]))
        a["districts"] = known or await _districts_within(a["postcode"], a["radius_miles"])
    cp = await _profile(db)
    if cp is None:
        cp = CompanyProfile(id="default", name="")
        db.add(cp)
    cp.icp = {**icp, "updated_at": datetime.utcnow().isoformat() + "Z"}
    return icp


# ── Staff-set weights ───────────────────────────────────────────────────────
_WEIGHTS: List[Any] = [0.0, None]
_WEIGHTS_TTL = 60.0


async def weights(db: AsyncSession) -> Dict[str, int]:
    if _WEIGHTS[1] is not None and time.monotonic() - _WEIGHTS[0] < _WEIGHTS_TTL:
        return dict(_WEIGHTS[1])
    row = await db.get(AppSetting, WEIGHTS_KEY)
    try:
        w = FS.clean_weights((row.data or {}).get("weights") or {}) if row else dict(FS.DEFAULT_WEIGHTS)
    except ValueError:
        w = dict(FS.DEFAULT_WEIGHTS)
    _WEIGHTS[0], _WEIGHTS[1] = time.monotonic(), w
    return dict(w)


async def save_weights(db: AsyncSession, raw: Dict[str, Any], by: str = "") -> Dict[str, int]:
    w = FS.clean_weights(raw)
    row = await db.get(AppSetting, WEIGHTS_KEY)
    data = {"weights": w, "by": by, "at": datetime.utcnow().isoformat() + "Z"}
    if row is None:
        db.add(AppSetting(id=WEIGHTS_KEY, data=data))
    else:
        row.data = data
    _WEIGHTS[0], _WEIGHTS[1] = 0.0, None
    return w


# ── SIC picker ──────────────────────────────────────────────────────────────
_SIC_CACHE: Dict[str, List[Dict[str, str]]] = {}
_SIC_PART = re.compile(r"^\s*(\d{4,5})\s*-\s*(.+?)\s*$")


async def sic_search(db: AsyncSession, q: str, limit: int = 20) -> List[Dict[str, str]]:
    """SIC codes and their words as the register writes them, read from our own copy of it, so the picker never offers a
    code or a description the register doesn't use. Words match the description; digits match the start of the code."""
    q = re.sub(r"\s+", " ", str(q or "")).strip()[:60]
    if len(q) < 2:
        return []
    key = q.lower()
    if key in _SIC_CACHE:
        return _SIC_CACHE[key][:limit]
    from app.services.search_synonyms import expand

    B = BusinessRecord
    digits = re.sub(r"\D", "", q)
    if digits and digits == q.replace(" ", ""):
        where = B.sic_codes.like(f"%|{digits}%")
        wanted = lambda code, words: code.startswith(digits)  # noqa: E731
    else:
        words, codes = expand(q)
        where = or_(*[B.sic_text.ilike(f"%{w}%") for w in words], *[B.sic_codes.like(f"%|{c}|%") for c in codes])
        wanted = lambda code, text: any(w in text.lower() for w in words) or code in codes  # noqa: E731
    rows = []
    try:
        async with db.begin_nested():
            if db.get_bind().dialect.name == "postgresql":
                from sqlalchemy import text as sql

                await db.execute(sql("SET LOCAL statement_timeout = '5s'"))
            rows = (await db.execute(select(B.sic_text).where(B.sic_text.isnot(None), where).limit(400))).scalars().all()
    except Exception as err:
        logger.warning("[icp] SIC lookup for %r failed: %s", q, err)
    seen: Dict[str, str] = {}
    for sic_text in rows:
        for part in str(sic_text or "").split(" | "):
            m = _SIC_PART.match(part)
            if m and m.group(1) not in seen and wanted(m.group(1), m.group(2)):
                seen[m.group(1)] = m.group(2)
    out = [{"code": c, "text": t} for c, t in sorted(seen.items())]
    if len(_SIC_CACHE) > 500:
        _SIC_CACHE.clear()
    _SIC_CACHE[key] = out
    return out[:limit]


async def sic_labels(db: AsyncSession, codes: List[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for c in codes:
        hit = next((r for r in await sic_search(db, c, limit=50) if r["code"] == c), None)
        if hit:
            out[c] = hit["text"]
    return out


# ── Drafting the ICP from the customer's own website ─────────────────────────
_DRAFT_SYSTEM = (
    "You read a UK company's own website and describe ITS CUSTOMERS (who it sells to), not the company itself. "
    "Only use what the page text says or clearly implies. Leave a field empty when the page doesn't say. "
    "customer_trades: up to 6 short trade words for the kinds of business it sells to (for example 'restaurants', 'dentists'). "
    "postcode_areas: UK postcode areas or districts it says it serves (for example 'LS', 'BD1'), only when places are named. "
    "size_bands: from micro, small, medium_large, only when the page says how big its customers are. "
    "company_types: from ltd, plc, llp, cic, only when stated. evidence: one short quote from the page for each thing you filled.")
_DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "customer_trades": {"type": "array", "items": {"type": "string"}},
        "postcode_areas": {"type": "array", "items": {"type": "string"}},
        "size_bands": {"type": "array", "items": {"type": "string", "enum": ["micro", "small", "medium_large"]}},
        "company_types": {"type": "array", "items": {"type": "string", "enum": list(FS.COMPANY_TYPES)}},
        "evidence": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["customer_trades"],
}


async def _site_text(url: str) -> str:
    from app.services.safe_fetch import FetchRefused, fetch_text

    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    links: List[str] = []
    try:
        title, body = await fetch_text(url, max_chars=6000, links_out=links)
    except FetchRefused as err:
        raise IcpError(f"Your website couldn't be read: {err}")
    except Exception:
        raise IcpError("Your website couldn't be read just now. Try again in a moment.")
    host = re.sub(r"^https?://", "", url).split("/")[0].lower()
    more = [l for l in links if host in l.lower() and re.search(r"/(about|services|who-we-help|industries|sectors|clients)", l, re.I)][:2]
    texts = [f"{title}\n{body}"]
    for link in more:
        try:
            t, b = await fetch_text(link, max_chars=3000)
            texts.append(f"{t}\n{b}")
        except Exception:
            continue
    return "\n\n".join(texts)[:10000]


async def draft_from_website(db: AsyncSession, website: str) -> Dict[str, Any]:
    """A first ICP worked out from the customer's own site, for them to check and save (nothing is saved here). The trades the
    page names become SIC codes only through the register's own descriptions (sic_search), so every code offered is real."""
    from app.services import llm_gateway

    website = str(website or "").strip()
    if not website:
        raise IcpError("Add your website in About your business first, or type it here.")
    page = await _site_text(website)
    if len(page.strip()) < 80:
        raise IcpError("Your website had too little text to work from. Fill the boxes in yourself.")
    try:
        data = await llm_gateway.extract_structured(system_prompt=_DRAFT_SYSTEM, user_text=f"Website: {website}\n\n{page}", schema=_DRAFT_SCHEMA,
                                                    tool_name="describe_customers", db=db, scope="leadgen", max_tokens=600)
    except Exception as err:
        logger.warning("[icp] draft failed: %s", err)
        data = None
    if not data:
        raise IcpError("The AI couldn't read your website just now. Try again, or fill the boxes in yourself.")
    codes: List[str] = []
    labels: Dict[str, str] = {}
    for trade in (data.get("customer_trades") or [])[:6]:
        for hit in (await sic_search(db, str(trade)))[:3]:
            if hit["code"] not in codes:
                codes.append(hit["code"])
                labels[hit["code"]] = hit["text"]
    areas = [a for a in (FS._outward(x) for x in data.get("postcode_areas") or []) if FS._AREA.match(a)]
    draft = FS.clean_icp({"sic_codes": codes[:12], "sic_labels": labels, "postcode_areas": areas,
                          "size_bands": data.get("size_bands") or [], "company_types": data.get("company_types") or []})
    return {"draft": draft, "trades": [str(t)[:60] for t in (data.get("customer_trades") or [])[:6]],
            "evidence": [str(e)[:200] for e in (data.get("evidence") or [])[:6]]}


# ── Scores and tags on companies ────────────────────────────────────────────
async def _verified_emails(db: AsyncSession, biz_ids: List[str]) -> set:
    if not biz_ids:
        return set()
    rows = await db.execute(select(PersonEmail.business_id).where(PersonEmail.business_id.in_(biz_ids), PersonEmail.status == "verified"))
    return {r[0] for r in rows.all()}


async def context(db: AsyncSession) -> Optional[tuple]:
    """(icp, weights) when this organisation has set an ICP, else None."""
    icp = await load(db)
    if not FS.icp_is_set(icp):
        return None
    return icp, await weights(db)


async def attach_to_cards(db: AsyncSession, cards: List[Dict[str, Any]], ctx: Optional[tuple]) -> List[Dict[str, Any]]:
    """Find Leads rows: the signal tags for every company, and the fit score with its reasons once an ICP is set."""
    ids = [c["id"] for c in cards]
    if not ids:
        return cards
    rows = {b.id: b for b in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(ids)))).scalars().all()}
    checked = await _verified_emails(db, ids) if ctx else set()
    today = datetime.utcnow().date()
    out = []
    for c in cards:
        biz = rows.get(c["id"])
        if biz is None:
            out.append({**c, "signals": [], "fit": None})
            continue
        tags = FS.signals(biz, today)
        score = FS.fit(biz, ctx[0], tags, FS.contacts_of(biz, verified_email=biz.id in checked), ctx[1]) if ctx else None
        out.append({**c, "signals": tags, "fit": score})
    return out


def _account_contacts(account: Any, biz: Any, checked: set) -> Dict[str, str]:
    verified = ((account.verification or {}).get("email") or {}).get("state") == "verified" and bool(account.email)
    if biz is not None:
        got = FS.contacts_of(biz, verified_email=verified or biz.id in checked)
        if not got["director"] and account.contact_name and "director" in (account.contact_title or "").lower():
            got["director"] = account.contact_name
        return got
    director = account.contact_name if "director" in (account.contact_title or "").lower() else ""
    return {"director": director, "email": "verified" if verified else ""}


class _AccountFacts:
    """A saved company with no register link, read as the fields the score knows (only what the person saved)."""

    def __init__(self, a: Any):
        self.status, self.company_category, self.registration_number = "", "", a.registration_number or ""
        self.sic_text, self.sic_codes, self.industry = "", "", a.industry or ""
        self.size_band, self.postcode, self.email, self.officers, self.sources, self.raw_data = "", a.postcode or "", "", None, [], None
        self.confidence_tier, self.incorporated_on, self.incorporation_date = "", None, ""


async def score_accounts(db: AsyncSession, accounts: List[Any], biz_by_id: Dict[str, Any], ctx: Optional[tuple]) -> Dict[str, Dict[str, Any]]:
    """account id -> {fit, signals} for the saved list. Read through the account's register record, as the list shows it."""
    ids = list(biz_by_id)
    checked = await _verified_emails(db, ids) if ctx and ids else set()
    today = datetime.utcnow().date()
    out: Dict[str, Dict[str, Any]] = {}
    for a in accounts:
        biz = biz_by_id.get(a.business_record_id) if a.business_record_id else None
        facts = biz if biz is not None else _AccountFacts(a)
        tags = FS.signals(biz, today) if biz is not None else []
        out[a.id] = {"signals": tags, "fit": FS.fit(facts, ctx[0], tags, _account_contacts(a, biz, checked), ctx[1]) if ctx else None}
    return out
