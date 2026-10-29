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

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.enrichment import _can_deep_search, _can_research, _charge_deep_search, _charge_leads
from app.database import get_db
from app.models.models import BusinessRecord, LeadAccount
from app.services import business_lookup, business_records, site_check
from app.services.person_record import is_person_account, is_role_inbox
from app.services.enrichment_service import _host_of, enrich_prospect_intelligence, search_google_places

logger = logging.getLogger("lead_accounts")

router = APIRouter(prefix="/leads", tags=["Leads"])

MAX_PER_REQUEST = 2000
_FIELDS = ("name", "website", "phone", "email", "contact_name", "contact_title", "industry", "region", "notes")
_SOURCES = {"scout", "copilot", "import", "manual"}


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
_RESERVED_COLUMNS = {"name", "website", "phone", "email", "contact", "contact_name", "contact_title", "industry", "region", "notes"}


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


def _out(a: LeadAccount, biz: Optional[BusinessRecord] = None) -> Dict[str, Any]:
    from app.api.connected import connection_fields

    return {"found": _found(a), "connection": connection_fields(a),
        "id": a.id, "name": a.name, "domain": a.domain or "", "website": a.website or "", "phone": _phone(a.phone),
        "email": a.email or "", "contact_name": a.contact_name or "", "contact_title": a.contact_title or "",
        "industry": a.industry or "", "region": a.region or "", "notes": a.notes or "", "source": a.source or "manual",
        "source_url": a.source_url or "", "business_record_id": a.business_record_id or "", "research": a.research or None,
        "researched_at": a.researched_at.isoformat() + "Z" if a.researched_at else None,
        "research_history": a.research_history or [],
        "verification": a.verification or None, "custom": a.custom or {},
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


def _page_key(filters, sort, limit, offset, drop_terms) -> str:
    import json

    return json.dumps([filters, sort, limit, offset, drop_terms, business_records._RANKING[1]], sort_keys=True, default=str)


async def warm_browse_pages() -> None:
    """Read the opening list (every company, best first) for the usual page sizes into the page cache, so the first person to
    open Find Leads after a restart does not wait for the whole register to be sorted."""
    import time

    from app.database import AsyncSessionLocal
    from app.services import lead_filters

    for limit in (25, 50, 100):
        async with AsyncSessionLocal() as db:
            out = await business_records.search_filtered(db, {}, limit=limit, offset=0, sort="best", stats=False)
            cards = [lead_filters.card(r) for r in out["rows"]]
        if not cards:
            continue  # an empty register (before an import) must never be remembered as "no companies"
        answer = {"companies": cards, "total": out["total"], "total_capped": out.get("total_capped", False), "filters": out["filters"],
                  "chips": lead_filters.describe(out["filters"]), "points": {}, "next_scan": None, "understood": [],
                  "tiers": None, "saved_total": None, "total_all": None, "ranked": out.get("ranked", True), "timing_ms": out.get("timing_ms")}
        _PAGE_CACHE[_page_key(out["filters"], "best", limit, 0, [])] = (time.monotonic(), answer, _BROWSE_TTL)


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


@router.post("/search")
async def search_companies(body: SearchIn, db: AsyncSession = Depends(get_db)):
    """The Apollo-style filter search over the shared company store (the same one the chat runs).
    Free: it reads our own data and calls no paid service -- credits are only used when contacts
    are looked up. Every row is a stored record with its trust tier; nothing here is generated."""
    from app.services import lead_filters, phrase_understanding

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

            key = _page_key(shown_filters, body.sort, body.limit, body.offset, body.drop_terms)
            hit = _PAGE_CACHE.get(key) if not body.exclude_ids else None
            if hit and time.monotonic() - hit[0] < hit[2]:
                cached = hit[1]
                mine = await business_records.saved_ids(db, [c["id"] for c in cached["companies"]])
                return {**cached, "companies": [{**c, "saved": c["id"] in mine} for c in cached["companies"]]}
            out, understood = await phrase_understanding.widen_if_empty(
                db, body.filters, body.drop_terms,
                lambda f: business_records.search_filtered(db, f, limit=body.limit, offset=body.offset, exclude_ids=body.exclude_ids,
                                                           sort=body.sort if body.sort in business_records.SORTS else "best", stats=False))
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except Exception as err:
        if "statement timeout" in str(err).lower():
            raise HTTPException(status_code=504, detail="That search is too broad to finish. Add a town or a narrower sector and try again.")
        raise
    out["filters"] = shown_filters
    chips = lead_filters.describe(out["filters"])
    if body.area:
        await db.commit()  # keeps the postcode points just looked up, so the next search is instant
        chips.append("Inside the area drawn on the map")
    cards = [lead_filters.card(r) for r in out["rows"]]
    mine = await business_records.saved_ids(db, [c["id"] for c in cards])
    answer = {"companies": [{**c, "saved": c["id"] in mine} for c in cards], "total": out["total"],
              "total_capped": out.get("total_capped", False), "filters": out["filters"], "chips": chips, "points": out.get("points", {}),
              "next_scan": out.get("next_scan"), "understood": understood,
              "tiers": out.get("tiers"), "saved_total": out.get("saved_total"), "total_all": out.get("total_all"), "ranked": out.get("ranked", True),
              "timing_ms": out.get("timing_ms")}
    if not body.area and not body.exclude_ids and not understood and cards:  # an empty answer is never remembered
        import time

        if len(_PAGE_CACHE) > 200:
            _PAGE_CACHE.clear()
        _PAGE_CACHE[key] = (time.monotonic(), {**answer, "companies": cards}, _PAGE_TTL)
    return answer


@router.post("/search/summary")
async def search_summary(body: SearchIn, db: AsyncSession = Depends(get_db)):
    """The slower figures for a search whose page is already on screen: real total, Full/Partial/Basic counts, how many are saved."""
    try:
        return await business_records.search_summary(db, body.filters)
    except Exception as err:
        if "statement timeout" in str(err).lower():
            return {"total": 0, "total_capped": False, "tiers": None, "saved_total": None, "total_all": None}
        raise


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
    from app.services import lead_filters

    try:
        out = await business_records.search_people(db, body.filters, title=body.title, limit=body.limit, offset=body.offset,
                                                   sort=body.sort if body.sort in business_records.SORTS else "best")
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except Exception as err:
        if "statement timeout" in str(err).lower():
            raise HTTPException(status_code=504, detail="That search is too broad to finish. Add a town or a narrower sector and try again.")
        raise
    mine = await business_records.saved_ids(db, [p["company"].id for p in out["people"]])
    people = [{"id": f'{p["company"].id}:{p["name"]}', "name": p["name"], "first_name": p.get("first_name", ""), "last_name": p.get("last_name", ""),
               "role": p["role"], "appointed_on": p["appointed_on"], "company": {**lead_filters.card(p["company"]), "saved": p["company"].id in mine}}
              for p in out["people"]]
    return {"people": people, "companies_total": out["companies_total"], "total_capped": out["total_capped"],
            "filters": out["filters"], "chips": lead_filters.describe(out["filters"]), "fill_ids": out["fill_ids"]}


async def _candidates_as_total(pending) -> Dict[str, Any]:
    out = await pending
    return {**out, "total": out["candidates"]}


@router.post("/search/area-count")
async def area_count(body: SearchIn, db: AsyncSession = Depends(get_db)):
    """How many companies a drawn area could hold, so the user picks how many to see before the
    (slower) step of placing each one on the map. Free."""
    if not body.area:
        raise HTTPException(status_code=422, detail="Draw an area on the map first.")
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
    return {"candidates": out["candidates"], "capped": out["capped"], "widened": bool(understood), "understood": understood}


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
    if not biz.officers:
        registry_checked = await CC.refresh_from_registry(db, biz)
    web: Optional[Dict[str, Any]] = None
    if body.include_web:
        await _can_research(db)
        try:
            web = await CC.web_contacts(db, biz, refresh=body.refresh_web)
        except Exception:
            raise HTTPException(status_code=502, detail="The web lookup didn't finish. Nothing was charged; try again in a minute.")
    await db.commit()
    if web and web.get("found") and not web.get("cached") and not body.find_site_only:
        await _charge_leads(db, 1, f"Contacts for {biz.name}")
    officers = CC.active_officers(biz.officers)
    return {
        "company": lead_filters.card(biz),
        "officers": officers,
        "officers_note": "" if officers else (
            "The registry lists no current officers for this company." if (biz.officers or registry_checked)
            else "Couldn't reach the registry to read this company's officers just now."),
        "stored": {"website": biz.website or biz.domain or "", "phone": biz.phone or "", "email": biz.email or "",
                   "tier": biz.confidence_tier or "scraped"},
        "web": web,
    }


class FindIn(BaseModel):
    kind: str = "website"  # "website" or "phone": each button looks for its own thing and is charged only when it finds that


@router.post("/companies/{company_id}/find-website")
async def find_company_website(company_id: str, body: FindIn = FindIn(), db: AsyncSession = Depends(get_db)):
    """One click from a result row that has no website: look on the open web first (1 Leads credit, only when a website or
    phone is found), and if that finds no website, the deeper search (its own price, only when it finds one). Nothing is
    charged for a miss. What the web finds stays labelled as web and unverified; the deeper search fills only empty fields
    and never replaces what the registry holds. Shown to the user as "web" and "deeper search", never by vendor name."""
    from app.services import company_contacts as CC, lead_filters

    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == company_id))).scalars().first()
    if not biz:
        raise HTTPException(status_code=404, detail="That company isn't in the company store.")
    from app.services import site_check

    if body.kind == "phone":
        return await _find_phone(db, biz)
    if lead_filters.card(biz)["website"]:
        return {"found": True, "source": "stored", "charged": 0, "note": "", "company": lead_filters.card(biz)}
    await _can_research(db)
    charged, note, source = 0, "", ""
    try:
        web = await CC.web_contacts(db, biz)
    except Exception:
        web = None
        note = "The web lookup didn't finish just now."
    if web and web.get("website") and not site_check.plausible_site(biz.name, web["website"]):
        web = {**web, "website": ""}  # a lookup stored earlier may hold a register or directory page
    found_web = bool(web and web.get("found") and web.get("website"))  # a phone that turns up on the way is kept, but only a website is charged here
    if found_web:
        source = "web"
        await db.commit()
        if not web.get("cached"):
            await _charge_leads(db, 1, f"Website for {biz.name}")
            charged += 1
    if not (lead_filters.card(biz)["website"] or (web or {}).get("website")):
        try:
            await _can_deep_search(db)
            place = await search_google_places(f"{biz.name} {biz.region or ''}".strip())
        except HTTPException:
            place = None
            note = "Nothing found on the web, and there are not enough credits for the deeper search."
        if place and not site_check.same_business(biz.name, place.get("name") or ""):
            logger.info("find-website: deeper search returned a different business for %r: %r", biz.name, place.get("name"))
            place = None
        elif not place:
            logger.info("find-website: nothing for %r on the web (web found %s); deeper search %s", biz.name, bool(web and web.get("found")),
                        "returned nothing or is not switched on")
        if place and place.get("website") and site_check.plausible_site(biz.name, place["website"], strict=False):
            try:
                await business_records.upsert(
                    db, source_id=f"google_places:{place['place_id']}", source_type="google_places", confidence_tier="scraped",
                    data={"name": biz.name, "registration_number": biz.registration_number, "website": place.get("website"),
                          "phone": place.get("phone"), "region": biz.region})
                await db.commit()
                await _charge_deep_search(db, f"Deeper search: {biz.name}")
                charged += 1
                source = "deep"
            except ValueError:
                pass
    await db.refresh(biz)
    card = lead_filters.card(biz)
    got = bool(card["website"] or card["web_website"])
    if not got and not note:
        note = "No website found for this company. Nothing was charged."
    _PAGE_CACHE.clear()  # the rows that were remembered no longer show this company's details
    return {"found": got, "source": source, "charged": charged, "note": note, "company": card}


