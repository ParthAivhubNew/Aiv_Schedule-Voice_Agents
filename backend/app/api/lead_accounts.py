"""Leads: the companies a user saved (Saved Accounts, Decision Makers, Account Dossiers).

Accounts come from AI Lead Scout (a live web search), the Copilot, a spreadsheet import or the
user. Only what a search, a research run or the user supplied is stored: nothing is made up.
Each company sees only its own accounts (lead_accounts is a tenant table, see core/tenancy).
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.enrichment import _can_deep_search, _can_research, _charge_deep_search, _charge_leads
from app.database import get_db
from app.models.models import BusinessRecord, LeadAccount
from app.services import company_check, lead_cleaner, next_action, normalise, send_readiness
from app.services import business_lookup, business_records, site_check
from app.services import contact_points as CP
from app.services import reveals as RV
from app.services import social_lookup as SL
from app.services.person_record import is_person_account, is_role_inbox
from app.services.enrichment_service import _host_of, enrich_prospect_intelligence, looks_like_person_name, search_deeper, search_google_places

logger = logging.getLogger("lead_accounts")

router = APIRouter(prefix="/leads", tags=["Leads"])

MAX_PER_REQUEST = 2000
_FIELDS = ("name", "website", "phone", "email", "contact_name", "contact_title", "industry", "region", "notes")
_SOURCES = {"scout", "copilot", "import", "manual", "inbound_form"}


class AccountIn(BaseModel):
    name: str = ""
    website: str = ""
    phone: str = ""
    email: str = ""
    contact_name: str = ""
    contact_title: str = ""
    industry: str = ""
    region: str = ""
    notes: str = ""
    source: str = "manual"
    source_url: str = ""
    business_record_id: str = ""  # set when saved from the company store, so the dossier shows its registry facts
    registration_number: str = ""
    postcode: str = ""
    address: str = ""
    country: str = ""
    linkedin_url: str = ""
    custom: Dict[str, Any] = {}  # extra columns the user kept from an imported file


class AccountsIn(BaseModel):
    accounts: List[AccountIn]
    list_id: str = ""  # put every saved or already-saved company in this list...
    list_name: str = ""  # ...or in the list with this name (made if it doesn't exist yet)
    on_existing: str = "fill"  # a company already saved, when it comes from an import: "fill" its blanks, "skip" it untouched, or "update" it from the file


class AccountPatch(BaseModel):
    name: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    contact_name: Optional[str] = None
    contact_title: Optional[str] = None
    industry: Optional[str] = None
    region: Optional[str] = None
    notes: Optional[str] = None


def _domain(website: str) -> str:
    host = _host_of(website or "")
    return host[4:] if host.startswith("www.") else host


def _clean(value: Any, limit: int = 300) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _phone(value: Any) -> str:
    """A phone with any web-link encoding undone ("%2002033717939" becomes "02033717939")."""
    from app.services.enrichment_service import clean_tel

    return _clean(clean_tel(value), 60)


MAX_CUSTOM_COLUMNS = 30
_RESERVED_COLUMNS = {"name", "website", "phone", "email", "contact", "contact_name", "contact_title", "industry", "region", "notes",
                     "registration_number", "postcode", "address", "country", "linkedin_url"}


def clean_custom(raw: Any) -> Optional[Dict[str, str]]:
    """The extra columns a user kept: plain-text names (up to 40 characters) and values (up to 500),
    at most MAX_CUSTOM_COLUMNS of them. Anything else is dropped."""
    if not isinstance(raw, dict):
        return None
    out: Dict[str, str] = {}
    for key, value in raw.items():
        name = _clean(key, 40)
        if not name or name.lower() in _RESERVED_COLUMNS or name in out or isinstance(value, (dict, list)):
            continue
        out[name] = _clean(value, 500)
        if len(out) >= MAX_CUSTOM_COLUMNS:
            break
    return out or None


def _registry_out(biz: BusinessRecord) -> Dict[str, Any]:
    """The shared, cross-organisation facts about this company (see BusinessRecord) -- registry
    status/category/dates plus officers and who actually controls it, when a live lookup has
    fetched that far. Kept under its own key so it's visually distinct from this organisation's
    own notes/contact info above, which stays private to them."""
    return {
        "registration_number": biz.registration_number or "", "status": biz.status or "",
        "company_category": biz.company_category or "", "incorporation_date": biz.incorporation_date or "",
        "officers": biz.officers or [], "significant_control": biz.significant_control or [],
        "confidence_tier": biz.confidence_tier or "", "source_count": len(biz.sources or []),
    }


QUALITY_FIELDS = ("website", "phone", "email", "contact_name")  # what "complete" means for a company's contact details


def _found(a: LeadAccount) -> Dict[str, Any]:
    """What we added to this company beyond what was saved, and how complete it is now and was before:
    fields a web search or a check filled in, plus the extra people, emails and phones that research
    turned up. A field the user had is never listed as found."""
    r = a.research or {}
    filled: Dict[str, Dict[str, Any]] = {f["field"]: {**f, "how": "web"} for f in (r.get("filled") or []) if f.get("field")}
    for fx in (a.verification or {}).get("fixes") or []:
        if fx.get("kind") == "fill" and fx.get("applied") and fx.get("field") and fx["field"] not in filled:
            filled[fx["field"]] = {"field": fx["field"], "value": fx.get("to", ""), "how": "check"}
    have = lambda f: bool((getattr(a, f, "") or "").strip())
    new = [v for v in filled.values() if have(v["field"])]
    new_fields = {v["field"] for v in new}
    extra = {"people": len(r.get("team") or r.get("people") or []), "emails": len(r.get("emails") or []), "phones": len(r.get("phones") or []),
             "socials": len(r.get("socials") or {}), "offices": len(r.get("other_offices") or [])}
    after = sum(1 for f in QUALITY_FIELDS if have(f))
    before = after - sum(1 for f in QUALITY_FIELDS if f in new_fields)
    pct = lambda n: round(100 * n / len(QUALITY_FIELDS))
    return {"filled": new, "extra": extra, "had": [f for f in QUALITY_FIELDS if have(f) and f not in new_fields],
            "before_pct": pct(before), "after_pct": pct(after), "new_count": len(new) + sum(extra.values())}


# Where a saved company's blank fields can be read from its linked register record, best first. Website, phone and email the
# register holds are masked until this organisation opens them (see reveals), so a masked card gives "" for those; what a paid
# lookup found (web_*) or the business confirmed is already shown to everyone and is used as it is.
RECORD_FILL = {
    "website": ("website", "confirmed_website", "web_website"),
    "phone": ("phone", "confirmed_phone", "web_phone"),
    "email": ("email", "web_email"),
    "industry": ("industry",),
    "region": ("region",),
    "postcode": ("postcode",),
    "address": ("address",),
    "registration_number": ("registration_number",),
}

# What "how complete" means for a saved company: one place, used by the list and the company panel.
COMPLETENESS_FIELDS = (("website", "Website"), ("phone", "Phone"), ("email", "Email"), ("address", "Address"),
                       ("industry", "Industry"), ("people", "People"), ("size", "Size"))


def held_values(card: Dict[str, Any]) -> Dict[str, str]:
    """The values a (masked) register card offers for each RECORD_FILL field. Blank ones are left out."""
    out: Dict[str, str] = {}
    for field, keys in RECORD_FILL.items():
        value = next((str(card.get(k) or "").strip() for k in keys if str(card.get(k) or "").strip()), "")
        if value:
            out[field] = value
    return out


def record_values(biz: Optional[BusinessRecord], seen: Optional[set] = None) -> Dict[str, str]:
    """What the linked register record holds for a saved company, masked for this organisation. With `seen` unknown,
    every register-held contact counts as not opened yet."""
    if not biz:
        return {}
    from app.services import lead_filters

    return held_values(RV.mask_card(lead_filters.card(biz), seen or set()))


def fill_blanks(item: "AccountIn", held: Dict[str, str]) -> List[str]:
    """Fills the blank fields of a company being saved from what its register record holds. What was sent always wins."""
    filled = []
    for field, value in held.items():
        if value and not str(getattr(item, field, "") or "").strip():
            setattr(item, field, value)
            filled.append(field)
    return filled


def completeness(values: Dict[str, Any]) -> Dict[str, Any]:
    """How complete a company's record is: the share of COMPLETENESS_FIELDS that hold something, and which are missing."""
    present = {k: bool(values.get(k)) for k, _ in COMPLETENESS_FIELDS}
    have = [label for k, label in COMPLETENESS_FIELDS if present[k]]
    missing = [label for k, label in COMPLETENESS_FIELDS if not present[k]]
    return {"pct": round(100 * len(have) / len(COMPLETENESS_FIELDS)), "have": have, "missing": missing}


def _completeness_of(a: LeadAccount, shown: Dict[str, str], biz: Optional[BusinessRecord]) -> Dict[str, Any]:
    r = a.research or {}
    people = bool((a.contact_name or "").strip() or (biz is not None and biz.officers) or r.get("team") or r.get("people"))
    size = bool(biz is not None and biz.size_band and biz.size_band != "unknown")
    return completeness({**shown, "phone": shown.get("phone") or r.get("phones"), "email": shown.get("email") or r.get("emails"),
                         "address": shown.get("address") or shown.get("postcode"), "people": people, "size": size})


def _on_file(biz: Optional[BusinessRecord], held: Dict[str, str], own: Dict[str, str]) -> List[str]:
    """Website, phone or email the register holds for this company that is not shown yet because this organisation has not opened it.
    The list says "On file" for these instead of looking empty; opening the company shows the value."""
    if not biz:
        return []
    from app.services import lead_filters

    full = held_values(lead_filters.card(biz))
    return [k for k in ("website", "phone", "email") if full.get(k) and not own.get(k) and not held.get(k)]


def _registry_contact(biz: Optional[BusinessRecord]) -> Optional[Dict[str, str]]:
    """The first current director or officer the register lists: public register facts, shown as the contact until someone is saved."""
    if not biz or not biz.officers:
        return None
    from app.services import company_contacts as CC

    first = next(iter(CC.active_officers(biz.officers)), None)
    if not first:
        return None
    joined = " ".join(x for x in (first.get("first_name"), first.get("last_name")) if x)
    name = normalise.person_name(joined or first.get("name") or "")
    return {"name": name, "role": str(first.get("role") or "")} if name else None


def _out(a: LeadAccount, biz: Optional[BusinessRecord] = None, seen: Optional[set] = None) -> Dict[str, Any]:
    """One saved company as the screens show it. Blank fields are read through the link to its register record (masked for
    this organisation), so what we hold shows from the start and later finds on the record show too. `from_record` names them."""
    from app.api.connected import connection_fields

    held = record_values(biz, seen)
    own = {"website": a.website or "", "phone": _phone(a.phone), "email": a.email or "", "industry": a.industry or "",
           "region": a.region or "", "postcode": a.postcode or "", "address": a.address or "", "registration_number": a.registration_number or ""}
    from_record = [k for k, v in own.items() if not v and held.get(k)]
    on_file = _on_file(biz, held, own)
    shown = {k: (v or (_phone(held[k]) if k == "phone" and held.get(k) else held.get(k, ""))) for k, v in own.items()}
    elig = send_readiness.eligibility(a, biz)
    conn = connection_fields(a)
    reg = _registry_contact(biz)
    step = next_action.decide({
        "status": (biz.status if biz else "") or "", "verdict": (a.verification or {}).get("verdict", ""), "stage": conn["stage"],
        "open_picks": sum(1 for fx in (a.verification or {}).get("fixes") or [] if fx.get("kind") == "pick" and not fx.get("applied")),
        "last_contact_at": conn["last_contact_at"] or conn["last_called_at"], "email_ok": bool(elig["ok"] and elig["email"] and shown["email"]),
        "has_email": bool(shown["email"]), "has_phone": bool(shown["phone"]), "director": (a.contact_name or (reg or {}).get("name") or "")})
    return {"next_step": step, "found": _found(a), "connection": conn,
        "from_record": from_record, "on_file": on_file, "registry_contact": reg, "completeness": _completeness_of(a, shown, biz),
        "id": a.id, "name": a.name, "domain": a.domain or _domain(shown["website"]), "website": shown["website"], "phone": shown["phone"],
        "email": shown["email"], "contact_name": a.contact_name or "", "contact_title": a.contact_title or "",
        "industry": shown["industry"], "region": shown["region"], "notes": a.notes or "", "source": a.source or "manual",
        "source_url": a.source_url or "", "business_record_id": a.business_record_id or "", "research": a.research or None,
        "researched_at": a.researched_at.isoformat() + "Z" if a.researched_at else None,
        "research_history": a.research_history or [],
        "verification": a.verification or None, "custom": a.custom or {},
        "registration_number": shown["registration_number"], "postcode": shown["postcode"], "address": shown["address"],
        "country": a.country or "", "linkedin_url": a.linkedin_url or "", "import_flags": a.import_flags or [],
        "consent_basis": a.consent_basis or "",
        "send_block": {"code": elig["code"], "reason": elig["reason"]} if not elig["ok"] else None,
        "send_warning": None,
        "email_route": {"group": elig["group"], "email": elig["email"], "reason": elig["reason"]} if elig["ok"] else None,
        "retention_flagged": bool(a.retention_flagged_at),
        "created_at": a.created_at.isoformat() + "Z" if a.created_at else None,
        "registry": _registry_out(biz) if biz else None,
        "kind": "person" if is_person_account(a) else "company",
    }


