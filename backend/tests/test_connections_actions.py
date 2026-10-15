"""Starting calls from Lead Gen, call steps in campaigns, email opens, social engagers, booking links,
reminders and the partner API sharing one contact id."""
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import (
    CallLog,
    ContactEvent,
    EmailCampaign,
    EmailEnrollment,
    EmailMessage,
    EmailSequenceStep,
    LeadAccount,
    LiveCall,
    Meeting,
    Prospect,
    SocialEngager,
    SocialPost,
)
from app.services import connection_handlers as H
from app.services import connections as C
from tests.conftest import make_user

pytestmark = pytest.mark.db
ORG = "org_default"


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


@pytest.fixture
def open_hours(monkeypatch):
    """The clock and the minutes left must not decide these tests."""
    from app.services import compliance, credits

    async def allowed(db, number, now_utc=None):
        return compliance.CallGate(allowed=True)

    async def enough(db, calls=1):
        return None
    monkeypatch.setattr(compliance, "check_call_allowed", allowed)
    monkeypatch.setattr(credits, "short_call_warning", enough)


async def test_calling_a_list_starts_one_round_with_each_company_carried_over(db, monkeypatch, open_hours):
    from app.services import outbound_dial

    seen = {}

    async def has_line(db_, number):
        return "+441130000000"
    monkeypatch.setattr(outbound_dial, "resolve_from_number", has_line)

    async def launch(db_, **kw):
        seen.update(kw)
        return {"success": True, "mission_id": "m_test", "title": kw["title"], "total": len(kw["prospects"]), "message": "ok"}
    monkeypatch.setattr(outbound_dial, "launch_outbound_mission", launch)
    _, token = await make_user(db, "caller", "Admin", org_id=ORG)
    async with _client(token) as c:
        made = (await c.post("/api/leads/accounts", json={"accounts": [
            {"name": "Kirkgate Dental", "phone": "01134960001", "email": "a@kirkgate.example", "contact_name": "Maria Lopez"},
            {"name": "No Number Ltd"},
        ]})).json()["accounts"]
        lst = (await c.post("/api/leads/lists", json={"name": "Leeds", "ids": [a["id"] for a in made]})).json()["list"]
        first = made[0]["id"]
        res = await c.post(f"/api/leads/lists/{lst['id']}/call", json={"hooks": {first: "Congrats on the new clinic"}, "concurrency": 2})
        assert res.status_code == 200, res.text
        assert res.json()["called"] == 1 and "no phone number" in res.json()["skipped_text"]
        row = seen["prospects"][0]
        assert row["lead_id"] == first and row["email"] == "a@kirkgate.example" and row["contact"] == "Maria Lopez"
        assert row["opening_hook"].startswith("Congrats on the new clinic")
        assert "Ask for Maria Lopez first" in row["opening_hook"]  # the decision maker is asked for, not whoever picks up
        assert seen["lead_list_id"] == lst["id"] and seen["source"] == "leadgen"

        # nothing to call: a plain answer, not a started round
        only_blank = await c.post("/api/leads/accounts/call", json={"ids": [made[1]["id"]]})
        assert only_blank.status_code == 400 and "no phone number" in only_blank.json()["detail"]
        # one company, right now
        seen.clear()
        one = await c.post(f"/api/leads/accounts/{first}/call-now", json={})
        assert one.status_code == 200 and seen["concurrency"] == 1


async def test_a_viewer_can_look_but_not_dial(db, open_hours):
    _, token = await make_user(db, "viewer1", "Viewer", org_id=ORG)
    async with _client(token) as c:
        assert (await c.post("/api/leads/lists/all/call", json={})).status_code == 403
        assert (await c.post("/api/leads/accounts/call", json={"ids": ["x"]})).status_code in (403, 400)


