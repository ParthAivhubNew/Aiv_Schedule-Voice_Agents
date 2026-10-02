"""Email outreach end to end with a fake mail server: connecting a mailbox, campaigns sending
inside their hours, follow-ups threading, replies and bounces stopping a lead, unsubscribe
links, the do-not-email list, finding emails (charged only when found) and the platform
mailbox staff set in the owner portal."""
import json
from datetime import datetime, timedelta

import pytest

from app.services import mail_transport as T

pytestmark = pytest.mark.db

MONDAY_10 = datetime(2027, 1, 4, 10, 0)  # winter: London time = UTC


class FakeMail:
    def __init__(self):
        self.sent = []  # (settings, message)
        self.inbox = []  # Incoming waiting to be read
        self.rescued = []

    async def check_login(self, settings):
        if settings.get("password") == "wrong":
            raise T.MailError("Sending (SMTP) rejected the username or password.")

    async def send(self, settings, msg):
        self.sent.append((settings, msg))

    async def fetch_new(self, settings, last_uid, limit=100):
        mine = [m for m in self.inbox if m.uid > last_uid]
        self.inbox = [m for m in self.inbox if m not in mine]
        return mine, max([last_uid, *(m.uid for m in mine)])

    async def rescue_warmup(self, settings, seen_uids=None):
        self.rescued.append(list(seen_uids or []))
        return 0


@pytest.fixture
def mail(monkeypatch):
    fake = FakeMail()
    for name in ("check_login", "send", "fetch_new", "rescue_warmup"):
        monkeypatch.setattr(T, name, getattr(fake, name))

    async def dns(domain, dkim_selector=None):
        return {"domain": domain, "spf_verified": True, "dkim_verified": True, "dmarc_verified": True,
                "mx_verified": True, "all_passed": True, "recommendations": []}

    from app.api import email_outreach

    monkeypatch.setattr(email_outreach, "verify_domain_dns", dns)

    async def no_ai(*a, **k):
        raise RuntimeError("no AI in tests")

    import app.services.llm_gateway as G

    monkeypatch.setattr(G, "call_open_chat_llm", no_ai)
    from app.services import platform_mailbox

    monkeypatch.setattr(platform_mailbox, "_cache", {})
    return fake


async def _mailbox(client, email="sam@acme-sales.com"):
    r = await client.post("/api/email/mailboxes", json={"email": email, "display_name": "Sam", "preset": "one.com",
                                                        "password": "pw", "signature": "Sam, Acme"})
    assert r.status_code == 200, r.text
    return r.json()["mailbox"]


async def _run(db, when):
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.services.email_worker import run_org

    with org_scope("org_default"):
        async with AsyncSessionLocal() as s:
            return await run_org(s, "org_default", when)


def test_bounce_reply_and_warmup_mail_are_read_correctly():
    dsn = (b"From: Mail Delivery System <MAILER-DAEMON@mx.example.net>\r\nTo: sam@acme-sales.com\r\n"
           b"Subject: Undelivered Mail Returned to Sender\r\nMIME-Version: 1.0\r\n"
           b"Content-Type: multipart/report; report-type=delivery-status; boundary=\"B\"\r\n\r\n"
           b"--B\r\nContent-Type: text/plain\r\n\r\nYour message could not be delivered.\r\n"
           b"--B\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; mx.example.net\r\n\r\n"
           b"Final-Recipient: rfc822; gone@client.com\r\nAction: failed\r\nStatus: 5.1.1\r\n\r\n"
           b"--B\r\nContent-Type: text/rfc822-headers\r\n\r\nMessage-ID: <abc@acme-sales.com>\r\nSubject: Hi\r\n\r\n--B--\r\n")
    b = T.parse_message(dsn, 7)
    assert b.is_bounce and b.failed_recipients == ["gone@client.com"] and b.bounce_status == "5.1.1"
    assert b.bounced_message_id == "<abc@acme-sales.com>"

    reply = (b"From: Ann <ann@client.com>\r\nTo: sam@acme-sales.com\r\nSubject: Re: Hi\r\n"
             b"In-Reply-To: <abc@acme-sales.com>\r\nReferences: <zz@x> <abc@acme-sales.com>\r\n\r\n"
             b"Yes, let's talk on Tuesday.\r\n\r\nOn Mon, Sam wrote:\r\n> Hi Ann\r\n")
    r = T.parse_message(reply, 8)
    assert not r.is_bounce and r.in_reply_to == "<abc@acme-sales.com>" and "<zz@x>" in r.references
    assert T.reply_text(r.text) == "Yes, let's talk on Tuesday."
    w = T.parse_message(b"From: a@b.com\r\nX-OutReach-Warmup: w1\r\nSubject: x\r\n\r\nhi", 9)
    assert w.warmup_id == "w1"
    from app.services.inbox_reader import classify_rules

    assert classify_rules("Please remove me from your list") == "unsubscribe"
    assert classify_rules("Not interested, thanks") == "not_interested"
    assert classify_rules("I'm out of the office until Monday") == "ooo"


