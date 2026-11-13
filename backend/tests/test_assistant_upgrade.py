"""Thumbs on assistant answers (kept for staff, and one offered sentence the person may keep), plus the draft card and pick-one
that Voice and Social answers end with."""
import json
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import AssistantFeedback, CallLog, SocialPost
from app.services import assistant_feedback as AF
from app.services import llm_gateway
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def _call(name, **args):
    return {"id": f"c_{name}", "function": {"name": name, "arguments": json.dumps(args)}}


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    state = {"plan": {"success": True, "reply": "Hello", "tool_calls": []}}

    async def plan(**kw):
        return state["plan"]

    async def answer(**kw):
        return {"success": True, "reply": "Here is what I found."}

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    monkeypatch.setattr(llm_gateway, "call_open_chat_llm", answer)
    return state


def _log(i, outcome):
    return CallLog(id=f"ucl{i}", canonical_name=f"Firm {i}", listed_as=f"Firm {i}", started_at="10:00", ended_at="10:05", duration="5 min", outcome=outcome,
                   summary="", phone="+441130000000", created_at=datetime.utcnow() - timedelta(days=1))


async def test_a_thumbs_down_is_kept_and_offers_the_persons_own_words_as_the_lesson(db):
    _, token = await make_user(db, "fb1", "Admin", org_id="org_fb1")
    async with _client(token) as c:
        r = (await c.post("/api/assistant/feedback", json={
            "plugin": "leads", "rating": "down", "reason": "wrong_companies", "note": "These are all dormant companies",
            "question": "cafes in Leeds", "answer": "I found 2 companies.", "context": {"filters": {"towns": ["leeds"]}, "total": 2, "junk": "dropped"}})).json()
        assert r["lesson"] == "These are all dormant companies" and r["id"].startswith("af_")
        row = (await db.execute(select(AssistantFeedback).where(AssistantFeedback.id == r["id"]))).scalars().first()
        assert row.rating == "down" and row.reason == "wrong_companies" and row.from_org == "org_fb1" and row.lesson_saved is False
        assert row.context == {"filters": {"towns": ["leeds"]}, "total": 2}  # only the fields we keep
        assert (await c.post(f"/api/assistant/feedback/{r['id']}/lesson")).status_code == 200
        await db.refresh(row)
        assert row.lesson_saved is True


async def test_without_a_note_the_lesson_is_the_fixed_line_for_the_reason_and_a_thumbs_up_has_none(db):
    _, token = await make_user(db, "fb2", "Admin", org_id="org_fb2")
    async with _client(token) as c:
        down = (await c.post("/api/assistant/feedback", json={"plugin": "voice", "rating": "down", "reason": "too_long"})).json()
        up = (await c.post("/api/assistant/feedback", json={"plugin": "social", "rating": "up"})).json()
        odd = (await c.post("/api/assistant/feedback", json={"plugin": "leads", "rating": "down", "reason": "made_up"})).json()
    assert down["lesson"] == AF.LESSONS["too_long"] and up["lesson"] == "" and odd["lesson"] == ""  # an unknown reason is "other": no fixed line
    rows = {r.id: r for r in (await db.execute(select(AssistantFeedback))).scalars().all()}
    assert rows[odd["id"]].reason == "other" and rows[up["id"]].reason == ""
    kept = await AF.record(db, org="o", plugin="nonsense", rating="up")
    row = (await db.execute(select(AssistantFeedback).where(AssistantFeedback.id == kept["id"]))).scalars().first()
    assert row.plugin == "leads"  # an unknown assistant is kept as leads


async def test_nobody_can_mark_another_organisations_lesson(db):
    _, mine = await make_user(db, "fb3", "Admin", org_id="org_fb3")
    _, theirs = await make_user(db, "fb4", "Admin", org_id="org_fb4")
    async with _client(mine) as c:
        fid = (await c.post("/api/assistant/feedback", json={"plugin": "leads", "rating": "down", "reason": "other", "note": "x"})).json()["id"]
    async with _client(theirs) as c:
        assert (await c.post(f"/api/assistant/feedback/{fid}/lesson")).status_code == 404


async def test_staff_see_rates_and_reasons_without_any_organisation_named(db, staff):
    await AF.record(db, org="org_secret", plugin="leads", rating="down", reason="wrong_companies", question="dentists in Hull", answer="Listed 3", note="not dentists")
    await AF.record(db, org="org_secret", plugin="leads", rating="down", reason="wrong_companies", question="plumbers in Hull", answer="Listed 5")
    await AF.record(db, org="org_other", plugin="leads", rating="up")
    r = (await staff.get("/api/admin-api/assistant-feedback")).json()
    assert r["by_plugin"]["leads"]["up"] == 1 and r["by_plugin"]["leads"]["down"] == 2 and r["by_plugin"]["leads"]["up_rate"] == 33
    assert r["top_reasons"][0] == {"plugin": "leads", "reason": "wrong_companies", "label": "Wrong companies", "count": 2}
    assert {x["question"] for x in r["recent"]} == {"dentists in Hull", "plumbers in Hull"}
    assert "org_secret" not in json.dumps(r)
    fid = r["recent"][0]["id"]
    assert (await staff.put(f"/api/admin-api/assistant-feedback/{fid}", json={"status": "fixed"})).status_code == 200
    assert fid not in [x["id"] for x in (await staff.get("/api/admin-api/assistant-feedback")).json()["recent"]]  # fixed ones leave the list


