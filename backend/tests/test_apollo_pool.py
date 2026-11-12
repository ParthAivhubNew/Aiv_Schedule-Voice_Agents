"""Backup Apollo keys: a key that is out of credits hands the same task to the next one, and every call is logged."""
import pytest

from app.services import apollo_pool as AP
from app.services import enrichment_service as E

pytestmark = pytest.mark.db


class _Resp:
    def __init__(self, status, body=None):
        self.status_code, self._body, self.text = status, body or {}, ""

    def json(self):
        return self._body


def _client(answers):
    """answers: {api key: status}. The key that gets 200 returns one UK company."""
    seen = []

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None, **k):
            key = headers["x-api-key"]
            seen.append(key)
            status = answers[key]
            org = {"id": "o1", "name": "Farsley Dental", "postal_code": "LS28 5HX", "country": "United Kingdom", "phone": "0113 000", "website_url": "http://f.co.uk"}
            return _Resp(status, {"organization": org} if status == 200 else {})

    Client.seen = seen
    return Client


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    AP._COOL.clear()

    async def main():
        return "main-key-aaaa1111"

    async def bump(_):
        return None

    monkeypatch.setattr(E, "apollo_key", main)
    monkeypatch.setattr(E, "_bump_vendor_call", bump)
    yield
    AP._COOL.clear()


async def test_an_exhausted_key_hands_the_task_to_the_backup_and_both_calls_are_logged(staff, monkeypatch):
    assert (await staff.post("/api/admin-api/apollo/keys", json={"label": "Backup 1", "key": "backup-key-bbbb2222"})).status_code == 200
    client = _client({"main-key-aaaa1111": 402, "backup-key-bbbb2222": 200})
    monkeypatch.setattr(E.httpx, "AsyncClient", client)

    got = await E.search_apollo("Farsley Dental Practice", postcode="LS28 5HX", domain="f.co.uk")
    assert got and got["phone"] == "0113 000"
    assert client.seen == ["main-key-aaaa1111", "backup-key-bbbb2222"]

    # The main key is now set aside: the next task goes straight to the backup.
    client.seen.clear()
    await E.search_apollo("Farsley Dental Practice", postcode="LS28 5HX", domain="g.co.uk")  # another company
    assert client.seen == ["backup-key-bbbb2222"]

    data = (await staff.get("/api/admin-api/apollo")).json()
    keys = {k["id"]: k for k in data["keys"]}
    assert keys["main"]["coolingSeconds"] > 0 and keys["main"]["exhausted"] == 1 and keys["main"]["tail"] == "1111"
    backup = next(k for k in data["keys"] if not k["main"])
    assert backup["label"] == "Backup 1" and backup["found"] == 2
    outcomes = [(c["tail"], c["outcome"], c["purpose"], c["lookedFor"]) for c in data["calls"]]
    assert ("1111", "key_exhausted", "company_by_website", "f.co.uk") in outcomes and ("2222", "found", "company_by_website", "f.co.uk") in outcomes
    assert any(c["lookedFor"] == "g.co.uk" and c["tail"] == "2222" for c in data["calls"])
    assert "bbbb2222" not in str(data)  # the key itself is never returned


async def test_when_every_key_is_exhausted_nothing_is_found_and_no_key_is_invented(staff, monkeypatch):
    await staff.post("/api/admin-api/apollo/keys", json={"label": "Backup 1", "key": "backup-key-bbbb2222"})
    monkeypatch.setattr(E.httpx, "AsyncClient", _client({"main-key-aaaa1111": 402, "backup-key-bbbb2222": 429}))
    assert await E.search_apollo("Farsley Dental Practice", postcode="LS28 5HX", domain="f.co.uk") is None


async def test_backup_keys_can_be_removed_and_a_duplicate_is_refused(staff):
    assert (await staff.post("/api/admin-api/apollo/keys", json={"label": "B", "key": "backup-key-bbbb2222"})).status_code == 200
    assert (await staff.post("/api/admin-api/apollo/keys", json={"label": "B again", "key": "backup-key-bbbb2222"})).status_code == 400
    assert (await staff.post("/api/admin-api/apollo/keys", json={"label": "Main again", "key": "main-key-aaaa1111"})).status_code == 400
    backup = next(k for k in (await staff.get("/api/admin-api/apollo")).json()["keys"] if not k["main"])
    assert (await staff.delete(f"/api/admin-api/apollo/keys/{backup['id']}")).status_code == 200
    assert [k["id"] for k in (await staff.get("/api/admin-api/apollo")).json()["keys"]] == ["main"]
    assert (await staff.delete("/api/admin-api/apollo/keys/nope")).status_code == 404


async def test_the_log_says_which_user_and_which_screen_action_caused_the_call(staff, db, monkeypatch):
    from app.core.tenancy import actor_scope, org_scope, route_scope
    from tests.conftest import make_user

    op, _ = await make_user(db, "anitha", "Admin", org_id="org_log1")
    monkeypatch.setattr(E.httpx, "AsyncClient", _client({"main-key-aaaa1111": 200}))
    with org_scope("org_log1"), actor_scope(op.id), route_scope("POST", "/api/leads/companies/c1/find-website"):
        await E.search_apollo("Farsley Dental Practice", postcode="LS28 5HX", domain="f.co.uk")
    await E.search_apollo("Farsley Dental Practice", postcode="LS28 5HX", domain="s.co.uk")  # no user, no request: a system job

    calls = (await staff.get("/api/admin-api/apollo")).json()["calls"]
    mine = next(c for c in calls if c["user"] == "Anitha")
    assert mine["where"] == "Find website (company)" and mine["org"] == "org_log1" and mine["credits"] == 1
    assert any(c["user"] == "System" and c["where"] == "Background job" for c in calls)


