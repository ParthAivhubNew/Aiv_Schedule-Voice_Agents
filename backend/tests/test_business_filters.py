"""The Apollo-style filter search over the shared company store, and the import counters that feed it."""
from datetime import date, timedelta

import pytest

from app.services import business_records as BR

pytestmark = pytest.mark.db


def _row(number, name, sic, town, postcode, status="Active", born="06/06/2022", category="MICRO ENTITY", **extra):
    return {"name": name, "registration_number": number, "sic_text": sic, "industry": sic.split(" | ")[0], "region": town,
            "postcode": postcode, "status": status, "incorporation_date": born, "accounts_category": category,
            "company_category": "Private Limited Company", "raw": {"CompanyNumber": number}, **extra}


CAFE = "56102 - Unlicensed restaurants and cafes"
ACCOUNTING = "69201 - Accounting and auditing activities"


async def _seed(db):
    await BR.bulk_upsert(db, source_id="ds_ch", rows=[
        _row("001", "Corner Cafe Ltd", CAFE, "LONDON", "EC1A 1BB"),
        _row("002", "Second Cafe Ltd", CAFE + " | 47110 - Retail sale in non-specialised stores", "LEEDS", "LS1 4AP", born="2012-01-31", category="SMALL"),
        _row("003", "Closed Cafe Ltd", CAFE, "LONDON", "EC1A 2BB", status="Dissolved"),
        _row("004", "Smith & Co Accountants", ACCOUNTING, "LONDON", "N1 9GU", category="FULL", born="01/01/2001"),
    ])
    await db.commit()


async def test_import_counts_only_new_companies_and_fills_search_columns(db):
    rows = [_row("001", "Corner Cafe Ltd", CAFE, "LONDON", "ec1a 1bb")]
    assert await BR.bulk_upsert(db, source_id="ds_ch", rows=rows) == 1
    assert await BR.bulk_upsert(db, source_id="ds_ch", rows=rows) == 0  # same company again: refreshed, not new
    await db.commit()
    biz = (await BR.search_filtered(db, {"towns": ["London"]}))["rows"][0]
    assert (biz.sic_codes, biz.postcode, biz.incorporated_on, biz.size_band) == ("|56102|", "EC1A 1BB", date(2022, 6, 6), "micro")


async def test_default_status_is_exactly_active_and_filters_combine(db):
    await _seed(db)
    out = await BR.search_filtered(db, {"sector": ["cafes"], "towns": ["london"]})
    assert [r.name for r in out["rows"]] == ["Corner Cafe Ltd"]  # the dissolved cafe and the Leeds one are out
    assert out["filters"]["status"] == "Active"
    both = await BR.search_filtered(db, {"sector": ["cafes"], "towns": ["london"], "status": "any"})
    assert {r.name for r in both["rows"]} == {"Corner Cafe Ltd", "Closed Cafe Ltd"}


async def test_sic_code_postcode_size_and_age_filters(db):
    await _seed(db)
    assert [r.name for r in (await BR.search_filtered(db, {"sic_codes": ["47110"]}))["rows"]] == ["Second Cafe Ltd"]
    assert [r.name for r in (await BR.search_filtered(db, {"sic_codes": ["69"]}))["rows"]] == ["Smith & Co Accountants"]
    assert {r.name for r in (await BR.search_filtered(db, {"postcode_prefixes": ["ec1"]}))["rows"]} == {"Corner Cafe Ltd"}
    assert [r.name for r in (await BR.search_filtered(db, {"sector": ["cafes"], "size_bands": ["small"]}))["rows"]] == ["Second Cafe Ltd"]
    old = await BR.search_filtered(db, {"towns": ["London"], "min_age_years": 10})
    assert [r.name for r in old["rows"]] == ["Smith & Co Accountants"]
    young = await BR.search_filtered(db, {"towns": ["London"], "max_age_years": 10})
    assert [r.name for r in young["rows"]] == ["Corner Cafe Ltd"]


async def test_a_search_needs_something_to_narrow_by_and_user_text_cannot_act_as_a_wildcard(db):
    await _seed(db)
    with pytest.raises(ValueError):
        await BR.search_filtered(db, {"status": "Active", "size_bands": ["micro"]})
    assert (await BR.search_filtered(db, {"towns": ["%"]}))["rows"] == []  # a literal "%", not "everything"
    assert (await BR.search_filtered(db, {"towns": ["L_NDON"]}))["rows"] == []


