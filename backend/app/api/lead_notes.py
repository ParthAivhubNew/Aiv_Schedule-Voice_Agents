"""Leads: notes on companies and people (shared across the organisation), and the journey a company is in, for the profile's bottom bar."""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import LeadAccount, LeadNote
from app.services import lead_notes as N
from app.services.person_emails import person_key

router = APIRouter(prefix="/leads", tags=["Leads"])


def _who(request: Request) -> Dict[str, Any]:
    from app.core.auth_middleware import current

    return current(request)


class NoteIn(BaseModel):
    company_id: str = ""  # a company store id
    account_id: str = ""  # a saved company's id
    person: str = ""  # the person's register name, for a note on one person
    text: str = ""


class CountsIn(BaseModel):
    company_ids: List[str] = []
    person_keys: List[str] = []  # each "<company id>|<person name>"


TIMELINE_REF = "leadnote:"  # a team note's line on the company's timeline, so deleting the note removes the line too


async def _on_timeline(db: AsyncSession, company: "N.Company", row: LeadNote, person: str) -> None:
    """A team note also shows on the timeline of each saved record of the company, under Notes."""
    from app.services import connections as C

    summary = f"On {person}: {row.text}" if person else row.text
    for lead in company.leads:
        await C.record_event(db, "note", lead_id=lead.id, registry_id=lead.registry_id or "", ref_id=TIMELINE_REF + row.id, summary=summary[:500])


@router.get("/notes")
async def list_notes(request: Request, company_id: str = "", account_id: str = "", db: AsyncSession = Depends(get_db)):
    ctx = _who(request)
    if not (company_id or account_id):
        raise HTTPException(status_code=400, detail="Say which company.")
    company = await N.resolve(db, company_id, account_id)
    return await N.notes_for(db, company, ctx.get("operator_id", ""), bool(ctx.get("is_admin")))


@router.post("/notes")
async def add_note(body: NoteIn, request: Request, db: AsyncSession = Depends(get_db)):
    from app.core.tenancy import current_org

    ctx = _who(request)
    try:
        text = N.clean_text(body.text)
    except N.NoteError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if not (body.company_id or body.account_id):
        raise HTTPException(status_code=400, detail="Say which company the note is about.")
    company = await N.resolve(db, body.company_id, body.account_id)
    key = company.key
    if not (key["business_record_id"] or key["lead_account_id"]):
        raise HTTPException(status_code=404, detail="That company isn't there any more.")
    who = person_key(body.person)
    row = LeadNote(org_id=current_org(), target_kind="person" if who else "company", person_key=who, text=text,
                   author_user_id=ctx.get("operator_id", ""), author_name=(ctx.get("name") or ctx.get("username") or "")[:120], **key)
    db.add(row)
    await db.flush()
    await _on_timeline(db, company, row, body.person.strip() if who else "")
    await db.commit()
    return {"note": N.view(row, ctx.get("operator_id", ""), bool(ctx.get("is_admin")))}


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _who(request)
    if note_id.startswith(N.EARLIER_PREFIX):
        lead = await db.get(LeadAccount, note_id[len(N.EARLIER_PREFIX):])
        if not lead:
            raise HTTPException(status_code=404, detail="That note isn't there any more.")
        lead.notes = ""
        await db.commit()
        return {"ok": True}
    row = await db.get(LeadNote, note_id)
    if not row:
        raise HTTPException(status_code=404, detail="That note isn't there any more.")
    if not (ctx.get("is_admin") or (row.author_user_id and row.author_user_id == ctx.get("operator_id"))):
        raise HTTPException(status_code=403, detail="Only the person who wrote a note, or an admin, can delete it.")
    from sqlalchemy import delete

    from app.models.models import ContactEvent

    await db.execute(delete(ContactEvent).where(ContactEvent.ref_id == TIMELINE_REF + row.id))
    await db.delete(row)
    await db.commit()
    return {"ok": True}


