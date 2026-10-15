"""The booking page: a signed link a lead opens from an email, a post or a text, picks a free time on, and books.

No sign-in. The link names the organisation, optionally the lead and the social post it came from, so
the meeting is saved against both. Times are shown in the lead's own time zone; the owner's calendar
stays in the account time zone.
"""
from __future__ import annotations

import html
import re
from typing import Any, Dict, Optional

from app.public_api import links
from app.services.approval_mail import _page

BOOK_TTL_S = 60 * 24 * 3600
KIND = "book"
SLUG_OK = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")


def encode(lead_id: str = "", post_id: str = "", slug: str = "15-min-discovery") -> str:
    return f"{lead_id}|{post_id}|{slug}"


def decode(raw: str) -> Dict[str, str]:
    parts = (raw or "").split("|")
    parts += [""] * (3 - len(parts))
    slug = parts[2] if SLUG_OK.match(parts[2] or "") else "15-min-discovery"
    return {"lead_id": parts[0], "post_id": parts[1], "slug": slug}


def booking_url(org_id: str, lead_id: str = "", post_id: str = "", slug: str = "15-min-discovery") -> str:
    """The link to put in an email, post or text."""
    token = links.make_token(KIND, encode(lead_id, post_id, slug), org_id, ttl_s=BOOK_TTL_S)
    return f"{links.public_base()}/api/p/{token}"


def _esc(v: Any) -> str:
    return html.escape(str(v if v is not None else ""))


def render(week: list, company: str, tz: str, name: str, email: str, notice: str = "", done: Optional[Dict[str, Any]] = None) -> str:
    if done:
        join = f'<div class="row"><a href="{_esc(done["join_url"])}"><button class="ok" type="button">Open the meeting link</button></a></div>' if done.get("join_url") else ""
        body = (f"<h1>You are booked</h1><div class='sub'>{_esc(company)}</div>"
                f"<div class='card'><div class='meta'>When</div><div class='head'>{_esc(done['when'])}</div>"
                f"<div class='meta'>A confirmation is on its way to {_esc(done['email'])}.</div>{join}</div>")
        return _page("Booked", body)
    banner = f'<div class="card" style="border-color:#B45309"><strong>{_esc(notice)}</strong></div>' if notice else ""
    days = ""
    for d in week:
        slots = "".join(
            f'<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 10px 4px 0;font-size:14px">'
            f'<input type="radio" name="slot" value="{_esc(d["date"])}|{_esc(s["hostTime"])}|{_esc(s["time"])}" required> {_esc(s["time"])}</label>'
            for s in d["open"])
        if slots:
            days += f'<div style="margin-bottom:10px"><div class="meta">{_esc(d["label"])}</div>{slots}</div>'
    if not days:
        days = '<div class="meta">There are no free times in the next few days. Please reply to the message you received and we will find a time.</div>'
    box = 'style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #E6E3DC;border-radius:10px;font:inherit;margin-bottom:8px"'
    form = (f'<form method="post"><div class="card"><div class="head">Pick a time</div>'
            f'<div class="meta">Times are shown in {_esc(tz)}.</div>{days}</div>'
            f'<div class="card"><div class="head">Your details</div>'
            f'<input name="name" required placeholder="Your name" value="{_esc(name)}" {box}>'
            f'<input name="email" required type="email" placeholder="Your email" value="{_esc(email)}" {box}>'
            f'<div class="row"><button class="ok" type="submit">Book this time</button></div></div></form>')
    return _page("Book a time", f"<h1>Book a time with {_esc(company)}</h1><div class='sub'>This link needs no sign-in</div>{banner}{form}")


async def view(db, ref: Dict[str, str]):
    """(week of free slots, the lead if named, the lead's time zone)."""
    from app.models.models import LeadAccount
    from app.services.calendar_service import calendar_service
    from app.services.org_settings import org_timezone
    from app.services.timezone_service import resolve_prospect_timezone

    lead = await db.get(LeadAccount, ref["lead_id"]) if ref["lead_id"] else None
    host_tz = await org_timezone(db)
    tz = resolve_prospect_timezone(phone=getattr(lead, "phone", None), host_tz=host_tz) if lead else host_tz
    week = await calendar_service.get_week_availability(db, days=5, event_type_slug=ref["slug"], prospect_tz=tz)
    return week, lead, tz


async def act(db, org: str, ref: Dict[str, str], form: Dict[str, str], lead, tz: str) -> Dict[str, Any]:
    """Book the chosen time. Returns {"error": text} or {"when","email","join_url"}."""
    from app.models.models import LeadAccount, Meeting
    from app.services.calendar_service import calendar_service

    name = (form.get("name") or "").strip()[:120]
    email = (form.get("email") or "").strip().lower()[:200]
    slot = (form.get("slot") or "").split("|")
    if not name or "@" not in email or len(slot) != 3:
        return {"error": "Pick a time and fill in your name and email."}
    date_iso, host_time, shown = slot
    res = await calendar_service.create_booking(
        db, prospect_name=name, attendee_email=email, date_str=date_iso, time_str=host_time,
        event_type_slug=ref["slug"], mission_name="Booking link", prospect_timezone=tz,
        prospect_phone=getattr(lead, "phone", None))
    if not res.get("success"):
        return {"error": res.get("message") or "That time was just taken. Please pick another."}
    meeting = await db.get(Meeting, res["bookingId"])
    if meeting:
        if ref["lead_id"]:
            meeting.lead_id = ref["lead_id"]
        if ref["post_id"]:
            meeting.source_post_id = ref["post_id"]
        if ref["post_id"] and not ref["lead_id"]:
            await _lead_from_booking(db, meeting, name, email, ref["post_id"])
        from app.services.connection_handlers import on_meeting_booked

        await on_meeting_booked(db, meeting)  # again, now that the lead and post are known
        await db.commit()
    return {"when": f"{date_iso} at {shown} ({tz})", "email": email, "join_url": res.get("videoLink") or ""}


async def _lead_from_booking(db, meeting, name: str, email: str, post_id: str) -> None:
    """Someone booked from a post: they become a lead (source Social) when the organisation has Lead Gen."""
    import uuid
    from datetime import datetime

    from app.core.tenancy import current_org
    from app.models.models import LeadAccount
    from app.services import connections as C
    from app.services.entitlement import get_org_entitlements

    if not (await get_org_entitlements(db, current_org())).get("leads"):
        return
    lead = await C.lead_for(db, email=email)
    if lead is None:
        lead = LeadAccount(id=f"la_{uuid.uuid4().hex[:12]}", name=name, contact_name=name, email=email, source="social",
                           stage="meeting", source_post_id=post_id, last_contact_at=datetime.utcnow())
        db.add(lead)
        await db.flush()
    meeting.lead_id = lead.id
    await C.record_event(db, "meeting", lead_id=lead.id, ref_id=meeting.id, summary="Booked from a social post", detail={"post_id": post_id})
