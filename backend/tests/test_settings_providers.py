"""E-mail finders set up in the staff portal with no code (plan 11, Part A; providers/generic_http.py)."""
import httpx
import pytest
from sqlalchemy import text

from app.providers import generic_http as GH
from app.providers import registry

CONFIG = {"id": "finder_x", "name": "Finder X", "method": "GET", "url": "https://api.finderx.test/v1/find",
          "keyIn": "header", "keyName": "Authorization", "keyPrefix": "Bearer ",
          "query": {"first": "{first_name}", "last": "{last_name}", "domain": "{domain}"},
          "emailPath": "data.email", "statusPath": "data.status", "verifiedValues": "valid, verified", "catchAllValues": "accept_all",
          "priceUsd": 0.04, "billing": "per_find", "exportable": True, "clientLabel": "Licensed business data", "order": 95}


@pytest.fixture(autouse=True)
def no_settings_providers():
    GH.apply([])
    yield
    GH.apply([])


def _mock(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


# ── What may be saved ───────────────────────────────────────────────────────
@pytest.mark.parametrize("url, ok", [
    ("https://api.finderx.test/v1/find", True), ("https://api.finderx.test/people/{domain}", True),
    ("http://api.finderx.test/find", False), ("https://localhost/find", False), ("https://10.0.0.5/find", False),
    ("https://[::1]/find", False), ("https://db.internal/find", False), ("https://user:pw@api.finderx.test/", False),
    ("https://api.finderx.test:8443/find", False), ("https://intranet/find", False), ("ftp://api.finderx.test", False),
])
def test_only_a_public_https_address_can_be_called(url, ok):
    assert (GH.url_problem(GH._fill(url, GH.TEST_PERSON, for_url=True)) == "") is ok


def test_a_config_is_checked_before_it_is_saved():
    cfg, bad = GH.clean(CONFIG, taken={"hunter"})
    assert bad == [] and cfg["verifiedValues"] == ["valid", "verified"] and cfg["sealedKey"] == ""
    _, bad = GH.clean({**CONFIG, "id": "hunter"}, taken={"hunter"})
    assert any("built into the app" in b for b in bad)
    _, bad = GH.clean({**CONFIG, "id": "Bad Id", "url": "http://x.test", "emailPath": "", "body": {"a": "b"}, "priceUsd": -1}, taken=set())
    assert len(bad) == 5  # the id, https, the e-mail path, a body on a GET, the price


# ── Asking it ───────────────────────────────────────────────────────────────
async def test_the_request_is_built_from_the_settings_and_the_answer_read_from_its_paths(monkeypatch):
    seen = []

    def handler(request):
        seen.append(request)
        status = {"ann": "valid", "bo": "accept_all", "cy": "risky"}[request.url.params["first"]]
        return httpx.Response(200, json={"data": {"email": f"{request.url.params['first']}@acme.co.uk", "status": status}})

    f = GH.SettingsFinder(GH.clean(CONFIG, taken=set())[0])
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ann = await f.find_email(client, "k-1", {"first_name": "ann", "last_name": "Lee", "company": "Acme", "domain": "acme.co.uk"})
        bo = await f.find_email(client, "k-1", {"first_name": "bo", "last_name": "Lee", "company": "Acme", "domain": "acme.co.uk"})
        cy = await f.find_email(client, "k-1", {"first_name": "cy", "last_name": "Lee", "company": "Acme", "domain": "acme.co.uk"})
    assert ann == ("ann@acme.co.uk", "verified") and bo == ("bo@acme.co.uk", "catch_all") and cy == ("", "")
    r = seen[0]
    assert r.headers["Authorization"] == "Bearer k-1" and dict(r.url.params) == {"first": "ann", "last": "Lee", "domain": "acme.co.uk"}


async def test_a_post_with_the_key_in_the_query_and_no_status_keeps_the_address_as_unverified():
    cfg = GH.clean({**CONFIG, "method": "POST", "keyIn": "query", "keyName": "api_key", "query": {},
                    "body": {"person": {"name": "{full_name}"}, "site": "{domain}"}, "statusPath": ""}, taken=set())[0]
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"data": {"email": "ann@acme.co.uk"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        got = await GH.SettingsFinder(cfg).find_email(client, "k-2", {"first_name": "Ann", "last_name": "Lee", "company": "", "domain": "acme.co.uk"})
    assert got == ("ann@acme.co.uk", "catch_all")
    import json

    assert seen[0].url.params["api_key"] == "k-2" and json.loads(seen[0].content) == {"person": {"name": "Ann Lee"}, "site": "acme.co.uk"}
    trusted = GH.SettingsFinder({**cfg, "trustAll": True})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert (await trusted.find_email(client, "k", {"first_name": "A", "last_name": "B", "company": "", "domain": "acme.co.uk"}))[1] == "verified"


async def test_a_refused_key_is_a_provider_failure_and_the_test_says_so():
    from app.providers.base import ProviderError

    f = GH.SettingsFinder(GH.clean(CONFIG, taken=set())[0])
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401))) as client:
        with pytest.raises(ProviderError):
            await f.find_email(client, "bad", GH.TEST_PERSON)
        result = await f.test(client, "bad")
    assert result.ok is False and "key rejected" in result.detail
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"data": {}}))) as client:
        good = await f.test(client, "k")
    assert good.ok is True and "nothing was found" in good.detail