async def test_a_campaign_sends_in_hours_threads_follow_ups_and_stops_on_reply_or_bounce(client, db, mail):
    r = await client.post("/api/email/mailboxes", json={"email": "x@acme-sales.com", "preset": "one.com", "password": "wrong"})
    assert r.status_code == 400 and "rejected" in r.json()["detail"]
    mb = await _mailbox(client)
    assert mb["smtp_host"] == "send.one.com" and "password" not in json.dumps(mb)
    assert (await client.post(f"/api/email/mailboxes/{mb['id']}/warmup", json={"action": "skip"})).json()["mailbox"]["status"] == "active"

    camp = (await client.post("/api/email/campaigns", json={
        "name": "Q1", "mailbox_ids": [mb["id"]], "min_delay_seconds": 30,
        "steps": [{"subject": "Idea for {{company}}", "body": "Hi {{first_name}},\n\nQuick idea."},
                  {"delay_days": 3, "body": "Hi {{first_name}}, any thoughts?"}]})).json()["campaign"]
    assert camp["status"] == "draft" and len(camp["steps"]) == 2
    await client.post("/api/email/suppression", json={"email": "blocked@other.com"})
    added = (await client.post(f"/api/email/campaigns/{camp['id']}/leads", json={"leads": [
        {"email": "ann@client.com", "first_name": "Ann", "company": "Client Ltd"},
        {"email": "gone@client.com", "first_name": "Gus", "company": "Client Ltd"},
        {"email": "ann@client.com"}, {"email": "not-an-email"}, {"email": "blocked@other.com"}]})).json()
    assert added == {"added": 2, "skipped": {"invalid": 1, "duplicate": 1, "do_not_email": 1}}
    assert (await client.post(f"/api/email/campaigns/{camp['id']}/status", json={"status": "running"})).status_code == 200

    # Saturday: outside the campaign's days, nothing goes out.
    await _run(db, datetime(2027, 1, 2, 10, 0))
    assert mail.sent == []
    await _run(db, MONDAY_10)
    await _run(db, MONDAY_10 + timedelta(minutes=1))
    first = [m for _, m in mail.sent]
    assert sorted(m["To"] for m in first) == ["ann@client.com", "gone@client.com"]
    ann = next(m for m in first if m["To"] == "ann@client.com")
    assert ann["Subject"] == "Idea for Client Ltd" and "List-Unsubscribe-Post" in ann
    assert "Hi Ann," in ann.get_body(("plain",)).get_content() and "Sam, Acme" in ann.get_body(("plain",)).get_content()
    gone = next(m for m in first if m["To"] == "gone@client.com")

    # Ann replies; Gus's address bounces.
    mail.inbox = [
        T.Incoming(uid=1, from_addr="ann@client.com", subject="Re: Idea", in_reply_to=ann["Message-ID"],
                   text="Sounds good, let's talk Tuesday."),
        T.Incoming(uid=2, from_addr="mailer-daemon@mx.net", is_bounce=True, failed_recipients=["gone@client.com"],
                   bounce_status="5.1.1", bounced_message_id=gone["Message-ID"]),
    ]
    await _run(db, MONDAY_10 + timedelta(minutes=10))
    replies = (await client.get("/api/email/replies")).json()["replies"]
    assert [(x["email"], x["category"], x["name"]) for x in replies] == [("ann@client.com", "interested", "Ann")]
    sup = [s["email"] for s in (await client.get("/api/email/suppression")).json()["suppressions"]]
    assert "gone@client.com" in sup
    leads = {l["email"]: l["status"] for l in (await client.get(f"/api/email/campaigns/{camp['id']}")).json()["campaign"]["lead_list"]}
    assert leads == {"ann@client.com": "replied", "gone@client.com": "bounced"}
    # Nobody is left, so no follow-ups and the campaign completes.
    before = len(mail.sent)
    await _run(db, MONDAY_10 + timedelta(days=3, minutes=20))
    assert len(mail.sent) == before
    assert (await client.get(f"/api/email/campaigns/{camp['id']}")).json()["campaign"]["status"] == "completed"


