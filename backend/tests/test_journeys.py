"""Journeys: steps that keep people's place when edited, manual steps that become tasks, call results that end, retry or reshape a journey,
exit rules, daily cap, no double sends, A/B versions, enrolment rules, the check before starting, and the API the screen uses."""
from datetime import datetime, timedelta

import pytest
from sqlalchemy.future import select

from app.models.models import (EmailCampaign, EmailEnrollment, EmailMessage, EmailSequenceStep, JourneyTask, LeadAccount)
from app.services import journeys as J
from app.services import mail_transport as T
from tests.test_email_outreach import MONDAY_10, _mailbox, _run, mail  # noqa: F401  (the fake mail server and helpers)

EMAIL = {"channel": "email", "subject": "Hello {{company}}", "body": "Hi {{first_name}}, one question."}


@pytest.fixture(autouse=True)
def _voice_minutes(monkeypatch):
    """The test organisation has the Voice plan and plenty of minutes, so a call step can start."""
    from app.services import lead_calls as LC

    async def enough(db, calls):
        return {"calls": calls, "wallet": "Voice", "minutes_left": 500, "average_minutes": 3.0, "minutes_needed": calls * 3.0, "enough": True}

    monkeypatch.setattr(LC, "cost_preview", enough)

    from app.services import call_permission as CP

    async def permitted(db, num, kind="ai", now=None):
        return {"allowed": True, "reasons": [], "warnings": [], "flags": [], "needs": ""}

    monkeypatch.setattr(CP, "decide", permitted)  # call steps are tested here, not the consent rules (see test_call_permission)


# ── the rules for steps (no database) ──────────────────────────────────────
def test_steps_are_checked_in_plain_words():
    with pytest.raises(J.JourneyError, match="at least one"):
        J.clean_steps([])
    with pytest.raises(J.JourneyError, match="can't be an automatic call"):
        J.clean_steps([{"channel": "call", "delay_days": 1}])
    with pytest.raises(J.JourneyError, match="needs a wait"):
        J.clean_steps([EMAIL, {"channel": "email", "body": "again"}])
    with pytest.raises(J.JourneyError, match="nothing in it"):
        J.clean_steps([{"channel": "email", "subject": "x", "body": ""}])
    with pytest.raises(J.JourneyError, match="subject"):
        J.clean_steps([{"channel": "email", "body": "no subject"}])
    with pytest.raises(J.JourneyError, match="type we don't have"):
        J.clean_steps([{"channel": "carrier_pigeon"}])
    ok = J.clean_steps([EMAIL, {"channel": "call_task", "delay_days": 0}, {"channel": "call", "delay_days": 2, "retries": 9, "voicemail": "leave_message"}])
    assert ok[1]["title"] == "Make a call" and ok[2]["retries"] == 3  # a task with no wait is fine; retries are capped
    assert len({s["key"] for s in ok}) == 3


def test_every_ready_made_journey_is_valid_and_written_for_a_person():
    assert len(J.TEMPLATES) >= 8
    for t in J.TEMPLATES:
        steps = J.clean_steps([dict(s) for s in t["steps"]])
        assert steps[0]["channel"] in ("email", "call_task", "task") and t["goal"] and t["best_for"], t["key"]
    assert len({t["key"] for t in J.TEMPLATES}) == len(J.TEMPLATES)


def test_exit_rules_that_must_stay_on_cannot_be_switched_off():
    camp = EmailCampaign(exit_rules={"on_reply": False, "on_meeting": False, "on_unsubscribe": False, "unresponsive_days": 999, "skip_stages": ["won", "nonsense"]})
    r = J.rules_of(camp)
    assert r["on_reply"] and r["on_meeting"] and r["on_unsubscribe"] and r["unresponsive_days"] == 60 and r["skip_stages"] == ["won"]


def test_a_b_versions_are_stable_per_person_and_split_roughly_in_half():
    ids = [f"en_{i:04d}" for i in range(400)]
    assert all(J.variant_for(i) == J.variant_for(i) for i in ids)
    share = sum(J.variant_for(i) == "b" for i in ids) / len(ids)
    assert 0.4 < share < 0.6
    step = EmailSequenceStep(subject="A", body_template="body a", subject_b="B", body_b="body b")
    assert J.pick_version(EmailEnrollment(variant="a"), step) == ("A", "body a") and J.pick_version(EmailEnrollment(variant="b"), step) == ("B", "body b")
    assert J.pick_version(EmailEnrollment(variant="b"), EmailSequenceStep(subject="A", body_template="x")) == ("A", "x")  # no second version: everyone gets the first


def test_advice_comes_from_the_numbers_and_works_without_the_ai():
    res = {"sent": 100, "opened": 10, "replied": 1, "bounced": 6, "reply_rate": 1.0, "bounce_rate": 6.0, "people": 40, "by_status": {"unresponsive": 30}, "variants": {}}
    text = " ".join(J.suggestions_from(res, [{"channel": "email"}]))
    assert "subject" in text and "bounced" in text and "call step" in text
    assert J.suggestions_from({**res, "sent": 5, "bounce_rate": 0, "people": 0, "by_status": {}, "reply_rate": 0}, []) == ["Nothing stands out yet. Give it more sends before changing anything."]


# ── on a real database ─────────────────────────────────────────────────────
async def _sender(db, legal="Acme Outreach Ltd", address="1 High Street, Leeds LS1 1AA"):
    """The sender identity every cold email must carry; a journey cannot start without it."""
    from sqlalchemy import select

    from app.models.models import CompanyProfile

    prof = (await db.execute(select(CompanyProfile).limit(1))).scalars().first()
    if not prof:
        prof = CompanyProfile(id="default", name="Acme")
        db.add(prof)
    prof.legal_name, prof.postal_address = legal, address
    await db.commit()