async def test_a_call_step_rings_only_when_its_condition_and_the_plans_allow(db, monkeypatch, open_hours):
    from app.services import lead_calls as LC

    started = []

    async def start(db_, leads, **kw):
        started.append([l.id for l in leads])
        return {}
    monkeypatch.setattr(LC, "start_calls", start)
    with org_scope(ORG):
        db.add(LeadAccount(id="la_1", name="Kirkgate Dental", phone="01134960001", email="a@kirkgate.example"))
        db.add(EmailCampaign(id="cp_1", name="Spring"))
        await db.flush()
        db.add(EmailEnrollment(id="en_1", campaign_id="cp_1", lead_id="la_1", email="a@kirkgate.example", status="active"))
        db.add(EmailSequenceStep(id="st_1", campaign_id="cp_1", step_number=2, channel="voice_call", condition="opened_no_reply"))
        await db.commit()
        enr, step = await db.get(EmailEnrollment, "en_1"), await db.get(EmailSequenceStep, "st_1")
        # not opened: skipped, the sequence carries on
        assert (await H.run_call_step(db, ORG, enr, step, datetime.utcnow()))[0] == "skipped" and not started
        # opened: rings
        db.add(EmailMessage(id="em_1", recipient_email="a@kirkgate.example", enrollment_id="en_1", campaign_id="cp_1", open_count=2))
        await db.commit()
        assert (await H.run_call_step(db, ORG, enr, step, datetime.utcnow()))[0] == "called" and started == [["la_1"]]
        # already booked: no call
        lead = await db.get(LeadAccount, "la_1")
        lead.stage = "meeting"
        await db.commit()
        assert (await H.run_call_step(db, ORG, enr, step, datetime.utcnow()))[0] == "skipped" and len(started) == 1


async def test_a_campaign_can_hold_call_steps_and_keeps_them_when_edited(db):
    _, token = await make_user(db, "camp", "Admin", org_id=ORG)
    async with _client(token) as c:
        body = {"name": "Spring", "mailbox_ids": [], "steps": [
            {"subject": "Hello", "body": "Hi {{first_name}}", "delay_days": 0},
            {"channel": "call", "condition": "no_reply", "delay_days": 2},
            {"subject": "", "body": "Following up. {{booking_link}}", "delay_days": 3}]}
        made = (await c.post("/api/email/campaigns", json=body)).json()["campaign"]
        assert [s["channel"] for s in made["steps"]] == ["email", "call", "email"] and made["steps"][1]["condition"] == "no_reply"
        saved = (await c.put(f"/api/email/campaigns/{made['id']}", json={**body, "name": "Spring 2"})).json()["campaign"]
        assert saved["steps"][1]["channel"] == "call"
        assert (await c.post("/api/email/campaigns", json={**body, "steps": [{"channel": "call", "delay_days": 0}]})).status_code == 400
        added = (await c.post(f"/api/email/campaigns/{made['id']}/leads", json={"leads": [{"email": "a@kirkgate.example", "lead_id": "la_9"}]})).json()
        assert added["added"] == 1
        with org_scope(ORG):
            assert (await db.execute(select(EmailEnrollment.lead_id))).scalar_one() == "la_9"


async def test_opening_an_email_counts_once_per_view_and_shows_on_the_timeline(db):
    from app.services.email_dispatcher import open_token

    with org_scope(ORG):
        db.add(LeadAccount(id="la_1", name="Kirkgate Dental", email="a@kirkgate.example"))
        db.add(EmailMessage(id="em_9", recipient_email="a@kirkgate.example", subject="Hello", open_count=0))
        await db.commit()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:  # no sign-in: an email app asks
        for _ in range(2):
            r = await anon.get(f"/api/email/o/{open_token(ORG, 'em_9')}")
            assert r.status_code == 200 and r.headers["content-type"] == "image/gif"
        assert (await anon.get("/api/email/o/not-a-token")).status_code == 200  # always a picture, never an error
    with org_scope(ORG):
        db.expire_all()
        assert (await db.get(EmailMessage, "em_9")).open_count == 2
        events = (await db.execute(select(ContactEvent).where(ContactEvent.lead_id == "la_1"))).scalars().all()
        assert len(events) == 1 and events[0].summary == "Opened: Hello"


async def test_engagers_become_leads_in_a_social_audience_list(db):
    from app.services import social_engagement as SE

    _, token = await make_user(db, "social", "Admin", org_id=ORG)
    with org_scope(ORG):
        db.add(SocialPost(id="post_1", title="Why follow-up matters", copy="x", status="published", publish_results=[]))
        db.add(LeadAccount(id="la_known", name="Kirkgate Dental", contact_name="Maria Lopez"))
        await db.commit()
    async with _client(token) as c:
        added = (await c.post("/api/social/posts/post_1/engagers", json={"people": [
            {"name": "Maria Lopez", "text": "Great point", "network": "linkedin"},
            {"name": "Sam Hart", "company": "Hart Plumbing", "text": "Can you quote?", "network": "linkedin"}]})).json()
        assert added["added"] == 2
        listing = (await c.get("/api/social/posts/post_1/engagers")).json()
        assert listing["can_add_to_leads"] is True and len(listing["engagers"]) == 2
        known = [e for e in listing["engagers"] if e["name"] == "Maria Lopez"][0]
        assert known["lead_id"] == "la_known"  # already a lead: shows on its timeline as engaged
        new = [e for e in listing["engagers"] if e["name"] == "Sam Hart"][0]
        out = (await c.post("/api/social/engagers/to-list", json={"ids": [new["id"], known["id"]]})).json()
        assert out["added"] == 1 and out["linked"] == 1 and out["list"]["name"] == "Social audience"
        mine = (await c.get("/api/leads/accounts")).json()["accounts"]
        sam = [a for a in mine if a["name"] == "Hart Plumbing"][0]
        assert sam["source"] == "social" and sam["connection"]["source_post_id"] == "post_1"
        flags = (await c.get("/api/together/leads")).json()["leads"]
        assert flags["la_known"]["engagements"] == 1 and flags["la_known"]["warm"] is True


