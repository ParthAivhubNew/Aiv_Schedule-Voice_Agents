"""A client organisation can save its own keys, and its own key is the one its calls use. Other organisations never see it."""
import pytest

from app.api import own_keys as K
from app.core.tenancy import org_scope
from app.database import AsyncSessionLocal
from app.services import enrichment_service as E, tavily_pool
from app.services.llm_gateway import resolve_llm_credentials

pytestmark = pytest.mark.db


async def _save(org, name, cfg, secret):
    with org_scope(org):
        async with AsyncSessionLocal() as s:
            await K._save(s, name, cfg, secret)


async def test_own_key_is_used_by_its_organisation_only():
    await _save("org_default", "Tavily", {"provider": "Tavily", "api_key": "tvly-own-9999"}, "tvly-own-9999")
    with org_scope("org_default"):
        assert await E.own_key("tavily") == "tvly-own-9999"
        assert await E.tavily_key() == "tvly-own-9999"
        assert [k[2] for k in await tavily_pool.keys()] == ["tvly-own-9999"]
    with org_scope("org_other_no_key"):
        assert await E.own_key("tavily") == ""


async def test_chat_ai_prefers_the_organisations_own_key_for_the_provider_it_asks_for():
    await _save("org_default", "DeepSeek", {"provider": "DeepSeek", "api_key": "sk-own-8888"}, "sk-own-8888")
    with org_scope("org_default"):
        got = await resolve_llm_credentials(provider="deepseek", scope="leadgen")
    assert got["api_key"] == "sk-own-8888" and got["provider"] == "deepseek"


async def test_market_location_is_saved_untested_and_secrets_are_not_listed():
    with org_scope("org_default"):
        async with AsyncSessionLocal() as s:
            res = await K.save_data_provider("market_location", K.DataProviderRequest(fields={"base_url": "https://api.example.com", "api_key": "abcd1234"}), s)
            status = await K.status(s)
            await K.remove_data_provider("market_location", s)
            after = await K.status(s)
    assert res["verified"] is False
    assert status["data"]["market_location"]["connected"] is True
    assert "abcd1234" not in str(status)
    assert after["data"]["market_location"]["connected"] is False
