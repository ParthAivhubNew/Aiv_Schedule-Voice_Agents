"""Integration tests for Cold Email, Warmup, DNS Verifier, and Waterfall Enrichment."""
import pytest
from app.services.dns_verifier import verify_domain_dns
from app.services.enrichment_waterfall import classify_pecr_entity
from app.services.email_warmup_engine import compute_ramp_schedule, plan_mailbox_day, MailboxState


def test_pecr_entity_classification():
    """Verify UK PECR B2B entity classification logic."""
    assert classify_pecr_entity("Acme Logistics Ltd", "john@acme.co.uk") == "corporate"
    assert classify_pecr_entity("Global Tech PLC", "cto@globaltech.com") == "corporate"
    assert classify_pecr_entity("Baker & Partners LLP", "sarah@bakerlaw.co.uk") == "corporate"
    assert classify_pecr_entity("John Smith Carpentry", "johnsmith@gmail.com") == "individual"
    assert classify_pecr_entity("", "jane.doe@yahoo.com") == "individual"
    assert classify_pecr_entity("", "") == "unknown"


@pytest.mark.asyncio
async def test_dns_verifier_structure():
    """Verify DNS verifier returns the expected dictionary structure and recommendations."""
    res = await verify_domain_dns("example.com")
    assert "domain" in res
    assert "spf_verified" in res
    assert "dkim_verified" in res
    assert "dmarc_verified" in res
    assert "mx_verified" in res
    assert "recommendations" in res
    assert isinstance(res["recommendations"], list)


def test_warmup_monotonicity():
    """Verify daily cap always increments smoothly without cliffs."""
    schedule = compute_ramp_schedule(max_target=40, total_days=28)
    for i in range(len(schedule) - 1):
        assert schedule[i] <= schedule[i + 1]
        assert (schedule[i + 1] - schedule[i]) <= 10
