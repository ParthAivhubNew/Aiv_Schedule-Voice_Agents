"""Fixes from the review of the Phase 0/1 work: who a rule-driven or one-off email may go to, approvals that never get stuck, a retention
sweep that cannot abort its caller, proof files and revoking across organisations, and a few smaller guards."""
import inspect
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy.future import select

from app.models.models import BusinessRecord, ConsentDeclaration, EmailApproval, LeadAccount
from app.services import send_readiness as SR
from tests.conftest import make_user
from tests.test_eligibility_phase0 import _add, _biz, _enrol
from tests.test_email_outreach import MONDAY_10, _run, mail  # noqa: F401
from tests.test_public_api_email import outbox  # noqa: F401
from tests.test_journeys import EMAIL, _enr, _go, _journey, _ready


def _as(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


# 1. a rule-driven email goes through the same register check
@pytest.mark.db
async def test_a_rule_driven_email_to_a_sole_trader_without_consent_sends_nothing(client, db, mail):
    from app.core.tenancy import org_scope
    from app.services.connection_handlers import send_lead_email

    await _ready(client, db)
    await _biz(db, "br_ltd", "SOUND TRADING LIMITED", "01234567")
    sole = await _add(db, id="rd_sole", name="Harbour Cafe", email="jo@harbourcafe.co.uk", eligibility="reach_other_way", eligibility_note={"by": "user"})
    ltd = await _add(db, id="rd_ltd", name="Sound Trading Ltd", email="hi@soundtrading.co.uk", business_record_id="br_ltd")
    with org_scope("org_default"):
        out = await send_lead_email(db, "org_default", await db.get(LeadAccount, sole.id), "Hi", "Hello", "rule")
        assert out["status"] == "skipped" and out["why"].startswith("reached another way")
        assert mail.sent == []
        assert (await send_lead_email(db, "org_default", await db.get(LeadAccount, ltd.id), "Hi", "Hello", "rule"))["status"] == "sent"
    assert len(mail.sent) == 1


# 2. personal webmail at a ready company needs consent
def test_a_personal_webmail_address_at_a_ready_company_needs_consent():
    ready = LeadAccount(name="Acme Ltd", eligibility="ready", verification={"verdict": "verified"})
    assert SR.eligibility(ready, address="sam@acme.co.uk")["email"] is True
    d = SR.eligibility(ready, address="sam@gmail.com")
    assert d["email"] is False and d["group"] == SR.OTHER and "consent" in d["reason"]
    ready.consent_basis = "enquiry"
    assert SR.eligibility(ready, address="sam@gmail.com")["email"] is True


@pytest.mark.db
async def test_a_journey_reaches_a_gmail_address_at_a_ready_company_another_way(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL])
    await _biz(db, "br_g", "GOOD LIMITED", "02222222")
    acc = await _add(db, id="g_one", name="Good Ltd", email="owner@gmail.com", phone="0113 496 0002", business_record_id="br_g")
    out = await _enrol(client, j["id"], acc)
    assert out["plan"]["reach_other_way"] == 1 and out["plan"]["email"] == 0
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    assert mail.sent == []


# 3. approvals never get stuck and edits are not lost
@pytest.mark.db
async def test_switching_approval_off_releases_parked_people_and_keeps_their_edits(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL], approval_required=True)
    await client.post(f"/api/journeys/{j['id']}/people", json={"people": [{"email": "ann@client.com", "first_name": "Ann", "company": "Client Ltd"}]})
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    assert mail.sent == []
    waiting = (await client.get(f"/api/journeys/approvals?journey={j['id']}")).json()["approvals"]
    assert len(waiting) == 1
    assert (await client.patch(f"/api/journeys/approvals/{waiting[0]['id']}", json={"subject": "My edited subject"})).status_code == 200
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.waiting_on.startswith("approval:")
    off = await client.patch(f"/api/journeys/{j['id']}/settings", json={"approval_required": False})
    assert off.status_code == 200, off.text
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.waiting_on == "" and enr.next_action_at is not None
    await _run(db, MONDAY_10 + timedelta(minutes=2))
    assert [m["Subject"] for _, m in mail.sent] == ["My edited subject"]
    assert (await db.execute(select(EmailApproval))).scalars().first().status == "sent"


