import os
import pytest
from app.services.credits import DEFAULT_RATES
from app.services import voice_assistants as VA
from app.services import platform_ai
from app.models.models import OrgPhoneNumber
from app.services.telnyx_client import TelnyxClient


def test_voice_assistants_enabled_for_org(monkeypatch):
    monkeypatch.setenv("TELNYX_MANAGED_ASSISTANTS", "true")
    assert VA.enabled() is True
    assert VA.enabled_for_org("org_default") is False  # Aivhub/platform org excluded
    assert VA.enabled_for_org("client_org_123") is True


def test_number_setup_rate_card():
    assert "number_setup" in DEFAULT_RATES
    assert DEFAULT_RATES["number_setup"]["credits"] == 5
    assert DEFAULT_RATES["number_setup"]["wallet"] == "voice"
    assert DEFAULT_RATES["number_setup"]["charged"] is True


def test_phone_number_model_rent_due_at():
    assert hasattr(OrgPhoneNumber, "rent_due_at")


def test_platform_ai_scope_keys():
    assert platform_ai._key_for("scheduler") == "platform_ai"
    assert platform_ai._key_for("voice") == "platform_ai_voice"
    assert platform_ai._key_for("leadgen") == "platform_ai_leadgen"
    assert platform_ai._health_key_for("scheduler") == "platform_ai_health"
    assert platform_ai._health_key_for("voice") == "platform_ai_voice_health"
    assert platform_ai._health_key_for("leadgen") == "platform_ai_leadgen_health"


def test_telnyx_client_update_outbound_voice_profile():
    client = TelnyxClient("dummy_key")
    assert hasattr(client, "update_outbound_voice_profile")
