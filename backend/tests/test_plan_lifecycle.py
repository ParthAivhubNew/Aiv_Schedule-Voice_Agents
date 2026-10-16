"""A plan's life: cancelling with a reason, the emails to the company's admins, the month-end report to the owner, and the daily
check that puts things right when a Stripe message never arrived."""
import asyncio
import time
from datetime import datetime, timedelta

import pytest
from sqlalchemy.future import select

from tests.test_credits import WHSEC, _hook, _sell, _stripe_with_prices  # noqa: F401

pytestmark = pytest.mark.db


@pytest.fixture
def mails(monkeypatch):
    """Every email the system tries to send, instead of sending it."""
    from app.core import mailer

    monkeypatch.delenv("STAFF_ADMIN_EMAIL", raising=False)  # the owner list is the staff admins in the database only
    sent = []

    async def fake(to, subject, html, text, reply_to=None):
        sent.append({"to": to, "subject": subject, "text": text})
        return {"ok": True}

    monkeypatch.setattr(mailer, "send_system_email", fake)
    return sent


@pytest.fixture
def stripe(monkeypatch):
    """Stripe as a stand-in: its subscription list is whatever the test puts in `state["subs"]`."""
    from app.services import billing as B

    _stripe_with_prices(monkeypatch)
    inner = B.stripe
    state = {"subs": [], "posted": []}

    async def layered(method, path, data=None, idempotency_key=""):
        if method == "GET" and path == "/subscriptions":
            return {"data": state["subs"]}
        if method == "POST" and path.startswith("/subscriptions/"):
            state["posted"].append((path, data))
            for s in state["subs"]:
                if path.endswith(s["id"]):
                    s["cancel_at_period_end"] = bool((data or {}).get("cancel_at_period_end"))
            return {}
        return await inner(method, path, data, idempotency_key)

    monkeypatch.setattr(B, "stripe", layered)
    return state


def stripe_sub(price, end, status="active", sub_id="sub_1"):
    return {"id": sub_id, "status": status, "cancel_at_period_end": False, "current_period_end": int(end.timestamp()),
            "items": {"data": [{"id": "si_1", "price": {"id": price}, "current_period_end": int(end.timestamp())}]}}


async def company_with_plan(db, staff, stripe, with_credits=True, days_left=12):
    """An admin with an email, a Voice plan on sale, and the company subscribed to it."""
    from app.models.models import BillingSubscription, Operator
    from app.services import credits as K

    boss = (await db.execute(select(Operator).where(Operator.username == "boss"))).scalars().first()
    boss.email = "boss@acme.test"
    plan = await _sell(staff, "price_voice", "voice", 1320)
    end = datetime.utcnow() + timedelta(days=days_left)
    db.add(BillingSubscription(id="org_default", stripe_customer_id="cus_1", stripe_subscription_id="sub_1", status="active",
                               plans={"voice": plan["id"]}, current_period_end=end))
    await db.commit()
    stripe["subs"] = [stripe_sub("price_voice", end)]
    if with_credits:
        await K.add_credits(db, "voice", 1320, source="plan", expires_at=end, note="Plan")
        await K.add_credits(db, "voice", 60, source="topup", note="Top-up")
        await db.commit()
    return plan, end


async def drain():
    await asyncio.sleep(0.3)  # the emails are sent in the background


async def test_cancelling_needs_a_reason_and_tells_the_admins(client, staff, db, stripe, mails):
    plan, end = await company_with_plan(db, staff, stripe)
    body = {"wallet": "voice", "cancel": True}
    assert (await client.post("/api/billing/cancel", json=body)).status_code == 400  # no reason
    assert (await client.post("/api/billing/cancel", json={**body, "reason": "because"})).status_code == 400  # not one of the choices
    assert not stripe["posted"] and not mails
    r = await client.post("/api/billing/cancel", json={**body, "reason": "too_expensive", "note": "Budget cut this quarter"})
    assert r.status_code == 200 and r.json()["ending"] is True
    assert stripe["posted"][0][1] == {"cancel_at_period_end": True}  # Stripe stops it at the end of the month, no refund
    await drain()
    assert [m["to"] for m in mails] == ["boss@acme.test"]
    text = mails[0]["text"]
    assert "stays active until" in text and "1,320 plan credits" in text and "60 top-up credits" in text and "not refunded" in text
    assert "Keep my plan" in text
    # a tidy line of history, for the owner's report and for staff
    from app.models.models import BillingEvent

    row = (await db.execute(select(BillingEvent).where(BillingEvent.kind == "cancel_requested"))).scalars().one()
    assert (row.reason, row.note, row.wallet, row.plan_name) == ("too_expensive", "Budget cut this quarter", "voice", "startervoice")
    # Changing their mind needs no reason and sends no email
    mails.clear()
    kept = await client.post("/api/billing/cancel", json={"wallet": "voice", "cancel": False})
    assert kept.status_code == 200 and stripe["posted"][-1][1] == {"cancel_at_period_end": False}
    await drain()
    assert not mails
    assert (await db.execute(select(BillingEvent.kind).where(BillingEvent.kind == "cancel_undone"))).scalars().all() == ["cancel_undone"]


