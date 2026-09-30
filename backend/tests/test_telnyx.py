"""Telnyx numbers: account setup, verification, ordering, and WhatsApp, against a fake Telnyx."""
from datetime import datetime, timedelta

import httpx
import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


class FakeTelnyx:
    def __init__(self):
        self.calls = []
        self.order_status = "pending"
        self.group_status = "pending-approval"

    async def __call__(self, client, method, path, *, params=None, json=None, files=None, data=None):
        self.calls.append((method, path, json))
        if path == "/billing_groups":
            return {"data": {"id": "bg_1"}}
        if path == "/requirements":
            return {"data": [{"requirements_types": [
                {"id": "rt_name", "name": "Business name", "type": "textual"},
                {"id": "rt_addr", "name": "UK address", "type": "address"},
                {"id": "rt_doc", "name": "Proof of address", "type": "document"},
            ]}]}
        if path == "/documents":
            return {"data": {"id": "doc_1"}}
        if path == "/addresses":
            return {"data": {"id": "addr_1"}}
        if path == "/requirement_groups" and method == "POST":
            return {"data": {"id": "rg_1", "status": "unapproved"}}
        if path.endswith("/submit_for_approval"):
            return {"data": {"id": "rg_1", "status": "pending-approval"}}
        if path.startswith("/requirement_groups/"):
            return {"data": {"id": "rg_1", "status": self.group_status,
                             "regulatory_requirements": [{"status_reason": "Bill older than 3 months"}] if self.group_status == "declined" else []}}
        if path == "/available_phone_numbers":
            return {"data": [{"phone_number": "+442071234567", "cost_information": {"monthly_cost": "1.00", "upfront_cost": "1.00", "currency": "USD"},
                              "region_information": [{"region_name": "London"}], "features": [{"name": "voice"}]}]}
        if path == "/number_orders":
            return {"data": {"id": "ord_1", "status": "pending"}}
        if path.startswith("/number_orders/"):
            return {"data": {"id": "ord_1", "status": self.order_status,
                             "phone_numbers": [{"id": "pn_1", "phone_number": "+442071234567"}]}}
        if path == "/messages/whatsapp":
            return {"data": {"id": f"wamsg_{len(self.calls)}"}}
        raise AssertionError(f"unexpected Telnyx call {method} {path}")


@pytest.fixture
def fake(monkeypatch):
    from app.services import telnyx_client

    f = FakeTelnyx()
    monkeypatch.setenv("TELNYX_API_KEY", "KEY_TEST")
    monkeypatch.delenv("TELNYX_ACCOUNT_MODE", raising=False)
    monkeypatch.setattr(telnyx_client.TelnyxClient, "_req", lambda self, *a, **k: f(self, *a, **k))
    return f


