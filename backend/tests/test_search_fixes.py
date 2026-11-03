"""The Leads finder fixes from the 3 Nov test report: words, postcodes, wildcards, ages, contact filters."""
import pytest
from sqlalchemy.dialects import postgresql

from app.services import business_records as BR
from app.services import search_synonyms as SYN


def sql(filters) -> str:
    conds = BR._filter_conditions(BR.normalize_filters(filters))
    text = " AND ".join(str(c.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})) for c in conds)
    return text.replace("%%", "%").replace("\\\\", "\\")  # undo the literal-rendering escapes


def test_accountancy_accounting_and_accountants_mean_the_same_thing():
    a, _ = SYN.expand("accountancy")
    b, sics = SYN.expand("Accounting")
    assert set(a) >= {"accounting", "accountants", "bookkeeping"} and set(b) >= {"accountancy"} and sics == ["69201", "69202", "69203"]
    assert SYN.expand("plumbing")[1] == ["43220"] and SYN.expand("zzqxvkw") == (["zzqxvkw"], [])


def test_keyword_search_also_matches_the_groups_sic_codes():
    q = sql({"keyword": ["accountancy"]})
    assert "69201" in q and "69203" in q and "accounting" in q.lower()


def test_short_words_match_whole_words_in_names_and_trade_text():
    q = sql({"keyword": ["tax"]})
    assert r"~* '\mtax\M'" in q  # "Stax" and "Mr Taxi" no longer match
    assert r"sic_text ~* '\mtax\M'" in q  # the trade text is whole-word too: "Taxi operation" is not "tax"


def test_longer_words_keep_the_contains_match():
    assert "ILIKE '%accountancy%'" in sql({"keyword": ["accountancy"]})


def test_postcode_ls1_is_the_ls1_district_only():
    q = sql({"postcode_prefixes": ["ls1"]})
    assert "postcode = 'LS1'" in q and "LIKE 'LS1 %'" in q and "LIKE 'LS1%'" not in q


def test_a_prefix_ending_in_a_letter_or_with_a_space_is_read_as_typed():
    assert "LIKE 'LS%'" in sql({"postcode_prefixes": ["LS"]})
    assert "LIKE 'LS1 4%'" in sql({"postcode_prefixes": ["LS1 4"]})


@pytest.mark.parametrize("bad", ["%", "*", "a", "_%"])
def test_wildcards_and_one_letter_searches_are_refused_at_once(bad):
    with pytest.raises(ValueError, match="at least two"):
        BR.check_filters({"keyword": [bad]})


def test_ages_are_checked():
    with pytest.raises(ValueError, match="negative"):
        BR.check_filters({"min_age_years": -5})
    with pytest.raises(ValueError, match="above the oldest"):
        BR.check_filters({"min_age_years": 10, "max_age_years": 2})
    BR.check_filters({"min_age_years": 2, "max_age_years": 10, "keyword": ["tax"]})


def test_the_assistant_never_breaks_on_junk_terms():
    assert "keyword" not in BR.normalize_filters({"keyword": ["%", "*"]})


def test_each_contact_filter_reads_its_own_column():
    for key, col in (("has_website", "website"), ("has_email", "email"), ("has_phone", "phone")):
        q = sql({key: True})
        assert f"business_records.{col}" in q, key
        for other in {"website", "email", "phone"} - {col}:
            assert f"business_records.{other}," not in q


@pytest.mark.db
async def test_the_report_cases_against_a_real_database(db):
    from app.models.models import BusinessRecord

    def rec(i, name, pc="LS1 4AB", sic="|99999", status="Active"):
        return BusinessRecord(id=f"br{i}", identity_hash=f"h{i}", name=name, status=status, postcode=pc, sic_codes=sic, sic_text="", industry="", region="Leeds", website="", email="", phone="")

    db.add_all([rec(1, "Stax Ltd"), rec(2, "Mr Taxi"), rec(3, "Leeds Tax Advisers"), rec(4, "Smith Accountancy Ltd", sic="|69201"),
                rec(5, "Jones & Co", sic="|69202"), rec(6, "North Books", pc="LS14 2XY"), rec(7, "East Books", pc="LS10 1AA"), rec(8, "Exact Books", pc="LS1")])
    await db.commit()

    async def names(filters):
        out = await BR.search_filtered(db, filters, limit=50, stats=False)
        return sorted(r.name for r in out["rows"])

    assert await names({"keyword": ["tax"]}) == ["Jones & Co", "Leeds Tax Advisers", "Smith Accountancy Ltd"]  # no Stax, no Mr Taxi
    assert await names({"keyword": ["accountancy"]}) == await names({"keyword": ["accounting"]})  # the same intent, the same answer
    got = await names({"keyword": ["accountancy"]})
    assert "Smith Accountancy Ltd" in got and "Jones & Co" in got
    ls1 = await names({"postcode_prefixes": ["LS1"]})
    assert "North Books" not in ls1 and "East Books" not in ls1 and "Exact Books" in ls1