async def _account(db: AsyncSession, account_id: str) -> LeadAccount:
    row = (await db.execute(select(LeadAccount).where(LeadAccount.id == account_id))).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="That account is not in your saved accounts.")
    return row


async def _registry_for(db: AsyncSession, account_id: str) -> Optional[BusinessRecord]:
    row = await _account(db, account_id)
    if not row.business_record_id:
        return None
    return (await db.execute(select(BusinessRecord).where(BusinessRecord.id == row.business_record_id))).scalars().first()


_PAGE_CACHE: Dict[str, Any] = {}  # one page of results for these filters -> (when, answer, ttl). Public company facts only, so it is shared.
_PAGE_TTL = 300.0
_BROWSE_TTL = 1200.0  # the opening list (no filters) changes slowly; it is also made ready at start-up and every 15 minutes (see warm_browse_pages)


def _page_key(filters, sort, limit, offset, drop_terms, default_on=False) -> str:
    import json

    # "main-activity": a trade now matches a company's main activity first (see business_records.matching), so pages kept
    # under the older any-activity rule are never served again.
    return json.dumps(["main-activity-v2", filters, sort, limit, offset, drop_terms, business_records._RANKING[1], default_on], sort_keys=True, default=str)  # default_on: a page opened by default carries a note a typed search does not


async def warm_browse_pages() -> None:
    """Read the opening list (every company, best first) for the usual page sizes into the page cache, so the first person to
    open Find Leads after a restart does not wait for the whole register to be sorted."""
    import time

    from app.database import AsyncSessionLocal
    from app.services import lead_filters

    opening, _ = business_records.with_default_browse({})
    for limit in (25, 50, 100):
        async with AsyncSessionLocal() as db:
            out = await business_records.opening_page(db, opening, limit=limit, offset=0, sort="best")
            cards = [lead_filters.card(r) for r in out["rows"]]
        if not cards:
            continue  # an empty register (before an import) must never be remembered as "no companies"
        answer = {"companies": cards, "total": out["total"], "total_capped": out.get("total_capped", False), "filters": out["filters"],
                  "chips": _browse_chips(lead_filters.describe(out["filters"]), True, out), "points": {}, "next_scan": None, "understood": [],
                  "tiers": None, "saved_total": None, "total_all": None, "ranked": out.get("ranked", True), "timing_ms": out.get("timing_ms"),
                  "query_filters": out["filters"], "relaxed": []}
        _PAGE_CACHE[_page_key(out["filters"], "best", limit, 0, [], True)] = (time.monotonic(), answer, _BROWSE_TTL)


def _browse_chips(chips: List[str], default_on: bool, out: Dict[str, Any]) -> List[str]:
    """What the person is told when the list is not exactly what they asked for: software companies as the starting point, or a sort that fell back."""
    chips = list(chips)
    if default_on:
        chips.append("Every company on the register, trading companies with the fullest records first. Add an industry, town or name to search anything else.")
    if out.get("sort_asked") == "name" and out.get("sort_used") != "name":
        chips.append("A to Z is not ready for the whole register yet, so this is newest first. Add an industry or town to sort by name.")
    return chips


class SearchIn(BaseModel):
    filters: Dict[str, Any] = {}
    limit: int = 25
    offset: int = 0
    exclude_ids: List[str] = []
    area: Optional[List[List[float]]] = None  # a drawn map area: [[lat, lng], ...] corners
    scan: int = 0  # with an area: where this step starts reading the districts it touches (see search_in_area)
    drop_terms: List[str] = []  # words the user removed from "how your words were read" (see phrase_understanding)
    sort: str = "best"  # best (filled-in and well-known first), newest, name
    title: str = ""  # People tab only: a job title word, like "director"
    widen: bool = False  # with an area: the typed words found nothing when counted, so the nearby words are used (see /search/area-count)


def _refuse_bad_filters(filters):
    """Wildcard-only words, negative ages and swapped ages are refused on what was typed, before anything is tidied away."""
    try:
        business_records.check_filters(filters)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))


@router.post("/search")
async def search_companies(body: SearchIn, db: AsyncSession = Depends(get_db)):
    """The Apollo-style filter search over the shared company store (the same one the chat runs).
    Free: it reads our own data and calls no paid service -- credits are only used when contacts
    are looked up. Every row is a stored record with its trust tier; nothing here is generated."""
    from app.services import icp as ICP
    from app.services import lead_filters, phrase_understanding, search_resolve

    _refuse_bad_filters(body.filters)
    fit_ctx = await ICP.context(db)  # this organisation's ICP and the weights, or None: no score is shown without one
    if body.sort == "fit" and not fit_ctx:
        body.sort = "best"
    default_on = False
    if not body.area and not body.exclude_ids:
        body.filters, default_on = business_records.with_default_browse(body.filters)  # nothing asked for: open on software companies
    shown_filters = business_records.normalize_filters(body.filters)  # what the user typed: this is what comes back
    understood: List[Dict[str, Any]] = []
    try:
        if body.area:
            # An area is read in steps, so the decision to use nearby words was made once, when it was counted.
            if body.widen:
                wide, understood = await phrase_understanding.apply(db, body.filters, body.drop_terms)
            else:
                wide = shown_filters
            out = await business_records.search_in_area(db, wide, body.area, scan=body.scan, exclude_ids=body.exclude_ids)
        else:
            import time

            key = _page_key(shown_filters, body.sort, body.limit, body.offset, body.drop_terms, default_on)
            # A "my saved lists" page, or one in this organisation's fit order, depends on the organisation: never shared.
            shareable = not body.exclude_ids and not shown_filters.get("saved") and body.sort != "fit"
            hit = _PAGE_CACHE.get(key) if shareable else None
            if hit and time.monotonic() - hit[0] < hit[2]:
                cached = hit[1]
                mine = await business_records.saved_ids(db, [c["id"] for c in cached["companies"]])
                shown = await ICP.attach_to_cards(db, await RV.mask(db, cached["companies"]), fit_ctx)
                return {**cached, "companies": [{**c, "saved": c["id"] in mine} for c in shown], "icp_set": bool(fit_ctx)}
            def run(f):
                opening = bool(f.get("complete_first"))
                sort = body.sort if body.sort in business_records.SORTS else "best"
                if opening:
                    return business_records.opening_page(db, f, limit=body.limit, offset=body.offset, exclude_ids=body.exclude_ids,
                                                         sort="best" if sort == "fit" else sort)
                return business_records.search_filtered(db, f, limit=body.limit, offset=body.offset, exclude_ids=body.exclude_ids,
                                                        sort=sort, stats=False, fit=fit_ctx)

            out, understood, relaxed_by = await search_resolve.resolve(db, body.filters, body.drop_terms, run, relax=not body.exclude_ids)
            out = {**out, "relaxed": relaxed_by}
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except Exception as err:
        if "statement timeout" in str(err).lower():
            raise HTTPException(status_code=504, detail="That search is too broad to finish. Add a town or a narrower sector and try again.")
        raise
    applied = out["filters"]  # what was really searched (the default sector, nearby words, a corrected town): the figures beside the list use this
    out["filters"] = shown_filters
    chips = _browse_chips(lead_filters.describe(out["filters"]), default_on, out)
    broadened = bool(out.get("broadened"))
    if broadened:  # too few have the trade as their main activity: the side-activity ones are in too, and the person is told
        chips.append(lead_filters.broadened_note(out["filters"]))
    relaxed = out.get("relaxed") or []
    relaxed_note = lead_filters.closest_note(relaxed) if relaxed else ""
    if relaxed_note:
        chips.append(relaxed_note)
    few_sites = lead_filters.website_note(out["filters"], int(out.get("total") or 0))
    if few_sites:
        chips.append(few_sites)
    if body.area:
        await db.commit()  # keeps the postcode points just looked up, so the next search is instant
        chips.append("Inside the area drawn on the map")
    cards = [lead_filters.card(r) for r in out["rows"]]
    mine = await business_records.saved_ids(db, [c["id"] for c in cards])
    shown = await RV.mask(db, cards)  # the page cache below keeps the unmasked cards: it is shared, each organisation is masked on the way out
    shown = await ICP.attach_to_cards(db, shown, fit_ctx)
    answer = {"companies": [{**c, "saved": c["id"] in mine} for c in shown], "total": out["total"], "icp_set": bool(fit_ctx),
              "sort_used": out.get("sort_used", body.sort),
              "total_capped": out.get("total_capped", False), "filters": out["filters"], "chips": chips, "points": out.get("points", {}),
              "next_scan": out.get("next_scan"), "understood": understood,
              "tiers": out.get("tiers"), "saved_total": out.get("saved_total"), "total_all": out.get("total_all"), "ranked": out.get("ranked", True),
              "timing_ms": out.get("timing_ms"), "broadened": broadened or bool(relaxed),
              "broadened_note": relaxed_note or (lead_filters.broadened_note(out["filters"]) if broadened else ""), "relaxed": relaxed, "query_filters": applied}
    from app.services import search_towns

    guess = search_towns.suggest((body.filters or {}).get("towns") or [])
    if guess and not out.get("total"):  # offered only when the typed town found nothing: "Boston" that found companies is not "Bolton"
        answer["did_you_mean"] = guess  # {"Leds": "Leeds"}: the screen offers the right town
    if not body.area and not body.exclude_ids and not shown_filters.get("saved") and not understood and cards:  # an empty answer is never remembered
        import time

        if len(_PAGE_CACHE) > 200:
            _PAGE_CACHE.clear()
        _PAGE_CACHE[key] = (time.monotonic(), {**answer, "companies": cards}, _PAGE_TTL)
    return answer


@router.post("/search/summary")
async def search_summary(body: SearchIn, db: AsyncSession = Depends(get_db)):
    """The slower figures for a search whose page is already on screen: real total, Full/Partial/Basic counts, how many are saved."""
    try:
        filters = body.filters if body.exclude_ids else business_records.with_default_browse(body.filters)[0]  # the same opening list the page showed
        return await business_records.search_summary(db, filters, body.exclude_ids)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except Exception as err:
        if "statement timeout" in str(err).lower():
            return {"total": None, "total_capped": False, "tiers": None, "saved_total": None, "total_all": None}  # unknown, not zero
        raise


SELECT_ALL_CAP = MAX_PER_REQUEST  # "Select all" takes at most this many, so the bulk save that follows fits one request
_SELECT_STEP = 250  # the most one search page reads (see business_records.search_filtered)
_SLIM_FIELDS = ("id", "name", "website", "phone", "email", "industry", "region", "postcode", "address", "registration_number",
                "status", "sic_text", "web_website", "web_phone", "web_email", "confirmed_phone", "confirmed_website")


def select_all_limit(asked: Any) -> int:
    """How many rows one "Select all" may resolve: what was asked, never more than the cap, never less than one."""
    try:
        n = int(asked)
    except (TypeError, ValueError):
        n = SELECT_ALL_CAP
    return max(1, min(n, SELECT_ALL_CAP))


def slim_card(card: Dict[str, Any]) -> Dict[str, Any]:
    """The part of a (masked) company card a bulk action needs: who it is and the contacts this organisation may see."""
    return {k: card.get(k, "") or "" for k in _SLIM_FIELDS}


class SelectAllIn(SearchIn):
    limit: int = SELECT_ALL_CAP


@router.post("/search/ids")
async def search_select_all(body: SelectAllIn, db: AsyncSession = Depends(get_db)):
    """Every company the current search matches, in the order the pages show them, up to SELECT_ALL_CAP: what "Select all" ticks.
    Free: it runs the same search as the pages (same default list, same reading of the words) and calls no paid service.
    Contacts come back masked exactly as on the pages, so a contact not yet opened stays hidden."""
    from app.services import lead_filters, search_resolve

    if body.area:
        raise HTTPException(status_code=422, detail="A drawn area selects the companies already on screen.")
    _refuse_bad_filters(body.filters)
    if not body.exclude_ids:
        body.filters, _ = business_records.with_default_browse(body.filters)
    from app.services import icp as ICP

    want = select_all_limit(body.limit)
    sort = body.sort if body.sort in business_records.SORTS else "best"
    fit_ctx = await ICP.context(db) if sort == "fit" else None  # the same order the pages showed
    rows: List[Any] = []
    seen: set = set()
    total, capped = 0, False
    offset = 0
    try:
        while len(rows) < want:
            step = min(_SELECT_STEP, want - len(rows))

            def run(f, _offset=offset, _step=step):
                if f.get("complete_first"):
                    return business_records.opening_page(db, f, limit=_step, offset=_offset, exclude_ids=body.exclude_ids,
                                                         sort="best" if sort == "fit" else sort)
                return business_records.search_filtered(db, f, limit=_step, offset=_offset, exclude_ids=body.exclude_ids, sort=sort,
                                                        stats=False, fit=fit_ctx)

            out, _, _ = await search_resolve.resolve(db, body.filters, body.drop_terms, run, relax=not body.exclude_ids)
            if not offset:
                total, capped = int(out.get("total") or 0), bool(out.get("total_capped"))
            got = out.get("rows") or []
            for r in got:
                if r.id not in seen:
                    seen.add(r.id)
                    rows.append(r)
            offset += len(got)
            if len(got) < step:
                break
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except Exception as err:
        if "statement timeout" in str(err).lower():
            raise HTTPException(status_code=504, detail="That search is too broad to select in one go. Add a town or a narrower sector and try again.")
        raise
    shown = await RV.mask(db, [lead_filters.card(r) for r in rows[:want]])
    return {"companies": [slim_card(c) for c in shown], "total": max(total, len(shown)), "total_capped": capped, "limit": SELECT_ALL_CAP}


