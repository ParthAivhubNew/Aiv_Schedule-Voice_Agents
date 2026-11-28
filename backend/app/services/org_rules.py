"""An organisation's own exclusion rules: what its admins keep in Administration > Exclusions, turned into search conditions.

A rule is (kind, value, mode):
  sic              a SIC code; a short one leaves out every code that starts with it (47 = all of 47xxx)
  company_type     the register's company type, exact (lower case)
  name_word        a word or phrase in the company name; `*` at the end of a word means any letters (charit* = charity, charitable)
  category         a directory-style category (Places of Worship): the name words and SIC codes it stands for (exclusion_categories.py)
  postcode         a postcode district (BN9, SW1A, BN1 4)
  company_number   one company (Companies House form)
  charity_register leaves out everything on the Charity Commission register (no value)
  status_only      keeps only companies whose status is exactly "Active" (no value)
  ch_number_only   keeps only Companies House companies, i.e. an 8-character company number (no value)
mode `exclude` leaves out; mode `keep` (name_word only) rescues names that hold the phrase from the organisation's own name_word rules.

Disabled rules are never read. services/tenant_policy.py loads the enabled rules of an organisation and ANDs `conditions` into every search.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import cast, func, or_, String

from app.models.models import BusinessRecord

KINDS = ("sic", "company_type", "name_word", "category", "postcode", "company_number", "charity_register", "status_only", "ch_number_only")
SWITCHES = ("charity_register", "status_only", "ch_number_only")
MAX_RULES = 500
MAX_VALUE = 80
STATUS = "Active"
CH_NUMBER = "^[A-Z0-9]{8}$"

KIND_LABELS = {
    "sic": "Industry (SIC code)", "company_type": "Company type", "name_word": "Word in the name", "category": "Category",
    "postcode": "Postcode district", "company_number": "One company", "charity_register": "Register check",
    "status_only": "Register check", "ch_number_only": "Register check",
}

# What the register calls a company type, lower case (the rule matches the whole type exactly).
KNOWN_TYPES = ("charitable incorporated organisation", "scottish charitable incorporated organisation", "registered society", "royal charter company",
               "other company type", "private limited company", "public limited company", "limited liability partnership", "private unlimited company",
               "limited partnership", "scottish partnership", "community interest company", "industrial and provident society",
               "private limited company by guarantee", "private limited company by shares")

_SWITCH_PHRASES = {
    "charity register": "charity_register", "charities register": "charity_register", "on the charity register": "charity_register",
    "charity commission register": "charity_register", "charities on the register": "charity_register",
    "active companies only": "status_only", "active only": "status_only", "active companies": "status_only", "status active": "status_only",
    "companies house only": "ch_number_only", "companies house companies only": "ch_number_only", "registered companies only": "ch_number_only",
    "companies house companies": "ch_number_only",
}
_SIC = re.compile(r"\d{2,5}")
_COMPANY_NO = re.compile(r"[A-Za-z]{0,2}\d{6,8}")
_POSTCODE = re.compile(r"[A-Z]{1,2}\d[A-Z\d]?(?: \d[A-Z]{0,2})?")
_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9 &'.\-*]*")
_KEEP = re.compile(r"^keep\s*:\s*(.+)$", re.I)


def _squash(text_: Any) -> str:
    return re.sub(r"\s+", " ", str(text_ or "")).strip()


def _alnum(text_: str) -> int:
    return len(re.sub(r"[^0-9A-Za-z]", "", text_))


def clean_value(kind: str, value: Any, mode: str = "exclude") -> str:
    """The stored form of a rule's value; raises ValueError with a sentence the admin can read."""
    if kind not in KINDS:
        raise ValueError("That kind of rule is not known.")
    if mode not in ("exclude", "keep"):
        raise ValueError("A rule either leaves out or keeps.")
    if mode == "keep" and kind != "name_word":
        raise ValueError("Only a word in the name can be a keep rule.")
    v = _squash(value)
    if kind in SWITCHES:
        return ""
    if not v:
        raise ValueError("Type a value for the rule.")
    if len(v) > MAX_VALUE:
        raise ValueError(f"Keep it under {MAX_VALUE} characters: {v[:30]}...")
    if kind == "sic":
        if not _SIC.fullmatch(v):
            raise ValueError(f"A SIC code is 2 to 5 digits: {v}")
        return v
    if kind == "company_type":
        return v.lower()
    if kind == "postcode":
        v = v.upper()
        if not _POSTCODE.fullmatch(v):
            raise ValueError(f"Use a postcode district such as BN9 or SW1A: {v}")
        return v
    if kind == "company_number":
        from app.services import tenant_policy as TP

        n = TP.normalize_company_number(v)
        if not n:
            raise ValueError(f"A company number has 8 characters, such as 01234567 or SC123456: {v}")
        return n
    if kind == "category":
        from app.services import exclusion_categories as XC

        if XC.key(v) not in XC.CATEGORIES:
            raise ValueError(f"That is not a known category: {v}")
        return v
    if not _WORD.fullmatch(v) or _alnum(v) < 2:  # name_word
        raise ValueError(f"Use letters and numbers, at least two: {v}")
    return v.lower()


