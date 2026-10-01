"""Agent Studio: a user's voice, model and phone; the company's call rules in every script;
a script per campaign; recording only when switched on; test calls to the user's own phone."""
import pytest

from tests.conftest import make_user
from tests.voice_fakes import FakeHttp, RealClient

pytestmark = pytest.mark.db


def _as(token):
    import httpx

    from app.main import app

    return RealClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def _catalogue(staff):
    r = await staff.put("/api/admin-api/voice-catalogue", json={
        "voices": [{"id": "Telnyx.NaturalHD.astra", "label": "Astra (UK)", "sample": "https://cdn.example.com/astra.mp3"},
                   {"id": "Telnyx.NaturalHD.orion", "label": "Orion", "sample": "javascript:alert(1)"}],
        "models": [{"id": "openai/gpt-4o-mini", "label": "Fast"}]})
    assert r.status_code == 200
    assert r.json()["voices"][1]["sample"] == ""  # only https samples are kept


async def test_users_pick_their_voice_from_the_staff_list(db, staff, fake):
    from sqlalchemy.future import select

    from app.core.tenancy import org_scope
    from app.models.models import VoiceAssistant
    from app.services import voice_assistants as VA

    await _catalogue(staff)
    bob, token = await make_user(db, "bob", "Operator", org_id="org_acme")
    async with _as(token) as c:
        s = (await c.get("/api/voice-studio")).json()
        assert s["canChangeCompany"] is False and [v["id"] for v in s["catalogue"]["voices"]][0] == "Telnyx.NaturalHD.astra"
        assert (await c.put("/api/voice-studio/me", json={"voice": "Polly.Made.Up"})).status_code == 400
        assert (await c.put("/api/voice-studio/me", json={"phone": "07700 900123"})).status_code == 400
        r = await c.put("/api/voice-studio/me", json={"voice": "Telnyx.NaturalHD.astra", "model": "openai/gpt-4o-mini",
                                                       "phone": "+44 7700 900123"})
        assert r.json() == {"ok": True, "phone": "+447700900123", "voice": "Telnyx.NaturalHD.astra", "model": "openai/gpt-4o-mini"}
        assert (await c.put("/api/voice-studio/company", json={"neverSay": "x"})).status_code == 403
    with org_scope("org_acme"):
        row = await VA.assistant_for(db, bob.id)
        await db.commit()
        tid = row.telnyx_assistant_id
        assert (await db.execute(select(VoiceAssistant).where(VoiceAssistant.operator_id == bob.id))).scalars().first().id == row.id
    made = next(j for m, p, j in fake.calls if p == "/ai/assistants")
    assert made["voice_settings"] == {"voice": "Telnyx.NaturalHD.astra"} and made["model"] == "openai/gpt-4o-mini"

    # Changing voice later updates the same assistant on its next call.
    async with _as(token) as c:
        await c.put("/api/voice-studio/me", json={"voice": "Telnyx.NaturalHD.orion"})
    bob_id = bob.id
    db.expire_all()
    with org_scope("org_acme"):
        await VA.assistant_for(db, bob_id)
    assert fake.calls[-1][1] == f"/ai/assistants/{tid}" and fake.calls[-1][2]["voice_settings"]["voice"] == "Telnyx.NaturalHD.orion"


async def test_company_rules_go_into_every_call(db, fake, signed):
    from sqlalchemy.future import select

    from app.core.tenancy import org_scope
    from app.models.models import CallBrief, ConversationTemplate, Mission
    from app.services.telnyx_assistant_dial import dial_via_telnyx_assistant

    ann, token = await make_user(db, "ann", "Admin", org_id="org_acme")
    with org_scope("org_acme"):
        db.add(ConversationTemplate(id="tpl_sales", name="Sales", call_direction="outbound", greeting_template="Hi, it's Sam from the window team.",
                                    value_prop_template="We fit windows.", booking_transition_template="Shall we book?",
                                    confirmation_template="Booked.", closing_template="Bye."))
        db.add(Mission(id="m_spring", title="Spring push"))
        await db.commit()
    async with _as(token) as c:
        r = await c.put("/api/voice-studio/company", json={
            "agentName": "Alex", "handoverWhen": "they ask about a refund", "neverSay": "discounts over 10%",
            "captureFields": ["email", "budget", " "], "recordCalls": True, "disclosure": "This call is recorded for training.",
            "defaultInboundTemplateId": "tpl_sales"})
        assert r.status_code == 400  # an outbound script cannot be the inbound default
        r = await c.put("/api/voice-studio/company", json={
            "agentName": "Alex", "handoverWhen": "they ask about a refund", "neverSay": "discounts over 10%",
            "captureFields": ["email", "budget", " "], "recordCalls": True, "disclosure": "This call is recorded for training."})
        assert r.json()["captureFields"] == ["email", "budget"] and r.json()["recordCalls"] is True
        assert (await c.put("/api/voice-studio/campaigns/m_spring", json={"templateId": "tpl_sales"})).json()["templateId"] == "tpl_sales"
        assert (await c.put("/api/voice-studio/campaigns/nope", json={"templateId": ""})).status_code == 404

    with org_scope("org_acme"):
        res = await dial_via_telnyx_assistant(db, "+447700900123", prospect_name="Jo", mission_id="m_spring",
                                              from_number_override="+442071234567", operator_id=ann.id)
        assert res["success"], res
        brief = (await db.execute(select(CallBrief).where(CallBrief.id == res["callId"]))).scalars().first()
    assert brief.template_id == "tpl_sales" and "We fit windows." in brief.script
    assert "refund" in brief.script and "discounts over 10%" in brief.script and "email, budget" in brief.script
    assert brief.variables["greeting"].endswith("This call is recorded for training.") and brief.variables["recorded"] == "yes"
    call = next(j for u, j in FakeHttp.posts if u.endswith("/calls"))
    assert call["record"] == "record-from-answer"

    # Recording off (the default): no recording, and the agent never claims one.
    async with _as(token) as c:
        await c.put("/api/voice-studio/company", json={"recordCalls": False})
    FakeHttp.posts = []
    with org_scope("org_acme"):
        res = await dial_via_telnyx_assistant(db, "+447700900123", from_number_override="+442071234567", operator_id=ann.id)
        brief = (await db.execute(select(CallBrief).where(CallBrief.id == res["callId"]))).scalars().first()
    call = next(j for u, j in FakeHttp.posts if u.endswith("/calls"))
    assert "record" not in call and "not recorded" in brief.script


async def test_test_call_rings_the_users_own_phone(db, fake, monkeypatch):
    from app.core.tenancy import org_scope
    from app.models.models import OrgPhoneNumber

    ann, token = await make_user(db, "ann", "Admin", org_id="org_acme")
    with org_scope("org_acme"):
        db.add(OrgPhoneNumber(id="num_1", e164="+442071234567", provider="telnyx", status="active"))
        await db.commit()
    async with _as(token) as c:
        r = await c.post("/api/voice-studio/test-call", json={})
        assert r.status_code == 400 and "phone" in r.json()["detail"]
        await c.put("/api/voice-studio/me", json={"phone": "+447700900555"})
        monkeypatch.delenv("TELNYX_MANAGED_ASSISTANTS")
        assert (await c.post("/api/voice-studio/test-call", json={})).status_code == 400
        monkeypatch.setenv("TELNYX_MANAGED_ASSISTANTS", "true")
        r = await c.post("/api/voice-studio/test-call", json={})
    assert r.status_code == 200, r.text
    call = next(j for u, j in FakeHttp.posts if u.endswith("/calls"))
    assert call["to"] == "+447700900555" and call["from"] == "+442071234567"