# 4. the nightly sweep cannot abort its caller's transaction
@pytest.mark.db
async def test_a_failing_retention_sweep_leaves_the_callers_transaction_usable(client, db, monkeypatch):
    from sqlalchemy import func, text

    from app.core.tenancy import org_scope
    from app.services import eligibility as EL

    monkeypatch.setattr(EL, "_due", lambda cutoff: func.no_such_function(LeadAccount.id) > 1)
    EL._swept.clear()
    with org_scope("org_default"):
        assert await EL.nightly(db, "org_default") is None
        assert (await db.execute(text("SELECT 1"))).scalar() == 1  # not "current transaction is aborted"


# 11. retention delete skips companies in a running check
@pytest.mark.db
async def test_the_retention_delete_skips_companies_being_checked_right_now(client, db, monkeypatch):
    from app.core.tenancy import org_scope
    from app.services import company_check_job
    from app.services import eligibility as EL

    old = datetime.utcnow() - timedelta(days=500)
    await _add(db, id="rl_busy", name="Busy Ltd", email="a@busy.co.uk", created_at=old)
    await _add(db, id="rl_free", name="Free Ltd", email="a@free.co.uk", created_at=old)

    async def locked():
        return {"rl_busy"}

    monkeypatch.setattr(company_check_job, "locked_ids", locked)
    with org_scope("org_default"):
        await EL.retention_sweep(db)
        await db.commit()
    out = (await client.post("/api/leads/retention/delete", json={})).json()
    assert out == {"deleted": 1, "locked": 1}
    db.expire_all()
    assert await db.get(LeadAccount, "rl_busy") is not None and await db.get(LeadAccount, "rl_free") is None


# 5. the /v1 one-off send judges the address
@pytest.mark.db
async def test_the_v1_one_off_send_uses_the_register_for_known_addresses_and_the_name_for_unknown_ones(db, admin_token, outbox):
    from tests.test_public_api_email import _company, _http, _key, _ready_box

    await _company(db, mailbox_status="active", credits=100)
    await _ready_box(db, status="active")
    await _biz(db, "br_v1", "REGISTERED LIMITED", "03333333")
    await _add(db, id="v1_reg", name="Registered Ltd", email="hi@registered.test", business_record_id="br_v1")
    await _add(db, id="v1_sole", name="Corner Plumber", email="jo@cornerplumber.test", eligibility="reach_other_way", eligibility_note={"by": "user"})
    key = await _key(admin_token)

    async def send(to, company=""):
        async with _http(key) as c:
            r = await c.post("/v1/email/send", json={"to": to, "subject": "Hi", "body": "Hello", "company": company})
        return r.status_code

    assert await send("JO@cornerplumber.test", "Corner Plumber Ltd") == 422  # held as a sole trader: the name given does not override
    assert await send("owner@gmail.com", "Big Ltd") == 422  # personal webmail
    assert await send("sam@somewhere.test", "") == 422  # nothing known and no Ltd in the name
    assert await send("sam@somewhere.test", "Somewhere Ltd") == 201
    assert await send("hi@registered.test", "") == 201  # a confirmed company


# 6. the entity is always said out loud
def test_send_cold_email_has_no_default_entity_type():
    from app.services.email_dispatcher import send_cold_email

    p = inspect.signature(send_cold_email).parameters["entity_type"]
    assert p.default is inspect.Parameter.empty and p.kind is inspect.Parameter.KEYWORD_ONLY


