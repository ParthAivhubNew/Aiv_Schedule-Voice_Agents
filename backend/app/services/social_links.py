"""Tracked links: each link in a post goes out as a short link, one per channel, tagged for analytics.

When a post is published, every web link in its text and first comment is swapped for
<base>/api/l/<code>. A click is counted (link-preview robots are not) and the person is sent on to the
original page with utm_source=<network>, utm_medium=social, utm_campaign=<post theme> and
utm_content=<post id> added, so the company's own analytics sees where visits came from. UTM tags
already on the link are kept. Instagram captions cannot hold clickable links, so they are left alone.
"""
from __future__ import annotations

import logging
import re
import secrets
import string
import uuid
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import SchedulerSetting, SocialLink, SocialLinkClick, SocialPost

logger = logging.getLogger("social_links")

URL_RE = re.compile(r"https?://[^\s<>\"'`]+", re.I)
_TRAILING = ".,;:!?)]}'\"…"
NOT_CLICKABLE = ("instagram",)
_CODE_CHARS = string.ascii_letters + string.digits
BOT_RE = re.compile(
    r"bot\b|bot/|crawl|spider|preview|facebookexternalhit|facebot|slackbot|twitterbot|linkedinbot|whatsapp|telegram|"
    r"discord|embedly|skypeuripreview|bingpreview|googleimageproxy|redditbot|pinterest|curl/|wget/|python-requests|"
    r"httpx|go-http-client|headless|okhttp", re.I)


def short_base() -> str:
    from app.config import settings
    from app.public_api.links import public_base

    custom = (getattr(settings, "SHORT_LINK_BASE_URL", "") or "").strip().rstrip("/")
    return custom or f"{public_base()}/api/l"


def is_ours(url: str) -> bool:
    """Our own short links and media files are never wrapped again."""
    low = url.lower()
    return "/api/l/" in low or "/api/scheduler/media/" in low or low.startswith(short_base().lower() + "/")


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:60] or "social"


def with_utm(url: str, platform: str, campaign: str, content: str) -> str:
    """The link with UTM tags added; tags already on it win."""
    u = urlparse(url)
    query = parse_qsl(u.query, keep_blank_values=True)
    have = {k.lower() for k, _ in query}
    for k, v in (("utm_source", platform), ("utm_medium", "social"), ("utm_campaign", campaign), ("utm_content", content)):
        if k not in have and v:
            query.append((k, v))
    return urlunparse(u._replace(query=urlencode(query)))


def find_links(text: str) -> List[str]:
    out = []
    for m in URL_RE.finditer(text or ""):
        url = m.group(0).rstrip(_TRAILING)
        if url and not is_ours(url) and url not in out:
            out.append(url)
    return out


async def org_default(db: AsyncSession) -> bool:
    row = (await db.execute(select(SchedulerSetting).where(SchedulerSetting.id == "default"))).scalars().first()
    links = ((row.data or {}).get("links") if row and isinstance(row.data, dict) else None) or {}
    return links.get("track", True) is not False


async def set_org_default(db: AsyncSession, on: bool) -> None:
    row = (await db.execute(select(SchedulerSetting).where(SchedulerSetting.id == "default"))).scalars().first()
    if not row:
        row = SchedulerSetting(id="default", data={})
        db.add(row)
    data = dict(row.data or {})
    data["links"] = {**(data.get("links") or {}), "track": bool(on)}
    row.data = data


async def tracking_on(db: AsyncSession, post: SocialPost) -> bool:
    if post.track_links is not None:
        return bool(post.track_links)
    return await org_default(db)


async def _link_for(db: AsyncSession, post: SocialPost, platform: str, url: str) -> SocialLink:
    found = (await db.execute(select(SocialLink).where(SocialLink.post_id == post.id, SocialLink.platform == platform,
                                                       SocialLink.original_url == url))).scalars().first()
    if found:
        return found
    campaign = slug(post.theme if post.theme and post.theme != "General" else post.title or "social")
    for _ in range(5):
        code = "".join(secrets.choice(_CODE_CHARS) for _ in range(7))
        if not await _code_taken(code):
            break
    row = SocialLink(id=code, post_id=post.id, platform=platform, original_url=url,
                     target_url=with_utm(url, platform, campaign, post.id))
    db.add(row)
    await db.flush()
    return row


async def _code_taken(code: str) -> bool:
    """Codes are unique across every organisation (the redirect looks them up without one)."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    with system_scope():
        async with AsyncSessionLocal() as s:
            return bool((await s.execute(select(SocialLink.id).where(SocialLink.id == code))).first())


async def rewriter(db: AsyncSession, post: SocialPost) -> Optional[Callable[[str, str], Awaitable[str]]]:
    """A function that swaps the links in a channel's text for tracked ones, or None when tracking is off."""
    if not await tracking_on(db, post):
        return None

    async def rewrite(text: str, platform: str) -> str:
        if not text or platform in NOT_CLICKABLE:
            return text
        for url in find_links(text):
            try:
                link = await _link_for(db, post, platform, url)
            except Exception:
                logger.exception("Could not make a tracked link for %s", post.id)
                continue
            # Not when the match is only the start of a longer link; a full stop ending the sentence is fine.
            text = re.sub(re.escape(url) + r"(?![\w/?=&%#-]|\.\w)", f"{short_base()}/{link.id}", text)
        return text

    return rewrite


async def follow(code: str, user_agent: str, referrer: str) -> Optional[str]:
    """Where a short link goes. Counts the click (not robots). None when the code is unknown."""
    from app.core.tenancy import org_scope, system_scope
    from app.database import AsyncSessionLocal

    with system_scope():
        async with AsyncSessionLocal() as s:
            link = (await s.execute(select(SocialLink).where(SocialLink.id == code))).scalars().first()
            if not link:
                return None
            org, target = link.org_id, link.target_url
    if BOT_RE.search(user_agent or "") or not (user_agent or "").strip():
        return target
    try:
        with org_scope(org):
            async with AsyncSessionLocal() as s:
                row = await s.get(SocialLink, code)
                if row:
                    row.clicks = (row.clicks or 0) + 1
                    row.last_click_at = datetime.utcnow()
                    s.add(SocialLinkClick(id=f"clk_{uuid.uuid4().hex[:14]}", link_id=code, post_id=row.post_id,
                                          platform=row.platform, referrer=(referrer or "")[:300]))
                    await s.commit()
    except Exception:
        logger.exception("Counting a click on %s failed", code)
    return target


async def clicks_by_post(db: AsyncSession, post_ids: Optional[List[str]] = None, since: Optional[datetime] = None) -> Dict[str, int]:
    q = select(SocialLinkClick.post_id, func.count(SocialLinkClick.id)).group_by(SocialLinkClick.post_id)
    if post_ids is not None:
        if not post_ids:
            return {}
        q = q.where(SocialLinkClick.post_id.in_(post_ids))
    if since is not None:
        q = q.where(SocialLinkClick.at >= since)
    return {pid: int(n) for pid, n in (await db.execute(q)).all()}


async def links_of(db: AsyncSession, post_id: str) -> List[Dict[str, Any]]:
    rows = (await db.execute(select(SocialLink).where(SocialLink.post_id == post_id).order_by(SocialLink.created_at))).scalars().all()
    return [{"code": r.id, "platform": r.platform, "url": r.original_url, "short": f"{short_base()}/{r.id}",
             "clicks": r.clicks or 0, "lastClickAt": r.last_click_at.isoformat() + "Z" if r.last_click_at else None}
            for r in rows]
