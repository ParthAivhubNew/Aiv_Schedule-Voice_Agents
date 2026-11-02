"""The pure parts of: opening registry-held contacts, picking between candidates, and LinkedIn matching. No database needed."""
from types import SimpleNamespace

from app.services import contact_choices as CH
from app.services import linkedin_lookup as LI
from app.services import reveals as RV


def test_registry_contacts_are_hidden_until_opened_and_the_copy_is_masked():
    card = {"id": "b1", "website": "https://acme.co.uk", "phone": "0113 496 0000", "email": ""}
    shown = RV.mask_card(card, {("b1", "website")})
    assert shown["website"] == "https://acme.co.uk"
    assert shown["phone"] == "" and shown["closed"] == {"phone": True}
    assert shown["held"] == {"website": True, "phone": True}  # nothing held for email
    assert card["phone"] == "0113 496 0000"  # the shared (cached) card is never changed


def test_options_only_when_there_is_no_winner_and_over_the_floor():
    cands = [
        {"field": "website", "value": "https://a.com", "score": 62, "rejected": "", "sources": [0]},
        {"field": "website", "value": "https://b.com", "score": 40, "rejected": "", "sources": [1]},
        {"field": "website", "value": "https://c.com", "score": 10, "rejected": "", "sources": [1]},
        {"field": "website", "value": "https://d.com", "score": 90, "rejected": "a directory", "sources": [0]},
    ]
    sources = [{"url": "https://a.com/x"}, {"url": "https://b.com/y"}]
    got = CH.options_from(cands, sources, None)
    assert [o["value"] for o in got] == ["https://a.com", "https://b.com"]
    assert got[0]["label"] == "Likely" and got[1]["label"] == "Possible"
    assert CH.options_from(cands, sources, cands[0]) == []


def _row(value, orgs):
    return SimpleNamespace(value=value, orgs=orgs)


def test_a_value_enough_organisations_picked_is_trusted_and_shown_first():
    rows = [_row("https://a.com", ["o1", "o2", "o3"]), _row("https://b.com", ["o1"])]
    assert CH.trusted(rows) == "https://a.com"
    assert CH.trusted([_row("https://a.com", ["o1", "o2"])]) is None
    opts = [{"value": "https://b.com", "score": 80}, {"value": "https://a.com", "score": 50}]
    assert [o["value"] for o in CH.annotate(opts, rows)] == ["https://a.com", "https://b.com"]


def test_linkedin_addresses_are_cleaned_and_only_profile_pages_count():
    assert LI.clean_url("https://uk.linkedin.com/company/acme-ltd/?trk=x") == "https://www.linkedin.com/company/acme-ltd"
    assert LI.clean_url("https://www.linkedin.com/in/ann-lee-123/") == "https://www.linkedin.com/in/ann-lee-123"
    assert LI.clean_url("https://www.linkedin.com/jobs/view/1") == ""
    assert LI.clean_url("https://example.com/company/acme") == ""


def test_linkedin_company_page_needs_the_name_and_a_clear_lead():
    rows = [
        {"url": "https://www.linkedin.com/company/bright-cafe", "title": "Bright Cafe | LinkedIn", "snippet": "Coffee in Leeds LS1 4AB"},
        {"url": "https://www.linkedin.com/company/bright-bakery", "title": "Bright Bakery | LinkedIn", "snippet": "Bread"},
        {"url": "https://www.linkedin.com/in/someone", "title": "Someone", "snippet": ""},
    ]
    cands = LI._rank(rows, "company", lambda r: LI.score_company(r, "BRIGHT CAFE LIMITED", "LS1 4AB", "leeds"))
    assert [c["value"] for c in cands] == ["https://www.linkedin.com/company/bright-cafe", "https://www.linkedin.com/company/bright-bakery"]
    assert LI.decide(cands)["value"].endswith("bright-cafe")
    close = [dict(c, score=60) for c in cands]
    assert LI.decide(close) is None  # two near-equal pages: ask the person
    assert len(LI.to_options(close)) == 2


def test_linkedin_person_needs_both_names_and_the_company():
    good = {"url": "https://www.linkedin.com/in/ann-lee", "title": "Ann Lee - Director - Bright Cafe | LinkedIn", "snippet": ""}
    other = {"url": "https://www.linkedin.com/in/ann-lee-9", "title": "Ann Lee - Nurse - Elsewhere | LinkedIn", "snippet": ""}
    assert LI.score_person(good, "Ann", "Lee", "BRIGHT CAFE LIMITED", "") > LI.score_person(other, "Ann", "Lee", "BRIGHT CAFE LIMITED", "")
    assert LI.score_person(good, "", "Lee", "BRIGHT CAFE LIMITED", "") == 0


def test_a_saved_lookup_is_reused_for_90_days_found_and_7_days_missed():
    from datetime import datetime, timedelta

    now = datetime(2026, 11, 20)
    day = lambda n: (now - timedelta(days=n)).isoformat() + "Z"
    assert LI.fresh({"url": "u", "at": day(80)}, now)
    assert not LI.fresh({"url": "u", "at": day(100)}, now)
    assert LI.fresh({"url": "", "at": day(5)}, now)
    assert not LI.fresh({"url": "", "at": day(8)}, now)


