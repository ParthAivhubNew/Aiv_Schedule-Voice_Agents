"""Phase 0 of the email rules: who gets email is worked out free from our register copy; sole traders without consent are reached
another way and the journey carries on; consent declarations are logged and revocable; emails can wait for approval (always while a
mailbox warms up); the 1.5% bounce warning; and the 12-month retention flag. Nothing here ever refuses a person or a journey."""
from datetime import datetime, timedelta

import pytest
from sqlalchemy.future import select

from app.models.models import (BusinessRecord, ConsentDeclaration, EmailApproval, EmailCampaign, EmailEnrollment, EmailMailbox, EmailSuppression,
                               JourneyTask, LeadAccount)
from app.services import email_warmup_engine as W
from app.services import send_readiness as SR
from tests.test_email_outreach import MONDAY_10, _run, mail  # noqa: F401
from tests.test_journeys import EMAIL, _enr, _go, _journey, _ready

FOLLOW = {"channel": "email", "subject": "", "body": "Following up, {{first_name}}.", "delay_days": 2}


@pytest.fixture(autouse=True)
def _voice_minutes(monkeypatch):
    from app.services import lead_calls as LC

    async def enough(db, calls):
        return {"calls": calls, "wallet": "Voice", "minutes_left": 500, "average_minutes": 3.0, "minutes_needed": calls * 3.0, "enough": True}

    monkeypatch.setattr(LC, "cost_preview", enough)


async def _add(db, **kw):
    from app.core.tenancy import org_scope

    with org_scope("org_default"):
        a = LeadAccount(id=kw.pop("id"), **kw)
        db.add(a)
        await db.commit()
    return a


async def _biz(db, id, name, number, category="Private Limited Company", status="Active", postcode=""):
    b = BusinessRecord(id=id, identity_hash=f"h_{id}", name=name, registration_number=number, company_category=category, status=status, postcode=postcode)
    db.add(b)
    await db.commit()
    return b


async def _enrol(client, jid, *leads):
    people = [{"email": a.email, "company": a.name, "first_name": "Sam", "lead_id": a.id} for a in leads]
    r = await client.post(f"/api/journeys/{jid}/people", json={"people": people})
    assert r.status_code == 200, r.text
    return r.json()


# ── the rules, no database ─────────────────────────────────────────────────
def test_the_three_groups_come_from_the_register_record():
    ltd = BusinessRecord(registration_number="01234567", company_category="Private Limited Company", status="Active")
    lp = BusinessRecord(registration_number="LP012345", company_category="Limited Partnership", status="Active")
    slp = BusinessRecord(registration_number="SL012345", company_category="Limited Partnership", status="Active")
    scot = BusinessRecord(registration_number="SG000001", company_category="Scottish Partnership", status="Active")
    dead = BusinessRecord(registration_number="01234568", company_category="Private Limited Company", status="Dissolved")
    acc = LeadAccount(name="Acme Ltd")
    assert SR.group_of(acc, ltd)[0] == SR.READY and SR.group_of(acc, slp)[0] == SR.READY and SR.group_of(acc, scot)[0] == SR.READY
    assert SR.group_of(acc, lp)[0] == SR.OTHER  # an English limited partnership is not a legal person
    assert SR.group_of(acc)[0] == SR.QUICK  # no clear register match
    assert SR.group_of(LeadAccount(name="Jo Bloggs", contact_name="Jo Bloggs"))[0] == SR.OTHER  # saved as a person
    assert SR.eligibility(acc, dead)["ok"] is False
    sole = LeadAccount(name="Harbour Cafe", eligibility="reach_other_way", eligibility_note={"by": "user"})
    assert SR.eligibility(sole)["email"] is False and SR.eligibility(sole)["ok"] is True
    sole.consent_basis = "opted_in"
    assert SR.eligibility(sole)["email"] is True
    sole.consent_basis = "not_sure"
    assert SR.eligibility(sole)["email"] is False
    assert SR.pasted_person("Bob's Plumbing")["email"] is False and SR.pasted_person("Bob Plumbing Ltd")["email"] is True


