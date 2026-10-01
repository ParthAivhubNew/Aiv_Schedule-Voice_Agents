"""A fake Telnyx for the voice tests (assistants, calls). Loaded for every test via conftest."""
import httpx
import pytest

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
