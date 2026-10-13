"""Runs a company check over a whole list in the background, with progress, cancel and fair charging.

The job's state is one small settings document per run (so any server process can answer a progress
question, and a restart never leaves a hold behind for long). Credits for the paid steps are held up
front at the most they could cost, then released and replaced by one charge for what was really used,
rounded up once per step.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from app.core.tenancy import current_org, org_scope
from app.services import check_fixes
from app.services import company_check as cc
from app.services import credits as credit

logger = logging.getLogger("company_check_job")

_TASKS: Dict[str, "asyncio.Task"] = {}
FLUSH_EVERY = 10
POLL_SECONDS = 3.0
_STEPS = (("registry", "check_registry", "Registry check"), ("deep", "google_deep_search", "Deep web search"),
          ("email", "check_email", "Contact email check"), ("web", "lead_lookup", "Web research"),
          ("phone", "lead_phone_check", "Phone check"))


def _key(org_id: str, job_id: str) -> str:
    return f"checkjob:{org_id}:{job_id}"


def _latest_key(org_id: str) -> str:
    return f"checkjob_latest:{org_id}"


async def _read(key: str) -> Dict[str, Any]:
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        return await credit._get_doc(db, key)


async def _write(key: str, doc: Dict[str, Any]) -> None:
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        await credit._put_doc(db, key, doc)
        await db.commit()


def _expire_if_stalled(doc: Dict[str, Any]) -> Dict[str, Any]:
    """A run whose server stopped (a restart) never finishes on its own; call it stalled."""
    if doc.get("status") == "running":
        try:
            if datetime.utcnow() - datetime.fromisoformat(doc["updated_at"]) > cc.STALL_AFTER:
                doc["status"] = "stalled"
        except Exception:
            pass
    return doc


async def get_job(job_id: str) -> Dict[str, Any]:
    return _expire_if_stalled(await _read(_key(current_org(), job_id)))


async def latest_job() -> Dict[str, Any]:
    pointer = await _read(_latest_key(current_org()))
    return await get_job(pointer["job_id"]) if pointer.get("job_id") else {}


async def request_cancel(job_id: str) -> Dict[str, Any]:
    org = current_org()
    doc = await _read(_key(org, job_id))
    if doc.get("status") == "running":
        doc["cancel"] = True
        await _write(_key(org, job_id), doc)
    return _expire_if_stalled(doc)


async def set_paused(job_id: str, paused: bool) -> Dict[str, Any]:
    """Pause or resume a running check. Held credits stay held; companies already checked keep their results."""
    org = current_org()
    doc = await _read(_key(org, job_id))
    if doc.get("status") == "running":
        doc["pause"] = bool(paused)
        await _write(_key(org, job_id), doc)
    return _expire_if_stalled(doc)


async def readiness() -> Dict[str, Any]:
    """Which checks can run right now (a register, the deep web search and the email finders each
    need a key saved by staff). The cost shown to the user only counts steps that can really run."""
    from app.services.enrichment_service import google_places_key
    from app.services.enrichment_waterfall import finder_keys

    sources = await cc.live_sources()
    from app.services.telnyx_client import platform_key

    return {"sources": sources, "registry": bool(sources), "deep": bool(await google_places_key()), "email": bool(await finder_keys()),
            "phone": bool(platform_key())}


async def estimate(db, accounts: List[Any], include_email: bool, include_web: bool = False, include_phone: bool = False) -> Dict[str, Any]:
    ready = await readiness()
    rates = await credit.rates(db)
    with_contact = sum(1 for a in accounts if len((a.contact_name or "").split()) >= 2)
    web_rows = sum(1 for a in accounts if not a.researched_at) if include_web else 0
    phone_rows = sum(1 for a in accounts if cc.phone_shape(a.phone or "") == "ok") if include_phone and ready.get("phone") else 0
    parts = cc.price_parts(rates, len(accounts), with_contact, registry=ready["registry"], deep=ready["deep"],
                           email=include_email and ready["email"], web_rows=web_rows, phone_rows=phone_rows)
    return {"companies": len(accounts), "with_contact": with_contact, "web_rows": web_rows, "phone_rows": phone_rows,
            "ready": {k: ready[k] for k in ("registry", "deep", "email", "phone") if k in ready},
            "max_credits": parts, "balance": await credit.wallet_balance(db, "leadgen"),
            "rates": {i: rates[i]["credits"] for i in ("check_registry", "google_deep_search", "check_email", "lead_lookup", "lead_phone_check")}}


async def start(db, accounts: List[Any], include_email: bool, include_web: bool = False, include_phone: bool = False) -> Dict[str, Any]:
    """Hold the credits and start the run. Returns {error} when it can't start."""
    org = current_org()
    pointer = await _read(_latest_key(org))
    if pointer.get("job_id"):
        running = await get_job(pointer["job_id"])
        if running.get("status") == "running":
            return {"error": "A check is already running. Let it finish or cancel it first."}
    if not accounts:
        return {"error": "Pick at least one company to check."}
    est = await estimate(db, accounts, include_email, include_web, include_phone)
    job_id = f"chk_{uuid.uuid4().hex[:12]}"
    held = []
    for step, item, label in _STEPS:
        if est["max_credits"][step] > 0:
            qty = {"email": est["with_contact"], "web": est["web_rows"], "phone": est["phone_rows"] / 5}.get(step, len(accounts))
            held.append({"item": item, "quantity": qty, "ref": f"{job_id}:{step}", "note": f"{label} (held for a company check)"})
    ok, why = await credit.hold(db, held)
    if not ok:
        await db.rollback()
        return {"error": why}
    await db.commit()
    ready = await readiness()
    doc = {"job_id": job_id, "org_id": org, "status": "running", "total": len(accounts), "done": 0, "cancel": False,
           "options": {"email": bool(include_email and ready["email"]), "web": bool(include_web), "phone": bool(include_phone and ready.get("phone"))}, "max_credits": est["max_credits"],
           "counts": {v: 0 for v in cc.VERDICTS}, "used": {s: 0 for s, _, _ in _STEPS}, "charged": None,
           "ready": est["ready"], "started_at": datetime.utcnow().isoformat(), "updated_at": datetime.utcnow().isoformat()}
    await _write(_key(org, job_id), doc)
    await _write(_latest_key(org), {"job_id": job_id})
    rows = [cc._account_row(a) for a in accounts]
    _TASKS[job_id] = asyncio.create_task(_run(org, job_id, rows, ready, doc, [h["ref"] for h in held]))
    return {"job": doc}


