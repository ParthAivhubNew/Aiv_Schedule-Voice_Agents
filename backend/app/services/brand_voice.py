"""How a company wants its posts to sound. Kept in the company's Post Scheduler settings and
given to Plan AI chat and to the post writer, so each company stops sounding the same.

Besides what the company writes down, the style is also learned: how people rewrite the AI's drafts,
which of their posts did best, and why approvers rejected posts. The learned rules are shown to the
user, who can switch them off or delete any of them; they are refreshed weekly once there is more to go on.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.future import select

logger = logging.getLogger("brand_voice")

FIELDS = ("tone", "audience", "always", "never")
MAX_SAMPLES = 3
SAMPLE_CHARS = 1500


def clean(raw: Dict[str, Any]) -> Dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    out: Dict[str, Any] = {k: str(raw.get(k) or "").strip()[:600] for k in FIELDS}
    samples: List[str] = [str(s).strip()[:SAMPLE_CHARS] for s in (raw.get("samples") or []) if str(s or "").strip()]
    out["samples"] = samples[:MAX_SAMPLES]
    return out


async def load(db) -> Dict[str, Any]:
    from app.models.models import CompanyProfile, SchedulerSetting

    row = (await db.execute(select(SchedulerSetting).where(SchedulerSetting.id == "default"))).scalars().first()
    data = row.data if row and isinstance(row.data, dict) else {}
    voice = clean(data.get("brandVoice") or {})
    voice["learned"] = data.get("learnedStyle") or None
    if not voice["tone"]:
        prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
        voice["tone"] = ((prof.tone if prof else "") or "").strip()
    return voice


async def save(db, raw: Dict[str, Any]) -> Dict[str, Any]:
    from app.models.models import SchedulerSetting

    voice = clean(raw)
    row = (await db.execute(select(SchedulerSetting).where(SchedulerSetting.id == "default"))).scalars().first()
    if not row:
        row = SchedulerSetting(id="default", data={})
        db.add(row)
    data = dict(row.data or {})
    data["brandVoice"] = voice
    row.data = data
    await db.commit()
    return {**voice, "learned": data.get("learnedStyle") or None}


def prompt_block(voice: Dict[str, Any]) -> str:
    """Brand voice for an AI prompt, or "" when nothing is set."""
    if not voice:
        return ""
    lines = []
    if voice.get("tone"):
        lines.append(f"Tone: {voice['tone']}")
    if voice.get("audience"):
        lines.append(f"Audience: {voice['audience']}")
    if voice.get("always"):
        lines.append(f"Always: {voice['always']}")
    if voice.get("never"):
        lines.append(f"Never: {voice['never']}")
    learned = voice.get("learned") or {}
    if learned.get("on") and learned.get("rules"):
        lines.append("Learned from how this company edits drafts and from its best posts:\n- " + "\n- ".join(learned["rules"]))
    samples = voice.get("samples") or []
    if samples:
        lines.append("Posts the company likes (match the voice and rhythm; never copy their topics or wording):")
        lines += [f"--- example {i + 1} ---\n{s}" for i, s in enumerate(samples)]
    return ("Brand voice:\n" + "\n".join(lines)) if lines else ""


# ── Learned style ───────────────────────────────────────────────────────────
MAX_RULES = 8
MIN_SIGNALS = 3
RELEARN_AFTER = timedelta(days=7)
RELEARN_NEW_SIGNALS = 5


async def _settings_row(db):
    from app.models.models import SchedulerSetting

    row = (await db.execute(select(SchedulerSetting).where(SchedulerSetting.id == "default"))).scalars().first()
    if not row:
        row = SchedulerSetting(id="default", data={})
        db.add(row)
    return row


async def _signals(db) -> Dict[str, List[Any]]:
    """What the style is learned from: hand edits of AI drafts, the best posts, and rejection notes."""
    from app.models.models import SocialPost, SocialPostMetric, SocialPostVersion

    versions = (await db.execute(select(SocialPostVersion)
                                 .where(SocialPostVersion.created_at >= datetime.utcnow() - timedelta(days=120))
                                 .order_by(SocialPostVersion.post_id, SocialPostVersion.created_at))).scalars().all()
    edits, prev = [], {}
    for v in versions:
        before = prev.get(v.post_id)
        if v.source == "you" and before is not None and before.source in ("ai", "original", "update") \
                and (before.copy or "").strip() and (v.copy or "").strip() != (before.copy or "").strip():
            edits.append({"before": (before.copy or "")[:700], "after": (v.copy or "")[:700]})
        prev[v.post_id] = v
    edits = edits[-15:]
    since = datetime.utcnow() - timedelta(days=90)
    eng = (func.coalesce(SocialPostMetric.likes, 0) + func.coalesce(SocialPostMetric.comments, 0)
           + func.coalesce(SocialPostMetric.shares, 0) + func.coalesce(SocialPostMetric.saves, 0))
    ranked = (await db.execute(select(SocialPostMetric.post_id, func.sum(eng)).where(SocialPostMetric.published_at >= since)
                               .group_by(SocialPostMetric.post_id).order_by(func.sum(eng).desc()).limit(5))).all()
    ids = [pid for pid, e in ranked if (e or 0) > 0]
    posts = {p.id: p for p in (await db.execute(select(SocialPost).where(SocialPost.id.in_(ids)))).scalars().all()} if ids else {}
    top = [{"text": (posts[i].copy or "")[:700], "engagements": int(e or 0)}
           for i, e in ranked if i in posts and (posts[i].copy or "").strip()]
    notes = [n for (n,) in (await db.execute(select(SocialPost.review_note).where(SocialPost.review_note.isnot(None))
                                             .order_by(SocialPost.created_at.desc()).limit(10))).all() if (n or "").strip()]
    return {"edits": edits, "top": top, "notes": [n[:300] for n in notes]}


def _signal_count(sig: Dict[str, List[Any]]) -> int:
    return len(sig["edits"]) + len(sig["top"]) + len(sig["notes"])


def parse_rules(reply: str) -> List[str]:
    m = re.search(r"\{[\s\S]*\}", reply or "")
    rules: List[Any] = []
    if m:
        try:
            rules = (json.loads(m.group(0)) or {}).get("rules") or []
        except ValueError:
            rules = []
    if not rules:
        rules = [ln.strip(" -*•\t") for ln in (reply or "").splitlines() if ln.strip().startswith(("-", "*", "•"))]
    out: List[str] = []
    for r in rules:
        r = re.sub(r"\s+", " ", str(r or "")).strip()[:220]
        if r and r not in out:
            out.append(r)
    return out[:MAX_RULES]


async def learn(db) -> Dict[str, Any]:
    """Ask the writing AI for a few concrete style rules from the company's own signals, and keep them.
    Raises ValueError (plain words) when there is too little to learn from."""
    sig = await _signals(db)
    if _signal_count(sig) < MIN_SIGNALS:
        raise ValueError("Not enough to learn from yet. Edit a few AI drafts or publish a few posts with results, then try again.")
    parts = []
    if sig["edits"]:
        parts.append("How the team rewrote AI drafts (before, then after):\n" + "\n\n".join(
            f"BEFORE: {e['before']}\nAFTER: {e['after']}" for e in sig["edits"]))
    if sig["top"]:
        parts.append("Their best-performing posts:\n" + "\n\n".join(f"({t['engagements']} engagements) {t['text']}" for t in sig["top"]))
    if sig["notes"]:
        parts.append("Why approvers rejected posts:\n- " + "\n- ".join(sig["notes"]))
    system = ("You study how one company likes its social media posts written. From the evidence, write between 3 and "
              f"{MAX_RULES} short, specific writing rules a copywriter can follow (length, opening line, tone, words they add "
              "or remove, emojis, hashtags, calls to action, formatting). Only rules the evidence supports; no generic advice. "
              'Reply with JSON only: {"rules": ["..."]}')
    from app.api.scheduler import _resolve_text_ai
    from app.services import platform_ai
    from app.services.generation_queue import PRIORITY_INTERACTIVE, TEXT_SLOTS
    from app.services.llm_gateway import call_open_chat_llm, output_token_limit

    async def attempt(slot: str) -> Dict[str, Any]:
        ai = await _resolve_text_ai(db, None, slot)
        if ai["error"]:
            raise platform_ai.AIUnavailable(ai["error"])
        async with TEXT_SLOTS.slot(PRIORITY_INTERACTIVE):
            res = await call_open_chat_llm(messages=[{"role": "user", "content": "\n\n".join(parts)[:16000]}], system_prompt=system,
                                           api_key=ai["api_key"], provider=ai["provider"], model=ai["model"],
                                           base_url=ai["base_url"], max_tokens=output_token_limit(ai["provider"], 1200), db=db)
        if not res.get("success", True) or res.get("error") or not (res.get("reply") or "").strip():
            raise platform_ai.AIUnavailable(res.get("error") or "The writing AI returned an empty reply.")
        return res

    res = await platform_ai.run_with_backup(db, "text", attempt)
    rules = parse_rules(res.get("reply") or "")
    if not rules:
        raise ValueError("The AI did not return any rules. Try again in a moment.")
    row = await _settings_row(db)
    data = dict(row.data or {})
    old = data.get("learnedStyle") or {}
    data["learnedStyle"] = {"rules": rules, "on": old.get("on", True), "updatedAt": datetime.utcnow().isoformat() + "Z",
                            "basedOn": {k: len(v) for k, v in sig.items()}, "signals": _signal_count(sig)}
    row.data = data
    await db.commit()
    return data["learnedStyle"]


async def set_learned(db, on: Optional[bool] = None, rules: Optional[List[str]] = None) -> Optional[Dict[str, Any]]:
    """Switch the learned rules on or off, or keep only the rules the user left in."""
    row = await _settings_row(db)
    data = dict(row.data or {})
    cur = dict(data.get("learnedStyle") or {})
    if not cur:
        return None
    if on is not None:
        cur["on"] = bool(on)
    if rules is not None:
        cur["rules"] = [r for r in (str(x).strip()[:220] for x in rules) if r][:MAX_RULES]
    data["learnedStyle"] = cur
    row.data = data
    await db.commit()
    return cur


async def maybe_relearn(db) -> bool:
    """Weekly refresh when there is clearly more to learn from. Never raises."""
    try:
        row = await _settings_row(db)
        cur = (row.data or {}).get("learnedStyle") or {}
        if cur and cur.get("on") is False:
            return False
        updated = cur.get("updatedAt")
        if updated and datetime.utcnow() - datetime.fromisoformat(updated.rstrip("Z")) < RELEARN_AFTER:
            return False
        sig = await _signals(db)
        n = _signal_count(sig)
        if n < MIN_SIGNALS or n - int(cur.get("signals") or 0) < (RELEARN_NEW_SIGNALS if cur else MIN_SIGNALS):
            return False
        await learn(db)
        return True
    except Exception as err:
        logger.info(f"[brand-voice] weekly learning skipped: {err}")
        try:
            await db.rollback()
        except Exception:
            pass
        return False
