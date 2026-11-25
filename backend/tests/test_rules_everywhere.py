"""Plan 12, step 4: the company's rules hold on every sign-in, not only on the brand's own web address, and Voice names the screening rule
(calls to an unscreened number are warned, never blocked: decided 2026-11-25)."""
import json

import httpx
import pytest
from sqlalchemy import select, text

from app.main import app
from app.services import tenant_policy as TP
from tests.conftest import make_user


async def _rules(db, policy):
    await db.execute(text("UPDATE organizations SET policy = CAST(:p AS JSON) WHERE id = 'org_default'"), {"p": json.dumps(policy)})
    await db.commit()
    TP.invalidate()


@pytest.fixture
async def anon_client(db):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
    TP.invalidate()


async def test_a_company_that_switches_passwords_off_refuses_them_on_every_address(db, anon_client):
    await make_user(db, "pat", "Operator")
    ok = await anon_client.post("/api/auth/login", json={"username": "pat", "password": "Str0ng-pass!"})
    assert ok.status_code == 200, ok.text
    await _rules(db, {"signin": {"password": False, "google": True}})
    refused = await anon_client.post("/api/auth/login", json={"username": "pat", "password": "Str0ng-pass!"})
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "signin_method_off" and "Sign in with Google" in refused.json()["detail"]["message"]


async def test_a_session_a_switched_off_method_began_ends_at_its_next_refresh(db, anon_client):
    from app.models.models import AuthSession

    await make_user(db, "pat", "Operator")
    signed = (await anon_client.post("/api/auth/login", json={"username": "pat", "password": "Str0ng-pass!"})).json()
    ses = (await db.execute(select(AuthSession).where(AuthSession.operator_id == "op_pat", AuthSession.method == "password"))).scalars().first()
    assert ses is not None  # the session remembers how it began
    again = await anon_client.post("/api/auth/refresh", json={"refresh_token": signed["refresh_token"]})
    assert again.status_code == 200, again.text
    await _rules(db, {"signin": {"password": False}})
    gone = await anon_client.post("/api/auth/refresh", json={"refresh_token": again.json()["refresh_token"]})
    assert gone.status_code == 401 and "sign-in rules changed" in gone.json()["detail"]
    await db.refresh(ses)
    assert ses.revoked_at is not None


async def test_the_brands_rule_holds_for_its_companies_too(db):
    from app.api.auth import signin_refusal
    from app.models.models import Operator

    await db.execute(text("INSERT INTO brands (id, name, display_name, policy, status) VALUES ('brd_x', 'X', 'X Ltd', CAST(:p AS JSON), 'active')"),
                     {"p": json.dumps({"signin": {"google": False}})})
    await db.execute(text("UPDATE organizations SET brand_id = 'brd_x' WHERE id = 'org_default'"))
    await db.commit()
    TP.invalidate()
    op, _ = await make_user(db, "pat", "Operator")
    op = (await db.execute(select(Operator).where(Operator.id == "op_pat"))).scalars().first()
    try:
        assert "don't allow signing in with Google" in await signin_refusal(db, op, "google")
        assert await signin_refusal(db, op, "password") == ""
        assert await signin_refusal(db, op, "") == ""  # nothing to check
    finally:
        TP.invalidate()


async def test_voice_names_the_screening_rule_but_still_lets_the_call_go(db):
    from datetime import datetime

    from app.core.tenancy import org_scope
    from app.services import call_permission as CP

    num, now = "+447700900321", datetime(2026, 10, 6, 10, 0)
    with org_scope("org_default"):
        plain = await CP.decide(db, num, "human", now)
        assert plain["allowed"] is True and plain["warnings"] == [CP.CHECK_TPS]
        await _rules(db, {"screening": {"block_unscreened": True}})
        try:
            ruled = await CP.decide(db, num, "human", now)
        finally:
            TP.invalidate()
    assert ruled["allowed"] is True and "check_tps" in ruled["flags"] and ruled["warnings"] == [CP.CHECK_TPS_RULE]
