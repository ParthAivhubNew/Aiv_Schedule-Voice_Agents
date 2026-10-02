"""Pure deterministic warmup and deliverability decision engine.

No database or network code is contained here, ensuring 100% testability.
Controls smooth daily ramp-ups, graduation, and safety pause guards.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class MailboxState:
    id: str
    email: str
    status: str  # connected, warming, graduated, active, paused, error, disabled
    daily_cap: int = 5
    max_daily_target: int = 40
    warmup_started_at: Optional[datetime] = None
    graduated_at: Optional[datetime] = None
    consecutive_healthy_days: int = 0
    bounce_rate_7d: float = 0.0
    pause_reason: str = ""


@dataclass
class DayLog:
    date: str  # YYYY-MM-DD
    sent_count: int = 0
    warmup_sent_count: int = 0
    campaign_sent_count: int = 0
    bounced_count: int = 0
    complaint_count: int = 0
    reply_count: int = 0


# ── Ramp Curve Generator (Max +20% / day, default 40 max) ─────────────────────

def compute_ramp_schedule(max_target: int = 40, total_days: int = 28) -> List[int]:
    """Generates a smooth monotonic daily send cap ramp curve.
    
    Guarantees:
    - Never jumps by more than 20% or 10 emails in a single day.
    - Reaches max_target gradually by day 28.
    """
    if max_target <= 5:
        return [max_target] * total_days

    schedule = [5]  # Day 1 start
    for day in range(1, total_days):
        prev = schedule[-1]
        if prev >= max_target:
            schedule.append(max_target)
            continue
        
        # Max +20% or +2 min increment
        step = max(2, int(prev * 0.20))
        # Ensure smooth distribution towards target
        remaining_days = total_days - day
        needed_increase = max_target - prev
        day_inc = max(step, int(needed_increase / max(1, remaining_days)))
        
        nxt = min(max_target, prev + day_inc)
        schedule.append(nxt)
    
    return schedule


# ── Core Pure Decision Engine ──────────────────────────────────────────────────

BOUNCE_PAUSE_THRESHOLD = 0.02  # 2.0% bounce rate triggers auto-pause
MIN_SENDS_FOR_RATE_CHECK = 10  # Don't evaluate bounce rate on negligible volume
GRADUATION_HEALTHY_DAYS = 21   # 21 continuous healthy days to graduate


def plan_mailbox_day(
    mailbox: MailboxState,
    recent_logs: List[DayLog],
    target_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Decides the sending schedule, daily cap, and status for a mailbox for a given day.
    
    Returns:
        {
            "action": "send" | "pause" | "skip",
            "new_status": str,
            "daily_cap": int,
            "warmup_sends": int,
            "campaign_sends": int,
            "pause_reason": str,
            "consecutive_healthy_days": int,
            "bounce_rate_7d": float,
        }
    """
    # 1. Disabled or hard-errored mailboxes do not send
    if mailbox.status in ("disabled", "error"):
        return {
            "action": "skip",
            "new_status": mailbox.status,
            "daily_cap": 0,
            "warmup_sends": 0,
            "campaign_sends": 0,
            "pause_reason": mailbox.pause_reason,
            "consecutive_healthy_days": mailbox.consecutive_healthy_days,
            "bounce_rate_7d": mailbox.bounce_rate_7d,
        }

    # 2. Calculate rolling 7-day health metrics
    last_7_logs = recent_logs[-7:] if recent_logs else []
    total_7d_sends = sum(l.sent_count for l in last_7_logs)
    total_7d_bounces = sum(l.bounced_count for l in last_7_logs)
    
    bounce_rate = (total_7d_bounces / total_7d_sends) if total_7d_sends >= MIN_SENDS_FOR_RATE_CHECK else 0.0

    # 3. Health Guard: Auto-pause if bounce rate exceeds threshold
    if bounce_rate >= BOUNCE_PAUSE_THRESHOLD:
        return {
            "action": "pause",
            "new_status": "paused",
            "daily_cap": 0,
            "warmup_sends": 0,
            "campaign_sends": 0,
            "pause_reason": f"High bounce rate ({bounce_rate * 100:.1f}% >= 2.0%) over past 7 days.",
            "consecutive_healthy_days": 0,
            "bounce_rate_7d": round(bounce_rate, 4),
        }

    # If previously paused for bounce rate, keep paused until explicitly resumed
    if mailbox.status == "paused":
        return {
            "action": "skip",
            "new_status": "paused",
            "daily_cap": 0,
            "warmup_sends": 0,
            "campaign_sends": 0,
            "pause_reason": mailbox.pause_reason or "Mailbox is paused.",
            "consecutive_healthy_days": mailbox.consecutive_healthy_days,
            "bounce_rate_7d": round(bounce_rate, 4),
        }

    # 4. Healthy Day Accumulation
    healthy_days = mailbox.consecutive_healthy_days + 1
    ramp = compute_ramp_schedule(mailbox.max_daily_target, total_days=28)
    
    # 5. Determine State Transitions & Volume Allocation
    if mailbox.status in ("connected", "warming"):
        current_day_index = min(healthy_days - 1, len(ramp) - 1)
        current_cap = ramp[max(0, current_day_index)]
        
        # Check graduation
        if healthy_days >= GRADUATION_HEALTHY_DAYS and current_cap >= mailbox.max_daily_target:
            new_status = "graduated"
            # Graduated mailboxes: 80% campaign outreach, 20% ongoing seed warmup maintenance
            warmup_sends = max(3, int(current_cap * 0.20))
            campaign_sends = current_cap - warmup_sends
        else:
            new_status = "warming"
            # During warmup: early days 100% warmup, transitioning gradually to real sends
            if healthy_days <= 7:
                warmup_sends = current_cap
                campaign_sends = 0
            elif healthy_days <= 14:
                warmup_sends = int(current_cap * 0.6)
                campaign_sends = current_cap - warmup_sends
            else:
                warmup_sends = int(current_cap * 0.3)
                campaign_sends = current_cap - warmup_sends

    elif mailbox.status in ("graduated", "active"):
        new_status = "active"
        current_cap = mailbox.max_daily_target
        warmup_sends = max(3, int(current_cap * 0.20))
        campaign_sends = current_cap - warmup_sends
    else:
        new_status = mailbox.status
        current_cap = mailbox.daily_cap
        warmup_sends = 0
        campaign_sends = 0

    return {
        "action": "send",
        "new_status": new_status,
        "daily_cap": current_cap,
        "warmup_sends": warmup_sends,
        "campaign_sends": campaign_sends,
        "pause_reason": "",
        "consecutive_healthy_days": healthy_days,
        "bounce_rate_7d": round(bounce_rate, 4),
    }
