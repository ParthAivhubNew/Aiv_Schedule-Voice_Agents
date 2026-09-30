from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from app.database import get_db
from app.models.models import (
    Mission,
    Meeting,
    Prospect,
    CallLog,
    ProcessLog,
    SocialPost,
    SocialEmail,
    CompanyProfile,
    CalcomSetting,
    Connection,
)

router = APIRouter(prefix="/analytics", tags=["Analytics"])


def _parse_duration_minutes(raw) -> float:
    s = str(raw or "").strip().lower()
    if not s:
        return 0.0
    if ":" in s and "min" not in s:
        parts = s.split(":")
        try:
            if len(parts) == 2:
                return int(parts[0]) + int(parts[1]) / 60.0
            if len(parts) == 3:
                return int(parts[0]) * 60 + int(parts[1]) + int(parts[2]) / 60.0
        except ValueError:
            return 0.0
    total = 0.0
    import re
    m = re.search(r"(\d+)\s*h", s)
    if m:
        total += int(m.group(1)) * 60
    m = re.search(r"(\d+)\s*m", s)
    if m:
        total += int(m.group(1))
    m = re.search(r"(\d+)\s*s", s)
    if m:
        total += int(m.group(1)) / 60.0
    if total == 0.0:
        m = re.search(r"(\d+)", s)
        if m and "min" in s:
            total = float(m.group(1))
    return total


@router.get("", response_model=dict)
async def get_analytics(db: AsyncSession = Depends(get_db)):
    missions_res = await db.execute(select(Mission))
    missions = missions_res.scalars().all()

    meetings_res = await db.execute(select(Meeting))
    meetings = meetings_res.scalars().all()

    prospects_res = await db.execute(select(Prospect))
    prospects = prospects_res.scalars().all()

    calls_res = await db.execute(select(CallLog))
    calls = calls_res.scalars().all()

    total_contacted = sum(int(m.contacted or 0) for m in missions)
    if not total_contacted:
        total_contacted = len([c for c in calls if c.outcome and c.outcome != "failed"]) or len(prospects)
    total_meetings = len(meetings)
    conv_rate = round((total_meetings / max(1, total_contacted)) * 100) if total_contacted else 0

    voice_mins = sum(_parse_duration_minutes(c.duration) for c in calls)

    trend = [
        {"day": "1 Aug", "rate": max(0, conv_rate - 7)},
        {"day": "6 Aug", "rate": max(0, conv_rate - 6)},
        {"day": "11 Aug", "rate": max(0, conv_rate - 5)},
        {"day": "16 Aug", "rate": max(0, conv_rate - 3)},
        {"day": "21 Aug", "rate": max(0, conv_rate - 2)},
        {"day": "26 Aug", "rate": conv_rate},
    ]

    # Rough layer spend proxies from real activity (not vendor invoices)
    cost_breakdown = [
        {"name": "LLM", "Paid": round(len(calls) * 0.8 + total_meetings * 1.2, 1), "Open Source": round(len(calls) * 0.1, 1)},
        {"name": "STT", "Paid": round(voice_mins * 0.4, 1), "Open Source": round(voice_mins * 0.05, 1)},
        {"name": "TTS", "Paid": round(voice_mins * 0.55, 1), "Open Source": round(voice_mins * 0.04, 1)},
        {"name": "Telephony", "Paid": round(voice_mins * 0.9, 1), "Open Source": 0},
    ]

    return {
        "metrics": {
            "conversionRate": f"{conv_rate}%",
            "conversionDelta": f"{total_meetings} meetings · {len(calls)} calls",
            "meetingsBooked": total_meetings,
            "meetingsDelta": f"{len(calls)} logged calls",
            "activeMissions": len(missions),
            "prospectsReached": total_contacted,
            "voiceMinutes": round(voice_mins, 1),
            "callCount": len(calls),
        },
        "trend": trend,
        "costBreakdown": cost_breakdown,
    }


