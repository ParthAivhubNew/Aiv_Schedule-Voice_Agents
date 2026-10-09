"""Phase 3: AI phone calls through the public API, on the managed assistant, against the repo's fake phone network.
No real call is ever placed here."""
import asyncio

import httpx
import pytest
from sqlalchemy.future import select

from tests.conftest import make_user
from tests.voice_fakes import FakeHttp, RealClient

pytestmark = pytest.mark.db

ORG = "org_acme"


def _http(token):
    from app.main import app

    return RealClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                      headers={"Authorization": f"Bearer {token}"})


@pytest.fixture(autouse=True)
def fresh_limits():
    from app.public_api import core

    core._WINDOWS.clear()
    yield
    core._WINDOWS.clear()


async def _company(db):
    """Acme: a name, a phone number, voice credits and an admin who makes a live key and a test key."""
    from app.core.tenancy import org_scope
    from app.models.models import CompanyProfile, OrgPhoneNumber
    from app.services import credits as K

    _, admin = await make_user(db, "ann", "Admin", org_id=ORG)
    with org_scope(ORG):
        db.add(CompanyProfile(id="default", name="Acme Windows"))
        db.add(OrgPhoneNumber(id="num_1", e164="+442071234567", provider="telnyx", status="active", is_default=True))
        await db.commit()
        await K.add_credits(db, "voice", 600, source="grant")
        await db.commit()
    keys = {}
    async with _http(admin) as c:
        for name, live in (("live", True), ("test", False)):
            r = await c.post("/api/developer/keys", json={"name": f"{name} key", "scopes": ["voice:calls"], "live": live})
            assert r.status_code == 200, r.text
            keys[name] = r.json()["secret"]
    return keys


async def test_a_call_carries_the_goal_and_questions_to_the_assistant(db, fake):
    from app.core.tenancy import org_scope
    from app.models.models import CallBrief, PublicObject

    keys = await _company(db)
    async with _http(keys["live"]) as c:
        r = await c.post("/v1/voice/calls", json={
            "to": "+447700900123", "lead_name": "Jo Bloggs",
            "goal": "Book a 15 minute demo", "instructions": "Be brief. Never mention pricing.",
            "questions": ["How many staff do you have?", {"ask": "Which CRM do you use?", "key": "crm"}],
            "variables": {"company": "Bloggs Ltd"}})
        assert r.status_code == 202, r.text
        call = r.json()
        assert call["id"].startswith("call_") and call["status"] == "ringing" and call["live_url"]
        assert call["capabilities"] == {"guide": False, "take_over": False, "hand_back": False, "end": True}  # nobody has answered yet
    with org_scope(ORG):
        brief = (await db.execute(select(CallBrief).where(CallBrief.id == call["id"]))).scalars().one()
        assert "Book a 15 minute demo" in brief.script and "Never mention pricing" in brief.script
        assert '"how_many_staff_do_you_have"' in brief.script and '"crm"' in brief.script and "company: Bloggs Ltd" in brief.script
        assert brief.script.index("SPECIAL INSTRUCTIONS") < brief.script.index("COMPANY RULES")  # read before the standing rules
        assert brief.operator_id == "" and brief.variables["customer_name"] == "Jo Bloggs"
        assert (await db.get(PublicObject, f"callmeta_{call['id']}")) is not None
    dialled = next(j for u, j in FakeHttp.posts if u.endswith("/calls"))
    assert dialled["to"] == "+447700900123" and dialled["from"] == "+442071234567"


async def test_the_answers_the_ai_saves_come_back_on_the_call(db, fake, signed):
    from app.core.tenancy import org_scope
    from app.models.models import LiveCall
    from app.services import voice_assistants as VA
    from app.services import voice_tools

    keys = await _company(db)
    async with _http(keys["live"]) as c:
        call = (await c.post("/v1/voice/calls", json={"to": "+447700900123", "questions": ["Which CRM do you use?"]})).json()
        with org_scope(ORG):
            await voice_tools.run("save_outcome", call["id"], {"outcome": "interested", "notes": "Warm", "fields": {"which_crm_do_you_use": "HubSpot"}})
            live = (await db.execute(select(LiveCall).where(LiveCall.id == call["id"]))).scalars().one()
            live.state, live.carrier = "pitching", "telnyx_assistant"
            await db.commit()
        got = (await c.get(f"/v1/voice/calls/{call['id']}")).json()
        assert got["answers"] == {"which_crm_do_you_use": "HubSpot"} and got["status"] == "in_progress"
        assert got["capabilities"]["guide"] and got["capabilities"]["take_over"] and not got["capabilities"]["hand_back"]


