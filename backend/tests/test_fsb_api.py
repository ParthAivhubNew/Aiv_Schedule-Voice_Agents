"""FSB import, review queue, monthly change report and registry health, through the API on a real database."""
import asyncio
import io
from datetime import date, datetime

import pytest

from app.core.tenancy import org_scope
from app.models.models import AppSetting, AuditLog, BusinessRecord, ChangeReport, LeadAccount, Organization, RegistryEvent
from tests.conftest import make_staff, make_user

pytestmark = pytest.mark.db

REGISTER = [
    ("00000001", "Seaview Plumbing Limited", "BN1 4AB", "1 Sea Road, Brighton, BN1 4AB", "Active"),
    ("00000002", "Harbour Bakery Ltd", "BN1 4AB", "2 Quay Street, Brighton, BN1 4AB", "Active"),
    ("00000003", "Downland Joinery Limited", "BN2 5CD", "3 Hill Lane, Brighton, BN2 5CD", "Active"),
    ("00000004", "Acme Builders Brighton Limited", "BN1 4AB", "4 Sea Road, Brighton, BN1 4AB", "Dissolved"),
]
HEADER = "Account ID,Account Name,Company Number,Billing Street,Billing City,Billing Postal Code,Phone,Website\n"
FILE = HEADER + "\n".join([
    "A1,Seaview Plumbing Ltd,,1 Sea Road,Brighton,BN1 4AB,,",  # auto: name and postcode
    "A2,Whatever FSB calls it,2,2 Quay Street,Brighton,BN1 4AB,,",  # auto: company number (zeros lost)
    "A3,Downland Joinery Ltd,,3 Hill Lane,Brighton,BN2 9ZZ,,",  # auto: same district
    "A4,Acme Builders Ltd,,4 Sea Road,Brighton,BN1 4AB,,",  # review
    "A5,Zebra Consulting,,9 Nowhere Rd,Brighton,BN1 4AB,,",  # none
    "A6,J Smith Decorating,,1 Lane,Lewes,BN7 1AA,,",  # none (sole trader)
    "A7,Harbour Bakery Limited,,2 Quay Street,Brighton,BN1 4AB,,",  # auto
    "A8,HARBOUR BAKERY LTD,,2 Quay Street,Brighton,bn14ab,,",  # exact duplicate of A7
    "A9,Seaview Plumbing Limitd,,1 Sea Road,Brighton,BN1 4AB,,",  # look-alike of A1: review
]) + "\n"


def h(token):
    return {"Authorization": f"Bearer {token}"}


async def seed_register(db):
    for n, name, pc, addr, status in REGISTER:
        db.add(BusinessRecord(id=f"br_{n}", identity_hash=f"h_{n}", name=name, registration_number=n, postcode=pc, address=addr, status=status,
                              sic_text="Test trade"))
    await db.commit()


async def upload(client, text=FILE, wait=True, headers=None):
    r = await client.post("/api/fsb/imports", files={"file": ("accounts.csv", io.BytesIO(text.encode()), "text/csv")}, headers=headers)
    assert r.status_code == 200, r.text
    imp = r.json()
    if wait:
        imp = await finish(client, imp["id"], headers)
    return imp


async def finish(client, import_id, headers=None):
    for _ in range(100):
        r = await client.get(f"/api/fsb/imports/{import_id}", headers=headers)
        if r.json()["status"] in ("done", "failed"):
            return r.json()
        await asyncio.sleep(0.1)
    raise AssertionError("matching did not finish")


async def rows_of(client, import_id, status=""):
    r = await client.get(f"/api/fsb/imports/{import_id}/rows", params={"status": status, "limit": 500})
    return {x["record_id"]: x for x in r.json()["rows"]}


