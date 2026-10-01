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
        await K.charge(db, "voice_minute", 70, "call:a")  # 70 credits: 50 from the plan, 20 from the top-up
        batches = {b["source"]: b["remaining"] for b in (await K.wallets(db))[0]["batches"]}
        assert batches == {"topup": 80}
        assert await K.wallet_balance(db, "voice") == 80
        await K.charge(db, "voice_minute", 100, "call:b")  # 100 > 80: 20 overdrawn
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
        assert await K.settle(db) == 3  # a credit a minute, part minutes rounded up
        assert await K.settle(db) == 0
        from app.models.models import CallLog
        from sqlalchemy.future import select

        row = (await db.execute(select(CallLog).where(CallLog.id == "cl_1"))).scalars().first()
        row.duration = "04:00"
        await db.commit()
        assert await K.settle(db) == 1
        assert await K.wallet_balance(db, "voice") == -4


async def test_stop_at_zero_per_plugin_only_when_enforced(db):
    from app.core.tenancy import org_scope
    from app.services import credits as K
    from app.services.compliance import check_call_allowed

    with org_scope("org_default"):
        # Stop at zero is on by default; staff can switch it off for a company.
        assert (await K.can_start(db, "voice_minute"))[0] is False
        await K.set_org_settings(db, {"enforce": False})
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
        await _call_log(db, "cl_low", "80:00")  # 80 credits -> 20 left = 20%
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


async def test_only_platform_staff_grant(admin_token, staff, db):
    _, other_admin = await make_user(db, "acme_admin", "Admin", org_id="org_acme")
    for tok in (other_admin, admin_token):
        async with _as(tok) as c:  # no client token opens the admin portal, not even the platform's
            assert (await c.post("/api/admin-api/clients/org_acme/credits", json={"wallet": "voice", "amount": 1000})).status_code == 401
            assert (await c.post("/api/admin-api/plans", json={"wallet": "voice", "name": "x", "priceUsdCents": 100, "credits": 1})).status_code == 401

    r = await staff.post("/api/admin-api/clients/org_acme/credits", json={"wallet": "leadgen", "amount": 250, "expires_in_days": 30})
    assert r.status_code == 200 and r.json()["balance"] == 250
    r = await staff.put("/api/admin-api/clients/org_acme/enforce", json={"enforce": True})
    assert r.json()["enforce"] is True
    orgs = {o["id"]: o for o in (await staff.get("/api/admin-api/clients")).json()}
    assert orgs["org_acme"]["wallets"]["leadgen"] == 250
    async with _as(other_admin) as c:
        mine = (await c.get("/api/billing/overview")).json()
    leadgen = next(w for w in mine["wallets"] if w["key"] == "leadgen")
    assert leadgen["balance"] == 250 and leadgen["nextExpiry"]["amount"] == 250
    assert (await staff.post("/api/admin-api/clients/nope/credits", json={"wallet": "voice", "amount": 5})).status_code == 404


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


async def _plans(staff):
    plan = (await staff.post("/api/admin-api/plans", json={
        "wallet": "voice", "kind": "plan", "name": "Voice Starter", "priceUsdCents": 4900, "credits": 3000})).json()
    topup = (await staff.post("/api/admin-api/plans", json={
        "wallet": "voice", "kind": "topup", "name": "Voice 1,000", "priceUsdCents": 1900, "credits": 1000})).json()
    return plan, topup


async def test_checkout_and_webhooks_grant_credits_once(client, staff, anon, db, monkeypatch):
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
    plan, topup = await _plans(staff)
    r = await client.post("/api/billing/checkout", json={"plans": [plan["id"]], "topups": [topup["id"]]})
    assert r.status_code == 400 and "Not ready for sale" in r.json()["detail"]
    for p in (plan, topup):
        assert (await staff.post(f"/api/admin-api/plans/{p['id']}/sync-stripe")).json()["inStripe"]
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