_UK_PC = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$")


@router.get("/geocode-postcode")
async def geocode_postcode(postcode: str = "", db: AsyncSession = Depends(get_db)):
    """The centre point of one UK postcode, for "search around this postcode" on the map. Free."""
    from app.services import geocoding

    code = re.sub(r"\s+", " ", postcode.strip().upper())
    if not _UK_PC.match(code):
        raise HTTPException(status_code=422, detail="Type a full UK postcode, like LS1 4AP.")
    points = await geocoding.geocode(db, [code])
    point = points.get(geocoding.norm_postcode(code))
    await db.commit()
    if not point:
        raise HTTPException(status_code=404, detail="That postcode wasn't found.")
    return {"postcode": code, "lat": point[0], "lng": point[1]}


@router.get("/companies/{company_id}/logo")
async def company_logo(company_id: str, db: AsyncSession = Depends(get_db)):
    """The company's logo from its own website's icon, or 404. Kept on our server so the browser never contacts the company's site."""
    from fastapi.responses import Response

    from app.services import lead_filters, logos

    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="Not found.")
    card = lead_filters.card(biz)
    site = card["website"] or card["web_website"]
    got = await logos.logo_for(site) if site else None
    if not got:
        return Response(status_code=204)  # no logo is an ordinary answer, not an error
    return Response(content=got[0], media_type=got[1], headers={"Cache-Control": "private, max-age=86400"})


@router.post("/people/search")
async def search_people(body: SearchIn, db: AsyncSession = Depends(get_db)):
    """The People tab: people the registry lists at the companies that match the same filters. Free. Names are
    public registry facts; an email or phone is only ever found (and charged) for one named person at a time."""
    from app.services import lead_filters, search_resolve

    try:
        _refuse_bad_filters(body.filters)
        filters, _ = business_records.with_default_browse(body.filters)

        def probe(f):
            return business_records.search_filtered(db, f, limit=1, stats=False)

        # The people of the same companies the Companies tab shows: its nearby words, corrected town and relaxed filters included.
        first, _understood, relaxed = await search_resolve.resolve(db, filters, body.drop_terms, probe)
        out = await business_records.search_people(db, first["filters"], title=body.title, limit=body.limit, offset=body.offset,
                                                   sort=body.sort if body.sort in business_records.SORTS else "best")
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except Exception as err:
        if "statement timeout" in str(err).lower():
            raise HTTPException(status_code=504, detail="That search is too broad to finish. Add a town or a narrower sector and try again.")
        raise
    mine = await business_records.saved_ids(db, [p["company"].id for p in out["people"]])
    masked = {c["id"]: c for c in await RV.mask(db, [lead_filters.card(co) for co in {p["company"].id: p["company"] for p in out["people"]}.values()])}
    people = [{"id": f'{p["company"].id}:{p["name"]}', "name": p["name"], "first_name": p.get("first_name", ""), "last_name": p.get("last_name", ""),
               "role": p["role"], "appointed_on": p["appointed_on"], "company": {**masked[p["company"].id], "saved": p["company"].id in mine}}
              for p in out["people"]]
    broadened = bool(out.get("broadened"))
    chips = lead_filters.describe(out["filters"]) + ([lead_filters.broadened_note(out["filters"])] if broadened else [])
    if relaxed:
        chips.append(lead_filters.closest_note(relaxed))
    return {"relaxed": relaxed, "people": people, "companies_total": out["companies_total"], "total_capped": out["total_capped"],
            "filters": out["filters"], "chips": chips, "fill_ids": out["fill_ids"], "broadened": broadened or bool(relaxed),
            "broadened_note": lead_filters.closest_note(relaxed) if relaxed else (lead_filters.broadened_note(out["filters"]) if broadened else "")}


async def _candidates_as_total(pending) -> Dict[str, Any]:
    out = await pending
    return {**out, "total": out["candidates"]}


@router.post("/search/area-count")
async def area_count(body: SearchIn, db: AsyncSession = Depends(get_db)):
    """How many companies a drawn area could hold, so the user picks how many to see before the
    (slower) step of placing each one on the map. Free."""
    if not body.area:
        raise HTTPException(status_code=422, detail="Draw an area on the map first.")
    _refuse_bad_filters(body.filters)
    from app.services import phrase_understanding

    try:
        out, understood = await phrase_understanding.widen_if_empty(
            db, body.filters, body.drop_terms,
            lambda f: _candidates_as_total(business_records.area_candidates(db, f, body.area)))
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except Exception as err:
        if "statement timeout" in str(err).lower():
            raise HTTPException(status_code=504, detail="That area is too busy to count. Draw a smaller one.")
        raise
    return {"candidates": out["candidates"], "capped": out["capped"], "widened": bool(understood), "understood": understood,
            "broadened": bool(out.get("broadened"))}


@router.get("/districts")
async def town_districts(town: str = "", include_closed: bool = False, db: AsyncSession = Depends(get_db)):
    """The postcode districts of one town with how many companies each holds -- counts only, no companies.
    Free. Feeds the picker next to the Town box on Find Leads."""
    try:
        rows = await business_records.districts_for_town(db, town, include_closed)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except Exception as err:
        if "statement timeout" in str(err).lower():
            raise HTTPException(status_code=504, detail="Too many companies in that town to list its areas. Type a postcode instead.")
        raise
    return {"town": town.strip(), "districts": rows, "total": sum(r["count"] for r in rows)}


class GeocodeIn(BaseModel):
    ids: List[str] = []


@router.post("/geocode")
async def geocode_companies(body: GeocodeIn, db: AsyncSession = Depends(get_db)):
    """Map points for companies already on screen: {id: [lat, lng]} from each one's postcode.
    Free (postcode centres are public and cached); a company with no usable postcode is just left out."""
    from app.services import geocoding

    ids = list(dict.fromkeys(body.ids))[:200]
    if not ids:
        return {"points": {}}
    rows = (await db.execute(select(BusinessRecord.id, BusinessRecord.postcode).where(BusinessRecord.id.in_(ids)))).all()
    coords = await geocoding.geocode(db, [pc for _, pc in rows])
    points = {}
    for rid, pc in rows:
        pt = coords.get(geocoding.norm_postcode(pc))
        if pt:
            points[rid] = [pt[0], pt[1]]
    await db.commit()
    return {"points": points}


class ContactsIn(BaseModel):
    include_web: bool = False  # a live web lookup for website/phone (1 Leads credit when something is found)
    refresh_web: bool = False
    find_site_only: bool = False  # the lookup is only to find the company's website for an email search: not charged on its own


@router.post("/companies/{company_id}/contacts")
async def company_contacts(company_id: str, body: ContactsIn, db: AsyncSession = Depends(get_db)):
    """Contacts on demand for one company from the store. Layers, each labelled by source:
    registry officers (verified, free), what the record already holds (with its trust tier), and --
    only when asked -- a web lookup, shown as web and never mixed into the registry fields.
    Emails for a named officer are found one person at a time with the existing email finder."""
    from app.services import company_contacts as CC, lead_filters

    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    registry_checked = False
    if CC.people_stale(biz):
        registry_checked = await CC.refresh_from_registry(db, biz)
    web: Optional[Dict[str, Any]] = None
    if body.include_web:
        await _can_research(db)
        try:
            web = await CC.web_contacts(db, biz, refresh=body.refresh_web)
        except Exception:
            raise HTTPException(status_code=502, detail="The web lookup didn't finish. Nothing was charged; try again in a minute.")
        if not body.find_site_only and web and not (web.get("cached") or web.get("from_saved")):
            CC.note_lookup(biz, "email", bool(web.get("emails") or biz.email))
    else:
        saved = (biz.raw_data or {}).get("contacts_web") or {}  # an earlier lookup is shown again free: it is already paid for
        if saved.get("guardrail") and (saved.get("website") or saved.get("phones") or saved.get("emails")):
            web = {**{k: v for k, v in saved.items() if k not in ("audit", "ledger")}, "found": True, "cached": True}
    await db.commit()
    if web and web.get("found") and not (web.get("cached") or web.get("from_saved")) and not body.find_site_only:
        await _charge_leads(db, 1, f"Contacts for {biz.name}")
    from app.services import person_emails as PE

    officers = PE.attach(CC.active_officers(biz.officers), await PE.kept_for(db, biz.id))
    return {
        "company": await RV.mask_one(db, lead_filters.card(biz)),
        "officers": officers,
        "controllers": CC.controllers(biz.significant_control),
        "recent_leavers": CC.recent_leavers(biz.officers),
        "officers_note": "" if officers else (
            "The registry lists no current officers for this company." if (biz.officers or registry_checked)
            else "Couldn't reach the public register to read this company's people just now. Try again later."),
        "stored": await _stored(db, biz),
        "web": web,
    }


class FindIn(BaseModel):
    kind: str = "website"  # "website" or "phone": each button looks for its own thing and is charged only when it finds that
    hint: str = ""  # extra words from the person when the first search could not be sure; searched again with them


@router.post("/companies/{company_id}/find-website")
async def find_company_website(company_id: str, body: FindIn = FindIn(), db: AsyncSession = Depends(get_db)):
    """One click from a result row that has no website: look on the open web first (1 Leads credit, only when a website or
    phone is found), and if that finds no website, the deeper search (its own price, only when it finds one). Nothing is
    charged for a miss. What the web finds stays labelled as web; the deeper search fills only empty fields
    and never replaces what the registry holds. Shown to the user as "web" and "deeper search", never by vendor name."""
    from app.services import company_contacts as CC, lead_filters

    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    from app.services import site_check

    if body.kind == "phone":
        return await _find_phone(db, biz, body.hint)
    if body.kind == "email":
        return await _find_email(db, biz, body.hint)
    if lead_filters.card(biz)["website"]:
        return {"found": True, "source": "stored", "charged": 0, "note": "", "company": await RV.mask_one(db, lead_filters.card(biz))}
    await _can_research(db)
    charged, note, source = 0, "", ""
    try:
        web = await CC.web_contacts(db, biz, want="website", hint=body.hint)
    except Exception:
        web = None
        note = "The web lookup didn't finish just now."
    if web and web.get("closed"):
        return {"found": False, "source": "", "charged": 0, "company": await RV.mask_one(db, lead_filters.card(biz)),
                "note": f"This company appears to have closed ({web.get('reason', 'the register says so')}). Nothing was charged."}
    if web and web.get("website") and not web.get("guardrail") and not site_check.plausible_site(biz.name, web["website"]):
        web = {**web, "website": ""}  # a lookup stored before the guardrail may hold a register or directory page
    found_web = bool(web and web.get("found") and web.get("website"))  # a phone that turns up on the way is kept, but only a website is charged here
    if found_web:
        source = "web"
        await db.commit()
        if not (web.get("cached") or web.get("from_saved")):
            await _charge_leads(db, 1, f"Website for {biz.name}", once=f"{biz.id}:website:{body.hint}")
            charged += 1
    if not (lead_filters.card(biz)["website"] or (web or {}).get("website")):
        try:
            await _can_deep_search(db)
            place = await search_deeper(f"{biz.name} {biz.region or ''}".strip(), name=biz.name, postcode=biz.postcode or "", domain=biz.domain or "", want="website")
        except HTTPException:
            place = None
            note = "Nothing found on the web, and there are not enough credits for the deeper search."
        if place and not site_check.same_business(biz.name, place.get("name") or ""):
            logger.info("find-website: deeper search returned a different business for %r: %r", biz.name, place.get("name"))
            place = None
        elif not place:
            logger.info("find-website: nothing for %r on the web (web found %s); deeper search %s", biz.name, bool(web and web.get("found")),
                        "returned nothing or is not switched on")
        from app.services import web_harness

        confirmed = _vouched(place, await web_harness.confirm_place(biz.name, biz.postcode or "", place, biz.registration_number or "") if place else {})
        if place and not confirmed:
            logger.info("find-website: the deeper search named a site for %r but it could not be confirmed on the site itself", biz.name)
        from app.services import listing_pages as _LPG

        booking = _LPG.booking_label(place.get("website") or "") if place else ""
        if booking and place.get("postcode_match") and not confirmed.get("website"):
            # a booking-platform page is the company's listing, never its website: kept labelled, and not charged as a website
            _LPG.keep(biz, {"url": place["website"], "site": booking, "kind": "booking", "confirmed": True, "how": "the deeper search lists it for this company at its postcode",
                            "why": f"The deeper search lists this {booking} page for the company at its postcode", "also_seen": {}, "at": datetime.utcnow().isoformat() + "Z"})
            await db.commit()
        if place and not confirmed.get("website") and not booking:
            await _suggest_place(db, biz, place, "website")
        if confirmed.get("website"):
            try:
                # The place ID is kept as the reference. The website (and phone) are kept because the company's own site shows them.
                await _keep_place(db, biz, place, confirmed)
                await db.commit()
                await _charge_deep_search(db, f"Deeper search: {biz.name}", once=f"{biz.id}:website:{body.hint}")
                charged += 1
                source = "deep"
                await RV.open_one(db, biz.id, "website")  # paid for by the deeper search, so it is shown without another click
            except ValueError:
                pass
    await db.refresh(biz)
    card = lead_filters.card(biz)
    got = bool(card["website"] or card["web_website"])
    if got or not note:  # a lookup that did not finish proves nothing, so only a finished one is remembered
        CC.note_lookup(biz, "website", got)
        await db.commit()
        card = lead_filters.card(biz)
    listing = card.get("listing_page") or {}
    if not got and listing.get("url"):
        shown = "the company's page" if listing.get("confirmed") else "a page that looks like the company's (not confirmed)"
        note = f"No website of its own found. Found {shown} on {listing['site']}. Nothing was charged for it."
    elif not got and not note and not _options(biz, "website", got):
        note = "Nothing confirmed for the website yet. We searched the web, read the company's own pages and ran the deep web search. Add details and search again." + _closest(web)
    await CP.sync_safely(db, biz)  # every website, phone, email and page found is also listed, searchable, on its own
    _PAGE_CACHE.clear()  # the rows that were remembered no longer show this company's details
    return {"found": got, "source": source, "charged": charged, "note": note, "company": await RV.mask_one(db, card),
            "options": _options(biz, "website", got), "listing": listing}


