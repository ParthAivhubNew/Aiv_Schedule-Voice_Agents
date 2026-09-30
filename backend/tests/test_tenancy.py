"""Organisations never see or change each other's data (row-level security)."""
import pytest
from sqlalchemy.future import select

from tests.conftest import make_user

pytestmark = pytest.mark.db


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


async def test_database_only_shows_the_current_orgs_rows(db):
    from app.core.tenancy import org_scope, system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import CallLog, Organization

    db.add(Organization(id="org_b", name="B", slug="b"))
    await db.commit()
    with org_scope("org_default"):
        async with AsyncSessionLocal() as s:
            s.add(CallLog(id="cl_a", canonical_name="A", listed_as="A", started_at="", ended_at=""))
            await s.commit()
    with org_scope("org_b"):
        async with AsyncSessionLocal() as s:
            s.add(CallLog(id="cl_b", canonical_name="B", listed_as="B", started_at="", ended_at=""))
            await s.commit()
            rows = (await s.execute(select(CallLog))).scalars().all()
            assert [r.id for r in rows] == ["cl_b"] and rows[0].org_id == "org_b"
            # Another org's row cannot be changed or deleted, even by id.
            from sqlalchemy import delete, update
            await s.execute(update(CallLog).where(CallLog.id == "cl_a").values(outcome="hacked"))
            await s.execute(delete(CallLog).where(CallLog.id == "cl_a"))
            await s.commit()
    with system_scope():
        async with AsyncSessionLocal() as s:
            a = (await s.execute(select(CallLog).where(CallLog.id == "cl_a"))).scalars().first()
            assert a is not None and a.outcome != "hacked"


async def test_writing_into_another_org_is_refused(db):
    from sqlalchemy.exc import DBAPIError

    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import CallLog, Organization

    db.add(Organization(id="org_b", name="B", slug="b"))
    await db.commit()
    with org_scope("org_b"):
        async with AsyncSessionLocal() as s:
            s.add(CallLog(id="cl_x", org_id="org_default", canonical_name="X", listed_as="X", started_at="", ended_at=""))
            with pytest.raises(DBAPIError):
                await s.commit()


async def test_two_orgs_through_the_api(anon, db):
    from app.models.models import CallLog, Organization

    db.add(Organization(id="org_b", name="B", slug="b"))
    await db.commit()
    _, tok_a = await make_user(db, "alice", "Admin", org_id="org_default")
    _, tok_b = await make_user(db, "bob", "Admin", org_id="org_b")

    # Same fixed-id settings row exists once per organisation.
    r = await anon.put("/api/profile", json={"name": "Alpha Ltd"}, headers=_h(tok_a))
    assert r.status_code == 200, r.text
    r = await anon.put("/api/profile", json={"name": "Beta Ltd"}, headers=_h(tok_b))
    assert r.status_code == 200, r.text
    assert (await anon.get("/api/profile", headers=_h(tok_a))).json()["name"] == "Alpha Ltd"
    assert (await anon.get("/api/profile", headers=_h(tok_b))).json()["name"] == "Beta Ltd"

    # Posts made by org A are invisible to org B.
    body = {"id": "v2_iso", "title": "A only", "copy": "x", "channels": ["linkedin"], "status": "awaiting_approval",
            "date": "2030-01-10", "time": "09:00"}
    assert (await anon.post("/api/scheduler/posts/create", json=body, headers=_h(tok_a))).status_code == 200
    posts_b = (await anon.get("/api/scheduler/posts", headers=_h(tok_b))).json()
    listed = posts_b.get("posts", posts_b) if isinstance(posts_b, dict) else posts_b
    assert all(p.get("id") != "v2_iso" for p in listed)
    assert (await anon.patch("/api/scheduler/posts/v2_iso", json={"copy": "B edit"}, headers=_h(tok_b))).status_code in (403, 404)

    # Users of org A are not listed for org B.
    names = [u["username"] for u in (await anon.get("/api/auth/users", headers=_h(tok_b))).json()]
    assert "alice" not in names and "bob" in names

    # Analytics only counts the org's own calls.
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal

    with org_scope("org_default"):
        async with AsyncSessionLocal() as s:
            s.add(CallLog(id="cl_api", canonical_name="A", listed_as="A", started_at="", ended_at="", outcome="meeting_booked"))
            await s.commit()
    a = (await anon.get("/api/analytics/overview", headers=_h(tok_a))).json()["current"]["calls"]
    b = (await anon.get("/api/analytics/overview", headers=_h(tok_b))).json()["current"]["calls"]
    assert a == 1 and b == 0
