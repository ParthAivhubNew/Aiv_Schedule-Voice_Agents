"""Agent Studio: the company's rules for every call (handover, never say, what to find out,
recording), kept on the company profile and added to each call's script."""
from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy.future import select

DEFAULTS: Dict[str, Any] = {
    "handoverWhen": "",  # when to ask for a person, in the company's words
    "neverSay": "",  # things the agent must never say or promise
    "captureFields": [],  # what to find out on each call, e.g. ["email", "budget"]
    "recordCalls": False,  # off by default; when on, every call starts with the recording notice
}
MAX_TEXT = 1500
MAX_FIELDS = 12


def clean(patch: Dict[str, Any], current: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    out = {**DEFAULTS, **(current or {})}
    if "handoverWhen" in patch:
        out["handoverWhen"] = str(patch.get("handoverWhen") or "").strip()[:MAX_TEXT]
    if "neverSay" in patch:
        out["neverSay"] = str(patch.get("neverSay") or "").strip()[:MAX_TEXT]
    if "captureFields" in patch:
        fields = patch.get("captureFields") if isinstance(patch.get("captureFields"), list) else []
        out["captureFields"] = [str(f).strip()[:60] for f in fields if str(f).strip()][:MAX_FIELDS]
    if "recordCalls" in patch:
        out["recordCalls"] = bool(patch.get("recordCalls"))
    return out


async def profile(db) -> Any:
    from app.models.models import CompanyProfile

    return (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()


async def settings(db) -> Dict[str, Any]:
    p = await profile(db)
    return clean({}, (p.studio if p is not None and isinstance(p.studio, dict) else {}))


def disclosure(p: Any) -> str:
    text = (getattr(p, "disclosure", None) or "").strip()
    return text or "This call is recorded."


def rules_block(studio: Dict[str, Any], p: Any) -> str:
    """The company's rules, appended to every call's script."""
    lines = []
    if studio.get("handoverWhen"):
        lines.append(f"- Ask for a person (request_human) when: {studio['handoverWhen']}")
    if studio.get("neverSay"):
        lines.append(f"- Never say or promise: {studio['neverSay']}")
    if studio.get("captureFields"):
        lines.append("- Try to find out, naturally and without interrogating: " + ", ".join(studio["captureFields"])
                     + ". Save what you learn with save_outcome (fields).")
    if studio.get("recordCalls"):
        lines.append(f"- This call is recorded. Your first sentence must include: \"{disclosure(p)}\"")
    else:
        lines.append("- This call is not recorded. Never say that it is.")
    return "COMPANY RULES (always follow):\n" + "\n".join(lines)


async def template_for(db, direction: str, mission_id: str = "", explicit: str = "") -> str:
    """Which script a call uses: the one asked for, else its campaign's, else the company's
    default for that direction, else "" (the active template)."""
    if explicit:
        return explicit
    if mission_id and direction == "outbound":
        from app.models.models import Mission

        m = (await db.execute(select(Mission).where(Mission.id == mission_id))).scalars().first()
        if m is not None and (m.template_id or ""):
            return m.template_id
    p = await profile(db)
    if p is not None:
        return (p.default_outbound_template_id if direction == "outbound" else p.default_inbound_template_id) or ""
    return ""
