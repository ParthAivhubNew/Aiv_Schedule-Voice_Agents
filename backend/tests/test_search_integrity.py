"""Search integrity that needs no database: the closest-match steps, officer clean-up, the People role match and the order of a trade search."""
import asyncio

from sqlalchemy.dialects import postgresql

from app.services import business_records as BR
from app.services import company_contacts as CC


def _closest(filters, found_when):
    seen = []

    async def run(f):
        seen.append(f)
        return {"rows": [1], "total": 1} if found_when(f) else {"rows": [], "total": 0}

    return asyncio.run(BR.closest_match(filters, run)), seen


def test_a_misspelt_town_is_corrected_before_any_filter_is_given_up():
    (out, dropped), seen = _closest({"towns": ["Leds"], "keyword": ["cafe"], "size_bands": ["micro"]}, lambda f: f.get("towns") == ["Leeds"])
    assert out and dropped == ["the town spelling (Leds read as Leeds)"]
    assert seen[-1]["size_bands"] == ["micro"]  # nothing else was dropped


def test_filters_are_dropped_least_important_first_and_the_trade_is_never_dropped():
    (out, dropped), seen = _closest({"keyword": ["cafe"], "towns": ["Leeds"], "has_email": True, "size_bands": ["micro"]},
                                    lambda f: "size_bands" not in f and "has_email" not in f)
    assert out and dropped == ["must-have email, phone and website", "company size and type"]
    (none, _), seen = _closest({"keyword": ["cafe"], "has_email": True}, lambda f: False)
    assert none is None and all(f.get("keyword") == ["cafe"] for f in seen)


def test_a_max_age_of_zero_is_a_filter_that_can_be_given_up():
    (out, dropped), _ = _closest({"keyword": ["cafe"], "max_age_years": 0}, lambda f: "max_age_years" not in f)
    assert out and dropped == ["company age"]


def test_a_long_name_falls_back_to_its_first_whole_word_only():
    (out, dropped), seen = _closest({"towns": ["Leeds"], "name_contains": "Acme Plumbing Ltd"}, lambda f: f.get("name_contains") == "Acme")
    assert out and seen[-1]["name_whole_word"] is True
    assert dropped == ["the words after the first in the company name"]
    (none, _), _ = _closest({"name_contains": "Acme"}, lambda f: False)  # one word already: nothing shorter, and no run on the whole register
    assert none is None


def test_nothing_left_to_search_on_is_an_empty_answer_not_the_whole_register():
    (out, dropped), seen = _closest({"towns": ["Leeds"], "has_email": True}, lambda f: not f.get("towns"))
    assert out is None and dropped == [] and not any(not f.get("towns") for f in seen)


def test_companies_acting_as_officers_are_not_people_and_a_double_role_is_one_person():
    people = CC.active_officers([
        {"name": "XYZ SECRETARIES LIMITED", "role": "corporate-secretary"},
        {"name": "SMITH, Anna Jane", "role": "director"},
        {"name": "SMITH, Anna Jane", "role": "secretary"},
        {"name": "KHAN, Omar", "role": "director", "resigned_on": "2020-01-01"},
    ])
    assert [p["name"] for p in people] == ["SMITH, Anna Jane"] and people[0]["role"] == "Director, Secretary"


def test_officers_are_read_again_after_ninety_days():
    from datetime import datetime, timedelta

    class Row:
        officers = [{"name": "A B", "role": "director", "v": CC.PEOPLE_V}]
        people_checked_at = datetime.utcnow() - timedelta(days=10)

    assert CC.people_stale(Row) is False
    Row.people_checked_at = datetime.utcnow() - timedelta(days=120)
    assert CC.people_stale(Row) is True


def test_a_trade_search_puts_the_fullest_tier_first_then_the_main_trade():
    cols = [str(c.compile(dialect=postgresql.dialect())) for c in BR._order("best", {"keyword": ["cafe"]})]
    assert cols[0].startswith("floor(") and "rank_score" in cols[0]


def test_saved_only_counts_as_a_narrowing_filter_so_the_opening_sector_is_not_added():
    assert BR.with_default_browse({"saved": "only"}) == ({"saved": "only"}, False)
