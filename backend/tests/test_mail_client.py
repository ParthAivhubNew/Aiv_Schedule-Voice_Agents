"""The Mail screen: reading, searching, tidying, deleting and writing, with a fake mail server."""
import json

import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


def raw_mail(subject, sender="Priya <priya@acme.test>", to="boss@mine.test", mid="<a1@acme>", reply_to="", html="", attach=False, body="Hello there"):
    from email.message import EmailMessage

    m = EmailMessage()
    m["From"], m["To"], m["Subject"], m["Message-ID"], m["Date"] = sender, to, subject, mid, "Mon, 12 Oct 2026 10:00:00 +0000"
    if reply_to:
        m["In-Reply-To"] = reply_to
        m["References"] = reply_to
    m.set_content(body)
    if html:
        m.add_alternative(html, subtype="html")
    if attach:
        m.add_attachment(b"%PDF fake", maintype="application", subtype="pdf", filename="offer.pdf")
    return m.as_bytes()


def item(folder, uid, raw, seen=False, starred=False):
    from app.services import mail_sync as S

    return {"folder": folder, "remote": {"inbox": "INBOX", "sent": "Sent Items", "trash": "Deleted Items", "archive": "Archive", "spam": "Junk"}[folder],
            "uid": uid, "seen": seen, "starred": starred, "draft": False, "parsed": S.parse_full(raw)}


class FakeServer:
    def __init__(self, items):
        self.items, self.applied, self.sent, self.appended = items, [], [], []
        self.folders = {"inbox": "INBOX", "sent": "Sent Items", "trash": "Deleted Items", "archive": "Archive", "spam": "Junk"}

    async def read(self, settings, state, limit=120):
        last = max([(state.get("uids") or {}).get("inbox", {}).get("last", 0)] + [0])
        fresh = [i for i in self.items if i["uid"] > last or i["folder"] != "inbox"]
        return {"folders": self.folders, "uids": {"inbox": {"validity": "1", "last": max([i["uid"] for i in self.items] + [0])}}, "items": fresh}


@pytest.fixture
async def mailbox(db):
    from app.models.models import EmailMailbox
    from app.services.secret_box import seal_secret

    boss, token = await make_user(db, "mailer", "Admin")
    box = EmailMailbox(id="mb1", org_id="org_default", operator_id=boss.id, email="boss@mine.test", display_name="Boss", status="active",
                       credentials_encrypted=seal_secret(json.dumps({"smtp_host": "smtp.mine.test", "imap_host": "imap.mine.test", "username": "boss@mine.test", "password": "pw"})))
    db.add(box)
    await db.commit()
    return box, token


@pytest.fixture
def fake(monkeypatch):
    from app.services import mail_sync as S
    from app.services import mail_transport as T

    server = FakeServer([])

    async def read(settings, state, limit=120):
        return await server.read(settings, state, limit)

    async def apply(settings, ops):
        server.applied.extend(ops)

    async def append(settings, folder, raw):
        server.appended.append(folder)

    async def send(settings, msg):
        server.sent.append(msg)

    monkeypatch.setattr(S, "server_read", read)
    monkeypatch.setattr(S, "server_apply", apply)
    monkeypatch.setattr(S, "server_append", append)
    monkeypatch.setattr(T, "send", send)
    monkeypatch.setattr(S, "STORE_DIR", __import__("pathlib").Path(__import__("tempfile").mkdtemp()))
    return server


async def synced(client, fake, items):
    fake.items = items
    r = await client.post("/api/email/mail/sync", json={"force": True})
    assert r.status_code == 200, r.text
    return r.json()


async def test_sync_stores_mail_once_and_groups_conversations(client, mailbox, fake):
    first = raw_mail("Proposal", mid="<p1@acme>")
    reply = raw_mail("Re: Proposal", sender="Boss <boss@mine.test>", to="priya@acme.test", mid="<p2@mine>", reply_to="<p1@acme>")
    other = raw_mail("Lunch?", sender="Tom <tom@x.test>", mid="<t1@x>")
    items = [item("inbox", 1, first), item("inbox", 2, other, seen=True), item("sent", 5, reply)]
    out = await synced(client, fake, items)
    assert out["added"] == 3 and not out["errors"]
    again = await synced(client, fake, items)
    assert again["added"] == 0  # reading the same mail again adds nothing
    inbox = (await client.get("/api/email/mail/messages?folder=inbox")).json()
    assert inbox["total"] == 2
    prop = next(t for t in inbox["threads"] if t["subject"] == "Proposal")
    assert prop["count"] == 2 and prop["unread_count"] == 1  # the reply you sent is in the same conversation
    counts = (await client.get("/api/email/mail/counts")).json()["folders"]
    assert counts["inbox"] == {"total": 2, "unread": 1} and counts["sent"]["total"] == 1


