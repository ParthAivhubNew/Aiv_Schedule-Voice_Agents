import html as html_lib
import httpx
import logging
import uuid
import asyncio
import smtplib
import ssl
import zoneinfo
import re
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import Dict, Any, Optional, List, Tuple
from urllib.parse import quote, urlparse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete

from app.config import settings
from app.models.models import Meeting, MeetingEventType, CalcomSetting, Notification, CompanyProfile
from app.services.timezone_service import (
    combine_local,
    convert_local,
    decorate_slots,
    display_hhmm,
    now_in,
    resolve_prospect_timezone,
    short_label,
    stamp_from_host,
    to_utc,
    tzinfo,
)

logger = logging.getLogger("calendar_service")

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def now_uk() -> datetime:
    try:
        return datetime.now(zoneinfo.ZoneInfo("Europe/London"))
    except Exception:
        return datetime.utcnow() + timedelta(hours=1)


def parse_spoken_date(raw: Optional[str], now: Optional[datetime] = None) -> datetime:
    """Turn 'tomorrow', 'Friday', 'next week', '2026-09-18' into a UK-local date."""
    stamp = now or now_uk()
    s = (raw or "").strip().lower()
    s = re.sub(r"\b202[0-5]\b", str(stamp.year), s)
    if not s or s in ("tomorrow", "tmrw", "tommorow"):
        return stamp + timedelta(days=1)
    if s in ("today", "tonight", "this afternoon", "this morning"):
        return stamp
    if "next week" in s:
        return stamp + timedelta(days=(7 - stamp.weekday()) or 7)
    for i, name in enumerate(WEEKDAYS):
        if name in s:
            delta = (i - stamp.weekday()) % 7
            if "next" in s and delta == 0:
                delta = 7
            elif delta == 0 and "today" not in s and stamp.hour >= 17:
                delta = 7
            return stamp + timedelta(days=delta)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%A, %d %b %Y", "%A, %d %B %Y"):
        try:
            parsed = datetime.strptime(raw.strip(), fmt)
            return parsed.replace(tzinfo=stamp.tzinfo) if stamp.tzinfo else parsed
        except Exception:
            continue
    return stamp + timedelta(days=1)


def _date_aliases(target: datetime) -> List[str]:
    return [
        target.strftime("%Y-%m-%d"),
        target.strftime("%A, %d %b %Y"),
        target.strftime("%A, %d %B %Y"),
        target.strftime("%A %d %B %Y"),
    ]


def hours_for_day(setting, day_name: str) -> tuple:
    """Return (core_start, core_end, bookable_end, flex_minutes) for a weekday name."""
    by_day = setting.working_hours_by_day if isinstance(getattr(setting, "working_hours_by_day", None), dict) else {}
    spec = {}
    if isinstance(by_day, dict):
        spec = by_day.get(day_name) or by_day.get(day_name[:3]) or {}
        if not isinstance(spec, dict):
            spec = {}
    start = spec.get("start") or setting.working_hours_start or "09:00"
    end = spec.get("end") or setting.working_hours_end or "17:30"
    flex = int(getattr(setting, "flex_minutes", 0) or 0)
    try:
        eh, em = map(int, str(end).split(":"))
    except Exception:
        eh, em = 17, 30
    total = eh * 60 + em + max(0, flex)
    if total > 23 * 60 + 45:
        total = 23 * 60 + 45
    bookable_end = f"{total // 60:02d}:{total % 60:02d}"
    return start, end, bookable_end, flex


def _norm_time(raw: Optional[str]) -> str:
    t = (raw or "").strip()
    if not t:
        return "14:00"
    if "T" in t:
        try:
            return datetime.fromisoformat(t.replace("Z", "+00:00")).strftime("%H:%M")
        except Exception:
            m = re.search(r"T(\d{1,2}):(\d{2})", t)
            if m:
                hh, mm = int(m.group(1)), int(m.group(2))
                if 0 <= hh <= 23 and 0 <= mm <= 59:
                    return f"{hh:02d}:{mm:02d}"
    u = t.upper().replace(".", "")
    for fmt in ("%H:%M:%S", "%H:%M", "%I:%M:%S %p", "%I:%M %p", "%I %p", "%H%M"):
        try:
            return datetime.strptime(u, fmt).strftime("%H:%M")
        except Exception:
            continue
    m = re.search(r"(\d{1,2}):(\d{2})", t)
    if m:
        hh, mm = int(m.group(1)), int(m.group(2))
        if 0 <= hh <= 23 and 0 <= mm <= 59:
            return f"{hh:02d}:{mm:02d}"
    return "14:00"


def _cal_slot_hhmm(raw: Any) -> str:
    if isinstance(raw, dict):
        raw = raw.get("time") or raw.get("start") or raw.get("slot") or ""
    s = str(raw or "").strip()
    if not s:
        return ""
    parsed = _norm_time(s)
    try:
        hh, mm = map(int, parsed.split(":"))
        if 0 <= hh <= 23 and 0 <= mm <= 59:
            return f"{hh:02d}:{mm:02d}"
    except Exception:
        return ""
    return ""


def _ics_escape(value: str) -> str:
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _is_real_join_url(url: Optional[str]) -> bool:
    u = (url or "").strip()
    if not u.startswith("http"):
        return False
    if re.search(r"meet\.google\.com/aiv-", u, re.I):
        return False
    return True


def _room_token(text: Optional[str], max_len: int = 24) -> str:
    words = re.findall(r"[A-Za-z0-9]+", str(text or ""))
    if not words:
        return ""
    parts = [(w[:1].upper() + w[1:]) for w in words if w]
    return "-".join(parts)[:max_len].strip("-")


def _meeting_display_title(brand: str, prospect: str, topic: str) -> str:
    brand_s = (brand or "Meeting").strip() or "Meeting"
    who = (prospect or "Guest").strip() or "Guest"
    topic_s = (topic or "Intro call").strip() or "Intro call"
    return f"{brand_s} × {who} — {topic_s}"


def _jitsi_url_with_title(room: str, title: str) -> str:
    enc = quote(title or "Meeting", safe="")
    clean_room = re.sub(r"[^A-Za-z0-9\-]", "", room or "Meeting")[:72] or "Meeting"
    return (
        f"https://meet.jit.si/{clean_room}"
        f"#config.subject=%22{enc}%22&config.localSubject=%22{enc}%22"
    )


def _joinable_meeting_url(
    booking_uid: str,
    *candidates: Optional[str],
    brand_slug: str = "Meet",
    brand_name: str = "Meet",
    prospect_name: str = "",
    topic: str = "Intro call",
) -> Tuple[str, str]:
    """Prefer a real Cal.com / configured room. Never invent a Google Meet code — those 404."""
    for raw in candidates:
        u = (raw or "").strip()
        if not u:
            continue
        if not u.startswith("http"):
            u = "https://" + u.lstrip("/")
        if not _is_real_join_url(u):
            continue
        low = u.lower()
        if "meet.google.com" in low:
            return u, "Google Meet"
        if "zoom.us" in low:
            return u, "Zoom"
        return u, "Video call"
    brand_part = _room_token(brand_name or brand_slug, 16) or "Meet"
    person_part = _room_token(prospect_name, 22) or "Guest"
    topic_part = _room_token(topic, 18) or "Intro"
    short = re.sub(r"[^A-Za-z0-9]", "", booking_uid or uuid.uuid4().hex)[-5:] or uuid.uuid4().hex[:5]
    room = f"{brand_part}-with-{person_part}-{topic_part}-{short}"
    title = _meeting_display_title(brand_name, prospect_name, topic)
    return _jitsi_url_with_title(room, title), "Video call"


def _pretty_datetime(date_iso: str, time_hhmm: str, tz_name: str) -> str:
    try:
        dt = combine_local(date_iso, time_hhmm, tz_name)
        day = dt.strftime("%A, %d %B %Y")
        if day[day.find(",") + 2] == "0":
            day = day.replace(" 0", " ", 1)
        clock = dt.strftime("%I:%M %p").lstrip("0")
        return f"{day} · {clock} {short_label(tz_name)}"
    except Exception:
        return f"{date_iso} · {display_hhmm(time_hhmm)} {short_label(tz_name)}"


