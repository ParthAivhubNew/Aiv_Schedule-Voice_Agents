"""Listening: find public posts that mention the words a company cares about (brand, product, competitor, topic).

Only networks that let an app search are used:
- Reddit: posts across Reddit (the platform's Reddit app, or a connected Reddit account). Every hour.
- Threads: recent posts with the keyword (a connected Threads account; Meta must grant keyword search). Every 2 hours.
- Instagram: recent posts with a hashtag (single-word keywords only; a connected Instagram account). Every 6 hours.
- X: recent posts (a connected X account). Every X search costs money on the X API plan, so once a day, 25 results.
LinkedIn and Facebook have no public search for apps, so they cannot be listened to.
Results are kept for 90 days. Nothing is invented: a source that fails says why, in plain words.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import SocialAccount, SocialListenTopic, SocialMention
from app.services.social_publisher import (REDDIT_API, TITLES, _reddit_headers, account_access_token, normalize_platform,
                                           pick_account_for_channel, reddit_user_agent)

logger = logging.getLogger("social_listening")

SOURCES = ("reddit", "threads", "instagram", "x")
EVERY = {"reddit": timedelta(hours=1), "threads": timedelta(hours=2), "instagram": timedelta(hours=6), "x": timedelta(hours=24)}
KEEP_DAYS = 90
MAX_TOPICS = 20
MAX_KEYWORDS = 10
PER_SEARCH = 25
GRAPH = "https://graph.facebook.com/v21.0"
THREADS = "https://graph.threads.net/v1.0"

_app_token: Dict[str, Tuple[str, float]] = {}


class SourceError(Exception):
    """A search could not run; the message is for the user."""


def view(m: SocialMention) -> Dict[str, Any]:
    return {"id": m.id, "topicId": m.topic_id, "source": m.source, "author": m.author or "", "authorUrl": m.author_url or "",
            "title": m.title or "", "text": m.text or "", "url": m.url or "", "where": m.where or "", "score": m.score,
            "status": m.status or "new", "leadId": m.lead_id or "",
            "postedAt": m.posted_at.isoformat() + "Z" if m.posted_at else None,
            "foundAt": m.found_at.isoformat() + "Z" if m.found_at else None}


def topic_view(t: SocialListenTopic, new_count: int = 0) -> Dict[str, Any]:
    return {"id": t.id, "name": t.name or "", "keywords": t.keywords or [], "exclude": t.exclude or [],
            "sources": t.sources or [], "active": t.active is not False, "checked": t.checked or {},
            "errors": t.last_error or {}, "newCount": new_count}


def clean_topic(payload: Dict[str, Any], row: Optional[SocialListenTopic] = None) -> Dict[str, Any]:
    def words(v: Any) -> List[str]:
        items = v.split(",") if isinstance(v, str) else (v or [])
        out = []
        for w in items:
            w = str(w or "").strip()[:60]
            if w and w.lower() not in [o.lower() for o in out]:
                out.append(w)
        return out

    name = str(payload.get("name", row.name if row else "") or "").strip()[:80]
    keywords = words(payload.get("keywords", row.keywords if row else []))
    if not keywords:
        raise ValueError("Add at least one word or phrase to listen for.")
    if len(keywords) > MAX_KEYWORDS:
        raise ValueError(f"Up to {MAX_KEYWORDS} words or phrases per topic.")
    sources = [normalize_platform(s) for s in (payload.get("sources", row.sources if row else ["reddit"]) or [])]
    sources = [s for s in dict.fromkeys(sources) if s in SOURCES]
    if not sources:
        raise ValueError("Pick at least one network to listen on: Reddit, Threads, Instagram or X.")
    return {"name": name or keywords[0], "keywords": keywords, "exclude": words(payload.get("exclude", row.exclude if row else []))[:10],
            "sources": sources, "active": bool(payload.get("active", row.active if row else True))}


def _excluded(text: str, exclude: List[str]) -> bool:
    low = (text or "").lower()
    return any(w.lower() in low for w in exclude or [])


def _mention_id(source: str, remote: str, topic_id: str) -> str:
    return "mn_" + hashlib.sha1(f"{topic_id}|{source}|{remote}".encode()).hexdigest()[:20]


def _when(v: Any) -> Optional[datetime]:
    if isinstance(v, (int, float)):
        return datetime.utcfromtimestamp(v)
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00").replace("+0000", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


# ── Sources ─────────────────────────────────────────────────────────────────
async def _reddit_token(db: AsyncSession) -> str:
    """An app-only Reddit token from the platform's Reddit app; else a connected account's login."""
    from app.services.social_oauth import get_oauth_app

    app = await get_oauth_app(db, "reddit")
    if app.get("configured"):
        cached = _app_token.get(app["clientId"])
        if cached and cached[1] > time.time() + 60:
            return cached[0]
        basic = base64.b64encode(f"{app['clientId']}:{app['clientSecret']}".encode()).decode()
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post("https://www.reddit.com/api/v1/access_token", data={"grant_type": "client_credentials"},
                                    headers={"Authorization": f"Basic {basic}", "User-Agent": reddit_user_agent()})
        tok = (res.json() or {}).get("access_token") if res.status_code == 200 else ""
        if tok:
            _app_token[app["clientId"]] = (tok, time.time() + int((res.json() or {}).get("expires_in") or 3600))
            return tok
    accounts = (await db.execute(select(SocialAccount))).scalars().all()
    acc = pick_account_for_channel(accounts, "reddit")
    if acc:
        from app.services import social_tokens

        await social_tokens.ensure_fresh_token(db, acc)
        return account_access_token(acc)
    raise SourceError("Reddit listening needs the Reddit app set up by Outreach support, or a connected Reddit account.")


async def search_reddit(db: AsyncSession, keywords: List[str], exclude: List[str]) -> List[Dict[str, Any]]:
    token = await _reddit_token(db)
    q = " OR ".join(f'"{k}"' if " " in k else k for k in keywords)
    q += "".join(f" NOT {w}" for w in exclude if " " not in w)
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(f"{REDDIT_API}/search", headers=_reddit_headers(token),
                               params={"q": q, "sort": "new", "t": "week", "limit": PER_SEARCH, "type": "link", "raw_json": 1})
    if res.status_code == 429:
        raise SourceError("Reddit asked us to slow down. Listening carries on next hour.")
    if res.status_code != 200:
        raise SourceError(f"Reddit search did not work ({res.status_code}).")
    out = []
    for c in ((res.json() or {}).get("data") or {}).get("children") or []:
        d = c.get("data") or {}
        out.append({"remote": d.get("name") or d.get("id"), "author": f"u/{d.get('author')}" if d.get("author") else "",
                    "author_url": f"https://www.reddit.com/user/{d['author']}" if d.get("author") else "",
                    "title": d.get("title") or "", "text": d.get("selftext") or "",
                    "url": "https://www.reddit.com" + str(d.get("permalink") or ""), "where": f"r/{d.get('subreddit')}",
                    "score": d.get("score"), "at": _when(d.get("created_utc"))})
    return out


def _account(accounts: List[SocialAccount], platform: str) -> SocialAccount:
    acc = pick_account_for_channel(accounts, platform)
    if not acc:
        raise SourceError(f"Connect your {TITLES[platform]} account under Accounts to listen there.")
    return acc


async def search_x(db: AsyncSession, accounts: List[SocialAccount], keywords: List[str], exclude: List[str]) -> List[Dict[str, Any]]:
    from app.services import social_tokens
    from app.services.social_metrics import _x_headers

    acc = _account(accounts, "x")
    await social_tokens.ensure_fresh_token(db, acc)
    token = account_access_token(acc)
    q = "(" + " OR ".join(f'"{k}"' if " " in k else k for k in keywords) + ")"
    q += "".join(f' -"{w}"' if " " in w else f" -{w}" for w in exclude) + " -is:retweet"
    url = "https://api.x.com/2/tweets/search/recent?" + str(httpx.QueryParams({
        "query": q[:512], "max_results": PER_SEARCH, "tweet.fields": "created_at,public_metrics,author_id",
        "expansions": "author_id", "user.fields": "username,name"}))
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(url, headers=_x_headers(acc, token, url))
    if res.status_code in (401, 403):
        raise SourceError("X search needs a paid X API plan (Basic or higher) and a reconnect of the X account.")
    if res.status_code == 429:
        raise SourceError("X limits how often searches can run on this plan. It tries again tomorrow.")
    if res.status_code != 200:
        raise SourceError(f"X search did not work ({res.status_code}).")
    body = res.json() or {}
    users = {u.get("id"): u for u in (body.get("includes") or {}).get("users") or []}
    out = []
    for t in body.get("data") or []:
        u = users.get(t.get("author_id")) or {}
        name = u.get("username") or ""
        out.append({"remote": t.get("id"), "author": f"@{name}" if name else "", "author_url": f"https://x.com/{name}" if name else "",
                    "title": "", "text": t.get("text") or "", "url": f"https://x.com/{name or 'i'}/status/{t.get('id')}",
                    "where": "", "score": (t.get("public_metrics") or {}).get("like_count"), "at": _when(t.get("created_at"))})
    return out


async def search_threads(db: AsyncSession, accounts: List[SocialAccount], keywords: List[str], exclude: List[str]) -> List[Dict[str, Any]]:
    from app.services import social_tokens

    acc = _account(accounts, "threads")
    await social_tokens.ensure_fresh_token(db, acc)
    token = account_access_token(acc)
    out = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        for k in keywords[:5]:
            res = await client.get(f"{THREADS}/keyword_search", params={
                "q": k, "search_type": "RECENT", "fields": "id,text,permalink,timestamp,username", "limit": PER_SEARCH,
                "access_token": token})
            if res.status_code in (400, 403) and "permission" in res.text.lower():
                raise SourceError("Threads search needs Meta to approve keyword search for the app, then a reconnect of Threads.")
            if res.status_code != 200:
                raise SourceError(f"Threads search did not work ({res.status_code}).")
            for t in (res.json() or {}).get("data") or []:
                name = t.get("username") or ""
                out.append({"remote": t.get("id"), "author": f"@{name}" if name else "",
                            "author_url": f"https://www.threads.net/@{name}" if name else "", "title": "", "text": t.get("text") or "",
                            "url": t.get("permalink") or "", "where": "", "score": None, "at": _when(t.get("timestamp"))})
    return out


async def search_instagram(db: AsyncSession, accounts: List[SocialAccount], keywords: List[str], exclude: List[str]) -> List[Dict[str, Any]]:
    tags = [k.lstrip("#").replace(" ", "") for k in keywords if " " not in k.strip()][:3]
    if not tags:
        raise SourceError("Instagram only searches hashtags: add a one-word keyword, for example acme.")
    acc = _account(accounts, "instagram")
    token, ig = account_access_token(acc), (acc.account_id or "").strip()
    out = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        for tag in tags:
            res = await client.get(f"{GRAPH}/ig_hashtag_search", params={"user_id": ig, "q": tag, "access_token": token})
            if res.status_code != 200:
                raise SourceError("Instagram hashtag search needs Meta's Instagram Public Content Access for the app.")
            hid = ((res.json() or {}).get("data") or [{}])[0].get("id")
            if not hid:
                continue
            res = await client.get(f"{GRAPH}/{hid}/recent_media", params={
                "user_id": ig, "fields": "id,caption,permalink,timestamp,like_count", "limit": PER_SEARCH, "access_token": token})
            if res.status_code != 200:
                raise SourceError(f"Instagram search did not work ({res.status_code}).")
            for m in (res.json() or {}).get("data") or []:
                out.append({"remote": m.get("id"), "author": "", "author_url": "", "title": "", "text": m.get("caption") or "",
                            "url": m.get("permalink") or "", "where": f"#{tag}", "score": m.get("like_count"), "at": _when(m.get("timestamp"))})
    return out


async def _search(db: AsyncSession, accounts: List[SocialAccount], source: str, t: SocialListenTopic) -> List[Dict[str, Any]]:
    kw, ex = list(t.keywords or []), list(t.exclude or [])
    if source == "reddit":
        return await search_reddit(db, kw, ex)
    if source == "x":
        return await search_x(db, accounts, kw, ex)
    if source == "threads":
        return await search_threads(db, accounts, kw, ex)
    return await search_instagram(db, accounts, kw, ex)


async def check_topic(db: AsyncSession, t: SocialListenTopic, force: bool = False) -> Dict[str, Any]:
    """Search each of the topic's sources that is due (or all, when forced). Returns {new, errors}."""
    accounts = (await db.execute(select(SocialAccount))).scalars().all()
    now = datetime.utcnow()
    checked, errors = dict(t.checked or {}), dict(t.last_error or {})
    new = 0
    for source in t.sources or []:
        last = _when(checked.get(source))
        if not force and last and now - last < EVERY.get(source, timedelta(hours=6)):
            continue
        if force and source == "x" and last and now - last < timedelta(hours=1):
            continue  # each X search costs money: at most one an hour, even on demand
        checked[source] = now.isoformat()
        try:
            found = await _search(db, accounts, source, t)
            errors.pop(source, None)
        except SourceError as err:
            errors[source] = str(err)
            continue
        except Exception as err:
            logger.warning(f"[listening] {t.id} {source}: {err}")
            errors[source] = f"Could not reach {TITLES[source]}. Listening tries again later."
            continue
        for f in found:
            if not f.get("remote") or _excluded(f"{f.get('title')} {f.get('text')}", t.exclude or []):
                continue
            mid = _mention_id(source, str(f["remote"]), t.id)
            if await db.get(SocialMention, mid):
                continue
            db.add(SocialMention(id=mid, topic_id=t.id, source=source, remote_id=str(f["remote"])[:120],
                                 author=(f.get("author") or "")[:200], author_url=(f.get("author_url") or "")[:400],
                                 title=(f.get("title") or "")[:500], text=(f.get("text") or "")[:4000], url=(f.get("url") or "")[:600],
                                 where=(f.get("where") or "")[:120], score=f.get("score") if isinstance(f.get("score"), int) else None,
                                 posted_at=f.get("at")))
            new += 1
    t.checked, t.last_error = checked, errors
    await db.commit()
    return {"new": new, "errors": errors}