async def test_calls_that_cannot_be_placed_say_why(db, fake, monkeypatch):
    from app.services import telnyx_assistant_dial as D

    keys = await _company(db)
    async with _http(keys["live"]) as c:
        bad = await c.post("/v1/voice/calls", json={"to": "12"})
        assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_phone_number"
        no_script = await c.post("/v1/voice/calls", json={"to": "+447700900123", "script_id": "tpl_missing"})
        assert no_script.status_code == 422 and no_script.json()["error"]["code"] == "invalid_script"
        too_many = await c.post("/v1/voice/calls", json={"to": ["+447700900123"] * 26})
        assert too_many.status_code == 422

        async def broke(db_, to, **k):
            return {"success": False, "error": "USR-01: Out of Voice credits.", "code": "OUT_OF_CREDITS"}

        monkeypatch.setattr(D, "dial_via_telnyx_assistant", broke)
        r = await c.post("/v1/voice/calls", json={"to": "+447700900123"})
        assert r.status_code == 402 and r.json()["error"]["code"] == "insufficient_credits" and r.json()["error"]["details"]["top_up_url"]

        async def blocked(db_, to, **k):
            return {"success": False, "error": "On the do-not-call list.", "compliance": {"blocked": True, "reasons": ["On the do-not-call list."]}}

        monkeypatch.setattr(D, "dial_via_telnyx_assistant", blocked)
        r = await c.post("/v1/voice/calls", json={"to": "+447700900123"})
        assert r.status_code == 422 and r.json()["error"]["code"] == "call_not_allowed"


async def test_goals_need_the_managed_assistant_and_plain_calls_do_not(db, fake, monkeypatch):
    keys = await _company(db)
    monkeypatch.delenv("TELNYX_MANAGED_ASSISTANTS")
    monkeypatch.setattr("app.config.settings.TELNYX_ASSISTANT_ID", "asst_pasted", raising=False)
    async with _http(keys["live"]) as c:
        r = await c.post("/v1/voice/calls", json={"to": "+447700900123", "goal": "Book a demo"})
        assert r.status_code == 409 and r.json()["error"]["code"] == "custom_script_unavailable"  # said plainly, not silently dropped


async def test_several_numbers_at_once_and_one_bad_number_does_not_stop_the_rest(db, fake):
    keys = await _company(db)
    async with _http(keys["live"]) as c:
        r = await c.post("/v1/voice/calls", json={"to": ["+447700900123", "nope", "+447700900124"], "goal": "Say hello"})
        assert r.status_code == 202
        assert len(r.json()["data"]) == 2 and r.json()["failed"][0]["to"] == "nope"
        listed = (await c.get("/v1/voice/calls")).json()
        assert len(listed["data"]) == 2 and listed["next_cursor"] is None


async def test_steering_a_live_call(db, fake, monkeypatch):
    from app.core.tenancy import org_scope
    from app.models.models import LiveCall
    from app.services import voice_takeover as T

    keys = await _company(db)
    seen = []

    async def guide(db_, rec, text):
        seen.append(("guide", text))

    async def take_over(db_, rec, op):
        seen.append(("take_over", op.phone))
        rec.taken = True
        await db_.commit()

    async def hand_back(db_, rec, note):
        seen.append(("hand_back", note))
        rec.taken = False
        await db_.commit()

    monkeypatch.setattr(T, "guide", guide)
    monkeypatch.setattr(T, "take_over", take_over)
    monkeypatch.setattr(T, "hand_back", hand_back)
    async with _http(keys["live"]) as c:
        call = (await c.post("/v1/voice/calls", json={"to": "+447700900123", "goal": "Say hello"})).json()
        url = f"/v1/voice/calls/{call['id']}/control"
        early = await c.post(url, json={"action": "guide", "message": "Offer Tuesday"})
        assert early.status_code == 409 and early.json()["error"]["code"] == "not_possible"  # still ringing
        with org_scope(ORG):
            live = (await db.execute(select(LiveCall).where(LiveCall.id == call["id"]))).scalars().one()
            live.state, live.carrier = "pitching", "telnyx_assistant"
            await db.commit()
        assert (await c.post(url, json={"action": "guide", "message": "Offer Tuesday at 3pm"})).status_code == 200
        no_phone = await c.post(url, json={"action": "take_over"})
        assert no_phone.status_code == 422
        taken = (await c.post(url, json={"action": "take_over", "phone": "+447911123456"})).json()
        assert taken["human"]["taken_over"] is True and taken["capabilities"]["hand_back"] is True
        assert (await c.post(url, json={"action": "guide", "message": "x"})).status_code == 409  # a person has it
        back = (await c.post(url, json={"action": "hand_back", "note": "They want a quote"})).json()
        assert back["human"]["taken_over"] is False
    assert seen == [("guide", "Offer Tuesday at 3pm"), ("take_over", "+447911123456"), ("hand_back", "They want a quote")]


