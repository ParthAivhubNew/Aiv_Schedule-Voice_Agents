"""Plan 10 (Phases 0, 1.1 and 3) / plan 11 step 6: one list of lead sources, the BN file's Google values kept view-only, and a Connectors
screen whose every status, count and test result comes from the server."""
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.services import connector_catalog as CC
from app.services import data_policy as DP
from app.services import source_catalog as SC

APP = Path(__file__).resolve().parents[1] / "app"


# -- the list of sources ------------------------------------------------------------------------------------------------------------
def test_every_origin_the_code_writes_has_a_label():
    found = set()
    for path in APP.rglob("*.py"):
        src = path.read_text(encoding="utf-8", errors="ignore")
        for m in re.finditer(r"LeadAccount\(", src):
            chunk = src[m.end():m.end() + 1500]
            hit = re.search(r"\bsource\s*=\s*[\"']([a-z_]+)[\"']", chunk)
            if hit:
                found.add(hit.group(1))
    assert {"social", "inbound_call"} <= found  # two of the writers plan 10 found shown as "Added by hand"
    assert found <= SC.ORIGIN_KEYS, found - SC.ORIGIN_KEYS


def test_origin_keys_keep_real_values_and_accept_the_new_names():
    assert SC.origin_key("social") == "social" and SC.origin_key("inbound_call") == "inbound_call" and SC.origin_key("api") == "api"
    assert SC.origin_key("find_leads") == "scout" and SC.origin_key("assistant") == "copilot"
    assert SC.origin_key("made-up") == "manual" and SC.origin_key(None) == "manual"
    assert SC.origin_label("scout") == "Find Leads" and SC.origin_label("copilot") == "AI Assistant"


def test_clients_see_categories_and_staff_see_suppliers():
    assert SC.provenance_label("import_bn_leads") == "Licensed business data"
    assert SC.provenance_label("import_bn_leads", staff=True) == "Licensed business data (BN leads file)"
    assert SC.provenance_label("import_scrapegraph_bn") == "Web scrape"
    assert SC.provenance_label("register:cqc") == "Care Quality Commission" and SC.provenance_label("apollo") == "Enrichment data"
    client = json.dumps(SC.catalog())
    assert "BN leads file" not in client and "ScrapeGraph" not in client
    assert "BN leads file" in json.dumps(SC.catalog(staff=True))


# -- the BN file's Google values ----------------------------------------------------------------------------------------------------
BN = {"Phone": "01273 555123", "phone": "01273 555123", "Website": "https://acme-widgets.co.uk", "website": "https://acme-widgets.co.uk",
      "Email": "hello@acme-widgets.co.uk", "GoogleName": "Acme Widgets", "MatchConfidence": "high"}


def _record(raw, **kw):
    base = {"phone": "01273 555123", "website": "https://acme-widgets.co.uk", "email": "hello@acme-widgets.co.uk", "raw_data": raw, "field_sources": None}
    return SimpleNamespace(**{**base, **kw})


def test_the_bn_files_phones_and_websites_are_view_only():
    rec = _record({"import_bn_leads": BN})
    assert DP.restricted_fields(rec) == {"phone", "website"}  # its e-mails didn't come from Google
    assert DP.record_source(rec, "phone") == "google_places" and DP.record_source(rec, "email") == "licensed"  # not "register"


def test_a_bn_value_an_open_source_also_lists_may_be_exported():
    rec = _record({"import_bn_leads": BN, "import_scrapegraph_bn": {"phone": "01273 555123"}})
    assert DP.restricted_fields(rec) == {"website"}


def test_a_saved_copy_labelled_register_is_checked_again():
    rec = _record({"import_bn_leads": BN})
    lead = SimpleNamespace(phone="01273 555123", website="", email="", field_sources={"phone": "register"})
    assert DP.restricted_fields(lead, rec) == {"phone"}
    own = SimpleNamespace(phone="01273 555123", website="", email="", field_sources={"phone": "website"})
    assert DP.restricted_fields(own, rec) == set()  # read from the company's own site: ours to hand over


