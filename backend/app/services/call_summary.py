"""AI summaries of calls: kept on the call (never mailed on their own), shown on screen, handed to
the person who takes over, and handed back to the assistant when it carries on.

A long call is summarised in pieces first so nothing is cut off. If no AI key works, a plain
recap of the last turns stands in, so a person is never left without context.
"""
from __future__ import annotations

import asyncio
import html
import logging
from typing import Any, Dict, List

from sqlalchemy.future import select

from app.database import AsyncSessionLocal

logger = logging.getLogger("call_summary")

PIECE_CHARS = 9000      # one LLM request reads at most this much transcript
MAX_PIECES = 8          # beyond this the oldest pieces are merged first, never dropped
MIN_LINES = 2           # fewer spoken lines than this is not worth summarising
TAIL_LINES = 12         # the plain recap when no AI summary is possible

LIVE_PROMPT = (
    "You brief a colleague who is about to take over a phone call that an AI assistant has been handling. "
    "Write for someone reading it in ten seconds, in plain English, no preamble:\n"
    "Who: who is on the line and their company if said.\n"
    "Wants: what they want or asked.\n"
    "So far: what was said, answered and agreed, with any names, numbers, dates or emails.\n"
    "Open: what is unanswered or why the AI needed a person.\n"
    "Next: the single best next step.\n"
    "Use only what the transcript says. Never invent facts. Under 150 words."
)
FINAL_PROMPT = (
    "Summarise this finished phone call for the business that made or took it, in plain English, no preamble:\n"
    "Outcome: one line.\nKey points: up to 5 short bullets.\nFollow-up: what should happen next, or 'None'.\n"
    "Include names, numbers, dates and emails that were said. Use only what the transcript says. Under 180 words."
)
PIECE_PROMPT = (
    "Condense this part of a phone call transcript, keeping every fact, name, number, date, email, "
    "question and decision. Plain text, no preamble. Under 220 words."
)


def spoken(lines: List[Any]) -> List[str]:
    """Transcript lines as 'AI: …' / 'Caller: …' / 'Note: …' text, whatever shape they are stored in."""
    from app.services.call_log_writer import format_transcript_lines

    names = {"ai": "AI", "them": "Caller", "system": "Note"}
    out = []
    for f in format_transcript_lines(list(lines or [])):
        text = (f.get("text") or "").strip()
        if text:
            out.append(f"{names.get(f.get('who'), 'AI')}: {text}")
    return out


def plain_recap(lines: List[str]) -> str:
    """No AI available: the last turns, as they were said."""
    tail = [l for l in lines if not l.startswith("Note:")][-TAIL_LINES:]
    return ("Recent conversation (AI summary unavailable):\n" + "\n".join(tail)) if tail else ""


def _pieces(lines: List[str], size: int = PIECE_CHARS) -> List[str]:
    out, cur, n = [], [], 0
    for l in lines:
        if n + len(l) > size and cur:
            out.append("\n".join(cur))
            cur, n = [], 0
        cur.append(l[:size])
        n += len(l) + 1
    if cur:
        out.append("\n".join(cur))
    return out


async def _ask(db, system: str, text: str, max_tokens: int) -> str:
    from app.services.llm_gateway import call_open_chat_llm

    res = await call_open_chat_llm(messages=[{"role": "user", "content": text}], system_prompt=system,
                                   temperature=0.2, max_tokens=max_tokens, db=db, scope="voice")
    if res and res.get("success") and res.get("reply"):
        return str(res["reply"]).strip()
    return ""


async def summarize(db, raw_lines: List[Any], *, final: bool = False) -> str:
    """The summary text for these transcript lines ('' when there is nothing to say)."""
    lines = spoken(raw_lines)
    if sum(1 for l in lines if not l.startswith("Note:")) < MIN_LINES:
        return ""
    try:
        pieces = _pieces(lines)
        while len(pieces) > 1:  # long call: condense the pieces, then summarise what is left
            if len(pieces) > MAX_PIECES:
                head, pieces = pieces[:2], pieces[2:]
                merged = await _ask(db, PIECE_PROMPT, "\n\n".join(head), 600)
                if not merged:
                    return plain_recap(lines)
                pieces.insert(0, merged)
                continue
            done = []
            for p in pieces:
                c = await _ask(db, PIECE_PROMPT, p, 600)
                if not c:
                    return plain_recap(lines)
                done.append(c)
            pieces = ["\n\n".join(done)]
        text = await _ask(db, FINAL_PROMPT if final else LIVE_PROMPT, pieces[0], 450)
        return text or plain_recap(lines)
    except Exception as err:
        logger.warning(f"[call-summary] AI summary failed: {err}")
        return plain_recap(lines)