# 7 + 8. staff consent screen: revoke inside the client's organisation, proof download headers
@pytest.mark.db
async def test_staff_revoke_works_in_another_organisation_and_a_later_declaration_keeps_its_consent(db, staff, monkeypatch, tmp_path):
    from app.core.tenancy import org_scope
    from app.services import eligibility as EL

    monkeypatch.setattr(EL, "_proof_root", lambda: tmp_path)
    _, token = await make_user(db, "rev_beta", "Admin", org_id="org_beta")
    async with _as(token) as beta:
        with org_scope("org_beta"):
            db.add(LeadAccount(id="rb_one", name="Beta Shop", email="a@betashop.co.uk"))
            db.add(LeadAccount(id="rb_two", name="Beta Cafe", email="a@betacafe.co.uk"))
            await db.commit()
        first = (await beta.post("/api/leads/consent", json={"basis": "enquiry", "source": "Phone call", "agreed_on": "2026-01-01",
                                                              "lead_ids": ["rb_one", "rb_two"], "confirmed": True})).json()["declaration"]
        later = (await beta.post("/api/leads/consent", json={"basis": "opted_in", "source": "Web form", "agreed_on": "2026-02-01",
                                                              "lead_ids": ["rb_two"], "confirmed": True})).json()["declaration"]
    rv = await staff.post(f"/api/admin-api/consent/{first['id']}/revoke", json={"reason": "No proof"})
    assert rv.status_code == 200, rv.text
    db.expire_all()
    with org_scope("org_beta"):
        assert (await db.get(LeadAccount, "rb_one")).consent_basis == ""
        two = await db.get(LeadAccount, "rb_two")
        assert two.consent_basis == "opted_in" and two.consent_id == later["id"]  # the later declaration still stands
    listed = (await staff.get("/api/admin-api/consent?org_id=org_beta")).json()["declarations"]
    assert {d["id"] for d in listed} == {first["id"], later["id"]}


@pytest.mark.db
async def test_the_proof_download_has_the_stored_type_and_nosniff(db, staff, client, monkeypatch, tmp_path):
    from app.services import eligibility as EL

    monkeypatch.setattr(EL, "_proof_root", lambda: tmp_path)
    up = await client.post("/api/leads/consent/proof", files={"file": ("export.csv", b"email\na@b.co\n", "text/csv")})
    assert up.status_code == 200, up.text
    await _add(db, id="pf_one", name="Proof Ltd", email="a@proof.co.uk")
    d = (await client.post("/api/leads/consent", json={"basis": "opted_in", "source": "Form", "agreed_on": "2026-01-01", "lead_ids": ["pf_one"],
                                                       "confirmed": True, "proof_file": up.json()["file"], "proof_name": "export.csv"})).json()["declaration"]
    r = await staff.get(f"/api/admin-api/consent/{d['id']}/proof")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and r.headers["x-content-type-options"] == "nosniff"
    assert EL.proof_mime("a.pdf") == "application/pdf" and EL.proof_mime("a.zzz") == "application/octet-stream"


# 9. a company number must look like one
def test_only_a_real_company_number_makes_an_unlabelled_record_ready():
    acc = LeadAccount(name="X")
    for number, group in (("01234567", SR.READY), ("SC123456", SR.READY), ("CC-123456", SR.QUICK), ("1234", SR.QUICK), ("IP12345R", SR.QUICK)):
        biz = BusinessRecord(registration_number=number, company_category="", status="Active")
        assert SR.group_of(acc, biz)[0] == group, number


# 10. "email published by the register" needs a register that publishes it
def test_a_registry_email_only_counts_when_a_register_supplied_it():
    from app.services import fit_score as FS

    mine = BusinessRecord(confidence_tier="verified_registry", email="a@b.co", sources=[{"source_id": "ds_companies_house"}])
    charity = BusinessRecord(confidence_tier="verified_registry", email="a@b.co", sources=[{"source_id": "ds_charity_commission"}])
    assert FS.contacts_of(mine)["email"] == "" and FS.contacts_of(charity)["email"] == "register"
    assert FS.contacts_of(mine, verified_email=True)["email"] == "verified"


@pytest.mark.db
async def test_the_fit_order_mirrors_the_register_email_rule(db):
    from app.services import business_records as BR
    from app.services import fit_score as FS

    db.add(BusinessRecord(id="fo_ch", identity_hash="fo1", name="Ch Ltd", confidence_tier="verified_registry", email="a@b.co", sources=[{"source_id": "ds_companies_house"}]))
    db.add(BusinessRecord(id="fo_cc", identity_hash="fo2", name="Cc Trust", confidence_tier="verified_registry", email="a@b.co", sources=[{"source_id": "ds_charity_commission"}]))
    await db.commit()
    expr = BR.fit_order({"sic_codes": ["1"]}, FS.DEFAULT_WEIGHTS)
    got = dict((await db.execute(select(BusinessRecord.id, expr).where(BusinessRecord.id.in_(("fo_ch", "fo_cc"))))).all())
    assert got["fo_cc"] - got["fo_ch"] == FS.DEFAULT_WEIGHTS["email"]