def test_the_bounce_warning_shows_at_one_and_a_half_percent_and_sending_pauses_at_two():
    assert W.bounce_health(0.01)["state"] == "ok"
    warn = W.bounce_health(0.016)
    assert warn["state"] == "warning" and "1.6%" in warn["text"] and "2%" in warn["text"]
    assert W.bounce_health(0.02)["state"] == "paused"
    mb = W.MailboxState(id="m", email="a@b.com", status="active")
    logs = [W.DayLog(date=f"2027-01-0{i}", sent_count=125, bounced_count=2) for i in range(1, 5)]  # 8 of 500 = 1.6%
    plan = W.plan_mailbox_day(mb, logs, "2027-01-05")
    assert plan["action"] == "send" and W.bounce_health(plan["bounce_rate_7d"])["state"] == "warning"
    logs = [W.DayLog(date=f"2027-01-0{i}", sent_count=125, bounced_count=3) for i in range(1, 5)]  # 12 of 500 = 2.4%
    assert W.plan_mailbox_day(mb, logs, "2027-01-05")["action"] == "pause"


def test_the_summary_says_what_happens_to_everyone_in_words():
    from app.services import journeys as J

    assert J.plan_text({"email": 186, "quick_choice": 9, "reach_other_way": 5}, {"call_task": 5}) == "186 get email, 9 need a quick choice, 5 get a call instead"
    assert J.plan_text({"email": 1, "reach_other_way": 2}, {"call_task": 1, "letter_task": 1}).startswith("1 gets email, 1 gets a")


def test_a_mailbox_still_warming_up_always_asks_for_approval():
    from app.services import journeys as J

    camp = EmailCampaign(mailbox_ids=["mb1"], approval_required=False)
    assert J.approval_reason(camp, [EmailMailbox(id="mb1", email="a@b.com", status="active")]) == ""
    assert "warming up" in J.approval_reason(camp, [EmailMailbox(id="mb1", email="a@b.com", status="warming")])
    assert J.approval_reason(EmailCampaign(mailbox_ids=[], approval_required=True), []) == "You check each email before it goes"


# ── on a real database ─────────────────────────────────────────────────────
@pytest.mark.db
async def test_a_sole_trader_without_consent_is_never_emailed_gets_a_call_task_and_the_journey_carries_on(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL, FOLLOW])
    sole = await _add(db, id="s_cafe", name="Harbour Cafe", email="jo@harbourcafe.co.uk", phone="0113 496 0000",
                      eligibility="reach_other_way", eligibility_note={"by": "user", "reason": "You said it's a sole trader"})
    out = await _enrol(client, j["id"], sole)
    assert out["added"] == 1 and out["plan"]["reach_other_way"] == 1
    await _go(client, j["id"])  # the journey starts: no red block
    await _run(db, MONDAY_10)
    assert mail.sent == []
    tasks = (await client.get("/api/journeys/tasks")).json()["tasks"]
    assert len(tasks) == 1 and tasks[0]["kind"] == "call_task" and tasks[0]["instead_of_email"] and tasks[0]["needs_screening"]
    assert "TPS" in tasks[0]["notes"] and tasks[0]["phone"]
    enr = await _enr(db, j["id"], "jo@harbourcafe.co.uk")
    assert enr.status == "active" and enr.current_step == 2 and enr.waiting_on == ""  # carries on, not parked on the task
    assert "email not sent" in enr.vars["timeline"][-1]["text"] and "A call instead" in enr.vars["timeline"][-1]["text"]
    await _run(db, MONDAY_10 + timedelta(days=2, minutes=5))
    assert mail.sent == []
    enr = await _enr(db, j["id"], "jo@harbourcafe.co.uk")
    assert enr.status == "completed"
    assert len((await client.get("/api/journeys/tasks")).json()["tasks"]) == 1  # one way in per person, not one per email
    people = (await client.get(f"/api/journeys/{j['id']}")).json()["journey"]["people"]
    assert people[0]["timeline"]


@pytest.mark.db
async def test_the_sender_never_emails_an_individual_even_if_they_slipped_in(client, db, mail):
    """Defence in depth: an enrolment written straight into the table, past every check, is still not emailed."""
    from app.core.tenancy import org_scope
    from app.services.email_dispatcher import send_cold_email

    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL])
    with org_scope("org_default"):
        db.add(EmailEnrollment(id="en_sneak", campaign_id=j["id"], email="bob@gmail.com", company="Bob Smith", first_name="Bob", current_step=1, status="active"))
        await db.commit()
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    assert mail.sent == []
    assert (await db.execute(select(JourneyTask).where(JourneyTask.enrollment_id == "en_sneak"))).scalars().first() is not None
    with org_scope("org_default"):
        box = (await db.execute(select(EmailMailbox))).scalars().first()
        res = await send_cold_email(db, "org_default", box, "bob@gmail.com", "Hi", "Hi", entity_type="individual")
    assert res["status"] == "blocked_pecr" and mail.sent == []