def test_the_research_samples_google_website_is_view_only():
    entry = {"website": "https://acme-widgets.co.uk", "phones": [], "emails": [], "sources": {"website": "Google Places"}}
    rec = _record({"fsb_sample_2026_11": entry}, phone="", email="")
    assert DP.restricted_fields(rec) == {"website"}
    entry["sources"]["website"] = "web search"
    assert DP.restricted_fields(_record({"fsb_sample_2026_11": entry}, phone="", email="")) == set()


# -- the Connectors screen ----------------------------------------------------------------------------------------------------------
@pytest.fixture
def keys(monkeypatch):
    """Which provider keys exist: the platform's AI and search keys, no e-mail finders, no number checks."""
    from app.api import connections
    from app.providers import registry
    from app.services import enrichment_waterfall

    state = {"where": {"openai": "platform", "deepseek": "none", "tavily": "platform", "apollo": "none", "google_places": "platform"},
             "finders": {}, "others": {}}

    async def where():
        return dict(state["where"])

    async def finders():
        return dict(state["finders"])

    monkeypatch.setattr(connections, "platform_provided", where)
    monkeypatch.setattr(enrichment_waterfall, "finder_keys", finders)
    for pid in ("telnyx_lookup", "provero_tps", "tavily", "google_places"):
        p = registry.get(pid)

        async def saved(pid=pid):
            return state["others"].get(pid, "")

        monkeypatch.setattr(p, "saved_key", saved)
    monkeypatch.setattr(CC, "_LAST_TEST", {})
    return state


async def _registers_and_records(db):
    from app.core.tenancy import org_scope
    from app.models.models import BusinessRecord, DataSource, LeadAccount

    now = datetime.utcnow()
    db.add_all([DataSource(id="ds_companies_house", name="Companies House (UK)", kind="api", run_state="paused"),
                DataSource(id="ds_cqc", name="CQC care directory (England)", kind="api", run_state="idle"),
                DataSource(id="ds_food_hygiene", name="Food Hygiene Ratings (FSA)", kind="api", run_state="idle")])
    await db.flush()
    await db.execute(text("INSERT INTO data_source_runs (id, source_id, status, error_message, started_at, finished_at) VALUES "
                          "('r1', 'ds_cqc', 'done', '', :a, :a), ('r2', 'ds_cqc', 'error', 'HTTP 500 from the CQC API', :b, NULL), "
                          "('r3', 'ds_food_hygiene', 'done', '', :a, :a)"), {"a": now - timedelta(days=3), "b": now - timedelta(days=1)})
    db.add_all([BusinessRecord(id="br1", identity_hash="h1", name="Acme Widgets Ltd", phone="01273 555123",
                               raw_data={"ds_companies_house": {"company_number": "01234567"}, "import_bn_leads": BN}),
                BusinessRecord(id="br2", identity_hash="h2", name="Other Ltd", raw_data={"ds_companies_house": {}})])
    await db.commit()
    with org_scope("org_default"):
        db.add_all([LeadAccount(id="la1", org_id="org_default", name="Acme Widgets Ltd", business_record_id="br1", source="import"),
                    LeadAccount(id="la2", org_id="org_default", name="Rang us", source="inbound_call")])
        await db.commit()


async def test_every_status_and_count_comes_from_the_server(db, client, keys):
    await _registers_and_records(db)
    await CC.refresh_stats()
    got = await client.get("/api/leadgen/connectors")
    assert got.status_code == 200, got.text
    body = got.json()
    by = {c["id"]: c for c in body["connectors"]}
    assert by["ds_companies_house"]["status"] == "paused" and by["ds_companies_house"]["records"] == 2
    assert by["ds_companies_house"]["leads"] == 1 and "searchable" in by["ds_companies_house"]["statusText"]
    assert by["ds_cqc"]["status"] == "error" and "lastError" not in by["ds_cqc"]  # the vendor's error is for staff
    assert by["ds_food_hygiene"]["status"] == "connected" and by["ds_food_hygiene"]["lastSyncedAt"]
    bn = by["import_bn_leads"]
    assert bn["name"] == "Licensed business data" and bn["records"] == 1 and bn["viewOnly"] == ["phone", "website"]
    assert "can't be downloaded" in bn["statusText"]
    assert "import_scrapegraph_bn" not in by  # not loaded here
    assert by["email_finders"]["status"] == "not_connected" and by["email_finders"]["testable"] is False
    assert by["key_openai"]["status"] == "connected" and by["key_openai"]["statusText"] == "Provided by Aivhub."
    assert by["key_deepseek"]["status"] == "not_connected"
    assert by["telnyx_lookup"]["status"] == "not_connected" and by["provero_tps"]["status"] == "not_connected"
    assert by["file_import"]["leads"] == 1 and by["experian"]["status"] == "coming_soon" and by["hubspot"]["status"] == "coming_soon"
    soon = {c["id"] for c in CC.COMING_SOON}
    assert all(by[i]["status"] == "coming_soon" for i in soon)
    assert body["canTest"] is True and body["countsAt"]
    words = got.text
    for supplier in ("BN leads file", "ScrapeGraph", "Hunter", "Icypeas", "Telnyx", "Provero", "HTTP 500"):
        assert supplier not in words, supplier


