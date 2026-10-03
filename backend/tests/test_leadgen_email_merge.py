import pytest
from app.services.credits import WALLETS, DEFAULT_RATES, starter_credits
from app.services.platform_balances import NON_POLLABLE_DEFAULTS, get_telnyx_live_balance, get_deepseek_live_balance


def test_rate_card_leadgen_email_merge():
    """Verify that email_send is billable and in the leadgen wallet."""
    assert "email" not in WALLETS
    assert "leadgen" in WALLETS
    assert DEFAULT_RATES["email_send"]["wallet"] == "leadgen"
    assert DEFAULT_RATES["email_send"]["charged"] is True
    assert DEFAULT_RATES["lead_lookup"]["wallet"] == "leadgen"
    assert DEFAULT_RATES["lead_lookup"]["charged"] is True


def test_starter_credits_is_zero_by_default():
    """Verify that by default no free trial starter credits are granted."""
    assert starter_credits() == 0


def test_platform_balance_non_pollable_defaults():
    """Verify checklist of non-pollable providers."""
    ids = [p["id"] for p in NON_POLLABLE_DEFAULTS]
    for required in ("openai", "anthropic", "groq", "xai", "elevenlabs", "deepgram", "cartesia", "calcom"):
        assert required in ids


@pytest.mark.asyncio
async def test_live_balances_graceful_error_handling():
    """Verify that live balance queries handle unconfigured or invalid keys gracefully."""
    # When keys are missing/dummy, functions return structured error/status dicts rather than raising unhandled exceptions
    telnyx_res = await get_telnyx_live_balance()
    assert isinstance(telnyx_res, dict)
    assert "status" in telnyx_res

    deepseek_res = await get_deepseek_live_balance()
    assert isinstance(deepseek_res, dict)
    assert "status" in deepseek_res
