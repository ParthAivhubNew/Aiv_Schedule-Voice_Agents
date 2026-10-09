"""Checking an imported list of phone numbers: is each one real, what kind is it, who is it
registered to. Free checks run first (format, repeats, do-not-call, answers we already have);
only the rest go to the carrier lookup, which costs credits (1 per 5 numbers answered)."""
from __future__ import annotations

import asyncio
import math
import re
import uuid
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

from sqlalchemy.future import select

from app.core.brand import scrub

CACHE_DAYS = 30
MAX_PER_RUN = 1000
PARALLEL = 8
PER_CREDIT = 5  # numbers per credit, as priced on the rate card

E164 = re.compile(r"^\+[1-9]\d{7,14}$")

# What the carrier calls a line -> our word for it, and whether such a line is a normal one.
_LINE_TYPES = [
    ("toll", "toll_free"), ("premium", "other"), ("shared", "other"), ("personal", "other"),
    ("pager", "other"), ("uan", "other"), ("voicemail", "other"), ("voip", "voip"),
    ("fixed", "landline"), ("landline", "landline"), ("mobile", "mobile"),
]
NORMAL_LINES = {"mobile", "landline"}

_LEGAL_WORDS = {"inc", "incorporated", "ltd", "limited", "llc", "llp", "plc", "corp", "corporation", "co",
                "company", "gmbh", "pvt", "private", "pty", "sa", "ag", "the", "and"}


def line_type_of(raw: Any) -> str:
    text = str(raw or "").lower()
    for needle, label in _LINE_TYPES:
        if needle in text:
            return label  # "fixed line or mobile" counts as a normal line either way
    return "other"


def classify(data: Dict[str, Any]) -> Dict[str, str]:
    """A carrier lookup answer in plain terms: status good / check, plus type, carrier,
    country and the name the network has on file."""
    carrier = data.get("carrier") or {}
    caller = data.get("caller_name") or {}
    kind = line_type_of(carrier.get("type"))
    name = str(carrier.get("normalized_carrier") or carrier.get("name") or "").strip()
    found = str(caller.get("caller_name") or "").strip()
    if caller.get("error_code"):
        found = ""
    known = bool(name) and kind in NORMAL_LINES
    return {"status": "good" if known else "check", "line_type": kind, "carrier": name,
            "country": str(data.get("country_code") or "").strip(), "found_name": found}


def _tokens(name: str) -> List[str]:
    words = re.sub(r"[^a-z0-9 ]+", " ", (name or "").lower()).split()
    return [w for w in words if w not in _LEGAL_WORDS]


def name_match(given: List[str], found: str) -> str:
    """How well the name on the list fits the name the network has: match / partial / differs,
    or none when either side has no name. A hint, never a verdict."""
    mine = [t for t in (_tokens(g) for g in given) if t]
    theirs = _tokens(found)
    if not mine or not theirs:
        return "none"
    best = "differs"
    for tokens in mine:
        a, b = " ".join(sorted(tokens)), " ".join(sorted(theirs))
        small, big = (set(tokens), set(theirs)) if len(tokens) <= len(theirs) else (set(theirs), set(tokens))
        if small <= big or SequenceMatcher(None, a, b).ratio() >= 0.85:
            return "match"
        if small & big or SequenceMatcher(None, a, b).ratio() >= 0.6:
            best = "partial"
    return best


def prepare(items: List[Dict[str, Any]], dnc: set) -> List[Dict[str, Any]]:
    """Free checks for each row: its number cleaned up, and whether it is already ruled out
    (bad format, repeat of an earlier row, on the do-not-call list)."""
    from app.services.numbers import normalize

    seen = set()
    out = []
    for it in items:
        phone = normalize(str(it.get("phone") or ""))
        row = {"key": str(it.get("key") or ""), "phone": phone, "names": [str(n) for n in (it.get("names") or []) if n],
               "status": "", "line_type": "", "carrier": "", "country": "", "found_name": "", "match": "none",
               "checked_on": "", "cached": False}
        if not phone or not E164.match(phone):
            row["status"] = "bad_format"
        elif phone in seen:
            row["status"] = "duplicate"
        elif phone in dnc:
            row["status"] = "do_not_call"
        if not row["status"]:
            seen.add(phone)
        out.append(row)
    return out


