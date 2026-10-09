"""Phase 1: the shared behaviour of every /v1 route (errors, safe retries, limits, audit, scopes, test keys)
and the webhook sender (signatures, retries, no calls into private networks)."""
import asyncio
import hashlib
import hmac

import httpx
import pytest
from sqlalchemy import func
from sqlalchemy.future import select

from tests.conftest import make_user

pytestmark = pytest.mark.db


def _http(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


async def _key(admin_token, scopes, live=True):
    async with _http(admin_token) as c:
        r = await c.post("/api/developer/keys", json={"name": "Test key", "scopes": scopes, "live": live})
    assert r.status_code == 200, r.text
    return r.json()["secret"]


@pytest.fixture(autouse=True)
def fresh_limits():
    from app.public_api import core

    core._WINDOWS.clear()
    yield
    core._WINDOWS.clear()


async def test_every_error_has_the_same_shape(db, admin_token):
    key = await _key(admin_token, ["voice:calls"])
    async with _http(key) as c:
        missing = await c.get("/v1/voice/calls/call_nope")
        body = missing.json()
        assert missing.status_code == 404
        assert body["error"]["code"] == "not_found" and body["request_id"].startswith("req_")
        assert missing.headers["x-request-id"] == body["request_id"]
        assert body["detail"]  # older clients still find their message

        invalid = await c.post("/v1/voice/calls", json={})
        assert invalid.status_code == 422
        assert invalid.json()["error"]["code"] == "invalid_request"
        assert invalid.json()["error"]["details"]["fields"][0]["field"] == "to"


async def test_a_key_needs_the_right_scope(db, admin_token):
    from app.public_api.core import has_scope

    key = await _key(admin_token, ["wallets:read"])
    async with _http(key) as c:
        r = await c.post("/v1/leads", json={"name": "Jo"})
        assert r.status_code == 403 and r.json()["error"]["code"] == "missing_scope"
        assert (await c.get("/v1/wallets")).status_code == 200
    assert has_scope({"scopes": ["social:publish"]}, "social:write")  # keys made before the split keep working
    assert has_scope({"scopes": ["social:publish"]}, "social:approve")
    assert not has_scope({"scopes": ["social:write"]}, "social:approve")
    assert has_scope({"scopes": ["full_access"]}, "email:approve")


async def test_a_retry_with_the_same_key_does_not_repeat_the_action(db, admin_token):
    from app.models.models import Prospect

    key = await _key(admin_token, ["leads:search"])
    async with _http(key) as c:
        h = {"Idempotency-Key": "abc-123"}
        first = await c.post("/v1/leads", json={"name": "Jo", "phone": "+447700900123"}, headers=h)
        again = await c.post("/v1/leads", json={"name": "Jo", "phone": "+447700900123"}, headers=h)
        assert first.status_code == again.status_code == 200
        assert first.json()["lead_id"] == again.json()["lead_id"]
        assert again.headers["idempotent-replay"] == "true"
        other = await c.post("/v1/leads", json={"name": "Someone else"}, headers=h)
        assert other.status_code == 422 and other.json()["error"]["code"] == "idempotency_key_reused"
        await c.post("/v1/leads", json={"name": "Jo"})  # no key: a real second action
        await c.post("/v1/leads", json={"name": "Jo"})
    db.expire_all()
    assert (await db.execute(select(func.count()).select_from(Prospect))).scalar() == 3


async def test_too_many_requests_are_slowed_down(db, admin_token, monkeypatch):
    from app.public_api import core

    monkeypatch.setattr(core, "WRITE_PER_MIN", 2)
    key = await _key(admin_token, ["leads:search"])
    async with _http(key) as c:
        assert (await c.post("/v1/leads", json={"name": "A"})).status_code == 200
        assert (await c.post("/v1/leads", json={"name": "B"})).status_code == 200
        r = await c.post("/v1/leads", json={"name": "C"})
        assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"
        assert int(r.headers["retry-after"]) >= 1
        assert (await c.get("/v1/wallets")).status_code == 200  # reading is a separate allowance


async def test_every_request_is_written_to_the_audit_trail(db, admin_token):
    from app.models.models import PublicApiAudit

    key = await _key(admin_token, ["wallets:read"])
    async with _http(key) as c:
        r = await c.get("/v1/wallets")
    await asyncio.sleep(0.3)
    db.expire_all()
    rows = (await db.execute(select(PublicApiAudit))).scalars().all()
    assert [(a.method, a.path, a.status, a.request_id) for a in rows] == [("GET", "/v1/wallets", 200, r.headers["x-request-id"])]
    assert rows[0].key_id.startswith("key_")


async def test_test_keys_are_free_and_marked_as_test(db):
    _, token = await make_user(db, "newco", "Admin", org_id="org_newco")  # no plan, no credits
    async with _http(token) as c:
        live = await c.post("/api/developer/keys", json={"name": "Live", "scopes": ["voice:calls"], "live": True})
        assert live.status_code == 402  # a live key needs a plan
        test = await c.post("/api/developer/keys", json={"name": "Test", "scopes": ["voice:calls", "social:write", "email:approve"], "live": False})
        assert test.status_code == 200 and test.json()["secret"].startswith("sk_test_")
        assert set(test.json()["key"]["scopes"]) == {"voice:calls", "social:write", "email:approve"}
    async with _http(test.json()["secret"]) as c:
        me = (await c.get("/v1/wallets")).json()
        assert me["key"]["test_mode"] is True
        assert any(p["item"] == "voice_minute" and p["credits"] == 1 for p in me["prices"])


def test_webhook_addresses_inside_our_network_are_refused():
    from app.services.webhook_dispatcher import url_problem

    assert url_problem("https://169.254.169.254/latest/meta-data")
    assert url_problem("https://10.0.0.5/hook")
    assert url_problem("https://192.168.1.10/hook")
    assert url_problem("http://example.com/hook")  # not https
    assert url_problem("ftp://example.com")
    assert url_problem("") and url_problem("https://")
    assert url_problem("http://localhost:8000/hook") is None  # development


async def test_creating_a_webhook_to_a_private_address_is_refused(db, admin_token):
    async with _http(admin_token) as c:
        r = await c.post("/api/developer/webhooks", json={"url": "https://169.254.169.254/x", "events": ["call.completed"]})
        assert r.status_code == 400 and "private" in r.json()["detail"]
        ok = await c.post("/api/developer/webhooks", json={"url": "http://localhost:9/hook", "events": ["post.ready", "nonsense"]})
        assert ok.status_code == 200 and ok.json()["endpoint"]["events"] == ["post.ready"]


def test_webhook_signature_can_be_checked_by_the_receiver():
    from app.services.webhook_dispatcher import sign_payload

    body = b"{\"event\":\"call.completed\"}"
    header = sign_payload(body, "whsec_abc", 1700000000)
    t, v1 = [p.split("=", 1)[1] for p in header.split(",")]
    expected = hmac.new(b"whsec_abc", f"t={t}.".encode() + body, hashlib.sha256).hexdigest()
    assert t == "1700000000" and v1 == expected


async def test_a_failed_delivery_is_tried_again_then_stops(monkeypatch):
    from app.services import webhook_dispatcher as W

    calls = []

    async def flaky(ep, event_id, event_type, data, test=False):
        calls.append(event_id)
        return {"success": len(calls) == 3, "status_code": 500, "blocked": False}

    monkeypatch.setattr(W, "deliver_to_endpoint", flaky)
    monkeypatch.setattr(W, "RETRY_DELAYS", (0, 0))
    await W._deliver_with_retries(object(), "evt_1", "call.completed", {}, False)
    assert len(calls) == 3  # first try + two retries, then success stops it

    calls.clear()

    async def refused(ep, event_id, event_type, data, test=False):
        calls.append(1)
        return {"success": False, "status_code": 404, "blocked": False}

    monkeypatch.setattr(W, "deliver_to_endpoint", refused)
    await W._deliver_with_retries(object(), "evt_2", "call.completed", {}, False)
    assert len(calls) == 1  # a 404 will not change by asking again