async def test_import_lands_rows_in_auto_review_none_and_duplicate(client, db):
    await seed_register(db)
    imp = await upload(client)
    assert imp["status"] == "done" and imp["row_count"] == 9 and imp["error"] == ""
    assert imp["counts"] == {"pending": 0, "auto": 4, "review": 2, "none": 2, "accepted": 0, "rejected": 0, "duplicate": 1}
    assert imp["stats"]["processed"] == 9 and imp["stats"]["thresholds"] == {"auto": 0.92, "review": 0.7}
    rows = await rows_of(client, imp["id"])
    assert {k: rows[k]["match_status"] for k in rows} == {"A1": "auto", "A2": "auto", "A3": "auto", "A4": "review", "A5": "none", "A6": "none",
                                                           "A7": "auto", "A8": "duplicate", "A9": "review"}
    assert rows["A2"]["match_company_number"] == "00000002" and rows["A2"]["score"] == 1.0
    assert rows["A3"]["match_company_number"] == "00000003" and "district" in rows["A3"]["reason"]
    assert rows["A8"]["duplicate_of"] == rows["A7"]["id"]
    assert rows["A9"]["duplicate_of"] == rows["A1"]["id"] and rows["A9"]["candidates"]  # a look-alike: a person decides which company it is
    assert rows["A4"]["candidates"][0]["company_number"] == "00000004"
    only = (await client.get(f"/api/fsb/imports/{imp['id']}/rows", params={"status": "review"})).json()
    assert only["total"] == 2
    assert (await client.get(f"/api/fsb/imports/{imp['id']}/rows", params={"status": "bogus"})).status_code == 400
    assert [i["id"] for i in (await client.get("/api/fsb/imports")).json()["imports"]] == [imp["id"]]
    audit = (await db.execute(AuditLog.__table__.select().where(AuditLog.action == "fsb.import_uploaded"))).all()
    assert len(audit) == 1


async def test_duplicates_file(client, db):
    await seed_register(db)
    imp = await upload(client)
    r = await client.get(f"/api/fsb/imports/{imp['id']}/duplicates.csv")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("kind,account_id") and len(lines) == 3
    assert any(l.startswith("exact,A8,") and ",A7," in l for l in lines) and any(l.startswith("similar,A9,") for l in lines)


async def test_json_rows_and_bad_uploads(client, db):
    await seed_register(db)
    r = await client.post("/api/fsb/imports", json={"filename": "x.json", "rows": [{"Account ID": "J1", "Account Name": "Harbour Bakery Ltd", "Billing Postal Code": "BN1 4AB"}]})
    assert r.status_code == 200 and (await finish(client, r.json()["id"]))["counts"]["auto"] == 1
    assert (await client.post("/api/fsb/imports", json={"rows": []})).status_code == 400
    bad = await client.post("/api/fsb/imports", files={"file": ("a.csv", io.BytesIO(b"Phone,Website\n1,2\n"), "text/csv")})
    assert bad.status_code == 400 and "Account ID" in bad.json()["detail"]
    assert (await client.post("/api/fsb/imports", files={"other": ("a.csv", io.BytesIO(b"x"), "text/csv")})).status_code == 400


async def test_exclusions_do_not_hide_fsb_own_records(client, db):
    """FSB's own records match even when the brand policy would hide them from prospect search."""
    await seed_register(db)
    from app.models.models import SuppressedCompany

    with org_scope("org_default"):
        db.add(SuppressedCompany(company_number="00000002", label="member"))
        await db.commit()
    imp = await upload(client)
    assert (await rows_of(client, imp["id"]))["A2"]["match_status"] == "auto"


async def test_thresholds_are_changeable_by_an_admin_and_used(client, db):
    await seed_register(db)
    assert (await client.get("/api/fsb/settings")).json() == {"auto": 0.92, "review": 0.7}
    assert (await client.put("/api/fsb/settings", json={"auto": 0.5, "review": 0.7})).status_code == 400
    assert (await client.put("/api/fsb/settings", json={"auto": 0.999, "review": 0.95})).json() == {"auto": 0.999, "review": 0.95}
    imp = await upload(client)
    rows = await rows_of(client, imp["id"])
    assert rows["A4"]["match_status"] == "none" and rows["A4"]["candidates"]  # 0.78 is now below the review line
    assert rows["A2"]["match_status"] == "auto"  # a given company number is always 1.0
    n = (await db.execute(AuditLog.__table__.select().where(AuditLog.action == "fsb.settings_changed"))).all()
    assert len(n) == 1


