"""Phase 1: the ideal customer (ICP), the fit score and the register's "why now" signals.

No score without an ICP; every reason is a fact we hold; staff weights change the score; the register's filing dates are
stored as columns; Best fit orders Find Leads and the saved list."""
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest

from app.main import app
from app.services import business_records as BR
from app.services import fit_score as FS
from tests.conftest import make_user

TODAY = date(2026, 11, 11)
CAFE = "56102 - Unlicensed restaurants and cafes"
ICP = {"sic_codes": ["56102"], "postcode_areas": ["LS"], "size_bands": ["micro", "small"], "company_types": ["ltd"], "exclude_charities": True}


def _biz(**kw):
    base = dict(status="Active", company_category="Private Limited Company", registration_number="01234567", sic_text=CAFE, sic_codes="|56102|",
                size_band="micro", postcode="LS1 4AP", email="", confidence_tier="verified_registry", officers=None, sources=[],
                raw_data=None, accounts_due_on=None, confstmt_due_on=None, incorporated_on=date(2015, 1, 1), incorporation_date="")
    base.update(kw)
    return SimpleNamespace(**base)


def _fd(d):
    return d.strftime("%d/%m/%Y")


# ── the score, no database ────────────────────────────────────────────────
def test_no_icp_means_no_score():
    assert FS.fit(_biz(), {}, [], {}) is None
    assert FS.fit(_biz(), {"exclude_charities": True}, [], {}) is None  # leaving charities out alone says nothing about who fits


def test_every_reason_is_a_stored_fact_and_a_missing_fact_gives_no_reason():
    full = FS.fit(_biz(), FS.clean_icp(ICP), [{"key": "new_company", "label": "New company", "detail": "Incorporated on 1 Jun 2026."}],
                  {"director": "Jane Smith", "email": "verified"})
    assert full["score"] == round(100 * (30 + 15 + 10 + 10 + 15 + 14) / 100)
    text = " | ".join(full["reasons"])
    assert "Unlicensed restaurants and cafes (56102)" in text and "Private Limited Company on the register" in text
    assert "micro company accounts" in text and "Registered office in LS1, inside LS" in text
    assert "Director on the register: Jane Smith" in text and "Email checked and verified" in text and "Incorporated on 1 Jun 2026." in text
    bare = FS.fit(_biz(sic_text="", sic_codes="", size_band="", postcode="", company_category=""), FS.clean_icp(ICP), [], {})
    assert bare["score"] == 0 and bare["reasons"] == []  # nothing stored, nothing claimed


def test_weights_change_the_score_and_staff_weights_must_add_up_to_100():
    icp = FS.clean_icp({"sic_codes": ["56102"]})
    b = _biz()
    default = FS.fit(b, icp, [], {})["score"]  # type+SIC 30 of 30+10+15+20 = 75
    heavy = FS.fit(b, icp, [], {}, {"type_sic": 70, "size": 0, "area": 0, "director": 10, "email": 10, "signals": 10})["score"]
    assert default == 40 and heavy == 70
    assert FS.clean_weights({"type_sic": 70, "size": 0, "area": 0, "director": 10, "email": 10, "signals": 10})["type_sic"] == 70
    for bad in ({"type_sic": 50}, {"type_sic": -5, "size": 50}, {"type_sic": "x"}, {"nope": 1}):
        with pytest.raises(ValueError):
            FS.clean_weights(bad)


def test_charities_closed_companies_and_types():
    icp = FS.clean_icp(ICP)
    assert FS.fit(_biz(company_category="Charitable Incorporated Organisation"), icp, [], {})["score"] == 0
    assert FS.fit(_biz(registration_number="CC-1234"), icp, [], {})["reasons"][0].startswith("A charity")
    closed = FS.fit(_biz(status="Dissolved"), icp, [], {})
    assert closed["score"] == 0 and "dissolved" in closed["reasons"][0]
    assert FS.type_of("Private Limited Company") == "ltd" and FS.type_of("PRI/LTD BY GUAR/NSC (Private, limited by guarantee, no share capital)") == "guarantee"
    assert FS.type_of("Public Limited Company") == "plc" and FS.type_of("Limited Liability Partnership") == "llp"


