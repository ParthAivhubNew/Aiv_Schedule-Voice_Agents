"""Connections between Lead Gen, Voice and Social: what the organisation can use together, the
switches for it, the do-not-contact list, one timeline per contact, and calling Lead Gen companies.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.tenancy import current_org
from app.database import get_db
from app.models.models import (
    CallLog,
    ContactEvent,
    DoNotContact,
    EmailEnrollment,
    LeadAccount,
    Meeting,
    Notification,
)
from app.services import connection_handlers as H
from app.services import connections as C
from app.services import lead_calls as LC
from app.services.identity import lead_phone

router = APIRouter(tags=["Connections"])


# ── Plan checks ─────────────────────────────────────────────────────────────
def calling_rights(request: Request, level: str) -> None:
    """Placing calls needs the Calling section as well as Leads (roles: Viewers can look, not dial)."""
    from app.core import permissions as P
    from app.core.auth_middleware import current

    ctx = current(request)
    if not (ctx.get("is_admin") or P.allows(ctx.get("perms") or {}, "calling", level)):
        raise HTTPException(status_code=403, detail="Your role can't make calls. Ask an admin to give you Calling access.")


async def need(db: AsyncSession, *plugins: str) -> None:
    """402 naming the first plugin the organisation does not have."""
    ent = (await C.availability(db, current_org()))["plugins"]
    missing = [p for p in plugins if not ent.get(p)]
    if missing:
        label = C.PLUGIN_LABEL[missing[0]]
        raise HTTPException(status_code=402, detail={
            "error": "service_not_subscribed", "code": "service_not_subscribed", "service": missing[0],
            "message": f"This needs the {label} plan. Add {label} to use it."})


@router.get("/together/availability")
async def get_availability(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Which plugins this organisation has and which links between them it can use now."""
    return await C.availability(db, current_org())