def parse_items(items: Iterable[Any]) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    """What an admin typed or pasted -> ([{kind, value, mode}], [{item, reason}]). Each item is sorted by what it looks like:
    "charity register", "active companies only" and "companies house only" are the switches; a register company type, a known category,
    a number of 2 to 5 digits (SIC), a company number, a postcode district, else a word in the name. "keep: driving school" is a keep rule."""
    from app.services import exclusion_categories as XC

    rules: List[Dict[str, str]] = []
    rejected: List[Dict[str, str]] = []
    seen = set()
    for raw in items:
        t = _squash(raw)
        if not t:
            continue
        mode, body = "exclude", t
        m = _KEEP.match(t)
        if m:
            mode, body = "keep", _squash(m.group(1))
        low = body.lower()
        kind = None
        if mode == "keep":
            kind = "name_word"
        elif low in _SWITCH_PHRASES:
            kind = _SWITCH_PHRASES[low]
        elif low in KNOWN_TYPES:
            kind = "company_type"
        elif XC.key(body) in XC.CATEGORIES:
            kind = "category"
        elif _SIC.fullmatch(body):
            kind = "sic"
        elif _COMPANY_NO.fullmatch(body.replace(" ", "")):
            kind = "company_number"
        elif _POSTCODE.fullmatch(body.upper()):
            kind = "postcode"
        else:
            kind = "name_word"
        try:
            value = clean_value(kind, body, mode)
        except ValueError as err:
            rejected.append({"item": t[:MAX_VALUE], "reason": str(err)})
            continue
        key = (kind, value, mode)
        if key not in seen:
            seen.add(key)
            rules.append({"kind": kind, "value": value, "mode": mode})
    return rules, rejected


def meaning(kind: str, value: str, mode: str = "exclude") -> str:
    """One plain sentence for a rule row."""
    if kind == "sic":
        return f"Leaves out companies with a SIC code starting {value}" if len(value) < 5 else f"Leaves out companies with SIC code {value}"
    if kind == "company_type":
        return f"Leaves out the company type: {value}"
    if kind == "name_word" and mode == "keep":
        return f'Keeps names with "{value}", even when a word above matches'
    if kind == "name_word":
        return f'Leaves out names with "{value[:-1]}" and any ending' if value.endswith("*") else f'Leaves out names with the word "{value}"'
    if kind == "category":
        return f'Leaves out the category "{value}"'
    if kind == "postcode":
        return f"Leaves out the postcode district {value}"
    if kind == "company_number":
        return f"Leaves out company {value}"
    if kind == "charity_register":
        return "Leaves out everything on the Charity Commission register"
    if kind == "status_only":
        return "Keeps only companies whose status is Active"
    if kind == "ch_number_only":
        return "Keeps only Companies House companies (an 8-character company number)"
    return ""


