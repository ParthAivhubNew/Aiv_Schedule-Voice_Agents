"""One way to turn the filters a person set into the companies to show, used by the Find Leads screen, the chat assistant,
the partner API and the People tab, so all of them give the same answer for the same filters:

  1. the search on the words exactly as typed;
  2. if that finds nothing, the same search on nearby words (see phrase_understanding.widen_if_empty);
  3. if that still finds nothing, a corrected town spelling and then the least important filters given up one at a time
     (see business_records.closest_match), each change reported so the person is told.

Every row is a stored company. `applied` is the filters that were really run: figures shown beside the list (totals, Full /
Partial / Basic counts, the People tab) must be counted on those, not on what was typed.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import business_records, phrase_understanding


async def resolve(db: AsyncSession, filters: Dict[str, Any], drop_terms: Optional[List[str]],
                  run: Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]], *, relax: bool = True
                  ) -> Tuple[Dict[str, Any], List[Dict[str, Any]], List[str]]:
    """(result, understood, relaxed). `run(filters)` is the search itself and returns a dict with "rows", "total" and "filters"."""
    out, understood = await phrase_understanding.widen_if_empty(db, filters, drop_terms, run)
    relaxed: List[str] = []
    if relax and not out.get("total"):
        reading: List[Dict[str, Any]] = []

        async def widened(f: Dict[str, Any]) -> Dict[str, Any]:
            nonlocal reading
            got, said = await phrase_understanding.widen_if_empty(db, f, drop_terms, run)
            if said:
                reading = said
            return got

        near, relaxed = await business_records.closest_match(filters, widened)
        if near:
            return near, reading or understood, relaxed
        relaxed = []
    return out, understood, relaxed