async def test_company_rules_and_plans_switch_connectors_off(db, client, keys):
    from app.services import tenant_policy as TP

    await db.execute(text("UPDATE organizations SET policy = CAST(:p AS JSON) WHERE id = 'org_default'"),
                     {"p": json.dumps({"restricted_sources": {"google": True}})})
    await db.commit()
    TP.invalidate()
    try:
        by = {c["id"]: c for c in (await client.get("/api/leadgen/connectors")).json()["connectors"]}
        assert by["key_google_places"]["status"] == "off" and "company's rules" in by["key_google_places"]["statusText"]
        assert by["key_tavily"]["status"] == "connected"
    finally:
        TP.invalidate()  # the cached rules would switch Google off for the tests that run next


async def test_the_test_button_shows_real_failures(db, client, keys, monkeypatch):
    from app.providers import registry

    calls = []

    async def fake_test(pid, key):
        calls.append(pid)
        return {"ok": False, "detail": "Hunter rejected the key (401)."} if pid == "hunter" else {"ok": True, "detail": "Key works. 900 credits left."}

    monkeypatch.setattr(registry, "test_key", fake_test)
    keys["finders"] = {"hunter": "k1"}
    res = (await client.post("/api/leadgen/connectors/email_finders/test")).json()
    assert res["ok"] is False and res["detail"].startswith("0 of 1 e-mail finders answered") and "Hunter" not in json.dumps(res)
    again = (await client.post("/api/leadgen/connectors/email_finders/test")).json()
    assert again.get("refused") is True and calls == ["hunter"]  # not asked twice in half a minute

    assert (await client.post("/api/leadgen/connectors/key_tavily/test")).json()["detail"] == "There's no key to check."
    keys["others"]["tavily"] = "k3"
    monkeypatch.setattr(CC, "_LAST_TEST", {})
    tav = (await client.post("/api/leadgen/connectors/key_tavily/test")).json()
    assert tav["ok"] is True and tav["detail"] == "It answered: it's working." and "credits" not in tav["detail"]

    keys["others"]["provero_tps"] = "k2"
    paid = (await client.post("/api/leadgen/connectors/provero_tps/test")).json()
    assert paid["ok"] is False and "paid look-up" in paid["detail"] and "provero_tps" not in calls
    nothing = (await client.post("/api/leadgen/connectors/ds_companies_house/test")).json()
    assert nothing.get("refused") is True


async def test_only_admins_test_connectors(db, keys):
    import httpx

    from app.main import app
    from tests.conftest import make_user

    _, token = await make_user(db, "worker", "Operator")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as c:
        assert (await c.post("/api/leadgen/connectors/email_finders/test")).status_code == 403
        seen = await c.get("/api/leadgen/connectors")
        assert seen.status_code == 200 and seen.json()["canTest"] is False


async def test_staff_see_a_companys_connectors_with_supplier_names(db, staff, keys):
    await _registers_and_records(db)
    await CC.refresh_stats()
    keys["finders"] = {"hunter": "k1", "icypeas": "k2"}
    body = (await staff.get("/api/admin-api/connectors", params={"orgId": "org_default"})).json()
    by = {c["id"]: c for c in body["connectors"]}
    assert by["import_bn_leads"]["name"] == "Licensed business data (BN leads file)"
    assert {p["id"] for p in by["email_finders"]["parts"] if p["connected"]} == {"hunter", "icypeas"}
    assert by["ds_cqc"]["lastError"] == "HTTP 500 from the CQC API"