# Prices made in the Stripe Dashboard (GBP), and events in the shape Stripe sends since API
# version 2025-03-31: the price id is at line.pricing.price_details.price and the subscription's
# metadata at invoice.parent.subscription_details.
STRIPE_PRICES = {
    "price_voice": {"id": "price_voice", "active": True, "unit_amount": 19999, "currency": "gbp", "recurring": {"interval": "month"},
                    "product": {"id": "prod_voice", "name": "startervoice", "description": "132 hours of call per month", "active": True}},
    "price_hour": {"id": "price_hour", "active": True, "unit_amount": 1200, "currency": "gbp", "recurring": None,
                   "product": {"id": "prod_hour", "name": "onehours", "description": "1 hours call", "active": True}},
    "price_social": {"id": "price_social", "active": True, "unit_amount": 4999, "currency": "gbp", "recurring": {"interval": "month"},
                     "product": {"id": "prod_social", "name": "startersocial", "description": None, "active": True}},
    "price_year": {"id": "price_year", "active": True, "unit_amount": 99900, "currency": "gbp", "recurring": {"interval": "year"},
                   "product": {"id": "prod_year", "name": "yearly", "description": None, "active": True}},
}


def _stripe_with_prices(monkeypatch):
    from app.services import billing as B

    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", WHSEC)
    calls = []

    async def fake_stripe(method, path, data=None, idempotency_key=""):
        calls.append((method, path, data))
        if method == "GET" and path == "/prices":
            return {"data": list(STRIPE_PRICES.values())}
        if method == "GET" and path.startswith("/prices/"):
            return STRIPE_PRICES[path.rsplit("/", 1)[1]]
        if path == "/products":
            return {"id": "prod_usd"}
        if path == "/prices":
            return {"id": "price_usd"}
        if path == "/checkout/sessions":
            return {"id": "cs_1", "url": "https://checkout.stripe.test/cs_1"}
        raise AssertionError(path)

    monkeypatch.setattr(B, "stripe", fake_stripe)
    return calls


async def _sell(staff, price_id, wallet, credits):
    r = await staff.post("/api/admin-api/plans/from-stripe", json={"priceId": price_id, "wallet": wallet, "credits": credits})
    assert r.status_code == 200, r.text
    return r.json()


async def _hook(anon, event):
    raw, headers = _signed(event)
    return (await anon.post("/api/billing/webhook", content=raw, headers=headers)).json()["result"]


def _invoice_paid(event_id, invoice_id, sub_id, lines):
    return {"id": event_id, "type": "invoice.paid", "data": {"object": {
        "id": invoice_id, "customer": "cus_1", "metadata": {},
        "parent": {"type": "subscription_details", "subscription_details": {"subscription": sub_id, "metadata": {"org_id": "org_default"}}},
        "lines": {"data": [{"amount": amount, "period": {"end": int(time.time()) + 30 * 86400},
                            "pricing": {"type": "price_details", "price_details": {"price": price, "product": "prod_x"}}}
                           for price, amount in lines]}}}}


async def test_prices_made_in_stripe_go_on_sale(client, staff, db, monkeypatch):
    calls = _stripe_with_prices(monkeypatch)
    listed = (await staff.get("/api/admin-api/stripe-prices")).json()
    assert {p["priceId"]: p["kind"] for p in listed} == {"price_voice": "plan", "price_hour": "topup", "price_social": "plan"}

    voice = await _sell(staff, "price_voice", "voice", 79200)
    assert (voice["kind"], voice["name"], voice["priceUsdCents"], voice["currency"], voice["inStripe"]) == ("plan", "startervoice", 19999, "gbp", True)
    hour = await _sell(staff, "price_hour", "voice", 600)
    assert hour["kind"] == "topup"
    assert [p["priceId"] for p in (await staff.get("/api/admin-api/stripe-prices")).json()] == ["price_social"]

    # The description is edited in Stripe; the plan on sale follows it (its credits are set here).
    monkeypatch.setitem(STRIPE_PRICES["price_voice"]["product"], "description", "22 hours of call per month")
    await staff.get("/api/admin-api/stripe-prices")
    plans = {p["name"]: p for p in (await staff.get("/api/admin-api/plans")).json()}
    assert (plans["startervoice"]["description"], plans["startervoice"]["credits"]) == ("22 hours of call per month", 79200)

    again = {"priceId": "price_voice", "wallet": "voice", "credits": 1}
    assert (await staff.post("/api/admin-api/plans/from-stripe", json=again)).status_code == 400
    assert (await staff.post("/api/admin-api/plans/from-stripe", json={**again, "priceId": "price_year"})).status_code == 400
    assert (await staff.post("/api/admin-api/plans/from-stripe", json={**again, "priceId": "../customers"})).status_code == 422
    _, other_admin = await make_user(db, "acme_admin", "Admin", org_id="org_acme")
    async with _as(other_admin) as c:
        assert (await c.get("/api/admin-api/stripe-prices")).status_code == 401
        assert (await c.post("/api/admin-api/plans/from-stripe", json=again)).status_code == 401

    # A top-up on its own: one-off payment with an invoice; Stripe Tax only when switched on.
    assert (await client.post("/api/billing/checkout", json={"topups": [hour["id"]]})).status_code == 200
    session = calls[-1][2]
    assert session["mode"] == "payment" and session["invoice_creation"]["enabled"] is True and "automatic_tax" not in session
    monkeypatch.setenv("STRIPE_AUTOMATIC_TAX", "true")
    assert (await client.post("/api/billing/checkout", json={"plans": [voice["id"]]})).status_code == 200
    session = calls[-1][2]
    assert session["automatic_tax"] == {"enabled": True} and session["tax_id_collection"] == {"enabled": True}

    # A USD plan made here cannot share a Checkout with a GBP price.
    usd = (await staff.post("/api/admin-api/plans", json={
        "wallet": "voice", "kind": "plan", "name": "Calls USD", "priceUsdCents": 2900, "credits": 100})).json()
    assert (await staff.post(f"/api/admin-api/plans/{usd['id']}/sync-stripe")).json()["currency"] == "usd"
    r = await client.post("/api/billing/checkout", json={"plans": [usd["id"]], "topups": [hour["id"]]})
    assert r.status_code == 400 and "currencies" in r.json()["detail"]
    # Each app is paid for on its own.
    posts = (await staff.post("/api/admin-api/plans", json={
        "wallet": "scheduler", "kind": "plan", "name": "Posts", "priceUsdCents": 2900, "credits": 100})).json()
    await staff.post(f"/api/admin-api/plans/{posts['id']}/sync-stripe")
    r = await client.post("/api/billing/checkout", json={"plans": [posts["id"]], "topups": [hour["id"]]})
    assert r.status_code == 400 and "paid for on its own" in r.json()["detail"]


