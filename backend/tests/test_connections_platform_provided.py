"""The Leads Connectors screen lists ChatGPT (OpenAI), DeepSeek, Tavily and Apollo with where each key comes from."""
import httpx
import pytest

from app.core.platform import platform_org_id
from app.core.tenancy import org_scope
from app.main import app
from app.models.models import Connection
from app.services.secret_box import seal_config
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


def _row(id_, group, name, key, org):
    return Connection(id=id_, group_name=group, name=name, status="connected", org_id=org,
                      api_key_masked="sk-••••" + key[-4:], config=seal_config({"api_key": key, "auth_token": key, "provider": name}))


async def test_each_provider_reads_own_platform_or_none(db, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    monkeypatch.delenv("APOLLO_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    from app.config import settings

    for attr in ("OPENAI_API_KEY", "TAVILY_API_KEY", "DEEPSEEK_API_KEY"):
        monkeypatch.setattr(settings, attr, "", raising=False)
    platform = platform_org_id()
    _, token = await make_user(db, "keys_admin", "Admin", org_id="org_default")
    with org_scope(platform):
        db.add(_row("c_plat_tavily", "Business Discovery", "Tavily", "tvly-platform-1234", platform))
        db.add(_row("c_plat_deepseek", "LLM", "DeepSeek", "sk-platform-5678", platform))
        await db.commit()
    with org_scope("org_default"):
        db.add(_row("c_own_deepseek", "LLM", "DeepSeek", "sk-own-9999", "org_default"))
        await db.commit()

    async with _client(token) as c:
        res = await c.get("/api/connections/platform-provided")
    assert res.status_code == 200
    body = res.json()
    assert body == {"openai": "none", "deepseek": "own", "tavily": "platform", "apollo": "none"}
    assert "sk-" not in res.text and "tvly" not in res.text
