"""The Apollo company lookup: only a company at the postcode we hold, or found by its own website, is taken."""
import pytest

from app.services import enrichment_service as E


class _Resp:
    def __init__(self, body, status=200):
        self._body, self.status_code, self.text = body, status, ""

    def json(self):
        return self._body


def _client(search_orgs=None, enrich_org=None):
    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, **k):
            return _Resp({"organization": enrich_org or {}})

        async def post(self, url, **k):
            return _Resp({"organizations": search_orgs or []})

    return Client


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    async def key():
        return "test-key"

    async def bump(_):
        return None

    monkeypatch.setattr(E, "apollo_key", key)
    monkeypatch.setattr(E, "_bump_vendor_call", bump)


def _org(name, postcode, country="United Kingdom", phone="+44 113 236 2010"):
    return {"id": "x1", "name": name, "postal_code": postcode, "country": country, "phone": phone, "website_url": "http://example.co.uk"}


@pytest.mark.asyncio
async def test_by_name_takes_only_the_company_at_our_postcode(monkeypatch):
    monkeypatch.setattr(E.httpx, "AsyncClient", _client(search_orgs=[_org("Farsley Dental", "LS28 5HX")]))
    got = await E.search_apollo("Farsley Dental Practice", postcode="LS28 5HX")
    assert got and got["phone"] == "+44 113 236 2010" and got["postcode_match"] is True and got["via"] == "apollo"


@pytest.mark.asyncio
async def test_the_same_name_in_another_town_or_country_is_not_taken(monkeypatch):
    other = [_org("Be Sweet", "LE1 1AA"), _org("Be Sweet", "94965", country="United States")]
    monkeypatch.setattr(E.httpx, "AsyncClient", _client(search_orgs=other))
    assert await E.search_apollo("Be Sweet", postcode="LE10 1DA") is None


@pytest.mark.asyncio
async def test_a_name_with_no_postcode_is_never_guessed(monkeypatch):
    monkeypatch.setattr(E.httpx, "AsyncClient", _client(search_orgs=[_org("Farsley Dental", "LS28 5HX")]))
    assert await E.search_apollo("Farsley Dental") is None


@pytest.mark.asyncio
async def test_by_website_domain_is_taken_when_the_name_agrees(monkeypatch):
    monkeypatch.setattr(E.httpx, "AsyncClient", _client(enrich_org=_org("Farsley Dental", "LS28 5HX")))
    got = await E.search_apollo("Farsley Dental Practice", postcode="LS28 5HX", domain="farsleydental.co.uk")
    assert got and got["postcode_match"] is True
    monkeypatch.setattr(E.httpx, "AsyncClient", _client(enrich_org=_org("Totally Different Ltd", "LS28 5HX")))
    assert await E.search_apollo("Farsley Dental Practice", postcode="LS28 5HX", domain="farsleydental.co.uk") is None


@pytest.mark.asyncio
async def test_with_apollo_first_switched_on_the_deeper_search_asks_apollo_then_google_for_what_is_missing(monkeypatch):
    monkeypatch.setenv("APOLLO_FIRST_FOR", "company_by_name")
    google_asked = []

    async def fake_google(query, **_):
        google_asked.append(query)
        return {"name": "York Place Dental Practice", "website": "http://www.ypdp.co.uk/", "phone": "", "place_id": "g1", "postcode_match": True}

    apollo_has = {"phone": "+44 1937 000000"}

    async def fake_apollo(name, *, postcode="", domain=""):
        if not apollo_has:
            return None
        return {"name": "York Place Dental", "phone": apollo_has["phone"], "website": "http://www.ypdp.co.uk", "place_id": "apollo_1", "via": "apollo", "postcode_match": True}

    monkeypatch.setattr(E, "search_google_places", fake_google)
    monkeypatch.setattr(E, "search_apollo", fake_apollo)
    # Apollo has the phone: Google is never asked.
    got = await E.search_deeper("York Place Dental", name="York Place Dental Practice", postcode="LS22 6NZ", want="phone")
    assert got["via"] == "apollo" and got["phone"] and google_asked == []
    # Apollo has nothing: Google's listing is used.
    apollo_has.clear()
    got = await E.search_deeper("York Place Dental", name="York Place Dental Practice", postcode="LS22 6NZ", want="website")
    assert got["place_id"] == "g1" and len(google_asked) == 1


@pytest.mark.asyncio
async def test_when_neither_has_it_the_google_listing_is_returned_not_invented(monkeypatch):
    async def fake_google(query, **_):
        return {"name": "Be Sweet", "website": "", "phone": "", "place_id": "g2"}

    async def fake_apollo(name, *, postcode="", domain=""):
        return None

    monkeypatch.setattr(E, "search_google_places", fake_google)
    monkeypatch.setattr(E, "search_apollo", fake_apollo)
    got = await E.search_deeper("Be Sweet", name="Be Sweet", postcode="LE10 1DA", want="phone")
    assert got["place_id"] == "g2" and not got["phone"]


@pytest.mark.asyncio
async def test_by_default_google_is_asked_first_and_apollo_only_for_what_it_lacks(monkeypatch):
    monkeypatch.delenv("APOLLO_FIRST_FOR", raising=False)
    google = {"name": "York Place Dental Practice", "website": "http://www.ypdp.co.uk/", "phone": "", "place_id": "g1", "postcode_match": True}
    asked = []

    async def fake_google(query, **_):
        return dict(google)

    async def fake_apollo(name, *, postcode="", domain=""):
        asked.append(domain)
        return {"name": "York Place Dental", "phone": "+44 1937 000000", "website": "http://www.ypdp.co.uk", "place_id": "apollo_1", "via": "apollo", "postcode_match": True}

    monkeypatch.setattr(E, "search_google_places", fake_google)
    monkeypatch.setattr(E, "search_apollo", fake_apollo)
    got = await E.search_deeper("York Place Dental", name="York Place Dental Practice", postcode="LS22 6NZ", want="website")
    assert got["place_id"] == "g1" and asked == []  # Google has the website: Apollo is never asked
    got = await E.search_deeper("York Place Dental", name="York Place Dental Practice", postcode="LS22 6NZ", want="phone")
    assert got["via"] == "apollo" and asked == ["ypdp.co.uk"]  # Google has no phone: Apollo is asked about the site Google named
