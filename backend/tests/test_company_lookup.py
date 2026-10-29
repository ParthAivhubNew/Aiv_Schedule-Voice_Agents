"""The company web lookup: the query recipe, the guardrail, and the scenarios from the plan. No database, no network: the search and the
page reads are stood in for."""
import asyncio
from datetime import datetime, timedelta

import pytest

from app.models.models import BusinessRecord
from app.services import company_contacts as CC
from app.services import enrichment_service as ES
from app.services import guardrail as G
from app.services import lead_filters
from app.services import search_recipe as R
from app.services import web_harness as H

NAME = "Teddy Bears Pre-School"
FACTS = {"name": NAME, "region": "North Hertfordshire SG4 0QY", "postcode": "SG4 0QY", "industry": "Child day-care activities", "status": "active"}
OWN = "https://www.teddybears-preschool.co.uk/"


def run(coro):
    return asyncio.run(coro)


# ── the recipe ───────────────────────────────────────────────────────────────────────────────────────
def test_the_query_follows_the_one_template_with_no_postcode_quotes_or_operators():
    steps = R.plan(FACTS)
    assert steps[0]["query"] == "Official website of Teddy Bears Pre-School, child day-care in North Hertfordshire"
    assert steps[1]["query"].startswith("Phone number of Teddy Bears Pre-School")
    for s in steps:
        assert "SG4" not in s["query"] and '"' not in s["query"] and "site:" not in s["query"] and len(s["query"]) < 400


def test_empty_slots_are_left_out_and_a_vague_industry_says_nothing():
    q = R.build_query("website", {"name": "Brew House Ltd", "region": "Leeds LS1", "industry": "Other food service activities n.e.c."})
    assert q == "Official website of Brew House in Leeds"
    assert R.build_query("phone", {"name": "Brew House"}) == "Phone number of Brew House"
    assert R.what_it_does("Caring Premises") == "" and R.what_it_does("56102 - Unlicensed restaurants and cafes") == "unlicensed restaurants and cafes"


def test_a_name_written_differently_gets_one_retry_and_a_trading_name_another():
    queries = [(s["retry"], s["query"]) for s in R.plan({**FACTS, "trading_as": "Little Teds Nursery"})]
    assert (True, "Official website of TeddyBears Pre-School, child day-care in North Hertfordshire") in queries
    assert any(r and "Little Teds Nursery" in q for r, q in queries) and len(queries) <= R.MAX_SEARCHES


def test_the_fixed_settings_are_basic_depth_five_results_uk_and_directories_excluded():
    assert R.SETTINGS["search_depth"] == "basic" and R.SETTINGS["max_results"] == 5 and R.SETTINGS["country"] == "united kingdom"
    assert "yell.com" in R.EXCLUDE_DOMAINS and "facebook.com" in R.EXCLUDE_DOMAINS


# ── the guardrail's parts ────────────────────────────────────────────────────────────────────────────
def test_one_domain_is_one_candidate_and_one_number_is_one_candidate():
    assert G.registered_domain("https://www.x.co.uk/a") == G.registered_domain("http://x.co.uk") == "x.co.uk"
    assert G.registered_domain("https://shop.x.com/p") == "x.com"
    assert set(G.numbers_in("Call +44 1462 123456 or 01462 123456")) == {"1462123456"}


def test_the_domain_name_rule_accepts_a_shorter_domain_and_rejects_an_unrelated_one():
    assert G.domain_matches_name("teddybears-preschool.co.uk", NAME)
    assert G.domain_matches_name("teddybears.co.uk", NAME)           # the first word and half of the words
    assert not G.domain_matches_name("preschool.co.uk", NAME)        # no first word
    assert not G.domain_matches_name("acmeplumbing.co.uk", NAME)


def _state(pages, facts=FACTS, own=()):
    src = G.prepare_sources(pages, facts)
    wc = G.website_candidates(src, facts)
    G.score(wc, src, facts, [])
    pc, ec = G.phone_candidates(src), G.email_candidates(src, list(own))
    G.score(pc, src, facts, list(own))
    G.score(ec, src, facts, list(own))
    return src, wc, pc, ec


