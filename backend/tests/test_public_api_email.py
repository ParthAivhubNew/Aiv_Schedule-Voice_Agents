"""Phase 5: email campaigns through the public API: the AI drafts, someone approves, only then does it send."""
import asyncio
import re
from datetime import datetime

import httpx
import pytest
from sqlalchemy.future import select

pytestmark = pytest.mark.db


def _http(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


@pytest.fixture(autouse=True)
def drafter(monkeypatch):
    """The writing AI is a stand-in; `drafter.fail` makes it unavailable, `drafter.invent` makes it quote a made-up figure."""
    from app.public_api import core
    from app.services import email_writer as W

    core._WINDOWS.clear()
    state = {"calls": [], "fail": False, "invent": False}
    words = ["zero", "one", "two", "three", "four", "five"]

    async def fake(db, system, user, **kwargs):
        if state["fail"]:
            raise W.WriterUnavailable("no key")
        if "FACTS about the receiver" in user:
            state["calls"].append(("line", user, ""))
            return {"line": re.search(r"f1: (.*?) \(source", user).group(1), "fact_ids": ["f1"]}
        if "Rewrite this email." in user:
            body = user[user.index("Subject:"):]
            state["calls"].append(("refine", user, body))
            return {"subject": "Shorter", "body": "Hi {{firstName}},\n\nShorter note.\n\nThanks"}
        count = int(re.search(r"Write (\d) emails", user).group(1))
        state["calls"].append(("sequence", user, ""))
        extra = " We cut costs by 80%." if state["invent"] else ""
        token = "{{personal_line}}\n\n" if "single line {{personal_line}}" in user else ""
        return {"steps": [{"subject": "Subject " + words[n] if n == 1 else "", "body": f"Hi {{{{firstName}}}},\n\n{token if n == 1 else ''}Email {words[n]} about the booking demo.{extra}\n\nThanks"}
                          for n in range(1, count + 1)]}

    monkeypatch.setattr(W, "_ask", fake)
    yield state
    core._WINDOWS.clear()


async def _key(admin_token, scopes=("email:write", "email:approve"), live=True):
    async with _http(admin_token) as c:
        r = await c.post("/api/developer/keys", json={"name": "Email key", "scopes": list(scopes), "live": live})
    assert r.status_code == 200, r.text
    return r.json()["secret"]


async def _company(db, mailbox_status="active", credits=100):
    from app.models.models import CompanyProfile, EmailMailbox
    from app.services import credits as K

    db.add(CompanyProfile(id="default", name="Acme Ltd", approver_emails=["boss@acme.test"]))
    db.add(EmailMailbox(id="mb_1", email="sales@acme.test", status=mailbox_status))
    await db.commit()
    if credits:
        await K.add_credits(db, "leadgen", credits, source="grant")
        await db.commit()


LEADS = [{"email": "jo@bloggs.test", "first_name": "Jo", "last_name": "Bloggs", "company": "Bloggs Ltd"},
         {"email": "sam@acme2.test", "first_name": "Sam", "company": "Acme2"},
         {"email": "not-an-email"}, {"email": "JO@bloggs.test"}]


async def _wait(c, cid, until=("needs_approval", "failed"), tries=100):
    for _ in range(tries):
        body = (await c.get(f"/v1/email/campaigns/{cid}")).json()
        if body["status"] in until:
            return body
        await asyncio.sleep(0.1)
    raise AssertionError(f"campaign stayed {body['status']}")


async def test_the_ai_drafts_a_sequence_and_nothing_sends_until_approved(db, admin_token, drafter):
    from app.models.models import EmailCampaign, EmailEnrollment, EmailSequenceStep

    await _company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/email/campaigns", json={"name": "Dentists", "goal": "Book a demo of our booking software", "audience": "practice managers",
                                                      "emails": 3, "leads": LEADS})
        assert r.status_code == 202, r.text
        made = r.json()
        assert made["status"] == "drafting" and made["leads"] == 2 and made["skipped"] == {"invalid": 1, "duplicate": 1, "do_not_email": 0}
        done = await _wait(c, made["id"])
        assert done["status"] == "needs_approval" and [s["step"] for s in done["steps"]] == [1, 2, 3]
        assert "{{firstName}}" in done["steps"][0]["body"] and done["steps"][2]["delay_days"] == 4
        assert done["estimated_credits"] == 6 and done["mailboxes"] == [{"email": "sales@acme.test", "status": "active"}]
        assert "/api/p/" in done["preview_url"]
    db.expire_all()
    camp = (await db.execute(select(EmailCampaign))).scalars().one()
    assert camp.status == "draft"  # not running: nothing is sent
    assert len((await db.execute(select(EmailSequenceStep))).scalars().all()) == 3
    assert {e.email for e in (await db.execute(select(EmailEnrollment))).scalars().all()} == {"jo@bloggs.test", "sam@acme2.test"}
    assert [c[0] for c in drafter["calls"]] == ["sequence"]  # one grounded writing call for the whole sequence
    assert "Book a demo of our booking software" in drafter["calls"][0][1] and "practice managers" in drafter["calls"][0][1]
    assert done["warnings"] == []


