"""Tools a managed Telnyx assistant calls during a call. Each runs inside the call's
organisation (from its signed reference) and works on that call's brief only."""
from __future__ import annotations

import logging
from typing import Any, Dict

from sqlalchemy import or_
from sqlalchemy.future import select

from app.database import AsyncSessionLocal

logger = logging.getLogger("voice_tools")

MAX_FIELDS = 30
MAX_TEXT = 2000
NO_ANSWER = "I don't have that information. Offer to have someone from the team follow up."


async def run(tool: str, call_id: str, args: Dict[str, Any]) -> Dict[str, Any]:
    from app.services import voice_assistants as VA

    async with AsyncSessionLocal() as db:
        brief = await VA.brief(db, call_id)
        if brief is None:
            return {"success": False, "error": "This call is not recognised."}
        handler = _TOOLS.get(tool)
        if handler is None:
            return {"success": False, "error": f"Unknown tool {tool}."}
        out = await handler(db, brief, args or {})
        await db.commit()
        return out


async def _get_script(db, brief, args) -> Dict[str, Any]:
    return {"success": True, "script": brief.script}


async def _lookup_knowledge(db, brief, args) -> Dict[str, Any]:
    from app.models.models import FAQ, KnowledgeChunk

    question = str(args.get("question") or "").strip()[:300]
    if not question:
        return {"success": False, "error": "Say what you need to know."}
    found = []
    try:
        from app.services.rag_service import search_knowledge

        found = [r["content"] for r in await search_knowledge(db, question, top_k=3)]
    except Exception as err:  # no embeddings key, or no pgvector: fall back to words
        logger.debug(f"[voice-tools] semantic search skipped: {err}")
    if not found:
        words = [w for w in question.lower().replace("?", " ").split() if len(w) > 3][:6]
        if words:
            faqs = (await db.execute(select(FAQ).where(or_(*[FAQ.question.ilike(f"%{w}%") for w in words])).limit(3))).scalars().all()
            found = [f"Q: {f.question}\nA: {f.answer}" for f in faqs]
            if not found:
                chunks = (await db.execute(select(KnowledgeChunk).where(
                    or_(*[KnowledgeChunk.content.ilike(f"%{w}%") for w in words])).limit(3))).scalars().all()
                found = [c.content for c in chunks]
    if not found:
        return {"success": True, "found": False, "answer": NO_ANSWER}
    return {"success": True, "found": True, "answer": "\n\n".join(found)[:MAX_TEXT]}


async def _context(db, brief) -> Dict[str, Any]:
    from app.services.conversation_engine import context_resolver

    if brief.direction == "outbound":
        ctx = await context_resolver.resolve_outbound(db, prospect_id=brief.prospect_id or None,
                                                      mission_id=brief.mission_id or None, override_phone=brief.phone or None)
    else:
        ctx = await context_resolver.resolve_inbound(db, brief.phone or "unknown")
    ctx["direction"] = brief.direction
    try:  # the business's booking rules (meeting length, types, timezone wording) apply to the tools too
        from app.services.booking_policy import normalize_booking_policy
        from app.services.calendar_service import calendar_service

        setting = await calendar_service.get_or_create_settings(db)
        ctx["booking_policy"] = normalize_booking_policy(getattr(setting, "booking_policy", None))
    except Exception as err:
        logger.debug(f"[voice-tools] booking policy skipped: {err}")
    return ctx


async def _live_call(db, call_id: str):
    from app.models.models import LiveCall

    return (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()


async def _booking(db, brief, args, name: str) -> Dict[str, Any]:
    from app.services.booking_tools import execute_smart_booking_tool

    result = await execute_smart_booking_tool(db, name, dict(args), await _context(db, brief))
    if name == "book_appointment" and isinstance(result, dict) and result.get("success"):
        brief.outcome = "meeting_booked"
        rec = await _live_call(db, brief.id)
        if rec:
            rec.booked = True
    return result


async def _check_availability(db, brief, args):
    return await _booking(db, brief, args, "check_availability")


async def _book_appointment(db, brief, args):
    return await _booking(db, brief, args, "book_appointment")


async def _request_human(db, brief, args) -> Dict[str, Any]:
    reason = str(args.get("reason") or "").strip()[:300] or "The caller asked for a person."
    rec = await _live_call(db, brief.id)
    if rec:
        rec.state, rec.flag = "human_review", reason
        rec.transcript = list(rec.transcript or []) + [f"System: The assistant asked for a person: {reason}"]
    if not brief.outcome:
        brief.outcome = "human_requested"
    try:
        from app.websockets.call_hub import call_hub

        await call_hub.broadcast("call_updated", {"callId": brief.id, "state": "human_review", "flag": reason})
    except Exception:
        pass
    try:
        from app.core.notify import notify

        who = rec.prospect if rec else brief.phone
        await notify("call_needs_review", "A call needs a person now",
                     [f"The assistant on the call with {who} asked for someone to take over.", f"Reason: {reason}"],
                     only_user_ids=[brief.operator_id] if brief.operator_id else None)
    except Exception as err:
        logger.debug(f"[voice-tools] notify skipped: {err}")
    return {"success": True, "message": "The team has been alerted. Tell the person someone will be with them shortly."}


async def _save_outcome(db, brief, args) -> Dict[str, Any]:
    from app.services.voice_assistants import OUTCOMES

    outcome = str(args.get("outcome") or "").strip()
    if outcome not in OUTCOMES:
        outcome = "other"
    if brief.outcome != "meeting_booked":  # a booking made in this call stays the outcome
        brief.outcome = outcome
    if outcome == "do_not_call" and brief.phone:
        # They asked not to be called again: never dial this number again for this company.
        from app.services.compliance import add_do_not_call

        await add_do_not_call(db, brief.phone)
    notes = str(args.get("notes") or "").strip()[:MAX_TEXT]
    if notes:
        brief.notes = notes
    fields = args.get("fields") if isinstance(args.get("fields"), dict) else {}
    captured = dict(brief.captured or {})
    for k, v in list(fields.items())[:MAX_FIELDS]:
        captured[str(k)[:60]] = str(v)[:300]
    brief.captured = captured
    return {"success": True}


_TOOLS = {
    "get_script": _get_script,
    "lookup_knowledge": _lookup_knowledge,
    "check_availability": _check_availability,
    "book_appointment": _book_appointment,
    "request_human": _request_human,
    "save_outcome": _save_outcome,
}

# Call history outcome for what the assistant reported (others keep the hangup outcome).
HISTORY_OUTCOME = {"meeting_booked": "meeting_booked", "callback_requested": "callback_requested",
                   "human_requested": "human_review"}
