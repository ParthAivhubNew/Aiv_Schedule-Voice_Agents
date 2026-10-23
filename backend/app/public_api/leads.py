"""Finding and checking leads in the public API.

One job does the whole thing: find companies (by words, place or a drawn area), look up their contacts,
save them as leads and check them (company, email, phone). The cost is shown first (estimate_only) and the
credits are the app's own. Contact lists a customer brings themselves go through the same checks.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Literal, Optional, Union

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.tenancy import org_scope
from app.database import AsyncSessionLocal, get_db
from app.models.models import BusinessRecord, LeadAccount, Prospect, PublicObject
from app.public_api import links
from app.public_api.core import V1Route, authorize, fail, is_test, page_args, page_of

logger = logging.getLogger("public_api.leads")
router = APIRouter(prefix="/leads", tags=["Leads"], route_class=V1Route)

MAX_AREA_STEPS = 40
MAX_WEB_LOOKUPS = 100
STALLED_AFTER = timedelta(minutes=45)
SANDBOX = "lead_test_"
_TASKS: set = set()
_FILTER_KEYS = ("keyword", "sector", "sic_codes", "towns", "postcode_prefixes", "size_bands", "status")


# ── Request bodies ───────────────────────────────────────────────────────────
class SearchIn(BaseModel):
    keyword: Optional[Union[str, List[str]]] = Field(None, description="Words in the company name or what it does")
    sector: Optional[Union[str, List[str]]] = Field(None, description="e.g. plumbing, accountancy")
    sic_codes: Optional[List[str]] = Field(None, description="Industry codes")
    towns: Optional[List[str]] = Field(None, description="Towns or cities")
    postcode_prefixes: Optional[List[str]] = Field(None, description="e.g. SW1, M1")
    size_bands: Optional[List[Literal["micro", "small", "medium_large", "dormant"]]] = None
    status: Optional[str] = Field(None, description="Company status. Default: active only")
    area: Optional[List[List[float]]] = Field(None, description="A drawn area: three or more [lat, lng] corners")
    limit: int = Field(25, ge=1, le=200, description="How many companies to find")
    contacts: Literal["none", "officers", "web"] = Field("officers", description="officers: the registered directors (free). web: also look for phones, websites and team on the web (costs credits)")
    checks: List[Literal["company", "email", "phone"]] = Field(default_factory=list, description="Check each company, its contact's email, and its phone number")
    estimate_only: bool = Field(False, description="Show what it would cost without starting")


class LeadIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Company name")
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    contact_name: Optional[str] = None
    contact_title: Optional[str] = None
    industry: Optional[str] = None
    region: Optional[str] = None
    notes: Optional[str] = None


class ImportIn(BaseModel):
    """Either one lead (name, phone, email, company, notes: the original form) or a list in `leads`."""
    leads: Optional[List[LeadIn]] = Field(None, max_length=500)
    checks: List[Literal["company", "email", "phone"]] = Field(default_factory=list)
    estimate_only: bool = False
    name: Optional[str] = Field(None, description="One lead (original form)")
    phone: Optional[str] = None
    email: Optional[str] = None
    company: Optional[str] = None
    notes: Optional[str] = None


# ── Cost ─────────────────────────────────────────────────────────────────────
def _clean_filters(body: SearchIn) -> Dict[str, Any]:
    from app.services import business_records

    raw = {k: getattr(body, k) for k in _FILTER_KEYS if getattr(body, k) not in (None, [], "")}
    return business_records.normalize_filters(raw)


async def estimate(db: AsyncSession, companies: int, contacts: str, checks: List[str], with_contact: Optional[int] = None) -> Dict[str, Any]:
    """The most a job could cost, per step, and whether the balance covers it. Charges nothing."""
    from app.services import company_check as cc
    from app.services import company_check_job as CCJ
    from app.services import credits as K
    from app.services import number_check as NC

    rates = await K.rates(db)
    ready = await CCJ.readiness()
    named = companies if with_contact is None else with_contact
    parts = {"web_contacts": 0, "company_check": 0, "email_check": 0, "phone_check": 0}
    if contacts == "web":
        parts["web_contacts"] = int(math.ceil(min(companies, MAX_WEB_LOOKUPS) * float(rates["lead_lookup"]["credits"])))
    want_company = bool({"company", "email"} & set(checks))
    priced = cc.price_parts(rates, companies, named, registry=ready["registry"] and want_company, deep=ready["deep"] and want_company,
                            email=ready["email"] and "email" in checks)
    parts["company_check"] = priced["registry"] + priced["deep"]
    parts["email_check"] = priced["email"]
    if "phone" in checks:
        parts["phone_check"] = int(math.ceil(companies / NC.PER_CREDIT * float(rates["lead_phone_check"]["credits"])))
    total = sum(parts.values())
    balance = await K.wallet_balance(db, "leadgen") + (await K.wallet_balance(db, "voice") if "phone" in checks else 0)
    enforced = bool((await K.org_settings(db))["enforce"])
    return {"credits_at_most": total, "breakdown": parts, "balance": balance, "enforced": enforced,
            "can_afford": (not enforced) or balance >= total,
            "available": {"company_check": ready["registry"], "email_check": ready["email"], "deep_search": ready["deep"]},
            "note": "These are upper limits. You are charged only for what is actually used."}


# ── Searching ────────────────────────────────────────────────────────────────
async def _find(db: AsyncSession, filters: Dict[str, Any], area: Optional[List[List[float]]], limit: int, progress) -> List[BusinessRecord]:
    from app.services import business_records

    if not area:
        out = await business_records.search_filtered(db, filters, limit=limit, offset=0)
        return list(out["rows"])
    rows: List[BusinessRecord] = []
    scan: Optional[int] = 0
    seen: List[str] = []
    for step in range(MAX_AREA_STEPS):
        out = await business_records.search_in_area(db, filters, area, scan=scan or 0, exclude_ids=seen or None)
        rows += out["rows"]
        seen += [r.id for r in out["rows"]]
        scan = out.get("next_scan")
        await progress(f"Looking inside the area ({len(rows)} found so far)")
        if scan is None or len(rows) >= limit:
            break
    await db.commit()  # keeps the postcode points just looked up
    return rows[:limit]


async def _patch(job_id: str, **fields: Any) -> None:
    async with AsyncSessionLocal() as db:
        o = await db.get(PublicObject, job_id)
        if o:
            o.data = {**(o.data or {}), **fields}
            await db.commit()


async def _contacts_for(db: AsyncSession, biz: BusinessRecord, mode: str, web_budget: List[int]) -> List[Dict[str, Any]]:
    from app.api.enrichment import _can_research, _charge_leads
    from app.services import company_contacts as CC
    from fastapi import HTTPException

    if mode == "none":
        return []
    try:
        if not biz.officers:
            await CC.refresh_from_registry(db, biz)
    except Exception as err:
        logger.debug(f"[leads] registry contacts skipped for {biz.id}: {err}")
    out = [{"name": o.get("name", ""), "role": o.get("role", ""), "source": "registry"} for o in CC.active_officers(biz.officers)]
    if mode == "web" and web_budget[0] > 0:
        try:
            await _can_research(db)
            web = await CC.web_contacts(db, biz)
            await db.commit()
            if web.get("found") and not web.get("cached"):
                await _charge_leads(db, 1, f"Contacts for {biz.name}")
            web_budget[0] -= 1
            for t in (web.get("team") or [])[:10]:
                out.append({"name": t.get("name", ""), "role": t.get("title", ""), "source": "web",
                            "email": t.get("email") or None, "phone": t.get("phone") or None})
            if web.get("website") and not (biz.website or biz.domain):
                out.append({"name": "", "role": "", "source": "web", "website": web["website"]})
            for ph in (web.get("phones") or [])[:1]:
                out.append({"name": "", "role": "", "source": "web", "phone": ph})
        except HTTPException:
            web_budget[0] = 0  # out of credits: the rest are done without the web step
        except Exception as err:
            logger.debug(f"[leads] web contacts skipped for {biz.id}: {err}")
    await db.commit()
    return out


async def _save_leads(db: AsyncSession, rows: List[BusinessRecord], contacts: Dict[str, List[Dict[str, Any]]]) -> Dict[str, str]:
    """Save found companies as leads (skipping ones already saved). Returns business id -> lead id."""
    from app.api.lead_accounts import AccountIn, add_accounts, AccountsIn

    have = {a.business_record_id: a.id for a in (await db.execute(
        select(LeadAccount).where(LeadAccount.business_record_id.in_([r.id for r in rows])))).scalars().all()}
    fresh = []
    for r in rows:
        if r.id in have:
            continue
        people = [c for c in contacts.get(r.id, []) if c.get("name")]
        fresh.append(AccountIn(name=r.name, website=r.website or r.domain or "", phone=r.phone or "", email=r.email or "",
                               contact_name=people[0]["name"] if people else "", contact_title=people[0].get("role", "") if people else "",
                               industry=(r.sic_text or r.industry or "").split(" | ")[0], region=r.postcode or r.region or "",
                               source="scout", business_record_id=r.id))
    if fresh:
        await add_accounts(AccountsIn(accounts=fresh), db)
    return {a.business_record_id: a.id for a in (await db.execute(
        select(LeadAccount).where(LeadAccount.business_record_id.in_([r.id for r in rows])))).scalars().all()}


async def _company_checks(job_id: str, lead_ids: List[str], include_email: bool) -> None:
    """Run the app's company check over the saved leads and wait for it."""
    from app.services import company_check_job as CCJ

    async with AsyncSessionLocal() as db:
        accounts = list((await db.execute(select(LeadAccount).where(LeadAccount.id.in_(lead_ids)))).scalars().all())
        started = await CCJ.start(db, accounts, include_email)
    if started.get("error"):
        await _patch(job_id, check_error=started["error"])
        return
    check_id = started["job"]["job_id"]
    await _patch(job_id, stage="checking", check_job=check_id)
    deadline = time.time() + 40 * 60
    while time.time() < deadline:
        doc = await CCJ.get_job(check_id)
        await _patch(job_id, progress={"done": doc.get("done", 0), "total": doc.get("total", len(lead_ids))})
        if doc.get("status") != "running":
            await _patch(job_id, charged=(doc.get("charged") or {}).get("total", 0))
            return
        await asyncio.sleep(3)


