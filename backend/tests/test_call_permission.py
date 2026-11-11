"""Permission for AI-voiced calls, TPS flags for human calls, and the fail-closed rule (PECR)."""
from datetime import datetime, timedelta

import pytest

from app.models.models import Operator
from app.services import call_permission as CP, compliance, credits as K

pytestmark = pytest.mark.db

NUM = "+447700900123"
NOW = datetime(2026, 10, 6, 10, 0)  # a Tuesday morning in London


@pytest.fixture(autouse=True)
async def _open_hours(db):
    from app.models.models import AppSetting

    await K.set_org_settings(db, {"enforce": False})  # these tests are about permission, not credits
    db.add(AppSetting(id="compliance", data={"mode": "off"}))
    await db.commit()


async def _consent(db, number=NUM):
    out = await CP.record_consent(db, number=number, company="Acme Ltd", product="bookkeeping", method="web_form", recorded_by="Sam")
    await db.commit()
    return out


async def test_ai_refused_without_consent(db):
    gate = await compliance.check_call_allowed(db, NUM, NOW)
    assert not gate.allowed
    assert gate.needs == "ai_consent"
    assert CP.NO_AI_PERMISSION in gate.reasons


async def test_ai_allowed_with_consent(db):
    await _consent(db)
    gate = await compliance.check_call_allowed(db, "07700 900123", NOW)  # a different way of writing the same number
    assert gate.allowed and gate.needs == ""


async def test_withdrawn_consent_refuses(db):
    c = await _consent(db)
    await CP.withdraw_consent(db, c["id"], by="Sam", method="phone")
    await db.commit()
    gate = await compliance.check_call_allowed(db, NUM, NOW)
    assert not gate.allowed and gate.needs == "ai_consent"
    assert (await CP.list_consents(db))[0]["withdrawn_at"]  # the record stays


async def test_consent_keeps_the_exact_wording(db):
    c = await _consent(db)
    assert c["wording_text"].startswith("I agree that Acme Ltd may call me on +447700900123 with automated or AI-voiced calls about bookkeeping.")
    assert c["wording_version"] == CP.WORDING_VERSION


async def test_human_unknown_flags_check_tps(db):
    gate = await compliance.check_call_allowed(db, NUM, NOW, kind="human")
    assert gate.allowed
    assert "check_tps" in gate.flags
    assert CP.CHECK_TPS in gate.warnings


async def test_human_listed_refused(db):
    await CP.save_screening(db, NUM, "listed", provider_name="test", now=NOW - timedelta(days=2))
    await db.commit()
    gate = await compliance.check_call_allowed(db, NUM, NOW, kind="human")
    assert not gate.allowed
    assert CP.TPS_LISTED in gate.reasons


async def test_human_listed_but_consented_is_allowed(db):
    await CP.save_screening(db, NUM, "listed", provider_name="test", now=datetime.utcnow())
    await _consent(db)
    assert (await compliance.check_call_allowed(db, NUM, NOW, kind="human")).allowed


async def test_rescreen_after_28_days_is_stale(db):
    await CP.save_screening(db, NUM, "clear", provider_name="test", now=NOW - timedelta(days=27))
    await db.commit()
    assert (await CP.status(db, NUM, NOW))["fresh"]
    assert (await CP.decide(db, NUM, "human", NOW))["flags"] == []
    stale = NOW + timedelta(days=2)
    assert not (await CP.status(db, NUM, stale))["fresh"]
    assert "check_tps" in (await CP.decide(db, NUM, "human", stale))["flags"]


async def test_own_number_allowed(db):
    db.add(Operator(id="op1", username="sam", name="Sam", hashed_password="x", phone="07700 900555"))
    await db.commit()
    assert (await compliance.check_call_allowed(db, "+447700900555", NOW)).allowed


async def test_check_fails_closed_for_ai(db, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("database hiccup")

    monkeypatch.setattr(CP, "decide", boom)
    ai = await compliance.check_call_allowed(db, NUM, NOW)
    assert not ai.allowed and ai.needs == "ai_consent"
    human = await compliance.check_call_allowed(db, NUM, NOW, kind="human")  # a person's call is not stopped by a failed lookup
    assert human.allowed and "check_tps" in human.flags


async def test_opted_out_still_refused_first(db):
    from app.models.models import ContactRegistry

    db.add(ContactRegistry(id="r1", canonical_name="X", phones=[NUM], do_not_call=True))
    await _consent(db)
    await db.commit()
    gate = await compliance.check_call_allowed(db, NUM, NOW)
    assert not gate.allowed and "opted out" in gate.reasons[0]


async def test_plan_calls_skips_without_permission(db):
    from app.models.models import LeadAccount
    from app.services import lead_calls

    db.add(LeadAccount(id="la_1", name="Acme", phone=NUM))
    db.add(LeadAccount(id="la_2", name="Beta", phone="+447700900124"))
    await db.commit()
    await _consent(db, "+447700900124")
    from sqlalchemy.future import select

    leads = (await db.execute(select(LeadAccount).order_by(LeadAccount.id))).scalars().all()
    plan = await lead_calls.plan_calls(db, leads)
    assert plan["skipped"]["no_call_permission"] == ["la_1"]
    assert plan["callable"] == ["la_2"]


async def test_withdraw_route_and_customer_withdraw(db):
    import httpx

    from app.main import app
    from app.services import eligibility as EL
    from tests.conftest import make_user

    _, token = await make_user(db, "admin", role="Admin")
    h = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/api/voice/call-permissions", headers=h, json={"number": NUM, "company": "Acme", "method": "email"})
        assert r.status_code == 200, r.text
        pid = r.json()["permission"]["id"]
        assert (await c.get(f"/api/voice/call-permissions?number={NUM}", headers=h)).json()["ai"]["allowed"]
        assert (await c.post(f"/api/voice/call-permissions/{pid}/withdraw", headers=h, json={})).status_code == 200
        assert not (await c.get(f"/api/voice/call-permissions?number={NUM}", headers=h)).json()["ai"]["allowed"]
        assert (await c.post("/api/voice/call-permissions", headers=h, json={"number": "12", "company": "Acme"})).status_code == 400
        gone = await c.post("/api/leads/consent/cd_missing/withdraw", headers=h, json={})
        assert gone.status_code == 404
    assert EL.revoke  # the customer route reuses the staff revoke
