"""TPS and CTPS screening at the moment a person checks a company.

Nothing runs in the background. When someone checks one company (the web research or the deep web search on a saved company), its UK phone
numbers that have no result under 28 days old are screened then, and charged to the Leads wallet through the same rate item as the manual
check in api/tps_check.py: 2 credits per 5 numbers that got an answer. Fresh numbers, non-UK numbers and numbers that got no answer cost
nothing. A missing provider key, too few credits or an unreachable service never fails the check: the numbers are left unscreened and the
caller says why (see `status`).
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import Any, Dict, List

from sqlalchemy import select

from app.core.brand import scrub
from app.services import call_permission as CP
from app.services import credits as K
from app.services.timezone_service import normalize_phone

logger = logging.getLogger(__name__)

ITEM = "lead_tps_check"  # saved companies belong to Leads, so the Leads wallet pays
UK = "+44"
PER_UNIT = 5  # numbers per rate-card unit
CHUNK = 50  # numbers sent to the provider at once: a whole number of units, so a full chunk never rounds up
MAX_NUMBERS = 50  # one company never has more than a few; this only bounds a bad row
LABEL = "TPS and CTPS check"


def account_numbers(row: Any) -> List[str]:
    from app.api.lead_accounts import card_numbers

    research = row.research if isinstance(row.research, dict) else {}
    return card_numbers({"phone": row.phone, "research": research})


async def _fresh_set(db, numbers: List[str]) -> set:
    from app.models.models import PhoneScreening

    out: set = set()
    now = datetime.utcnow()
    for i in range(0, len(numbers), CP.SCREEN_CHUNK):
        rows = (await db.execute(select(PhoneScreening).where(PhoneScreening.number.in_(numbers[i:i + CP.SCREEN_CHUNK])))).scalars().all()
        out.update(r.number for r in rows if CP._fresh(r, now))
    return out


def _ref(answered: List[str], now: datetime) -> str:
    """The same set of numbers answered on the same day always gets the same ref, so it is never charged twice."""
    digest = hashlib.sha1(",".join(sorted(answered)).encode()).hexdigest()[:20]
    return f"checktps:{digest}:{now:%Y%m%d}"


async def _keep(db, answers: Dict[str, Dict[str, Any]], provider_name: str, label: str) -> Dict[str, int]:
    """Save the answers and charge for them in one transaction. Numbers screened meanwhile by someone else are neither saved nor charged again."""
    try:
        await K._lock(db)
        now = datetime.utcnow()
        fresh = await _fresh_set(db, sorted(answers))
        todo = {n: r for n, r in answers.items() if n not in fresh}
        for n, res in todo.items():
            await CP.save_screening(db, n, res.get("tps", "unknown"), bool(res.get("ctps")), provider_name, now)
        charged = 0
        if todo:
            ref = _ref(list(todo), now)
            if not await K._already_charged(db, ref, ITEM):
                charged = await K.charge(db, ITEM, len(todo) / PER_UNIT, ref, f"{label}: {len(todo)} numbers")
        await db.commit()
        return {"screened": len(todo), "charged": charged}
    except Exception as err:
        logger.warning(f"[check-tps] could not save or charge: {scrub(str(err))}")
        await db.rollback()
        return {"screened": 0, "charged": 0}


async def screen_account(db, row: Any, label: str = LABEL) -> Dict[str, Any]:
    """Screen one saved company's UK numbers now. Returns {"status", "screened", "charged"};
    status is one of: nothing (no number needs it), done, no_key, no_credits, service."""
    out: Dict[str, Any] = {"status": "nothing", "screened": 0, "charged": 0}
    nums = list(dict.fromkeys(n for n in (normalize_phone(x) for x in account_numbers(row)) if n and n.startswith(UK)))[:MAX_NUMBERS]
    if not nums:
        return out
    fresh = await _fresh_set(db, nums)
    todo = [n for n in nums if n not in fresh]
    if not todo:
        return out
    prov = await CP.provider()
    if not prov.configured():
        return {**out, "status": "no_key"}
    for i in range(0, len(todo), CHUNK):
        part = todo[i:i + CHUNK]
        ok, _why = await K.can_start(db, ITEM, len(part) / PER_UNIT)
        if not ok:
            return {**out, "status": "no_credits"}
        answers = await prov.screen(part)
        err = getattr(prov, "error", "")
        if answers:
            done = await _keep(db, answers, prov.name, label)
            out["screened"] += done["screened"]
            out["charged"] += done["charged"]
        if err:
            if err in ("key", "balance"):
                try:
                    from app.services import provero

                    await provero.note(db, last_error=err, last_error_at=datetime.utcnow().isoformat() + "Z")
                    await db.commit()
                except Exception:
                    pass
            return {**out, "status": "service"}
    return {**out, "status": "done"}


async def screen_account_safely(db, row: Any, label: str = LABEL) -> Dict[str, Any]:
    """The same, but it never raises: a problem here must not fail the check that called it."""
    try:
        return await screen_account(db, row, label)
    except Exception as err:
        logger.warning(f"[check-tps] skipped: {scrub(str(err))}")
        return {"status": "service", "screened": 0, "charged": 0}