async def _run(org: str, job_id: str, rows: List[Dict[str, Any]], ready: Dict[str, Any], doc: Dict[str, Any], refs: List[str]) -> None:
    key = _key(org, job_id)
    try:
        with org_scope(org):
            ctx = cc.Context(
                org_id=org, job_id=job_id, registry_sources=ready["sources"], paces={s.id: cc.Pace() for s in ready["sources"]},
                deep_ready=ready["deep"], find_emails=doc["options"]["email"], check_phones=doc["options"].get("phone", False),
                phone_sem=asyncio.Semaphore(6), phone_client=_phone_client() if doc["options"].get("phone") else None,
                web_sem=asyncio.Semaphore(10), dns_sem=asyncio.Semaphore(20), deep_sem=asyncio.Semaphore(4), email_sem=asyncio.Semaphore(3))
            queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()
            for r in rows:
                queue.put_nowait(r)
            pending: List[tuple] = []
            lock = asyncio.Lock()
            state = {"cancelled": False, "paused": False, "polled": 0.0}

            async def flush(force: bool = False) -> None:
                async with lock:
                    if not force and len(pending) < FLUSH_EVERY:
                        return
                    batch, pending[:] = list(pending), []
                    if batch:
                        await _save_results(batch)
                    cur = await _read(key)
                    if cur.get("cancel"):
                        state["cancelled"] = True
                    state["paused"] = bool(cur.get("pause")) and not state["cancelled"]
                    doc["cancel"] = bool(cur.get("cancel"))
                    doc["pause"] = state["paused"]
                    doc["updated_at"] = datetime.utcnow().isoformat()
                    state["polled"] = time.monotonic()
                    await _write(key, doc)

            async def worker() -> None:
                while not state["cancelled"]:
                    # Look for a pause or cancel every few seconds, not only after a batch is saved,
                    # so pressing either takes effect quickly. While paused nothing new is started,
                    # what is already finished is saved, and the run keeps its heartbeat so it is not
                    # mistaken for a stalled one.
                    if time.monotonic() - state["polled"] > POLL_SECONDS:
                        await flush(force=True)
                    if state["paused"]:
                        await asyncio.sleep(1.0)
                        continue
                    try:
                        row = queue.get_nowait()
                    except asyncio.QueueEmpty:
                        return
                    try:
                        result = await cc.check_row(row, ctx)
                    except Exception as err:
                        logger.warning(f"[company_check] {row['name']} failed: {err}")
                        result = {"verdict": "unclear", "reasons": ["The check couldn't finish for this company"], "stages": [],
                                  "spent": {"registry": 0, "deep": 0, "email": 0, "phone": 0}, "email": {"state": "unchecked"},
                                  "phone": {"state": "unchecked"}, "website": {"state": "unchecked"},
                                  "checked_at": datetime.utcnow().isoformat() + "Z", "job_id": job_id, "pending_registry": False}
                    if doc["options"].get("web") and not row.get("researched"):
                        result.setdefault("spent", {})["web"] = await _web_research(row["id"], result)
                    doc["done"] += 1
                    doc["counts"][result["verdict"]] = doc["counts"].get(result["verdict"], 0) + 1
                    for step, n in result.get("spent", {}).items():
                        doc["used"][step] = doc["used"].get(step, 0) + n
                    pending.append((row["id"], result))
                    await flush()

            await asyncio.gather(*[worker() for _ in range(cc.WORKERS)])
            await flush(force=True)
            doc["status"] = "cancelled" if state["cancelled"] else "done"
            await _settle(job_id, refs, doc)
    except Exception as err:
        logger.exception(f"[company_check] run {job_id} failed")
        doc["status"] = "error"
        doc["error"] = "The check stopped early. Companies already checked keep their results."
        try:
            with org_scope(org):
                await _settle(job_id, refs, doc)
        except Exception:
            pass
    finally:
        doc["updated_at"] = datetime.utcnow().isoformat()
        try:
            await _write(key, doc)
        except Exception:
            logger.warning("[company_check] final progress not saved")
        _TASKS.pop(job_id, None)