def test_a_directory_page_saved_as_the_website_does_not_count_as_having_one():
    q = sql({"has_website": True})
    assert "food.gov.uk" in q and "NOT" in q and "yell.com" in q


def test_a_directory_page_is_never_stored_as_a_websites():
    assert BR.own_site("https://ratings.food.gov.uk/business/12") == "" and BR.own_site("https://www.facebook.com/acme") == ""
    assert BR.own_site("https://acme.co.uk") == "https://acme.co.uk" and BR.own_site("") == ""


def test_the_sector_box_gets_synonyms_and_whole_words_too():
    q = sql({"sector": ["accounting", "bookkeeping", "tax"], "postcode_prefixes": ["RG2"]})
    assert "69201" in q and r"sic_text ~* '\mtax\M'" in q and "sic_text ILIKE '%tax%'" not in q
    assert r"industry ~* '\mtax\M'" in q


def test_a_typo_of_a_trade_still_means_the_trade():
    assert SYN.expand("accoutants")[1] == ["69201", "69202", "69203"] and SYN.expand("acountant")[1] == ["69201", "69202", "69203"]
    assert SYN.expand("taxi") == (["taxi"], []) and SYN.expand("plumers")[1] == ["43220"]


def test_not_keyword_is_whole_word_too():
    assert r"~* '\mtax\M'" in sql({"keyword": ["plumber"], "not_keyword": ["tax"]})


@pytest.mark.db
async def test_the_accountants_in_rg2_request_returns_accountants_only(db):
    from app.models.models import BusinessRecord

    def rec(i, name, sic_text, sic, pc="RG2 7AA"):
        return BusinessRecord(id=f"rg{i}", identity_hash=f"rh{i}", name=name, status="Active", postcode=pc, sic_codes=sic, sic_text=sic_text, industry="", region="Reading", website="", email="", phone="")

    db.add_all([rec(1, "Reading Taxi Corporation", "49320 - Taxi operation", "|49320|"), rec(2, "RG2 Driver Services", "49320 - Taxi operation", "|49320|"),
                rec(3, "Smith & Co Accountants", "69201 - Accounting and auditing activities", "|69201|"), rec(4, "Oak Tax Advisers", "69203 - Tax consultancy", "|69203|"),
                rec(5, "Elsewhere Accountants", "69201 - Accounting and auditing activities", "|69201|", pc="SW1 1AA")])
    await db.commit()

    async def names(filters):
        return sorted(r.name for r in (await BR.search_filtered(db, filters, limit=50, stats=False))["rows"])

    want = ["Oak Tax Advisers", "Smith & Co Accountants"]
    assert await names({"sector": ["accounting", "bookkeeping", "tax"], "postcode_prefixes": ["RG2"]}) == want
    assert await names({"keyword": ["accountants"], "postcode_prefixes": ["RG2"]}) == want
    assert await names({"keyword": ["accoutants"], "postcode_prefixes": ["RG2"]}) == want  # the user's typo
    assert await names({"keyword": ["tax"], "postcode_prefixes": ["RG2"]}) == want  # and no taxi firms for "tax"


@pytest.mark.db
async def test_the_assistant_lists_the_number_asked_for_and_never_drops_the_trade(db):
    from types import SimpleNamespace

    from app.api import lead_assistant as LA
    from app.models.models import BusinessRecord

    db.add_all([BusinessRecord(id=f"as{i}", identity_hash=f"ah{i}", name=f"Firm {i} Accountants", status="Active", postcode="RG2 7AA", sic_codes="|69201|",
                               sic_text="69201 - Accounting and auditing activities", industry="", region="Reading", website="", email="", phone="") for i in range(30)]
               + [BusinessRecord(id="as_taxi", identity_hash="ah_taxi", name="Reading Taxi Corporation", status="Active", postcode="RG2 7AB", sic_codes="|49320|",
                                 sic_text="49320 - Taxi operation", industry="", region="Reading", website="", email="", phone="")])
    await db.commit()
    res = await LA._run_search(db, {"sector": ["accoutants"], "postcode_prefixes": ["RG2"], "limit": 20})
    assert res["total"] == 30 and len(res["top"]) == 20 and res["asked"] == 20  # 20 listed of 30, no taxi firm
    assert all("Taxi" not in c["name"] for c in res["top"])
    assert len((await LA._run_search(db, {"sector": ["accounting"], "postcode_prefixes": ["RG2"]}))["top"]) == LA.TOP  # no number asked: a short preview

    turn = LA._Turn(SimpleNamespace(web_search=False, filters=None), [])
    await LA._tool_search(db, turn, {"sector": ["accounting"], "postcode_prefixes": ["RG2"], "limit": 5})
    first = turn.found
    await LA._tool_search(db, turn, {"postcode_prefixes": ["RG2"]})  # a second round that lost the trade
    assert turn.found is first and any("left out the trade" in n for n in turn.notes)