async def do_not_call_numbers(db) -> set:
    from app.models.models import ContactRegistry
    from app.services.numbers import normalize

    rows = (await db.execute(select(ContactRegistry).where(ContactRegistry.do_not_call.is_(True)))).scalars().all()
    return {normalize(p if isinstance(p, str) else (p or {}).get("number", "")) for r in rows for p in (r.phones or [])} - {""}


async def cached_answers(db, phones: List[str]) -> Dict[str, Any]:
    from app.models.models import NumberCheck

    if not phones:
        return {}
    since = datetime.utcnow() - timedelta(days=CACHE_DAYS)
    rows = (await db.execute(select(NumberCheck).where(NumberCheck.phone.in_(phones), NumberCheck.checked_at >= since)
                             .order_by(NumberCheck.checked_at))).scalars().all()
    return {r.phone: r for r in rows}  # newest wins


def _apply(row: Dict[str, Any], status: str, line_type: str, carrier: str, country: str, found: str,
           checked_at: datetime, cached: bool) -> None:
    row.update(status=status, line_type=line_type, carrier=carrier, country=country, found_name=found,
               match=name_match(row["names"], found), checked_on=checked_at.date().isoformat(), cached=cached)


def plan(rows: List[Dict[str, Any]], cache: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fill rows we can answer without paying; returns the rows still to look up."""
    todo = []
    for row in rows:
        if row["status"]:
            continue
        hit = cache.get(row["phone"])
        if hit:
            _apply(row, hit.status, hit.line_type or "", hit.carrier or "", hit.country or "", hit.found_name or "",
                   hit.checked_at, True)
        else:
            todo.append(row)
    return todo


def credits_for(count: int, per_unit: int = 1) -> int:
    return int(math.ceil(count / PER_CREDIT * per_unit)) if count > 0 else 0


async def _lookup_one(client, row: Dict[str, Any], gate: asyncio.Semaphore) -> Optional[Dict[str, str]]:
    """The carrier's answer for one number; None when it could not be checked right now."""
    from app.services.telnyx_client import TelnyxError

    async with gate:
        for attempt in range(2):
            try:
                return {**classify(await client.lookup_number(row["phone"])), "answered": "1"}
            except TelnyxError as err:
                if err.status in (404, 422):  # the network does not know the number
                    return {"status": "not_working", "line_type": "", "carrier": "", "country": "", "found_name": "",
                            "answered": "1"}
                if err.status == 429 and attempt == 0:
                    await asyncio.sleep(1.5)
                    continue
                return None
            except Exception:
                return None
    return None


async def look_up(rows: List[Dict[str, Any]], client=None) -> int:
    """Ask the carrier about each row (a few at a time). Rows that get no answer are marked
    couldnt_check and never charged. Returns how many got a real answer."""
    from app.services.telnyx_client import TelnyxClient, platform_key

    if not rows:
        return 0
    if client is None:
        key = platform_key()
        if not key:
            for row in rows:
                row["status"] = "couldnt_check"
            return 0
        client = TelnyxClient(key)
    gate = asyncio.Semaphore(PARALLEL)
    answers = await asyncio.gather(*[_lookup_one(client, r, gate) for r in rows])
    now = datetime.utcnow()
    answered = 0
    for row, ans in zip(rows, answers):
        if not ans:
            row["status"] = "couldnt_check"
            continue
        answered += 1
        _apply(row, ans["status"], ans["line_type"], ans["carrier"], ans["country"], ans["found_name"], now, False)
    return answered


async def remember(db, rows: List[Dict[str, Any]]) -> None:
    """Keep the answers we paid for so the same number is free next time."""
    from app.models.models import NumberCheck

    now = datetime.utcnow()
    for row in rows:
        if row["status"] in ("good", "check", "not_working") and not row["cached"]:
            db.add(NumberCheck(id=f"nc_{uuid.uuid4().hex[:14]}", phone=row["phone"], status=row["status"],
                               line_type=row["line_type"], carrier=row["carrier"][:120], country=row["country"][:8],
                               found_name=row["found_name"][:200], checked_at=now))


def public(row: Dict[str, Any]) -> Dict[str, Any]:
    return {k: row[k] for k in ("key", "phone", "status", "line_type", "carrier", "country", "found_name", "match",
                                "checked_on", "cached")}


def summary(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in rows:
        out[r["status"]] = out.get(r["status"], 0) + 1
    return out


def friendly(err: Exception) -> str:
    return scrub(str(err))
