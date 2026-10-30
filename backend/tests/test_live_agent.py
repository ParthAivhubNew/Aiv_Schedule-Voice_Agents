"""Planning with the person and running the plan, against the real model. Runs only with LIVE_AI=1 (costs a few cents), on the scratch database.

    LIVE_AI=1 TEST_DATABASE_URL=postgresql+asyncpg://.../aiv_live pytest tests/test_live_agent.py -s
"""
import asyncio
import json
import os
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import BusinessRecord, CallList, CallLog, LeadAccount
from tests.conftest import make_user

pytestmark = [pytest.mark.db, pytest.mark.skipif(os.environ.get("LIVE_AI") != "1", reason="set LIVE_AI=1 to call the real model")]
ORG = "org_liveag"


async def say(c, plugin, message, history):
    r = await c.post(f"/api/assistant/{plugin}/ask" if plugin != "leads" else "/api/leads/assistant/ask", json={"message": message, "history": history})
    assert r.status_code == 200, r.text
    res = r.json()
    print(f"\n[{plugin}] {message}\n  steps: {[s['label'] for s in res['steps']]}  cards: {[p['kind'] for p in res['proposals']]}\n  reply: {res['reply']}")
    history += [{"role": "user", "content": message}, {"role": "assistant", "content": res["reply"]}]
    return res


@pytest.fixture
async def world(db):
    _, token = await make_user(db, "liveag", "Admin", org_id=ORG)
    now = datetime.utcnow()
    with org_scope(ORG):
        db.add_all([CallList(id="l1", name="Weekday list", row_count=12, called_count=0),
                    CallLog(id="c1", canonical_name="Brew House", listed_as="Brew House", started_at="10:00", ended_at="10:05", duration="5 min", outcome="meeting_booked",
                            summary="Wants a meeting Thursday 2pm.", created_at=now - timedelta(days=1)),
                    LeadAccount(id="a1", name="Old Customer Ltd", phone="0113 111", stage="won"), LeadAccount(id="a2", name="No Phone Ltd", stage="new")])
        await db.commit()
    db.add_all([BusinessRecord(id=f"lb{i}", identity_hash=f"lh{i}", name=n, region="Leeds", sic_text="56101 - Licensed restaurants", status="Active", raw_data={}, sources=[], rank_score=0)
                for i, n in enumerate(["Brew House Ltd", "Corner Cafe Ltd", "Roast Lane Ltd", "Bean There Ltd"])])
    await db.commit()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=180, headers={"Authorization": f"Bearer {token}"}) as c:
        yield c


async def test_the_real_model_talks_it_through_then_writes_a_valid_plan_that_runs(world, db):
    history = []
    first = await say(world, "voice", "I want to get more meetings from cafes in Leeds.", history)
    assert not [p for p in first["proposals"] if p["kind"] == "plan_run"], "it should talk it through first, not jump to a plan"

    second = await say(world, "voice", "Find cafes in Leeds, save up to 4 into a list called Leeds cafes, then help me schedule calls to that list. Go ahead and write the plan.", history)
    cards = [p for p in second["proposals"] if p["kind"] == "plan_run"]
    assert len(cards) == 1, second
    run = cards[0]["params"]["run"]
    kinds = [(s["plugin"], s["tool"], s["kind"]) for s in run["steps"]]
    print("  plan:", kinds)
    assert ("leads", "search_companies", "read") in kinds and ("leads", "add_to_list", "do") in kinds and any(k[2] == "gate" for k in kinds)
    with org_scope(ORG):
        assert (await db.execute(select(func.count()).select_from(LeadAccount).where(LeadAccount.source == "scout"))).scalar() == 0  # not run yet
        await db.rollback()

    change = await say(world, "voice", "Actually leave out the scheduling step, I will do that later.", history)
    changed = [p for p in change["proposals"] if p["kind"] == "plan_run"]
    assert len(changed) == 1 and not any(s["kind"] == "gate" for s in changed[0]["params"]["run"]["steps"])
    plan = changed[0]["params"]["run"]

    assert (await world.post(f"/api/agent/runs/{plan['id']}/start")).status_code == 200
    for _ in range(100):
        final = (await world.get(f"/api/agent/runs/{plan['id']}")).json()["run"]
        if final["status"] in ("done", "failed", "waiting"):
            break
        await asyncio.sleep(0.2)
    print("  run:", final["status"], [(s["label"], s["state"], s["result"][:80]) for s in final["steps"]])
    assert final["status"] == "done"
    with org_scope(ORG):
        saved = [a.name for a in (await db.execute(select(LeadAccount).where(LeadAccount.source == "scout"))).scalars().all()]
        await db.rollback()
    assert 1 <= len(saved) <= 4 and all(n.endswith("Ltd") for n in saved)  # real register companies, saved for this company
    assert "the person" not in change["reply"] and change["reply"].count("is on screen") <= 1  # the answer reads naturally, once


async def test_the_real_model_asks_to_switch_when_a_question_needs_another_plugin(world):
    history = []
    res = await say(world, "voice", "Before I plan calls, how many of my saved companies in Leads have a phone number?", history)
    sw = [p for p in res["proposals"] if p["kind"] == "switch"]
    print("  switch:", [(p["params"]["plugin"], p["params"]["task"]) for p in sw])
    assert len(sw) == 1 and sw[0]["params"]["plugin"] == "leads"
    answer = await world.post("/api/leads/assistant/ask", json={"message": sw[0]["params"]["task"]})
    assert answer.status_code == 200
    print("  leads answered:", answer.json()["reply"])
    assert "1" in answer.json()["reply"] or "one" in answer.json()["reply"].lower()