def test_email_rules_off_domain_and_personal_looking_addresses_are_rejected():
    pages = [{"url": OWN, "title": "Teddybears Pre-School", "text": "Email hello@teddybears-preschool.co.uk, jane.smith@teddybears-preschool.co.uk or teddybears@gmail.com", "score": 0.9}]
    _, _, _, ec = _state(pages, own=["teddybears-preschool.co.uk"])
    by = {c["value"]: c["rejected"] for c in ec}
    assert by["hello@teddybears-preschool.co.uk"] == ""
    assert "personal" in by["jane.smith@teddybears-preschool.co.uk"] and "own domain" in by["teddybears@gmail.com"]


def test_a_page_about_another_place_is_rejected_but_a_branch_page_that_shows_our_town_is_not():
    other = [{"url": "https://teddybears-preschool.co.uk/leeds", "title": "Teddy Bears Pre-School Leeds", "text": "Visit us in Leeds LS1 4AB. 0113 496 0123", "score": 0.9}]
    _, wc, pc, _ = _state(other)
    assert wc[0]["rejected"] and pc[0]["rejected"]
    branch = [{"url": "https://teddybears-preschool.co.uk/", "title": "Teddybears Pre-School", "text": "Our branches: Leeds LS1 4AB and Hitchin SG4 0QY. 01462 123456", "score": 0.9}]
    _, wc, pc, _ = _state(branch)
    assert not wc[0]["rejected"] and not pc[0]["rejected"]


def test_the_margin_applies_between_different_candidates_only_and_the_threshold_to_the_best():
    a = {"field": "phone", "rejected": "", "score": 90, "key": "a"}
    b = {"field": "phone", "rejected": "", "score": 80, "key": "b"}
    assert G.decide([a, b], 70, 15)[0] is None and "too close" in G.decide([a, b], 70, 15)[1]
    assert G.decide([a, {**b, "score": 70}], 70, 15)[0] is a
    assert G.decide([a], 95, 15)[0] is None and G.decide([], 70, 15)[1] == "no usable candidate"
    assert G.decide([{**a, "rejected": "x"}], 70, 15)[0] is None


def test_the_scale_is_110_and_scores_are_not_capped():
    assert sum(v for v in G.POINTS.values() if v > 0) == G.SCALE_MAX == 110


# ── the whole lookup, one scenario at a time ─────────────────────────────────────────────────────────
def _web(monkeypatch, answers, pages=None, dead=(), blocked=()):
    """answers: {query text contains: [results]}. pages: {url: (title, text)} for the company's own site."""
    log = {"queries": [], "include": [], "depth": []}

    async def search_web(query, *, max_results=5, include_domains=None, exclude_domains=None, must_mention=None, depth="basic", meter=None):
        log["queries"].append(query)
        log["include"].append(include_domains)
        log["depth"].append(depth)
        if meter is not None:
            meter["searches"] = meter.get("searches", 0) + 1
            meter["tavily_credits"] = meter.get("tavily_credits", 0) + (2 if depth == "advanced" else 1)
        for key, rows in answers.items():
            if key in query:
                return [dict(r) for r in rows]
        return []

    async def read_page(url):
        read_page.dead = False
        if any(d in url for d in dead):
            read_page.dead = not any(b in url for b in blocked)
            return None
        return {k.rstrip("/"): v for k, v in (pages or {}).items()}.get(url.rstrip("/"))

    monkeypatch.setattr(ES, "search_web", search_web)
    monkeypatch.setattr(H, "_read_page", read_page)
    return log


TEDDY_SITE = {"url": OWN, "title": "Teddybears Pre-School | Hitchin", "snippet": "Welcome to Teddybears Pre-School in Hitchin SG4 0QY. Call 01462 123456", "score": 0.93}
YELL = {"url": "https://www.yell.com/biz/teddybears-hitchin", "title": "Teddybears Pre-School - Yell", "snippet": "Hitchin SG4 0QY phone 01462 123456", "score": 0.6}


