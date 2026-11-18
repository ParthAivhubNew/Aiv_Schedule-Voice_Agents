"""The industries people can pick in Find Leads: the real values of business_records.industry, cleaned and counted.

The column holds four kinds of value (checked on the live database, 6.7M rows, 1,829 distinct values):
  * "69201 - Accounting activities"  Companies House SIC text, the main activity  -> a SIC term (picks the existing sic_codes filter)
  * "Restaurant/Cafe/Canteen", "Charity"  a register's own type                  -> a type term (picks the exact-type filter)
  * "Doctors/GPs|Doctors/GPs|Mobile doctors"  the care register's service types joined by "|", often repeated -> one type term each, counts added up
  * "None Supplied", an empty value, bare codes like "69201"  -> junk, or a code with no label
The list is small enough to hold whole, so typing never queries the database: refresh() builds it (slow, run from a script) and stores it
in app_settings; load() reads it back with a short in-memory cache. If nothing is stored the picker uses the old SIC search.
"""
from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

_KEY = "industry_terms:v1"
_TTL = 600.0
_JUNK = {"none supplied"}
_HIDDEN_SIC = {"99999"}  # "Dormant Company": only offered when someone types "dormant"
_SIC = re.compile(r"^\s*(\d{4,5})\s*-\s*(.+?)\s*$")
_ONLY_CODES = re.compile(r"^[0-9 ,]+$")
_cache: Dict[str, Any] = {"at": 0.0, "terms": []}


def build_terms(rows: List[Tuple[Any, Any]]) -> List[Dict[str, Any]]:
    """(industry value, how many companies) pairs -> the terms to offer, biggest first."""
    sic: Dict[str, Dict[str, Any]] = {}
    types: Dict[str, Dict[str, Any]] = {}
    bare: Dict[str, int] = {}
    for value, n in rows:
        v = str(value or "").strip()
        count = int(n or 0)
        if not v or v.lower() in _JUNK:
            continue
        if _ONLY_CODES.match(v):
            for code in dict.fromkeys(re.findall(r"\d{4,5}", v)):
                bare[code] = bare.get(code, 0) + count
            continue
        seen_codes: set = set()
        seen_types: set = set()
        for part in (p.strip() for p in v.split("|") if p.strip()):
            m = _SIC.match(part)
            if m:
                code, label = m.groups()
                if code in seen_codes:
                    continue
                seen_codes.add(code)
                e = sic.setdefault(code, {"label": label, "n": 0})
                e["n"] += count
            else:
                key = part.lower()
                if key in seen_types:
                    continue
                seen_types.add(key)
                e = types.setdefault(key, {"label": part, "n": 0})
                e["n"] += count
    for code, count in bare.items():
        sic.setdefault(code, {"label": "", "n": 0})["n"] += count
    terms: List[Dict[str, Any]] = [{"k": "sic", "code": c, "label": e["label"], "n": e["n"], **({"hidden": True} if c in _HIDDEN_SIC else {})}
                                   for c, e in sic.items()]
    terms += [{"k": "type", "label": e["label"], "n": e["n"]} for e in types.values()]
    terms.sort(key=lambda t: (-t["n"], t.get("label", "")))
    return terms


async def refresh(db) -> int:
    """Reads the whole column (slow: run it from scripts/refresh_industry_terms.py, never from a request) and stores the terms."""
    from sqlalchemy import select, text

    from app.models.models import AppSetting

    await db.execute(text("SET LOCAL statement_timeout = '900s'"))
    rows = (await db.execute(text("SELECT industry, count(*) FROM business_records WHERE lower(status) = 'active' GROUP BY industry"))).all()
    terms = build_terms([(r[0], r[1]) for r in rows])
    data = {"terms": terms, "at": datetime.utcnow().isoformat(), "values": len(rows)}
    row = (await db.execute(select(AppSetting).where(AppSetting.id == _KEY))).scalars().first()
    if row:
        row.data = data
    else:
        db.add(AppSetting(id=_KEY, data=data))
    await db.commit()
    _cache.update(at=0.0, terms=[])
    return len(terms)


async def load(db) -> List[Dict[str, Any]]:
    """The stored terms ([] when none were ever built), cached for ten minutes."""
    if _cache["terms"] and time.monotonic() - _cache["at"] < _TTL:
        return _cache["terms"]
    from sqlalchemy import select

    from app.models.models import AppSetting

    try:
        row = (await db.execute(select(AppSetting).where(AppSetting.id == _KEY))).scalars().first()
    except Exception:
        return []
    terms = list((row.data or {}).get("terms") or []) if row else []
    if terms:
        _cache.update(at=time.monotonic(), terms=terms)
    return terms


def families() -> List[Dict[str, Any]]:
    """The trade families (accountancy = accounting = accountants ...) so the picker can offer their SIC codes for any of their words."""
    from app.services import search_synonyms

    return [{"name": name, "words": list(words), "codes": list(codes)} for name, (words, codes) in search_synonyms.GROUPS.items()]
