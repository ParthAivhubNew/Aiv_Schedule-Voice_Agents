"""Lead Gen, Voice and Social working together, end to end on a real database: what a call changes on a lead,
the one do-not-contact list, meetings stopping sequences, rules, merging, timelines and the cross-plugin views."""
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import (
    CallBrief,
    CallLog,
    ContactEvent,
    DoNotContact,
    EmailEnrollment,
    LeadAccount,
    LiveCall,
    Meeting,
    NumberCheck,
    Prospect,
)
from app.services import connection_handlers as H
from app.services import connections as C
from tests.conftest import make_user

pytestmark = pytest.mark.db
ORG = "org_default"  # the house organisation owns every plugin, so plans don't get in the way here


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


async def _lead(db, id="la_1", **kw):
    row = LeadAccount(id=id, name=kw.pop("name", "Kirkgate Dental"), phone=kw.pop("phone", "01134960001"), **kw)
    db.add(row)
    await db.flush()
    return row


async def _finished_call(db, lead, outcome="contacted", lines=(), notes="", captured=None, follow_up=None, call_id="call_1"):
    prospect = Prospect(id="p_" + call_id, name=lead.name, phone=lead.phone, lead_id=lead.id, mission_id=None)
    call = LiveCall(id=call_id, prospect=lead.name, mission="Calls", prospect_id=prospect.id, lead_id=lead.id, booked=(outcome == "meeting_booked"))
    log = CallLog(id="cl_" + call_id, canonical_name=lead.name, listed_as=lead.name, started_at="today", ended_at="today", outcome=outcome,
                  duration="01:10", requested_follow_up=follow_up)
    db.add_all([prospect, call, log])
    if notes or captured:
        db.add(CallBrief(id=call_id, outcome="", notes=notes, captured=captured or {}))
    await db.flush()
    transcript = [{"who": "them", "text": t} for t in lines] + [{"who": "ai", "text": "Hello"}]
    await H.on_call_finished(db, call, log, prospect, outcome, transcript)
    await db.commit()
    return call, log


async def test_a_finished_call_moves_the_lead_and_offers_what_it_heard(db):
    with org_scope(ORG):
        await _lead(db)
        await db.commit()
        await _finished_call(db, await db.get(LeadAccount, "la_1"), lines=["Yes, send it to bob@kirkgate.example please", "Best time to call is Tuesday mornings"])
        lead = await db.get(LeadAccount, "la_1")
        assert lead.stage == "contacted" and lead.last_call_outcome == "contacted" and lead.last_called_at
        assert {s["field"] for s in lead.suggestions} == {"email", "best_time"}
        events = (await db.execute(select(ContactEvent).where(ContactEvent.lead_id == "la_1"))).scalars().all()
        assert [e.summary for e in events] == ["Spoke to them"]

        # running it twice (the call is updated again later) changes nothing more
        call = await db.get(LiveCall, "call_1")
        log = await db.get(CallLog, "cl_call_1")
        await H.on_call_finished(db, call, log, await db.get(Prospect, "p_call_1"), "contacted", [{"who": "them", "text": "Yes, send it to bob@kirkgate.example please"}])
        await db.commit()
        lead = await db.get(LeadAccount, "la_1")
        assert len(lead.suggestions) == 2
        assert len((await db.execute(select(ContactEvent).where(ContactEvent.lead_id == "la_1"))).scalars().all()) == 1


async def test_suggestions_are_used_only_when_accepted_or_switched_on(db):
    with org_scope(ORG):
        lead = await _lead(db)
        await db.commit()
        await _finished_call(db, lead, lines=["Use dana@kirkgate.example"])
        lead = await db.get(LeadAccount, "la_1")
        assert lead.email == "" and len(lead.suggestions) == 1
        assert await H.resolve_suggestion(db, lead, lead.suggestions[0]["id"], True)
        await db.commit()
        assert (await db.get(LeadAccount, "la_1")).email == "dana@kirkgate.example"
        assert (await db.get(LeadAccount, "la_1")).suggestions is None

        await C.save_rules(db, {"auto_apply_suggestions": True})
        lead2 = await _lead(db, id="la_2", name="Headrow Lettings", phone="01134960002")
        await db.commit()
        await _finished_call(db, lead2, lines=["It is info@headrow.example"], call_id="call_2")
        assert (await db.get(LeadAccount, "la_2")).email == "info@headrow.example"


async def test_a_wrong_number_is_remembered_for_the_number_check(db):
    with org_scope(ORG):
        lead = await _lead(db)
        await db.commit()
        await _finished_call(db, lead, outcome="contacted", lines=["Sorry, you have the wrong number"])
        lead = await db.get(LeadAccount, "la_1")
        assert lead.last_call_outcome == "wrong_number" and lead.stage == "new"
        assert lead.verification["phone"]["state"] == "invalid"
        cached = (await db.execute(select(NumberCheck).where(NumberCheck.phone == "+441134960001"))).scalars().first()
        assert cached is not None and cached.status == "not_working"