def test_scenario_a_a_clear_match_shows_one_website_phone_and_email_with_reasons(monkeypatch):
    _web(monkeypatch, {"Official website": [TEDDY_SITE, YELL]},
         pages={OWN: ("Teddybears Pre-School", "Welcome to Teddybears Pre-School, Hitchin SG4 0QY. Call 01462 123456 or email hello@teddybears-preschool.co.uk")})
    out = run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS))
    assert out["found"] and out["website"] == "https://www.teddybears-preschool.co.uk"
    assert out["phones"] == ["01462 123456"] and out["emails"] == ["hello@teddybears-preschool.co.uk"]
    # one domain's evidence is "good" (own site, place, name in the title, relevance = 74); a phone a second source repeats is "high" (94)
    assert out["confidence"]["website"] == {"score": 74, "label": "good"}
    assert out["confidence"]["phone"]["label"] == "high" and out["confidence"]["phone"]["score"] >= G.HIGH
    assert out["ledger"]["outcome"] == "found" and out["ledger"]["searches"] <= R.MAX_SEARCHES and out["audit"]


def test_scenario_b_the_run_together_spelling_is_tried_when_the_first_search_finds_nothing(monkeypatch):
    log = _web(monkeypatch, {"TeddyBears Pre-School": [TEDDY_SITE]}, pages={OWN: ("Teddybears Pre-School", "Hitchin SG4 0QY. 01462 123456")})
    out = run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS))
    assert out["website"] == "https://www.teddybears-preschool.co.uk"
    assert any("TeddyBears Pre-School" in q for q in log["queries"])


def test_scenario_c_a_phone_only_a_directory_has_is_not_shown(monkeypatch):
    _web(monkeypatch, {"Official website": [YELL], "Phone number": [YELL]})
    out = run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS))
    assert out["phones"] == [] and not out["found"]
    assert any(a["field"] == "phone" and "directory_only" in a["points"] for a in out["audit"])


def test_scenario_d_two_phones_the_companys_own_site_wins_and_the_other_is_dropped(monkeypatch):
    yell = {**YELL, "snippet": "Hitchin SG4 0QY phone 01462 999111"}
    _web(monkeypatch, {"Official website": [TEDDY_SITE, yell]}, pages={OWN: ("Teddybears Pre-School", "Hitchin SG4 0QY. Call 01462 123456")})
    out = run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS))
    assert out["phones"] == ["01462 123456"]
    lost = [a for a in out["audit"] if a["field"] == "phone" and a["value"] == "01462 999111"][0]
    assert "disagree" in lost["points"]


def test_scenario_e_a_common_name_in_another_town_shows_nothing(monkeypatch):
    other = {"url": "https://www.besweetbakery.co.uk/", "title": "Be Sweet Bakery Leeds", "snippet": "Cakes in Leeds LS1 4AB. 0113 496 0123", "score": 0.9}
    _web(monkeypatch, {"Official website": [other], "Phone number": [other]}, pages={other["url"]: ("Be Sweet Bakery", "Leeds LS1 4AB. 0113 496 0123")})
    facts = {"name": "Be Sweet", "region": "Hinckley and Bosworth LE10 1DA", "postcode": "LE10 1DA", "industry": "Takeaway/sandwich shop", "status": "active"}
    out = run(H.find_company(None, name="Be Sweet", place=facts["region"], facts=facts))
    assert not out["found"] and out["website"] == "" and out["phones"] == []


def test_scenario_f_no_web_presence_finds_nothing_and_says_the_searches_returned_nothing(monkeypatch):
    log = _web(monkeypatch, {})
    out = run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS))
    assert not out["found"] and out["ledger"]["outcome"] == "no_web_search"
    assert out["ledger"]["searches"] <= R.MAX_SEARCHES and "advanced" in log["depth"]   # the one advanced retry was spent, and only one
    assert log["depth"].count("advanced") == 1


