"""Review fixes in Journeys and Mail that need no database: sealing, bounce reading, the company's day, create() checks,
the call step retry, the sync lock and the IMAP high mark."""
import asyncio
import json
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.services import mail_transport as T
from app.services import secret_box as SB


# ── sealing a mailbox's settings ───────────────────────────────────────────
def test_a_password_with_question_mark_or_star_is_sealed_not_stored_plain():
    blob = json.dumps({"host": "smtp.x.com", "password": "pa?ss*word…"})
    sealed = SB.seal_blob(blob)
    assert sealed.startswith("enc:v1:") and "pa?ss" not in sealed
    assert json.loads(SB.open_blob(sealed)) == json.loads(blob)
    assert SB.seal_secret(blob) == blob  # what the old call did: plaintext


def test_an_old_plaintext_blob_still_opens_and_empty_stays_empty():
    legacy = json.dumps({"password": "a?b*"})
    assert SB.open_blob(legacy) == legacy
    assert SB.open_blob("") == "" and SB.seal_blob("") == ""


def test_mailbox_settings_keeps_a_password_with_special_characters():
    from app.services.email_dispatcher import mailbox_settings

    mb = SimpleNamespace(email="a@b.com", credentials_encrypted=SB.seal_blob(json.dumps({"password": "p?w*d", "username": "a@b.com"})))
    assert mailbox_settings(mb)["password"] == "p?w*d"


def test_no_secret_key_fails_closed(monkeypatch):
    from app.services import email_dispatcher as D

    monkeypatch.setattr(SB.settings, "SECRET_KEY", "")
    monkeypatch.setattr(D.settings, "SECRET_KEY", "")
    with pytest.raises(RuntimeError):
        SB.seal_blob("x")
    with pytest.raises(RuntimeError):
        D.unsubscribe_token("org", "a@b.com")


def test_a_masked_password_from_the_form_is_not_a_real_one():
    from app.api.email_outreach import _placeholder

    assert _placeholder("••••••••") and _placeholder("abcd…wxyz") and _placeholder("****")
    assert not _placeholder("pa?ss*word") and not _placeholder("")


# ── bounces and read receipts ──────────────────────────────────────────────
def _report(kind: str, body: str, status: str = "") -> bytes:
    if kind == "mdn":
        return (b"From: bob@x.com\r\nTo: me@y.com\r\nSubject: Read: hi\r\nMIME-Version: 1.0\r\n"
                b"Content-Type: multipart/report; report-type=disposition-notification; boundary=B\r\n\r\n"
                b"--B\r\nContent-Type: text/plain\r\n\r\nYour message was displayed.\r\n"
                b"--B\r\nContent-Type: message/disposition-notification\r\n\r\nFinal-Recipient: rfc822; bob@x.com\r\n\r\n--B--\r\n")
    return (b"From: MAILER-DAEMON@x.com\r\nTo: me@y.com\r\nSubject: Delivery Status Notification\r\nMIME-Version: 1.0\r\n"
            b"Content-Type: multipart/report; report-type=delivery-status; boundary=B\r\n\r\n"
            b"--B\r\nContent-Type: text/plain\r\n\r\nWe could not deliver your message.\r\n"
            b"--B\r\nContent-Type: message/delivery-status\r\n\r\nFinal-Recipient: rfc822; gone@z.com\r\nStatus: " + status.encode() + b"\r\n\r\n--B--\r\n")


def test_a_read_receipt_is_not_a_bounce():
    inc = T.parse_message(_report("mdn", ""), 1)
    assert inc.is_receipt and not inc.is_bounce and not inc.failed_recipients


def test_a_real_bounce_is_still_read():
    inc = T.parse_message(_report("dsn", "", "5.1.1"), 2)
    assert inc.is_bounce and inc.bounce_status == "5.1.1" and inc.failed_recipients == ["gone@z.com"]


def test_without_a_final_recipient_our_own_address_is_not_taken_as_the_failed_one():
    raw = (b"From: MAILER-DAEMON@x.com\r\nTo: me@y.com\r\nSubject: Undeliverable mail\r\n\r\n"
           b"Mail to me@y.com's recipient bob@z.com failed. 550 5.1.1 no such user")
    inc = T.parse_message(raw, 3)
    assert inc.is_bounce and "me@y.com" not in inc.failed_recipients and "bob@z.com" in inc.failed_recipients


def _incoming(**kw):
    base = dict(uid=1, from_addr="mailer-daemon@x.com", is_bounce=True, failed_recipients=["gone@z.com"], bounce_status="", text="", bounced_message_id="<m1>")
    base.update(kw)
    return T.Incoming(**base)


@pytest.fixture
def reader(monkeypatch):
    from app.services import inbox_reader as R

    calls = {"suppress": [], "stop": [], "logs": []}
    sent = SimpleNamespace(recipient_email="gone@z.com", status="sent", enrollment_id="en1", sent_at=datetime(2027, 1, 4, 10, 0), bounce_reason="")
    log = SimpleNamespace(bounced_count=0)

    async def sent_message(db, ids):
        return sent

    async def suppress(db, org, addr, reason, source):
        calls["suppress"].append(addr)

    async def stop(db, eid, reason, *a):
        calls["stop"].append(eid)

    async def day_log(db, mid, day=None):
        calls["logs"].append(day)
        return log

    async def tz(db):
        return "UTC"

    monkeypatch.setattr(R, "_sent_message", sent_message)
    monkeypatch.setattr(R, "suppress", suppress)
    monkeypatch.setattr(R, "_stop", stop)
    monkeypatch.setattr(R, "day_log", day_log)
    import app.services.org_settings as OS

    monkeypatch.setattr(OS, "org_timezone", tz)
    return R, calls, sent, log