def _phone_client():
    from app.services.telnyx_client import TelnyxClient, platform_key

    return TelnyxClient(platform_key())


async def _web_research(account_id: str, result: Dict[str, Any]) -> int:
    """The live web search for one company, as part of the same run. Returns 1 when it found something
    (the only case that is charged), else 0. A failure here never fails the company's check."""
    from app.api.lead_accounts import _apply_shared_record, research_into
    from app.database import AsyncSessionLocal
    from app.models.models import LeadAccount

    try:
        async with AsyncSessionLocal() as db:
            acc = (await db.execute(select(LeadAccount).where(LeadAccount.id == account_id))).scalars().first()
            if not acc:
                return 0
            await _apply_shared_record(db, acc)
            found = await research_into(db, acc)
            await db.commit()
            return 1 if found else 0
    except Exception as err:
        logger.warning(f"[company_check] web research failed for {account_id}: {err}")
        return 0


async def _save_results(batch: List[tuple]) -> None:
    from app.database import AsyncSessionLocal
    from app.models.models import LeadAccount

    ids = [i for i, _ in batch]
    async with AsyncSessionLocal() as db:
        rows = {a.id: a for a in (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(ids)))).scalars().all()}
        for acc_id, result in batch:
            acc = rows.get(acc_id)
            if not acc:
                continue
            result = {k: v for k, v in result.items() if k != "spent"}
            for fix in result.get("fixes") or []:
                # A blank field is filled right away; a value the user gave is only ever offered (see check_fixes).
                if fix["kind"] == "fill" and not getattr(acc, fix["field"], ""):
                    check_fixes.set_field(acc, fix["field"], fix["to"])
                    fix["applied"] = True
            acc.verification = result
            if result.get("record_id") and not acc.business_record_id:
                acc.business_record_id = result["record_id"]
        await db.commit()


async def _settle(job_id: str, refs: List[str], doc: Dict[str, Any]) -> None:
    """Give back every held credit, then charge what the run really used (once per step)."""
    from app.database import AsyncSessionLocal

    charged = {}
    async with AsyncSessionLocal() as db:
        await credit.release(db, refs)
        for step, item, label in _STEPS:
            used = int(doc["used"].get(step, 0))
            if used > 0:
                try:
                    charged[step] = await credit.charge(db, item, used / 5 if step == "phone" else used, f"{job_id}:{step}", f"{label}: {used} {'company' if step != 'email' else 'email found'}")
                except Exception as err:
                    logger.warning(f"[company_check] charge for {step} skipped: {err}")
                    charged[step] = 0
        await db.commit()
    doc["charged"] = {**charged, "total": sum(charged.values())}
