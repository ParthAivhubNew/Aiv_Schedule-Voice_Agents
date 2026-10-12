"""Meeting rooms: platform mapping, connect link, and one request shape per provider (HTTP faked)."""
import asyncio
from datetime import datetime

from app.config import settings
from app.core.security import decode_token
from app.services import meeting_rooms as MR


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_platform_labels_map_to_providers():
    assert MR.provider_for("Google Meet") == "google"
    assert MR.provider_for("Zoom") == "zoom"
    assert MR.provider_for("Microsoft Teams") == "microsoft"
    for own in ("Jitsi (auto room)", "Cal.com", "", None):
        assert MR.provider_for(own) is None


def test_start_needs_platform_app_then_signs_state(monkeypatch):
    async def _no_db():
        return None

    monkeypatch.setattr(MR, "load_creds", _no_db)
    monkeypatch.setattr(MR, "_db_creds", {})
    monkeypatch.setattr(settings, "ZOOM_OAUTH_CLIENT_ID", "", raising=False)
    assert not run(MR.start("zoom"))["ok"]
    monkeypatch.setattr(MR, "_db_creds", {"zoom": {"id": "cid", "secret": "sec"}})
    res = run(MR.start("zoom", "https://app.example"))
    assert res["ok"] and res["authUrl"].startswith("https://zoom.us/oauth/authorize?")
    state = res["authUrl"].split("state=")[1].split("&")[0]
    import urllib.parse as up

    claims = decode_token(up.unquote(state), "meetlink")
    assert claims["sub"] == "zoom" and claims["org"]


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._b, self.content = status, body, b"x"
        self.text = str(body)

    def json(self):
        return self._b


def _fake_client(calls, reply):
    class C:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kw):
            calls.append((url, kw))
            return reply

    return C


def _room(monkeypatch, provider, reply):
    calls = []

    async def tok(db, p):
        return "tkn"

    monkeypatch.setattr(MR, "_access_token", tok)
    monkeypatch.setattr(MR.httpx, "AsyncClient", _fake_client(calls, reply))
    out = run(MR.create_room(None, provider, title="Meeting with Ana", start_utc=datetime(2026, 10, 14, 9, 0), attendee_email="a@b.co"))
    return out, calls


def test_google_meet_room(monkeypatch):
    out, calls = _room(monkeypatch, "google", _Resp(200, {"hangoutLink": "https://meet.google.com/abc-defg-hij"}))
    assert out == {"ok": True, "url": "https://meet.google.com/abc-defg-hij"}
    url, kw = calls[0]
    assert "calendar/v3" in url and kw["params"]["conferenceDataVersion"] == 1
    assert kw["json"]["conferenceData"]["createRequest"]["conferenceSolutionKey"]["type"] == "hangoutsMeet"


def test_teams_room(monkeypatch):
    out, calls = _room(monkeypatch, "microsoft", _Resp(201, {"joinWebUrl": "https://teams.microsoft.com/l/meetup-join/x"}))
    assert out["ok"] and out["url"].startswith("https://teams.microsoft.com/")
    assert calls[0][1]["json"]["startDateTime"] == "2026-10-14T09:00:00Z"


def test_zoom_room(monkeypatch):
    out, calls = _room(monkeypatch, "zoom", _Resp(201, {"join_url": "https://zoom.us/j/123"}))
    assert out == {"ok": True, "url": "https://zoom.us/j/123"}
    assert calls[0][1]["json"]["duration"] == 15


def test_provider_error_is_reported_not_raised(monkeypatch):
    out, _ = _room(monkeypatch, "zoom", _Resp(401, {"message": "Invalid access token"}))
    assert not out["ok"] and "Invalid access token" in out["error"]