def test_area_matches_a_whole_area_a_district_or_a_resolved_radius_only():
    icp = FS.clean_icp({"postcode_areas": ["L", "BD1"], "areas": [{"postcode": "M1 1AA", "radius_miles": 5, "districts": ["M1", "M4"]}]})
    reason = lambda pc: FS._area_match(pc, icp)  # noqa: E731
    assert reason("L1 8JQ") and not reason("LS1 4AP")  # the L area is not LS
    assert reason("BD1 1AA") and not reason("BD10 1AA")
    assert "within 5 miles of M1 1AA" in reason("M4 5AB") and not reason("M20 2AB")
    with pytest.raises(ValueError):
        FS.clean_icp({"areas": [{"postcode": "LS1 4AP", "radius_miles": 40}]})
    with pytest.raises(ValueError):
        FS.clean_icp({"postcode_areas": ["Leeds"]})


# ── signals from the register's own file ───────────────────────────────────
def test_register_dates_come_out_of_raw_data_into_columns():
    raw = {" CompanyNumber": "01234567", "Accounts.NextDueDate": "30/11/2026", "Accounts.LastMadeUpDate": "28/02/2026",
           "ConfStmtNextDueDate": "05/01/2027", "ConfStmtLastMadeUpDate": "22/12/2025"}
    out = BR.derive_search_fields({"name": "Acme Ltd", "raw": raw})
    assert out["accounts_due_on"] == date(2026, 11, 30) and out["last_accounts_on"] == date(2026, 2, 28)
    assert out["confstmt_due_on"] == date(2027, 1, 5) and out["last_confstmt_on"] == date(2025, 12, 22)
    api = BR.derive_search_fields({"name": "Acme Ltd", "raw": {"accounts": {"next_due": "2026-12-01", "last_accounts": {"made_up_to": "2025-12-31"}},
                                                               "confirmation_statement": {"next_due": "2027-03-01"}}})
    assert api["accounts_due_on"] == date(2026, 12, 1) and api["last_accounts_on"] == date(2025, 12, 31) and "last_confstmt_on" not in api
    assert "accounts_due_on" not in BR.derive_search_fields({"name": "x", "raw": {"Accounts.NextDueDate": ""}})


def test_signals_due_soon_new_director_and_new_company():
    officers = [{"name": "SMITH, Jane", "role": "director", "appointed_on": (TODAY - timedelta(days=30)).isoformat()},
                {"name": "OLD, Bob", "role": "director", "appointed_on": "2001-01-01"},
                {"name": "GONE, Al", "role": "director", "appointed_on": (TODAY - timedelta(days=10)).isoformat(), "resigned_on": "2026-11-01"}]
    b = _biz(accounts_due_on=TODAY + timedelta(days=20), confstmt_due_on=TODAY + timedelta(days=90), incorporated_on=TODAY - timedelta(days=100),
             officers=officers)
    keys = {s["key"]: s for s in FS.signals(b, TODAY)}
    assert set(keys) == {"accounts_due", "new_director", "new_company"}  # the statement is 90 days off: not "due soon"
    assert "Jane Smith" in keys["new_director"]["detail"]
    raw_only = _biz(raw_data={"ds_companies_house": {" CompanyNumber": "1", "ConfStmtNextDueDate": _fd(TODAY + timedelta(days=5))}})
    assert [s["key"] for s in FS.signals(raw_only, TODAY)] == ["confstmt_due"]  # not backfilled yet: read from the register's row
    assert FS.signals(_biz(status="Dissolved", accounts_due_on=TODAY), TODAY) == []
    assert [s["key"] for s in FS.signals(_biz(accounts_due_on=TODAY - timedelta(days=1)), TODAY)] == ["filed_late"]  # overdue is not "due within 60 days": it is its own reason


# ── on a real database ────────────────────────────────────────────────────
def _row(number, name, *, sic=CAFE, postcode="LS1 4AP", accounts="MICRO ENTITY", category="Private Limited Company", **raw):
    return {"name": name, "registration_number": number, "sic_text": sic, "industry": sic, "region": "LEEDS", "postcode": postcode, "status": "Active",
            "incorporation_date": "01/01/2015", "accounts_category": accounts, "company_category": category,
            "raw": {"CompanyNumber": number, **raw}}