async def test_asking_not_to_be_called_blocks_calls_emails_and_posts_everywhere(db):
    from app.services.compliance import is_opted_out
    from app.services.email_dispatcher import is_email_suppressed

    with org_scope(ORG):
        lead = await _lead(db, email="owner@kirkgate.example")
        await db.commit()
        await _finished_call(db, lead, outcome="contacted", lines=["Please stop calling me"])
        lead = await db.get(LeadAccount, "la_1")
        assert lead.stage == "do_not_contact"
        assert await is_opted_out(db, "01134960001")
        assert (await is_email_suppressed(db, "owner@kirkgate.example", ORG))[0]
        assert await C.block_for(db, phone="+44 113 496 0001", channel="call")
        assert await C.block_for(db, email="OWNER@kirkgate.example", channel="email")
        # a person-level block does not catch a stranger
        assert not await C.block_for(db, phone="01134960999", channel="call")
        entry = (await db.execute(select(DoNotContact))).scalars().first()
        assert entry.source == "call" and set(entry.channels) == {"call", "email", "social"}


async def test_a_callback_request_plans_a_follow_up(db):
    with org_scope(ORG):
        lead = await _lead(db)
        await db.commit()
        await _finished_call(db, lead, outcome="callback_requested", lines=["Call me Thursday at 3pm"], follow_up={"day": "Thursday", "time": "3pm"})
        lead = await db.get(LeadAccount, "la_1")
        assert lead.stage == "interested" and lead.next_action == "Call back"
        assert lead.next_action_at.weekday() == 3 and lead.next_action_at.hour == 15


async def test_booking_a_meeting_stops_the_rest_of_the_sequence(db):
    with org_scope(ORG):
        lead = await _lead(db, email="owner@kirkgate.example")
        from app.models.models import EmailCampaign

        db.add(EmailCampaign(id="cp_x", name="X"))
        await db.flush()
        db.add(EmailEnrollment(id="en_1", campaign_id="cp_x", email="owner@kirkgate.example", status="active", current_step=2))
        db.add(Prospect(id="p_q", name="Kirkgate Dental", phone="01134960001", lead_id="la_1", status="queued"))
        meeting = Meeting(id="mt_1", prospect="Kirkgate Dental", mission="Calls", date="2026-11-20", time="10:00", attendee_email="owner@kirkgate.example")
        db.add(meeting)
        await db.commit()
        await H.on_meeting_booked(db, meeting)
        await db.commit()
        assert (await db.get(Meeting, "mt_1")).lead_id == "la_1"
        assert (await db.get(LeadAccount, "la_1")).stage == "meeting"
        assert (await db.get(EmailEnrollment, "en_1")).status == "booked"
        assert (await db.get(Prospect, "p_q")).status == "meeting_booked"
        kinds = [e.kind for e in (await db.execute(select(ContactEvent).where(ContactEvent.lead_id == "la_1"))).scalars().all()]
        assert "meeting" in kinds


async def test_your_own_rules_run_on_the_lead_behind_an_event(db):
    from app.services import workflows as W

    with org_scope(ORG):
        await _lead(db)
        await db.commit()
        saved = await W.save_workflows(db, [
            {"name": "Lost on a no", "event": "call.completed", "when": {"outcome": "rejected"}, "do": [{"action": "set_stage", "value": "lost"}, {"action": "add_note", "value": "Said no to {{company}}"}]},
            {"name": "Broken", "event": "call.completed", "do": [{"action": "set_stage", "value": "nonsense"}]},
        ])
        assert [w["name"] for w in saved] == ["Lost on a no"]  # an incomplete rule is not kept
        await W.on_event(ORG, "call.completed", {"lead_id": "la_1", "outcome": "meeting_booked", "id": "c1"})
        assert (await db.get(LeadAccount, "la_1")).stage == "new"  # a different outcome: the rule stays quiet
        await W.on_event(ORG, "call.completed", {"lead_id": "la_1", "outcome": "rejected", "id": "c2"})
    with org_scope(ORG):
        db.expire_all()
        assert (await db.get(LeadAccount, "la_1")).stage == "lost"
        notes = [e.summary for e in (await db.execute(select(ContactEvent).where(ContactEvent.lead_id == "la_1"))).scalars().all()]
        assert any("Said no to Kirkgate Dental" in n for n in notes)


