"""The media library: every picture and video a company uploads or the AI draws, ready to reuse in posts.

Files live in the media store (public URLs the networks can fetch); this keeps one row per file with
its size, length and alt text. A post holds copies of the items it uses (see SocialPost.media), so
deleting a library row never breaks a post already published.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import SocialMedia, SocialPost
from app.services import media_store as MS

logger = logging.getLogger("social_library")

MAX_ITEMS_PER_POST = 20
_LIVE = ("published", "publishing")


def item(m: SocialMedia, alt: Optional[str] = None) -> Dict[str, Any]:
    """What a post keeps for one library file."""
    return {"id": m.id, "url": m.url, "kind": m.kind or "image", "alt": (m.alt_text if alt is None else alt) or "",
            "mime": m.mime or "", "width": m.width, "height": m.height, "duration": m.duration_s}


def view(m: SocialMedia, used: int = 0) -> Dict[str, Any]:
    return {**item(m), "name": m.name or "", "size": m.size_bytes or 0, "tags": m.tags or [], "source": m.source or "upload",
            "createdAt": m.created_at.isoformat() + "Z" if m.created_at else None,
            "lastUsedAt": m.last_used_at.isoformat() + "Z" if m.last_used_at else None, "usedBy": used}


async def add_file(db: AsyncSession, url: str, *, size: int = 0, name: str = "", source: str = "upload", by: str = "",
                   alt: str = "", tags: Optional[List[str]] = None) -> SocialMedia:
    path = MS.local_media_path(url)
    info = MS.probe(path) if path else {}
    mime = MS.mime_of(path) if path else ""
    row = SocialMedia(id=f"med_{uuid.uuid4().hex[:12]}", kind="video" if mime.startswith("video/") else "image", url=url,
                      name=(name or "")[:200], mime=mime, size_bytes=size or (path.stat().st_size if path else 0),
                      width=info.get("width"), height=info.get("height"), duration_s=info.get("duration"),
                      alt_text=(alt or "")[:1000], tags=clean_tags(tags), source=source, created_by=by or "")
    db.add(row)
    await db.flush()
    return row


def clean_tags(raw: Any) -> List[str]:
    if isinstance(raw, str):
        raw = raw.split(",")
    out = []
    for t in raw or []:
        t = str(t or "").strip().lower()[:40]
        if t and t not in out:
            out.append(t)
    return out[:12]


def _relative(url: str) -> str:
    """Our files are stored by their relative path so a change of public address never breaks them."""
    path = MS.local_media_path(url)
    return f"{MS.MEDIA_URL_PREFIX}/{path.name}" if path else url


async def remember(db: AsyncSession, url: Optional[str], *, source: str = "ai", name: str = "") -> Optional[SocialMedia]:
    """Keep a picture the AI drew (or one set by older code) in the library, once. Never raises."""
    try:
        if not url or not MS.local_media_path(url):
            return None
        rel = _relative(url)
        found = (await db.execute(select(SocialMedia).where(SocialMedia.url == rel))).scalars().first()
        return found or await add_file(db, rel, name=name, source=source)
    except Exception:
        logger.exception("Could not add %s to the media library", url)
        return None


async def import_remote(db: AsyncSession, url: str, by: str = "", source: str = "import") -> SocialMedia:
    """Download a picture or video from a public link into the library. Raises ValueError in plain words."""
    url = (url or "").strip()
    if MS.local_media_path(url):
        return await remember(db, url, source=source) or await add_file(db, _relative(url), source=source, by=by)
    if not url.startswith(("http://", "https://")):
        raise ValueError(f"Not a link to a picture or video: {url[:80]}")
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=False) as client:
            target = url
            for _ in range(4):  # each redirect is checked again, so no hop can lead inside our network
                why = public_url_problem(target)
                if why:
                    raise ValueError(f"That link can't be used: {why}")
                async with client.stream("GET", target) as res:
                    if res.status_code in (301, 302, 303, 307, 308) and res.headers.get("location"):
                        target = str(httpx.URL(target).join(res.headers["location"]))
                        continue
                    if res.status_code != 200:
                        raise ValueError(f"Could not download {url[:80]} ({res.status_code}).")
                    mime = (res.headers.get("content-type") or "").split(";")[0].strip().lower()

                    class _Body:
                        def __init__(self):
                            self.it = res.aiter_bytes(1024 * 1024)

                        async def read(self, _n):
                            try:
                                return await self.it.__anext__()
                            except StopAsyncIteration:
                                return b""

                    stored, size = await MS.store_upload(_Body(), mime)
                    break
            else:
                raise ValueError(f"Could not download {url[:80]}: too many redirects.")
    except httpx.HTTPError as e:
        raise ValueError(f"Could not download {url[:80]}: {e}")
    name = url.split("?")[0].rstrip("/").split("/")[-1][:120]
    return await add_file(db, stored, size=size, name=name, source=source, by=by)


def public_url_problem(url: str) -> Optional[str]:
    """Why a link may not be fetched by the server, or None: only public internet addresses."""
    from urllib.parse import urlparse

    from app.services.webhook_dispatcher import url_problem

    host = (urlparse(url).hostname or "").lower()
    if host in ("localhost", "127.0.0.1", "::1") or host.endswith(".local") or host.endswith(".internal"):
        return "it points inside a private network."
    problem = url_problem(url)
    if problem:
        return "it points inside a private network." if "private" in problem else "we could not reach that address."
    return None


async def resolve(db: AsyncSession, raw: Any) -> List[Dict[str, Any]]:
    """Turn what the editor sends ([{id}|{url}, alt?]) into the post's media list. Only library files
    and our own stored files are accepted. Raises ValueError in plain words."""
    if not isinstance(raw, list):
        raise ValueError("media must be a list.")
    if len(raw) > MAX_ITEMS_PER_POST:
        raise ValueError(f"A post can hold up to {MAX_ITEMS_PER_POST} pictures and videos.")
    ids = [str(r.get("id")) for r in raw if isinstance(r, dict) and r.get("id")]
    rows = {m.id: m for m in (await db.execute(select(SocialMedia).where(SocialMedia.id.in_(ids)))).scalars().all()} if ids else {}
    out = []
    for r in raw:
        if not isinstance(r, dict):
            continue
        alt = str(r.get("alt") or "").strip()[:1000] if "alt" in r else None
        m = rows.get(str(r.get("id") or ""))
        if not m and r.get("url"):
            url = str(r["url"])
            m = await remember(db, url, source="upload")
            if not m and url.startswith(("http://", "https://")):
                # An older post's picture on an outside link (e.g. drawn before the library existed).
                m = await import_remote(db, url, source="upload")
        if not m:
            raise ValueError("A picture or video in this post is no longer in the media library. Remove it and add it again.")
        out.append(item(m, alt))
    if out:
        now = datetime.utcnow()
        for m in rows.values():
            m.last_used_at = now
    return out


async def usage(db: AsyncSession) -> Dict[str, int]:
    """How many posts not yet live use each library file (by id or by URL)."""
    counts: Dict[str, int] = {}
    posts = (await db.execute(select(SocialPost).where(SocialPost.status.notin_(list(_LIVE))))).scalars().all()
    for p in posts:
        keys = set()
        for m in p.media or []:
            if isinstance(m, dict):
                keys.add(m.get("id") or "")
                keys.add(_relative(m.get("url") or ""))
        if p.image_url:
            keys.add(_relative(p.image_url))
        for k in keys - {""}:
            counts[k] = counts.get(k, 0) + 1
    return counts


def used_by(m: SocialMedia, counts: Dict[str, int]) -> int:
    return max(counts.get(m.id, 0), counts.get(m.url, 0))
