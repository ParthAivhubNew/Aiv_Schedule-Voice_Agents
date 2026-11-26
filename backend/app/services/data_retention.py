"""How long personal data and supplier logs are kept (plan 11, C.4: "apply retention to raw data, call recordings and vendor call logs").

The 12-month review of saved companies is separate (services/eligibility.retention_sweep). Browser-call audio has its own delete date
(services/human_calls.sweep). This covers the rest:

  call_recordings  AI-call audio files in the recordings folder (not the browser-call subfolder): deleted after 90 days
  finder_searches  who was searched for in e-mail finding (the name and the address found, in enrichment_attempts): blanked after 90
                   days; the row and its cost stay
  supplier_logs    tavily_calls, apollo_calls, enrichment_attempts and the provider wrapper's provider_call_log: deleted after 13 months,
                   which keeps a full year for the client profit-and-loss report. Each supplier's first wrapper row is always kept: the
                   cost view (services/cost_ledger.py) dates the supplier's switch to the wrapper from it, so nothing is counted twice
  number_checks    number check results: deleted after 13 months

**Nothing is deleted until a staff admin switches retention on** (the app setting "data_retention"). Until then the staff screen shows,
as a dry run, what each rule would remove. Staff may change each period. The raw register data on company records (business_records.raw_data)
is reported but never deleted here: the register and the provenance of every value depend on it, so that is a decision, not a sweep.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import text

logger = logging.getLogger("data_retention")

SETTING = "data_retention"
POLICIES: List[Dict[str, Any]] = [
    {"id": "call_recordings", "label": "AI call recordings (audio files)", "days": 90, "does": "deleted"},
    {"id": "finder_searches", "label": "Who was searched for in e-mail finding (the name and the address found)", "days": 90, "does": "blanked"},
    {"id": "supplier_logs", "label": "Supplier call logs (web search, Apollo, e-mail finders, the provider wrapper)", "days": 396, "does": "deleted"},
    {"id": "number_checks", "label": "Number check results", "days": 396, "does": "deleted"},
]
MIN_DAYS, MAX_DAYS = 30, 3650
BY_ID = {p["id"]: p for p in POLICIES}


def recordings_folder() -> str:
    from app.services.call_recorder import RECORDINGS_DIR

    return RECORDINGS_DIR


async def _doc(db) -> Dict[str, Any]:
    from app.services.credits import _get_doc

    return await _get_doc(db, SETTING)


def days_of(doc: Dict[str, Any]) -> Dict[str, int]:
    out = {}
    for p in POLICIES:
        try:
            n = int((doc.get("days") or {}).get(p["id"]) or p["days"])
        except (TypeError, ValueError):
            n = p["days"]
        out[p["id"]] = max(MIN_DAYS, min(n, MAX_DAYS))
    return out


def _old_recordings(cutoff: datetime) -> List[str]:
    """AI-call audio files last changed before the cutoff. Only the folder itself: browser-call audio (a subfolder) has its own date."""
    folder = recordings_folder()
    limit = cutoff.timestamp()
    out = []
    try:
        for name in os.listdir(folder):
            path = os.path.join(folder, name)
            if os.path.isfile(path) and name.lower().endswith((".wav", ".mp3", ".ogg", ".webm", ".m4a")) and os.path.getmtime(path) < limit:
                out.append(path)
    except FileNotFoundError:
        pass
    return out


# Each rule's rows, as (count SQL, change SQL). :c is the cutoff. Run under the system scope: every organisation's rows.
_SQL = {
    "finder_searches": ("SELECT count(*) FROM enrichment_attempts WHERE created_at < :c AND (coalesce(query, '') <> '' OR coalesce(found_email, '') <> '')",
                        "UPDATE enrichment_attempts SET query = '', found_email = '' WHERE created_at < :c "
                        "AND (coalesce(query, '') <> '' OR coalesce(found_email, '') <> '')"),
    "number_checks": ("SELECT count(*) FROM number_checks WHERE checked_at < :c", "DELETE FROM number_checks WHERE checked_at < :c"),
}
_SUPPLIER_TABLES = [("tavily_calls", "at"), ("apollo_calls", "at"), ("enrichment_attempts", "created_at")]
_KEEP_FIRST = "SELECT DISTINCT ON (provider) id FROM provider_call_log ORDER BY provider, at"  # each supplier's switch to the wrapper


async def _count(db, rule: str, cutoff: datetime) -> int:
    if rule == "call_recordings":
        return len(_old_recordings(cutoff))
    if rule == "supplier_logs":
        n = 0
        for table, col in _SUPPLIER_TABLES:
            n += int((await db.execute(text(f"SELECT count(*) FROM {table} WHERE {col} < :c"), {"c": cutoff})).scalar() or 0)
        n += int((await db.execute(text(f"SELECT count(*) FROM provider_call_log WHERE at < :c AND id NOT IN ({_KEEP_FIRST})"),
                                   {"c": cutoff})).scalar() or 0)
        return n
    return int((await db.execute(text(_SQL[rule][0]), {"c": cutoff})).scalar() or 0)


async def _apply(db, rule: str, cutoff: datetime) -> int:
    if rule == "call_recordings":
        gone = 0
        for path in _old_recordings(cutoff):
            try:
                os.remove(path)
                gone += 1
            except OSError as err:
                logger.warning(f"[retention] recording not deleted: {os.path.basename(path)}: {err}")
        return gone
    if rule == "supplier_logs":
        n = 0
        for table, col in _SUPPLIER_TABLES:
            n += (await db.execute(text(f"DELETE FROM {table} WHERE {col} < :c"), {"c": cutoff})).rowcount or 0
        n += (await db.execute(text(f"DELETE FROM provider_call_log WHERE at < :c AND id NOT IN ({_KEEP_FIRST})"), {"c": cutoff})).rowcount or 0
        return n
    return (await db.execute(text(_SQL[rule][1]), {"c": cutoff})).rowcount or 0


async def raw_register_report(db) -> Dict[str, int]:
    """What raw register data there is, for the decision about it: company records holding it, and those of closed companies."""
    row = (await db.execute(text("SELECT count(*) FILTER (WHERE raw_data IS NOT NULL), "
                                 "count(*) FILTER (WHERE raw_data IS NOT NULL AND coalesce(status, '') NOT IN ('', 'Active', 'active')) "
                                 "FROM business_records"))).one()
    return {"withRawData": int(row[0] or 0), "closedWithRawData": int(row[1] or 0)}


async def overview(db, now: Optional[datetime] = None) -> Dict[str, Any]:
    """For the staff screen: whether retention is on, each rule's period and what it would remove now. Read under the system scope."""
    now = now or datetime.utcnow()
    doc = await _doc(db)
    days = days_of(doc)
    rules = []
    for p in POLICIES:
        cutoff = now - timedelta(days=days[p["id"]])
        rules.append({"id": p["id"], "label": p["label"], "does": p["does"], "days": days[p["id"]], "defaultDays": p["days"],
                      "dueNow": await _count(db, p["id"], cutoff)})
    return {"on": bool(doc.get("on")), "rules": rules, "lastRun": doc.get("lastRun"), "rawRegister": await raw_register_report(db),
            "minDays": MIN_DAYS, "maxDays": MAX_DAYS}