def _closest(web: Optional[Dict[str, Any]]) -> str:
    """Why a lookup found no website, in a sentence: the closest site it saw and what held it back. Empty when the lookup did not run."""
    from app.services import guardrail as G

    if not web:
        return ""
    sites = sorted((a for a in (web.get("audit") or []) if a.get("field") == "website"), key=lambda a: -a.get("score", 0))
    if not sites:
        return " The web search came back with no site that looked like theirs, only directories or other businesses."
    a = sites[0]
    if a.get("rejected"):
        return f" The closest was {a['value']}, left out because {a['rejected']}."
    return f" The closest was {a['value']}, but its match score ({a['score']}) was under the {G.THRESHOLD} needed to be sure it is theirs."


@router.get("/companies/{company_id}/profile")
async def company_profile(company_id: str, db: AsyncSession = Depends(get_db)):
    """Everything we hold about one company, for the company page. Officers are read from the registry the first time (free, saved for next time)."""
    from app.services import company_contacts as CC, company_profile as CP

    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    if CP.is_registry_company(biz) and CC.people_stale(biz):
        try:
            await CC.refresh_from_registry(db, biz)
            await db.commit()
        except Exception as err:  # the page still opens with what is stored
            logger.info("company page: registry people not read for %s: %s", company_id, err)
    return {"company": await CP.build(db, biz)}


@router.get("/companies/{company_id}/news")
async def company_news(company_id: str, db: AsyncSession = Depends(get_db)):
    """Phase 7e: one recent news line, only for companies that fit well (see company_news)."""
    from app.services import company_news as CN, company_profile as CP, fit_score as FS, icp as ICP

    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    ctx = await ICP.context(db)
    fit = FS.fit(biz, ctx[0], FS.signals(biz), FS.contacts_of(biz), ctx[1]) if ctx else None
    out = await CN.news_for(db, biz, (fit or {}).get("score"))
    await db.commit()
    return out


class PersonEmailIn(BaseModel):
    name: str  # the officer's name as the register gives it: the key the found email is kept under
    first_name: str
    last_name: str


@router.post("/companies/{company_id}/person-email")
async def find_person_email(company_id: str, body: PersonEmailIn, db: AsyncSession = Depends(get_db)):
    """The Find email button next to one director. The finder searches with the company's name, plus its website when we know one.
    1 credit only when it finds one. What this organisation found is kept and shown again on load; asking again for the same person is free."""
    from app.core.tenancy import current_org
    from app.services import person_emails as PE
    from app.services.enrichment_waterfall import lookup_person_waterfall

    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    kept = await PE.kept_one(db, biz.id, body.name)
    if kept and kept.email:
        return {"found": True, **PE.shown(kept), "verification_status": kept.status or "", "kept": True, "charged": 0}
    res = await lookup_person_waterfall(db=db, org_id=current_org(), first_name=body.first_name, last_name=body.last_name,
                                        company_name=biz.name, domain=PE.finder_domain(biz))
    if res.get("error") == "insufficient_credits":
        raise HTTPException(status_code=402, detail=res["detail"])
    if res.get("error") in ("bad_input", "not_configured"):
        raise HTTPException(status_code=400 if res["error"] == "bad_input" else 503, detail=res["detail"])
    if not (res.get("found") and res.get("email")):
        return {"found": False, "charged": 0}
    await PE.keep(db, biz.id, body.name, body.first_name, body.last_name, res["email"], res.get("verification_status", ""), res.get("source", ""))
    await db.commit()
    return {"found": True, "email": res["email"], "status": res.get("verification_status", ""), "verification_status": res.get("verification_status", ""),
            "kept": False, "charged": 1}


class JourneyIn(BaseModel):
    journey_id: str


@router.post("/companies/{company_id}/add-to-journey")
async def company_add_to_journey(company_id: str, body: JourneyIn, db: AsyncSession = Depends(get_db)):
    """Saves the company if it is not saved yet and puts it in a journey. The person to write to is the saved contact, else the first director on the register."""
    from app.core.tenancy import current_org
    from app.models.models import EmailCampaign
    from app.services import company_contacts as CC, journeys as J, lead_filters

    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    camp = (await db.execute(select(EmailCampaign).where(EmailCampaign.id == body.journey_id))).scalars().first()
    if not camp:
        raise HTTPException(status_code=404, detail="That journey isn't there any more.")
    lead = (await db.execute(select(LeadAccount).where(LeadAccount.business_record_id == biz.id).limit(1))).scalars().first()
    if not lead:
        card = lead_filters.card(biz)
        await save_accounts(db, AccountsIn(accounts=[AccountIn(name=biz.name, website=card["website"] or card["web_website"], phone=card["phone"] or card["web_phone"], email=card["email"] or card["web_email"],
                                                          industry=card["industry"], region=card["region"], source="scout", business_record_id=biz.id)], list_name="Unsorted"), "")
        lead = (await db.execute(select(LeadAccount).where(LeadAccount.business_record_id == biz.id).limit(1))).scalars().first()
    if not lead:
        raise HTTPException(status_code=400, detail="This company couldn't be saved, so it can't be added.")
    first = (CC.active_officers(biz.officers) or [{}])[0]
    parts = (lead.contact_name or "").split()
    card = lead_filters.card(biz)
    person = {"email": lead.email or card["email"] or card["web_email"] or "", "first_name": parts[0] if parts else first.get("first_name", ""),
              "last_name": " ".join(parts[1:]) if parts else first.get("last_name", ""), "company": biz.name, "lead_id": lead.id}
    out = await J.enrol(db, camp, [person], current_org())
    await db.commit()
    if not out["added"]:
        why = next((k for k, n in out["skipped"].items() if n), "")
        words = {"invalid": "It has no email address yet, so an email journey can't write to it. Find one first.", "duplicate": "It is already in that journey.",
                 "do_not_email": "It is on your do-not-email list.", "in_another_journey": "It is already in another running journey.", "no_contact": "It has no contact details."}
        raise HTTPException(status_code=400, detail=words.get(why, "It couldn't be added."))
    return {"added": out["added"], "journey": camp.name, "status": camp.status}


async def _email_through_google(db: AsyncSession, biz: BusinessRecord, hint: str) -> bool:
    """Last resort for a company email: Google's listing for the company (only one whose name matches), then the address that listing's own
    website publishes. Only an address on that website's own domain is kept, so it is the company's and never a third party's. Charged as a
    deep search, and only when an address is found."""
    from app.services import enrichment_service as ES, guardrail as G, site_check

    try:
        await _can_deep_search(db)
    except HTTPException:
        return False
    place = await search_deeper(f"{biz.name} {biz.region or ''}".strip(), name=biz.name, postcode=biz.postcode or "", domain=biz.domain or "", want="website")
    site = (place or {}).get("website") or ""
    if not site or not site_check.same_business(biz.name, place.get("name") or ""):
        return False
    own = G.registered_domain(site)
    crawled = await ES.crawl_homepage_contacts(site)
    emails = [e for e in crawled.get("emails") or [] if own and G.registered_domain("https://" + e.split("@")[-1]) == own]
    if not emails:
        return False
    raw = dict(biz.raw_data or {})
    web = dict(raw.get("contacts_web") or {})
    web.update({"emails": emails[:1], "source": "web", "guardrail": True, "verified": False, "fetched_at": datetime.utcnow().isoformat() + "Z"})
    raw["contacts_web"] = web
    biz.raw_data = raw
    await db.commit()
    await _charge_deep_search(db, f"Deeper search: {biz.name}", once=f"{biz.id}:email:{hint}")
    await RV.open_one(db, biz.id, "email")
    return True


async def _find_email(db: AsyncSession, biz: BusinessRecord, hint: str = "") -> Dict[str, Any]:
    """The Find email button on a company: the web lookup's email for the company itself (1 credit if it finds one, nothing for a miss)."""
    from app.services import company_contacts as CC, lead_filters

    have = lead_filters.card(biz)
    if have["email"] or have["web_email"]:
        return {"found": True, "source": "stored", "charged": 0, "note": "", "company": await RV.mask_one(db, have)}
    await _can_research(db)
    try:
        web = await CC.web_contacts(db, biz, want="email", hint=hint)
    except Exception:
        return {"found": False, "source": "", "charged": 0, "company": await RV.mask_one(db, have), "note": "The web lookup didn't finish just now. Nothing was charged."}
    if web.get("closed"):
        return {"found": False, "source": "", "charged": 0, "company": await RV.mask_one(db, have),
                "note": f"This company appears to have closed ({web.get('reason', 'the register says so')}). Nothing was charged."}
    got = bool(web.get("emails"))
    source, person = ("web" if got else ""), ""
    charged = 0
    if got and not (web.get("cached") or web.get("from_saved")):
        await db.commit()
        await _charge_leads(db, 1, f"Email for {biz.name}", once=f"{biz.id}:email:{hint}")
        charged = 1
    elif not got:
        # Stage 2: the company published no address, so ask the email finders (cheapest first, two at most) for its directors.
        hit = await _email_from_people(db, biz)
        if hit:
            from app.services import person_emails as PE

            await CC.keep_person_email(db, biz, hit[0], hit[1])
            names = CC.split_officer_name(hit[1])
            await PE.keep(db, biz.id, hit[1], names["first_name"], names["last_name"], hit[0], "verified", "")  # paid for here, so the person's own row shows it too
            got, source, person = True, "people", hit[1]
            await db.commit()
            await _charge_leads(db, 1, f"Email for {biz.name}", once=f"{biz.id}:email:{hint}")
            charged = 1
        else:
            if await _email_through_google(db, biz, hint):  # Stage 3: Google's listing, then the address its own site publishes
                got, source, charged = True, "deep", 1
    CC.note_lookup(biz, "email", got)
    await db.commit()
    await CP.sync_safely(db, biz)
    shown = _options(biz, "email", got)
    return {"found": got, "source": source, "person": person, "charged": charged, "options": shown, "company": await RV.mask_one(db, lead_filters.card(biz)),
            "note": "" if got or shown else "Nothing confirmed for the email yet. We searched the web, read the company's own pages and asked the email finders for its directors. Add details and search again."}


EMAIL_PEOPLE = 2  # directors asked about when the company itself published no address: a miss costs two finder calls each at most


async def _email_from_people(db: AsyncSession, biz: BusinessRecord):
    """(address, person's name) for a current director whose work email a finder verified, else None. Only a verified address is taken:
    a catch-all guess is never shown as theirs. Nothing is charged here; the caller charges once when this finds one."""
    from app.core.tenancy import current_org
    from app.services import company_contacts as CC
    from app.services.enrichment_waterfall import lookup_person_waterfall

    people = [o for o in CC.active_officers(biz.officers) if o.get("first_name") and o.get("last_name")][:EMAIL_PEOPLE]
    domain = (biz.domain or "").strip() or _domain(biz.website or "")
    for o in people:
        try:
            res = await lookup_person_waterfall(db, current_org(), o["first_name"], o["last_name"], biz.name, domain, bill=False)
        except Exception as err:  # one finder failing must not end the search
            logger.info("find-email: the finders did not answer for %r: %s", biz.name, err)
            continue
        if res.get("error") in ("not_configured", "insufficient_credits"):
            return None
        if res.get("found") and res.get("verification_status") == "verified" and res.get("email"):
            return res["email"], o["name"]
    return None


