from types import SimpleNamespace

import pytest

from app.api.lead_assistant import last_shown, save_proposal
from app.services import enrichment_service as ES
from app.services.company_profile import best_named
from app.services.lead_filters import website_note


@pytest.mark.parametrize("name", ["First Last", "Your Name", "John Doe", "Ie Support", "Speaking Invitations", "Sales Team",
                                  "Office Manager", "Manager", "Jane", "CONTACT US", "JOHN SMITH", "Jane Smith 2", "Jane Smith!",
                                  "Mary Ann Jane Kate Smith", "Customer Services", "info@acme.co.uk", "J. K."])
def test_text_that_is_not_a_person_is_not_a_name(name):
    assert not ES.looks_like_person_name(name)


@pytest.mark.parametrize("name", ["Jane Smith", "Anne-Marie O'Neill", "José Álvarez", "J. Smith", "Mary J. Blige", "Ludwig van Beethoven",
                                  "Siobhán Ní Bhriain", "D'Arcy Moore"])
def test_real_names_are_kept(name):
    assert ES.looks_like_person_name(name)


def test_the_older_name_check_rejects_labels_too():
    assert not ES._is_person_name("Speaking Invitations") and not ES._is_person_name("First Last")
    assert ES._is_person_name("Ellis Blackham")


async def test_team_read_from_a_page_keeps_only_people(monkeypatch):
    from app.services import llm_gateway

    async def fake(**_):
        return {"team": [{"name": "First Last"}, {"name": "Ie Support", "phone": "0113 550 0123"},
                         {"name": "Jane Smith", "title": "Director", "phone": "844) 744-3512"},
                         {"name": "Tom O'Brien", "phone": "0113 550 0123"}]}

    monkeypatch.setattr(llm_gateway, "extract_structured", fake)
    team = await ES._extract_team("page text")
    assert [t["name"] for t in team] == ["Jane Smith", "Tom O'Brien"]
    assert team[0]["phone"] == "" and team[1]["phone"] == "0113 550 0123"


@pytest.mark.parametrize("raw", ["844) 744-3512", "(844 744-3512", "285164681", "01234567", "2024-2025", "02 1234 5678",
                                 "1234 567 8901 234", "+1 044 744 3512", "07700 90012"])
def test_a_cut_off_or_impossible_number_is_dropped(raw):
    assert not ES._is_real_phone(raw)


@pytest.mark.parametrize("raw", ["(844) 744-3512", "+1 (844) 744-3512", "0113 550 0123", "+44 113 550 0123", "(01756) 753782",
                                 "07700 912345", "0800 123 456", "+33 1 23 45 67 89", "1384 221 642", "+353 1 234 5678"])
def test_real_numbers_are_kept(raw):
    assert ES._is_real_phone(raw)


def test_a_number_in_brackets_keeps_its_brackets_from_a_snippet():
    _, phones = ES._harvest_contacts_from_text("Call us on (844) 744-3512 or ref 285164681.")
    assert phones == ["(844) 744-3512"]


def _biz(name, status, rank=0):
    return SimpleNamespace(name=name, status=status, rank_score=rank)


def test_a_trading_company_wins_over_a_dissolved_one_with_the_typed_name():
    old = _biz("SCREWFIX LIMITED", "Dissolved", 50)
    live = _biz("SCREWFIX DIRECT LIMITED", "Active", 10)
    assert best_named([old, live], "Screwfix") is live
    assert best_named([_biz("SCREWFIX LIMITED", "Active"), live], "Screwfix").name == "SCREWFIX LIMITED"


def test_a_dissolved_company_is_still_found_when_it_is_the_only_one_or_the_only_close_one():
    old = _biz("ACME WIDGETS LIMITED", "Dissolved")
    assert best_named([old], "Acme Widgets") is old
    assert best_named([old, _biz("BEST ACME WIDGETS LTD", "Active")], "Acme Widgets") is old
    assert best_named([], "x") is None


def test_save_uses_the_search_last_shown_not_an_older_list():
    london = {"total": 500, "asked": 0, "filters": {"sector": ["software"], "towns": ["London"]}, "top": [{"id": "L1", "name": "London Soft"}]}
    manchester = {"sector": ["plumbers"], "towns": ["Manchester"]}
    assert last_shown(manchester, None, london) is None
    p = save_proposal("p0", "Manchester Plumbers", manchester, last_shown(manchester, None, london), 1)
    assert "companies" not in p["params"] and p["params"]["filters"] == manchester and p["params"]["how_many"] == 1
    assert last_shown(london["filters"], None, london) is london
    found = {"total": 3, "filters": manchester, "top": [{"id": "M1", "name": "Mancs Plumbing"}]}
    assert last_shown(manchester, found, london) is found


def test_has_website_explains_why_so_few():
    assert website_note({"has_website": True}, 1) == ("Only 1 company in this list has a website on file. The register itself does not hold "
                                                      "websites; use Find website on a company to look one up.")
    assert website_note({"has_website": True}, 0).startswith("No company in this list has a website")
    assert website_note({"has_website": True}, 40).startswith("Only 40 companies in this list have")
    assert website_note({"has_website": True}, 5000) == "" and website_note({}, 1) == ""