async def test_your_own_emails_skip_the_ai(db, admin_token, drafter):
    await _company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/email/campaigns", json={"name": "Mine", "leads": LEADS[:1], "steps": [
            {"subject": "Hello", "body": "Hi {{firstName}}, quick question."}, {"body": "Following up.", "delay_days": 2}]})
        assert r.status_code == 202 and r.json()["status"] == "needs_approval" and len(r.json()["steps"]) == 2
    assert drafter["calls"] == []


async def test_when_the_writing_ai_is_down_nothing_is_invented(db, admin_token, drafter):
    await _company(db)
    drafter["fail"] = True
    key = await _key(admin_token)
    async with _http(key) as c:
        made = (await c.post("/v1/email/campaigns", json={"name": "Dentists", "goal": "Book a demo", "leads": LEADS[:1]})).json()
        done = await _wait(c, made["id"], until=("failed", "needs_approval"))
        assert done["status"] == "failed" and "not available" in done["error"] and done["steps"] == []  # no filler copy saved
        r = await c.post(f"/v1/email/campaigns/{made['id']}/decision", json={"decision": "approve"})
        assert r.status_code == 409 and r.json()["error"]["code"] == "failed"


async def test_a_campaign_needs_a_mailbox_and_people_to_send_to(db, admin_token):
    from app.models.models import CompanyProfile, EmailCampaign

    db.add(CompanyProfile(id="default", name="Acme Ltd"))
    await db.commit()
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/email/campaigns", json={"name": "X", "goal": "Hello", "leads": LEADS[:1]})
        assert r.status_code == 422 and r.json()["error"]["code"] == "no_mailbox" and r.json()["error"]["details"]["fix_url"]
    from app.models.models import EmailMailbox

    db.add(EmailMailbox(id="mb_1", email="sales@acme.test", status="active"))
    await db.commit()
    async with _http(key) as c:
        r = await c.post("/v1/email/campaigns", json={"name": "X", "goal": "Hello", "leads": [{"email": "bad"}]})
        assert r.status_code == 422 and r.json()["error"]["code"] == "no_leads"
        assert (await c.post("/v1/email/campaigns", json={"name": "X", "leads": LEADS[:1]})).status_code == 422  # no goal and no steps
        assert (await c.post("/v1/email/campaigns", json={"name": "X", "goal": "Hi"})).json()["error"]["code"] == "no_leads"
    db.expire_all()
    assert (await db.execute(select(EmailCampaign))).scalars().all() == []  # failed requests leave no empty drafts


