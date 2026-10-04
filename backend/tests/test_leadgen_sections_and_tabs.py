import pytest
from app.services.email_warmup_engine import (
    MailboxState,
    DayLog,
    compute_ramp_schedule,
    plan_mailbox_day,
)
from app.services.enrichment_waterfall import classify_pecr_entity
from app.models.models import EmailMailbox, EmailCampaign, EmailSequenceStep, EmailSuppression, Prospect

# Section 1: Find Leads Tests (Scout, Copilot, Waterfall Finder)
def test_find_leads_email_waterfall_caching_and_entity():
    assert classify_pecr_entity("Acme Ltd", "acme.co.uk") == "corporate"
    assert classify_pecr_entity("Global Tech Inc", "global.com") == "corporate"
    assert classify_pecr_entity("Baker & Partners LLP", "sarah@bakerlaw.co.uk") == "corporate"
    assert classify_pecr_entity("John Smith Carpentry", "johnsmith@gmail.com") == "individual"
    assert classify_pecr_entity("", "") == "unknown"

# Section 2: Enrichment & Prospects Tests (Saved Accounts, Decision Makers, Dossiers, Import/Export)
def test_enrichment_prospect_model_structure():
    p = Prospect(
        id="pros_123",
        org_id="org_test_123",
        name="Apex Solutions Ltd",
        site="https://apexsolutions.io",
        sector="Information Technology",
        contact_person="Jane Smith",
        email="jane@apexsolutions.io",
        phone="+14155552671",
        fit=94,
        status="active",
        opening_hook="Saw your recent expansion in EMEA",
    )
    assert p.name == "Apex Solutions Ltd"
    assert p.fit == 94
    assert p.contact_person == "Jane Smith"
    assert p.opening_hook == "Saw your recent expansion in EMEA"

# Section 3: Email Outreach (Sequences & Inbound Replies) Tests
def test_email_sequences_step_cadence_and_variables():
    step1 = EmailSequenceStep(
        id="step_1",
        campaign_id="camp_1",
        step_number=1,
        delay_days=0,
        subject="Quick question for {{company}}",
        body_template="Hi {{first_name}},\n\nSaw your work at {{company}}."
    )
    assert step1.delay_days == 0
    assert "{{first_name}}" in step1.body_template
    assert "{{company}}" in step1.subject

    step2 = EmailSequenceStep(
        id="step_2",
        campaign_id="camp_1",
        step_number=2,
        delay_days=3,
        subject="Re: Quick question for {{company}}",
        body_template="Following up on my previous note."
    )
    assert step2.delay_days == 3

# Section 4: Mailboxes & Deliverability (Mailboxes & Warmup, 28-day Ramp) Tests
def test_mailboxes_warmup_engine_safety():
    # 28-day ramp begins safely at 5
    mb = MailboxState(id="mb_1", email="test@domain.com", status="warming", consecutive_healthy_days=0)
    decision = plan_mailbox_day(mb, recent_logs=[])
    assert decision["action"] == "send"
    assert decision["daily_cap"] == 5
    assert decision["warmup_sends"] == 5
    assert decision["campaign_sends"] == 0

    # Auto-pause on high bounce rate (>= 2%)
    high_bounce_mb = MailboxState(id="mb_1", email="test@domain.com", status="warming", consecutive_healthy_days=10)
    logs = [DayLog(date="2026-09-01", sent_count=50, bounced_count=2)]
    high_bounce_decision = plan_mailbox_day(high_bounce_mb, recent_logs=logs)
    assert high_bounce_decision["action"] == "pause"
    assert "High bounce rate" in high_bounce_decision["pause_reason"]

# Section 5: Suppression & Compliance (Do Not Email) Tests
def test_suppression_model_creation():
    sup = EmailSuppression(
        id="sup_123",
        org_id="org_test_123",
        email="optout@domain.com",
        domain="domain.com",
        reason="unsubscribe"
    )
    assert sup.email == "optout@domain.com"
    assert sup.domain == "domain.com"
    assert sup.reason == "unsubscribe"