async def test_paging_total_and_removing_rows(db):
    await _seed(db)
    page = await BR.search_filtered(db, {"sector": ["cafes"], "status": "any"}, limit=2)
    assert page["total"] == 3 and len(page["rows"]) == 2 and not page["total_capped"]
    rest = await BR.search_filtered(db, {"sector": ["cafes"], "status": "any"}, limit=2, offset=2)
    assert len(rest["rows"]) == 1
    removed = await BR.search_filtered(db, {"sector": ["cafes"], "status": "any"}, exclude_ids=[r.id for r in page["rows"]])
    assert [r.id for r in removed["rows"]] == [rest["rows"][0].id]


def test_derived_fields_use_only_what_the_source_published():
    out = BR.derive_search_fields({"sic_text": f"{CAFE} | 47110 - Retail", "postcode": " ec1a  1bb ",
                                   "incorporation_date": "06/06/2022", "accounts_category": "total exemption full"})
    assert out == {"sic_text": f"{CAFE} | 47110 - Retail", "sic_codes": "|56102|47110|", "postcode": "EC1A 1BB",
                   "incorporated_on": date(2022, 6, 6), "size_band": "small"}
    assert BR.derive_search_fields({"name": "x", "accounts_category": "SOMETHING NEW"}) == {}  # unknown category: no guess


async def test_search_endpoint_returns_stored_records_with_their_tier_and_chips(client, db):
    await _seed(db)
    r = await client.post("/api/leads/search", json={"filters": {"sector": ["cafe"], "towns": ["London"]}})
    assert r.status_code == 200
    body = r.json()
    assert [c["name"] for c in body["companies"]] == ["Corner Cafe Ltd"]
    assert body["companies"][0]["tier"] == "verified_registry" and body["companies"][0]["size_band"] == "micro"
    assert "Status: Active" in body["chips"]
    assert (await client.post("/api/leads/search", json={"filters": {"size_bands": ["micro"]}})).status_code == 422


async def test_chat_runs_the_same_filters_and_can_drop_companies(client, db, monkeypatch):
    from app.services import llm_gateway

    await _seed(db)
    plans = iter([
        {"action": "search", "sector": ["cafe"], "towns": ["London"], "status": "any"},
        {"action": "remove", "remove_names": ["Closed Cafe"]},
    ])

    async def fake_extract(**kwargs):
        return next(plans)

    async def fake_chat(**kwargs):
        return {"reply": "ok"}

    monkeypatch.setattr(llm_gateway, "extract_structured", fake_extract)
    monkeypatch.setattr("app.api.enrichment.call_open_chat_llm", fake_chat)
    first = (await client.post("/api/enrichment/copilot-chat", json={"message": "find cafes in London including closed ones", "plugin": "leadgen"})).json()
    assert {c["name"] for c in first["registry"]["companies"]} == {"Corner Cafe Ltd", "Closed Cafe Ltd"}
    second = (await client.post("/api/enrichment/copilot-chat", json={"message": "remove Closed Cafe", "plugin": "leadgen",
                                                                  "filters": first["registry"]["filters"]})).json()
    assert second["removed_names"] == ["Closed Cafe"] and second["registry"] is None


def test_officer_names_are_split_and_only_current_officers_are_kept():
    from app.services import company_contacts as CC

    assert CC.split_officer_name("SMITH, John Paul") == {"first_name": "John", "last_name": "Smith"}
    assert CC.split_officer_name("Jane Doe") == {"first_name": "Jane", "last_name": "Doe"}
    got = CC.active_officers([
        {"name": "SMITH, John", "role": "director", "appointed_on": "2020-01-01"},
        {"name": "OLD, Person", "role": "director", "resigned_on": "2021-01-01"},
        {"name": "LEGAL, Corp Secretaries Ltd", "role": "corporate-secretary"},
        {"name": "AUDITOR, Alan", "role": "auditor"},
    ])
    assert [o["name"] for o in got] == ["SMITH, John", "LEGAL, Corp Secretaries Ltd"]
    assert all(o["verified"] and o["source"] == "registry" for o in got)