async def test_follow_up_threads_under_the_first_email_on_the_same_mailbox(client, db, mail):
    mb = await _mailbox(client)
    await client.post(f"/api/email/mailboxes/{mb['id']}/warmup", json={"action": "skip"})
    camp = (await client.post("/api/email/campaigns", json={
        "name": "F", "mailbox_ids": [mb["id"]],
        "steps": [{"subject": "Hello", "body": "One"}, {"delay_days": 2, "body": "Two"}]})).json()["campaign"]
    await client.post(f"/api/email/campaigns/{camp['id']}/leads", json={"leads": [{"email": "bo@corp.io", "company": "Corp"}]})
    await client.post(f"/api/email/campaigns/{camp['id']}/status", json={"status": "running"})
    await _run(db, MONDAY_10)
    await _run(db, MONDAY_10 + timedelta(days=1))  # not due yet
    assert len(mail.sent) == 1
    await _run(db, MONDAY_10 + timedelta(days=2, minutes=5))
    first, second = mail.sent[0][1], mail.sent[1][1]
    assert second["Subject"] == "Re: Hello" and second["In-Reply-To"] == first["Message-ID"]


async def test_unsubscribe_link_needs_the_button_and_stops_the_lead(client, anon, db, mail):
    from app.services.email_dispatcher import unsubscribe_token

    mb = await _mailbox(client)
    camp = (await client.post("/api/email/campaigns", json={"name": "U", "mailbox_ids": [mb["id"]],
                                                            "steps": [{"subject": "Hi", "body": "x"}]})).json()["campaign"]
    await client.post(f"/api/email/campaigns/{camp['id']}/leads", json={"leads": [{"email": "cy@corp.io"}]})
    token = unsubscribe_token("org_default", "cy@corp.io")
    assert (await anon.get(f"/api/email/u/{token}")).status_code == 200
    assert (await client.get("/api/email/suppression")).json()["suppressions"] == []
    assert (await anon.post(f"/api/email/u/{token}x")).status_code == 404
    assert (await anon.post(f"/api/email/u/{token}")).status_code == 200
    assert [s["email"] for s in (await client.get("/api/email/suppression")).json()["suppressions"]] == ["cy@corp.io"]
    lead = (await client.get(f"/api/email/campaigns/{camp['id']}")).json()["campaign"]["lead_list"][0]
    assert lead["status"] == "unsubscribed"


async def test_domain_entries_block_the_whole_domain_and_single_addresses_do_not(client, db, mail):
    from app.services.email_dispatcher import is_email_suppressed

    await client.post("/api/email/suppression", json={"email": "one@big.com"})
    await client.post("/api/email/suppression", json={"email": "rival.com"})
    assert (await is_email_suppressed(db, "one@big.com", "org_default"))[0]
    assert not (await is_email_suppressed(db, "two@big.com", "org_default"))[0]
    assert (await is_email_suppressed(db, "anyone@rival.com", "org_default"))[0]
    assert not (await is_email_suppressed(db, "one@big.com", "org_other"))[0]


async def _finder_key(db, name="Hunter"):
    from sqlalchemy import text

    from app.core.tenancy import system_scope

    with system_scope():
        await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES ('org_outreach', 'OutReach', 'outreach', 'platform') "
                              "ON CONFLICT (id) DO NOTHING"))
        await db.execute(text("INSERT INTO connections (id, org_id, group_name, name, status, config) "
                              "VALUES (:i, 'org_outreach', 'Email Finder', :n, 'connected', :c)"),
                         {"i": f"c_{name}", "n": name, "c": json.dumps({"api_key": "k-" + name})})
        await db.commit()


async def _credits(db, n=10):
    from app.core.tenancy import org_scope
    from app.services import credits as K

    with org_scope("org_default"):
        await K.add_credits(db, "leadgen", n, source="grant", note="Trial")
        await db.commit()


async def _charges(db):
    from sqlalchemy import text

    from app.core.tenancy import system_scope

    with system_scope():
        return (await db.execute(text("SELECT count(*) FROM credit_ledger WHERE ref LIKE 'lead:%'"))).scalar()