async def test_ending_a_call_and_reading_the_scripts(db, fake, monkeypatch):
    from app.core.tenancy import org_scope
    from app.models.models import ConversationTemplate

    keys = await _company(db)
    with org_scope(ORG):
        db.add(ConversationTemplate(id="tpl_demo", name="Demo booking", description="Book a demo", call_direction="outbound",
                                    greeting_template="Hi", value_prop_template="v", booking_transition_template="b",
                                    confirmation_template="c", closing_template="x"))
        db.add(ConversationTemplate(id="tpl_in", name="Reception", call_direction="inbound", greeting_template="Hi",
                                    value_prop_template="v", booking_transition_template="b", confirmation_template="c", closing_template="x"))
        await db.commit()
    ended = []

    async def terminate(call_id, db_, ended_by="x"):
        ended.append((call_id, ended_by))
        return {"ok": True}

    monkeypatch.setattr("app.api.calls.terminate_live_call", terminate)
    async with _http(keys["live"]) as c:
        scripts = (await c.get("/v1/voice/scripts")).json()["data"]
        assert [s["id"] for s in scripts] == ["tpl_demo"]  # outbound scripts only
        call = (await c.post("/v1/voice/calls", json={"to": "+447700900123", "script_id": "tpl_demo"})).json()
        assert (await c.delete(f"/v1/voice/calls/{call['id']}")).status_code == 200
        assert (await c.delete("/v1/voice/calls/call_nope")).status_code == 404
    assert ended == [(call["id"], "api")]


async def test_the_finished_call_event_carries_the_answers_once_per_outcome(db, monkeypatch):
    from app.core.tenancy import org_scope
    from app.models.models import CallBrief, LiveCall
    from app.public_api import voice_events
    from app.services import webhook_dispatcher as W

    sent = []
    monkeypatch.setattr(W, "dispatch_event", lambda org, event, data, test=False: sent.append((org, event, data)))
    await make_user(db, "ann", "Admin", org_id=ORG)
    with org_scope(ORG):
        db.add(CallBrief(id="call_e1", phone="+447700900123", captured={"crm": "HubSpot"}, notes="Warm"))
        call = LiveCall(id="call_e1", prospect="Jo", mission="m", booked=True)
        db.add(call)
        await db.commit()
        legacy = {"call_id": "call_e1", "prospect": "Acme", "person": "Jo", "duration": "03:12 min", "outcome": "meeting_booked", "transcript": []}
        await voice_events.dispatch_finished(db, ORG, "call.completed", call, legacy)
        await voice_events.dispatch_finished(db, ORG, "call.completed", call, legacy)  # the same outcome again: not sent again
        await voice_events.dispatch_finished(db, ORG, "call.completed", call, {**legacy, "outcome": "interested"})
        await db.commit()
    assert [(e[1], e[2]["outcome"]) for e in sent] == [("call.completed", "meeting_booked"), ("call.completed", "interested")]
    first = sent[0][2]
    assert first["answers"] == {"crm": "HubSpot"} and first["meeting_booked"] is True and first["duration_seconds"] == 192
    assert first["to"] == "+447700900123" and first["call_id"] == "call_e1" and first["recording_url"].endswith("/v1/voice/calls/call_e1/recording")


