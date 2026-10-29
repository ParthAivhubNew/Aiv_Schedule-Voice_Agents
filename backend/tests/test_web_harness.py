"""The AI search harness: the model proposes, the code decides. None of this needs a database or a network."""
import asyncio

import pytest

from app.services import enrichment_service as ES
from app.services import llm_gateway, web_harness as H

NAME = "Teddy Bears Pre-School"
FACTS = {"postcode": "SG4 0QY", "address": "1 High St, Hitchin", "industry": "Child day-care activities", "company_number": "0123"}

SOURCES = [
    {"url": "https://www.teddybears-preschool.co.uk/contact", "title": "Teddybears Pre-School | Hitchin", "text": "Call us on 01462 123456 or email hello@teddybears-preschool.co.uk"},
    {"url": "https://www.yell.com/biz/teddy-bears-pre-school", "title": "Teddy Bears Pre-School - Yell", "text": "Phone 01462 999111"},
    {"url": "https://www.otherplace.co.uk/", "title": "Teddy Bears Nursery Leeds", "text": "Ring 0113 496 0123"},
]


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def web(monkeypatch):
    seen = {"queries": [], "fetched": []}

    async def search(q, max_results=5):
        seen["queries"].append(q)
        return [{"url": s["url"], "title": s["title"], "snippet": s["text"]} for s in SOURCES]

    async def fetch(url):
        seen["fetched"].append(url)
        return None

    monkeypatch.setattr(ES, "search_open_web", search)
    monkeypatch.setattr(ES, "fetch_deepseek", fetch)
    return seen


def ai(monkeypatch, answer):
    async def fake(**kw):
        return answer
    monkeypatch.setattr(llm_gateway, "extract_structured", fake)


def test_the_searches_use_the_postcode_first_and_the_name_as_the_site_spells_it(web, monkeypatch):
    ai(monkeypatch, {"website_source": -1, "phones": [], "emails": []})
    run(H.find_company(None, name=NAME, place="North Hertfordshire SG4 0QY", facts=FACTS))
    assert web["queries"][0] == "Teddy Bears Pre-School SG4 0QY"
    assert any("TeddyBearsPreSchool" in q for q in web["queries"]) and len(web["queries"]) <= 4


def test_the_model_pick_is_kept_when_the_sources_back_it(web, monkeypatch):
    ai(monkeypatch, {"website_source": 0, "phones": [{"number": "01462 123456", "source": 0}], "emails": [{"address": "hello@teddybears-preschool.co.uk", "source": 0}]})
    out = run(H.find_company(None, name=NAME, place="Hitchin", facts=FACTS))
    assert out["found"] and out["via"] == "ai"
    assert out["website"] == "https://www.teddybears-preschool.co.uk"
    assert out["phones"] == ["01462 123456"] and out["emails"] == ["hello@teddybears-preschool.co.uk"]


def test_a_phone_the_source_does_not_contain_is_dropped(web, monkeypatch):
    ai(monkeypatch, {"website_source": 0, "phones": [{"number": "01462 654321", "source": 0}], "emails": []})  # not on the page
    assert run(H.find_company(None, name=NAME, place="Hitchin", facts=FACTS))["phones"] == []


def test_a_number_from_a_page_about_another_business_is_dropped(web, monkeypatch):
    ai(monkeypatch, {"website_source": -1, "phones": [{"number": "0113 496 0123", "source": 2}], "emails": []})  # a nursery in Leeds
    assert run(H.find_company(None, name=NAME, place="Hitchin", facts=FACTS))["phones"] == []


def test_a_directory_is_never_taken_as_the_website_but_its_number_can_stand(web, monkeypatch):
    ai(monkeypatch, {"website_source": 1, "phones": [{"number": "01462 999111", "source": 1}], "emails": []})
    out = run(H.find_company(None, name=NAME, place="Hitchin", facts=FACTS))
    assert out["website"] == ""                    # yell.com is a listing, not the company's own site
    assert out["phones"] == ["01462 999111"]       # but it does name this business and carries its number


def test_an_email_must_sit_on_the_companys_own_domain(web, monkeypatch):
    ai(monkeypatch, {"website_source": 0, "phones": [], "emails": [{"address": "someone@gmail.com", "source": 0}, {"address": "hello@teddybears-preschool.co.uk", "source": 0}]})
    assert run(H.find_company(None, name=NAME, place="Hitchin", facts=FACTS))["emails"] == ["hello@teddybears-preschool.co.uk"]


def test_a_source_number_the_model_invents_cannot_get_through(web, monkeypatch):
    ai(monkeypatch, {"website_source": 99, "phones": [{"number": "01462 123456", "source": 99}], "emails": []})
    out = run(H.find_company(None, name=NAME, place="Hitchin", facts=FACTS))
    assert not out["found"]


def test_without_an_ai_answer_plain_rules_find_the_site_and_still_check(web, monkeypatch):
    ai(monkeypatch, None)
    out = run(H.find_company(None, name=NAME, place="Hitchin", facts=FACTS))
    assert out["via"] == "rules" and out["website"] == "https://www.teddybears-preschool.co.uk" and "01462 123456" in out["phones"]


def test_the_model_is_given_what_the_register_holds_and_no_person_names(web, monkeypatch):
    seen = {}

    async def fake(**kw):
        seen["prompt"] = kw["user_text"]
        return {"website_source": -1, "phones": [], "emails": []}

    monkeypatch.setattr(llm_gateway, "extract_structured", fake)
    run(H.find_company(None, name=NAME, place="Hitchin", facts={**FACTS, "officers": ["Jane Smith"], "notes": "my private note"}))
    assert "SG4 0QY" in seen["prompt"] and "Child day-care" in seen["prompt"] and "0123" in seen["prompt"]
    assert "Jane Smith" not in seen["prompt"] and "private note" not in seen["prompt"]


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
