"""The one endpoint, POST /v1/run: it must do exactly what the separate URLs do, with the same rules.
Only test keys are used for real work here, so nothing is placed, sent or charged."""
import asyncio

import httpx
import pytest

from tests.conftest import make_user
from tests.voice_fakes import RealClient

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


async def _keys(db, **scopes_by_name):
    """An admin makes a test key per name; each gets its own permissions."""
    from app.core.tenancy import org_scope
    from app.models.models import CompanyProfile

    _, admin = await make_user(db, "ann", "Admin", org_id=ORG)
    with org_scope(ORG):
        db.add(CompanyProfile(id="default", name="Acme Windows"))
        await db.commit()
    out = {}
    async with _http(admin) as c:
        for name, scopes in scopes_by_name.items():
            r = await c.post("/api/developer/keys", json={"name": name, "scopes": scopes, "live": False})
            assert r.status_code == 200, r.text
            out[name] = r.json()["secret"]
    return out


def test_every_action_points_at_a_real_public_call():
    from app.main import app
    from app.public_api.run import ACTIONS

    import re

    def plain(path):  # {call_id} and {id} are the same thing here
        return re.sub(r"\{[^}]+\}", "{id}", path)

    paths = app.openapi()["paths"]
    real = {(m.upper(), plain(p)) for p, ops in paths.items() if p.startswith("/v1/") for m in ops}
    mapped = [(m, "/v1" + p) for acts in ACTIONS.values() for (m, p, _) in acts.values()]
    assert len(mapped) == 87  # mail has no URL of its own, so it is not in this list
    missing = [x for x in mapped if x not in real]
    assert not missing, missing
    assert len({x for x in mapped}) == 87


async def test_a_call_started_and_read_through_the_one_endpoint(db, monkeypatch):
    monkeypatch.setenv("PUBLIC_API_SANDBOX_CALL_SECONDS", "0")
    keys = await _keys(db, all=["full_access"])
    async with _http(keys["all"]) as c:
        r = await c.post("/v1/run", json={"plugin": "voice", "action": "call.start",
                                          "data": {"to": "+447700900123", "goal": "Book a meeting"}})
        assert r.status_code == 202, r.text
        assert r.headers["x-outreach-action"] == "voice.call.start" and r.headers["x-request-id"]
        cid = r.json()["id"]
        await asyncio.sleep(0.05)
        got = await c.post("/v1/run", json={"plugin": "voice", "action": "call.get", "id": cid})
        assert got.status_code == 200 and got.json()["status"] == "completed" and got.json()["test"] is True
        # the same read as a link, and the same answer as the separate URL
        link = await c.get("/v1/run", params={"plugin": "voice", "action": "call.get", "id": cid})
        plain = lambda r: {k: v for k, v in r.json().items() if k != "live_url"}  # the page link is re-signed each time
        assert plain(link) == plain(got) == plain(await c.get(f"/v1/voice/calls/{cid}"))
        listed = await c.post("/v1/run", json={"plugin": "voice", "action": "call.list", "data": {"status": "completed"}})
        assert [x["id"] for x in listed.json()["data"]] == [cid]


async def test_the_link_form_only_reads(db):
    keys = await _keys(db, all=["full_access"])
    async with _http(keys["all"]) as c:
        r = await c.get("/v1/run", params={"plugin": "voice", "action": "call.start"})
        assert r.status_code == 405 and r.json()["error"]["code"] == "read_only"
        assert (await c.get("/v1/run", params={"plugin": "account", "action": "wallet"})).status_code == 200


async def test_a_key_only_does_what_its_permissions_allow(db):
    keys = await _keys(db, social=["voice:calls"])
    async with _http(keys["social"]) as c:
        r = await c.post("/v1/run", json={"plugin": "social", "action": "post.create",
                                          "data": {"prompt": "Announce our new office", "channels": ["linkedin"]}})
        assert r.status_code == 403 and r.json()["error"]["code"] == "missing_scope", r.text
        assert (await c.post("/v1/run", json={"plugin": "account", "action": "wallet"})).status_code == 200


