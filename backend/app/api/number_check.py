"""Check an imported list of phone numbers (real? what kind? whose?). Free checks first, then
the carrier lookup for what is left, charged 1 credit per 5 numbers that got an answer."""
from __future__ import annotations

import logging
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.brand import scrub
from app.database import get_db
from app.services import credits as K
from app.services import number_check as NC

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/number-check", tags=["Number check"])


class Item(BaseModel):
    key: str = ""
    phone: str = ""
    names: List[str] = []


class CheckBody(BaseModel):
    items: List[Item]


async def _prepared(db: AsyncSession, body: CheckBody):
    if len(body.items) > 20000:
        raise HTTPException(status_code=400, detail="That list is too long to check in one go.")
    rows = NC.prepare([i.dict() for i in body.items], await NC.do_not_call_numbers(db))
    todo = NC.plan(rows, await NC.cached_answers(db, [r["phone"] for r in rows if not r["status"]]))
    return rows, todo


@router.post("/estimate")
async def estimate(body: CheckBody, db: AsyncSession = Depends(get_db)):
    """What a check would do, before anything is spent: every free answer already filled in,
    the numbers that still need a lookup, and what they would cost."""
    rows, todo = await _prepared(db, body)
    rate = (await K.rates(db)).get("number_check", {}).get("credits", 1)
    enforce = (await K.org_settings(db))["enforce"]
    return {
        "rows": [NC.public(r) for r in rows],
        "to_check": [r["key"] for r in todo],
        "credits": NC.credits_for(len(todo), rate),
        "balance": await K.wallet_balance(db, K.wallet_of("number_check")),
        "enforced": bool(enforce),
        "per_credit": NC.PER_CREDIT,
    }


@router.post("/run")
async def run(body: CheckBody, db: AsyncSession = Depends(get_db)):
    """Look these numbers up and return one answer per row. Numbers that cannot be checked right
    now come back as couldnt_check and are not charged."""
    rows, todo = await _prepared(db, body)
    if len(todo) > NC.MAX_PER_RUN:
        raise HTTPException(status_code=400, detail=f"Check up to {NC.MAX_PER_RUN} numbers at a time.")
    charged = 0
    if todo:
        ok, why = await K.can_start(db, "number_check", len(todo) / NC.PER_CREDIT)
        if not ok:
            raise HTTPException(status_code=402, detail=scrub(why) or "Not enough credits to check these numbers.")
        answered = await NC.look_up(todo)
        try:
            await NC.remember(db, todo)
            if answered:
                charged = await K.charge(db, "number_check", answered / NC.PER_CREDIT, f"numcheck:{uuid.uuid4().hex[:16]}",
                                         f"Number check: {answered} numbers")
            await db.commit()
        except Exception as err:  # the answers still go back; a failed save must not hide them
            logger.warning(f"[number-check] could not save or charge: {scrub(str(err))}")
            await db.rollback()
            charged = 0
    return {"rows": [NC.public(r) for r in rows], "summary": NC.summary(rows), "credits_charged": charged}