async def test_the_assistant_asking_for_a_person_reaches_the_customers_webhook(db, fake, signed, monkeypatch):
    from app.core.tenancy import org_scope
    from app.models.models import LiveCall
    from app.services import voice_assistants as VA
    from app.services import webhook_dispatcher as W
    from app.services import voice_tools

    sent = []
    monkeypatch.setattr(W, "dispatch_event", lambda org, event, data, test=False: sent.append((org, event, data)))
    keys = await _company(db)
    async with _http(keys["live"]) as c:
        call = (await c.post("/v1/voice/calls", json={"to": "+447700900123", "lead_name": "Jo"})).json()
    with org_scope(ORG):
        await voice_tools.run("request_human", call["id"], {"reason": "Wants to negotiate"})
    [(org, event, data)] = sent
    assert (org, event) == (ORG, "call.needs_human") and data["reason"] == "Wants to negotiate" and "/api/p/" in data["live_url"]


async def test_the_live_call_page_needs_no_sign_in_and_steers_the_same_call(db, fake, monkeypatch):
    from app.core.tenancy import org_scope
    from app.models.models import LiveCall
    from app.services import voice_takeover as T

    keys = await _company(db)
    guided = []

    async def guide(db_, rec, text):
        guided.append(text)

    monkeypatch.setattr(T, "guide", guide)
    async with _http(keys["live"]) as c:
        call = (await c.post("/v1/voice/calls", json={"to": "+447700900123", "lead_name": "Jo Bloggs"})).json()
    with org_scope(ORG):
        live = (await db.execute(select(LiveCall).where(LiveCall.id == call["id"]))).scalars().one()
        live.state, live.carrier, live.transcript = "pitching", "telnyx_assistant", ["AI: Hello Jo", "Prospect: Hi"]
        await db.commit()
    path = "/api/p/" + call["live_url"].split("/api/p/")[1]
    from app.main import app

    async with RealClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        page = await anon.get(path)
        assert page.status_code == 200 and "Jo Bloggs" in page.text and "Hello Jo" in page.text and "Take the call yourself" in page.text
        done = await anon.post(path, data={"action": "guide", "message": "Offer Tuesday"})
        assert "carries on with your instruction" in done.text
        assert (await anon.get("/api/p/garbage")).status_code == 404
    assert guided == ["Offer Tuesday"]


async def test_test_keys_get_a_pretend_call_with_answers_and_a_test_webhook(db, monkeypatch):
    from app.models.models import CallLog, LiveCall
    from app.services import webhook_dispatcher as W

    monkeypatch.setenv("PUBLIC_API_SANDBOX_CALL_SECONDS", "0")
    sent = []
    monkeypatch.setattr(W, "dispatch_event", lambda org, event, data, test=False: sent.append((event, test, data)))
    keys = await _company(db)
    async with _http(keys["test"]) as c:
        r = await c.post("/v1/voice/calls", json={"to": "+447700900123", "goal": "Book a meeting", "questions": [{"ask": "Staff?", "key": "staff"}]})
        assert r.status_code == 202
        await asyncio.sleep(0.05)
        done = (await c.get(f"/v1/voice/calls/{r.json()['id']}")).json()
        assert done["id"].startswith("call_test_") and done["status"] == "completed" and done["test"] is True
        assert done["answers"] == {"staff": "Test answer"} and done["meeting_booked"] is True
        assert (await c.post(f"/v1/voice/calls/{done['id']}/control", json={"action": "guide", "message": "x"})).status_code == 409
        assert len((await c.get("/v1/voice/calls")).json()["data"]) == 1
    assert [(e[0], e[1]) for e in sent] == [("call.completed", True)]
    assert (await db.execute(select(LiveCall))).scalars().all() == [] and (await db.execute(select(CallLog))).scalars().all() == []


async def test_one_company_cannot_see_anothers_calls(db, fake):
    keys = await _company(db)
    async with _http(keys["live"]) as c:
        call = (await c.post("/v1/voice/calls", json={"to": "+447700900123"})).json()
    _, other = await make_user(db, "rival", "Admin", org_id="org_rival")
    async with _http(other) as c:
        other_key = (await c.post("/api/developer/keys", json={"name": "Rival key", "scopes": ["voice:calls"], "live": False})).json()["secret"]
    async with _http(other_key) as c:
        assert (await c.get(f"/v1/voice/calls/{call['id']}")).status_code == 404
