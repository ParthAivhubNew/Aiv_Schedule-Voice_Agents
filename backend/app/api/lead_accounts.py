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

from app.api.enrichment import _can_research, _charge_leads
from app.database import get_db
from app.models.models import LeadAccount
from app.services.enrichment_service import _host_of, enrich_prospect_intelligence

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


def _out(a: LeadAccount) -> Dict[str, Any]:
    return {
        "id": a.id, "name": a.name, "domain": a.domain or "", "website": a.website or "", "phone": a.phone or "",
        "email": a.email or "", "contact_name": a.contact_name or "", "contact_title": a.contact_title or "",
        "industry": a.industry or "", "region": a.region or "", "notes": a.notes or "", "source": a.source or "manual",
        "source_url": a.source_url or "", "research": a.research or None,
        "researched_at": a.researched_at.isoformat() + "Z" if a.researched_at else None,
        "created_at": a.created_at.isoformat() + "Z" if a.created_at else None,
    }


async def _account(db: AsyncSession, account_id: str) -> LeadAccount:
    row = (await db.execute(select(LeadAccount).where(LeadAccount.id == account_id))).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="That account is not in your saved accounts.")
    return row


@router.get("/accounts")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(LeadAccount).order_by(LeadAccount.created_at.desc()))).scalars().all()
    return {"accounts": [_out(a) for a in rows]}


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
    return _out(row)


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db)):
    row = await _account(db, account_id)
    await db.delete(row)
    await db.commit()
    return {"ok": True}


@router.post("/accounts/{account_id}/research")
async def research_account(account_id: str, db: AsyncSession = Depends(get_db)):
    """Research one company on the web (1 Leads credit when anything is found). Fills only the
    fields that are still empty; what the user or an earlier run saved is never overwritten."""
    row = await _account(db, account_id)
    await _can_research(db)
    try:
        data = await enrich_prospect_intelligence(name=row.contact_name or row.name, company=row.name,
                                                  domain=row.domain or row.website or None, person=row.contact_name or None)
    except Exception:
        raise HTTPException(status_code=502, detail=f"Couldn't research {row.name} right now. Nothing was charged; try again in a minute.")
    people = [{"name": _clean(p.get("name"), 120), "role": _clean(p.get("roleHint"), 120), "source": p.get("source") or ""}
              for p in (data.get("keyPeople") or []) if p.get("name")]
    found = bool(data.get("phones") or data.get("emails") or people or data.get("socials")
                 or (data.get("overview") and data.get("overview") != "No detailed summary found."))
    overview = data.get("overview") or ""
    row.research = {
        "overview": "" if overview == "No detailed summary found." else _clean(overview, 2000),
        "people": people,
        "phones": [p for p in (data.get("phones") or [])][:5],
        "emails": [e for e in (data.get("emails") or [])][:5],
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
    row.researched_at = row.updated_at = datetime.utcnow()
    await db.commit()
    if found:
        await _charge_leads(db, 1, f"Researched {row.name}")
    return _out(row)
