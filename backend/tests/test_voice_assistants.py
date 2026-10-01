"""Managed Telnyx assistants: one per user, a fixed shell in Telnyx, each call's script in its
brief (sent as dynamic variables), signed tool calls, inbound calls, against a fake Telnyx."""
import base64
import json

import httpx
import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db

RealClient = httpx.AsyncClient  # the fakes below replace httpx.AsyncClient for the app's Telnyx calls


class FakeTelnyx:
    """TelnyxClient._req stand-in (assistants, answering calls)."""

    def __init__(self):
        self.calls = []
        self.fail = False
        self.n = 0

    async def __call__(self, client, method, path, *, params=None, json=None, files=None, data=None):
        from app.services.telnyx_client import TelnyxError

        self.calls.append((method, path, json))
        if self.fail:
            raise TelnyxError("Telnyx is down", 503)
        if path == "/ai/assistants" and method == "POST":
            self.n += 1
            return {"data": {"id": f"assistant-{self.n}"}}
        if path.startswith("/ai/assistants/"):
            return {"data": {"id": path.rsplit("/", 1)[-1]}}
        if path.endswith("/actions/answer"):
            return {"data": {"result": "ok"}}
        raise AssertionError(f"unexpected Telnyx call {method} {path}")


class FakeHttp:
    """httpx.AsyncClient stand-in for the code that calls Telnyx directly (dial, assistant start)."""

    posts = []

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, **k):
        return httpx.Response(200, json={"data": [{"id": "cca_1", "application_name": "AIVHub Voice AI"}]})

    async def post(self, url, json=None, **k):
        FakeHttp.posts.append((url, json))
        if url.endswith("/calls"):
            return httpx.Response(200, json={"data": {"call_control_id": "ccid_out_1"}})
        return httpx.Response(200, json={"data": {"conversation_id": "conv_1"}})


@pytest.fixture
def fake(monkeypatch):
    from app.services import telnyx_assistant_calls, telnyx_assistant_dial, telnyx_client
    from app.services import compliance

    f = FakeTelnyx()
    FakeHttp.posts = []
    monkeypatch.setenv("TELNYX_API_KEY", "KEY_TEST")
    monkeypatch.setattr("app.config.settings.TELNYX_API_KEY", "KEY_TEST", raising=False)
    monkeypatch.setenv("TELNYX_MANAGED_ASSISTANTS", "true")
    monkeypatch.setattr("app.config.settings.PUBLIC_BASE_URL", "https://outreach.example.com", raising=False)
    monkeypatch.setattr(telnyx_client.TelnyxClient, "_req", lambda self, *a, **k: f(self, *a, **k))
    monkeypatch.setattr(telnyx_assistant_dial.httpx, "AsyncClient", FakeHttp)
    monkeypatch.setattr(telnyx_assistant_calls.httpx, "AsyncClient", FakeHttp)
    monkeypatch.setattr(telnyx_assistant_calls, "_start_poller", lambda *a: None)

    async def allow(db, to, now_utc=None):
        return compliance.CallGate(allowed=True, reasons=[], warnings=[])

    monkeypatch.setattr(compliance, "check_call_allowed", allow)
    return f


@pytest.fixture
def signed(monkeypatch):
    """Telnyx webhook signatures: valid unless a test says otherwise."""
    state = {"ok": True}
    monkeypatch.setattr("app.api.telnyx_assistant_webhook.verify_telnyx_ed25519_signature", lambda *a, **k: state["ok"])
    return state


def _anon():
    from app.main import app

    return RealClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _company(db, org_id, name):
    from app.core.tenancy import org_scope
    from app.models.models import CompanyProfile

    with org_scope(org_id):
        db.add(CompanyProfile(id="default", name=name))
        await db.commit()


def test_call_reference_is_signed():
    from app.services import voice_assistants as VA

    ref = VA.make_ref("org_acme", "call_123")
    assert VA.read_ref(ref) == ("org_acme", "call_123")
    assert VA.read_ref(ref.replace("org_acme", "org_other")) is None
    assert VA.read_ref("org_acme.call_123.0000") is None
    assert VA.read_ref("") is None


