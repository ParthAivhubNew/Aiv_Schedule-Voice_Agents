"""Find Leads: understand what a user typed, so "dentists" also finds dental practices.

The panel's box matches the words as typed, and that comes first: only when the typed words find
nothing are they turned (by the AI, once per phrase) into the nearest words that appear in the
official business descriptions we hold, and the search run again on those too (see widen_if_empty). The AI only suggests search words: it never sees company data and
never writes any. Every answer is cleaned, kept for the next time the same phrase is typed (so the
same words always give the same results), and can be corrected by staff. If the AI can't be
reached the search simply uses the typed words, as before.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import business_records, llm_gateway

logger = logging.getLogger("phrase_understanding")

MAX_TERMS = 8
MAX_PHRASES = 6  # typed items understood per search
MAX_TOTAL = 40  # words in the final search
ASK_SECONDS = 8.0  # the most a whole search will wait on the AI for its suggestions; after that the typed words are used
_KEY = "phrase_terms:"
# Words so general that searching for them would return half the register.
_TOO_GENERAL = {"business", "businesses", "service", "services", "company", "companies", "activity", "activities", "other",
                "general", "retail", "trade", "wholesale", "limited", "ltd", "uk", "the", "and", "management", "support"}
_WORD = re.compile(r"^[a-z0-9][a-z0-9 &'\-]{1,38}$")

_SCHEMA = {
    "type": "object",
    "properties": {"terms": {"type": "array", "items": {"type": "string"}, "maxItems": 10}},
    "required": ["terms"],
}
_SYSTEM = (
    "You help search a UK register of businesses, where each company has an official industry (SIC) description and "
    "a business type. Given a short phrase describing the kind of business someone wants, return up to 8 lower-case, "
    "singular words or short phrases likely to appear in the official description or type of such businesses, "
    "including close synonyms and the usual official wording (for example 'dentist' -> ['dental', 'dental practice', "
    "'orthodontic']). Do not return place names, generic words like 'services' or 'business', or anything unrelated. "
    "If the phrase is a company or brand name, a person, or you are unsure what it means, return an empty list."
)


def _phrase_key(phrase: str) -> str:
    return _KEY + hashlib.sha1(phrase.encode("utf-8")).hexdigest()[:20]


def normalise_phrase(phrase: Any) -> str:
    return re.sub(r"\s+", " ", str(phrase or "").strip().lower())[:60]


def clean_terms(raw: Any, phrase: str = "") -> List[str]:
    """Only short plain words come through: nothing the model returns can carry anything else into a query."""
    out: List[str] = []
    for item in raw if isinstance(raw, list) else []:
        t = re.sub(r"\s+", " ", str(item or "").strip().lower())
        if not _WORD.match(t) or t in _TOO_GENERAL or t == phrase or t in out:
            continue
        if all(w in _TOO_GENERAL for w in t.split()):
            continue
        out.append(t)
    return out[:MAX_TERMS]


async def _stored(db: AsyncSession, phrase: str) -> Optional[Dict[str, Any]]:
    from sqlalchemy import select

    from app.models.models import AppSetting

    row = (await db.execute(select(AppSetting).where(AppSetting.id == _phrase_key(phrase)))).scalars().first()
    return dict(row.data or {}) if row else None


async def _remember(db: AsyncSession, phrase: str, terms: List[str]) -> None:
    from app.models.models import AppSetting

    key = _phrase_key(phrase)
    db.add(AppSetting(id=key, data={"phrase": phrase, "terms": terms, "at": datetime.utcnow().isoformat(), "edited": False}))
    try:
        await db.commit()
    except Exception:  # another request saved the same phrase a moment ago: theirs stands
        await db.rollback()


async def _ask(phrase: str, scope: str, seconds: float) -> Optional[Dict[str, Any]]:
    """The AI's suggestions, within `seconds`. It runs on its own database session so that giving up
    on a slow answer never leaves the search's own session half-used."""
    from app.database import AsyncSessionLocal

    async def go():
        async with AsyncSessionLocal() as own:
            return await llm_gateway.extract_structured(
                system_prompt=_SYSTEM, user_text=f"Phrase: {phrase}", schema=_SCHEMA, tool_name="suggest_search_words",
                db=own, scope=scope, max_tokens=200)

    return await asyncio.wait_for(go(), timeout=seconds)


async def terms_for(db: AsyncSession, phrase: str, *, scope: str = "leadgen", seconds: float = ASK_SECONDS) -> List[str]:
    """The nearest words for one typed phrase: remembered if seen before, else asked of the AI once
    (for at most `seconds`; a slow or silent AI means the typed word alone is used this time)."""
    phrase = normalise_phrase(phrase)
    if len(phrase) < 3:
        return []
    saved = await _stored(db, phrase)
    if saved is not None:
        return clean_terms(saved.get("terms"), phrase)
    if seconds < 0.5:  # this search has already waited long enough on the AI
        return []
    try:
        data = await _ask(phrase, scope, seconds)
    except asyncio.TimeoutError:
        logger.warning(f"[phrase] the AI took longer than {seconds:.0f}s on '{phrase}'; searching the typed words")
        return []
    except Exception as err:
        logger.warning(f"[phrase] couldn't understand '{phrase}': {err}")
        return []
    if data is None:  # the AI could not be reached: don't remember a non-answer
        return []
    terms = clean_terms((data or {}).get("terms"), phrase)
    await _remember(db, phrase, terms)
    return terms


async def apply(db: AsyncSession, filters: Dict[str, Any], drop_terms: Optional[List[str]] = None, *,
                scope: str = "leadgen") -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """The filters with the typed words widened to their nearest words, and how each was read:
    [{phrase, terms}]. The caller keeps showing the ORIGINAL filters; only the search uses these.
    `drop_terms` are words the user removed from the reading."""
    f = business_records.normalize_filters(filters or {})
    typed = f.get("keyword") or []
    if not typed:
        return f, []
    dropped = {normalise_phrase(t) for t in (drop_terms or [])}
    reading: List[Dict[str, Any]] = []
    words: List[str] = []
    loop = asyncio.get_running_loop()
    deadline = loop.time() + ASK_SECONDS  # one allowance for the whole search, not one per typed word
    for item in typed[:MAX_PHRASES]:
        phrase = normalise_phrase(item)
        if not phrase:
            continue
        words.append(item)
        terms = [t for t in await terms_for(db, phrase, scope=scope, seconds=deadline - loop.time()) if t not in dropped]
        if terms:
            reading.append({"phrase": phrase, "terms": terms})
            words.extend(t for t in terms if t not in words)
    wide = dict(f)
    wide["keyword"] = words[:MAX_TOTAL] if words else typed
    return business_records.normalize_filters(wide), reading


async def widen_if_empty(db: AsyncSession, filters: Dict[str, Any], drop_terms: Optional[List[str]], run, *,
                         scope: str = "leadgen") -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Runs the search on the words exactly as typed. Only if that finds nothing is the AI asked for
    nearby words and the search run once more on those. `run(filters)` is the search itself and
    returns a dict with "total". Returns (result, reading): reading is empty when the typed words
    were enough, which is the usual case and costs no AI call at all."""
    typed = business_records.normalize_filters(filters or {})
    out = await run(typed)
    if out.get("total") or not typed.get("keyword"):
        return out, []
    wide, reading = await apply(db, filters, drop_terms, scope=scope)
    if not reading:
        return out, []
    return await run(wide), reading