async def _phone_checks(job_id: str, lead_ids: List[str]) -> Dict[str, Any]:
    """The carrier check on each lead's phone (the app's number check, charged the same way)."""
    from app.services import credits as K
    from app.services import number_check as NC

    async with AsyncSessionLocal() as db:
        accounts = list((await db.execute(select(LeadAccount).where(LeadAccount.id.in_(lead_ids)))).scalars().all())
        items = [{"key": a.id, "phone": a.phone, "names": [a.name, a.contact_name or ""]} for a in accounts if (a.phone or "").strip()]
        if not items:
            return {}
        rows = NC.prepare(items, await NC.do_not_call_numbers(db))
        todo = NC.plan(rows, await NC.cached_answers(db, [r["phone"] for r in rows if not r["status"]]))
        todo = todo[:NC.MAX_PER_RUN]
        if todo:
            ok, why = await K.can_start(db, "lead_phone_check", len(todo) / NC.PER_CREDIT)
            if not ok:
                await _patch(job_id, check_error=why)
            else:
                answered = await NC.look_up(todo)
                await NC.remember(db, todo)
                if answered:
                    await K.charge(db, "lead_phone_check", answered / NC.PER_CREDIT, f"numcheck:{uuid.uuid4().hex[:16]}", f"Number check: {answered} numbers")
                await db.commit()
        return {r["key"]: NC.public(r) for r in rows}