async def test_each_plugin_bought_separately_keeps_its_own_plan(client, staff, anon, db, monkeypatch):
    calls = _stripe_with_prices(monkeypatch)
    voice = await _sell(staff, "price_voice", "voice", 79200)
    social = await _sell(staff, "price_social", "scheduler", 400)

    async def plans():
        return (await client.get("/api/billing/overview")).json()["subscription"]

    async def balance(wallet):
        return next(w["balance"] for w in (await client.get("/api/billing/overview")).json()["wallets"] if w["key"] == wallet)

    # Voice is bought from inside the Voice plugin.
    assert (await client.post("/api/billing/checkout", json={"plans": [voice["id"]]})).status_code == 200
    assert await _hook(anon, {"id": "evt_v1", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_v", "customer": "cus_1", "subscription": "sub_v", "payment_status": "paid",
        "metadata": {"org_id": "org_default", "plans": voice["id"], "topups": ""}}}}) == "checkout"
    assert await _hook(anon, _invoice_paid("evt_v2", "in_v", "sub_v", [("price_voice", 19999)])) == "renewal"
    assert await balance("voice") == 79200

    # Later the scheduler is bought from inside the Post scheduler: allowed, and voice stays.
    r = await client.post("/api/billing/checkout", json={"plans": [voice["id"]]})
    assert r.status_code == 400 and "already have a plan for AI Voice" in r.json()["detail"]
    assert (await client.post("/api/billing/checkout", json={"plans": [social["id"]]})).status_code == 200
    assert calls[-1][2]["customer"] == "cus_1"
    assert await _hook(anon, {"id": "evt_s1", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_s", "customer": "cus_1", "subscription": "sub_s", "payment_status": "paid",
        "metadata": {"org_id": "org_default", "plans": social["id"], "topups": ""}}}}) == "checkout"
    assert await _hook(anon, _invoice_paid("evt_s2", "in_s", "sub_s", [("price_social", 4999)])) == "renewal"
    assert (await plans())["plans"] == {"voice": voice["id"], "scheduler": social["id"]}
    assert (await balance("voice"), await balance("scheduler")) == (79200, 400)

    # A plan change refunds the unused part of the old plan as a negative line: no credits for it.
    assert await _hook(anon, _invoice_paid("evt_v3", "in_v2", "sub_v", [("price_voice", -19999)])) == "ignored"
    assert await balance("voice") == 79200

    # Cancelling the scheduler leaves voice subscribed; cancelling voice too ends the subscription.
    def deleted(event_id, sub_id, price):
        return {"id": event_id, "type": "customer.subscription.deleted", "data": {"object": {
            "id": sub_id, "customer": "cus_1", "status": "canceled", "metadata": {"org_id": "org_default"},
            "items": {"data": [{"price": {"id": price}}]}}}}

    await _hook(anon, deleted("evt_s3", "sub_s", "price_social"))
    assert ((await plans())["status"], (await plans())["plans"]) == ("active", {"voice": voice["id"]})
    await _hook(anon, deleted("evt_v4", "sub_v", "price_voice"))
    assert ((await plans())["status"], (await plans())["plans"]) == ("canceled", {})


