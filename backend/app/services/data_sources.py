"""Run-state housekeeping for DataSource batch crawls (see models.py: DataSource/DataSourceRun).

CRUD for a source itself lives in app.api.admin_portal (same inline AsyncSessionLocal pattern as
every other staff-only screen there); this file is only the watchdog that notices a batch run
has stalled, so a future bulk crawler's pause/resume/stop is actually safe to rely on -- a run
that silently died "running" forever would otherwise block that source until someone happens to
look at the admin screen.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import DataSource, DataSourceRun

logger = logging.getLogger("data_sources")

STUCK_AFTER = timedelta(minutes=30)


async def check_stuck_runs(db: AsyncSession) -> List[str]:
    """Any run still "running" with no progress for STUCK_AFTER is marked stuck, its source is
    auto-paused, and staff are emailed once (see ai_errors.alert_staff's own de-dup) -- the same
    "never let one bad actor silently block everything" discipline platform_balances.py already
    applies to provider balance checks."""
    cutoff = datetime.utcnow() - STUCK_AFTER
    runs = (await db.execute(
        select(DataSourceRun).where(DataSourceRun.status == "running", DataSourceRun.updated_at < cutoff)
    )).scalars().all()
    flagged: List[str] = []
    for run in runs:
        run.status = "stuck"
        source = (await db.execute(select(DataSource).where(DataSource.id == run.source_id))).scalars().first()
        if source:
            source.run_state = "stuck"
            source.last_error = f"Run {run.id} made no progress for over {int(STUCK_AFTER.total_seconds() // 60)} minutes."
            flagged.append(source.name)
            try:
                from app.services.ai_errors import alert_staff

                await alert_staff("DS-01", f"{source.name}: {source.last_error}", ref=run.id)
            except Exception as err:  # the alert is a convenience; pausing the run matters more
                logger.warning(f"[data_sources] could not alert staff about {source.name}: {err}")
    if flagged:
        await db.commit()
    return flagged
