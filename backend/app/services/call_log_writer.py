"""Persist CallLog rows for every terminal live-call outcome (success or not)."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import CallLog, LiveCall, Prospect
from app.services.call_names import apply_names_to_log, resolve_call_people

logger = logging.getLogger("call_log_writer")

# Higher = keep when merging (don't let a later "contacted" wipe no_answer)
OUTCOME_RANK = {
    "failed": 10,
    "canceled": 20,
    "busy": 25,
    "no_answer": 30,
    "left_voicemail": 40,
    "rejected": 45,
    "callback_requested": 50,
    "operator_ended": 55,
    "contacted": 60,
    "meeting_booked": 100,
}


def log_id_for_call(call_id: str) -> str:
    return f"cl_{str(call_id).replace('call_', '')}"


def map_carrier_status_to_outcome(status: str) -> str:
    s = (status or "").strip().lower().replace("_", "-")
    if s in ("no-answer", "no_answer"):
        return "no_answer"
    if s == "busy":
        return "no_answer"
    if s in ("canceled", "cancelled"):
        return "canceled"
    if s == "failed":
        return "failed"
    if s == "completed":
        return "contacted"
    return "failed"


def map_carrier_status_to_state(status: str) -> str:
    s = (status or "").strip().lower().replace("_", "-")
    if s in ("no-answer", "no_answer", "busy"):
        return "failed"
    if s in ("canceled", "cancelled"):
        return "canceled"
    if s == "failed":
        return "failed"
    return "ended"


def format_transcript_lines(raw_lines: List[Any]) -> List[Dict[str, str]]:
    formatted: List[Dict[str, str]] = []
    for item in raw_lines or []:
        if isinstance(item, dict) and "text" in item and "who" in item:
            formatted.append({"who": str(item["who"]), "text": str(item["text"])})
            continue
        if not isinstance(item, str):
            continue
        s = item.strip()
        if not s:
            continue
        if s.startswith("AI:"):
            formatted.append({"who": "ai", "text": s[3:].strip()})
        elif s.startswith("Prospect:") or s.startswith("Them:"):
            text_val = s.replace("Prospect:", "").replace("Them:", "").strip()
            formatted.append({"who": "them", "text": text_val})
        elif s.startswith("System:"):
            formatted.append({"who": "system", "text": s[7:].strip()})
        else:
            formatted.append({"who": "ai", "text": s})
    return formatted


def infer_outcome_from_transcript(
    lines: List[Any],
    *,
    is_booked: bool = False,
    duration_str: str = "",
    preferred: Optional[str] = None,
) -> str:
    if is_booked:
        return "meeting_booked"
    if preferred and preferred in OUTCOME_RANK:
        return preferred

    formatted = format_transcript_lines(lines)
    blob = " ".join(
        (f.get("text") or "").lower() if isinstance(f, dict) else str(f).lower()
        for f in formatted
    )
    if "voicemail" in blob or "leave a message" in blob or "after the tone" in blob:
        return "left_voicemail"
    if any(x in blob for x in ("no-answer", "no answer", "busy", "did not answer", "prospect busy")):
        return "no_answer"
    if "dial failed" in blob or "sip failed" in blob:
        return "failed"
    if "canceled" in blob or "cancelled" in blob or "operator ended" in blob:
        return "canceled"

    them_turns = sum(1 for f in formatted if isinstance(f, dict) and f.get("who") == "them")
    # Very short / no human talk → treat as no answer when duration tiny
    secs = 0
    try:
        parts = str(duration_str or "0:00").replace(" min", "").strip().split(":")
        if len(parts) == 2:
            secs = int(parts[0]) * 60 + int(parts[1])
        else:
            secs = int(float(parts[0]))
    except Exception:
        secs = 0
    if them_turns == 0 and secs < 25:
        return "no_answer"
    return "contacted"


def _should_replace_outcome(existing: Optional[str], new: str) -> bool:
    if not existing:
        return True
    if existing == new:
        return True
    # Never downgrade a booking
    if existing == "meeting_booked" and new != "meeting_booked":
        return False
    # Prefer stronger failure labels over a late generic "contacted"
    if new == "contacted" and existing in ("no_answer", "failed", "canceled", "left_voicemail", "busy"):
        return False
    return OUTCOME_RANK.get(new, 0) >= OUTCOME_RANK.get(existing, 0)


async def upsert_call_log_from_live(
    db: AsyncSession,
    call: LiveCall,
    *,
    outcome: str,
    duration: Optional[str] = None,
    extra_note: Optional[str] = None,
    force_outcome: bool = False,
) -> Optional[CallLog]:
    """Create or update CallLog for a LiveCall. Always safe to call on terminal events."""
    if not call or not call.id:
        return None
    try:
        log_id = log_id_for_call(call.id)
        existing = (await db.execute(select(CallLog).where(CallLog.id == log_id))).scalars().first()

        raw = list(call.transcript or [])
        if extra_note:
            raw = raw + [f"System: {extra_note}"]
        formatted = format_transcript_lines(raw)

        prospect_row = None
        if call.prospect_id:
            prospect_row = (
                await db.execute(select(Prospect).where(Prospect.id == call.prospect_id))
            ).scalars().first()

        names = resolve_call_people(
            prospect=prospect_row,
            live_label=call.prospect,
            transcript=formatted,
            existing_person=existing.person_listed_as if existing else None,
            existing_company=existing.canonical_name if existing else None,
        )

        dur = duration or call.duration or "00:00"
        if not str(dur).endswith("min"):
            dur_disp = f"{dur} min"
        else:
            dur_disp = dur

        now_str = datetime.utcnow().strftime("%d %b %Y, %H:%M")
        started = (
            call.created_at.strftime("%d %b %Y, %H:%M")
            if getattr(call, "created_at", None)
            else now_str
        )

        final_outcome = infer_outcome_from_transcript(
            formatted,
            is_booked=bool(call.booked),
            duration_str=str(duration or call.duration or ""),
            preferred=outcome,
        )
        if call.booked:
            final_outcome = "meeting_booked"

        if existing:
            existing.transcript = formatted or existing.transcript
            existing.duration = dur_disp
            existing.ended_at = now_str
            existing.mission = call.mission or existing.mission
            if force_outcome or _should_replace_outcome(existing.outcome, final_outcome):
                existing.outcome = final_outcome
            apply_names_to_log(existing, names)
            return existing

        entry = CallLog(
            id=log_id,
            canonical_name=names["canonical"] or call.prospect or "Unknown",
            listed_as=names["listed"] or call.prospect or "Unknown",
            person_canonical=names["person"] or "",
            person_listed_as=names["person"] or "",
            channel=call.channel or "voice",
            mission=call.mission or "",
            started_at=started,
            ended_at=now_str,
            duration=dur_disp,
            outcome=final_outcome,
            transcript=formatted,
        )
        merged = await db.merge(entry)
        return merged
    except Exception as err:
        logger.warning(f"upsert_call_log_from_live failed for {getattr(call, 'id', '?')}: {err}")
        return None