async def _run(org: str, job_id: str) -> None:
    """The whole job, in the background. Never raises: a failure is written on the job."""
    try:
        with org_scope(org):
            async with AsyncSessionLocal() as db:
                job = await db.get(PublicObject, job_id)
                p = dict(job.data["params"])

            async def progress(msg: str) -> None:
                await _patch(job_id, message=msg)

            lead_ids: List[str] = list(p.get("lead_ids") or [])
            contacts: Dict[str, List[Dict[str, Any]]] = {}
            biz_of: Dict[str, str] = {}
            if p["mode"] == "search":
                await _patch(job_id, stage="searching", message="Finding companies")
                async with AsyncSessionLocal() as db:
                    rows = await _find(db, p["filters"], p.get("area"), p["limit"], progress)
                    await _patch(job_id, found=len(rows), message=f"{len(rows)} companies found")
                    if p["contacts"] != "none" and rows:
                        await _patch(job_id, stage="contacts", progress={"done": 0, "total": len(rows)})
                        budget = [MAX_WEB_LOOKUPS]
                        for i, biz in enumerate(rows, 1):
                            contacts[biz.id] = await _contacts_for(db, biz, p["contacts"], budget)
                            if i % 5 == 0 or i == len(rows):
                                await _patch(job_id, progress={"done": i, "total": len(rows)})
                    save = bool(p["checks"]) or p.get("save")
                    if save and rows:
                        await _patch(job_id, stage="saving")
                        biz_of = await _save_leads(db, rows, contacts)
                        lead_ids = list(biz_of.values())
                    await _patch(job_id, contacts={k: v for k, v in contacts.items()},
                                 companies=[{"id": r.id} for r in rows], lead_ids=lead_ids, biz_of=biz_of)
            if lead_ids and ({"company", "email"} & set(p["checks"])):
                await _company_checks(job_id, lead_ids, "email" in p["checks"])
            phone_results: Dict[str, Any] = {}
            if lead_ids and "phone" in p["checks"]:
                await _patch(job_id, stage="checking", message="Checking phone numbers")
                phone_results = await _phone_checks(job_id, lead_ids)
            await _patch(job_id, status="done", stage="done", message="Done", phone_checks=phone_results, finished_at=datetime.utcnow().isoformat() + "Z")
    except Exception as err:
        logger.exception(f"[public-api] lead job {job_id} failed")
        msg = "That search is too broad to finish. Add a town or a narrower sector and try again." if "statement timeout" in str(err).lower() \
            else "The job stopped early. Whatever was found so far is kept."
        try:
            with org_scope(org):
                await _patch(job_id, status="failed", stage="failed", message=msg, error=msg)
        except Exception:
            pass
    finally:
        await _after_job(org, job_id)


