"""Search-service calls (DeepSeek, Tavily) and Google confirmation. None of this needs a database or a network."""
import asyncio

import pytest

from app.services import enrichment_service as ES
from app.services import web_harness as H

NAME = "Teddy Bears Pre-School"


def run(coro):
    return asyncio.run(coro)


def test_no_search_api_means_no_scraped_fallback(monkeypatch):
    async def off():
        return False

    async def boom(*a, **k):
        raise AssertionError("a scraped search engine was called")

    monkeypatch.setattr(ES, "deepseek_search_enabled", off)

    async def no_tavily():
        return ""

    monkeypatch.setattr(ES, "tavily_key", no_tavily)
    monkeypatch.setattr(ES.httpx, "AsyncClient", boom)
    assert run(ES.search_open_web("Teddy Bears Pre-School SG4 0QY")) == []
    assert not hasattr(ES, "search_duckduckgo_lite")


def test_the_deepseek_search_request_has_no_localization(monkeypatch):
    sent = {}

    class Resp:
        status_code = 200
        text = ""

        def json(self):
            return {"results": [{"title": "Teddybears Pre-School", "url": "https://teddybears-preschool.co.uk", "snippet": "s", "summary": "long", "content": ""}]}

    class Client:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, headers=None):
            sent["url"], sent["body"] = url, json
            return Resp()

    async def on():
        return True

    async def key():
        return "sk-test"

    async def bump(_):
        return None

    monkeypatch.setattr(ES, "deepseek_search_enabled", on)
    monkeypatch.setattr(ES, "deepseek_key", key)
    monkeypatch.setattr(ES, "_bump_vendor_call", bump)
    monkeypatch.setattr(ES.httpx, "AsyncClient", Client)
    monkeypatch.setattr(ES, "_DEEPSEEK_SPACING", 0)
    out = run(ES.search_deepseek("Teddy Bears Pre-School SG4 0QY", max_results=6))
    assert sent["url"] == "https://api.deepseek.com/v1/tools/search"
    assert sent["body"] == {"query": "Teddy Bears Pre-School SG4 0QY", "count": 6}  # only what is needed: no localization (it must be an IP)
    assert out[0]["url"] == "https://teddybears-preschool.co.uk" and out[0]["summary"] == "long"


class _Resp:
    def __init__(self, status, payload=None, text=""):
        self.status_code, self._payload, self.text = status, payload or {}, text

    def json(self):
        return self._payload


def _deepseek_client(monkeypatch, replies, log):
    """Stands in for DeepSeek: each call answers with the next reply in the list."""
    class Client:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, headers=None):
            log.append((url, json))
            return replies.pop(0)

    async def on():
        return True

    async def key():
        return "sk-test"

    async def bump(_):
        return None

    monkeypatch.setattr(ES, "deepseek_search_enabled", on)
    monkeypatch.setattr(ES, "deepseek_key", key)
    monkeypatch.setattr(ES, "_bump_vendor_call", bump)
    monkeypatch.setattr(ES.httpx, "AsyncClient", Client)
    monkeypatch.setattr(ES, "_DEEPSEEK_BACKOFF", (0, 0))
    monkeypatch.setattr(ES, "_DEEPSEEK_SPACING", 0)


HIT = {"results": [{"title": "T", "url": "https://teddybears-preschool.co.uk", "snippet": "s", "summary": "long", "content": ""}]}


def test_a_429_is_retried_and_then_succeeds(monkeypatch):
    log = []
    _deepseek_client(monkeypatch, [_Resp(429), _Resp(200, HIT)], log)
    assert run(ES.search_deepseek("Teddy Bears", max_results=3))[0]["url"] == "https://teddybears-preschool.co.uk"
    assert len(log) == 2


def test_a_server_error_gives_up_after_the_retries_and_finds_nothing(monkeypatch):
    log = []
    _deepseek_client(monkeypatch, [_Resp(503), _Resp(503), _Resp(503)], log)
    assert run(ES.search_deepseek("Teddy Bears")) == [] and len(log) == 3