def _booking_email_html(
    *,
    greeting_name: str,
    host_name: str,
    company_name: str,
    company_website: str,
    duration: str,
    when_primary: str,
    when_secondary: Optional[str],
    join_url: str,
    platform_label: str,
    is_host: bool,
) -> str:
    who = html_lib.escape(greeting_name or "there")
    host = html_lib.escape(host_name or company_name)
    brand = html_lib.escape(company_name or host)
    when = html_lib.escape(when_primary)
    extra = html_lib.escape(when_secondary) if when_secondary else ""
    url = html_lib.escape(join_url, quote=True)
    plat = html_lib.escape(platform_label)
    dur = html_lib.escape(duration or "15 min")
    site = (company_website or "").strip()
    if site and not site.startswith("http"):
        site = "https://" + site
    site_html = (
        f' · <a href="{html_lib.escape(site, quote=True)}" style="color:#0F766E;text-decoration:none;">{html_lib.escape(site.replace("https://", "").replace("http://", ""))}</a>'
        if site
        else ""
    )
    headline = "You are confirmed" if not is_host else "New booking on your diary"
    intro = (
        f"You are booked with {host} at {brand} for a {dur} intro."
        if not is_host
        else f"{who} booked a {dur} intro with you."
    )
    extra_label = "Guest time" if is_host else "Host time"
    second_row = (
        f'<tr><td style="padding:0 0 14px 0;font-size:13px;color:#64748B;line-height:1.45;">{extra_label}: {extra}</td></tr>'
        if extra
        else ""
    )
    return f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F1F5F9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;">
      <tr><td style="background:#0F766E;padding:22px 28px;">
        <div style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#99F6E4;font-weight:700;">{brand}</div>
        <div style="font-family:Arial,sans-serif;font-size:22px;color:#ffffff;font-weight:700;margin-top:6px;">{headline}</div>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 16px 0;font-family:Arial,sans-serif;font-size:15px;color:#0F172A;line-height:1.5;">Hi {who},</p>
        <p style="margin:0 0 22px 0;font-family:Arial,sans-serif;font-size:15px;color:#334155;line-height:1.55;">{intro}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:12px;border:1px solid #E2E8F0;">
          <tr><td style="padding:18px 20px;font-family:Arial,sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:0 0 4px 0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0F766E;">When</td></tr>
              <tr><td style="padding:0 0 14px 0;font-size:16px;font-weight:700;color:#0F172A;line-height:1.4;">{when}</td></tr>
              {second_row}
              <tr><td style="padding:0 0 4px 0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0F766E;">Duration</td></tr>
              <tr><td style="padding:0 0 14px 0;font-size:15px;color:#0F172A;">{dur}</td></tr>
              <tr><td style="padding:0 0 4px 0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0F766E;">Join</td></tr>
              <tr><td style="padding:0;font-size:14px;color:#0F172A;">{plat}</td></tr>
            </table>
          </td></tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px 0;">
          <tr><td style="border-radius:10px;background:#0F766E;">
            <a href="{url}" style="display:inline-block;padding:14px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Join video call</a>
          </td></tr>
        </table>
        <p style="margin:0 0 20px 0;font-family:Arial,sans-serif;font-size:12px;color:#64748B;word-break:break-all;">{html_lib.escape(join_url)}</p>
        <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#64748B;line-height:1.5;">A calendar file is attached — add it to Google Calendar, Outlook, or Apple Calendar. See you then.</p>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:11px;color:#94A3B8;">
        Sent by {brand}{site_html}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


# Default Event Types seeded if none exist
DEFAULT_EVENT_TYPES = [
    {
        "id": "et_15min",
        "title": "15 Min Discovery Call",
        "slug": "15-min-discovery",
        "length": 15,
        "description": "Quick intro to align on your business goals, operational pain points, and explore fit.",
        "location_type": "google_meet",
        "color": "#10B981"
    },
    {
        "id": "et_30min",
        "title": "30 Min Solution Deep Dive",
        "slug": "30-min-deep-dive",
        "length": 30,
        "description": "Comprehensive walkthrough of AI-powered automation architecture, integration points, and ROI metrics.",
        "location_type": "google_meet",
        "color": "#6366F1"
    },
    {
        "id": "et_45min",
        "title": "45 Min Technical Demo & Consultation",
        "slug": "45-min-demo",
        "length": 45,
        "description": "Live custom demo tailored to your workflows with technical evaluation and roadmap scoping.",
        "location_type": "google_meet",
        "color": "#F59E0B"
    }
]


