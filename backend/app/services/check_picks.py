"""Picks: when a company check finds several phones or emails and cannot tell which is right, it keeps the
options for the person to choose from instead of guessing.

A pick lives in the company's check result (`verification.fixes`, kind "pick") beside the other fixes. Nothing
is saved on the company until the person chooses; skipping leaves it open. Nothing here overwrites a value the
person already saved.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.services.check_fixes import set_field

FIELDS: Dict[str, str] = {"phone": "phones", "email": "emails"}  # company field -> key in the research result
MAX_OPTIONS = 5
SOURCE = "Web search"


def _key(field: str, value: str) -> str:
    return re.sub(r"\D", "", value) if field == "phone" else value.strip().lower()


def candidates(research: Optional[Dict[str, Any]], field: str) -> List[str]:
    """The distinct values the web search found for a field, best first."""
    out: List[str] = []
    seen: set = set()
    for raw in (research or {}).get(FIELDS[field]) or []:
        v = str(raw.get("value") if isinstance(raw, dict) else raw or "").strip()
        k = _key(field, v)
        if v and k and k not in seen:
            seen.add(k)
            out.append(v)
    return out[:MAX_OPTIONS]


def add_picks(acc: Any, before: Dict[str, str], result: Dict[str, Any]) -> int:
    """After a web search: for each field that was blank and now has two or more candidates, undo the guess the search
    filled in, and add a pick to the check result. Returns how many picks were added."""
    added = 0
    for field in FIELDS:
        cands = candidates(getattr(acc, "research", None), field)
        if (before.get(field) or "").strip() or len(cands) < 2:
            continue
        setattr(acc, field, "")
        research = dict(acc.research or {})
        research["filled"] = [f for f in research.get("filled") or [] if f.get("field") != field]
        acc.research = research
        fixes = [f for f in result.setdefault("fixes", []) if not (f.get("kind") == "pick" and f.get("field") == field)]
        fixes.append({"kind": "pick", "field": field, "options": [{"value": c, "source": SOURCE} for c in cands], "applied": False})
        result["fixes"] = fixes
        added += 1
    return added


def open_picks(acc: Any) -> List[Dict[str, Any]]:
    return [f for f in ((acc.verification or {}).get("fixes") or []) if f.get("kind") == "pick" and not f.get("applied")]


class PickError(ValueError):
    """Something the person can fix, in plain words."""


def _update(acc: Any, field: str, change: Dict[str, Any]) -> Dict[str, Any]:
    ver = dict(acc.verification or {})
    fixes = [dict(f) for f in ver.get("fixes") or []]
    for f in fixes:
        if f.get("kind") == "pick" and f.get("field") == field and not f.get("applied"):
            f.update(change)
            ver["fixes"] = fixes
            acc.verification = ver  # a new dict, so the change is saved
            return f
    raise PickError("That one was already chosen.")


def choose(acc: Any, field: str, value: str) -> str:
    """Save the chosen value on the company. It must be one of the options that were shown."""
    pick = next((f for f in open_picks(acc) if f.get("field") == field), None)
    if pick is None:
        done = next((f for f in ((acc.verification or {}).get("fixes") or []) if f.get("kind") == "pick" and f.get("field") == field and f.get("applied")), None)
        raise PickError(f"That was already chosen: {done.get('chosen')}." if done and done.get("chosen") else "There is nothing to choose here any more.")
    shown = [o["value"] for o in pick.get("options") or []]
    value = (value or "").strip()
    if value not in shown:
        raise PickError("That isn't one of the options that were shown.")
    set_field(acc, field, value)
    _update(acc, field, {"applied": True, "chosen": value, "chosen_at": datetime.utcnow().isoformat() + "Z"})
    return value


def skip(acc: Any, field: str) -> None:
    """Leave it for later. It stays open and nothing is saved."""
    _update(acc, field, {"skipped_at": datetime.utcnow().isoformat() + "Z"})


def as_cards(rows: Iterable[Any]) -> List[Dict[str, Any]]:
    out = []
    for acc in rows:
        for p in open_picks(acc):
            out.append({"account_id": acc.id, "name": acc.name, "region": acc.region or "", "field": p["field"],
                        "options": p.get("options") or [], "skipped": bool(p.get("skipped_at"))})
    return out
