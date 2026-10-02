"""Clients set their Telnyx assistant from OutReach: the lists come live from Telnyx ("" means
Telnyx default), each user tunes how it speaks and listens, admins set how every call behaves,
and companies add their own voices for free, made again from the sample if Telnyx lets one expire."""
import pytest

from tests.conftest import make_user
from tests.test_agent_studio import _as, give_number

pytestmark = pytest.mark.db


def test_defaults_leave_telnyx_to_choose_and_choices_reach_the_payload():
    from app.services import assistant_options as O
    from app.services.voice_assistants import shell_payload

    base = shell_payload("A", "B")
    assert "voice_settings" not in base and "transcription" not in base and "model" not in base
    assert base["telephony_settings"] == {"recording_settings": {"enabled": False}, "user_idle_reply_secs": 10}
    assert base["interruption_settings"] == {"enable": True, "disable_greeting_interruption": False}
    assert [t["type"] for t in base["tools"]] == ["webhook"] * 6

    mine = {"voiceSpeed": 1.2, "expressive": True, "background": "office", "backgroundVolume": 0.3,
            "sttModel": "deepgram/nova-3", "language": "en"}
    company = {"speaksFirst": False, "interruptions": False, "idleReplySecs": 8, "idleHangupSecs": 60, "noise": "krisp",
               "fallbackNumber": "+447700900123", "transfers": [{"name": "Sales", "number": "+447700900124"}],
               "textCaller": True, "keyterms": "Aivhub, OutReach", "keepData": False}
    p = shell_payload("A", "B", "Telnyx.Ultra.Clara", "moonshotai/Kimi-K2.6", mine, company)
    assert p["voice_settings"] == {"voice": "Telnyx.Ultra.Clara", "voice_speed": 1.2, "expressive_mode": True,
                                   "background_audio": {"type": "predefined_media", "value": "office", "volume": 0.3}}
    assert p["transcription"] == {"model": "deepgram/nova-3", "language": "en", "settings": {"keyterm": "Aivhub, OutReach"}}
    assert p["greeting"] == "" and p["interruption_settings"]["enable"] is False
    assert p["telephony_settings"] == {"recording_settings": {"enabled": False}, "user_idle_reply_secs": 8,
                                       "user_idle_timeout_secs": 60, "fallback_destination": "+447700900123",
                                       "noise_suppression": "krisp"}
    assert p["privacy_settings"] == {"data_retention": False}
    transfer = next(t for t in p["tools"] if t["type"] == "transfer")["transfer"]
    assert transfer["targets"] == [{"name": "Sales", "to": "+447700900124"}]
    assert any(t["type"] == "send_message" for t in p["tools"])

    with pytest.raises(O.OptionError):
        O.clean_company({"transfers": [{"name": "X", "number": "07700 900123"}]})
    assert O.clean_mine({"voiceSpeed": 9, "background": "jungle"})["voiceSpeed"] == 2.0
    assert O.clean_mine({"background": "jungle"})["background"] == ""