async def test_a_booking_link_shows_free_times_and_a_post_gets_the_credit(db):
    from app.public_api import book_page

    _, token = await make_user(db, "booker", "Admin", org_id=ORG)
    with org_scope(ORG):
        db.add(LeadAccount(id="la_1", name="Kirkgate Dental", contact_name="Maria Lopez", email="m@kirkgate.example", phone="01134960001"))
        db.add(SocialPost(id="post_1", title="Event", copy="x", status="published"))
        await db.commit()
    async with _client(token) as c:
        for_lead = (await c.get("/api/leads/booking-link?lead_id=la_1")).json()["url"]
        for_post = (await c.post("/api/social/posts/post_1/booking-link", json={})).json()["url"]
        assert "/api/p/" in for_lead and for_post != for_lead
        assert (await c.get("/api/leads/booking-link?lead_id=nope")).status_code == 404
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:  # the lead opens it
        page = await anon.get(for_lead.replace("http://test", "").replace("https://test", ""))
        assert page.status_code in (200, 503)
        if page.status_code == 200:
            assert "Book a time" in page.text and "m@kirkgate.example" in page.text  # filled in for them
        assert (await anon.get("/api/p/not-a-real-token")).status_code == 404
    ref = book_page.decode(book_page.encode("la_1", "post_1", "../../etc"))
    assert ref == {"lead_id": "la_1", "post_id": "post_1", "slug": "15-min-discovery"}  # a slug can't point anywhere else


async def test_reminders_go_out_once_and_callbacks_notify_once(db, monkeypatch):
    from app.models.models import Notification
    from app.services import connection_jobs as J
    from app.services.calendar_service import calendar_service

    sent = []

    async def send(db_, to, subject, html, text_body=None, ics_text=None):
        sent.append((to, subject))
        return {"ok": True}
    monkeypatch.setattr(calendar_service, "send_outbound_email", send)
    now = datetime.utcnow()
    with org_scope(ORG):
        db.add(Meeting(id="mt_1", prospect="Maria Lopez", mission="Calls", date="2026-11-20", time="10:00", status="upcoming",
                       starts_at_utc=now + timedelta(hours=24), attendee_email="m@kirkgate.example"))
        db.add(Meeting(id="mt_far", prospect="Far Away", mission="Calls", date="2026-12-20", time="10:00", status="upcoming",
                       starts_at_utc=now + timedelta(days=10), attendee_email="far@example.test"))
        db.add(LeadAccount(id="la_1", name="Kirkgate Dental", next_action="Call back", next_action_at=now - timedelta(minutes=5)))
        await db.commit()
        assert await J.send_reminders(db, now) == 1 and await J.send_reminders(db, now) == 0  # once only
        assert sent == [("m@kirkgate.example", "Reminder: your meeting tomorrow")]
        assert await J.callbacks_due(db, now) == 1 and await J.callbacks_due(db, now) == 0
        await db.commit()
        assert len((await db.execute(select(Notification))).scalars().all()) == 1


async def test_a_meeting_not_attended_follows_up_once(db, monkeypatch):
    from app.services import connection_jobs as J
    from app.services.calendar_service import calendar_service

    sent = []

    async def send(db_, to, subject, html, text_body=None, ics_text=None):
        sent.append(subject)
        return {"ok": True}
    monkeypatch.setattr(calendar_service, "send_outbound_email", send)
    with org_scope(ORG):
        db.add(LeadAccount(id="la_1", name="Kirkgate Dental", email="m@kirkgate.example"))
        db.add(Meeting(id="mt_1", prospect="Maria Lopez", mission="Calls", date="2026-11-20", time="10:00", attendee_email="m@kirkgate.example", lead_id="la_1"))
        await C.save_rules(db, {"no_show_email": True})
        await db.commit()
        meeting = await db.get(Meeting, "mt_1")
        assert (await J.after_no_show(db, ORG, meeting))["email"] is True
        assert (await J.after_no_show(db, ORG, meeting))["email"] is False  # the second time does nothing
        assert sent == ["Sorry we missed you"]