async def test_review_decisions_update_counts_and_are_audited_once(client, db):
    await seed_register(db)
    imp = await upload(client)
    rows = await rows_of(client, imp["id"])
    queue = (await client.get("/api/review-queue", params={"import": imp["id"]})).json()
    assert queue["total"] == 2
    item = next(i for i in queue["items"] if i["fsb"]["record_id"] == "A4")
    assert item["fsb"]["name"] == "Acme Builders Ltd" and item["fsb"]["postcode"] == "BN1 4AB" and item["fsb"]["address"] == "4 Sea Road, Brighton"
    assert item["candidate"]["company_number"] == "00000004" and item["candidate"]["status"] == "Dissolved" and item["candidate"]["sic_text"] == "Test trade"
    assert item["candidate"]["name"] == "Acme Builders Brighton Limited" and "address" in item["candidate"] and item["score"] and item["reason"]

    a4, a9 = rows["A4"]["id"], rows["A9"]["id"]
    r = await client.post(f"/api/review-queue/{a4}/decision", json={"decision": "accept"})
    assert r.status_code == 200 and r.json()["changed"] is True and r.json()["row"]["match_company_number"] == "00000004"
    assert r.json()["counts"]["accepted"] == 1 and r.json()["counts"]["review"] == 1
    again = await client.post(f"/api/review-queue/{a4}/decision", json={"decision": "accept"})
    assert again.status_code == 200 and again.json()["changed"] is False
    assert len((await db.execute(AuditLog.__table__.select().where(AuditLog.action == "review.accepted"))).all()) == 1

    assert (await client.post(f"/api/review-queue/{a9}/decision", json={"decision": "pick", "company_number": "12345678"})).status_code == 400
    assert (await client.post(f"/api/review-queue/{a9}/decision", json={"decision": "pick"})).status_code == 400
    picked = await client.post(f"/api/review-queue/{a9}/decision", json={"decision": "pick", "company_number": "00000001"})
    assert picked.status_code == 200 and picked.json()["row"]["match_status"] == "accepted" and picked.json()["row"]["match_company_number"] == "00000001"
    assert (await client.post(f"/api/review-queue/{rows['A5']['id']}/decision", json={"decision": "reject"})).status_code == 409  # not in the queue
    assert (await client.post(f"/api/review-queue/{a4}/decision", json={"decision": "maybe"})).status_code == 400
    assert (await client.post("/api/review-queue/nope/decision", json={"decision": "reject"})).status_code == 404

    # the same person may change their mind
    rej = await client.post(f"/api/review-queue/{a4}/decision", json={"decision": "reject"})
    assert rej.status_code == 200 and rej.json()["row"]["match_status"] == "rejected" and rej.json()["row"]["match_company_number"] == ""
    counts = (await client.get(f"/api/fsb/imports/{imp['id']}")).json()["counts"]
    assert counts["accepted"] == 1 and counts["rejected"] == 1 and counts["review"] == 0
    assert (await client.get("/api/review-queue", params={"import": imp["id"]})).json()["total"] == 0
    decided = (await client.get("/api/review-queue", params={"import": imp["id"], "status": "decided"})).json()
    assert decided["total"] == 2
    actions = sorted(a.action for a in (await db.execute(AuditLog.__table__.select().where(AuditLog.action.like("review.%")))).all())
    assert actions == ["review.accepted", "review.picked", "review.rejected"]


async def test_someone_elses_decision_is_not_overwritten(client, db):
    await seed_register(db)
    imp = await upload(client)
    row = (await rows_of(client, imp["id"]))["A4"]
    assert (await client.post(f"/api/review-queue/{row['id']}/decision", json={"decision": "accept"})).status_code == 200
    _, mtoken = await make_user(db, "mina", "Manager")
    same = await client.post(f"/api/review-queue/{row['id']}/decision", json={"decision": "accept"}, headers=h(mtoken))
    assert same.status_code == 200 and same.json()["changed"] is False
    other = await client.post(f"/api/review-queue/{row['id']}/decision", json={"decision": "reject"}, headers=h(mtoken))
    assert other.status_code == 409