async def test_lead_sources_are_served(client):
    body = (await client.get("/api/leadgen/sources")).json()
    origins = {o["key"]: o["label"] for o in body["origins"]}
    assert origins["inbound_call"] == "Inbound call" and origins["social"] == "Social" and origins["scout"] == "Find Leads"
    prov = {p["key"]: p for p in body["provenance"]}
    assert prov["google_places"]["exportable"] is False and prov["import_bn_leads"]["viewOnlyFields"] == ["phone", "website"]


async def test_saving_a_lead_keeps_its_real_origin(db, client):
    saved = await client.post("/api/leads/accounts", json={"accounts": [{"name": "Social Co Ltd", "source": "social"},
                                                                        {"name": "Search Co Ltd", "source": "find_leads"},
                                                                        {"name": "Odd Co Ltd", "source": "zzz"}]})
    assert saved.status_code == 200, saved.text
    listed = {a["name"]: a["source"] for a in (await client.get("/api/leads/accounts")).json()["accounts"]}
    assert listed == {"Social Co Ltd": "social", "Search Co Ltd": "scout", "Odd Co Ltd": "manual"}


# -- Phase 1: every value keeps the source that really listed it -----------------------------------------------------------------------
def _biz(raw, **kw):
    base = {"id": "br1", "website": "", "domain": "", "phone": "", "email": "", "confidence_tier": "verified_registry", "raw_data": raw,
            "shared_research": None}
    return SimpleNamespace(**{**base, **kw})


def test_contact_points_file_a_copied_value_under_its_real_source():
    from app.services import contact_points as CP

    raw = {"ds_companies_house": {"company_number": "01234567"}, "import_bn_leads": BN,
           "import_scrapegraph_bn": {"phone": "01273 999888", "email": "sales@acme-widgets.co.uk"},
           "ds_charity_commission": {"phone": "01273 111222"}}
    pts = {(p["kind"], p["value"]): (p["source"], p["confidence"]) for p in CP.points_of(_biz(raw, phone="01273 555123", website="https://acme-widgets.co.uk",
                                                                                               email="hello@acme-widgets.co.uk"))}
    assert pts[("phone", "01273 555123")] == ("google_places", "found")  # the BN file's phone is Google's, not the register's
    assert pts[("website", "https://acme-widgets.co.uk")] == ("google_places", "found")
    assert pts[("email", "hello@acme-widgets.co.uk")] == ("licensed", "found")
    assert pts[("phone", "01273 999888")] == ("scrape", "found")
    assert pts[("phone", "01273 111222")] == ("register", "register")  # a register really published this one
    alone = CP.points_of(_biz({"ds_companies_house": {}}, phone="01273 444555"))
    assert [(p["source"], p["confidence"]) for p in alone] == [("record", "found")]


def test_a_value_an_open_source_also_lists_is_filed_under_the_open_source():
    from app.services import contact_points as CP

    raw = {"import_bn_leads": BN, "import_scrapegraph_bn": {"phone": "01273 555123"}}
    pts = {(p["kind"], p["norm"]): p["source"] for p in CP.points_of(_biz(raw))}
    assert pts[("phone", CP.norm("phone", "01273 555123"))] == "scrape"


def test_record_source_never_calls_a_scraped_or_licensed_value_register():
    rec = _record({"import_scrapegraph_bn": {"phone": "01273 555123"}, "import_bn_leads": {"Email": "hello@acme-widgets.co.uk"},
                   "ds_charity_commission": {"website": "https://acme-widgets.co.uk"}})
    assert DP.record_source(rec, "phone") == "scrape" and DP.record_source(rec, "email") == "licensed"
    assert DP.record_source(rec, "website") == "register:charity"
    assert DP.record_source(_record({}), "phone") == "register" and DP.record_source(_record({}), "phone", default="record") == "record"
    assert DP.public_source("register:charity") == "register"


