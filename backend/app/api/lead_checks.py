"""Check companies: validate a saved list against our records, the company registers and the web.

Start it from Saved Accounts with some rows ticked, or with Select all. The cost is shown first
(the most it could be); the run goes on in the background and the page follows its progress.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import LeadAccount
from app.services import company_check_job as job

router = APIRouter(prefix="/leads/checks", tags=["Leads"])

MAX_COMPANIES = 5000


class CheckIn(BaseModel):
    ids: List[str] = []
    all: bool = False  # every saved company (Select all), whatever page it is on
    pending_only: bool = False  # only companies whose register check is still pending
    include_email: bool = False
    include_web: bool = False  # also run the live web search for companies not researched yet
    include_phone: bool = True  # ask the phone network whether each number is real (1 credit per 5 numbers)


async def _accounts(db: AsyncSession, body: CheckIn) -> List[LeadAccount]:
    if not body.all and not body.ids:
        raise HTTPException(status_code=400, detail="Pick at least one company to check.")
    q = select(LeadAccount).order_by(LeadAccount.created_at.desc())
    if not body.all:
        q = q.where(LeadAccount.id.in_(body.ids))
    rows = list((await db.execute(q)).scalars().all())
    if body.pending_only:
        rows = [a for a in rows if (a.verification or {}).get("pending_registry")]
    if len(rows) > MAX_COMPANIES:
        raise HTTPException(status_code=400, detail=f"Check at most {MAX_COMPANIES} companies at a time.")
    return rows


@router.post("/estimate")
async def estimate(body: CheckIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """What a check would cost at most, and which checks can run right now. Charges nothing."""
    return await job.estimate(db, await _accounts(db, body), body.include_email, body.include_web, body.include_phone)


@router.post("")
async def start_check(body: CheckIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    started = await job.start(db, await _accounts(db, body), body.include_email, body.include_web, body.include_phone)
    if started.get("error"):
        raise HTTPException(status_code=402 if "credits" in started["error"].lower() else 409, detail=started["error"])
    return started


@router.post("/account/{account_id}")
async def check_one(account_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Check one company and wait for the answer: its register status, website, email and phone (each number is
    asked of the phone network). Used by Improve this company, so one button leaves the company fully checked."""
    import asyncio

    from app.api.lead_accounts import _out, _registry_for

    row = (await db.execute(select(LeadAccount).where(LeadAccount.id == account_id))).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="That account is not in your saved accounts.")
    started = await job.start(db, [row], True, False, True)
    if started.get("error"):
        raise HTTPException(status_code=402 if "credits" in started["error"].lower() else 409, detail=started["error"])
    task = job._TASKS.get(started["job"]["job_id"])
    if task:
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=90)
        except asyncio.TimeoutError:
            pass  # still running: the list picks up the result when it lands
    await db.refresh(row)
    return _out(row, await _registry_for(db, account_id))


class AcceptIn(BaseModel):
    ids: List[str]
    fields: List[str] = []  # empty = every open fix


@router.post("/fixes/accept")
async def accept_fixes(body: AcceptIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Apply the fixes a check suggested, for one company or many (Accept all fixes on a list)."""
    from app.services import check_fixes

    if not body.ids:
        raise HTTPException(status_code=400, detail="Pick at least one company.")
    rows = (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(body.ids[:MAX_COMPANIES])))).scalars().all()
    applied = sum(check_fixes.accept(a, body.fields) for a in rows)
    await db.commit()
    return {"applied": applied}


@router.get("/latest")
async def latest() -> Dict[str, Any]:
    found = await job.latest_job() or None
    return {"job": found, "locked_ids": sorted(await job.locked_ids()) if found and found.get("status") == "running" else []}


@router.get("/{job_id}")
async def progress(job_id: str) -> Dict[str, Any]:
    doc = await job.get_job(job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="That check isn't in your history.")
    return {"job": doc}


@router.post("/{job_id}/pause")
async def pause(job_id: str) -> Dict[str, Any]:
    doc = await job.set_paused(job_id, True)
    if not doc:
        raise HTTPException(status_code=404, detail="That check isn't in your history.")
    return {"job": doc}


@router.post("/{job_id}/resume")
async def resume(job_id: str) -> Dict[str, Any]:
    doc = await job.set_paused(job_id, False)
    if not doc:
        raise HTTPException(status_code=404, detail="That check isn't in your history.")
    return {"job": doc}


@router.post("/{job_id}/cancel")
async def cancel(job_id: str) -> Dict[str, Any]:
    doc = await job.request_cancel(job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="That check isn't in your history.")
    return {"job": doc}
