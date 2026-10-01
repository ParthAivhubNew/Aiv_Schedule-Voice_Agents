"""Revenue and cost breakdown (admin portal), and lead generation charged per lead found."""
from datetime import datetime

import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


async def test_revenue_usage_costs_and_margin_per_client(staff, db):
    from app.core.tenancy import org_scope
    from app.services import credits as K

    month = datetime.utcnow().strftime("%Y-%m")
    await make_user(db, "acme_admin", "Admin", org_id="org_acme")
    with org_scope("org_acme"):
        await K.add_credits(db, "voice", 1000, source="plan", note="Plan", paid_cents=4900, paid_currency="gbp")
        await K.add_credits(db, "scheduler", 100, source="topup", note="Top-up", paid_cents=900, paid_currency="gbp")
        await K.charge(db, "voice_minute", 30, "call:a")
        await K.charge(db, "ai_post", 5, "gen:1")
        await db.commit()

    r = await staff.put("/api/admin-api/unit-costs", json={"currency": "gbp", "costs": {"voice_minute": 2.5, "ai_post": 4, "nope": 9}})
    assert r.status_code == 200 and r.json()["costs"]["voice_minute"] == 2.5 and "nope" not in r.json()["costs"]
    assert (await staff.put("/api/admin-api/unit-costs", json={"currency": "jpy", "costs": {}})).status_code == 400
    items = {i["key"] for i in (await staff.get("/api/admin-api/unit-costs")).json()["items"]}
    assert {"voice_minute", "lead_lookup", "email_send"} <= items

    rep = (await staff.get(f"/api/admin-api/revenue?month={month}")).json()
    assert rep["revenue"] == {"voice": {"gbp": 4900}, "scheduler": {"gbp": 900}} and rep["payments"] == 2
    usage = {u["item"]: u for u in rep["usage"]}
    assert usage["voice_minute"]["units"] == 30 and usage["voice_minute"]["costCents"] == 75
    assert usage["ai_post"]["credits"] == 10 and usage["ai_post"]["costCents"] == 20
    acme = next(c for c in rep["clients"] if c["orgId"] == "org_acme")
    assert acme["paid"] == {"gbp": 5800} and acme["costCents"] == 95 and acme["marginCents"] == 5800 - 95
    assert (await staff.get("/api/admin-api/revenue?month=2026-13")).status_code == 400


async def test_lead_generation_pays_per_lead_found_and_stops_at_zero(db, monkeypatch):
    import httpx

    from app.core.tenancy import org_scope
    from app.main import app
    from app.services import credits as K

    async def fake_discover(query_or_domain, target_role=None):
        return [{"name": "Acme Freight"}, {"name": "Beta Haulage"}, {"name": "Cargo Co"}]

    async def fake_llm(**kwargs):
        return {"text": "Here are some leads.", "model": "m", "provider": "p"}

    monkeypatch.setattr("app.api.enrichment.discover_new_target_accounts", fake_discover)
    monkeypatch.setattr("app.api.enrichment.call_open_chat_llm", fake_llm)
    _, token = await make_user(db, "lg", "Admin", org_id="org_acme")
    with org_scope("org_acme"):
        await K.add_credits(db, "leadgen", 3, source="grant", note="Trial")
        await K.set_org_settings(db, {"enforce": True})
        await db.commit()
    body = {"message": "find logistics companies in Leeds", "plugin": "leadgen", "history": []}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                 headers={"Authorization": f"Bearer {token}"}) as c:
        r = await c.post("/api/enrichment/copilot-chat", json=body)
        assert r.status_code == 200, r.text
        assert len(r.json()["leads"]) == 3
        with org_scope("org_acme"):
            assert await K.wallet_balance(db, "leadgen") == 0
        r = await c.post("/api/enrichment/copilot-chat", json=body)
        assert r.status_code == 402 and "Lead generation" in r.json()["detail"]
        # Other apps' chat never touches Lead generation credits.
        r = await c.post("/api/enrichment/copilot-chat", json={**body, "plugin": "voice"})
        assert r.status_code == 200


async def test_image_redraw_costs_one_post_scheduler_credit(client, db, monkeypatch):
    from app.services import credits as K

    async def fake_image(**kwargs):
        return {"status": "ok", "imageUrl": "https://img.example.com/a.png", "provider": "fal"}

    monkeypatch.setattr("app.api.scheduler.generate_image_with_provider", fake_image)
    monkeypatch.setattr("app.api.scheduler._host_image", lambda url, request: url)
    await K.add_credits(db, "scheduler", 1, source="grant", note="Trial")
    await K.set_org_settings(db, {"enforce": True})
    await db.commit()
    assert (await client.post("/api/scheduler/generate-image", json={"prompt": "a van"})).status_code == 200
    assert await K.wallet_balance(db, "scheduler") == 0
    r = await client.post("/api/scheduler/generate-image", json={"prompt": "a van"})
    assert r.status_code == 402 and "Post scheduler" in r.json()["detail"]

    # A failed draw is free, shows a plain error and never names the provider.
    async def failed(**kwargs):
        return {"status": "error", "imageUrl": None, "provider": "fal", "warning": "fal returned 500"}

    monkeypatch.setattr("app.api.scheduler.generate_image_with_provider", failed)
    await K.add_credits(db, "scheduler", 5, source="grant", note="More")
    await db.commit()
    r = await client.post("/api/scheduler/generate-image", json={"prompt": "a van"})
    assert r.status_code == 200 and r.json()["status"] == "error" and r.json()["imageUrl"] is None
    assert "fal" not in str(r.json()).lower()
    assert await K.wallet_balance(db, "scheduler") == 5
