"""The Leads assistant picks tools, shows what it did, and only proposes anything that costs credits or changes a list."""
import json

import httpx
import pytest
from sqlalchemy import select

from app.api import lead_assistant as LA
from app.main import app
from app.models.models import BusinessRecord, LeadAccount
from app.services import business_records, llm_gateway
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def _call(name, **args):
    return {"id": f"c_{name}", "function": {"name": name, "arguments": json.dumps(args)}}


def _rows():
    return [BusinessRecord(id=f"b{i}", identity_hash=f"h{i}", name=name, region="Leeds", sic_text="56101 - Licensed restaurants", status="Active",
                           raw_data={}, sources=[], rank_score=0) for i, name in enumerate(["Brew House Ltd", "Corner Cafe Ltd"])]


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    LA._used.clear()
    state = {"plan": {"success": True, "reply": "Hello", "tool_calls": []}, "answer": {"success": True, "reply": "I found 2 companies."}}

    async def plan(**_):
        return state["plan"]

    async def answer(**_):
        return state["answer"]

    async def search(db, filters, **_):
        return {"total": 2, "total_capped": False, "rows": _rows()}

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    monkeypatch.setattr(llm_gateway, "call_open_chat_llm", answer)
    monkeypatch.setattr(business_records, "search_filtered", search)
    return state


async def test_a_search_shows_what_it_did_and_returns_stored_companies(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("search_companies", sector=["restaurant"], towns=["Leeds"])]}
    _, token = await make_user(db, "as1", "Admin", org_id="org_as1")
    async with _client(token) as c:
        r = (await c.post("/api/leads/assistant/ask", json={"message": "cafes in Leeds"})).json()
    assert r["reply"] == "I found 2 companies."
    assert r["found"]["total"] == 2 and [x["name"] for x in r["found"]["top"]] == ["Brew House Ltd", "Corner Cafe Ltd"]
    assert r["steps"][0]["label"] == "Searched the company register" and "2 found" in r["steps"][0]["detail"]
    assert r["proposals"] == []


async def test_saving_to_a_list_is_only_proposed_never_done(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("search_companies", sector=["restaurant"], towns=["Leeds"]),
                                                                   _call("add_to_list", list_name="Leeds cafes", how_many=500)]}
    _, token = await make_user(db, "as2", "Admin", org_id="org_as2")
    async with _client(token) as c:
        r = (await c.post("/api/leads/assistant/ask", json={"message": "save cafes in Leeds to a list called Leeds cafes"})).json()
        p = r["proposals"][0]
        assert p["kind"] == "add_to_list" and p["params"]["list_name"] == "Leeds cafes" and p["params"]["how_many"] == 200 and p["params"]["filters"]
        assert (await db.execute(select(LeadAccount))).scalars().all() == []  # nothing was saved: the person confirms on screen


async def test_a_check_is_proposed_for_a_real_list_and_a_made_up_one_is_not(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("check_list", list_name="aivhub"), _call("start_campaign", list_name="Nope")]}
    _, token = await make_user(db, "as3", "Admin", org_id="org_as3")
    async with _client(token) as c:
        r = (await c.post("/api/leads/assistant/ask", json={"message": "check my aivhub list", "lists": [{"id": "l1", "name": "AIVHUB", "count": 3}]})).json()
    assert [(p["kind"], p["params"]["list_id"]) for p in r["proposals"]] == [("check_list", "l1")]


async def test_a_plain_question_needs_no_tool(db, fakes):
    fakes["plan"] = {"success": True, "reply": "Cold emails work best when short.", "tool_calls": []}
    _, token = await make_user(db, "as4", "Admin", org_id="org_as4")
    async with _client(token) as c:
        r = (await c.post("/api/leads/assistant/ask", json={"message": "how long should a cold email be?"})).json()
    assert r["reply"] == "Cold emails work best when short." and r["steps"] == [] and r["found"] is None


async def test_when_the_ai_is_down_the_person_is_told_and_not_charged_a_message(db, fakes):
    fakes["plan"] = {"success": False, "error": "boom", "tool_calls": [], "reply": ""}
    _, token = await make_user(db, "as5", "Admin", org_id="org_as5")
    async with _client(token) as c:
        r = await c.post("/api/leads/assistant/ask", json={"message": "hi"})
    assert r.status_code == 502 and "did not answer" in r.json()["detail"]
    assert not LA._used


async def test_the_daily_message_cap_stops_runaway_use(db, fakes, monkeypatch):
    monkeypatch.setattr(LA, "DAILY_MESSAGES", 1)
    _, token = await make_user(db, "as6", "Admin", org_id="org_as6")
    async with _client(token) as c:
        assert (await c.post("/api/leads/assistant/ask", json={"message": "hi"})).status_code == 200
        assert (await c.post("/api/leads/assistant/ask", json={"message": "again"})).status_code == 429


async def test_the_profile_is_read_from_the_site_and_not_saved(db, monkeypatch):
    async def page(url, max_chars=6000):
        return "Brew House", "We roast coffee for offices across Yorkshire and deliver weekly. " * 4

    async def fields(**_):
        return {"company": "Brew House", "sells": "Roasted coffee for offices.", "audience": "Offices in Yorkshire", "offer": "", "tone": "friendly"}

    monkeypatch.setattr(LA, "fetch_text", page)
    monkeypatch.setattr(llm_gateway, "extract_structured", fields)
    _, token = await make_user(db, "as7", "Admin", org_id="org_as7")
    async with _client(token) as c:
        r = (await c.post("/api/leads/assistant/profile-from-site", json={"url": "brewhouse.example"})).json()
    assert r["website"] == "https://brewhouse.example" and r["profile"]["sells"] == "Roasted coffee for offices."


async def test_an_unreadable_site_gives_a_plain_reason(db, monkeypatch):
    async def page(url, max_chars=6000):
        raise LA.FetchRefused("That website could not be found.")

    monkeypatch.setattr(LA, "fetch_text", page)
    _, token = await make_user(db, "as8", "Admin", org_id="org_as8")
    async with _client(token) as c:
        r = await c.post("/api/leads/assistant/profile-from-site", json={"url": "nowhere.example"})
    assert r.status_code == 400 and r.json()["detail"] == "That website could not be found."
