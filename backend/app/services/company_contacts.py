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
from typing import Any, Dict, List, Optional, Tuple

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


def note_lookup(biz: BusinessRecord, kind: str, found: bool) -> None:
    """Remember that a lookup for `kind` (website, phone or email) ran and came back empty, and clear that once something turns up.
    Without it a refreshed page shows the untried button again, as if nobody had looked."""
    raw = dict(biz.raw_data or {})
    missed = dict(raw.get("lookups_missed") or {})
    if found:
        if kind not in missed:
            return
        missed.pop(kind)
    else:
        missed[kind] = datetime.utcnow().isoformat() + "Z"
    raw["lookups_missed"] = missed
    biz.raw_data = raw


async def web_contacts(db: AsyncSession, biz: BusinessRecord, *, refresh: bool = False, want: str = "all", hint: str = "") -> Dict[str, Any]:
    """A live web lookup for the company's website, phone and email. Stored on the record under raw_data['contacts_web'] -- NOT in the
    verified columns -- so a web finding never sits in a field the registry tier vouches for.

    The lookup is the guardrail's: web_harness searches with one recipe, and only a candidate that passes the hard rules and scores
    over the threshold is kept, one value per field. A saved lookup is reused for CACHE_DAYS; one saved before the guardrail existed
    (no `guardrail` mark) is stale at once, because its phones and emails were never checked."""
    cached = (biz.raw_data or {}).get("contacts_web")
    fresh = bool(cached) and bool(cached.get("guardrail")) and _age_days(cached.get("fetched_at")) <= CACHE_DAYS
    if cached and not refresh and fresh and not hint and (want == "all" or _has(cached, want)):  # extra words from the person always mean a new search
        if cached.get("audit") and _age_days(cached.get("fetched_at")) > AUDIT_DAYS:
            raw = dict(biz.raw_data or {})
            raw["contacts_web"] = {k: v for k, v in cached.items() if k != "audit"}
            biz.raw_data = raw
            await db.flush()
        return {**cached, "cached": True}
    taught = None if hint else await _taught(db, biz, want)
    if taught:
        return taught
    saved = (biz.raw_data or {}).get("contacts_web_all")
    if want in ("website", "phone", "email") and saved and saved.get("guardrail") and not refresh and not hint and _age_days(saved.get("fetched_at")) <= CACHE_DAYS:
        return await _reveal_saved(db, biz, saved, want, cached)  # the earlier search looked for all three: this button shows its own, no new search
    from app.services import web_harness

    facts = {"address": biz.address, "postcode": biz.postcode, "industry": (biz.sic_text or biz.industry or "").split(" | ")[0],
             "company_number": biz.registration_number, "website": biz.website or biz.domain, "phone": biz.phone, "email": biz.email,
             "status": biz.status, "previous_names": _previous_names(biz)}
    search_want = want if hint else "all"  # one search serves the website, phone and email buttons; extra words from the person search for their one field
    try:
        from app.services import contact_choices as CH

        try:
            boosts = await CH.boosts_for(db, biz.id, [k for k in ("website", "phone", "email") if search_want in ("all", k)])
        except Exception as err:  # what users confirmed only improves a lookup; it must never stop one
            logger.warning("confirmed-answer boost unavailable for %s: %s", biz.name, err)
            boosts = {}
        got = await web_harness.find_company(db, name=biz.name, place=biz.region or "", facts=facts, want=search_want, boosts=boosts, hint=hint)
    except Exception as err:
        logger.warning("web lookup failed for %s: %s", biz.name, err)
        raise
    stamp = datetime.utcnow().isoformat() + "Z"
    options = await _remember_options(db, biz, got.get("options") or {})
    if got.get("ledger", {}).get("outcome") == "closed":
        return {"website": "", "phones": [], "emails": [], "team": [], "sources": [], "source": "web", "verified": False, "found": False, "cached": False,
                "closed": True, "reason": got.get("reason", ""), "fetched_at": stamp}
    found = {"website": got["website"], "phones": got["phones"][:1], "emails": got["emails"][:1], "team": [], "sources": got["sources"][:8],
             "source": "web", "verified": False, "guardrail": True, "confidence": got["confidence"], "audit": got["audit"], "ledger": got["ledger"],
             "fetched_at": stamp}
    if not hint:  # what the search found for all three is kept hidden; each button shows its own field when it is pressed (and paid for)
        raw0 = dict(biz.raw_data or {})
        raw0["contacts_web_all"] = dict(found)
        biz.raw_data = raw0
    _keep_socials(biz, got.get("social_links") or {}, stamp)
    # One button shows one thing: the other fields stay hidden in contacts_web_all until their own button is pressed.
    if want in ("website", "phone", "email"):
        if want != "website":
            found["website"] = ""
        if want != "phone":
            found["phones"] = []
        if want != "email":
            found["emails"] = []
    if cached and cached.get("guardrail"):  # a refresh adds to what an earlier checked lookup found; it never throws that away
        found["website"] = found["website"] or cached.get("website") or ""
        found["phones"] = found["phones"] or list(cached.get("phones") or [])[:1]
        found["emails"] = found["emails"] or list(cached.get("emails") or [])[:1]
    elif cached:
        # A lookup from before the guardrail: its website was only checked for looking like the company's, and its phones and emails
        # were never checked. They are retired here, so nothing unchecked is shown again.
        found["website"] = found["website"] or (cached.get("website") or "")
    listing, options = await _listing_step(db, biz, want, found, options, hint)
    if not (found["website"] or found["phones"] or found["emails"]):
        if cached and not cached.get("guardrail"):
            raw = dict(biz.raw_data or {})
            raw["contacts_web"] = {**found, "website": "", "phones": [], "emails": []}
            biz.raw_data = raw
            business_records.refresh_rank(biz)
            await db.flush()
        return {**found, "found": False, "cached": False, "reason": got.get("reason", ""), "options": options, "listing": listing}
    raw = dict(biz.raw_data or {})
    raw["contacts_web"] = found
    biz.raw_data = raw
    business_records.refresh_rank(biz)
    await db.flush()
    return {**found, "found": True, "cached": False, "options": options, "listing": listing}


