import math
from typing import Dict, Any, List, Optional

PECR_RULES = {
    "weekday_start": "08:00",
    "weekday_end": "21:00",
    "weekend_start": "09:00",
    "weekend_end": "18:00",
}

CALL_HOUR_POLICIES = {
    "respectful": {
        "id": "respectful",
        "label": "Shorter, respectful hours",
        "weekday_start": "09:00",
        "weekday_end": "17:30",
    },
    "pecr_max": {
        "id": "pecr_max",
        "label": "Full PECR legal window",
        "weekday_start": "08:00",
        "weekday_end": "21:00",
    },
}

AVG_CALL_MINUTES = 3.0

def time_to_minutes(hhmm: str) -> int:
    try:
        parts = str(hhmm).strip().split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return 0

def minutes_to_time(mins: int) -> str:
    m = max(0, min(24 * 60 - 1, int(mins)))
    h = m // 60
    rem = m % 60
    return f"{h:02d}:{rem:02d}"

def is_in_lunch(hhmm: str, lunch_start: str = "12:00", lunch_end: str = "13:00") -> bool:
    m = time_to_minutes(hhmm)
    return time_to_minutes(lunch_start) <= m < time_to_minutes(lunch_end)

def lunch_overlap_minutes(
    window_start: str,
    window_end: str,
    lunch_start: str = "12:00",
    lunch_end: str = "13:00"
) -> int:
    ws = time_to_minutes(window_start)
    we = time_to_minutes(window_end)
    ls = time_to_minutes(lunch_start)
    le = time_to_minutes(lunch_end)
    overlap_start = max(ws, ls)
    overlap_end = min(we, le)
    return max(0, overlap_end - overlap_start)

def compute_queue_estimate(
    total_companies: int,
    concurrency: int = 5,
    window_start: str = "09:00",
    window_end: str = "17:30",
    lunch_start: str = "12:00",
    lunch_end: str = "13:00",
) -> Dict[str, Any]:
    if total_companies <= 0:
        return {
            "total_companies": 0,
            "total_minutes": 0,
            "daily_minutes": 0,
            "days": 0,
            "fits_today": True,
            "finish_time": window_start,
            "finish_label": "now",
        }
    
    total_call_minutes = (total_companies * AVG_CALL_MINUTES) / max(1, concurrency)
    gross_daily_minutes = max(0, time_to_minutes(window_end) - time_to_minutes(window_start))
    lunch_mins = lunch_overlap_minutes(window_start, window_end, lunch_start, lunch_end)
    net_daily_minutes = max(30, gross_daily_minutes - lunch_mins)
    
    fits_today = total_call_minutes <= net_daily_minutes
    days_needed = math.ceil(total_call_minutes / net_daily_minutes)
    
    # Calculate finish time today if it fits
    start_min = time_to_minutes(window_start)
    running_min = start_min + total_call_minutes
    if start_min < time_to_minutes(lunch_start) and running_min >= time_to_minutes(lunch_start):
        running_min += lunch_mins
    
    finish_time = minutes_to_time(int(running_min))
    finish_label = f"Today by {finish_time}" if fits_today else f"{days_needed} working days"
    
    return {
        "total_companies": total_companies,
        "concurrency": concurrency,
        "total_minutes": round(total_call_minutes),
        "daily_minutes": net_daily_minutes,
        "days": days_needed,
        "fits_today": fits_today,
        "finish_time": finish_time,
        "finish_label": finish_label,
    }


# ── Call gate: checked before every outbound dial ───────────────────────────
# UK PECR / Ofcom practice: never call people who opted out, and only at reasonable hours in
# the callee's own time zone. Two hour policies from the Company profile:
#   "respectful" (default): Mon–Fri between weekday_start and weekday_end, not over lunch
#   "legal":                every day 08:00–21:00
# Enforcement mode (env CALL_WINDOW_ENFORCEMENT or app setting "compliance".mode):
#   "block": out-of-hours calls are refused; "warn": they go ahead with a warning; "off".
# Opted-out numbers are always refused, whatever the mode.

import os as _os
from dataclasses import dataclass, field
from datetime import datetime as _dt
from typing import List as _List