async def _after_job(org: str, job_id: str) -> None:
    from app.services.webhook_dispatcher import dispatch_event

    try:
        with org_scope(org):
            async with AsyncSessionLocal() as db:
                o = await db.get(PublicObject, job_id)
                if o:
                    dispatch_event(org, "leads.ready", {"search": await job_view(db, o, org, include_results=False)})
    except Exception as err:
        logger.debug(f"[public-api] leads.ready skipped: {err}")


# ── What a customer sees ─────────────────────────────────────────────────────
def _lead(acc: LeadAccount, biz: Optional[BusinessRecord], people: List[Dict[str, Any]], phone: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    v = acc.verification or {}
    checks: Dict[str, Any] = {}
    if v:
        checks["company"] = {"result": v.get("verdict"), "reasons": v.get("reasons") or []}
        em = v.get("email") or {}
        checks["email"] = {"state": em.get("state"), "address": em.get("found") or None, "note": em.get("note") or ""}
        checks["website"] = {"state": (v.get("website") or {}).get("state")}
        if not phone:
            checks["phone"] = {"state": (v.get("phone") or {}).get("state"), "note": (v.get("phone") or {}).get("note") or ""}
    if phone:
        checks["phone"] = {"state": phone.get("status"), "line_type": phone.get("line_type"), "carrier": phone.get("carrier"), "match": phone.get("match")}
    return {
        "id": acc.id, "name": acc.name, "registration_number": (biz.registration_number if biz else "") or "",
        "status": (biz.status if biz else "") or "", "address": (biz.address if biz else "") or "", "postcode": (biz.postcode if biz else "") or "",
        "industry": acc.industry or "", "website": acc.website or "", "phone": acc.phone or "", "email": acc.email or "",
        "contacts": people, "checks": checks, "source": acc.source or "", "created_at": (acc.created_at.isoformat() + "Z") if acc.created_at else None,
    }


async def job_view(db: AsyncSession, o: PublicObject, org: str, include_results: bool = True, limit: int = 25, offset: int = 0) -> Dict[str, Any]:
    d = dict(o.data or {})
    status = d.get("status", "running")
    if status == "running" and o.updated_at and datetime.utcnow() - o.updated_at > STALLED_AFTER:
        status = "failed"
        d["message"] = "The job stopped (the server restarted). Start it again; leads already found are saved."
    out: Dict[str, Any] = {
        "id": o.id, "status": status, "stage": d.get("stage"), "message": d.get("message", ""), "progress": d.get("progress"),
        "found": d.get("found", len(d.get("lead_ids") or [])), "estimate": d.get("estimate"),
        "credits_charged": d.get("charged"), "error": d.get("error") or d.get("check_error"),
        "created_at": (o.created_at.isoformat() + "Z") if o.created_at else None,
    }
    if d.get("test"):
        out["test"] = True
    if not include_results:
        return out
    ids = list(d.get("lead_ids") or [])
    if d.get("test"):
        out["results"] = page_of(d["sandbox_results"][offset: offset + limit + 1], limit, offset)
        return out
    biz_of = {v: k for k, v in (d.get("biz_of") or {}).items()}
    if ids:
        accs = {a.id: a for a in (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(ids[offset: offset + limit + 1])))).scalars().all()}
        biz_ids = [a.business_record_id for a in accs.values() if a.business_record_id]
        bizs = {b.id: b for b in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(biz_ids)))).scalars().all()} if biz_ids else {}
        rows = [_lead(accs[i], bizs.get(accs[i].business_record_id), (d.get("contacts") or {}).get(biz_of.get(i, ""), []),
                      (d.get("phone_checks") or {}).get(i)) for i in ids[offset: offset + limit + 1] if i in accs]
    elif d.get("companies"):  # found but not saved: plain companies, no checks
        from app.services import lead_filters

        found = [c["id"] for c in d["companies"]][offset: offset + limit + 1]
        bizs = {b.id: b for b in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(found)))).scalars().all()}
        rows = []
        for i in found:
            b = bizs.get(i)
            if b:
                c = lead_filters.card(b)
                rows.append({"id": None, "name": c["name"], "registration_number": c["registration_number"], "status": c["status"],
                             "address": c["address"], "postcode": c["postcode"], "industry": c["industry"], "website": c["website"],
                             "phone": c["phone"], "email": c["email"], "contacts": (d.get("contacts") or {}).get(i, []), "checks": {}, "source": "search"})
    else:
        rows = []
    out["results"] = page_of(rows, limit, offset)
    return out


