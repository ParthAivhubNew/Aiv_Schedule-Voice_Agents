"""Check phone numbers against the TPS and CTPS registers. Numbers with a result under 28 days old are free and answered from our own record;
the rest are screened and charged to the organisation: 2 credits per 5 numbers that got an answer (the rate card sets the price).

POST /tps-check/estimate   what a check would do and cost, before anything is spent
POST /tps-check/run        screen what needs it, save the answers, charge for the answered numbers
"""
from __future__ import annotations

import logging
import math
import uuid
from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.brand import scrub
from app.database import get_db
from app.services import call_permission as CP
from app.services import credits as K
from app.services.timezone_service import normalize_phone

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tps-check", tags=["TPS check"])

PER_CREDIT = 5  # numbers per rate-card unit
MAX_PER_RUN = 500
UK = "+44"


class CheckBody(BaseModel):
    numbers: List[str] = Field(default_factory=list)
    wallet: str = "voice"  # "voice" or "leadgen": whose credits pay


def _item(wallet: str) -> str:
    return "lead_tps_check" if wallet == "leadgen" else "tps_check"


def credits_for(count: int, rate: float) -> float:
    return math.ceil(count / PER_CREDIT * float(rate) * 100) / 100 if count else 0.0


def _clean(numbers: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in numbers[:5000]:
        n = normalize_phone(raw)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _row(n: str, st: Dict[str, Any]) -> Dict[str, Any]:
    if not n.startswith(UK):
        return {"number": n, "status": "not_uk", "ctps": False, "fresh": False, "checked_at": None, "note": "TPS and CTPS cover UK numbers only."}
    status = st["tps_status"] if st["fresh"] else "unknown"
    return {"number": n, "status": status, "ctps": bool(st["ctps"]) if st["fresh"] else False, "fresh": bool(st["fresh"]),
            "checked_at": st["screened_at"], "note": ""}


async def _plan(db: AsyncSession, numbers: List[str]):
    nums = _clean(numbers)
    rows, todo = [], []
    for n in nums:
        st = await CP.status(db, n)
        row = _row(n, st)
        rows.append(row)
        if n.startswith(UK) and not st["fresh"]:
            todo.append(n)
    return rows, todo


def summary(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    return {"listed": sum(1 for r in rows if r["status"] == "listed"), "ctps": sum(1 for r in rows if r["ctps"]),
            "clear": sum(1 for r in rows if r["status"] == "clear" and not r["ctps"]), "not_uk": sum(1 for r in rows if r["status"] == "not_uk"),
            "couldnt_check": sum(1 for r in rows if r["status"] == "unknown")}


@router.post("/estimate")
async def estimate(body: CheckBody, db: AsyncSession = Depends(get_db)):
    if len(body.numbers) > 5000:
        raise HTTPException(status_code=400, detail="That list is too long to check in one go.")
    item = _item(body.wallet)
    rows, todo = await _plan(db, body.numbers)
    rate = (await K.rates(db)).get(item, {}).get("credits", 2)
    prov = await CP.provider()
    return {"ready": prov.configured(), "rows": rows, "to_check": len(todo), "credits": credits_for(len(todo), rate),
            "balance": await K.wallet_balance(db, K.wallet_of(item)), "enforced": bool((await K.org_settings(db))["enforce"]),
            "max_per_run": MAX_PER_RUN, "summary": summary(rows)}


@router.post("/run")
async def run(body: CheckBody, db: AsyncSession = Depends(get_db)):
    """Screens the numbers that have no fresh result and returns one answer per number. A number that could not be checked comes back as
    "unknown" and is not charged."""
    item = _item(body.wallet)
    rows, todo = await _plan(db, body.numbers)
    if len(todo) > MAX_PER_RUN:
        raise HTTPException(status_code=400, detail=f"Check up to {MAX_PER_RUN} numbers at a time.")
    prov = await CP.provider()
    charged = 0
    note = ""
    if todo:
        if not prov.configured():
            raise HTTPException(status_code=503, detail="TPS and CTPS checking is not switched on yet. Ask your administrator.")
        ok, why = await K.can_start(db, item, len(todo) / PER_CREDIT)
        if not ok:
            raise HTTPException(status_code=402, detail=scrub(why) or "Not enough credits to check these numbers.")
        answers = await prov.screen(todo)
        now = datetime.utcnow()
        try:
            for n, res in answers.items():
                await CP.save_screening(db, n, res.get("tps", "unknown"), bool(res.get("ctps")), prov.name, now)
            if answers:
                charged = await K.charge(db, item, len(answers) / PER_CREDIT, f"tps:{uuid.uuid4().hex[:16]}", f"TPS/CTPS check: {len(answers)} numbers")
            await db.commit()
        except Exception as err:  # the answers still go back; a failed save must not hide them
            logger.warning(f"[tps-check] could not save or charge: {scrub(str(err))}")
            await db.rollback()
            charged = 0
        if getattr(prov, "error", ""):
            note = {"key": "The checking service is not set up correctly. Tell your administrator.",
                    "balance": "The checking service has run out of balance. Tell your administrator.",
                    "unavailable": "Some numbers could not be checked just now. Try again in a few minutes."}.get(prov.error, "")
            if prov.error in ("key", "balance"):
                try:
                    from app.services import provero

                    await provero.note(db, last_error=prov.error, last_error_at=datetime.utcnow().isoformat() + "Z")
                    await db.commit()
                except Exception:
                    await db.rollback()
        rows, _ = await _plan(db, body.numbers)
    return {"rows": rows, "summary": summary(rows), "credits_charged": charged, "note": note}
