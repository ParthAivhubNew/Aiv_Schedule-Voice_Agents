"""AI Lead Scout's web discovery: one business per result, only its own website, readable text."""
import pytest
from bs4 import BeautifulSoup

from app.services import enrichment_service as E


def test_visible_text_keeps_the_spaces_around_highlighted_words():
    el = BeautifulSoup("<td>Oakwood <b>Dental Practice</b>is a <b>dental</b> clinic in Leeds , UK .</td>", "html.parser").td
    assert E._visible_text(el) == "Oakwood Dental Practice is a dental clinic in Leeds, UK."
    assert E._visible_text(None) == ""


@pytest.mark.parametrize("title, listing", [
    ("Dental Practices in Leeds", True),
    ("Dentists in Leeds", True),
    ("Dentists in Leeds — 153 practices near you", True),
    ("Top 10 dentists in Leeds", True),
    ("Best dental practices near me", True),
    ("Oakwood Dental Practice", False),
    ("Accountants near Leeds", True),
    ("Leeds Smile Centre", False),
    ("Mohammed Shabir Email & Phone Number", True),
    ("Headrow Dental", False),
])
def test_pages_listing_many_businesses_are_told_apart_from_one_business(title, listing):
    assert E._is_listing_title(title, "dental practices in leeds") is listing


@pytest.mark.parametrize("title, url, name", [
    ("Contact Us | Meliora Dental", "https://melioradental.co.uk/contact", "Meliora Dental"),
    ("Contact Us", "https://melioradental.co.uk/contact", "Melioradental"),
    ("Church View Dental Care Overview, Address & Contact", "https://prospeo.io/c/church-view", "Church View Dental Care"),
    ("Oakwood Dental Practice - Email Format", "https://contactout.com/company/oakwood", "Oakwood Dental Practice"),
    ("Home", "https://contactout.com/company/x", ""),
])
def test_the_company_name_skips_page_names_and_directory_add_ons(title, url, name):
    assert E._company_name_from_title(title, url) == name


def test_search_keys_are_the_words_that_name_the_business_or_place():
    assert E._search_keys("Accountants in Birmingham") == ["accou", "birmi"]
    assert E._search_keys('"Meliora Dental" Leeds email OR contact OR phone') == ["melio", "denta", "leeds"]
    assert E._search_keys("site:www.melioradental.co.uk contact email phone") == ["melio"]
    assert E._search_keys("contact phone email") == []


def test_results_that_mention_nothing_searched_for_are_dropped():
    decoys = [  # what Bing gave a script for "Accountants in Birmingham"
        {"title": "Wikipedia, die freie Enzyklopädie", "snippet": "", "url": "https://www.wikipedia.de"},
        {"title": "Ray-Ban Meta Wayfarer", "snippet": "AI glasses", "url": "https://www.ray-ban.com/germany"},
    ]
    real = {"title": "Smith & Co Chartered Accountants", "snippet": "Accountancy practice in Edgbaston", "url": "https://smithco.co.uk/"}
    assert E._on_topic(decoys + [real], "Accountants in Birmingham") == [real]
    assert E._on_topic(decoys, "contact phone email") == decoys  # nothing specific searched: nothing to judge by


async def test_an_engine_with_only_off_topic_results_hands_over_to_the_next(monkeypatch):
    async def decoys(query, max_results=5):
        return [{"title": "Natural language processing", "snippet": "", "url": "https://www.ibm.com/nlp"}]

    async def real(query, max_results=5):
        return [{"title": "Leeds Smile Centre", "snippet": "Dentist in Leeds", "url": "https://leedssmile.co.uk/"}]

    monkeypatch.setattr(E, "search_tavily", decoys)
    monkeypatch.setattr(E, "search_duckduckgo_lite", real)
    assert [r["title"] for r in await E.search_open_web("dentists in Leeds")] == ["Leeds Smile Centre"]


