"""Version history for scheduler posts: the content after each change, newest 10 per post.

Only content is versioned (headline, caption, image). Date, time and channel are schedule
settings the user changes directly; undo never moves a post in the calendar.
"""
import time
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import SocialPost, SocialPostVersion

MAX_VERSIONS = 10
SOURCES = ("original", "you", "ai", "restore", "update")


def content_of(post: SocialPost) -> Dict[str, Any]:
    return {
        "title": post.title or "",
        "copy": post.copy or "",
        "image_url": post.image_url or None,
        "image_prompt": post.image_prompt or None,
    }


def _same(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return all((a.get(k) or None) == (b.get(k) or None) for k in ("title", "copy", "image_url"))


def version_dict(v: SocialPostVersion) -> Dict[str, Any]:
    return {
        "id": v.id,
        "postId": v.post_id,
        "source": v.source,
        "title": v.title or "",
        "copy": v.copy or "",
        "imageUrl": v.image_url or "",
        "createdAt": v.created_at.isoformat() + "Z" if v.created_at else None,
    }


async def list_versions(db: AsyncSession, post_id: str) -> List[SocialPostVersion]:
    res = await db.execute(
        select(SocialPostVersion)
        .where(SocialPostVersion.post_id == post_id)
        .order_by(SocialPostVersion.created_at.desc(), SocialPostVersion.id.desc())
    )
    return list(res.scalars().all())


async def record_version(
    db: AsyncSession,
    post: SocialPost,
    source: str,
    before: Optional[Dict[str, Any]] = None,
    amend_ai: bool = False,
) -> Optional[SocialPostVersion]:
    """Store the post's current content. `before` is its content ahead of this change: kept as
    the "original" entry the first time, so the very first edit can be undone too.
    Nothing is stored when the content did not change. amend_ai: an image finished for text the
    AI just wrote, so it joins that AI version instead of adding another. Caller commits."""
    source = source if source in SOURCES else "update"
    now = content_of(post)
    versions = await list_versions(db, post.id)
    if before is not None and _same(before, now):
        return None
    if versions and _same(content_of_version(versions[0]), now):
        return None
    latest = versions[0] if versions else None
    if amend_ai and latest and latest.source == "ai" and (latest.title or "") == now["title"] and (latest.copy or "") == now["copy"]:
        latest.image_url = now["image_url"]
        latest.image_prompt = now["image_prompt"]
        return latest
    if not versions and before is not None and (before.get("copy") or before.get("image_url")):
        db.add(SocialPostVersion(id=_vid(), post_id=post.id, source="original", **before))
        await db.flush()
    row = SocialPostVersion(id=_vid(), post_id=post.id, source=source, **now)
    db.add(row)
    await db.flush()
    await _trim(db, post.id)
    return row


def content_of_version(v: SocialPostVersion) -> Dict[str, Any]:
    return {"title": v.title or "", "copy": v.copy or "", "image_url": v.image_url or None, "image_prompt": v.image_prompt or None}


async def _trim(db: AsyncSession, post_id: str) -> None:
    versions = await list_versions(db, post_id)
    old = [v.id for v in versions[MAX_VERSIONS:]]
    if old:
        await db.execute(delete(SocialPostVersion).where(SocialPostVersion.id.in_(old)))


async def delete_versions(db: AsyncSession, post_id: str) -> None:
    await db.execute(delete(SocialPostVersion).where(SocialPostVersion.post_id == post_id))


def _vid() -> str:
    # Sortable: created_at ties (same transaction) still order by id.
    return f"ver_{int(time.time() * 1000):013d}_{uuid.uuid4().hex[:6]}"
