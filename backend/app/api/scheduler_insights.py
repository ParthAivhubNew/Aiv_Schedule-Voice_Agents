"""Overview and Insights for Social: what needs the user today, and how published posts did.

Numbers come only from what the networks reported (app.services.social_metrics). A figure a network
did not share is left out, never counted as zero, and each total says how many posts it covers.
"""
from __future__ import annotations

import time
import zoneinfo
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.models import (LeadAccount, Meeting, SocialAccount, SocialAccountStat, SocialEngager, SocialLinkClick,
                               SocialPost, SocialPostMetric)
from app.services import social_links
from app.services import social_metrics as SM
from app.services.org_settings import org_timezone
from app.services.social_publisher import failure_kind, normalize_platform

router = APIRouter(prefix="/scheduler", tags=["Post Scheduler"])

WINDOWS = (7, 30, 90)
MIN_POSTS_FOR_BEST_TIMES = 8
FIELDS = SM.FIELDS
from app.services.social_publisher import TITLES  # noqa: E402


def is_test(p: SocialPost) -> bool:
    """Sent in Test mode: it went through the whole flow but never reached a network."""
    res = [r for r in (p.publish_results or []) if isinstance(r, dict)]
    return bool(res) and all(r.get("test") for r in res)


def _split(raw: str, norm=lambda v: v) -> List[str]:
    return [norm(v.strip()) for v in (raw or "").split(",") if v.strip()]


def _local(dt: Optional[datetime], tz: str) -> Optional[datetime]:
    if not dt:
        return None
    return dt.replace(tzinfo=zoneinfo.ZoneInfo("UTC")).astimezone(zoneinfo.ZoneInfo(tz))


def _due_ms(p: SocialPost) -> float:
    return float(p.due_at_ms or p.slot_date_ms or 0)


def _channel(p: SocialPost) -> str:
    ch = p.channels or ["linkedin"]
    return normalize_platform(ch[0] if isinstance(ch, list) and ch else ch)


def _reason(p: SocialPost) -> Dict[str, str]:
    """Why a post failed, in plain words, and what fixes it."""
    bad = [r for r in (p.publish_results or []) if isinstance(r, dict) and not r.get("ok")]
    if not bad:
        return {"text": "The network did not accept the post.", "kind": "permanent"}
    r = bad[0]
    kind = r.get("kind") or failure_kind(r)
    plat = TITLES.get(normalize_platform(r.get("platform")), "") or "The network"
    text = {
        "login": f"{plat} needs you to reconnect the account.",
        "temporary": f"{plat} was busy or unreachable. Retrying usually works.",
    }.get(kind, f"{plat} refused the post: {str(r.get('error') or '')[:160]}")
    return {"text": text, "kind": kind}


def _sum(rows: List[SocialPostMetric], field: str) -> Optional[int]:
    vals = [getattr(r, field) for r in rows if getattr(r, field) is not None]
    return sum(vals) if vals else None


def _totals(rows: List[SocialPostMetric]) -> Dict[str, Any]:
    out: Dict[str, Any] = {f: _sum(rows, f) for f in FIELDS}
    eng = [SM.engagements(r) for r in rows]
    out["engagements"] = sum(e for e in eng if e is not None) if any(e is not None for e in eng) else None
    seen = [r for r in rows if r.impressions or r.reach]
    denom = sum((r.impressions or r.reach or 0) for r in seen)
    num = sum((SM.engagements(r) or 0) for r in seen)
    out["engagementRate"] = round(100.0 * num / denom, 2) if denom else None
    out["posts"] = len({r.post_id for r in rows})
    out["measured"] = len({r.post_id for r in rows if r.error is None})
    return out


def _change(now: Optional[int], before: Optional[int]) -> Optional[float]:
    if now is None or not before:
        return None
    return round(100.0 * (now - before) / before, 1)


async def _post_outcomes(db: AsyncSession, post_ids: List[str]) -> Dict[str, Dict[str, int]]:
    """Leads and meetings each post produced (commenters added as leads, bookings from its link)."""
    out: Dict[str, Dict[str, int]] = defaultdict(lambda: {"leads": 0, "meetings": 0})
    if not post_ids:
        return out
    for pid, n in (await db.execute(select(Meeting.source_post_id, func.count(Meeting.id))
                                    .where(Meeting.source_post_id.in_(post_ids)).group_by(Meeting.source_post_id))).all():
        out[pid]["meetings"] = int(n)
    leads: Dict[str, set] = defaultdict(set)
    for pid, lid in (await db.execute(select(LeadAccount.source_post_id, LeadAccount.id).where(LeadAccount.source_post_id.in_(post_ids)))).all():
        leads[pid].add(lid)
    for pid, lid in (await db.execute(select(SocialEngager.post_id, SocialEngager.lead_id)
                                      .where(SocialEngager.post_id.in_(post_ids), SocialEngager.lead_id.isnot(None)))).all():
        leads[pid].add(lid)
    for pid, ids in leads.items():
        out[pid]["leads"] = len(ids)
    return out