def _sandbox_job(db: AsyncSession, body: SearchIn) -> PublicObject:
    place = ((body.towns or [""])[0] or "Testville").title()
    word = (body.keyword if isinstance(body.keyword, str) else (body.keyword or [""])[0]) or (body.sector if isinstance(body.sector, str) else "") or "Sample"
    checks = set(body.checks)
    results = []
    for i in range(1, min(body.limit, 5) + 1):
        contact = {"name": "Alex Test", "role": "director", "source": "registry"}
        results.append({
            "id": f"lead_test_{i}", "name": f"{word.title()} {place} Ltd {i}", "registration_number": f"TEST{i:04d}", "status": "active",
            "address": f"{i} High Street, {place}", "postcode": "TE1 1ST", "industry": word, "website": f"https://example{i}.test",
            "phone": f"+4420790000{i:02d}", "email": f"hello@example{i}.test", "contacts": [] if body.contacts == "none" else [contact],
            "checks": {**({"company": {"result": "verified", "reasons": ["Test result"]}} if checks & {"company", "email"} else {}),
                       **({"email": {"state": "verified", "address": f"alex@example{i}.test", "note": "Test result"}} if "email" in checks else {}),
                       **({"phone": {"state": "mobile" if i % 2 else "landline", "line_type": "test", "carrier": "Test Carrier"}} if "phone" in checks else {})},
            "source": "test"})
    return PublicObject(id=f"{SANDBOX}{uuid.uuid4().hex[:10]}", kind="sandbox_lead_job", data={
        "test": True, "status": "done", "stage": "done", "message": "Done (test data)", "found": len(results), "sandbox_results": results,
        "estimate": None, "charged": 0})