def test_routes_are_named_in_plain_words_and_unknown_ones_are_shown_as_they_are():
    assert AP.route_label("POST /api/leads/companies/x/person-email") == "Find a person's email"
    assert AP.route_label("POST /api/leads/accounts/a1/deep-search") == "Quick check / deep search (My List)"
    assert AP.route_label("GET /api/something/new") == "GET /api/something/new"
    assert AP.route_label("") == "Background job"


async def test_a_403_only_sets_that_kind_of_request_aside_and_a_429_waits_as_long_as_apollo_says(monkeypatch):
    """403 = this key may not use that endpoint (a master key is needed); it still serves the others. 429 carries Retry-After."""
    AP._COOL.clear()

    class Client:
        async def get(self, url, headers=None, **k):
            return _Resp(403)

        async def post(self, url, headers=None, **k):
            return _Resp(200, {"organizations": []})

    r = await AP.call(Client(), "get", "https://x", purpose="company_by_website")
    assert r.status_code == 403
    assert AP.cooling_for("main:company_by_website") > 0 and AP.cooling_for("main") == 0
    r = await AP.call(Client(), "post", "https://x", purpose="company_by_name")
    assert r.status_code == 200  # the same key still answers a different kind of request

    class Limited(_Resp):
        headers = {"retry-after": "600"}

    class Client429:
        async def get(self, url, headers=None, **k):
            return Limited(429)

    await AP.call(Client429(), "get", "https://x", purpose="email_lookup")
    assert 590 <= AP.cooling_for("main") <= 600


async def test_apollo_first_gives_the_pages_phone_and_website_once_and_remembers_a_miss(db, monkeypatch):
    monkeypatch.setenv("APOLLO_FIRST_FOR", "company_by_name")
    from app.core.tenancy import org_scope
    from app.models.models import BusinessRecord
    from app.services import apollo_first as AF

    asked = []

    async def fake_apollo(name, *, postcode="", domain=""):
        asked.append(name)
        return {"name": name, "phone": "0113 496 0000", "website": "http://f.co.uk", "raw": {
            "linkedin_url": "http://www.linkedin.com/company/farsley-dental", "facebook_url": "https://facebook.com/", "twitter_url": "https://example.com/x"}}

    monkeypatch.setattr(E, "search_apollo", fake_apollo)
    org = "org_af1"
    with org_scope(org):
        biz = BusinessRecord(id="br_af1", identity_hash="h_af1", name="Farsley Dental", postcode="LS28 5HX", raw_data={})
        db.add(biz)
        await db.flush()
        first = await AF.record(db, biz)
        again = await AF.record(db, biz)
    assert first["linkedin"] == "https://linkedin.com/company/farsley-dental"  # a real company page
    assert first["facebook"] == "" and first["x"] == ""  # a bare facebook.com or a link to another site is not a page
    assert first["phone"] == "0113 496 0000" and again == first and asked == ["Farsley Dental"]  # the second ask is free


async def test_apollo_first_does_nothing_until_it_is_switched_on(db, monkeypatch):
    from app.models.models import BusinessRecord
    from app.services import apollo_first as AF

    monkeypatch.delenv("APOLLO_FIRST_FOR", raising=False)

    async def never(*a, **k):
        raise AssertionError("Apollo must not be asked")

    monkeypatch.setattr(E, "search_apollo", never)
    assert await AF.record(db, BusinessRecord(id="br_af2", identity_hash="h_af2", name="X", raw_data={})) == {}


async def test_a_company_costs_one_apollo_request_ever_and_a_miss_or_a_failure_is_handled_right(db, monkeypatch):
    sent = []

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None, **k):
            sent.append(k["params"]["domain"])
            return _Resp(429) if k["params"]["domain"] == "busy.co.uk" else _Resp(200, {"organization": {}})  # Apollo has nothing for the others

        async def post(self, url, headers=None, **k):
            sent.append(k["json"]["q_organization_name"])
            return _Resp(200, {"organizations": []})

    monkeypatch.setattr(E.httpx, "AsyncClient", Client)
    # A miss is one request, and asking again (from any button, any organisation) sends nothing.
    assert await E.search_apollo("Nobody Ltd", postcode="LS1 1AA", domain="nobody.co.uk") is None
    assert await E.search_apollo("Nobody Ltd", postcode="LS1 1AA", domain="nobody.co.uk") is None
    assert sent == ["nobody.co.uk"]
    # By name there is one request too (no second spelling), and a name with no postcode is never sent.
    assert await E.search_apollo("Farsley Dental Practice", postcode="LS28 5HX") is None
    assert await E.search_apollo("Farsley Dental Practice") is None
    assert sent == ["nobody.co.uk", "Farsley Dental Practice"]
    # A refused request is not an answer: it is asked again later.
    await E.search_apollo("Busy Ltd", postcode="LS1 1AA", domain="busy.co.uk")
    AP._COOL.clear()
    await E.search_apollo("Busy Ltd", postcode="LS1 1AA", domain="busy.co.uk")
    assert sent.count("busy.co.uk") == 2
