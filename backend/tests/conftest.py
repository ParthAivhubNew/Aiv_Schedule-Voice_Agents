"""Test setup.

Unit tests need no database. Tests marked `db` run against the PostgreSQL database in
TEST_DATABASE_URL (it is wiped); without it they are skipped:

    TEST_DATABASE_URL=postgresql+asyncpg://user:pw@localhost/aiv_pytest pytest
"""
import os

import pytest

pytest_plugins = ["tests.voice_fakes"]  # the fake Telnyx fixtures (fake, signed)

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
    """Every test starts with an empty in-memory voice stack and no legacy stack file."""
    from app.services import voice_plugin_plan

    monkeypatch.setattr(voice_plugin_plan, "_stack", {})
    monkeypatch.setattr(voice_plugin_plan, "LEGACY_STACK_FILE", str(tmp_path / "active_voice_stack.json"))
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
    from app.core.tenancy import ensure_tenancy

    async with engine.begin() as conn:
        await ensure_tenancy(conn)
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
        # The default organisation always exists (the app creates it at startup).
        await conn.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES ('org_default', 'Default', 'default', 'active')"))
    from app.core import auth_middleware

    auth_middleware.forget()
    async with AsyncSessionLocal() as session:
        yield session


async def make_user(db, username, role="Operator", password="Str0ng-pass!", org_id="org_default", must_change=False):
    """A signed-in user: returns (operator, access token)."""
    import uuid
    from datetime import datetime, timedelta

    from app.core.accounts import assign_roles, ensure_system_roles
    from app.core.security import create_access_token, hash_password
    from app.models.models import AuthSession, Operator, Organization
    from sqlalchemy.future import select

    if not (await db.execute(select(Organization).where(Organization.id == org_id))).scalars().first():
        db.add(Organization(id=org_id, name=org_id, slug=org_id))
        await db.flush()
    roles = await ensure_system_roles(db, org_id)
    op = Operator(id=f"op_{username}", org_id=org_id, username=username, name=username.title(), role=role,
                  hashed_password=hash_password(password), is_active=True, must_change_password=must_change)
    db.add(op)
    await db.flush()
    await assign_roles(db, op, [roles[role].id])
    sid = f"ses_{uuid.uuid4().hex}"
    db.add(AuthSession(id=sid, operator_id=op.id, refresh_jti="x", expires_at=datetime.utcnow() + timedelta(days=1)))
    await db.commit()
    return op, create_access_token(op.id, org_id, role, sid)


@pytest.fixture
async def admin_token(db):
    _, token = await make_user(db, "boss", "Admin")
    return token


@pytest.fixture
async def client(db, admin_token):
    """API client signed in as an admin."""
    import httpx

    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                 headers={"Authorization": f"Bearer {admin_token}"}) as c:
        yield c


@pytest.fixture
async def anon(db):
    """API client that is not signed in."""
    import httpx

    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def make_staff(db, email="ops@outreach.test", role="staff_admin"):
    """A signed-in staff user of the admin portal (2FA already set up): returns its token."""
    import uuid

    from app.core.security import hash_password
    from app.core.staff import staff_token
    from app.models.models import StaffUser

    sid = f"stf_{uuid.uuid4().hex[:10]}"
    db.add(StaffUser(id=sid, email=email, name=email.split("@")[0], role=role,
                     hashed_password=hash_password("Staff-pass-2026"), totp_enabled=True))
    await db.commit()
    return staff_token(sid, role)


@pytest.fixture
async def staff(db):
    """API client signed in to the admin portal as a staff admin."""
    import httpx

    from app.main import app

    token = await make_staff(db)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                 headers={"Authorization": f"Bearer {token}"}) as c:
        yield c
