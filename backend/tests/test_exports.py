"""Admin downloads and the Salesforce update file: view-only values stay out, counts are shown first, every download is audited."""
import csv
import io
from datetime import datetime, timedelta

import httpx
import pytest

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import AuditLog, BusinessRecord, FsbImport, FsbImportRow, LeadAccount, PhoneScreening
from app.services import tenant_policy as TP
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def _rows(resp):
    assert resp.content.startswith(b"\xef\xbb\xbf")
    return list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))


async def _seed(db, org):
    """Three companies: Alpha (Google phone, own-site website), Beta (own phone, a formula-looking name), Gamma (Apollo email)."""
    with org_scope(org):
        db.add_all([
            LeadAccount(id="la_a", name="Alpha Ltd", phone="01273 111111", website="alpha.example", email="", contact_name="Ann Alpha", contact_title="Owner",
                        field_sources={"phone": "google_places", "website": "website"}),
            LeadAccount(id="la_b", name="=Beta Ltd", phone="01273 222222", website="", email="hi@beta.example", field_sources={"phone": "user", "email": "user"}),
            LeadAccount(id="la_g", name="Gamma Ltd", phone="", website="", email="g@apollo.example", field_sources={"email": "apollo"}),
        ])
        await db.commit()


async def _list(c, ids, name="L1"):
    r = await c.post("/api/leads/lists", json={"name": name, "ids": ids})
    assert r.status_code == 200, r.text
    return r.json()["list"]["id"]


async def test_admin_only_and_preview_counts(db):
    await make_user(db, "adm", "Admin", org_id="org_ex1")
    _, tok_admin = await make_user(db, "adm2", "Admin", org_id="org_ex1")
    _, tok_op = await make_user(db, "oper", "Operator", org_id="org_ex1")
    await _seed(db, "org_ex1")
    body = {"kind": "companies", "scope": {"ids": ["la_a", "la_b", "la_g"]}}
    async with _client(tok_op) as c:  # an ordinary user may export until an admin switches it off for them (services/data_access.py)
        assert (await c.post("/api/exports/preview", json=body)).status_code == 200
    async with _client(tok_admin) as c:
        op_id = (await c.get("/api/org/data-access")).json()["users"]
        op_id = next(u["id"] for u in op_id if u["username"] == "oper")
        assert (await c.put(f"/api/org/data-access/{op_id}", json={"allow_export": False})).status_code == 200
    async with _client(tok_op) as c:
        for path, payload in (("/api/exports/preview", body), ("/api/exports", {**body, "format": "wide"})):
            r = await c.post(path, json=payload)
            assert r.status_code == 403 and r.json()["code"] == "export_off"
    async with _client(tok_admin) as c:
        p = (await c.post("/api/exports/preview", json=body)).json()
        assert p["rows"] == 3 and p["withheld"] == 2 and p["withheld_fields"] == {"phone": 1, "website": 0, "email": 1}
        assert p["restricted_sources"] == ["apollo", "google_places"] and p["popup"].startswith("Some of this data")
        assert p["unscreened_phones"] == 1  # Beta's phone has no TPS result
        none = (await c.post("/api/exports/preview", json={"kind": "companies", "scope": {"ids": ["la_b"]}})).json()
        assert none["withheld"] == 0 and none["popup"] == ""
        assert (await c.post("/api/exports/preview", json={"kind": "companies", "scope": {}})).status_code == 400


async def test_csv_drops_restricted_values_and_is_audited(db):
    _, tok = await make_user(db, "adm", "Admin", org_id="org_ex2")
    await _seed(db, "org_ex2")
    async with _client(tok) as c:
        lid = await _list(c, ["la_a", "la_b", "la_g"])
        r = await c.post("/api/exports", json={"kind": "companies", "scope": {"list_id": lid}, "format": "wide"})
        assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
        assert r.headers["x-withheld-count"] == "2" and r.headers["x-export-rows"] == "3"
        rows = _rows(r)
        assert rows[0][-1] == "restricted_values_withheld" and rows[0][rows[0].index("phone") + 1] == "tps_status"
        text = r.content.decode()
        assert "01273 111111" not in text and "g@apollo.example" not in text and "alpha.example" in text and "hi@beta.example" in text
        by = {x[1]: x for x in rows[1:]}
        assert by["Alpha Ltd"][-1] == "1" and by["'=Beta Ltd"][-1] == "0"  # the name that starts with = is written as text
        assert by["Alpha Ltd"][rows[0].index("phone")] == ""
    with org_scope("org_ex2"):
        audit = (await db.execute(AuditLog.__table__.select().where(AuditLog.action == "export.created"))).all()
    assert len(audit) == 1
    assert audit[0].detail == {"kind": "companies", "rows": 3, "withheld": 2, "scope": "list", "format": "wide"}