def _previous_names(biz: BusinessRecord) -> List[str]:
    """The names the register says the company had before: a renamed company's website often still uses the old one."""
    from app.services.company_profile import register_fields

    ch = register_fields(biz)
    return [n for n in (ch.get(f"PreviousName_{i}.CompanyName", "") for i in range(1, 4)) if n]


def _has(found: Dict[str, Any], want: str) -> bool:
    return bool({"website": found.get("website"), "phone": found.get("phones"), "email": found.get("emails")}.get(want))


async def _reveal_saved(db: AsyncSession, biz: BusinessRecord, saved: Dict[str, Any], want: str, cached: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The saved combined lookup holds this button's field (or nothing for it): shown or answered as not found, with no new search."""
    stamp = datetime.utcnow().isoformat() + "Z"
    none = {"website": "", "phones": [], "emails": [], "team": [], "sources": [], "source": "web", "verified": False, "guardrail": True, "fetched_at": stamp}
    if not _has(saved, want):
        return {**none, "found": False, "cached": True, "combined": True, "reason": saved.get("reason", ""), "options": {}, "listing": (biz.raw_data or {}).get("listing_page") or {}}
    shown = {**(cached if cached and cached.get("guardrail") else none)}
    for k in ("website", "phones", "emails"):
        shown.setdefault(k, none[k])
    if want == "website":
        shown["website"] = saved["website"]
    elif want == "phone":
        shown["phones"] = list(saved["phones"])[:1]
    else:
        shown["emails"] = list(saved["emails"])[:1]
    shown.update({"source": "web", "guardrail": True, "fetched_at": saved.get("fetched_at") or stamp,
                  "confidence": {**((cached or {}).get("confidence") or {}), **{k: v for k, v in (saved.get("confidence") or {}).items() if k == want}}})
    raw = dict(biz.raw_data or {})
    raw["contacts_web"] = shown
    biz.raw_data = raw
    business_records.refresh_rank(biz)
    await db.flush()
    return {**shown, "found": True, "cached": False, "from_saved": True, "options": {}, "listing": {}}


def _keep_socials(biz: BusinessRecord, links: Dict[str, str], stamp: str) -> None:
    """The company's own website links to these pages: free, said by the company itself. Only an empty icon is filled."""
    if not links:
        return
    import copy

    from app.services import social_lookup as SL

    for net, url in links.items():
        if net == "linkedin":
            raw = copy.deepcopy(biz.raw_data or {})
            store = raw.setdefault("linkedin", {})
            if not (store.get("company") or {}).get("url"):
                store["company"] = {"url": url, "options": [], "at": stamp, "by": "own_site", "title": "", "note": "Linked from the company's own website"}
                biz.raw_data = raw
        elif net in SL.NETWORKS and not SL._slot(biz, net).get("url"):
            SL._put(biz, net, {"url": url, "options": [], "at": stamp, "by": "own_site", "title": "", "note": "Linked from the company's own website"})


async def _listing_step(db: AsyncSession, biz: BusinessRecord, want: str, found: Dict[str, Any], options: Dict[str, List[Dict[str, Any]]],
                        hint: str) -> Tuple[Dict[str, Any], Dict[str, List[Dict[str, Any]]]]:
    """When the lookup found no site of its own (or no phone or email, for those buttons), the company's exact page on a directory or social site.
    A saved listing is reused for CACHE_DAYS, so the extra search runs once. A phone or email that page shows is offered as a labelled choice
    ("From the Yell page"), never filled in: the person picks it, and the pick is remembered like any other."""
    from app.services import listing_pages as LP
    from app.services.person_record import is_role_inbox

    need = {"website": want in ("all", "website") and not found["website"] and not (biz.website or biz.domain),
            "phone": want in ("all", "phone") and not found["phones"] and not biz.phone,
            "email": want in ("all", "email") and not found["emails"] and not biz.email}
    if not any(need.values()):
        return {}, options
    stored = (biz.raw_data or {}).get("listing_page") or {}
    if stored.get("url") and _age_days(stored.get("at")) <= CACHE_DAYS and not hint:
        listing = stored
    else:
        listing = await _listing_for(biz)
        if listing:
            LP.keep(biz, listing)
            await db.flush()
    if not listing.get("url"):
        return {}, options
    seen = listing.get("also_seen") or {}
    extra = {kind: [{"value": v, "score": 45, "label": f"From the {listing['site']} page", "sources": [listing["url"]]} for v in vals]
             for kind, vals in (("phone", seen.get("phones") or []), ("email", [e for e in seen.get("emails") or [] if is_role_inbox(e)])) if need[kind] and vals}
    if extra:
        kept = await _remember_options(db, biz, extra)
        options = {**options, **{k: (options.get(k) or []) + v for k, v in kept.items()}}
    return listing, options


async def _listing_for(biz: BusinessRecord) -> Dict[str, Any]:
    from app.services import listing_pages

    return await listing_pages.find_for(biz.name, biz.postcode or "", biz.region or biz.address or "")


async def _remember_options(db: AsyncSession, biz: BusinessRecord, options: Dict[str, List[Dict[str, Any]]]) -> Dict[str, List[Dict[str, Any]]]:
    """Keep the candidates a lookup could not decide between, with how many organisations picked each before, so the pick call can check a pick against them."""
    from app.services import contact_choices as CH

    shown: Dict[str, List[Dict[str, Any]]] = {}
    for kind, opts in options.items():
        shown[kind] = CH.annotate(opts, await CH.rows_for(db, biz.id, kind)) if opts else []
    raw = dict(biz.raw_data or {})
    raw["lookup_options"] = {**(raw.get("lookup_options") or {}), **{k: v for k, v in shown.items() if v}}  # a search that found nothing new keeps the earlier candidates
    biz.raw_data = raw
    await db.flush()
    return shown


async def keep_person_email(db: AsyncSession, biz: BusinessRecord, email: str, person: str) -> None:
    """A director's verified work email, found by the email finders, kept as the company's email with who it belongs to."""
    cached = (biz.raw_data or {}).get("contacts_web") or {}
    found = {"website": cached.get("website") or "", "phones": list(cached.get("phones") or [])[:1], "emails": [email.strip().lower()], "team": [], "sources": [],
             "source": "web", "verified": True, "guardrail": True, "by": "email_finder", "person": person,
             "confidence": {"email": {"score": 90, "label": "high"}}, "audit": [], "ledger": {"outcome": "email_finder"}, "fetched_at": datetime.utcnow().isoformat() + "Z"}
    raw = dict(biz.raw_data or {})
    raw["contacts_web"] = found
    biz.raw_data = raw
    business_records.refresh_rank(biz)
    await db.flush()


async def _taught(db: AsyncSession, biz: BusinessRecord, want: str) -> Optional[Dict[str, Any]]:
    """A value that enough different organisations picked for this company is used straight away, with no search. Only for one field at a time."""
    from app.services import contact_choices as CH

    if want not in ("website", "phone", "email"):
        return None
    value = CH.trusted(await CH.rows_for(db, biz.id, want))
    if not value:
        return None
    found = {"website": value if want == "website" else "", "phones": [value] if want == "phone" else [], "emails": [value] if want == "email" else [],
             "team": [], "sources": [], "source": "web", "verified": False, "guardrail": True, "by": "users", "confidence": {want: {"score": 100, "label": "high"}},
             "audit": [], "ledger": {"outcome": "taught"}, "fetched_at": datetime.utcnow().isoformat() + "Z"}
    cached = (biz.raw_data or {}).get("contacts_web") or {}
    if cached.get("guardrail"):
        found["website"] = found["website"] or cached.get("website") or ""
        found["phones"] = found["phones"] or list(cached.get("phones") or [])[:1]
        found["emails"] = found["emails"] or list(cached.get("emails") or [])[:1]
    raw = dict(biz.raw_data or {})
    raw["contacts_web"] = found
    biz.raw_data = raw
    business_records.refresh_rank(biz)
    await db.flush()
    return {**found, "found": True, "cached": False, "options": {}}
