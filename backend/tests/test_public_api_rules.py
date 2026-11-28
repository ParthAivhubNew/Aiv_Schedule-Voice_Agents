"""The exclusion list and each person's areas through /v1 and the one front door /v1/run: the same handlers the Administration screens use,
reached by an API key. No database needed: the handlers are stand-ins here (their own tests cover what they do)."""
import json
from types import SimpleNamespace

import pytest
from fastapi.responses import JSONResponse

from app.api import data_access as DAPI
from app.api import org_exclusions as OE
from app.public_api import core
from app.public_api import rules as R
from app.public_api import run as RUN

KEY = {"type": "api_key", "org_id": "org_k", "operator_id": "api_client", "username": "key:abc", "scopes": ["full_access"], "test": False}


def request():
    return SimpleNamespace(state=SimpleNamespace(auth=dict(KEY)), headers={"authorization": "Bearer x"})


@pytest.fixture
def as_key(monkeypatch):
    seen = {}

    async def authorize(req, db, scope, service=None):
        seen["scope"] = scope
        return dict(seen.get("ctx") or KEY)

    monkeypatch.setattr(R, "authorize", authorize)
    return seen


# ---- the front door -----------------------------------------------------------------------------------
def test_every_call_is_an_action_of_the_one_endpoint():
    acts = RUN.ACTIONS["account"]
    assert acts["exclusion.list"] == ("GET", "/exclusions", False) and acts["exclusion.add"] == ("POST", "/exclusions", False)
    assert acts["exclusion.preview"] == ("POST", "/exclusions/preview", False)
    assert acts["exclusion.edit"] == ("PATCH", "/exclusions/{id}", True) and acts["exclusion.remove"] == ("DELETE", "/exclusions/{id}", True)
    assert acts["access.list"] == ("GET", "/access", False) and acts["access.preview"] == ("POST", "/access/preview", False)
    assert acts["access.set"] == ("PUT", "/access/{id}", True)


def test_each_action_points_at_a_real_public_route():
    from app.main import app

    routes = set()
    for path, ops in app.openapi()["paths"].items():
        for method in ops:
            routes.add((method.upper(), path))
    import re

    norm = lambda p: re.sub(r"\{[a-z_]+\}", "{id}", p)  # noqa: E731
    published = {(m, norm(p)) for m, p in routes if p.startswith("/v1/")}
    for name, (method, path, _) in RUN.ACTIONS["account"].items():
        if name.startswith(("exclusion.", "access.")):
            assert (method, "/v1" + path) in published, name


# ---- the key acts as its account's admin, through the app's own handler --------------------------------
async def test_the_handler_is_called_for_the_keys_account_as_its_admin(monkeypatch, as_key):
    got = {}

    async def list_rules(req, db):
        got["auth"] = req.state.auth
        return {"rules": [], "max": 500, "enabled": 0}

    monkeypatch.setattr(OE, "list_rules", list_rules)
    out = await R.exclusions_get(request(), None)
    assert out["max"] == 500 and as_key["scope"] == "company:write"
    assert got["auth"]["org_id"] == "org_k" and got["auth"]["is_admin"] is True and got["auth"]["type"] == "session"
    assert KEY["type"] == "api_key"  # the key's own context is untouched


async def test_every_call_needs_the_company_scope(monkeypatch, as_key):
    async def anything(*a, **k):
        return {}

    for name in ("list_rules", "add_rules", "change_rule", "delete_rule", "preview"):
        monkeypatch.setattr(OE, name, anything)
    for name in ("overview", "change", "preview_areas"):
        monkeypatch.setattr(DAPI, name, anything)
    calls = [R.exclusions_get(request(), None), R.exclusions_add(R.ExclusionsIn(items=["church"]), request(), None),
             R.exclusions_preview(R.ExclusionPreviewIn(add_items=["church"]), request(), None),
             R.exclusions_change("x", R.ExclusionChange(enabled=False), request(), None), R.exclusions_delete("x", request(), None),
             R.access_get(request(), None), R.access_preview(R.AreasIn(districts=["BN1"]), request(), None),
             R.access_set("u", R.AccessChange(districts=["BN1"]), request(), None)]
    for call in calls:
        as_key.clear()
        await call
        assert as_key["scope"] == "company:write"