# ── Routes ───────────────────────────────────────────────────────────────────
@router.post("/searches", status_code=202)
async def create_search(body: SearchIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Find companies, get their contacts and check them in one job. Use estimate_only to see the cost first."""
    ctx = await authorize(request, db, "leads:search", "leads")
    org = ctx["org_id"]
    filters = _clean_filters(body)
    if not body.area and not any(filters.get(k) for k in ("keyword", "sector", "sic_codes", "towns", "postcode_prefixes")):
        fail(422, "need_a_filter", "Add at least a keyword, sector, SIC code, town, postcode or a drawn area to search.")
    if body.area and (len(body.area) < 3 or any(len(pt) != 2 for pt in body.area)):
        fail(422, "invalid_area", "An area needs three or more [lat, lng] corners.")
    contacts = "officers" if ("email" in body.checks and body.contacts == "none") else body.contacts
    if is_test(ctx):
        if body.estimate_only:
            return {"estimate": {"credits_at_most": 0, "breakdown": {}, "can_afford": True, "note": "Test keys are free."}}
        o = _sandbox_job(db, body)
        db.add(o)
        await db.commit()
        from app.services.webhook_dispatcher import dispatch_event

        dispatch_event(org, "leads.ready", {"search": await job_view(db, o, org, include_results=False)}, test=True)
        return await job_view(db, o, org)
    est = await estimate(db, body.limit, contacts, body.checks)
    if body.estimate_only:
        return {"estimate": est, "filters": filters}
    if not est["can_afford"]:
        fail(402, "insufficient_credits", "You do not have enough Leads credits for everything you asked for. "
             "Ask for fewer companies or checks, or top up.", estimate=est, top_up_url=links.fix_url("billing"))
    o = PublicObject(id=f"lsearch_{uuid.uuid4().hex[:12]}", kind="lead_job", data={
        "status": "running", "stage": "queued", "message": "Starting", "estimate": est,
        "params": {"mode": "search", "filters": filters, "area": body.area, "limit": body.limit, "contacts": contacts,
                   "checks": body.checks, "save": bool(body.checks)}})
    db.add(o)
    await db.commit()
    task = asyncio.get_running_loop().create_task(_run(org, o.id))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return await job_view(db, o, org, include_results=False)


@router.get("/searches/{search_id}")
async def get_search(search_id: str, request: Request, limit: int = 25, cursor: str = "", db: AsyncSession = Depends(get_db)):
    """Progress while it runs; the companies, contacts and check results (paged) once there are some."""
    ctx = await authorize(request, db, "leads:search", "leads")
    o = await db.get(PublicObject, search_id)
    if not o or o.kind not in ("lead_job", "sandbox_lead_job"):
        fail(404, "not_found", f"Search '{search_id}' not found.")
    lim, off = page_args(limit, cursor)
    return await job_view(db, o, ctx["org_id"], True, lim, off)


@router.post("")
async def import_leads(body: ImportIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Add your own leads. One lead (name, phone, email, company, notes), or a list in `leads`, optionally checked."""
    ctx = await authorize(request, db, "leads:search", "leads")
    org = ctx["org_id"]
    if not body.leads:
        if not (body.name or "").strip():
            fail(422, "invalid_request", "Send `leads` (a list) or `name` (one lead).")
        # The original form: one lead for calling, saved as a prospect.
        note = "\n".join(x for x in ((f"Company: {body.company.strip()}" if body.company else ""), (body.notes or "").strip()) if x)
        p = Prospect(id=f"p_{uuid.uuid4().hex[:10]}", name=body.name.strip(), phone=body.phone or "", email=body.email or "", note=note,
                     status="queued", created_at=datetime.utcnow())
        db.add(p)
        await db.commit()
        await db.refresh(p)
        # Pass this lead_id to call.start or meeting.book and the call and the meeting are saved against the same contact.
        return {"lead_id": p.id, "name": p.name, "phone": p.phone, "company": body.company or "", "status": p.status,
                "created_at": p.created_at.isoformat()}
    if is_test(ctx):
        results = [{"id": f"lead_test_{i}", "name": x.name, "phone": x.phone or "", "email": x.email or "", "website": x.website or "",
                    "contacts": [], "checks": {c: {"state": "verified"} for c in body.checks}, "source": "test"} for i, x in enumerate(body.leads, 1)]
        return {"added": len(results), "skipped": 0, "data": results, "estimate": None}
    est = await estimate(db, len(body.leads), "none", body.checks, with_contact=sum(1 for x in body.leads if len((x.contact_name or "").split()) >= 2))
    if body.estimate_only:
        return {"estimate": est}
    if not est["can_afford"]:
        fail(402, "insufficient_credits", "You do not have enough credits for those checks.", estimate=est, top_up_url=links.fix_url("billing"))
    from app.api.lead_accounts import AccountIn, AccountsIn, add_accounts

    saved = await add_accounts(AccountsIn(accounts=[AccountIn(
        name=x.name, website=x.website or "", phone=x.phone or "", email=x.email or "", contact_name=x.contact_name or "",
        contact_title=x.contact_title or "", industry=x.industry or "", region=x.region or "", notes=x.notes or "", source="import")
        for x in body.leads]), db)
    ids = [a["id"] for a in saved["accounts"]]
    if not body.checks:
        return {"added": saved["added"], "skipped": saved["skipped"], "data": saved["accounts"]}
    names = {x.name.strip().lower() for x in body.leads}
    everyone = [a.id for a in (await db.execute(select(LeadAccount))).scalars().all() if (a.name or "").strip().lower() in names]
    o = PublicObject(id=f"lsearch_{uuid.uuid4().hex[:12]}", kind="lead_job", data={
        "status": "running", "stage": "queued", "message": "Starting checks", "estimate": est, "lead_ids": everyone,
        "params": {"mode": "import", "checks": body.checks, "lead_ids": everyone, "contacts": "none"}})
    db.add(o)
    await db.commit()
    task = asyncio.get_running_loop().create_task(_run(org, o.id))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    from fastapi.responses import JSONResponse

    return JSONResponse(await job_view(db, o, org, include_results=False) | {"added": saved["added"], "skipped": saved["skipped"]}, status_code=202)


@router.get("")
async def list_leads(request: Request, q: str = "", limit: int = 25, cursor: str = "", db: AsyncSession = Depends(get_db)):
    """Your saved leads, newest first, with any check results."""
    ctx = await authorize(request, db, "leads:search", "leads")
    lim, off = page_args(limit, cursor)
    if is_test(ctx):
        return page_of([], lim, off)
    query = select(LeadAccount).order_by(LeadAccount.created_at.desc())
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.where(LeadAccount.name.ilike(like) | LeadAccount.domain.ilike(like) | LeadAccount.email.ilike(like))
    accs = (await db.execute(query.offset(off).limit(lim + 1))).scalars().all()
    biz_ids = [a.business_record_id for a in accs if a.business_record_id]
    bizs = {b.id: b for b in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(biz_ids)))).scalars().all()} if biz_ids else {}
    return page_of([_lead(a, bizs.get(a.business_record_id), [], None) for a in accs], lim, off)