async def _find_phone(db: AsyncSession, biz: BusinessRecord) -> Dict[str, Any]:
    """The Find phone button: look for this company's phone only. A number we already hold is returned free. Otherwise the web lookup
    (1 credit if it finds a UK number), then the deeper search (its own price, only if it finds one). A miss costs nothing."""
    from app.services import company_contacts as CC, lead_filters

    if lead_filters.card(biz)["phone"] or lead_filters.card(biz)["web_phone"]:
        return {"found": True, "source": "stored", "charged": 0, "note": "", "company": lead_filters.card(biz)}
    await _can_research(db)
    charged, note, source = 0, "", ""
    try:
        web = await CC.web_contacts(db, biz)
        if web.get("cached") and not web.get("phones"):
            web = await CC.web_contacts(db, biz, refresh=True)  # the earlier lookup was for a website: this one is for a phone
    except Exception:
        web = None
        note = "The web lookup didn't finish just now."
    if web and web.get("phones"):
        source = "web"
        await db.commit()
        if not web.get("cached"):
            await _charge_leads(db, 1, f"Phone for {biz.name}")
            charged += 1
    else:
        try:
            await _can_deep_search(db)
            place = await search_google_places(f"{biz.name} {biz.region or ''}".strip())
        except HTTPException:
            place = None
            note = "Nothing found on the web, and there are not enough credits for the deeper search."
        if place and not site_check.same_business(biz.name, place.get("name") or ""):
            logger.info("find-phone: deeper search returned a different business for %r: %r", biz.name, place.get("name"))
            place = None
        elif not place:
            logger.info("find-phone: nothing for %r on the web (web found %s); deeper search returned nothing or is not switched on",
                        biz.name, bool(web and web.get("found")))
        if place and place.get("phone") and CC.is_uk_phone(place["phone"]):
            try:
                await business_records.upsert(
                    db, source_id=f"google_places:{place['place_id']}", source_type="google_places", confidence_tier="scraped",
                    data={"name": biz.name, "registration_number": biz.registration_number, "website": place.get("website"),
                          "phone": place.get("phone"), "region": biz.region})
                await db.commit()
                await _charge_deep_search(db, f"Deeper search: {biz.name}")
                charged += 1
                source = "deep"
            except ValueError:
                pass
    await db.refresh(biz)
    card = lead_filters.card(biz)
    got = bool(card["phone"] or card["web_phone"])
    if not got and not note:
        note = "No phone number found for this company. Nothing was charged."
    _PAGE_CACHE.clear()
    return {"found": got, "source": source, "charged": charged, "note": note, "company": card}


