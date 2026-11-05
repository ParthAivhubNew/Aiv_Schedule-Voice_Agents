"""Phase 1 of the search-stack plan: never another business's data, never a booking page as a website, suggestions are free."""
import asyncio

from app.services import enrichment_service as ES
from app.services import listing_pages as LP
from app.services import site_check


def run(coro):
    return asyncio.run(coro)


def _place(name, address, website="", phone=""):
    return {"displayName": {"text": name}, "formattedAddress": address, "websiteUri": website, "internationalPhoneNumber": phone}


def test_places_first_guess_is_not_used_when_no_name_matches():
    places = [_place("Flowtec Engineering (UK) Limited", "Doncaster DN1 1AA", "https://flowtec.uk/")]
    assert ES._best_place(places, "FLOWTEK AI LTD", "IG7 6AB") == {}


def test_places_still_picks_the_same_name_at_the_same_postcode():
    places = [_place("Other Cafe", "Leeds LS1 1AA"), _place("Hartsprays Ltd", "Salisbury SP2 8PU", "https://www.hartsprays.co.uk")]
    assert ES._best_place(places, "HARTSPRAYS LTD.", "SP2 8PU")["displayName"]["text"] == "Hartsprays Ltd"


def test_deeper_search_asks_apollo_when_google_has_another_business(monkeypatch):
    asked = []

    async def places(query, *, name="", postcode=""):
        return None  # no same-name business at Google

    async def apollo(name, *, postcode="", domain=""):
        asked.append(name)
        return {"name": name, "website": "https://www.example-co.uk", "phone": "", "postcode_match": True, "via": "apollo"}

    monkeypatch.setattr(ES, "search_google_places", places)
    monkeypatch.setattr(ES, "search_apollo", apollo)
    got = run(ES.search_deeper("Example Co Leeds", name="Example Co Ltd", postcode="LS1 1AA", want="website"))
    assert asked and got["website"] == "https://www.example-co.uk"


def test_a_google_answer_at_another_postcode_gives_way_to_a_same_postcode_apollo_answer(monkeypatch):
    async def places(query, *, name="", postcode=""):
        return {"name": "Example Co", "website": "https://other-town-site.co.uk", "phone": "", "postcode_match": False}

    async def apollo(name, *, postcode="", domain=""):
        return {"name": name, "website": "https://www.example-co.uk", "phone": "", "postcode_match": True, "via": "apollo"}

    monkeypatch.setattr(ES, "search_google_places", places)
    monkeypatch.setattr(ES, "search_apollo", apollo)
    assert run(ES.search_deeper("Example Co", name="Example Co Ltd", postcode="LS1 1AA", want="website"))["website"] == "https://www.example-co.uk"


def test_booking_platforms_are_listings_not_websites():
    for u in ("http://mhaychcuts.booksy.com/", "https://www.fresha.com/a/some-salon-123", "https://www.treatwell.co.uk/places/venue-1/"):
        assert site_check.is_listing_host(u, "Anything Ltd"), u
        assert LP.booking_label(u)
    assert not site_check.is_listing_host("https://www.hartsprays.co.uk", "Hartsprays Ltd")
    assert LP.booking_label("https://www.hartsprays.co.uk") == ""


def test_google_website_on_a_booking_platform_is_not_kept_as_the_website():
    from app.api.lead_accounts import _vouched

    place = {"postcode_match": True, "website": "http://mhaychcuts.booksy.com/", "phone": "07704 965949"}
    assert "website" not in _vouched(place, {})
    assert _vouched({"postcode_match": True, "website": "https://www.hartsprays.co.uk"}, {})["website"] == "https://www.hartsprays.co.uk"


def test_an_unconfirmed_social_listing_is_not_put_under_the_icon():
    class Biz:
        raw_data = {}
    b = Biz()
    LP.keep(b, {"url": "https://www.facebook.com/AcmePlumbing", "site": "Facebook", "kind": "social", "confirmed": False, "at": "2026-11-05T00:00:00Z"})
    assert b.raw_data["listing_page"]["url"] and "socials" not in b.raw_data
    LP.keep(b, {"url": "https://www.facebook.com/AcmePlumbing", "site": "Facebook", "kind": "social", "confirmed": True, "at": "2026-11-05T00:00:00Z"})
    assert b.raw_data["socials"]["facebook"]["url"] == "https://www.facebook.com/AcmePlumbing"


# ── social buttons: suggestions are free, a found page or a pick is charged once ────────────────────
class _Biz:
    id, name, region, postcode, raw_data = "b1", "Acme Plumbing Ltd", "Leeds", "LS1 4AB", {}


