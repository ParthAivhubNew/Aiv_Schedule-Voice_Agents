"""Credits: per-plugin wallets, spend nearest expiry first, expiry, overdraw, stop per plugin,
staff-only grants, and Stripe billing (checkout + signed webhooks)."""
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta

import httpx
import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


def _as(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


def test_minutes_of_duration_formats():
    from app.services.credits import minutes_of

    assert [minutes_of(d) for d in ("00:00", "00:01", "03:25", "02:00 min", "4 min", "0 min", "")] == [0, 1, 4, 2, 4, 0, 0]


async def _call_log(db, cid, duration, created=None):
    from app.models.models import CallLog

    db.add(CallLog(id=cid, canonical_name="Pat", listed_as="Pat", started_at="x", ended_at="y", duration=duration,
                   channel="voice", created_at=created or datetime.utcnow()))
    await db.commit()


async def test_spend_nearest_expiry_first_and_overdraw_paid_by_next_grant(db):
    from app.core.tenancy import org_scope
    from app.services import credits as K

    now = datetime.utcnow()
    with org_scope("org_default"):
        await K.add_credits(db, "voice", 100, source="topup", expires_at=now + timedelta(days=40))
        await K.add_credits(db, "voice", 50, source="plan", expires_at=now + timedelta(days=10))
        await K.charge(db, "voice_minute", 7, "call:a")  # 70 credits: 50 from the plan, 20 from the top-up
        batches = {b["source"]: b["remaining"] for b in (await K.wallets(db))[0]["batches"]}
        assert batches == {"topup": 80}
        assert await K.wallet_balance(db, "voice") == 80
        await K.charge(db, "voice_minute", 10, "call:b")  # 100 > 80: 20 overdrawn
        assert await K.wallet_balance(db, "voice") == -20
        assert await K.add_credits(db, "voice", 50, source="topup", expires_at=now + timedelta(days=30)) == 30
        # Other plugins are separate.
        assert await K.wallet_balance(db, "scheduler") == 0


async def test_expiry_and_plan_renewal(db):
    from app.core.tenancy import org_scope
    from app.services import credits as K

    now = datetime.utcnow()
    with org_scope("org_default"):
        await K.add_credits(db, "email", 30, source="topup", expires_at=now - timedelta(minutes=1))
        await K.add_credits(db, "email", 20, source="plan", expires_at=now + timedelta(days=5))
        assert await K.wallet_balance(db, "email") == 20  # expired batch no longer counts
        assert await K.expire(db) == 30
        await K.expire_plan_batches(db, "email")
        assert await K.wallet_balance(db, "email") == 0
        kinds = [h["kind"] for h in await K.history(db)]
        assert kinds.count("expire") == 2


async def test_settle_charges_once_by_wallet(db):
    from app.core.tenancy import org_scope
    from app.services import credits as K

    with org_scope("org_default"):
        await _call_log(db, "cl_old", "05:00", datetime.utcnow() - timedelta(hours=1))
        assert await K.settle(db) == 0  # first run only marks the start
        await _call_log(db, "cl_1", "02:10")
        assert await K.settle(db) == 30
        assert await K.settle(db) == 0
        from app.models.models import CallLog
        from sqlalchemy.future import select

        row = (await db.execute(select(CallLog).where(CallLog.id == "cl_1"))).scalars().first()
        row.duration = "04:00"
        await db.commit()
        assert await K.settle(db) == 10
        assert await K.wallet_balance(db, "voice") == -40


async def test_stop_at_zero_per_plugin_only_when_enforced(db):
    from app.core.tenancy import org_scope
    from app.services import credits as K
    from app.services.compliance import check_call_allowed

    with org_scope("org_default"):
        assert (await K.can_start(db, "voice_minute"))[0] is True
        await K.set_org_settings(db, {"enforce": True})
        await K.add_credits(db, "scheduler", 10)
        await db.commit()
        ok, why = await K.can_start(db, "voice_minute")
        assert not ok and "AI Voice" in why
        gate = await check_call_allowed(db, "+447700900123")
        assert not gate.allowed
        assert (await K.can_start(db, "ai_post"))[0] is True  # scheduler still has credits
        await K.add_credits(db, "voice", 15)
        await db.commit()
        assert (await K.can_start(db, "voice_minute"))[0] is True


async def test_low_warning_at_twenty_percent_once(db, monkeypatch):
    from app.core.tenancy import org_scope
    from app.services import credits as K

    sent = []

    async def fake_notify(event, subject, lines, button=None, only_user_ids=None):
        sent.append(subject)

    monkeypatch.setattr("app.core.notify.notify", fake_notify)
    with org_scope("org_default"):
        await K.settle(db)  # marks tracking start
        await K.set_org_settings(db, {"enforce": True})
        await K.add_credits(db, "voice", 100)
        await db.commit()
        await _call_log(db, "cl_low", "08:00")  # 80 credits -> 20 left = 20%
        await K.settle(db)
        await _call_log(db, "cl_low2", "00:30")
        await K.settle(db)
    assert sent == ["AI Voice (calls and WhatsApp): credits running low"]


async def test_admin_sees_wallets_operator_does_not(client, db):
    r = await client.get("/api/credits")
    assert r.status_code == 200, r.text
    assert [w["key"] for w in r.json()["wallets"]] == ["voice", "leadgen", "email", "scheduler"]
    _, tok = await make_user(db, "olly", "Operator")
    async with _as(tok) as c:
        assert (await c.get("/api/credits")).status_code == 403
        assert (await c.get("/api/billing/overview")).status_code == 403


async def test_only_platform_staff_grant(client, db):
    _, other_admin = await make_user(db, "acme_admin", "Admin", org_id="org_acme")
    async with _as(other_admin) as c:
        assert (await c.post("/api/credits/platform/grant", json={"org_id": "org_acme", "amount": 1000})).status_code == 403
        assert (await c.post("/api/credits/platform/plans", json={"wallet": "voice", "name": "x", "priceUsdCents": 100, "credits": 1})).status_code == 403

    r = await client.post("/api/credits/platform/grant", json={"org_id": "org_acme", "amount": 250, "wallet": "leadgen", "expires_in_days": 30})
    assert r.status_code == 200 and r.json()["balance"] == 250
    r = await client.put("/api/credits/platform/orgs/org_acme", json={"enforce": True})
    assert r.json()["enforce"] is True
    orgs = {o["id"]: o for o in (await client.get("/api/credits/platform/orgs")).json()}
    assert orgs["org_acme"]["wallets"]["leadgen"] == 250
    async with _as(other_admin) as c:
        mine = (await c.get("/api/billing/overview")).json()
    leadgen = next(w for w in mine["wallets"] if w["key"] == "leadgen")
    assert leadgen["balance"] == 250 and leadgen["nextExpiry"]["amount"] == 250
    assert (await client.post("/api/credits/platform/grant", json={"org_id": "nope", "amount": 5})).status_code == 404


async def test_signup_gets_starter_credits_in_every_wallet(anon, db, monkeypatch):
    monkeypatch.setenv("ALLOW_SIGNUP", "true")
    monkeypatch.setenv("STARTER_CREDITS", "300")
    monkeypatch.delenv("SYSTEM_MAIL_HOST", raising=False)
    from app.api import signup

    signup._HITS.clear()
    body = {"company": "Cred Co", "name": "Cy", "email": "cy@cred.test", "password": "Cred-pass-2026"}
    assert (await anon.post("/api/auth/signup", json=body)).status_code == 200
    r = await anon.post("/api/auth/login", json={"username": "cy@cred.test", "password": body["password"]})
    async with _as(r.json()["access_token"]) as c:
        mine = (await c.get("/api/billing/overview")).json()
    assert mine["enforce"] is True and all(w["balance"] == 300 for w in mine["wallets"])


# ── Stripe ─────────────────────────────────────────────────────────────────
WHSEC = "whsec_test_secret"


def _signed(event):
    raw = json.dumps(event).encode()
    ts = int(time.time())
    sig = hmac.new(WHSEC.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    return raw, {"stripe-signature": f"t={ts},v1={sig}", "content-type": "application/json"}


def test_signature_check():
    from app.services.billing import verify_signature

    raw = b'{"id":"evt"}'
    ts = int(time.time())
    good = hmac.new(b"sec", f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    assert verify_signature(raw, f"t={ts},v1={good}", "sec")
    assert not verify_signature(raw, f"t={ts},v1={'0' * 64}", "sec")
    assert not verify_signature(raw, f"t={ts - 3600},v1={good}", "sec")  # too old
    assert not verify_signature(raw, "", "sec")


async def _plans(client):
    plan = (await client.post("/api/credits/platform/plans", json={
        "wallet": "voice", "kind": "plan", "name": "Voice Starter", "priceUsdCents": 4900, "credits": 3000})).json()
    topup = (await client.post("/api/credits/platform/plans", json={
        "wallet": "voice", "kind": "topup", "name": "Voice 1,000", "priceUsdCents": 1900, "credits": 1000})).json()
    return plan, topup


async def test_checkout_and_webhooks_grant_credits_once(client, anon, db, monkeypatch):
    from app.services import billing as B

    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", WHSEC)
    calls = []

    async def fake_stripe(method, path, data=None, idempotency_key=""):
        calls.append((method, path, data))
        if path == "/products":
            return {"id": "prod_1"}
        if path == "/prices":
            return {"id": f"price_{data['metadata']['kind']}"}
        if path == "/checkout/sessions":
            return {"id": "cs_1", "url": "https://checkout.stripe.test/cs_1"}
        raise AssertionError(path)

    monkeypatch.setattr(B, "stripe", fake_stripe)
    plan, topup = await _plans(client)
    r = await client.post("/api/billing/checkout", json={"plans": [plan["id"]], "topups": [topup["id"]]})
    assert r.status_code == 400 and "Not ready for sale" in r.json()["detail"]
    for p in (plan, topup):
        assert (await client.post(f"/api/credits/platform/plans/{p['id']}/sync-stripe")).json()["inStripe"]
    r = await client.post("/api/billing/checkout", json={"plans": [plan["id"]], "topups": [topup["id"]]})
    assert r.status_code == 200 and r.json()["url"].startswith("https://checkout.stripe.test")
    session = calls[-1][2]
    assert session["mode"] == "subscription" and session["adaptive_pricing"] == {"enabled": True}
    assert [li["price"] for li in session["line_items"]] == ["price_plan", "price_topup"]

    # Unsigned or forged webhooks are refused.
    assert (await anon.post("/api/billing/webhook", json={"id": "evt_x"})).status_code == 400

    completed = {"id": "evt_1", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_1", "customer": "cus_1", "subscription": "sub_1", "payment_status": "paid",
        "metadata": {"org_id": "org_default", "plans": plan["id"], "topups": topup["id"]}}}}
    raw, headers = _signed(completed)
    assert (await anon.post("/api/billing/webhook", content=raw, headers=headers)).json()["result"] == "topup"
    raw, headers = _signed(completed)
    assert (await anon.post("/api/billing/webhook", content=raw, headers=headers)).json()["result"] == "duplicate"

    period_end = int(time.time()) + 30 * 86400
    paid = {"id": "evt_2", "type": "invoice.paid", "data": {"object": {
        "id": "in_1", "customer": "cus_1", "subscription": "sub_1",
        "lines": {"data": [{"price": {"id": "price_plan"}, "period": {"end": period_end}}]}}}}
    raw, headers = _signed(paid)
    assert (await anon.post("/api/billing/webhook", content=raw, headers=headers)).json()["result"] == "renewal"

    ov = (await client.get("/api/billing/overview")).json()
    voice = next(w for w in ov["wallets"] if w["key"] == "voice")
    assert voice["balance"] == 4000
    assert ov["subscription"]["status"] == "active" and ov["subscription"]["plans"] == {"voice": plan["id"]}

    # Next month: unused plan credits are replaced, the top-up stays.
    paid2 = {"id": "evt_3", "type": "invoice.paid", "data": {"object": {
        "id": "in_2", "customer": "cus_1", "lines": {"data": [{"price": {"id": "price_plan"}, "period": {"end": period_end + 30 * 86400}}]}}}}
    raw, headers = _signed(paid2)
    await anon.post("/api/billing/webhook", content=raw, headers=headers)
    voice = next(w for w in (await client.get("/api/billing/overview")).json()["wallets"] if w["key"] == "voice")
    assert voice["balance"] == 4000 and sorted(b["source"] for b in voice["batches"]) == ["plan", "topup"]


async def test_checkout_without_keys(client, monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    assert (await client.post("/api/billing/checkout", json={"topups": ["x"]})).status_code == 503
    assert (await client.get("/api/billing/overview")).json()["stripeReady"] is False