async def test_approving_launches_it_and_only_the_approve_scope_may(db, admin_token):
    from app.models.models import EmailCampaign

    await _company(db)
    maker, approver = await _key(admin_token, ("email:write",)), await _key(admin_token)
    async with _http(maker) as c:
        made = (await c.post("/v1/email/campaigns", json={"name": "Dentists", "goal": "Book a demo", "leads": LEADS[:2]})).json()
        await _wait(c, made["id"])
        denied = await c.post(f"/v1/email/campaigns/{made['id']}/decision", json={"decision": "approve"})
        assert denied.status_code == 403 and denied.json()["error"]["code"] == "missing_scope"
    async with _http(approver) as c:
        ok = (await c.post(f"/v1/email/campaigns/{made['id']}/decision", json={"decision": "approve"})).json()
        assert ok["status"] == "sending" and ok["approved_by"] == "api:Email key"
        assert (await c.post(f"/v1/email/campaigns/{made['id']}/decision", json={"decision": "approve"})).json()["status"] == "sending"
        no_reject = await c.post(f"/v1/email/campaigns/{made['id']}/decision", json={"decision": "reject"})
        assert no_reject.status_code == 409 and no_reject.json()["error"]["code"] == "already_sending"
    db.expire_all()
    assert (await db.execute(select(EmailCampaign))).scalars().one().status == "running"  # the app's own sender picks it up


async def test_approval_is_refused_when_it_could_not_send(db, admin_token):
    await _company(db, credits=0)
    from app.services import credits as K

    await K.add_credits(db, "leadgen", 1, source="grant")
    await db.commit()
    key = await _key(admin_token)
    async with _http(key) as c:
        made = (await c.post("/v1/email/campaigns", json={"name": "N", "leads": LEADS[:2], "steps": [{"subject": "S", "body": "B"}]})).json()
        from app.models.models import EmailMailbox

        box = await db.get(EmailMailbox, "mb_1")
        box.status = "paused"  # its mailbox was switched off after the draft was made
        await db.commit()
        cold = await c.post(f"/v1/email/campaigns/{made['id']}/decision", json={"decision": "approve"})
        assert cold.status_code == 409 and cold.json()["error"]["code"] == "mailbox_not_ready"
    mb = await db.get(EmailMailbox, "mb_1")
    mb.status = "active"
    await db.commit()
    async with _http(key) as c:
        poor = await c.post(f"/v1/email/campaigns/{made['id']}/decision", json={"decision": "approve"})
        assert poor.status_code == 402 and poor.json()["error"]["code"] == "insufficient_credits"  # 2 emails, 1 credit


async def test_changes_pause_a_running_campaign_until_it_is_approved_again(db, admin_token):
    await _company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        made = (await c.post("/v1/email/campaigns", json={"name": "Mine", "leads": LEADS[:2], "steps": [{"subject": "S", "body": "Hi {{firstName}}"}]})).json()
        url = f"/v1/email/campaigns/{made['id']}"
        assert (await c.post(url + "/decision", json={"decision": "approve"})).json()["status"] == "sending"
        paused = (await c.patch(url, json={"action": "pause"})).json()
        assert paused["status"] == "paused"
        assert (await c.patch(url, json={"action": "resume"})).json()["status"] == "sending"
        edited = (await c.patch(url, json={"steps": [{"subject": "New subject", "body": "Changed {{firstName}}"}]})).json()
        assert edited["status"] == "needs_approval" and edited["steps"][0]["subject"] == "New subject"
        blocked = await c.patch(url, json={"action": "resume"})
        assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "not_approved"
        assert (await c.post(url + "/decision", json={"decision": "approve"})).json()["status"] == "sending"
        assert (await c.patch(url, json={})).json()["error"]["code"] == "nothing_to_change"


async def test_asking_the_ai_to_rewrite_sends_it_back_for_approval(db, admin_token, drafter):
    await _company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        made = (await c.post("/v1/email/campaigns", json={"name": "Dentists", "goal": "Book a demo", "emails": 2, "leads": LEADS[:1]})).json()
        await _wait(c, made["id"])
        before = len(drafter["calls"])
        again = (await c.patch(f"/v1/email/campaigns/{made['id']}", json={"regenerate": {"instruction": "make it shorter"}})).json()
        assert again["status"] == "drafting"
        done = await _wait(c, made["id"])
        assert done["status"] == "needs_approval" and len(done["steps"]) == 2
    rewrites = drafter["calls"][before:]
    assert len(rewrites) == 2 and all("make it shorter" in r[1] and r[2] for r in rewrites)  # each email is rewritten from its current text


