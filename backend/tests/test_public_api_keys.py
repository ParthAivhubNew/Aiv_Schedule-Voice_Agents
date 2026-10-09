"""Phase 0 of the public API: keys reach /v1 only, key management is for admins,
staff can see and switch off customer keys, and the call status endpoint works."""
import httpx
import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


def _http(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


async def _new_key(admin_token, scopes=("voice:calls",)):
    async with _http(admin_token) as c:
        r = await c.post("/api/developer/keys", json={"name": "Test key", "scopes": list(scopes)})
    assert r.status_code == 200, r.text
    return r.json()["secret"], r.json()["key"]["id"]


def test_keys_may_only_use_v1_paths():
    from app.core.auth_middleware import key_may_use

    assert key_may_use("/v1/voice/calls")
    assert key_may_use("/v1")
    assert not key_may_use("/developer/keys")
    assert not key_may_use("/team/users")
    assert not key_may_use("/v1evil/x")
    assert not key_may_use("/v1/x", websocket=True)


async def test_a_key_cannot_reach_the_apps_own_endpoints(db, admin_token):
    secret, _ = await _new_key(admin_token, ("voice:calls",))
    async with _http(secret) as c:
        denied = await c.get("/api/developer/keys")
        assert denied.status_code == 403 and denied.json()["code"] == "key_not_allowed"
        assert (await c.post("/api/developer/keys", json={"name": "Sneaky", "scopes": ["full_access"]})).status_code == 403
        assert (await c.get("/api/calls/logs")).status_code == 403
        assert (await c.get("/v1/wallets")).status_code == 200  # the public API itself works
        assert (await c.get("/api/v1/wallets")).status_code == 200  # and under the /api prefix


async def test_only_an_admin_manages_keys_and_webhooks(db, admin_token):
    _, op_token = await make_user(db, "olly", "Operator")
    async with _http(op_token) as c:
        assert (await c.get("/api/developer/keys")).status_code == 403
        assert (await c.post("/api/developer/keys", json={"name": "Mine", "scopes": ["voice:calls"]})).status_code == 403
        assert (await c.get("/api/developer/webhooks")).status_code == 403
    async with _http(admin_token) as c:
        assert (await c.get("/api/developer/keys")).status_code == 200
        assert (await c.get("/api/developer/webhooks")).status_code == 200


def _staff_request(role="staff_admin"):
    from starlette.requests import Request

    return Request({"type": "http", "headers": [], "state": {"staff": {"staff_id": "s1", "email": "s@x.com", "role": role}}})


async def test_staff_see_and_switch_off_customer_keys_and_webhooks(db, admin_token):
    from fastapi import HTTPException

    from app.api import admin_portal as A
    from app.core.auth_middleware import _api_key_ctx
    from app.core.tenancy import system_scope
    from app.models.models import WebhookEndpoint

    secret, key_id = await _new_key(admin_token)
    async with _http(admin_token) as c:
        r = await c.post("/api/developer/webhooks", json={"url": "http://localhost:9/hook", "events": ["call.completed"]})
    hook_id = r.json()["endpoint"]["id"]

    with system_scope():
        data = await A.developer_access(_staff_request("staff_support"))
        assert [k["id"] for k in data["keys"]] == [key_id]
        assert [w["id"] for w in data["webhooks"]] == [hook_id]
        assert "secret" not in str(data) and secret not in str(data)
        with pytest.raises(HTTPException) as err:  # support staff look but do not change
            await A.revoke_customer_key(key_id, _staff_request("staff_support"))
        assert err.value.status_code == 403

        assert (await A.revoke_customer_key(key_id, _staff_request()))["active"] is False
        assert await _api_key_ctx(secret) is None  # the key stops working at once
        assert (await A.disable_customer_webhook(hook_id, _staff_request()))["active"] is False
        db.expire_all()
        assert (await db.get(WebhookEndpoint, hook_id)).is_active is False
        with pytest.raises(HTTPException):
            await A.revoke_customer_key("key_missing", _staff_request())


async def test_call_status_shows_a_live_call_and_a_finished_one(db, admin_token):
    from app.models.models import CallBrief, CallLog, LiveCall

    secret, _ = await _new_key(admin_token)
    db.add(LiveCall(id="call_live1", prospect="Jo", mission="m", state="negotiating", duration="00:42",
                    transcript=["AI: Hello", "Prospect: Hi there"]))
    db.add(CallBrief(id="call_live1", phone="+447700900123", captured={"budget": "5k"}))
    db.add(LiveCall(id="call_done1", prospect="Acme", mission="m", state="ended", ended=True, booked=True))
    db.add(CallLog(id="cl_done1", canonical_name="Acme", listed_as="Acme", person_listed_as="Sam", started_at="x", ended_at="y",
                   duration="3:12 min", outcome="meeting_booked", transcript=[{"who": "ai", "text": "Hi"}, {"who": "them", "text": "Yes"}]))
    await db.commit()
    async with _http(secret) as c:
        live = (await c.get("/v1/voice/calls/call_live1")).json()
        assert live["status"] == "in_progress" and live["duration_seconds"] == 42
        assert live["answers"] == {"budget": "5k"} and live["to"] == "+447700900123"
        assert [t["who"] for t in live["transcript"]] == ["ai", "them"]
        done = (await c.get("/v1/voice/calls/call_done1")).json()
        assert done["status"] == "completed" and done["outcome"] == "meeting_booked" and done["meeting_booked"] is True
        assert done["duration_seconds"] == 192 and done["to_name"] == "Sam"
        assert (await c.get("/v1/voice/calls/call_nope")).status_code == 404
