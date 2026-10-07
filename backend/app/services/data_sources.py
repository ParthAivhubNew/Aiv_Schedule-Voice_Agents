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
        spawn(run_bulk(run.id) if (run.cursor or {}).get("bulk") else run_batch(run.id))
    return run


async def stop_run(db: AsyncSession, source: DataSource) -> Optional[DataSourceRun]:
    run = await latest_run(db, source.id)
    if run and run.status in ACTIVE_STATUSES:
        run.status = "done"
        run.finished_at = datetime.utcnow()
        source.run_state = "idle"
    return run


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