async def test_discovery_searches_the_users_words_and_skips_encyclopedias(monkeypatch):
    asked = []

    async def fake_search(query, max_results=5):
        asked.append(query)
        return [
            {"title": "Birmingham - Wikipedia", "snippet": "Birmingham is a city", "url": ""},
            {"title": "Smith & Co Accountants | Birmingham", "snippet": "Accountants in Birmingham", "url": "https://smithco.co.uk/"},
        ]

    monkeypatch.setattr(E, "search_open_web", fake_search)
    found = await E.discover_new_target_accounts("Accountants in Birmingham")
    assert [f["name"] for f in found] == ["Smith & Co Accountants"]
    await E.discover_new_target_accounts("Accountants in Birmingham", target_role="practice manager")
    assert asked == ["Accountants in Birmingham", "Accountants in Birmingham practice manager"]
    assert not E._usable_website("https://de.wikipedia.org/wiki/Birmingham") and not E._usable_website("https://www.wikipedia.de")


@pytest.mark.parametrize("title, url, name", [  # SearXNG's answers for "Accountants in Birmingham"
    ("Birmingham | Chartered Accountants - Bishop Fleming", "https://www.bishopfleming.co.uk/contact/birmingham", "Bishop Fleming"),
    ("Accountants in Birmingham - Menzies LLP", "https://www.menzies.co.uk/office/birmingham/", "Menzies LLP"),
    ("Your local accountants in Birmingham - Azets", "https://www.azets.com/en-uk/offices/birmingham", "Azets"),
    ("Ark & Co Ltd: Accountants in Birmingham", "https://www.arkandco.uk/", "Ark & Co Ltd"),
    ("Contact Us | M A Edwards Accountants Ltd", "https://www.maedwards.co.uk/contact/", "M A Edwards Accountants Ltd"),
    ("Kassouf – CPAs and Advisors", "https://ww3.kassouf.com/", "Kassouf"),
    ("Accountants in Birmingham | Free Consultation", "https://www.gondalaccountancy.co.uk/", ""),  # a name nowhere in it
    ("Accountants Near Me in Birmingham | Yell Marketplace", "https://www.yell.com/s/accountants-birmingham.html", ""),
    ("Accountants in Birmingham | HealthGPS", "https://www.healthgps.co.uk/birmingham", ""),  # the directory's name
])
def test_the_name_is_the_part_of_the_title_that_matches_the_website(title, url, name):
    assert E._company_name_from_title(title, url, "Accountants in Birmingham") == name


@pytest.mark.parametrize("title, url, name", [  # SearXNG's answers for "plumbers in Manchester"
    ("Plumbers in Manchester - Able Group", "https://www.able-group.co.uk/plumbing/manchester/", "Able Group"),
    ("Find 53+ Trusted Plumbers in Manchester - Checkatrade", "https://www.checkatrade.com/Search/Plumber/in/Manchester", ""),
    ("Find the most trusted local Plumbers in Manchester | TrustATrader", "https://www.trustatrader.com/plumbers-in-manchester", ""),
    ("Approved Plumbers in Manchester - WaterSafe Register", "https://www.watersafe.org.uk/locations/manchester/", ""),
    ("Affordable Manchester Plumbers from £26/hr - HaMuch.com", "https://www.hamuch.com/plumber/near/manchester", ""),
    ("JB7 Plumbing and Heating Limited - Checkatrade", "https://www.checkatrade.com/trades/jb7", "JB7 Plumbing and Heating Limited"),
])
def test_trade_directories_give_no_name_unless_the_page_is_about_one_business(title, url, name):
    assert E._company_name_from_title(title, url, "plumbers in Manchester") == name


def test_a_count_of_the_trade_or_a_property_portal_is_not_a_business():
    assert E._company_name_from_title("121 Solicitors serving Bristol - Solicitors.com", "https://www.solicitors.com/bristol", "solicitors in Bristol") == ""
    assert E._company_name_from_title("Estate agents in Glasgow - Rightmove", "https://www.rightmove.co.uk/estate-agents/Glasgow.html", "estate agents in Glasgow") == ""
    assert E._company_name_from_title("Reeds Solicitors - Bristol", "https://www.reeds.co.uk/bristol", "solicitors in Bristol") == "Reeds Solicitors"


@pytest.mark.parametrize("title, url, name", [
    ("Welcome to Wards", "https://www.wards.uk.com/", "Wards"),
    ("Welcome to Watkins Solicitors in Bristol, Bath and Somerset", "https://watkinssolicitors.co.uk/", "Watkins Solicitors"),
    ("M A Edwards Accountants Ltd", "https://www.maedwards.co.uk/", "M A Edwards Accountants Ltd"),  # short enough to keep whole
    ("Companies House - GOV.UK", "https://find-and-update.company-information.service.gov.uk/search", ""),
])
def test_greetings_long_taglines_and_register_names_are_trimmed(title, url, name):
    assert E._company_name_from_title(title, url, "solicitors in Bristol") == name