def _as(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


async def test_overview_without_platform_key(client, monkeypatch):
    monkeypatch.delenv("TELNYX_API_KEY", raising=False)
    monkeypatch.setattr("app.config.settings.TELNYX_API_KEY", "", raising=False)
    r = await client.get("/api/telnyx/overview")
    assert r.status_code == 200 and r.json()["platformReady"] is False
    assert (await client.get("/api/telnyx/numbers/search")).status_code == 503


async def test_operator_cannot_manage_numbers(db, fake):
    _, tok = await make_user(db, "olly", "Operator")
    async with _as(tok) as c:
        assert (await c.get("/api/telnyx/overview")).status_code == 403


async def test_verify_then_buy_number(client, db, fake):
    reqs = (await client.get("/api/telnyx/requirements")).json()["fields"]
    assert [f["type"] for f in reqs] == ["textual", "address", "document"]
    assert any(c[1] == "/billing_groups" for c in fake.calls)  # account set up on first use

    # Ordering before verification is refused.
    r = await client.post("/api/telnyx/numbers/order", json={"phoneNumber": "+442071234567"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "verification_required"

    # Wrong file type refused.
    bad = await client.post("/api/telnyx/verification", data={"texts": "{}", "addresses": "{}"},
                            files={"doc_rt_doc": ("bill.exe", b"MZ", "application/octet-stream")})
    assert bad.status_code == 400

    r = await client.post("/api/telnyx/verification", data={
        "entity_type": "company", "texts": '{"rt_name": "Acme Ltd"}',
        "addresses": '{"rt_addr": {"street_address": "1 High St", "locality": "London", "postal_code": "E1 1AA", "country_code": "GB"}}',
    }, files={"doc_rt_doc": ("bill.pdf", b"%PDF-1.4", "application/pdf")})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending-approval"
    group = next(c[2] for c in fake.calls if c[1] == "/requirement_groups")
    assert {v["requirement_id"]: v["field_value"] for v in group["regulatory_requirements"]} == {
        "rt_name": "Acme Ltd", "rt_addr": "addr_1", "rt_doc": "doc_1"}

    # Telnyx approves; the overview re-reads it (throttle bypassed by making it old).
    from app.models.models import VerificationSubmission
    from sqlalchemy.future import select

    fake.group_status = "approved"
    sub = (await db.execute(select(VerificationSubmission))).scalars().first()
    sub.updated_at = datetime.utcnow() - timedelta(minutes=5)
    await db.commit()
    ov = (await client.get("/api/telnyx/overview")).json()
    assert ov["verification"]["status"] == "approved"

    found = (await client.get("/api/telnyx/numbers/search?locality=London")).json()
    assert found[0]["phoneNumber"] == "+442071234567" and found[0]["monthlyCost"] == "1.00"
    r = await client.post("/api/telnyx/numbers/order", json={"phoneNumber": "+442071234567", "monthlyCost": "1.00"})
    assert r.status_code == 200 and r.json()["status"] == "pending"
    order_call = next(c[2] for c in fake.calls if c[1] == "/number_orders")
    assert order_call["phone_numbers"][0]["requirement_group_id"] == "rg_1" and order_call["billing_group_id"] == "bg_1"

    fake.order_status = "success"
    from app.models.models import NumberOrder

    o = (await db.execute(select(NumberOrder))).scalars().first()
    o.updated_at = datetime.utcnow() - timedelta(minutes=5)
    await db.commit()
    ov = (await client.get("/api/telnyx/overview")).json()
    assert ov["orders"][0]["status"] == "success"
    assert [n["e164"] for n in ov["numbers"]] == ["+442071234567"]


async def test_declined_verification_shows_reason(client, db, fake):
    await client.get("/api/telnyx/requirements")
    await client.post("/api/telnyx/verification", data={"texts": '{"rt_name": "Acme"}', "addresses": "{}"},
                      files={"doc_rt_doc": ("bill.pdf", b"%PDF", "application/pdf")})
    fake.group_status = "declined"
    from app.models.models import VerificationSubmission
    from sqlalchemy.future import select

    sub = (await db.execute(select(VerificationSubmission))).scalars().first()
    sub.updated_at = datetime.utcnow() - timedelta(minutes=5)
    await db.commit()
    v = (await client.get("/api/telnyx/overview")).json()["verification"]
    assert v["status"] == "declined" and "older than 3 months" in v["reason"]


async def _wa_number(db):
    from app.models.models import OrgPhoneNumber

    db.add(OrgPhoneNumber(id="num_wa", org_id="org_default", e164="+442079990000", capabilities=["voice", "whatsapp"], status="active"))
    await db.commit()


async def test_whatsapp_inbound_reply_window_and_status(client, anon, db, fake, monkeypatch):
    await _wa_number(db)
    replies = []

    def no_ai(org, tid):
        replies.append(tid)

    monkeypatch.setattr("app.services.whatsapp.schedule_ai_reply", no_ai)
    inbound = {"data": {"event_type": "message.received", "payload": {
        "id": "in_1", "type": "WhatsApp", "text": "Hi, are you open Saturday?",
        "from": {"phone_number": "+447700900123", "name": "Pat"}, "to": [{"phone_number": "+442079990000"}]}}}
    assert (await anon.post("/api/telnyx/messaging-webhook", json=inbound)).status_code == 200
    assert (await anon.post("/api/telnyx/messaging-webhook", json=inbound)).status_code == 200  # retry: stored once
    threads = (await client.get("/api/wa/threads")).json()
    assert len(threads) == 1 and threads[0]["contactName"] == "Pat" and threads[0]["unread"] == 1 and threads[0]["windowOpen"]
    assert len(replies) == 1  # the AI is asked once; the retried webhook is ignored
    tid = threads[0]["id"]
    msgs = (await client.get(f"/api/wa/threads/{tid}")).json()["messages"]
    assert [m["text"] for m in msgs] == ["Hi, are you open Saturday?"]

    r = await client.post(f"/api/wa/threads/{tid}/send", json={"text": "Yes, 9 to 1."})
    assert r.status_code == 200 and r.json()["status"] == "sent"
    sent = next(c[2] for c in fake.calls if c[1] == "/messages/whatsapp")
    assert sent["from"] == "+442079990000" and sent["whatsapp_message"]["text"]["body"] == "Yes, 9 to 1."
    assert (await client.get("/api/wa/threads")).json()[0]["aiEnabled"] is False  # a person took over

    from app.models.models import WhatsappMessage
    from sqlalchemy.future import select as _select

    out = (await db.execute(_select(WhatsappMessage).where(WhatsappMessage.direction == "outbound"))).scalars().first()
    status = {"data": {"event_type": "message.delivered", "payload": {"id": out.telnyx_message_id,
              "to": [{"phone_number": "+447700900123"}], "from": {"phone_number": "+442079990000"}}}}
    assert (await anon.post("/api/telnyx/messaging-webhook", json=status)).status_code == 200
    await db.refresh(out)
    assert out.status == "delivered"

    # After 24 hours only a template may be sent.
    from app.models.models import WhatsappThread
    from sqlalchemy.future import select

    t = (await db.execute(select(WhatsappThread))).scalars().first()
    t.last_inbound_at = datetime.utcnow() - timedelta(hours=25)
    await db.commit()
    r = await client.post(f"/api/wa/threads/{tid}/send", json={"text": "Still there?"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "window_closed"
    r = await client.post(f"/api/wa/threads/{tid}/send", json={"template": {"name": "follow_up", "params": ["Pat"]}})
    assert r.status_code == 200
    tpl = [c[2] for c in fake.calls if c[1] == "/messages/whatsapp"][-1]["whatsapp_message"]
    assert tpl["type"] == "template" and tpl["template"]["name"] == "follow_up"


async def test_whatsapp_ai_reply_and_handover(db, fake, monkeypatch):
    from app.core.tenancy import org_scope
    from app.services import whatsapp as WA

    await _wa_number(db)
    answers = iter(["We are open 9-5.", "A colleague will call you back. [HANDOVER]"])

    async def fake_llm(**kw):
        return {"success": True, "reply": next(answers)}

    monkeypatch.setattr("app.services.llm_gateway.call_open_chat_llm", fake_llm)
    with org_scope("org_default"):
        t = await WA.record_inbound(db, "+442079990000", "+447700900555", "When are you open?")
        await db.commit()
        m = await WA.ai_reply(db, t)
        assert m.sender == "ai" and m.text == "We are open 9-5." and t.ai_enabled
        await WA.record_inbound(db, "+442079990000", "+447700900555", "I want to complain", telnyx_id="in_x")
        m = await WA.ai_reply(db, t)
        assert m.text == "A colleague will call you back." and t.ai_enabled is False


async def test_webhook_for_unknown_number_is_ignored(anon, db, fake):
    body = {"data": {"event_type": "message.received", "payload": {"type": "WhatsApp", "text": "hi",
            "from": {"phone_number": "+447700900123"}, "to": [{"phone_number": "+15550001111"}]}}}
    assert (await anon.post("/api/telnyx/messaging-webhook", json=body)).status_code == 200