async def _ready(client, db, credits=50):
    from app.core.tenancy import org_scope
    from app.services import credits as K

    with org_scope("org_default"):
        await K.add_credits(db, "leadgen", credits, source="grant", note="Test")
        await _sender(db)
    mb = await _mailbox(client)
    await client.post(f"/api/email/mailboxes/{mb['id']}/warmup", json={"action": "skip"})
    return mb["id"]


async def _journey(client, mailbox, steps, **settings):
    r = await client.post("/api/journeys", json={"name": "J", "goal": "Get a reply", "steps": steps, "mailbox_ids": [mailbox], "settings": {"min_delay_seconds": 30, **settings}})
    assert r.status_code == 200, r.text
    return r.json()["journey"]


async def _people(client, jid, *emails, lead_ids=None):
    people = [{"email": e, "first_name": e.split("@")[0].title(), "company": "Co " + e.split("@")[0] + " Ltd", **({"lead_id": lead_ids[i]} if lead_ids else {})} for i, e in enumerate(emails)]
    r = await client.post(f"/api/journeys/{jid}/people", json={"people": people})
    assert r.status_code == 200, r.text
    return r.json()


async def _go(client, jid):
    r = await client.post(f"/api/journeys/{jid}/status", json={"status": "running"})
    assert r.status_code == 200, r.text


async def _enr(db, jid, email=None):
    db.expire_all()
    q = select(EmailEnrollment).where(EmailEnrollment.campaign_id == jid)
    rows = (await db.execute(q)).scalars().all()
    return rows if email is None else next(r for r in rows if r.email == email)


async def _result(db, lead_id, outcome):
    """A call ended with this outcome: told to the journeys the way the call-finished handler does, using a freshly loaded lead."""
    n = await J.on_call_result(db, await db.get(LeadAccount, lead_id), "", outcome)
    await db.commit()
    return n


async def _lead(db, **kw):
    from app.core.tenancy import org_scope

    with org_scope("org_default"):
        kw.setdefault("verification", {"verdict": "verified"})  # a checked company: unchecked ones are kept out of journeys
        a = LeadAccount(id=kw.pop("id"), name=kw.pop("name", "Acme Ltd"), **kw)
        db.add(a)
        await db.commit()
    return a


@pytest.mark.db
async def test_editing_steps_never_moves_someone_part_way_through(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL, {**EMAIL, "subject": "", "body": "two", "delay_days": 2}, {**EMAIL, "subject": "", "body": "three", "delay_days": 2}])
    await _people(client, j["id"], "ann@client.com")
    keys = [s["key"] for s in j["steps"]]
    enr = await _enr(db, j["id"], "ann@client.com")
    enr.current_step, enr.current_step_key = 2, keys[1]
    await db.commit()
    # a new first step goes in: Ann is still on "two", which is now step 3
    r = await client.put(f"/api/journeys/{j['id']}/steps", json={"steps": [{"channel": "task", "title": "Look them up"}, {**j["steps"][0], "delay_days": 1}, *[{**s} for s in j["steps"][1:]]]})
    assert r.status_code == 200, r.text
    enr = await _enr(db, j["id"], "ann@client.com")
    assert (enr.current_step, enr.current_step_key) == (3, keys[1])
    # her step is taken out: she carries on at what now sits in its place
    kept = [s for s in r.json()["journey"]["steps"] if s["key"] != keys[1]]
    r = await client.put(f"/api/journeys/{j['id']}/steps", json={"steps": kept})
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.current_step == 3 and enr.current_step_key == keys[2] and enr.status == "active"
    # steps shortened past her position: she is finished
    r = await client.put(f"/api/journeys/{j['id']}/steps", json={"steps": kept[:1]})
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.status == "completed"


@pytest.mark.db
async def test_a_manual_step_makes_a_task_waits_for_it_and_then_carries_on(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL, {"channel": "call_task", "delay_days": 1, "title": "Call {{company}}", "notes": "Ask about {{first_name}}'s week"},
                                    {**EMAIL, "subject": "", "body": "after the call", "delay_days": 1}])
    await _people(client, j["id"], "ann@client.com")
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    await _run(db, MONDAY_10 + timedelta(minutes=1))
    assert len(mail.sent) == 1
    await _run(db, MONDAY_10 + timedelta(days=1, minutes=5))
    assert len(mail.sent) == 1  # the call is a task, nothing is sent
    tasks = (await client.get("/api/journeys/tasks")).json()["tasks"]
    assert [(t["title"], t["kind"], t["notes"]) for t in tasks] == [("Call Co ann Ltd", "call_task", "Ask about Ann's week")]
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.status == "active" and enr.waiting_on == f"task:{tasks[0]['id']}" and enr.next_action_at is None
    await _run(db, MONDAY_10 + timedelta(days=2))
    assert len(mail.sent) == 1  # still waiting for the person
    done = MONDAY_10 + timedelta(days=2)
    await J.complete_task(db, tasks[0]["id"], "done", "connected", now=done)
    await db.commit()
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.current_step == 3 and enr.waiting_on == "" and enr.next_action_at == done + timedelta(days=1)
    await _run(db, done + timedelta(days=1, minutes=5))
    await _run(db, done + timedelta(days=1, minutes=7))
    assert len(mail.sent) == 2
    assert (await client.get("/api/journeys/tasks")).json()["tasks"] == []