def test_scenario_g_a_closed_company_is_not_searched_at_all(monkeypatch):
    log = _web(monkeypatch, {"Official website": [TEDDY_SITE]})
    out = run(H.find_company(None, name=NAME, place=FACTS["region"], facts={**FACTS, "status": "dissolved"}))
    assert not out["found"] and out["ledger"]["outcome"] == "closed" and log["queries"] == [] and "dissolved" in out["reason"]


def test_a_dead_site_is_rejected_even_when_it_looks_right(monkeypatch):
    _web(monkeypatch, {"Official website": [TEDDY_SITE]}, dead=("teddybears-preschool",))
    out = run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS))
    assert out["website"] == "" and any("dead site" in a["rejected"] for a in out["audit"])


def test_find_website_searches_only_for_the_website_and_find_phone_only_for_the_phone(monkeypatch):
    log = _web(monkeypatch, {"Official website": [TEDDY_SITE]})
    run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS, want="website"))
    assert log["queries"] and all(q.startswith("Official website") for q in log["queries"])
    log = _web(monkeypatch, {"Phone number": [TEDDY_SITE]})
    run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS, want="phone"))
    assert log["queries"] and all(q.startswith("Phone number") or q.startswith("Contact page") for q in log["queries"])


def test_the_kind_of_organisation_does_not_stop_a_name_matching():
    assert G.mentions("WINCHESTER CHAMBER MUSIC FESTIVAL TRUST", "Winchester Chamber Music Festival | Home")
    assert G.domain_matches_name("winchesterchambermusic.com", "WINCHESTER CHAMBER MUSIC FESTIVAL TRUST")
    assert not G.mentions("WINCHESTER CHAMBER MUSIC FESTIVAL TRUST", "Winchester Cathedral Choir")


def test_a_school_hosted_by_its_council_keeps_its_own_label():
    assert G.registered_domain("https://www.fawkham.kent.sch.uk/contact") == "fawkham.kent.sch.uk"
    assert G.registered_domain("https://stmarys.sch.uk") == "stmarys.sch.uk"


def test_a_phone_written_with_a_bracket_is_tidied():
    assert list(G.numbers_in("Call (01756) 753782 today").values()) == ["01756 753782"]


def test_a_site_that_only_blocks_our_reader_is_not_called_dead(monkeypatch):
    _web(monkeypatch, {"Official website": [TEDDY_SITE]}, dead=("teddybears-preschool",), blocked=("teddybears-preschool",))
    out = run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS))
    assert out["website"] == "https://www.teddybears-preschool.co.uk" and not any("dead site" in a["rejected"] for a in out["audit"])


def test_a_found_website_with_no_phone_triggers_the_contact_search_limited_to_that_domain(monkeypatch):
    site = {**TEDDY_SITE, "snippet": "Welcome to Teddybears Pre-School in Hitchin SG4 0QY"}
    log = _web(monkeypatch, {"Official website": [site], "Phone number": []}, pages={OWN: ("Teddybears Pre-School", "Welcome. Hitchin SG4 0QY")})
    run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS))
    assert ["teddybears-preschool.co.uk"] in log["include"]


def test_the_search_cap_is_never_exceeded(monkeypatch):
    log = _web(monkeypatch, {})
    out = run(H.find_company(None, name=NAME, place=FACTS["region"], facts={**FACTS, "trading_as": "Little Teds Nursery"}))
    assert len(log["queries"]) <= R.MAX_SEARCHES and out["ledger"]["searches"] <= R.MAX_SEARCHES


# ── saving, the cache, and what is shown ─────────────────────────────────────────────────────────────
class _Db:
    async def flush(self):
        return None


def _biz(cached=None, status="active"):
    return BusinessRecord(id="b1", identity_hash="h1", name=NAME, region=FACTS["region"], postcode="SG4 0QY", status=status, sic_text="Child day-care activities",
                          raw_data={"contacts_web": cached} if cached else {}, sources=[], rank_score=0)


def _harness(monkeypatch, result):
    calls = []

    async def find(db, **kw):
        calls.append(kw)
        return result

    monkeypatch.setattr(H, "find_company", find)
    return calls


