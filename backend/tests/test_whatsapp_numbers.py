"""WhatsApp runs only through Telnyx on the company's own numbers: admins switch it on and off
next to a number, and meeting confirmations go from that number, never from a shared sender."""
from datetime import datetime, timedelta

import pytest

from tests.conftest import make_user
from tests.test_telnyx import _as, _wa_number, fake  # noqa: F401  (fixture)

pytestmark = pytest.mark.db


async def test_admins_turn_whatsapp_on_and_off(staff, db):
    from app.core.tenancy import org_scope
    from app.models.models import OrgPhoneNumber

    _, boss = await make_user(db, "wa_boss", "Admin", org_id="org_acme")
    _, member = await make_user(db, "wa_member", "Operator", org_id="org_acme")
    with org_scope("org_acme"):
        db.add(OrgPhoneNumber(id="num_t", e164="+442071234567", provider="telnyx", status="active", capabilities=["voice"]))
        await db.commit()
    on, off = "/api/wa/numbers/num_t/request", "/api/wa/numbers/num_t/off"

    async with _as(member) as c:
        assert (await c.post(on)).status_code == 403
    async with _as(boss) as c:
        # First time: Meta's business check is still needed, so the team is asked.
        r = (await c.post(on)).json()
        assert r["live"] is False and r["capabilities"] == ["voice", "whatsapp_requested"]
        assert (await c.post(off)).json()["capabilities"] == ["voice"]  # request cancelled
        await c.post(on)
    await staff.post("/api/admin-api/clients/org_acme/numbers/num_t/whatsapp", json={"enabled": True})
    async with _as(boss) as c:
        assert (await c.get("/api/wa/status")).json()["numbers"][0]["whatsapp"] is True
        r = (await c.post(off)).json()
        assert r["capabilities"] == ["voice", "whatsapp_ready"]
        assert (await c.get("/api/wa/status")).json()["numbers"][0]["whatsapp"] is False
        r = (await c.post(on)).json()  # signup done: back on at once
        assert r["live"] is True and r["capabilities"] == ["voice", "whatsapp", "whatsapp_ready"]
        assert (await c.post("/api/wa/numbers/missing/request")).status_code == 404
    # Staff switching it off forgets the signup: the company has to ask again.
    await staff.post("/api/admin-api/clients/org_acme/numbers/num_t/whatsapp", json={"enabled": False})
    async with _as(boss) as c:
        assert (await c.post(on)).json()["live"] is False


async def test_meeting_confirmations_use_the_companys_own_whatsapp_number(client, db, fake):  # noqa: F811
    from app.core.tenancy import org_scope
    from app.services import whatsapp as WA
    from app.services.whatsapp_notify import send_whatsapp

    # No WhatsApp number: a wa.me link, nothing sent.
    assert (await client.get("/api/schedule/whatsapp-status")).json()["configured"] is False
    with org_scope("org_default"):
        r = await send_whatsapp(db, "07700 900123", "See you at 10.")
    assert r["sent"] is False and r["waMeUrl"].startswith("https://wa.me/447700900123")
    assert not [c for c in fake.calls if c[1] == "/messages/whatsapp"]

    await _wa_number(db)
    st = (await client.get("/api/schedule/whatsapp-status")).json()
    assert st["configured"] is True and st["fromMasked"] == "+442079990000"
    with org_scope("org_default"):
        # They have not written in 24 hours: WhatsApp needs a template, so a link instead.
        r = await send_whatsapp(db, "+447700900123", "See you at 10.")
        assert r["sent"] is False and r["waMeUrl"]
        assert not [c for c in fake.calls if c[1] == "/messages/whatsapp"]
        t = await WA.get_or_create_thread(db, "+442079990000", "+447700900123")
        t.last_inbound_at = datetime.utcnow() - timedelta(hours=1)
        await db.commit()
        r = await send_whatsapp(db, "+447700900123", "See you at 10.")
    assert r["sent"] is True and r["mode"] == "telnyx"
    sent = next(c[2] for c in fake.calls if c[1] == "/messages/whatsapp")
    assert sent["from"] == "+442079990000" and sent["to"] == "+447700900123"
    msgs = (await client.get(f"/api/wa/threads/{t.id}")).json()["messages"]
    assert [m["text"] for m in msgs] == ["See you at 10."]  # shows in the inbox, charged like any message


async def test_no_meta_whatsapp_paths_left(anon):
    from app.config import settings

    assert (await anon.get("/api/whatsapp/webhook?hub.mode=subscribe")).status_code in (401, 404)
    assert not hasattr(settings, "WHATSAPP_CLOUD_ACCESS_TOKEN")


class SignupFake:
    """Telnyx's WhatsApp Tech Provider calls, on top of the usual fake."""

    def __init__(self, base):
        self.base, self.registered, self.templates = base, {}, {}

    async def __call__(self, client, method, path, *, params=None, json=None, files=None, data=None):
        self.base.calls.append((method, path, json))
        if path == "/whatsapp/hosted_signups":
            assert json == {"app_id": "APP_1"}
            return {"data": {"url": "https://acct.fyi?token=abc"}}
        if path.startswith("/whatsapp/phone_numbers/"):
            from urllib.parse import unquote

            reg = self.registered.get(unquote(path.rsplit("/", 1)[1]))
            if not reg:
                from app.services.telnyx_client import TelnyxError
                raise TelnyxError("not found", 404)
            return {"data": reg}
        if path == "/whatsapp/message_templates" and method == "POST":
            self.templates[json["name"]] = "PENDING"
            return {"data": {"name": json["name"], "status": "PENDING"}}
        if path == "/whatsapp/message_templates":
            return {"data": [{"name": k, "status": v} for k, v in self.templates.items()]}
        return await self.base(client, method, path, params=params, json=json, files=files, data=data)