# 12. new organisations start with approval on
@pytest.mark.db
async def test_a_journey_made_without_a_profile_follows_the_organisation_age(db):
    from app.core.tenancy import org_scope
    from app.models.models import Organization
    from app.services import journeys as J

    db.add(Organization(id="org_new", name="n", slug="org_new", created_at=datetime(2026, 11, 12)))
    db.add(Organization(id="org_old", name="o", slug="org_old", created_at=datetime(2026, 5, 1)))
    await db.commit()
    for org, expected in (("org_new", True), ("org_old", False)):
        with org_scope(org):
            camp = await J.create(db, name="J", steps=[{"channel": "email", "subject": "s", "body": "b"}], mailbox_ids=[])
            assert camp.approval_required is expected, org


# 13. one swap task per person, even after it is done
@pytest.mark.db
async def test_the_swap_task_is_made_once_per_person_even_when_the_first_is_done(client, db, mail):
    from app.models.models import JourneyTask

    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL, {"channel": "email", "subject": "", "body": "Following up.", "delay_days": 1}])
    sole = await _add(db, id="sw_one", name="Harbour Cafe", email="jo@harbourcafe.co.uk", phone="0113 496 0000", eligibility="reach_other_way", eligibility_note={"by": "user"})
    await _enrol(client, j["id"], sole)
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    task = (await db.execute(select(JourneyTask))).scalars().first()
    task.status = "done"
    await db.commit()
    await _run(db, MONDAY_10 + timedelta(days=2))
    assert len((await db.execute(select(JourneyTask))).scalars().all()) == 1


# 14. a bad register date cannot end the backfill
@pytest.mark.db
async def test_the_backfill_skips_one_impossible_date_and_fills_the_rest(db, monkeypatch):
    import importlib.util
    import pathlib

    path = pathlib.Path(__file__).resolve().parent.parent / "scripts" / "backfill_register_dates.py"
    spec = importlib.util.spec_from_file_location("backfill_dates", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for i, due in enumerate(("31/02/2026", "15/03/2026")):
        db.add(BusinessRecord(id=f"bf_{i}", identity_hash=f"bf{i}", name=f"B{i} Ltd", raw_data={"ds_companies_house": {"Accounts.NextDueDate": due}}))
    await db.commit()
    assert await mod.fill_range(0, 10_000) == 1
    db.expire_all()
    assert (await db.get(BusinessRecord, "bf_1")).accounts_due_on is not None and (await db.get(BusinessRecord, "bf_0")).accounts_due_on is None


# 17. isolation between organisations
@pytest.mark.db
async def test_another_organisation_cannot_see_approvals_declarations_or_proof(client, db, mail, monkeypatch, tmp_path):
    from app.services import eligibility as EL

    monkeypatch.setattr(EL, "_proof_root", lambda: tmp_path)
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL], approval_required=True)
    await client.post(f"/api/journeys/{j['id']}/people", json={"people": [{"email": "ann@client.com", "first_name": "Ann", "company": "Client Ltd"}]})
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    approval = (await client.get("/api/journeys/approvals")).json()["approvals"][0]
    await _add(db, id="iso_one", name="Iso Ltd", email="a@iso.co.uk")
    up = (await client.post("/api/leads/consent/proof", files={"file": ("p.txt", b"proof", "text/plain")})).json()["file"]
    mine = (await client.post("/api/leads/consent", json={"basis": "opted_in", "source": "Form", "agreed_on": "2026-01-01", "lead_ids": ["iso_one"],
                                                          "confirmed": True, "proof_file": up})).json()["declaration"]
    _, token = await make_user(db, "iso_beta", "Admin", org_id="org_beta")
    async with _as(token) as beta:
        assert (await beta.get("/api/journeys/approvals")).json()["count"] == 0
        assert (await beta.post(f"/api/journeys/approvals/{approval['id']}/approve")).status_code in (400, 404)
        assert (await beta.patch(f"/api/journeys/approvals/{approval['id']}", json={"subject": "x"})).status_code in (400, 404)
        assert (await beta.get("/api/leads/consent")).json()["declarations"] == []
        stolen = await beta.post("/api/leads/consent", json={"basis": "opted_in", "source": "Form", "agreed_on": "2026-01-01", "lead_ids": ["iso_one"],
                                                              "confirmed": True, "proof_file": up})
        assert stolen.status_code == 400  # org A's proof file name means nothing to org B
    db.expire_all()
    assert (await db.get(EmailApproval, approval["id"])).status == "pending"
    assert (await db.get(ConsentDeclaration, mine["id"])).revoked_at is None