async def test_pressing_start_in_the_app_counts_as_approval(db, admin_token):
    await _company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        made = (await c.post("/v1/email/campaigns", json={"name": "Mine", "leads": LEADS[:1], "steps": [{"subject": "S", "body": "B"}]})).json()
    async with _http(admin_token) as app_user:
        assert (await app_user.post(f"/api/email/campaigns/{made['id']}/status", json={"status": "running"})).status_code == 200
    await asyncio.sleep(0.2)
    async with _http(key) as c:
        got = (await c.get(f"/v1/email/campaigns/{made['id']}")).json()
        assert got["status"] == "sending" and got["approved_by"] == "app"


async def test_the_preview_page_needs_no_sign_in_and_acts_on_the_same_campaign(db, admin_token):
    from app.models.models import EmailCampaign

    await _company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        made = (await c.post("/v1/email/campaigns", json={"name": "Mine", "leads": LEADS[:2], "steps": [{"subject": "Hello", "body": "Hi {{firstName}}, a question."}]})).json()
    path = "/api/p/" + made["preview_url"].split("/api/p/")[1]
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        page = await anon.get(path)
        assert page.status_code == 200 and "Hi {{firstName}}, a question." in page.text and "Approve and start sending" in page.text
        saved = await anon.post(path, data={"action": "save", "subject_1": "Better subject", "body_1": "Hi {{firstName}}, edited here.", "delay_1": "0"})
        assert "Saved" in saved.text and "edited here." in saved.text
        approved = await anon.post(path, data={"action": "approve"})
        assert "Approved" in approved.text and "Sending" in approved.text
        assert (await anon.get("/api/p/garbage")).status_code == 404
    db.expire_all()
    assert (await db.execute(select(EmailCampaign))).scalars().one().status == "running"
    async with _http(key) as c:
        got = (await c.get(f"/v1/email/campaigns/{made['id']}")).json()
        assert got["approved_by"] == "preview link" and got["steps"][0]["subject"] == "Better subject"