@pytest.fixture(autouse=True)
def _fresh_caches():
    from app.api import lead_accounts
    from app.services import icp as I

    lead_accounts._PAGE_CACHE.clear()
    BR._RANKING[0] = 0.0
    BR._TOTALS.clear()
    I._WEIGHTS[0], I._WEIGHTS[1] = 0.0, None
    I._SIC_CACHE.clear()
    yield


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def _seed(db):
    soon = _fd(datetime.utcnow().date() + timedelta(days=20))
    await BR.bulk_upsert(db, source_id="ds_companies_house", rows=[
        _row("00000001", "Due Soon Cafe Ltd", **{"Accounts.NextDueDate": soon, "ConfStmtNextDueDate": soon}),
        _row("00000002", "Plain Cafe Ltd"),
        _row("00000003", "Far Cafe Ltd", postcode="M1 1AA"),
        _row("00000004", "Cafe Plc", category="Public Limited Company", accounts="FULL"),
    ])
    await db.commit()


@pytest.mark.db
async def test_bulk_import_stores_the_register_dates_as_columns(db):
    await _seed(db)
    row = await BR.find(db, registration_number="00000001")
    assert row.accounts_due_on == datetime.utcnow().date() + timedelta(days=20) and row.confstmt_due_on is not None
    assert (await BR.find(db, registration_number="00000002")).accounts_due_on is None


@pytest.mark.db
async def test_icp_saves_and_loads_and_a_radius_becomes_postcode_districts(client, monkeypatch):
    from app.services import icp as I

    async def districts(pc, miles):
        assert (pc, miles) == ("LS1 4AP", 10)
        return ["LS1", "LS2", "LS6"]

    monkeypatch.setattr(I, "_districts_within", districts)
    got = (await client.get("/api/leads/icp")).json()
    assert got["is_set"] is False and got["can_edit"] is True and {t["id"] for t in got["choices"]["company_types"]} >= {"ltd", "plc", "llp"}
    r = await client.put("/api/leads/icp", json={"sic_codes": ["56102"], "sic_labels": {"56102": "Unlicensed restaurants and cafes"},
                                                  "areas": [{"postcode": "ls1 4ap", "radius_miles": 10}], "size_bands": ["micro"],
                                                  "company_types": ["ltd"], "exclude_charities": True})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["is_set"] and out["icp"]["areas"][0]["districts"] == ["LS1", "LS2", "LS6"]
    assert out["filters"] == {"sic_codes": ["56102"], "postcode_prefixes": ["LS1", "LS2", "LS6"], "size_bands": ["micro"], "company_types": ["ltd"],
                              "exclude_charities": True}
    again = (await client.get("/api/leads/icp")).json()
    assert again["icp"]["sic_labels"] == {"56102": "Unlicensed restaurants and cafes"} and again["is_set"]
    bad = await client.put("/api/leads/icp", json={"areas": [{"postcode": "LS1 4AP", "radius_miles": 50}]})
    assert bad.status_code == 400 and "miles" in bad.json()["detail"]


@pytest.mark.db
async def test_a_member_without_company_rights_cant_change_the_icp(db, funded_house_org):
    _, token = await make_user(db, "rep", "Operator")
    async with _client(token) as c:
        assert (await c.put("/api/leads/icp", json={"sic_codes": ["56102"]})).status_code == 403


@pytest.mark.db
async def test_only_staff_see_the_weights_and_only_staff_admins_change_them(db, client, staff):
    from tests.conftest import make_staff

    assert (await client.get("/api/admin-api/fit-weights")).status_code == 401  # a customer never
    got = (await staff.get("/api/admin-api/fit-weights")).json()
    assert got["weights"] == FS.DEFAULT_WEIGHTS
    new = {"type_sic": 40, "size": 10, "area": 10, "director": 10, "email": 10, "signals": 20}
    r = await staff.put("/api/admin-api/fit-weights", json={"weights": new})
    assert r.status_code == 200 and r.json()["weights"] == new
    assert (await staff.put("/api/admin-api/fit-weights", json={"weights": {**new, "size": 30}})).status_code == 400
    viewer = await make_staff(db, email="viewer@outreach.test", role="staff_support")
    async with _client(viewer) as v:
        assert (await v.get("/api/admin-api/fit-weights")).status_code == 200
        assert (await v.put("/api/admin-api/fit-weights", json={"weights": new})).status_code == 403


