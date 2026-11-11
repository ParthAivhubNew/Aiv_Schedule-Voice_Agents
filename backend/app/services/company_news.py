"""One recent news line for a company worth a call: the best-fitting companies only, one web search a week at most.

The line is a headline and its source link as the search returned them, never rewritten. It is kept on the record for
CACHE_DAYS, so opening the same company again costs nothing.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

logger = logging.getLogger("company_news")

MIN_FIT = 70
CACHE_DAYS = 7
WINDOW_DAYS = 30


def _fresh(cached: Optional[Dict[str, Any]], now: datetime) -> bool:
    try:
        return bool(cached) and now - datetime.fromisoformat(str(cached["at"]).rstrip("Z")) < timedelta(days=CACHE_DAYS)
    except (KeyError, ValueError):
        return False


def _about(biz: Any, row: Dict[str, Any]) -> bool:
    """The result names the company: its main words all appear in the headline or text."""
    words = [w for w in re.findall(r"[a-z0-9]+", str(biz.name or "").lower()) if w not in {"ltd", "limited", "llp", "plc", "the", "and", "uk", "group"}]
    blob = f"{row.get('title') or ''} {row.get('snippet') or ''}".lower()
    return bool(words) and all(w in blob for w in words[:3])


async def news_for(db: Any, biz: Any, fit_score: Optional[int], now: Optional[datetime] = None) -> Dict[str, Any]:
    """{skipped: "low_fit"} below MIN_FIT, else {headline, url, source, at, cached}; headline is "" when nothing recent names the company."""
    now = now or datetime.utcnow()
    if fit_score is None or fit_score < MIN_FIT:
        return {"skipped": "low_fit"}
    cached = (biz.raw_data or {}).get("news")
    if _fresh(cached, now):
        return {**cached, "cached": True}
    from urllib.parse import urlparse

    from app.services import enrichment_service as ES

    place = (biz.region or "").strip()
    rows = await ES.search_tavily(f'"{biz.name}" {place}'.strip(), max_results=5, days=WINDOW_DAYS)
    hit = next((r for r in rows if _about(biz, r)), None)
    news = {"headline": (hit or {}).get("title", "")[:200], "url": (hit or {}).get("url", ""),
            "source": urlparse((hit or {}).get("url", "")).netloc.removeprefix("www.") if hit else "", "at": now.isoformat() + "Z"}
    raw = dict(biz.raw_data or {})
    raw["news"] = news
    biz.raw_data = raw
    await db.flush()
    return {**news, "cached": False}