def _vouched(place: Optional[Dict[str, Any]], confirmed: Dict[str, Any]) -> Dict[str, Any]:
    """What the deeper search may keep. Normally only what the company's own site shows. When Google's listing has the same name AND is
    at the postcode our register holds, it is this company, so its website and UK phone are kept as well."""
    from app.services import company_contacts as CC

    out = dict(confirmed or {})
    if place and place.get("postcode_match") and place.get("name_match", True):
        if not out.get("website") and place.get("website") and not site_check.is_listing_host(place["website"]):
            out["website"] = place["website"]  # a booking platform or directory page is a listing, never the company's website
        if not out.get("phone") and place.get("phone") and CC.is_uk_phone(place["phone"]):
            out["phone"] = place["phone"]
    return out


async def _keep_place(db: AsyncSession, biz: BusinessRecord, place: Dict[str, Any], confirmed: Dict[str, Any]) -> None:
    """Save what the company's own site confirmed from a deeper search. It goes on the company the person is looking at: the shared
    record the search is filed under is matched by name and postcode, and a register row without a registration number would
    otherwise get a second, separate record while its own row stayed empty."""
    source_id = f"{place.get('via') or 'google_places'}:{place['place_id']}"
    data = {"name": biz.name, "registration_number": biz.registration_number, "postcode": biz.postcode, "website": confirmed.get("website"),
            "phone": confirmed.get("phone"), "region": biz.region}
    if place.get("raw"):
        data["raw"] = place["raw"]  # everything Apollo returned about the company is kept under its own source, not just the two details used
    shared = await business_records.upsert(db, source_id=source_id, source_type=place.get("via") or "google_places", confidence_tier="scraped", data=data)
    if shared.id != biz.id and place.get("raw"):
        raw = dict(biz.raw_data or {})
        raw[source_id] = place["raw"]
        biz.raw_data = raw
    if shared.id != biz.id:
        if confirmed.get("website") and not (biz.website or "").strip():
            biz.website = _clean(confirmed.get("website"), 300)
            if not biz.domain:
                biz.domain = _domain(biz.website)
        if confirmed.get("phone") and not (biz.phone or "").strip():
            biz.phone = _phone(confirmed.get("phone"))
        biz.updated_at = datetime.utcnow()


async def _find_phone(db: AsyncSession, biz: BusinessRecord, hint: str = "") -> Dict[str, Any]:
    """The Find phone button: look for this company's phone only. A number we already hold is returned free. Otherwise the web lookup
    (1 credit if it finds a UK number), then the deeper search (its own price, only if it finds one). A miss costs nothing."""
    from app.services import company_contacts as CC, lead_filters

    if lead_filters.card(biz)["phone"] or lead_filters.card(biz)["web_phone"]:
        return {"found": True, "source": "stored", "charged": 0, "note": "", "company": await RV.mask_one(db, lead_filters.card(biz))}
    await _can_research(db)
    charged, note, source = 0, "", ""
    try:
        web = await CC.web_contacts(db, biz, want="phone", hint=hint)
    except Exception:
        web = None
        note = "The web lookup didn't finish just now."
    if web and web.get("closed"):
        return {"found": False, "source": "", "charged": 0, "company": await RV.mask_one(db, lead_filters.card(biz)),
                "note": f"This company appears to have closed ({web.get('reason', 'the register says so')}). Nothing was charged."}
    if web and web.get("phones"):
        source = "web"
        await db.commit()
        if not (web.get("cached") or web.get("from_saved")):
            await _charge_leads(db, 1, f"Phone for {biz.name}", once=f"{biz.id}:phone:{hint}")
            charged += 1
    else:
        try:
            await _can_deep_search(db)
            place = await search_deeper(f"{biz.name} {biz.region or ''}".strip(), name=biz.name, postcode=biz.postcode or "", domain=biz.domain or "", want="phone")
        except HTTPException:
            place = None
            note = "Nothing found on the web, and there are not enough credits for the deeper search."
        if place and not site_check.same_business(biz.name, place.get("name") or ""):
            logger.info("find-phone: deeper search returned a different business for %r: %r", biz.name, place.get("name"))
            place = None
        elif not place:
            logger.info("find-phone: nothing for %r on the web (web found %s); deeper search returned nothing or is not switched on",
                        biz.name, bool(web and web.get("found")))
        from app.services import web_harness

        confirmed = _vouched(place, await web_harness.confirm_place(biz.name, biz.postcode or "", place, biz.registration_number or "") if place else {})
        if place and not confirmed.get("phone"):
            logger.info("find-phone: the deeper search matched %r but %s", biz.name,
                        "its listing has no phone" if not place.get("phone") else "the number is not confirmed (no postcode match, and the company's own site does not show it)")
        if place and not confirmed.get("phone"):
            await _suggest_place(db, biz, place, "phone")
        if confirmed.get("phone"):
            try:
                await _keep_place(db, biz, place, confirmed)
                await db.commit()
                await _charge_deep_search(db, f"Deeper search: {biz.name}", once=f"{biz.id}:phone:{hint}")
                charged += 1
                source = "deep"
                await RV.open_one(db, biz.id, "phone")
            except ValueError:
                pass
    await db.refresh(biz)
    card = lead_filters.card(biz)
    got = bool(card["phone"] or card["web_phone"])
    if got or not note:
        CC.note_lookup(biz, "phone", got)
        await db.commit()
        card = lead_filters.card(biz)
    if not got and not note and not _options(biz, "phone", got):
        note = "Nothing confirmed for the phone yet. We searched the web, read the company's own pages and ran the deep web search. Add details and search again."
    await CP.sync_safely(db, biz)
    _PAGE_CACHE.clear()
    return {"found": got, "source": source, "charged": charged, "note": note, "company": await RV.mask_one(db, card),
            "options": _options(biz, "phone", got)}


async def _suggest_place(db: AsyncSession, biz: BusinessRecord, place: Optional[Dict[str, Any]], kind: str) -> None:
    """A Google listing for this company's own postcode that could not be confirmed on its own site: offered as a labelled suggestion with its
    Google Maps page, never filled in. Added to the web lookup's suggestions, not instead of them."""
    from app.services import company_contacts as CC

    if not place or not place.get("postcode_match") or str(place.get("via") or "google_places") != "google_places":
        return
    ref = place.get("place_id") or ""
    maps = f"https://www.google.com/maps/place/?q=place_id:{ref}" if ref else ""
    if kind == "website":
        value = _domain(place.get("website") or "")
        if not value or site_check.is_listing_host(place.get("website") or ""):
            return
        value = "https://" + value
    else:
        value = _phone(place.get("phone") or "") if place.get("phone") else ""
        from app.services.company_contacts import is_uk_phone

        if not value or not is_uk_phone(value):
            return
    label = "Google lists this for the company" if place.get("name_match", True) else f"Google lists \"{place.get('name', 'a business')}\" at the company's address"
    have = list(((biz.raw_data or {}).get("lookup_options") or {}).get(kind) or [])
    if any(o.get("value") == value for o in have):
        return
    await CC._remember_options(db, biz, {kind: [*have, {"value": value, "score": 55, "label": label, "sources": [maps] if maps else []}]})


def _options(biz: BusinessRecord, kind: str, got: bool) -> List[Dict[str, Any]]:
    """The candidates the last lookup could not decide between, for the person to pick from. None once something was found."""
    return [] if got else list(((biz.raw_data or {}).get("lookup_options") or {}).get(kind) or [])


def lead_filters_card(biz: BusinessRecord) -> Dict[str, Any]:
    from app.services import lead_filters

    return lead_filters.card(biz)


async def _stored(db: AsyncSession, biz: BusinessRecord) -> Dict[str, Any]:
    card = await RV.mask_one(db, lead_filters_card(biz))
    return {"website": card["website"], "phone": card["phone"], "email": card["email"], "tier": biz.confidence_tier or "scraped",
            "closed": card["closed"], "held": card["held"]}


class RevealIn(BaseModel):
    kind: str


@router.post("/companies/{company_id}/reveal")
async def reveal_contact(company_id: str, body: RevealIn, db: AsyncSession = Depends(get_db)):
    """Open a website, phone or email our registry holds. Free, once; it stays visible to this organisation after that."""
    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    card = lead_filters_card(biz)
    if body.kind not in RV.KINDS or not card.get(body.kind):
        raise HTTPException(status_code=404, detail="We don't hold that for this company.")
    await RV.open_one(db, biz.id, body.kind)
    return {"company": await RV.mask_one(db, card)}


class RevealManyIn(BaseModel):
    ids: List[str] = []


MAX_REVEAL_MANY = 500


@router.post("/companies/reveal-many")
async def reveal_many(body: RevealManyIn, db: AsyncSession = Depends(get_db)):
    """Open everything our registry holds for these companies, in one go. Free; it never charges credits."""
    ids = list(dict.fromkeys(i for i in body.ids if i))
    if len(ids) > MAX_REVEAL_MANY:
        raise HTTPException(status_code=400, detail=f"Open up to {MAX_REVEAL_MANY} companies at a time.")
    rows = (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(ids)))).scalars().all() if ids else []
    before = await RV.opened(db, ids)
    seen = await RV.open_many(db, rows, before)
    return {"companies": await RV.mask(db, [lead_filters_card(b) for b in rows]), "opened": len(seen - before)}


class ChooseIn(BaseModel):
    kind: str  # website | phone | email | linkedin
    value: str
    person: str = ""  # linkedin only: the person's name, empty for the company's page


@router.post("/companies/{company_id}/choose")
async def choose_contact(company_id: str, body: ChooseIn, db: AsyncSession = Depends(get_db)):
    """The person checked the suggestions and confirmed the correct one. It is kept as the answer and counted: more confirmations raise its score,
    until the next lookup uses it without asking. A website, phone, email, LinkedIn or social pick is charged here, once: showing suggestions is free, so a
    search that ends with nothing chosen costs nothing."""
    from app.services import company_contacts as CC, contact_choices as CH, linkedin_lookup as LI

    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    value = (body.value or "").strip()
    charged = 0
    if body.kind == "linkedin":
        if not LI.allowed(biz, body.person, value):
            raise HTTPException(status_code=422, detail="That isn't one of the options that were shown. Look again.")
        LI.chosen(biz, body.person, value)
        kind_key = LI.entry_key(body.person)
        await db.commit()
        await _charge_leads(db, 1, f"LinkedIn for {biz.name}", "lead_social")
        charged = 1
    elif body.kind in SL.NETWORKS:
        if not SL.allowed(biz, body.kind, value):
            raise HTTPException(status_code=422, detail="That isn't one of the options that were shown. Look again.")
        SL.chosen(biz, body.kind, value)
        kind_key = body.kind
        await db.commit()
        await _charge_leads(db, 1, f"{body.kind.title()} for {biz.name}", "lead_social")
        charged = 1
    elif body.kind in RV.KINDS:
        shown = ((biz.raw_data or {}).get("lookup_options") or {}).get(body.kind) or []
        if value not in [o.get("value") for o in shown]:
            raise HTTPException(status_code=422, detail="That isn't one of the options that were shown. Look again.")
        raw = dict(biz.raw_data or {})
        cw = dict(raw.get("contacts_web") or {})
        cw.update({"guardrail": True, "source": "web", "verified": False, "by": "pick", "fetched_at": datetime.utcnow().isoformat() + "Z"})
        cw.setdefault("website", "")
        cw.setdefault("phones", [])
        cw.setdefault("emails", [])
        if body.kind == "website":
            cw["website"] = value
        elif body.kind == "phone":
            cw["phones"] = [value]
        else:
            cw["emails"] = [value]
        raw["contacts_web"] = cw
        raw["lookup_options"] = {**(raw.get("lookup_options") or {}), body.kind: []}
        biz.raw_data = raw
        business_records.refresh_rank(biz)
        CC.note_lookup(biz, body.kind, True)
        kind_key = body.kind
        await db.commit()
        await _charge_leads(db, 1, f"{body.kind.title()} for {biz.name}")
        charged = 1
    else:
        raise HTTPException(status_code=422, detail="Pick a website, phone, email or LinkedIn page.")
    await db.commit()
    picked_by = await CH.record(db, biz.id, kind_key, value)
    await CP.sync_safely(db, biz)
    _PAGE_CACHE.clear()
    return {"found": True, "charged": charged, "picked_by": picked_by, "company": await RV.mask_one(db, lead_filters_card(biz))}


@router.get("/companies/{company_id}/contact-points")
async def company_contact_points(company_id: str, db: AsyncSession = Depends(get_db)):
    """Every website, phone, email and social page any source gave us for this company, with which source and how sure. A phone, email or
    website the register holds stays hidden until it is opened (free, once), the same as in the company row. `shared_with` lists other
    company records holding the same page, phone or email: usually the same company saved twice."""
    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    points = await CP.for_company(db, company_id)
    if not points:  # a company nobody has looked at since the list was introduced: fill it from what the record already holds
        await CP.sync_safely(db, biz)
        points = await CP.for_company(db, company_id)
    seen = await RV.opened(db, [company_id])
    out: List[Dict[str, Any]] = []
    hidden = 0
    for p in points:
        if p["kind"] in RV.KINDS and p["source"] in ("record", "register") and (company_id, p["kind"]) not in seen:
            hidden += 1
            out.append({**p, "value": "", "hidden": True})
        else:
            out.append(p)
    shared = [{**x, "value": x["value"] if x["kind"] in CP.PAGE_KINDS else ""} for x in await CP.shared_with(db, company_id)]
    return {"points": out, "hidden": hidden, "shared_with": shared}