@pytest.mark.db
async def test_best_fit_orders_find_leads_and_every_row_carries_its_reasons(db):
    await _seed(db)
    _, token = await make_user(db, "fit", "Admin", org_id="org_fit")
    async with _client(token) as c:
        before = (await c.post("/api/leads/search", json={"filters": {"sic_codes": ["56102"]}, "sort": "fit"})).json()
        assert before["icp_set"] is False and all(x["fit"] is None for x in before["companies"])  # no ICP: no score, best match order
        due = next(x for x in before["companies"] if x["name"] == "Due Soon Cafe Ltd")
        assert {s["key"] for s in due["signals"]} == {"accounts_due", "confstmt_due"}  # signal tags show with or without an ICP
        assert (await c.put("/api/leads/icp", json={"sic_codes": ["56102"], "postcode_areas": ["LS"], "company_types": ["ltd"]})).status_code == 200
        out = (await c.post("/api/leads/search", json={"filters": {"sic_codes": ["56102"]}, "sort": "fit"})).json()
    names = [x["name"] for x in out["companies"]]
    assert out["icp_set"] and names[0] == "Due Soon Cafe Ltd" and names[-1] in ("Far Cafe Ltd", "Cafe Plc")
    scores = [x["fit"]["score"] for x in out["companies"]]
    assert scores == sorted(scores, reverse=True)
    top = out["companies"][0]["fit"]
    assert any("accounts are due" in r for r in top["reasons"]) and any("inside LS" in r for r in top["reasons"])
    far = next(x for x in out["companies"] if x["name"] == "Far Cafe Ltd")["fit"]
    assert not any("Registered office" in r for r in far["reasons"])  # outside the area: no area reason


@pytest.mark.db
async def test_the_saved_list_has_a_fit_only_once_the_icp_is_set(db, client):
    await _seed(db)
    row = await BR.find(db, registration_number="00000001")
    r = await client.post("/api/leads/accounts", json={"accounts": [{"name": "Due Soon Cafe Ltd", "business_record_id": row.id, "source": "scout"}]})
    assert r.status_code == 200, r.text
    got = (await client.get("/api/leads/accounts")).json()
    assert got["icp_set"] is False and got["accounts"][0]["fit"] is None and got["accounts"][0]["signals"]
    await client.put("/api/leads/icp", json={"sic_codes": ["56102"]})
    got = (await client.get("/api/leads/accounts")).json()
    fit = got["accounts"][0]["fit"]
    assert got["icp_set"] and fit["score"] > 0 and any("56102" in x for x in fit["reasons"])


@pytest.mark.db
async def test_the_sic_picker_only_offers_codes_the_register_uses(db, client):
    await _seed(db)
    codes = (await client.get("/api/leads/sic-codes?q=cafes")).json()["codes"]
    assert codes == [{"code": "56102", "text": "Unlicensed restaurants and cafes"}]
    assert (await client.get("/api/leads/sic-codes?q=5610")).json()["codes"][0]["code"] == "56102"
    assert (await client.get("/api/leads/sic-codes?q=zzzz")).json()["codes"] == []


@pytest.mark.db
async def test_set_it_from_my_website_drafts_without_saving_and_only_offers_real_codes(db, client, monkeypatch):
    from app.services import icp as I
    from app.services import llm_gateway

    await _seed(db)

    async def site(url):
        return "We do the books for cafes and coffee shops across Leeds and Bradford. " * 5

    async def model(**kw):
        return {"customer_trades": ["cafes"], "postcode_areas": ["LS", "BD", "Leeds"], "size_bands": ["micro"], "evidence": ["the books for cafes"]}

    monkeypatch.setattr(I, "_site_text", site)
    monkeypatch.setattr(llm_gateway, "extract_structured", model)
    r = await client.post("/api/leads/icp/draft", json={"website": "https://example-books.co.uk"})
    assert r.status_code == 200, r.text
    d = r.json()["draft"]
    assert d["sic_codes"] == ["56102"] and d["postcode_areas"] == ["LS", "BD"] and d["size_bands"] == ["micro"]
    assert (await client.get("/api/leads/icp")).json()["is_set"] is False  # the person checks it and saves it
