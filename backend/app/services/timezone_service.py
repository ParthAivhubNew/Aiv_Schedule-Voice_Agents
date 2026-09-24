"""Dual clock: host diary vs prospect speech.

Host calendar stays in company timezone (default Europe/London).
Spoken times and attendee emails use prospect local time.
Never mention conversion, UK, GMT, or 'your time' on a live call.
"""
from __future__ import annotations

import re
import zoneinfo
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

HOST_TZ_DEFAULT = "Europe/London"
PROSPECT_DAY_START = 8
PROSPECT_DAY_END = 18

# Longest prefix first
_PHONE_TZ = (
    ("+353", "Europe/Dublin"),
    ("+351", "Europe/Lisbon"),
    ("+971", "Asia/Dubai"),
    ("+44", "Europe/London"),
    ("+33", "Europe/Paris"),
    ("+49", "Europe/Berlin"),
    ("+34", "Europe/Madrid"),
    ("+39", "Europe/Rome"),
    ("+31", "Europe/Amsterdam"),
    ("+32", "Europe/Brussels"),
    ("+41", "Europe/Zurich"),
    ("+46", "Europe/Stockholm"),
    ("+47", "Europe/Oslo"),
    ("+48", "Europe/Warsaw"),
    ("+91", "Asia/Kolkata"),
    ("+65", "Asia/Singapore"),
    ("+81", "Asia/Tokyo"),
    ("+61", "Australia/Sydney"),
    ("+27", "Africa/Johannesburg"),
    ("+1", "America/New_York"),
)

_SHORT = {
    "Europe/London": "UK",
    "Europe/Dublin": "Ireland",
    "Europe/Paris": "Paris",
    "Europe/Berlin": "Berlin",
    "Europe/Madrid": "Madrid",
    "Europe/Rome": "Rome",
    "Europe/Amsterdam": "Amsterdam",
    "Europe/Brussels": "Brussels",
    "Europe/Zurich": "Zurich",
    "Europe/Stockholm": "Stockholm",
    "Europe/Oslo": "Oslo",
    "Europe/Warsaw": "Warsaw",
    "Europe/Lisbon": "Lisbon",
    "Asia/Kolkata": "IST",
    "Asia/Dubai": "GST",
    "Asia/Singapore": "SGT",
    "Asia/Tokyo": "JST",
    "America/New_York": "ET",
    "America/Chicago": "CT",
    "America/Denver": "MT",
    "America/Los_Angeles": "PT",
    "Australia/Sydney": "AEST",
    "Africa/Johannesburg": "SAST",
    "UTC": "UTC",
}


def tzinfo(name: Optional[str]) -> zoneinfo.ZoneInfo:
    try:
        return zoneinfo.ZoneInfo((name or HOST_TZ_DEFAULT).strip() or HOST_TZ_DEFAULT)
    except Exception:
        return zoneinfo.ZoneInfo(HOST_TZ_DEFAULT)


def now_in(name: Optional[str] = None) -> datetime:
    return datetime.now(tzinfo(name or HOST_TZ_DEFAULT))


def short_label(name: Optional[str]) -> str:
    key = (name or HOST_TZ_DEFAULT).strip() or HOST_TZ_DEFAULT
    if key in _SHORT:
        return _SHORT[key]
    return key.split("/")[-1].replace("_", " ")


def display_hhmm(hhmm: str) -> str:
    try:
        return datetime.strptime(_norm_hhmm(hhmm), "%H:%M").strftime("%I:%M %p").lstrip("0")
    except Exception:
        return hhmm


def _norm_hhmm(raw: Optional[str]) -> str:
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


def normalize_phone(raw: Optional[str]) -> str:
    s = re.sub(r"[^\d+]", "", raw or "")
    if s.startswith("00"):
        s = "+" + s[2:]
    if not s:
        return ""
    if not s.startswith("+"):
        if s.startswith("0") and len(s) >= 10:
            s = "+44" + s[1:]
        else:
            s = "+" + s
    return s


