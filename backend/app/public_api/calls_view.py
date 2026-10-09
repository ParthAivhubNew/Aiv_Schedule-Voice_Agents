"""How a call looks to a customer: one plain shape built from the live call, its log and its brief."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import CallBrief, CallLog, LiveCall
from app.services.call_log_writer import format_transcript_lines, log_id_for_call

# What the app stores -> what a customer sees.
_LIVE_STATE = {
    "calling": "ringing",
    "negotiating": "in_progress",
    "pitching": "in_progress",
    "human_review": "in_progress",
    "ended": "completed",
    "failed": "failed",
    "canceled": "canceled",
}
_NOT_COMPLETED = {"failed": "failed", "canceled": "canceled", "no_answer": "no_answer", "busy": "no_answer"}


def parse_seconds(text: Any) -> int:
    """'03:12', '3:12 min' or '75' -> seconds."""
    s = str(text or "").replace("min", "").strip()
    try:
        parts = [int(float(p)) for p in s.split(":")]
    except ValueError:
        return 0
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return parts[0] if parts else 0


def _iso(d) -> Optional[str]:
    return d.isoformat() + "Z" if d else None


def _public_id(call_id: str) -> str:
    return call_id if call_id.startswith("call_") else "call_" + call_id.split("_", 1)[-1]


async def load_call(db: AsyncSession, call_id: str) -> Optional[Dict[str, Any]]:
    """The customer's view of one call, or None when this organisation has no such call."""
    live_id = _public_id(call_id)
    live = (await db.execute(select(LiveCall).where(LiveCall.id == live_id))).scalars().first()
    log = (await db.execute(select(CallLog).where(CallLog.id == log_id_for_call(live_id)))).scalars().first()
    if not live and not log:
        return None
    brief = (await db.execute(select(CallBrief).where(CallBrief.id == live_id))).scalars().first()

    ended = bool(log) or bool(live and live.ended)
    outcome = (log.outcome if log else None) or (brief.outcome if brief and brief.outcome else None)
    if live and not ended:
        status = _LIVE_STATE.get(live.state or "", "in_progress")
    elif live and live.state in ("failed", "canceled"):
        status = live.state
    else:
        status = _NOT_COMPLETED.get(outcome or "", "completed")

    raw = (log.transcript if log and log.transcript else (live.transcript if live else [])) or []
    transcript: List[Dict[str, str]] = [t for t in format_transcript_lines(raw) if t.get("who") != "system"]
    name = (log.person_listed_as or log.listed_as) if log else (live.prospect if live else "")

    out: Dict[str, Any] = {
        "id": live_id,
        "status": status,
        "to_name": name or "",
        "started_at": _iso(live.created_at) if live else None,
        "duration_seconds": parse_seconds(log.duration if log else (live.duration if live else "")),
        "outcome": outcome if ended else None,
        "meeting_booked": bool(live and live.booked) or outcome == "meeting_booked",
        "answers": dict(brief.captured or {}) if brief else {},
        "transcript": transcript,
        "human": {
            "taken_over": bool(live and live.taken and not ended),
            "listening": bool(live and live.listening and not ended),
        },
    }
    if brief and brief.phone:
        out["to"] = brief.phone
    return out