@pytest.mark.db
async def test_a_skipped_task_carries_on_and_a_task_for_a_manual_email_holds_the_text(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [{"channel": "manual_email", "subject": "Hi {{first_name}}", "body": "Write this one yourself, {{first_name}}"},
                                    {**EMAIL, "subject": "", "body": "next", "delay_days": 1}])
    await _people(client, j["id"], "ann@client.com")
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    task = (await client.get("/api/journeys/tasks")).json()["tasks"][0]
    assert task["kind"] == "manual_email" and "Subject: Hi Ann" in task["notes"] and "Write this one yourself, Ann" in task["notes"]
    assert (await client.post(f"/api/journeys/tasks/{task['id']}/skip")).status_code == 200
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.current_step == 2 and enr.waiting_on == ""


@pytest.mark.db
async def test_a_reply_ends_the_journey_cancels_open_tasks_and_a_bounce_only_stops_email(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL, {"channel": "call_task", "delay_days": 1, "title": "Ring"}, {**EMAIL, "subject": "", "body": "later", "delay_days": 1}])
    await _people(client, j["id"], "ann@client.com", "gus@client.com")
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    await _run(db, MONDAY_10 + timedelta(minutes=1))
    sent = {m["To"]: m for _, m in mail.sent}
    await _run(db, MONDAY_10 + timedelta(days=1, minutes=5))
    assert len((await client.get("/api/journeys/tasks")).json()["tasks"]) == 2
    mail.inbox = [T.Incoming(uid=1, from_addr="ann@client.com", subject="Re", in_reply_to=sent["ann@client.com"]["Message-ID"], text="Sounds good, call me."),
                  T.Incoming(uid=2, from_addr="mailer-daemon@mx.net", is_bounce=True, failed_recipients=["gus@client.com"], bounce_status="5.1.1",
                             bounced_message_id=sent["gus@client.com"]["Message-ID"])]
    await _run(db, MONDAY_10 + timedelta(days=1, minutes=20))
    ann, gus = await _enr(db, j["id"], "ann@client.com"), await _enr(db, j["id"], "gus@client.com")
    assert (ann.status, ann.finish_reason) == ("replied", "replied")
    tasks = (await client.get("/api/journeys/tasks")).json()["tasks"]
    assert [t["email"] for t in tasks] == ["gus@client.com"]  # Ann's open task was cancelled
    assert gus.email_blocked and gus.status == "active"  # the call task is still to do; only emails are skipped from now on


@pytest.mark.db
async def test_the_wrong_kind_of_reply_is_handled_out_of_office_waits_and_unsubscribe_ends(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL, {**EMAIL, "subject": "", "body": "second", "delay_days": 2}])
    await _people(client, j["id"], "ann@client.com", "bo@client.com")
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    await _run(db, MONDAY_10 + timedelta(minutes=1))
    sent = {m["To"]: m for _, m in mail.sent}
    before = (await _enr(db, j["id"], "ann@client.com")).next_action_at
    mail.inbox = [T.Incoming(uid=1, from_addr="ann@client.com", subject="Auto: away", in_reply_to=sent["ann@client.com"]["Message-ID"],
                             text="I'm out of the office until Monday, with limited access to email.", auto_submitted=True),
                  T.Incoming(uid=2, from_addr="bo@client.com", subject="Re", in_reply_to=sent["bo@client.com"]["Message-ID"], text="Please remove me from your list.")]
    await _run(db, MONDAY_10 + timedelta(minutes=30))
    ann, bo = await _enr(db, j["id"], "ann@client.com"), await _enr(db, j["id"], "bo@client.com")
    assert ann.status == "active" and ann.next_action_at >= before  # an auto-reply is not an answer
    assert (bo.status, bo.finish_reason) == ("unsubscribed", "unsubscribed")


@pytest.mark.db
async def test_the_journeys_daily_cap_and_the_never_twice_guard(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL], daily_cap=1)
    await _people(client, j["id"], "ann@client.com", "bo@client.com")
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    assert len(mail.sent) == 1  # one email, then the cap
    for m in (await db.execute(select(EmailMessage))).scalars().all():
        m.sent_at = MONDAY_10  # the test clock is in the future; the sender counts today's mail by its own clock
    await db.commit()
    await _run(db, MONDAY_10 + timedelta(minutes=1))
    await _run(db, MONDAY_10 + timedelta(minutes=3))
    assert len(mail.sent) == 1  # the cap, not the mailbox, stopped the second
    # a step that already went out (before a restart) is never sent again
    step_id = (await J.steps_of(db, j["id"]))[0].id
    waiting = next(e for e in await _enr(db, j["id"]) if e.status == "active")
    waiting_id, waiting_email = waiting.id, waiting.email
    db.add(EmailMessage(id="msg_x", campaign_id=j["id"], sequence_step_id=step_id, enrollment_id=waiting_id, recipient_email=waiting_email, status="sent",
                        sent_at=MONDAY_10 - timedelta(days=1)))
    await db.commit()
    await client.patch(f"/api/journeys/{j['id']}/settings", json={"daily_cap": 0})
    await _run(db, MONDAY_10 + timedelta(minutes=5))
    assert len(mail.sent) == 1 and (await _enr(db, j["id"], waiting_email)).status == "completed"