async def test_a_mistyped_request_says_what_is_allowed(db):
    keys = await _keys(db, all=["full_access"])
    async with _http(keys["all"]) as c:
        r = await c.post("/v1/run", json={"plugin": "fax", "action": "send"})
        assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_plugin"
        assert r.json()["error"]["details"]["plugins"] == ["voice", "leads", "social", "whatsapp", "account", "mail", "auth", "numbers"]
        r = await c.post("/v1/run", json={"plugin": "voice", "action": "dial"})
        assert r.json()["error"]["code"] == "unknown_action" and "call.start" in r.json()["error"]["details"]["actions"]
        r = await c.post("/v1/run", json={"plugin": "voice", "action": "call.get"})
        assert r.json()["error"]["code"] == "id_required"
        r = await c.post("/v1/run", json={"plugin": "voice", "action": "call.start", "to": "+447700900123"})
        assert r.json()["error"]["code"] == "unknown_field" and "to" in r.json()["error"]["details"]["fields"]
        r = await c.post("/v1/run", json={"plugin": "voice", "action": "call.start", "data": {"goal": "no number"}})
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"  # the call's own checks still apply


async def test_a_retry_with_the_same_idempotency_key_does_not_repeat_the_work(db, monkeypatch):
    monkeypatch.setenv("PUBLIC_API_SANDBOX_CALL_SECONDS", "0")
    keys = await _keys(db, all=["full_access"])
    body = {"plugin": "voice", "action": "call.start", "data": {"to": "+447700900123", "goal": "Book a meeting"}}
    async with _http(keys["all"]) as c:
        first = await c.post("/v1/run", json=body, headers={"Idempotency-Key": "abc-1"})
        again = await c.post("/v1/run", json=body, headers={"Idempotency-Key": "abc-1"})
        assert again.json() == first.json() and again.headers.get("idempotent-replay") == "true"
        await asyncio.sleep(0.05)
        assert len((await c.post("/v1/run", json={"plugin": "voice", "action": "call.list"})).json()["data"]) == 1


async def test_meetings_and_posts_work_through_the_one_endpoint(db):
    keys = await _keys(db, all=["full_access"])
    async with _http(keys["all"]) as c:
        slots = await c.post("/v1/run", json={"plugin": "voice", "action": "meeting.slots", "data": {"date": "2026-11-03"}})
        assert slots.status_code == 200 and slots.json()["data"][0]["slots"]
        booked = await c.post("/v1/run", json={"plugin": "voice", "action": "meeting.book", "data": {
            "name": "Jo Bloggs", "email": "jo@bloggs.example", "date": "2026-11-03", "time": slots.json()["data"][0]["slots"][0]["time"]}})
        assert booked.status_code == 201, booked.text
        mid = booked.json()["id"]
        cancelled = await c.post("/v1/run", json={"plugin": "voice", "action": "meeting.update", "id": mid, "data": {"action": "cancel"}})
        assert cancelled.status_code == 200, cancelled.text
        post = await c.post("/v1/run", json={"plugin": "social", "action": "post.create", "data": {
            "prompt": "Announce our new office", "channels": ["linkedin"]}})
        assert post.status_code == 202, post.text
        got = await c.post("/v1/run", json={"plugin": "social", "action": "post.get", "id": post.json()["id"]})
        assert got.status_code == 200


def test_the_developer_docs_name_the_same_actions_the_endpoint_runs():
    """The docs page (frontend) and POST /v1/run (backend) must list the very same call for each action."""
    import re
    from pathlib import Path

    from app.public_api.run import ACTIONS

    js = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "settings" / "developerCatalog.js").read_text(encoding="utf-8")
    docs = {(m, p): a for m, p, a in re.findall(r'"([A-Z]+) (/v1/[^"]+)": "([a-z]+\.[a-z_.]+)"', js)}
    from app.public_api.mail import ACTIONS as MAIL

    code = {(m, "/v1" + p): f"{plugin}.{action}" for plugin, acts in ACTIONS.items() for action, (m, p, _) in acts.items()}
    # mail has no URL of its own: the docs show each action as POST /v1/run with plugin=mail
    code.update({("POST", f"/v1/run?plugin=mail&action={a}"): f"mail.{a}" for a in MAIL})
    assert docs == code