def _process(R, msgs):
    mb = SimpleNamespace(id="mb1", email="me@y.com")
    return asyncio.run(R.process(None, "org", mb, msgs))


def test_a_soft_bounce_suppresses_nobody_and_is_not_counted(reader):
    R, calls, sent, log = reader
    for status in ("4.2.2", ""):  # temporary, or no status at all
        out = _process(R, [_incoming(bounce_status=status)])
        assert out["bounces"] == 0
    assert calls["suppress"] == [] and calls["stop"] == [] and log.bounced_count == 0 and sent.status == "sent"


def test_a_hard_bounce_suppresses_and_counts(reader):
    R, calls, sent, log = reader
    out = _process(R, [_incoming(bounce_status="5.1.1")])
    assert out["bounces"] == 1 and calls["suppress"] == ["gone@z.com"] and calls["stop"] == ["en1"] and log.bounced_count == 1
    assert calls["logs"] == ["2027-01-04"]


def test_a_read_receipt_changes_nothing(reader):
    R, calls, sent, log = reader
    out = _process(R, [T.Incoming(uid=2, from_addr="bob@x.com", is_receipt=True)])
    assert out == {"bounces": 0, "replies": 0, "warmup_uids": []} and calls["suppress"] == []


# ── the company's day ──────────────────────────────────────────────────────
def test_the_company_day_follows_its_timezone():
    from app.services import journeys as J

    start, end = J.day_bounds_utc("Asia/Kolkata", datetime(2027, 1, 4, 20, 0))  # 01:30 on the 5th in India
    assert start == datetime(2027, 1, 4, 18, 30) and end == datetime(2027, 1, 5, 18, 30)
    start, end = J.day_bounds_utc("UTC", datetime(2027, 1, 4, 20, 0))
    assert start == datetime(2027, 1, 4) and end == datetime(2027, 1, 5)
    assert J.day_bounds_utc("Not/AZone", datetime(2027, 1, 4, 20, 0))[0] == datetime(2027, 1, 4)


# ── create() checks ────────────────────────────────────────────────────────
@pytest.mark.parametrize("settings, message", [
    ({"sending_window_start": "9am"}, "Sending hours"),
    ({"sending_window_start": "18:00", "sending_window_end": "09:00"}, "Sending hours"),
    ({"days_of_week": [8, 0]}, "sending day"),
])
def test_create_checks_hours_and_days_before_touching_anything(settings, message):
    from app.services import journeys as J

    steps = [{"channel": "email", "subject": "Hi", "body": "Hello"}]
    with pytest.raises(J.JourneyError, match=message):
        asyncio.run(J.create(None, name="x", steps=steps, settings=settings))


# ── a call step that errors is tried again ─────────────────────────────────
def test_a_call_step_error_is_retried_then_skipped(monkeypatch):
    from app.services import connection_handlers as H

    async def boom(db, org):
        raise RuntimeError("database hiccup")

    monkeypatch.setattr(H, "entitled", boom)
    enr = SimpleNamespace(id="en1", vars=None, lead_id="", email="a@b.com")
    outcomes = [asyncio.run(H.run_call_step(None, "org", enr, SimpleNamespace(), datetime.utcnow()))[0] for _ in range(H.CALL_ERROR_TRIES)]
    assert outcomes == ["deferred"] * (H.CALL_ERROR_TRIES - 1) + ["skipped"]
    assert "call_errors" not in (enr.vars or {})


# ── mail sync ──────────────────────────────────────────────────────────────
def test_a_second_sync_of_the_same_mailbox_waits_its_turn(monkeypatch):
    from app.services import mail_sync as S

    async def run():
        mb = SimpleNamespace(id="mb-lock")
        async with S._sync_locks.setdefault("mb-lock", asyncio.Lock()):
            return await S.sync_mailbox(None, "org", mb, {})

    assert asyncio.run(run()) == {"added": 0, "more": False}


class _Imap:
    """Two new messages; the first fetch returns nothing."""
    def __init__(self, empty):
        self.empty, self.fetched = empty, []

    def select(self, *a, **k):
        return "OK", [b"1"]

    def uid(self, cmd, *args):
        if cmd == "search":
            return "OK", [b"11 12"]
        self.fetched.append(args[0])
        if int(args[0]) in self.empty:
            return "OK", [None]
        raw = b"From: a@b.com\r\nSubject: hi\r\nMessage-ID: <" + args[0].encode() + b"@x>\r\n\r\nbody"
        return "OK", [(b"1 (BODY[] {10}", raw), b")"]

    def logout(self):
        pass


def test_the_inbox_mark_stops_before_a_message_that_did_not_come(monkeypatch):
    monkeypatch.setattr(T, "_imap", lambda s: _Imap({11}))
    out, newest = T._fetch_sync({}, 10, 100)
    assert out == [] and newest == 10  # tried again next time, nothing skipped
    monkeypatch.setattr(T, "_imap", lambda s: _Imap({12}))
    out, newest = T._fetch_sync({}, 10, 100)
    assert [m.uid for m in out] == [11] and newest == 11
    monkeypatch.setattr(T, "_imap", lambda s: _Imap(set()))
    out, newest = T._fetch_sync({}, 10, 100)
    assert [m.uid for m in out] == [11, 12] and newest == 12
