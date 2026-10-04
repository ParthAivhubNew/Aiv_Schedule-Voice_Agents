"""One AI stack for every company, run by OutReach: only the platform record's keys are used,
a chosen provider is never swapped for another one, the backup is used when the main fails,
and companies never see which AI or which error the provider gave."""
import json

import pytest

from tests.conftest import make_staff

pytestmark = pytest.mark.db

ENV_KEYS = ("OPENAI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "TELNYX_API_KEY")


@pytest.fixture(autouse=True)
def _no_env_keys(monkeypatch):
    for k in ENV_KEYS:
        monkeypatch.delenv(k, raising=False)


async def _keys(db, rows):
    """rows: (id, org, group, name, key)."""
    from sqlalchemy import text

    from app.core.tenancy import system_scope

    with system_scope():
        await _insert(db, rows)


async def _insert(db, rows):
    from sqlalchemy import text

    await db.execute(text(
        "INSERT INTO organizations (id, name, slug, status) VALUES ('org_outreach', 'OutReach platform', 'outreach', 'platform') "
        "ON CONFLICT (id) DO NOTHING"))
    for cid, org, group, name, key in rows:
        await db.execute(text(
            "INSERT INTO connections (id, org_id, group_name, name, status, config) VALUES (:i, :o, :g, :n, 'connected', :c)"),
            {"i": cid, "o": org, "g": group, "n": name, "c": json.dumps({"api_key": key, "provider": name.lower()})})
    await db.commit()


async def _choose(db, **fields):
    from app.services import platform_ai

    await platform_ai.put(db, fields)
    await db.commit()


async def test_only_outreachs_keys_are_used_and_never_swapped(db):
    from app.services.llm_gateway import resolve_llm_credentials

    await _keys(db, [
        ("c_plat_openai", "org_outreach", "LLM", "OpenAI", "sk-platform-1234567890"),
        ("c_own_openai", "org_default", "LLM", "OpenAI", "sk-company-own-123456"),
        ("c_own_groq", "org_default", "LLM", "Groq", "gsk-company-own-12345"),
    ])
    creds = await resolve_llm_credentials(db=db, provider="openai")
    assert creds["api_key"] == "sk-platform-1234567890"
    # The company's own Groq key is never used, and OpenAI is not used in Groq's place.
    creds = await resolve_llm_credentials(db=db, provider="groq")
    assert creds["api_key"] == "" and creds["provider"] == "groq"


async def test_a_chosen_image_engine_without_a_key_is_an_error_not_the_free_engine(db, monkeypatch):
    from app.services.post_writer import generate_image_with_provider

    await _keys(db, [("c_own_fal", "org_default", "IMAGE", "fal", "fal-company-own-1234")])

    def no_network(*a, **k):
        raise AssertionError("no image service may be called")

    monkeypatch.setattr("app.services.post_writer.generate_image_url", no_network)
    img = await generate_image_with_provider(prompt="a van", provider="fal", db=db)
    assert img["status"] == "error" and img["imageUrl"] is None and img["fallback"] is False


async def test_backup_is_used_when_the_main_fails_and_health_is_recorded(db):
    from app.services import platform_ai

    await _keys(db, [
        ("c_plat_openai", "org_outreach", "LLM", "OpenAI", "sk-platform-1234567890"),
        ("c_plat_deepseek", "org_outreach", "LLM", "DeepSeek", "sk-deepseek-123456789"),
    ])
    await _choose(db, textProvider="openai", textBackupProvider="deepseek")
    tried = []

    async def attempt(slot):
        tried.append(slot)
        if slot == "main":
            raise platform_ai.AIUnavailable("openai 503")
        return "written"

    assert await platform_ai.run_with_backup(db, "text", attempt) == "written"
    assert tried == ["main", "backup"]
    health = await platform_ai.health(db)
    assert health["text"]["main"]["lastError"] == "openai 503" and health["text"]["backup"]["lastOkAt"]

    # No backup set: the main's error stands.
    await _choose(db, textBackupProvider="")
    tried.clear()
    with pytest.raises(platform_ai.AIUnavailable):
        await platform_ai.run_with_backup(db, "text", attempt)
    assert tried == ["main"]


async def test_plan_ai_falls_back_to_the_backup_and_hides_provider_names(client, db, monkeypatch):
    await _keys(db, [
        ("c_plat_openai", "org_outreach", "LLM", "OpenAI", "sk-platform-1234567890"),
        ("c_plat_deepseek", "org_outreach", "LLM", "DeepSeek", "sk-deepseek-123456789"),
    ])
    await _choose(db, textProvider="openai", textModel="gpt-test", textBackupProvider="deepseek")
    calls = []

    async def fake_llm(**kw):
        calls.append(kw["provider"])
        if kw["provider"] == "openai":
            return {"success": False, "error": "openai: insufficient_quota", "reply": ""}
        return {"success": True, "reply": "Here is your plan.", "provider": "deepseek", "model": "deepseek-chat"}

    monkeypatch.setattr("app.services.llm_gateway.call_open_chat_llm", fake_llm)
    # Whatever the request asks for is ignored.
    r = await client.post("/api/scheduler/chat-plan", json={"text": "Plan a week", "provider": "groq", "apiKey": "sk-mine"})
    body = r.json()
    assert r.status_code == 200 and body["status"] == "ok" and calls == ["openai", "deepseek"]
    text = json.dumps(body).lower()
    assert "deepseek" not in text and "openai" not in text and "provider" not in body

    # Both fail: a plain message, no provider error text.
    async def broken(**kw):
        return {"success": False, "error": f"{kw['provider']}: invalid api key", "reply": ""}

    monkeypatch.setattr("app.services.llm_gateway.call_open_chat_llm", broken)
    body = (await client.post("/api/scheduler/chat-plan", json={"text": "Plan a week"})).json()
    assert body["status"] == "error" and body["error"] == "ai_unavailable"
    assert "invalid api key" not in json.dumps(body).lower()


async def test_staff_test_button_shows_the_real_error(db, monkeypatch):
    import httpx

    from app.main import app

    await _keys(db, [("c_plat_openai", "org_outreach", "LLM", "OpenAI", "sk-platform-1234567890")])
    await _choose(db, textProvider="openai")

    async def broken(**kw):
        return {"success": False, "error": "401 invalid api key", "reply": ""}

    monkeypatch.setattr("app.services.llm_gateway.call_open_chat_llm", broken)
    token = await make_staff(db)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                 headers={"Authorization": f"Bearer {token}"}) as staff:
        r = (await staff.post("/api/admin-api/platform-ai/test", json={"kind": "text", "slot": "main"})).json()
        assert r["ok"] is False and "invalid api key" in r["error"]
        health = (await staff.get("/api/admin-api/platform-ai")).json()["health"]
        assert "invalid api key" in health["text"]["main"]["lastError"]


