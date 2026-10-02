"""OutReach (the software owner) versus client companies.

The platform record ("org_outreach" unless PLATFORM_ORG_ID says otherwise) is not a company:
nobody signs in to it and it is never listed as a client. It only holds the provider keys and
connections (AI, voice, Telnyx...) every company uses, managed in the admin portal. Every real
company, including Aivhub (the original "org_default"), is a normal paying client.
"""
from __future__ import annotations

import logging
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger("platform")

PLATFORM_DEFAULT = "org_outreach"
PLATFORM_NAME = "OutReach platform"
PLATFORM_STATUS = "platform"  # never "active": not a client, skipped by every client loop
AIVHUB_ORG = "org_default"
DEMO_CREDITS = 500  # per app, once, so Aivhub can be shown to clients


def platform_org_id() -> str:
    return (os.getenv("PLATFORM_ORG_ID") or PLATFORM_DEFAULT).strip() or PLATFORM_DEFAULT


def provider_groups():
    from app.core.tenancy import SHARED_PROVIDER_GROUPS

    return list(SHARED_PROVIDER_GROUPS)


async def split_platform(conn: AsyncConnection) -> None:
    """Migration: create the platform record and move the provider keys Aivhub held (it used to
    be the platform) to it, so they keep working for everyone. Aivhub keeps its own mailboxes,
    calendars and data, and gets its real name."""
    platform = platform_org_id()
    try:
        await conn.execute(text("ALTER TABLE connections ADD COLUMN IF NOT EXISTS org_id VARCHAR DEFAULT 'org_default'"))
        await conn.execute(text("UPDATE connections SET org_id = 'org_default' WHERE org_id IS NULL"))
    except Exception:
        pass
    await conn.execute(text(
        "INSERT INTO organizations (id, name, slug, status) VALUES (:i, :n, 'outreach-platform', :s) "
        "ON CONFLICT (id) DO UPDATE SET status = :s"), {"i": platform, "n": PLATFORM_NAME, "s": PLATFORM_STATUS})
    if platform != AIVHUB_ORG:
        groups = provider_groups()
        params = {f"g{i}": g for i, g in enumerate(groups)}
        names = ", ".join(f":g{i}" for i in range(len(groups)))
        moved = await conn.execute(text(
            f"UPDATE connections SET org_id = :p WHERE org_id = :a AND group_name IN ({names})"),
            {"p": platform, "a": AIVHUB_ORG, **params})
        logger.info(f"[platform] moved {moved.rowcount} provider connections from Aivhub to the platform")
    await conn.execute(text(
        "UPDATE organizations SET name = 'Aivhub', slug = 'aivhub' "
        "WHERE id = :a AND name IN ('Default Organization', 'Default', 'default', 'org_default')"), {"a": AIVHUB_ORG})


async def ensure_aivhub_ready() -> None:
    """Once: Aivhub pays like every company (stop at zero) and gets demo credits in each app.
    Its users and passwords are its own, like any company's (staff can reset one in /admin)."""
    from app.core.tenancy import org_scope, system_scope
    from app.database import AsyncSessionLocal
    from app.services import credits as K

    if platform_org_id() == AIVHUB_ORG:
        return
    with system_scope():
        async with AsyncSessionLocal() as db:
            exists = (await db.execute(text("SELECT 1 FROM organizations WHERE id = :a"), {"a": AIVHUB_ORG})).first()
            done = await K._get_doc(db, "aivhub_demo_setup")
    if not exists:
        return
    if not done.get("credits"):
        with org_scope(AIVHUB_ORG):
            async with AsyncSessionLocal() as db:
                for wallet in K.WALLETS:
                    await K.grant(db, DEMO_CREDITS, note="Demo credits from OutReach", by="OutReach", wallet=wallet)
                await K.set_org_settings(db, {"enforce": True}, AIVHUB_ORG)
                await db.commit()
        with system_scope():
            async with AsyncSessionLocal() as db:
                await K._put_doc(db, "aivhub_demo_setup", {**done, "credits": True})
                await db.commit()
        logger.info(f"[platform] Aivhub: {DEMO_CREDITS} demo credits in each app, stop at zero on")