async def test_when_a_plan_ends_the_admins_are_told_once(client, staff, anon, db, stripe, mails):
    plan, end = await company_with_plan(db, staff, stripe)
    ended = {"id": "evt_end", "type": "customer.subscription.deleted", "data": {"object": {
        "id": "sub_1", "customer": "cus_1", "status": "canceled", "items": {"data": [{"price": {"id": "price_voice"}}]}}}}
    assert await _hook(anon, ended) == "subscription"
    assert await _hook(anon, ended) == "duplicate"  # Stripe sending it twice changes nothing
    await drain()
    assert len(mails) == 1 and "has ended" in mails[0]["subject"] and "60 top-up credits" in mails[0]["text"]
    assert (await client.get("/api/billing/overview")).json()["subscription"]["plans"] == {}
    from app.models.models import BillingEvent

    assert (await db.execute(select(BillingEvent.kind).where(BillingEvent.kind == "ended"))).scalars().all() == ["ended"]


async def test_a_missed_webhook_is_repaired_by_the_check(client, staff, db, stripe, mails):
    """Stripe has the plan, but its 'invoice paid' message never came: no plan credits. The page visit adds them, once."""
    from app.models.models import BillingSubscription
    from app.services import credits as K

    plan, end = await company_with_plan(db, staff, stripe, with_credits=False)
    sub = await db.get(BillingSubscription, "org_default")
    sub.plans = {}
    await db.commit()
    assert (await client.get("/api/billing/subscriptions")).status_code == 200
    again = await client.get("/api/billing/subscriptions")
    assert again.status_code == 200
    voice = next(w for w in await K.wallets(db) if w["key"] == "voice")
    plan_batches = [b for b in voice["batches"] if b["source"] == "plan"]
    assert voice["balance"] == 1320 and len(plan_batches) == 1 and plan_batches[0]["expiresAt"]  # added once, with its end date
    assert (await client.get("/api/billing/overview")).json()["subscription"]["plans"] == {"voice": plan["id"]}
    await db.refresh(sub)
    assert sub.status == "active" and sub.current_period_end is not None


async def test_a_plan_stripe_no_longer_has_is_ended_by_the_check(client, staff, db, stripe, mails):
    plan, end = await company_with_plan(db, staff, stripe)
    stripe["subs"] = []  # cancelled in Stripe, and the webhook never told us
    assert (await client.get("/api/billing/subscriptions")).status_code == 200
    await drain()
    assert (await client.get("/api/billing/overview")).json()["subscription"]["plans"] == {}
    told = [m for m in mails if m["to"] == "boss@acme.test"]
    assert len(told) == 1 and "has ended" in told[0]["subject"]  # the company's admin hears of it once


async def test_the_daily_pass_repairs_every_company_and_warns_the_staff(client, db, staff, stripe, mails):
    from app.core.tenancy import system_scope
    from app.services import billing as B
    from app.services.credits import _get_doc

    await company_with_plan(db, staff, stripe, with_credits=False)
    out = await B.reconcile_all()
    assert out == {"companies": 1, "fixed": 1}
    with system_scope():
        from app.services.ai_errors import alerts

        codes = [a["code"] for a in await alerts(db)]
    assert "BL-01" in codes  # a repair means a webhook was lost, so the owner's portal says so
    assert (await B.reconcile_all())["fixed"] == 0  # nothing left to repair the second time
    # the webhook secret is set, so "no message from Stripe yet" is not treated as a fault
    assert [a for a in codes if a == "BL-01"] == ["BL-01"]
    _ = _get_doc


async def test_a_plan_long_past_its_paid_period_stops_counting(db):
    from app.core.tenancy import org_scope
    from app.models.models import BillingSubscription, Organization
    from app.services.entitlement import get_org_entitlements

    db.add(Organization(id="org_acme", name="Acme", slug="acme", status="active"))
    await db.commit()
    with org_scope("org_acme"):
        db.add(BillingSubscription(id="org_acme", status="active", plans={"voice": "plan_x"}, current_period_end=datetime.utcnow() + timedelta(days=2)))
        await db.commit()
        assert (await get_org_entitlements(db, "org_acme"))["voice"] is True
        sub = await db.get(BillingSubscription, "org_acme")
        sub.current_period_end = datetime.utcnow() - timedelta(days=3)  # a few days late: still given the benefit of the doubt
        await db.commit()
        assert (await get_org_entitlements(db, "org_acme"))["voice"] is True
        sub.current_period_end = datetime.utcnow() - timedelta(days=9)
        await db.commit()
        assert (await get_org_entitlements(db, "org_acme"))["voice"] is False


