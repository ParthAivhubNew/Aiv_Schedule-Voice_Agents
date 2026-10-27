"""Find Leads: filled-in and well-known companies first, Full/Partial/Basic counts, saved counts, exclude filters, people."""
import httpx
import pytest

from app.main import app
from app.services import business_records as BR
from tests.conftest import make_user

CAFE = "56102 - Unlicensed restaurants and cafes"


def test_rank_orders_by_filled_in_then_prominence():
    plc = BR.rank_score_of(filled=4, prominence=BR.prominence_points(size_band="medium_large", company_category="Public Limited Company", source_count=1, has_site=True))
    small = BR.rank_score_of(filled=4, prominence=BR.prominence_points(source_count=1, has_site=True))
    half = BR.rank_score_of(filled=2, prominence=99)
    bare = BR.rank_score_of(filled=0, prominence=5)
    assert plc > small > half > bare
    assert [BR.profile_of(x) for x in (plc, small, half, bare, None)] == ["full", "full", "partial", "basic", "basic"]


def test_plc_is_not_guessed_from_a_word_inside_another_word():
    assert BR.prominence_points(company_category="Private Limited Company") == 0
    assert BR.prominence_points(company_category="Public Limited Company") == 20
    assert BR.prominence_points(company_category="PLC") == 20


pytestmark_db = pytest.mark.db


def _row(number, name, born, category="Private Limited Company", accounts="MICRO ENTITY", **extra):
    return {"name": name, "registration_number": number, "sic_text": CAFE, "industry": CAFE.split(" | ")[0], "region": "LEEDS",
            "postcode": "LS1 4AP", "status": "Active", "incorporation_date": born, "accounts_category": accounts,
            "company_category": category, "raw": {"CompanyNumber": number}, **extra}


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def _seed(db):
    await BR.bulk_upsert(db, source_id="ds_ch", rows=[
        _row("001", "Tiny Cafe Ltd", "06/06/2024"),
        _row("002", "Big Cafe Group PLC", "01/01/1990", category="Public Limited Company", accounts="FULL",
             website="bigcafe.com", phone="0113 111", email="hi@bigcafe.com", description="Coffee chain"),
        _row("003", "Mid Cafe Ltd", "02/02/2015", accounts="SMALL", website="midcafe.co.uk", phone="0113 222", email="a@midcafe.co.uk", description="One cafe"),
        _row("004", "Half Cafe Ltd", "03/03/2020", website="halfcafe.co.uk", phone="0113 333"),
    ])
    await db.commit()


async def _search(c, **body):
    r = await c.post("/api/leads/search", json={"filters": {"towns": ["Leeds"], **body.pop("filters", {})}, **body})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.db
async def test_best_match_puts_full_profiles_and_big_names_first_and_counts_the_tiers(db):
    await _seed(db)
    _, token = await make_user(db, "fl", "Admin", org_id="org_acme")
    async with _client(token) as c:
        out = await _search(c)
        assert [x["name"] for x in out["companies"]] == ["Big Cafe Group PLC", "Mid Cafe Ltd", "Half Cafe Ltd", "Tiny Cafe Ltd"]
        assert [x["profile"] for x in out["companies"]] == ["full", "full", "partial", "basic"]
        assert out["tiers"] == {"full": 2, "partial": 1, "basic": 1} and out["total"] == 4
        newest = await _search(c, sort="newest")
        assert [x["name"] for x in newest["companies"]] == ["Tiny Cafe Ltd", "Half Cafe Ltd", "Mid Cafe Ltd", "Big Cafe Group PLC"]
        by_name = await _search(c, sort="name")
        assert by_name["companies"][0]["name"] == "Big Cafe Group PLC" and by_name["companies"][-1]["name"] == "Tiny Cafe Ltd"