async def test_users_get_telnyx_lists_and_admins_set_call_behaviour(db, fake):
    from sqlalchemy.future import select

    from app.core.tenancy import org_scope
    from app.models.models import VoiceAssistant
    from app.services import voice_assistants as VA

    bob, bob_tok = await make_user(db, "bob2", "Operator", org_id="org_acme")
    _, admin_tok = await make_user(db, "ann2", "Admin", org_id="org_acme")
    async with _as(bob_tok) as c:
        s = (await c.get("/api/voice-studio")).json()
        cat = s["catalogue"]
        assert [m["id"] for m in cat["models"]] == ["moonshotai/Kimi-K2.6"] and "0.5" in cat["models"][0]["price"]
        assert cat["voices"][0]["id"] == "Telnyx.Ultra.Clara" and cat["stt"][0]["id"] == "deepgram/nova-3"
        assert s["hasNumber"] is False and cat["voices"][0]["engine"] == "Ultra" and cat["models"][0]["recommended"] is True
        assert s["me"]["settings"]["voiceSpeed"] == 1.0 and s["company"]["assistant"]["speaksFirst"] is True
        assert s["isAdmin"] is False  # no "Get a number" button: the Numbers page is admins' only
        r = await c.put("/api/voice-studio/me", json={"voice": "Telnyx.Ultra.Clara"})
        assert r.status_code == 409 and "phone number" in r.json()["detail"]  # no number yet
        await give_number(db, "org_acme")
        assert (await c.get("/api/voice-studio")).json()["hasNumber"] is True
        assert (await c.put("/api/voice-studio/me", json={"settings": {"sttModel": "made/up"}})).status_code == 400
        r = await c.put("/api/voice-studio/me", json={"voice": "Telnyx.Ultra.Clara", "settings": {"sttModel": "deepgram/nova-3", "voiceSpeed": 0.9}})
        assert r.status_code == 200
        assert (await c.put("/api/voice-studio/company", json={"assistant": {"textCaller": True}})).status_code == 403
    with org_scope("org_acme"):
        await VA.assistant_for(db, bob.id)
        await db.commit()
    made = next(j for m, p, j in fake.calls if p == "/ai/assistants")
    assert made["voice_settings"]["voice_speed"] == 0.9 and made["transcription"] == {"model": "deepgram/nova-3"}

    async with _as(admin_tok) as c:
        assert (await c.put("/api/voice-studio/company", json={"assistant": {"fallbackNumber": "123"}})).status_code == 400
        r = await c.put("/api/voice-studio/company", json={"assistant": {"textCaller": True, "speaksFirst": False}})
        assert r.status_code == 200
        assert (await c.get("/api/voice-studio")).json()["company"]["assistant"]["textCaller"] is True
    bob_id = bob.id
    db.expire_all()
    with org_scope("org_acme"):
        row = (await db.execute(select(VoiceAssistant).where(VoiceAssistant.operator_id == bob_id))).scalars().first()
        assert row.synced_at is None  # picks the change up on its next call
        await VA.assistant_for(db, bob_id)
        await db.commit()
    last = [c for c in fake.calls if c[0] == "POST"][-1][2]
    assert last["greeting"] == "" and any(t["type"] == "send_message" for t in last["tools"])


async def test_a_company_clones_a_voice_for_free_and_it_comes_back_if_telnyx_drops_it(db, fake):
    from app.core.tenancy import org_scope
    from app.services import voice_assistants as VA

    bob, tok = await make_user(db, "bob3", "Operator", org_id="org_acme")
    sample_ok = ("me.wav", b"RIFF" + b"\0" * 2000, "audio/wav")
    async with _as(tok) as c:  # no number yet: nothing is sent to Telnyx
        r = await c.post("/api/voice-studio/clones", data={"name": "x", "language": "en", "gender": "male", "consent": "true"}, files={"audio": sample_ok})
        assert r.status_code == 409
    await give_number(db, "org_acme")
    sample = ("me.wav", b"RIFF" + b"\0" * 2000, "audio/wav")
    form = {"name": "My voice", "language": "en", "gender": "male"}
    async with _as(tok) as c:
        r = await c.post("/api/voice-studio/clones", data=form, files={"audio": sample})
        assert r.status_code == 400 and "agreed" in r.json()["detail"]  # consent first
        assert (await c.post("/api/voice-studio/clones", data={**form, "consent": "true"},
                             files={"audio": ("me.txt", b"x", "text/plain")})).status_code == 400
        r = await c.post("/api/voice-studio/clones", data={**form, "consent": "true"}, files={"audio": sample})
        assert r.status_code == 200, r.text
        clone = r.json()
        voice = clone["voice"]
        assert voice.startswith("Telnyx.Qwen3TTS.clone-")
        s = (await c.get("/api/voice-studio")).json()
        assert s["catalogue"]["voices"][0]["id"] == voice and s["catalogue"]["voices"][0]["private"] is True
        assert s["clones"][0]["name"] == "My voice" and "file" not in s["clones"][0]
        assert (await c.put("/api/voice-studio/me", json={"voice": voice})).status_code == 200
    _, other = await make_user(db, "eve3", "Operator", org_id="org_other")
    async with _as(other) as c:
        assert voice not in [v["id"] for v in (await c.get("/api/voice-studio")).json()["catalogue"]["voices"]]

    # Telnyx let it expire: it is made again from the saved sample, and the assistant uses the new one.
    fake.clone_status[voice.rsplit(".", 1)[-1]] = "expired"
    with org_scope("org_acme"):
        row = await VA.assistant_for(db, bob.id)
        await db.commit()
        assert row.voice != voice and row.voice.startswith("Telnyx.Qwen3TTS.clone-")
    uploads = [c for c in fake.calls if c[1] == "/voice_clones/from_upload"]
    assert len(uploads) == 2 and uploads[1][2]["name"] == "My voice"

    async with _as(tok) as c:
        assert (await c.delete(f"/api/voice-studio/clones/{clone['id']}")).status_code == 200
        s = (await c.get("/api/voice-studio")).json()
        assert s["clones"] == [] and s["me"]["voice"] == ""  # back to the default voice