@router.get("/accounts")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(LeadAccount).order_by(LeadAccount.created_at.desc()))).scalars().all()
    biz_ids = [r.business_record_id for r in rows if r.business_record_id]
    registry_by_id: Dict[str, BusinessRecord] = {}
    if biz_ids:
        biz_rows = (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(biz_ids)))).scalars().all()
        registry_by_id = {b.id: b for b in biz_rows}
    return {"accounts": [_out(a, registry_by_id.get(a.business_record_id)) for a in rows]}


@router.get("/accounts/{account_id}/registry")
async def account_registry(account_id: str, db: AsyncSession = Depends(get_db)):
    """Just the shared registry facts for one account -- for refreshing that section after a
    Research call without re-fetching the whole list."""
    biz = await _registry_for(db, account_id)
    return {"registry": _registry_out(biz) if biz else None}


def _place(region: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (region or "").lower()).strip()


@router.post("/accounts")
async def add_accounts(body: AccountsIn, db: AsyncSession = Depends(get_db)):
    """Save one or many accounts. A company already saved (same website, or same name when there
    is no website) is skipped, so saving a search twice or re-importing a file adds no copies. When the
    match comes from an import, what the file holds fills the saved company's blanks and its file columns,
    and a company that was only found by a search is now marked as imported, because it is in the user's file."""
    if len(body.accounts) > MAX_PER_REQUEST:
        raise HTTPException(status_code=400, detail=f"Save at most {MAX_PER_REQUEST} accounts at a time.")
    existing = (await db.execute(select(LeadAccount.id, LeadAccount.domain, LeadAccount.name, LeadAccount.region, LeadAccount.business_record_id, LeadAccount.contact_name))).all()
    # Each identity maps to every saved record that has it: one company can hold several people (a call list of contacts at the
    # same firm), and a name that is already saved for someone else is a different record, not a copy.
    contact_of: Dict[str, str] = {i: (c or "").strip().lower() for i, _, _, _, _, c in existing}
    by_domain: Dict[Any, List[str]] = {}
    by_biz: Dict[Any, List[str]] = {}  # the registry record is the most exact identity a company has
    by_name: Dict[Any, List[str]] = {}
    no_site: Dict[Any, List[str]] = {}  # saved without a website
    for i, d, n, r, b, _ in existing:
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
    fresh: set = set()
    claimed = {i.business_record_id for i in body.accounts if i.business_record_id}
    known_biz = set((await db.execute(select(BusinessRecord.id).where(BusinessRecord.id.in_(claimed)))).scalars().all()) if claimed else set()
    for item in body.accounts:
        website = _clean(item.website)
        domain = _domain(website)
        name = _clean(item.name) or domain
        if not name:
            skipped += 1
            unnamed += 1
            continue
        key = (name.lower(), _place(item.region))
        person = _clean(item.contact_name, 120).lower()
        hit = (find(by_biz.get(item.business_record_id), person) if item.business_record_id else None) or find(by_domain.get(domain) if domain else by_name.get(key), person)
        if not hit and domain:
            hit = find(no_site.get(key), person)  # the same firm saved earlier without a website, now arriving with one
        if hit:
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
            phone=_clean(item.phone, 60), email=_clean(item.email, 200).lower(), contact_name=_clean(item.contact_name, 120),
            contact_title=_clean(item.contact_title, 120), industry=_clean(item.industry, 120), region=_clean(item.region, 120),
            notes=_clean(item.notes, 2000), source=item.source if item.source in _SOURCES else "manual",
            source_url=_clean(item.source_url, 500), custom=clean_custom(item.custom),
            business_record_id=item.business_record_id if item.business_record_id in known_biz else None,
        )
        db.add(row)
        added.append(row)
        fresh.add(row.id)
        contact_of[row.id] = person
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
    await db.commit()
    out: Dict[str, Any] = {"added": len(added), "skipped": skipped, "matched": len(matched), "unnamed": unnamed, "repeats": repeats, "accounts": [_out(a) for a in added],
                           "updated": [_out(a) for a in updated]}
    if body.list_id or body.list_name.strip():
        from app.api.lead_lists import put_in_list

        out["list"] = await put_in_list(db, body.list_id, body.list_name, [a.id for a in added] + matched)
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
    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == row.business_record_id))).scalars().first() if row.business_record_id else None
    return _out(row, biz)


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db)):
    from app.services import company_check_job

    row = await _account(db, account_id)
    if account_id in await company_check_job.locked_ids():
        raise HTTPException(status_code=409, detail="This company is being checked right now. You can edit it, but delete it when the check has finished.")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


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
            team = shared.shared_research.get("team") or []
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
    """"Deep web search": one structured lookup against Google's places data (2 Leads credits
    when it finds something -- shown to the user only as "Deep web search", never by vendor
    name). Checks our own shared store first, same as /research; whatever it finds is saved
    back to that store so the next lookup for this company is free."""
    row = await _account(db, account_id)
    if (row.verification or {}).get("verdict") == "problem" or is_person_account(row):
        return _out(row, await _registry_for(db, account_id))  # the company has ended, or this is a person: nothing found would be about a company
    await _apply_shared_record(db, row)
    await _can_deep_search(db)
    place = await search_google_places(f"{row.name} {row.region}".strip())
    if not place:
        biz = await _registry_for(db, account_id)
        return _out(row, biz)
    row.phone = _phone(row.phone) or _phone(place.get("phone"))
    site = _clean(place.get("website"), 300)
    row.website = row.website or (site if site and site_check.plausible_site(row.name, site, strict=False) else "")
    row.region = row.region or _clean(place.get("address"), 120)
    if not row.domain and row.website:
        row.domain = _domain(row.website)
    try:
        shared_row = await business_records.upsert(
            db, source_id=f"google_places:{place['place_id']}", source_type="google_places", confidence_tier="scraped",
            data={"name": row.name, "domain": row.domain, "website": row.website, "phone": row.phone,
                  "region": row.region, "description": f"Rating {place['rating']}/5 on Google." if place.get("rating") else ""},
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
_LISTING_SITES = ("booking.com", "tripadvisor.", "facebook.com", "yell.com", "trustpilot.", "linkedin.com", "yelp.", "opentable.",
                  "checkatrade.com", "companieshouse.gov.uk", "endole.co.uk", "opencorporates.com", "dnb.com", "google.com", "instagram.com")


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
            for t in (data.get("team") or []) if t.get("name")][:10]
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
