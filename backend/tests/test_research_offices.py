"""Research of a firm with several offices: the office that was searched for comes first, the others apart."""
import pytest

from app.services import enrichment_service as E


@pytest.mark.parametrize("phone, number, code", [
    ("0121 456 7890", "01214567890", "0121"),
    ("+44 (0)121 456 7890", "01214567890", "0121"),
    ("+44 1752 262611", "01752262611", "01752"),
    ("0044 20 7946 0000", "02079460000", "020"),
    ("0333 321 9000", "03333219000", ""),  # a national number: no town
])
def test_a_number_is_read_as_dialled_in_the_uk_and_gives_its_town_code(phone, number, code):
    assert E._uk_number(phone) == number
    assert E._dialling_code(phone) == code


def test_the_place_and_office_addresses_are_matched_to_towns():
    assert E._code_for_place("Birmingham") == "0121"
    assert E._code_for_place("Kings Norton, Birmingham B30") == "0121"
    assert E._code_for_place("Milton Keynes") == "01908"
    assert E._code_for_place("Springfield") == ""
    assert E._town_in_email("exeter@bishopfleming.co.uk") == "exeter"
    assert E._town_in_email("office.leeds@firm.co.uk") == "leeds"
    assert E._town_in_email("rachel.lugg@bishopfleming.co.uk") == ""


# What Research found for Bishop Fleming (searched for in Birmingham) on 2026-10-04.
PHONES = ["01752 262611", "01905 732144", "0333 321 9000", "0121 285 1700"]
EMAILS = ["jobs@bishopfleming.co.uk", "exeter@bishopfleming.co.uk", "birmingham@bishopfleming.co.uk"]


def test_another_towns_numbers_and_addresses_are_other_offices():
    phones, emails, others = E._split_by_office(PHONES, EMAILS, "Birmingham", [], [])
    assert phones == ["0121 285 1700", "0333 321 9000"]  # the town's number first, then the national one
    assert emails == ["birmingham@bishopfleming.co.uk", "jobs@bishopfleming.co.uk"]
    assert others == [{"town": "Plymouth", "phone": "01752 262611"}, {"town": "Worcester", "phone": "01905 732144"},
                      {"town": "Exeter", "email": "exeter@bishopfleming.co.uk"}]


def test_without_a_town_the_office_page_number_decides_and_nothing_is_split_without_either():
    phones, _, others = E._split_by_office(PHONES, EMAILS, "", ["0121 285 1700"], [])
    assert phones[0] == "0121 285 1700" and {o.get("town") for o in others} == {"Plymouth", "Worcester", "Exeter"}
    assert E._split_by_office(PHONES, EMAILS, "", [], []) == (PHONES, [EMAILS[1], EMAILS[2], EMAILS[0]], [])  # jobs@ last


def test_a_general_address_comes_before_peoples_and_jobs_comes_last():
    _, emails, _ = E._split_by_office([], ["jobs@firm.co.uk", "cbrooks@firm.co.uk", "info@firm.co.uk"], "", [], [])
    assert emails == ["info@firm.co.uk", "cbrooks@firm.co.uk", "jobs@firm.co.uk"]


async def test_research_reads_the_office_page_first(monkeypatch):
    read = []

    async def fake_crawl(url, **kwargs):
        read.append(url)
        return {"phones": ["01752 262611", "01905 732144"], "emails": ["exeter@bishopfleming.co.uk"], "socials": {}, "description": ""}

    async def fake_page(url):
        read.append(url)
        return {"phones": ["0121 285 1700"], "emails": ["birmingham@bishopfleming.co.uk"], "description": "Contact our Birmingham team."}

    async def no_search(query, max_results=5):
        return []

    monkeypatch.setattr(E, "crawl_homepage_contacts", fake_crawl)
    monkeypatch.setattr(E, "_page_contacts", fake_page)
    monkeypatch.setattr(E, "search_open_web", no_search)
    d = await E.enrich_prospect_intelligence("Bishop Fleming", company="Bishop Fleming", domain="bishopfleming.co.uk",
                                             place="Birmingham", page_url="https://www.bishopfleming.co.uk/contact/birmingham", deep=False)
    assert read == ["https://bishopfleming.co.uk", "https://www.bishopfleming.co.uk/contact/birmingham"]
    assert d["primaryPhone"] == "0121 285 1700" and d["primaryEmail"] == "birmingham@bishopfleming.co.uk"
    assert [o["town"] for o in d["otherOffices"]] == ["Plymouth", "Worcester", "Exeter"]
    assert d["overview"] == "Contact our Birmingham team."

    # a page on another site (a directory) is not read as the firm's office page
    read.clear()
    await E.enrich_prospect_intelligence("Bishop Fleming", company="Bishop Fleming", domain="bishopfleming.co.uk",
                                         page_url="https://www.yell.com/biz/bishop-fleming", deep=False)
    assert read == ["https://bishopfleming.co.uk"]