async def test_a_reaction_that_keeps_failing_is_kept_for_a_retry(db, monkeypatch):
    from app.models.models import PublicObject

    calls = []

    async def broken(org_id, event, data):
        calls.append(1)
        raise RuntimeError("mailbox down")
    monkeypatch.setattr(C, "RETRY_WAITS", (0, 0))
    C._HANDLERS["unit.test"] = [broken]
    await C._run(ORG, "unit.test", {"id": "x"})
    C._HANDLERS.pop("unit.test", None)
    assert len(calls) == 3
    with org_scope(ORG):
        kept = (await db.execute(select(PublicObject).where(PublicObject.kind == "dead_letter"))).scalars().all()
        assert len(kept) == 1 and kept[0].data["handler"] == "broken" and "mailbox down" in kept[0].data["error"]


async def test_the_same_event_id_is_handled_once():
    import asyncio

    seen = []

    async def note(org_id, event, data):
        seen.append(data["n"])
    C.subscribe("unit.once", note)
    C.emit(ORG, "unit.once", {"n": 1}, event_id="same")
    C.emit(ORG, "unit.once", {"n": 2}, event_id="same")
    await asyncio.sleep(0.05)
    C._HANDLERS.pop("unit.once", None)
    assert seen == [1]


# ── through the API ─────────────────────────────────────────────────────────
async def test_rules_blocklist_timeline_and_stage_through_the_api(db):
    _, token = await make_user(db, "boss2", "Admin", org_id=ORG)
    async with _client(token) as c:
        lead = (await c.post("/api/leads/accounts", json={"accounts": [{"name": "Kirkgate Dental", "phone": "01134960001", "email": "a@kirkgate.example"}]})).json()["accounts"][0]
        assert lead["connection"]["stage"] == "new" and lead["connection"]["can_call"] is True

        r = (await c.put("/api/together/rules", json={"rules": {"recontact_days": 30, "bogus": 1, "stop_on_booking": False}})).json()["rules"]
        assert r["recontact_days"] == 30 and r["stop_on_booking"] is False and "bogus" not in r
        assert (await c.get("/api/together/rules")).json()["rules"]["recontact_days"] == 30

        moved = (await c.post(f"/api/leads/accounts/{lead['id']}/stage", json={"stage": "interested", "note": "liked the demo"})).json()
        assert moved["lead"]["stage"] == "interested"
        await c.post(f"/api/leads/accounts/{lead['id']}/notes", json={"text": "Rang the owner"})
        tl = (await c.get(f"/api/contacts/{lead['id']}/timeline")).json()
        assert [e["kind"] for e in tl["events"]] == ["note", "status"]
        assert (await c.get(f"/api/contacts/{lead['id']}/timeline?kinds=status")).json()["events"][0]["summary"].startswith("Moved to interested")

        # blocking by hand reaches the lead, and unblocking lets calls through again
        added = (await c.post("/api/compliance/do-not-contact", json={"phone": "01134960001", "name": "Kirkgate"})).json()["entry"]
        assert (await c.get("/api/leads/accounts")).json()["accounts"][0]["connection"]["stage"] == "do_not_contact"
        entries = (await c.get("/api/compliance/do-not-contact")).json()["entries"]
        assert any(e["id"] == added["id"] for e in entries)
        assert (await c.delete(f"/api/compliance/do-not-contact/{added['id']}")).status_code == 200
        assert not [e for e in (await c.get("/api/compliance/do-not-contact")).json()["entries"] if e["phone"]]
        assert (await c.post("/api/compliance/do-not-contact", json={})).status_code == 400


async def test_home_views_pipeline_actions_search_inbox_and_export(db):
    _, token = await make_user(db, "boss3", "Admin", org_id=ORG)
    async with _client(token) as c:
        accounts = (await c.post("/api/leads/accounts", json={"accounts": [
            {"name": "Kirkgate Dental", "phone": "01134960001", "email": "a@kirkgate.example"},
            {"name": "Headrow Lettings", "phone": "01134960002"},
        ]})).json()["accounts"]
        a, b = accounts[0]["id"], accounts[1]["id"]
        await c.post(f"/api/leads/accounts/{a}/stage", json={"stage": "interested"})
        with org_scope(ORG):
            row = await db.get(LeadAccount, b)
            row.next_action, row.next_action_at = "Call back", datetime.utcnow() - timedelta(hours=1)
            await db.commit()

        pipe = (await c.get("/api/together/pipeline")).json()
        assert [s["key"] for s in pipe["stages"]] == ["found", "verified", "contacted", "interested", "meeting", "won"]
        assert pipe["stages"][0]["count"] == 2 and pipe["stages"][3]["count"] == 1

        nxt = (await c.get("/api/together/next-actions")).json()
        assert nxt["items"][0]["kind"] == "callback" and nxt["items"][0]["lead_id"] == b

        found = (await c.get("/api/together/search?q=kirkgate")).json()
        assert found["groups"][0]["kind"] == "lead" and found["groups"][0]["items"][0]["id"] == a
        assert (await c.get("/api/together/search?q=k")).json()["groups"] == []

        assert (await c.get("/api/together/inbox")).status_code == 200
        assert (await c.get("/api/together/checklist")).json()["total"] >= 3
        assert (await c.get("/api/together/weekly-summary")).status_code == 200

        csv_text = (await c.get("/api/contacts/export.csv")).text
        assert csv_text.splitlines()[0].startswith("Company,Contact,Email") and "Kirkgate Dental" in csv_text

        per = (await c.get("/api/together/leads")).json()["leads"]
        assert per[a]["score"] > per[b]["score"] and per[a]["history"] == "never"


