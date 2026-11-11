"""Phase 6: the Today strip on Home, the reply chip data in Mail, the 7-day mailbox card and the Phase 7c LIA and export columns."""
from datetime import datetime, timedelta

import pytest

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("funded_house_org")]

NOW = datetime.utcnow()


async def _seed(db):
    from app.models.models import (CreditEntry, ContactEvent, EmailApproval, EmailMailbox, EmailMessage, EmailSendLog, LeadAccount, Meeting)

    db.add(EmailMailbox(id="mb1", email="me@x.test", status="active"))
    await db.flush()
    db.add(LeadAccount(id="l_a", name="A Co", email="a@x.test"))
    db.add(LeadAccount(id="l_b", name="B Co", email="b@x.test"))
    rep = lambda i, who, cat, ago: EmailMessage(id=i, mailbox_id="mb1", campaign_id="c1", recipient_email=who, reply_from=who, status="replied", reply_category=cat,
                                                is_warmup=False, sent_at=NOW - timedelta(days=ago + 1), replied_at=NOW - timedelta(days=ago))
    db.add_all([rep("r1", "a@x.test", "interested", 2),      # waiting
                rep("r2", "b@x.test", "question", 2),        # answered below
                rep("r3", "c@x.test", "not_interested", 2),  # not a category we count
                rep("r4", "d@x.test", "interested", 90)])    # too old
    db.add(ContactEvent(id="ev0", lead_id="l_b", kind="email", summary="Replied: hi", at=NOW - timedelta(days=1)))  # the reply's own line does not count
    db.add(ContactEvent(id="ev1", lead_id="l_b", kind="note", summary="Rang them", at=NOW - timedelta(days=1)))
    db.add(EmailApproval(id="ap1", campaign_id="c1", enrollment_id="e1", status="pending"))
    db.add(EmailApproval(id="ap2", campaign_id="c1", enrollment_id="e2", status="approved"))
    db.add(Meeting(id="m1", prospect="P", mission="M", date="2026-01-01", time="10:00", created_at=NOW))
    db.add(Meeting(id="m2", prospect="Q", mission="M", date="2026-01-01", time="10:00", created_at=NOW - timedelta(days=15)))
    d = lambda n: (NOW - timedelta(days=n)).date().isoformat()
    db.add(EmailSendLog(id="s1", mailbox_id="mb1", date=d(1), campaign_sent_count=100, bounced_count=2, complaint_count=1))
    db.add(EmailSendLog(id="s2", mailbox_id="mb1", date=d(20), campaign_sent_count=500, bounced_count=50))  # outside the week
    db.add(CreditEntry(id="ce1", kind="usage", wallet="leadgen", amount=-30, created_at=NOW - timedelta(days=1)))
    db.add(CreditEntry(id="ce2", kind="usage", wallet="leadgen", amount=-99, created_at=NOW - timedelta(days=20)))
    db.add(CreditEntry(id="ce3", kind="grant", wallet="leadgen", amount=500, created_at=NOW - timedelta(days=1)))
    await db.commit()


async def test_today_counts(client, db):
    await _seed(db)
    res = (await client.get("/api/together/today")).json()
    assert res["replies_waiting"] == 1
    assert res["approvals_waiting"] == 1
    assert res["meetings_this_week"] == 1  # the one made 15 days ago is another week
    assert res["bounce_rate_7d"] == 0.02 and res["sent_7d"] == 100
    assert res["credits_used_7d"] == 30
    assert isinstance(res["credits_left"], int)
    assert res["links"]["replies"].startswith("#/leadgen/")


async def test_today_hides_unentitled(client, db, monkeypatch):
    await _seed(db)

    async def availability(_db, _org):
        return {"plugins": {"voice": False, "leads": False, "social": True}, "links": {}}

    monkeypatch.setattr("app.services.connections.availability", availability)
    res = (await client.get("/api/together/today")).json()
    assert "replies_waiting" not in res and "approvals_waiting" not in res and "bounce_rate_7d" not in res and "meetings_this_week" not in res
    assert "credits_used_7d" in res and set(res["links"]) == {"credits"}


async def test_mail_rows_carry_the_reply_category(db):
    from app.api.mail_client import reply_categories

    await _seed(db)
    got = await reply_categories(db, ["A@x.test", "b@x.test", "c@x.test", "d@x.test", "nobody@x.test", ""])
    assert got["a@x.test"] == ("interested", "l_a") and got["b@x.test"] == ("question", "l_b") and got["c@x.test"] == ("not_interested", "")
    assert "d@x.test" not in got and "nobody@x.test" not in got  # too old / never replied


async def test_mailboxes_report_seven_day_complaints(client, db):
    await _seed(db)
    box = next(m for m in (await client.get("/api/email/mailboxes")).json()["mailboxes"] if m["id"] == "mb1")
    assert (box["sent_7d"], box["bounced_7d"], box["complaints_7d"]) == (100, 2, 1)
    assert "bounce_health" in box and "dmarc_verified" in box


async def test_lia_is_prefilled_then_saved_and_downloadable(client):
    first = (await client.get("/api/leads/lia")).json()
    assert first["saved"] is False and "unsubscribe" in first["safeguards"] and first["purpose"]
    put = (await client.put("/api/leads/lia", json={"purpose": "We help accountants.", "necessity": "n", "balance": "b", "safeguards": "s"})).json()
    assert put["saved"] is True and put["purpose"] == "We help accountants."
    again = (await client.get("/api/leads/lia")).json()
    assert again["saved"] is True and again["necessity"] == "n" and again["updated_at"]
    txt = await client.get("/api/leads/lia.txt")
    assert txt.status_code == 200 and "We help accountants." in txt.text and "attachment" in txt.headers["content-disposition"]


async def test_contact_export_says_where_each_company_was_found(client, db):
    from app.models.models import BusinessRecord, LeadAccount

    db.add(BusinessRecord(id="br1", identity_hash="h_br1", name="Reg Ltd", sources=[{"source_id": "s1", "source_type": "bulk_csv", "confirmed_at": "2026-11-03T09:00:00"}]))
    await db.flush()
    db.add(LeadAccount(id="la1", name="Reg Ltd", source="scout", business_record_id="br1", created_at=datetime(2026, 11, 5, 9, 0)))
    db.add(LeadAccount(id="la2", name="Web Ltd", source="research", source_url="https://www.web.test/about", created_at=datetime(2026, 11, 6, 9, 0)))
    db.add(LeadAccount(id="la3", name="Typed Ltd", source="manual", created_at=datetime(2026, 11, 7, 9, 0)))
    await db.commit()
    import csv, io

    rows = list(csv.DictReader(io.StringIO((await client.get("/api/contacts/export.csv")).text)))
    by = {r["Company"]: r for r in rows}
    assert (by["Reg Ltd"]["Where found"], by["Reg Ltd"]["Found on"], by["Reg Ltd"]["Saved on"]) == ("Companies House register", "2026-11-03", "2026-11-05")
    assert (by["Web Ltd"]["Where found"], by["Web Ltd"]["Found on"]) == ("web.test", "2026-11-06")
    assert (by["Typed Ltd"]["Where found"], by["Typed Ltd"]["Found on"]) == ("", "") and "Saved by" in rows[0]