@pytest.mark.db
async def test_a_lead_whose_stage_means_stop_leaves_the_journey_without_a_send(client, db, mail):
    mb = await _ready(client, db)
    await _lead(db, id="ld_1", email="ann@client.com", stage="lost")
    j = await _journey(client, mb, [EMAIL])
    await _people(client, j["id"], "ann@client.com", lead_ids=["ld_1"])
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    await _run(db, MONDAY_10 + timedelta(minutes=1))
    assert mail.sent == []
    enr = await _enr(db, j["id"], "ann@client.com")
    assert (enr.status, enr.finish_reason) == ("finished", "stage")


@pytest.mark.db
async def test_people_who_never_answer_are_marked_unresponsive_after_the_set_days(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL], rules={"unresponsive_days": 5})
    await _people(client, j["id"], "ann@client.com")
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    await _run(db, MONDAY_10 + timedelta(minutes=1))
    assert (await _enr(db, j["id"], "ann@client.com")).status == "completed"
    await _run(db, MONDAY_10 + timedelta(days=2))
    assert (await _enr(db, j["id"], "ann@client.com")).status == "completed"
    enr = await _enr(db, j["id"], "ann@client.com")
    enr.last_action_at = datetime.utcnow() - timedelta(days=6)  # a time in the real past, as the sweep compares with the sender's clock
    await db.commit()
    await _run(db, datetime.utcnow().replace(hour=10, minute=0) + timedelta(days=1))
    assert (await _enr(db, j["id"], "ann@client.com")).status in ("unresponsive", "completed")


@pytest.mark.db
async def test_a_call_waits_for_its_result_then_retries_ends_or_reshapes_the_journey(client, db, mail, monkeypatch):
    from app.services import connection_handlers as H

    mb = await _ready(client, db)
    await _lead(db, id="ld_2", email="ann@client.com", name="Client Ltd", phone="+441132223333")
    calls = []

    async def fake_call(db_, org, enr, step, now):
        calls.append(enr.id)
        return "called", ""

    monkeypatch.setattr(H, "run_call_step", fake_call)
    j = await _journey(client, mb, [EMAIL, {"channel": "call", "delay_days": 1, "retries": 1, "retry_gap_hours": 24, "goal": "Ask the question"},
                                    {**EMAIL, "subject": "", "body": "after", "delay_days": 1}])
    await _people(client, j["id"], "ann@client.com", lead_ids=["ld_2"])
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    await _run(db, MONDAY_10 + timedelta(minutes=1))
    t1 = MONDAY_10 + timedelta(days=1, minutes=5)
    await _run(db, t1)
    assert len(calls) == 1
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.waiting_on == "call" and enr.current_step == 2 and enr.next_action_at > datetime.utcnow() + timedelta(hours=30)  # waits for the result
    # nobody answered, and the step allows one more try
    assert await _result(db, "ld_2", "no_answer") == 1
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.waiting_on == "" and enr.retry_count == 1 and enr.current_step == 2
    # the retry goes out, nobody answers again: the journey carries on to the next email
    enr.waiting_on = "call"
    await db.commit()
    await _result(db, "ld_2", "no_answer")
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.current_step == 3 and enr.retry_count == 0 and enr.waiting_on == ""
    # back on the call step: a callback request makes a task, "not interested" ends everything
    enr.current_step, enr.current_step_key, enr.waiting_on, enr.next_action_at = 2, (await J.steps_of(db, j["id"]))[1].step_key, "call", None
    await db.commit()
    await _result(db, "ld_2", "callback_requested")
    task = (await client.get("/api/journeys/tasks")).json()["tasks"][0]
    assert task["kind"] == "call_task" and task["title"].startswith("Call back")
    await _result(db, "ld_2", "rejected")
    enr = await _enr(db, j["id"], "ann@client.com")
    assert (enr.status, enr.finish_reason) == ("finished", "not_interested")
    assert (await client.get("/api/journeys/tasks")).json()["tasks"] == []  # the open task went with it


@pytest.mark.db
async def test_the_other_call_results_wrong_number_voicemail_interest_do_not_call_and_a_silent_call(client, db, mail, monkeypatch):
    from app.services import connection_handlers as H

    mb = await _ready(client, db)

    async def fake_call(db_, org, enr, step, now):
        return "called", ""

    monkeypatch.setattr(H, "run_call_step", fake_call)
    j = await _journey(client, mb, [EMAIL, {"channel": "call", "delay_days": 1}, {**EMAIL, "subject": "", "body": "after", "delay_days": 1}])
    leads = {n: f"ld_{n}" for n in ("wrong", "vm", "yes", "dnc", "quiet")}
    for n, i in leads.items():
        await _lead(db, id=i, email=f"{n}@client.com", name=f"{n} Ltd")
    await _people(client, j["id"], *[f"{n}@client.com" for n in leads], lead_ids=list(leads.values()))
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    for m in range(1, 4):
        await _run(db, MONDAY_10 + timedelta(minutes=m))
    await _run(db, MONDAY_10 + timedelta(days=1, minutes=10))
    for _ in range(3):
        await _run(db, MONDAY_10 + timedelta(days=1, minutes=11))
    assert all(e.waiting_on == "call" for e in await _enr(db, j["id"]))
    for n, outcome in (("wrong", "wrong_number"), ("vm", "left_voicemail"), ("yes", "interested"), ("dnc", "do_not_call")):
        await _result(db, leads[n], outcome)
    got = {e.email.split("@")[0]: e for e in await _enr(db, j["id"])}
    assert got["wrong"].call_blocked and got["wrong"].current_step == 3
    assert got["vm"].current_step == 3 and not got["vm"].call_blocked
    assert (got["yes"].status, got["yes"].finish_reason) == ("finished", "interested")
    assert (got["dnc"].status, got["dnc"].finish_reason) == ("finished", "do_not_contact")
    follow_up = [t for t in (await client.get("/api/journeys/tasks")).json()["tasks"] if "sounded interested" in t["title"]]
    assert len(follow_up) == 1  # a person follows up the interested one
    # the call that never reports back is treated as unanswered after the wait
    for _ in range(3):  # two days on, inside the sending hours; the sender handles a couple of people a run
        await _run(db, MONDAY_10 + timedelta(days=3))
    assert (await _enr(db, j["id"], "quiet@client.com")).current_step == 3