@pytest.mark.db
async def test_a_sole_trader_with_recorded_consent_is_emailed(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL])
    sole = await _add(db, id="s_ok", name="Harbour Bistro", email="jo@bistro.co.uk", eligibility="reach_other_way", eligibility_note={"by": "user"})
    r = await client.post("/api/leads/consent", json={"basis": "opted_in", "source": "Newsletter sign-up on our website", "agreed_on": "2026-01-15",
                                                      "lead_ids": [sole.id], "confirmed": True, "proof_ref": "Mailchimp export, January"})
    assert r.status_code == 200, r.text
    out = await _enrol(client, j["id"], sole)
    assert out["plan"] == {"email": 1, "quick_choice": 0, "reach_other_way": 0}
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    assert len(mail.sent) == 1


@pytest.mark.db
async def test_a_confirmed_company_is_emailed_and_saving_works_out_its_group_for_free(client, db, mail):
    await _biz(db, "br_acme", "ACME WIDGETS LIMITED", "01234567")
    r = await client.post("/api/leads/accounts", json={"accounts": [
        {"name": "Acme Widgets Ltd", "email": "sam@acmewidgets.co.uk", "business_record_id": "br_acme", "source": "scout"},
        {"name": "Nobody Knows Ltd", "email": "x@nobody.co.uk", "source": "manual"}]})
    assert r.status_code == 200, r.text
    saved = {a["name"]: a for a in r.json()["accounts"]}
    assert saved["Acme Widgets Ltd"]["email_route"]["group"] == "ready" and saved["Nobody Knows Ltd"]["email_route"]["group"] == "quick_choice"
    db.expire_all()
    rows = {a.name: a for a in (await db.execute(select(LeadAccount))).scalars().all()}
    assert rows["Acme Widgets Ltd"].eligibility == "ready" and rows["Nobody Knows Ltd"].eligibility == "quick_choice"
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL])
    await _enrol(client, j["id"], rows["Acme Widgets Ltd"])
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    assert len(mail.sent) == 1


@pytest.mark.db
async def test_the_quick_choice_moves_a_company_into_its_group(client, db, mail):
    await _biz(db, "br_harb", "HARBOUR TRADING LIMITED", "07654321", postcode="LS1 1AA")
    await _biz(db, "br_gone", "HARBOUR TRADING (OLD) LIMITED", "07654322", status="Dissolved")
    a = await _add(db, id="q_one", name="Harbour Trading", email="hi@harbourtrading.co.uk", postcode="LS1 1AA", eligibility="quick_choice")
    b = await _add(db, id="q_two", name="Jo's Van Hire", email="jo@vanhire.co.uk", eligibility="quick_choice")
    got = (await client.get(f"/api/leads/eligibility/{a.id}")).json()
    assert got["group"] == "quick_choice" and [c["id"] for c in got["candidates"]] == ["br_harb"]  # closed companies are not offered
    picked = (await client.post(f"/api/leads/eligibility/{a.id}/choose", json={"business_record_id": "br_harb"})).json()
    assert picked["group"] == "ready" and picked["email"] is True
    sole = (await client.post(f"/api/leads/eligibility/{b.id}/choose", json={"sole_trader": True})).json()
    assert sole["group"] == "reach_other_way" and sole["email"] is False
    db.expire_all()
    assert (await db.get(LeadAccount, "q_one")).business_record_id == "br_harb"
    counts = (await client.get("/api/leads/eligibility")).json()["counts"]
    assert counts["email"] == 1 and counts["reach_other_way"] == 1


