"""Leads: the companies a user saved (Saved Accounts, Decision Makers, Account Dossiers).

Accounts come from AI Lead Scout (a live web search), the Copilot, a spreadsheet import or the
user. Only what a search, a research run or the user supplied is stored: nothing is made up.
Each company sees only its own accounts (lead_accounts is a tenant table, see core/tenancy).
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.enrichment import _can_deep_search, _can_research, _charge_deep_search, _charge_leads
from app.database import get_db
from app.models.models import BusinessRecord, LeadAccount
from app.services import business_lookup, business_records
from app.services.enrichment_service import _host_of, enrich_prospect_intelligence, search_google_places

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


class AccountsIn(BaseModel):
    accounts: List[AccountIn]


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


def _out(a: LeadAccount, biz: Optional[BusinessRecord] = None) -> Dict[str, Any]:
    return {
        "id": a.id, "name": a.name, "domain": a.domain or "", "website": a.website or "", "phone": a.phone or "",
        "email": a.email or "", "contact_name": a.contact_name or "", "contact_title": a.contact_title or "",
        "industry": a.industry or "", "region": a.region or "", "notes": a.notes or "", "source": a.source or "manual",
        "source_url": a.source_url or "", "business_record_id": a.business_record_id or "", "research": a.research or None,
        "researched_at": a.researched_at.isoformat() + "Z" if a.researched_at else None,
        "research_history": a.research_history or [],
        "verification": a.verification or None,
        "created_at": a.created_at.isoformat() + "Z" if a.created_at else None,
        "registry": _registry_out(biz) if biz else None,
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


class SearchIn(BaseModel):
    filters: Dict[str, Any] = {}
    limit: int = 25
    offset: int = 0
    exclude_ids: List[str] = []
    area: Optional[List[List[float]]] = None  # a drawn map area: [[lat, lng], ...] corners
    scan: int = 0  # with an area: where this step starts reading the districts it touches (see search_in_area)
    drop_terms: List[str] = []  # words the user removed from "how your words were read" (see phrase_understanding)


@router.post("/search")
async def search_companies(body: SearchIn, db: AsyncSession = Depends(get_db)):
    """The Apollo-style filter search over the shared company store (the same one the chat runs).
    Free: it reads our own data and calls no paid service -- credits are only used when contacts
    are looked up. Every row is a stored record with its trust tier; nothing here is generated."""
    from app.services import lead_filters, phrase_understanding

    shown_filters = business_records.normalize_filters(body.filters)  # what the user typed: this is what comes back
    wide, understood = await phrase_understanding.apply(db, body.filters, body.drop_terms)
    try:
        if body.area:
            out = await business_records.search_in_area(db, wide, body.area, scan=body.scan, exclude_ids=body.exclude_ids)
        else:
            out = await business_records.search_filtered(db, wide, limit=body.limit, offset=body.offset, exclude_ids=body.exclude_ids)
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
    return {"companies": [lead_filters.card(r) for r in out["rows"]], "total": out["total"],
            "total_capped": out.get("total_capped", False), "filters": out["filters"], "chips": chips, "points": out.get("points", {}),
            "next_scan": out.get("next_scan"), "understood": understood}


@router.post("/search/area-count")
async def area_count(body: SearchIn, db: AsyncSession = Depends(get_db)):
    """How many companies a drawn area could hold, so the user picks how many to see before the
    (slower) step of placing each one on the map. Free."""
    if not body.area:
        raise HTTPException(status_code=422, detail="Draw an area on the map first.")
    from app.services import phrase_understanding

    wide, _ = await phrase_understanding.apply(db, body.filters, body.drop_terms)
    try:
        out = await business_records.area_candidates(db, wide, body.area)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except Exception as err:
        if "statement timeout" in str(err).lower():
            raise HTTPException(status_code=504, detail="That area is too busy to count. Draw a smaller one.")
        raise
    return {"candidates": out["candidates"], "capped": out["capped"]}


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
    if web and web.get("found") and not web.get("cached"):
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


@router.post("/accounts")
async def add_accounts(body: AccountsIn, db: AsyncSession = Depends(get_db)):
    """Save one or many accounts. A company already saved (same website, or same name when there
    is no website) is skipped, so saving a search twice or re-importing a file adds no copies."""
    if len(body.accounts) > MAX_PER_REQUEST:
        raise HTTPException(status_code=400, detail=f"Save at most {MAX_PER_REQUEST} accounts at a time.")
    existing = (await db.execute(select(LeadAccount.domain, LeadAccount.name))).all()
    domains = {d for d, _ in existing if d}
    names = {(n or "").strip().lower() for _, n in existing}
    added: List[LeadAccount] = []
    skipped = 0
    claimed = {i.business_record_id for i in body.accounts if i.business_record_id}
    known_biz = set((await db.execute(select(BusinessRecord.id).where(BusinessRecord.id.in_(claimed)))).scalars().all()) if claimed else set()
    for item in body.accounts:
        website = _clean(item.website)
        domain = _domain(website)
        name = _clean(item.name) or domain
        if not name:
            skipped += 1
            continue
        key = name.lower()
        if (domain and domain in domains) or (not domain and key in names):
            skipped += 1
            continue
        row = LeadAccount(
            id=f"acc_{uuid.uuid4().hex[:16]}", name=name, domain=domain,
            website=website if "://" in website or not website else f"https://{website}",
            phone=_clean(item.phone, 60), email=_clean(item.email, 200).lower(), contact_name=_clean(item.contact_name, 120),
            contact_title=_clean(item.contact_title, 120), industry=_clean(item.industry, 120), region=_clean(item.region, 120),
            notes=_clean(item.notes, 2000), source=item.source if item.source in _SOURCES else "manual",
            source_url=_clean(item.source_url, 500),
            business_record_id=item.business_record_id if item.business_record_id in known_biz else None,
        )
        db.add(row)
        added.append(row)
        if domain:
            domains.add(domain)
        names.add(key)
    await db.commit()
    return {"added": len(added), "skipped": skipped, "accounts": [_out(a) for a in added]}


@router.patch("/accounts/{account_id}")
async def update_account(account_id: str, body: AccountPatch, db: AsyncSession = Depends(get_db)):
    row = await _account(db, account_id)
    changes = body.model_dump(exclude_none=True)
    if "name" in changes and not _clean(changes["name"]):
        raise HTTPException(status_code=400, detail="A saved account needs a company name.")
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
    row = await _account(db, account_id)
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
    shared = await business_records.lookup(db, name=row.name, domain=row.domain)
    if shared:
        row.business_record_id = shared.id
        row.industry = row.industry or _clean(shared.industry, 120)
        row.region = row.region or _clean(shared.region, 120)
        row.phone = row.phone or _clean(shared.phone, 60)
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
    await _apply_shared_record(db, row)
    await _can_deep_search(db)
    place = await search_google_places(f"{row.name} {row.region}".strip())
    if not place:
        biz = await _registry_for(db, account_id)
        return _out(row, biz)
    row.phone = row.phone or _clean(place.get("phone"), 60)
    row.website = row.website or _clean(place.get("website"), 300)
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
    try:
        data = await enrich_prospect_intelligence(name=row.contact_name or row.name, company=row.name,
                                                  domain=row.domain or row.website or None, person=row.contact_name or None,
                                                  place=row.region or None, page_url=row.source_url or None, db=db)
    except Exception:
        raise HTTPException(status_code=502, detail=f"Couldn't research {row.name} right now. Nothing was charged; try again in a minute.")
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
    if not row.domain and data.get("domain"):
        row.domain = _domain(data["domain"])
        row.website = row.website or (data["domain"] if "://" in data["domain"] else f"https://{row.domain}")
    row.phone = row.phone or _clean(data.get("primaryPhone"), 60)
    row.email = row.email or _clean(data.get("primaryEmail"), 200).lower()
    if people and not row.contact_name:
        row.contact_name, row.contact_title = people[0]["name"], row.contact_title or people[0]["role"]
    elif not row.contact_name:
        # No titled exec found by name -- fall back to the first named mailbox (person, not a
        # role inbox); leave the title blank rather than guessing one.
        named = next((c for c in email_contacts if c["name"]), None)
        if named:
            row.contact_name = named["name"]
    row.researched_at = row.updated_at = datetime.utcnow()
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
            shared_row.shared_research = row.research
            await db.flush()
        except ValueError:
            pass  # nothing identifiable enough to be worth caching for anyone else
    await db.commit()
    if found:
        await _charge_leads(db, 1, f"Researched {row.name}")
    biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == row.business_record_id))).scalars().first() if row.business_record_id else None
    return _out(row, biz)


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
