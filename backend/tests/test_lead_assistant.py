"""The Leads assistant picks tools, shows what it did, and only proposes anything that costs credits or changes a list."""
import json

import httpx
import pytest
from sqlalchemy import select

from app.api import lead_assistant as LA
from app.core.tenancy import org_scope
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
    assert await LA._spent_today(db) == 0


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


async def test_questions_about_my_own_leads_are_answered_from_my_data(db, fakes, monkeypatch):
    seen = {}

    async def answer(**kw):
        seen["prompt"] = kw["system_prompt"]
        return {"success": True, "reply": "Done."}

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm", answer)
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("my_data", topic="pipeline")]}
    _, token = await make_user(db, "as9", "Admin", org_id="org_as9")
    for org, rows in (("org_as9", [LeadAccount(id="la1", name="A", email="a@a.test", stage="new"), LeadAccount(id="la2", name="B", phone="0113", stage="interested")]),
                      ("other", [LeadAccount(id="la3", name="C", email="c@c.test", stage="won")])):
        with org_scope(org):
            db.add_all(rows)
            await db.commit()
    async with _client(token) as c:
        r = (await c.post("/api/leads/assistant/ask", json={"message": "how are my leads doing?"})).json()
    assert "Saved companies: 2" in seen["prompt"] and "new 1" in seen["prompt"] and "interested 1" in seen["prompt"] and "won" not in seen["prompt"]
    assert r["steps"][0]["label"] == "Read your saved companies"


async def test_every_reply_carries_suggestions_and_remembered_notes_reach_the_model(db, fakes, monkeypatch):
    seen = {}

    async def plan(**kw):
        seen["prompt"] = kw["system_prompt"]
        return {"success": True, "reply": "Hi", "tool_calls": []}

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    _, token = await make_user(db, "as10", "Admin", org_id="org_as10")
    async with _client(token) as c:
        r = (await c.post("/api/leads/assistant/ask", json={"message": "hi", "memory": ["Only suggest companies with a website"]})).json()
    assert "Only suggest companies with a website" in seen["prompt"]
    assert r["suggestions"] and len(r["suggestions"]) <= 6 and "hi" not in [s.lower() for s in r["suggestions"]]


def test_suggestions_follow_the_state_of_the_chat():
    after_search = LA.suggestions(found=True, proposals=False, lists=[], has_profile=True)
    assert "Only the ones with an email" in after_search and "Save these to a new list" in after_search
    with_lists = LA.suggestions(found=False, proposals=False, lists=[{"name": "Leeds cafes"}], has_profile=True)
    assert with_lists[0] == "Check my list “Leeds cafes”"
    assert "Help me describe my business" in LA.suggestions(found=False, proposals=False, lists=[], has_profile=False)


async def test_tools_chain_over_rounds_and_each_round_sees_the_last(db, fakes, monkeypatch):
    seen = []
    plans = [{"success": True, "reply": "", "tool_calls": [_call("my_data", topic="customer_profile")]},
             {"success": True, "reply": "", "tool_calls": [_call("search_companies", sector=["restaurant"], towns=["Leeds"])]},
             {"success": True, "reply": "Here are 2 like your best customers.", "tool_calls": []}]

    async def plan(**kw):
        seen.append(kw["system_prompt"])
        return plans[len(seen) - 1]

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    _, token = await make_user(db, "as11", "Admin", org_id="org_as11")
    async with _client(token) as c:
        r = (await c.post("/api/leads/assistant/ask", json={"message": "find companies like my best customers"})).json()
    assert len(seen) == 3 and "no saved companies yet" in seen[1]
    assert "Search (" in seen[2]
    assert r["reply"] == "Here are 2 like your best customers." and r["found"]["total"] == 2


async def test_one_tool_failing_does_not_lose_the_turn(db, fakes, monkeypatch):
    async def boom(db, filters, **_):
        raise RuntimeError("register down")

    monkeypatch.setattr(business_records, "search_filtered", boom)
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("search_companies", sector=["restaurant"]), _call("show_credits")]}
    _, token = await make_user(db, "as12", "Admin", org_id="org_as12")
    async with _client(token) as c:
        r = await c.post("/api/leads/assistant/ask", json={"message": "cafes and my credits"})
    assert r.status_code == 200
    labels = [s["label"] for s in r.json()["steps"]]
    assert "Read your credits" in labels and any(l.startswith("Could not finish") for l in labels)