async def _broadcast(call_id: str) -> None:
    try:  # ids only: the screen fetches the text itself, inside its own organisation
        from app.websockets.call_hub import call_hub

        await call_hub.broadcast("call_summary", {"callId": call_id})
    except Exception:
        pass


async def refresh_live(call_id: str, *, sync: bool = True) -> str:
    """Summarise a call in progress and keep it on the call. Safe to run in the background."""
    from app.models.models import LiveCall

    try:
        if sync:
            await _sync_now(call_id)
        async with AsyncSessionLocal() as db:
            rec = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
            if rec is None:
                return ""
            text = await summarize(db, rec.transcript or [])
            if text:
                rec.summary = text
                await db.commit()
        if text:
            await _broadcast(call_id)
        return text
    except Exception as err:
        logger.warning(f"[call-summary] live summary for {call_id} failed: {err}")
        return ""


async def _sync_now(call_id: str) -> None:
    """Pull the newest turns from the phone provider before summarising."""
    from app.models.models import LiveCall
    from app.services import telnyx_assistant_calls as TA

    async with AsyncSessionLocal() as db:
        rec = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
        sid = rec.carrier_sid if rec is not None else ""
    if sid and TA.is_tracked(sid):
        await TA._sync_transcript(sid)


async def summarize_finished(call_id: str, delay: float = 0.0) -> None:
    """The final summary, on the call and in Call history. Never mailed on its own."""
    from app.models.models import CallLog, LiveCall
    from app.services.call_log_writer import log_id_for_call

    try:
        if delay:
            await asyncio.sleep(delay)
        async with AsyncSessionLocal() as db:
            log = (await db.execute(select(CallLog).where(CallLog.id == log_id_for_call(call_id)))).scalars().first()
            rec = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
            lines = (log.transcript if log is not None and log.transcript else (rec.transcript if rec is not None else [])) or []
            text = await summarize(db, lines, final=True)
            if not text:
                return
            if log is not None:
                log.summary = text
            if rec is not None:
                rec.summary = text
            await db.commit()
        await _broadcast(call_id)
    except Exception as err:
        logger.warning(f"[call-summary] final summary for {call_id} failed: {err}")


def restart_context(summary: str, transcript: List[Any]) -> str:
    """What the assistant is told when it carries on after a person was on the call."""
    text = (summary or "").strip() or plain_recap(spoken(transcript))
    return ("Here is what happened on this call before you carry on (do not repeat it to the caller):\n"
            f"{text}\n\n") if text else ""


# ── Emails ──────────────────────────────────────────────────────────────────
def _paras(text: str) -> List[str]:
    return [html.escape(p).replace("\n", "<br>") for p in (text or "").split("\n\n") if p.strip()] or [html.escape(text or "")]


async def alert_person_needed(call_id: str, who: str, reason: str, operator_id: str = "") -> None:
    """The AI asked for a person: summary on the call, then email with that summary."""
    await asyncio.sleep(1)  # the tool call that raised this is still saving the call
    summary = await refresh_live(call_id)
    try:
        from app.config import settings as cfg
        from app.core.notify import notify

        lines = [f"The assistant on the call with <b>{html.escape(who or 'a caller')}</b> asked for someone to take over.",
                 f"<b>Reason:</b> {html.escape(reason)}"]
        if summary:
            lines += ["<b>What has happened so far</b>"] + _paras(summary)
        await notify("call_needs_review", "A call needs a person now", lines,
                     {"label": "Open the call", "url": (cfg.PUBLIC_BASE_URL or "").rstrip("/") + "/"},
                     only_user_ids=[operator_id] if operator_id else None)
    except Exception as err:
        logger.debug(f"[call-summary] alert email skipped: {err}")


async def email_summary(to: str, title: str, summary: str) -> Dict[str, Any]:
    """Sent only when a user asks for it."""
    from app.core.mailer import render, send_system_email

    msg = render(f"Call summary: {title}", _paras(summary))
    return await send_system_email(to, f"Call summary: {title}", msg["html"], msg["text"])
