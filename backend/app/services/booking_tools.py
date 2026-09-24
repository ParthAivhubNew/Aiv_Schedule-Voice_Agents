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
                    }
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
        }
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


async def execute_smart_booking_tool(
    db: AsyncSession,
    tool_name: str,
    args: Dict[str, Any],
    call_context: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Executes booking tool calls in real time (Internal DB or Cal.com).
    """
    from app.services.calendar_service import calendar_service

    temporal = call_context.get("temporal_context") or {}
    prospect = call_context.get("prospect") or {}
    company = call_context.get("company") or {}

    timezone = temporal.get("timezone", "Europe/London")

    if tool_name == "check_availability":
        start_date = str(args.get("start_date") or "").strip()
        end_date = str(args.get("end_date") or start_date).strip()

        if not start_date:
            start_date = temporal.get("today_iso", datetime.utcnow().strftime("%Y-%m-%d"))
        if not end_date:
            end_date = start_date

        try:
            slots = await calendar_service.get_available_slots(
                db=db,
                date_str=start_date,
                event_type_slug="15-min-discovery",
                prospect_tz=timezone
            )
            if slots and isinstance(slots, list):
                # Return up to 6 formatted slots
                formatted = [s.get("time") or s.get("start") or str(s) for s in slots[:6]]
                return {
                    "success": True,
                    "available_slots": formatted,
                    "total_found": len(slots),
                    "timezone": timezone
                }
            return {
                "success": True,
                "available_slots": [],
                "message": f"No open slots found on {start_date}. Suggest alternative days."
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

        date_str = temporal.get("today_iso", datetime.utcnow().strftime("%Y-%m-%d"))
        time_str = "14:00"
        if "T" in start_time:
            parts = start_time.split("T")
            date_str = parts[0]
            time_str = parts[1][:5]
        elif " " in start_time:
            parts = start_time.split(" ")
            date_str = parts[0]
            time_str = parts[1][:5]
        elif ":" in start_time:
            time_str = start_time[:5]

        try:
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
                prospect_timezone=timezone,
                notes=f"Booked via Voice AI ({call_context.get('direction', 'outbound')})"
            )
            return {
                "success": True,
                "booking_id": booking_res.get("meeting_id") or booking_res.get("id"),
                "date": date_str,
                "time": time_str,
                "meeting_type": format_type,
                "platform": platform,
                "attendee_name": attendee_name,
                "attendee_email": attendee_email,
                "message": "Appointment successfully booked and confirmation dispatched."
            }
        except Exception as e:
            logger.warning(f"[BOOKING-TOOL] Booking execution error: {e}")
            return {"success": False, "error": str(e)}

    return {"success": False, "error": f"Unknown tool: {tool_name}"}
