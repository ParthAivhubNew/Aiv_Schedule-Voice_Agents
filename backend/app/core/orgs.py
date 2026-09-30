"""Organisations known to the app (used by background jobs that work for every organisation)."""
from __future__ import annotations

from typing import List

from sqlalchemy import text

from app.core.tenancy import DEFAULT_ORG, system_scope


async def active_org_ids() -> List[str]:
    from app.database import AsyncSessionLocal

    try:
        with system_scope():
            async with AsyncSessionLocal() as db:
                rows = (await db.execute(text("SELECT id FROM organizations WHERE coalesce(status, 'active') = 'active' ORDER BY id"))).scalars().all()
        return list(rows) or [DEFAULT_ORG]
    except Exception:
        return [DEFAULT_ORG]
