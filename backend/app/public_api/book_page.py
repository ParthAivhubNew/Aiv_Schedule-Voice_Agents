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


BOOK_CSS = """<style>
.wrap{max-width:1000px}
.bk{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(260px,1fr);gap:14px;align-items:start}
@media(max-width:760px){.bk{grid-template-columns:1fr}}
.strip{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 10px;margin:0 -2px;scroll-snap-type:x proximity}
.dayb{flex:0 0 auto;min-width:74px;text-align:center;padding:8px 6px;border:1px solid #E6E3DC;border-radius:12px;background:#fff;cursor:pointer;scroll-snap-align:start;height:auto;font-weight:400}
.dayb b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#5B6170}
.dayb span{display:block;font-size:20px;font-weight:700;line-height:1.2}
.dayb small{display:block;font-size:11px;color:#0F766E}
.dayb.on{background:#12141C;border-color:#12141C;color:#fff}
.dayb.on b,.dayb.on small{color:#D6D9E0}
.panel h3{font-size:14px;margin:4px 0 10px}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px;max-height:340px;overflow-y:auto;padding:2px}
.slot{position:relative}
.slot input{position:absolute;opacity:0;inset:0;cursor:pointer;margin:0}
.slot span{display:block;text-align:center;padding:9px 4px;border:1px solid #E6E3DC;border-radius:10px;font-size:14px;font-weight:600;background:#fff}
.slot input:checked+span{background:#12141C;color:#fff;border-color:#12141C}
.slot input:focus-visible+span{outline:3px solid #3457D5;outline-offset:2px}
.side{position:sticky;top:12px}
.pick{font-size:13px;color:#5B6170;margin:0 0 10px}.pick b{color:#12141C}
.js .panel{display:none}.js .panel.on{display:block}
button.ok:disabled{opacity:.45;cursor:not-allowed}
</style>"""


def _weekday_parts(date_iso: str):
    from datetime import datetime

    d = datetime.strptime(date_iso, "%Y-%m-%d")
    return d.strftime("%a"), d.day, d.strftime("%b")


def _event_lines(event: Optional[Dict[str, Any]]) -> str:
    """What is being booked: name, length, where it happens, who with, and the event's own description."""
    if not event:
        return ""
    bits = [f"{event['length']} min", event["where"]] + ([f"with {event['host']}"] if event.get("host") else [])
    desc = f'<p class="cap" style="margin:8px 0 0;font-size:13px">{_esc(event["description"])}</p>' if event.get("description") else ""
    return (f'<div class="head" style="font-size:16px;margin-bottom:2px">{_esc(event["title"])}</div>'
            f'<div class="meta">{_esc(" · ".join(bits))}</div>{desc}')


def render(week: list, company: str, tz: str, name: str, email: str, notice: str = "", done: Optional[Dict[str, Any]] = None,
           event: Optional[Dict[str, Any]] = None) -> str:
    if done:
        join = f'<div class="row"><a href="{_esc(done["join_url"])}"><button class="ok" type="button">Open the meeting link</button></a></div>' if done.get("join_url") else ""
        if done.get("mailed"):
            mail = f"A confirmation with a calendar invite was emailed to {_esc(done['email'])}, and {_esc(company)} was told too."
        else:
            mail = (f"We could not email {_esc(done['email'])} just now. Keep this page: it has everything you need. "
                    f"{_esc(company)} has been told about your booking.")
        body = (f"<h1>You are booked</h1><div class='sub'>{_esc(company)}</div>"
                f"<div class='card'>{_event_lines(event)}<div class='meta' style='margin-top:12px'>When</div>"
                f"<div class='head'>{_esc(done['when'])}</div>"
                f"<div class='meta'>{mail}</div>{join}</div>")
        return _page("Booked", body)
    banner = f'<div class="card" style="border-color:#B45309"><strong>{_esc(notice)}</strong></div>' if notice else ""
    open_days = [d for d in week if d["open"]]
    strip, panels = "", ""
    for i, d in enumerate(open_days):
        wd, num, mon = _weekday_parts(d["date"])
        strip += (f'<button type="button" class="dayb{" on" if i == 0 else ""}" data-day="{i}" aria-pressed="{"true" if i == 0 else "false"}">'
                  f'<b>{_esc(wd)}</b><span>{num}</span><small>{_esc(mon)} · {len(d["open"])}</small></button>')
        slots = "".join(
            f'<label class="slot"><input type="radio" name="slot" required data-when="{_esc(d["label"])} at {_esc(s["time"])}" '
            f'value="{_esc(d["date"])}|{_esc(s["hostTime"])}|{_esc(s["time"])}"><span>{_esc(s["time"])}</span></label>'
            for s in d["open"])
        panels += f'<div class="panel{" on" if i == 0 else ""}" data-panel="{i}"><h3>{_esc(d["label"])}</h3><div class="slots">{slots}</div></div>'
    box = 'style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #E6E3DC;border-radius:10px;font:inherit;margin-bottom:8px"'
    if not open_days:
        left = ('<div class="card"><div class="head">No free times right now</div><div class="meta">Please reply to the message you received '
                'and we will find a time.</div></div>')
        side = ""
    else:
        left = (f'<div class="card"><div class="head">Pick a day and a time</div>'
                f'<div class="meta">Times are shown in {_esc(tz)}. {len(open_days)} days with free times.</div>'
                f'<div class="strip" role="group" aria-label="Days">{strip}</div>{panels}</div>')
        side = (f'<div class="card side"><div class="meta" style="font-weight:700;text-transform:uppercase;letter-spacing:.04em">What you are booking</div>'
                f'{_event_lines(event)}'
                f'<p class="pick" id="pick" aria-live="polite" style="margin-top:12px">Choose a time on the left.</p>'
                f'<div class="head" style="margin-top:4px">Your details</div>'
                f'<input name="name" required placeholder="Your name" value="{_esc(name)}" {box}>'
                f'<input name="email" required type="email" placeholder="Your email" value="{_esc(email)}" {box}>'
                f'<div class="meta" style="margin:2px 0 0">When you confirm, you and {_esc(company)} both get an email with these details and a calendar invite.</div>'
                f'<div class="row"><button class="ok" id="go" type="submit" style="width:100%">Confirm booking</button></div></div>')
    script = """<script>
(function(){var d=document;d.documentElement.className+=' js';
var days=d.querySelectorAll('.dayb'),panels=d.querySelectorAll('.panel'),pick=d.getElementById('pick'),go=d.getElementById('go');
function show(i){days.forEach(function(b,j){b.classList.toggle('on',i==j);b.setAttribute('aria-pressed',i==j)});panels.forEach(function(p,j){p.classList.toggle('on',i==j)})}
days.forEach(function(b,i){b.addEventListener('click',function(){show(i)})});
if(go)go.disabled=true;
d.addEventListener('change',function(e){if(e.target&&e.target.name==='slot'){pick.innerHTML='You chose <b>'+e.target.getAttribute('data-when')+'</b>.';go.disabled=false}});
})();
</script>"""
    form = f'<form method="post"><div class="bk"><div>{left}</div><div>{side}</div></div></form>'
    return _page("Book a time", f"{BOOK_CSS}<h1>Book a time with {_esc(company)}</h1><div class='sub'>This link needs no sign-in</div>{banner}{form}{script}")


