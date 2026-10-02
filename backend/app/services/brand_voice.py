"""How a company wants its posts to sound. Kept in the company's Post Scheduler settings and
given to Plan AI chat and to the post writer, so each company stops sounding the same."""
from __future__ import annotations

from typing import Any, Dict, List

from sqlalchemy.future import select

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
    voice = clean((row.data or {}).get("brandVoice") if row and isinstance(row.data, dict) else {})
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
    return voice


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
    samples = voice.get("samples") or []
    if samples:
        lines.append("Posts the company likes (match the voice and rhythm; never copy their topics or wording):")
        lines += [f"--- example {i + 1} ---\n{s}" for i, s in enumerate(samples)]
    return ("Brand voice:\n" + "\n".join(lines)) if lines else ""