async def test_one_assistant_per_user_with_a_fixed_shell(db, fake):
    from app.core.tenancy import org_scope
    from app.services import voice_assistants as VA

    ann, _ = await make_user(db, "ann", "Admin", org_id="org_acme")
    bob, _ = await make_user(db, "bob", "Operator", org_id="org_acme")
    with org_scope("org_acme"):
        a1 = await VA.assistant_for(db, ann.id)
        a2 = await VA.assistant_for(db, ann.id)
        b1 = await VA.assistant_for(db, bob.id)
        shared = await VA.assistant_for(db, "")
        await db.commit()
    assert a1.telnyx_assistant_id == a2.telnyx_assistant_id == "assistant-1"
    assert {b1.telnyx_assistant_id, shared.telnyx_assistant_id} == {"assistant-2", "assistant-3"}
    creates = [c for c in fake.calls if c[:2] == ("POST", "/ai/assistants")]
    assert len(creates) == 3
    body = creates[0][2]
    assert "{{script}}" in body["instructions"] and body["greeting"] == "{{greeting}}"
    assert "Managed by OutReach" in body["description"] and "org_acme" in body["description"]
    tool_names = {t["webhook"]["name"] for t in body["tools"]}
    assert tool_names == {"get_script", "lookup_knowledge", "check_availability", "book_appointment", "request_human", "save_outcome"}
    assert all(t["webhook"]["url"].startswith("https://outreach.example.com/api/telnyx-assistant/tools/")
               and t["webhook"]["url"].endswith("?ref={{call_ref}}") for t in body["tools"])
    assert body["dynamic_variables_webhook_url"] == "https://outreach.example.com/api/telnyx-assistant/call-event"

    # Another organisation never sees these.
    with org_scope("org_other"):
        from sqlalchemy.future import select

        from app.models.models import VoiceAssistant

        assert (await db.execute(select(VoiceAssistant))).scalars().all() == []


async def test_shell_update_and_telnyx_outage(db, fake, monkeypatch):
    from app.core.tenancy import org_scope
    from app.services import voice_assistants as VA

    ann, _ = await make_user(db, "ann", "Admin", org_id="org_acme")
    with org_scope("org_acme"):
        row = await VA.assistant_for(db, ann.id)
        await db.commit()
        monkeypatch.setattr(VA, "SHELL_VERSION", VA.SHELL_VERSION + 1)
        await VA.assistant_for(db, ann.id)
        assert ("POST", "/ai/assistants/assistant-1") == fake.calls[-1][:2]

        # Telnyx down: the existing assistant keeps working, marked for another try.
        monkeypatch.setattr(VA, "SHELL_VERSION", VA.SHELL_VERSION + 1)
        fake.fail = True
        row = await VA.assistant_for(db, ann.id)
        assert row.telnyx_assistant_id == "assistant-1" and row.status == "error"
        # A user without one yet gets a clear error.
        bob, _ = await make_user(db, "bob", "Operator", org_id="org_acme")
        from app.services.telnyx_client import TelnyxError

        with pytest.raises(TelnyxError):
            await VA.assistant_for(db, bob.id)


async def test_outbound_call_uses_the_callers_assistant_and_its_own_script(db, fake, signed):
    from sqlalchemy.future import select

    from app.core.tenancy import org_scope
    from app.models.models import CallBrief
    from app.services import voice_assistants as VA
    from app.services.telnyx_assistant_calls import decode_client_state, handle_call_control_event
    from app.services.telnyx_assistant_dial import dial_via_telnyx_assistant

    ann, _ = await make_user(db, "ann", "Admin", org_id="org_acme")
    await _company(db, "org_acme", "Acme Windows")
    with org_scope("org_acme"):
        res = await dial_via_telnyx_assistant(db, "+447700900123", prospect_name="Jo Bloggs",
                                              from_number_override="+442071234567", operator_id=ann.id)
        assert res["success"], res
        call = next(j for u, j in FakeHttp.posts if u.endswith("/calls"))
        state = decode_client_state(call["client_state"])
        assert state == {"assistant_id": "assistant-1", "call_id": res["callId"], "org_id": "org_acme"}
        brief = (await db.execute(select(CallBrief).where(CallBrief.id == res["callId"]))).scalars().first()
        assert brief.operator_id == ann.id and brief.direction == "outbound"
        assert "Acme Windows" in brief.script and brief.variables["customer_name"] == "Jo Bloggs"
        assert VA.read_ref(brief.variables["call_ref"]) == ("org_acme", res["callId"])

        # Answered: the assistant starts with exactly this call's variables.
        out = await handle_call_control_event("call.answered", {"call_control_id": "ccid_out_1"}, state)
        assert out["status"] == "assistant_started"
    url, body = FakeHttp.posts[-1]
    assert url.endswith("/calls/ccid_out_1/actions/ai_assistant_start")
    assert body["assistant"] == {"id": "assistant-1", "dynamic_variables": brief.variables}