# ── Lists, contacts for one company, and finding one person's email ─────────────────────────────
class ListBody(BaseModel):
    name: str = Field("", max_length=80)
    ids: List[str] = Field(default_factory=list, description="Saved lead ids to put in the list")


class ListChange(BaseModel):
    name: Optional[str] = Field(None, max_length=80)
    add: List[str] = Field(default_factory=list)
    remove: List[str] = Field(default_factory=list)


class CompanyContactsIn(BaseModel):
    include_web: bool = Field(False, description="Also look on the web for a website and phone. Costs 1 Leads credit, only when something is found.")


class EmailFindIn(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=80)
    last_name: str = Field(..., min_length=1, max_length=80)
    company_name: str = Field("", max_length=200)
    domain: str = Field(..., min_length=3, max_length=200, description="The company's web address, e.g. example.com")


async def _app_call(coro):
    """Run one of the app's own handlers and turn its plain-words refusals into this API's errors."""
    from fastapi import HTTPException

    try:
        return await coro
    except HTTPException as err:
        code = {402: "insufficient_credits", 404: "not_found", 409: "already_exists"}.get(err.status_code, "invalid_request")
        fail(err.status_code if err.status_code in (400, 402, 404, 409, 502, 503) else 422, code, str(err.detail))


@router.get("/lists")
async def lists_get(request: Request, db: AsyncSession = Depends(get_db)):
    """Your lists of saved leads, with the lead ids in each."""
    from app.api.lead_lists import all_lists

    ctx = await authorize(request, db, "leads:search", "leads")
    if is_test(ctx):
        return {"lists": [], "simulated": True}
    return await all_lists(db)


