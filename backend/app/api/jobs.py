"""What is running in the background across the apps, for the corner dock.

One list, filtered by what the organisation has bought. The company check (Leads) has its own richer
endpoints; this adds the long jobs in Social and Voice so the dock can show them too.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import Mission, SocialGenJob, SocialVideoJob

router = APIRouter(prefix="/jobs", tags=["Jobs"])

POST_WORKING = ("queued", "image_queued", "imaging")  # a post is waiting to be written or drawn
VIDEO_WORKING = ("queued", "making")
RECENT = timedelta(hours=2)  # finished posts count toward "x of y" for a while, so the bar has something to fill


async def collect(db: AsyncSession, ent: Dict[str, bool]) -> List[Dict[str, Any]]:
    """Running jobs for the apps this organisation has. Each: {id, plugin, title, done, total}."""
    jobs: List[Dict[str, Any]] = []
    if ent.get("social"):
        rows = (await db.execute(select(SocialGenJob.state))).scalars().all()
        since = datetime.utcnow() - RECENT
        left = sum(1 for s in rows if s in POST_WORKING)
        if left:
            done = len((await db.execute(select(SocialGenJob.id).where(SocialGenJob.state == "done", SocialGenJob.updated_at >= since))).scalars().all())
            jobs.append({"id": "social_posts", "plugin": "social", "title": "Writing posts", "done": done, "total": done + left})
        videos = (await db.execute(select(SocialVideoJob.state).where(SocialVideoJob.state.in_(VIDEO_WORKING)))).scalars().all()
        if videos:
            jobs.append({"id": "social_videos", "plugin": "social", "title": "Making videos", "done": 0, "total": len(videos)})
    if ent.get("voice"):
        missions = (await db.execute(select(Mission).where(Mission.status == "active"))).scalars().all()
        for m in missions:
            if (m.total or 0) > (m.contacted or 0):
                jobs.append({"id": f"mission_{m.id}", "plugin": "voice", "title": f"Calling: {m.title}", "done": m.contacted or 0, "total": m.total or 0})
    return jobs


@router.get("/active")
async def active(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.services.entitlement import get_org_entitlements

    ctx = current(request)
    ent = await get_org_entitlements(db, ctx["org_id"])
    return {"jobs": await collect(db, ent)}