async def test_without_the_switch_calls_work_as_before(db, fake, monkeypatch):
    from app.core.tenancy import org_scope
    from app.services.telnyx_assistant_dial import dial_via_telnyx_assistant

    monkeypatch.delenv("TELNYX_MANAGED_ASSISTANTS")
    monkeypatch.setattr("app.config.settings.TELNYX_ASSISTANT_ID", "", raising=False)
    ann, _ = await make_user(db, "ann", "Admin", org_id="org_acme")
    with org_scope("org_acme"):
        res = await dial_via_telnyx_assistant(db, "+447700900123", from_number_override="+442071234567", operator_id=ann.id)
    assert not res["success"] and "No Telnyx Assistant ID" in res["error"]
    assert not [c for c in fake.calls if c[1].startswith("/ai/assistants")]


async def _call_with_brief(db, org_id="org_acme"):
    from app.core.tenancy import org_scope
    from app.models.models import LiveCall
    from app.services import voice_assistants as VA

    ann, _ = await make_user(db, f"ann_{org_id}", "Admin", org_id=org_id)
    with org_scope(org_id):
        row = await VA.assistant_for(db, ann.id)
        variables = await VA.build_brief(db, call_id=f"call_{org_id}", direction="outbound", operator_id=ann.id,
                                         assistant_row_id=row.id, phone="+447700900123", prospect_name="Jo")
        db.add(LiveCall(id=f"call_{org_id}", carrier_sid=f"cc_{org_id}", prospect="Jo", mission="Test", state="pitching", carrier="telnyx_assistant"))
        await db.commit()
    return variables["call_ref"], ann


async def test_tools_are_signed_and_stay_in_their_call(db, fake, signed, monkeypatch):
    from sqlalchemy.future import select

    from app.core.tenancy import org_scope
    from app.models.models import FAQ, CallBrief, LiveCall

    ref, ann = await _call_with_brief(db)
    other_ref, _ = await _call_with_brief(db, "org_other")
    with org_scope("org_acme"):
        db.add(FAQ(id="faq_1", question="Do you install windows on weekends?", answer="Yes, Saturdays 9 to 1."))
        await db.commit()

    async def no_vectors(*a, **k):
        raise RuntimeError("no embeddings key")

    monkeypatch.setattr("app.services.rag_service.search_knowledge", no_vectors)
    async with _anon() as c:
        signed["ok"] = False
        bad = await c.post(f"/api/telnyx-assistant/tools/save_outcome?ref={ref}", json={"outcome": "interested"})
        assert bad.status_code == 401, bad.text
        signed["ok"] = True
        r = await c.post("/api/telnyx-assistant/tools/save_outcome?ref=org_acme.call_org_acme.bad", json={"outcome": "interested"})
        assert r.json() == {"success": False, "error": "This call is not recognised."}
        # A reference for another organisation's call never reaches this one's data.
        forged = other_ref.replace("call_org_other", "call_org_acme")
        assert (await c.post(f"/api/telnyx-assistant/tools/get_script?ref={forged}")).json()["success"] is False

        script = (await c.post(f"/api/telnyx-assistant/tools/get_script?ref={ref}")).json()
        assert script["success"] and "Jo" in script["script"]
        k = (await c.post(f"/api/telnyx-assistant/tools/lookup_knowledge?ref={ref}", json={"question": "Do you work weekends?"})).json()
        assert k["found"] and "Saturdays" in k["answer"]
        k = (await c.post(f"/api/telnyx-assistant/tools/lookup_knowledge?ref={ref}", json={"question": "Lunar pricing?"})).json()
        assert k["found"] is False
        r = await c.post(f"/api/telnyx-assistant/tools/save_outcome?ref={ref}",
                         json={"outcome": "callback_requested", "notes": "Call back Friday", "fields": {"email": "jo@x.test"}})
        assert r.json() == {"success": True}
        r = await c.post(f"/api/telnyx-assistant/tools/request_human?ref={ref}", json={"reason": "Wants the owner"})
        assert r.json()["success"]
        assert (await c.post(f"/api/telnyx-assistant/tools/nope?ref={ref}")).json()["success"] is False

    with org_scope("org_acme"):
        brief = (await db.execute(select(CallBrief).where(CallBrief.id == "call_org_acme"))).scalars().first()
        await db.refresh(brief)
        assert brief.outcome == "callback_requested" and brief.captured == {"email": "jo@x.test"} and brief.notes == "Call back Friday"
        live = (await db.execute(select(LiveCall).where(LiveCall.id == "call_org_acme"))).scalars().first()
        await db.refresh(live)
        assert live.state == "human_review" and live.flag == "Wants the owner"