async def test_long_format_has_a_source_per_value(db):
    _, tok = await make_user(db, "adm", "Admin", org_id="org_ex3")
    await _seed(db, "org_ex3")
    async with _client(tok) as c:
        r = await c.post("/api/exports", json={"kind": "companies", "scope": {"ids": ["la_a", "la_b"]}, "format": "long", "fields": ["phone", "website"]})
        rows = _rows(r)
        assert rows[0] == ["company_id", "name", "field", "value", "source", "tps_status", "restricted_values_withheld"]
        got = {(x[0], x[2]): x for x in rows[1:]}
        assert got[("la_a", "website")][3:5] == ["alpha.example", "website"] and ("la_a", "phone") not in got
        assert got[("la_b", "phone")][3:6] == ["01273 222222", "user", "unknown"]
        assert (await c.post("/api/exports", json={"kind": "companies", "scope": {"ids": ["la_a"]}, "fields": ["bogus"]})).status_code == 400


async def test_people_export_uses_the_same_rules(db):
    _, tok = await make_user(db, "adm", "Admin", org_id="org_ex4")
    await _seed(db, "org_ex4")
    async with _client(tok) as c:
        r = await c.post("/api/exports", json={"kind": "people", "scope": {"ids": ["la_a", "la_b"]}, "format": "wide"})
        rows = _rows(r)
        assert rows[0][:3] == ["company_id", "company_name", "person"]
        assert [x[2] for x in rows[1:]] == ["Ann Alpha"]  # Beta has no contact; Alpha's phone is Google's
        assert rows[1][rows[0].index("title")] == "Owner" and rows[1][rows[0].index("phone")] == "" and rows[1][-1] == "1"


async def test_row_cap_and_empty_and_other_organisation(db):
    _, tok = await make_user(db, "adm", "Admin", org_id="org_ex5")
    _, other = await make_user(db, "adm_o", "Admin", org_id="org_ex5b")
    await _seed(db, "org_ex5")
    async with _client(tok) as c:
        lid = await _list(c, ["la_a"])
        from app.services import export_engine as EE

        old = EE.MAX_ROWS
        EE.MAX_ROWS = 1
        try:
            r = await c.post("/api/exports", json={"kind": "companies", "scope": {"ids": ["la_a", "la_b"]}})
            assert r.status_code == 400 and "up to 1" in r.json()["detail"]
        finally:
            EE.MAX_ROWS = old
        assert (await c.post("/api/exports", json={"kind": "companies", "scope": {"ids": [f"x{i}" for i in range(20001)]}})).status_code == 422
    async with _client(other) as c:
        assert (await c.post("/api/exports/preview", json={"kind": "companies", "scope": {"list_id": lid}})).status_code == 404
        assert (await c.post("/api/exports/preview", json={"kind": "companies", "scope": {"ids": ["la_a"]}})).json()["rows"] == 0
        assert (await c.post("/api/exports", json={"kind": "companies", "scope": {"ids": ["la_a"]}})).status_code == 404