@pytest.mark.parametrize("status,words", [(402, "balance is empty"), (401, "rejected the saved key"), (403, "security policy")])
def test_each_failure_is_said_plainly_in_the_log_and_not_retried(monkeypatch, caplog, status, words):
    log = []
    _deepseek_client(monkeypatch, [_Resp(status)], log)
    with caplog.at_level("WARNING"):
        assert run(ES.search_deepseek("Teddy Bears")) == []
    assert len(log) == 1 and words in caplog.text


def test_fetch_returns_markdown_and_refuses_an_address_with_a_login_in_it(monkeypatch):
    log = []
    _deepseek_client(monkeypatch, [_Resp(200, {"title": "Home", "content": "# Teddybears\nCall 01462 123456"})], log)
    assert run(ES.fetch_deepseek("https://teddybears-preschool.co.uk"))["content"].startswith("# Teddybears")
    assert log[0] == ("https://api.deepseek.com/v1/tools/fetch", {"url": "https://teddybears-preschool.co.uk"})
    assert run(ES.fetch_deepseek("https://user:pass@site.com/")) is None and run(ES.fetch_deepseek("ftp://site.com")) is None
    assert len(log) == 1


def test_a_fetch_with_no_readable_content_is_not_counted_as_a_find(monkeypatch):
    log = []
    _deepseek_client(monkeypatch, [_Resp(200, {"title": "", "content": "  "})], log)
    assert run(ES.fetch_deepseek("https://site.com")) is None


def test_requests_are_spaced_under_the_five_a_second_limit(monkeypatch):
    import time
    log, replies = [], [_Resp(200, HIT) for _ in range(3)]
    _deepseek_client(monkeypatch, replies, log)
    monkeypatch.setattr(ES, "_DEEPSEEK_SPACING", 0.12)

    async def three():
        await asyncio.gather(*[ES.search_deepseek(f"Teddy Bears {i}") for i in range(3)])

    started = time.monotonic()
    run(three())
    assert time.monotonic() - started >= 0.22 and len(log) == 3



def _site(monkeypatch, title, text=None, raises=None):
    async def fake(url, max_chars=6000):
        if raises:
            raise raises
        return title, text
    monkeypatch.setattr(H, "fetch_text", fake)


PLACE = {"name": "Teddybears Pre-School", "website": "https://www.teddybears-preschool.co.uk/", "phone": "01462 123456", "place_id": "p1"}


def test_google_is_only_a_lead_the_site_must_confirm_it(monkeypatch):
    _site(monkeypatch, "Teddybears Pre-School | Hitchin", "Welcome. Call us on 01462 123456.")
    assert run(H.confirm_place(NAME, "SG4 0QY", PLACE)) == {"website": "https://www.teddybears-preschool.co.uk/", "phone": "01462 123456"}


def test_a_google_phone_the_site_does_not_print_is_not_kept(monkeypatch):
    _site(monkeypatch, "Teddybears Pre-School", "Welcome to our pre-school. Contact us by email.")
    assert run(H.confirm_place(NAME, "SG4 0QY", PLACE)) == {"website": "https://www.teddybears-preschool.co.uk/"}


def test_a_page_about_another_business_confirms_nothing(monkeypatch):
    _site(monkeypatch, "Acme Plumbing", "Boilers in Leeds. Call 01462 123456.")
    assert run(H.confirm_place(NAME, "SG4 0QY", PLACE)) == {}


def test_the_postcode_on_the_page_can_confirm_a_site_that_does_not_name_the_company(monkeypatch):
    _site(monkeypatch, "Welcome", "Visit us at 1 High Street, Hitchin SG4 0QY. Phone 01462 123456")
    assert run(H.confirm_place(NAME, "SG4 0QY", PLACE))["website"] == "https://www.teddybears-preschool.co.uk/"


def test_a_dead_site_and_a_listing_page_confirm_nothing(monkeypatch):
    _site(monkeypatch, "", raises=H.FetchRefused("The page answered with error 404."))
    assert run(H.confirm_place(NAME, "SG4 0QY", PLACE)) == {}
    assert run(H.confirm_place(NAME, "SG4 0QY", {**PLACE, "website": "https://www.yell.com/biz/teddy-bears"})) == {}
    assert run(H.confirm_place(NAME, "SG4 0QY", None)) == {}
