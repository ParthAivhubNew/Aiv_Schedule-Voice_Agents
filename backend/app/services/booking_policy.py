"""Per-business booking policy — meeting types, notify channels, call-flow rules.

Stored on CalcomSetting.booking_policy (JSON). Defaults are starters only;
each tenant edits via Schedule / Calendar settings.
"""
from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Dict, List, Optional


DEFAULT_BOOKING_POLICY: Dict[str, Any] = {
    "meeting_types": [
        {
            "id": "phone",
            "label": "Phone call",
            "hint": "We dial them",
            "enabled": True,
            "speak_as": "a phone call",
        },
        {
            "id": "video",
            "label": "Video meeting",
            "hint": "Join URL",
            "enabled": True,
            "speak_as": "a video meeting",
            "default_platform": "Google Meet",
        },
        {
            "id": "in_person",
            "label": "In person",
            "hint": "Address",
            "enabled": True,
            "speak_as": "an in-person meeting",
        },
    ],
    "notify_channels": [
        {
            "id": "whatsapp",
            "label": "WhatsApp confirmation",
            "hint": "Message after booking — not a meeting type",
            "enabled": True,
            "is_meeting_type": False,
        },
    ],
    "default_meeting_type": "video",
    "ask_meeting_type_on_call": True,
    # Always off — book only after full finalize; no mid-call hold / email read-back gate.
    "require_email_confirm": False,
    "confirm_existing_bookings": True,
    "recheck_slot_before_book": False,
    "offer_notify_after_book": True,
    "booking_order": ["meeting_type", "slot", "email", "book"],
    "duration_minutes": 15,
    # Hang-up behaviour — per business, editable in Call Script & Rules.
    "ask_before_hangup": True,
    "hangup_confirm_prompt": "Anything else before I hang up?",
    "hangup_goodbye": "Thanks for your time — goodbye!",
    "hangup_delay_seconds": 4,
    # Free-text: injected into voice prompt only. For business-specific rules
    # that are not one of the structured toggles (e.g. "always offer Tuesday mornings first").
    "extra_agent_rules": "",
}


def default_booking_policy() -> Dict[str, Any]:
    return deepcopy(DEFAULT_BOOKING_POLICY)


