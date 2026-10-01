"""Telnyx assistant calls: take over by ringing the user's phone and bridging, hand back with
a note, the user hanging up, recordings saved and served to the right organisation only, and
credits per call in history."""
import pytest

from tests.conftest import make_user
from tests.voice_fakes import FakeHttp, RealClient

pytestmark = pytest.mark.db


def _as(token=None):
    import httpx

    from app.main import app

    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return RealClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers)


async def _live_call(db, phone="+447700900555"):
    """A managed-assistant call that is up: its brief, LiveCall and the caller's phone saved."""
    from sqlalchemy import update

    from app.core.tenancy import org_scope
    from app.models.models import LiveCall, Operator
    from app.services import voice_assistants as VA

    ann, token = await make_user(db, "ann", "Admin", org_id="org_acme")
    with org_scope("org_acme"):
        await db.execute(update(Operator).where(Operator.id == ann.id).values(phone=phone))
        row = await VA.assistant_for(db, ann.id)
        await VA.build_brief(db, call_id="call_t1", direction="outbound", operator_id=ann.id, assistant_row_id=row.id,
                             phone="+447700900123", our_number="+442071234567", prospect_name="Jo")
        db.add(LiveCall(id="call_t1", carrier_sid="cc_prospect", prospect="Jo", mission="Test", state="pitching", carrier="telnyx_assistant"))
        await db.commit()
    return ann, token


def _posts(suffix):
    return [(u, j) for u, j in FakeHttp.posts if u.endswith(suffix)]


async def _state(db):
    from sqlalchemy.future import select

    from app.core.tenancy import org_scope
    from app.models.models import CallBrief, LiveCall

    db.expire_all()
    with org_scope("org_acme"):
        live = (await db.execute(select(LiveCall).where(LiveCall.id == "call_t1"))).scalars().first()
        brief = (await db.execute(select(CallBrief).where(CallBrief.id == "call_t1"))).scalars().first()
        return live.taken, live.state, brief.supervisor_leg, list(live.transcript or []), brief.notes


async def test_take_over_rings_the_user_and_bridges_then_hands_back_with_a_note(db, fake, signed):
    from app.services.voice_takeover import BACK_GREETING, decode_leg

    _, token = await _live_call(db)
    async with _as(token) as c:
        lv = next(x for x in (await c.get("/api/calls/live")).json() if x["id"] == "call_t1")
        assert lv["takeoverByPhone"] is True and lv["supportsListen"] is False
        r = await c.post("/api/calls/live/call_t1/takeover")
        assert r.status_code == 200 and r.json() == {"status": "ringing", "taken": True}
        assert (await c.post("/api/calls/live/call_t1/takeover")).json()["taken"] is False  # pressing again hands back
        r = await c.post("/api/calls/live/call_t1/takeover")
        assert r.json()["taken"] is True
    assert _posts("/calls/cc_prospect/actions/ai_assistant_stop")
    ring = _posts("/calls")[-1][1]
    assert ring["to"] == "+447700900555" and ring["from"] == "+442071234567" and decode_leg(ring["client_state"]) == ("call_t1", "org_acme")
    taken, state, leg, lines, _ = await _state(db)
    assert taken and state == "human_review" and leg == "ccid_out_1"

    # The user answers: the two calls are joined.
    answered = {"data": {"event_type": "call.answered", "payload": {"call_control_id": "ccid_out_1", "client_state": ring["client_state"]}}}
    async with _as() as c:
        assert (await c.post("/api/telnyx-assistant/call-control", json=answered)).json()["status"] == "bridged"
    assert _posts("/calls/ccid_out_1/actions/bridge")[-1][1] == {"call_control_id": "cc_prospect"}

    # Hand back with a note: the user's leg hangs up, the assistant continues from the note.
    async with _as(token) as c:
        r = await c.post("/api/calls/live/call_t1/handback", json={"note": "They want a quote by Friday"})
        assert r.json() == {"status": "handed_back", "taken": False}
        assert (await c.post("/api/calls/live/call_t1/handback", json={})).status_code == 400  # nothing to hand back
    assert _posts("/calls/ccid_out_1/actions/hangup")
    restart = _posts("/calls/cc_prospect/actions/ai_assistant_start")[-1][1]
    variables = restart["assistant"]["dynamic_variables"]
    assert variables["greeting"] == BACK_GREETING and "They want a quote by Friday" in variables["script"]
    taken, state, leg, lines, notes = await _state(db)
    assert not taken and state == "pitching" and leg == "" and "quote by Friday" in notes


async def test_user_hanging_up_hands_the_call_back(db, fake, signed):
    _, token = await _live_call(db)
    async with _as(token) as c:
        await c.post("/api/calls/live/call_t1/takeover")
    ring = _posts("/calls")[-1][1]
    hung = {"data": {"event_type": "call.hangup", "payload": {"call_control_id": "ccid_out_1", "client_state": ring["client_state"]}}}
    async with _as() as c:
        assert (await c.post("/api/telnyx-assistant/call-control", json=hung)).json()["status"] == "handed_back"
    taken, *_ = await _state(db)
    assert not taken and _posts("/calls/cc_prospect/actions/ai_assistant_start")


async def test_take_over_needs_your_phone(db, fake):
    _, token = await _live_call(db, phone="")
    async with _as(token) as c:
        r = await c.post("/api/calls/live/call_t1/takeover")
    assert r.status_code == 400 and "Agent Studio" in r.json()["detail"]
    assert not _posts("/actions/ai_assistant_stop")


async def test_recording_is_saved_and_only_its_organisation_can_play_it(db, fake, signed, monkeypatch, tmp_path):
    import base64

    from app.services import call_recorder, voice_takeover
    from app.services.telnyx_assistant_calls import DIAL_MARKER

    monkeypatch.setattr(call_recorder, "RECORDINGS_DIR", str(tmp_path))
    _, token = await _live_call(db)
    state = base64.b64encode(f"{DIAL_MARKER}:assistant-1:call_t1|org_acme".encode()).decode()
    saved = {"data": {"event_type": "call.recording.saved", "payload": {
        "call_control_id": "cc_prospect", "client_state": state, "recording_urls": {"mp3": "https://s3.example.com/rec.mp3"}}}}
    async with _as() as c:
        assert (await c.post("/api/telnyx-assistant/call-control", json=saved)).json()["status"] == "recording_saved"
    assert (tmp_path / "call_t1.mp3").exists()
    assert voice_takeover.decode_leg(state) is None
    async with _as(token) as c:
        r = await c.get("/api/calls/call_t1/recording")
        assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    _, other = await make_user(db, "zed", "Admin", org_id="org_other")
    async with _as(other) as c:
        assert (await c.get("/api/calls/call_t1/recording")).status_code == 404


async def test_call_history_shows_credits_used(client, db):
    from app.models.models import CallLog
    from app.services import credits as K

    db.add(CallLog(id="cl_abc", canonical_name="Jo", listed_as="Jo", started_at="x", ended_at="y", duration="03:10", channel="voice"))
    await db.commit()
    await K.charge(db, "voice_minute", 4, "call:cl_abc")
    await db.commit()
    row = next(x for x in (await client.get("/api/calls/logs")).json() if x["id"] == "cl_abc")
    assert row["creditsUsed"] == 4
