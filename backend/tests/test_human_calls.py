"""Calls a person makes from the browser: checks before the call, one charge after it, transcripts, the sweep."""
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy.future import select

from app.main import app
from app.models.models import CallLog, HumanCall, LiveCall, OrgPhoneNumber, OrgTelnyx
from app.services import call_summary, compliance, credits as K, human_calls as HC, transcribe as T
from app.services.call_log_writer import log_id_for_call
from app.services.telnyx_client import TelnyxError
from tests.conftest import make_user


class FakePhone:
    """Stands in for the Telnyx client used for browser calls."""

    def __init__(self):
        self.calls = []
        self.profile = "ovp_1"
        self.n = 0
        self.down = False

    async def create_credential_connection(self, name, profile, url=""):
        self.calls.append(("create_connection", name, profile))
        return {"id": "conn_1"}

    async def find_credential_connection(self, name):
        return {"id": "conn_1"}

    async def get_credential_connection(self, cid):
        return {"id": cid, "outbound": {"outbound_voice_profile_id": self.profile}}

    async def set_credential_connection_active(self, cid, active):
        self.calls.append(("active", cid, active))

    async def create_telephony_credential(self, conn, name, expires_at=""):
        if self.down:
            raise TelnyxError("Telnyx is down", 503)
        self.n += 1
        self.calls.append(("create_credential", name, expires_at))
        return {"id": f"cred_{self.n}", "sip_username": f"gencred{self.n}"}

    async def telephony_credential_token(self, cid):
        return f"jwt-{cid}"

    async def delete_telephony_credential(self, cid):
        self.calls.append(("delete_credential", cid))


@pytest.fixture
async def phone(db, monkeypatch):
    fake = FakePhone()
    monkeypatch.setattr("app.services.telnyx_provisioning.client_for", lambda setup: fake)
    monkeypatch.setenv("TELNYX_DAILY_SPEND_LIMIT_USD", "5")
    db.add(OrgTelnyx(id="org_default", mode="billing_group", status="ready", outbound_voice_profile_id="ovp_1", allowed_countries=["GB"]))
    db.add(OrgPhoneNumber(id="num_1", e164="+442079460000", provider="telnyx", provider_ref="pn_1", status="active"))
    await db.commit()
    await K.grant(db, 60, note="test", wallet="voice")
    await db.commit()
    return fake


@pytest.fixture
def signed(monkeypatch):
    state = {"ok": True}
    monkeypatch.setattr("app.services.telnyx_signature.verify_telnyx_ed25519_signature", lambda *a, **k: state["ok"])
    return state