def timezone_from_phone(phone: Optional[str]) -> Optional[str]:
    s = normalize_phone(phone)
    if not s:
        return None
    for prefix, tz in _PHONE_TZ:
        if s.startswith(prefix):
            return tz
    return None


def resolve_prospect_timezone(
    phone: Optional[str] = None,
    mission_tz: Optional[str] = None,
    override: Optional[str] = None,
    host_tz: Optional[str] = None,
) -> str:
    host = (host_tz or HOST_TZ_DEFAULT).strip() or HOST_TZ_DEFAULT
    if override and str(override).strip():
        try:
            zoneinfo.ZoneInfo(str(override).strip())
            return str(override).strip()
        except Exception:
            pass
    from_phone = timezone_from_phone(phone)
    if from_phone:
        return from_phone
    if mission_tz and str(mission_tz).strip():
        try:
            zoneinfo.ZoneInfo(str(mission_tz).strip())
            return str(mission_tz).strip()
        except Exception:
            pass
    return host


def combine_local(date_str: str, time_str: str, tz_name: Optional[str]) -> datetime:
    iso = (date_str or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", iso[:10] if len(iso) >= 10 else ""):
        raise ValueError(f"date must be YYYY-MM-DD, got {date_str}")
    hhmm = _norm_hhmm(time_str)
    h, m = map(int, hhmm.split(":"))
    y, mo, d = map(int, iso[:10].split("-"))
    return datetime(y, mo, d, h, m, tzinfo=tzinfo(tz_name))


def convert_local(
    date_str: str,
    time_str: str,
    from_tz: Optional[str],
    to_tz: Optional[str],
) -> Tuple[str, str]:
    start = combine_local(date_str, time_str, from_tz)
    dest = start.astimezone(tzinfo(to_tz))
    return dest.strftime("%Y-%m-%d"), dest.strftime("%H:%M")


def to_utc(date_str: str, time_str: str, tz_name: Optional[str]) -> datetime:
    return combine_local(date_str, time_str, tz_name).astimezone(timezone.utc)


def prospect_hour_ok(hhmm: str) -> bool:
    try:
        hour = int(_norm_hhmm(hhmm).split(":")[0])
    except Exception:
        return True
    return PROSPECT_DAY_START <= hour < PROSPECT_DAY_END


def decorate_slots(
    slots: List[Dict[str, Any]],
    host_date: str,
    host_tz: str,
    prospect_tz: str,
) -> List[Dict[str, Any]]:
    out = []
    same = (host_tz or HOST_TZ_DEFAULT) == (prospect_tz or host_tz)
    for s in slots:
        host_time = _norm_hhmm(s.get("time") or s.get("hostTime") or "")
        try:
            p_date, p_time = convert_local(host_date, host_time, host_tz, prospect_tz)
        except Exception:
            p_date, p_time = host_date, host_time
        available = bool(s.get("available"))
        offerable = available and (same or prospect_hour_ok(p_time))
        row = dict(s)
        row["time"] = host_time
        row["hostTime"] = host_time
        row["prospectTime"] = p_time
        row["prospectDate"] = p_date
        row["spoken"] = display_hhmm(p_time)
        row["offerable"] = offerable
        out.append(row)
    return out


def stamp_from_host(
    host_date: str,
    host_time: str,
    host_tz: str,
    prospect_tz: str,
) -> Dict[str, Any]:
    hhmm = _norm_hhmm(host_time)
    p_date, p_time = convert_local(host_date, hhmm, host_tz, prospect_tz)
    utc = to_utc(host_date, hhmm, host_tz)
    return {
        "date": host_date,
        "time": hhmm,
        "host_timezone": host_tz or HOST_TZ_DEFAULT,
        "prospect_timezone": prospect_tz or host_tz or HOST_TZ_DEFAULT,
        "prospect_date": p_date,
        "prospect_time": p_time,
        "starts_at_utc": utc.replace(tzinfo=None),
    }