def signature(rules: List[Dict[str, Any]]) -> str:
    """A short digest of the enabled rules, so a cache key changes when any rule does, on every server."""
    basis = sorted((r["kind"], r["value"], r["mode"]) for r in rules)
    return hashlib.sha1(json.dumps(basis).encode()).hexdigest()[:12]


def _fragment(word: str) -> str:
    """A Postgres regex piece for one name word: escaped, spaces literal, a trailing * meaning any letters."""
    return re.escape(_squash(word).lower()).replace(r"\*", "[a-z]*")


def conditions(rules: List[Dict[str, Any]]) -> list:
    """The SQL that leaves out what the enabled rules say. [] for no rules. Every value is escaped; many rules become a few regexes."""
    from app.services import business_records as BR

    B = BusinessRecord
    if not rules:
        return []
    ex = [r for r in rules if r["mode"] == "exclude"]
    keeps = [r["value"] for r in rules if r["mode"] == "keep"]
    of = lambda *kinds: [r["value"] for r in ex if r["kind"] in kinds]  # noqa: E731
    conds: list = []
    if any(r["kind"] == "status_only" for r in ex):
        conds.append(func.btrim(B.status) == STATUS)
    if any(r["kind"] == "ch_number_only" for r in ex):
        conds.append(func.coalesce(B.registration_number, "").op("~")(CH_NUMBER))
    types = of("company_type")
    if types:
        conds.append(~func.lower(func.btrim(func.coalesce(B.company_category, ""))).in_(types))
    if any(r["kind"] == "charity_register" for r in ex):
        conds.append(~func.coalesce(cast(B.sources, String), "").like('%"ds_charity_commission"%'))  # a record with no sources is not on the register
    keep_rx = "(" + "|".join(_fragment(w) for w in keeps) + ")" if keeps else None
    words = of("name_word")
    if words:
        rx = r"\m(" + "|".join(_fragment(w) for w in words) + r")\M"
        conds.append(or_(~B.name.op("~*")(rx), B.name.op("~*")(keep_rx)) if keep_rx else ~B.name.op("~*")(rx))
    typed = of("sic", "postcode", "company_number", "category")
    if typed:
        conds += BR._exclusion_items(typed, keep_rx=keep_rx)
    return conds


async def count_where(db, where, seconds: int = 8) -> Optional[int]:
    """How many companies match, or None when it takes longer than `seconds`. Not remembered anywhere (a preview of unsaved rules)."""
    from sqlalchemy import select, text

    try:
        async with db.begin_nested():
            if db.get_bind().dialect.name == "postgresql":
                await db.execute(text(f"SET LOCAL statement_timeout = '{int(seconds)}s'"))
            return int((await db.execute(select(func.count()).select_from(BusinessRecord).where(where))).scalar() or 0)
    except Exception as err:
        if "statement timeout" in str(err).lower():
            return None
        raise


async def excluded_record_ids(db, record_ids: List[str]) -> set:
    """Which of these company records the organisation's enabled rules leave out. Used where a saved company is already in hand (an export, a
    journey step), so a rule applies there as it does in a search. A record a rule cannot judge (a missing name or status the rule needs) counts as
    left out, exactly as in a search. Empty when the organisation has no rules."""
    from sqlalchemy import and_, select

    from app.services import tenant_policy as TP

    ids = [i for i in dict.fromkeys(record_ids or []) if i]
    if not ids:
        return set()
    rules = (await TP.org_effective(db)).org_rules
    conds = conditions(rules) if rules else []
    if not conds:
        return set()
    out: set = set()
    for i in range(0, len(ids), 5000):
        chunk = ids[i:i + 5000]
        rows = await db.execute(select(BusinessRecord.id).where(BusinessRecord.id.in_(chunk), ~func.coalesce(and_(*conds), False)))
        out.update(r[0] for r in rows.all())
    return out