@pytest.mark.db
async def test_the_start_summary_counts_who_gets_email_a_choice_or_a_call_and_never_blocks(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL])
    await _biz(db, "br_ok", "GOOD THINGS LIMITED", "01111111")
    ok = await _add(db, id="m_ok", name="Good Things Ltd", email="a@goodthings.co.uk", business_record_id="br_ok")
    quick = await _add(db, id="m_q", name="Maybe Co", email="b@maybe.co.uk")
    sole = await _add(db, id="m_s", name="Jo Plumber", email="c@joplumber.co.uk", phone="0113 496 0001", eligibility="reach_other_way",
                      eligibility_note={"by": "user"})
    await _enrol(client, j["id"], ok, quick, sole)
    got = (await client.get(f"/api/journeys/{j['id']}")).json()["journey"]
    aud = got["audience"]
    assert (aud["email"], aud["quick_choice"], aud["reach_other_way"]) == (1, 1, 1)
    assert aud["text"] == "1 gets email, 1 needs a quick choice, 1 gets a call instead"
    assert [c["lead_id"] for c in aud["choices"]] == ["m_q"]
    assert not [p for p in got["preflight"] if p["level"] == "red"]
    assert any(p["text"].startswith("1 gets email") for p in got["preflight"])
    await _go(client, j["id"])


@pytest.mark.db
async def test_consent_is_logged_word_for_word_needs_a_confirmation_and_staff_can_revoke_it(client, db, staff, mail):
    await _add(db, id="c_one", name="Corner Shop", email="a@cornershop.co.uk")
    await _add(db, id="c_two", name="Cake Stall", email="b@cakestall.co.uk")
    bad = await client.post("/api/leads/consent", json={"basis": "enquiry", "source": "Phone", "agreed_on": "2026-02-01", "lead_ids": ["c_one"]})
    assert bad.status_code == 400 and "confirm" in bad.json()["detail"]
    r = await client.post("/api/leads/consent", json={"basis": "existing_customer", "source": "Bought from us in 2025", "agreed_on": "2025-12-01",
                                                      "lead_ids": ["c_one", "c_two"], "confirmed": True})
    assert r.status_code == 200, r.text
    d = r.json()["declaration"]
    assert d["count"] == 2 and d["declared_by"] and d["wording_version"] and "How did these contacts agree to hear from you?" in d["wording"]
    assert "Bought from us in 2025" in d["wording"] and "2025-12-01" in d["wording"]
    db.expire_all()
    assert (await db.get(LeadAccount, "c_one")).consent_basis == "existing_customer"
    unsure = (await client.post("/api/leads/consent", json={"basis": "not_sure", "lead_ids": ["c_two"]})).json()["declaration"]
    assert unsure["basis"] == "not_sure"  # logged too, and records no consent
    assert len((await client.get("/api/leads/consent")).json()["declarations"]) == 2
    assert (await client.post(f"/api/admin-api/consent/{d['id']}/revoke", json={"reason": "x"})).status_code == 401  # a customer can't
    listed = (await staff.get("/api/admin-api/consent")).json()["declarations"]
    assert {x["id"] for x in listed} == {d["id"], unsure["id"]}
    rv = await staff.post(f"/api/admin-api/consent/{d['id']}/revoke", json={"reason": "No proof when asked"})
    assert rv.status_code == 200 and rv.json()["declaration"]["revoked_at"]
    db.expire_all()
    assert (await db.get(LeadAccount, "c_one")).consent_basis == "" and (await db.get(LeadAccount, "c_two")).consent_basis == ""
    row = await db.get(ConsentDeclaration, d["id"])
    assert row.revoke_reason == "No proof when asked"


@pytest.mark.db
async def test_with_approval_on_emails_are_parked_edited_approved_and_then_sent(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL], approval_required=True)
    assert j["settings"]["approval_required"] is True
    await client.post(f"/api/journeys/{j['id']}/people", json={"people": [{"email": "ann@client.com", "first_name": "Ann", "company": "Client Ltd"},
                                                                          {"email": "bob@client2.com", "first_name": "Bob", "company": "Client Two Ltd"}]})
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    assert mail.sent == []
    waiting = (await client.get(f"/api/journeys/approvals?journey={j['id']}")).json()
    assert waiting["count"] == 2 and waiting["approvals"][0]["subject"].startswith("Hello Client")
    first = next(a for a in waiting["approvals"] if a["email"] == "ann@client.com")
    edited = await client.patch(f"/api/journeys/approvals/{first['id']}", json={"subject": "A better subject"})
    assert edited.status_code == 200 and edited.json()["approval"]["edited"]
    assert (await client.post(f"/api/journeys/approvals/{first['id']}/approve")).status_code == 200
    await _run(db, MONDAY_10 + timedelta(minutes=2))
    assert [m["Subject"] for _, m in mail.sent] == ["A better subject"]
    assert (await client.post("/api/journeys/approvals/approve-all", json={"journey": j["id"]})).json()["approved"] == 1
    await _run(db, MONDAY_10 + timedelta(minutes=4))
    assert len(mail.sent) == 2
    rows = (await db.execute(select(EmailApproval))).scalars().all()
    assert sorted(r.status for r in rows) == ["sent", "sent"]
    assert (await client.get("/api/journeys/approvals")).json()["count"] == 0


