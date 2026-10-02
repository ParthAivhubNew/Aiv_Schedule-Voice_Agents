"""Unit tests for the cold email warmup and deliverability engine."""
import pytest
from app.services.email_warmup_engine import (
    MailboxState,
    DayLog,
    compute_ramp_schedule,
    plan_mailbox_day,
    BOUNCE_PAUSE_THRESHOLD,
)


def test_ramp_schedule_smoothness_and_target():
    """Verify that the 28-day ramp schedule never makes abrupt volume spikes."""
    schedule = compute_ramp_schedule(max_target=40, total_days=28)
    assert len(schedule) == 28
    assert schedule[0] == 5
    assert schedule[-1] == 40
    
    # Check monotonicity and max daily increase
    for i in range(1, len(schedule)):
        assert schedule[i] >= schedule[i - 1], f"Day {i+1} dropped below previous day"
        daily_jump = schedule[i] - schedule[i - 1]
        assert daily_jump <= 10, f"Day {i+1} jumped by {daily_jump}, which exceeds safety limit"


def test_plan_mailbox_day_first_day():
    """First day of warming starts with low warmup sends only."""
    mb = MailboxState(id="mb_1", email="test@domain.com", status="warming", consecutive_healthy_days=0)
    decision = plan_mailbox_day(mb, recent_logs=[])
    
    assert decision["action"] == "send"
    assert decision["new_status"] == "warming"
    assert decision["daily_cap"] == 5
    assert decision["warmup_sends"] == 5
    assert decision["campaign_sends"] == 0
    assert decision["consecutive_healthy_days"] == 1


def test_plan_mailbox_day_graduation():
    """Mailbox graduates after 21 healthy days and reaching max target."""
    mb = MailboxState(
        id="mb_1",
        email="test@domain.com",
        status="warming",
        daily_cap=40,
        max_daily_target=40,
        consecutive_healthy_days=21,
    )
    logs = [DayLog(date=f"2026-09-{i:02d}", sent_count=35, bounced_count=0) for i in range(1, 8)]
    decision = plan_mailbox_day(mb, recent_logs=logs)
    
    assert decision["action"] == "send"
    assert decision["new_status"] == "graduated"
    assert decision["daily_cap"] == 40
    assert decision["campaign_sends"] > 0
    assert decision["warmup_sends"] >= 3


def test_plan_mailbox_day_auto_pause_on_high_bounces():
    """Bounce rate of 2% or higher over 7 days triggers immediate auto-pause."""
    mb = MailboxState(id="mb_1", email="test@domain.com", status="warming", consecutive_healthy_days=10)
    # 50 sends with 2 bounces = 4.0% bounce rate (> 2.0% threshold)
    logs = [DayLog(date="2026-09-01", sent_count=50, bounced_count=2)]
    decision = plan_mailbox_day(mb, recent_logs=logs)
    
    assert decision["action"] == "pause"
    assert decision["new_status"] == "paused"
    assert decision["daily_cap"] == 0
    assert "High bounce rate" in decision["pause_reason"]
    assert decision["consecutive_healthy_days"] == 0


def test_plan_mailbox_day_disabled_state():
    """Disabled mailboxes should not send anything."""
    mb = MailboxState(id="mb_1", email="test@domain.com", status="disabled", pause_reason="User disabled")
    decision = plan_mailbox_day(mb, recent_logs=[])
    
    assert decision["action"] == "skip"
    assert decision["new_status"] == "disabled"
    assert decision["daily_cap"] == 0