class _Db:
    def __init__(self, biz):
        self.biz = biz

    async def execute(self, *_a, **_k):
        biz = self.biz

        class R:
            def scalars(self):
                class S:
                    def first(self_inner):
                        return biz
                return S()
        return R()

    async def commit(self):
        return None


def _wire(monkeypatch, find_result):
    from app.api import lead_accounts as LA

    charges = []

    async def ok(db):
        return None

    async def charge(db, count, what, item="lead_lookup"):
        charges.append((what, item))

    async def nothing(*a, **k):
        return None

    async def mask(db, card):
        return card

    async def find(db, biz, network, **kw):
        return find_result

    monkeypatch.setattr(LA, "_can_research", ok)
    monkeypatch.setattr(LA, "_charge_leads", charge)
    monkeypatch.setattr(LA.CP, "sync_safely", nothing)
    monkeypatch.setattr(LA.RV, "mask_one", mask)
    monkeypatch.setattr(LA, "lead_filters_card", lambda biz: {})
    monkeypatch.setattr(LA.SL, "find", find)
    return LA, charges


def test_social_suggestions_alone_are_not_charged(monkeypatch):
    LA, charges = _wire(monkeypatch, {"url": "", "options": [{"value": "https://x.com/acme"}], "searched": True})
    out = run(LA.find_social("b1", LA.SocialIn(network="x"), _Db(_Biz())))
    assert out["found"] is False and out["options"] and out["charged"] == 0 and charges == []


def test_a_social_page_found_is_charged_once(monkeypatch):
    LA, charges = _wire(monkeypatch, {"url": "https://x.com/acme", "options": [], "searched": True})
    out = run(LA.find_social("b1", LA.SocialIn(network="x"), _Db(_Biz())))
    assert out["found"] is True and out["charged"] == 1 and [i for _w, i in charges] == ["lead_social"]  # the social price, not the 5-credit one


def test_picking_a_social_suggestion_is_charged_once(monkeypatch):
    LA, charges = _wire(monkeypatch, {})
    biz = _Biz()
    biz.raw_data = {"socials": {"x": {"url": "", "options": [{"value": "https://x.com/acme"}]}}}
    from app.services import contact_choices as CH

    async def record(db, biz_id, kind, value):
        return 1

    monkeypatch.setattr(CH, "record", record)
    out = run(LA.choose_contact("b1", LA.ChooseIn(kind="x", value="https://x.com/acme"), _Db(biz)))
    assert out["charged"] == 1 and [i for _w, i in charges] == ["lead_social"]


def test_a_social_page_has_its_own_fixed_price_below_a_website_phone_or_email():
    from app.services import credits as C
    assert C.DEFAULT_RATES["lead_social"]["credits"] == 2 and C.DEFAULT_RATES["lead_social"]["wallet"] == "leadgen" and C.DEFAULT_RATES["lead_social"]["charged"]
    assert C.DEFAULT_RATES["lead_lookup"]["credits"] == 5 and C.DEFAULT_RATES["google_deep_search"]["credits"] == 5


# ── never an empty box: the same address, other names, and links that are always there ────────────────
def test_number_words_and_digits_are_one_name():
    assert site_check.same_business("FIFTY THREE TWO", "53two")
    assert site_check.same_business("Twenty One Pilots Ltd", "21 Pilots")
    assert not site_check.same_business("Be Sweet", "Sweet Dreams Bakery")


def test_a_business_at_the_same_postcode_under_another_name_is_kept_but_flagged():
    places = [_place("Khedrubje Kadampa Buddhist Centre", "196 Coltman St, Hull HU3 2SQ", "http://www.meditateinhull.org.uk/", "+44 1482 324940")]
    got = ES._best_place(places, "DHARMARATNA BUDDHIST CENTRE", "HU3 2SQ")
    assert got["_name_match"] is False and got["displayName"]["text"] == "Khedrubje Kadampa Buddhist Centre"
    # another postcode and another name is the wrong company
    assert ES._best_place([_place("Khedrubje Kadampa Buddhist Centre", "Leeds LS1 1AA")], "DHARMARATNA BUDDHIST CENTRE", "HU3 2SQ") == {}