@pytest.mark.db
async def test_a_warming_mailbox_forces_approval_and_new_organisations_start_with_it_on(client, db, mail):
    from app.core.tenancy import org_scope
    from app.models.models import CompanyProfile

    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL])
    assert j["settings"]["approval_required"] is False
    await client.post(f"/api/journeys/{j['id']}/people", json={"people": [{"email": "ann@client.com", "company": "Client Ltd"}]})
    await _go(client, j["id"])
    box = await db.get(EmailMailbox, mb)
    box.status = "warming"
    await db.commit()
    got = (await client.get(f"/api/journeys/{j['id']}")).json()["journey"]
    assert "warming up" in got["approval"]["reason"]
    await _run(db, MONDAY_10)
    assert mail.sent == [] and (await client.get("/api/journeys/approvals")).json()["count"] == 1
    with org_scope("org_default"):
        prof = (await db.execute(select(CompanyProfile).limit(1))).scalars().first()
        prof.send_approval = True  # what signup sets for a new organisation
        await db.commit()
    assert (await _journey(client, mb, [EMAIL]))["settings"]["approval_required"] is True
    switched = (await client.patch(f"/api/journeys/{j['id']}/settings", json={"approval_required": True})).json()["journey"]
    assert switched["settings"]["approval_required"] is True


@pytest.mark.db
async def test_retention_flags_after_twelve_months_and_delete_keeps_the_do_not_email_list(client, db, mail):
    from app.core.tenancy import org_scope
    from app.services import eligibility as EL

    now = datetime.utcnow()
    await _add(db, id="r_old", name="Old Never Ltd", email="old@never.co.uk", created_at=now - timedelta(days=400))
    await _add(db, id="r_quiet", name="Quiet Ltd", email="q@quiet.co.uk", created_at=now - timedelta(days=800), last_contact_at=now - timedelta(days=380))
    await _add(db, id="r_recent", name="Recent Ltd", email="r@recent.co.uk", created_at=now - timedelta(days=800), last_called_at=now - timedelta(days=20))
    await _add(db, id="r_new", name="New Ltd", email="n@new.co.uk", created_at=now - timedelta(days=10))
    with org_scope("org_default"):
        db.add(EmailSuppression(id="sup_old", org_id="org_default", email="old@never.co.uk", reason="unsubscribe", source="manual"))
        await db.commit()
        out = await EL.retention_sweep(db, now)
        await db.commit()
    assert out == {"flagged": 2, "cleared": 0}
    listed = (await client.get("/api/leads/retention")).json()
    assert {a["id"] for a in listed["accounts"]} == {"r_old", "r_quiet"} and listed["total"] == 2
    assert any("never contacted" in a["reason"] for a in listed["accounts"])
    assert {a["id"] for a in (await client.get("/api/leads/accounts?retention=true")).json()["accounts"]} == {"r_old", "r_quiet"}
    q = await db.get(LeadAccount, "r_quiet")
    q.last_contact_at = now
    await db.commit()
    with org_scope("org_default"):
        assert (await EL.retention_sweep(db, now))["cleared"] == 1
        await db.commit()
    assert (await client.post("/api/leads/retention/delete", json={})).json()["deleted"] == 1
    db.expire_all()
    assert await db.get(LeadAccount, "r_old") is None and await db.get(LeadAccount, "r_quiet") is not None
    assert await db.get(EmailSuppression, "sup_old") is not None


