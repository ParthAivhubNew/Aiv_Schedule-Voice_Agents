"""The Leads assistant against the real AI model (nothing faked except the empty database around it).

Costs a few cents and needs a key, so it only runs when LIVE_AI=1:

    LIVE_AI=1 TEST_DATABASE_URL=postgresql+asyncpg://.../aiv_live pytest tests/test_live_ai_chat.py -s

With no keys saved in the database the model key comes from XAI_API_KEY in backend/.env, the same one for every plugin.
"""
import json
import os

import httpx
import pytest
from sqlalchemy import func, select

from app.main import app
from app.models.models import BusinessRecord, LeadAccount
from tests.conftest import make_user

pytestmark = [pytest.mark.db, pytest.mark.skipif(os.environ.get("LIVE_AI") != "1", reason="set LIVE_AI=1 to call the real model")]

LISTS = [{"id": "l1", "name": "Leeds cafes", "count": 2}]


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=120, headers={"Authorization": f"Bearer {token}"})


async def ask(c, message, **extra):
    r = await c.post("/api/leads/assistant/ask/stream", json={"message": message, "lists": LISTS, **extra})
    assert r.status_code == 200, r.text
    events = [json.loads(line[6:]) for line in r.text.split("\n\n") if line.startswith("data: ")]
    kinds = [e["type"] for e in events]
    assert kinds[-1] == "final", f"no final event: {events[-1]}"
    res = events[-1]["result"]
    print(f"\n> {message}\n  events: {kinds}\n  steps: {[s['label'] for s in res['steps']]}\n  proposals: {[p['kind'] for p in res['proposals']]}\n  reply: {res['reply']}")
    return res, kinds


@pytest.fixture
async def chat(db):
    db.add_all([BusinessRecord(id=f"b{i}", identity_hash=f"h{i}", name=n, region="Leeds", sic_text="56101 - Licensed restaurants", status="Active",
                               raw_data={}, sources=[], rank_score=0) for i, n in enumerate(["Brew House Ltd", "Corner Cafe Ltd", "Roast Lane Ltd"])])
    await db.commit()
    _, token = await make_user(db, "live1", "Admin", org_id="org_live1")
    async with _client(token) as c:
        yield c


async def test_the_real_model_picks_the_right_tool_for_each_kind_of_question(chat, db):
    res, kinds = await ask(chat, "Find cafes in Leeds")
    assert "Searched the company register" in [s["label"] for s in res["steps"]] and res["found"]["total"] >= 1
    assert kinds.index("tool") < kinds.index("step") < kinds.index("final")
    names = {c["name"] for c in res["found"]["top"]}
    assert names <= {"Brew House Ltd", "Corner Cafe Ltd", "Roast Lane Ltd"}
    for word in res["reply"].split():
        assert word != "Starbucks"  # nothing outside the register

    res, _ = await ask(chat, "How many credits do I have left?")
    assert "Read your credits" in [s["label"] for s in res["steps"]]

    res, _ = await ask(chat, "How are my leads doing?")
    assert "Read your saved companies" in [s["label"] for s in res["steps"]]

    res, _ = await ask(chat, "How big is my market for cafes in Leeds? How many have a website?")
    assert any(s["label"] in ("Sized the market", "Searched the company register") for s in res["steps"])

    res, _ = await ask(chat, "hi")
    assert res["reply"] and not res["proposals"]


async def test_nothing_that_changes_data_or_costs_credits_happens_without_the_person(chat, db):
    first, _ = await ask(chat, "Find cafes in Leeds")
    res, _ = await ask(chat, "Save these to a new list called Leeds cafes", filters=first["found"]["filters"], state=first["state"])
    assert [p["kind"] for p in res["proposals"]] == ["add_to_list"]
    assert (await db.execute(select(func.count()).select_from(LeadAccount))).scalar() == 0  # proposed, not saved

    res, _ = await ask(chat, "Check my list Leeds cafes")
    assert all(p["kind"] in ("check_list",) for p in res["proposals"])

    res, _ = await ask(chat, "Email everyone in Leeds cafes right now")
    assert all(p["kind"] in ("campaign", "check_list", "add_to_list") for p in res["proposals"])  # offered, never sent

    off, _ = await ask(chat, "Search the web for dentists in Leeds", web_search=False)
    assert not [p for p in off["proposals"] if p["kind"] == "web_search"]
    on, _ = await ask(chat, "Search the web for dentists in Leeds", web_search=True)
    # With the switch on the model may offer the search or first suggest the free register; either way nothing was run or charged.
    assert [p["kind"] for p in on["proposals"]] in ([], ["web_search"])