@dataclass
class CallGate:
    allowed: bool
    reasons: _List[str] = field(default_factory=list)
    warnings: _List[str] = field(default_factory=list)
    callee_timezone: str = ""
    callee_local_time: str = ""


def _in_window(local: _dt, policy: str, weekday_start: str, weekday_end: str, lunch_start: str, lunch_end: str) -> tuple:
    hhmm = local.strftime("%H:%M")
    mins = time_to_minutes(hhmm)
    if (policy or "respectful").lower() == "legal":
        if not (time_to_minutes("08:00") <= mins < time_to_minutes("21:00")):
            return False, "outside 08:00–21:00 in the callee's time"
        return True, ""
    if local.weekday() >= 5:
        return False, "weekend in the callee's time (calls are Monday to Friday)"
    if not (time_to_minutes(weekday_start or "09:00") <= mins < time_to_minutes(weekday_end or "17:30")):
        return False, f"outside {weekday_start}–{weekday_end} in the callee's time"
    if is_in_lunch(hhmm, lunch_start or "12:00", lunch_end or "13:00"):
        return False, "lunch time in the callee's time"
    return True, ""




async def enforcement_mode(db) -> str:
    from sqlalchemy.future import select as _select

    from app.models.models import AppSetting

    try:
        row = (await db.execute(_select(AppSetting).where(AppSetting.id == "compliance"))).scalars().first()
        mode = ((row.data or {}).get("mode") if row else None) or _os.getenv("CALL_WINDOW_ENFORCEMENT", "warn")
    except Exception:
        mode = _os.getenv("CALL_WINDOW_ENFORCEMENT", "warn")
    mode = str(mode).lower().strip()
    return mode if mode in ("block", "warn", "off") else "warn"


async def is_opted_out(db, number: str) -> bool:
    from sqlalchemy.future import select as _select

    from app.models.models import ContactRegistry
    from app.services.timezone_service import normalize_phone

    target = normalize_phone(number)
    if not target:
        return False
    rows = (await db.execute(_select(ContactRegistry).where(ContactRegistry.do_not_call.is_(True)))).scalars().all()
    for r in rows:
        for p in (r.phones or []):
            if normalize_phone(p if isinstance(p, str) else (p or {}).get("number", "")) == target:
                return True
    return False


async def check_call_allowed(db, to_number: str, now_utc: Optional[_dt] = None) -> CallGate:
    """Never raises: a failure inside the check itself lets the call through with a warning,
    so a bug here can never stop calling altogether (opt-outs aside)."""
    import zoneinfo

    from sqlalchemy.future import select as _select

    from app.models.models import CompanyProfile
    from app.services.timezone_service import resolve_prospect_timezone

    gate = CallGate(allowed=True)
    try:
        if await is_opted_out(db, to_number):
            gate.allowed = False
            gate.reasons.append("This number opted out (do not call).")
            return gate
    except Exception as err:
        gate.warnings.append(f"Opt-out list could not be checked: {err}")
    try:
        mode = await enforcement_mode(db)
        if mode == "off":
            return gate
        prof = (await db.execute(_select(CompanyProfile).limit(1))).scalars().first()
        tz = resolve_prospect_timezone(phone=to_number, host_tz=getattr(prof, "timezone", None))
        now_utc = now_utc or _dt.utcnow()
        local = now_utc.replace(tzinfo=zoneinfo.ZoneInfo("UTC")).astimezone(zoneinfo.ZoneInfo(tz))
        gate.callee_timezone = tz
        gate.callee_local_time = local.strftime("%a %H:%M")
        ok, why = _in_window(
            local,
            getattr(prof, "call_hours_policy", "respectful"),
            getattr(prof, "weekday_start", "09:00"),
            getattr(prof, "weekday_end", "17:30"),
            getattr(prof, "lunch_start", "12:00"),
            getattr(prof, "lunch_end", "13:00"),
        )
        if not ok:
            msg = f"It is {gate.callee_local_time} for this number ({tz}): {why}."
            if mode == "block":
                gate.allowed = False
                gate.reasons.append(msg)
            else:
                gate.warnings.append(msg)
    except Exception as err:
        gate.warnings.append(f"Call hours could not be checked: {err}")
    return gate
