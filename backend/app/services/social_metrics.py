"""Results of published posts: reach, views, likes, comments, shares, saves, clicks, and followers.

Read back from each network every few hours (posts from the last 90 days) and kept as the latest
numbers per post per channel. A number the network does not report stays empty (None), never 0,
so the screens can say "not shared by this network" instead of showing a false zero.

What each network gives a connected account:
- Facebook Page: reach, views, clicks (read_insights), reactions, comments, shares; Page followers.
- Instagram professional account: reach, views, likes, comments, shares, saves; followers.
- Threads: views, likes, replies, reposts, quotes, shares; followers.
- X: views, likes, replies, reposts, quotes, bookmarks; link clicks for the account's own recent
  posts; followers. Every read counts against the X API plan, so X is read at most once a day and
  only for posts from the last 30 days.
- LinkedIn: likes and comments only where LinkedIn lets the app read them (company pages or
  approved partner access); a personal profile usually returns nothing.
- Reddit: score (upvotes minus downvotes, shown as likes) and comments; the account's own followers.
  Reddit does not share views.
Posts sent in Test mode never reached a network and are not read.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import SocialAccount, SocialAccountStat, SocialPost, SocialPostMetric
from app.services.social_publisher import REDDIT_API, _oauth1_header, _reddit_headers, account_access_token, normalize_platform

logger = logging.getLogger("social_metrics")

GRAPH = "https://graph.facebook.com/v21.0"
THREADS = "https://graph.threads.net/v1.0"
LOOKBACK_DAYS = 90
X_LOOKBACK_DAYS = 30
REFRESH_EVERY = timedelta(hours=6)
X_REFRESH_EVERY = timedelta(hours=24)
MAX_POSTS_PER_SYNC = 150
FIELDS = ("reach", "impressions", "likes", "comments", "shares", "saves", "clicks")


class NotShared(Exception):
    """The network would not give these numbers; the message is for the user."""


def _published(post: SocialPost) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(post.published_at).replace("Z", "")) if post.published_at else None
    except ValueError:
        return None


def _insight_values(body: Dict[str, Any]) -> Dict[str, int]:
    """Graph/Threads insights: {"data": [{"name", "values": [{"value"}]} or {"total_value": {"value"}}]}."""
    out: Dict[str, int] = {}
    for row in body.get("data") or []:
        val = None
        if isinstance(row.get("total_value"), dict):
            val = row["total_value"].get("value")
        elif row.get("values"):
            val = (row["values"][-1] or {}).get("value")
        if isinstance(val, (int, float)):
            out[str(row.get("name"))] = int(val)
    return out


def _refused(platform: str, res: httpx.Response) -> NotShared:
    detail = ""
    try:
        detail = str(((res.json() or {}).get("error") or {}).get("message") or "")[:160]
    except Exception:
        pass
    if res.status_code in (401, 403) or "permission" in detail.lower() or "scope" in detail.lower():
        return NotShared(f"{platform.title()} needs a reconnect before it shares results.")
    return NotShared(f"{platform.title()} did not share results ({res.status_code}{': ' + detail if detail else ''}).")


async def _graph_insights(client: httpx.AsyncClient, base: str, remote: str, token: str, tries: List[str]) -> Tuple[Dict[str, int], Optional[httpx.Response]]:
    """Ask for each metric list in turn (networks rename metrics); first list that works wins."""
    last = None
    for metrics in tries:
        res = await client.get(f"{base}/{remote}/insights", params={"metric": metrics, "access_token": token})
        if res.status_code == 200:
            return _insight_values(res.json() or {}), None
        last = res
    return {}, last


async def _facebook(client, token: str, remote: str) -> Dict[str, Optional[int]]:
    res = await client.get(f"{GRAPH}/{remote}", params={
        "fields": "shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)",
        "access_token": token})
    if res.status_code != 200:
        raise _refused("facebook", res)
    body = res.json() or {}
    vals, _ = await _graph_insights(client, GRAPH, remote, token, [
        "post_impressions_unique,post_impressions,post_clicks",
        "post_total_media_view_unique,post_media_view,post_clicks",
    ])
    return {
        "reach": vals.get("post_impressions_unique", vals.get("post_total_media_view_unique")),
        "impressions": vals.get("post_impressions", vals.get("post_media_view")),
        "clicks": vals.get("post_clicks"),
        "likes": ((body.get("reactions") or {}).get("summary") or {}).get("total_count"),
        "comments": ((body.get("comments") or {}).get("summary") or {}).get("total_count"),
        "shares": (body.get("shares") or {}).get("count", 0),
    }


async def _instagram(client, token: str, remote: str) -> Dict[str, Optional[int]]:
    vals, err = await _graph_insights(client, GRAPH, remote, token, [
        "reach,views,likes,comments,shares,saved",
        "reach,impressions,likes,comments,shares,saved",
        "reach,likes,comments,saved",
    ])
    if err is not None:
        raise _refused("instagram", err)
    return {"reach": vals.get("reach"), "impressions": vals.get("views", vals.get("impressions")), "likes": vals.get("likes"),
            "comments": vals.get("comments"), "shares": vals.get("shares"), "saves": vals.get("saved")}


async def _threads(client, token: str, remote: str) -> Dict[str, Optional[int]]:
    vals, err = await _graph_insights(client, THREADS, remote, token, ["views,likes,replies,reposts,quotes,shares", "views,likes,replies,reposts,quotes"])
    if err is not None:
        raise _refused("threads", err)
    shares = None
    if any(k in vals for k in ("reposts", "quotes", "shares")):
        shares = vals.get("reposts", 0) + vals.get("quotes", 0) + vals.get("shares", 0)
    return {"impressions": vals.get("views"), "likes": vals.get("likes"), "comments": vals.get("replies"), "shares": shares}


def _x_headers(account, token: str, url: str) -> Dict[str, str]:
    extra = account.extra if isinstance(account.extra, dict) else {}
    key = extra.get("apiKey") or extra.get("consumerKey") or ""
    secret = extra.get("apiSecret") or extra.get("consumerSecret") or ""
    tsecret = (account.token_secret or extra.get("accessTokenSecret") or "").strip()
    if key and secret and tsecret:
        return {"Authorization": _oauth1_header("GET", url, key, secret, token, tsecret)}
    return {"Authorization": f"Bearer {token}"}


async def _x(client, token: str, remote: str, account) -> Dict[str, Optional[int]]:
    data = None
    for fields in ("public_metrics,non_public_metrics", "public_metrics"):
        url = f"https://api.x.com/2/tweets/{remote}?tweet.fields={fields}"
        res = await client.get(url, headers=_x_headers(account, token, url))
        if res.status_code == 200:
            data = (res.json() or {}).get("data") or {}
            break
        if res.status_code == 429:
            raise NotShared("X limits how often results can be read on this plan. They will update later.")
    if data is None:
        raise _refused("x", res)
    pub = data.get("public_metrics") or {}
    priv = data.get("non_public_metrics") or {}
    return {
        "impressions": priv.get("impression_count", pub.get("impression_count")),
        "likes": pub.get("like_count"), "comments": pub.get("reply_count"),
        "shares": (pub.get("retweet_count") or 0) + (pub.get("quote_count") or 0),
        "saves": pub.get("bookmark_count"), "clicks": priv.get("url_link_clicks"),
    }


async def _linkedin(client, token: str, remote: str) -> Dict[str, Optional[int]]:
    res = await client.get(f"https://api.linkedin.com/rest/socialActions/{quote(remote, safe='')}",
                           headers={"Authorization": f"Bearer {token}", "Linkedin-Version": "202401", "X-Restli-Protocol-Version": "2.0.0"})
    if res.status_code != 200:
        raise NotShared("LinkedIn shares post results only for company pages or approved partner apps.")
    body = res.json() or {}
    return {"likes": (body.get("likesSummary") or {}).get("totalLikes"),
            "comments": (body.get("commentsSummary") or {}).get("aggregatedTotalComments")}


async def _reddit(client, token: str, remote: str) -> Dict[str, Optional[int]]:
    res = await client.get(f"{REDDIT_API}/api/info", headers=_reddit_headers(token), params={"id": remote, "raw_json": 1})
    if res.status_code != 200:
        raise _refused("reddit", res)
    children = ((res.json() or {}).get("data") or {}).get("children") or []
    if not children:
        raise NotShared("Reddit no longer shows this post (it may have been removed).")
    d = children[0].get("data") or {}
    return {"likes": d.get("score"), "comments": d.get("num_comments"),
            "impressions": d.get("view_count") if isinstance(d.get("view_count"), int) else None}


async def read_post_numbers(account, platform: str, remote: str) -> Dict[str, Optional[int]]:
    token = account_access_token(account)
    if not token:
        raise NotShared("This channel is not connected.")
    async with httpx.AsyncClient(timeout=20.0) as client:
        if platform == "facebook":
            return await _facebook(client, token, remote)
        if platform == "instagram":
            return await _instagram(client, token, remote)
        if platform == "threads":
            return await _threads(client, token, remote)
        if platform == "x":
            return await _x(client, token, remote, account)
        if platform == "linkedin":
            return await _linkedin(client, token, remote)
        if platform == "reddit":
            return await _reddit(client, token, remote)
    raise NotShared(f"{platform.title()} does not share results.")


async def read_followers(account) -> Optional[int]:
    plat = normalize_platform(account.platform)
    token = account_access_token(account)
    remote = (account.account_id or "").strip()
    if not token or not remote:
        return None
    async with httpx.AsyncClient(timeout=20.0) as client:
        if plat == "reddit":
            res = await client.get(f"{REDDIT_API}/api/v1/me", headers=_reddit_headers(token))
            return (((res.json() or {}).get("subreddit")) or {}).get("subscribers") if res.status_code == 200 else None
        if plat in ("facebook", "instagram"):
            res = await client.get(f"{GRAPH}/{remote}", params={"fields": "followers_count", "access_token": token})
            return (res.json() or {}).get("followers_count") if res.status_code == 200 else None
        if plat == "threads":
            res = await client.get(f"{THREADS}/{remote}/threads_insights", params={"metric": "followers_count", "access_token": token})
            return _insight_values(res.json() or {}).get("followers_count") if res.status_code == 200 else None
        if plat == "x":
            url = "https://api.x.com/2/users/me?user.fields=public_metrics"
            res = await client.get(url, headers=_x_headers(account, token, url))
            return ((((res.json() or {}).get("data") or {}).get("public_metrics")) or {}).get("followers_count") if res.status_code == 200 else None
    return None


def _account_for(accounts: List[SocialAccount], result: Dict[str, Any], platform: str) -> Optional[SocialAccount]:
    by_id = next((a for a in accounts if a.id == result.get("accountId")), None)
    return by_id or next((a for a in accounts if normalize_platform(a.platform) == platform), None)


def _due(row: Optional[SocialPostMetric], platform: str, now: datetime) -> bool:
    if not row or not row.fetched_at:
        return True
    return now - row.fetched_at >= (X_REFRESH_EVERY if platform == "x" else REFRESH_EVERY)


async def sync_post(db: AsyncSession, post: SocialPost, accounts: List[SocialAccount], force: bool = False) -> int:
    """Refresh one post's numbers on every channel it went to. Returns channels updated."""
    from app.services import social_tokens

    now = datetime.utcnow()
    published = _published(post)
    done = 0
    for r in post.publish_results or []:
        if not isinstance(r, dict) or not r.get("ok") or not r.get("id") or r.get("test"):
            continue
        platform = normalize_platform(r.get("platform"))
        if platform == "x" and published and now - published > timedelta(days=X_LOOKBACK_DAYS) and not force:
            continue
        mid = f"{post.id}:{platform}"
        row = await db.get(SocialPostMetric, mid)
        if not force and not _due(row, platform, now):
            continue
        if not row:
            row = SocialPostMetric(id=mid, post_id=post.id, platform=platform)
            db.add(row)
        row.remote_id = str(r["id"])
        row.published_at = published
        acc = _account_for(accounts, r, platform)
        row.account_id = acc.id if acc else ""
        row.fetched_at = now
        if not acc:
            row.error = f"The {platform.title()} account this went to is no longer connected."
            continue
        try:
            await social_tokens.ensure_fresh_token(db, acc)
            vals = await read_post_numbers(acc, platform, row.remote_id)
            for f in FIELDS:
                v = vals.get(f)
                setattr(row, f, int(v) if isinstance(v, (int, float)) else None)
            row.error = None
            done += 1
        except NotShared as e:
            logger.warning(f"[metrics] {post.id} {platform}: {e}")
            row.error = str(e)
        except Exception as e:
            logger.warning(f"[metrics] {post.id} {platform}: {e}")
            row.error = f"Could not reach {platform.title()}. Results will update later."
    await db.flush()
    return done