async def test_company_ai_keys_are_switched_off_and_aivhubs_move_to_outreach(db):
    from sqlalchemy import text

    from app.core.migrations import _ai_keys_owner_only
    from app.core.tenancy import system_scope
    from app.database import engine

    await _keys(db, [
        ("c_plat_openai", "org_outreach", "LLM", "OpenAI", "sk-platform-1234567890"),
        ("c_aiv_openai", "org_default", "LLM", "OpenAI", "sk-aivhub-dupe-123456"),
        ("c_aiv_fal", "org_default", "IMAGE", "fal", "fal-aivhub-123456789"),
        ("c_aiv_cal", "org_default", "Calendar", "Cal.com", "cal-key-1234567890"),
    ])
    async with engine.begin() as conn:
        await _ai_keys_owner_only(conn)
    with system_scope():
        rows = {r[0]: (r[1], r[2]) for r in (await db.execute(text("SELECT id, org_id, status FROM connections"))).all()}
    assert rows["c_aiv_fal"] == ("org_outreach", "connected")  # moved to OutReach
    assert rows["c_aiv_openai"] == ("org_default", "disabled_by_platform")  # OutReach already has one
    assert rows["c_plat_openai"] == ("org_outreach", "connected")
    assert rows["c_aiv_cal"] == ("org_default", "connected")  # not an AI key