def test_another_name_is_confirmed_only_when_its_own_site_names_the_company_or_shows_its_number(monkeypatch):
    from app.services import web_harness as H

    place = {"website": "http://www.meditateinhull.org.uk/", "phone": "", "name_match": False}
    pages = {"text": "Meditation classes in Hull HU3 2SQ", "title": "Hull Meditation"}

    async def fetch(url, max_chars=0, **k):
        return pages["title"], pages["text"]

    monkeypatch.setattr(H, "fetch_text", fetch)
    # the postcode is on the page, but a shared address proves nothing: not confirmed
    assert run(H.confirm_place("DHARMARATNA BUDDHIST CENTRE", "HU3 2SQ", place, "01234567")) == {}
    pages["text"] = "Registered as Dharmaratna Buddhist Centre, charity. Hull HU3 2SQ"
    assert run(H.confirm_place("DHARMARATNA BUDDHIST CENTRE", "HU3 2SQ", place, "01234567"))["website"] == "http://www.meditateinhull.org.uk/"
    pages["text"] = "Company number 01234567, Hull"
    assert run(H.confirm_place("DHARMARATNA BUDDHIST CENTRE", "HU3 2SQ", place, "01234567"))["website"]


def test_a_postcode_vouch_needs_the_name_to_match():
    from app.api.lead_accounts import _vouched

    assert "website" not in _vouched({"postcode_match": True, "name_match": False, "website": "https://other-firm.co.uk"}, {})
    assert _vouched({"postcode_match": True, "name_match": True, "website": "https://hartsprays.co.uk"}, {})["website"] == "https://hartsprays.co.uk"


def test_every_field_always_has_links_to_look_at():
    from app.services import closest_links as CL

    class Biz:
        name, region, postcode, registration_number, raw_data = "Acme Plumbing Ltd", "Leeds", "LS1 4AB", "01234567", {}
    for kind in ("website", "phone", "email", "linkedin", "facebook", "x", "instagram"):
        links = CL.links_for(Biz(), kind)
        assert len(links) >= 3 and all(l["url"].startswith("https://") and l["label"] and l["note"] for l in links), kind
    urls = [l["url"] for l in CL.links_for(Biz(), "website")]
    assert "https://find-and-update.company-information.service.gov.uk/company/01234567" in urls
    assert any(u.startswith("https://www.google.com/maps/search/") for u in urls) and any(u.startswith("https://www.google.com/search?q=") for u in urls)

    class Bare(Biz):
        registration_number = ""
    assert len(CL.links_for(Bare(), "phone")) == 2  # no company number: still the Maps search and the web search


def test_a_google_listing_at_the_companys_address_becomes_a_labelled_suggestion(monkeypatch):
    from app.api import lead_accounts as LA
    from app.services import company_contacts as CC

    saved = {}

    async def remember(db, biz, options):
        saved.update(options)
        return options

    monkeypatch.setattr(CC, "_remember_options", remember)

    class Biz:
        id, raw_data = "b1", {"lookup_options": {"website": [{"value": "https://web-candidate.co.uk", "score": 43}]}}
    place = {"postcode_match": True, "name_match": False, "name": "Khedrubje Kadampa Buddhist Centre", "website": "http://www.meditateinhull.org.uk/x?utm=1", "place_id": "ChIJabc", "via": "google_places"}
    run(LA._suggest_place(None, Biz(), place, "website"))
    got = saved["website"]
    assert [o["value"] for o in got] == ["https://web-candidate.co.uk", "https://www.meditateinhull.org.uk"] or got[1]["value"].endswith("meditateinhull.org.uk")
    assert "at the company's address" in got[1]["label"] and got[1]["sources"] == ["https://www.google.com/maps/place/?q=place_id:ChIJabc"]
    saved.clear()
    run(LA._suggest_place(None, Biz(), {**place, "website": "http://mhaychcuts.booksy.com/"}, "website"))
    assert saved == {}  # a booking page is never a suggested website
    run(LA._suggest_place(None, Biz(), {**place, "postcode_match": False}, "website"))
    assert saved == {}  # another address is not offered


def test_previous_names_are_searched_and_accepted():
    from app.services import guardrail as G
    from app.services import search_recipe as R

    facts = {"name": "NEW BRAND LTD", "region": "Leeds", "postcode": "LS1 4AB", "industry": "", "previous_names": ["OLD TRADER LIMITED"]}
    queries = [s["query"] for s in R.plan(facts)]
    assert any("old trader" in q.lower() for q in queries)
    src = G.prepare_sources([{"url": "https://www.oldtrader.co.uk/about", "title": "Old Trader | Leeds", "text": "Leeds LS1 4AB", "score": 0.8}], {**facts, "area": "Leeds"})
    cands = G.website_candidates(src, facts)
    assert cands and not cands[0]["rejected"]  # not "a different business": the register says the company had that name