def normalize_booking_policy(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Merge stored JSON with defaults so older rows keep working."""
    base = default_booking_policy()
    if not isinstance(raw, dict):
        return base

    out = deepcopy(base)
    for key, val in raw.items():
        if key in ("meeting_types", "notify_channels") and isinstance(val, list) and val:
            out[key] = val
        elif key == "booking_order" and isinstance(val, list) and val:
            out[key] = val
        elif key in ("extra_agent_rules", "hangup_confirm_prompt", "hangup_goodbye"):
            out[key] = str(val or "").strip()
        elif key == "hangup_delay_seconds":
            try:
                out[key] = max(2, min(int(val), 15))
            except (TypeError, ValueError):
                out[key] = base["hangup_delay_seconds"]
        elif key == "ask_before_hangup":
            out[key] = bool(val)
        elif key in out:
            out[key] = val

    # Ensure every meeting type has id/label/enabled
    cleaned_types: List[Dict[str, Any]] = []
    for t in out.get("meeting_types") or []:
        if not isinstance(t, dict) or not (t.get("id") or "").strip():
            continue
        tid = str(t["id"]).strip().lower().replace(" ", "_")
        cleaned_types.append({
            "id": tid,
            "label": (t.get("label") or tid.replace("_", " ").title()).strip(),
            "hint": (t.get("hint") or "").strip(),
            "enabled": bool(t.get("enabled", True)),
            "speak_as": (t.get("speak_as") or t.get("label") or tid).strip(),
            "default_platform": t.get("default_platform"),
        })
    if cleaned_types:
        out["meeting_types"] = cleaned_types

    cleaned_notify: List[Dict[str, Any]] = []
    for n in out.get("notify_channels") or []:
        if not isinstance(n, dict) or not (n.get("id") or "").strip():
            continue
        cleaned_notify.append({
            "id": str(n["id"]).strip().lower(),
            "label": (n.get("label") or n["id"]).strip(),
            "hint": (n.get("hint") or "").strip(),
            "enabled": bool(n.get("enabled", True)),
            "is_meeting_type": False,
        })
    out["notify_channels"] = cleaned_notify

    enabled_ids = {t["id"] for t in out["meeting_types"] if t.get("enabled")}
    default_mt = str(out.get("default_meeting_type") or "").strip().lower()
    if default_mt not in enabled_ids and enabled_ids:
        out["default_meeting_type"] = next(iter(enabled_ids))

    # Product rule: never mid-call recheck / email read-back gates (UI removed).
    out["require_email_confirm"] = False
    out["recheck_slot_before_book"] = False
    return out


def enabled_meeting_types(policy: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    p = normalize_booking_policy(policy)
    return [t for t in p["meeting_types"] if t.get("enabled")]


def enabled_notify_channels(policy: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    p = normalize_booking_policy(policy)
    return [n for n in p["notify_channels"] if n.get("enabled")]


def is_valid_meeting_type(policy: Optional[Dict[str, Any]], type_id: str) -> bool:
    tid = str(type_id or "").strip().lower()
    return any(t["id"] == tid for t in enabled_meeting_types(policy))


def resolve_meeting_type(policy: Optional[Dict[str, Any]], raw: str) -> Optional[Dict[str, Any]]:
    """Map free-text / alias to an enabled meeting type, or None."""
    p = normalize_booking_policy(policy)
    raw_l = str(raw or "").strip().lower().replace("-", "_").replace(" ", "_")
    if not raw_l:
        return None
    # Explicit reject of notify channels as meetings
    for n in p.get("notify_channels") or []:
        nid = str(n.get("id") or "").lower()
        if nid and (raw_l == nid or nid in raw_l):
            return None
    aliases = {
        "call": "phone",
        "callback": "phone",
        "dial": "phone",
        "telephone": "phone",
        "meet": "video",
        "zoom": "video",
        "teams": "video",
        "google_meet": "video",
        "inperson": "in_person",
        "office": "in_person",
        "cafe": "in_person",
        "face_to_face": "in_person",
    }
    want = aliases.get(raw_l, raw_l)
    for t in enabled_meeting_types(p):
        if t["id"] == want or t["id"] == raw_l:
            return t
        if want in (t.get("label") or "").lower().replace(" ", "_"):
            return t
    return None


def voice_booking_instructions(policy: Optional[Dict[str, Any]]) -> str:
    """Inject into xAI system prompt — driven by this business's policy."""
    p = normalize_booking_policy(policy)
    types = enabled_meeting_types(p)
    notify = enabled_notify_channels(p)
    if not types:
        return (
            "CRITICAL MEETING BOOKING:\n"
            "No meeting types are enabled for this business. Do not book. "
            "Offer to take an email and have a human follow up."
        )

    type_lines = []
    for t in types:
        type_lines.append(f"   - {t['label']} (format id: {t['id']})" + (f" — {t['hint']}" if t.get("hint") else ""))
    type_block = "\n".join(type_lines)

    notify_ids = [n["id"] for n in notify]
    notify_names = ", ".join(n["label"] for n in notify) if notify else "none"
    never_as_meeting = ", ".join(notify_ids) if notify_ids else "whatsapp"

    steps = []
    order = p.get("booking_order") or ["meeting_type", "slot", "email_confirm", "book"]
    n = 1
    steps.append(f"{n}. Goal: book a {p.get('duration_minutes') or 15}-minute discovery when they are willing.")
    n += 1
    if p.get("ask_meeting_type_on_call", True):
        steps.append(
            f"{n}. MEETING TYPE FIRST: Ask which format works best among ONLY these enabled options:\n{type_block}\n"
            f"   Never offer {never_as_meeting} as the meeting itself — those are notify/confirm channels only ({notify_names})."
        )
        n += 1
    else:
        default = p.get("default_meeting_type") or types[0]["id"]
        steps.append(f"{n}. Default meeting type for this business is `{default}` — confirm only if they ask to change.")
        n += 1
    steps.append(f"{n}. CLOCK: Use the local wall-clock below. Never invent day/year.")
    n += 1
    steps.append(
        f"{n}. CALENDAR: Call check_calendar_availability. Only offer spoken times from that list. Never invent a slot. "
        "Do not book or hold a slot until the prospect has fully agreed (type + day/time + email). Finalize once at the end."
    )
    n += 1
    steps.append(f"{n}. Agree day + time after format is clear.")
    n += 1
    steps.append(
        f"{n}. EMAIL: Collect their email once they are ready to book. "
        "Then call book with email_confirmed=true. No need to read the email back for a separate yes."
    )
    n += 1
    if p.get("confirm_existing_bookings", True):
        steps.append(
            f"{n}. EXISTING BOOKING: If tool returns needs=confirm_existing, speak the old day/time. "
            "Ask: keep old, replace with new, or keep both. Pass replace_existing / keep_both as they choose."
        )
        n += 1
    allowed = "|".join(t["id"] for t in types)
    steps.append(
        f"{n}. Call book_calendar_meeting only when type, slot, and email are all agreed — one finalize at the end. Pass format={allowed}."
    )
    n += 1
    if p.get("offer_notify_after_book") and notify:
        steps.append(
            f"{n}. After booking is locked, optionally ask if they also want a confirmation via: {notify_names}. "
            "That is notify-only — not a meeting type."
        )

    body = "CRITICAL MEETING BOOKING (THIS BUSINESS'S RULES):\n" + "\n".join(steps)
    extra = str(p.get("extra_agent_rules") or "").strip()
    if extra:
        body += (
            "\n\nEXTRA BOOKING RULES FROM THIS BUSINESS (follow unless they conflict with the hard rules above):\n"
            + extra
        )
    return body


def voice_hangup_instructions(policy: Optional[Dict[str, Any]]) -> str:
    """WRAP-UP / hang-up lines. Wording prefers Extra call rules; defaults if none."""
    p = normalize_booking_policy(policy)
    delay = int(p.get("hangup_delay_seconds") or 4)
    delay = max(2, min(delay, 15))
    ask = p.get("ask_before_hangup", True)
    extra = str(p.get("extra_agent_rules") or "").strip()
    # Legacy fields still honored if present; UI now points people to Extra call rules.
    confirm = (p.get("hangup_confirm_prompt") or "").strip()
    goodbye = (p.get("hangup_goodbye") or "").strip()
    if not confirm:
        confirm = "Anything else before I hang up?"
    if not goodbye:
        goodbye = "Thanks for your time — goodbye!"

    lines = ["WRAP-UP & HANG UP (THIS BUSINESS'S RULES):"]
    lines.append(
        "- When the conversation is naturally done (booking locked, they decline, or they say goodbye):"
    )
    if ask:
        lines.append(
            f'  Ask once whether they need anything else. Default wording: "{confirm}" '
            "(or the hang-up wording in EXTRA BOOKING RULES if they wrote one)."
        )
        lines.append("- If they still have a question or want something else: answer it. Do NOT hang up yet.")
        lines.append(
            f'- If they say no / nothing else / that\'s all / bye: speak a short goodbye. Default: "{goodbye}" '
            "(or their EXTRA hang-up goodbye if written)."
        )
    else:
        lines.append(f'  Speak a short goodbye. Default: "{goodbye}" (or EXTRA hang-up goodbye if written).')
    lines.append(
        f"- Then call end_call with delay_seconds around {delay} so the goodbye can finish speaking before the line drops."
    )
    lines.append("- Never leave the line open after wrap-up. Never hang up mid-sentence without finishing the goodbye.")
    if extra and re.search(r"hang[\s\-]?up|goodbye|before i (hang|cut)|end the call", extra, re.I):
        lines.append(
            "- Prefer hang-up / goodbye wording from EXTRA BOOKING RULES when it is more specific than the defaults above."
        )
    return "\n".join(lines)


def hangup_delay_seconds(policy: Optional[Dict[str, Any]]) -> float:
    p = normalize_booking_policy(policy)
    try:
        return float(max(2, min(int(p.get("hangup_delay_seconds") or 4), 15)))
    except (TypeError, ValueError):
        return 4.0
