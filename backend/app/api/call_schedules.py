"""Call schedules: dial a Call list right now, once, or on a repeating pattern, at one or more times a day.

The same Schedule window idea as Social, for Voice. The work is in services/call_schedule_engine.py.
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import CallList, CallSchedule
from app.services import call_schedule_engine as E
from app.services.org_settings import org_timezone
from app.services.schedule_engine import org_today, parse_date

router = APIRouter(prefix="/call-schedules", tags=["Call schedules"])

MAX_SCHEDULES = 100


class StatusIn(BaseModel):
    status: str


def _who(request: Request) -> str:
    auth = getattr(request.state, "auth", None) or {}
    return str(auth.get("name") or auth.get("email") or "")


async def _get(db: AsyncSession, schedule_id: str) -> CallSchedule:
    hit = (await db.execute(select(CallSchedule).where(CallSchedule.id == schedule_id))).scalars().first()
    if not hit:
        raise HTTPException(status_code=404, detail="That schedule doesn't exist any more.")
    return hit


async def _list_names(db: AsyncSession) -> Dict[str, str]:
    return {l.id: l.name for l in (await db.execute(select(CallList))).scalars().all()}


async def _one(db: AsyncSession, s: CallSchedule, tz: str) -> Dict[str, Any]:
    names = await _list_names(db)
    return E.schedule_dict(s, time.time() * 1000, tz, org_today(tz), names.get(s.list_id, ""))


async def _checked(db: AsyncSession, payload: Dict[str, Any], tz: str, existing: Optional[CallSchedule] = None) -> Dict[str, Any]:
    try:
        fields = E.clean(payload, org_today(tz), existing)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    the_list = (await db.execute(select(CallList).where(CallList.id == fields["list_id"]))).scalars().first()
    if not the_list:
        raise HTTPException(status_code=400, detail="That Call list doesn't exist. Pick another.")
    if not E.prospects_from(the_list.rows or []):
        raise HTTPException(status_code=400, detail=f"“{the_list.name}” has no phone numbers to dial yet.")
    return fields


@router.get("")
async def all_schedules(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    tz = await org_timezone(db)
    now_ms, today = time.time() * 1000, org_today(tz)
    names = await _list_names(db)
    rows = (await db.execute(select(CallSchedule).order_by(CallSchedule.created_at.desc()))).scalars().all()
    return {"timezone": tz, "today": today.isoformat(),
            "schedules": [E.schedule_dict(s, now_ms, tz, today, names.get(s.list_id, "")) for s in rows]}


@router.get("/slots")
async def slots(start: str, end: str, db: AsyncSession = Depends(get_db)) -> List[Dict[str, Any]]:
    """Every call time of the schedules that are not finished, between two dates, for the calendar."""
    first, last = parse_date(start), parse_date(end)
    if not first or not last or last < first or (last - first).days > 62:
        raise HTTPException(status_code=400, detail="Give a start and end date, at most two months apart.")
    rows = (await db.execute(select(CallSchedule).where(CallSchedule.status != "ended"))).scalars().all()
    return [{"date": d.isoformat(), "time": t, "id": s.id, "name": s.name, "status": s.status,
             "done": f"{d.isoformat()} {t}" in (s.fired or [])}
            for s in rows for d, t in E.slots_between(s, first, last)]


@router.post("/preview")
async def preview(body: Dict[str, Any], db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """The call times a schedule would have, so the window can list them before it is saved."""
    tz = await org_timezone(db)
    try:
        fields = E.clean(body or {}, org_today(tz))
    except ValueError as err:
        return {"ok": False, "message": str(err), "slots": [], "count": 0}
    if fields["frequency"] == "now":
        return {"ok": True, "message": "", "slots": ["right now"], "count": 1}
    draft = CallSchedule(**fields, status="active", fired=[])
    found = E.upcoming(draft, time.time() * 1000, tz, org_today(tz), limit=60)
    return {"ok": True, "message": "", "slots": found[:12], "count": len(found)}


@router.post("")
async def create(body: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    tz = await org_timezone(db)
    if len((await db.execute(select(CallSchedule.id))).all()) >= MAX_SCHEDULES:
        raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_SCHEDULES} schedules. Delete one you no longer use.")
    fields = await _checked(db, body or {}, tz)
    s = CallSchedule(id=f"cs_{uuid.uuid4().hex[:10]}", created_by=_who(request), status="active", fired=[], runs=[], **fields)
    db.add(s)
    await db.commit()
    message = "Schedule saved."
    if s.frequency == "now":
        result = await E.execute(db, s.id, f"{org_today(tz).isoformat()} now", tz)
        if not result.get("ok"):
            await db.delete(await _get(db, s.id))
            await db.commit()
            raise HTTPException(status_code=400, detail=result.get("message") or "The calls could not start.")
        s = await _get(db, s.id)
        s.status, s.ended_reason = "ended", "Dialled right now."
        await db.commit()
        message = result.get("message") or "Calling has started."
    return {"message": message, "schedule": await _one(db, await _get(db, s.id), tz)}


@router.put("/{schedule_id}")
async def change(schedule_id: str, body: Dict[str, Any], db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    tz = await org_timezone(db)
    s = await _get(db, schedule_id)
    if s.frequency == "now":
        raise HTTPException(status_code=400, detail="A run that already happened can't be edited. Make a new schedule.")
    fields = await _checked(db, body or {}, tz, s)
    if fields["frequency"] == "now":
        raise HTTPException(status_code=400, detail="To dial right now, make a new schedule with Right now.")
    for k, v in fields.items():
        setattr(s, k, v)
    if s.status == "ended":
        s.status, s.ended_reason = "active", None
    # Times that moved may run again today; past days are kept so nothing already dialled is dialled twice.
    s.fired = [k for k in (s.fired or []) if k < org_today(tz).isoformat()]
    await db.commit()
    return {"message": "Saved.", "schedule": await _one(db, s, tz)}


@router.post("/{schedule_id}/status")
async def set_status(schedule_id: str, body: StatusIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    if body.status not in ("active", "paused"):
        raise HTTPException(status_code=400, detail="Status must be active or paused.")
    s = await _get(db, schedule_id)
    if s.status == "ended":
        raise HTTPException(status_code=400, detail="This schedule has finished. Edit it to run again, or make a new one.")
    s.status = body.status
    await db.commit()
    return {"message": "Resumed." if body.status == "active" else "Paused. Nothing is dialled until you resume it."}


@router.delete("/{schedule_id}")
async def remove(schedule_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    await db.delete(await _get(db, schedule_id))
    await db.commit()
    return {"message": "Schedule deleted."}