async def test_only_admins_and_managers_can_use_it(client, db):
    await seed_register(db)
    imp = await upload(client)
    _, mgr = await make_user(db, "mina", "Manager")
    _, op = await make_user(db, "olly", "Operator")
    _, view = await make_user(db, "vera", "Viewer")
    reads = ["/api/fsb/imports", f"/api/fsb/imports/{imp['id']}", f"/api/fsb/imports/{imp['id']}/rows", f"/api/fsb/imports/{imp['id']}/duplicates.csv",
             "/api/review-queue", "/api/change-reports", "/api/fsb/settings"]
    for tok in (op, view):
        for path in reads:
            assert (await client.get(path, headers=h(tok))).status_code == 403, path
        assert (await client.post("/api/fsb/imports", json={"rows": [{"Account ID": "1", "Account Name": "x"}]}, headers=h(tok))).status_code == 403
        assert (await client.post("/api/review-queue/x/decision", json={"decision": "reject"}, headers=h(tok))).status_code == 403
        assert (await client.post("/api/change-reports/run", json={"start": "2026-10-01", "end": "2026-10-31"}, headers=h(tok))).status_code == 403
    for path in reads:
        assert (await client.get(path, headers=h(mgr))).status_code == 200, path
    assert (await client.put("/api/fsb/settings", json={"auto": 0.9, "review": 0.6}, headers=h(mgr))).status_code == 403  # admins only
    assert (await client.get("/api/fsb/imports", headers={"Authorization": ""})).status_code in (401, 403)


async def test_another_organisation_sees_nothing(client, db):
    await seed_register(db)
    imp = await upload(client)
    row = (await rows_of(client, imp["id"]))["A4"]
    db.add(Organization(id="org_b", name="B", slug="b"))
    await db.commit()
    _, tok = await make_user(db, "bob", "Admin", org_id="org_b")
    assert (await client.get("/api/fsb/imports", headers=h(tok))).json()["imports"] == []
    assert (await client.get(f"/api/fsb/imports/{imp['id']}", headers=h(tok))).status_code == 404
    assert (await client.get(f"/api/fsb/imports/{imp['id']}/rows", headers=h(tok))).status_code == 404
    assert (await client.get("/api/review-queue", headers=h(tok))).json()["total"] == 0
    assert (await client.post(f"/api/review-queue/{row['id']}/decision", json={"decision": "accept"}, headers=h(tok))).status_code == 404
    assert (await client.get("/api/change-reports", headers=h(tok))).json()["reports"] == []
    # thresholds are per organisation too
    await client.put("/api/fsb/settings", json={"auto": 0.97, "review": 0.8})
    assert (await client.get("/api/fsb/settings", headers=h(tok))).json() == {"auto": 0.92, "review": 0.7}


async def test_a_restart_carries_the_import_on_from_its_pending_rows(client, db):
    await seed_register(db)
    imp = await upload(client)
    from sqlalchemy import update

    from app.models.models import FsbImport, FsbImportRow

    with org_scope("org_default"):
        await db.execute(update(FsbImport).where(FsbImport.id == imp["id"]).values(status="matching"))
        await db.execute(update(FsbImportRow).where(FsbImportRow.import_id == imp["id"], FsbImportRow.source_record_id.in_(["A1", "A5"])).values(match_status="pending", reason=""))
        await db.commit()
    from app.services.fsb_import import recover_after_restart

    assert await recover_after_restart() == 1
    done = await finish(client, imp["id"])
    assert done["status"] == "done" and done["counts"]["pending"] == 0 and done["counts"]["auto"] == 4 and done["counts"]["duplicate"] == 1


async def test_a_failed_import_says_so(client, db, monkeypatch):
    await seed_register(db)
    from app.services import fsb_import as FI

    async def boom(*a, **k):
        raise RuntimeError("register unavailable")

    monkeypatch.setattr(FI, "_register_for", boom)
    imp = await upload(client)
    assert imp["status"] == "failed" and "register unavailable" in imp["error"]


# ---------- change report ----------

