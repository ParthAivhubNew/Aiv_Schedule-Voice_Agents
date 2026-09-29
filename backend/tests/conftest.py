"""Test setup.

Unit tests need no database. Tests marked `db` run against the PostgreSQL database in
TEST_DATABASE_URL (it is wiped); without it they are skipped:

    TEST_DATABASE_URL=postgresql+asyncpg://user:pw@localhost/aiv_pytest pytest
"""
import os

import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL", "")
# The app builds its engine at import time; a placeholder URL is fine for unit tests
# (nothing connects until a query runs).
os.environ["DATABASE_URL"] = TEST_DB or "postgresql+asyncpg://unused:unused@localhost:1/unused"
os.environ.setdefault("SECRET_KEY", "test-secret-key")


def pytest_collection_modifyitems(config, items):
    if TEST_DB:
        return
    skip = pytest.mark.skip(reason="set TEST_DATABASE_URL to run database tests")
    for item in items:
        if "db" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def isolated_voice_stack(tmp_path, monkeypatch):
    """Every test gets its own active voice stack file."""
    from app.services import voice_plugin_plan

    monkeypatch.setattr(voice_plugin_plan, "ACTIVE_STACK_FILE", str(tmp_path / "active_voice_stack.json"))
    yield


@pytest.fixture(scope="session")
async def schema():
    """Create all tables once (fresh) for the database tests."""
    from app.database import engine
    from app.database import Base
    import app.models.models  # noqa: F401  (registers every table)
    from app.api.scheduler import ensure_social_schema

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await ensure_social_schema()
    yield
    await engine.dispose()


@pytest.fixture
async def db(schema):
    """A session on a clean database (all tables emptied before the test)."""
    from sqlalchemy import text

    from app.database import AsyncSessionLocal, engine
    from app.database import Base
    import app.models.models  # noqa: F401  (registers every table)

    async with engine.begin() as conn:
        names = ", ".join(t.name for t in Base.metadata.sorted_tables)
        await conn.execute(text(f"TRUNCATE {names} CASCADE"))
    async with AsyncSessionLocal() as session:
        yield session