@pytest.mark.db
async def test_saved_counts_and_filter_cover_only_your_own_lists(db):
    await _seed(db)
    _, token = await make_user(db, "fl2", "Admin", org_id="org_acme")
    _, other = await make_user(db, "fl3", "Admin", org_id="org_other")
    async with _client(token) as c, _client(other) as o:
        first = await _search(c)
        mid = next(x for x in first["companies"] if x["name"] == "Mid Cafe Ltd")
        r = await c.post("/api/leads/accounts", json={"accounts": [{"name": mid["name"], "website": mid["website"], "business_record_id": mid["id"]}]})
        assert r.status_code == 200 and r.json()["added"] == 1
        out = await _search(c)
        assert out["saved_total"] == 1 and [x["name"] for x in out["companies"] if x["saved"]] == ["Mid Cafe Ltd"]
        assert (await _search(o))["saved_total"] == 0  # another organisation's lists are not counted
        only = await _search(c, filters={"saved": "only"})
        assert [x["name"] for x in only["companies"]] == ["Mid Cafe Ltd"]
        new = await _search(c, filters={"saved": "exclude"})
        assert "Mid Cafe Ltd" not in [x["name"] for x in new["companies"]] and new["total"] == 3


@pytest.mark.db
async def test_exclude_filters_remove_matches_without_losing_rows_with_empty_fields(db):
    await _seed(db)
    _, token = await make_user(db, "fl4", "Admin", org_id="org_acme")
    async with _client(token) as c:
        out = await _search(c, filters={"not_keyword": ["Tiny"], "not_company_category": ["public limited"]})
        assert sorted(x["name"] for x in out["companies"]) == ["Half Cafe Ltd", "Mid Cafe Ltd"]
        assert any("Not about" in ch for ch in out["chips"])
        assert (await _search(c, filters={"not_towns": ["Leeds"]}))["total"] == 0


@pytest.mark.db
async def test_a_lookup_that_adds_contact_details_lifts_the_company(db):
    await _seed(db)
    before = (await BR.search_filtered(db, {"towns": ["Leeds"], "name_contains": "Tiny"}))["rows"][0]
    assert BR.profile_of(before.rank_score) == "basic"
    row = await BR.upsert(db, source_id="web", source_type="scrape", confidence_tier="scraped",
                          data={"name": "Tiny Cafe Ltd", "registration_number": "001", "website": "tiny.cafe", "phone": "0113 9", "email": "x@tiny.cafe", "description": "A cafe"})
    assert BR.profile_of(row.rank_score) == "full"


@pytest.mark.db
async def test_people_tab_lists_registry_people_and_says_which_companies_still_need_reading(db):
    await _seed(db)
    big = (await BR.search_filtered(db, {"towns": ["Leeds"], "name_contains": "Big"}))["rows"][0]
    big.officers = [{"name": "SMITH, Jane", "role": "director", "appointed_on": "2020-01-01"},
                    {"name": "BROWN, Tom", "role": "director", "appointed_on": "2019-01-01", "resigned_on": "2022-01-01"}]
    await db.commit()
    _, token = await make_user(db, "fl5", "Admin", org_id="org_acme")
    async with _client(token) as c:
        r = await c.post("/api/leads/people/search", json={"filters": {"towns": ["Leeds"]}})
        assert r.status_code == 200, r.text
        out = r.json()
        assert [p["name"] for p in out["people"]] == ["SMITH, Jane"]  # the resigned one is not listed
        assert out["people"][0]["company"]["name"] == "Big Cafe Group PLC" and out["companies_total"] == 1
        assert len(out["fill_ids"]) == 3 and big.id not in out["fill_ids"]
        none = await c.post("/api/leads/people/search", json={"filters": {"towns": ["Leeds"]}, "title": "secretary"})
        assert none.json()["people"] == []


@pytest.mark.db
async def test_opening_with_no_filters_lists_the_whole_store_best_first(db):
    await _seed(db)
    _, token = await make_user(db, "fl6", "Admin", org_id="org_acme")
    async with _client(token) as c:
        r = await c.post("/api/leads/search", json={"filters": {}})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["total"] == 4 and out["companies"][0]["name"] == "Big Cafe Group PLC"
        assert out["total_all"] is None  # only counted separately when there are more than 10,000
        assert (await c.post("/api/leads/people/search", json={"filters": {}})).status_code == 200


@pytest.mark.db
async def test_before_the_ranking_job_has_run_the_list_still_opens_newest_first(db, monkeypatch):
    await _seed(db)

    async def not_ready(_db):
        return False

    monkeypatch.setattr(BR, "ranking_ready", not_ready)
    _, token = await make_user(db, "fl7", "Admin", org_id="org_acme")
    async with _client(token) as c:
        out = (await c.post("/api/leads/search", json={"filters": {}})).json()
        assert out["ranked"] is False and out["tiers"] is None
        assert out["companies"][0]["name"] == "Tiny Cafe Ltd"  # newest first, no sort by rank