async def run_due(db: AsyncSession) -> int:
    """Hourly: search every active topic whose sources are due, and drop mentions older than KEEP_DAYS."""
    new = 0
    for t in (await db.execute(select(SocialListenTopic).where(SocialListenTopic.active.isnot(False)))).scalars().all():
        try:
            new += (await check_topic(db, t))["new"]
        except Exception:
            logger.exception("Listening for %s failed", t.id)
            await db.rollback()
    await db.execute(delete(SocialMention).where(SocialMention.found_at < datetime.utcnow() - timedelta(days=KEEP_DAYS)))
    await db.commit()
    return new


async def add_to_leads(db: AsyncSession, mention_ids: List[str]) -> Dict[str, Any]:
    """Make leads of the people behind these mentions (source "Social listening") and put them in a list."""
    from app.api.lead_lists import put_in_list
    from app.models.models import LeadAccount
    from app.services import connections as C

    rows = (await db.execute(select(SocialMention).where(SocialMention.id.in_(mention_ids)))).scalars().all()
    ids, created = [], 0
    for m in rows:
        if m.lead_id:
            ids.append(m.lead_id)
            continue
        if not m.author:
            continue
        lead = LeadAccount(id=f"la_{uuid.uuid4().hex[:12]}", name=m.author[:120], contact_name=m.author[:120], source="social",
                           source_url=m.author_url or m.url or "", stage="new",
                           notes=(f"Posted on {TITLES.get(m.source, m.source)} (found by Social listening): "
                                  + " ".join(x for x in (m.title, m.text) if x))[:2000])
        db.add(lead)
        await db.flush()
        m.lead_id = lead.id
        m.status = "seen"
        await C.record_event(db, "post", lead_id=lead.id, ref_id=m.id, summary=f"Found by Social listening on {m.source}",
                             detail={"url": m.url, "text": (m.text or "")[:200]})
        ids.append(lead.id)
        created += 1
    await db.flush()
    placed = await put_in_list(db, "", "Social listening", ids) if ids else {"id": "", "name": "Social listening", "count": 0}
    await db.commit()
    return {"added": created, "linked": len(ids) - created, "skipped": len(rows) - len(ids), "list": placed}