async def test_search_and_filters(client, mailbox, fake):
    await synced(client, fake, [
        item("inbox", 1, raw_mail("Proposal", mid="<1@a>", attach=True)),
        item("inbox", 2, raw_mail("Lunch?", sender="Tom <tom@x.test>", mid="<2@a>", body="pizza at noon"), seen=True, starred=True),
    ])
    get = lambda q: client.get(f"/api/email/mail/messages?folder=inbox&{q}")
    assert [t["subject"] for t in (await get("q=pizza")).json()["threads"]] == ["Lunch?"]
    assert [t["subject"] for t in (await get("q=priya")).json()["threads"]] == ["Proposal"]
    assert [t["subject"] for t in (await get("unread=true")).json()["threads"]] == ["Proposal"]
    assert [t["subject"] for t in (await get("starred=true")).json()["threads"]] == ["Lunch?"]
    assert [t["subject"] for t in (await get("attachments=true")).json()["threads"]] == ["Proposal"]
    assert (await client.get("/api/email/mail/messages?folder=nope")).status_code == 400


async def test_open_conversation_cleans_html_and_serves_attachments(client, mailbox, fake):
    html = '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:evil()">go</a><iframe src="//e"></iframe>'
    await synced(client, fake, [item("inbox", 1, raw_mail("Offer", mid="<o1@a>", html=html, attach=True))])
    key = (await client.get("/api/email/mail/messages")).json()["threads"][0]["thread_key"]
    msgs = (await client.get(f"/api/email/mail/threads/{key}")).json()["messages"]
    body = msgs[0]["body_html"]
    assert "<script" not in body and "onclick" not in body and "javascript:" not in body and "<iframe" not in body and "Hi" in body
    att = msgs[0]["attachments"][0]
    assert att["name"] == "offer.pdf" and att["available"]
    got = await client.get(f"/api/email/mail/messages/{msgs[0]['id']}/attachments/{att['index']}")
    assert got.status_code == 200 and got.content == b"%PDF fake"
    assert (await client.get(f"/api/email/mail/messages/{msgs[0]['id']}/attachments/9")).status_code == 404


async def test_read_star_move_and_delete_for_good(client, mailbox, fake):
    await synced(client, fake, [item("inbox", 1, raw_mail("One", mid="<1@a>", attach=True)), item("inbox", 2, raw_mail("Two", mid="<2@a>"))])
    rows = (await client.get("/api/email/mail/messages")).json()["threads"]
    one = next(t for t in rows if t["subject"] == "One")["id"]
    two = next(t for t in rows if t["subject"] == "Two")["id"]
    act = lambda ids, a: client.post("/api/email/mail/actions", json={"ids": ids, "action": a})
    assert (await act([one, two], "read")).status_code == 200
    assert (await client.get("/api/email/mail/counts")).json()["folders"]["inbox"]["unread"] == 0
    assert any(op["do"] == "seen" and op["folder"] == "INBOX" and op["uid"] == 1 for op in fake.applied)  # the server's copy is marked read too
    await act([one], "star")
    # Delete: to Trash first, and the server is told to move it
    assert (await act([one, two], "trash")).status_code == 200
    assert any(op["do"] == "move" and op["to"] == "Deleted Items" for op in fake.applied)
    assert (await client.get("/api/email/mail/messages?folder=inbox")).json()["total"] == 0
    trash = (await client.get("/api/email/mail/messages?folder=trash")).json()
    assert trash["total"] == 2
    # Put one back, and delete the other for good
    await act([two], "inbox")
    assert (await client.get("/api/email/mail/messages?folder=inbox")).json()["total"] == 1
    assert (await act([two], "delete_forever")).status_code == 400  # it is in the inbox: Trash comes first
    assert (await act([one], "delete_forever")).status_code == 200
    assert (await client.get("/api/email/mail/messages?folder=trash")).json()["total"] == 0
    assert (await act(["mm_nope"], "read")).status_code == 404
    assert (await act([one], "explode")).status_code == 400