async def test_a_partner_chain_shares_one_contact_across_calls_and_meetings(db):
    with org_scope(ORG):
        db.add(Prospect(id="p_api1", name="Jo Bloggs", phone="+447700900123", email="jo@bloggs.example"))
        await db.commit()
        first = await C.resolve_lead_id(db, "p_api1")
        again = await C.resolve_lead_id(db, "p_api1")
        assert first and first == again and first.startswith("la_")  # made once, then reused
        company = await db.get(LeadAccount, first)
        assert company.source == "api" and company.phone == "+447700900123"
        assert await C.resolve_lead_id(db, first) == first
        assert await C.resolve_lead_id(db, "nope") is None


async def test_a_round_started_from_lead_gen_dials_through_the_assistant_when_the_company_uses_it(db, monkeypatch):
    from app.models.models import Mission
    from app.services import outbound_dial as OD
    from app.services import telnyx_assistant_dial as TAD
    from app.services import voice_assistants as VA

    placed = []

    async def dial(db_, to, **kw):
        placed.append((to, kw["prospect_id"], kw["mission_id"]))
        return {"success": True, "callId": "call_x", "to": to}

    async def minutes(db_):
        return True

    async def from_number(db_, n):
        return "+441130000000"
    monkeypatch.setattr(TAD, "dial_via_telnyx_assistant", dial)
    monkeypatch.setattr(VA, "enabled_for_org", lambda org: True)
    monkeypatch.setattr(OD, "_has_minutes", minutes)
    monkeypatch.setattr(OD, "resolve_from_number", from_number)

    async def count_lines(db_):
        return 0
    monkeypatch.setattr(OD, "count_active_voice_lines", count_lines)
    with org_scope(ORG):
        db.add(Mission(id="m_lg", title="Calls: Leeds", status="active", source="leadgen", concurrency=1))
        await db.flush()
        db.add(Prospect(id="p_lg", mission_id="m_lg", name="Kirkgate Dental", phone="+441134960001", status="queued", lead_id="la_1"))
        await db.commit()
        out = await OD.start_mission_dials("m_lg")
        assert placed == [("+441134960001", "p_lg", "m_lg")]
        assert out[0]["status"] == "calling" and out[0]["call_id"] == "call_x"
        db.expire_all()
        assert (await db.get(Prospect, "p_lg")).status == "calling"


async def test_the_real_call_log_writer_updates_the_lead_it_called(db):
    from app.services.call_log_writer import upsert_call_log_from_live

    with org_scope(ORG):
        db.add(LeadAccount(id="la_1", name="Kirkgate Dental", phone="01134960001"))
        db.add(Prospect(id="p_1", name="Kirkgate Dental", phone="01134960001", lead_id="la_1"))
        await db.flush()
        call = LiveCall(id="call_w1", prospect="Kirkgate Dental", mission="Calls", prospect_id="p_1", transcript=["AI: Hello", "Prospect: Not now, thanks"])
        db.add(call)
        await db.commit()
        await upsert_call_log_from_live(db, call, outcome="contacted", duration="00:40")
        await db.commit()
        db.expire_all()
        lead = await db.get(LeadAccount, "la_1")
        assert lead.last_call_outcome == "contacted" and lead.stage == "contacted" and lead.last_called_at
        log = (await db.execute(select(CallLog))).scalars().first()
        assert log.lead_id == "la_1"


async def test_a_start_that_cannot_dial_leaves_no_half_made_round_behind(db, monkeypatch, open_hours):
    from app.models.models import Mission
    from app.services import outbound_dial

    async def no_line(db_, number):
        raise ValueError("No outbound Caller ID configured.")
    monkeypatch.setattr(outbound_dial, "resolve_from_number", no_line)
    _, token = await make_user(db, "noline", "Admin", org_id=ORG)
    async with _client(token) as c:
        made = (await c.post("/api/leads/accounts", json={"accounts": [{"name": "Kirkgate Dental", "phone": "01134960001"}]})).json()["accounts"]
        res = await c.post("/api/leads/accounts/call", json={"ids": [made[0]["id"]]})
        assert res.status_code == 400 and "Caller ID" in res.json()["detail"]
    with org_scope(ORG):
        assert (await db.execute(select(Mission))).scalars().all() == []
        assert (await db.execute(select(Prospect))).scalars().all() == []