async def test_the_owner_gets_one_summary_a_month_not_one_per_event(client, staff, db, stripe, mails):
    from app.models.models import BillingEvent, Organization
    from app.services import billing_events as E

    await company_with_plan(db, staff, stripe)
    now = datetime(2026, 11, 3, 9, 0)
    db.add(Organization(id="org_new", name="Fresh Ltd", slug="fresh", status="active", created_at=datetime(2026, 10, 12)))
    for kind, org, wallet, name, reason, note in [
        ("started", "Fresh Ltd", "voice", "startervoice", "", ""), ("started", "Fresh Ltd", "scheduler", "startersocial", "", ""),
        ("renewed", "Old Co", "voice", "startervoice", "", ""),
        ("cancel_requested", "Old Co", "leadgen", "starterlead", "too_expensive", "Budget cut"),
        ("cancel_requested", "Gone Ltd", "voice", "growthvoice", "not_using", ""),
        ("ended", "Gone Ltd", "voice", "growthvoice", "", ""),
        ("started", "September Co", "voice", "startervoice", "", "")]:  # this one is last month's story, not October's
        when = datetime(2026, 9, 20) if org == "September Co" else datetime(2026, 10, 15)
        db.add(BillingEvent(id=f"be_{org}{kind}{wallet}", org_name=org, wallet=wallet, plan_name=name, kind=kind, reason=reason, note=note, at=when))
    await db.commit()
    mails.clear()  # nothing so far was sent to the owner as it happened
    assert await E.send_due_report(now) == "2026-10"
    owner = [m for m in mails if m["to"] == "ops@outreach.test"]
    assert len(owner) == 1 and len(mails) == 1
    text = owner[0]["text"]
    assert "October 2026" in owner[0]["subject"]
    assert "New companies joined: 1" in text and "Fresh Ltd" in text
    assert "New plans started: 2" in text and "September Co" not in text
    assert "Cancelled" in text and "2." in text and "It costs too much 1" in text and "I am not using it enough 1" in text and "Budget cut" in text
    assert "ended for good: 1" in text and "Net change in plans: +1" in text
    assert await E.send_due_report(now) is None  # not twice
    assert await E.send_due_report(datetime(2026, 11, 20)) is None
    assert await E.send_due_report(datetime(2026, 12, 2)) == "2026-11"  # the next month's turn
    # a company's admin never gets the owner's summary
    assert all(m["to"] != "boss@acme.test" for m in mails)


async def test_staff_can_see_why_people_leave_and_send_a_report_now(staff, client, db, stripe, mails):
    await company_with_plan(db, staff, stripe)
    await client.post("/api/billing/cancel", json={"wallet": "voice", "cancel": True, "reason": "other_tool", "note": "Moving to a rival"})
    rows = (await staff.get("/api/admin-api/billing-events")).json()
    cancel = next(r for r in rows if r["kind"] == "cancel_requested")
    assert cancel["reasonLabel"] == "I am switching to another tool" and cancel["note"] == "Moving to a rival" and cancel["plan"] == "startervoice"
    assert (await staff.get("/api/admin-api/billing-events", params={"org_id": "org_other"})).json() == []
    await drain()
    mails.clear()
    now = datetime.utcnow()
    sent = await staff.post("/api/admin-api/billing-report/send", json={"year": now.year, "month": now.month})
    assert sent.status_code == 200 and sent.json()["sent"] == 1 and mails[0]["to"] == "ops@outreach.test"
    assert (await staff.post("/api/admin-api/billing-report/send", json={"year": 1999, "month": 13})).status_code == 400
    _ = time


def test_emails_for_the_owner_look_like_the_rest_and_say_they_are_for_the_owner():
    from app.core.mailer import render, render_owner

    owner = render_owner("Low balance: Telnyx", ["Only 12 days of runway."], page="balances", button_label="Open Balances")
    company = render("Your plan has ended", ["Subscribe again any time."])
    assert "FOR THE SOFTWARE OWNER" in owner["html"] and "/admin/balances" in owner["html"] and "Open Balances" in owner["html"]
    assert "staff admin of the Outreach owner portal" in owner["html"] and "companies never receive it" in owner["html"]
    assert "activity on your" not in owner["html"]  # the line meant for a company's own users
    assert "OWNER PORTAL" in owner["text"]
    # the same design: the same header band and card
    assert "BY AIVHUB" in owner["html"] and "BY AIVHUB" in company["html"] and "border-radius:18px" in owner["html"]
    assert "OWNER PORTAL" not in company["html"] and "activity on your" in company["html"]
