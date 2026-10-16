"""Mail through the public API: only the one endpoint, POST /v1/run with plugin "mail", with three separate
permissions (read, write, delete), an optional limit to some mailboxes, and the same rules as the Mail screen."""
import asyncio
import base64
import json

import httpx
import pytest
from sqlalchemy.future import select

from tests.conftest import make_user
from tests.test_mail_client import FakeServer, item, raw_mail

pytestmark = pytest.mark.db


def _http(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


@pytest.fixture(autouse=True)
def clean_limits(monkeypatch, tmp_path):
    from app.public_api import core
    from app.services import mail_sync as S

    core._WINDOWS.clear()
    monkeypatch.setattr(S, "STORE_DIR", tmp_path)
    yield
    core._WINDOWS.clear()


@pytest.fixture
def fake(monkeypatch):
    from app.services import mail_sync as S
    from app.services import mail_transport as T

    server = FakeServer([])

    async def apply(settings, ops):
        server.applied.extend(ops)

    async def send(settings, msg):
        server.sent.append(msg)

    async def append(settings, folder, raw):
        server.appended.append(folder)

    monkeypatch.setattr(S, "server_apply", apply)
    monkeypatch.setattr(S, "server_append", append)
    monkeypatch.setattr(T, "send", send)
    return server


async def company(db):
    """Two mailboxes with mail in them, and a Leads plan (credits) so a live key can be made."""
    from app.models.models import CompanyProfile, EmailMailbox, MailMessage
    from app.services import credits as K
    from app.services import mail_sync as S
    from app.services.secret_box import seal_secret

    login = seal_secret(json.dumps({"smtp_host": "smtp.x.test", "imap_host": "imap.x.test", "username": "u", "password": "p"}))
    db.add(CompanyProfile(id="default", name="Acme Ltd"))
    for box, addr in (("mb_a", "sales@acme.test"), ("mb_b", "support@acme.test")):
        db.add(EmailMailbox(id=box, email=addr, status="active", credentials_encrypted=login,
                            mail_state={"folders": {"inbox": "INBOX", "trash": "Trash", "sent": "Sent"}}))
    await db.commit()
    await K.add_credits(db, "leadgen", 100, source="grant")
    await db.commit()
    for box, uid, subject in (("mb_a", 1, "Alpha proposal"), ("mb_b", 2, "Bravo secret")):
        p = S.parse_full(raw_mail(subject, mid=f"<{uid}@x>"))
        db.add(MailMessage(id=f"mm_{box}", mailbox_id=box, folder="inbox", remote_folder="INBOX", uid=uid, message_id=p["message_id"],
                           thread_key=p["thread_key"], from_name=p["from_name"], from_email=p["from_email"], to_list=p["to"], subject=subject,
                           snippet="hi", body_text="hi", is_read=False, sent_at=p["sent_at"]))
    await db.commit()


async def make_key(admin_token, scopes, live=True, mailbox_ids=None):
    async with _http(admin_token) as c:
        r = await c.post("/api/developer/keys", json={"name": "Mail key", "scopes": scopes, "live": live, "mailbox_ids": mailbox_ids})
    assert r.status_code == 200, r.text
    return r.json()["secret"], r.json()["key"]


async def call(secret, action, id=None, data=None, headers=None):
    async with _http(secret) as c:
        return await c.post("/v1/run", json={"plugin": "mail", "action": action, **({"id": id} if id else {}), "data": data or {}}, headers=headers or {})


async def test_each_kind_of_mail_access_is_its_own_permission(db, admin_token):
    await company(db)
    reader, _ = await make_key(admin_token, ["mail:read"])
    writer, _ = await make_key(admin_token, ["mail:read", "mail:write"])
    old_full, key = await make_key(admin_token, ["full_access"])
    assert "mail:read" not in key["scopes"] and "mail:delete" not in key["scopes"]  # never part of "full access"
    assert (await call(reader, "mailboxes.list")).status_code == 200
    for action, data in (("messages.mark", {"ids": ["mm_mb_a"], "mark": "read"}), ("send", {"mailbox_id": "mb_a", "to": ["a@b.test"]}), ("draft.save", {"mailbox_id": "mb_a"})):
        r = await call(reader, action, data=data)
        assert r.status_code == 403 and r.json()["error"]["code"] == "missing_scope" and r.json()["error"]["details"]["scope"] == "mail:write", action
    assert (await call(writer, "messages.move", data={"ids": ["mm_mb_a"], "to": "trash"})).status_code == 200
    gone = await call(writer, "messages.delete", data={"ids": ["mm_mb_a"]})  # it is in Trash, but this key may not erase
    assert gone.status_code == 403 and gone.json()["error"]["details"]["scope"] == "mail:delete"
    assert (await call(old_full, "mailboxes.list")).status_code == 403
    assert (await call(reader, "teleport")).status_code == 422


async def test_a_key_limited_to_one_mailbox_never_sees_the_other(db, admin_token):
    await company(db)
    secret, key = await make_key(admin_token, ["mail:read", "mail:write", "mail:delete"], mailbox_ids=["mb_a"])
    assert key["mailbox_ids"] == ["mb_a"]
    assert [m["id"] for m in (await call(secret, "mailboxes.list")).json()["data"]] == ["mb_a"]
    subjects = [t["subject"] for t in (await call(secret, "messages.list")).json()["data"]]
    assert subjects == ["Alpha proposal"]
    assert (await call(secret, "messages.get", id="mm_mb_b")).status_code == 404
    assert (await call(secret, "messages.list", data={"mailbox_id": "mb_b"})).status_code == 404
    assert (await call(secret, "messages.move", data={"ids": ["mm_mb_b"], "to": "trash"})).status_code == 404
    sent = await call(secret, "send", data={"mailbox_id": "mb_b", "to": ["x@y.test"], "subject": "no", "body_text": "no"})
    assert sent.status_code == 400
    # a key cannot be limited to a mailbox that is not the company's
    async with _http(admin_token) as c:
        bad = await c.post("/api/developer/keys", json={"name": "Bad key", "scopes": ["mail:read"], "live": True, "mailbox_ids": ["mb_nope"]})
        assert bad.status_code == 400


async def test_deleting_is_trash_first_then_erase_and_is_recorded(db, admin_token, fake):
    await company(db)
    secret, key = await make_key(admin_token, ["mail:read", "mail:write", "mail:delete"])
    early = await call(secret, "messages.delete", data={"ids": ["mm_mb_a"]})
    assert early.status_code == 400 and "Trash first" in early.json()["error"]["message"]
    assert (await call(secret, "messages.move", data={"ids": ["mm_mb_a"], "to": "explode"})).status_code == 422
    assert (await call(secret, "messages.delete", data={"ids": [f"m{i}" for i in range(101)]})).status_code == 422
    assert (await call(secret, "messages.delete")).status_code == 422  # which emails?
    moved = await call(secret, "messages.move", data={"ids": ["mm_mb_a"], "to": "trash"})
    assert moved.status_code == 200 and any(op["do"] == "move" and op["to"] == "Trash" for op in fake.applied)
    left = (await call(secret, "messages.list")).json()
    assert [t["subject"] for t in left["data"]] == ["Bravo secret"]  # only the other mailbox's email is still in the inbox
    trash = await call(secret, "messages.list", data={"folder": "trash"})
    assert [t["id"] for t in trash.json()["data"]] == ["mm_mb_a"]
    erased = await call(secret, "messages.delete", data={"ids": ["mm_mb_a"]})
    assert erased.status_code == 200 and erased.json()["changed"] == 1
    assert (await call(secret, "messages.get", id="mm_mb_a")).status_code == 404
    assert any(op["do"] == "delete" for op in fake.applied)  # the real mailbox lost it too
    await asyncio.sleep(0.2)
    from app.core.tenancy import system_scope
    from app.models.models import PublicApiAudit

    with system_scope():
        rows = (await db.execute(select(PublicApiAudit.path).where(PublicApiAudit.key_id == key["id"]))).scalars().all()
    assert "/v1/run#messages.delete" in rows  # who erased what is kept, by action


async def test_send_with_an_attachment_once_even_if_retried(db, admin_token, fake):
    await company(db)
    secret, _ = await make_key(admin_token, ["mail:read", "mail:write"])
    data = {"mailbox_id": "mb_a", "to": ["tom@x.test"], "cc": "ann@x.test", "subject": "Terms", "body_text": "See attached.",
            "attachments": [{"name": "terms.txt", "type": "text/plain", "content_base64": base64.b64encode(b"terms").decode()}]}
    first = await call(secret, "send", data=data, headers={"Idempotency-Key": "k1"})
    again = await call(secret, "send", data=data, headers={"Idempotency-Key": "k1"})
    assert first.status_code == 200 and first.json()["status"] == "sent" and again.headers.get("idempotent-replay") == "true"
    assert len(fake.sent) == 1 and fake.sent[0]["Cc"] == "ann@x.test"
    assert [p.get_filename() for p in fake.sent[0].iter_attachments()] == ["terms.txt"]
    sent = (await call(secret, "messages.list", data={"folder": "sent"})).json()["data"]
    got = await call(secret, "attachment.get", id=sent[0]["id"], data={"index": 0})
    assert base64.b64decode(got.json()["content_base64"]) == b"terms" and got.json()["name"] == "terms.txt"
    bad = await call(secret, "send", data={**data, "attachments": [{"name": "x", "content_base64": "!!!"}]})
    assert bad.status_code == 422


async def test_there_is_no_separate_mail_url_and_a_link_only_reads(db, admin_token, fake):
    from app.main import app

    assert not [p for p in app.openapi()["paths"] if p.startswith("/v1/mail")]
    await company(db)
    secret, _ = await make_key(admin_token, ["mail:read", "mail:write"])
    async with _http(secret) as c:
        assert (await c.post("/v1/mail", json={"action": "mailboxes.list"})).status_code == 404
        door = await c.post("/v1/run", json={"plugin": "mail", "action": "messages.list", "data": {"folder": "inbox"}})
        link = await c.get("/v1/run", params={"plugin": "mail", "action": "messages.list", "folder": "inbox", "unread": "true"})
        assert door.status_code == 200 and link.status_code == 200 and door.headers["x-outreach-action"] == "mail.messages.list"
        assert link.json()["total"] == 2
        assert (await c.get("/v1/run", params={"plugin": "mail", "action": "send"})).status_code == 405
        one = await c.post("/v1/run", json={"plugin": "mail", "action": "messages.get", "id": "mm_mb_a"})
        assert one.status_code == 200 and one.json()["message"]["subject"] == "Alpha proposal"
        marked = await c.post("/v1/run", json={"plugin": "mail", "action": "messages.mark", "data": {"ids": ["mm_mb_a"], "mark": "read"}})
        assert marked.status_code == 200
        nope = await c.post("/v1/run", json={"plugin": "mail", "action": "messages.delete", "data": {"ids": ["mm_mb_a"]}})
        assert nope.status_code == 403  # the permission is checked the same way


async def test_a_test_key_never_touches_real_mail(db, admin_token, fake):
    await company(db)
    secret, _ = await make_key(admin_token, ["mail:read", "mail:write", "mail:delete"], live=False)
    assert (await call(secret, "messages.list")).json()["data"] == []
    sent = await call(secret, "send", data={"mailbox_id": "mb_a", "to": ["a@b.test"], "subject": "x", "body_text": "x"})
    assert sent.status_code == 200 and sent.json()["test"] is True and not fake.sent
    assert (await call(secret, "messages.delete", data={"ids": ["mm_mb_a"]})).json()["changed"] == 0
    assert (await call(secret, "messages.get", id="mm_mb_a")).status_code == 404
    from app.models.models import MailMessage

    assert (await db.get(MailMessage, "mm_mb_a")) is not None  # still there
