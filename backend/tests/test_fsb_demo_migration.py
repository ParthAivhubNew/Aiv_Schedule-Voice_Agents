"""The FSB demo account step runs at every startup inside one shared transaction: it must create the account when it does not exist yet
(the case on a server that never ran the seed) and a failure in it must never stop the app from starting."""
import pytest
from sqlalchemy import text

from app.core import migrations as M

pytestmark = pytest.mark.db


async def test_the_demo_operator_is_created_when_missing_and_startup_can_carry_on(schema):
    from app.database import engine

    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM operator_roles WHERE operator_id IN (SELECT id FROM operators WHERE LOWER(username) IN ('fsbdemo', 'fsboutreach'))"))
        await conn.execute(text("DELETE FROM operators WHERE LOWER(username) IN ('fsbdemo', 'fsboutreach')"))
        await M._ensure_fsb_demo_operator(conn)
        await conn.execute(text("SELECT 1"))  # the startup transaction is still usable afterwards
        row = (await conn.execute(text("SELECT role, is_active, email FROM operators WHERE username = 'fsbdemo'"))).first()
    assert row is not None and row[0] == "Admin" and row[1] is True and row[2] == "fsbdemo@outreach.com"


async def test_a_failure_in_the_step_is_skipped_and_does_not_abort_the_startup_transaction(schema, monkeypatch):
    from app.database import engine

    async def broken(conn):
        await conn.execute(text("SELECT * FROM table_that_does_not_exist"))

    monkeypatch.setattr(M, "_fsb_demo_operator", broken)
    async with engine.begin() as conn:
        await M._ensure_fsb_demo_operator(conn)  # logs a warning and carries on
        assert (await conn.execute(text("SELECT 1"))).scalar() == 1
        await conn.execute(text("CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR PRIMARY KEY, applied_at TIMESTAMP NOT NULL)"))