async def test_unscreened_phones_blocked_only_when_the_policy_asks(db):
    from app.models.models import Brand, Organization
    from sqlalchemy import update

    _, tok = await make_user(db, "adm", "Admin", org_id="org_ex6")
    await _seed(db, "org_ex6")
    db.add_all([PhoneScreening(number="+441273222222", tps_status="clear", ctps=False, screened_at=datetime.utcnow()),
                PhoneScreening(number="+441273111111", tps_status="listed", ctps=False, screened_at=datetime.utcnow())])
    with org_scope("org_ex6"):
        db.add(LeadAccount(id="la_old", name="Stale Ltd", phone="01273 333333", field_sources={"phone": "website"}))
        db.add(PhoneScreening(number="+441273333333", tps_status="clear", ctps=False, screened_at=datetime.utcnow() - timedelta(days=40)))
        await db.commit()
    ids = ["la_b", "la_old"]
    async with _client(tok) as c:
        r = await c.post("/api/exports", json={"kind": "companies", "scope": {"ids": ids}, "format": "long", "fields": ["phone"]})
        got = {x[0]: x for x in _rows(r)[1:]}
        assert got["la_b"][5] == "clear" and got["la_old"][5] == "unknown"  # nothing blocked, the flag is shown
        db.add(Brand(id="brd_x", name="B", status="active", policy=TP.clean_policy({"screening": {"block_unscreened": True}})))
        await db.flush()
        await db.execute(update(Organization).where(Organization.id == "org_ex6").values(brand_id="brd_x"))
        await db.commit()
        TP.invalidate()
        p = (await c.post("/api/exports/preview", json={"kind": "companies", "scope": {"ids": ids + ["la_a"]}})).json()
        assert p["screening_blocked"] == 1 and p["withheld_fields"]["phone"] == 2 and p["unscreened_phones"] == 1  # stale one; Alpha's is Google's
        r = await c.post("/api/exports", json={"kind": "companies", "scope": {"ids": ids}, "format": "long", "fields": ["phone"]})
        got = {x[0]: x for x in _rows(r)[1:]}
        assert got["la_b"][3] == "01273 222222" and "la_old" in got and got["la_old"][3] == "" and got["la_old"][-1] == "1"


async def _fixture_import(db, org):
    with org_scope(org):
        db.add(FsbImport(id="fsi_t", filename="a.csv", status="done", row_count=5))
        mk = lambda i, n, st, **kw: FsbImportRow(id=f"fsr_{i}", import_id="fsi_t", source_record_id=f"SF{i}", name=n, match_status=st, **kw)
        db.add_all([
            mk(1, "Changed", "auto", match_company_number="00000001", phone="01273 000000", website="old.example", score=1.0),
            mk(2, "Same", "accepted", match_company_number="00000002", phone="01273 555555", website="https://www.same.example/", score=0.9),
            mk(3, "Unmatched", "none"),
            mk(4, "Restricted", "auto", match_company_number="00000004", phone="", website="", score=0.95),
            mk(5, "Review", "review", match_company_number="00000001"),
        ])
        db.add(LeadAccount(id="la_c", name="Changed", registration_number="00000001", phone="01273 999999", website="", field_sources={"phone": "website"}))
        await db.commit()
    db.add_all([
        BusinessRecord(id="br_1", identity_hash="h1", name="Changed", registration_number="00000001", website="new.example", phone="01273 111111",
                       raw_data={"contacts_web": {"website": "new.example", "source": "web", "phones": ["01273 111111"]}}),
        BusinessRecord(id="br_2", identity_hash="h2", name="Same", registration_number="00000002", website="same.example", phone="01273 555555",
                       raw_data={"companies_house": {"website": "same.example"}}),
        BusinessRecord(id="br_4", identity_hash="h4", name="Restricted", registration_number="00000004", website="g.example", phone="01273 444444",
                       raw_data={"google_places": {"website": "g.example", "phone": "01273 444444"}}),
    ])
    db.add(PhoneScreening(number="+441273999999", tps_status="listed", ctps=False, screened_at=datetime.utcnow()))
    await db.commit()


