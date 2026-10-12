"""Fixes a company check suggests, and accepting them.

A check never overwrites what the user saved. A blank field it can fill is filled; a value that looks
wrong is offered as a fix, kept in the company's check result next to the original. Accepting a fix puts
the new value in the company and marks the fix applied; the original stays in the fix for reference.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

FIELDS = ("phone", "website", "email")


def _domain(url: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", (url or "").strip().lower()).split("/")[0]


def set_field(acc: Any, field: str, value: str) -> None:
    if field == "website":
        acc.website = value if "://" in value else f"https://{value}"
        acc.domain = _domain(value)
    elif field == "email":
        acc.email = value.strip().lower()
    elif field == "phone":
        acc.phone = value.strip()[:60]


def open_fixes(acc: Any) -> List[Dict[str, Any]]:
    return [f for f in ((acc.verification or {}).get("fixes") or []) if f.get("kind") == "fix" and not f.get("applied")]


def accept(acc: Any, fields: Optional[Iterable[str]] = None) -> int:
    """Apply this company's open fixes (all of them, or only the named fields). Returns how many were applied."""
    wanted = set(fields) if fields else set(FIELDS)
    ver = dict(acc.verification or {})
    fixes = [dict(f) for f in ver.get("fixes") or []]
    n = 0
    for f in fixes:
        if f.get("kind") == "fix" and not f.get("applied") and f.get("field") in wanted:
            set_field(acc, f["field"], f["to"])
            f["applied"] = True
            n += 1
    if n:
        ver["fixes"] = fixes
        acc.verification = ver  # a new dict, so the change is saved
    return n
