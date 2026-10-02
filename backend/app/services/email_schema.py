"""Columns added to the email outreach tables after they first shipped.

create_all makes new tables but never changes existing ones, so a database created with the
first version gets the later columns here (idempotent; runs at every startup).
"""
from __future__ import annotations

import logging

from sqlalchemy import text

logger = logging.getLogger("email_schema")

_COLUMNS = {
    "email_mailboxes": [
        ("last_error", "TEXT DEFAULT ''"), ("signature", "TEXT DEFAULT ''"),
        ("imap_last_uid", "INTEGER DEFAULT 0"), ("plan_date", "VARCHAR DEFAULT ''"),
        ("warmup_quota", "INTEGER DEFAULT 0"), ("campaign_quota", "INTEGER DEFAULT 0"),
        ("last_sent_at", "TIMESTAMP"),
    ],
    "email_messages": [("enrollment_id", "VARCHAR DEFAULT ''"), ("reply_from", "VARCHAR DEFAULT ''")],
    "email_sequence_steps": [("org_id", "VARCHAR")],
    "email_enrollments": [
        ("email", "VARCHAR DEFAULT ''"), ("first_name", "VARCHAR DEFAULT ''"), ("last_name", "VARCHAR DEFAULT ''"),
        ("company", "VARCHAR DEFAULT ''"), ("mailbox_id", "VARCHAR DEFAULT ''"),
        ("last_message_id", "VARCHAR DEFAULT ''"), ("last_subject", "TEXT DEFAULT ''"),
    ],
    "person_cache": [("source", "VARCHAR DEFAULT ''")],
}


async def ensure_email_schema(conn) -> None:
    if conn.dialect.name != "postgresql":
        return
    for table, cols in _COLUMNS.items():
        for name, ddl in cols:
            try:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {ddl}"))
            except Exception as err:
                logger.warning(f"[Email] {table}.{name} not added: {err}")
    # Leads no longer have to be voice prospects (cold email leads carry their own address).
    try:
        await conn.execute(text("ALTER TABLE email_enrollments ALTER COLUMN prospect_id DROP NOT NULL"))
        await conn.execute(text("ALTER TABLE email_enrollments DROP CONSTRAINT IF EXISTS email_enrollments_prospect_id_fkey"))
    except Exception as err:
        logger.warning(f"[Email] enrollment prospect link not relaxed: {err}")
    # Step rows follow their campaign's organisation.
    try:
        await conn.execute(text(
            "UPDATE email_sequence_steps s SET org_id = c.org_id FROM email_campaigns c "
            "WHERE s.campaign_id = c.id AND s.org_id IS NULL"))
    except Exception as err:
        logger.warning(f"[Email] step organisations not filled: {err}")