def test_each_organisation_that_confirms_a_value_adds_points_up_to_a_cap():
    rows = [_row("https://a.com", ["o1", "o2"]), _row("https://b.com", ["o1", "o2", "o3", "o4", "o5", "o6"]), _row("https://c.com", [])]
    assert CH.boost_of(rows) == {"https://a.com": 50, "https://b.com": 100}


def test_a_confirmed_website_gets_a_higher_lookup_score(monkeypatch):
    from tests.test_company_lookup import FACTS, NAME, OWN, TEDDY_SITE, YELL, _web, run
    from app.services import web_harness as H

    page = {OWN: ("Teddybears Pre-School", "Welcome to Teddybears Pre-School, Hitchin SG4 0QY. Call 01462 123456")}
    _web(monkeypatch, {"Official website": [TEDDY_SITE, YELL]}, pages=page)
    base = run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS))
    _web(monkeypatch, {"Official website": [TEDDY_SITE, YELL]}, pages=page)
    boosted = run(H.find_company(None, name=NAME, place=FACTS["region"], facts=FACTS, boosts={"website": {"https://teddybears-preschool.co.uk": 50}}))
    assert boosted["confidence"]["website"]["score"] == base["confidence"]["website"]["score"] + 50


def test_a_person_pick_is_a_real_change_of_the_stored_record():
    """The nested people entry must not be edited in place: the record would look unchanged and the pick would never be saved."""
    from types import SimpleNamespace

    biz = SimpleNamespace(raw_data={"linkedin": {"people": {"Ann Lee": {"url": "", "options": [{"value": "https://www.linkedin.com/in/ann", "title": "Ann Lee - Director", "note": "Leeds"}]}}}})
    before = biz.raw_data
    LI.chosen(biz, "Ann Lee", "https://www.linkedin.com/in/ann")
    assert biz.raw_data is not before and before["linkedin"]["people"]["Ann Lee"]["url"] == ""  # the old value is untouched, so the change is detected
    assert biz.raw_data["linkedin"]["people"]["Ann Lee"] == {**biz.raw_data["linkedin"]["people"]["Ann Lee"], "url": "https://www.linkedin.com/in/ann", "title": "Ann Lee - Director", "note": "Leeds"}


def test_facebook_and_x_addresses_must_be_pages_not_posts_or_share_links():
    from app.services import social_lookup as SL

    assert SL.clean_url("facebook", "https://m.facebook.com/brightcafeleeds/?ref=x") == "https://www.facebook.com/brightcafeleeds"
    assert SL.clean_url("facebook", "https://www.facebook.com/sharer/sharer.php?u=x") == ""
    assert SL.clean_url("facebook", "https://www.facebook.com/groups/12345") == ""
    assert SL.clean_url("x", "https://twitter.com/brightcafe/status/1") == "https://x.com/brightcafe"
    assert SL.clean_url("x", "https://x.com/intent/tweet") == "" and SL.clean_url("x", "https://x.com/i/flow/login") == ""
    assert SL.clean_url("x", "https://example.com/brightcafe") == ""


def test_social_pages_are_ranked_by_the_company_name_and_place():
    from app.services import social_lookup as SL

    rows = [{"url": "https://www.facebook.com/brightcafeleeds", "title": "Bright Cafe - Leeds | Facebook", "snippet": "Coffee in Leeds LS1 4AB"},
            {"url": "https://www.facebook.com/brightbakery", "title": "Bright Bakery | Facebook", "snippet": "Bread"},
            {"url": "https://www.facebook.com/groups/9", "title": "Bright Cafe fans", "snippet": ""}]
    cands = SL.rank(rows, "facebook", "BRIGHT CAFE LIMITED", "LS1 4AB", "leeds")
    assert [c["value"] for c in cands] == ["https://www.facebook.com/brightcafeleeds", "https://www.facebook.com/brightbakery"]
    assert cands[0]["score"] > cands[1]["score"]


def test_the_links_column_lists_every_page_we_hold_and_blanks_the_rest():
    from app.services import social_lookup as SL

    raw = {"linkedin": {"company": {"url": "https://www.linkedin.com/company/acme"}}, "socials": {"x": {"url": "https://x.com/acme"}, "facebook": {"url": ""}}}
    got = SL.links_of(raw)
    assert got["linkedin"] == "https://www.linkedin.com/company/acme" and got["x"] == "https://x.com/acme" and got["facebook"] == ""
    assert set(SL.links_of(None).values()) == {""}


def test_more_networks_accept_only_real_pages():
    from app.services import social_lookup as SL

    assert SL.clean_url("instagram", "https://www.instagram.com/greggsofficial/?hl=en") == "https://www.instagram.com/greggsofficial"
    assert SL.clean_url("instagram", "https://www.instagram.com/p/Cabc123/") == ""
    assert set(SL.links_of({})) == {"linkedin", *SL.NETWORKS}
