"""Listen-in / takeover audio routing: no cross-organisation audio, no self-echo."""
import asyncio
import json

import pytest


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send_text(self, msg):
        self.sent.append(json.loads(msg))


@pytest.fixture
def hub():
    from app.websockets.media_stream import MediaStreamHub

    return MediaStreamHub()


async def test_unlinked_listener_of_another_org_never_hears_the_call(hub):
    carrier = FakeWS()
    hub.twilio_streams["call_a"] = carrier
    hub.stream_org["call_a"] = "org_a"
    other_org = FakeWS()
    hub.register_listener("some_other_id", other_org, "org_b")
    await hub.broadcast_to_listeners("call_a", {"type": "audio_chunk", "payload": "x"})
    assert other_org.sent == []


async def test_unlinked_listener_of_same_org_is_bridged(hub):
    hub.twilio_streams["call_a"] = FakeWS()
    hub.stream_org["call_a"] = "org_a"
    mine = FakeWS()
    hub.register_listener("alias_id", mine, "org_a")
    await hub.broadcast_to_listeners("call_a", {"type": "audio_chunk", "payload": "x"})
    assert len(mine.sent) == 1


async def test_supervisor_voice_goes_to_caller_and_others_but_not_back_to_them(hub):
    carrier = FakeWS()
    hub.twilio_streams["call_a"] = carrier
    hub.stream_protocol["call_a"] = "telnyx"
    hub.stream_org["call_a"] = "org_a"
    speaker, colleague = FakeWS(), FakeWS()
    hub.register_listener("call_a", speaker, "org_a")
    hub.register_listener("call_a", colleague, "org_a")
    await hub.inject_operator_audio_to_twilio("call_a", "AAAA", from_ws=speaker)
    await asyncio.sleep(0.01)
    assert carrier.sent and carrier.sent[0]["media"]["payload"] == "AAAA"  # caller hears it
    assert colleague.sent and colleague.sent[0]["track"] == "operator"  # other supervisors hear it
    assert speaker.sent == []  # no echo of your own voice


async def test_supervisor_cannot_inject_into_another_orgs_only_call(hub):
    carrier = FakeWS()
    hub.twilio_streams["call_b"] = carrier
    hub.stream_protocol["call_b"] = "telnyx"
    hub.stream_org["call_b"] = "org_b"
    intruder = FakeWS()
    hub.register_listener("guess", intruder, "org_a")
    await hub.inject_operator_audio_to_twilio("guess", "AAAA", from_ws=intruder)
    assert carrier.sent == []


async def test_ai_audio_path_still_uses_the_single_stream_fallback(hub):
    """The AI engine's own audio must keep reaching the call even when IDs were not linked."""
    carrier = FakeWS()
    hub.twilio_streams["call_c"] = carrier
    hub.stream_protocol["call_c"] = "telnyx"
    await hub.inject_operator_audio_to_twilio("unlinked_ai_id", "BBBB")
    assert carrier.sent and carrier.sent[0]["media"]["payload"] == "BBBB"


def test_livekit_webhook_signature():
    import base64
    import hashlib

    from jose import jwt

    from app.api.livekit_router import _webhook_signature_ok
    from app.config import settings

    body = b'{"event":"room_finished"}'
    good = jwt.encode({"iss": settings.LIVEKIT_API_KEY, "sha256": base64.b64encode(hashlib.sha256(body).digest()).decode()},
                      settings.LIVEKIT_API_SECRET, algorithm="HS256")
    assert _webhook_signature_ok(body, good)
    assert not _webhook_signature_ok(b'{"event":"tampered"}', good)
    assert not _webhook_signature_ok(body, "")
    bad = jwt.encode({"sha256": "x"}, "wrong-secret", algorithm="HS256")
    assert not _webhook_signature_ok(body, bad)