@router.post("/notes/counts")
async def note_counts(body: CountsIn, request: Request, db: AsyncSession = Depends(get_db)):
    _who(request)
    if len(body.company_ids) > N.MAX_BATCH or len(body.person_keys) > N.MAX_BATCH:
        raise HTTPException(status_code=400, detail=f"Ask for up to {N.MAX_BATCH} at a time.")
    return await N.counts(db, body.company_ids, body.person_keys)


# ── The journey a company is in (the bottom bar) ─────────────────────────────
class JourneyAddIn(BaseModel):
    company_id: str = ""
    account_id: str = ""
    journey_id: str


@router.get("/company-journeys")
async def company_journeys(request: Request, company_id: str = "", account_id: str = "", db: AsyncSession = Depends(get_db)):
    """The journeys the company's saved record is in, running ones first."""
    from app.models.models import EmailCampaign, EmailEnrollment

    _who(request)
    company = await N.resolve(db, company_id, account_id)
    if not company.leads:
        return {"journeys": [], "saved": False}
    emails = [x.email.lower() for x in company.leads if x.email]
    cond = [EmailEnrollment.lead_id.in_([x.id for x in company.leads])]
    if emails:
        cond.append(func.lower(EmailEnrollment.email).in_(emails))
    rows = (await db.execute(select(EmailEnrollment, EmailCampaign).join(EmailCampaign, EmailCampaign.id == EmailEnrollment.campaign_id).where(or_(*cond)))).all()
    from app.models.models import EmailSequenceStep

    totals = dict((await db.execute(select(EmailSequenceStep.campaign_id, func.count(EmailSequenceStep.id))
                                    .where(EmailSequenceStep.campaign_id.in_({c.id for _, c in rows})).group_by(EmailSequenceStep.campaign_id))).all()) if rows else {}
    seen, out = set(), []
    for e, c in rows:
        if c.id in seen:
            continue
        seen.add(c.id)
        out.append({"id": c.id, "name": c.name, "status": c.status, "person_status": e.status, "step": e.current_step, "steps_total": totals.get(c.id, 0),
                    "next_at": e.next_action_at.isoformat() + "Z" if e.next_action_at else None})
    out.sort(key=lambda j: (j["person_status"] != "active", j["status"] != "running"))
    return {"journeys": out, "saved": True}


@router.post("/journey-add")
async def journey_add(body: JourneyAddIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Puts the company in a journey. A company linked to the company store goes through the store's path (it saves it first if needed);
    a saved company with no store record is written to at its saved contact."""
    from app.api.lead_accounts import JourneyIn, company_add_to_journey
    from app.core.tenancy import current_org
    from app.models.models import EmailCampaign
    from app.services import journeys as J

    _who(request)
    company = await N.resolve(db, body.company_id, body.account_id)
    if company.business_ids:
        return await company_add_to_journey(sorted(company.business_ids)[0], JourneyIn(journey_id=body.journey_id), db)
    if not company.leads:
        raise HTTPException(status_code=404, detail="That company isn't there any more.")
    lead = company.leads[0]
    camp = (await db.execute(select(EmailCampaign).where(EmailCampaign.id == body.journey_id))).scalars().first()
    if not camp:
        raise HTTPException(status_code=404, detail="That journey isn't there any more.")
    parts = (lead.contact_name or "").split()
    person = {"email": lead.email or "", "first_name": parts[0] if parts else "", "last_name": " ".join(parts[1:]), "company": lead.name, "lead_id": lead.id}
    out = await J.enrol(db, camp, [person], current_org())
    await db.commit()
    if not out["added"]:
        why = next((k for k, n in out["skipped"].items() if n), "")
        words = {"invalid": "It has no email address yet, so an email journey can't write to it. Find one first.", "duplicate": "It is already in that journey.",
                 "do_not_email": "It is on your do-not-email list.", "in_another_journey": "It is already in another running journey.", "no_contact": "It has no contact details."}
        raise HTTPException(status_code=400, detail=words.get(why, "It couldn't be added."))
    return {"added": out["added"], "journey": camp.name, "status": camp.status}
