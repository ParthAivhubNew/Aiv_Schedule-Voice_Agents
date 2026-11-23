"""Automatic TPS and CTPS screening of the phone numbers on saved companies.

Nothing runs at search time and nothing runs for a number that is not on a saved account. A sweep looks at the accounts an organisation
saved or changed since its last sweep (added to a list, saved from Find Leads, created by hand, imported, or given a new number by
research), and screens the UK numbers that have no result under 28 days old. It reuses the paid check a person can start
(api/tps_check.py): the same provider, the same 28-day record (PhoneScreening) and the same rate item, so the price is 2 credits per
5 numbers that got an answer. Fresh numbers, non-UK numbers and numbers that got no answer cost nothing.

Where it runs: a loop in main.py calls sweep_all_orgs() every few minutes, and a save calls kick() so a small save is screened within
seconds. Both do the same bounded piece of work per organisation, so a 10,000-row import is screened over several ticks and a restart
loses nothing: progress is a cursor (updated_at, id) kept in the organisation's own setting, and a crash before a chunk commits leaves
its numbers unscreened and uncharged, to be picked up on the next tick.

Per organisation: AppSetting "auto_tps:<org>" = {"enabled": bool (on unless switched off), "cursor": {"at", "id"}, "notice": {...}}.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select, tuple_

from app.core.brand import scrub
from app.services import call_permission as CP
from app.services import credits as K
from app.services.timezone_service import normalize_phone

logger = logging.getLogger(__name__)

ITEM = "lead_tps_check"  # saved companies belong to Leads, so the Leads wallet pays
UK = "+44"
PER_UNIT = 5  # numbers per rate-card unit
CHUNK = 50  # numbers sent to the provider at once: a whole number of units, so a full chunk never rounds up
CHUNK_PAUSE = 1.0  # seconds between chunks
TICK_NUMBERS = 250  # most numbers one organisation is screened for in one tick (125 credits at the standard price)
TICK_ACCOUNTS = 100  # most accounts one tick looks at
FIRST_LOOK_BACK = timedelta(minutes=15)  # a new setting starts from just before now, so a book saved long ago is never swept
LABEL = "TPS and CTPS check (automatic)"

NOTICE_CREDITS = "Some phone numbers were not screened: not enough credits."
NOTICE_KEY = "Some phone numbers were not screened: the TPS and CTPS check is not switched on yet. Ask your account manager."
NOTICE_SERVICE = "Some phone numbers were not screened: the TPS and CTPS check could not be reached. It will try again."

AUTO_KICK = False  # main.py switches this on at start-up; tests leave it off so a save starts no background work
_running: set = set()


def key(org_id: str) -> str:
    return f"auto_tps:{org_id}"


async def load(db, org_id: str) -> Dict[str, Any]:
    doc = await K._get_doc(db, key(org_id))
    notice = doc.get("notice") if isinstance(doc.get("notice"), dict) else None
    cur = doc.get("cursor") if isinstance(doc.get("cursor"), dict) else None
    return {"enabled": bool(doc.get("enabled", True)), "cursor": cur, "notice": notice}


async def _save(db, org_id: str, **fields: Any) -> None:
    doc = await K._get_doc(db, key(org_id))
    doc.update(fields)
    await K._put_doc(db, key(org_id), doc)


async def set_enabled(db, org_id: str, enabled: bool) -> None:
    """Switching on starts from now: numbers saved while it was off are not swept up and charged later. Caller commits."""
    fields: Dict[str, Any] = {"enabled": bool(enabled)}
    if enabled:
        fields.update(cursor={"at": datetime.utcnow().isoformat(), "id": ""}, notice=None)
    await _save(db, org_id, **fields)


async def _notice(db, org_id: str, code: str, text: str) -> None:
    await _save(db, org_id, notice={"code": code, "text": text, "at": datetime.utcnow().isoformat() + "Z"})


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
    return f"autotps:{digest}:{now:%Y%m%d}"


async def _cursor(db, org_id: str, st: Dict[str, Any]):
    cur = st["cursor"]
    if cur:
        try:
            return datetime.fromisoformat(str(cur["at"])), str(cur.get("id") or "")
        except (KeyError, ValueError):
            pass
    start = datetime.utcnow() - FIRST_LOOK_BACK
    await _save(db, org_id, cursor={"at": start.isoformat(), "id": ""})
    await db.commit()
    return start, ""


async def sweep_org(org_id: str, chunk_pause: Optional[float] = None) -> Dict[str, Any]:
    """One bounded pass for one organisation. Returns {"status", "screened", "charged"} (status: off, idle, done, no_key, no_credits, service)."""
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal

    if org_id in _running:
        return {"status": "busy", "screened": 0, "charged": 0}
    _running.add(org_id)
    try:
        with org_scope(org_id):
            async with AsyncSessionLocal() as db:
                return await _sweep(db, org_id, CHUNK_PAUSE if chunk_pause is None else chunk_pause)
    finally:
        _running.discard(org_id)


async def _sweep(db, org_id: str, pause: float) -> Dict[str, Any]:
    from app.models.models import LeadAccount

    out = {"status": "idle", "screened": 0, "charged": 0}
    st = await load(db, org_id)
    if not st["enabled"]:
        return {**out, "status": "off"}
    at, last_id = await _cursor(db, org_id, st)
    rows = (await db.execute(select(LeadAccount).where(tuple_(LeadAccount.updated_at, LeadAccount.id) > tuple_(at, last_id))
                             .order_by(LeadAccount.updated_at, LeadAccount.id).limit(TICK_ACCOUNTS))).scalars().all()
    if not rows:
        return out
    per_account = []
    for row in rows:
        nums = list(dict.fromkeys(n for n in (normalize_phone(x) for x in account_numbers(row)) if n and n.startswith(UK)))
        per_account.append((row, nums))
    fresh = await _fresh_set(db, sorted({n for _, nums in per_account for n in nums}))
    todo: List[str] = []
    last = None  # the last account this tick takes in
    for row, nums in per_account:
        need = [n for n in nums if n not in fresh and n not in todo]
        if todo and len(todo) + len(need) > TICK_NUMBERS:
            break
        todo.extend(need)
        last = row
    if last is None:
        return out

    async def advance() -> None:
        await _save(db, org_id, cursor={"at": last.updated_at.isoformat(), "id": last.id})
        await db.commit()

    if not todo:
        await advance()
        return {**out, "status": "done"}
    prov = await CP.provider()
    if not prov.configured():
        await _notice(db, org_id, "no_key", NOTICE_KEY)
        await db.commit()
        return {**out, "status": "no_key"}
    problem = ""
    for i in range(0, len(todo), CHUNK):
        part = todo[i:i + CHUNK]
        if i and pause:
            await asyncio.sleep(pause)
        ok, _why = await K.can_start(db, ITEM, len(part) / PER_UNIT)
        if not ok:
            problem = "no_credits"
            break
        answers = await prov.screen(part)
        err = getattr(prov, "error", "")
        if answers:
            done = await _keep(db, answers, prov.name)
            out["screened"] += done["screened"]
            out["charged"] += done["charged"]
        if err in ("key", "balance"):
            problem = "service"
            try:
                from app.services import provero

                await provero.note(db, last_error=err, last_error_at=datetime.utcnow().isoformat() + "Z")
            except Exception:
                pass
            await db.commit()
            break
        if err:
            problem = "service"  # a timeout or a rate limit: the unanswered numbers are tried again next tick
            break
    if problem == "no_credits":
        await _notice(db, org_id, "no_credits", NOTICE_CREDITS)
        await db.commit()
        return {**out, "status": "no_credits"}
    if problem == "service":
        await _notice(db, org_id, "service", NOTICE_SERVICE)
        await db.commit()
        return {**out, "status": "service"}
    if st["notice"]:
        await _save(db, org_id, notice=None)
    await advance()
    return {**out, "status": "done"}


async def _keep(db, answers: Dict[str, Dict[str, Any]], provider_name: str) -> Dict[str, int]:
    """Save the answers and charge for them in one transaction. Numbers another sweep screened meanwhile are neither saved nor charged again."""
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
                charged = await K.charge(db, ITEM, len(todo) / PER_UNIT, ref, f"{LABEL}: {len(todo)} numbers")
        await db.commit()
        return {"screened": len(todo), "charged": charged}
    except Exception as err:
        logger.warning(f"[auto-tps] could not save or charge: {scrub(str(err))}")
        await db.rollback()
        return {"screened": 0, "charged": 0}


async def sweep_all_orgs() -> None:
    from app.core.orgs import active_org_ids

    for org_id in await active_org_ids():
        try:
            res = await sweep_org(org_id)
            if res["screened"]:
                logger.info(f"[auto-tps] {org_id}: screened {res['screened']} numbers, {res['charged']} credits")
        except Exception as err:
            logger.warning(f"[auto-tps] {org_id} failed: {scrub(str(err))}")


def kick() -> None:
    """Called after a save: starts a sweep for the current organisation without making the request wait. A no-op until main.py enables it."""
    if not AUTO_KICK:
        return
    from app.core.tenancy import current_org

    org_id = current_org()
    if org_id in _running:
        return

    async def go() -> None:
        try:
            await asyncio.sleep(2)  # the save has committed by now
            await sweep_org(org_id)
        except Exception as err:
            logger.warning(f"[auto-tps] {org_id} kick failed: {scrub(str(err))}")

    try:
        asyncio.get_running_loop().create_task(go())
    except RuntimeError:
        pass
