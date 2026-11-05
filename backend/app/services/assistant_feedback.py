"""Thumbs up and down on assistant answers, and what is learned from them.

Nothing here trains a model. A thumbs down is kept so staff can see which questions go wrong, and it offers the person one plain sentence they
may keep in their own Memory (which is already added to every later prompt). The sentence is only ever the person's own note or a fixed line
for the reason they picked, and it is saved only when they press the button, so a wrong or injected lesson cannot slip in.
"""
from __future__ import annotations

import uuid
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import AssistantFeedback

PLUGINS = ("leads", "voice", "social")
REASONS: Dict[str, str] = {
    "wrong_companies": "Wrong companies",
    "wrong_info": "Wrong information",
    "missed_ask": "Missed what I asked",
    "too_long": "Too long or slow",
    "other": "Something else",
}
# The sentence offered for each reason when the person wrote no note of their own.
LESSONS: Dict[str, str] = {
    "wrong_companies": "Check that every company matches the exact trade and place I ask for, and say when few match.",
    "wrong_info": "Give only details that are in the company record, and say plainly when something is not known.",
    "missed_ask": "Do exactly what I ask, and ask me a short question first when something is unclear.",
    "too_long": "Keep answers short and get to the point.",
}
RECENT = 30  # how many thumbs-down items the staff list shows


def _clip(text: Any, n: int) -> str:
    return " ".join(str(text or "").split())[:n]


def lesson_for(reason: str, note: str) -> str:
    """The one sentence a thumbs down offers to remember: the person's own words when they gave a note, else the fixed line for the reason."""
    own = _clip(note, 300)
    return own or LESSONS.get(reason, "")


async def record(db: AsyncSession, *, org: str, plugin: str, rating: str, reason: str = "", note: str = "", question: str = "", answer: str = "",
                 chat_id: str = "", message_id: str = "", context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Save one rating. Returns {id, lesson}; the lesson is empty for a thumbs up."""
    plugin = plugin if plugin in PLUGINS else "leads"
    rating = "down" if rating == "down" else "up"
    reason = (reason if reason in REASONS else "other") if rating == "down" else ""
    lesson = lesson_for(reason, note) if rating == "down" else ""
    ctx = context if isinstance(context, dict) else {}
    keep = {k: ctx[k] for k in ("filters", "total", "tools", "kind") if k in ctx}
    row = AssistantFeedback(
        id=f"af_{uuid.uuid4().hex[:16]}", from_org=org or "", plugin=plugin, chat_id=_clip(chat_id, 80), message_id=_clip(message_id, 80),
        rating=rating, reason=reason, note=_clip(note, 500), question=_clip(question, 1000), answer=_clip(answer, 3000),
        context=keep or None, lesson=lesson, lesson_saved=False, status="new")
    db.add(row)
    await db.commit()
    return {"id": row.id, "lesson": lesson}


async def mark_lesson_saved(db: AsyncSession, feedback_id: str, org: str) -> bool:
    row = (await db.execute(select(AssistantFeedback).where(AssistantFeedback.id == feedback_id, AssistantFeedback.from_org == (org or "")))).scalars().first()
    if not row:
        return False
    row.lesson_saved = True
    await db.commit()
    return True


async def report(db: AsyncSession, days: int = 30) -> Dict[str, Any]:
    """What staff see: ratings by assistant, the reasons behind the thumbs down, and the latest ones. No organisation or person is named."""
    since = datetime.utcnow() - timedelta(days=min(max(int(days or 30), 1), 365))
    base = AssistantFeedback.created_at >= since
    pairs = (await db.execute(select(AssistantFeedback.plugin, AssistantFeedback.rating, func.count()).where(base)
                              .group_by(AssistantFeedback.plugin, AssistantFeedback.rating))).all()
    by_plugin: Dict[str, Dict[str, int]] = {p: {"up": 0, "down": 0} for p in PLUGINS}
    for plugin, rating, n in pairs:
        by_plugin.setdefault(plugin, {"up": 0, "down": 0})[rating] = int(n)
    for v in by_plugin.values():
        total = v["up"] + v["down"]
        v["up_rate"] = round(100 * v["up"] / total) if total else None
    downs = (await db.execute(select(AssistantFeedback).where(base, AssistantFeedback.rating == "down", AssistantFeedback.status == "new")
                              .order_by(AssistantFeedback.created_at.desc()).limit(500))).scalars().all()
    reasons = Counter((r.plugin, r.reason or "other") for r in downs)
    top = [{"plugin": p, "reason": k, "label": REASONS.get(k, k), "count": n} for (p, k), n in reasons.most_common(12)]
    recent: List[Dict[str, Any]] = [
        {"id": r.id, "plugin": r.plugin, "reason": REASONS.get(r.reason, r.reason), "note": r.note, "question": r.question, "answer": r.answer[:400],
         "context": r.context or {}, "at": r.created_at.isoformat() if r.created_at else ""} for r in downs[:RECENT]]
    return {"days": days, "by_plugin": by_plugin, "top_reasons": top, "recent": recent}


async def set_status(db: AsyncSession, feedback_id: str, status: str) -> bool:
    if status not in ("new", "fixed", "dismissed"):
        return False
    row = (await db.execute(select(AssistantFeedback).where(AssistantFeedback.id == feedback_id))).scalars().first()
    if not row:
        return False
    row.status = status
    await db.commit()
    return True