@pytest.mark.db
async def test_a_booked_meeting_ends_the_journey_and_its_tasks(client, db, mail):
    from app.services import connection_handlers as H

    mb = await _ready(client, db)
    lead = await _lead(db, id="ld_3", email="ann@client.com")
    j = await _journey(client, mb, [{"channel": "task", "title": "Look them up"}, {**EMAIL, "delay_days": 1}])
    await _people(client, j["id"], "ann@client.com", lead_ids=["ld_3"])
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    assert len((await client.get("/api/journeys/tasks")).json()["tasks"]) == 1
    await H.stop_sequences(db, await db.get(LeadAccount, "ld_3"))
    await db.commit()
    enr = await _enr(db, j["id"], "ann@client.com")
    assert (enr.status, enr.finish_reason) == ("booked", "meeting_booked")
    assert (await client.get("/api/journeys/tasks")).json()["tasks"] == []


@pytest.mark.db
async def test_the_call_prompt_gets_the_goal_what_was_emailed_and_the_directors_names(client, db, mail):
    from app.core.tenancy import org_scope
    from app.models.models import BusinessRecord

    mb = await _ready(client, db)
    db.add(BusinessRecord(id="br_9", identity_hash="h9", name="Client Ltd", registration_number="00000009", status="Active", confidence_tier="verified_registry",
                          officers=[{"name": "MURPHY, Ken", "role": "director", "v": 2}]))
    await db.commit()
    await _lead(db, id="ld_4", email="ann@client.com", name="Client Ltd", business_record_id="br_9")
    j = await _journey(client, mb, [EMAIL, {"channel": "call", "delay_days": 1, "goal": "Book a 15 minute intro", "notes": "Mention the case study", "voicemail": "leave_message"}])
    await _people(client, j["id"], "ann@client.com", lead_ids=["ld_4"])
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    await _run(db, MONDAY_10 + timedelta(minutes=1))
    enr = await _enr(db, j["id"], "ann@client.com")
    step = (await J.steps_of(db, j["id"]))[1]
    brief = await J.call_brief(db, enr, step, await db.get(LeadAccount, "ld_4"))
    assert "Goal of this call: Book a 15 minute intro" in brief and "Talking points: Mention the case study" in brief
    assert 'We emailed them "Hello Co ann Ltd"' in brief and "has not opened it" in brief
    assert "Ken Murphy" in brief and "leave one short message" in brief and "Never invent" in brief or "never invent" in brief
    quiet = await J.call_brief(db, enr, EmailSequenceStep(voicemail="hang_up", notes="", goal=""), None)
    assert "do not leave a message" in quiet and "Goal of this call" not in quiet or "Goal of this call: Get a reply" in quiet


@pytest.mark.db
async def test_people_already_in_another_running_journey_are_not_added_and_a_dry_run_only_counts(client, db, mail):
    mb = await _ready(client, db)
    a = await _journey(client, mb, [EMAIL])
    await _people(client, a["id"], "ann@client.com")
    await _go(client, a["id"])
    b = await _journey(client, mb, [EMAIL])
    people = [{"email": e, "company": "Acme Ltd"} for e in ("ann@client.com", "new@client.com", "bad", "new@client.com")]
    dry = (await client.post(f"/api/journeys/{b['id']}/people", json={"people": people, "dry_run": True})).json()
    assert dry["added"] == 1 and dry["skipped"]["in_another_journey"] == 1 and dry["skipped"]["invalid"] == 1 and dry["skipped"]["duplicate"] == 1 and dry["dry_run"]
    assert await _enr(db, b["id"]) == []  # nothing was written
    real = (await client.post(f"/api/journeys/{b['id']}/people", json={"people": people})).json()
    assert real["added"] == 1 and len(await _enr(db, b["id"])) == 1