def test_the_company_search_route_refuses_wildcards_and_negative_ages_before_they_are_tidied_away():
    from fastapi import HTTPException

    from app.api.lead_accounts import _refuse_bad_filters

    for bad in ({"keyword": ["%"]}, {"keyword": ["*"]}, {"min_age_years": -5, "keyword": ["accountancy"]}, {"min_age_years": 10, "max_age_years": 2}):
        with pytest.raises(HTTPException) as err:
            _refuse_bad_filters(bad)
        assert err.value.status_code == 422
    _refuse_bad_filters({"keyword": ["accountancy"], "towns": ["Leeds"]})


def test_schools_and_community_places_are_left_out_unless_asked_for():
    q = sql({"keyword": ["dentist"], "towns": ["Manchester"]})
    assert "registration_number" in q and "school" in q and "community" in q
    assert "school" not in sql({"keyword": ["dentist"], "include_non_business": True})  # the toggle includes them
    assert "school" not in sql({"keyword": ["nursery"]})  # searching for one means wanting them


def test_a_slip_in_a_town_is_offered_the_right_town():
    from app.services import search_towns as ST

    assert ST.suggest(["Leds"]) == {"Leds": "Leeds"} and ST.suggest(["Mancester"]) == {"Mancester": "Manchester"}
    assert ST.suggest(["Leeds"]) == {} and ST.suggest(["Zzzzz"]) == {}


@pytest.mark.db
async def test_main_activity_first_no_community_centres_and_honest_labels(db):
    from app.models.models import BusinessRecord
    from app.services import lead_filters

    def rec(i, name, industry, sic, sic_text, regno=""):
        return BusinessRecord(id=f"mo{i}", identity_hash=f"mh{i}", name=name, registration_number=regno, status="Active", postcode="RG2 7AA", sic_codes=sic, sic_text=sic_text,
                              industry=industry, region="READING", website="", email="", phone="", confidence_tier="verified_registry", rank_score=50 if i == 1 else 10)

    db.add_all([rec(1, "Used Cars Ltd", "Sale of used cars", "|45112|69201|", "45112 - Sale of used cars | 69201 - Accounting", regno="01234567"),
                rec(2, "Smith Accountants Ltd", "Accounting", "|69201|", "69201 - Accounting and auditing activities", regno="07654321"),
                rec(3, "Wythenshawe Forum", "Community services - Healthcare", "|99999|", "dentist services"),
                rec(4, "Reading Dental Practice", "Dentist", "|86230|", "86230 - Dental practice activities")])
    await db.commit()
    first = [r.name for r in (await BR.search_filtered(db, {"keyword": ["accountants"]}, limit=5, stats=False, sort="newest"))["rows"]]
    best = (await BR.search_filtered(db, {"keyword": ["accountants"]}, limit=5, stats=False, sort="best"))["rows"]
    assert first == ["Smith Accountants Ltd", "Used Cars Ltd"]  # newest-first (the live fallback while ranking is not built) puts the main trade first too
    assert [r.name for r in best] == ["Smith Accountants Ltd", "Used Cars Ltd"]  # main activity ahead of a side activity, though the side one ranks higher
    assert "Wythenshawe Forum" not in [r.name for r in (await BR.search_filtered(db, {"keyword": ["dentist"]}, limit=5, stats=False))["rows"]]
    assert "Wythenshawe Forum" in [r.name for r in (await BR.search_filtered(db, {"keyword": ["dentist"], "include_non_business": True}, limit=5, stats=False))["rows"]]
    cards = {r.name: lead_filters.card(r) for r in (await BR.search_filtered(db, {"include_non_business": True}, limit=10, stats=False))["rows"]}
    assert cards["Reading Dental Practice"]["tier"] == "premises_listing" and cards["Smith Accountants Ltd"]["tier"] == "verified_registry"
    assert cards["Smith Accountants Ltd"]["region"] == "Reading"