class LinkedinIn(BaseModel):
    first_name: str = ""
    last_name: str = ""  # both empty: the company's own page
    hint: str = ""


@router.post("/companies/{company_id}/find-linkedin")
async def find_linkedin(company_id: str, body: LinkedinIn = LinkedinIn(), db: AsyncSession = Depends(get_db)):
    """Look for the company's (or one person's) public LinkedIn page through a web search limited to linkedin.com. 1 Leads credit only when a page
    is found; a page already found is shown again free. When no result is clearly right, `options` holds the best few to pick from."""
    from app.services import linkedin_lookup as LI

    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    person = {"first_name": body.first_name.strip(), "last_name": body.last_name.strip()} if (body.first_name or body.last_name) else None
    if person and not (person["first_name"] and person["last_name"]):
        raise HTTPException(status_code=422, detail="Both a first and a last name are needed to look for a person.")
    await _can_research(db)
    r = await LI.find(db, biz, person, hint=body.hint)
    await db.commit()
    charged = 0
    if r["url"] and r.get("searched"):  # suggestions alone are free: a pick is charged when it is made (choose_contact)
        await _charge_leads(db, 1, f"LinkedIn for {biz.name}", "lead_social")
        charged = 1
    note = "" if r["url"] or r["options"] else ("The search didn't finish just now. Nothing was charged." if r.get("failed") else "Nothing confirmed for LinkedIn yet. Add details and search again.")
    await CP.sync_safely(db, biz)
    _PAGE_CACHE.clear()  # the rows remembered for searches carry the links
    return {"found": bool(r["url"]), "url": r["url"], "options": r["options"], "charged": charged, "note": note}


class SocialIn(BaseModel):
    network: str = "linkedin"  # linkedin | facebook | x: each icon in the Links column looks for its own page
    hint: str = ""


async def _social_through_google(db: AsyncSession, biz: BusinessRecord, body: "SocialIn", r: Dict[str, Any]):
    """Last resort when the web search found no page: Google's listing for this company (only one whose name and place match), then the
    website that listing names is read for the company's own links. Charged as a deep search, and only when it finds the page.
    Returns (the lookup result, credits charged)."""
    from app.services import linkedin_lookup as LI
    from app.services import site_check

    try:
        await _can_deep_search(db)
    except HTTPException:
        return r, 0  # not switched on, or not enough credits: the person is told nothing was confirmed
    place = await search_deeper(f"{biz.name} {biz.region or ''}".strip(), name=biz.name, postcode=biz.postcode or "", domain=biz.domain or "", want="website")
    site = (place or {}).get("website") or ""
    if not site or not site_check.same_business(biz.name, place.get("name") or ""):
        return r, 0
    links = await SL.read_own_site(biz, site=site, force=True)
    if not links.get(body.network):
        return r, 0
    again = await (LI.find(db, biz) if body.network == "linkedin" else SL.find(db, biz, body.network))
    if not again["url"]:
        return r, 0
    await db.commit()
    await _charge_deep_search(db, f"Deeper search: {biz.name}", once=f"{biz.id}:{body.network}")
    return {**again, "searched": False}, 1


@router.post("/companies/{company_id}/find-social")
async def find_social(company_id: str, body: SocialIn, db: AsyncSession = Depends(get_db)):
    """Look for one public page of the company: LinkedIn, Facebook or X. Only that network is searched. 1 Leads credit when a page or close matches
    are found; a page already found is shown again free. Close matches (`options`) are for the person to choose from."""
    from app.services import linkedin_lookup as LI

    if body.network not in ("linkedin", *SL.NETWORKS):
        raise HTTPException(status_code=422, detail="Choose LinkedIn, Facebook or X.")
    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    await _can_research(db)
    if not body.hint:  # the company's own website links to its pages: read that first (free); the web search is for what it does not link to
        await SL.read_own_site(biz)
    r = await (LI.find(db, biz, hint=body.hint) if body.network == "linkedin" else SL.find(db, biz, body.network, hint=body.hint))
    charged = 0
    if not (r["url"] or r["options"] or r.get("failed")):
        r, charged = await _social_through_google(db, biz, body, r)  # the web search found nothing: Google's listing for the company, then the site it names
    await db.commit()
    if r["url"] and r.get("searched"):  # suggestions alone are free: a pick is charged when it is made (choose_contact)
        await _charge_leads(db, 1, f"{body.network.title()} for {biz.name}", "lead_social")
        charged = 1
    label = "a LinkedIn page" if body.network == "linkedin" else f"{'an' if SL.NETWORKS[body.network]['label'][0] in 'AEIOUX' else 'a'} {SL.NETWORKS[body.network]['label']}"
    note = "" if r["url"] or r["options"] else ("The search didn't finish just now. Try again later." if r.get("failed") else f"Nothing confirmed for {label} yet. Add details and search again.")
    await CP.sync_safely(db, biz)
    _PAGE_CACHE.clear()
    return {"found": bool(r["url"]), "url": r["url"], "options": r["options"], "charged": charged, "note": note, "company": await RV.mask_one(db, lead_filters_card(biz))}


@router.get("/accounts")
async def list_accounts(retention: bool = False, db: AsyncSession = Depends(get_db)):
    q = select(LeadAccount).order_by(LeadAccount.created_at.desc())
    if retention:  # only the companies the 12-month retention sweep flagged
        q = q.where(LeadAccount.retention_flagged_at.isnot(None))
    rows = (await db.execute(q)).scalars().all()
    biz_ids = [r.business_record_id for r in rows if r.business_record_id]
    registry_by_id: Dict[str, BusinessRecord] = {}
    if biz_ids:
        biz_rows = (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(biz_ids)))).scalars().all()
        registry_by_id = {b.id: b for b in biz_rows}
    seen = await RV.opened(db, registry_by_id.keys())
    seen = await RV.open_for_saved(db, registry_by_id.values(), seen)  # saved to a list: what the register holds is shown, not hidden
    from app.services import icp as ICP

    fit_ctx = await ICP.context(db)
    scored = await ICP.score_accounts(db, rows, registry_by_id, fit_ctx)
    return {"accounts": [{**_out(a, registry_by_id.get(a.business_record_id), seen), **scored[a.id]} for a in rows], "icp_set": bool(fit_ctx)}


async def _outs(db: AsyncSession, rows: List[LeadAccount]) -> List[Dict[str, Any]]:
    """Several saved companies as the screens show them, each read through its register record."""
    ids = {r.business_record_id for r in rows if r.business_record_id}
    biz = {b.id: b for b in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(ids)))).scalars().all()} if ids else {}
    seen = await RV.opened(db, biz.keys())
    seen = await RV.open_for_saved(db, biz.values(), seen)
    return [_out(r, biz.get(r.business_record_id), seen) for r in rows]


@router.get("/accounts/{account_id}/registry")
async def account_registry(account_id: str, db: AsyncSession = Depends(get_db)):
    """Just the shared registry facts for one account -- for refreshing that section after a
    Research call without re-fetching the whole list."""
    biz = await _registry_for(db, account_id)
    return {"registry": _registry_out(biz) if biz else None}


def _place(region: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (region or "").lower()).strip()


def phone_key(value: Any) -> str:
    """A phone number as digits only, in one form, so "0113 496 0101" and "+44 113 496 0101" are the same number. "" when it is too short to mean anything."""
    d = re.sub(r"\D", "", str(value or ""))
    if d.startswith("0044"):
        d = d[4:]
    elif d.startswith("44") and len(d) >= 11:
        d = d[2:]
    d = d.lstrip("0")
    return d if len(d) >= 9 else ""


def _card(name: str, website: str, phone: str, email: str, contact: str, place: str) -> Dict[str, str]:
    return {"name": name or "", "website": website or "", "phone": phone or "", "email": email or "", "contact": contact or "", "place": place or ""}


def _duplicate_pairs(dups: List[tuple], added: List[LeadAccount], limit: int = 300) -> List[Dict[str, Any]]:
    """What was not added because it is already saved: for each, the row that was sent and the saved company it matched, so the person
    can see both. Only the first `limit` are listed (the count of all of them is `duplicates_total`)."""
    return [{"duplicate": _card(it.name, it.website, it.phone, it.email, it.contact_name, it.region), "why": how, "original_id": hit}
            for it, hit, how in dups[:limit]]


@router.post("/accounts/check")
async def check_accounts(body: AccountsIn):
    """Checks imported rows without saving anything: which are clean, which carry warnings, which would be quarantined, and why."""
    if len(body.accounts) > MAX_PER_REQUEST:
        raise HTTPException(status_code=400, detail=f"Check at most {MAX_PER_REQUEST} rows at a time.")
    rows = []
    for i, item in enumerate(body.accounts):
        v = lead_cleaner.check_row(item.model_dump())
        rows.append({"row": i, "name": _clean(item.name), "status": "quarantined" if v["hard"] else "warnings" if v["warn"] else "clean",
                     "hard": v["hard"], "warn": v["warn"], "reasons": lead_cleaner.explain(v["hard"] + v["warn"])})
    return {"clean": sum(r["status"] == "clean" for r in rows), "warnings": sum(r["status"] == "warnings" for r in rows),
            "quarantined": sum(r["status"] == "quarantined" for r in rows), "rows": rows}


async def _register_match(db: AsyncSession, name: str, regno: str, postcode: str, flags: List[Dict[str, str]]) -> Optional[BusinessRecord]:
    """The register record an imported company really is, or None. A company number decides: it is used
    only when the register's name for that number agrees with the file's name (otherwise the row is flagged
    and left unlinked). With no number, the same name at the same postcode is accepted."""
    if regno:
        biz = await business_records.find(db, registration_number=regno)
        if biz:
            if company_check.name_score(name, biz.name) >= 0.9:
                return biz
            flags.append({"code": "REGNO_NAME_MISMATCH", "text": f"Company number {regno} belongs to {biz.name}, not {name}."})
        return None
    if postcode and not normalise.is_outward_only(postcode):
        rows = (await db.execute(select(BusinessRecord).where(BusinessRecord.postcode == postcode).limit(60))).scalars().all()
        close = [b for b in rows if company_check.name_score(name, b.name) >= 0.97]
        if len(close) == 1:
            return close[0]
    return None


@router.post("/accounts")
async def add_accounts_route(body: AccountsIn, request: Request, db: AsyncSession = Depends(get_db)):
    from app.core.auth_middleware import current

    who = current(request)
    return await save_accounts(db, body, who.get("name") or who.get("username") or "")


