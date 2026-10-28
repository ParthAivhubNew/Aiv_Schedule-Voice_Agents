"""A new account made through a partner (credit limits switched off while the programme is free) can use every app."""
import httpx
import pytest

from app.core.tenancy import org_scope
from app.main import app
from app.services import credits as K
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def test_an_account_without_a_plan_or_credits_is_locked_unless_its_limits_are_off(db):
    _, token = await make_user(db, "free1", "Admin", org_id="org_new")
    async with _client(token) as c:
        locked = (await c.get("/api/billing/access")).json()["has_active_plan"]
        assert locked and not any(locked.values())  # no plan, no credits: apps are locked
        with org_scope("org_new"):
            await K.set_org_settings(db, {"enforce": False}, "org_new")
            await db.commit()
        open_ = (await c.get("/api/billing/access")).json()["has_active_plan"]
        assert open_ and all(open_.values())  # limits off (a partner's free account): every app is open