async def test_send_reply_with_attachment_and_draft_cleanup(client, mailbox, fake):
    await synced(client, fake, [item("inbox", 1, raw_mail("Proposal", mid="<p1@acme>"))])
    parent = (await client.get("/api/email/mail/messages")).json()["threads"][0]
    draft = (await client.post("/api/email/mail/drafts", json={"mailbox_id": "mb1", "to": "priya@acme.test", "subject": "Re: Proposal", "body_html": "<p>Draft</p>", "in_reply_to_id": parent["id"]})).json()["message"]
    assert (await client.get("/api/email/mail/messages?folder=drafts")).json()["total"] == 1
    payload = {"mailbox_id": "mb1", "to": ["priya@acme.test"], "cc": "tom@x.test", "bcc": ["audit@mine.test"], "subject": "Re: Proposal",
               "body_html": "<p>Thanks, <b>agreed</b>.</p>", "in_reply_to_id": parent["id"], "draft_id": draft["id"]}
    r = await client.post("/api/email/mail/send", data={"payload": json.dumps(payload)}, files={"files": ("terms.txt", b"terms", "text/plain")})
    assert r.status_code == 200, r.text
    sent = fake.sent[0]
    assert sent["To"] == "priya@acme.test" and sent["Cc"] == "tom@x.test" and sent["In-Reply-To"] == "<p1@acme>"
    assert [p.get_filename() for p in sent.iter_attachments()] == ["terms.txt"]
    assert fake.appended == ["Sent Items"]  # this server does not keep a copy by itself
    assert (await client.get("/api/email/mail/messages?folder=drafts")).json()["total"] == 0
    thread = (await client.get(f"/api/email/mail/threads/{parent['thread_key']}")).json()["messages"]
    assert [m["folder"] for m in thread] == ["inbox", "sent"] and thread[1]["attachments"][0]["name"] == "terms.txt"


async def test_send_checks(client, mailbox, fake):
    base = {"mailbox_id": "mb1", "to": ["priya@acme.test"], "subject": "Hi", "body_html": "<p>x</p>"}
    send = lambda p: client.post("/api/email/mail/send", data={"payload": json.dumps(p)})
    assert (await send({**base, "to": []})).status_code == 400
    assert (await send({**base, "to": ["not-an-address"]})).status_code == 400
    assert (await send({**base, "mailbox_id": "nope"})).status_code == 400
    assert (await send({**base, "to": [f"p{i}@a.test" for i in range(60)]})).status_code == 400
    assert not fake.sent
    ok = await send({**base, "from_address": "someone-else@mine.test"})  # not a saved alias: sent from the mailbox itself
    assert ok.status_code == 200 and fake.sent[0]["From"].endswith("<boss@mine.test>")


async def test_people_only_see_their_own_mailboxes(client, anon, mailbox, fake, db):
    await synced(client, fake, [item("inbox", 1, raw_mail("Secret", mid="<s@a>"))])
    _, token = await make_user(db, "sam", "Operator")
    h = {"Authorization": f"Bearer {token}"}
    assert (await anon.get("/api/email/mail/mailboxes", headers=h)).json()["mailboxes"] == []
    assert (await anon.get("/api/email/mail/messages", headers=h)).json()["total"] == 0
    assert (await anon.get("/api/email/mail/messages?mailbox_id=mb1", headers=h)).status_code == 404
    msg_id = (await client.get("/api/email/mail/messages")).json()["threads"][0]["id"]
    assert (await anon.post("/api/email/mail/actions", json={"ids": [msg_id], "action": "trash"}, headers=h)).status_code == 404
    assert (await anon.post("/api/email/mail/send", data={"payload": json.dumps({"mailbox_id": "mb1", "to": ["a@b.test"]})}, headers=h)).status_code == 400
    assert (await anon.get("/api/email/mail/messages")).status_code == 401