async def test_the_same_call_is_never_run_twice(db, fakes):
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("show_credits")]}
    _, token = await make_user(db, "as13", "Admin", org_id="org_as13")
    async with _client(token) as c:
        r = (await c.post("/api/leads/assistant/ask", json={"message": "credits?"})).json()
    assert [s["label"] for s in r["steps"]] == ["Read your credits"]


async def test_web_search_is_only_offered_when_the_toggle_is_on_and_is_a_proposal(db, fakes, monkeypatch):
    tools_seen = []

    async def plan(**kw):
        tools_seen.append([t["function"]["name"] for t in kw["tools"]])
        return fakes["plan"]

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("search_web", query="dental practices in Leeds")]}
    _, token = await make_user(db, "as14", "Admin", org_id="org_as14")
    async with _client(token) as c:
        off = (await c.post("/api/leads/assistant/ask", json={"message": "web search dentists in Leeds"})).json()
        on = (await c.post("/api/leads/assistant/ask", json={"message": "web search dentists in Leeds", "web_search": True})).json()
    assert "search_web" not in tools_seen[0] and "search_web" in tools_seen[-1]
    assert off["proposals"] == []  # a model that calls it anyway is refused by the server
    p = on["proposals"][0]
    assert p["kind"] == "web_search" and p["params"] == {"query": "dental practices in Leeds"}


async def test_a_thin_register_result_offers_the_web(db, fakes, monkeypatch):
    async def few(db, filters, **_):
        return {"total": 1, "total_capped": False, "rows": _rows()[:1]}

    monkeypatch.setattr(business_records, "search_filtered", few)
    fakes["plan"] = {"success": True, "reply": "", "tool_calls": [_call("search_companies", sector=["restaurant"], towns=["Leeds"])]}
    _, token = await make_user(db, "as15", "Admin", org_id="org_as15")
    async with _client(token) as c:
        off = (await c.post("/api/leads/assistant/ask", json={"message": "cafes in Leeds"})).json()
        on = (await c.post("/api/leads/assistant/ask", json={"message": "cafes in Leeds", "web_search": True})).json()
    assert off["suggestions"][0] == "Turn on Web search to look beyond the register"
    assert on["suggestions"][0] == "Search the web for these"
    assert on["state"]["last_names"] == ["Brew House Ltd"]


async def test_the_last_results_reach_the_model_so_the_second_one_resolves(db, fakes, monkeypatch):
    seen = {}

    async def plan(**kw):
        seen["prompt"] = kw["system_prompt"]
        return {"success": True, "reply": "ok", "tool_calls": []}

    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    _, token = await make_user(db, "as16", "Admin", org_id="org_as16")
    async with _client(token) as c:
        await c.post("/api/leads/assistant/ask", json={"message": "save the second one", "state": {"last_names": ["Brew House Ltd", "Corner Cafe Ltd"]}})
    assert "2. Corner Cafe Ltd" in seen["prompt"]


async def test_the_daily_count_is_shared_through_the_database(db, fakes, monkeypatch):
    monkeypatch.setattr(LA, "DAILY_MESSAGES", 2)
    _, token = await make_user(db, "as17", "Admin", org_id="org_as17")
    async with _client(token) as c:
        for _ in range(2):
            assert (await c.post("/api/leads/assistant/ask", json={"message": "hi"})).status_code == 200
        assert (await c.post("/api/leads/assistant/ask", json={"message": "hi"})).status_code == 429


def test_the_tool_set_is_small_and_every_tool_says_when_to_use_it():
    names = [t["function"]["name"] for t in LA.TOOLS]
    assert len(names) == len(set(names)) and len(names) <= 6
    assert all(t["function"]["description"].startswith("USE") for t in LA.TOOLS + [LA.WEB_TOOL])
    assert "search_web" not in names  # only added when the person switches Web search on