async def test_events_ready_approved_reply_and_finished_are_sent_once(db, admin_token, monkeypatch):
    from app.models.models import EmailCampaign, EmailEnrollment, EmailMessage
    from app.public_api import email_events
    from app.services import webhook_dispatcher as W

    sent, mails = [], []
    monkeypatch.setattr(W, "dispatch_event", lambda org, event, data, test=False: sent.append(event))

    async def fake_send(db_, to, subject, html_body, text_body):
        mails.append((to, subject))
        return {"ok": True}

    monkeypatch.setattr("app.services.approval_mail._send", fake_send)
    await _company(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        made = (await c.post("/v1/email/campaigns", json={"name": "Mine", "leads": LEADS[:1], "steps": [{"subject": "S", "body": "B"}]})).json()
        await email_events.tick(db)
        await email_events.tick(db)
        assert sent == ["campaign.ready"] and mails == [("boss@acme.test", "Acme Ltd: an email campaign is waiting for your approval")]
        await c.post(f"/v1/email/campaigns/{made['id']}/decision", json={"decision": "approve"})
        await email_events.tick(db)
        assert sent == ["campaign.ready", "campaign.approved"]
        enr = (await db.execute(select(EmailEnrollment))).scalars().one()
        db.add(EmailMessage(id="msg_1", campaign_id=made["id"], enrollment_id=enr.id, recipient_email="jo@bloggs.test", subject="S", status="replied",
                            reply_from="jo@bloggs.test", reply_snippet="Yes please", reply_category="interested", replied_at=datetime.utcnow()))
        await db.commit()
        await email_events.tick(db)
        await email_events.tick(db)
        assert sent.count("campaign.reply") == 1
        camp = (await db.execute(select(EmailCampaign))).scalars().one()
        camp.status = "completed"
        await db.commit()
        await email_events.tick(db)
        assert sent[-1] == "campaign.completed"
        got = (await c.get(f"/v1/email/campaigns/{made['id']}")).json()
        assert got["replies"][0]["text"] == "Yes please" and got["stats"]["replied"] == 1


async def test_test_keys_get_a_full_pretend_campaign(db, admin_token, monkeypatch):
    from app.models.models import EmailCampaign
    from app.services import webhook_dispatcher as W

    monkeypatch.setenv("PUBLIC_API_SANDBOX_CALL_SECONDS", "0")
    sent = []
    monkeypatch.setattr(W, "dispatch_event", lambda org, event, data, test=False: sent.append((event, test)))
    key = await _key(admin_token, live=False)
    async with _http(key) as c:
        made = await c.post("/v1/email/campaigns", json={"name": "Practice", "goal": "Book demos", "emails": 2, "leads": LEADS[:2]})
        assert made.status_code == 202
        cp = made.json()
        assert cp["id"].startswith("cp_test_") and cp["status"] == "needs_approval" and len(cp["steps"]) == 2 and cp["test"] is True
        ok = (await c.post(f"/v1/email/campaigns/{cp['id']}/decision", json={"decision": "approve"})).json()
        assert ok["status"] in ("sending", "completed")
        await asyncio.sleep(0.05)
        done = (await c.get(f"/v1/email/campaigns/{cp['id']}")).json()
        assert done["status"] == "completed" and done["stats"]["sent"] == 4
        assert len((await c.get("/v1/email/campaigns")).json()["data"]) == 1
    assert [e for e, t in sent] == ["campaign.ready", "campaign.approved", "campaign.completed"] and all(t for _, t in sent)
    db.expire_all()
    assert (await db.execute(select(EmailCampaign))).scalars().all() == []


async def test_a_figure_the_ai_invents_is_reported_to_whoever_approves(db, admin_token, drafter):
    await _company(db)
    drafter["invent"] = True
    key = await _key(admin_token)
    async with _http(key) as c:
        made = (await c.post("/v1/email/campaigns", json={"name": "Dentists", "goal": "Book a demo", "emails": 2, "leads": LEADS[:1]})).json()
        done = await _wait(c, made["id"])
    assert done["status"] == "needs_approval"  # a person still decides, but is told what to check
    assert any("80%" in w and w.startswith("Email 1") for w in done["warnings"])
    assert len([c for c in drafter["calls"] if c[0] == "sequence"]) == 2  # it was asked once more before giving up


async def test_opening_lines_come_from_the_callers_facts_and_the_register_and_are_paid_per_five(db, admin_token, drafter):
    from app.models.models import BusinessRecord, EmailEnrollment
    from app.services import credits as K

    await _company(db, credits=100)
    db.add(BusinessRecord(id="br_1", identity_hash="h1", name="Kirkgate Dental Ltd", registration_number="01234567", domain="kirkgate.test",
                          region="Leeds", status="active"))
    await db.commit()
    key = await _key(admin_token)
    leads = [{"email": "a@x.test", "first_name": "Ann", "company": "Alpha", "facts": ["Their new contract covers door entry systems"]},
             {"email": "b@kirkgate.test", "first_name": "Bo", "company": "Kirkgate Dental", "company_number": "01234567"},
             {"email": "c@none.test", "first_name": "Cy", "company": "Nothing Known"}]
    async with _http(key) as c:
        made = (await c.post("/v1/email/campaigns", json={"name": "Lines", "goal": "Book a demo", "emails": 2, "personalise": True, "leads": leads})).json()
        done = await _wait(c, made["id"])
    assert done["status"] == "needs_approval" and "{{personal_line}}" in done["steps"][0]["body"]
    by = {p["email"]: p for p in done["personal_lines"]}
    assert set(by) == {"a@x.test", "b@kirkgate.test"}, done["warnings"]  # nothing is written for someone we know nothing about
    assert by["a@x.test"]["line"] == "Their new contract covers door entry systems" and by["a@x.test"]["based_on"][0]["source"] == "supplied by the sender"
    assert by["b@kirkgate.test"]["based_on"][0]["source"] == "company register"  # matched by company number, not by name
    assert any("2 of 3" in w for w in done["warnings"])
    db.expire_all()
    assert await K.wallet_balance(db, "leadgen") == 99  # two lines written = one credit
    stored = {e.email: e.vars for e in (await db.execute(select(EmailEnrollment))).scalars().all()}
    assert stored["a@x.test"]["personal_line"] and "personal_line" not in (stored["c@none.test"] or {})


async def test_a_company_is_matched_to_the_register_only_when_it_is_certain(db):
    from app.models.models import BusinessRecord
    from app.services import email_writer as W

    db.add_all([BusinessRecord(id="br_a", identity_hash="ha", name="Alpha Ltd", registration_number="111", domain="alpha.test"),
                BusinessRecord(id="br_b", identity_hash="hb", name="Beta One Ltd", registration_number="222", domain="shared.test"),
                BusinessRecord(id="br_c", identity_hash="hc", name="Beta Two Ltd", registration_number="333", domain="shared.test")])
    await db.commit()
    assert (await W.register_match(db, number="111")).id == "br_a"
    assert (await W.register_match(db, website="https://www.alpha.test/about")).id == "br_a"
    assert (await W.register_match(db, email="jo@alpha.test")).id == "br_a"
    assert await W.register_match(db, website="shared.test") is None  # two companies share it: never guess
    assert await W.register_match(db, email="jo@gmail.com") is None  # free mail says nothing about the company
    assert await W.register_match(db, number="999") is None


async def test_your_own_emails_can_still_get_opening_lines_but_only_if_they_use_the_field(db, admin_token, drafter):
    await _company(db)
    key = await _key(admin_token)
    lead = [{"email": "a@x.test", "first_name": "Ann", "company": "Alpha", "facts": ["Based in Leeds"]}]
    async with _http(key) as c:
        used = (await c.post("/v1/email/campaigns", json={"name": "A", "personalise": True, "leads": lead,
                                                          "steps": [{"subject": "Hi", "body": "Hi {{firstName}},\n\n{{personal_line}}\n\nQuick question."}]})).json()
        done = await _wait(c, used["id"])
        assert [p["line"] for p in done["personal_lines"]] == ["Based in Leeds"]
        unused = (await c.post("/v1/email/campaigns", json={"name": "B", "personalise": True, "leads": [{**lead[0], "email": "b@x.test"}],
                                                            "steps": [{"subject": "Hi", "body": "Hi {{firstName}}, quick question."}]})).json()
        done = await _wait(c, unused["id"])
        assert done["personal_lines"] == [] and any("none of the emails uses" in w for w in done["warnings"])


@pytest.fixture
def outbox(monkeypatch):
    from app.services import mail_transport as T

    sent = []

    async def fake_send(settings, msg):
        sent.append(msg)

    monkeypatch.setattr(T, "send", fake_send)
    return sent


async def _ready_box(db, status="warming", spf=True, dkim_skipped=True):
    from app.models.models import EmailMailbox

    mb = await db.get(EmailMailbox, "mb_1")
    mb.status, mb.spf_verified, mb.dkim_override = status, spf, dkim_skipped
    await db.commit()


async def test_one_email_can_go_now_even_from_a_mailbox_still_warming_up(db, admin_token, outbox):
    from app.services import credits as K

    await _company(db, mailbox_status="warming", credits=100)
    await _ready_box(db)
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/email/send", json={"to": "Jo@Bloggs.test", "subject": "Hello {{firstName}}", "body": "Hi {{firstName}} at {{company}},\n\nA quick note.\n\nThanks",
                                                 "first_name": "Jo", "company": "Bloggs Ltd"})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "sent" and r.json()["from"] == "sales@acme.test" and r.json()["to"] == "jo@bloggs.test"
    assert len(outbox) == 1 and outbox[0]["Subject"] == "Hello Jo" and "Hi Jo at Bloggs Ltd" in outbox[0].as_string()
    assert outbox[0]["List-Unsubscribe"]  # the unsubscribe link is always there
    db.expire_all()
    assert await K.wallet_balance(db, "leadgen") == 99