def test_the_company_page_says_on_the_register_only_for_a_register():
    from app.services.company_profile import _contact

    biz = _biz({"import_scrapegraph_bn": {"phone": "01273 555123"}, "ds_cqc": {"website": "https://acme-care.co.uk"}})
    out = _contact({"phone": "01273 555123", "website": "https://acme-care.co.uk", "email": "x@y.co.uk"}, biz)
    assert (out["phone"]["source"], out["phone"]["label"]) == ("scrape", "From a web scrape")
    assert (out["website"]["source"], out["website"]["label"]) == ("register", "On the register")
    assert (out["email"]["source"], out["email"]["label"]) == ("record", "On our company record")


async def _old_labels(db):
    from app.core.tenancy import org_scope
    from app.models.models import BusinessRecord, CompanyContactPoint as P, LeadAccount
    from app.services import contact_points as CP

    db.add_all([BusinessRecord(id="br1", identity_hash="h1", name="Acme Widgets Ltd", phone="01273 555123", email="hello@acme-widgets.co.uk",
                               confidence_tier="verified_registry", raw_data={"ds_companies_house": {}, "import_bn_leads": BN}),
                BusinessRecord(id="br2", identity_hash="h2", name="Other Ltd", phone="01273 999888", confidence_tier="verified_registry",
                               raw_data={"import_scrapegraph_bn": {"phone": "01273 999888"}, "ds_cqc": {"phone": "01273 111222"}})])
    await db.flush()
    # what the old code wrote: the record's own values as "record"/"register", and the bulk datasets as "register"
    for i, (biz, kind, value, src) in enumerate((("br1", "phone", "01273 555123", "record"), ("br1", "email", "hello@acme-widgets.co.uk", "record"),
                                                  ("br2", "phone", "01273 999888", "record"), ("br2", "phone", "01273 111222", "register"))):
        db.add(P(id=f"cp{i}", business_record_id=biz, kind=kind, value=value, norm=CP.norm(kind, value), source=src, confidence="register"))
    await db.commit()
    with org_scope("org_default"):
        db.add_all([LeadAccount(id="la1", org_id="org_default", name="Acme Widgets Ltd", business_record_id="br1", phone="01273 555123", source="scout"),
                    LeadAccount(id="la2", org_id="org_default", name="Other Ltd", business_record_id="br2", phone="01273 999888",
                                email="me@other.co.uk", source="import"),
                    LeadAccount(id="la3", org_id="org_default", name="Typed Ltd", phone="01273 000111", source="manual")])
        await db.commit()


async def test_the_repair_is_a_dry_run_until_applied(db, staff):
    from sqlalchemy import select

    from app.core.tenancy import system_scope
    from app.models.models import CompanyContactPoint as P, LeadAccount

    await _old_labels(db)
    dry = (await staff.post("/api/admin-api/maintenance/provenance", json={})).json()
    cp, saved = dry["contactPoints"], dry["savedCompanies"]
    assert cp["applied"] is False and cp["records"] == 2 and cp["rows"] == 3
    assert cp["changes"] == {"record/register -> google_places/found": 1, "record/register -> licensed/found": 1, "record/register -> scrape/found": 1}
    assert saved["values"] == 3 and saved["bySource"] == {"google_places": 1, "scrape": 1, "import": 1} and saved["leftAlone"] == 1
    with system_scope():
        await db.rollback()
        assert {p.source for p in (await db.execute(select(P))).scalars().all()} == {"record", "register"}  # nothing written
        assert all(not a.field_sources for a in (await db.execute(select(LeadAccount))).scalars().all())

    done = (await staff.post("/api/admin-api/maintenance/provenance", json={"apply": True})).json()
    assert done["contactPoints"]["rows"] == 3 and done["savedCompanies"]["values"] == 3
    with system_scope():
        await db.rollback()
        pts = {p.id: (p.source, p.confidence) for p in (await db.execute(select(P))).scalars().all()}
        assert pts == {"cp0": ("google_places", "found"), "cp1": ("licensed", "found"), "cp2": ("scrape", "found"), "cp3": ("register", "register")}
        leads = {a.id: a.field_sources for a in (await db.execute(select(LeadAccount))).scalars().all()}
    assert leads["la1"] == {"phone": "google_places"} and leads["la2"] == {"phone": "scrape", "email": "import"} and not leads["la3"]
    again = (await staff.post("/api/admin-api/maintenance/provenance", json={})).json()
    assert again["contactPoints"]["rows"] == 0 and again["savedCompanies"]["values"] == 0  # safe to run twice


