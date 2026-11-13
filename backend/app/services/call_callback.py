"""A finished call where the person asked to be rung back, and nothing was booked: put the callback on the calendar.

The AI assistant's own report is not needed. The finished call's words are read once for a callback agreement
(who, which number, which day, which hours). Works for numbers dialled by hand, which have no saved lead.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.future import select

logger = logging.getLogger("call_callback")

PROMPT = (
    "Read this finished phone call. Did the other person agree to be called back, or ask for a call later, "
    "and was no meeting booked? Reply with JSON only, no other text:\n"
    '{"callback": true|false, "name": "", "phone": "", "date": "YYYY-MM-DD or empty", "from": "HH:MM or empty", '
    '"to": "HH:MM or empty", "note": "one short line"}\n'
    "Use only what was said. Leave a field empty when it was not said. Hours are 24-hour. "
    "'between 12 and 4' means from 12:00 to 16:00. Today is {today} ({weekday})."
)


def _json(text: str) -> Dict[str, Any]:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return {}
    try:
        data = json.loads(m.group(0))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _hhmm(raw: Any) -> str:
    m = re.match(r"^\s*(\d{1,2}):(\d{2})\s*$", str(raw or ""))
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        return ""
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def plan(data: Dict[str, Any], today: datetime) -> Optional[Dict[str, str]]:
    """The calendar entry for an extracted callback, or None. A day that was not said becomes the next working day;
    hours that were not said become the office day's start. Nothing is placed in the past."""
    if not data.get("callback"):
        return None
    day = str(data.get("date") or "").strip()
    try:
        d = datetime.strptime(day, "%Y-%m-%d").date()
    except ValueError:
        d = None
    if d is None or d < today.date():
        d = today.date() + timedelta(days=1)
        while d.weekday() >= 5:
            d += timedelta(days=1)
    start, end = _hhmm(data.get("from")), _hhmm(data.get("to"))
    start = start or "10:00"
    window = f"{start}–{end}" if end and end > start else f"{start}–{start}"
    return {"day": d.isoformat(), "time": start, "window": window,
            "name": str(data.get("name") or "").strip()[:80], "phone": str(data.get("phone") or "").strip()[:30],
            "note": str(data.get("note") or "").strip()[:300]}


async def add_callback_for_call(call_id: str) -> Optional[str]:
    """Reads the finished call and, if a callback was agreed, adds it to the calendar. Returns the item id."""
    from app.database import AsyncSessionLocal
    from app.models.models import LiveCall, Notification, ScheduleItem
    from app.services.call_summary import _ask, spoken
    from app.services.org_settings import org_timezone
    from app.services.timezone_service import now_in

    try:
        async with AsyncSessionLocal() as db:
            rec = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
            if rec is None or rec.booked:
                return None
            marker = f"call:{call_id}"
            done = (await db.execute(select(ScheduleItem.id).where(ScheduleItem.notes.like(f"%{marker}%")).limit(1))).first()
            if done:
                return None
            lines: List[str] = spoken(rec.transcript or [])
            if sum(1 for l in lines if l.startswith("Caller:")) < 2:
                return None
            now = now_in(await org_timezone(db))
            system = PROMPT.replace("{today}", now.strftime("%Y-%m-%d")).replace("{weekday}", now.strftime("%A"))
            data = _json(await _ask(db, system, "\n".join(lines)[-9000:], 250))
            entry = plan(data, now.replace(tzinfo=None))
            if entry is None:
                return None
            name = entry["name"] or (rec.prospect if rec.prospect and not rec.prospect.startswith(("Prospect (", "+")) else "") or "Caller"
            phone = entry["phone"] or rec.phone or ""
            item = ScheduleItem(
                id=f"s_{uuid.uuid4().hex[:8]}", day=entry["day"], time=entry["time"], window=entry["window"],
                prospect=name, mission="Call back", status="queued", kind="phone", phone=phone or None,
                notes="\n".join(p for p in [entry["note"], f"Asked for a call back between {entry['window'].replace('–', ' and ')}.", marker] if p),
            )
            db.add(item)
            db.add(Notification(id=f"n_{uuid.uuid4().hex[:8]}", type="info", time="Just now",
                                text=f"Call {name} back on {entry['day']} between {entry['window'].replace('–', ' and ')}."))
            await db.commit()
            return item.id
    except Exception as err:
        logger.warning(f"[call-callback] {call_id} not added to the calendar: {err}")
        return None