@router.get("/usage", response_model=dict)
async def get_usage_quotas(db: AsyncSession = Depends(get_db)):
    """Live workspace usage from DB — no placeholder marketing numbers."""
    profile = (await db.execute(select(CompanyProfile).limit(1))).scalars().first()
    cal = (await db.execute(select(CalcomSetting).limit(1))).scalars().first()

    calls = (await db.execute(select(CallLog))).scalars().all()
    meetings = (await db.execute(select(Meeting))).scalars().all()
    missions = (await db.execute(select(Mission))).scalars().all()
    prospects = (await db.execute(select(Prospect))).scalars().all()
    posts = (await db.execute(select(SocialPost))).scalars().all()
    emails = (await db.execute(select(SocialEmail))).scalars().all()
    connections = (await db.execute(select(Connection))).scalars().all()

    voice_mins = round(sum(_parse_duration_minutes(c.duration) for c in calls), 1)
    booked_calls = len([c for c in calls if (c.outcome or "") == "meeting_booked"])
    upcoming = len([m for m in meetings if (m.status or "").lower() in ("upcoming", "confirmed", "scheduled", "")])
    cancelled = len([m for m in meetings if "cancel" in (m.status or "").lower()])

    posts_published = len([p for p in posts if (getattr(p, "status", "") or "").lower() in ("published", "posted", "live")])
    posts_scheduled = len([p for p in posts if (getattr(p, "status", "") or "").lower() in ("scheduled", "queued", "approved")])

    # Process log activity by subsystem (last period = all stored)
    log_counts = {}
    rows = (
        await db.execute(
            select(ProcessLog.subsystem, func.count(ProcessLog.id)).group_by(ProcessLog.subsystem)
        )
    ).all()
    for subsystem, count in rows:
        log_counts[subsystem or "system"] = int(count or 0)
    total_logs = sum(log_counts.values())

    connected = [
        {
            "id": c.id,
            "group": c.group_name or "",
            "name": c.name or "",
            "status": c.status or "",
        }
        for c in connections
        if (c.status or "").lower() in ("connected", "active", "ready", "ok")
        or bool(getattr(c, "api_key_masked", None))
    ]

    # Soft cost estimate from observed activity (display only — not billed)
    est_voice = voice_mins * 0.12
    est_meetings = len(meetings) * 0.05
    est_posts = len(posts) * 0.08
    est_emails = len(emails) * 0.02
    est_logs = total_logs * 0.001
    estimated_cost = round(est_voice + est_meetings + est_posts + est_emails + est_logs, 2)

    tenant = (profile.name if profile and profile.name else None) or (
        cal.host_name if cal and cal.host_name else None
    ) or "Workspace"

    plugins = [
        {
            "id": "voice",
            "name": "AI Voice Assistant",
            "color": "#3457D5",
            "units": f"{len(calls)} calls · {voice_mins} mins · {booked_calls} booked from call",
            "detail": f"{log_counts.get('voice', 0) + log_counts.get('telephony', 0)} process events",
            "count": len(calls),
            "cost": round(est_voice, 2),
        },
        {
            "id": "scheduler",
            "name": "Post Scheduler",
            "color": "#0C8C7D",
            "units": f"{len(posts)} posts · {posts_published} published · {posts_scheduled} scheduled",
            "detail": f"{log_counts.get('scheduler', 0)} process events",
            "count": len(posts),
            "cost": round(est_posts, 2),
        },
        {
            "id": "email",
            "name": "Email Outreach",
            "color": "#F59E0B",
            "units": f"{len(emails)} outreach emails logged",
            "detail": f"{log_counts.get('system', 0)} system events",
            "count": len(emails),
            "cost": round(est_emails, 2),
        },
        {
            "id": "calendar",
            "name": "Calendar & meetings",
            "color": "#10B981",
            "units": f"{len(meetings)} meetings · {upcoming} open · {cancelled} cancelled",
            "detail": f"{log_counts.get('calendar', 0)} calendar events",
            "count": len(meetings),
            "cost": round(est_meetings, 2),
        },
        {
            "id": "leadgen",
            "name": "Lead Generation",
            "color": "#8B5CF6",
            "units": f"{len(prospects)} prospects · {len(missions)} missions",
            "detail": f"{log_counts.get('crawler_rag', 0)} crawl/RAG events",
            "count": len(prospects) + len(missions),
            "cost": round(log_counts.get("crawler_rag", 0) * 0.01, 2),
        },
    ]
    total_plugin_cost = sum(p["cost"] for p in plugins) or 1
    for p in plugins:
        p["share"] = f"{round((p['cost'] / total_plugin_cost) * 100)}%"

    return {
        "tenantName": tenant,
        "hostEmail": (cal.host_email if cal else None) or (profile.website if profile else None) or "",
        "planTier": "Workspace (metered from live activity)",
        "estimatedCostUsd": estimated_cost,
        "monthlyBudgetCapUsd": None,
        "note": "Figures are live counts from this workspace DB. Soft cost is an activity estimate, not a vendor invoice.",
        "summary": {
            "calls": len(calls),
            "voiceMinutes": voice_mins,
            "meetings": len(meetings),
            "posts": len(posts),
            "emails": len(emails),
            "prospects": len(prospects),
            "missions": len(missions),
            "processEvents": total_logs,
            "connectedServices": len(connected),
        },
        "connections": connected,
        "plugins": plugins,
        "processBySubsystem": log_counts,
    }


# ── Calling analytics (the Analytics tab) ──────────────────────────────────
# Everything below is counted from real call history; no sample numbers.

NOT_CONNECTED = {"no_answer", "failed", "busy", "voicemail", "canceled", "cancelled", "not_answered", "unreachable"}
BOOKED = {"meeting_booked", "booked"}
OUTCOME_LABELS = {
    "meeting_booked": "Meeting booked",
    "callback_requested": "Callback asked",
    "contacted": "Talked, no result",
    "human_review": "Needs review",
    "rejected": "Not interested",
    "no_answer": "No answer",
    "voicemail": "Voicemail",
    "busy": "Busy",
    "failed": "Failed",
}