@pytest.mark.db
async def test_the_screen_api_start_check_settings_clone_templates_and_delete(client, db, mail, monkeypatch):
    mb = await _ready(client, db)
    from app.services import connection_handlers as H

    async def no_voice(db_, org):
        return {"voice": False, "leads": True}

    monkeypatch.setattr(H, "entitled", no_voice)
    j = await _journey(client, mb, [EMAIL, {"channel": "call", "delay_days": 1}])
    got = (await client.get(f"/api/journeys/{j['id']}")).json()["journey"]
    texts = " | ".join(p["text"] for p in got["preflight"])
    assert "Nobody is in this journey" in texts and "needs the Voice plan" in texts  # what stands in the way, in words
    refused = await client.post(f"/api/journeys/{j['id']}/status", json={"status": "running"})
    assert refused.status_code == 400 and "Nobody" in refused.json()["detail"]
    assert (await client.patch(f"/api/journeys/{j['id']}/settings", json={"sending_window_start": "18:00", "sending_window_end": "09:00"})).status_code == 400
    ok = (await client.patch(f"/api/journeys/{j['id']}/settings", json={"name": "Renamed", "days_of_week": [1, 2], "daily_cap": 20, "rules": {"unresponsive_days": 3}})).json()["journey"]
    assert ok["name"] == "Renamed" and ok["settings"]["daily_cap"] == 20 and ok["settings"]["rules"]["unresponsive_days"] == 3 and ok["settings"]["rules"]["on_reply"]
    copy = (await client.post(f"/api/journeys/{j['id']}/clone")).json()["journey"]
    assert copy["status"] == "draft" and copy["name"] == "Renamed (copy)" and [s["channel"] for s in copy["steps"]] == ["email", "call"]
    assert {s["key"] for s in copy["steps"]}.isdisjoint({s["key"] for s in ok["steps"]})
    t = (await client.get("/api/journeys/templates")).json()["templates"]
    made = (await client.post("/api/journeys/from-template", json={"key": t[0]["key"]})).json()["journey"]
    assert made["template_key"] == t[0]["key"] and made["status"] == "draft" and made["steps"]
    assert (await client.post("/api/journeys/from-template", json={"key": "nope"})).status_code == 400
    assert len((await client.get("/api/journeys")).json()["journeys"]) == 3
    assert (await client.get(f"/api/journeys/{copy['id']}/suggestions")).status_code == 200
    assert (await client.delete(f"/api/journeys/{copy['id']}")).status_code == 200
    assert (await client.get(f"/api/journeys/{copy['id']}")).status_code == 404


@pytest.mark.db
async def test_the_old_campaign_screen_still_saves_through_journeys_and_keeps_people_in_place(client, db, mail):
    mb = await _ready(client, db)
    camp = (await client.post("/api/email/campaigns", json={"name": "Old", "mailbox_ids": [mb], "steps": [{"subject": "Hi", "body": "One"}, {"delay_days": 2, "body": "Two"}]})).json()["campaign"]
    await client.post(f"/api/email/campaigns/{camp['id']}/leads", json={"leads": [{"email": "ann@client.com"}]})
    enr = await _enr(db, camp["id"], "ann@client.com")
    enr.current_step = 2
    await db.commit()
    r = await client.put(f"/api/email/campaigns/{camp['id']}", json={"name": "Old", "mailbox_ids": [mb], "steps": [{"subject": "Hi", "body": "One"}, {"delay_days": 2, "body": "Two, edited"}]})
    assert r.status_code == 200
    enr = await _enr(db, camp["id"], "ann@client.com")
    assert enr.current_step == 2 and enr.status == "active"


@pytest.mark.db
async def test_open_tasks_show_on_the_days_agenda_and_overdue_ones_on_today(client, db, mail):
    from app.core.tenancy import org_scope

    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL, {"channel": "task", "title": "Ring them"}])
    noon = datetime.utcnow().replace(hour=12, minute=0, second=0, microsecond=0)
    with org_scope("org_default"):
        db.add(JourneyTask(id="jt_today", campaign_id=j["id"], enrollment_id="en_a", kind="task", title="Today's task", contact="Ann", status="open", due_at=noon))
        db.add(JourneyTask(id="jt_late", campaign_id=j["id"], enrollment_id="en_b", kind="task", title="Late task", status="open", due_at=noon - timedelta(days=3)))
        db.add(JourneyTask(id="jt_done", campaign_id=j["id"], enrollment_id="en_c", kind="task", title="Done task", status="done", due_at=noon))
        await db.commit()

    async def items(day):
        r = await client.get(f"/api/together/agenda?date={day:%Y-%m-%d}&focus=leads")
        assert r.status_code == 200, r.text
        return {i["title"]: i["status"] for g in r.json()["groups"] for i in g["items"] if i["kind"] == "journey_task"}

    assert await items(noon) == {"Today's task": "To do", "Late task": "Overdue"}  # today: what is due, and what is already late
    assert await items(noon - timedelta(days=3)) == {"Late task": "To do"}  # that day: only what was due then


@pytest.mark.db
async def test_closed_people_are_kept_out_and_everyone_else_is_added_with_how_they_will_be_reached(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL])
    await _lead(db, id="g_ok", name="Good Ltd", email="ok@good.com")
    await _lead(db, id="g_dead", name="Dead Ltd", email="x@dead.com", verification={"verdict": "problem", "reasons": ["Company register: Dissolved"]})
    await _lead(db, id="g_wrong", name="Wrong Ltd", email="x@wrong.com", verification={"verdict": "mismatch", "reasons": ["Company number 1 belongs to Other Ltd"]})
    await _lead(db, id="g_new", name="Unchecked Ltd", email="x@new.com", verification=None)
    await _lead(db, id="g_cafe", name="Harbour Cafe", email="info@harbour.com", verification={"verdict": "person"})
    await _lead(db, id="g_cafe_ok", name="Harbour Bistro", email="info@bistro.com", verification={"verdict": "person"}, consent_basis="signed up on our site")
    people = [{"email": a, "company": n, "lead_id": i} for i, n, a in [
        ("g_ok", "Good Ltd", "ok@good.com"), ("g_dead", "Dead Ltd", "x@dead.com"), ("g_wrong", "Wrong Ltd", "x@wrong.com"),
        ("g_new", "Unchecked Ltd", "x@new.com"), ("g_cafe", "Harbour Cafe", "info@harbour.com"), ("g_cafe_ok", "Harbour Bistro", "info@bistro.com")]]
    out = (await client.post(f"/api/journeys/{j['id']}/people", json={"people": people})).json()
    assert out["added"] == 4  # nobody is refused for being unchecked or a sole trader: they are reached another way
    assert out["skipped"]["problem"] == 2
    assert {e["lead_id"]: e["code"] for e in out["excluded"]} == {"g_dead": "problem", "g_wrong": "problem"}
    assert out["plan"] == {"email": 2, "quick_choice": 1, "reach_other_way": 1}
    assert [q["lead_id"] for q in out["quick_choices"]] == ["g_new"] and [o["lead_id"] for o in out["other_way"]] == ["g_cafe"]
    assert out["plan_text"] == "2 get email, 1 needs a quick choice, 1 is reached another way"
    assert "warned" not in out