async def sync_followers(db: AsyncSession, accounts: List[SocialAccount], tz: str) -> int:
    from app.services.schedule_engine import org_today

    day = org_today(tz).isoformat()
    n = 0
    for acc in accounts:
        if acc.status not in ("connected", "ok"):
            continue
        sid = f"{acc.id}:{day}"
        if await db.get(SocialAccountStat, sid):
            continue
        try:
            followers = await read_followers(acc)
        except Exception as e:
            logger.info(f"[metrics] followers for {acc.id}: {e}")
            followers = None
        if followers is None:
            continue
        db.add(SocialAccountStat(id=sid, account_id=acc.id, platform=normalize_platform(acc.platform), day=day, followers=int(followers)))
        n += 1
    await db.flush()
    return n


async def sync_org(db: AsyncSession, force: bool = False) -> Dict[str, int]:
    """Refresh the current organisation's results. Safe to call often: each channel is read only when due."""
    from app.services.org_settings import org_timezone

    since = datetime.utcnow() - timedelta(days=LOOKBACK_DAYS)
    posts = (await db.execute(select(SocialPost).where(SocialPost.status == "published"))).scalars().all()
    posts = [p for p in posts if (_published(p) or datetime.min) >= since]
    posts.sort(key=lambda p: _published(p) or datetime.min, reverse=True)
    accounts = (await db.execute(select(SocialAccount))).scalars().all()
    updated = 0
    for post in posts[:MAX_POSTS_PER_SYNC]:
        updated += await sync_post(db, post, accounts, force=force)
    followers = await sync_followers(db, accounts, await org_timezone(db))
    await db.commit()
    return {"posts": len(posts[:MAX_POSTS_PER_SYNC]), "channels": updated, "followers": followers}


def engagements(m: SocialPostMetric) -> Optional[int]:
    vals = [getattr(m, f) for f in ("likes", "comments", "shares", "saves")]
    known = [v for v in vals if v is not None]
    return sum(known) if known else None