async def test_one_to_one_sending_keeps_its_safety_rules(db, admin_token, outbox, monkeypatch):
    from app.public_api import email as E

    await _company(db, mailbox_status="active", credits=100)
    await _ready_box(db, status="active")
    key = await _key(admin_token)
    weak = await _key(admin_token, scopes=("email:write",))
    body = {"to": "jo@bloggs.test", "subject": "Hi", "body": "Hello"}
    async with _http(weak) as c:
        assert (await c.post("/v1/email/send", json=body)).status_code == 403  # sending needs the approve permission
    async with _http(key) as c:
        assert (await c.post("/v1/email/send", json={**body, "to": "nope"})).json()["error"]["code"] == "invalid_email"
        person = await c.post("/v1/email/send", json={**body, "to_is_a_person": True})
        assert person.status_code == 422 and person.json()["error"]["code"] == "needs_consent" and outbox == []
        monkeypatch.setattr(E, "DIRECT_DAILY_LIMIT", 1)
        assert (await c.post("/v1/email/send", json=body)).status_code == 201
        limited = await c.post("/v1/email/send", json={**body, "to": "sam@bloggs.test"})
        assert limited.status_code == 429 and limited.json()["error"]["code"] == "daily_limit"


async def test_nothing_sends_without_a_mailbox_that_passes_spf(db, admin_token, outbox):
    await _company(db, mailbox_status="active", credits=100)
    await _ready_box(db, status="active", spf=False)
    key = await _key(admin_token)
    async with _http(key) as c:
        r = await c.post("/v1/email/send", json={"to": "jo@bloggs.test", "subject": "Hi", "body": "Hello"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_mailbox" and outbox == []


async def test_a_test_key_pretends_to_send(db, admin_token, outbox):
    key = await _key(admin_token, live=False)
    async with _http(key) as c:
        r = await c.post("/v1/email/send", json={"to": "jo@bloggs.test", "subject": "Hi", "body": "Hello"})
    assert r.status_code == 201 and r.json()["test"] is True and outbox == []


async def test_sent_emails_can_be_listed_and_read_through_the_api(db, admin_token):
    from app.models.models import EmailMessage

    await _company(db)
    now = datetime.utcnow()
    db.add_all([EmailMessage(id="p1", mailbox_id="mb_1", campaign_id="", recipient_email="jo@x.test", subject="Hello", body_text="Hi Jo", status="sent", sent_at=now),
                EmailMessage(id="p2", mailbox_id="mb_1", campaign_id="cp_x", recipient_email="sam@y.test", subject="Hi", body_text="Hi Sam", status="replied",
                             reply_snippet="Sounds good", sent_at=now),
                EmailMessage(id="p3", mailbox_id="mb_1", recipient_email="w@w.test", subject="warm", is_warmup=True, status="sent", sent_at=now)])
    await db.commit()
    key = await _key(admin_token)
    async with _http(key) as c:
        everything = (await c.get("/v1/email/messages")).json()
        assert sorted(m["id"] for m in everything["data"]) == ["p1", "p2"] and everything["next_cursor"] is None
        assert [m["id"] for m in (await c.get("/v1/email/messages", params={"status": "replied"})).json()["data"]] == ["p2"]
        assert [m["id"] for m in (await c.get("/v1/email/messages", params={"kind": "one_to_one"})).json()["data"]] == ["p1"]
        first = (await c.get("/v1/email/messages", params={"limit": 1})).json()
        assert len(first["data"]) == 1 and first["next_cursor"]
        one = (await c.get("/v1/email/messages/p2")).json()
        assert one["body"] == "Hi Sam" and one["reply"] == "Sounds good"
        assert (await c.get("/v1/email/messages/p3")).status_code == 404
        assert (await c.get("/v1/email/messages", params={"status": "weird"})).status_code == 422
    test = await _key(admin_token, live=False)
    async with _http(test) as c:
        assert (await c.get("/v1/email/messages")).json()["data"] == []  # a test key never sees real mail