FOUND = {"website": "https://www.teddybears-preschool.co.uk", "phones": ["01462 123456"], "emails": [], "sources": [OWN], "found": True,
         "confidence": {"website": {"score": 90, "label": "high"}}, "audit": [{"field": "website"}], "ledger": {"outcome": "found", "searches": 3}, "reason": ""}
NOTHING = {"website": "", "phones": [], "emails": [], "sources": [], "found": False, "confidence": {}, "audit": [], "ledger": {"outcome": "not_found"}, "reason": "x"}


def _stamp(days):
    return (datetime.utcnow() - timedelta(days=days)).isoformat() + "Z"


def test_a_lookup_is_saved_with_the_guardrail_mark_and_one_value_per_field(monkeypatch):
    _harness(monkeypatch, FOUND)
    biz = _biz()
    out = run(CC.web_contacts(_Db(), biz))
    saved = biz.raw_data["contacts_web"]
    assert out["found"] and not out["cached"] and saved["guardrail"] and saved["phones"] == ["01462 123456"] and saved["audit"]


def test_a_fresh_checked_lookup_is_reused_for_90_days_then_searched_again(monkeypatch):
    calls = _harness(monkeypatch, FOUND)
    fresh = {"website": "https://x.co.uk", "phones": [], "emails": [], "guardrail": True, "fetched_at": _stamp(30)}
    assert run(CC.web_contacts(_Db(), _biz(fresh)))["cached"] and calls == []
    stale = {**fresh, "fetched_at": _stamp(100)}
    assert not run(CC.web_contacts(_Db(), _biz(stale)))["cached"] and len(calls) == 1


def test_a_lookup_from_before_the_guardrail_is_stale_at_once_and_its_unchecked_phone_is_retired(monkeypatch):
    calls = _harness(monkeypatch, NOTHING)
    legacy = {"website": "https://www.teddybears-preschool.co.uk", "phones": ["07582 016 125"], "emails": ["x@gmail.com"], "found": True, "fetched_at": _stamp(5)}
    biz = _biz(legacy)
    assert lead_filters.card(biz)["web_phone"] == ""                       # not shown: nobody checked it
    out = run(CC.web_contacts(_Db(), biz))
    assert len(calls) == 1 and not out["cached"]
    saved = biz.raw_data["contacts_web"]
    assert saved["guardrail"] and saved["phones"] == [] and saved["emails"] == [] and saved["website"] == "https://www.teddybears-preschool.co.uk"


def test_a_checked_phone_is_shown_and_a_refresh_keeps_what_an_earlier_checked_lookup_found(monkeypatch):
    prior = {"website": "https://a.co.uk", "phones": ["01462 123456"], "emails": [], "guardrail": True, "fetched_at": _stamp(100)}
    _harness(monkeypatch, {**NOTHING, "website": "https://www.teddybears-preschool.co.uk", "found": True})
    biz = _biz(prior)
    assert lead_filters.card(biz)["web_phone"] == "01462 123456"
    out = run(CC.web_contacts(_Db(), biz, refresh=True))
    assert out["website"] == "https://www.teddybears-preschool.co.uk" and out["phones"] == ["01462 123456"]


def test_the_audit_is_dropped_after_12_months_and_a_closed_company_is_reported_not_saved(monkeypatch):
    old = {"website": "https://x.co.uk", "phones": [], "emails": [], "guardrail": True, "audit": [{"a": 1}], "fetched_at": _stamp(400)}
    biz = _biz(old)
    _harness(monkeypatch, FOUND)
    run(CC.web_contacts(_Db(), biz))                                        # stale (400 days): searched again, so the old audit is replaced
    assert biz.raw_data["contacts_web"]["audit"] == [{"field": "website"}]
    closed = {**NOTHING, "ledger": {"outcome": "closed"}, "reason": "the register shows this company as dissolved"}
    _harness(monkeypatch, closed)
    biz2 = _biz()
    out = run(CC.web_contacts(_Db(), biz2))
    assert out["closed"] and not out["found"] and "contacts_web" not in biz2.raw_data