async def save(db, *, on: bool, days: Dict[str, Any]) -> Dict[str, Any]:
    """Switches retention on or off and sets the periods (each clamped to 30 days to 10 years). The caller commits."""
    from app.services.credits import _put_doc

    doc = await _doc(db)
    clean = {}
    for rule, n in (days or {}).items():
        if rule not in BY_ID:
            raise ValueError(f"No retention rule called {rule!r}.")
        try:
            clean[rule] = max(MIN_DAYS, min(int(n), MAX_DAYS))
        except (TypeError, ValueError):
            raise ValueError("Each period is a whole number of days.")
    doc["days"] = {**(doc.get("days") or {}), **clean}
    doc["on"] = bool(on)
    await _put_doc(db, SETTING, doc)
    return doc


async def run(db, now: Optional[datetime] = None, *, force: bool = False) -> Dict[str, Any]:
    """Applies every rule, when retention is on (or force, for a staff-pressed run that the caller has checked). Read and write under the
    system scope; the caller commits. {"ran": False} when it is off."""
    from app.services.credits import _put_doc

    now = now or datetime.utcnow()
    doc = await _doc(db)
    if not (doc.get("on") or force):
        return {"ran": False}
    days = days_of(doc)
    started = time.monotonic()
    done: Dict[str, int] = {}
    for p in POLICIES:
        try:
            async with db.begin_nested():  # one rule failing never undoes or stops the others
                done[p["id"]] = await _apply(db, p["id"], now - timedelta(days=days[p["id"]]))
        except Exception as err:
            logger.warning(f"[retention] {p['id']} failed: {err}")
            done[p["id"]] = -1
    doc["lastRun"] = {"at": now.isoformat(timespec="seconds") + "Z", "done": done, "seconds": round(time.monotonic() - started, 1)}
    await _put_doc(db, SETTING, doc)
    return {"ran": True, **doc["lastRun"]}


async def daily() -> Optional[Dict[str, Any]]:
    """The job: once a day, when retention is on. Never raises."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    try:
        with system_scope():
            async with AsyncSessionLocal() as db:
                doc = await _doc(db)
                last = ((doc.get("lastRun") or {}).get("at") or "").rstrip("Z")
                if not doc.get("on") or (last and datetime.utcnow() - datetime.fromisoformat(last) < timedelta(hours=23)):
                    return None
                out = await run(db)
                await db.commit()
                return out
    except Exception as err:
        logger.warning(f"[retention] daily run failed: {err}")
        return None