async def seed_events(db):
    def ev(i, num, kind, when, name="X", old="", new=""):
        return RegistryEvent(id=f"e{i}", source="ch_companies", ext_id=str(i), company_number=num, company_name=name, kind=kind, field="f",
                             old_value=old, new_value=new, event_date=when, link=f"https://example.test/{num}")

    db.add_all([
        ev(1, "00000001", "status_changed", datetime(2026, 10, 5, 9), "Seaview Plumbing Limited", "Active", "Liquidation"),  # followed via an auto match
        ev(2, "00000002", "name_changed", datetime(2026, 10, 31, 23, 30), "Harbour Bakery Ltd", "Harbour Bakery Ltd", "Quay Bakery Ltd"),  # the last evening counts
        ev(3, "00000003", "address_changed", datetime(2026, 10, 12), "Downland Joinery Limited", "BN2 5CD", "BN3 1AA"),  # followed as a saved lead only
        ev(4, "00000004", "status_changed", datetime(2026, 10, 15)),  # the review row was never accepted: not followed
        ev(5, "00000001", "officer_resigned", datetime(2026, 9, 30, 23)),  # before the period
        ev(6, "00000001", "gazette_notice", datetime(2026, 11, 1, 0, 0)),  # after the period
        ev(7, "99999999", "status_changed", datetime(2026, 10, 10)),  # a company nobody follows
    ])
    await db.commit()
    with org_scope("org_default"):
        db.add(LeadAccount(id="la_1", name="Downland Joinery Limited", registration_number="00000003"))
        await db.commit()


async def test_change_report_rows_summary_and_download(client, db):
    await seed_register(db)
    imp = await upload(client)
    await seed_events(db)
    r = await client.post("/api/change-reports/run", json={"start": "2026-10-01", "end": "2026-10-31"})
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["period"] == "2026-10" and rep["created"] is True and rep["row_count"] == 3
    assert rep["summary"]["by_kind"] == {"status_changed": 1, "name_changed": 1, "address_changed": 1} and rep["summary"]["companies"] == 3
    assert rep["summary"]["text"].startswith("3 changes at 3 companies")
    csv_r = await client.get(f"/api/change-reports/{rep['id']}/rows.csv")
    assert csv_r.status_code == 200 and "attachment" in csv_r.headers["content-disposition"]
    lines = csv_r.text.strip().splitlines()
    assert lines[0] == "company_number,company_name,change,field,old_value,new_value,source,date,link,fsb_record_id" and len(lines) == 4
    by_num = {l.split(",")[0]: l for l in lines[1:]}
    assert by_num["00000001"].endswith(",A1") and by_num["00000002"].endswith(",A2;A7")
    assert by_num["00000003"].endswith(",A3")  # matched by district, and also a saved lead
    assert "2026-10-31" in by_num["00000002"] and "00000004" not in by_num and "99999999" not in by_num
    assert len((await db.execute(AuditLog.__table__.select().where(AuditLog.action == "changes.downloaded"))).all()) == 1

    # accepting the review row starts following it; running again refreshes the same report
    row = (await rows_of(client, imp["id"]))["A4"]
    await client.post(f"/api/review-queue/{row['id']}/decision", json={"decision": "accept"})
    again = (await client.post("/api/change-reports/run", json={"start": "2026-10-01", "end": "2026-10-31"})).json()
    assert again["id"] == rep["id"] and again["created"] is False and again["row_count"] == 4
    assert len((await client.get("/api/change-reports")).json()["reports"]) == 1
    odd = (await client.post("/api/change-reports/run", json={"start": "2026-10-10", "end": "2026-10-20"})).json()
    assert odd["period"] == "2026-10-10..2026-10-20" and odd["row_count"] == 2 and odd["id"] != rep["id"]
    assert (await client.post("/api/change-reports/run", json={"start": "2026-10-20", "end": "2026-10-10"})).status_code == 400
    assert (await client.post("/api/change-reports/run", json={"start": "nope", "end": "2026-10-10"})).status_code == 400
    assert (await client.get("/api/change-reports/chr_nope/rows.csv")).status_code == 404