async def test_one_company_found_on_two_of_its_pages_is_offered_once(monkeypatch):
    async def fake_search(query, max_results=5):
        return [
            {"title": "The Green Group | Logistics", "snippet": "", "url": "https://thegreen-group.com/"},
            {"title": "Contact - The Green Group", "snippet": "", "url": "https://thegreen-group.com/contact"},
        ]

    monkeypatch.setattr(E, "search_open_web", fake_search)
    assert [f["name"] for f in await E.discover_new_target_accounts("logistics companies in Leicester")] == ["The Green Group"]


def test_the_name_can_come_from_the_words_that_spell_the_website():
    assert E._company_name_from_title("Dentist Leeds City Centre | Dental Clinic - Private & Cosmetic", "https://www.leedsdentalclinic.co.uk/",
                                      "dental practices in Leeds", "Leeds Dental Clinic offers quality dental care in Leeds city centre.") == "Leeds Dental Clinic"
    assert E._company_name_from_title("Accountants in Birmingham | Free Consultation", "https://www.gondalaccountancy.co.uk/",
                                      "Accountants in Birmingham", "Gondal Accountancy: chartered accountants.") == "Gondal Accountancy"


async def test_discovery_keeps_firms_whose_titles_start_with_the_search(monkeypatch):
    async def fake_search(query, max_results=5):
        return [
            {"title": "Accountants in Birmingham - Menzies LLP", "snippet": "", "url": "https://www.menzies.co.uk/office/birmingham/"},
            {"title": "29 Best Accountants in Birmingham for 2026 | AccountantsUp", "snippet": "", "url": "https://www.accountantsup.co.uk/birmingham"},
            {"title": 'Search results for "birmingham/1000" - Find A Chartered Accountant', "snippet": "", "url": "https://find.icaew.com/search"},
        ]

    monkeypatch.setattr(E, "search_open_web", fake_search)
    found = await E.discover_new_target_accounts("Accountants in Birmingham")
    assert [(f["name"], f["site"]) for f in found] == [("Menzies LLP", "https://menzies.co.uk")]


async def test_discovery_drops_listings_and_never_takes_a_directory_for_the_website(monkeypatch):
    async def fake_search(query, max_results=5):
        return [
            {"title": "Dental Practices in Leeds", "snippet": "Find dental practices", "url": "https://www.healthgps.co.uk/leeds"},
            {"title": "Dentists in Leeds — 153 practices near you", "snippet": "All 153", "url": "https://nearbydentist.co.uk/leeds"},
            {"title": "Oakwood Dental Practice - Email Format", "snippet": "Oakwood Dental Practice is a dental company in Leeds",
             "url": "https://contactout.com/company/oakwood-dental"},
            {"title": "Headrow Dental | Leeds dentist", "snippet": "Friendly dental practice in Leeds city centre",
             "url": "https://www.headrowdental.co.uk/"},
        ]

    monkeypatch.setattr(E, "search_open_web", fake_search)
    found = await E.discover_new_target_accounts("dental practices in Leeds")
    assert [f["name"] for f in found] == ["Oakwood Dental Practice", "Headrow Dental"]
    oakwood, headrow = found
    assert oakwood["site"] == "" and oakwood["sourceUrl"].startswith("https://contactout.com")  # broker page kept as the source only
    assert "headrowdental.co.uk" in headrow["site"]
    assert all(f["sector"] == "" and f["region"] == "" and f["openingHook"] == "" for f in found)  # nothing guessed


@pytest.mark.parametrize("name, title, url, snippet, noise", [
    ("Craneww", "Freight forwarding in Leicester", "https://craneww.com/uk", "Logistics services", True),  # name only guessed from the address
    ("Leicester Freight Association", "Leicester Freight Association - members", "https://lfa.org.uk", "", True),
    ("Smith & Co", "Smith & Co Accountants", "https://smithco.co.uk/", "", False),
    ("Melioradental", "Meliora Dental | Leeds", "https://melioradental.co.uk/", "", False),
])
def test_noise_filter_drops_trade_bodies_and_guessed_names(name, title, url, snippet, noise):
    assert E._is_noise_result(name, title, url, snippet) is noise
