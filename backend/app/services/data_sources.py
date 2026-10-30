"""Batch runs for a DataSource: work a list of search terms, one at a time, saving each result
into the shared BusinessRecord store (see models.py: DataSource/DataSourceRun).

CRUD for a source itself lives in app.api.admin_portal (same inline AsyncSessionLocal pattern as
every other staff-only screen there); this file is the run loop those Start/Pause/Resume/Stop
buttons actually drive, plus the watchdog that notices a run has stalled.

The loop is checkpointed (DataSourceRun.cursor holds the query list and how far through it the
run got) and re-reads its own row's status from the database before every single item -- so
Pause writes "paused" and the loop sees it and exits within one item, and Resume just starts a
new background task that continues from the same cursor instead of restarting the list.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import DataSource, DataSourceRun

logger = logging.getLogger("data_sources")

# asyncio only holds a WEAK reference to a task returned by create_task(); with nothing else
# referencing it, the garbage collector is free to destroy it mid-run at any point -- silently,
# no error, no log, it just stops. This set is that "something else" (the standard fix the
# asyncio docs themselves recommend), so a run reliably finishes its whole list instead of
# randomly dying a few items in.
_background_tasks: set = set()


def spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task

STUCK_AFTER = timedelta(minutes=30)
ACTIVE_STATUSES = ("running", "paused")


async def latest_run(db: AsyncSession, source_id: str) -> Optional[DataSourceRun]:
    return (await db.execute(
        select(DataSourceRun).where(DataSourceRun.source_id == source_id).order_by(DataSourceRun.started_at.desc())
    )).scalars().first()


async def start_run(db: AsyncSession, source: DataSource, queries: List[str]) -> DataSourceRun:
    """Creates the run row and hands it to the background loop. Caller commits and is
    responsible for actually scheduling the right loop (run_bulk for a source with
    bulk_index_url configured, run_batch otherwise) as a background task via spawn() -- kept
    separate so the HTTP request returns immediately instead of waiting for the whole thing to
    finish. A bulk source needs no `queries` at all -- key + URL configured once is the whole
    setup; nothing to type at run time."""
    import uuid

    from app.services.data_source_connector import is_bulk

    bulk = is_bulk(source)
    if not bulk:
        queries = [q.strip() for q in queries if q.strip()]
        if not queries:
            raise ValueError("Give at least one search term to start a run with.")
    current = await latest_run(db, source.id)
    if current and current.status in ACTIVE_STATUSES:
        raise ValueError(f"A run is already {current.status} for this source -- stop it first.")
    cursor = {"bulk": True} if bulk else {"queries": queries, "index": 0, "total": len(queries)}
    run = DataSourceRun(id=f"dsr_{uuid.uuid4().hex[:16]}", source_id=source.id, status="running", cursor=cursor)
    db.add(run)
    source.run_state = "running"
    source.last_error = ""
    await db.flush()
    return run


async def _process_one(db: AsyncSession, source: DataSource, query: str, *, scope: str = "leadgen") -> bool:
    """True if a record was actually saved for this query."""
    from app.services import business_records

    if source.kind == "api":
        from app.services import data_source_connector as connector

        hits = await connector.search(source, query)
        if not hits:
            return False
        profile = await connector.fetch_profile(source, hits[0])
        if not profile.get("name") and not profile.get("registration_number"):
            return False
        trust = (source.config or {}).get("trust_tier", "scraped")
        await business_records.upsert(db, source_id=source.id, source_type=source.kind, confidence_tier=trust, data=profile)
        return True
    from app.services import data_source_scraper

    profile = await data_source_scraper.run_source(db, source, query, scope=scope)
    if not profile:
        return False
    trust = (source.config or {}).get("trust_tier", "scraped")
    await business_records.upsert(db, source_id=source.id, source_type="scrape", confidence_tier=trust, data=profile)
    return True


async def run_batch(run_id: str) -> None:
    """The actual background loop -- runs detached from any HTTP request, so it opens its own
    sessions throughout rather than reusing the one from whichever endpoint started/resumed it."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    with system_scope():
        async with AsyncSessionLocal() as db:
            run = (await db.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
            if not run or run.status != "running":
                return
            source = (await db.execute(select(DataSource).where(DataSource.id == run.source_id))).scalars().first()
            if not source:
                return
        cursor: Dict[str, Any] = dict(run.cursor or {})
        queries, total = cursor.get("queries") or [], cursor.get("total") or 0
        delay = max(0, source.min_delay_ms or 0) / 1000.0

        i = cursor.get("index", 0)
        while i < len(queries):
            query = queries[i]
            logger.info(f"[data_sources] {source.name} run {run_id}: ({i + 1}/{total}) looking up \"{query}\"")
            async with AsyncSessionLocal() as db:
                live = (await db.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
                if not live or live.status != "running":
                    return  # paused or stopped elsewhere -- stop cleanly, cursor already saved
                try:
                    saved = await _process_one(db, source, query)
                except Exception as err:
                    logger.warning(f"[data_sources] {source.name} run {run_id} item '{query}' failed: {err}")
                    saved = False
                i += 1
                live.cursor = {**cursor, "index": i, "current": query}
                live.records_found += 1
                if saved:
                    live.records_new += 1
                live.updated_at = datetime.utcnow()
                logger.info(f"[data_sources] {source.name} run {run_id}: \"{query}\" -> {'saved' if saved else 'nothing found'}")
                if i >= len(queries):
                    live.status = "done"
                    live.finished_at = datetime.utcnow()
                    src = (await db.execute(select(DataSource).where(DataSource.id == source.id))).scalars().first()
                    if src:
                        src.run_state = "idle"
                    logger.info(f"[data_sources] {source.name} run {run_id}: done -- {live.records_new} new of {total} looked up.")
                await db.commit()
            if delay and i < len(queries):
                await asyncio.sleep(delay)


BULK_BATCH_SIZE = 500


async def run_bulk(run_id: str) -> None:
    """The background loop for a bulk-file source: streams every row the provider's own download
    publishes, in batches, with no company name ever typed by staff. Checks its own row's status
    between batches the same way run_batch does, so Pause/Stop work the same way -- Resume,
    though, restarts the file stream from the top rather than an exact row (there's no cheap way
    to resume partway through a remote zip's CSV stream); re-processed rows just upsert over
    themselves harmlessly since identity_hash dedup makes that safe, only slower."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services import business_records
    from app.services import data_source_connector as connector

    with system_scope():
        async with AsyncSessionLocal() as db:
            run = (await db.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
            if not run or run.status != "running":
                return
            source = (await db.execute(select(DataSource).where(DataSource.id == run.source_id))).scalars().first()
            if not source:
                return

        async def _finish(status: str, error: str = "") -> None:
            async with AsyncSessionLocal() as finish_db:
                live = (await finish_db.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
                if live:
                    live.status, live.error_message = status, error[:500]
                    live.finished_at = datetime.utcnow()
                src = (await finish_db.execute(select(DataSource).where(DataSource.id == source.id))).scalars().first()
                if src:
                    src.run_state, src.last_error = ("error" if error else "idle"), error[:500]
                await finish_db.commit()

        processed = 0
        batch: List[Dict[str, Any]] = []
        try:
            async for mapped in connector.stream_bulk_rows(source):
                batch.append(mapped)
                if len(batch) < BULK_BATCH_SIZE:
                    continue
                async with AsyncSessionLocal() as db:
                    live = (await db.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
                    if not live or live.status != "running":
                        return  # paused or stopped elsewhere
                    saved = await business_records.bulk_upsert(db, source_id=source.id, rows=batch)
                    processed += len(batch)
                    live.records_found, live.records_new = processed, live.records_new + saved
                    live.records_updated = (live.records_updated or 0) + (len(batch) - saved)
                    live.updated_at = datetime.utcnow()
                    await db.commit()
                logger.info(f"[data_sources] {source.name} bulk run {run_id}: {processed} processed so far")
                batch = []
            if batch:
                async with AsyncSessionLocal() as db:
                    live = (await db.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
                    if live and live.status == "running":
                        saved = await business_records.bulk_upsert(db, source_id=source.id, rows=batch)
                        processed += len(batch)
                        live.records_found, live.records_new = processed, live.records_new + saved
                        live.records_updated = (live.records_updated or 0) + (len(batch) - saved)
                        await db.commit()
        except Exception as err:
            logger.error(f"[data_sources] bulk import for {source.name} failed: {err}")
            await _finish("error", str(err))
            return
        await _finish("done")
        logger.info(f"[data_sources] {source.name} bulk run {run_id}: done -- {processed} row(s) processed.")


# ── The people job: read each company's directors (and owners) from the registry in the background ──────────────
PEOPLE_BATCH = 10
PEOPLE_MAX_LIMIT = 6_000_000
REGISTRY_CALLS_PER_5_MIN = 600  # Companies House's own limit for one key


def people_interval(share: int) -> float:
    """Seconds between calls so the job uses only `share` percent of the registry's 600 calls per 5 minutes; the rest is left for people
    opening companies in the app."""
    share = max(10, min(int(share or 75), 90))
    return 300.0 / (REGISTRY_CALLS_PER_5_MIN * share / 100.0)


def people_days(limit: int, share: int, owners: bool) -> float:
    """About how many days a job of this size takes."""
    calls = int(limit) * (2 if owners else 1)
    return calls / (REGISTRY_CALLS_PER_5_MIN * 12 * 24 * max(10, min(int(share or 75), 90)) / 100.0)


async def start_people_run(db: AsyncSession, source: DataSource, *, limit: int, share: int = 75, owners: bool = False) -> DataSourceRun:
    """Creates the run row for the people job (the caller commits, then spawns run_people). Same one-run-at-a-time rule as any source."""
    import uuid

    cfg = source.config or {}
    if not cfg.get("officers_endpoint"):
        raise ValueError("This source has no officers_endpoint, so there are no people to read.")
    if not source.api_key:
        raise ValueError("Save this source's API key first.")
    limit = int(limit or 0)
    if limit < 1 or limit > PEOPLE_MAX_LIMIT:
        raise ValueError(f"Choose how many companies to read, from 1 to {PEOPLE_MAX_LIMIT:,}.")
    current = await latest_run(db, source.id)
    if current and current.status in ACTIVE_STATUSES:
        raise ValueError(f"A run is already {current.status} for this source -- stop it first.")
    cursor = {"people": True, "job": "people", "limit": limit, "total": limit, "share": max(10, min(int(share or 75), 90)), "owners": bool(owners),
              "failed": 0, "waiting": ""}
    run = DataSourceRun(id=f"dsr_{uuid.uuid4().hex[:16]}", source_id=source.id, status="running", cursor=cursor)
    db.add(run)
    source.run_state = "running"
    source.last_error = ""
    await db.flush()
    return run


def _people_todo(skip: set):
    """The companies still to read: active, with a real registry number, never read, best-ranked first."""
    from app.models.models import BusinessRecord as B

    q = select(B).where(B.people_checked_at.is_(None), B.confidence_tier == "verified_registry", B.status.ilike("active%"),
                        B.registration_number.op("~")("^[A-Z0-9]{8}$"))
    if skip:
        q = q.where(B.id.notin_(skip))
    return q.order_by(B.rank_score.desc().nullslast(), B.id)


async def run_people(run_id: str) -> None:
    """The background loop for the people job. Reads one company at a time at a steady pace under the registry's limit, saves its officers
    (and owners) on the company, and marks it read even when it had none. Checks the run's status before every batch, so Pause and Stop
    work within seconds; starting again carries on from the next unread company because the mark on each company is the checkpoint."""
    import time

    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services import business_records
    from app.services import company_contacts as CC
    from app.services import data_source_connector as connector

    with system_scope():
        async with AsyncSessionLocal() as db:
            run = (await db.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
            if not run or run.status != "running":
                return
            source = (await db.execute(select(DataSource).where(DataSource.id == run.source_id))).scalars().first()
            if not source:
                return
        cursor: Dict[str, Any] = dict(run.cursor or {})
        limit, owners = int(cursor.get("limit") or 0), bool(cursor.get("owners"))
        pace = people_interval(cursor.get("share") or 75) * (2 if owners else 1)
        done, with_people, none_found, failed = int(run.records_found or 0), int(run.records_new or 0), int(run.records_updated or 0), int(cursor.get("failed") or 0)
        skip: set = set()
        in_a_row = 0

        async def _finish(status: str, error: str = "") -> None:
            async with AsyncSessionLocal() as fdb:
                live = (await fdb.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
                if live:
                    live.status, live.error_message, live.finished_at = status, error[:500], datetime.utcnow()
                src = (await fdb.execute(select(DataSource).where(DataSource.id == source.id))).scalars().first()
                if src:
                    src.run_state, src.last_error = ("error" if error else "idle"), error[:500]
                await fdb.commit()

        while done < limit:
            wait, fatal, last = 0.0, "", ""
            async with AsyncSessionLocal() as db:
                live = (await db.execute(select(DataSourceRun).where(DataSourceRun.id == run_id))).scalars().first()
                if not live or live.status != "running":
                    return  # paused or stopped elsewhere
                rows = (await db.execute(_people_todo(skip).limit(min(PEOPLE_BATCH, limit - done)))).scalars().all()
                if not rows:
                    break  # nothing left to read
                for biz in rows:
                    started = time.monotonic()
                    try:
                        got = await connector.fetch_people(source, biz.registration_number, owners=owners)
                    except connector.RateLimited as err:
                        wait = err.wait
                        break
                    except connector.KeyRejected as err:
                        fatal = str(err)
                        break
                    except connector.ConnectorError as err:
                        failed += 1
                        in_a_row += 1
                        skip.add(biz.id)
                        logger.warning(f"[data_sources] people run {run_id}: {biz.registration_number} failed: {err}")
                        if in_a_row >= 10:
                            fatal = f"Ten calls in a row failed, so the job stopped. Last error: {err}"
                            break
                        continue
                    in_a_row = 0
                    people = got.get("officers") or []
                    for o in people:
                        o["v"] = CC.PEOPLE_V
                    biz.officers = people
                    if owners:
                        biz.significant_control = got.get("significant_control") or []
                    biz.people_checked_at = datetime.utcnow()
                    business_records.refresh_rank(biz)
                    done += 1
                    with_people, none_found = with_people + (1 if people else 0), none_found + (0 if people else 1)
                    last = biz.name
                    spare = pace - (time.monotonic() - started)
                    if spare > 0:
                        await asyncio.sleep(spare)
                live.records_found, live.records_new, live.records_updated = done, with_people, none_found
                live.cursor = {**cursor, "failed": failed, "current": last or (cursor.get("current") or ""), "waiting": "the registry's limit" if wait else ""}
                live.updated_at = datetime.utcnow()
                await db.commit()
            if fatal:
                logger.error(f"[data_sources] people run {run_id} stopped: {fatal}")
                await _finish("error", fatal)
                return
            if wait:
                logger.info(f"[data_sources] people run {run_id}: at the registry's limit, waiting {wait:.0f}s")
                await asyncio.sleep(wait)
            if done and done % 1000 < PEOPLE_BATCH:
                logger.info(f"[data_sources] people run {run_id}: {done} of {limit} read")
        await _finish("done")
        logger.info(f"[data_sources] people run {run_id}: done -- {done} read, {with_people} with people, {none_found} with none, {failed} failed.")


async def pause_run(db: AsyncSession, source: DataSource) -> Optional[DataSourceRun]:
    run = await latest_run(db, source.id)
    if run and run.status == "running":
        run.status = "paused"
        source.run_state = "paused"
    return run


async def resume_run(db: AsyncSession, source: DataSource) -> Optional[DataSourceRun]:
    run = await latest_run(db, source.id)
    if run and run.status == "paused":
        run.status = "running"
        source.run_state = "running"
        await db.flush()
        c = run.cursor or {}
        spawn(run_people(run.id) if c.get("people") else run_bulk(run.id) if c.get("bulk") else run_batch(run.id))
    return run


async def stop_run(db: AsyncSession, source: DataSource) -> Optional[DataSourceRun]:
    run = await latest_run(db, source.id)
    if run and run.status in ACTIVE_STATUSES:
        run.status = "done"
        run.finished_at = datetime.utcnow()
        source.run_state = "idle"
    return run


async def recover_after_restart() -> int:
    """A run lives in this process, so a restart or rebuild ends it while the database still says "running" (it would sit there for
    STUCK_AFTER, then be flagged stuck). A people run keeps a checkpoint on every company it reads, so it carries on by itself; a
    batch or bulk run is paused for Resume instead of starting a long download unasked."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    again = 0
    with system_scope():
        async with AsyncSessionLocal() as db:
            runs = (await db.execute(select(DataSourceRun).where(DataSourceRun.status == "running"))).scalars().all()
            for run in runs:
                if (run.cursor or {}).get("people"):
                    again += 1
                    spawn(run_people(run.id))
                    continue
                run.status = "paused"
                source = (await db.execute(select(DataSource).where(DataSource.id == run.source_id))).scalars().first()
                if source:
                    source.run_state = "paused"
                    source.last_error = "The server restarted while this was running. Press Resume to carry on."
            await db.commit()
    return again


BULK_STUCK_AFTER = timedelta(hours=3)  # one file alone can take a while to download with no commit in between


async def check_stuck_runs(db: AsyncSession) -> List[str]:
    """Any run still "running" with no progress for STUCK_AFTER (longer for a bulk run -- see
    BULK_STUCK_AFTER) is marked stuck, its source is auto-paused, and staff are emailed once (see
    ai_errors.alert_staff's own de-dup) -- the same "never let one bad actor silently block
    everything" discipline platform_balances.py already applies to provider balance checks."""
    cutoff = datetime.utcnow() - STUCK_AFTER
    bulk_cutoff = datetime.utcnow() - BULK_STUCK_AFTER
    runs = (await db.execute(select(DataSourceRun).where(DataSourceRun.status == "running"))).scalars().all()
    runs = [r for r in runs if r.updated_at and r.updated_at < (bulk_cutoff if (r.cursor or {}).get("bulk") else cutoff)]
    flagged: List[str] = []
    for run in runs:
        run.status = "stuck"
        source = (await db.execute(select(DataSource).where(DataSource.id == run.source_id))).scalars().first()
        if source:
            threshold = BULK_STUCK_AFTER if (run.cursor or {}).get("bulk") else STUCK_AFTER
            source.run_state = "stuck"
            source.last_error = f"Run {run.id} made no progress for over {int(threshold.total_seconds() // 60)} minutes."
            flagged.append(source.name)
            try:
                from app.services.ai_errors import alert_staff

                await alert_staff("DS-01", f"{source.name}: {source.last_error}", ref=run.id)
            except Exception as err:  # the alert is a convenience; pausing the run matters more
                logger.warning(f"[data_sources] could not alert staff about {source.name}: {err}")
    if flagged:
        await db.commit()
    return flagged
