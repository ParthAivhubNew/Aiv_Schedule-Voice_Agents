"""
Smart Booking Tools & Schema Generator
Provides:
1. Provider-agnostic tool schemas (OpenAI / Telnyx / Vapi / Retell / LiveKit compatible).
2. Dynamic parameter adaptation based on prospect data completeness (Full, Partial, Minimal).
3. Verbatim ISO-8601 start time enforcement (eliminating date/time hallucinations).
4. Direct execution handler for live call function calls.
"""

import logging
from typing import Any, Dict, List, Optional
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

logger = logging.getLogger("booking_tools")

CALLER_TZ_PARAM = {
    "type": "string",
    "description": (
        "Only when the caller says they are in a different timezone from the one assumed "
        "(e.g. 'America/New_York' for 'I'm on Eastern time'). Leave out otherwise."
    ),
}

MAX_SLOT_DAYS = 7
MAX_SLOTS_OFFERED = 8
SLOTS_PER_DAY = 3


def generate_smart_booking_tools(call_context: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Generates dynamic tool definitions adapted to the call direction & lead data completeness.
    """
    direction = call_context.get("direction", "outbound")
    prospect = call_context.get("prospect") or {}
    caller = call_context.get("caller") or {}
    company = call_context.get("company") or {}
    temporal = call_context.get("temporal_context") or {}

    today_iso = temporal.get("today_iso", datetime.utcnow().strftime("%Y-%m-%d"))
    timezone = temporal.get("timezone", "Europe/London")

    # 1. Availability Checker Tool
    check_availability_tool = {
        "type": "function",
        "function": {
            "name": "check_availability",
            "description": (
                "Check the calendar for open appointment slots on specific dates. "
                "Call this as soon as the caller/prospect indicates a day or time preference (e.g. 'tomorrow morning', 'Friday', 'next Tuesday'). "
                f"Use today's date ({today_iso}) and timezone ({timezone}) as reference."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": f"First date to check in YYYY-MM-DD format (e.g. '{today_iso}')."
                    },
                    "end_date": {
                        "type": "string",
                        "description": "Last date to check in YYYY-MM-DD format (usually start_date + 1 day, or up to 7 days for a range)."
                    },
                    "caller_timezone": CALLER_TZ_PARAM,
                },
                "required": ["start_date", "end_date"]
            }
        }
    }

    # 2. Adaptive Booking Tool based on lead data
    known_name = prospect.get("name") or caller.get("name") or ""
    known_email = prospect.get("email") or caller.get("email") or ""

    properties: Dict[str, Any] = {
        "start_time": {
            "type": "string",
            "description": (
                "The EXACT ISO-8601 start timestamp from the check_availability response "
                "(e.g. '2026-09-25T10:30:00+01:00'). DO NOT reformat or guess - copy verbatim."
            )
        },
        "caller_timezone": CALLER_TZ_PARAM,
    }
    required_fields = ["start_time"]

    from app.services.booking_policy import enabled_meeting_types
    policy = call_context.get("booking_policy")
    types = enabled_meeting_types(policy) if policy else []
    allowed_types = [t["id"] for t in types if t.get("id")] or ["phone", "video", "in_person"]
    default_type = (policy.get("default_meeting_type") if policy else None) or (allowed_types[0] if allowed_types else "video")
    properties["meeting_type"] = {
        "type": "string",
        "enum": allowed_types,
        "description": f"The agreed meeting format. Allowed values: {', '.join(allowed_types)}. Defaults to '{default_type}' if not specified."
    }

    # If name is unknown, require the AI to collect it
    if not known_name:
        properties["attendee_name"] = {
            "type": "string",
            "description": "The attendee's full name collected from the caller."
        }
        required_fields.append("attendee_name")
    else:
        properties["attendee_name"] = {
            "type": "string",
            "description": f"The attendee's full name (pre-known as '{known_name}')."
        }

    # If email is unknown, require the AI to collect it
    if not known_email:
        properties["attendee_email"] = {
            "type": "string",
            "description": "The attendee's confirmed email address (spelled back for accuracy)."
        }
        required_fields.append("attendee_email")
    else:
        properties["attendee_email"] = {
            "type": "string",
            "description": f"The attendee's email address (pre-known as '{known_email}'; confirm on call)."
        }

    book_tool = {
        "type": "function",
        "function": {
            "name": "book_appointment",
            "description": (
                "Lock in the appointment and create a real calendar booking. "
                "Call this ONLY after the prospect/caller has picked an open slot and confirmed their details."
            ),
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required_fields
            }
        }
    }

    return [check_availability_tool, book_tool]


def _parse_start_time(raw: str, today_iso: str):
    """(date, 'HH:MM', instant) from a start time. `instant` is an aware datetime when the text
    carries a UTC offset (what check_availability hands out); otherwise None and the date/time
    are the caller's own wall clock. (None, None, None) when there is no usable time."""
    text = (raw or "").strip()
    if not text:
        return None, None, None
    if "T" in text or " " in text:
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00").replace(" ", "T", 1))
        except ValueError:
            dt = None
        if dt is not None:
            return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M"), (dt if dt.tzinfo else None)
        return None, None, None
    if ":" in text:
        return today_iso, text[:5], None
    return None, None, None


async def _slot_zones(db: AsyncSession, args: Dict[str, Any], call_context: Dict[str, Any]):
    """(account timezone, caller timezone). The caller's zone is what they said on the call, else
    the one worked out for the call (their number, campaign), else the account's."""
    from app.services.org_settings import org_timezone
    from app.services.timezone_service import normalize_stated_timezone

    temporal = call_context.get("temporal_context") or {}
    host_tz = await org_timezone(db)
    stated = normalize_stated_timezone(args.get("caller_timezone"))
    caller_tz = stated or temporal.get("timezone") or host_tz
    return host_tz, caller_tz


async def _open_slots(db, calendar_service, date_iso: str, caller_tz: str) -> List[Dict[str, Any]]:
    from app.services.timezone_service import combine_local, display_hhmm

    rows = await calendar_service.get_available_slots(
        db=db, date_str=date_iso, event_type_slug="15-min-discovery", prospect_tz=caller_tz,
    )
    out: List[Dict[str, Any]] = []
    for s in rows or []:
        if not s.get("offerable", s.get("available")):
            continue
        c_date = s.get("prospectDate") or date_iso
        c_time = s.get("prospectTime") or s.get("time")
        if not c_time:
            continue
        try:
            start = combine_local(c_date, c_time, caller_tz).isoformat(timespec="seconds")
            day = datetime.strptime(c_date, "%Y-%m-%d").strftime("%A %d %B")
        except Exception:
            continue
        out.append({"start": start, "spoken": f"{day}, {display_hhmm(c_time)}"})
    return out


async def execute_smart_booking_tool(
    db: AsyncSession,
    tool_name: str,
    args: Dict[str, Any],
    call_context: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Executes booking tool calls in real time (Internal DB or Cal.com).

    Times the caller hears and the ISO starts handed back are in the caller's timezone; what is
    stored (meeting, calendar, call log) stays in the account timezone, which create_booking
    handles from the start time it is given.
    """
    from datetime import timedelta
    from app.services.calendar_service import calendar_service
    from app.services.timezone_service import display_hhmm, short_label, tzinfo

    args = dict(args or {})
    # The hosted assistant names these fields email / name.
    if not args.get("attendee_email") and args.get("email"):
        args["attendee_email"] = args["email"]
    if not args.get("attendee_name") and args.get("name"):
        args["attendee_name"] = args["name"]

    temporal = call_context.get("temporal_context") or {}
    prospect = call_context.get("prospect") or {}
    today_iso = temporal.get("today_iso", datetime.utcnow().strftime("%Y-%m-%d"))

    if tool_name == "check_availability":
        start_date = str(args.get("start_date") or "").strip() or today_iso
        end_date = str(args.get("end_date") or "").strip() or start_date
        try:
            host_tz, caller_tz = await _slot_zones(db, args, call_context)
            first = datetime.strptime(start_date, "%Y-%m-%d")
            last = datetime.strptime(end_date, "%Y-%m-%d")
            span = max(0, min((last - first).days, MAX_SLOT_DAYS - 1))

            offered: List[Dict[str, Any]] = []
            total = 0
            for n in range(span + 1):
                day_slots = await _open_slots(db, calendar_service, (first + timedelta(days=n)).strftime("%Y-%m-%d"), caller_tz)
                total += len(day_slots)
                offered.extend(day_slots[:SLOTS_PER_DAY])
            offered = offered[:MAX_SLOTS_OFFERED]

            if offered:
                return {
                    "success": True,
                    "available_slots": [o["start"] for o in offered],
                    "spoken_slots": [o["spoken"] for o in offered],
                    "total_found": total,
                    "timezone": caller_tz,
                    "message": (
                        "Offer two or three of spoken_slots. Say only the spoken form. When booking, pass the matching "
                        "entry of available_slots unchanged as start_time."
                    ),
                }

            # Nothing free in the range: look ahead so the caller is never told "we are full" without an alternative.
            nxt: List[Dict[str, Any]] = []
            for n in range(1, MAX_SLOT_DAYS + 1):
                nxt.extend((await _open_slots(db, calendar_service, (last + timedelta(days=n)).strftime("%Y-%m-%d"), caller_tz))[:SLOTS_PER_DAY])
                if len(nxt) >= 3:
                    break
            nxt = nxt[:MAX_SLOTS_OFFERED]
            return {
                "success": True,
                "available_slots": [],
                "next_available_slots": [o["start"] for o in nxt],
                "next_spoken_slots": [o["spoken"] for o in nxt],
                "timezone": caller_tz,
                "message": (
                    f"Nothing is free between {start_date} and {end_date}. "
                    + ("Offer the next_spoken_slots instead." if nxt else "Say the calendar is full for now and offer to have someone follow up.")
                ),
            }
        except Exception as e:
            logger.warning(f"[BOOKING-TOOL] Availability check error: {e}")
            return {"success": False, "error": str(e), "available_slots": []}

    elif tool_name == "book_appointment":
        start_time = str(args.get("start_time") or "").strip()
        attendee_name = str(args.get("attendee_name") or prospect.get("name") or "Valued Client").strip()
        attendee_email = str(args.get("attendee_email") or prospect.get("email") or "").strip()
        raw_meeting_type = str(args.get("meeting_type") or args.get("format_type") or args.get("format") or "").strip()

        if not start_time:
            return {"success": False, "error": "Missing start_time"}
        if not attendee_email:
            return {"success": False, "error": "Missing attendee_email"}

        from app.services.booking_policy import resolve_meeting_type
        policy = call_context.get("booking_policy")
        resolved_mt = resolve_meeting_type(policy, raw_meeting_type) if policy and raw_meeting_type else None

        format_type = (resolved_mt.get("id") if resolved_mt else raw_meeting_type) or (policy.get("default_meeting_type") if policy else None) or "video"
        platform = "Google Meet"
        if resolved_mt:
            platform = resolved_mt.get("default_platform") or ("Phone call" if format_type == "phone" else "In person" if format_type == "in_person" else "Google Meet")
        elif format_type == "phone":
            platform = "Phone call"
        elif format_type == "in_person":
            platform = "In person"

        date_str, time_str, instant = _parse_start_time(start_time, today_iso)
        if not date_str or not time_str:
            return {
                "success": False,
                "error": "start_time must be one of the available_slots from check_availability. Check availability again and use one of those.",
            }

        try:
            host_tz, caller_tz = await _slot_zones(db, args, call_context)
            if instant is not None:
                # An exact moment: store it in the account's timezone.
                local = instant.astimezone(tzinfo(host_tz))
                date_str, time_str = local.strftime("%Y-%m-%d"), local.strftime("%H:%M")
                caller_local = False
            else:
                caller_local = True  # a bare date/time is the caller's own wall clock

            booking_res = await calendar_service.create_booking(
                db=db,
                prospect_name=attendee_name,
                attendee_email=attendee_email,
                date_str=date_str,
                time_str=time_str,
                event_type_slug="15-min-discovery",
                duration_minutes=int(policy.get("duration_minutes") or 15) if policy else 15,
                format_type=format_type,
                platform=platform,
                prospect_timezone=caller_tz,
                prospect_phone=prospect.get("phone") or None,
                time_is_prospect_local=caller_local,
                notes=f"Booked via Voice AI ({call_context.get('direction', 'outbound')})"
            )
            if not booking_res.get("success", True):
                # create_booking refuses a time that is taken or outside hours: never tell the caller it worked.
                alts = [display_hhmm(t) for t in (booking_res.get("availableSlots") or [])]
                return {
                    "success": False,
                    "error": booking_res.get("error") or "slot_unavailable",
                    "message": "That time is not free. Tell the caller and offer another time: call check_availability again.",
                    "alternatives_account_time": alts,
                }

            zone_note = ""
            if policy and policy.get("confirm_timezone"):
                zone_note = f" When you confirm it, say the timezone once ({short_label(caller_tz)})."
            return {
                "success": True,
                "booking_id": booking_res.get("bookingId") or booking_res.get("meeting_id") or booking_res.get("id"),
                "date": booking_res.get("prospectDate") or date_str,
                "time": booking_res.get("prospectTime") or time_str,
                "timezone": caller_tz,
                "meeting_type": format_type,
                "platform": platform,
                "attendee_name": attendee_name,
                "attendee_email": attendee_email,
                "message": "Appointment successfully booked and confirmation dispatched." + zone_note,
            }
        except Exception as e:
            logger.warning(f"[BOOKING-TOOL] Booking execution error: {e}")
            return {"success": False, "error": str(e)}

    return {"success": False, "error": f"Unknown tool: {tool_name}"}
