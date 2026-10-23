"""The views that sit across all three plugins: pipeline, what to do next, search, one inbox, exports,
merging duplicates, workflow rules, the setup checklist, and filling in links for data that already exists.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core import permissions as P
from app.core.auth_middleware import current
from app.core.tenancy import current_org
from app.database import get_db
from app.models.models import (
    CallLog,
    ContactEvent,
    ContactRegistry,
    EmailEnrollment,
    EmailMailbox,
    EmailMessage,
    LeadAccount,
    LiveCall,
    Meeting,
    Prospect,
    SocialEngager,
    SocialPost,
)
from app.services import connections as C
from app.services import workflows as W
from app.services.identity import lead_phone, match_lead_to_registry

router = APIRouter(tags=["Connections"])
W.register()  # workflow rules listen to the event bus from the moment the app starts


def allowed(request: Request, section: str, level: str = "view") -> bool:
    ctx = current(request)
    return bool(ctx.get("is_admin")) or P.allows(ctx.get("perms") or {}, section, level)


def require(request: Request, section: str, level: str = "view") -> None:
    if not allowed(request, section, level):
        raise HTTPException(status_code=403, detail="Your role doesn't include this. Ask an admin.")


def iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() + "Z" if d else None


# ── Signals per lead: opens, engagement, replies ────────────────────────────
async def lead_signals(db: AsyncSession, leads: List[LeadAccount]) -> Dict[str, Dict[str, Any]]:
    since = datetime.utcnow() - timedelta(days=30)
    emails = {a.email.lower(): a.id for a in leads if a.email}
    opens: Dict[str, int] = {}
    last_open: Dict[str, datetime] = {}
    replies: Dict[str, int] = {}
    if emails:
        rows = (await db.execute(select(EmailMessage.recipient_email, func.sum(EmailMessage.open_count), func.max(EmailMessage.last_opened_at),
                                        func.count(EmailMessage.replied_at)).where(
            EmailMessage.is_warmup.is_(False), EmailMessage.created_at >= since,
            func.lower(EmailMessage.recipient_email).in_(list(emails))).group_by(EmailMessage.recipient_email))).all()
        for addr, n, last, rep in rows:
            lid = emails.get((addr or "").lower())
            if lid:
                opens[lid] = int(n or 0)
                if last:
                    last_open[lid] = last
                replies[lid] = int(rep or 0)
    posts = dict((await db.execute(select(ContactEvent.lead_id, func.count(ContactEvent.id)).where(
        ContactEvent.kind == "post", ContactEvent.at >= since, ContactEvent.lead_id.is_not(None)).group_by(ContactEvent.lead_id))).all())
    return {a.id: {"opens": opens.get(a.id, 0), "last_open": last_open.get(a.id), "engagements": int(posts.get(a.id, 0)),
                   "replies": replies.get(a.id, 0)} for a in leads}


# ── Pipeline (X-4) ──────────────────────────────────────────────────────────
def verified(a: LeadAccount) -> bool:
    v = a.verification or {}
    return (v.get("email") or {}).get("state") in C.GOOD_EMAIL_STATES or (v.get("phone") or {}).get("state") in ("ok", "verified")


@router.get("/together/pipeline")
async def pipeline(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Found -> Verified -> Contacted -> Interested -> Meeting -> Won, counted across whatever the organisation owns."""
    rows = (await db.execute(select(LeadAccount))).scalars().all()
    rank = {s: i for i, s in enumerate(C.STAGE_ORDER)}
    reached = lambda a, s: rank.get(a.stage or "new", 0) >= rank[s]
    live = [a for a in rows if (a.stage or "new") not in ("lost", "do_not_contact")]
    steps = [
        ("found", "Found", len(rows)),
        ("verified", "Verified", sum(1 for a in rows if verified(a))),
        ("contacted", "Contacted", sum(1 for a in rows if reached(a, "contacted") or a.last_contact_at)),
        ("interested", "Interested", sum(1 for a in live if reached(a, "interested"))),
        ("meeting", "Meeting", sum(1 for a in live if reached(a, "meeting"))),
        ("won", "Won", sum(1 for a in live if reached(a, "won"))),
    ]
    out, prev = [], None
    for key, label, n in steps:
        out.append({"key": key, "label": label, "count": n, "of_previous": round(100 * n / prev) if prev else None})
        prev = n or None
    meetings_from_posts = (await db.execute(select(func.count(Meeting.id)).where(Meeting.source_post_id.is_not(None)))).scalar() or 0
    return {"stages": out, "lost": sum(1 for a in rows if a.stage == "lost"), "do_not_contact": sum(1 for a in rows if a.stage == "do_not_contact"),
            "meetings_from_posts": int(meetings_from_posts)}


