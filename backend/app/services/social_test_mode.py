"""Test mode: the whole Social flow (approval, scheduling, publishing, alerts, results screens) with nothing
sent to any network. Kept in the company's scheduler settings. A post published in test mode is marked
as a test everywhere it shows, and its numbers are never read or counted.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy.future import select

from app.models.models import SchedulerSetting
from app.services.social_publisher import TEST_OUTCOMES

OUTCOMES = ("ok",) + tuple(TEST_OUTCOMES)


async def get(db) -> Dict[str, Any]:
    row = (await db.execute(select(SchedulerSetting).where(SchedulerSetting.id == "default"))).scalars().first()
    cur = ((row.data or {}).get("testMode") if row and isinstance(row.data, dict) else None) or {}
    return {"on": bool(cur.get("on")), "outcome": cur.get("outcome") if cur.get("outcome") in OUTCOMES else "ok"}


async def active(db) -> Optional[Dict[str, Any]]:
    """The test settings when test mode is on, else None (publish for real)."""
    cur = await get(db)
    return cur if cur["on"] else None


async def put(db, on: Optional[bool] = None, outcome: Optional[str] = None) -> Dict[str, Any]:
    if outcome is not None and outcome not in OUTCOMES:
        raise ValueError("Pick what the test should do: post, a login problem, a busy network or a refused post.")
    row = (await db.execute(select(SchedulerSetting).where(SchedulerSetting.id == "default"))).scalars().first()
    if not row:
        row = SchedulerSetting(id="default", data={})
        db.add(row)
    data = dict(row.data or {})
    cur = dict(data.get("testMode") or {})
    if on is not None:
        cur["on"] = bool(on)
    if outcome is not None:
        cur["outcome"] = outcome
    data["testMode"] = cur
    row.data = data
    await db.commit()
    return await get(db)
