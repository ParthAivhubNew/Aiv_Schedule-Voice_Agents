"""Social working with Lead Gen and Voice: who engaged, booking links on posts, event and recap posts,
ideas from the leads and calls the organisation already has, and booking from a lead.
"""
from __future__ import annotations

import re
import time
import uuid
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api.connected import need
from app.api.connected_home import allowed, require
from app.core.tenancy import current_org
from app.database import get_db
from app.models.models import (
    CallLog,
    EmailCampaign,
    EmailEnrollment,
    EmailSequenceStep,
    LeadAccount,
    Meeting,
    MeetingEventType,
    SocialEngager,
    SocialPost,
)
from app.public_api import book_page
from app.services import connection_handlers as H
from app.services import connections as C
from app.services import social_engagement as SE
from app.services.identity import lead_phone

router = APIRouter(tags=["Connections"])


async def _post(db: AsyncSession, post_id: str) -> SocialPost:
    post = await db.get(SocialPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="That post doesn't exist any more.")
    return post


def post_url(post: SocialPost) -> str:
    for r in post.publish_results or []:
        if r.get("url"):
            return str(r["url"])
    return ""


# ── Engagers (SL-1, SL-6) ───────────────────────────────────────────────────
@router.get("/social/posts/{post_id}/engagers")
async def post_engagers(post_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    await _post(db, post_id)
    rows = (await db.execute(select(SocialEngager).where(SocialEngager.post_id == post_id).order_by(SocialEngager.at.desc()).limit(500))).scalars().all()
    ent = (await C.availability(db, current_org()))["plugins"]
    return {"engagers": [SE.view(e) for e in rows], "can_add_to_leads": bool(ent.get("leads")) and allowed(request, "leadgen", "full"),
            "can_call": bool(ent.get("leads") and ent.get("voice"))}


@router.post("/social/posts/{post_id}/engagers/refresh")
async def refresh_engagers(post_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    post = await _post(db, post_id)
    out = await SE.refresh_post(db, post)
    await db.commit()
    return out


class PersonIn(BaseModel):
    name: str = ""
    handle: str = ""
    company: str = ""
    text: str = ""
    network: str = ""
    kind: str = "comment"
    profile_url: str = ""


class PeopleIn(BaseModel):
    people: List[PersonIn]


@router.post("/social/posts/{post_id}/engagers")
async def add_engagers(post_id: str, body: PeopleIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """People who engaged that the networks do not let us read: added by hand or from a file."""
    await _post(db, post_id)
    people = [{"name": p.name.strip(), "handle": (p.handle or p.name).strip(), "company": p.company.strip(), "text": p.text.strip(),
               "kind": p.kind if p.kind in ("comment", "reaction", "share", "reply") else "comment", "profile_url": p.profile_url.strip()}
              for p in body.people[:500] if (p.name or p.handle).strip()]
    network = (body.people[0].network if body.people else "") or "manual"
    new = await SE.save_engagers(db, post_id, network.lower(), people)
    await SE.link_warm(db, post_id)
    await db.commit()
    return {"added": new}


class ToListIn(BaseModel):
    ids: List[str]
    list_name: str = SE.LIST_NAME


@router.post("/social/engagers/to-list")
async def engagers_to_list(body: ToListIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    require(request, "leadgen", "full")
    await need(db, "social", "leads")
    if not body.ids:
        raise HTTPException(status_code=400, detail="Pick at least one person.")
    out = await SE.add_to_list(db, body.ids[:500], (body.list_name or SE.LIST_NAME).strip()[:80])
    await db.commit()
    return out


@router.get("/social/audience")
async def audience(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    rows = (await db.execute(select(SocialEngager).order_by(SocialEngager.at.desc()).limit(500))).scalars().all()
    return {"engagers": [SE.view(e) for e in rows]}


# ── Booking links on posts (SV-3) ───────────────────────────────────────────
class LinkIn(BaseModel):
    slug: str = "15-min-discovery"


@router.post("/social/posts/{post_id}/booking-link")
async def post_booking_link(post_id: str, body: LinkIn = LinkIn(), db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    await need(db, "social", "voice")
    await _post(db, post_id)
    return {"url": book_page.booking_url(current_org(), post_id=post_id, slug=body.slug)}


@router.get("/social/posts/{post_id}/bookings")
async def post_bookings(post_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Meetings that came from this post's link."""
    rows = (await db.execute(select(Meeting).where(Meeting.source_post_id == post_id).order_by(Meeting.created_at.desc()))).scalars().all()
    return {"count": len(rows), "meetings": [{"id": m.id, "name": m.prospect, "date": m.date, "time": m.time, "status": m.status} for m in rows]}


@router.get("/social/booking-credit")
async def booking_credit(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Meetings credited to each post, most first."""
    rows = (await db.execute(select(Meeting.source_post_id, func.count(Meeting.id)).where(Meeting.source_post_id.is_not(None)).group_by(Meeting.source_post_id)
                             .order_by(func.count(Meeting.id).desc()).limit(20))).all()
    titles = {p.id: p.title for p in (await db.execute(select(SocialPost).where(SocialPost.id.in_([r[0] for r in rows])))).scalars().all()} if rows else {}
    return {"posts": [{"post_id": pid, "title": titles.get(pid, ""), "meetings": int(n)} for pid, n in rows]}


# ── Drafts: event, objection and recap posts (SV-4, SV-2, SV-5) ─────────────
async def _draft(db: AsyncSession, request: Request, post_id: str, title: str, copy: str, channels: Optional[List[str]] = None) -> Dict[str, Any]:
    """A post waiting for approval, like any post: the user reads it, edits it and approves it."""
    from app.api.scheduler import create_post_endpoint

    payload = {"id": post_id, "title": title[:140], "copy": copy, "channels": channels or ["linkedin"], "status": "awaiting_approval",
               "slotDateMs": time.time() * 1000 + 2 * 86400000, "time": "10:00", "theme": "Connected"}
    res = await create_post_endpoint(payload, request, db)
    return res.get("post") or {"id": post_id}


class EventPostIn(BaseModel):
    slug: str = ""
    when: str = ""        # words the user wants in the post, e.g. "Thursday 20 November, 11:00"
    channels: List[str] = []


@router.post("/social/event-post")
async def event_post(body: EventPostIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """"Announce this event": a draft post with a tracked sign-up link, from a calendar event type."""
    await need(db, "social", "voice")
    ev = (await db.execute(select(MeetingEventType).where(MeetingEventType.slug == body.slug))).scalars().first() if body.slug else \
        (await db.execute(select(MeetingEventType).where(MeetingEventType.is_active.is_(True)).order_by(MeetingEventType.length.desc()).limit(1))).scalars().first()
    if not ev:
        raise HTTPException(status_code=404, detail="Add an event in your calendar first.")
    post_id = f"post_{uuid.uuid4().hex[:8]}"
    link = book_page.booking_url(current_org(), post_id=post_id, slug=ev.slug)
    when = f" {body.when.strip()}." if body.when.strip() else ""
    desc = (ev.description or "").strip()
    copy = (f"Join us: {ev.title} ({ev.length} min).{when}\n\n" + (desc + "\n\n" if desc else "") + f"Pick a time that suits you: {link}")
    return {"post": await _draft(db, request, post_id, f"Join us: {ev.title}", copy, body.channels or None), "link": link}


OBJECTIONS: Dict[str, Dict[str, Any]] = {
    "price": {"label": "Price and budget", "pattern": r"too expensive|cost|price|budget|afford|cheaper",
              "title": "What does it really cost?", "angle": "Answer the price question openly: what is included, what is not, and what to compare."},
    "timing": {"label": "Not the right time", "pattern": r"not the right time|too busy|maybe later|call (me )?back later|next quarter|next month",
               "title": "Is now the right time?", "angle": "Explain what waiting costs and how little time starting takes."},
    "already_have": {"label": "Already have a supplier", "pattern": r"already have|current (provider|supplier)|existing supplier|happy with (our|what)",
                     "title": "Already have someone? Here is what to compare", "angle": "Give a fair checklist for comparing without saying anyone is wrong."},
    "send_info": {"label": "Send me information", "pattern": r"send (me )?(an? )?(email|info|details)|email me",
                  "title": "The short version", "angle": "A plain summary of what you do, who it is for and what happens next."},
    "wrong_person": {"label": "Not the right person", "pattern": r"not my department|decision.?maker|not the right person|speak to",
                     "title": "Who should hear about this at your company?", "angle": "Say who usually decides, and give them something to forward."},
}


@router.get("/social/objections")
async def objections(request: Request, days: int = 60, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """What people said no to on calls, counted, with a post idea for each."""
    await need(db, "social", "voice")
    since = datetime.utcnow() - timedelta(days=max(7, min(days, 365)))
    logs = (await db.execute(select(CallLog).where(CallLog.created_at >= since).order_by(CallLog.created_at.desc()).limit(400))).scalars().all()
    counts: Counter = Counter()
    for l in logs:
        said = " ".join(C.their_lines(l.transcript or [])).lower()
        for key, o in OBJECTIONS.items():
            if re.search(o["pattern"], said):
                counts[key] += 1
    return {"days": days, "calls": len(logs), "objections": [
        {"key": k, "label": OBJECTIONS[k]["label"], "calls": n, "title": OBJECTIONS[k]["title"], "angle": OBJECTIONS[k]["angle"]} for k, n in counts.most_common()]}


class ObjectionPostIn(BaseModel):
    key: str
    channels: List[str] = []


@router.post("/social/objection-post")
async def objection_post(body: ObjectionPostIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    await need(db, "social", "voice")
    o = OBJECTIONS.get(body.key)
    if not o:
        raise HTTPException(status_code=400, detail="Unknown question.")
    copy = (f"{o['title']}\n\nWe hear this a lot: {o['label'].lower()}.\n\n[Write your honest answer here. {o['angle']}]\n\n"
            "Questions? Reply and we will answer them.")
    return {"post": await _draft(db, request, f"post_{uuid.uuid4().hex[:8]}", o["title"], copy, body.channels or None)}


class RecapIn(BaseModel):
    meeting_id: str
    permission: bool = False   # the other person agreed to be mentioned
    channels: List[str] = []


@router.post("/social/recap-post")
async def recap_post(body: RecapIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """A thank-you draft after a meeting. It names the other side only when the user confirms they agreed."""
    await need(db, "social", "voice")
    m = await db.get(Meeting, body.meeting_id)
    if not m:
        raise HTTPException(status_code=404, detail="That meeting doesn't exist any more.")
    who = f" {m.prospect}" if body.permission and m.prospect else " a customer"
    note = (m.outcome or m.prep or "").strip()
    copy = f"Thank you to{who} for their time this week.\n\n" + (f"{note[:400]}\n\n" if note else "") + "[Add what you took from the conversation.]"
    return {"post": await _draft(db, request, f"post_{uuid.uuid4().hex[:8]}", "Thank you", copy, body.channels or None),
            "named": bool(body.permission)}


# ── Topic ideas and best times (SL-4, SV-6) ─────────────────────────────────
async def _sector_names(db: AsyncSession, raws: List[str]) -> Dict[str, str]:
    """Industry codes saved on leads (e.g. 45212) as the words the company register uses
    ("Sale of used cars and light motor vehicles"). Text that is not a code is kept as it is."""
    import re

    from app.models.models import BusinessRecord

    out: Dict[str, str] = {}
    for raw in raws:
        code = raw.strip()
        if not re.fullmatch(r"\d{4,5}", code):
            out[raw] = raw
            continue
        try:
            text = (await db.execute(select(BusinessRecord.sic_text).where(BusinessRecord.sic_codes.like(f"%|{code}|%"))
                                     .limit(1))).scalar() or ""
        except Exception:
            text = ""
        m = re.search(code + r"\s*-\s*([^|;,\d][^|;\d]*)", text)
        out[raw] = m.group(1).strip().rstrip(".") if m else ""
    return out


def _short(name: str) -> str:
    """A register description short enough for a headline: the part before any "and"/"other" tail."""
    name = name.strip()
    for cut in (" n.e.c", " not elsewhere", ", except", " (", " except "):
        if cut in name:
            name = name.split(cut)[0]
    return name[:60].strip(" ,")


@router.get("/social/topic-ideas")
async def topic_ideas(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Ideas from the sectors and towns the organisation is actually prospecting."""
    await need(db, "social", "leads")
    leads = (await db.execute(select(LeadAccount))).scalars().all()
    sectors = Counter(a.industry.strip() for a in leads if (a.industry or "").strip())
    regions = Counter(a.region.strip().title() for a in leads if (a.region or "").strip())
    names = await _sector_names(db, [s for s, _ in sectors.most_common(4)])
    town = regions.most_common(1)[0][0] if regions else ""
    where = f" in {town}" if town else ""
    ideas = []
    for raw, n in sectors.most_common(4):
        name = _short(names.get(raw) or "")
        if not name:
            continue  # an industry code we cannot put into words would make a meaningless headline
        low = name[0].lower() + name[1:] if not name[:2].isupper() else name
        ideas.append({"title": f"What {low} businesses{where} ask us most", "why": f"{n} of your saved companies work in {low}.",
                      "sector": name, "kind": "sector", "count": n})
        ideas.append({"title": f"3 things {low} owners get wrong about following up with customers",
                      "why": f"{low[0].upper() + low[1:]} is one of your biggest groups of saved companies.", "sector": name, "kind": "sector", "count": n})
    for t, n in regions.most_common(2):
        ideas.append({"title": f"Working with businesses in {t}", "why": f"{n} of your saved companies are in {t}.", "sector": "",
                      "kind": "town", "count": n})
    return {"ideas": ideas[:8]}


@router.get("/social/best-times")
async def best_times(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Posting times that miss the user's meetings, from where the last two months of meetings fell."""
    await need(db, "social", "voice")
    since = datetime.utcnow() - timedelta(days=60)
    busy: Counter = Counter()
    for m in (await db.execute(select(Meeting).where(Meeting.created_at >= since))).scalars().all():
        try:
            day = datetime.strptime(m.date[:10], "%Y-%m-%d").weekday()
            busy[(day, int(m.time[:2]))] += 1
        except Exception:
            continue
    names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    good_hours = (8, 12, 17, 9, 16)  # when feeds are busy and a working day is not
    out = []
    for day in (1, 2, 3, 0, 4):
        free = [h for h in good_hours if busy[(day, h)] == 0 and busy[(day, h - 1)] == 0]
        if free:
            out.append({"day": names[day], "time": f"{free[0]:02d}:00", "meetings_nearby": 0})
    return {"suggestions": out[:5], "meetings_checked": sum(busy.values())}


# ── Proof for emails (SL-5) ─────────────────────────────────────────────────
@router.get("/leads/proof-blocks")
async def proof_blocks(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Recent published posts that can be dropped into an email as a block."""
    await need(db, "social", "leads")
    posts = (await db.execute(select(SocialPost).where(SocialPost.status == "published").order_by(SocialPost.created_at.desc()).limit(8))).scalars().all()
    return {"blocks": [{"post_id": p.id, "title": p.title, "text": (p.copy or "")[:240].strip(), "url": post_url(p),
                        "block": f"We recently shared: “{(p.title or '').strip()}”" + (f" {post_url(p)}" if post_url(p) else "")} for p in posts]}


# ── Post to a list (SL-2) ───────────────────────────────────────────────────
class ShareIn(BaseModel):
    list_id: str
    note: str = ""


@router.post("/social/posts/{post_id}/share-to-list")
async def share_post_to_list(post_id: str, body: ShareIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """A short email to a list with the post's link. Made as a draft campaign: the user checks it and presses Start,
    and the normal sender then spreads it over mailboxes, hours and daily limits."""
    require(request, "email", "full")
    await need(db, "social", "leads")
    from app.api import lead_lists as L

    post = await _post(db, post_id)
    url = post_url(post)
    if not url:
        raise HTTPException(status_code=400, detail="This post isn't published yet, so there is no link to share.")
    hit = next((l for l in await L._load(db) if l["id"] == body.list_id), None)
    if not hit:
        raise HTTPException(status_code=404, detail="That list doesn't exist any more.")
    leads = (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(hit["ids"])))).scalars().all()
    camp = EmailCampaign(id=f"cp_{uuid.uuid4().hex[:12]}", name=f"Share: {post.title[:80]}", status="draft", mailbox_ids=[], alias_map={}, timezone_policy="org")
    db.add(camp)
    await db.flush()
    note = body.note.strip() or "I thought you might find this useful:"
    db.add(EmailSequenceStep(id=f"st_{uuid.uuid4().hex[:12]}", campaign_id=camp.id, step_number=1, channel="email", delay_days=0, delay_hours=0,
                             subject=post.title[:200] or "Something we shared", body_template=f"Hi {{{{first_name}}}},\n\n{note}\n\n{post.title}\n{url}\n\nThanks"))
    added, skipped = 0, 0
    seen = set()
    for a in leads:
        addr = (a.email or "").strip().lower()
        if not addr or addr in seen or await C.block_for(db, email=addr, registry_id=a.registry_id or "", channel="email"):
            skipped += 1
            continue
        seen.add(addr)
        first = (a.contact_name or "").split()[0] if (a.contact_name or "").strip() else ""
        db.add(EmailEnrollment(id=f"en_{uuid.uuid4().hex[:12]}", campaign_id=camp.id, lead_id=a.id, email=addr, first_name=first,
                               company=a.name[:160], current_step=1, status="active", next_action_at=datetime.utcnow()))
        added += 1
    await db.commit()
    return {"campaign_id": camp.id, "people": added, "skipped": skipped}


# ── Booking from a lead (LC-1, LC-3, LC-5) ──────────────────────────────────
@router.get("/leads/booking-link")
async def lead_booking_link(request: Request, lead_id: str = "", slug: str = "15-min-discovery", db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """The link to put in an email. With a lead id the page is filled in for them and the meeting is saved against them."""
    await need(db, "leads", "voice")
    if lead_id and not await db.get(LeadAccount, lead_id):
        raise HTTPException(status_code=404, detail="That company doesn't exist any more.")
    return {"url": book_page.booking_url(current_org(), lead_id=lead_id, slug=slug), "merge_tag": "{{booking_link}}"}


@router.get("/leads/accounts/{lead_id}/slots")
async def lead_slots(lead_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Free times in the lead's own time zone, as text to paste into a reply, plus the booking link."""
    await need(db, "leads", "voice")
    if not await db.get(LeadAccount, lead_id):
        raise HTTPException(status_code=404, detail="That company doesn't exist any more.")
    ref = {"lead_id": lead_id, "post_id": "", "slug": "15-min-discovery"}
    week, _lead, tz = await book_page.view(db, ref)
    lines = [f"{d['label']}: " + ", ".join(s["time"] for s in d["open"][:4]) for d in week[:3] if d["open"]]
    url = book_page.booking_url(current_org(), lead_id=lead_id)
    text = ("Here are some times that could suit you (" + tz + "):\n" + "\n".join(lines) + f"\n\nOr pick your own: {url}") if lines else f"You can pick a time here: {url}"
    return {"timezone": tz, "lines": lines, "text": text, "url": url}


@router.get("/leads/slots-by-email")
async def slots_by_email(email: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Free times to offer someone who replied to an email, found through the company behind that address."""
    await need(db, "leads", "voice")
    lead = await C.lead_for(db, email=email)
    ref = {"lead_id": lead.id if lead else "", "post_id": "", "slug": "15-min-discovery"}
    week, _lead, tz = await book_page.view(db, ref)
    lines = [f"{d['label']}: " + ", ".join(s["time"] for s in d["open"][:4]) for d in week[:3] if d["open"]]
    url = book_page.booking_url(current_org(), lead_id=ref["lead_id"])
    text = ("Here are some times that could suit you (" + tz + "):\n" + "\n".join(lines) + f"\n\nOr pick your own: {url}") if lines else f"You can pick a time here: {url}"
    return {"timezone": tz, "lines": lines, "text": text, "url": url, "lead_id": ref["lead_id"]}


class FromLeadIn(BaseModel):
    lead_id: str
    date: str
    time: str
    slug: str = "15-min-discovery"
    email: str = ""
    notes: str = ""


@router.post("/meetings/from-lead")
async def meeting_from_lead(body: FromLeadIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.services.calendar_service import calendar_service

    await need(db, "leads", "voice")
    lead = await db.get(LeadAccount, body.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="That company doesn't exist any more.")
    email = (body.email or lead.email or "").strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="This company has no email address to send the invitation to. Add one first.")
    res = await calendar_service.create_booking(db, prospect_name=lead.contact_name or lead.name, attendee_email=email, date_str=body.date,
                                                time_str=body.time, event_type_slug=body.slug, notes=body.notes, mission_name="Booked from Lead Gen",
                                                prospect_phone=lead_phone(lead))
    if not res.get("success"):
        raise HTTPException(status_code=409, detail=res.get("message") or "That time isn't free.")
    meeting = await db.get(Meeting, res["bookingId"])
    if meeting:
        meeting.lead_id = lead.id
        await H.on_meeting_booked(db, meeting)
        await db.commit()
    return res