async def test_contacts_use_only_the_exact_company_number_and_label_web_results(client, db, monkeypatch):
    from app.models.models import DataSource
    from app.services import company_contacts as CC, data_source_connector as conn, enrichment_service

    await _seed(db)
    db.add(DataSource(id="ds_ch", name="Companies House", kind="api", status="active", base_url="http://x", api_key="k",
                      config={"officers_endpoint": "/o", "trust_tier": "verified_registry", "id_field_from_search": "company_number"}))
    await db.commit()
    biz = (await BR.search_filtered(db, {"name_contains": "Corner Cafe"}))["rows"][0]

    async def fake_search(source, query, limit=10):
        return [{"company_number": "00000999"}, {"company_number": "001"}]  # a near-miss first, the exact one second

    async def fake_profile(source, hit):
        assert hit["company_number"] == "001"  # the exact number, not the near miss
        return {"name": "Corner Cafe Ltd", "officers": [{"name": "SMITH, John", "role": "director"}], "raw": hit}

    async def fake_web(**kwargs):
        return {"domain": "cornercafe.example", "phones": ["020 0000 0000"], "citations": ["https://cornercafe.example"]}

    monkeypatch.setattr(conn, "search", fake_search)
    monkeypatch.setattr(conn, "fetch_profile", fake_profile)
    monkeypatch.setattr(enrichment_service, "enrich_prospect_intelligence", fake_web)
    charged = []

    async def allow(db):
        return None

    async def charge(db, count, what):
        charged.append(count)

    monkeypatch.setattr("app.api.lead_accounts._can_research", allow)
    monkeypatch.setattr("app.api.lead_accounts._charge_leads", charge)
    resp = await client.post(f"/api/leads/companies/{biz.id}/contacts", json={"include_web": True})
    assert resp.status_code == 200, resp.text
    r = resp.json()
    assert [o["name"] for o in r["officers"]] == ["SMITH, John"] and r["officers"][0]["verified"] is True
    assert r["web"]["source"] == "web" and r["web"]["verified"] is False and r["web"]["website"] == "cornercafe.example"
    assert r["stored"]["website"] == ""  # the web guess was NOT written into the registry fields
    again = (await client.post(f"/api/leads/companies/{biz.id}/contacts", json={"include_web": True})).json()
    assert again["web"]["cached"] is True
    assert charged == [1]  # one credit for the first lookup, none for the cached repeat


async def test_same_premises_from_two_sources_merge_but_same_name_elsewhere_does_not(db):
    care = {"name": "Oak Dental Ltd", "postcode": "ls1 4ap", "industry": "Dentist", "status": "Active", "raw": {"a": 1}}
    food = {"name": "OAK DENTAL LTD", "postcode": "LS1 4AP", "phone": "0113 000", "status": "Active", "raw": {"b": 2}}
    elsewhere = {"name": "Oak Dental Ltd", "postcode": "M1 1AA", "status": "Active", "raw": {"c": 3}}
    assert await BR.bulk_upsert(db, source_id="ds_cqc", rows=[care, elsewhere]) == 2
    assert await BR.bulk_upsert(db, source_id="ds_fsa", rows=[food]) == 0  # same name + postcode: the same place
    await db.commit()
    got = (await BR.search_filtered(db, {"name_contains": "Oak Dental", "postcode_prefixes": ["LS1"]}))["rows"]
    assert len(got) == 1 and got[0].phone == "0113 000" and got[0].industry == "Dentist"  # facts from both, none lost


async def test_a_second_source_fills_gaps_but_never_overwrites_the_first_and_refreshes_its_own(db):
    ch = {"name": "OLD ROSE CHARITY LTD", "registration_number": "00682766", "status": "Active", "industry": "94990 - Other membership",
          "region": "LONDON", "postcode": "WC2H 0HF", "raw": {"CompanyNumber": "00682766"}}
    charity = {"name": "The Old Rose Charity", "registration_number": "00682766", "status": "Removed", "industry": "Charity",
               "phone": "07000 000000", "website": "www.oldrose.org.uk", "postcode": "WC2H 0HF", "raw": {"charity": 1}}
    assert await BR.bulk_upsert(db, source_id="ds_ch", rows=[ch]) == 1
    assert await BR.bulk_upsert(db, source_id="ds_charity", rows=[charity]) == 0
    await db.commit()
    biz = (await BR.search_filtered(db, {"name_contains": "Old Rose"}))["rows"][0]
    assert (biz.name, biz.status, biz.industry) == ("OLD ROSE CHARITY LTD", "Active", "94990 - Other membership")  # first source kept
    assert (biz.phone, biz.website) == ("07000 000000", "www.oldrose.org.uk")  # gaps filled from the second
    assert {s["source_id"] for s in biz.sources} == {"ds_ch", "ds_charity"} and set(biz.raw_data) == {"ds_ch", "ds_charity"}
    # the registry re-imports next month: its own facts change, and the charity's additions stay
    await BR.bulk_upsert(db, source_id="ds_charity", rows=[charity])
    assert len((await BR.search_filtered(db, {"name_contains": "Old Rose"}))["rows"][0].sources) == 2  # not listed twice
    # a row only one source has described is refreshed freely
    solo = {"name": "Solo Ltd", "registration_number": "11111111", "status": "Active", "raw": {}}
    await BR.bulk_upsert(db, source_id="ds_ch", rows=[solo])
    await BR.bulk_upsert(db, source_id="ds_ch", rows=[{**solo, "status": "Dissolved"}])
    await db.commit()
    assert (await BR.search_filtered(db, {"name_contains": "Solo", "status": "any"}))["rows"][0].status == "Dissolved"