async def test_finding_emails_uses_saved_providers_and_charges_only_verified_finds(client, db, mail, monkeypatch):
    from app.services import enrichment_waterfall as W

    await _credits(db)
    body = {"first_name": "Ann", "last_name": "Lee", "domain": "https://www.client.com/about"}
    r = await client.post("/api/email/find", json=body)
    assert r.status_code == 503 and "isn't set up" in r.json()["detail"]

    await _finder_key(db, "Hunter")
    await _finder_key(db, "Findymail")
    calls = []

    async def hunter(client_, key, p):
        calls.append(("hunter", key, p["domain"]))
        return "ann@client.com", "catch_all"

    async def findymail(client_, key, p):
        calls.append(("findymail", key, p["domain"]))
        return ("ann.lee@client.com", "verified") if p["last_name"] == "Lee" else ("", "")

    monkeypatch.setattr(W, "ADAPTERS", {**W.ADAPTERS, "hunter": hunter, "findymail": findymail})
    got = (await client.post("/api/email/find", json=body)).json()
    assert got["email"] == "ann.lee@client.com" and got["source"] == "findymail" and got["verification_status"] == "verified"
    assert calls == [("hunter", "k-Hunter", "client.com"), ("findymail", "k-Findymail", "client.com")]
    assert await _charges(db) == 1

    again = (await client.post("/api/email/find", json=body)).json()
    assert again["source"] == "cache" and len(calls) == 2 and await _charges(db) == 2

    miss = (await client.post("/api/email/find", json={"first_name": "Bo", "last_name": "Nobody", "domain": "x.com"})).json()
    assert miss["found"] is False or miss["verification_status"] == "catch_all"


async def test_nothing_found_is_free_and_not_remembered(client, db, mail, monkeypatch):
    from sqlalchemy import text

    from app.services import enrichment_waterfall as W

    await _credits(db)
    await _finder_key(db, "LeadMagic")

    async def nothing(client_, key, p):
        return "", ""

    monkeypatch.setattr(W, "ADAPTERS", {**W.ADAPTERS, "leadmagic": nothing})
    got = (await client.post("/api/email/find", json={"first_name": "Bo", "last_name": "Lee", "company_name": "Corp"})).json()
    assert got["found"] is False
    assert await _charges(db) == 0
    assert (await db.execute(text("SELECT count(*) FROM person_cache"))).scalar() == 0


async def test_staff_set_the_platform_mailbox_and_it_answers_warmup_mail(staff, db, mail, monkeypatch):
    from app.core import mailer
    from app.services import email_worker

    r = await staff.put("/api/admin-api/platform-mailbox", json={"email": "hello@outreach.test", "preset": "one.com",
                                                             "password": "secret-pw", "from_name": "OutReach"})
    assert r.status_code == 200, r.text
    got = (await staff.get("/api/admin-api/platform-mailbox")).json()
    assert got["configured"] and got["smtp_host"] == "send.one.com" and got["has_password"]
    assert "secret-pw" not in json.dumps(got)
    assert mailer.configured()
    # A blank password keeps the saved one.
    assert (await staff.put("/api/admin-api/platform-mailbox", json={"email": "hello@outreach.test", "preset": "one.com"})).status_code == 200

    monkeypatch.setattr(email_worker, "_platform_checked", None)
    monkeypatch.setattr(email_worker, "REPLY_SHARE", 1.0)
    mail.inbox = [T.Incoming(uid=3, from_addr="sam@acme-sales.com", subject="Notes from today", message_id="<w@a>", warmup_id="w9"),
                  T.Incoming(uid=4, from_addr="someone@else.com", subject="Real mail")]
    assert await email_worker.platform_partner(MONDAY_10) == 1
    assert mail.rescued[-1] == [3]
    reply = mail.sent[-1][1]
    assert reply["To"] == "sam@acme-sales.com" and reply["In-Reply-To"] == "<w@a>" and reply[T.WARMUP_HEADER] == "w9"

    keys = (await staff.get("/api/admin-api/platform-keys")).json()["groups"]
    finder = next(g for g in keys if g["group"] == "Email Finder")
    assert [i["name"] for i in finder["items"]] == ["Icypeas", "Hunter", "Findymail", "LeadMagic", "BetterContact"]


async def test_warming_mailboxes_warm_each_other_and_skip_campaigns_in_week_one(client, db, mail):
    a = await _mailbox(client, "a@acme-sales.com")
    b = await _mailbox(client, "b@acme-sales.com")
    for m in (a, b):
        await client.post(f"/api/email/mailboxes/{m['id']}/warmup", json={"action": "start"})
    await _run(db, MONDAY_10)
    boxes = {m["email"]: m for m in (await client.get("/api/email/mailboxes")).json()["mailboxes"]}
    assert boxes["a@acme-sales.com"]["status"] == "warming"
    assert boxes["a@acme-sales.com"]["warmup_quota"] == 5 and boxes["a@acme-sales.com"]["campaign_quota"] == 0
    sent = [(m["From"], m["To"], m[T.WARMUP_HEADER]) for _, m in mail.sent]
    assert len(sent) == 2 and all(w for _, _, w in sent)
    assert {s[1] for s in sent} == {"a@acme-sales.com", "b@acme-sales.com"}
    assert all("List-Unsubscribe" not in m for _, m in mail.sent)