async def test_duplicates_are_found_and_merged_without_losing_history(db):
    _, token = await make_user(db, "boss4", "Admin", org_id=ORG)
    async with _client(token) as c:
        one = (await c.post("/api/leads/accounts", json={"accounts": [{"name": "Kirkgate Dental", "website": "https://kirkgate.example"}]})).json()["accounts"][0]
        with org_scope(ORG):  # the same company saved a second time from another file, with a phone
            db.add(LeadAccount(id="la_dup", name="Kirkgate Dental Ltd", domain="kirkgate.example", phone="01134960001", stage="interested"))
            await db.commit()
        await c.post(f"/api/leads/accounts/la_dup/notes", json={"text": "Rang them"})
        lst = (await c.post("/api/leads/lists", json={"name": "Leeds", "ids": [one["id"], "la_dup"]})).json()["list"]
        groups = (await c.get("/api/contacts/duplicates")).json()["groups"]
        assert len(groups) == 1 and {m["id"] for m in groups[0]["members"]} == {one["id"], "la_dup"}

        done = (await c.post("/api/contacts/merge", json={"keep_id": one["id"], "merge_ids": ["la_dup"]})).json()
        assert done == {"kept": one["id"], "merged": 1}
        kept = [a for a in (await c.get("/api/leads/accounts")).json()["accounts"] if a["id"] == one["id"]][0]
        assert kept["phone"] == "01134960001" and kept["connection"]["stage"] == "interested"  # gained what it lacked
        assert [l for l in (await c.get("/api/leads/lists")).json()["lists"] if l["id"] == lst["id"]][0]["ids"] == [one["id"]]
        assert any("Rang them" in e["summary"] for e in (await c.get(f"/api/contacts/{one['id']}/timeline")).json()["events"])
        assert (await c.post("/api/contacts/merge", json={"keep_id": one["id"], "merge_ids": [one["id"]]})).status_code == 404


async def test_older_calls_are_linked_by_phone_without_overwriting(db):
    _, token = await make_user(db, "boss5", "Admin", org_id=ORG)
    async with _client(token) as c:
        lead = (await c.post("/api/leads/accounts", json={"accounts": [{"name": "Kirkgate Dental", "phone": "0113 496 0001"}]})).json()["accounts"][0]
        with org_scope(ORG):
            db.add(Prospect(id="p_old", name="Kirkgate", phone="+441134960001"))
            db.add(Prospect(id="p_kept", name="Other", phone="+441134960001", lead_id="la_other"))
            await db.commit()
        dry = (await c.post("/api/together/backfill?dry_run=true")).json()
        assert dry["dry_run"] is True and dry["prospects_linked"] == 1
        with org_scope(ORG):
            assert (await db.get(Prospect, "p_old")).lead_id is None
        await c.post("/api/together/backfill?dry_run=false")
        with org_scope(ORG):
            db.expire_all()
            assert (await db.get(Prospect, "p_old")).lead_id == lead["id"]
            assert (await db.get(Prospect, "p_kept")).lead_id == "la_other"  # an existing link is never replaced


async def test_every_new_table_is_private_to_its_organisation(db):
    from sqlalchemy import text

    for table in ("contact_events", "do_not_contact", "connection_rules", "social_engagers"):
        flag = (await db.execute(text("SELECT relrowsecurity FROM pg_class WHERE relname = :t"), {"t": table})).scalar()
        assert flag is True, f"{table} has no row-level security"
    with org_scope("org_a"):
        await C.add_block(db, phone="01134960001", name="Kirkgate", source="manual")
        await C.record_event(db, "note", lead_id="la_a", ref_id="n1", summary="Private to A")
        await C.save_rules(db, {"recontact_days": 3})
    await db.rollback()
    with org_scope("org_b"):
        assert await C.block_for(db, phone="01134960001", channel="call") is None
        assert await C.timeline(db, lead_id="la_a") == []
        assert (await C.get_rules(db))["recontact_days"] == 14