async def test_voice_ends_with_a_calls_card_and_a_pick_one(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("call_results", days=7, outcome="meeting_booked")]}
    _, token = await make_user(db, "vv1", "Admin", org_id="org_vv1")
    with org_scope("org_vv1"):
        db.add_all([_log(1, "meeting_booked"), _log(2, "meeting_booked"), _log(3, "rejected")])
        await db.commit()
    async with _client(token) as c:
        r = (await c.post("/api/assistant/voice/ask", json={"message": "which calls booked a meeting?"})).json()
    assert r["view"] == {"kind": "calls", "title": "Calls view", "summary": "Last 7 days · meeting booked", "filter_count": 2, "total": 2, "capped": False,
                         "asked": 0, "screen": "#/voice/logs"}
    assert r["choices"][0]["recommended"] and r["choices"][0]["open"] == "#/voice/logs" and len(r["choices"]) == 3


async def test_social_ends_with_a_posts_card_and_nothing_found_means_no_card(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("post_overview")]}
    _, token = await make_user(db, "vs1", "Admin", org_id="org_vs1")
    async with _client(token) as c:
        empty = (await c.post("/api/assistant/social/ask", json={"message": "what is going out?"})).json()
    assert empty["view"] is None and empty["choices"] == []
    with org_scope("org_vs1"):
        db.add(SocialPost(id="up1", title="Launch", copy="Hello", status="scheduled", channels=["x"], due_at_ms=int((datetime.utcnow() + timedelta(days=1)).timestamp() * 1000)))
        await db.commit()
    async with _client(token) as c:
        r = (await c.post("/api/assistant/social/ask", json={"message": "what is going out?"})).json()
    assert r["view"]["kind"] == "posts" and r["view"]["total"] == 1 and r["view"]["screen"] == "#/scheduler/plan"
    assert r["choices"][0]["open"] == "#/scheduler/plan"


async def test_voice_and_social_have_no_daily_cap(db, fakes):
    from app.api import plugin_assistant as PA
    from app.services import credits

    _, token = await make_user(db, "vc1", "Admin", org_id="org_vc1")
    with org_scope("org_vc1"):
        await credits._put_doc(db, PA._usage_key("voice"), {"n": 9999})
        await db.commit()
    async with _client(token) as c:
        assert (await c.post("/api/assistant/voice/ask", json={"message": "hi"})).status_code == 200


async def test_social_plans_on_the_open_calendar_and_returns_an_outline_card(db, fakes, monkeypatch):
    seen = {}

    async def fake_plan(payload, _db):
        seen.update(payload)
        return {"status": "ok", "reply": "Two LinkedIn posts, Monday and Thursday.", "error": None, "posts": [],
                "plan": {"channels": ["linkedin"], "deleteIds": [], "posts": [
                    {"date": "2026-11-16", "time": "09:00", "channel": "linkedin", "headline": "A"},
                    {"date": "2026-11-19", "time": "09:00", "channel": "linkedin", "headline": "B"}]}}

    monkeypatch.setattr("app.api.scheduler.chat_plan", fake_plan)
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("plan_posts", request="two LinkedIn posts next week")]}
    _, token = await make_user(db, "wp1", "Admin", org_id="org_wp1")
    ws = {"posts": [{"id": "v2_1", "date": "2026-11-14", "channel": "x", "headline": "Old"}], "pinnedDates": ["2026-11-16"], "channels": ["linkedin"], "focusPostId": ""}
    async with _client(token) as c:
        r = (await c.post("/api/assistant/social/ask", json={"message": "two LinkedIn posts next week", "workspace": ws})).json()
    card = [p for p in r["proposals"] if p["kind"] == "plan_outline"]
    assert len(card) == 1 and len(card[0]["params"]["plan"]["posts"]) == 2 and "2 new posts for Linkedin" in card[0]["detail"]
    assert seen["currentPlan"]["posts"][0]["id"] == "v2_1" and seen["pinnedDates"] == ["2026-11-16"] and seen["targetDate"] == "2026-11-16"
    assert seen["selectedChannels"] == ["linkedin"]
    async with _client(token) as c:  # without an open calendar it still hands over to the planner
        r = (await c.post("/api/assistant/social/ask", json={"message": "two LinkedIn posts next week"})).json()
    assert [p["kind"] for p in r["proposals"]] == ["plan"]