# ── Per-lead connection fields, score and warm flag (VL-10, VL-11, LV-11) ───
@router.get("/together/leads")
async def leads_with_connections(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.api.connected import connection_fields, history_bucket

    rows = (await db.execute(select(LeadAccount))).scalars().all()
    rules = await C.get_rules(db)
    sig = await lead_signals(db, rows)
    out = {}
    for a in rows:
        s = sig[a.id]
        a._last_open = s["last_open"]
        f = connection_fields(a)
        f.update(history=history_bucket(a, int(rules["recontact_days"])), opens=s["opens"], engagements=s["engagements"],
                 score=C.score_lead(a, opens=s["opens"], engagements=s["engagements"], replies=s["replies"]),
                 warm=bool(rules["warm_lead_prompt"]) and (C.is_warm(a, s["opens"], int(rules["warm_opens"])) or (s["engagements"] > 0 and (a.stage or "new") in ("new", "contacted"))))
        out[a.id] = f
    return {"leads": out}


# ── What to do next (X-5) ───────────────────────────────────────────────────
@router.get("/together/next-actions")
async def next_actions(request: Request, limit: int = 5, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ent = (await C.availability(db, current_org()))["plugins"]
    rules = await C.get_rules(db)
    rows = (await db.execute(select(LeadAccount))).scalars().all()
    sig = await lead_signals(db, rows)
    now = datetime.utcnow()
    items: List[Dict[str, Any]] = []
    can_call = bool(ent.get("voice") and ent.get("leads"))
    for a in rows:
        s = sig[a.id]
        a._last_open = s["last_open"]
        if a.next_action_at and a.next_action_at <= now + timedelta(days=1) and (a.stage or "") not in ("do_not_contact", "lost"):
            items.append({"kind": "callback", "priority": 100 if a.next_action_at <= now else 80, "lead_id": a.id, "title": f"{a.next_action or 'Follow up'}: {a.name}",
                          "detail": f"Planned for {a.next_action_at:%a %d %b %H:%M}", "action": "call" if can_call else "open", "locked": not can_call})
        elif rules["warm_lead_prompt"] and C.is_warm(a, s["opens"], int(rules["warm_opens"])):
            items.append({"kind": "warm", "priority": 70 + min(s["opens"], 10), "lead_id": a.id, "title": f"{a.name} opened your email {s['opens']} times",
                          "detail": "A call now is likely to land well.", "action": "call" if can_call else "open", "locked": not can_call})
        elif (a.stage or "") == "interested" and (not a.last_contact_at or a.last_contact_at < now - timedelta(days=3)):
            items.append({"kind": "follow_up", "priority": 60, "lead_id": a.id, "title": f"Follow up with {a.name}", "detail": "Interested, but quiet for 3 days.", "action": "open", "locked": False})
        if a.suggestions:
            items.append({"kind": "suggestions", "priority": 40, "lead_id": a.id, "title": f"{len(a.suggestions)} update(s) found for {a.name}", "detail": "Found on a call. Accept or ignore.", "action": "open", "locked": False})
    for m in (await db.execute(select(Meeting).where(Meeting.status == "needs_outcome").limit(20))).scalars().all():
        items.append({"kind": "meeting_outcome", "priority": 75, "lead_id": m.lead_id or "", "title": f"Record how the meeting with {m.prospect} went", "detail": f"{m.date} {m.time}", "action": "meeting", "meeting_id": m.id, "locked": False})
    items.sort(key=lambda i: -i["priority"])
    return {"items": items[: max(1, min(limit, 20))], "total": len(items), "plugins": ent}


# ── One day across every app ────────────────────────────────────────────────
@router.get("/together/agenda")
async def agenda_for_day(date: str = "", focus: str = "", db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Everything happening on a date for the company, from every app it has, with the `focus` app's items first.
    Every calendar in the product shows this, so no app has to be opened to see what another has planned."""
    import re

    from app.services import agenda as A
    from app.services.org_settings import org_timezone
    from app.services.timezone_service import now_in

    tz = await org_timezone(db)
    day = (date or "").strip() or now_in(tz).strftime("%Y-%m-%d")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(status_code=400, detail="date must look like 2026-10-21.")
    try:
        datetime.fromisoformat(day)
    except ValueError:
        raise HTTPException(status_code=400, detail="That is not a real date.")
    ent = (await C.availability(db, current_org()))["plugins"]
    return await A.day(db, day, (focus or "").strip().lower(), ent, tz)


# ── Search (X-9) ────────────────────────────────────────────────────────────
@router.get("/together/search")
async def search(request: Request, q: str = "", db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    term = q.strip()
    if len(term) < 2:
        return {"query": term, "groups": []}
    like = f"%{term.lower()}%"
    groups: List[Dict[str, Any]] = []
    if allowed(request, "leadgen"):
        rows = (await db.execute(select(LeadAccount).where(or_(func.lower(LeadAccount.name).like(like), func.lower(LeadAccount.contact_name).like(like),
                                                                func.lower(LeadAccount.email).like(like), LeadAccount.phone.like(f"%{term}%"),
                                                                func.lower(LeadAccount.domain).like(like))).limit(8))).scalars().all()
        groups.append({"kind": "lead", "label": "Companies and people", "items": [{"id": a.id, "title": a.name, "detail": a.contact_name or a.email or a.phone, "stage": a.stage or "new"} for a in rows]})
    if allowed(request, "calling"):
        logs = (await db.execute(select(CallLog).where(or_(func.lower(CallLog.canonical_name).like(like), func.lower(CallLog.person_canonical).like(like))).order_by(CallLog.created_at.desc()).limit(8))).scalars().all()
        groups.append({"kind": "call", "label": "Calls", "items": [{"id": c.id, "title": c.canonical_name, "detail": f"{c.outcome} · {c.started_at}", "lead_id": c.lead_id or ""} for c in logs]})
    if allowed(request, "calcom"):
        ms = (await db.execute(select(Meeting).where(or_(func.lower(Meeting.prospect).like(like), func.lower(Meeting.attendee_email).like(like))).order_by(Meeting.created_at.desc()).limit(8))).scalars().all()
        groups.append({"kind": "meeting", "label": "Meetings", "items": [{"id": m.id, "title": m.prospect, "detail": f"{m.date} {m.time} · {m.status}", "lead_id": m.lead_id or ""} for m in ms]})
    if allowed(request, "scheduler"):
        ps = (await db.execute(select(SocialPost).where(or_(func.lower(SocialPost.title).like(like), func.lower(SocialPost.copy).like(like))).limit(8))).scalars().all()
        groups.append({"kind": "post", "label": "Posts", "items": [{"id": p.id, "title": p.title, "detail": p.status} for p in ps]})
    return {"query": term, "groups": [g for g in groups if g["items"]]}


# ── One inbox (X-7) ─────────────────────────────────────────────────────────
@router.get("/together/inbox")
async def inbox(request: Request, limit: int = 40, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Replies, calls that need a person, meeting requests and post comments, newest first, with the contact beside each."""
    items: List[Dict[str, Any]] = []
    leads_by_email: Dict[str, LeadAccount] = {}
    if allowed(request, "email"):
        try:
            replies = (await db.execute(select(EmailMessage).where(EmailMessage.status == "replied", EmailMessage.is_warmup.is_(False))
                                        .order_by(EmailMessage.replied_at.desc()).limit(30))).scalars().all()
            for r in replies:
                lead = leads_by_email.get(r.reply_from) or await C.lead_for(db, email=r.reply_from or r.recipient_email)
                kind = "meeting_request" if r.reply_category in ("interested", "question") else "reply"
                items.append({"type": kind, "id": r.id, "title": f"{r.reply_from or r.recipient_email}: {r.subject}"[:160], "text": r.reply_snippet or "",
                              "category": r.reply_category or "", "at": iso(r.replied_at), "lead_id": lead.id if lead else "", "lead_name": lead.name if lead else ""})
        except Exception as err:  # one source being down must not empty the whole inbox
            logging.getLogger("connections").warning("inbox: %s skipped: %s", 'email', err)
            await db.rollback()
    if allowed(request, "calling"):
        try:
            for c in (await db.execute(select(LiveCall).where(LiveCall.state == "human_review", LiveCall.ended.is_(False)).limit(10))).scalars().all():
                items.append({"type": "needs_human", "id": c.id, "title": f"{c.prospect} needs a person on the call", "text": c.flag or "", "at": iso(c.created_at), "lead_id": c.lead_id or "", "lead_name": c.prospect})
            for l in (await db.execute(select(CallLog).where(CallLog.outcome == "callback_requested").order_by(CallLog.created_at.desc()).limit(10))).scalars().all():
                items.append({"type": "callback", "id": l.id, "title": f"{l.canonical_name} asked for a call back", "text": l.summary or "", "at": iso(l.created_at), "lead_id": l.lead_id or "", "lead_name": l.canonical_name})
        except Exception as err:  # one source being down must not empty the whole inbox
            logging.getLogger("connections").warning("inbox: %s skipped: %s", 'calling', err)
            await db.rollback()
    if allowed(request, "scheduler"):
        try:
            for e in (await db.execute(select(SocialEngager).where(SocialEngager.kind.in_(("comment", "reply"))).order_by(SocialEngager.at.desc()).limit(15))).scalars().all():
                items.append({"type": "comment", "id": e.id, "title": f"{e.name or e.handle} on your {e.network.title()} post", "text": e.text, "at": iso(e.at), "lead_id": e.lead_id or "", "lead_name": e.name or e.handle})
        except Exception as err:  # one source being down must not empty the whole inbox
            logging.getLogger("connections").warning("inbox: %s skipped: %s", 'scheduler', err)
            await db.rollback()
    items.sort(key=lambda i: i["at"] or "", reverse=True)
    return {"items": items[: max(1, min(limit, 100))]}


# ── Export (X-16) ───────────────────────────────────────────────────────────
def _csv(rows: List[List[Any]]) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    for r in rows:
        w.writerow([("'" + str(c) if isinstance(c, str) and c[:1] in "=+-@" else c) for c in r])  # a cell can never run as a formula
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="contacts.csv"'})


@router.get("/contacts/export.csv")
async def export_contacts(request: Request, db: AsyncSession = Depends(get_db)):
    """One row per saved company with the totals of every touch."""
    require(request, "leadgen")
    leads = (await db.execute(select(LeadAccount).order_by(LeadAccount.name))).scalars().all()
    counts: Dict[str, Dict[str, int]] = {}
    for lid, kind, n in (await db.execute(select(ContactEvent.lead_id, ContactEvent.kind, func.count(ContactEvent.id)).where(ContactEvent.lead_id.is_not(None)).group_by(ContactEvent.lead_id, ContactEvent.kind))).all():
        counts.setdefault(lid, {})[kind] = int(n)
    rows: List[List[Any]] = [["Company", "Contact", "Email", "Phone", "Website", "Stage", "Last call outcome", "Last contacted", "Emails", "Calls", "Meetings", "Posts", "Notes", "Source"]]
    for a in leads:
        c = counts.get(a.id, {})
        rows.append([a.name, a.contact_name, a.email, a.phone, a.website, a.stage or "new", a.last_call_outcome or "", a.last_contact_at.date().isoformat() if a.last_contact_at else "",
                     c.get("email", 0), c.get("call", 0), c.get("meeting", 0), c.get("post", 0), c.get("note", 0), a.source])
    return _csv(rows)


@router.get("/contacts/{contact_id}/export.csv")
async def export_one(contact_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    require(request, "leadgen")
    lead = await db.get(LeadAccount, contact_id)
    if not lead:
        raise HTTPException(status_code=404, detail="That company doesn't exist any more.")
    events = await C.timeline(db, lead_id=lead.id, registry_id=lead.registry_id or "", limit=500)
    rows: List[List[Any]] = [["When", "Kind", "What happened", "Company"]] + [[e["at"], e["kind"], e["summary"], lead.name] for e in reversed(events)]
    return _csv(rows)


# ── Duplicates and merging (X-1) ────────────────────────────────────────────
@router.get("/contacts/duplicates")
async def duplicates(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    require(request, "leadgen")
    rows = (await db.execute(select(LeadAccount))).scalars().all()
    by_key: Dict[str, List[LeadAccount]] = {}
    for a in rows:
        for k in C.duplicate_key(a):
            by_key.setdefault(k, []).append(a)
    seen, groups = set(), []
    for k, members in by_key.items():
        ids = tuple(sorted({m.id for m in members}))
        if len(ids) < 2 or ids in seen:
            continue
        seen.add(ids)
        groups.append({"match": k.split(":")[0], "key": k.split(":", 1)[1], "members": [
            {"id": m.id, "name": m.name, "email": m.email, "phone": m.phone, "website": m.website, "stage": m.stage or "new", "created_at": iso(m.created_at)} for m in members]})
    return {"groups": groups[:100]}


class MergeIn(BaseModel):
    keep_id: str
    merge_ids: List[str]


@router.post("/contacts/merge")
async def merge(body: MergeIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Fold other records into the kept one. It keeps its own values, gains what it was missing, and takes over every
    list place, timeline entry, call, meeting and campaign slot."""
    require(request, "leadgen", "full")
    from app.api import lead_lists as L

    keep = await db.get(LeadAccount, body.keep_id)
    others = [o for o in [await db.get(LeadAccount, i) for i in dict.fromkeys(body.merge_ids)] if o and o.id != body.keep_id]
    if not keep or not others:
        raise HTTPException(status_code=404, detail="Pick a company to keep and at least one other to merge into it.")
    ids = {o.id for o in others}
    for o in others:
        for field, value in C.merge_plan(keep, o).items():
            setattr(keep, field, value)
        keep.registry_id = keep.registry_id or o.registry_id
        keep.last_contact_at = max([d for d in (keep.last_contact_at, o.last_contact_at) if d], default=None)
        keep.last_called_at = max([d for d in (keep.last_called_at, o.last_called_at) if d], default=None)
        if C.STAGE_ORDER.index(o.stage if o.stage in C.STAGE_ORDER else "new") > C.STAGE_ORDER.index(keep.stage if keep.stage in C.STAGE_ORDER else "new"):
            keep.stage = o.stage
        if o.stage == "do_not_contact":
            keep.stage = "do_not_contact"
    for model, col in ((ContactEvent, ContactEvent.lead_id), (CallLog, CallLog.lead_id), (Meeting, Meeting.lead_id), (Prospect, Prospect.lead_id),
                       (EmailEnrollment, EmailEnrollment.lead_id), (LiveCall, LiveCall.lead_id), (SocialEngager, SocialEngager.lead_id)):
        for row in (await db.execute(select(model).where(col.in_(ids)))).scalars().all():
            row.lead_id = keep.id
    lists = await L._load(db)
    for l in lists:
        if ids & set(l["ids"]):
            l["ids"] = list(dict.fromkeys([keep.id if i in ids else i for i in l["ids"]]))
    await L._save(db, lists)
    for o in others:
        await db.delete(o)
    await C.record_event(db, "note", lead_id=keep.id, ref_id=f"merge:{'+'.join(sorted(ids))}", summary=f"Merged {len(others)} duplicate record(s) into this one")
    await db.commit()
    return {"kept": keep.id, "merged": len(others)}


# ── Workflow rules (X-8) ────────────────────────────────────────────────────
@router.get("/together/workflows")
async def get_workflows(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    return {"workflows": await W.get_workflows(db), "events": W.EVENTS, "actions": W.ACTIONS, "stages": W.STAGES,
            "call_outcomes": W.CALL_OUTCOMES, "reply_kinds": W.REPLY_KINDS}


class WorkflowsIn(BaseModel):
    workflows: List[Dict[str, Any]] = []


@router.put("/together/workflows")
async def put_workflows(body: WorkflowsIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    clean = await W.save_workflows(db, body.workflows)
    if len(clean) < len(body.workflows[: W.MAX_RULES]):
        raise HTTPException(status_code=400, detail="One of the rules isn't complete. Each needs an event and at least one action with its value.")
    return {"workflows": clean}


# ── Meetings that did not happen (LC-6, VC-3) ───────────────────────────────
@router.post("/meetings/{meeting_id}/no-show")
async def mark_no_show(meeting_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """The other person did not come. Records it and runs the follow-ups switched on in Settings -> Connections."""
    from app.services.connection_jobs import after_no_show

    require(request, "calcom", "full")
    m = await db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(status_code=404, detail="That meeting doesn't exist any more.")
    m.outcome = "no_show"
    m.status = "no_show"
    done = await after_no_show(db, current_org(), m)
    await db.commit()
    return {"meeting_id": m.id, "followed_up": done}


@router.post("/together/weekly-summary/send")
async def send_weekly_now(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Email this week's numbers to the person who asked, whatever their notification choices are."""
    from app.core.mailer import render, send_system_email
    from app.models.models import Operator

    ent = (await C.availability(db, current_org()))["plugins"]
    nums = await weekly_numbers(db)
    labels = [("new_leads", "New companies saved", "leads"), ("emails_sent", "Emails sent", "leads"), ("replies", "Replies", "leads"),
              ("calls", "Calls made", "voice"), ("conversations", "Conversations", "voice"), ("meetings", "Meetings booked", "voice"),
              ("posts", "Posts published", "social")]
    lines = [f"<b>{nums[k]}</b> {label.lower()}" for k, label, plugin in labels if ent.get(plugin)]
    if not lines:
        raise HTTPException(status_code=400, detail="Add a plugin first. There is nothing to summarise yet.")
    op = await db.get(Operator, current(request).get("operator_id"))
    to = (getattr(op, "email", "") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Your account has no email address. Add one in your profile first.")
    msg = render("Your last 7 days across Outreach", lines, None)
    res = await send_system_email(to, "Your last 7 days across Outreach", msg["html"], msg["text"])
    if not res.get("ok"):
        raise HTTPException(status_code=502, detail="We couldn't send the email just now. Try again in a minute.")
    return {"sent": True, "to": to, "lines": len(lines)}


# ── Reactions that failed (so nothing is lost silently) ─────────────────────
@router.get("/together/failed-events")
async def failed_events(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.models.models import PublicObject

    require(request, "company")
    rows = (await db.execute(select(PublicObject).where(PublicObject.kind == "dead_letter").order_by(PublicObject.created_at.desc()).limit(50))).scalars().all()
    return {"events": [{"id": r.id, "event": (r.data or {}).get("event"), "handler": (r.data or {}).get("handler"),
                        "error": (r.data or {}).get("error"), "at": (r.data or {}).get("at")} for r in rows]}


@router.post("/together/failed-events/{event_id}/retry")
async def retry_failed_event(event_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.models.models import PublicObject

    require(request, "company", "full")
    row = await db.get(PublicObject, event_id)
    if not row or row.kind != "dead_letter":
        raise HTTPException(status_code=404, detail="That item is already gone.")
    d = row.data or {}
    handler = next((h for h in C.handlers_for(d.get("event", "")) if h.__name__ == d.get("handler")), None)
    if handler is None:
        await db.delete(row)
        await db.commit()
        return {"ok": True, "ran": False}
    error = await C.run_handler(handler, current_org(), d["event"], d.get("payload") or {})
    if error:
        raise HTTPException(status_code=502, detail=f"It failed again: {error}")
    await db.delete(row)
    await db.commit()
    return {"ok": True, "ran": True}


# ── Setup checklist (X-15) ──────────────────────────────────────────────────
@router.get("/together/checklist")
async def checklist(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.models.models import CompanyProfile, ConnectionRules

    ent = (await C.availability(db, current_org()))["plugins"]
    row = await db.get(ConnectionRules, "default")
    chosen = dict(row.rules or {}) if row else {}
    profile = (await db.execute(select(CompanyProfile).limit(1))).scalars().first()
    mailbox = (await db.execute(select(EmailMailbox.id).where(EmailMailbox.status.in_(("warming", "graduated", "active"))).limit(1))).first()
    steps = [
        {"key": "calendar", "label": "Set your working hours and calendar", "done": bool(profile and getattr(profile, "weekday_start", None)), "needs": ["voice"]},
        {"key": "call_window", "label": "Choose your calling hours", "done": bool(profile and getattr(profile, "call_hours_policy", None)), "needs": ["voice"]},
        {"key": "mailbox", "label": "Connect a mailbox", "done": bool(mailbox), "needs": ["leads"]},
        {"key": "gap", "label": "Choose how long to wait before contacting a company again", "done": "recontact_days" in chosen, "needs": []},
        {"key": "followups", "label": "Decide which follow-ups run by themselves", "done": any(k in chosen for k in ("interested_email", "no_answer_email", "stop_on_booking")), "needs": []},
    ]
    for s in steps:
        s["available"] = all(ent.get(p) for p in s["needs"])
    return {"steps": steps, "done": sum(1 for s in steps if s["done"] or not s["available"]), "total": len(steps)}


# ── Weekly summary (X-16) ───────────────────────────────────────────────────
async def weekly_numbers(db: AsyncSession, days: int = 7) -> Dict[str, int]:
    since = datetime.utcnow() - timedelta(days=days)
    calls = (await db.execute(select(func.count(CallLog.id)).where(CallLog.created_at >= since))).scalar() or 0
    spoke = (await db.execute(select(func.count(CallLog.id)).where(CallLog.created_at >= since, CallLog.outcome.in_(("contacted", "meeting_booked", "callback_requested"))))).scalar() or 0
    meetings = (await db.execute(select(func.count(Meeting.id)).where(Meeting.created_at >= since))).scalar() or 0
    emails = (await db.execute(select(func.count(EmailMessage.id)).where(EmailMessage.created_at >= since, EmailMessage.is_warmup.is_(False)))).scalar() or 0
    replies = (await db.execute(select(func.count(EmailMessage.id)).where(EmailMessage.replied_at >= since))).scalar() or 0
    leads = (await db.execute(select(func.count(LeadAccount.id)).where(LeadAccount.created_at >= since))).scalar() or 0
    posts = (await db.execute(select(func.count(SocialPost.id)).where(SocialPost.status == "published", SocialPost.created_at >= since))).scalar() or 0
    return {"new_leads": int(leads), "emails_sent": int(emails), "replies": int(replies), "calls": int(calls), "conversations": int(spoke),
            "meetings": int(meetings), "posts": int(posts)}


@router.get("/together/weekly-summary")
async def weekly_summary(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ent = (await C.availability(db, current_org()))["plugins"]
    nums = await weekly_numbers(db)
    shown = {"new_leads": ent.get("leads"), "emails_sent": ent.get("leads"), "replies": ent.get("leads"), "calls": ent.get("voice"),
             "conversations": ent.get("voice"), "meetings": ent.get("voice"), "posts": ent.get("social")}
    return {"numbers": {k: v for k, v in nums.items() if shown.get(k)}, "days": 7}


# ── Filling in links for data that already exists (P1 backfill) ─────────────
@router.post("/together/backfill")
async def backfill(request: Request, dry_run: bool = True, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Links existing call targets and call logs to saved companies by phone, and saved companies to contact records.
    Never overwrites a link that is already there. Run with dry_run=true first to see the counts."""
    require(request, "company", "full")
    leads = (await db.execute(select(LeadAccount))).scalars().all()
    by_phone = {}
    for a in leads:
        d = C.normalize_phone_digits(lead_phone(a))
        if len(d) >= 9:
            by_phone.setdefault(d, a)
    registry = [{"id": r.id, "canonical_name": r.canonical_name, "aliases": r.aliases or [], "phones": r.phones or [], "websites": r.websites or [],
                 "do_not_call": bool(r.do_not_call)} for r in (await db.execute(select(ContactRegistry))).scalars().all()]
    counts = {"prospects_linked": 0, "calls_linked": 0, "leads_matched_to_contacts": 0}
    for p in (await db.execute(select(Prospect).where(Prospect.lead_id.is_(None)))).scalars().all():
        hit = by_phone.get(C.normalize_phone_digits(p.phone or ""))
        if hit:
            counts["prospects_linked"] += 1
            if not dry_run:
                p.lead_id = hit.id
    for c in (await db.execute(select(CallLog).where(CallLog.lead_id.is_(None)))).scalars().all():
        reg = c.registry_id
        hit = None
        if reg:
            hit = next((a for a in leads if a.registry_id == reg), None)
        if hit is None and c.canonical_name:
            hit = next((a for a in leads if (a.name or "").strip().lower() == c.canonical_name.strip().lower()), None)
        if hit:
            counts["calls_linked"] += 1
            if not dry_run:
                c.lead_id = hit.id
    for a in leads:
        if a.registry_id:
            continue
        m = match_lead_to_registry(a, registry)
        if m and m.get("registryId"):
            counts["leads_matched_to_contacts"] += 1
            if not dry_run:
                a.registry_id = m["registryId"]
    if not dry_run:
        await db.commit()
    return {"dry_run": dry_run, **counts}