def api(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def begin(c, **kw):
    body = {"to": "+441189000123", "from_number": "+442079460000", **kw}
    return await c.post("/api/human-calls/start", json=body)


async def answer_and_age(db, ref, seconds):
    hc = await db.get(HumanCall, ref)
    hc.state, hc.answered_at = "answered", datetime.utcnow() - timedelta(seconds=seconds)
    await db.commit()


@pytest.mark.db
async def test_start_checks_everything_and_hands_over_one_login(db, phone):
    _, token = await make_user(db, "caller", "Admin")
    async with api(token) as c:
        r = await begin(c)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["token"] == "jwt-cred_1" and body["call_ref"].startswith("call_") and body["max_seconds"] == 3600
        make = [x for x in phone.calls if x[0] == "create_credential"][0]
        assert make[1] == body["call_ref"] and make[2].endswith("Z")  # a login that ends on its own
        assert await db.get(HumanCall, body["call_ref"]) and await db.get(LiveCall, body["call_ref"]) and await db.get(CallLog, log_id_for_call(body["call_ref"]))
        # one open call at a time
        assert (await begin(c)).status_code == 409


@pytest.mark.db
async def test_refusals(db, phone, monkeypatch):
    _, token = await make_user(db, "caller2", "Admin")
    async with api(token) as c:
        assert (await begin(c, to="12")).status_code == 400  # not a number
        assert (await begin(c, from_number="+442079469999")).status_code == 400  # not our number
        assert (await begin(c, to="+33612345678")).status_code == 400  # country not switched on
        assert (await begin(c, record=True)).status_code == 400  # recording needs the confirmation

        async def blocked(db_, to, now_utc=None):
            return compliance.CallGate(allowed=False, reasons=["This number opted out (do not call)."], warnings=[])

        monkeypatch.setattr(compliance, "check_call_allowed", blocked)
        r = await begin(c)
        assert r.status_code == 403 and "opted out" in r.json()["detail"]
        assert not (await db.execute(select(HumanCall))).scalars().all()  # nothing was made
    assert not [x for x in phone.calls if x[0] == "create_credential"]  # and no login either


@pytest.mark.db
async def test_no_credit_no_call_and_a_telnyx_failure_gives_the_hold_back(db, phone):
    _, token = await make_user(db, "caller3", "Admin")
    async with api(token) as c:
        phone.down = True
        assert (await begin(c)).status_code == 503
        assert await K.wallet_balance(db, "voice") == 60  # the hold was released
        assert not (await db.execute(select(HumanCall))).scalars().all()
        phone.down = False
        await K.grant(db, -60, note="drain", wallet="voice")
        await db.commit()
        assert (await begin(c)).status_code == 402


@pytest.mark.db
async def test_the_login_must_use_our_own_profile(db, phone):
    _, token = await make_user(db, "caller4", "Admin")
    phone.profile = "someone_elses"
    async with api(token) as c:
        assert (await begin(c)).status_code == 503


@pytest.mark.db
async def test_ending_charges_whole_minutes_once_and_only_the_owner_can_end(db, phone):
    _, token = await make_user(db, "caller5", "Admin")
    _, other = await make_user(db, "stranger", "Admin")
    async with api(token) as c, api(other) as o:
        ref = (await begin(c)).json()["call_ref"]
        assert (await o.post(f"/api/human-calls/{ref}/end", json={})).status_code == 404
        await c.post(f"/api/human-calls/{ref}/connected", json={"answered": True})
        await answer_and_age(db, ref, 125)
        r = await c.post(f"/api/human-calls/{ref}/end", json={"outcome": "talked", "note": "Wants a quote"})
        assert r.status_code == 200 and r.json()["minutes"] == 3 and r.json()["state"] == "ended"
        before = await K.wallet_balance(db, "voice")
        assert before == 57
        again = await c.post(f"/api/human-calls/{ref}/end", json={"outcome": "talked"})
        assert again.status_code == 200 and await K.wallet_balance(db, "voice") == before  # charged once
        log = await db.get(CallLog, log_id_for_call(ref))
        await db.refresh(log)
        assert log.duration == "3 min" and log.outcome == "contacted" and "quote" in log.summary
        assert ("delete_credential", "cred_1") in phone.calls


@pytest.mark.db
async def test_an_unanswered_call_costs_nothing(db, phone):
    _, token = await make_user(db, "caller6", "Admin")
    async with api(token) as c:
        ref = (await begin(c)).json()["call_ref"]
        r = await c.post(f"/api/human-calls/{ref}/end", json={"outcome": "no_answer"})
        assert r.json()["minutes"] == 0 and await K.wallet_balance(db, "voice") == 60


@pytest.mark.db
async def test_do_not_call_outcome_blocks_the_number_next_time(db, phone):
    _, token = await make_user(db, "caller7", "Admin")
    async with api(token) as c:
        ref = (await begin(c)).json()["call_ref"]
        await c.post(f"/api/human-calls/{ref}/end", json={"outcome": "do_not_call"})
        assert (await begin(c)).status_code == 403


@pytest.mark.db
async def test_the_sweep_closes_a_call_whose_tab_died(db, phone):
    _, token = await make_user(db, "caller8", "Admin")
    async with api(token) as c:
        ref = (await begin(c)).json()["call_ref"]
    hc = await db.get(HumanCall, ref)
    hc.started_at = datetime.utcnow() - timedelta(hours=3)
    hc.answered_at = hc.started_at + timedelta(seconds=10)
    await db.commit()
    assert (await HC.sweep(db))["closed"] == 1
    await db.refresh(hc)
    assert hc.state == "ended" and hc.billed_minutes == 61  # capped at the hold (3600 s + 60), never open-ended
    assert (await HC.sweep(db))["closed"] == 0


@pytest.mark.db
async def test_telnyx_events_close_a_call_and_bad_signatures_are_refused(db, phone, signed):
    _, token = await make_user(db, "caller9", "Admin")
    async with api(token) as c:
        ref = (await begin(c)).json()["call_ref"]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        event = {"data": {"event_type": "call.hangup", "payload": {"client_state": ref, "call_session_id": "sess_1"}}}
        signed["ok"] = False
        assert (await anon.post("/api/human-calls/events", json=event)).status_code == 401
        signed["ok"] = True
        assert (await anon.post("/api/human-calls/events", json=event)).json()["status"] == "closed"
        unknown = {"data": {"event_type": "call.hangup", "payload": {"client_state": "call_nope"}}}
        assert (await anon.post("/api/human-calls/events", json=unknown)).json()["status"] == "ignored"
    hc = await db.get(HumanCall, ref)
    await db.refresh(hc)
    assert hc.state == "ended" and hc.telnyx_session_id == "sess_1"


@pytest.fixture
def fake_speech(monkeypatch):
    state = {"fail": 0, "lines": [{"who": "you", "start": 1.0, "text": "Hello, is that Maria?"}, {"who": "them", "start": 4.0, "text": "Yes, speaking."}]}

    async def transcribe(path):
        if state["fail"] > 0:
            state["fail"] -= 1
            raise T.TranscribeError("The transcript could not be made just now.")
        return state["lines"]

    async def ask(db, system, text, max_tokens):
        return "Maria asked for a quote."

    monkeypatch.setattr(T, "transcribe", transcribe)
    monkeypatch.setattr(call_summary, "_ask", ask)
    monkeypatch.setattr(HC, "TRANSCRIBE_RETRY_S", 0)
    monkeypatch.setattr(HC, "recordings_dir", lambda: str(__import__("tempfile").gettempdir()))
    return state


@pytest.fixture
def no_auto(monkeypatch):
    """Tests that run the transcript job by hand: the job that ending a call starts by itself stays out of the way."""
    async def idle(db, hc):
        return None

    monkeypatch.setattr(HC, "maybe_start_transcript", idle)


async def recorded_call(c, db, minutes=2):
    ref = (await begin(c, record=True, consent_ack=True)).json()["call_ref"]
    await c.post(f"/api/human-calls/{ref}/connected", json={"answered": True})
    r = await c.post(f"/api/human-calls/{ref}/audio", content=b"audio-bytes", headers={"content-type": "audio/webm"})
    assert r.status_code == 200, r.text
    await answer_and_age(db, ref, minutes * 60 - 10)
    return ref


@pytest.mark.db
async def test_a_transcript_is_saved_speaker_by_speaker_and_charged_once(db, phone, no_auto, fake_speech):
    _, token = await make_user(db, "caller10", "Admin")
    async with api(token) as c:
        ref = await recorded_call(c, db)
        await c.post(f"/api/human-calls/{ref}/end", json={"outcome": "talked"})
        assert await K.wallet_balance(db, "voice") == 60 - 2
        res = await HC.run_transcript(db, ref)
        assert res["status"] == "ready"
        after = await K.wallet_balance(db, "voice")
        assert after == 60 - 2 - 2  # the call, then the transcript at the same number of minutes
        assert (await HC.run_transcript(db, ref))["status"] == "skipped" and await K.wallet_balance(db, "voice") == after
        t = (await c.get(f"/api/human-calls/{ref}/transcript")).json()
        assert [l["who"] for l in t["lines"]] == ["you", "them"] and t["summary"].startswith("Maria asked") and t["charged"] is True
        assert (await c.get(f"/api/human-calls/{ref}/audio")).status_code == 200


@pytest.mark.db
async def test_a_failed_transcript_costs_nothing_and_can_be_tried_again(db, phone, no_auto, fake_speech):
    _, token = await make_user(db, "caller11", "Admin")
    async with api(token) as c:
        ref = await recorded_call(c, db)
        await c.post(f"/api/human-calls/{ref}/end", json={})
        fake_speech["fail"] = 3
        balance = await K.wallet_balance(db, "voice")
        assert (await HC.run_transcript(db, ref))["status"] == "failed"
        assert await K.wallet_balance(db, "voice") == balance
        assert (await c.get(f"/api/human-calls/{ref}/transcript")).json()["transcript"] == "failed"
        fake_speech["fail"] = 0
        hc = await db.get(HumanCall, ref)
        await db.refresh(hc)
        hc.transcript_state = "waiting"
        await db.commit()
        assert (await HC.run_transcript(db, ref))["status"] == "ready"
        assert await K.wallet_balance(db, "voice") == balance - 2


@pytest.mark.db
async def test_recording_needs_consent_and_audio_is_private(db, phone, no_auto, fake_speech):
    _, token = await make_user(db, "caller12", "Admin")
    _, other = await make_user(db, "snoop", "Admin")
    async with api(token) as c, api(other) as o:
        ref = await recorded_call(c, db)
        assert (await o.get(f"/api/human-calls/{ref}/audio")).status_code == 404
        assert (await o.get(f"/api/human-calls/{ref}/transcript")).status_code == 404
        plain = (await begin(c)).status_code  # a second call while one is open
        assert plain == 409
        await c.post(f"/api/human-calls/{ref}/end", json={})
        plain_ref = (await begin(c)).json()["call_ref"]
        assert (await c.post(f"/api/human-calls/{plain_ref}/audio", content=b"x")).status_code == 400  # not a recorded call


@pytest.mark.db
async def test_old_audio_is_deleted_but_the_text_stays(db, phone, no_auto, fake_speech, tmp_path):
    _, token = await make_user(db, "caller13", "Admin")
    async with api(token) as c:
        ref = await recorded_call(c, db)
        await c.post(f"/api/human-calls/{ref}/end", json={})
        await HC.run_transcript(db, ref)
    hc = await db.get(HumanCall, ref)
    await db.refresh(hc)
    hc.audio_delete_at = datetime.utcnow() - timedelta(days=1)
    await db.commit()
    assert (await HC.sweep(db))["audio_deleted"] == 1
    await db.refresh(hc)
    log = await db.get(CallLog, log_id_for_call(ref))
    await db.refresh(log)
    assert hc.recording_path == "" and len(log.transcript) == 2


@pytest.mark.db
async def test_the_phone_panel_config_lists_our_numbers_and_prices(db, phone):
    _, token = await make_user(db, "caller14", "Admin")
    async with api(token) as c:
        r = (await c.get("/api/human-calls/config")).json()
        assert [n["e164"] for n in r["numbers"]] == ["+442079460000"] and r["rates"] == {"call": 1, "transcript": 1}
        assert (await c.get("/api/human-calls/mine")).json() == {"calls": []}


@pytest.mark.db
async def test_ending_a_recorded_call_starts_its_transcript_by_itself(db, phone, fake_speech):
    import asyncio

    _, token = await make_user(db, "caller15", "Admin")
    async with api(token) as c:
        ref = await recorded_call(c, db)
        await c.post(f"/api/human-calls/{ref}/end", json={})
        for _ in range(50):
            await asyncio.sleep(0.1)
            if (await c.get(f"/api/human-calls/{ref}/transcript")).json()["transcript"] == "ready":
                break
        t = (await c.get(f"/api/human-calls/{ref}/transcript")).json()
        assert t["transcript"] == "ready" and len(t["lines"]) == 2
        assert await K.wallet_balance(db, "voice") == 60 - 2 - 2


@pytest.mark.db
async def test_zero_credit_switch_off_also_stops_browser_calls_and_switch_on_restores_them(db, phone, monkeypatch):
    from app.services import voice_access as VA

    async def get_phone_number(ref):
        return {"connection_id": "app_1"}

    async def update_phone_number(ref, **kw):
        phone.calls.append(("number", ref, kw))

    phone.get_phone_number, phone.update_phone_number = get_phone_number, update_phone_number
    setup = (await db.execute(select(OrgTelnyx))).scalars().first()
    setup.credential_connection_id = "conn_1"
    await db.commit()
    state = await VA._switch_off(db, setup)
    assert state["browser_calls"] is True and ("active", "conn_1", False) in phone.calls
    left = await VA._switch_on(db, setup, state)
    assert left == {} and ("active", "conn_1", True) in phone.calls