def test_find_leads_can_filter_on_the_bulk_datasets():
    from app.services import business_records as BR

    assert BR.DATA_FROM["data"] == ("licensed", "scrape")


# -- Phase 2: where each company came from, on the screens --------------------------------------------------------------------------
def test_how_a_company_joined_in_words():
    assert SC.origin_detail("file:members-2026.csv") == {"text": "From the file members-2026.csv", "url": ""}
    assert SC.origin_detail("form:frm_1")["text"] == "From one of your web forms"
    assert SC.origin_detail("booking:post_9")["text"] == "Booked through your booking page"
    assert SC.origin_detail("https://www.linkedin.com/in/someone") == {"text": "From this post or profile", "url": "https://www.linkedin.com/in/someone"}
    assert SC.origin_detail("") == {"text": "", "url": ""} and SC.origin_detail("weird") == {"text": "", "url": ""}
    assert SC.registers_of({"ds_companies_house": {}, "import_bn_leads": {}, "ds_cqc": {}}) == ["Companies House", "Care Quality Commission"]


async def test_the_lead_sources_summary_counts_only_the_companys_own(db, client):
    from app.core.tenancy import org_scope
    from app.models.models import LeadAccount
    from tests.conftest import make_user

    await make_user(db, "other", "Admin", org_id="org_other")
    with org_scope("org_default"):
        db.add_all([LeadAccount(id="a1", org_id="org_default", name="A", source="import", stage="won", phone="01273 1", field_sources={"phone": "import"}),
                    LeadAccount(id="a2", org_id="org_default", name="B", source="import", stage="contacted", phone="01273 2", field_sources={"phone": "register:ch"}),
                    LeadAccount(id="a3", org_id="org_default", name="C", source="scout", stage="new", email="x@c.co.uk"),
                    LeadAccount(id="a4", org_id="org_default", name="D", source="inbound_call", stage="meeting", phone="01273 4")])
        await db.commit()
    with org_scope("org_other"):
        db.add(LeadAccount(id="o1", org_id="org_other", name="Not mine", source="import", stage="won"))
        await db.commit()
    body = (await client.get("/api/leadgen/sources/summary")).json()
    assert body["total"] == 4
    rows = {o["key"]: o for o in body["origins"]}
    assert rows["import"]["count"] == 2 and rows["import"]["label"] == "Your file"
    assert rows["import"]["reached"] == {"contacted": 2, "interested": 1, "meeting": 1, "won": 1}
    assert rows["inbound_call"]["reached"]["meeting"] == 1 and rows["scout"]["reached"]["contacted"] == 0
    phones = next(f for f in body["coverage"] if f["field"] == "phone")
    assert phones["with"] == 3 and {s["label"]: s["count"] for s in phones["bySource"]} == {"Your file": 1, "Official register": 1, "Not recorded": 1}


async def test_credits_are_counted_by_where_the_companies_came_from(db, client):
    """Cost per source: each charge goes to the origin of the company it was for, from what the charge already names."""
    from app.core.tenancy import org_scope
    from app.models.models import BusinessRecord, CreditEntry, EmailMessage, LeadAccount
    from app.services.credits import _put_doc

    db.add_all([BusinessRecord(id="br_a", identity_hash="ha", name="A Ltd"), BusinessRecord(id="br_b", identity_hash="hb", name="B Ltd")])
    await db.commit()
    with org_scope("org_default"):
        db.add_all([LeadAccount(id="la_a", org_id="org_default", name="A Ltd", source="import", business_record_id="br_a"),
                    LeadAccount(id="la_b", org_id="org_default", name="B Ltd", source="scout", business_record_id="br_b"),
                    LeadAccount(id="la_c", org_id="org_default", name="C Ltd", source="manual", email="ann@c.test")])
        def use(ref, n):
            return CreditEntry(id=f"cr_{ref[:20]}", kind="usage", wallet="leadgen", item="lead_lookup", quantity=1, amount=-n, ref=ref)
        db.add_all([use("lead:br_a:email", 5), use("deepsearch:br_b:website", 5), use("chk_job1:web", 10), use("email:msg_0123456789ab", 1),
                    use("lead:0123456789abcdef", 20), use("lead:br_gone:phone", 3)])
        db.add(EmailMessage(id="msg_0123456789abcdef-x", recipient_email="ann@c.test"))
        await _put_doc(db, "checkids:org_default:chk_job1", {"ids": ["la_a", "la_b"]})
        await db.commit()
    body = (await client.get("/api/leadgen/sources/summary")).json()
    credits = {o["key"]: o["credits"] for o in body["origins"]}
    assert credits == {"import": 10, "scout": 10, "manual": 1}  # the check run is split over the two companies it checked
    assert body["credits"] == {"searches": 20, "removed": 3, "total": 44}