async def test_salesforce_long_file(db):
    _, tok = await make_user(db, "adm", "Admin", org_id="org_sf")
    _, op = await make_user(db, "op", "Operator", org_id="org_sf")
    _, mgr = await make_user(db, "mg", "Manager", org_id="org_sf")
    await _fixture_import(db, "org_sf")
    async with _client(op) as c:
        assert (await c.post("/api/fsb/imports/fsi_t/salesforce.csv", json={})).status_code == 200  # export is on by default for everyone but can be switched off per user
    async with _client(mgr) as c:
        p = (await c.post("/api/fsb/imports/fsi_t/salesforce/preview", json={})).json()
        assert p["rows"] == 2 and p["withheld"] == 2 and p["popup"]  # Restricted: Google phone and website left out
    async with _client(tok) as c:
        r = await c.post("/api/fsb/imports/fsi_t/salesforce.csv", json={"format": "long"})
        assert r.status_code == 200 and r.headers["x-withheld-count"] == "2" and r.headers["x-export-rows"] == "2"
        rows = _rows(r)
        assert rows[0] == ["salesforce_id", "field", "old_value", "new_value", "source", "date_found", "confidence", "tps_status"]
        got = {(x[0], x[1]): x for x in rows[1:]}
        assert set(got) == {("SF1", "phone"), ("SF1", "website")}  # same value, unmatched, review and view-only rows are skipped
        ph = got[("SF1", "phone")]
        assert ph[2:5] == ["01273 000000", "01273 999999", "website"] and ph[6] == "1.0" and ph[7] == "listed"  # our saved value wins over the record's
        assert got[("SF1", "website")][2:5] == ["old.example", "new.example", "website"] and got[("SF1", "website")][7] == ""
        assert "g.example" not in r.text and "444444" not in r.text
        w = _rows(await c.post("/api/fsb/imports/fsi_t/salesforce.csv", json={"format": "wide", "fields": ["phone", "website"]}))
        assert w[0][:5] == ["salesforce_id", "new_phone", "new_website", "new_email", "tps_status"] and len(w) == 2
        assert w[1][:5] == ["SF1", "01273 999999", "new.example", "", "listed"]
        assert (await c.post("/api/fsb/imports/fsi_t/salesforce.csv", json={"fields": ["name"]})).status_code == 400
        assert (await c.post("/api/fsb/imports/nope/salesforce.csv", json={})).status_code == 404
    with org_scope("org_sf"):
        audit = (await db.execute(AuditLog.__table__.select().where(AuditLog.action == "export.salesforce"))).all()
    assert len(audit) == 3 and audit[0].detail["rows"] == 2  # the operator's own download is audited too


async def test_salesforce_blocks_unscreened_phones_when_the_policy_asks(db):
    from app.models.models import Brand, Organization
    from sqlalchemy import update

    _, tok = await make_user(db, "adm", "Admin", org_id="org_sf2")
    await _fixture_import(db, "org_sf2")
    db.add(Brand(id="brd_s", name="B", status="active", policy=TP.clean_policy({"screening": {"block_unscreened": True}})))
    await db.flush()
    await db.execute(update(Organization).where(Organization.id == "org_sf2").values(brand_id="brd_s"))
    await db.commit()
    TP.invalidate()
    async with _client(tok) as c:
        rows = _rows(await c.post("/api/fsb/imports/fsi_t/salesforce.csv", json={"format": "long"}))
        assert {(x[0], x[1]) for x in rows[1:]} == {("SF1", "website")}  # the listed phone is left out


async def test_account_payload_and_company_card_carry_provenance(db):
    from app.services import lead_filters

    _, tok = await make_user(db, "adm", "Admin", org_id="org_pv")
    await _seed(db, "org_pv")
    async with _client(tok) as c:
        r = await c.get("/api/leads/accounts")
        assert r.status_code == 200, r.text
        accts = {a["id"]: a for a in r.json()["accounts"]}
        a = accts["la_a"]
        assert a["phone"] == "01273 111111"  # still shown in the app
        assert a["field_sources"]["phone"] == "google_places" and a["restricted"] == {"phone": True, "website": False, "email": False}
        assert "can't be downloaded" in a["restricted_note"]["phone"] and "website" not in a["restricted_note"]
        assert accts["la_g"]["restricted"]["email"] is True and "enrichment" in accts["la_g"]["restricted_note"]["email"]
        assert accts["la_b"]["restricted"] == {"phone": False, "website": False, "email": False}
    biz = BusinessRecord(id="br_c", identity_hash="hc", name="Card Ltd", phone="01273 777777",
                         raw_data={"contacts_web": {"guardrail": True, "source": "google_places", "phones": ["01273 777777"], "emails": []}})
    card = lead_filters.card(biz)
    assert card["web_phone"] == "01273 777777" and card["restricted"]["web_phone"] is True and card["restricted"]["web_email"] is False


def test_clean_policy_accepts_screening_and_drops_unknown_keys():
    assert TP.default_policy()["screening"] == {"block_unscreened": False}
    p = TP.clean_policy({"screening": {"block_unscreened": 1, "bogus": 1}, "bogus": {"a": 1}})
    assert p["screening"] == {"block_unscreened": True} and "bogus" not in p
    assert TP.clean_policy({"screening": "x"})["screening"] == {"block_unscreened": False}
    assert TP.Policy("o", "b", {"screening": {"block_unscreened": True}}).block_unscreened and not TP.Policy("o").block_unscreened