def _metric_dict(m: SocialPostMetric) -> Dict[str, Any]:
    return {**{f: getattr(m, f) for f in FIELDS}, "engagements": SM.engagements(m), "platform": m.platform,
            "error": m.error, "fetchedAt": m.fetched_at.isoformat() + "Z" if m.fetched_at else None}


@router.get("/overview")
async def overview(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    tz = await org_timezone(db)
    zone = zoneinfo.ZoneInfo(tz)
    now = datetime.now(zone)
    now_ms = time.time() * 1000
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    month_start = day_start.replace(day=1)
    posts = (await db.execute(select(SocialPost))).scalars().all()

    def due_local(p):
        ms = _due_ms(p)
        return datetime.fromtimestamp(ms / 1000, zone) if ms else None

    def published_local(p):
        return _local(SM._published(p), tz)

    today = [p for p in posts if (d := due_local(p)) and day_start <= d < day_end and p.status != "failed"]
    week = [p for p in posts if p.status in ("approved", "scheduled") and now_ms <= _due_ms(p) <= now_ms + 7 * 86400000]
    failed = [p for p in posts if p.status == "failed"]
    month = [p for p in posts if p.status == "published" and not is_test(p) and (d := published_local(p)) and d >= month_start]
    waiting = [p for p in posts if p.status == "awaiting_approval"]

    accounts = (await db.execute(select(SocialAccount))).scalars().all()
    reconnect = [{"id": a.id, "platform": normalize_platform(a.platform), "handle": a.handle or "", "error": a.last_error or ""}
                 for a in accounts if a.status in ("expired", "error")]

    upcoming = sorted([p for p in posts if p.status in ("approved", "scheduled", "awaiting_approval") and _due_ms(p) >= now_ms - 600000],
                      key=_due_ms)[:8]

    # Last 7 days of results, by publish day.
    since = datetime.utcnow() - timedelta(days=7)
    rows = (await db.execute(select(SocialPostMetric).where(SocialPostMetric.published_at >= since))).scalars().all()
    days = [(day_start - timedelta(days=i)).date() for i in range(6, -1, -1)]
    series = {d.isoformat(): {"date": d.isoformat(), "reach": None, "engagements": None} for d in days}
    for r in rows:
        d = _local(r.published_at, tz)
        key = d.date().isoformat() if d else ""
        if key in series:
            for field, val in (("reach", r.reach if r.reach is not None else r.impressions), ("engagements", SM.engagements(r))):
                if val is not None:
                    series[key][field] = (series[key][field] or 0) + val
    recent_ids = [p.id for p in posts if p.status == "published" and not is_test(p) and (d := published_local(p)) and d >= now - timedelta(days=7)]
    outcomes = await _post_outcomes(db, recent_ids)
    return {
        "timezone": tz,
        "counts": {"today": len(today), "nextSevenDays": len(week), "failed": len(failed), "publishedThisMonth": len(month),
                   "waiting": len(waiting)},
        "failed": [{"id": p.id, "title": p.title, "channel": _channel(p), "dueAtMs": _due_ms(p), **_reason(p)} for p in
                   sorted(failed, key=_due_ms, reverse=True)[:10]],
        "reconnect": reconnect,
        "upcoming": [{"id": p.id, "title": p.title, "channel": _channel(p), "dueAtMs": _due_ms(p), "status": p.status} for p in upcoming],
        "week": {"series": list(series.values()), "totals": _totals(rows),
                 "leads": sum(o["leads"] for o in outcomes.values()), "meetings": sum(o["meetings"] for o in outcomes.values()),
                 "linkClicks": await _link_clicks(db, since, None, [])},
    }


async def _link_clicks(db: AsyncSession, since: datetime, until: Optional[datetime], chans: List[str]) -> int:
    q = select(func.count(SocialLinkClick.id)).where(SocialLinkClick.at >= since)
    if until:
        q = q.where(SocialLinkClick.at < until)
    if chans:
        q = q.where(SocialLinkClick.platform.in_(chans))
    return int((await db.execute(q)).scalar() or 0)


@router.get("/insights")
async def insights(days: int = 30, channel: str = "", account: str = "", db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    if days not in WINDOWS:
        raise HTTPException(status_code=400, detail="Pick 7, 30 or 90 days.")
    tz = await org_timezone(db)
    now = datetime.utcnow()
    start, prev_start = now - timedelta(days=days), now - timedelta(days=2 * days)
    chans, accs = _split(channel, normalize_platform), _split(account)
    q = select(SocialPostMetric).where(SocialPostMetric.published_at >= prev_start)
    if chans:
        q = q.where(SocialPostMetric.platform.in_(chans))
    if accs:
        q = q.where(SocialPostMetric.account_id.in_(accs))
    rows = (await db.execute(q)).scalars().all()
    cur = [r for r in rows if r.published_at and r.published_at >= start]
    prev = [r for r in rows if r.published_at and prev_start <= r.published_at < start]
    totals, before = _totals(cur), _totals(prev)
    totals["linkClicks"] = await _link_clicks(db, start, None, chans)
    before["linkClicks"] = await _link_clicks(db, prev_start, start, chans)
    changes = {k: _change(totals.get(k), before.get(k)) for k in ("reach", "impressions", "engagements", "clicks", "linkClicks")}

    # Daily series by publish day in the organisation's time zone.
    zone = zoneinfo.ZoneInfo(tz)
    first = datetime.now(zone).date() - timedelta(days=days - 1)
    series = {(first + timedelta(days=i)).isoformat(): {"date": (first + timedelta(days=i)).isoformat(), "reach": None,
                                                         "impressions": None, "engagements": None, "posts": 0} for i in range(days)}
    counted = set()
    for r in cur:
        d = _local(r.published_at, tz)
        key = d.date().isoformat() if d else ""
        if key not in series:
            continue
        if r.post_id not in counted:
            series[key]["posts"] += 1
            counted.add(r.post_id)
        for field, val in (("reach", r.reach), ("impressions", r.impressions), ("engagements", SM.engagements(r))):
            if val is not None:
                series[key][field] = (series[key][field] or 0) + val

    # Top posts by engagements, then reach.
    by_post: Dict[str, List[SocialPostMetric]] = defaultdict(list)
    for r in cur:
        by_post[r.post_id].append(r)
    titles = {p.id: p for p in (await db.execute(select(SocialPost).where(SocialPost.id.in_(list(by_post))))).scalars().all()} if by_post else {}
    outcomes = await _post_outcomes(db, list(by_post))
    tracked = await social_links.clicks_by_post(db, list(by_post))
    top = []
    for pid, ms in by_post.items():
        t = _totals(ms)
        post = titles.get(pid)
        url = next((r.get("url") for r in (post.publish_results or []) if isinstance(r, dict) and r.get("url")), "") if post else ""
        top.append({"id": pid, "title": post.title if post else "", "channel": ms[0].platform, "url": url,
                    # Every network the post went to, each with its own numbers, so a post counts under each of them.
                    "channels": [normalize_platform(r.platform) for r in ms],
                    "perChannel": {normalize_platform(r.platform): {k: _totals([r]).get(k) for k in ("reach", "impressions", "engagements", "clicks")} for r in ms},
                    "publishedAt": ms[0].published_at.isoformat() + "Z" if ms[0].published_at else None,
                    **{k: t.get(k) for k in ("reach", "impressions", "likes", "comments", "shares", "saves", "clicks", "engagements")},
                    "linkClicks": tracked.get(pid, 0), **outcomes[pid]})
    top.sort(key=lambda x: ((x["engagements"] or 0), (x["reach"] or x["impressions"] or 0)), reverse=True)

    # Best times: average engagements by weekday and hour, once there are enough measured posts.
    measured = [r for r in rows if r.error is None and SM.engagements(r) is not None and r.published_at]
    cells: Dict[tuple, List[int]] = defaultdict(list)
    for r in measured:
        d = _local(r.published_at, tz)
        cells[(d.weekday(), d.hour)].append(SM.engagements(r) or 0)
    best = None
    if len({r.post_id for r in measured}) >= MIN_POSTS_FOR_BEST_TIMES:
        grid = [{"weekday": wd, "hour": h, "avg": round(sum(v) / len(v), 1), "posts": len(v)} for (wd, h), v in cells.items()]
        best = {"cells": grid, "top": sorted(grid, key=lambda c: (c["avg"], c["posts"]), reverse=True)[:3]}

    # Followers per account: latest count and change over the window.
    accounts = (await db.execute(select(SocialAccount))).scalars().all()
    stats = (await db.execute(select(SocialAccountStat).where(SocialAccountStat.day >= (datetime.now(zone).date() - timedelta(days=days)).isoformat())
                              .order_by(SocialAccountStat.day))).scalars().all()
    per: Dict[str, List[SocialAccountStat]] = defaultdict(list)
    for s in stats:
        per[s.account_id].append(s)
    followers = []
    for a in accounts:
        if accs and a.id not in accs:
            continue
        if chans and normalize_platform(a.platform) not in chans:
            continue
        hist = per.get(a.id) or []
        latest = hist[-1].followers if hist else None
        followers.append({"accountId": a.id, "platform": normalize_platform(a.platform), "handle": a.handle or "",
                          "followers": latest, "change": (latest - hist[0].followers) if len(hist) > 1 else None,
                          "series": [{"date": s.day, "followers": s.followers} for s in hist]})

    # One row per network, so the networks can be read side by side. A connected network with no posts in the window still gets a row.
    cur_by: Dict[str, List[SocialPostMetric]] = defaultdict(list)
    prev_by: Dict[str, List[SocialPostMetric]] = defaultdict(list)
    for r in cur:
        cur_by[normalize_platform(r.platform)].append(r)
    for r in prev:
        prev_by[normalize_platform(r.platform)].append(r)
    fol_by: Dict[str, int] = {}
    for f in followers:
        if f["followers"] is not None:
            fol_by[f["platform"]] = fol_by.get(f["platform"], 0) + f["followers"]
    names = set(cur_by) | {normalize_platform(a.platform) for a in accounts}
    if chans:
        names &= set(chans)
    if accs:
        names &= {normalize_platform(a.platform) for a in accounts if a.id in accs}
    by_channel = []
    for plat in names:
        t, b = _totals(cur_by.get(plat, [])), _totals(prev_by.get(plat, []))
        by_channel.append({
            "platform": plat, "posts": t["posts"], "measured": t["measured"], "reach": t["reach"], "impressions": t["impressions"],
            "engagements": t["engagements"], "engagementRate": t["engagementRate"], "clicks": t["clicks"],
            "linkClicks": await _link_clicks(db, start, None, [plat]) if t["posts"] else 0,
            "followers": fol_by.get(plat),
            "change": {"reach": _change(t["reach"], b["reach"]), "engagements": _change(t["engagements"], b["engagements"])},
        })
    by_channel.sort(key=lambda c: (c["posts"] > 0, c["engagements"] or 0, c["reach"] or 0), reverse=True)

    notes = sorted({r.error for r in cur if r.error})
    last = max((r.fetched_at for r in rows if r.fetched_at), default=None)
    return {
        "days": days, "timezone": tz, "totals": totals, "previous": before, "changes": changes, "byChannel": by_channel,
        "series": list(series.values()), "top": top[:100], "bestTimes": best, "followers": followers,
        "notes": notes[:6], "lastSyncedAt": last.isoformat() + "Z" if last else None,
        "accounts": [{"id": a.id, "platform": normalize_platform(a.platform), "handle": a.handle or ""} for a in accounts],
    }


@router.post("/insights/sync")
async def insights_sync(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Read fresh results now (each channel is still read at most once per its refresh interval)."""
    return {"status": "ok", **(await SM.sync_org(db))}


@router.get("/posts/{post_id}/results")
async def post_results(post_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    post = await db.get(SocialPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    rows = (await db.execute(select(SocialPostMetric).where(SocialPostMetric.post_id == post_id))).scalars().all()
    outcome = (await _post_outcomes(db, [post_id]))[post_id]
    links = [{"platform": normalize_platform(r.get("platform")), "url": r.get("url") or ""}
             for r in (post.publish_results or []) if isinstance(r, dict) and r.get("ok")]
    tracked = await social_links.links_of(db, post_id)
    fetched = max((r.fetched_at for r in rows if r.fetched_at), default=None)
    return {"title": post.title or "", "channels": [_metric_dict(r) for r in rows], "totals": _totals(rows) if rows else None, "links": links,
            "trackedLinks": tracked, "linkClicks": sum(t["clicks"] for t in tracked), "test": is_test(post),
            "asOf": fetched.isoformat() + "Z" if fetched else None, **outcome}


async def best_slots(db: AsyncSession, limit: int = 3) -> List[Dict[str, Any]]:
    """Top weekday/hour slots from the last 90 days, for Plan AI and the Schedule window. Empty until enough data."""
    data = await insights(days=90, channel="", account="", db=db)
    return (data.get("bestTimes") or {}).get("top", [])[:limit]
