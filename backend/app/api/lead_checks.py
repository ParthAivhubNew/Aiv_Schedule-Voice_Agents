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
    return await job.estimate(db, await _accounts(db, body), body.include_email)


@router.post("")
async def start_check(body: CheckIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    started = await job.start(db, await _accounts(db, body), body.include_email)
    if started.get("error"):
        raise HTTPException(status_code=402 if "credits" in started["error"].lower() else 409, detail=started["error"])
    return started


@router.get("/latest")
async def latest() -> Dict[str, Any]:
    return {"job": await job.latest_job() or None}


@router.get("/{job_id}")
async def progress(job_id: str) -> Dict[str, Any]:
    doc = await job.get_job(job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="That check isn't in your history.")
    return {"job": doc}


@router.post("/{job_id}/cancel")
async def cancel(job_id: str) -> Dict[str, Any]:
    doc = await job.request_cancel(job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="That check isn't in your history.")
    return {"job": doc}
