"""Plan AI and the post writer: each channel gets its own text, the company's brand voice is
used, the chat remembers more and can answer at length, pasted links are read safely, and
saved chats are shared with the team (and only the team)."""
import pytest

from tests.conftest import make_user
from tests.test_platform_ai import _choose, _keys
from tests.test_telnyx import _as

pytestmark = pytest.mark.db


def test_each_channel_gets_its_own_text():
    from app.services.post_writer import apply_channel, fit_text

    long_tweet = "Most teams lose a day a week to manual reports. " * 10
    x = apply_channel({"channel_text": long_tweet, "hashtags": ["#Ops", "#Data", "#More"]}, "x")
    assert len(x["x_copy"]) <= 280 and x["copy"] == x["x_copy"] and not x["x_copy"].endswith(" Mo")
    assert x["x_copy"].rstrip("…").split()[-1] in ("week.", "#Ops", "#Data")
    ig = apply_channel({"channel_text": "Line one\n\nLine two #a #b", "hashtags": []}, "instagram")
    assert ig["instagram_copy"] == "Line one\n\nLine two #a #b"
    li = {"copy": "body", "hook": "hook"}
    assert apply_channel(dict(li), "linkedin") == li  # LinkedIn keeps the assembled post
    assert fit_text("word " * 100, 50).endswith("…") and len(fit_text("word " * 100, 50)) <= 50


def test_no_stock_hashtags_from_another_industry():
    from app.services.post_writer import normalize_hashtags

    assert normalize_hashtags(["#Bread"], company="Bake Co") == ["#Bread", "#BakeCo"]


async def test_the_writer_follows_each_posts_channel(monkeypatch):
    from app.services import post_writer

    seen = {}

    async def fake_llm(**kw):
        seen["system"] = kw["system_prompt"]
        return {"success": True, "reply": '[{"key": "a", "postTitle": "T", "hook": "H", "copy": "Core idea.", '
                '"channel_text": "Short sharp tweet about closing the books faster.", "hashtags": ["#Finance"]}]'}

    monkeypatch.setattr("app.services.llm_gateway.call_open_chat_llm", fake_llm)
    out = await post_writer.write_post_batch([{"key": "a", "plan": "closing faster", "channel": "x"}], company_name="Acme",
                                             company_context="Brand voice:\nTone: Dry humour")
    assert "X (Twitter)" in seen["system"] and "Tone: Dry humour" in seen["system"]
    assert out["a"]["x_copy"].startswith("Short sharp tweet") and len(out["a"]["x_copy"]) <= 280


async def test_brand_voice_is_saved_and_reaches_the_writer(client, db):
    from app.core.tenancy import org_scope
    from app.services.generation_queue import _company

    r = await client.put("/api/scheduler/brand-voice", json={"tone": "Warm", "audience": "Bakers", "never": "Emojis",
                                                             "samples": ["Example one", "", "Two", "Three", "Four"]})
    assert r.status_code == 200 and r.json()["samples"] == ["Example one", "Two", "Three"]
    assert (await client.get("/api/scheduler/brand-voice")).json()["audience"] == "Bakers"
    with org_scope("org_default"):
        ctx = (await _company(db))["context"]
    assert "Tone: Warm" in ctx and "Never: Emojis" in ctx and "Example one" in ctx


def test_chat_history_keeps_30_turns_once_each():
    from app.api.scheduler import _chat_history

    msgs = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"} for i in range(40)]
    out = _chat_history(msgs + [{"role": "user", "content": "plan May"}, {"role": "user", "content": "For 2026-05-01 on linkedin only: plan May"}], "")
    assert len(out) <= 30 and out[0]["role"] == "user"
    assert out[-1]["content"] == "For 2026-05-01 on linkedin only: plan May" and out[-2]["content"] != "plan May"


async def test_plan_ai_uses_voice_links_and_answers_at_length(client, db, monkeypatch):
    await _keys(db, [("c_plat_openai2", "org_outreach", "LLM", "OpenAI", "sk-platform-1234567890")])
    await _choose(db, textProvider="openai", textModel="gpt-test")
    await client.put("/api/scheduler/brand-voice", json={"tone": "Plain and warm"})
    seen = {}
    long_answer = "Here is a content strategy for you. " * 60

    async def fake_llm(**kw):
        seen.update(kw)
        return {"success": True, "reply": long_answer}

    async def fake_fetch(url, max_chars=6000):
        return "Our blog", "Five ways to close the month in three days."

    monkeypatch.setattr("app.services.llm_gateway.call_open_chat_llm", fake_llm)
    monkeypatch.setattr("app.services.safe_fetch.fetch_text", fake_fetch)
    body = (await client.post("/api/scheduler/chat-plan", json={"messages": [
        {"role": "user", "content": "What should we post? Use https://example.com/blog"}]})).json()
    assert "Tone: Plain and warm" in seen["system_prompt"]
    assert "Five ways to close the month" in seen["system_prompt"]
    assert len(body["reply"]) > 1500  # strategy answers are no longer cut to a few sentences


async def test_links_to_private_addresses_are_never_read():
    from app.services.safe_fetch import FetchRefused, fetch_text, urls_in

    assert urls_in("see https://a.com/x, and http://b.org.") == ["https://a.com/x", "http://b.org"]
    for bad in ("http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "http://localhost:8000/api",
                "ftp://example.com/file", "http://example.com:2375/", "http://user:pw@example.com/"):
        with pytest.raises(FetchRefused):
            await fetch_text(bad)


async def test_saved_chats_are_shared_with_the_team_only(client, db):
    _, other = await make_user(db, "beta_planner", "Admin", org_id="org_beta")
    msgs = [{"id": "u1", "who": "user", "text": "Plan May"}, {"id": "a1", "who": "ai", "text": "Done.", "evil": "<x>"}]
    r = await client.put("/api/scheduler/chat-threads/t_1", json={"title": "May plan", "messages": msgs})
    assert r.status_code == 200 and r.json()["messages"][1] == {"id": "a1", "who": "ai", "text": "Done."}
    assert [t["title"] for t in (await client.get("/api/scheduler/chat-threads")).json()] == ["May plan"]
    assert (await client.put("/api/scheduler/chat-threads/bad id!", json={})).status_code in (400, 404)
    async with _as(other) as c:
        assert (await c.get("/api/scheduler/chat-threads")).json() == []
        await c.delete("/api/scheduler/chat-threads/t_1")  # cannot touch another company's chat
    assert len((await client.get("/api/scheduler/chat-threads")).json()) == 1
    await client.delete("/api/scheduler/chat-threads/t_1")
    assert (await client.get("/api/scheduler/chat-threads")).json() == []
