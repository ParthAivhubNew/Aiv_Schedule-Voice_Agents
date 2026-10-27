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


@pytest.fixture(autouse=True)
def _fresh_caches():
    from app.api import lead_accounts

    lead_accounts._PAGE_CACHE.clear()
    BR._RANKING[0] = 0.0
    BR._TOTALS.clear()
    yield


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
        assert out["total"] == 4
        summary = (await c.post("/api/leads/search/summary", json={"filters": {"towns": ["Leeds"]}})).json()
        assert summary["tiers"] == {"full": 2, "partial": 1, "basic": 1} and summary["total"] == 4
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
        assert [x["name"] for x in out["companies"] if x["saved"]] == ["Mid Cafe Ltd"]
        mine = (await c.post("/api/leads/search/summary", json={"filters": {"towns": ["Leeds"]}})).json()
        assert mine["saved_total"] == 1
        theirs = (await o.post("/api/leads/search/summary", json={"filters": {"towns": ["Leeds"]}})).json()
        assert theirs["saved_total"] == 0  # another organisation's lists are not counted
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


@pytest.mark.db
async def test_find_website_tries_the_web_then_the_deeper_search_and_charges_only_for_a_find(db, monkeypatch):
    from app.core.tenancy import org_scope
    from app.services import credits as K

    await BR.bulk_upsert(db, source_id="ds_ch", rows=[_row("101", "Web Cafe Ltd", "01/01/2015"), _row("102", "Deep Cafe Ltd", "01/01/2015"),
                                                       _row("103", "Hidden Cafe Ltd", "01/01/2015"), _row("104", "Has Site Ltd", "01/01/2015", website="has.co.uk")])
    await db.commit()
    ids = {r.name: r.id for r in (await BR.search_filtered(db, {"towns": ["Leeds"]}))["rows"]}

    async def fake_web(_db, biz, refresh=False):
        if biz.name == "Web Cafe Ltd":
            found = {"found": True, "cached": False, "website": "webcafe.co.uk", "phones": ["0113 000 111"], "emails": [], "team": []}
            biz.raw_data = {**(biz.raw_data or {}), "contacts_web": found}  # the real lookup keeps what it finds here
            return found
        return {"found": False, "cached": False, "website": "", "phones": [], "emails": [], "team": []}

    async def fake_places(query):
        return {"place_id": "p1", "website": "https://deepcafe.co.uk", "phone": "0113 222 333", "name": "Deep Cafe"} if "Deep" in query else None

    monkeypatch.setattr("app.services.company_contacts.web_contacts", fake_web)
    monkeypatch.setattr("app.api.lead_accounts.search_google_places", fake_places)
    _, token = await make_user(db, "fl8", "Admin", org_id="org_acme")
    with org_scope("org_acme"):
        await K.add_credits(db, "leadgen", 200, source="grant", note="Trial")
        await db.commit()
    async with _client(token) as c:
        r = await c.post(f"/api/leads/companies/{ids['Web Cafe Ltd']}/find-website")
        assert r.status_code == 200, r.text
        web = r.json()
        assert web["found"] and web["source"] == "web" and web["charged"] == 1
        assert web["company"]["web_website"] == "webcafe.co.uk" and web["company"]["website"] == ""  # labelled, not mixed into the registry's own field

        r = await c.post(f"/api/leads/companies/{ids['Deep Cafe Ltd']}/find-website")
        deep = r.json()
        assert deep["found"] and deep["source"] == "deep" and deep["company"]["website"] == "https://deepcafe.co.uk" and deep["company"]["phone"] == "0113 222 333"

        with org_scope("org_acme"):
            before = await K.wallet_balance(db, "leadgen")
        miss_r = await c.post(f"/api/leads/companies/{ids['Hidden Cafe Ltd']}/find-website")
        assert miss_r.status_code == 200, miss_r.text
        miss = miss_r.json()
        assert not miss["found"] and miss["charged"] == 0 and "Nothing was charged" in miss["note"]
        with org_scope("org_acme"):
            assert await K.wallet_balance(db, "leadgen") == before

        already = (await c.post(f"/api/leads/companies/{ids['Has Site Ltd']}/find-website")).json()
        assert already["found"] and already["source"] == "stored" and already["charged"] == 0
        assert (await c.post("/api/leads/companies/nope/find-website")).status_code == 404



def test_a_register_or_rating_page_is_never_taken_for_the_company_own_website():
    from app.services import site_check as S

    assert not S.plausible_site("Creative Cheesecakes", "https://ratings.food.gov.uk/")
    assert not S.plausible_site("Acme Ltd", "https://find-and-update.company-information.service.gov.uk/company/123")
    assert not S.plausible_site("Acme Ltd", "https://www.facebook.com/acme")
    assert not S.plausible_site("Creative Cheesecakes", "https://totallyunrelated.co.uk")  # a web find must carry the company's name
    assert S.plausible_site("Creative Cheesecakes", "https://www.creativecheesecakes.co.uk/")
    assert S.plausible_site("Teddy Bears Pre-School", "https://teddybears-preschool.co.uk")
    assert S.plausible_site("Leeds City Council", "https://www.leeds.gov.uk")
    assert S.plausible_site("Totally Unrelated Name", "https://registry-copy.co.uk", strict=False)  # a stored registry value is only checked for listing sites


def test_a_logo_is_found_from_the_sites_icon_links_best_first():
    from app.services import logos

    html = ('<link rel="icon" href="/small.png" sizes="16x16"><link rel="apple-touch-icon" href="/touch.png"><link rel="mask-icon" href="/m.svg">'
            '<link rel="shortcut icon" href="https://cdn.example/f.ico">')
    assert logos._icon_links(html, "https://acme.co.uk/") == ["https://acme.co.uk/touch.png", "https://acme.co.uk/small.png", "https://cdn.example/f.ico"]
    assert logos._kind(b"\x89PNG\r\n\x1a\nxxxx") == "image/png" and logos._kind(b"<html>") == ""


async def test_a_logo_is_never_fetched_from_a_private_address(tmp_path, monkeypatch):
    from app.services import logos

    monkeypatch.setattr(logos, "LOGO_DIR", tmp_path)
    assert await logos.logo_for("http://127.0.0.1/") is None
    assert await logos.logo_for("localhost") is None
