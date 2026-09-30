"""One database, many organisations, each seeing only its own rows.

How it works
- Every tenant table has an org_id column. Its database default is the current organisation,
  so code that inserts rows does not need to set it.
- PostgreSQL row-level security (RLS) on each tenant table only shows and accepts rows whose
  org_id equals the session setting app.org_id. Application sessions run as the role
  outreach_app, which RLS applies to (the connecting superuser/owner would bypass it).
- Which organisation a session belongs to comes from a context variable: the auth middleware
  sets it from the signed-in user; background jobs and webhooks set it with org_scope().
  Code that must see every organisation (e.g. a job queue picking the next job) uses
  system_scope(); then no role switch happens.

So a missed filter in any query can never leak another organisation's data.
"""
from __future__ import annotations

import contextvars
import logging
from contextlib import contextmanager
from typing import Iterator, List

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger("tenancy")

DEFAULT_ORG = "org_default"
APP_ROLE = "outreach_app"
SYSTEM = "*"

_current_org: contextvars.ContextVar[str] = contextvars.ContextVar("current_org", default=DEFAULT_ORG)

# Tables whose rows belong to one organisation.
TENANT_TABLES: List[str] = [
    "company_profile", "knowledge_sources", "knowledge_chunks", "services", "faqs", "connections",
    "contact_registry", "missions", "prospects", "live_calls", "call_logs", "meetings",
    "meeting_event_types", "calcom_settings", "schedule_items", "notifications", "voices",
    "social_schedules", "social_posts", "social_post_versions", "social_gen_jobs",
    "scheduler_settings", "social_accounts", "social_oauth_states", "social_emails",
    "process_logs", "conversation_templates", "conversation_variables", "org_phone_numbers",
    "credit_ledger", "org_telnyx", "verification_submissions", "number_orders",
    "whatsapp_threads", "whatsapp_messages", "credit_grants", "billing_subscriptions",
]
# Tables that keep one row per organisation under a fixed id (e.g. id "default").
PER_ORG_SINGLETONS = ["company_profile", "calcom_settings", "scheduler_settings", "conversation_templates"]

ORG_DEFAULT_SQL = f"coalesce(nullif(current_setting('app.org_id', true), ''), '{DEFAULT_ORG}')"


def current_org() -> str:
    org = _current_org.get()
    return DEFAULT_ORG if org in ("", SYSTEM, "default", None) else org


def is_system() -> bool:
    return _current_org.get() == SYSTEM


def set_org(org_id: str) -> contextvars.Token:
    return _current_org.set(org_id or DEFAULT_ORG)


@contextmanager
def org_scope(org_id: str) -> Iterator[None]:
    token = _current_org.set(org_id or DEFAULT_ORG)
    try:
        yield
    finally:
        _current_org.reset(token)


@contextmanager
def system_scope() -> Iterator[None]:
    token = _current_org.set(SYSTEM)
    try:
        yield
    finally:
        _current_org.reset(token)


async def in_org(org_id: str, coro):
    """Await coro with org_id as the current organisation (for tasks spawned by system jobs)."""
    with org_scope(org_id):
        return await coro


_rls_ready = False


def install_session_hook(session_class) -> None:
    """Every transaction of an app session starts with the organisation setting and role."""

    @event.listens_for(session_class, "after_begin")
    def _after_begin(session, transaction, connection):  # noqa: ANN001
        if not _rls_ready or connection.dialect.name != "postgresql":
            return
        org = _current_org.get()
        if org == SYSTEM:
            connection.exec_driver_sql("SELECT set_config('app.org_id', '', true)")
            return
        connection.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": org or DEFAULT_ORG})
        connection.exec_driver_sql(f"SET LOCAL ROLE {APP_ROLE}")


async def _table_exists(conn: AsyncConnection, name: str) -> bool:
    return bool((await conn.execute(text("SELECT to_regclass(:n)"), {"n": f"public.{name}"})).scalar())


async def ensure_tenancy(conn: AsyncConnection) -> None:
    """Idempotent: org_id columns, per-org keys, the app role, grants and RLS policies.
    Runs at every startup (after create_all) so new tables are covered too."""
    global _rls_ready
    if conn.dialect.name != "postgresql":
        return
    await conn.execute(text(f"""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
            CREATE ROLE {APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
          END IF;
        END $$;"""))
    await conn.execute(text(f"GRANT {APP_ROLE} TO CURRENT_USER"))
    await conn.execute(text(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}"))
    await conn.execute(text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE}"))
    await conn.execute(text(f"GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE}"))

    for table in TENANT_TABLES:
        if not await _table_exists(conn, table):
            continue
        await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS org_id VARCHAR"))
        await conn.execute(text(f"UPDATE {table} SET org_id = '{DEFAULT_ORG}' WHERE org_id IS NULL OR org_id IN ('', 'default')"))
        await conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN org_id SET DEFAULT {ORG_DEFAULT_SQL}"))
        await conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN org_id SET NOT NULL"))
        await conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_org_id ON {table} (org_id)"))
        await conn.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
        await conn.execute(text(f"DROP POLICY IF EXISTS org_isolation ON {table}"))
        await conn.execute(text(
            f"CREATE POLICY org_isolation ON {table} "
            f"USING (org_id = current_setting('app.org_id', true)) "
            f"WITH CHECK (org_id = current_setting('app.org_id', true))"
        ))

    # Fixed-id rows (id = "default") exist once per organisation.
    for table in PER_ORG_SINGLETONS:
        if not await _table_exists(conn, table):
            continue
        cols = (await conn.execute(text(
            "SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
            "WHERE i.indrelid = CAST(:t AS regclass) AND i.indisprimary"), {"t": table})).scalars().all()
        if set(cols) == {"id"}:
            await conn.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_pkey"))
            await conn.execute(text(f"ALTER TABLE {table} ADD PRIMARY KEY (id, org_id)"))

    # Names that were unique across the whole app are unique per organisation.
    if await _table_exists(conn, "meeting_event_types"):
        await conn.execute(text("DROP INDEX IF EXISTS ix_meeting_event_types_slug"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_meeting_event_types_slug ON meeting_event_types (slug)"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_event_types_org_slug ON meeting_event_types (org_id, slug)"))
    if await _table_exists(conn, "voices"):
        await conn.execute(text("ALTER TABLE voices DROP CONSTRAINT IF EXISTS uq_voices_provider_voice"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_voices_org_provider_voice ON voices (org_id, provider, voice_id)"))
    _rls_ready = True
    logger.info("Organisation isolation (row-level security) is active on %d tables.", len(TENANT_TABLES))


def mark_ready(value: bool = True) -> None:
    global _rls_ready
    _rls_ready = value