@router.post("/lists", status_code=201)
async def lists_create(body: ListBody, request: Request, db: AsyncSession = Depends(get_db)):
    from app.api.lead_lists import ListIn, create

    ctx = await authorize(request, db, "leads:search", "leads")
    if is_test(ctx):
        return {"list": {"id": "lst_test", "name": body.name, "ids": body.ids}, "simulated": True}
    return await _app_call(create(ListIn(name=body.name, ids=body.ids), db))


@router.patch("/lists/{list_id}")
async def lists_change(list_id: str, body: ListChange, request: Request, db: AsyncSession = Depends(get_db)):
    """Rename a list, and add or remove leads."""
    from app.api.lead_lists import ListPatch, change

    ctx = await authorize(request, db, "leads:search", "leads")
    if is_test(ctx):
        return {"list": {"id": list_id, "name": body.name or "", "ids": body.add}, "simulated": True}
    return await _app_call(change(list_id, ListPatch(name=body.name, add=body.add, remove=body.remove), db))


@router.delete("/lists/{list_id}")
async def lists_delete(list_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Delete a list. The leads in it stay saved."""
    from app.api.lead_lists import delete

    ctx = await authorize(request, db, "leads:search", "leads")
    if is_test(ctx):
        return {"ok": True, "simulated": True}
    return await _app_call(delete(list_id, db))


@router.post("/companies/{company_id}/contacts")
async def company_contacts_get(company_id: str, body: CompanyContactsIn, request: Request, db: AsyncSession = Depends(get_db)):
    """The people on a company's official record (free), what we hold for it, and, if asked, website and phone found on the web.
    `company_id` is the `id` of a company in search results."""
    from app.api.lead_accounts import ContactsIn, company_contacts

    ctx = await authorize(request, db, "leads:search", "leads")
    if is_test(ctx):
        return {"company": {"id": company_id, "name": "Test Ltd"}, "officers": [], "stored": {}, "web": None, "simulated": True}
    return await _app_call(company_contacts(company_id, ContactsIn(include_web=body.include_web), db))


@router.post("/email-find")
async def email_find(body: EmailFindIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Find one named person's work email at a company. 1 Leads credit when one is found, nothing when not."""
    from app.services.enrichment_waterfall import lookup_person_waterfall

    ctx = await authorize(request, db, "leads:search", "leads")
    if is_test(ctx):
        return {"found": True, "email": f"{body.first_name}.{body.last_name}@{body.domain}".lower(), "verification_status": "verified", "simulated": True}
    result = await lookup_person_waterfall(db=db, org_id=ctx["org_id"], first_name=body.first_name, last_name=body.last_name,
                                           company_name=body.company_name, domain=body.domain, mission_id=None, prospect_id=None)
    if result.get("error") == "insufficient_credits":
        fail(402, "insufficient_credits", result["detail"], top_up_url=links.fix_url("billing"))
    if result.get("error") in ("bad_input", "not_configured"):
        fail(422 if result["error"] == "bad_input" else 503, result["error"], result["detail"])
    return result