def test_voice_ids_match_what_telnyx_assistants_take():
    from app.services import assistant_options as AO

    assert AO._voice_id("telnyx", "Telnyx.KokoroTTS.af_heart") == "Telnyx.KokoroTTS.af_heart"
    assert AO._voice_id("xai", "eve") == "xAI.eve" and AO._voice_id("azure", "en-US-AvaNeural") == "azure.en-US-AvaNeural"
    assert AO._voice_id("soniox", "Maya") == "Soniox.tts-rt-v2.Maya"
    assert AO._voice_id("minimax", "English_radiant_girl") == ""  # model unknown: would fail on the call
    assert AO.voice_engine("Telnyx.Ultra.Clara") == "Ultra" and AO.voice_engine("xAI.eve") == ""
    assert AO.voice_engine("aws.Polly.Generative.Lucia") == "Polly Generative"
    assert AO.voice_engine("aws.Polly.Danielle-Neural") == "Polly Neural"
    assert AO.needs_key("openai/gpt-4o") and not AO.needs_key("moonshotai/Kimi-K2.6")


def test_a_voice_telnyx_swapped_for_its_default_is_reported():
    from app.services import assistant_options as AO

    assert AO.mismatch({"voice": "aws.Polly.Joanna", "model": ""}, {"voice": "Telnyx.KokoroTTS.af_heart"}).startswith("Telnyx did not accept the voice")
    assert AO.mismatch({"voice": "Telnyx.Ultra.Clara"}, {"voice": "Telnyx.Ultra.Clara"}) == ""
    assert AO.mismatch({"voice": ""}, {"voice": "Telnyx.Ultra.Clara"}) == ""  # Telnyx default chosen


async def test_a_voice_preview_is_made_once_then_served_from_disk(db, fake, monkeypatch, tmp_path):
    from app.services.telnyx_client import TelnyxClient

    monkeypatch.setenv("VOICE_PREVIEW_DIR", str(tmp_path))
    said = []

    async def speech(self, text, voice):
        said.append((text, voice))
        return b"ID3audio", "audio/mpeg"

    monkeypatch.setattr(TelnyxClient, "speech", speech)
    _, tok = await make_user(db, "pat", "Operator", org_id="org_acme")
    async with _as(tok) as c:
        assert (await c.get("/api/voice-studio/preview", params={"voice": "Made.Up.voice"})).status_code == 404
        for _ in range(2):
            r = await c.get("/api/voice-studio/preview", params={"voice": "Telnyx.Ultra.Clara"})
            assert r.status_code == 200 and r.content == b"ID3audio" and r.headers["content-type"] == "audio/mpeg"
    assert said == [(said[0][0], "Telnyx.Ultra.Clara")]  # Telnyx asked once