@pytest.mark.db
async def test_people_in_a_draft_are_queued_with_no_send_time_until_start(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL])
    out = await _people(client, j["id"], "ann@client.com")
    assert out["queued"] is True
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.next_action_at is None
    await _go(client, j["id"])
    await db.refresh(enr)
    assert enr.next_action_at is not None


@pytest.mark.db
async def test_a_check_done_after_joining_still_stops_the_email(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL])
    lead = await _lead(db, id="g_late", name="Late Ltd", email="late@client.com")
    await _people(client, j["id"], "late@client.com", lead_ids=["g_late"])
    await _go(client, j["id"])
    lead.verification = {"verdict": "problem", "reasons": ["Company register: Dissolved"]}
    await db.commit()
    await _run(db, MONDAY_10 + timedelta(minutes=5))
    assert mail.sent == []
    enr = await _enr(db, j["id"], "late@client.com")
    assert enr.status == "finished" and enr.finish_reason == "not_eligible"


@pytest.mark.db
async def test_a_journey_cannot_start_without_the_sender_name_and_address(client, db, mail):
    from app.core.tenancy import org_scope

    mb = await _ready(client, db)
    with org_scope("org_default"):
        await _sender(db, legal="", address="")
    j = await _journey(client, mb, [EMAIL])
    await _people(client, j["id"], "ann@client.com")
    r = await client.post(f"/api/journeys/{j['id']}/status", json={"status": "running"})
    assert r.status_code != 200 and "postal address" in r.text
    with org_scope("org_default"):
        await _sender(db)
    await _go(client, j["id"])


@pytest.mark.db
async def test_every_cold_email_carries_the_sender_and_the_unsubscribe_link(client, db, mail):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL])
    await _people(client, j["id"], "ann@client.com")
    await _go(client, j["id"])
    await _run(db, MONDAY_10 + timedelta(minutes=5))
    assert len(mail.sent) == 1
    body = mail.sent[0][1].get_body(preferencelist=("plain",)).get_content()
    assert "Acme Outreach Ltd, 1 High Street, Leeds LS1 1AA" in body and "Unsubscribe:" in body


# ── Phase 5: results, preview, source line, templates ──────────────────────
async def _two_step_journey(client, db):
    mb = await _ready(client, db)
    j = await _journey(client, mb, [EMAIL, {**EMAIL, "subject": "", "body": "again", "delay_days": 2}])
    await _people(client, j["id"], "ann@client.com", "bob@client.com", "cy@client.com")
    from types import SimpleNamespace

    rows = (await db.execute(select(EmailSequenceStep.id).where(EmailSequenceStep.campaign_id == j["id"]).order_by(EmailSequenceStep.step_number))).scalars().all()
    j["mailbox"] = mb
    return j, [SimpleNamespace(id=i) for i in rows]


def _msg(i, j, step, enr, status, minutes=0, **kw):
    return EmailMessage(id=f"m_{i}", campaign_id=j["id"], sequence_step_id=step.id, enrollment_id=enr.id, recipient_email=enr.email, status=status,
                        sent_at=MONDAY_10 + timedelta(minutes=minutes), **kw)


@pytest.mark.db
async def test_step_results_delivered_is_sent_minus_bounced(client, db, mail):
    j, steps = await _two_step_journey(client, db)
    enrs = await _enr(db, j["id"])
    db.add_all([_msg(1, j, steps[0], enrs[0], "sent"), _msg(2, j, steps[0], enrs[1], "bounced"), _msg(3, j, steps[0], enrs[2], "replied")])
    await db.commit()
    camp = await db.get(EmailCampaign, j["id"])
    rows = await J.step_results(db, camp)
    assert [r["step"] for r in rows] == [1, 2]
    first = rows[0]
    assert (first["sent"], first["bounced"], first["delivered"], first["replied"]) == (3, 1, 2, 1)
    assert first["reply_rate"] == 33.3 and rows[1]["sent"] == 0 and rows[1]["reply_rate"] is None
    res = await J.results(db, camp)
    assert res["delivered"] == 2 and res["by_step"][0]["delivered"] == 2 and res["opens_tracked"] in (True, False)


@pytest.mark.db
async def test_booked_attributed_to_last_step(client, db, mail):
    j, steps = await _two_step_journey(client, db)
    ann, bob, cy = sorted(await _enr(db, j["id"]), key=lambda e: e.email)
    db.add_all([_msg(1, j, steps[0], ann, "sent", 0), _msg(2, j, steps[1], ann, "sent", 10), _msg(3, j, steps[0], bob, "sent", 0), _msg(4, j, steps[0], cy, "sent", 0)])
    ann.status, bob.status, cy.status = "booked", "unsubscribed", "active"
    await db.commit()
    rows = await J.step_results(db, await db.get(EmailCampaign, j["id"]))
    assert [(r["booked"], r["opted_out"]) for r in rows] == [(0, 1), (1, 0)]  # ann booked after step 2, bob left after step 1