async def test_reported_outcome_reaches_call_history(db, fake, signed):
    from sqlalchemy.future import select

    from app.core.tenancy import org_scope
    from app.models.models import CallLog
    from app.services.call_log_writer import log_id_for_call
    from app.services.telnyx_assistant_calls import finish_call

    ref, _ = await _call_with_brief(db)
    async with _anon() as c:
        await c.post(f"/api/telnyx-assistant/tools/save_outcome?ref={ref}",
                     json={"outcome": "callback_requested", "notes": "Call back Friday"})
    with org_scope("org_acme"):
        await finish_call("cc_org_acme", {"hangup_cause": "normal_clearing"}, summary="Short chat")
        log = (await db.execute(select(CallLog).where(CallLog.id == log_id_for_call("call_org_acme")))).scalars().first()
    assert log.outcome == "callback_requested"
    assert any("Call back Friday" in str(line) for line in log.transcript)


async def test_inbound_call_is_answered_by_the_numbers_user(db, fake, signed):
    from sqlalchemy.future import select

    from app.core.tenancy import org_scope
    from app.models.models import CallBrief, LiveCall, OrgPhoneNumber, PhoneNumberAssignment
    from app.services.telnyx_assistant_calls import decode_client_state

    ann, _ = await make_user(db, "ann", "Admin", org_id="org_acme")
    await _company(db, "org_acme", "Acme Windows")
    with org_scope("org_acme"):
        db.add(OrgPhoneNumber(id="num_1", e164="+442071234567", provider="telnyx", provider_ref="pn_1", status="active"))
        await db.flush()
        db.add(PhoneNumberAssignment(number_id="num_1", operator_id=ann.id))
        await db.commit()

    event = {"data": {"event_type": "call.initiated", "payload": {
        "call_control_id": "ccid_in_1", "direction": "incoming", "from": "+447700900999", "to": "+442071234567"}}}
    async with _anon() as c:
        r = (await c.post("/api/telnyx-assistant/call-control", json=event)).json()
        assert r["status"] == "answered"
        # A number that is not ours is left alone.
        other = json.loads(json.dumps(event))
        other["data"]["payload"].update({"call_control_id": "ccid_in_2", "to": "+442079999999"})
        assert (await c.post("/api/telnyx-assistant/call-control", json=other)).json()["status"] == "ignored"

    answer = next(j for m, p, j in fake.calls if p == "/calls/ccid_in_1/actions/answer")
    state = decode_client_state(answer["client_state"])
    assert state["org_id"] == "org_acme" and state["call_id"] == r["callId"] and state["assistant_id"] == "assistant-1"
    with org_scope("org_acme"):
        brief = (await db.execute(select(CallBrief).where(CallBrief.id == r["callId"]))).scalars().first()
        assert brief.direction == "inbound" and brief.operator_id == ann.id and brief.phone == "+447700900999"
        assert brief.variables["call_direction"] == "inbound" and "Acme Windows" in brief.script
        assert (await db.execute(select(LiveCall).where(LiveCall.carrier_sid == "ccid_in_1"))).scalars().first() is not None

    # Telnyx asking for the variables gets this call's brief.
    init = {"data": {"event_type": "assistant.initialization", "payload": {"call_control_id": "ccid_in_1",
                                                                          "telnyx_end_user_target": "+447700900999"}}}
    async with _anon() as c:
        got = (await c.post("/api/telnyx-assistant/call-event", json=init)).json()
    assert got == {"dynamic_variables": brief.variables}


async def test_inbound_ignored_when_switched_off(db, fake, signed, monkeypatch):
    monkeypatch.delenv("TELNYX_MANAGED_ASSISTANTS")
    event = {"data": {"event_type": "call.initiated", "payload": {
        "call_control_id": "ccid_in_9", "direction": "incoming", "from": "+447700900999", "to": "+442071234567"}}}
    async with _anon() as c:
        assert (await c.post("/api/telnyx-assistant/call-control", json=event)).json()["status"] == "ignored"
    assert not fake.calls


def test_client_state_stays_compatible():
    from app.services.telnyx_assistant_calls import DIAL_MARKER, decode_client_state, encode_client_state

    old = base64.b64encode(f"{DIAL_MARKER}:asst:call_1".encode()).decode()
    assert decode_client_state(old) == {"assistant_id": "asst", "call_id": "call_1", "org_id": ""}
    assert decode_client_state(encode_client_state("asst", "call_1", "org_x")) == {"assistant_id": "asst", "call_id": "call_1", "org_id": "org_x"}