async def event_info(db, slug: str) -> Dict[str, Any]:
    """What a booking link books: the event's name, length, description and where it happens."""
    from sqlalchemy.future import select

    from app.models.models import MeetingEventType
    from app.services.calendar_service import calendar_service

    ev = (await db.execute(select(MeetingEventType).where(MeetingEventType.slug == slug))).scalars().first()
    setting = await calendar_service.get_or_create_settings(db)
    kind = {"google_meet": "Google Meet video call", "cal_video": "Video call", "zoom": "Zoom video call",
            "phone": "Phone call", "in_person": "In person"}.get((ev.location_type if ev else "") or "google_meet", "Video call")
    if ev and ev.location_type == "in_person" and (ev.location_value or "").strip():
        kind = f"In person, {ev.location_value.strip()}"
    return {"title": (ev.title if ev else "") or "Meeting", "length": (ev.length if ev else 15) or 15,
            "description": ((ev.description if ev else "") or "").strip()[:400], "where": kind,
            "host": (getattr(setting, "host_name", "") or "").strip()}


async def view(db, ref: Dict[str, str]):
    """(week of free slots, the lead if named, the lead's time zone)."""
    from app.models.models import LeadAccount
    from app.services.calendar_service import calendar_service
    from app.services.org_settings import org_timezone
    from app.services.timezone_service import resolve_prospect_timezone

    lead = await db.get(LeadAccount, ref["lead_id"]) if ref["lead_id"] else None
    host_tz = await org_timezone(db)
    tz = resolve_prospect_timezone(phone=getattr(lead, "phone", None), host_tz=host_tz) if lead else host_tz
    week = await calendar_service.get_week_availability(db, days=10, event_type_slug=ref["slug"], prospect_tz=tz,
                                                        max_slots=60, scan_days=21)
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
    ev = await event_info(db, ref["slug"])
    res = await calendar_service.create_booking(
        db, prospect_name=name, attendee_email=email, date_str=date_iso, time_str=host_time,
        event_type_slug=ref["slug"], mission_name=ev["title"], prospect_timezone=tz,
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
        from app.services import feed

        feed.add(db, f"{name} booked a meeting for {date_iso} at {shown}" + (" from one of your posts." if ref["post_id"] else " from a booking link."), "success")
        await db.commit()
    sent = res.get("emailConfirmationSent") or {}
    when = f"{date_iso} at {shown} ({tz})"
    mailed = bool(sent.get("attendee"))
    if not mailed:  # the calendar mailbox could not send it: use the platform mailbox so the booker still gets one
        mailed = await _fallback_mail(email, name, ev, when, res.get("videoLink") or "", company_name=await _company(db))
    if not sent.get("host") and res.get("hostEmail"):
        await _fallback_mail(res["hostEmail"], res.get("hostName") or "", ev, when, res.get("videoLink") or "", company_name=await _company(db),
                             host_view=f"{name} ({email}) booked this time.")
    return {"when": when, "email": email, "join_url": res.get("videoLink") or "", "mailed": mailed, "event": ev}


async def _company(db) -> str:
    from app.services.approval_mail import _company_name

    return await _company_name(db)


async def _fallback_mail(to: str, name: str, ev: Dict[str, Any], when: str, join_url: str, company_name: str, host_view: str = "") -> bool:
    """A plain confirmation from the platform mailbox. Never raises; True when it was sent."""
    try:
        from app.core import mailer

        lines = [host_view or f"You are booked: <b>{_esc(ev['title'])}</b> with {_esc(company_name)}.",
                 f"<b>When:</b> {_esc(when)}<br><b>Length:</b> {ev['length']} min<br><b>Where:</b> {_esc(ev['where'])}"]
        msg = mailer.render(f"Confirmed: {ev['title']}", lines, {"label": "Open the meeting link", "url": join_url} if join_url else None,
                            reason=f"You are getting this because a time was booked with {_esc(company_name)}.")
        res = await mailer.send_system_email(to, f"Confirmed: {ev['title']}, {when}", msg["html"], msg["text"])
        return bool(res.get("ok"))
    except Exception:
        return False


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