@pytest.mark.db
async def test_preview_uses_real_enrollment_and_footer(client, db, mail):
    j, _ = await _two_step_journey(client, db)
    enr = next(e for e in await _enr(db, j["id"]) if e.email == "bob@client.com")
    enr_id = enr.id
    camp = await db.get(EmailCampaign, j["id"])
    got = await J.preview(db, camp, enr_id)
    assert got["to"] == "bob@client.com" and got["subject"] == "Hello Co bob Ltd" and got["body_text"].startswith("Hi Bob,")
    assert "Acme Outreach Ltd, 1 High Street, Leeds LS1 1AA" in got["footer_text"] and "(unsubscribe link)" in got["footer_text"]
    api = await client.get(f"/api/journeys/{j['id']}/preview", params={"enrollment_id": enr_id})
    assert api.status_code == 200 and api.json()["to"] == "bob@client.com"
    db.expire_all()
    assert (await J.preview(db, await db.get(EmailCampaign, j["id"])))["to"]  # no person chosen: the first one
    empty = await _journey(client, j["mailbox"], [EMAIL])
    with pytest.raises(J.JourneyError):
        await J.preview(db, await db.get(EmailCampaign, empty["id"]))


def test_source_line_register_wording():
    from types import SimpleNamespace

    lead = SimpleNamespace(name="Acme Ltd", source="scout", source_url="", created_at=datetime(2026, 11, 9))
    rec = SimpleNamespace(sources=[{"source_id": "companies_house", "source_type": "api", "confirmed_at": "2026-11-03T10:00:00"}])
    assert J.source_sentence(lead, rec) == "We found Acme Ltd on the Companies House register on 3 Nov 2026."
    web = SimpleNamespace(name="Acme Ltd", source="web", source_url="https://www.acme.co.uk/about", created_at=datetime(2026, 11, 9))
    assert J.source_sentence(web, None) == "We found Acme Ltd on acme.co.uk on 9 Nov 2026."
    for kind in ("import", "manual"):
        assert J.source_sentence(SimpleNamespace(name="Acme Ltd", source=kind, source_url="", created_at=datetime(2026, 11, 9)), None) == ""
    assert J.source_sentence(None) == ""


@pytest.mark.db
async def test_source_line_is_stored_on_enrolment_and_rendered(client, db, mail):
    from app.services.email_worker import render

    mb = await _ready(client, db)
    await _lead(db, id="ld_9", name="Reg Ltd", email="ann@client.com", source="web", source_url="https://reg.example/x")
    j = await _journey(client, mb, [{**EMAIL, "body": "Hi {{first_name}}. {{source_line}} Quick question."}])
    await _people(client, j["id"], "ann@client.com", lead_ids=["ld_9"])
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.vars["source_line"].startswith("We found Reg Ltd on reg.example on ")
    assert "We found Reg Ltd" in render("{{source_line}}", enr)


@pytest.mark.db
async def test_preflight_amber_without_source_line(client, db, mail):
    mb = await _ready(client, db)
    bare = await _journey(client, mb, [EMAIL])
    await _people(client, bare["id"], "ann@client.com")
    with_tag = await _journey(client, mb, [{**EMAIL, "body": "Hi. {{source_line}} Question?"}])
    await _people(client, with_tag["id"], "bob@client.com")

    async def items(jid):
        return await J.preflight(db, await db.get(EmailCampaign, jid), "org_default")

    got = await items(bare["id"])
    hit = [i for i in got if "where you found them" in i["text"]]
    assert len(hit) == 1 and hit[0]["level"] == "amber" and hit[0]["fix"] == "steps"
    assert not [i for i in got if i["level"] == "red"]  # it never blocks
    assert not [i for i in await items(with_tag["id"]) if "where you found them" in i["text"]]


def test_vertical_templates_valid():
    keys = {t["key"]: t for t in J.TEMPLATES}
    for k in ("accountants", "ltd_companies", "landlords"):
        steps = J.clean_steps([dict(s) for s in keys[k]["steps"]])
        assert len(steps) == 3 and "{{source_line}}" in steps[0]["body"] and steps[-1]["channel"] == "call_task"


@pytest.mark.db
async def test_journey_call_step_swaps_to_a_task_without_ai_permission(client, db, mail, monkeypatch):
    from app.services import call_permission as CP

    async def refuse(db_, num, kind="ai", now=None):
        return {"allowed": False, "reasons": ["No permission recorded for AI calls to this number."], "warnings": [], "flags": [], "needs": "ai_consent"}

    monkeypatch.setattr(CP, "decide", refuse)
    mb = await _ready(client, db)
    await _lead(db, id="ld_5", email="ann@client.com", name="Client Ltd", phone="+441132223333")
    j = await _journey(client, mb, [EMAIL, {"channel": "call", "delay_days": 1, "goal": "Ask"}, {**EMAIL, "subject": "", "body": "after", "delay_days": 1}])
    await _people(client, j["id"], "ann@client.com", lead_ids=["ld_5"])
    await _go(client, j["id"])
    await _run(db, MONDAY_10)
    await _run(db, MONDAY_10 + timedelta(minutes=1))
    await _run(db, MONDAY_10 + timedelta(days=1, minutes=5))
    tasks = (await client.get("/api/journeys/tasks")).json()["tasks"]
    assert len(tasks) == 1 and tasks[0]["kind"] == "call_task" and "Check TPS first" in tasks[0]["notes"]
    enr = await _enr(db, j["id"], "ann@client.com")
    assert enr.current_step == 3 and enr.waiting_on == ""  # the journey carried on
