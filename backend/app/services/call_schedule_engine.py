"""Call schedules: dial a Call list right now, once, or on a repeating pattern, at one or more times a day.

A schedule only starts the same list dial the Call list screen starts (one mission per run), so calls, credits,
caller IDs and logs behave exactly as for a hand-started list. The server checks every half minute; a slot is
handled once (it is written to `fired` before anything is dialled) and, if the server was down for more than
GRACE_MIN minutes past its time, it is recorded as missed instead of ringing people late.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import CallList, CallSchedule
from app.services.org_settings import org_instant_ms, org_timezone
from app.services.schedule_engine import (
    DEFAULT_RUN_MONTHS, FREQUENCIES, MAX_RUN_DAYS, PATTERNS, WEEKDAYS, add_months, occurrences, org_today, parse_date,
)

logger = logging.getLogger("call_schedule_engine")

GRACE_MIN = 45
MAX_TIMES = 6
KEEP_FIRED = 400
KEEP_RUNS = 12
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def clean(payload: Dict[str, Any], today: date, existing: Optional[CallSchedule] = None) -> Dict[str, Any]:
    """Validate a schedule from the Schedule window. Raises ValueError with a message for the user."""
    from app.services.outbound_dial import MAX_CONCURRENCY

    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Give the schedule a name.")
    list_id = str(payload.get("listId") or "").strip()
    if not list_id:
        raise ValueError("Pick the Call list to dial.")
    frequency = str(payload.get("frequency") or "recurring").lower()
    if frequency not in FREQUENCIES:
        raise ValueError("Frequency must be right now, once or recurring.")
    times = sorted({str(t).strip() for t in (payload.get("times") or [payload.get("time")]) if str(t or "").strip()})
    if frequency != "now":
        if not times:
            raise ValueError("Add at least one time to call.")
        if len(times) > MAX_TIMES:
            raise ValueError(f"At most {MAX_TIMES} times a day.")
        bad = [t for t in times if not _TIME_RE.match(t)]
        if bad:
            raise ValueError(f"Times must look like 09:30 (not {bad[0]}).")
    try:
        concurrency = int(payload.get("concurrency") or 1)
    except (TypeError, ValueError):
        raise ValueError("Calls at once must be a whole number.")
    out: Dict[str, Any] = {
        "name": name[:120], "list_id": list_id, "from_number": str(payload.get("fromNumber") or "").strip()[:32],
        "concurrency": max(1, min(concurrency, MAX_CONCURRENCY)), "frequency": frequency,
        "times": times if frequency != "now" else ["00:00"],
        "pattern": None, "weekday": "", "month_day": None, "custom_dates": [], "start_date": None, "end_date": None,
    }
    if frequency == "now":
        out["start_date"] = out["end_date"] = today.isoformat()
        return out
    if frequency == "once":
        d = parse_date(payload.get("date") or payload.get("startDate"))
        if not d:
            raise ValueError("Pick the date to call.")
        if d < today:
            raise ValueError("That date has passed. Pick today or later, or use Right now.")
        out["start_date"] = out["end_date"] = d.isoformat()
        return out

    pattern = str(payload.get("pattern") or "weekly").lower()
    if pattern not in PATTERNS:
        raise ValueError("Pattern must be daily, weekly, monthly or custom dates.")
    out["pattern"] = pattern
    if pattern == "dates":
        dates = sorted({d for d in (parse_date(x) for x in payload.get("customDates") or []) if d})
        if not dates:
            raise ValueError("Add at least one date.")
        if dates[0] < today and not existing:
            raise ValueError("Custom dates must be today or later.")
        if (dates[-1] - dates[0]).days > MAX_RUN_DAYS:
            raise ValueError("Keep custom dates within one year.")
        out["custom_dates"] = [d.isoformat() for d in dates]
        out["start_date"], out["end_date"] = dates[0].isoformat(), dates[-1].isoformat()
        return out
    start = parse_date(payload.get("startDate")) or today
    if start < today and not (existing and existing.start_date == start.isoformat()):
        raise ValueError("The start date has passed. Pick today or later.")
    end = parse_date(payload.get("endDate")) or add_months(start, DEFAULT_RUN_MONTHS)
    if end < start:
        raise ValueError("The end date is before the start date.")
    if (end - start).days > MAX_RUN_DAYS:
        raise ValueError("A schedule can run for at most a year. Extend it later when it nears the end.")
    out["start_date"], out["end_date"] = start.isoformat(), end.isoformat()
    if pattern == "weekly":
        days = [str(d).upper()[:2] for d in payload.get("weekdays") or []]
        days = [d for d in WEEKDAYS if d in days]
        if not days:
            raise ValueError("Pick the weekdays to call on.")
        out["weekday"] = ",".join(days)
    if pattern == "monthly":
        try:
            md = int(payload.get("monthDay") or start.day)
        except (TypeError, ValueError):
            md = 0
        if not 1 <= md <= 31:
            raise ValueError("Day of the month must be 1 to 31.")
        out["month_day"] = md
    return out


def slots_between(s: CallSchedule, first: date, last: date) -> List[Tuple[date, str]]:
    """Every (date, "HH:MM") this schedule calls at between first and last (inclusive)."""
    if s.frequency == "now":
        return []
    return [(d, t) for d in occurrences(s, first, last) for t in sorted(s.times or [])]


def _key(d: date, t: str) -> str:
    return f"{d.isoformat()} {t}"


def _created_ms(s: CallSchedule) -> float:
    c = s.created_at or datetime.utcnow()
    return c.replace(tzinfo=timezone.utc).timestamp() * 1000.0


def due_slots(s: CallSchedule, now_ms: float, tz: str, today: date) -> Tuple[List[str], List[str]]:
    """(slots to dial now, slots whose time passed while nothing was running). Slots from before the
    schedule was made never count: a schedule made at 11:00 with a 09:00 time starts tomorrow."""
    fired = set(s.fired or [])
    go: List[str] = []
    missed: List[str] = []
    for d, t in slots_between(s, today - timedelta(days=1), today):
        key = _key(d, t)
        at = org_instant_ms(d.isoformat(), t, tz)
        if key in fired or at is None or at > now_ms or at < _created_ms(s) - 60_000:
            continue
        (go if now_ms - at <= GRACE_MIN * 60_000 else missed).append(key)
    return go, missed


def upcoming(s: CallSchedule, now_ms: float, tz: str, today: date, limit: int = 8) -> List[str]:
    if s.status != "active" or s.frequency == "now":
        return []
    fired = set(s.fired or [])
    end = parse_date(s.end_date) or today
    out: List[str] = []
    for d, t in slots_between(s, today, max(end, today)):
        at = org_instant_ms(d.isoformat(), t, tz)
        if _key(d, t) not in fired and at is not None and at > now_ms - GRACE_MIN * 60_000:
            out.append(_key(d, t))
            if len(out) >= limit:
                break
    return out


def schedule_dict(s: CallSchedule, now_ms: float, tz: str, today: date, list_name: str = "") -> Dict[str, Any]:
    nxt = upcoming(s, now_ms, tz, today, limit=40)
    return {
        "id": s.id, "name": s.name, "listId": s.list_id, "listName": list_name, "fromNumber": s.from_number or "",
        "concurrency": s.concurrency or 1, "frequency": s.frequency, "pattern": s.pattern, "times": s.times or [],
        "weekdays": [d for d in (s.weekday or "").split(",") if d], "monthDay": s.month_day,
        "customDates": s.custom_dates or [], "startDate": s.start_date, "endDate": s.end_date,
        "status": s.status or "active", "endedReason": s.ended_reason,
        "upcoming": nxt[:6], "upcomingCount": len(nxt), "runs": list(reversed((s.runs or [])[-5:])),
    }


def _phone(row: Dict[str, Any]) -> str:
    def digits(v: Any) -> int:
        return len(re.sub(r"\D", "", str(v or "")))

    direct = row.get("phone")
    if 7 <= digits(direct) <= 16:
        return str(direct).strip()
    cells = row.get("cells") or {}
    keyed = [v for h, v in cells.items() if re.search(r"phone|mobile|tel|cell", str(h), re.I)]
    for v in keyed + [v for h, v in cells.items() if not re.search(r"mail|web|site|linkedin|url", str(h), re.I)]:
        if 7 <= digits(v) <= 16:
            return str(v).strip()
    return ""


def prospects_from(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for r in rows or []:
        phone = _phone(r)
        if not phone:
            continue
        person = str(r.get("contact") or "").strip()
        company = str(r.get("company") or r.get("name") or "").strip()
        out.append({"to_number": phone, "phone": phone, "prospect_name": person or company, "name": company or person,
                    "company": company, "contact": person or company, "website": r.get("website") or "",
                    "lead_id": r.get("leadId") or None, "email": r.get("email") or ""})
    return out


async def run_slot(db: AsyncSession, s: CallSchedule, slot: str, tz: str) -> Dict[str, Any]:
    """Start the list dial for one slot. Returns {ok, message, missionId}; never raises."""
    from app.services import numbers as numbers_service
    from app.services.outbound_dial import _has_minutes, launch_outbound_mission

    the_list = (await db.execute(select(CallList).where(CallList.id == s.list_id))).scalars().first()
    if not the_list:
        return {"ok": False, "message": "The Call list was deleted, so nothing was dialled."}
    prospects = prospects_from(the_list.rows or [])
    if not prospects:
        return {"ok": False, "message": f"“{the_list.name}” has no phone numbers to dial."}
    if not await _has_minutes(db):
        return {"ok": False, "message": "No call minutes left, so nothing was dialled. Top up and the next run will go ahead."}
    picked, number_err = await numbers_service.pick_caller_id(db, {"is_admin": True}, s.from_number or None)
    if number_err:
        return {"ok": False, "message": number_err}
    try:
        res = await launch_outbound_mission(
            db, title=f"{s.name} · {slot}", prospects=prospects, concurrency=s.concurrency or 1,
            from_number=picked or (s.from_number or None), timezone=tz, source="schedule",
        )
    except Exception as err:  # the dial itself failed: say so in the run history, keep the schedule going
        logger.warning(f"[CallSchedules] {s.name} {slot}: {err}")
        return {"ok": False, "message": re.sub(r"^\d{3}:\s*", "", str(err))[:300]}
    return {"ok": True, "message": res.get("message") or f"Dialling {res.get('total', len(prospects))} contacts.",
            "missionId": res.get("mission_id")}


async def execute(db: AsyncSession, schedule_id: str, slot: str, tz: str, missed: bool = False) -> Dict[str, Any]:
    """Handle one slot of one schedule: write it to `fired` first, dial, then record how it went."""
    # The row is locked while the slot is claimed, so two server processes never dial the same slot twice.
    s = (await db.execute(select(CallSchedule).where(CallSchedule.id == schedule_id).with_for_update())).scalars().first()
    if not s:
        return {"ok": False, "message": "That schedule no longer exists."}
    if slot in (s.fired or []):
        await db.rollback()
        return {"ok": False, "message": "Already handled.", "skipped": True}
    s.fired = (list(s.fired or []) + [slot])[-KEEP_FIRED:]
    await db.commit()
    result = ({"ok": False, "message": "Missed: Outreach was not running at this time, so nobody was called."}
              if missed else await run_slot(db, s, slot, tz))
    s = (await db.execute(select(CallSchedule).where(CallSchedule.id == schedule_id))).scalars().first()
    if s:
        entry = {"slot": slot, "at": datetime.utcnow().isoformat() + "Z", **result}
        s.runs = (list(s.runs or []) + [entry])[-KEEP_RUNS:]
        await db.commit()
    return result


async def tick(db: AsyncSession, now_ms: float) -> int:
    """End finished schedules and start the runs that are due. Returns runs started."""
    tz = await org_timezone(db)
    today = org_today(tz)
    schedules = (await db.execute(select(CallSchedule).where(CallSchedule.status == "active"))).scalars().all()
    work: List[Tuple[str, str, bool]] = []
    for s in schedules:
        go, missed = due_slots(s, now_ms, tz, today)
        work += [(s.id, k, False) for k in go] + [(s.id, k, True) for k in missed]
        end = parse_date(s.end_date)
        left = [k for k in upcoming(s, now_ms, tz, today, limit=1)]
        if (end and today > end) or (not left and not go and s.frequency in ("once", "recurring") and end and today >= end):
            s.status = "ended"
            s.ended_reason = f"Finished: every call time up to {end.isoformat() if end else 'its end'} was handled."
    await db.commit()
    for sid, slot, was_missed in work:
        await execute(db, sid, slot, tz, was_missed)
    return len([w for w in work if not w[2]])