# ---- errors come back in this API's shape --------------------------------------------------------------
async def test_unusable_items_are_named_in_rejected(monkeypatch, as_key):
    async def add_rules(body, req, db):
        return JSONResponse(status_code=422, content={"detail": "Nothing was added. x: Use letters.", "rejected": [{"item": "x", "reason": "Use letters"}]})

    monkeypatch.setattr(OE, "add_rules", add_rules)
    with pytest.raises(core.ApiError) as err:
        await R.exclusions_add(R.ExclusionsIn(items=["x"]), request(), None)
    assert err.value.status == 422 and err.value.code == "invalid_request" and err.value.details["rejected"][0]["item"] == "x"


async def test_the_apps_plain_refusals_keep_their_meaning(monkeypatch, as_key):
    from fastapi import HTTPException

    async def gone(rule_id, req, db):
        raise HTTPException(status_code=404, detail="That rule isn't in your list.")

    async def clash(rule_id, body, req, db):
        raise HTTPException(status_code=409, detail="Someone else changed this rule.")

    monkeypatch.setattr(OE, "delete_rule", gone)
    monkeypatch.setattr(OE, "change_rule", clash)
    with pytest.raises(core.ApiError) as a:
        await R.exclusions_delete("x", request(), None)
    assert a.value.status == 404 and a.value.code == "not_found"
    with pytest.raises(core.ApiError) as b:
        await R.exclusions_change("x", R.ExclusionChange(enabled=False), request(), None)
    assert b.value.status == 409 and b.value.code == "conflict"


# ---- a test key reads and writes nothing real -----------------------------------------------------------
async def test_a_test_key_is_simulated_and_touches_nothing(monkeypatch, as_key):
    as_key["ctx"] = {**KEY, "test": True}

    async def boom(*a, **k):
        raise AssertionError("a test key reached a real handler")

    for name in ("list_rules", "add_rules", "change_rule", "delete_rule", "preview"):
        monkeypatch.setattr(OE, name, boom)
    for name in ("overview", "change", "preview_areas"):
        monkeypatch.setattr(DAPI, name, boom)
    outs = [await R.exclusions_get(request(), None), await R.exclusions_add(R.ExclusionsIn(items=["church"]), request(), None),
            await R.exclusions_preview(R.ExclusionPreviewIn(), request(), None), await R.exclusions_change("x", R.ExclusionChange(enabled=False), request(), None),
            await R.exclusions_delete("x", request(), None), await R.access_get(request(), None),
            await R.access_preview(R.AreasIn(districts=["BN1"]), request(), None), await R.access_set("u", R.AccessChange(districts=["BN1"]), request(), None)]
    assert all(o.get("simulated") is True for o in outs)


# ---- through the real front door (needs the database) ---------------------------------------------------
@pytest.mark.db
async def test_the_front_door_keeps_the_list_and_the_areas_end_to_end(client, db):
    import httpx

    from app.main import app

    key = (await client.post("/api/developer/keys", json={"name": "rules", "scopes": ["leads:search"], "live": True})).json()["secret"]

    async def run(action, data=None, id=None):
        body = {"plugin": "account", "action": action, **({"data": data} if data is not None else {}), **({"id": id} if id else {})}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {key}"}) as c:
            return await c.post("/v1/run", json=body)

    added = await run("exclusion.add", {"items": ["church", "85200", "Charity register"]})
    assert added.status_code == 200 and added.json()["added"] == 3
    bad = await run("exclusion.add", {"items": ["x"]})
    assert bad.status_code == 422 and bad.json()["error"]["details"]["rejected"][0]["item"] == "x"
    rules = (await run("exclusion.list")).json()["rules"]
    assert len(rules) == 3 and all(r["enabled"] for r in rules)
    church = next(r for r in rules if r["value"] == "church")
    off = await run("exclusion.edit", {"enabled": False, "updated_at": church["updatedAt"]}, id=church["id"])
    assert off.status_code == 200 and off.json()["enabled"] is False
    assert (await run("exclusion.preview", {"add_items": ["school"]})).status_code == 200
    assert (await run("exclusion.remove", id=church["id"])).json()["deleted"] is True
    assert (await run("exclusion.remove", id=church["id"])).status_code == 404

    # the same list is what the app's own Administration screen reads
    assert len((await client.get("/api/org/exclusions")).json()["rules"]) == 2

    people = (await run("access.list")).json()
    assert "users" in people and "roles" in people
    assert (await run("access.preview", {"districts": ["BN1"]})).json()["districts"] == ["BN1"]
    assert (await run("access.preview", {"districts": ["not an area"]})).status_code == 400
