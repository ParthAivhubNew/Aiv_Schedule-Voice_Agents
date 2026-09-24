import math
from typing import Dict, Any, List

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