class CalendarService:
    def __init__(self):
        self.default_base_url = settings.CALCOM_BASE_URL.rstrip("/")
        self.default_api_key = settings.CALCOM_API_KEY
        self.default_event_type_id = settings.CALCOM_EVENT_TYPE_ID

    async def _company_brand(self, db: AsyncSession) -> Dict[str, str]:
        res = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
        p = res.scalars().first()
        name = ((p.name if p else "") or "").strip() or "Company"
        website = ((p.website if p else "") or "").strip()
        legal = ((p.legal_name if p else "") or name).strip()
        caller = ((p.caller_name if p else "") or "").strip()
        parsed = urlparse(website if website.startswith("http") else (f"https://{website}" if website else ""))
        domain = (parsed.netloc or "").replace("www.", "") or "calendar.local"
        slug = re.sub(r"[^A-Za-z0-9]+", "", name)[:18] or "Meet"
        return {
            "name": name,
            "website": website,
            "legal": legal,
            "caller": caller,
            "domain": domain,
            "slug": slug,
        }

    async def get_or_create_settings(self, db: AsyncSession) -> CalcomSetting:
        """Retrieves CalcomSetting singleton or creates default row."""
        result = await db.execute(select(CalcomSetting).where(CalcomSetting.id == "default"))
        setting = result.scalars().first()
        if not setting:
            setting = CalcomSetting(
                id="default",
                host_email="admin@aivhub.io",
                host_name="Jitendra S.",
                api_key=self.default_api_key or None,
                base_url=self.default_base_url or "https://api.cal.com/v1",
                default_event_type_slug="15-min-discovery",
                default_duration=15,
                default_platform="google_meet",
                timezone="Europe/London",
                working_hours_start="09:00",
                working_hours_end="17:30",
                working_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                buffer_before=5,
                buffer_after=5,
                auto_email_attendee=True,
                auto_email_host=True
            )
            db.add(setting)
            await db.commit()
            await db.refresh(setting)
        return setting

    async def save_settings(self, db: AsyncSession, data: Dict[str, Any]) -> CalcomSetting:
        """Updates CalcomSetting."""
        setting = await self.get_or_create_settings(db)
        
        for field in [
            "host_email", "host_name", "api_key", "base_url",
            "default_event_type_slug", "default_duration", "default_platform",
            "timezone", "working_hours_start", "working_hours_end",
            "working_days", "working_hours_by_day", "slot_step_minutes", "flex_minutes",
            "buffer_before", "buffer_after",
            "auto_email_attendee", "auto_email_host",
            "prospect_timezone_override",
        ]:
            if field in data:
                val = data[field]
                if field == "prospect_timezone_override" and not str(val or "").strip():
                    val = None
                setattr(setting, field, val)

        await db.commit()
        await db.refresh(setting)
        return setting

    async def check_calcom_status(self, db: Optional[AsyncSession] = None) -> Dict[str, Any]:
        """Checks Cal.com connectivity using DB settings or default config."""
        api_key = self.default_api_key
        base_url = self.default_base_url

        if db:
            try:
                setting = await self.get_or_create_settings(db)
                if setting.api_key:
                    api_key = setting.api_key
                if setting.base_url:
                    base_url = setting.base_url.rstrip("/")
            except Exception as err:
                logger.debug(f"Could not load settings from DB for status check: {err}")

        # 1. Test direct reachability of base_url
        reachable = False
        api_valid = False
        message = "AIVHub Managed Cal.com Engine: Pre-configured & Ready"
        
        try:
            async with httpx.AsyncClient(timeout=3.5) as client:
                res = await client.get(f"{base_url}/health")
                if res.status_code < 400:
                    reachable = True
        except Exception:
            pass

        # 2. If API Key provided, test Cal.com v1 / v2 endpoints
        if api_key:
            try:
                headers = {"Authorization": f"Bearer {api_key}"}
                async with httpx.AsyncClient(timeout=4.0) as client:
                    # Cal.com v1 /event-types or /users/me
                    res = await client.get(f"{base_url}/event-types", headers=headers, params={"apiKey": api_key})
                    if res.status_code in [200, 201]:
                        api_valid = True
                        reachable = True
                        message = "Cal.com Cloud/Self-Hosted API Connected"
                    elif res.status_code == 401:
                        message = "Cal.com API key is invalid or unauthorized"
                    else:
                        message = f"Cal.com returned status {res.status_code}"
            except Exception as e:
                message = f"Cal.com connection error: {str(e)[:100]}"

        return {
            "connected": True, "managed": True,
            "api_valid": api_valid,
            "reachable": reachable,
            "type": "calcom_api" if api_valid else ("calcom_instance" if reachable else "native_engine"),
            "url": base_url,
            "has_api_key": bool(api_key),
            "message": message
        }

    async def get_event_types(self, db: AsyncSession) -> List[Dict[str, Any]]:
        """Returns list of event types, seeding defaults if table is empty."""
        result = await db.execute(select(MeetingEventType).order_by(MeetingEventType.length.asc()))
        types = result.scalars().all()

        if not types:
            # Seed defaults
            for item in DEFAULT_EVENT_TYPES:
                ev = MeetingEventType(
                    id=item["id"],
                    title=item["title"],
                    slug=item["slug"],
                    length=item["length"],
                    description=item["description"],
                    location_type=item["location_type"],
                    location_value=None,
                    color=item["color"],
                    is_active=True
                )
                db.add(ev)
            await db.commit()
            result = await db.execute(select(MeetingEventType).order_by(MeetingEventType.length.asc()))
            types = result.scalars().all()

        return [
            {
                "id": t.id,
                "title": t.title,
                "slug": t.slug,
                "length": t.length,
                "description": t.description,
                "locationType": t.location_type,
                "locationValue": t.location_value,
                "calcomEventTypeId": t.calcom_event_type_id,
                "isActive": t.is_active,
                "color": t.color or "#10B981",
                "bookingUrl": f"/book/{t.slug}"
            }
            for t in types
        ]

    async def create_or_update_event_type(self, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
        """Creates or updates an event type in DB and syncs with Cal.com if configured."""
        event_id = data.get("id") or f"et_{uuid.uuid4().hex[:8]}"
        slug = data.get("slug") or data.get("title", "meeting").lower().replace(" ", "-")[:24]

        result = await db.execute(select(MeetingEventType).where(MeetingEventType.id == event_id))
        ev = result.scalars().first()

        if not ev:
            # Check by slug
            res_slug = await db.execute(select(MeetingEventType).where(MeetingEventType.slug == slug))
            ev = res_slug.scalars().first()

        if ev:
            ev.title = data.get("title", ev.title)
            ev.slug = slug
            ev.length = int(data.get("length", ev.length))
            ev.description = data.get("description", ev.description)
            ev.location_type = data.get("locationType", data.get("location_type", ev.location_type))
            ev.color = data.get("color", ev.color)
            ev.is_active = data.get("isActive", data.get("is_active", ev.is_active))
        else:
            ev = MeetingEventType(
                id=event_id,
                title=data.get("title", "New Event Type"),
                slug=slug,
                length=int(data.get("length", 15)),
                description=data.get("description", ""),
                location_type=data.get("locationType", data.get("location_type", "google_meet")),
                location_value=data.get("locationValue", None),
                color=data.get("color", "#10B981"),
                is_active=True
            )
            db.add(ev)

        # Sync to Cal.com if API key present
        setting = await self.get_or_create_settings(db)
        if setting.api_key:
            try:
                headers = {"Authorization": f"Bearer {setting.api_key}", "Content-Type": "application/json"}
                payload = {
                    "title": ev.title,
                    "slug": ev.slug,
                    "length": ev.length,
                    "description": ev.description
                }
                async with httpx.AsyncClient(timeout=4.0) as client:
                    await client.post(f"{setting.base_url.rstrip('/')}/event-types", json=payload, headers=headers)
            except Exception as e:
                logger.debug(f"Optional Cal.com sync for event type skipped: {e}")

        await db.commit()
        await db.refresh(ev)

        return {
            "id": ev.id,
            "title": ev.title,
            "slug": ev.slug,
            "length": ev.length,
            "description": ev.description,
            "locationType": ev.location_type,
            "locationValue": ev.location_value,
            "isActive": ev.is_active,
            "color": ev.color
        }

    async def delete_event_type(self, db: AsyncSession, event_id: str) -> bool:
        """Deletes an event type by ID."""
        await db.execute(delete(MeetingEventType).where(MeetingEventType.id == event_id))
        await db.commit()
        return True

    async def host_and_prospect_tz(
        self,
        db: AsyncSession,
        phone: Optional[str] = None,
        mission_tz: Optional[str] = None,
        call_override: Optional[str] = None,
    ) -> Tuple[str, str]:
        setting = await self.get_or_create_settings(db)
        host_tz = setting.timezone or "Europe/London"
        p_tz = resolve_prospect_timezone(
            phone=phone,
            mission_tz=mission_tz,
            override=call_override or setting.prospect_timezone_override,
            host_tz=host_tz,
        )
        return host_tz, p_tz

    async def get_available_slots(
        self,
        db: AsyncSession,
        date_str: str,
        event_type_slug: str = "15-min-discovery",
        prospect_tz: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Returns list of available booking slots for the given date.
        Uses Cal.com API if configured, otherwise computes open slots based on working hours and existing DB meetings.
        Times on each slot are host-local. If prospect_tz is set, also attach spoken prospect-local times.
        """
        setting = await self.get_or_create_settings(db)
        host_tz = setting.timezone or "Europe/London"

        native = await self._native_slots(db, setting, date_str, event_type_slug, host_tz)
        cal_open: List[Dict[str, Any]] = []

        # Cal.com if connected — parse ISO times properly. Sparse/garbled days fall back to native.
        if setting.api_key:
            try:
                headers = {"Authorization": f"Bearer {setting.api_key}"}
                params = {
                    "startTime": f"{date_str}T00:00:00Z",
                    "endTime": f"{date_str}T23:59:59Z",
                    "apiKey": setting.api_key
                }
                async with httpx.AsyncClient(timeout=4.0) as client:
                    resp = await client.get(f"{setting.base_url.rstrip('/')}/slots", headers=headers, params=params)
                    if resp.status_code == 200:
                        payload = resp.json() if resp.content else {}
                        cal_slots = payload.get("slots") or payload.get("data") or payload
                        if isinstance(cal_slots, dict) and "slots" in cal_slots:
                            cal_slots = cal_slots.get("slots")
                        day_slots = []
                        if isinstance(cal_slots, dict):
                            day_slots = cal_slots.get(date_str) or cal_slots.get(date_str.replace("-", "/")) or []
                        elif isinstance(cal_slots, list):
                            day_slots = cal_slots
                        parsed = []
                        for s in day_slots or []:
                            hhmm = _cal_slot_hhmm(s)
                            if not hhmm:
                                continue
                            parsed.append({"time": hhmm, "iso": s.get("time") if isinstance(s, dict) else s, "available": True})
                        cal_open = parsed
            except Exception as e:
                logger.debug(f"Cal.com slot fetch failed, using native schedule generator: {e}")

        native_open = [s for s in native if s.get("available")]
        # Prefer host diary (native) whenever Cal.com is sparse or emptier — never starve the day to 1 junk slot.
        if cal_open and len(cal_open) >= 4 and len(cal_open) >= len(native_open):
            slots = cal_open
        else:
            if cal_open and len(cal_open) < 4:
                logger.info(
                    f"Cal.com returned {len(cal_open)} slot(s) for {date_str}; using native {len(native_open)} openings instead."
                )
            slots = native

        if prospect_tz:
            slots = decorate_slots(slots, date_str, host_tz, prospect_tz)
        return slots

    async def _native_slots(
        self,
        db: AsyncSession,
        setting,
        date_str: str,
        event_type_slug: str,
        host_tz: str,
    ) -> List[Dict[str, Any]]:
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            target_date = parse_spoken_date(date_str)
            date_str = target_date.strftime("%Y-%m-%d")

        day_name = target_date.strftime("%A")
        working_days = setting.working_days or ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

        if day_name not in working_days:
            return []

        start_s, core_end, bookable_end, _flex = hours_for_day(setting, day_name)
        start_h, start_m = map(int, (start_s or "09:00").split(":"))
        end_h, end_m = map(int, (bookable_end or core_end or "17:30").split(":"))

        res = await db.execute(select(MeetingEventType).where(MeetingEventType.slug == event_type_slug))
        ev_type = res.scalars().first()
        duration_minutes = ev_type.length if ev_type else setting.default_duration or 15

        aliases = _date_aliases(target_date)
        m_res = await db.execute(select(Meeting).where(Meeting.date.in_(aliases)))
        existing_meetings = m_res.scalars().all()
        booked_times = {_norm_time(m.time) for m in existing_meetings if m.status not in ("cancelled", "not_fit")}

        zone = tzinfo(host_tz)
        current_dt = datetime(target_date.year, target_date.month, target_date.day, start_h, start_m, tzinfo=zone)
        end_dt = datetime(target_date.year, target_date.month, target_date.day, end_h, end_m, tzinfo=zone)

        step_minutes = int(getattr(setting, "slot_step_minutes", 0) or 0)
        if step_minutes not in (15, 30, 45, 60):
            step_minutes = 30 if duration_minutes >= 30 else 15
        slots = []

        lunch_start = str(getattr(setting, "lunch_start", None) or "12:00")
        lunch_end = str(getattr(setting, "lunch_end", None) or "13:00")
        try:
            ls_h, ls_m = map(int, (lunch_start or "12:00").split(":")[:2])
            le_h, le_m = map(int, (lunch_end or "13:00").split(":")[:2])
            lunch_from = ls_h * 60 + ls_m
            lunch_to = le_h * 60 + le_m
        except Exception:
            lunch_from, lunch_to = 12 * 60, 13 * 60

        host_now = now_in(host_tz)
        while current_dt + timedelta(minutes=duration_minutes) <= end_dt:
            time_str = current_dt.strftime("%H:%M")
            mins = current_dt.hour * 60 + current_dt.minute
            is_lunch = lunch_from <= mins < lunch_to
            is_past = current_dt <= host_now
            is_booked = time_str in booked_times
            blocked = is_booked or is_past or is_lunch
            slots.append({
                "time": time_str,
                "displayTime": current_dt.strftime("%I:%M %p").lstrip("0"),
                "available": not blocked,
                "reason": "Already Booked" if is_booked else ("Past Time" if is_past else ("Lunch" if is_lunch else "Available"))
            })
            current_dt += timedelta(minutes=step_minutes)

        return slots

    async def get_week_availability(
        self,
        db: AsyncSession,
        start: Optional[datetime] = None,
        days: int = 5,
        event_type_slug: str = "15-min-discovery",
        prospect_tz: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Open slots for the next N working days, using host calendar + working hours."""
        setting = await self.get_or_create_settings(db)
        host_tz = setting.timezone or "Europe/London"
        stamp = start or now_in(host_tz)
        out = []
        scanned = 0
        day = stamp
        while len(out) < days and scanned < 14:
            scanned += 1
            date_iso = day.strftime("%Y-%m-%d")
            slots = await self.get_available_slots(db, date_iso, event_type_slug, prospect_tz=prospect_tz)
            key = "offerable" if prospect_tz else "available"
            open_slots = [s for s in slots if s.get(key, s.get("available"))]
            if slots:
                out.append({
                    "date": date_iso,
                    "label": day.strftime("%A, %d %B %Y"),
                    "weekday": day.strftime("%A"),
                    "open": [{
                        "time": s.get("prospectTime") or s["time"],
                        "hostTime": s.get("hostTime") or s["time"],
                        "display": s.get("spoken") or s.get("displayTime") or s["time"],
                    } for s in open_slots[:8]],
                    "openCount": len(open_slots),
                })
            day = day + timedelta(days=1)
        return out

    async def get_availability_brief(
        self,
        db: AsyncSession,
        days: int = 5,
        prospect_tz: Optional[str] = None,
    ) -> str:
        """Plain-language calendar snapshot for the live voice prompt."""
        setting = await self.get_or_create_settings(db)
        host_tz = setting.timezone or "Europe/London"
        p_tz = prospect_tz or host_tz
        host_now = now_in(host_tz)
        p_now = now_in(p_tz)
        week = await self.get_week_availability(db, host_now, days=days, prospect_tz=p_tz)
        hours = f"{setting.working_hours_start or '09:00'}–{setting.working_hours_end or '17:30'}"
        by_day = setting.working_hours_by_day if isinstance(getattr(setting, "working_hours_by_day", None), dict) else {}
        day_bits = []
        for dname, spec in (by_day or {}).items():
            if isinstance(spec, dict) and (spec.get("start") or spec.get("end")):
                day_bits.append(f"{dname} {spec.get('start') or setting.working_hours_start}–{spec.get('end') or setting.working_hours_end}")
        flex = int(getattr(setting, "flex_minutes", 0) or 0)
        flex_line = f" Flex +{flex} min after close if they ask just past it." if flex else ""
        hours_line = hours if not day_bits else f"{hours} default; " + "; ".join(day_bits)
        lines = [
            f"INTERNAL (never speak timezone names, never say UK/GMT/IST/'your time'/'our time'): host diary {host_tz}.",
            f"Current local clock for speech: {p_now.strftime('%I:%M %p').lstrip('0')} on {p_now.strftime('%A, %d %B %Y')}.",
            f"We sit {hours_line}.{flex_line} If their ask falls outside, say that window is packed and offer nearby times from the list. Stay easy-going.",
            "Offer only these spoken times (do not invent):",
        ]
        for d in week:
            if d["open"]:
                shown = ", ".join(s["display"] for s in d["open"][:5])
                extra = f" (+{d['openCount'] - 5} more)" if d["openCount"] > 5 else ""
                lines.append(f"- {d['label']}: {shown}{extra}")
            else:
                lines.append(f"- {d['label']}: no free slots — offer another day")
        if not week:
            lines.append("- Calendar empty of working days. Offer next weekday morning or afternoon and then check again.")
        return "\n".join(lines)

    async def create_booking(
        self,
        db: AsyncSession,
        prospect_name: str,
        attendee_email: str,
        date_str: str,
        time_str: str,
        host_email: Optional[str] = None,
        event_type_slug: str = "15-min-discovery",
        duration_minutes: Optional[int] = None,
        notes: str = "",
        mission_name: str = "Direct Booking",
        format_type: str = "video",
        platform: str = "Google Meet",
        prospect_timezone: Optional[str] = None,
        prospect_phone: Optional[str] = None,
        time_is_prospect_local: bool = False,
        enforce_hours: bool = True,
        mission_tz: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Creates a confirmed booking with Google Meet link, persists to DB,
        syncs to Cal.com API if configured, and dispatches automated email records.
        date_str/time_str are host-local unless time_is_prospect_local is True.
        """
        setting = await self.get_or_create_settings(db)
        brand = await self._company_brand(db)
        resolved_host_email = host_email or setting.host_email or ""
        resolved_host_name = setting.host_name or brand.get("caller") or brand["name"]
        host_tz = setting.timezone or "Europe/London"
        p_tz = resolve_prospect_timezone(
            phone=prospect_phone,
            mission_tz=mission_tz,
            override=prospect_timezone or setting.prospect_timezone_override,
            host_tz=host_tz,
        )

        raw_date = (date_str or "").strip()
        if re.match(r"^\d{4}-\d{2}-\d{2}$", raw_date[:10] if len(raw_date) >= 10 else ""):
            date_iso = raw_date[:10]
        else:
            stamp = now_in(p_tz if time_is_prospect_local else host_tz)
            date_iso = parse_spoken_date(raw_date, stamp).strftime("%Y-%m-%d")
        time_norm = _norm_time(time_str)

        if time_is_prospect_local and p_tz != host_tz:
            try:
                date_iso, time_norm = convert_local(date_iso, time_norm, p_tz, host_tz)
            except Exception as conv_err:
                logger.warning(f"Prospect-to-host convert failed: {conv_err}")

        if enforce_hours:
            slots = await self.get_available_slots(db, date_iso, event_type_slug)
            open_times = [s["time"] for s in slots if s.get("available")]
            if time_norm not in open_times:
                alts = open_times[:6]
                return {
                    "success": False,
                    "error": "outside_hours_or_taken",
                    "date": date_iso,
                    "time": time_norm,
                    "availableSlots": alts,
                    "hostTimezone": host_tz,
                    "prospectTimezone": p_tz,
                    "message": "That time is not free on our calendar.",
                }

        stamp = stamp_from_host(date_iso, time_norm, host_tz, p_tz)
        date_str = stamp["date"]
        time_str = stamp["time"]

        # Fetch event type for duration + standing room URL
        res_et = await db.execute(select(MeetingEventType).where(MeetingEventType.slug == event_type_slug))
        ev = res_et.scalars().first()
        if not duration_minutes:
            duration_minutes = ev.length if ev else 15

        booking_uid = f"cal_{uuid.uuid4().hex[:10]}"
        calcom_booking_id = None
        provider = "native_calendar_engine"
        calcom_video = None

        # 1. Attempt Cal.com REST API Sync if API Key configured
        if setting.api_key:
            try:
                headers = {"Authorization": f"Bearer {setting.api_key}", "Content-Type": "application/json"}
                start_iso = to_utc(date_str, time_str, host_tz).strftime("%Y-%m-%dT%H:%M:%SZ")
                payload = {
                    "eventTypeId": 1,
                    "start": start_iso,
                    "responses": {
                        "name": prospect_name,
                        "email": attendee_email,
                        "notes": notes
                    },
                    "metadata": {
                        "source": "aivhub_platform",
                        "host_email": resolved_host_email,
                        "mission": mission_name
                    }
                }
                async with httpx.AsyncClient(timeout=6.0) as client:
                    resp = await client.post(f"{setting.base_url.rstrip('/')}/bookings", json=payload, headers=headers)
                    if resp.status_code in [200, 201]:
                        cal_data = resp.json()
                        calcom_booking_id = str(cal_data.get("id", ""))
                        if cal_data.get("videoCallUrl"):
                            calcom_video = cal_data.get("videoCallUrl")
                        provider = "cal.com"
            except Exception as e:
                logger.warning(f"Cal.com booking creation fallback: {e}")

        standing_room = (ev.location_value if ev else None) or None
        event_title = (ev.title if ev else None) or "15 min discovery"
        display_title = _meeting_display_title(brand["name"], prospect_name, event_title)
        join_url, platform_label = _joinable_meeting_url(
            booking_uid,
            calcom_video,
            standing_room,
            brand_slug=brand["slug"],
            brand_name=brand["name"],
            prospect_name=prospect_name,
            topic=event_title,
        )
        if (platform or "").lower() in ("google_meet", "google meet") and platform_label != "Google Meet":
            platform = platform_label
        elif not platform:
            platform = platform_label

        # 2. Persist to DB Meeting record
        meeting = Meeting(
            id=booking_uid,
            prospect=prospect_name,
            mission=display_title if (not mission_name or mission_name == "Direct Booking") else mission_name,
            date=date_str,
            time=time_str,
            host_timezone=stamp["host_timezone"],
            prospect_timezone=stamp["prospect_timezone"],
            prospect_date=stamp["prospect_date"],
            prospect_time=stamp["prospect_time"],
            starts_at_utc=stamp["starts_at_utc"],
            duration=f"{duration_minutes} min",
            status="upcoming",
            fit=92,
            channel="voice" if "voice" in mission_name.lower() else "calendar",
            format=format_type,
            platform=platform_label if platform_label else platform,
            video_link=join_url,
            dial_in=None,
            address="Remote Video Conference",
            host=resolved_host_name,
            host_email=resolved_host_email,
            attendee=prospect_name,
            attendee_email=attendee_email,
            calcom_booking_id=calcom_booking_id or booking_uid,
            event_type_slug=event_type_slug,
            prep=notes or f"{display_title}. Booked via {provider.replace('_', ' ').title()}. Attendee: {attendee_email}",
            created_at=datetime.utcnow()
        )
        db.add(meeting)

        # 3. Create In-App Notification
        notif = Notification(
            id=f"notif_{uuid.uuid4().hex[:8]}",
            text=f"Confirmed meeting with {prospect_name} ({attendee_email}) on {date_str} at {time_str} {short_label(host_tz)} via {platform}.",
            type="success",
            time="Just now"
        )
        db.add(notif)

        await db.commit()
        await db.refresh(meeting)

        email_result = {"attendee": False, "host": False, "error": None}
        if setting.auto_email_attendee or setting.auto_email_host:
            try:
                email_result = await self.send_booking_emails(db, meeting, join_url)
            except Exception as mail_err:
                logger.warning(f"Booking email send failed: {mail_err}")
                email_result["error"] = str(mail_err)[:240]

        # 4. Structured Process Log for Audit
        try:
            from app.services.process_logger import log_process_event
            await log_process_event(
                subsystem="calendar",
                process_name="meeting_booked",
                message=f"Meeting booked successfully for {prospect_name} on {date_str} {time_str}",
                level="SUCCESS",
                details={
                    "meeting_id": meeting.id,
                    "host_email": resolved_host_email,
                    "attendee_email": attendee_email,
                    "date": date_str,
                    "time": time_str,
                    "duration": f"{duration_minutes} min",
                    "video_link": join_url,
                    "provider": provider,
                    "calcom_booking_id": calcom_booking_id,
                    "auto_email_attendee": setting.auto_email_attendee,
                    "auto_email_host": setting.auto_email_host
                }
            )
        except Exception:
            pass

        return {
            "success": True,
            "bookingId": meeting.id,
            "calcomBookingId": calcom_booking_id or meeting.id,
            "prospect": prospect_name,
            "attendeeEmail": attendee_email,
            "hostEmail": resolved_host_email,
            "hostName": resolved_host_name,
            "date": date_str,
            "time": time_str,
            "hostTimezone": stamp["host_timezone"],
            "prospectTimezone": stamp["prospect_timezone"],
            "prospectDate": stamp["prospect_date"],
            "prospectTime": stamp["prospect_time"],
            "duration": f"{duration_minutes} min",
            "videoLink": join_url,
            "platform": platform_label,
            "provider": provider,
            "emailConfirmationSent": {
                "attendee": bool(email_result.get("attendee")),
                "host": bool(email_result.get("host")),
                "error": email_result.get("error"),
            }
        }

    async def cancel_booking(self, db: AsyncSession, booking_id: str, reason: str = "User requested cancellation") -> Dict[str, Any]:
        """Cancels a booking in DB and on Cal.com if synced."""
        result = await db.execute(select(Meeting).where(Meeting.id == booking_id))
        meeting = result.scalars().first()
        if not meeting:
            res2 = await db.execute(select(Meeting).where(Meeting.calcom_booking_id == booking_id))
            meeting = res2.scalars().first()

        if not meeting:
            return {"success": False, "error": "Meeting not found"}

        setting = await self.get_or_create_settings(db)

        # Cancel on Cal.com if API key and booking id present
        if setting.api_key and meeting.calcom_booking_id and not meeting.calcom_booking_id.startswith("cal_"):
            try:
                headers = {"Authorization": f"Bearer {setting.api_key}"}
                async with httpx.AsyncClient(timeout=4.0) as client:
                    await client.delete(
                        f"{setting.base_url.rstrip('/')}/bookings/{meeting.calcom_booking_id}",
                        headers=headers,
                        params={"cancellationReason": reason}
                    )
            except Exception as e:
                logger.debug(f"Cal.com cancellation API error: {e}")

        meeting.status = "cancelled"
        meeting.cancellation_reason = reason
        await db.commit()

        try:
            from app.services.process_logger import log_process_event
            await log_process_event(
                subsystem="calendar",
                process_name="meeting_cancelled",
                message=f"Meeting {booking_id} for {meeting.prospect} cancelled: {reason}",
                level="WARN",
                details={"meeting_id": booking_id, "reason": reason}
            )
        except Exception:
            pass

        return {"success": True, "bookingId": booking_id, "status": "cancelled"}

    async def get_overview_stats(self, db: AsyncSession) -> Dict[str, Any]:
        """Returns summary statistics for the Meeting Scheduler Plugin."""
        res_meetings = await db.execute(select(Meeting).order_by(Meeting.created_at.desc()))
        meetings = res_meetings.scalars().all()

        res_events = await db.execute(select(MeetingEventType))
        event_types = res_events.scalars().all()

        setting = await self.get_or_create_settings(db)
        status_info = await self.check_calcom_status(db)

        upcoming = [m for m in meetings if m.status == "upcoming"]
        completed = [m for m in meetings if m.status in ["completed", "converted"]]
        cancelled = [m for m in meetings if m.status == "cancelled"]

        return {
            "totalBookings": len(meetings),
            "upcomingCount": len(upcoming),
            "completedCount": len(completed),
            "cancelledCount": len(cancelled),
            "eventTypesCount": len(event_types),
            "hostEmail": setting.host_email,
            "hostName": setting.host_name,
            "calcomConnected": status_info["connected"],
            "calcomStatus": status_info
        }



    async def reschedule_booking(self, db: AsyncSession, booking_id: str, new_date: str, new_time: str, reason: str = "") -> Dict[str, Any]:
        """Reschedules an existing booking to a new date and time."""
        result = await db.execute(select(Meeting).where(Meeting.id == booking_id))
        meeting = result.scalars().first()
        if not meeting:
            res2 = await db.execute(select(Meeting).where(Meeting.calcom_booking_id == booking_id))
            meeting = res2.scalars().first()

        if not meeting:
            return {"success": False, "error": "Meeting not found"}

        old_date = meeting.date
        old_time = meeting.time
        setting = await self.get_or_create_settings(db)
        host_tz = meeting.host_timezone or setting.timezone or "Europe/London"
        p_tz = meeting.prospect_timezone or host_tz
        slots = await self.get_available_slots(db, new_date, meeting.event_type_slug or "15-min-discovery")
        open_times = [s["time"] for s in slots if s.get("available")]
        new_time_n = _norm_time(new_time)
        if new_time_n not in open_times:
            return {
                "success": False,
                "error": "outside_hours_or_taken",
                "availableSlots": open_times[:6],
                "message": "That time is not free on our calendar.",
            }
        stamp = stamp_from_host(new_date, new_time_n, host_tz, p_tz)
        meeting.date = stamp["date"]
        meeting.time = stamp["time"]
        meeting.host_timezone = stamp["host_timezone"]
        meeting.prospect_timezone = stamp["prospect_timezone"]
        meeting.prospect_date = stamp["prospect_date"]
        meeting.prospect_time = stamp["prospect_time"]
        meeting.starts_at_utc = stamp["starts_at_utc"]
        meeting.status = "upcoming"
        if reason:
            prior_prep = meeting.prep or ""
            meeting.prep = f"{prior_prep}\n[Rescheduled from {old_date} {old_time} to {new_date} {new_time}. Reason: {reason}]".strip()

        # If Cal.com API key is configured and calcom booking exists
        if setting.api_key and meeting.calcom_booking_id and not meeting.calcom_booking_id.startswith("cal_"):
            try:
                headers = {"Authorization": f"Bearer {setting.api_key}", "Content-Type": "application/json"}
                start_iso = to_utc(new_date, new_time_n, host_tz).strftime("%Y-%m-%dT%H:%M:%SZ")
                async with httpx.AsyncClient(timeout=4.0) as client:
                    await client.patch(
                        f"{setting.base_url.rstrip('/')}/bookings/{meeting.calcom_booking_id}",
                        headers=headers,
                        json={"start": start_iso, "reschedulingReason": reason}
                    )
            except Exception as e:
                logger.debug(f"Cal.com reschedule API fallback: {e}")

        # Add notification
        notif = Notification(
            id=f"notif_{uuid.uuid4().hex[:8]}",
            text=f"Meeting with {meeting.prospect} rescheduled to {new_date} at {new_time}.",
            type="info",
            time="Just now"
        )
        db.add(notif)
        await db.commit()
        await db.refresh(meeting)

        try:
            from app.services.process_logger import log_process_event
            await log_process_event(
                subsystem="calendar",
                process_name="meeting_rescheduled",
                message=f"Meeting {booking_id} for {meeting.prospect} rescheduled to {new_date} {new_time}",
                level="INFO",
                details={"meeting_id": booking_id, "old_date": old_date, "old_time": old_time, "new_date": new_date, "new_time": new_time, "reason": reason}
            )
        except Exception:
            pass

        return {
            "success": True,
            "bookingId": meeting.id,
            "newDate": new_date,
            "newTime": new_time,
            "status": "upcoming"
        }

    def generate_ics(self, meeting: Meeting, brand: Optional[Dict[str, str]] = None) -> str:
        """Generates iCalendar with host-local time converted to UTC so clients show their own zone."""
        brand = brand or {}
        company = brand.get("name") or meeting.host or "Meeting"
        domain = brand.get("domain") or "calendar.local"
        try:
            host_tz = meeting.host_timezone or "Europe/London"
            start_local = combine_local(meeting.date, meeting.time, host_tz)
            dur = 15
            if meeting.duration:
                dur_str = "".join([c for c in meeting.duration if c.isdigit()])
                if dur_str:
                    dur = int(dur_str)
            end_local = start_local + timedelta(minutes=dur)
            dtstart = start_local.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            dtend = end_local.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            dtstamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        except Exception:
            dtstart = datetime.utcnow().strftime("%Y%m%dT%H%M00Z")
            dtend = (datetime.utcnow() + timedelta(minutes=15)).strftime("%Y%m%dT%H%M00Z")
            dtstamp = dtstart

        topic = (meeting.event_type_slug or "discovery").replace("-", " ").title()
        summary = (meeting.mission or "").strip() or _meeting_display_title(
            company, meeting.prospect or "Guest", meeting.duration or topic or "15 min"
        )
        join = meeting.video_link or ""
        description = (
            f"{summary}\n"
            f"Join: {join}\n"
            f"Platform: {meeting.platform or 'Video call'}\n"
            f"Host: {meeting.host} ({meeting.host_email or ''})\n"
            f"Guest: {meeting.attendee or meeting.prospect} ({meeting.attendee_email or ''})"
        )
        uid = f"{meeting.id}@{domain}"

        ics_lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            f"PRODID:-//{_ics_escape(company)}//Calendar//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:REQUEST",
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{dtstamp}",
            f"DTSTART:{dtstart}",
            f"DTEND:{dtend}",
            f"SUMMARY:{_ics_escape(summary)}",
            f"DESCRIPTION:{_ics_escape(description)}",
            f"LOCATION:{_ics_escape(join or 'Video call')}",
            f"ORGANIZER;CN={_ics_escape(meeting.host or company)}:mailto:{meeting.host_email or ('invite@' + domain)}",
            f"ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE;CN={_ics_escape(meeting.prospect or '')}:mailto:{meeting.attendee_email or 'attendee@example.com'}",
            "STATUS:CONFIRMED",
            "SEQUENCE:0",
        ]
        if join:
            ics_lines.append(f"CONFERENCE;VALUE=URI;FEATURE=VIDEO:{join}")
        ics_lines.extend([
            "BEGIN:VALARM",
            "TRIGGER:-PT15M",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{_ics_escape(company)} meeting in 15 minutes",
            "END:VALARM",
            "END:VEVENT",
            "END:VCALENDAR",
        ])
        return "\r\n".join(ics_lines)

    def _public_config(self, cfg: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        data = dict(cfg or {})
        has_pw = bool(data.get("smtp_password"))
        data.pop("smtp_password", None)
        data["hasPassword"] = has_pw
        return data

    async def _primary_mail_account(self, db: AsyncSession):
        ready = await self._mail_accounts_ready(db)
        return ready[0] if ready else None

    def _smtp_send_sync(self, host, port, use_tls, username, password, from_addr, to_addrs, msg_bytes) -> None:
        port = int(port or 587)
        ctx = ssl.create_default_context()
        # one.com / many hosts use 465 implicit SSL — STARTTLS on 465 fails.
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=20, context=ctx) as smtp:
                smtp.login(username, password)
                smtp.sendmail(from_addr, to_addrs, msg_bytes)
            return
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            smtp.ehlo()
            if use_tls is not False:
                smtp.starttls(context=ctx)
                smtp.ehlo()
            smtp.login(username, password)
            smtp.sendmail(from_addr, to_addrs, msg_bytes)

    def _smtp_host_for(self, cfg: Dict[str, Any], from_addr: str = "") -> str:
        host = str(cfg.get("host") or "").strip()
        if host:
            return host
        provider = str(cfg.get("provider") or "").lower()
        if provider in ("google", "gmail"):
            return "smtp.gmail.com"
        if provider in ("outlook", "microsoft", "office365"):
            return "smtp.office365.com"
        domain = (from_addr or "").split("@")[-1].lower()
        if domain in ("one.com",) or domain.endswith(".one"):
            return "send.one.com"
        # Custom domains on one.com still need host saved — common default:
        if provider in ("smtp", "custom", "one.com"):
            return "send.one.com"
        return ""

    async def _mail_accounts_ready(self, db: AsyncSession) -> List[Any]:
        from app.models.models import Connection
        result = await db.execute(select(Connection).where(Connection.group_name == "Communication Accounts"))
        rows = list(result.scalars().all())

        def _pw(c) -> str:
            cfg = c.config or {}
            for k in ("smtp_password", "app_password", "password", "auth_password"):
                v = str(cfg.get(k) or "").strip()
                if v:
                    return v
            return ""

        ready = [c for c in rows if (c.config or {}).get("email") and _pw(c)]
        if not ready:
            return []
        primary = [c for c in ready if (c.config or {}).get("is_primary")]
        smtpish = [
            c for c in ready
            if str((c.config or {}).get("provider") or "").lower() in ("smtp", "custom", "one.com")
            or "one.com" in str((c.config or {}).get("host") or "").lower()
            or "send.one.com" in str((c.config or {}).get("host") or "").lower()
        ]
        # Prefer primary, then custom/one.com (user's working path), then any with password.
        ordered: List[Any] = []
        for bucket in (primary, smtpish, ready):
            for c in bucket:
                if c not in ordered:
                    ordered.append(c)
        return ordered

    async def send_outbound_email(
        self,
        db: AsyncSession,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
        ics_text: Optional[str] = None,
    ) -> Dict[str, Any]:
        accounts = await self._mail_accounts_ready(db)
        if not accounts:
            return {
                "ok": False,
                "error": "No mail account with SMTP password. Open Communication Accounts and re-save your custom/one.com or Gmail account with the password.",
            }
        brand = await self._company_brand(db)
        last_err = "SMTP send failed"
        for acc in accounts:
            cfg = acc.config or {}
            from_addr = (cfg.get("email") or "").strip()
            password = ""
            for k in ("smtp_password", "app_password", "password", "auth_password"):
                password = str(cfg.get(k) or "").strip()
                if password:
                    break
            if not from_addr or not password:
                continue
            host = self._smtp_host_for(cfg, from_addr)
            if not host:
                last_err = f"Mail account {from_addr} has no SMTP host. Re-save Custom SMTP with host (e.g. send.one.com)."
                continue
            port = int(cfg.get("port") or (465 if "one.com" in host.lower() else 587))
            use_tls = cfg.get("use_tls", True)
            if port == 465:
                use_tls = False
            sender_name = cfg.get("sender_name") or brand.get("name") or from_addr

            msg = MIMEMultipart("mixed")
            msg["Subject"] = subject
            msg["From"] = f"{sender_name} <{from_addr}>"
            msg["To"] = to_email
            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(text_body or html_lib.unescape(re.sub(r"<[^>]+>", " ", html_body)), "plain", "utf-8"))
            alt.attach(MIMEText(html_body, "html", "utf-8"))
            msg.attach(alt)
            if ics_text:
                part = MIMEBase("text", "calendar", method="REQUEST")
                part.set_payload(ics_text)
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", "attachment", filename="invite.ics")
                msg.add_header("Content-Class", "urn:content-classes:calendarmessage")
                msg.attach(part)

            try:
                await asyncio.to_thread(
                    self._smtp_send_sync,
                    host, port, use_tls, from_addr, password, from_addr, [to_email], msg.as_string(),
                )
                return {"ok": True, "from": from_addr, "to": to_email, "host": host}
            except Exception as err:
                logger.warning(f"SMTP send via {from_addr}@{host}:{port} failed: {err}")
                last_err = str(err)[:300]
                try:
                    await asyncio.sleep(0.4)
                    # one.com often wants 465 if 587 failed (or reverse)
                    alt_port = 587 if int(port) == 465 else 465
                    await asyncio.to_thread(
                        self._smtp_send_sync,
                        host, alt_port, alt_port != 465, from_addr, password, from_addr, [to_email], msg.as_string(),
                    )
                    return {"ok": True, "from": from_addr, "to": to_email, "host": host, "port": alt_port, "retried": True}
                except Exception as err2:
                    logger.warning(f"SMTP retry via {from_addr} failed: {err2}")
                    last_err = str(err2)[:300]
                    continue
        return {"ok": False, "error": last_err}
    async def send_booking_emails(self, db: AsyncSession, meeting: Meeting, video_link: str) -> Dict[str, Any]:
        setting = await self.get_or_create_settings(db)
        brand = await self._company_brand(db)
        company = brand["name"]
        host_name = meeting.host or brand.get("caller") or company
        ics = self.generate_ics(meeting, brand)
        result = {"attendee": False, "host": False, "error": None}
        p_tz = meeting.prospect_timezone or meeting.host_timezone or "Europe/London"
        h_tz = meeting.host_timezone or "Europe/London"
        p_date = meeting.prospect_date or meeting.date
        p_time = meeting.prospect_time or meeting.time
        attendee_when = _pretty_datetime(p_date, p_time, p_tz)
        host_when = _pretty_datetime(meeting.date, meeting.time, h_tz)
        zones_differ = short_label(p_tz) != short_label(h_tz)
        first = (meeting.prospect or "there").strip().split()[0]
        plat = meeting.platform or "Video call"
        dur = meeting.duration or "15 min"
        subject = (meeting.mission or "").strip() or f"Confirmed: {company} — {attendee_when}"
        if not subject.lower().startswith("confirmed"):
            subject = f"Confirmed: {subject}"
        html = _booking_email_html(
            greeting_name=first,
            host_name=host_name,
            company_name=company,
            company_website=brand.get("website") or "",
            duration=dur,
            when_primary=attendee_when,
            when_secondary=host_when if zones_differ else None,
            join_url=video_link,
            platform_label=plat,
            is_host=False,
        )
        text = (
            f"Hi {first},\n\nYou are booked with {host_name} at {company} for a {dur} intro.\n"
            f"When: {attendee_when}\nJoin: {video_link}\n\nA calendar invite is attached.\n"
        )
        if setting.auto_email_attendee and meeting.attendee_email:
            sent = await self.send_outbound_email(db, meeting.attendee_email, subject, html, text_body=text, ics_text=ics)
            result["attendee"] = bool(sent.get("ok"))
            if not sent.get("ok"):
                result["error"] = sent.get("error")
        if setting.auto_email_host and meeting.host_email:
            host_html = _booking_email_html(
                greeting_name=host_name,
                host_name=host_name,
                company_name=company,
                company_website=brand.get("website") or "",
                duration=dur,
                when_primary=host_when,
                when_secondary=attendee_when if zones_differ else None,
                join_url=video_link,
                platform_label=plat,
                is_host=True,
            )
            host_text = (
                f"Hi {meeting.host},\n\n{meeting.prospect} ({meeting.attendee_email}) booked a {dur} intro.\n"
                f"Your diary: {host_when}\nJoin: {video_link}\n"
            )
            sent_h = await self.send_outbound_email(
                db,
                meeting.host_email,
                f"New booking: {meeting.prospect} — {host_when}",
                host_html,
                text_body=host_text,
                ics_text=ics,
            )
            result["host"] = bool(sent_h.get("ok"))
            if not sent_h.get("ok") and not result["error"]:
                result["error"] = sent_h.get("error")
        return result

    async def get_communication_accounts(self, db: AsyncSession) -> List[Dict[str, Any]]:
        """Retrieves all connected communication accounts (Gmail, Outlook, SMTP, Zoom)."""
        from app.models.models import Connection
        result = await db.execute(
            select(Connection).where(Connection.group_name == "Communication Accounts")
        )
        conns = result.scalars().all()

        # If no accounts in DB, initialize standard provider profiles
        if not conns:
            defaults = [
                {
                    "id": "comm_google_default",
                    "group_name": "Communication Accounts",
                    "name": "Google / Gmail & Calendar",
                    "status": "not_configured",
                    "api_key_masked": None,
                    "config": {
                        "provider": "google",
                        "email": "",
                        "sender_name": "",
                        "host": "smtp.gmail.com",
                        "port": 587,
                        "use_tls": True,
                        "sync_calendar": True,
                        "send_invites": True,
                        "video_provider": "google_meet",
                        "is_primary": True,
                        "connected_at": None
                    }
                },
                {
                    "id": "comm_outlook_default",
                    "group_name": "Communication Accounts",
                    "name": "Microsoft Outlook / 365",
                    "status": "not_configured",
                    "api_key_masked": None,
                    "config": {
                        "provider": "outlook",
                        "email": "",
                        "sender_name": "",
                        "sync_calendar": False,
                        "send_invites": False,
                        "video_provider": "ms_teams",
                        "is_primary": False,
                        "connected_at": None
                    }
                },
                {
                    "id": "comm_smtp_default",
                    "group_name": "Communication Accounts",
                    "name": "Custom SMTP / Corporate Domain",
                    "status": "not_configured",
                    "api_key_masked": None,
                    "config": {
                        "provider": "smtp",
                        "host": "smtp.gmail.com",
                        "port": 587,
                        "email": "",
                        "sender_name": "",
                        "use_tls": True,
                        "is_primary": False,
                        "connected_at": None
                    }
                },
                {
                    "id": "comm_zoom_default",
                    "group_name": "Communication Accounts",
                    "name": "Zoom Meetings",
                    "status": "not_configured",
                    "api_key_masked": None,
                    "config": {
                        "provider": "zoom",
                        "account_id": "",
                        "is_primary": False,
                        "connected_at": None
                    }
                }
            ]
            for d in defaults:
                c = Connection(
                    id=d["id"],
                    group_name=d["group_name"],
                    name=d["name"],
                    status=d["status"],
                    api_key_masked=d["api_key_masked"],
                    config=d["config"]
                )
                db.add(c)
            await db.commit()
            return defaults

        out = []
        for c in conns:
            cfg = dict(c.config or {})
            has_pw = bool(cfg.get("smtp_password"))
            cfg.pop("smtp_password", None)
            cfg["hasPassword"] = has_pw
            out.append({
                "id": c.id,
                "name": c.name,
                "status": c.status,
                "apiKeyMasked": c.api_key_masked,
                "config": cfg
            })
        return out

    async def save_communication_account(self, db: AsyncSession, account_data: Dict[str, Any]) -> Dict[str, Any]:
        """Saves or updates a communication account (Gmail, Outlook, Custom SMTP, etc.)."""
        from app.models.models import Connection
        acc_id = account_data.get("id") or f"comm_{uuid.uuid4().hex[:8]}"
        result = await db.execute(select(Connection).where(Connection.id == acc_id))
        conn = result.scalars().first()

        provider = account_data.get("provider", "google")
        display_name = account_data.get("name") or (
            "Google / Gmail & Calendar" if provider == "google" else
            ("Microsoft Outlook / 365" if provider == "outlook" else
            ("Custom SMTP Server" if provider == "smtp" else f"{provider.capitalize()} Account"))
        )

        cfg = account_data.get("config", {})
        if "provider" not in cfg:
            cfg["provider"] = provider
        prev_pw = (conn.config or {}).get("smtp_password") if conn and isinstance(conn.config, dict) else None
        if account_data.get("password"):
            cfg["smtp_password"] = account_data.get("password")
        if account_data.get("apiKey") and not cfg.get("smtp_password"):
            cfg["smtp_password"] = account_data.get("apiKey")
        if not cfg.get("smtp_password") and prev_pw:
            cfg["smtp_password"] = prev_pw
        if "connected_at" not in cfg or not cfg["connected_at"]:
            cfg["connected_at"] = datetime.utcnow().strftime("%Y-%m-%d %H:%M")

        is_primary = cfg.get("is_primary", False)

        # If this is marked as primary, unmark others
        if is_primary:
            all_conns_res = await db.execute(select(Connection).where(Connection.group_name == "Communication Accounts"))
            all_conns = all_conns_res.scalars().all()
            for other in all_conns:
                if other.id != acc_id and other.config:
                    updated_cfg = dict(other.config)
                    updated_cfg["is_primary"] = False
                    other.config = updated_cfg

        if not conn:
            conn = Connection(
                id=acc_id,
                group_name="Communication Accounts",
                name=display_name,
                status=account_data.get("status", "connected"),
                api_key_masked="••••••••" if account_data.get("password") or account_data.get("apiKey") else "oauth_connected",
                config=cfg
            )
            db.add(conn)
        else:
            conn.name = display_name
            conn.status = account_data.get("status", "connected")
            if account_data.get("password") or account_data.get("apiKey"):
                conn.api_key_masked = "••••••••"
            merged_cfg = dict(conn.config or {})
            incoming_pw = cfg.get("smtp_password")
            merged_cfg.update(cfg)
            if not merged_cfg.get("smtp_password") and (incoming_pw or prev_pw):
                merged_cfg["smtp_password"] = incoming_pw or prev_pw
            conn.config = merged_cfg

        # Also sync host_email in CalcomSetting if this account is primary or host
        if cfg.get("email"):
            setting = await self.get_or_create_settings(db)
            if is_primary or not setting.host_email:
                setting.host_email = cfg["email"]
                if cfg.get("sender_name"):
                    setting.host_name = cfg["sender_name"]
                db.add(setting)

        await db.commit()
        await db.refresh(conn)

        public_cfg = dict(conn.config or {})
        public_cfg.pop("smtp_password", None)
        public_cfg["hasPassword"] = bool((conn.config or {}).get("smtp_password"))

        return {
            "success": True,
            "account": {
                "id": conn.id,
                "name": conn.name,
                "status": conn.status,
                "apiKeyMasked": conn.api_key_masked,
                "config": public_cfg
            }
        }

    async def delete_communication_account(self, db: AsyncSession, account_id: str) -> bool:
        """Removes or resets a communication account."""
        from app.models.models import Connection
        result = await db.execute(select(Connection).where(Connection.id == account_id))
        conn = result.scalars().first()
        if not conn:
            return False
        # Reset to not_configured rather than hard delete if default
        if "default" in account_id:
            conn.status = "not_configured"
            conn.api_key_masked = None
            cfg = dict(conn.config or {})
            cfg["email"] = ""
            cfg["is_primary"] = False
            cfg["connected_at"] = None
            conn.config = cfg
        else:
            await db.delete(conn)
        await db.commit()
        return True

    async def test_communication_account(self, db: AsyncSession, account_id: str) -> Dict[str, Any]:
        """Real SMTP login test for Gmail / Outlook / custom SMTP."""
        from app.models.models import Connection
        result = await db.execute(select(Connection).where(Connection.id == account_id))
        conn = result.scalars().first()
        if not conn:
            return {"success": False, "error": "Account not found"}

        cfg = conn.config or {}
        email = (cfg.get("email") or "").strip()
        password = (cfg.get("smtp_password") or "").strip()
        provider = cfg.get("provider") or "google"
        host = self._smtp_host_for(cfg, email) or (
            "smtp.gmail.com" if provider == "google" else "smtp.office365.com" if provider == "outlook" else ""
        )
        port = int(cfg.get("port") or (465 if "one.com" in (host or "").lower() else 587))
        use_tls = cfg.get("use_tls", True)
        if port == 465:
            use_tls = False

        if not email:
            return {"success": False, "error": "Email address is required."}
        if not password:
            return {
                "success": False,
                "error": "SMTP password missing. For Gmail use a 16-character App Password. For one.com / custom SMTP paste the mailbox password and set host (send.one.com) + port (465 or 587).",
            }
        if not host:
            return {
                "success": False,
                "error": "SMTP host missing. For one.com use send.one.com (port 465 SSL or 587 STARTTLS).",
            }

        start = datetime.utcnow()
        try:
            def _login():
                self._smtp_send_sync(host, port, use_tls, email, password, email, [email], b"")
            # login-only probe without sendmail empty — use raw connect
            def _login_only():
                ctx = ssl.create_default_context()
                if port == 465:
                    with smtplib.SMTP_SSL(host, port, timeout=18, context=ctx) as smtp:
                        smtp.login(email, password)
                else:
                    with smtplib.SMTP(host, port, timeout=18) as smtp:
                        smtp.ehlo()
                        if use_tls is not False:
                            smtp.starttls(context=ctx)
                            smtp.ehlo()
                        smtp.login(email, password)
            await asyncio.to_thread(_login_only)
            latency = int((datetime.utcnow() - start).total_seconds() * 1000)
            conn.status = "connected"
            await db.commit()
            return {
                "success": True,
                "accountId": account_id,
                "provider": provider,
                "email": email,
                "latencyMs": latency,
                "calendarSync": cfg.get("sync_calendar", True),
                "outboundEmail": cfg.get("send_invites", True),
                "message": f"SMTP login OK for {email} via {host}:{port}. Ready to send meeting invites.",
            }
        except Exception as err:
            # Try alternate port once (587 <-> 465) — common one.com mismatch
            try:
                alt_port = 587 if port == 465 else 465
                def _login_alt():
                    ctx = ssl.create_default_context()
                    if alt_port == 465:
                        with smtplib.SMTP_SSL(host, alt_port, timeout=18, context=ctx) as smtp:
                            smtp.login(email, password)
                    else:
                        with smtplib.SMTP(host, alt_port, timeout=18) as smtp:
                            smtp.ehlo()
                            smtp.starttls(context=ctx)
                            smtp.ehlo()
                            smtp.login(email, password)
                await asyncio.to_thread(_login_alt)
                cfg["port"] = alt_port
                conn.config = dict(cfg)
                conn.status = "connected"
                await db.commit()
                latency = int((datetime.utcnow() - start).total_seconds() * 1000)
                return {
                    "success": True,
                    "accountId": account_id,
                    "provider": provider,
                    "email": email,
                    "latencyMs": latency,
                    "calendarSync": cfg.get("sync_calendar", True),
                    "outboundEmail": cfg.get("send_invites", True),
                    "message": f"SMTP login OK for {email} via {host}:{alt_port} (auto-switched port). Ready to send meeting invites.",
                }
            except Exception:
                pass
            conn.status = "error"
            await db.commit()
            hint = str(err)
            if "Application-specific password" in hint or "Username and Password not accepted" in hint or "535" in hint:
                if provider in ("google", "gmail"):
                    hint = "Gmail rejected the password. Turn on 2-Step Verification, create an App Password, paste that 16-character code (not your normal Gmail password)."
                else:
                    hint = f"SMTP auth failed for {email} via {host}:{port}. Check password and that host/port match your provider (one.com: send.one.com, 465 or 587)."
            return {"success": False, "error": hint[:400], "email": email, "provider": provider}


calendar_service = CalendarService()