async def test_plan_is_changed_and_cancelled_from_the_plugin(client, staff, anon, db, monkeypatch):
    from app.services import billing as B

    calls = _stripe_with_prices(monkeypatch)
    monkeypatch.setitem(STRIPE_PRICES, "price_growth", {
        "id": "price_growth", "active": True, "unit_amount": 39999, "currency": "gbp", "recurring": {"interval": "month"},
        "product": {"id": "prod_growth", "name": "growthvoice", "description": "180 hours of call per month", "active": True}})
    period_end = int(time.time()) + 20 * 86400
    # The organisation's subscription as Stripe reports it, and Stripe's answer to changing it.
    sub = {"id": "sub_v", "status": "active", "cancel_at_period_end": False,
           "items": {"data": [{"id": "si_v", "price": {"id": "price_voice"}, "current_period_end": period_end}]}}
    answer = {"id": "sub_v", "pending_update": None}
    catalogue = B.stripe

    async def fake_stripe(method, path, data=None, idempotency_key=""):
        if path == "/subscriptions":
            return {"data": [sub]}
        if path == "/subscriptions/sub_v":
            calls.append((method, path, data))
            return answer
        if path == "/invoices/in_up":
            return {"hosted_invoice_url": "https://invoice.stripe.test/in_up"}
        return await catalogue(method, path, data, idempotency_key)

    monkeypatch.setattr(B, "stripe", fake_stripe)
    starter = await _sell(staff, "price_voice", "voice", 79200)
    growth = await _sell(staff, "price_growth", "voice", 108000)

    async def balance():
        return next(w["balance"] for w in (await client.get("/api/billing/overview")).json()["wallets"] if w["key"] == "voice")

    # Before the first purchase there is nothing to manage; Checkout returns to the plugin's page.
    assert (await client.get("/api/billing/subscriptions")).json() == {}
    assert (await client.post("/api/billing/plan", json={"plan": growth["id"]})).status_code == 400
    assert (await client.post("/api/billing/checkout", json={"plans": [starter["id"]], "back": "/voice/subscription"})).status_code == 200
    assert calls[-1][2]["success_url"].endswith("/voice/subscription?billing=success")
    assert (await client.post("/api/billing/checkout", json={"plans": [starter["id"]], "back": "//evil.test"})).status_code == 422
    await _hook(anon, {"id": "evt_1", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_v", "customer": "cus_1", "subscription": "sub_v", "payment_status": "paid",
        "metadata": {"org_id": "org_default", "plans": starter["id"], "topups": ""}}}})
    await _hook(anon, _invoice_paid("evt_2", "in_1", "sub_v", [("price_voice", 19999)]))
    assert await balance() == 79200
    mine = (await client.get("/api/billing/subscriptions")).json()
    assert mine == {"voice": {"planId": starter["id"], "status": "active", "ending": False, "alone": True,
                              "periodEnd": datetime.utcfromtimestamp(period_end).isoformat()}}

    # Upgrade: charged now. When the bank wants the payment confirmed, the customer pays on Stripe's page.
    answer.update(pending_update={"expires_at": 1}, latest_invoice="in_up")
    r = await client.post("/api/billing/plan", json={"plan": growth["id"]})
    assert r.json() == {"url": "https://invoice.stripe.test/in_up"}
    assert calls[-1][2] == {"items": [{"id": "si_v", "price": "price_growth"}],
                            "proration_behavior": "always_invoice", "payment_behavior": "pending_if_incomplete"}
    answer.update(pending_update=None)
    assert (await client.post("/api/billing/plan", json={"plan": growth["id"]})).json() == {"url": None}
    # Its invoice refunds the rest of the old plan and charges the new one: only the extra credits are added.
    await _hook(anon, _invoice_paid("evt_3", "in_2", "sub_v", [("price_voice", -13000), ("price_growth", 26000)]))
    assert await balance() == 108000
    sub["items"]["data"][0]["price"]["id"] = "price_growth"
    assert (await client.post("/api/billing/plan", json={"plan": growth["id"]})).status_code == 400  # already on it

    # Downgrade: from the next renewal, nothing refunded, and it never refills the wallet.
    assert (await client.post("/api/billing/plan", json={"plan": starter["id"]})).json() == {"url": None}
    assert calls[-1][2] == {"items": [{"id": "si_v", "price": "price_voice"}], "proration_behavior": "none"}
    await _hook(anon, _invoice_paid("evt_4", "in_3", "sub_v", [("price_growth", -26000), ("price_voice", 13000)]))
    assert await balance() == 108000

    # Cancel at the end of the paid period, or keep it after all.
    assert (await client.post("/api/billing/cancel", json={"wallet": "voice"})).json() == {"wallet": "voice", "ending": True}
    assert calls[-1][2] == {"cancel_at_period_end": True}
    assert (await client.post("/api/billing/cancel", json={"wallet": "voice", "cancel": False})).status_code == 200
    assert calls[-1][2] == {"cancel_at_period_end": False}
    assert (await client.post("/api/billing/cancel", json={"wallet": "scheduler"})).status_code == 400
    sub["items"]["data"].append({"id": "si_x", "price": {"id": "price_other"}, "current_period_end": period_end})
    r = await client.post("/api/billing/cancel", json={"wallet": "voice"})
    assert r.status_code == 400 and "bought together" in r.json()["detail"]

    _, tok = await make_user(db, "olly", "Operator")
    async with _as(tok) as c:
        assert (await c.get("/api/billing/subscriptions")).status_code == 403
        assert (await c.post("/api/billing/plan", json={"plan": growth["id"]})).status_code == 403
        assert (await c.post("/api/billing/cancel", json={"wallet": "voice"})).status_code == 403