# ── Staff set it up, and it joins the waterfall ─────────────────────────────
@pytest.mark.db
async def test_staff_save_one_and_it_joins_the_waterfall_with_its_price_and_key(staff, db, monkeypatch):
    from app.services import enrichment_waterfall as W

    r = await staff.put("/api/admin-api/providers/custom", json={"config": CONFIG, "key": "secret-key-123"})
    assert r.status_code == 200, r.text
    assert r.json()["keySaved"] is True and "sealedKey" not in r.json() and "secret-key-123" not in r.text
    assert registry.get("finder_x") is not None and "finder_x" in W.PROVIDERS and W.LABELS["finder_x"] == "Finder X"
    listed = (await staff.get("/api/admin-api/providers/custom")).json()["providers"]
    assert [p["id"] for p in listed] == ["finder_x"] and "secret-key-123" not in str(listed)
    assert (await W.finder_keys()).get("finder_x") == "secret-key-123"
    price = (await db.execute(text("SELECT price_in_usd, billing, confirmed FROM provider_prices WHERE provider = 'finder_x'"))).one()
    assert tuple(price) == (0.04, "per_find", True)
    every = (await staff.get("/api/admin-api/providers")).json()["providers"]
    assert next(p for p in every if p["id"] == "finder_x")["settingsMade"] is True

    # Changing it without a key keeps the key.
    r = await staff.put("/api/admin-api/providers/custom", json={"config": {**CONFIG, "name": "Finder X2"}})
    assert r.json()["keySaved"] is True and W.LABELS["finder_x"] == "Finder X2"

    # Test runs its real request with the saved key.
    _mock(monkeypatch, lambda req: httpx.Response(200, json={"data": {}}) if req.headers.get("Authorization") == "Bearer secret-key-123"
          else httpx.Response(401))
    assert (await staff.post("/api/admin-api/providers/finder_x/test")).json()["ok"] is True

    assert (await staff.delete("/api/admin-api/providers/custom/finder_x")).json() == {"ok": True}
    assert registry.get("finder_x") is None and "finder_x" not in W.PROVIDERS
    assert (await staff.delete("/api/admin-api/providers/custom/finder_x")).status_code == 404


@pytest.mark.db
async def test_a_bad_config_or_a_built_in_id_is_refused(staff):
    r = await staff.put("/api/admin-api/providers/custom", json={"config": {**CONFIG, "url": "https://127.0.0.1/find"}})
    assert r.status_code == 400 and "IP address" in r.json()["detail"]
    r = await staff.put("/api/admin-api/providers/custom", json={"config": {**CONFIG, "id": "hunter"}})
    assert r.status_code == 400 and "built into the app" in r.json()["detail"]


@pytest.mark.db
async def test_a_search_uses_it_through_the_provider_wrapper(db, monkeypatch):
    from app.core.tenancy import org_scope, system_scope
    from app.services import enrichment_waterfall as W

    with system_scope():
        cfg, bad = await GH.save(db, {**CONFIG, "order": 1}, key="k-9")
    assert bad == []

    async def only_mine():
        return {"finder_x": "k-9"}

    monkeypatch.setattr(W, "finder_keys", only_mine)
    _mock(monkeypatch, lambda req: httpx.Response(200, json={"data": {"email": "ann@acme.co.uk", "status": "valid"}}))
    with org_scope("org_s"):
        out = await W.lookup_person_waterfall(db, "org_s", "Ann", "Lee", "Acme Ltd", "acme.co.uk", bill=False)
    assert out["found"] is True and out["source"] == "finder_x"
    row = (await db.execute(text("SELECT provider, op, outcome, cost_usd FROM provider_call_log WHERE provider = 'finder_x'"))).one()
    assert tuple(row) == ("finder_x", "find_email", "found", 0.04)


@pytest.mark.db
async def test_it_is_loaded_again_at_start_up(db):
    from app.core.tenancy import system_scope
    from app.services import enrichment_waterfall as W

    with system_scope():
        await GH.save(db, CONFIG, key="k")
    GH.apply([])
    assert registry.get("finder_x") is None
    assert await GH.load() == 1
    assert registry.get("finder_x") is not None and "finder_x" in W.PROVIDERS


def test_a_settings_made_finder_never_replaces_a_provider_file():
    GH.apply([GH.SettingsFinder({**GH.clean(CONFIG, taken=set())[0], "id": "hunter", "name": "Fake Hunter"})])
    assert registry.get("hunter").manifest.name != "Fake Hunter"