async def save_accounts(db: AsyncSession, body: AccountsIn, owner: str) -> Dict[str, Any]:
    """Save one or many accounts. A company already saved (same website, or same name when there
    is no website) is skipped, so saving a search twice or re-importing a file adds no copies. When the
    match comes from an import, what the file holds fills the saved company's blanks and its file columns,
    and a company that was only found by a search is now marked as imported, because it is in the user's file."""
    if len(body.accounts) > MAX_PER_REQUEST:
        raise HTTPException(status_code=400, detail=f"Save at most {MAX_PER_REQUEST} accounts at a time.")
    existing = (await db.execute(select(LeadAccount.id, LeadAccount.domain, LeadAccount.name, LeadAccount.region, LeadAccount.business_record_id, LeadAccount.contact_name,
                                        LeadAccount.email, LeadAccount.phone))).all()
    # Each identity maps to every saved record that has it: one company can hold several people (a call list of contacts at the
    # same firm), and a name that is already saved for someone else is a different record, not a copy.
    contact_of: Dict[str, str] = {row[0]: (row[5] or "").strip().lower() for row in existing}
    name_of: Dict[str, str] = {row[0]: (row[2] or "").strip().lower() for row in existing}
    domain_of: Dict[str, str] = {row[0]: row[1] or "" for row in existing}
    by_email: Dict[str, List[str]] = {}  # the same address is the same contact
    by_phone: Dict[str, List[str]] = {}  # a number alone is not enough (a switchboard is shared): it needs the same company name too
    by_domain: Dict[Any, List[str]] = {}
    by_biz: Dict[Any, List[str]] = {}  # the registry record is the most exact identity a company has
    by_name: Dict[Any, List[str]] = {}
    no_site: Dict[Any, List[str]] = {}  # saved without a website
    for i, d, n, r, b, _c, em, ph in existing:
        if (em or "").strip():
            by_email.setdefault(em.strip().lower(), []).append(i)
        if phone_key(ph):
            by_phone.setdefault(phone_key(ph), []).append(i)
        k = ((n or "").strip().lower(), _place(r))
        if d:
            by_domain.setdefault(d, []).append(i)
        else:
            no_site.setdefault(k, []).append(i)
        if b:
            by_biz.setdefault(b, []).append(i)
        by_name.setdefault(k, []).append(i)

    def find(ids: Optional[List[str]], person: str) -> Optional[str]:
        """The saved record for this company and this person: one with no named contact yet, or the same contact."""
        for i in ids or []:
            if not person or not contact_of.get(i) or contact_of[i] == person:
                return i
        return None

    added: List[LeadAccount] = []
    matched: List[str] = []  # companies that were already saved: not copied, but still go in the list
    from_file: List[tuple] = []  # (saved company id, the imported row) to fill from the file
    skipped = 0
    unnamed = 0  # rows with no name or website: nothing to save
    repeats = 0  # the same company twice in what was sent (e.g. a file listing it on two rows)
    dups: List[tuple] = []  # (the row that was not added, the saved company it matched, why): shown to the person afterwards
    fresh: set = set()
    claimed = {i.business_record_id for i in body.accounts if i.business_record_id}
    claimed_rows = (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(claimed)))).scalars().all() if claimed else []
    known_biz = {b.id for b in claimed_rows}
    # A company taken from the register starts with what the record holds (contacts masked as on the search pages), not a blank form.
    claimed_seen = await RV.open_for_saved(db, claimed_rows, await RV.opened(db, known_biz))  # saving it opens what the register holds, free
    held_by_biz = {b.id: record_values(b, claimed_seen) for b in claimed_rows}
    quarantined: List[Dict[str, Any]] = []  # imported rows that failed a hard check: not saved, listed with the reason
    warned = 0
    # Company numbers already in use, so a second company with the same number is flagged, not silently saved.
    seen_regno: Dict[str, str] = {
        r[0]: r[1] for r in (await db.execute(select(LeadAccount.registration_number, LeadAccount.name).where(LeadAccount.registration_number != ""))).all() if r[0]}
    for item in body.accounts:
        if item.business_record_id in held_by_biz:
            fill_blanks(item, held_by_biz[item.business_record_id])
            if not _clean(item.name):
                item.name = next((b.name for b in claimed_rows if b.id == item.business_record_id), "") or ""
        website = _clean(item.website)
        domain = _domain(website)
        name = _clean(item.name) or domain
        if not name:
            skipped += 1
            if item.source == "import":
                quarantined.append({"name": "", "email": _clean(item.email, 200), "phone": _clean(item.phone, 60), "website": website,
                                    "codes": ["NAME_MISSING"], "reasons": lead_cleaner.explain(["NAME_MISSING"])})
            else:
                unnamed += 1
            continue
        flags: List[Dict[str, str]] = []
        if item.source == "import":
            verdict = lead_cleaner.check_row(item.model_dump())
            if verdict["hard"]:
                skipped += 1
                quarantined.append({"name": name, "email": _clean(item.email, 200), "phone": _clean(item.phone, 60), "website": website,
                                    "codes": verdict["hard"], "reasons": lead_cleaner.explain(verdict["hard"])})
                continue
            warned += bool(verdict["warn"])
            flags = [{"code": c, "text": t} for c, t in zip(verdict["warn"], lead_cleaner.explain(verdict["warn"]))]
        regno = normalise.company_number(item.registration_number)
        postcode = normalise.postcode(item.postcode)
        if not item.business_record_id and item.source == "import":
            biz = await _register_match(db, name, regno, postcode, flags)
            if biz:
                item.business_record_id = biz.id
                known_biz.add(biz.id)
        if regno:
            other = seen_regno.get(regno)
            if other is not None and company_check.name_key(other) != company_check.name_key(name):
                flags.append({"code": "REGNO_DUPLICATE", "text": f"Company number {regno} is also used by {other}."})
            seen_regno.setdefault(regno, name)
        key = (name.lower(), _place(item.region))
        person = _clean(item.contact_name, 120).lower()
        hit = (find(by_biz.get(item.business_record_id), person) if item.business_record_id else None)
        how = "Same company on the register" if hit else ""
        if not hit:
            hit = find(by_domain.get(domain) if domain else by_name.get(key), person)
            how = "Same website" if hit and domain else "Same name and place" if hit else ""
        if not hit and domain:
            hit = find(no_site.get(key), person)  # the same firm saved earlier without a website, now arriving with one
            how = "Same company, saved earlier without a website" if hit else ""
        email = _clean(item.email, 200).lower()
        if not hit and email:
            # An address that belongs to one person is the same contact wherever it turns up. A shared inbox (info@, sales@) only counts
            # for the same company, because two different firms can both have one.
            for cand in by_email.get(email, []):
                if find([cand], person) and (not is_role_inbox(email) or name_of.get(cand) == name.lower() or (domain and domain_of.get(cand) == domain)):
                    hit, how = cand, "Same email address"
                    break
        if not hit and phone_key(item.phone):
            for cand in by_phone.get(phone_key(item.phone), []):
                if find([cand], person) and name_of.get(cand) == name.lower():
                    hit, how = cand, "Same phone number and company name"
                    break
        if hit:
            dups.append((item, hit, how))
            skipped += 1
            if hit in fresh or hit in matched:
                repeats += 1
            else:
                matched.append(hit)
                if item.source == "import" and body.on_existing != "skip":
                    from_file.append((hit, item))
            continue
        row = LeadAccount(
            id=f"acc_{uuid.uuid4().hex[:16]}", name=name, domain=domain,
            website=website if "://" in website or not website else f"https://{website}",
            phone=normalise.phone_display(_clean(item.phone, 60)), email=_clean(item.email, 200).lower(),
            contact_name=normalise.person_name(_clean(item.contact_name, 120)),
            contact_title=_clean(item.contact_title, 120), industry=_clean(item.industry, 120), region=_clean(item.region, 120),
            notes=_clean(item.notes, 2000), source=item.source if item.source in _SOURCES else "manual",
            source_url=_clean(item.source_url, 500), custom=clean_custom(item.custom),
            registration_number=regno, postcode=postcode, address=_clean(item.address, 300), country=_clean(item.country, 60),
            linkedin_url=_clean(item.linkedin_url, 300), import_flags=flags or None,
            business_record_id=item.business_record_id if item.business_record_id in known_biz else None,
        )
        db.add(row)
        added.append(row)
        fresh.add(row.id)
        contact_of[row.id] = person
        name_of[row.id] = name.lower()
        domain_of[row.id] = domain
        if row.email:
            by_email.setdefault(row.email, []).append(row.id)
        if phone_key(row.phone):
            by_phone.setdefault(phone_key(row.phone), []).append(row.id)
        if domain:
            by_domain.setdefault(domain, []).append(row.id)
        else:
            no_site.setdefault(key, []).append(row.id)
        if row.business_record_id:
            by_biz.setdefault(row.business_record_id, []).append(row.id)
        by_name.setdefault(key, []).append(row.id)
    updated: List[LeadAccount] = []
    for hit_id, item in from_file:
        row = await db.get(LeadAccount, hit_id)
        if not row:
            continue
        overwrite = body.on_existing == "update"  # the file wins over what is saved; otherwise only blanks are filled
        for field, limit in (("phone", 60), ("email", 200), ("contact_name", 120), ("contact_title", 120), ("industry", 120), ("region", 120)):
            value = _clean(getattr(item, field), limit)
            if value and (overwrite or not (getattr(row, field) or "").strip()):
                setattr(row, field, value.lower() if field == "email" else value)
        site = _clean(item.website)
        if site and (overwrite or not (row.website or "").strip()):
            row.domain = _domain(site)
            row.website = site if "://" in site else f"https://{site}"
        row.custom = ({**(row.custom or {}), **(clean_custom(item.custom) or {})} if overwrite else {**(clean_custom(item.custom) or {}), **(row.custom or {})}) or None
        if row.source == "scout":
            row.source = "import"
        row.updated_at = datetime.utcnow()
        updated.append(row)
    from app.services import eligibility as _EL

    await _EL.classify(db, added + updated)  # free: our own register copy only, so every saved company has its email group at once
    await db.commit()
    from app.core.tenancy import current_org
    from app.services import connections as _C

    for a in added[:200]:  # workflows hear about each company saved (the first 200 of a big import)
        _C.emit(current_org(), "lead.created", {"id": a.id, "lead_id": a.id}, a.id)
    out: Dict[str, Any] = {"added": len(added), "skipped": skipped, "matched": len(matched), "unnamed": unnamed, "repeats": repeats, "quarantined": quarantined, "warned": warned, "accounts": await _outs(db, added),
                           "updated": await _outs(db, updated), "duplicates": _duplicate_pairs(dups, added), "duplicates_total": len(dups)}
    # The saved company each duplicate matched, so both are shown side by side.
    want = {d["original_id"] for d in out["duplicates"]}
    if want:
        mine = {a.id: a for a in added}
        saved = {r.id: r for r in (await db.execute(select(LeadAccount).where(LeadAccount.id.in_([i for i in want if i not in mine])))).scalars().all()}
        for d in out["duplicates"]:
            r = mine.get(d["original_id"]) or saved.get(d["original_id"])
            d["original"] = _card(r.name, r.website, r.phone, r.email, r.contact_name, r.region) if r else None
    if body.list_id or body.list_name.strip():
        from app.api.lead_lists import put_in_list

        out["list"] = await put_in_list(db, body.list_id, body.list_name, [a.id for a in added] + matched, owner=owner)
    return out


@router.patch("/accounts/{account_id}")
async def update_account(account_id: str, body: AccountPatch, db: AsyncSession = Depends(get_db)):
    row = await _account(db, account_id)
    changes = body.model_dump(exclude_none=True)
    if "name" in changes and not _clean(changes["name"]):
        raise HTTPException(status_code=400, detail="A saved account needs a company name.")
    # An edit may not turn this company into a copy of another one that is already saved.
    new_domain = _domain(_clean(changes["website"])) if "website" in changes else None
    if new_domain and new_domain != row.domain:
        other = (await db.execute(select(LeadAccount.name).where(LeadAccount.domain == new_domain, LeadAccount.id != row.id))).scalars().first()
        if other:
            raise HTTPException(status_code=409, detail=f"That website is already saved for {other}.")
    if "name" in changes and not new_domain and not row.domain:
        rows = (await db.execute(select(LeadAccount.id, LeadAccount.name, LeadAccount.region).where(LeadAccount.id != row.id, or_(LeadAccount.domain == "", LeadAccount.domain.is_(None))))).all()
        mine = (_clean(changes["name"]).lower(), _place(changes.get("region", row.region)))
        if any((n or "").strip().lower() == mine[0] and _place(r) == mine[1] for _, n, r in rows):
            raise HTTPException(status_code=409, detail=f"{_clean(changes['name'])} in this place is already saved.")
    for field in _FIELDS:
        if field in changes:
            setattr(row, field, _clean(changes[field], 2000 if field == "notes" else 300))
    if "website" in changes:
        row.domain = _domain(row.website)
    row.updated_at = datetime.utcnow()
    await db.commit()
    return (await _outs(db, [row]))[0]


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db)):
    from app.services import company_check_job

    row = await _account(db, account_id)
    if account_id in await company_check_job.locked_ids():
        raise HTTPException(status_code=409, detail="This company is being checked right now. You can edit it, but delete it when the check has finished.")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


@router.post("/accounts/{account_id}/register")
async def register_page_for(account_id: str, db: AsyncSession = Depends(get_db)):
    """The register record behind a saved company, found free from our own store when it was not linked yet (by its company number,
    its website, or its exact name). {business_record_id: ""} when there is none: the company then has its own page."""
    row = await _account(db, account_id)
    if not row.business_record_id:
        biz = None
        regno = normalise.company_number(row.registration_number)
        if regno:
            biz = await business_records.find(db, registration_number=regno)
            if biz and company_check.name_score(row.name, biz.name) < 0.9:
                biz = None  # that number belongs to another company: never linked
        if biz is None:
            biz = await _apply_shared_record(db, row)
        elif not row.business_record_id:
            row.business_record_id = biz.id
        if row.business_record_id:
            await db.commit()
    return {"business_record_id": row.business_record_id or ""}


class BulkDelete(BaseModel):
    ids: List[str]
    do_not_contact: bool = False  # erase and never contact again (an erasure request)


@router.post("/accounts/bulk-delete")
async def bulk_delete_accounts(body: BulkDelete, db: AsyncSession = Depends(get_db)):
    """Delete many saved companies at once (up to 2,000): they leave their lists and any journey they are in. A company being
    checked right now is left alone and reported. With do_not_contact, their email and phone go on the do-not-contact list first."""
    from app.services import company_check_job, connections as C, journeys as J

    ids = list(dict.fromkeys(i for i in body.ids if i))[:2000]
    if not ids:
        raise HTTPException(status_code=400, detail="Choose at least one company to delete.")
    locked = await company_check_job.locked_ids()
    rows = (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(ids)))).scalars().all()
    deleted, skipped_locked = 0, []
    for row in rows:
        if row.id in locked:
            skipped_locked.append(row.id)
            continue
        if body.do_not_contact:  # the address and the number are blocked separately: a shared switchboard must not hide a person's email
            if row.email:
                await C.add_block(db, email=row.email, name=row.name or "", reason="Erased at the owner's request", source="manual")
            if row.phone:
                await C.add_block(db, phone=row.phone, name=row.name or "", reason="Erased at the owner's request", source="manual")
        await J.exit_for_lead(db, row, "", "deleted")
        await db.delete(row)
        deleted += 1
    await db.commit()
    return {"deleted": deleted, "locked": skipped_locked, "not_found": len(ids) - len(rows)}