async def test_top_up_bought_several_at_once(client, staff, anon, db, monkeypatch):
    calls = _stripe_with_prices(monkeypatch)
    hour = await _sell(staff, "price_hour", "voice", 600)
    r = await client.post("/api/billing/checkout", json={"topups": [hour["id"]], "quantities": {hour["id"]: 3}})
    session = calls[-1][2]
    assert r.status_code == 200 and session["line_items"] == [{"price": "price_hour", "quantity": 3}]
    for bad in (0, 100):
        assert (await client.post("/api/billing/checkout", json={"topups": [hour["id"]], "quantities": {hour["id"]: bad}})).status_code == 400

    # The webhook grants credits for as many as were paid for.
    assert await _hook(anon, {"id": "evt_q", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_q", "customer": "cus_1", "payment_status": "paid", "metadata": session["metadata"]}}}) == "topup"
    ov = (await client.get("/api/billing/overview")).json()
    assert next(w["balance"] for w in ov["wallets"] if w["key"] == "voice") == 1800
    assert ov["history"][0]["note"] == "Top-up: onehours × 3"
    # What was paid is kept on the batch, for the Telnyx margin report.
    from app.core.tenancy import org_scope
    from app.models.models import CreditGrant
    from sqlalchemy.future import select

    with org_scope("org_default"):
        grant = (await db.execute(select(CreditGrant).where(CreditGrant.source == "topup"))).scalars().first()
        assert (grant.paid_cents, grant.paid_currency) == (3600, "gbp")
        assert grant.expires_at is None  # top-ups outlast the plan month: they never expire


async def test_failed_webhook_is_applied_on_stripes_retry(client, staff, anon, db, monkeypatch):
    from app.services import credits as K

    _stripe_with_prices(monkeypatch)
    hour = await _sell(staff, "price_hour", "voice", 600)
    event = {"id": "evt_t1", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_t", "customer": "cus_1", "payment_status": "paid",
        "metadata": {"org_id": "org_default", "plans": "", "topups": hour["id"]}}}}

    async def broken(*args, **kwargs):
        raise RuntimeError("database went away")

    real = K.add_credits
    monkeypatch.setattr(K, "add_credits", broken)
    with pytest.raises(RuntimeError):
        await _hook(anon, event)
    monkeypatch.setattr(K, "add_credits", real)
    assert await _hook(anon, event) == "topup"
    assert await _hook(anon, event) == "duplicate"
    voice = next(w for w in (await client.get("/api/billing/overview")).json()["wallets"] if w["key"] == "voice")
    assert voice["balance"] == 600


async def test_checkout_without_keys(client, monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    assert (await client.post("/api/billing/checkout", json={"topups": ["x"]})).status_code == 503
    assert (await client.get("/api/billing/overview")).json()["stripeReady"] is False