@pytest.mark.db
async def test_retention_counts_journey_emails_and_calls_as_contact_even_when_the_stamps_are_empty(client, db, mail):
    """Journey sends don't write last_contact_at, so the sweep reads the email and call logs too. 12 months from the last contact."""
    from app.core.tenancy import org_scope
    from app.models.models import EmailMessage, LiveCall
    from app.services import eligibility as EL

    now = datetime.utcnow()
    old = now - timedelta(days=900)
    await _add(db, id="t_mailed", name="Mailed Ltd", email="a@mailed.co.uk", created_at=old)
    await _add(db, id="t_called", name="Called Ltd", email="b@called.co.uk", created_at=old)
    await _add(db, id="t_replied", name="Replied Ltd", email="c@replied.co.uk", created_at=old)
    await _add(db, id="t_quiet", name="Quiet Ltd", email="d@quiet.co.uk", created_at=old)
    with org_scope("org_default"):
        db.add(EmailCampaign(id="cmp_ret", name="Spring"))
        db.add(EmailEnrollment(id="en_m", campaign_id="cmp_ret", email="someone@mailed.co.uk", lead_id="t_mailed"))
        db.add(EmailEnrollment(id="en_q", campaign_id="cmp_ret", email="d@quiet.co.uk", lead_id="t_quiet"))
        db.add(EmailMessage(id="em_m", enrollment_id="en_m", recipient_email="someone@mailed.co.uk", status="sent", sent_at=now - timedelta(days=7)))
        db.add(EmailMessage(id="em_q", enrollment_id="en_q", recipient_email="d@quiet.co.uk", status="sent", sent_at=now - timedelta(days=395)))
        db.add(EmailMessage(id="em_r", recipient_email="c@replied.co.uk", status="replied", sent_at=now - timedelta(days=500),
                            replied_at=now - timedelta(days=30)))
        db.add(LiveCall(id="lc_c", lead_id="t_called", prospect="Called Ltd", mission="m", created_at=now - timedelta(days=40)))
        await db.commit()
        out = await EL.retention_sweep(db, now)
        await db.commit()
    assert out["flagged"] == 1
    db.expire_all()
    flagged = {a.id for a in (await db.execute(select(LeadAccount).where(LeadAccount.retention_flagged_at.isnot(None)))).scalars().all()}
    assert flagged == {"t_quiet"}  # last emailed 13 months ago
    listed = (await client.get("/api/leads/retention")).json()["accounts"]
    assert "Last contacted" in listed[0]["reason"]
    # Emailed again after the nightly flag: the bulk delete re-checks and keeps it.
    with org_scope("org_default"):
        db.add(EmailMessage(id="em_q2", enrollment_id="en_q", recipient_email="d@quiet.co.uk", status="sent", sent_at=now - timedelta(days=1)))
        await db.commit()
    assert (await client.post("/api/leads/retention/delete", json={})).json()["deleted"] == 0
    db.expire_all()
    assert await db.get(LeadAccount, "t_quiet") is not None


def test_a_saved_company_on_the_active_register_reads_verified_without_a_click():
    from app.services import eligibility as EL

    live = BusinessRecord(registration_number="01234567", company_category="Private Limited Company", status="Active")
    gone = BusinessRecord(registration_number="01234568", company_category="Private Limited Company", status="Dissolved")
    fresh, dead, done = LeadAccount(name="A Ltd"), LeadAccount(name="B Ltd"), LeadAccount(name="C Ltd", verification={"verdict": "looks_ok"})
    EL._verify_from_copy(fresh, live)
    EL._verify_from_copy(dead, gone)
    EL._verify_from_copy(done, live)
    assert fresh.verification["verdict"] == "verified" and fresh.verification["source"] == "register_copy"
    assert dead.verification is None
    assert done.verification == {"verdict": "looks_ok"}  # a check that already ran is never replaced


def test_the_journey_summary_counts_everyone_including_an_address_that_cannot_be_emailed():
    from app.services import journeys as J

    assert J.eligible_person(None, {}, {"company": "Acme Ltd", "email": "info@crosskeysbaltimore.com."})["code"] == "email_bad"
    assert J.eligible_person(None, {}, {"company": "Acme Ltd", "email": "sam@acme.co.uk"})["ok"]
    plan = {"email": 2, "quick_choice": 4, "reach_other_way": 0, "cant_email": 1}
    assert J.plan_text(plan, {}, {"email_bad": 1}) == "2 get email, 4 need a quick choice, 1 can't be emailed: invalid address"