# -- statuses that tell the truth (2026-11-27) ------------------------------------------------------------------------------------
async def test_an_old_load_is_out_of_date_and_a_paused_people_job_says_so(db, client, keys):
    await _registers_and_records(db)
    now = datetime.utcnow()
    from app.models.models import DataSource

    db.add(DataSource(id="ds_charity_commission", name="Charity Commission", kind="api", run_state="idle"))
    await db.flush()
    await db.execute(text("INSERT INTO data_source_runs (id, source_id, status, error_message, started_at, finished_at, cursor) VALUES "
                          "('r4', 'ds_charity_commission', 'done', '', :old, :old, NULL), "
                          "('r5', 'ds_companies_house', 'paused', '', :n, NULL, CAST(:c AS JSON))"),
                     {"old": now - timedelta(days=50), "n": now, "c": json.dumps({"job": "people"})})
    await db.commit()
    by = {c["id"]: c for c in (await client.get("/api/leadgen/connectors")).json()["connectors"]}
    cc = by["ds_charity_commission"]
    assert cc["status"] == "stale" and cc["statusLabel"] == "Out of date" and "last updated on" in cc["statusText"]
    assert by["ds_food_hygiene"]["status"] == "connected"  # loaded 3 days ago
    assert by["ds_companies_house"]["status"] == "paused" and "directors" in by["ds_companies_house"]["statusText"]


async def test_a_provider_with_no_credit_left_is_out_of_credit(db, client, keys):
    from app.models.models import AppSetting

    keys["others"]["telnyx_lookup"] = "k"
    now = datetime.utcnow().isoformat() + "+00:00"
    db.add_all([AppSetting(id="balance_history:tavily", data={"points": [{"t": now, "remaining": 0.0}]}),
                AppSetting(id="balance_history:telnyx", data={"points": [{"t": "2026-01-01T00:00:00+00:00", "remaining": 0.0}]})])
    await db.commit()
    by = {c["id"]: c for c in (await client.get("/api/leadgen/connectors")).json()["connectors"]}
    assert by["key_tavily"]["status"] == "no_credit" and by["key_tavily"]["statusLabel"] == "Out of credit"
    assert by["key_tavily"]["testable"] is True
    assert by["telnyx_lookup"]["status"] == "connected"  # an old zero reading doesn't count


async def test_the_ai_keys_can_be_checked_for_free(db, client, keys, monkeypatch):
    seen = []

    async def ai_key(word, org_id):
        return "k" if word == "openai" else ""

    async def ai_check(word, key):
        seen.append(word)
        return {"ok": False, "detail": "The key was rejected (401)."}

    monkeypatch.setattr(CC, "_ai_key", ai_key)
    monkeypatch.setattr(CC, "_ai_check", ai_check)
    by = {c["id"]: c for c in (await client.get("/api/leadgen/connectors")).json()["connectors"]}
    assert by["key_openai"]["testable"] is True
    res = (await client.post("/api/leadgen/connectors/key_openai/test")).json()
    assert res["ok"] is False and "isn't working" in res["detail"] and "401" not in res["detail"] and seen == ["openai"]
    assert (await client.post("/api/leadgen/connectors/key_deepseek/test")).json()["detail"] == "There's no key to check."


async def test_tavily_with_no_credits_left_fails_its_check():
    import httpx

    from app.providers.search.tavily import PROVIDER

    def handler(req):
        return httpx.Response(200, json={"account": {"plan_limit": 1000, "plan_usage": 1000, "paygo_limit": None}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        r = await PROVIDER.test(c, "k")
    assert r.ok is False and "used all its credits" in r.detail