async def test_build_rows_directly_gives_every_column(db):
    await seed_register(db)
    await seed_events(db)
    from app.models.models import FsbImport, FsbImportRow
    from app.services import change_report as CR

    with org_scope("org_default"):
        db.add(FsbImport(id="fsi_1", filename="x", status="done", row_count=2))
        db.add(FsbImportRow(id="fsr_1", import_id="fsi_1", source_record_id="SF1", name="a", match_status="auto", match_company_number="00000001"))
        db.add(FsbImportRow(id="fsr_2", import_id="fsi_1", source_record_id="SF2", name="b", match_status="accepted", match_company_number="00000001"))
        db.add(FsbImportRow(id="fsr_3", import_id="fsi_1", source_record_id="SF3", name="c", match_status="rejected", match_company_number="00000002"))
        await db.commit()
        rows = await CR.build_rows(db, "org_default", date(2026, 10, 1), date(2026, 10, 31))
    one = next(r for r in rows if r["company_number"] == "00000001")
    assert one["fsb_record_id"] == "SF1;SF2" and set(one) == set(CR.COLUMNS)
    assert (one["change"], one["old_value"], one["new_value"], one["source"], one["date"], one["link"]) == ("status_changed", "Active", "Liquidation", "ch_companies", "2026-10-05", "https://example.test/00000001")
    assert not any(r["company_number"] == "00000002" for r in rows)  # a rejected match is not followed


async def test_monthly_run_makes_last_month_once_for_orgs_with_an_import(client, db):
    await seed_register(db)
    await upload(client)
    await seed_events(db)
    from app.services import change_report as CR

    db.add(Organization(id="org_b", name="B", slug="b"))
    await db.commit()
    assert await CR.organisations_with_imports() == ["org_default"]
    assert await CR.run_monthly(date(2026, 11, 1)) == 1
    assert await CR.run_monthly(date(2026, 11, 17)) == 0  # a restart, or a second server: no second copy
    with org_scope("org_default"):
        reps = (await db.execute(ChangeReport.__table__.select())).all()
    assert [r.period for r in reps] == ["2026-10"] and reps[0].row_count == 3
    assert CR.previous_month(date(2027, 1, 1)) == (date(2026, 12, 1), date(2026, 12, 31))
    assert CR.period_for(date(2026, 2, 1), date(2026, 2, 28)) == "2026-02"


# ---------- registry health ----------

async def test_registry_health_endpoint_and_one_alert(db, monkeypatch):
    import httpx

    from app.main import app
    from app.services import ai_errors, registry_feeds as RF, registry_health as RH

    token = await make_staff(db)
    sent = []

    async def fake_alert(code, detail, **kw):
        sent.append((code, detail))

    monkeypatch.setattr(ai_errors, "alert_staff", fake_alert)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as c:
        none = (await c.get("/api/admin-api/registry-health")).json()
        assert none == {"keyPresent": False, "lastEventAt": None, "hoursSinceLastEvent": None, "healthy": False}
        assert await RH.alert_if_unhealthy() is None and sent == []  # no key saved: a setup state, not an outage

        await RF.set_key("ch_stream", "x" * 20)
        stale = datetime.utcnow().replace(microsecond=0)
        await RF.patch_state("ch_companies", last_event_at=(stale.replace(year=stale.year - 1)).isoformat() + "Z")
        bad = (await c.get("/api/admin-api/registry-health")).json()
        assert bad["keyPresent"] is True and bad["healthy"] is False and bad["hoursSinceLastEvent"] > 24
        assert await RH.alert_if_unhealthy() == "alerted"
        assert await RH.alert_if_unhealthy() is None and len(sent) == 1  # only once while it stays down

        await RF.patch_state("ch_companies", last_event_at=datetime.utcnow().isoformat() + "Z")
        ok = (await c.get("/api/admin-api/registry-health")).json()
        assert ok["healthy"] is True and ok["hoursSinceLastEvent"] < 1
        assert await RH.alert_if_unhealthy() == "recovered"
    anon_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    async with anon_client as a:
        assert (await a.get("/api/admin-api/registry-health")).status_code == 401