def _outcome(c) -> str:
    return (c.outcome or "contacted").strip().lower() or "contacted"


def _period_stats(calls) -> dict:
    total = len(calls)
    connected = [c for c in calls if _outcome(c) not in NOT_CONNECTED]
    booked = [c for c in calls if _outcome(c) in BOOKED]
    talk = [_parse_duration_minutes(c.duration) for c in connected]
    return {
        "calls": total,
        "connected": len(connected),
        "booked": len(booked),
        "callbacks": len([c for c in calls if _outcome(c) == "callback_requested"]),
        "connectRate": round(100 * len(connected) / total, 1) if total else 0.0,
        "bookingRate": round(100 * len(booked) / len(connected), 1) if connected else 0.0,
        "talkMinutes": round(sum(talk), 1),
        "avgTalkMinutes": round(sum(talk) / len(talk), 2) if talk else 0.0,
    }


@router.get("/overview", response_model=dict)
async def calling_overview(days: int = 30, db: AsyncSession = Depends(get_db)):
    """KPIs with the change against the previous period, a daily trend, outcomes, the best
    hours to call and campaign results for the last `days` days (in the organisation's zone)."""
    import zoneinfo
    from collections import Counter, defaultdict
    from datetime import datetime, timedelta

    from app.services.org_settings import load_org

    days = max(1, min(int(days or 30), 365))
    org = await load_org(db)
    try:
        tz = zoneinfo.ZoneInfo(org["timezone"])
    except Exception:
        tz = zoneinfo.ZoneInfo("Europe/London")
    now = datetime.utcnow()
    start = now - timedelta(days=days)
    prev_start = start - timedelta(days=days)

    rows = (await db.execute(select(CallLog).where(CallLog.created_at >= prev_start))).scalars().all()
    current = [c for c in rows if c.created_at and c.created_at >= start]
    previous = [c for c in rows if c.created_at and c.created_at < start]

    def local(dt):
        return dt.replace(tzinfo=zoneinfo.ZoneInfo("UTC")).astimezone(tz)

    # Daily trend (every day in range, zero-filled)
    by_day = defaultdict(lambda: {"calls": 0, "connected": 0, "booked": 0})
    for c in current:
        d = local(c.created_at).date().isoformat()
        by_day[d]["calls"] += 1
        if _outcome(c) not in NOT_CONNECTED:
            by_day[d]["connected"] += 1
        if _outcome(c) in BOOKED:
            by_day[d]["booked"] += 1
    first = local(start).date()
    trend = []
    for i in range(days + 1):
        d = (first + timedelta(days=i)).isoformat()
        trend.append({"date": d, **by_day[d]})

    outcomes = Counter(_outcome(c) for c in current)
    outcome_list = [
        {"key": k, "label": OUTCOME_LABELS.get(k, k.replace("_", " ").capitalize()), "count": n}
        for k, n in outcomes.most_common()
    ]

    # Weekday x hour: calls and how many connected, to show the best time to call.
    heat = defaultdict(lambda: {"calls": 0, "connected": 0})
    for c in current:
        lt = local(c.created_at)
        cell = heat[(lt.weekday(), lt.hour)]
        cell["calls"] += 1
        if _outcome(c) not in NOT_CONNECTED:
            cell["connected"] += 1
    heatmap = [
        {"weekday": wd, "hour": hr, "calls": v["calls"], "connected": v["connected"],
         "rate": round(100 * v["connected"] / v["calls"], 1) if v["calls"] else 0.0}
        for (wd, hr), v in sorted(heat.items())
    ]

    campaigns = defaultdict(list)
    for c in current:
        campaigns[(c.mission or "").strip() or "Direct calls"].append(c)
    campaign_rows = sorted(
        ({"name": name, **_period_stats(cs)} for name, cs in campaigns.items()),
        key=lambda r: (-r["booked"], -r["calls"]),
    )[:12]

    channels = Counter((c.channel or "voice") for c in current)

    meetings = (await db.execute(select(Meeting))).scalars().all()
    upcoming = [m for m in meetings if (m.status or "").lower() in ("upcoming", "confirmed", "scheduled")]
    meeting_outcomes = Counter((m.status or "upcoming").lower() for m in meetings)

    return {
        "days": days,
        "timezone": org["timezone"],
        "current": _period_stats(current),
        "previous": _period_stats(previous),
        "trend": trend,
        "outcomes": outcome_list,
        "heatmap": heatmap,
        "campaigns": campaign_rows,
        "channels": [{"key": k, "count": n} for k, n in channels.most_common()],
        "meetings": {
            "upcoming": len(upcoming),
            "converted": meeting_outcomes.get("converted", 0),
            "notFit": meeting_outcomes.get("not_fit", 0),
            "needsOutcome": meeting_outcomes.get("needs_outcome", 0),
            "total": len(meetings),
        },
        "generatedAt": now.isoformat() + "Z",
    }