async def _apply_shared_record(db: AsyncSession, row: LeadAccount) -> Optional[BusinessRecord]:
    """Fill empty fields from the shared, cross-organisation BusinessRecord store -- someone else
    may already have looked this company up via Companies House or an earlier search. Free: it's
    our own stored data and calls no paid API, so this never charges a credit.

    If another organisation's Research run already found a full dossier for this company
    (shared.shared_research -- team, named contacts, sources), that dossier is public fact about
    the business, not that organisation's private data, so it's copied here too: this account
    looks fully researched without this organisation ever paying for its own research run.
    Never overwrites research this organisation already paid for or entered itself."""
    if is_person_account(row):
        return None  # a person has no company record to take details from
    shared = await business_records.lookup(db, name=row.name, domain=row.domain)
    if shared:
        row.business_record_id = shared.id
        row.industry = row.industry or _clean(shared.industry, 120)
        row.region = row.region or _clean(shared.region, 120)
        row.phone = _phone(row.phone) or _phone(shared.phone)
        row.email = row.email or _clean(shared.email, 200).lower()
        if shared.shared_research and not row.research:
            row.research = shared.shared_research
            row.researched_at = row.updated_at = shared.updated_at or datetime.utcnow()
            team = [t for t in shared.shared_research.get("team") or [] if isinstance(t, dict) and looks_like_person_name(t.get("name"))]
            if team and not row.contact_name:
                row.contact_name = team[0].get("name") or row.contact_name
                row.contact_title = row.contact_title or team[0].get("title") or ""
        await db.commit()
    return shared


@router.post("/accounts/{account_id}/quick-check")
async def quick_check_account(account_id: str, db: AsyncSession = Depends(get_db)):
    """Fill what we can from our own shared company store only -- no live web search, no AI
    call, no credit charged. Use /research below for a live web search (which does cost a
    credit when it finds something) -- this is the free step before reaching for that."""
    row = await _account(db, account_id)
    shared = await _apply_shared_record(db, row)
    biz = shared or await _registry_for(db, account_id)
    return _out(row, biz)


@router.post("/accounts/{account_id}/deep-search")
async def deep_search_account(account_id: str, db: AsyncSession = Depends(get_db)):
    """"Deep web search": one structured lookup against Google's places data (5 Leads credits
    when it finds something -- shown to the user only as "Deep web search", never by vendor
    name). Checks our own shared store first, same as /research; whatever it finds is saved
    back to that store so the next lookup for this company is free."""
    row = await _account(db, account_id)
    if (row.verification or {}).get("verdict") == "problem" or is_person_account(row):
        return _out(row, await _registry_for(db, account_id))  # the company has ended, or this is a person: nothing found would be about a company
    await _apply_shared_record(db, row)
    await _can_deep_search(db)
    place = await search_deeper(f"{row.name} {row.region}".strip(), name=row.name, postcode=getattr(row, "postcode", "") or "", domain=getattr(row, "domain", "") or "")
    if not place:
        biz = await _registry_for(db, account_id)
        return _out(row, biz)
    from app.services import web_harness

    # Google's answer is a lead: only what the company's own site confirms is kept (and its address and rating are not stored).
    confirmed = _vouched(place, await web_harness.confirm_place(row.name, getattr(row, "postcode", "") or "", place))
    if not confirmed:
        biz = await _registry_for(db, account_id)
        return _out(row, biz)
    row.phone = _phone(row.phone) or _phone(confirmed.get("phone"))
    site = _clean(confirmed.get("website"), 300)
    row.website = row.website or (site or "")
    if not row.domain and row.website:
        row.domain = _domain(row.website)
    try:
        shared_row = await business_records.upsert(
            db, source_id=f"{place.get('via') or 'google_places'}:{place['place_id']}", source_type=place.get("via") or "google_places", confidence_tier="scraped",
            data={"name": row.name, "domain": row.domain, "website": row.website, "phone": _phone(confirmed.get("phone"))},
        )
        row.business_record_id = row.business_record_id or shared_row.id
    except ValueError:
        pass
    row.updated_at = datetime.utcnow()
    await db.commit()
    await _charge_deep_search(db, f"Deep web search: {row.name}")
    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == row.business_record_id))).scalars().first() if row.business_record_id else None
    return _out(row, biz)


@router.post("/accounts/{account_id}/research")
async def research_account(account_id: str, db: AsyncSession = Depends(get_db)):
    """Research one company on the web (1 Leads credit when anything is found). Fills only the
    fields that are still empty; what the user or an earlier run saved is never overwritten.

    Checks the shared, cross-organisation BusinessRecord store first (instant, free -- someone
    else may have already looked this company up via Companies House or an earlier search); the
    live web search below still runs regardless, since it finds things (people, phones, socials)
    no registry API covers, and whatever it finds is saved back to the shared store afterwards
    for the next organisation that asks about this same company. Only the live search below is
    ever charged -- see _charge_leads below, called only when it actually finds something."""
    row = await _account(db, account_id)
    await _can_research(db)
    await _apply_shared_record(db, row)
    found = await research_into(db, row)
    await db.commit()
    if found:
        await _charge_leads(db, 1, f"Researched {row.name}")
    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == row.business_record_id))).scalars().first() if row.business_record_id else None
    return _out(row, biz)


_UK_POSTCODE = re.compile(r"\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b", re.I)
# Sites that list many businesses: their pages and contacts are never this company's own.
from app.services import listing_pages as _LP  # noqa: E402  (the one list of directory sites, plus a few that are only ever listings)

_LISTING_SITES = tuple(dict.fromkeys((*_LP.hosts(), "booking.com", "yelp.", "opentable.", "google.com")))


def _is_uk(row: LeadAccount) -> bool:
    vals = [row.region or "", row.website or ""] + [str(v) for v in (row.custom or {}).values()]
    return any(_UK_POSTCODE.search(v) or re.search(r"\b(uk|united kingdom|england|scotland|wales)\b", v, re.I) or v.lower().rstrip("/").endswith(".uk") for v in vals)


def _wrong_business(row: LeadAccount, data: Dict[str, Any]) -> bool:
    """A UK company whose web result is a listing site or a number from another country is a different business."""
    if not _is_uk(row):
        return False
    host = _domain(str(data.get("domain") or ""))
    if host and any(site in host for site in _LISTING_SITES):
        return True
    digits = re.sub(r"\D", "", str(data.get("primaryPhone") or ""))
    return bool(digits) and not digits.startswith(("0", "44"))


async def research_into(db: AsyncSession, row: LeadAccount) -> bool:
    """The live web search itself: fills the account's empty fields and its research dossier. Returns
    whether anything was found (the only case that is charged). Does not commit or charge; the caller does.
    Raises HTTPException 502 when the search can't run. Used by Research and by the bulk Enrich run."""
    before = {f: (getattr(row, f, "") or "").strip() for f in QUALITY_FIELDS}
    if (row.verification or {}).get("verdict") == "problem":
        return False  # the company has ended: whatever the web shows would be about a different business
    if is_person_account(row):
        return False  # a web search for a person's name finds other people and unrelated businesses
    try:
        data = await enrich_prospect_intelligence(name=row.contact_name or row.name, company=row.name,
                                                  domain=row.domain or row.website or None, person=row.contact_name or None,
                                                  place=row.region or None, page_url=row.source_url or None, db=db)
    except Exception:
        raise HTTPException(status_code=502, detail=f"Couldn't research {row.name} right now. Nothing was charged; try again in a minute.")
    if _wrong_business(row, data):
        return False  # a UK company matched to a foreign listing or a booking site: use none of it
    people = [{"name": _clean(p.get("name"), 120), "role": _clean(p.get("roleHint"), 120), "source": p.get("source") or ""}
              for p in (data.get("keyPeople") or []) if p.get("name")]
    # Each entry here is one real person with whatever was actually found right next to their name
    # on the page (title/phone/email kept together) -- not three separate flattened lists with no
    # link between them, which is what made the old phones/emails lists unusable for "whose is whose."
    team = [{"name": _clean(t.get("name"), 120), "title": _clean(t.get("title"), 120),
             "phone": _clean(t.get("phone"), 60), "email": _clean(t.get("email"), 200).lower()}
            for t in (data.get("team") or []) if looks_like_person_name(t.get("name"))][:10]
    found = bool(data.get("phones") or data.get("emails") or data.get("otherOffices") or people or team or data.get("socials")
                 or (data.get("overview") and data.get("overview") != "No detailed summary found."))
    overview = data.get("overview") or ""
    # Named mailboxes (ellis.blackham@...) vs the company's general/role inboxes (info@, sales@...)
    # -- so the dossier can label who's who instead of one flat, unattributed list of addresses.
    email_contacts = [{"email": _clean(c.get("email"), 200).lower(), "name": _clean(c.get("name"), 120)}
                       for c in (data.get("emailContacts") or []) if c.get("email")][:5]
    if row.research and row.researched_at:
        # Keep the run this is about to replace -- re-researching used to throw it away, so an
        # earlier run's findings (maybe about a person who's since left) were gone for good.
        history = list(row.research_history or [])
        history.insert(0, {"research": row.research, "researched_at": row.researched_at.isoformat() + "Z"})
        row.research_history = history[:10]
    row.research = {
        "overview": "" if overview == "No detailed summary found." else _clean(overview, 2000),
        "people": people,
        "team": team,
        "phones": [p for p in (data.get("phones") or [])][:5],
        "emails": [e for e in (data.get("emails") or [])][:5],
        "email_contacts": email_contacts,
        "other_offices": (data.get("otherOffices") or [])[:8],
        "socials": data.get("socials") or {},
        "sources": [c for c in (data.get("citations") or [])][:8],
    }
    if not row.domain and data.get("domain") and site_check.plausible_site(row.name, data["domain"], strict=True):  # never a register or directory page
        row.domain = _domain(data["domain"])
        row.website = row.website or (data["domain"] if "://" in data["domain"] else f"https://{row.domain}")
    row.phone = _phone(row.phone) or _phone(data.get("primaryPhone"))
    found_email = _clean(data.get("primaryEmail"), 200).lower()
    # A company's general inbox (support@, info@) is not the email of the named person on this record.
    if not (row.contact_name and is_role_inbox(found_email)):
        row.email = row.email or found_email
    if people and not row.contact_name:
        row.contact_name, row.contact_title = people[0]["name"], row.contact_title or people[0]["role"]
    elif not row.contact_name:
        # No titled exec found by name -- fall back to the first named mailbox (person, not a
        # role inbox); leave the title blank rather than guessing one.
        named = next((c for c in email_contacts if c["name"]), None)
        if named:
            row.contact_name = named["name"]
    row.researched_at = row.updated_at = datetime.utcnow()
    # What this run added to fields that were empty (the values the user gave are never in this list).
    row.research = {**row.research, "filled": [{"field": f, "value": (getattr(row, f, "") or "").strip()}
                                              for f in QUALITY_FIELDS if not before[f] and (getattr(row, f, "") or "").strip()]}
    if found and (row.domain or row.name):
        # Save what the live search found back into the shared store too, tagged as the least
        # trusted tier (a web-search summary, not a verified registry) -- the next organisation
        # that asks about this same company gets this instantly instead of re-searching for it.
        try:
            overview = row.research.get("overview") if row.research else ""
            shared_row = await business_records.upsert(
                db, source_id="llm_web_search", source_type="llm_fallback", confidence_tier="llm_fallback",
                data={"name": row.name, "domain": row.domain, "website": row.website, "phone": row.phone,
                      "email": row.email, "region": row.region, "description": overview},
            )
            row.business_record_id = row.business_record_id or shared_row.id
            # The full dossier (team, named contacts, sources) is public fact about the business,
            # not this organisation's private data -- every other organisation's saved account for
            # the same company gets it too, for free, via _apply_shared_record above.
            shared_row.shared_research = {k: v for k, v in row.research.items() if k != "filled"}  # what this run filled in is this account's own
            business_records.refresh_rank(shared_row)
            await db.flush()
        except ValueError:
            pass  # nothing identifiable enough to be worth caching for anyone else
    return found


class AskIn(BaseModel):
    prompt: str


@router.post("/ask")
async def ask(body: AskIn, db: AsyncSession = Depends(get_db)):
    """The Data Find chat: ask about one company or describe businesses in open-ended terms
    (direct or indirect). Answers from the shared BusinessRecord store first, then live Data
    Sources, then a general web search if even those come up short -- and saves whatever that
    search finds back into the shared store for the next organisation that asks something
    similar. Costs 1 Leads credit, same pool as researching a saved account, only when something
    was actually found."""
    prompt = _clean(body.prompt, 1000)
    if not prompt:
        raise HTTPException(status_code=400, detail="Ask something first.")
    await _can_research(db)
    try:
        out = await business_lookup.answer(db, prompt)
    except Exception:
        raise HTTPException(status_code=502, detail="Couldn't look that up right now. Nothing was charged; try again in a minute.")
    await db.commit()
    if out.get("results"):
        await _charge_leads(db, 1, f"Asked: {prompt[:80]}")
    return out