@router.get("/together/rules")
async def get_rules(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    return {"rules": await C.get_rules(db), "defaults": C.DEFAULT_RULES}


class RulesIn(BaseModel):
    rules: Dict[str, Any] = {}


@router.put("/together/rules")
async def put_rules(body: RulesIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    return {"rules": await C.save_rules(db, body.rules)}


# ── Do-not-contact ──────────────────────────────────────────────────────────
def _dnc_view(r: DoNotContact) -> Dict[str, Any]:
    return {"id": r.id, "name": r.name or "", "phone": r.phone or "", "email": r.email or "",
            "domain": r.domain if not r.email else "", "channels": r.channels or [], "reason": r.reason or "",
            "source": r.source or "manual", "at": r.at.isoformat() + "Z" if r.at else None}


@router.get("/compliance/do-not-contact")
async def list_dnc(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """The one list, plus entries that only exist on the older call and email lists."""
    rows = (await db.execute(select(DoNotContact).order_by(DoNotContact.at.desc()).limit(2000))).scalars().all()
    out = [_dnc_view(r) for r in rows]
    seen_p = {r.phone for r in rows if r.phone}
    seen_e = {r.email for r in rows if r.email}
    from app.models.models import ContactRegistry, EmailSuppression

    for reg in (await db.execute(select(ContactRegistry).where(ContactRegistry.do_not_call.is_(True)))).scalars().all():
        phones = [p if isinstance(p, str) else (p or {}).get("number", "") for p in (reg.phones or [])]
        if any(C.normalize_phone_digits(p) in seen_p for p in phones if p):
            continue
        out.append({"id": f"reg:{reg.id}", "name": reg.canonical_name, "phone": phones[0] if phones else "", "email": "", "domain": "",
                    "channels": ["call"], "reason": "Asked on a call", "source": "call",
                    "at": reg.updated_at.isoformat() + "Z" if reg.updated_at else None})
    org = current_org()
    for s in (await db.execute(select(EmailSuppression).where(or_(EmailSuppression.org_id == org, EmailSuppression.org_id.is_(None))).limit(2000))).scalars().all():
        if s.email in seen_e:
            continue
        out.append({"id": f"sup:{s.id}", "name": "", "phone": "", "email": s.email, "domain": s.domain or "", "channels": ["email"],
                    "reason": s.reason, "source": "email_unsubscribe" if s.reason == "unsubscribe" else s.source, "at": s.created_at.isoformat() + "Z" if s.created_at else None})
    return {"entries": out}


class DncIn(BaseModel):
    phone: str = ""
    email: str = ""
    domain: str = ""
    name: str = ""
    reason: str = ""
    channels: List[str] = Field(default_factory=lambda: ["call", "email", "social"])


@router.post("/compliance/do-not-contact")
async def add_dnc(body: DncIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    if not (body.phone.strip() or body.email.strip() or body.domain.strip()):
        raise HTTPException(status_code=400, detail="Give a phone number, an email address or a domain.")
    channels = [c for c in body.channels if c in ("call", "email", "social")] or ["call", "email", "social"]
    entry = await C.add_block(db, phone=body.phone, email=body.email, domain=body.domain, name=body.name[:120],
                              reason=body.reason or "Added by hand", source="manual", channels=channels)
    for lead in await _leads_matching(db, body.phone, body.email, body.domain):
        lead.stage = "do_not_contact"
        await C.record_event(db, "status", lead_id=lead.id, ref_id=f"dnc:{entry.id}", summary="Added to the do-not-contact list")
    await db.commit()
    return {"entry": _dnc_view(entry)}


async def _leads_matching(db: AsyncSession, phone: str, email: str, domain: str) -> List[LeadAccount]:
    found: List[LeadAccount] = []
    if phone:
        hit = await C.lead_for(db, phone=phone)
        if hit:
            found.append(hit)
    if email:
        hit = await C.lead_for(db, email=email)
        if hit and hit not in found:
            found.append(hit)
    if domain:
        for r in (await db.execute(select(LeadAccount).where(LeadAccount.domain == domain.lower()))).scalars().all():
            if r not in found:
                found.append(r)
    return found


@router.delete("/compliance/do-not-contact/{entry_id}")
async def remove_dnc(entry_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.models.models import ContactRegistry, EmailSuppression

    if entry_id.startswith("reg:"):
        reg = await db.get(ContactRegistry, entry_id[4:])
        if not reg:
            raise HTTPException(status_code=404, detail="That entry doesn't exist any more.")
        reg.do_not_call = False
    elif entry_id.startswith("sup:"):
        sup = await db.get(EmailSuppression, entry_id[4:])
        if not sup:
            raise HTTPException(status_code=404, detail="That entry doesn't exist any more.")
        await db.delete(sup)
    else:
        row = await db.get(DoNotContact, entry_id)
        if not row:
            raise HTTPException(status_code=404, detail="That entry doesn't exist any more.")
        digits = row.phone
        email = row.email
        await db.delete(row)
        await db.flush()
        # The mirrors on the older call and email lists go too, or the number would stay blocked.
        from app.models.models import ContactRegistry

        if digits:
            for reg in (await db.execute(select(ContactRegistry).where(ContactRegistry.do_not_call.is_(True)))).scalars().all():
                if any(C.normalize_phone_digits(p if isinstance(p, str) else (p or {}).get("number", "")) == digits for p in (reg.phones or [])):
                    reg.do_not_call = False
        if email:
            for sup in (await db.execute(select(EmailSuppression).where(EmailSuppression.email == email))).scalars().all():
                await db.delete(sup)
    await db.commit()
    return {"ok": True}


# ── Lead view with its connection fields ────────────────────────────────────
HISTORY_FILTERS = ("never", "no_answer", "interested", "recent", "called")


def call_state(a: LeadAccount) -> Dict[str, Any]:
    """Why this company can or cannot be called right now (without the live checks)."""
    if a.stage == "do_not_contact":
        return {"can_call": False, "blocked_reason": "do_not_contact"}
    if not lead_phone(a):
        return {"can_call": False, "blocked_reason": "no_phone"}
    if LC.phone_state(a) == "invalid":
        return {"can_call": False, "blocked_reason": "failed_check"}
    return {"can_call": True, "blocked_reason": ""}


def connection_fields(a: LeadAccount) -> Dict[str, Any]:
    iso = lambda d: d.isoformat() + "Z" if d else None
    return {
        "stage": a.stage or "new", "registry_id": a.registry_id or "", "last_call_outcome": a.last_call_outcome or "",
        "last_called_at": iso(a.last_called_at), "last_contact_at": iso(a.last_contact_at), "next_action": a.next_action or "",
        "next_action_at": iso(a.next_action_at), "best_time": a.best_time or "", "suggestions": a.suggestions or [],
        "source_post_id": a.source_post_id or "", **call_state(a),
    }


def history_bucket(a: LeadAccount, days: int = 14) -> str:
    """never / no_answer / interested / recent / called, for the Call history filters."""
    if not a.last_called_at:
        return "never"
    if (a.stage or "") in ("interested", "meeting", "won"):
        return "interested"
    if a.last_called_at > datetime.utcnow() - timedelta(days=days):
        return "recent"
    if (a.last_call_outcome or "") in ("no_answer", "busy", "left_voicemail"):
        return "no_answer"
    return "called"


# ── Timeline, suggestions, stage ────────────────────────────────────────────
@router.get("/contacts/{contact_id}/timeline")
async def contact_timeline(contact_id: str, kinds: str = "", db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Everything that happened with one contact. The id is a Lead Gen company id or a contact-record id."""
    wanted = [k for k in kinds.split(",") if k] or None
    lead = await db.get(LeadAccount, contact_id)
    events = await C.timeline(db, lead_id=contact_id, registry_id=(lead.registry_id if lead and lead.registry_id else contact_id), kinds=wanted)
    out: Dict[str, Any] = {"events": events}
    if lead:
        out["lead"] = {"id": lead.id, "name": lead.name, **connection_fields(lead)}
        meetings = (await db.execute(select(Meeting).where(Meeting.lead_id == lead.id).order_by(Meeting.created_at.desc()))).scalars().all()
        out["meetings"] = [{"id": m.id, "date": m.date, "time": m.time, "status": m.status, "video_link": m.video_link,
                            "call_id": m.call_id, "outcome": m.outcome} for m in meetings]
        logs = (await db.execute(select(CallLog).where(CallLog.lead_id == lead.id).order_by(CallLog.created_at.desc()).limit(50))).scalars().all()
        out["calls"] = [{"id": c.id, "outcome": c.outcome, "duration": c.duration, "started_at": c.started_at,
                         "summary": c.summary or "", "has_transcript": bool(c.transcript)} for c in logs]
    return out


@router.get("/leads/accounts/{lead_id}/timeline")
async def lead_timeline(lead_id: str, kinds: str = "", db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    return await contact_timeline(lead_id, kinds, db)


class SuggestionIn(BaseModel):
    accept: bool = True


@router.post("/leads/accounts/{lead_id}/suggestions/{suggestion_id}")
async def resolve_suggestion(lead_id: str, suggestion_id: str, body: SuggestionIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    lead = await db.get(LeadAccount, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="That company doesn't exist any more.")
    if not await H.resolve_suggestion(db, lead, suggestion_id, body.accept):
        raise HTTPException(status_code=404, detail="That suggestion is already handled.")
    await db.commit()
    return {"lead": {"id": lead.id, **connection_fields(lead)}}


class StageIn(BaseModel):
    stage: str
    note: str = ""


@router.post("/leads/accounts/{lead_id}/stage")
async def set_stage(lead_id: str, body: StageIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    if body.stage not in ("new", "contacted", "interested", "meeting", "won", "lost", "do_not_contact"):
        raise HTTPException(status_code=400, detail="Unknown stage.")
    lead = await db.get(LeadAccount, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="That company doesn't exist any more.")
    lead.stage = body.stage
    await C.record_event(db, "status", lead_id=lead.id, registry_id=lead.registry_id or "", ref_id=f"stage:{datetime.utcnow().timestamp()}",
                         summary=f"Moved to {body.stage.replace('_', ' ')}" + (f": {body.note[:120]}" if body.note else ""))
    if body.stage == "do_not_contact":
        await C.add_block(db, phone=lead.phone, email=lead.email, registry_id=lead.registry_id or "", name=lead.name,
                          reason=body.note or "Marked by hand", source="manual")
    await db.commit()
    return {"lead": {"id": lead.id, **connection_fields(lead)}}


class NoteIn(BaseModel):
    text: str


@router.post("/leads/accounts/{lead_id}/notes")
async def add_note(lead_id: str, body: NoteIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    lead = await db.get(LeadAccount, lead_id)
    if not lead or not body.text.strip():
        raise HTTPException(status_code=404 if not lead else 400, detail="Write a note first." if lead else "That company doesn't exist any more.")
    ev = await C.record_event(db, "note", lead_id=lead.id, registry_id=lead.registry_id or "", ref_id=f"note:{datetime.utcnow().timestamp()}", summary=body.text.strip()[:500])
    await db.commit()
    return {"event": C.event_view(ev)}


# ── Calling Lead Gen companies ──────────────────────────────────────────────
class CallIn(BaseModel):
    ids: List[str] = []
    hooks: Dict[str, str] = {}            # lead id -> the opening line the user edited
    override_recontact: bool = False
    from_number: Optional[str] = None
    concurrency: int = 2
    title: str = ""
    accept_low_minutes: bool = False


async def _list_ids(db: AsyncSession, list_id: str) -> List[str]:
    from app.api import lead_lists as L

    if list_id == "all":
        return list((await db.execute(select(LeadAccount.id).order_by(LeadAccount.created_at))).scalars().all())
    hit = next((l for l in await L._load(db) if l["id"] == list_id), None)
    if not hit:
        raise HTTPException(status_code=404, detail="That list doesn't exist any more.")
    return list(hit["ids"])


async def _leads(db: AsyncSession, ids: List[str]) -> List[LeadAccount]:
    if not ids:
        return []
    rows = (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(ids)))).scalars().all()
    order = {i: n for n, i in enumerate(ids)}
    return sorted(rows, key=lambda a: order.get(a.id, 0))


def _skip_text(plan: Dict[str, Any]) -> str:
    parts = [f"{len(v)} {LC.SKIP_WORDS[k]}" for k, v in plan["skipped"].items() if v]
    return ", ".join(parts)


async def _preview(db: AsyncSession, leads: List[LeadAccount], body: CallIn) -> Dict[str, Any]:
    await need(db, "leads", "voice")
    plan = await LC.plan_calls(db, leads, override_recontact=body.override_recontact)
    by_id = {a.id: a for a in leads}
    plan["people"] = [{"id": i, "name": by_id[i].name, "phone": lead_phone(by_id[i]), "contact": by_id[i].contact_name or "",
                       "opening_line": LC.opening_line(by_id[i]), "warning": plan["warnings"].get(i, "")} for i in plan["callable"]]
    plan["skipped_text"] = _skip_text(plan)
    plan["cost"] = await LC.cost_preview(db, len(plan["callable"]))
    await db.commit()  # the contact-record links found while planning
    return plan


async def _start(db: AsyncSession, leads: List[LeadAccount], body: CallIn, title: str, list_id: Optional[str]) -> Dict[str, Any]:
    plan = await _preview(db, leads, body)
    if not plan["callable"]:
        raise HTTPException(status_code=400, detail=("Nobody here can be called right now: " + plan["skipped_text"] + ".") if plan["skipped_text"] else "Nobody to call.")
    if not body.accept_low_minutes:
        from app.services.credits import short_call_warning

        warn = await short_call_warning(db, calls=len(plan["callable"]))
        if warn:
            raise HTTPException(status_code=409, detail=warn)
    chosen = await _leads(db, plan["callable"])
    try:
        res = await LC.start_calls(db, chosen, title=title, list_id=list_id, hooks=body.hooks, from_number=body.from_number,
                                   concurrency=1 if len(chosen) == 1 else max(1, min(body.concurrency, 5)))
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {**res, "called": len(plan["callable"]), "skipped": plan["skipped"], "skipped_text": plan["skipped_text"]}


@router.post("/leads/lists/{list_id}/call-preview")
async def list_call_preview(list_id: str, request: Request, body: CallIn = CallIn(), db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    calling_rights(request, "view")
    return await _preview(db, await _leads(db, await _list_ids(db, list_id)), body)


@router.post("/leads/lists/{list_id}/call")
async def list_call(list_id: str, request: Request, body: CallIn = CallIn(), db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    calling_rights(request, "full")
    from app.api import lead_lists as L

    leads = await _leads(db, await _list_ids(db, list_id))
    name = "All companies" if list_id == "all" else next((l["name"] for l in await L._load(db) if l["id"] == list_id), "list")
    return await _start(db, leads, body, body.title.strip() or f"Calls: {name}", None if list_id == "all" else list_id)


@router.post("/leads/accounts/call-preview")
async def selected_call_preview(body: CallIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    calling_rights(request, "view")
    return await _preview(db, await _leads(db, body.ids), body)


@router.post("/leads/accounts/call")
async def selected_call(body: CallIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    calling_rights(request, "full")
    leads = await _leads(db, body.ids)
    if not leads:
        raise HTTPException(status_code=400, detail="Pick at least one company.")
    return await _start(db, leads, body, body.title.strip() or f"Calls: {len(leads)} selected", None)


@router.post("/leads/accounts/{lead_id}/call-now")
async def call_now(lead_id: str, request: Request, body: CallIn = CallIn(), db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    calling_rights(request, "full")
    lead = await db.get(LeadAccount, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="That company doesn't exist any more.")
    body.override_recontact = True  # a person pressing Call on one company means it
    return await _start(db, [lead], body, f"Call: {lead.name}", None)


@router.post("/leads/accounts/{lead_id}/call-preview")
async def one_call_preview(lead_id: str, request: Request, body: CallIn = CallIn(), db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    calling_rights(request, "view")
    lead = await db.get(LeadAccount, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="That company doesn't exist any more.")
    body.override_recontact = True
    return await _preview(db, [lead], body)