@pytest.mark.db
async def test_a_client_token_gets_401_on_every_staff_consent_route(client):
    assert (await client.get("/api/admin-api/consent")).status_code == 401
    assert (await client.get("/api/admin-api/consent/cd_x/proof")).status_code == 401
    assert (await client.post("/api/admin-api/consent/cd_x/revoke", json={})).status_code == 401


def test_a_proof_name_cannot_climb_out_or_reach_another_organisation(monkeypatch, tmp_path):
    from app.services import eligibility as EL

    monkeypatch.setattr(EL, "_proof_root", lambda: tmp_path)
    (tmp_path / "org_a").mkdir()
    (tmp_path / "org_a" / "0123456789abcdef.pdf").write_bytes(b"x")
    (tmp_path / "secret.pdf").write_bytes(b"x")
    assert EL.proof_path("org_a", "0123456789abcdef.pdf") is not None
    assert EL.proof_path("org_b", "0123456789abcdef.pdf") is None
    assert EL.proof_path("org_a", "../0123456789abcdef.pdf") is None
    assert EL.proof_path("org_a", "..\\..\\secret.pdf") is None


# 16. the quick-choice lookup survives a failing query
@pytest.mark.db
async def test_the_candidate_lookup_orders_by_name_similarity_and_does_not_abort_the_transaction(db, monkeypatch):
    from sqlalchemy import func as sa_func, text

    from app.services import eligibility as EL

    for i, name in enumerate(("HARBOUR TRADING LIMITED", "HARBOUR TRADING GROUP HOLDINGS LIMITED")):
        db.add(BusinessRecord(id=f"cd_{i}", identity_hash=f"cd{i}", name=name, registration_number=f"0765432{i}", company_category="Private Limited Company", status="Active"))
    await db.commit()
    acc = LeadAccount(id="cd_acc", name="Harbour Trading")
    got = await EL.candidates(db, acc)
    assert got and got[0]["id"] == "cd_0"

    class _NoTrigram:  # as on a database without pg_trgm: the ordering function does not exist, which fails at execution time
        similarity = staticmethod(lambda *a: sa_func.similarity_missing_here(*a))

    monkeypatch.setattr(EL, "func", _NoTrigram)
    again = await EL.candidates(db, acc)  # falls back to the unordered query inside a savepoint
    assert again and again[0]["id"] == "cd_0"
    assert (await db.execute(text("SELECT 1"))).scalar() == 1  # the transaction was not aborted


# 22. drafting an ideal customer is limited per organisation per day
@pytest.mark.db
async def test_the_icp_draft_has_a_daily_limit_with_a_friendly_message(client, db, monkeypatch):
    from app.api import icp as API
    from app.services import icp as ICP

    async def draft(db, website):
        return {"sic_codes": []}

    monkeypatch.setattr(ICP, "draft_from_website", draft)
    monkeypatch.setattr(API, "DRAFTS_PER_DAY", 2)
    for _ in range(2):
        assert (await client.post("/api/leads/icp/draft", json={"website": "https://acme.test"})).status_code == 200
    r = await client.post("/api/leads/icp/draft", json={"website": "https://acme.test"})
    assert r.status_code == 429 and "today" in r.json()["detail"]


# 23. the journey summary reads its audience once
@pytest.mark.db
async def test_the_journey_summary_works_out_the_audience_once(client, db, mail, monkeypatch):
    from app.services import journeys as J

    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL])
    await client.post(f"/api/journeys/{j['id']}/people", json={"people": [{"email": "ann@client.com", "company": "Client Ltd"}]})
    calls = []
    real = J.audience

    async def counted(*a, **k):
        calls.append(1)
        return await real(*a, **k)

    monkeypatch.setattr(J, "audience", counted)
    got = (await client.get(f"/api/journeys/{j['id']}")).json()["journey"]
    assert len(calls) == 1 and got["audience"]["text"] and any(p["level"] for p in got["preflight"])