@pytest.fixture
def auto(monkeypatch, fake):  # noqa: F811
    from app.services import telnyx_client

    f = SignupFake(fake)
    monkeypatch.setenv("WHATSAPP_META_APP_ID", "APP_1")
    monkeypatch.setattr(telnyx_client.TelnyxClient, "_req", lambda self, *a, **k: f(self, *a, **k))
    return f


async def test_whatsapp_switches_on_by_itself_after_the_client_signs_up(client, anon, db, auto, monkeypatch):
    from app.core.tenancy import org_scope
    from app.models.models import OrgPhoneNumber
    from app.services import whatsapp_signup as WS

    told = []

    async def fake_tell(e164):
        told.append(e164)

    monkeypatch.setattr(WS, "tell_live", fake_tell)
    db.add(OrgPhoneNumber(id="num_a", org_id="org_default", e164="+442071112222", provider="telnyx", status="active", capabilities=["voice"]))
    await db.commit()

    r = (await client.post("/api/wa/numbers/num_a/request")).json()
    assert r["live"] is False and r["signup"]["url"] == "https://acct.fyi?token=abc"
    # Asking again reuses the same link.
    await client.post("/api/wa/numbers/num_a/request")
    assert len([c for c in auto.base.calls if c[1] == "/whatsapp/hosted_signups"]) == 1

    # Meta texts its code to our number: shown to the admin while signing up.
    sms = {"data": {"event_type": "message.received", "payload": {"type": "SMS", "text": "Your WhatsApp code 123-456",
           "from": {"phone_number": "+447700900999"}, "to": [{"phone_number": "+442071112222"}]}}}
    assert (await anon.post("/api/telnyx/messaging-webhook", json=sms)).status_code == 200
    st = (await client.get("/api/wa/status")).json()
    assert st["automatic"] is True and st["numbers"][0]["signup"]["code"] == "123-456"

    # Not registered yet: nothing changes.
    assert (await client.post("/api/wa/numbers/num_a/check")).json()["live"] is False
    # Telnyx shows it registered: the automatic check switches it on and adds our templates.
    auto.registered["+442071112222"] = {"status": "verified", "waba_id": "waba_9"}
    with org_scope("org_default"):
        assert await WS.check_org(db) == 1
    n = (await db.execute(__import__("sqlalchemy").select(OrgPhoneNumber).where(OrgPhoneNumber.id == "num_a"))).scalars().first()
    await db.refresh(n)
    assert n.capabilities == ["voice", "whatsapp", "whatsapp_ready"] and told == ["+442071112222"]
    assert set(auto.templates) == {"outreach_meeting_confirmation", "outreach_follow_up"}
    s = (await client.get("/api/wa/status")).json()["numbers"][0]["signup"]
    assert s["status"] == "live" and s["url"] == "" and s["templates"]["outreach_meeting_confirmation"] == "PENDING"


async def test_meeting_confirmation_uses_the_approved_template_outside_24_hours(db, auto):
    from app.core.tenancy import org_scope
    from app.models.models import WhatsappSignup
    from app.services.whatsapp_notify import send_whatsapp

    await _wa_number(db)
    with org_scope("org_default"):
        db.add(WhatsappSignup(id="ws_t", number_id="num_wa", e164="+442079990000", status="live", waba_id="waba_1",
                              templates={"outreach_meeting_confirmation": "APPROVED"}))
        await db.commit()
        r = await send_whatsapp(db, "+447700900123", "See you at 10.", template_params=["Pat", "Acme", "video meeting", "Tue at 10:00"])
    assert r["sent"] is True
    tpl = next(c[2] for c in auto.base.calls if c[1] == "/messages/whatsapp")["whatsapp_message"]
    assert tpl["template"]["name"] == "outreach_meeting_confirmation"
    assert [p["text"] for p in tpl["template"]["components"][0]["parameters"]] == ["Pat", "Acme", "video meeting", "Tue at 10:00"]


async def test_a_rejected_signup_can_be_tried_again(client, db, auto):
    from app.core.tenancy import org_scope
    from app.models.models import OrgPhoneNumber
    from app.services import whatsapp_signup as WS

    db.add(OrgPhoneNumber(id="num_b", org_id="org_default", e164="+442071113333", provider="telnyx", status="active", capabilities=["voice"]))
    await db.commit()
    await client.post("/api/wa/numbers/num_b/request")
    auto.registered["+442071113333"] = {"status": "rejected", "reason": "Display name does not match your business."}
    with org_scope("org_default"):
        await WS.check_org(db)
    st = (await client.get("/api/wa/status")).json()["numbers"][0]
    assert st["requested"] is False and st["signup"]["status"] == "failed" and "Display name" in st["signup"]["error"]
    r = (await client.post("/api/wa/numbers/num_b/request")).json()
    assert r["signup"]["status"] == "link_sent" and r["signup"]["url"]
