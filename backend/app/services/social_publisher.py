"""Publish approved social posts to connected LinkedIn, X, Facebook, Instagram, Threads and Reddit accounts."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import time
import urllib.parse
import uuid
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("social_publisher")

PLATFORM_ALIASES = {
    "twitter": "x",
    "fb": "facebook",
    "ig": "instagram",
    "insta": "instagram",
    "li": "linkedin",
}


def normalize_platform(raw: Optional[str]) -> str:
    p = (raw or "").strip().lower()
    return PLATFORM_ALIASES.get(p, p)


def _mask_token(token: Optional[str]) -> str:
    try:
        from app.services.secret_box import open_secret, mask_secret, is_sealed
        plain = open_secret(token) if is_sealed(token) else (token or "")
        return mask_secret(plain) if plain else ""
    except Exception:
        t = (token or "").strip()
        if not t:
            return ""
        if len(t) <= 8:
            return "••••"
        return t[:3] + "••••" + t[-4:]


def account_access_token(account) -> str:
    try:
        from app.services.secret_box import open_secret
        return open_secret(getattr(account, "access_token", None) or "")
    except Exception:
        return (getattr(account, "access_token", None) or "").strip()


def seal_account_secrets(account) -> None:
    try:
        from app.services.secret_box import seal_secret, seal_config, is_sealed, is_masked
        for attr in ("access_token", "refresh_token", "token_secret"):
            val = getattr(account, attr, None) or ""
            if val and not is_sealed(val) and not is_masked(val):
                setattr(account, attr, seal_secret(val))
        extra = account.extra if isinstance(account.extra, dict) else {}
        if extra:
            account.extra = seal_config(extra)
    except Exception:
        pass


def account_public_dict(acc) -> Dict[str, Any]:
    extra = acc.extra if isinstance(acc.extra, dict) else {}
    return {
        "id": acc.id,
        "platform": normalize_platform(acc.platform),
        "label": acc.label or acc.handle or acc.platform,
        "handle": acc.handle or "",
        "accountId": acc.account_id or "",
        "status": acc.status or "disconnected",
        "isDefault": bool(acc.is_default),
        "hasToken": bool(account_access_token(acc) or (acc.access_token or "").strip()),
        "tokenHint": _mask_token(acc.access_token),
        "lastError": acc.last_error or "",
        "lastTestedAt": acc.last_tested_at,
        "extra": {
            k: extra.get(k)
            for k in ("pageId", "orgId", "authorType", "apiKeySet", "userId")
            if k in extra
        },
        "createdAt": acc.created_at.isoformat() if acc.created_at else None,
    }


def copy_for_platform(post, platform: str) -> str:
    p = normalize_platform(platform)
    hook = (getattr(post, "hook", None) or "").strip()
    hashtags = getattr(post, "hashtags", None) or []
    if isinstance(hashtags, str):
        tag_line = hashtags.strip()
    else:
        tag_line = " ".join([t if str(t).startswith("#") else f"#{t}" for t in hashtags if t])
    cta = (getattr(post, "cta", None) or "").strip()
    adapt = bool(getattr(post, "adapt_per_channel", False))

    channel_copy = None
    if adapt:
        channel_copy = {
            "linkedin": getattr(post, "linkedin_copy", None),
            "x": getattr(post, "x_copy", None),
            "facebook": getattr(post, "facebook_copy", None),
            "instagram": getattr(post, "instagram_copy", None),
            "threads": getattr(post, "threads_copy", None),
        }.get(p)
    body = (channel_copy or getattr(post, "copy", None) or getattr(post, "linkedin_copy", None) or "").strip()
    body = scrub_image_urls_from_text(body)

    if p == "x":
        return (body or hook)[:280]
    if p == "reddit":
        # Reddit readers dislike hashtags and sign-offs; the headline is the post title.
        return re.sub(r"(?:\s*#\w+)+\s*$", "", body or hook).strip()

    # Full channel draft already includes hook / CTA / tags — do not wrap again.
    if body and (channel_copy or len(body) > 160):
        text = body
        if cta and cta not in text:
            text = f"{text}\n\n{cta}"
        if tag_line and tag_line.split()[0] not in text:
            text = f"{text}\n\n{tag_line}"
        return text.strip()

    parts = []
    if hook and hook.lower() not in body.lower():
        parts.append(hook)
    if body:
        parts.append(body)
    if cta and cta not in body:
        parts.append(cta)
    if tag_line and tag_line not in body:
        parts.append(tag_line)
    return "\n\n".join(parts).strip()


_IMG_URL_IN_TEXT = re.compile(
    r"https?://\S*(?:pollinations\.ai|licdn\.com|/api/scheduler/media/|oaidalleapiprodscus)\S*",
    re.I,
)


def scrub_image_urls_from_text(text: str) -> str:
    cleaned = _IMG_URL_IN_TEXT.sub("", text or "")
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def _mime_from_bytes(raw: bytes, hinted: str = "") -> str:
    if raw.startswith(b"\x89PNG"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    hint = (hinted or "").split(";")[0].strip().lower()
    if hint.startswith("image/") and "html" not in hint:
        return hint
    return ""


async def fetch_image_bytes(url: Optional[str]) -> Tuple[Optional[bytes], str]:
    if not url:
        return None, "image/png"
    if url.startswith("data:"):
        try:
            header, b64 = url.split(",", 1)
            raw = base64.b64decode(b64)
            mime = _mime_from_bytes(raw, header)
            return (raw, mime or "image/png") if raw and len(raw) > 200 else (None, "image/png")
        except Exception:
            return None, "image/png"
    try:
        from app.services.media_store import local_media_bytes, store_image_bytes
        local, local_mime = local_media_bytes(url)
        if local and len(local) > 200:
            return local, _mime_from_bytes(local, local_mime) or local_mime
    except Exception:
        pass
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        }
        async with httpx.AsyncClient(timeout=90.0, follow_redirects=True, headers=headers) as client:
            res = await client.get(url)
            if res.status_code == 200 and res.content and len(res.content) > 200:
                mime = _mime_from_bytes(res.content, res.headers.get("content-type", ""))
                if not mime:
                    logger.warning("Fetched URL was not an image")
                    return None, "image/png"
                try:
                    from app.services.media_store import store_image_bytes
                    store_image_bytes(res.content, mime)
                except Exception:
                    pass
                return res.content, mime
    except Exception as e:
        logger.warning(f"Could not fetch image bytes: {e}")
    return None, "image/png"


def _oauth1_header(method: str, url: str, api_key: str, api_secret: str, token: str, token_secret: str, extra: Optional[Dict[str, str]] = None) -> str:
    nonce = uuid.uuid4().hex
    ts = str(int(time.time()))
    params = {
        "oauth_consumer_key": api_key,
        "oauth_nonce": nonce,
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": ts,
        "oauth_token": token,
        "oauth_version": "1.0",
    }
    if extra:
        params.update(extra)
    parsed = urllib.parse.urlparse(url)
    query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    all_params = {**query, **params}
    base_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    encoded = "&".join(
        f"{urllib.parse.quote(str(k), safe='~')}={urllib.parse.quote(str(all_params[k]), safe='~')}"
        for k in sorted(all_params)
    )
    base = "&".join([
        method.upper(),
        urllib.parse.quote(base_url, safe="~"),
        urllib.parse.quote(encoded, safe="~"),
    ])
    signing_key = f"{urllib.parse.quote(api_secret, safe='~')}&{urllib.parse.quote(token_secret, safe='~')}"
    sig = base64.b64encode(hmac.new(signing_key.encode(), base.encode(), hashlib.sha1).digest()).decode()
    params["oauth_signature"] = sig
    return "OAuth " + ", ".join(
        f'{urllib.parse.quote(k, safe="~")}="{urllib.parse.quote(params[k], safe="~")}"'
        for k in params
    )


async def test_account(account) -> Dict[str, Any]:
    platform = normalize_platform(account.platform)
    token = account_access_token(account)
    if not token:
        return {"ok": False, "error": "Access token missing."}

    try:
        if platform == "linkedin":
            return await _test_linkedin(account, token)
        if platform == "x":
            return await _test_x(account, token)
        if platform == "facebook":
            return await _test_facebook(account, token)
        if platform == "instagram":
            return await _test_instagram(account, token)
        if platform == "threads":
            return await _test_threads(account, token)
        if platform == "reddit":
            return await _test_reddit(account, token)
        return {"ok": False, "error": f"Unknown platform: {platform}"}
    except Exception as e:
        logger.warning(f"Account test failed ({platform}): {e}")
        return {"ok": False, "error": str(e)}


async def _test_linkedin(account, token: str) -> Dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get("https://api.linkedin.com/v2/userinfo", headers=headers)
        if res.status_code == 200:
            data = res.json()
            sub = data.get("sub") or ""
            name = data.get("name") or data.get("given_name") or "LinkedIn"
            if sub and not (account.account_id or "").strip():
                account.account_id = sub
            account.handle = name
            return {"ok": True, "handle": name, "accountId": account.account_id, "raw": {"sub": sub}}
        # Legacy me
        res2 = await client.get("https://api.linkedin.com/v2/me", headers=headers)
        if res2.status_code == 200:
            data = res2.json()
            lid = data.get("id") or ""
            if lid and not (account.account_id or "").strip():
                account.account_id = lid
            loc = f"{data.get('localizedFirstName') or ''} {data.get('localizedLastName') or ''}".strip()
            name = loc or account.handle or lid
            account.handle = name
            return {"ok": True, "handle": name, "accountId": lid}
        return {"ok": False, "error": f"LinkedIn {res.status_code}: {res.text[:240]}"}


async def _test_x(account, token: str) -> Dict[str, Any]:
    extra = account.extra if isinstance(account.extra, dict) else {}
    api_key = extra.get("apiKey") or extra.get("consumerKey") or ""
    api_secret = extra.get("apiSecret") or extra.get("consumerSecret") or ""
    token_secret = (account.token_secret or extra.get("accessTokenSecret") or "").strip()
    headers = {}
    if api_key and api_secret and token_secret:
        headers["Authorization"] = _oauth1_header(
            "GET", "https://api.twitter.com/2/users/me", api_key, api_secret, token, token_secret
        )
    else:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get("https://api.twitter.com/2/users/me", headers=headers)
        if res.status_code == 200:
            data = (res.json() or {}).get("data") or {}
            handle = data.get("username") or data.get("name") or "X"
            xid = data.get("id") or ""
            if xid and not (account.account_id or "").strip():
                account.account_id = xid
            account.handle = account.handle or f"@{handle}" if handle and not str(handle).startswith("@") else handle
            return {"ok": True, "handle": account.handle, "accountId": xid}
        return {"ok": False, "error": f"X {res.status_code}: {res.text[:240]}"}


async def _test_facebook(account, token: str) -> Dict[str, Any]:
    extra = account.extra if isinstance(account.extra, dict) else {}
    page_id = (account.account_id or extra.get("pageId") or "").strip()
    if not page_id:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.get("https://graph.facebook.com/v21.0/me/accounts", params={"access_token": token})
            if res.status_code == 200:
                pages = (res.json() or {}).get("data") or []
                if pages:
                    page_id = pages[0].get("id") or ""
                    account.account_id = page_id
                    account.handle = account.handle or pages[0].get("name") or ""
                    if pages[0].get("access_token"):
                        account.access_token = pages[0]["access_token"]
                        seal_account_secrets(account)
                    return {"ok": True, "handle": account.handle, "accountId": page_id, "pages": len(pages)}
            return {"ok": False, "error": "No Facebook Page found. Paste a Page ID + Page access token."}
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(f"https://graph.facebook.com/v21.0/{page_id}", params={"fields": "name,id", "access_token": token})
        if res.status_code == 200:
            data = res.json()
            account.handle = account.handle or data.get("name") or page_id
            account.account_id = data.get("id") or page_id
            return {"ok": True, "handle": account.handle, "accountId": account.account_id}
        return {"ok": False, "error": f"Facebook {res.status_code}: {res.text[:240]}"}


async def _test_instagram(account, token: str) -> Dict[str, Any]:
    ig_id = (account.account_id or "").strip()
    if not ig_id:
        return {"ok": False, "error": "Instagram Business account ID required (from a connected Facebook Page)."}
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(
            f"https://graph.facebook.com/v21.0/{ig_id}",
            params={"fields": "username,name,id", "access_token": token},
        )
        if res.status_code == 200:
            data = res.json()
            uname = data.get("username") or data.get("name") or ig_id
            account.handle = account.handle or f"@{uname}"
            return {"ok": True, "handle": account.handle, "accountId": data.get("id") or ig_id}
        return {"ok": False, "error": f"Instagram {res.status_code}: {res.text[:240]}"}


async def _test_threads(account, token: str) -> Dict[str, Any]:
    uid = (account.account_id or "").strip() or "me"
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(
            f"https://graph.threads.net/v1.0/{uid}",
            params={"fields": "id,username,name", "access_token": token},
        )
        if res.status_code == 200:
            data = res.json()
            uname = data.get("username") or data.get("name") or data.get("id")
            account.handle = account.handle or f"@{uname}"
            if data.get("id"):
                account.account_id = data["id"]
            return {"ok": True, "handle": account.handle, "accountId": account.account_id}
        return {"ok": False, "error": f"Threads {res.status_code}: {res.text[:240]}"}


# Longest text each network accepts in one post. Longer text is refused before publishing
# (see channel_issues) instead of being cut off without the user knowing.
TEXT_LIMITS = {"x": 280, "threads": 500, "instagram": 2200, "linkedin": 3000, "facebook": 63206, "reddit": 40000}
REDDIT_TITLE_LIMIT = 300
NEEDS_IMAGE = ("instagram",)
TITLES = {"linkedin": "LinkedIn", "x": "X", "facebook": "Facebook", "instagram": "Instagram", "threads": "Threads",
          "reddit": "Reddit"}

# What each network takes in one post. "items": pictures and videos together (a carousel);
# otherwise separate caps for pictures and videos. Video lengths are in seconds.
MEDIA_RULES: Dict[str, Dict[str, Any]] = {
    "x": {"images": 4, "videos": 1, "mix": False, "video_max_s": 140},
    "instagram": {"items": 10, "mix": True, "video_max_s": 900, "carousel_video_max_s": 60},
    "threads": {"items": 20, "mix": True, "video_max_s": 300},
    "facebook": {"images": 10, "videos": 1, "mix": False, "video_max_s": 4 * 3600},
    "linkedin": {"images": 9, "videos": 1, "mix": False, "video_max_s": 1800},
    "reddit": {"images": 20, "videos": 0, "mix": False},
}


def post_media(post) -> List[Dict[str, Any]]:
    """The post's pictures and videos in order. Older posts have only image_url."""
    items = [dict(m) for m in (getattr(post, "media", None) or []) if isinstance(m, dict) and m.get("url")]
    if not items:
        url = (getattr(post, "image_url", None) or "").strip()
        items = [{"url": url, "kind": "image"}] if url else []
    for i, m in enumerate(items):
        m["kind"] = "video" if m.get("kind") == "video" else "image"
        if i == 0 and not m.get("alt"):
            m["alt"] = getattr(post, "alt_text", None) or ""
    return items


def channel_options(post, platform: str) -> Dict[str, Any]:
    opts = getattr(post, "channel_options", None) or {}
    return opts.get(platform) if isinstance(opts, dict) and isinstance(opts.get(platform), dict) else {}


def _length(seconds: float) -> str:
    s = int(round(seconds))
    return f"{s // 60}:{s % 60:02d}"


def media_issues(platform: str, items: List[Dict[str, Any]]) -> List[str]:
    """Why this network would refuse these pictures/videos, in plain words."""
    rule = MEDIA_RULES.get(platform)
    if not rule or not items:
        return []
    title = TITLES.get(platform, platform.title())
    images = [m for m in items if m["kind"] == "image"]
    videos = [m for m in items if m["kind"] == "video"]
    out = []
    if "items" in rule:
        if len(items) > rule["items"]:
            out.append(f"{title} takes up to {rule['items']} pictures or videos in one post; this has {len(items)}.")
    else:
        if videos and not rule["videos"]:
            out.append(f"{title} posts from here can't include a video. Remove it or post the video elsewhere.")
        elif len(videos) > rule["videos"]:
            out.append(f"{title} takes one video per post; this has {len(videos)}.")
        if len(images) > rule["images"]:
            out.append(f"{title} takes up to {rule['images']} pictures in one post; this has {len(images)}.")
        if images and videos and not rule["mix"] and rule["videos"]:
            out.append(f"{title} can't mix pictures and a video in one post.")
    longest = rule.get("carousel_video_max_s") if len(items) > 1 and rule.get("carousel_video_max_s") else rule.get("video_max_s")
    for v in videos:
        if longest and (v.get("duration") or 0) > longest:
            out.append(f"A video is {_length(v['duration'])} long; {title} takes up to {_length(longest)}"
                       + (" in a carousel." if longest == rule.get("carousel_video_max_s") else "."))
    return out


def channel_issues(post, channels: Optional[List[str]] = None) -> List[Dict[str, str]]:
    """What would make a channel refuse this post, in plain words: [{channel, problem, kind}].
    kind: length | media | missing_media (a picture is drawn before posting) | setup."""
    chans = channels if channels is not None else (post.channels or [])
    if isinstance(chans, str):
        chans = [chans]
    items = post_media(post)
    out = []
    for ch in chans:
        plat = normalize_platform(ch)
        limit = TEXT_LIMITS.get(plat)
        text = copy_for_platform(post, plat) if plat != "x" else _x_text(post)
        if limit and len(text) > limit:
            out.append({"channel": plat, "problem": f"Text is {len(text)} characters; the limit is {limit}.", "kind": "length"})
        if plat in NEEDS_IMAGE and not items:
            out.append({"channel": plat, "problem": "Instagram needs a picture.", "kind": "missing_media"})
        for problem in media_issues(plat, items):
            out.append({"channel": plat, "problem": problem, "kind": "media"})
        if plat == "reddit":
            if not str(channel_options(post, "reddit").get("subreddit") or "").strip():
                out.append({"channel": plat, "problem": "Pick the subreddit to post in.", "kind": "setup"})
            title = (getattr(post, "title", None) or "").strip()
            if len(title) > REDDIT_TITLE_LIMIT:
                out.append({"channel": plat, "problem": f"The Reddit title is {len(title)} characters; the limit is {REDDIT_TITLE_LIMIT}.",
                            "kind": "length"})
    return out


def _x_text(post) -> str:
    """X text before the 280 cut, so an over-long tweet is reported rather than cut."""
    body = (getattr(post, "x_copy", None) if getattr(post, "adapt_per_channel", False) else None) \
        or getattr(post, "copy", None) or getattr(post, "hook", None) or ""
    return scrub_image_urls_from_text(str(body)).strip()


def failure_kind(result: Dict[str, Any]) -> str:
    """login (reconnect), temporary (try again later) or permanent (change the post)."""
    err = str(result.get("error") or "").lower()
    if not err:
        return ""
    if "no connected" in err or "no access token" in err or "access token missing" in err:
        return "login"
    code = 0
    for part in err.replace(":", " ").split():
        if part.isdigit() and len(part) == 3:
            code = int(part)
            break
    if code in (401,) or any(w in err for w in ("expired", "invalid oauth", "session has been invalidated",
                                               "token", "reconnect", "permission", "not authorized")):
        return "login"
    if code == 429 or code >= 500 or any(w in err for w in ("timeout", "timed out", "could not reach", "connection",
                                                           "rate limit", "temporarily", "try again")):
        return "temporary"
    if code == 403:
        return "login"
    return "permanent"


async def publish_to_account(account, text: str, image_url: Optional[str] = None,
                             alt_text: str = "", first_comment: str = "",
                             media: Optional[List[Dict[str, Any]]] = None, title: str = "",
                             options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Post to one account. media (pictures/videos, public URLs) wins over the single image_url."""
    platform = normalize_platform(account.platform)
    token = account_access_token(account)
    if not token:
        return {"ok": False, "platform": platform, "error": "No access token on this account."}
    alt = (alt_text or "").strip()[:1000]
    items = list(media or [])
    if not items and image_url:
        items = [{"url": image_url, "kind": "image", "alt": alt}]
    for i, m in enumerate(items):
        m["alt"] = (m.get("alt") or (alt if i == 0 else "")).strip()[:1000]
    try:
        if platform == "linkedin":
            res = await _publish_linkedin(account, token, text, items)
        elif platform == "x":
            res = await _publish_x(account, token, text, items)
        elif platform == "facebook":
            res = await _publish_facebook(account, token, text, items)
        elif platform == "instagram":
            res = await _publish_instagram(account, token, text, items)
        elif platform == "threads":
            res = await _publish_threads(account, token, text, items)
        elif platform == "reddit":
            res = await _publish_reddit(account, token, text, items, title, options or {})
        else:
            return {"ok": False, "platform": platform, "error": f"Unsupported platform {platform}"}
    except Exception as e:
        logger.exception(f"Publish failed ({platform})")
        return {"ok": False, "platform": platform, "error": str(e)}
    comments = [c for c in (res.pop("captionComment", ""), (first_comment or "").strip()) if c]
    if res.get("ok") and comments:
        # The post is live either way; a refused comment is reported, never a failed post.
        for c in comments:
            try:
                res["firstComment"] = await _post_first_comment(account, token, platform, res, c)
            except Exception as e:
                res["firstComment"] = {"ok": False, "error": str(e)}
    return res


async def _post_first_comment(account, token: str, platform: str, res: Dict[str, Any], text: str) -> Dict[str, Any]:
    remote = str(res.get("id") or "")
    async with httpx.AsyncClient(timeout=30.0) as client:
        if platform in ("facebook", "instagram"):
            r = await client.post(f"https://graph.facebook.com/v21.0/{remote}/comments",
                                  data={"message": text[:8000], "access_token": token})
        elif platform == "linkedin":
            actor = _linkedin_author(account)
            r = await client.post(
                f"https://api.linkedin.com/v2/socialActions/{urllib.parse.quote(remote, safe='')}/comments",
                headers={"Authorization": f"Bearer {token}", "X-Restli-Protocol-Version": "2.0.0"},
                json={"actor": actor, "message": {"text": text[:1250]}},
            )
        elif platform == "x":
            return await _publish_x(account, token, text[:280], [], reply_to=remote)
        elif platform == "threads":
            uid = (account.account_id or "").strip()
            c = await client.post(f"https://graph.threads.net/v1.0/{uid}/threads",
                                  data={"access_token": token, "text": text[:500], "media_type": "TEXT", "reply_to_id": remote})
            if c.status_code not in (200, 201) or not (c.json() or {}).get("id"):
                return {"ok": False, "error": f"{c.status_code}: {c.text[:200]}"}
            r = await client.post(f"https://graph.threads.net/v1.0/{uid}/threads_publish",
                                  data={"creation_id": c.json()["id"], "access_token": token})
        elif platform == "reddit":
            r = await client.post(f"{REDDIT_API}/api/comment", headers=_reddit_headers(token),
                                  data={"thing_id": remote, "text": text[:10000], "api_type": "json"})
            errors = ((r.json() or {}).get("json") or {}).get("errors") if r.status_code == 200 else None
            if errors:
                return {"ok": False, "error": f"400: {errors}"}
        else:
            return {"ok": False, "error": "This channel has no comments."}
    if r.status_code in (200, 201):
        return {"ok": True}
    return {"ok": False, "error": f"{r.status_code}: {r.text[:200]}"}


def _linkedin_author(account) -> str:
    extra = account.extra if isinstance(account.extra, dict) else {}
    aid = (account.account_id or extra.get("orgId") or "").strip()
    if aid.startswith("urn:"):
        return aid
    if extra.get("authorType") == "organization" or extra.get("orgId"):
        return f"urn:li:organization:{aid or extra.get('orgId')}"
    return f"urn:li:person:{aid}" if aid else ""


async def media_bytes(url: str, kind: str = "image") -> Tuple[Optional[bytes], str]:
    """Bytes of one of the post's files. Our own files are read from disk; others are downloaded."""
    if kind != "video":
        return await fetch_image_bytes(url)
    from app.services.media_store import MAX_VIDEO_BYTES, local_media_path, mime_of

    path = local_media_path(url)
    if path:
        return path.read_bytes(), mime_of(path)
    try:
        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            res = await client.get(url)
            if res.status_code == 200 and 200 < len(res.content) <= MAX_VIDEO_BYTES:
                return res.content, (res.headers.get("content-type") or "video/mp4").split(";")[0]
    except Exception as e:
        logger.warning(f"Could not fetch video: {e}")
    return None, "video/mp4"


async def _publish_linkedin(account, token: str, text: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    author = _linkedin_author(account)
    if not author or author.endswith(":"):
        tested = await _test_linkedin(account, token)
        if not tested.get("ok"):
            return {"ok": False, "platform": "linkedin", "error": tested.get("error") or "Could not resolve LinkedIn author URN."}
        author = _linkedin_author(account)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
    }
    share: Dict[str, Any] = {
        "shareCommentary": {"text": scrub_image_urls_from_text(text)[:3000]},
        "shareMediaCategory": "NONE",
    }
    video = next((m for m in items if m["kind"] == "video"), None)
    entries = []
    if video:
        asset = await _linkedin_upload(token, author, video["url"], "video")
        if not asset:
            return {"ok": False, "platform": "linkedin", "error": "LinkedIn did not accept the video upload. Try again later."}
        not_ready = await _linkedin_wait_asset(token, asset)
        if not_ready:
            return {"ok": False, "platform": "linkedin", "error": not_ready}
        share["shareMediaCategory"] = "VIDEO"
        entries.append({"status": "READY", "media": asset, "title": {"text": "Video"}})
    else:
        for m in items[:MEDIA_RULES["linkedin"]["images"]]:
            asset = await _linkedin_upload(token, author, m["url"], "image")
            if asset:
                entry = {"status": "READY", "media": asset, "title": {"text": "Post image"}}
                if m.get("alt"):
                    entry["description"] = {"text": m["alt"][:200]}
                entries.append(entry)
            else:
                logger.warning("LinkedIn image upload failed; that picture is left out.")
        if entries:
            share["shareMediaCategory"] = "IMAGE"
    if entries:
        share["media"] = entries

    body = {
        "author": author,
        "lifecycleState": "PUBLISHED",
        "specificContent": {"com.linkedin.ugc.ShareContent": share},
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    async with httpx.AsyncClient(timeout=40.0) as client:
        res = await client.post("https://api.linkedin.com/v2/ugcPosts", headers=headers, json=body)
        if res.status_code in (200, 201):
            post_id = res.headers.get("x-restli-id") or (res.json() or {}).get("id") or ""
            url = f"https://www.linkedin.com/feed/update/{post_id}" if post_id else ""
            return {"ok": True, "platform": "linkedin", "id": post_id, "url": url}
        return {"ok": False, "platform": "linkedin", "error": f"{res.status_code}: {res.text[:300]}"}


async def _linkedin_upload(token: str, author: str, url: str, kind: str) -> Optional[str]:
    raw, mime = await media_bytes(url, kind)
    if not raw:
        return None
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
    }
    register = {
        "registerUploadRequest": {
            "recipes": [f"urn:li:digitalmediaRecipe:feedshare-{kind}"],
            "owner": author,
            "serviceRelationships": [{
                "relationshipType": "OWNER",
                "identifier": "urn:li:userGeneratedContent",
            }],
        }
    }
    try:
        async with httpx.AsyncClient(timeout=300.0 if kind == "video" else 40.0) as client:
            reg = await client.post(
                "https://api.linkedin.com/v2/assets?action=registerUpload",
                headers=headers,
                json=register,
            )
            if reg.status_code not in (200, 201):
                logger.warning(f"LinkedIn registerUpload {reg.status_code}: {reg.text[:200]}")
                return None
            data = reg.json() or {}
            asset = (data.get("value") or {}).get("asset")
            upload_url = (
                ((data.get("value") or {}).get("uploadMechanism") or {})
                .get("com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest") or {}
            ).get("uploadUrl")
            if not asset or not upload_url:
                return None
            put = await client.put(
                upload_url,
                content=raw,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/octet-stream",
                },
            )
            if put.status_code in (200, 201, 204):
                return asset
    except Exception as e:
        logger.warning(f"LinkedIn {kind} upload failed: {e}")
    return None


async def _linkedin_wait_asset(token: str, asset: str, tries: int = 40) -> str:
    """Wait until LinkedIn has processed an uploaded video. "" when ready, else the reason."""
    import asyncio

    aid = asset.rsplit(":", 1)[-1]
    async with httpx.AsyncClient(timeout=20.0) as client:
        for _ in range(tries):
            res = await client.get(f"https://api.linkedin.com/v2/assets/{aid}", headers={"Authorization": f"Bearer {token}"})
            if res.status_code == 200:
                recipes = (res.json() or {}).get("recipes") or [{}]
                status = str((recipes[0] or {}).get("status") or "").upper()
                if status == "AVAILABLE":
                    return ""
                if status in ("PROCESSING_FAILED", "CLIENT_ERROR"):
                    return "LinkedIn could not process the video. Check its format (MP4, H.264) and try again."
            await asyncio.sleep(3)
    return ""  # still processing: post anyway; LinkedIn shows it once ready


async def _publish_x(account, token: str, text: str, items: List[Dict[str, Any]], reply_to: str = "") -> Dict[str, Any]:
    extra = account.extra if isinstance(account.extra, dict) else {}
    api_key = extra.get("apiKey") or extra.get("consumerKey") or ""
    api_secret = extra.get("apiSecret") or extra.get("consumerSecret") or ""
    token_secret = (account.token_secret or extra.get("accessTokenSecret") or "").strip()
    oauth1 = bool(api_key and api_secret and token_secret)
    tweet: Dict[str, Any] = {"text": (text or "")[:280]}
    if reply_to:
        tweet["reply"] = {"in_reply_to_tweet_id": reply_to}
    media_ids = []
    videos = [m for m in items if m["kind"] == "video"]
    for m in (videos[:1] or items[:MEDIA_RULES["x"]["images"]]):
        if m["kind"] == "video":
            mid = await (_x_upload_video(api_key, api_secret, token, token_secret, m["url"]) if oauth1
                         else _x_upload_video_v2(token, m["url"]))
            if not mid:
                return {"ok": False, "platform": "x", "error": "X did not accept the video upload. Check it is an MP4 under 2:20, then try again."}
        elif oauth1:
            mid = await _x_upload_media(api_key, api_secret, token, token_secret, m["url"], m.get("alt", ""))
        else:
            # Accounts connected with "Connect" (OAuth 2.0) upload through the v2 media endpoint.
            mid = await _x_upload_media_v2(token, m["url"], m.get("alt", ""))
        if mid:
            media_ids.append(str(mid))
        else:
            logger.warning("X image upload failed; that picture is left out.")
    if media_ids:
        tweet["media"] = {"media_ids": media_ids}

    headers = {"Content-Type": "application/json"}
    if oauth1:
        headers["Authorization"] = _oauth1_header(
            "POST", "https://api.twitter.com/2/tweets", api_key, api_secret, token, token_secret
        )
    else:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post("https://api.twitter.com/2/tweets", headers=headers, json=tweet)
        if res.status_code in (200, 201):
            tid = ((res.json() or {}).get("data") or {}).get("id") or ""
            handle = (account.handle or "").lstrip("@")
            url = f"https://x.com/{handle}/status/{tid}" if tid else ""
            return {"ok": True, "platform": "x", "id": tid, "url": url}
        return {"ok": False, "platform": "x", "error": f"{res.status_code}: {res.text[:300]}"}


X_UPLOAD_V1 = "https://upload.twitter.com/1.1/media/upload.json"
X_CHUNK = 4 * 1024 * 1024


async def _x_upload_media(api_key, api_secret, token, token_secret, image_url: str, alt_text: str = "") -> Optional[str]:
    raw, mime = await fetch_image_bytes(image_url)
    if not raw:
        return None
    auth = _oauth1_header("POST", X_UPLOAD_V1, api_key, api_secret, token, token_secret)
    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            res = await client.post(
                X_UPLOAD_V1,
                headers={"Authorization": auth},
                files={"media": ("image.png", raw, mime or "image/png")},
            )
            if res.status_code in (200, 201):
                mid = str((res.json() or {}).get("media_id_string") or (res.json() or {}).get("media_id") or "")
                if mid and alt_text:
                    meta_url = "https://upload.twitter.com/1.1/media/metadata/create.json"
                    await client.post(meta_url, json={"media_id": mid, "alt_text": {"text": alt_text}},
                                      headers={"Authorization": _oauth1_header("POST", meta_url, api_key, api_secret, token, token_secret)})
                return mid
    except Exception as e:
        logger.warning(f"X media upload failed: {e}")
    return None


async def _x_upload_media_v2(token: str, image_url: str, alt_text: str = "") -> Optional[str]:
    """Image upload for OAuth 2.0 logins (needs the media.write scope)."""
    raw, mime = await fetch_image_bytes(image_url)
    if not raw:
        return None
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(
                "https://api.x.com/2/media/upload",
                headers=headers,
                data={"media_category": "tweet_image"},
                files={"media": ("image", raw, mime or "image/png")},
            )
            if res.status_code not in (200, 201):
                logger.warning(f"X v2 media upload {res.status_code}: {res.text[:200]}")
                return None
            body = res.json() or {}
            mid = str((body.get("data") or {}).get("id") or body.get("media_id_string") or "")
            if mid and alt_text:
                await client.post("https://api.x.com/2/media/metadata", headers=headers,
                                  json={"id": mid, "metadata": {"alt_text": {"text": alt_text}}})
            return mid or None
    except Exception as e:
        logger.warning(f"X v2 media upload failed: {e}")
    return None


async def _x_wait(client, status_url: str, headers_for, media_id: str, tries: int = 60) -> bool:
    """Poll X until an uploaded video is processed. headers_for(url) gives the auth headers."""
    import asyncio

    for _ in range(tries):
        res = await client.get(status_url, headers=headers_for(status_url))
        info = {}
        if res.status_code == 200:
            body = res.json() or {}
            info = (body.get("data") or body).get("processing_info") or {}
        state = str(info.get("state") or "succeeded").lower()
        if state == "succeeded":
            return True
        if state == "failed":
            logger.warning(f"X video processing failed: {info}")
            return False
        await asyncio.sleep(min(int(info.get("check_after_secs") or 3), 10))
    return False


async def _x_upload_video(api_key, api_secret, token, token_secret, url: str) -> Optional[str]:
    """Chunked video upload for OAuth 1.0a keys (INIT, APPEND, FINALIZE, STATUS). Form fields go in the
    query string so they are part of the signature; the file part of APPEND is not signed."""
    raw, mime = await media_bytes(url, "video")
    if not raw:
        return None

    def signed(method: str, u: str) -> Dict[str, str]:
        return {"Authorization": _oauth1_header(method, u, api_key, api_secret, token, token_secret)}

    q = urllib.parse.urlencode
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            init = f"{X_UPLOAD_V1}?{q({'command': 'INIT', 'total_bytes': len(raw), 'media_type': mime, 'media_category': 'tweet_video'})}"
            res = await client.post(init, headers=signed("POST", init))
            mid = str((res.json() or {}).get("media_id_string") or "") if res.status_code in (200, 201, 202) else ""
            if not mid:
                logger.warning(f"X video INIT {res.status_code}: {res.text[:200]}")
                return None
            for i in range(0, len(raw), X_CHUNK):
                part = f"{X_UPLOAD_V1}?{q({'command': 'APPEND', 'media_id': mid, 'segment_index': i // X_CHUNK})}"
                res = await client.post(part, headers=signed("POST", part), files={"media": ("video", raw[i:i + X_CHUNK], mime)})
                if res.status_code not in (200, 201, 204):
                    logger.warning(f"X video APPEND {res.status_code}: {res.text[:200]}")
                    return None
            fin = f"{X_UPLOAD_V1}?{q({'command': 'FINALIZE', 'media_id': mid})}"
            res = await client.post(fin, headers=signed("POST", fin))
            if res.status_code not in (200, 201):
                logger.warning(f"X video FINALIZE {res.status_code}: {res.text[:200]}")
                return None
            status = f"{X_UPLOAD_V1}?{q({'command': 'STATUS', 'media_id': mid})}"
            return mid if await _x_wait(client, status, lambda u: signed("GET", u), mid) else None
    except Exception as e:
        logger.warning(f"X video upload failed: {e}")
    return None


async def _x_upload_video_v2(token: str, url: str) -> Optional[str]:
    """Chunked video upload for OAuth 2.0 logins (initialize, append, finalize, then wait)."""
    raw, mime = await media_bytes(url, "video")
    if not raw:
        return None
    base = "https://api.x.com/2/media/upload"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            res = await client.post(f"{base}/initialize", headers=headers,
                                    json={"media_type": mime, "total_bytes": len(raw), "media_category": "tweet_video"})
            mid = str(((res.json() or {}).get("data") or {}).get("id") or "") if res.status_code in (200, 201, 202) else ""
            if not mid:
                logger.warning(f"X v2 video initialize {res.status_code}: {res.text[:200]}")
                return None
            for i in range(0, len(raw), X_CHUNK):
                res = await client.post(f"{base}/{mid}/append", headers=headers, data={"segment_index": str(i // X_CHUNK)},
                                        files={"media": ("video", raw[i:i + X_CHUNK], mime)})
                if res.status_code not in (200, 201, 204):
                    logger.warning(f"X v2 video append {res.status_code}: {res.text[:200]}")
                    return None
            res = await client.post(f"{base}/{mid}/finalize", headers=headers)
            if res.status_code not in (200, 201):
                logger.warning(f"X v2 video finalize {res.status_code}: {res.text[:200]}")
                return None
            status = f"{base}?{urllib.parse.urlencode({'command': 'STATUS', 'media_id': mid})}"
            return mid if await _x_wait(client, status, lambda u: headers, mid) else None
    except Exception as e:
        logger.warning(f"X v2 video upload failed: {e}")
    return None


async def _publish_facebook(account, token: str, text: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    extra = account.extra if isinstance(account.extra, dict) else {}
    page_id = (account.account_id or extra.get("pageId") or "").strip()
    if not page_id:
        tested = await _test_facebook(account, token)
        if not tested.get("ok"):
            return {"ok": False, "platform": "facebook", "error": tested.get("error")}
        page_id = account.account_id
    params = {"access_token": token}
    text = (text or "")[:TEXT_LIMITS["facebook"]]
    graph = "https://graph.facebook.com/v21.0"
    video = next((m for m in items if m["kind"] == "video"), None)
    images = [m for m in items if m["kind"] == "image"][:MEDIA_RULES["facebook"]["images"]]
    async with httpx.AsyncClient(timeout=120.0 if video else 40.0) as client:
        if video:
            res = await client.post(f"https://graph-video.facebook.com/v21.0/{page_id}/videos",
                                    data={**params, "file_url": video["url"], "description": text})
            if res.status_code not in (200, 201):
                return {"ok": False, "platform": "facebook", "error": f"video {res.status_code}: {res.text[:300]}"}
            vid = (res.json() or {}).get("id") or ""
            link = await _graph_permalink(client, vid, token, "permalink_url")
            url = ("https://www.facebook.com" + link) if link.startswith("/") else (link or f"https://www.facebook.com/{page_id}/videos/{vid}")
            return {"ok": True, "platform": "facebook", "id": vid, "url": url}
        if len(images) > 1:
            # Several pictures: upload each unpublished, then one feed post that carries them all.
            ids = []
            for m in images:
                r = await client.post(f"{graph}/{page_id}/photos", data={**params, "url": m["url"], "published": "false"})
                if r.status_code not in (200, 201) or not (r.json() or {}).get("id"):
                    return {"ok": False, "platform": "facebook", "error": f"photo {r.status_code}: {r.text[:300]}"}
                ids.append(r.json()["id"])
            data = {**params, "message": text}
            for i, fid in enumerate(ids):
                data[f"attached_media[{i}]"] = json.dumps({"media_fbid": fid})
            res = await client.post(f"{graph}/{page_id}/feed", data=data)
        elif images:
            res = await client.post(f"{graph}/{page_id}/photos", data={**params, "url": images[0]["url"], "caption": text})
        else:
            res = await client.post(f"{graph}/{page_id}/feed", data={**params, "message": text})
        if res.status_code in (200, 201):
            body = res.json() or {}
            # A photo returns its photo id plus the feed post id; comments and insights need the post id.
            pid = body.get("post_id") or body.get("id") or ""
            url = await _graph_permalink(client, pid, token, "permalink_url") or (f"https://www.facebook.com/{pid}" if pid else "")
            return {"ok": True, "platform": "facebook", "id": pid, "url": url}
        return {"ok": False, "platform": "facebook", "error": f"{res.status_code}: {res.text[:300]}"}


async def _graph_permalink(client: httpx.AsyncClient, remote_id: str, token: str, field: str = "permalink",
                           base: str = "https://graph.facebook.com/v21.0") -> str:
    """The public link of a just-published post, or "" when the network does not say."""
    if not remote_id:
        return ""
    try:
        res = await client.get(f"{base}/{remote_id}", params={"fields": field, "access_token": token})
        if res.status_code == 200:
            return str((res.json() or {}).get(field) or "")
    except Exception as e:
        logger.info(f"Permalink lookup failed for {remote_id}: {e}")
    return ""


async def _wait_container(client: httpx.AsyncClient, base: str, cid: str, token: str, tries: int = 10, delay: float = 2) -> str:
    """Wait until a media container is ready to publish. Returns "" when ready, else the reason.
    Instagram reports the state in status_code; Threads in status."""
    import asyncio

    for _ in range(tries):
        res = await client.get(f"{base}/{cid}", params={"fields": "status_code,status", "access_token": token})
        body = (res.json() or {}) if res.status_code == 200 else {}
        code = str(body.get("status_code") or body.get("status") or "").split(":")[0].strip().upper()
        if code in ("FINISHED", "PUBLISHED", ""):
            return ""
        if code in ("ERROR", "EXPIRED"):
            why = body.get("error_message") or body.get("status") or "the network could not process the file"
            return f"media {code.lower()}: {why}"
        await asyncio.sleep(delay)
    return ""  # still processing: try publishing anyway; the network says if it is not ready


async def _publish_instagram(account, token: str, text: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    ig_id = (account.account_id or "").strip()
    if not ig_id:
        return {"ok": False, "platform": "instagram", "error": "Instagram business account ID missing."}
    items = [m for m in items if m.get("url") and not str(m["url"]).startswith("data:")]
    if not items:
        return {"ok": False, "platform": "instagram", "error": "Instagram needs a public image URL. Generate a visual first."}
    graph = "https://graph.facebook.com/v21.0"
    has_video = any(m["kind"] == "video" for m in items)
    async with httpx.AsyncClient(timeout=60.0) as client:

        async def container(data: Dict[str, Any], alt: str = "") -> Tuple[str, str]:
            data = {**data, "access_token": token}
            if alt:
                data["alt_text"] = alt
            res = await client.post(f"{graph}/{ig_id}/media", data=data)
            if res.status_code not in (200, 201) and alt:
                # Older Graph versions refuse alt_text: post without it rather than fail.
                data.pop("alt_text", None)
                res = await client.post(f"{graph}/{ig_id}/media", data=data)
            if res.status_code not in (200, 201) or not (res.json() or {}).get("id"):
                return "", f"container {res.status_code}: {res.text[:300]}"
            return res.json()["id"], ""

        if len(items) == 1:
            m = items[0]
            if m["kind"] == "video":
                cid, err = await container({"media_type": "REELS", "video_url": m["url"], "caption": text[:2200], "share_to_feed": "true"})
            else:
                cid, err = await container({"image_url": m["url"], "caption": text[:2200]}, m.get("alt", ""))
        else:
            children = []
            for m in items[:MEDIA_RULES["instagram"]["items"]]:
                if m["kind"] == "video":
                    cid, err = await container({"media_type": "VIDEO", "video_url": m["url"], "is_carousel_item": "true"})
                else:
                    cid, err = await container({"image_url": m["url"], "is_carousel_item": "true"}, m.get("alt", ""))
                if err:
                    return {"ok": False, "platform": "instagram", "error": err}
                if m["kind"] == "video":
                    not_ready = await _wait_container(client, graph, cid, token, tries=60, delay=5)
                    if not_ready:
                        return {"ok": False, "platform": "instagram", "error": not_ready}
                children.append(cid)
            cid, err = await container({"media_type": "CAROUSEL", "children": ",".join(children), "caption": text[:2200]})
        if err:
            return {"ok": False, "platform": "instagram", "error": err}
        not_ready = await _wait_container(client, graph, cid, token, tries=60 if has_video else 10, delay=5 if has_video else 2)
        if not_ready:
            return {"ok": False, "platform": "instagram", "error": not_ready}
        pub = await client.post(
            f"{graph}/{ig_id}/media_publish",
            data={"creation_id": cid, "access_token": token},
        )
        if pub.status_code in (200, 201):
            mid = (pub.json() or {}).get("id") or cid
            url = await _graph_permalink(client, mid, token)
            return {"ok": True, "platform": "instagram", "id": mid, "url": url}
        return {"ok": False, "platform": "instagram", "error": f"publish {pub.status_code}: {pub.text[:300]}"}


async def _publish_threads(account, token: str, text: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    uid = (account.account_id or "").strip()
    if not uid:
        tested = await _test_threads(account, token)
        if not tested.get("ok"):
            return {"ok": False, "platform": "threads", "error": tested.get("error")}
        uid = account.account_id
    threads = "https://graph.threads.net/v1.0"
    items = [m for m in items if m.get("url") and not str(m["url"]).startswith("data:")]
    has_video = any(m["kind"] == "video" for m in items)

    def media_fields(m: Dict[str, Any]) -> Dict[str, str]:
        if m["kind"] == "video":
            return {"media_type": "VIDEO", "video_url": m["url"]}
        d = {"media_type": "IMAGE", "image_url": m["url"]}
        if m.get("alt"):
            d["alt_text"] = m["alt"]
        return d

    async with httpx.AsyncClient(timeout=60.0) as client:

        async def container(data: Dict[str, str]) -> Tuple[str, str]:
            res = await client.post(f"{threads}/{uid}/threads", data={**data, "access_token": token})
            if res.status_code not in (200, 201) or not (res.json() or {}).get("id"):
                return "", f"container {res.status_code}: {res.text[:300]}"
            return res.json()["id"], ""

        if len(items) > 1:
            children = []
            for m in items[:MEDIA_RULES["threads"]["items"]]:
                cid, err = await container({**media_fields(m), "is_carousel_item": "true"})
                if err:
                    return {"ok": False, "platform": "threads", "error": err}
                not_ready = await _wait_container(client, threads, cid, token, tries=60 if m["kind"] == "video" else 10,
                                                  delay=5 if m["kind"] == "video" else 2)
                if not_ready:
                    return {"ok": False, "platform": "threads", "error": not_ready}
                children.append(cid)
            cid, err = await container({"media_type": "CAROUSEL", "children": ",".join(children), "text": text[:500]})
        elif items:
            cid, err = await container({**media_fields(items[0]), "text": text[:500]})
        else:
            cid, err = await container({"media_type": "TEXT", "text": text[:500]})
        if err:
            return {"ok": False, "platform": "threads", "error": err}
        if items:
            not_ready = await _wait_container(client, threads, cid, token, tries=60 if has_video else 10, delay=5 if has_video else 2)
            if not_ready:
                return {"ok": False, "platform": "threads", "error": not_ready}
        pub = await client.post(
            f"{threads}/{uid}/threads_publish",
            data={"creation_id": cid, "access_token": token},
        )
        if pub.status_code in (200, 201):
            tid = (pub.json() or {}).get("id") or cid
            url = await _graph_permalink(client, tid, token, base=threads)
            return {"ok": True, "platform": "threads", "id": tid, "url": url}
        return {"ok": False, "platform": "threads", "error": f"publish {pub.status_code}: {pub.text[:300]}"}


# ── Reddit ──────────────────────────────────────────────────────────────────
REDDIT_API = "https://oauth.reddit.com"


def reddit_user_agent() -> str:
    """Reddit refuses API calls without a descriptive User-Agent naming the app."""
    import os

    return (os.getenv("REDDIT_USER_AGENT") or "web:outreach-aivhub:1.0 (by /u/aivhub)").strip()


def _reddit_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"bearer {token}", "User-Agent": reddit_user_agent()}


def subreddit_name(raw: Any) -> str:
    return re.sub(r"^/?r/", "", str(raw or "").strip(), flags=re.I).strip("/ ")


async def _test_reddit(account, token: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(f"{REDDIT_API}/api/v1/me", headers=_reddit_headers(token))
        if res.status_code == 200:
            data = res.json() or {}
            name = data.get("name") or ""
            account.handle = f"u/{name}" if name else (account.handle or "Reddit")
            if data.get("id"):
                account.account_id = data["id"]
            return {"ok": True, "handle": account.handle, "accountId": account.account_id}
        return {"ok": False, "error": f"Reddit {res.status_code}: {res.text[:240]}"}


async def _reddit_upload(client: httpx.AsyncClient, token: str, url: str) -> Tuple[str, str]:
    """Upload a picture to Reddit's own image host. Returns (asset_id, hosted_url) or ("", "")."""
    raw, mime = await fetch_image_bytes(url)
    if not raw:
        return "", ""
    ext = {"image/png": "png", "image/webp": "webp"}.get(mime, "jpg")
    lease = await client.post(f"{REDDIT_API}/api/media/asset.json", headers=_reddit_headers(token),
                              data={"filepath": f"image.{ext}", "mimetype": mime})
    if lease.status_code != 200:
        logger.warning(f"Reddit media lease {lease.status_code}: {lease.text[:200]}")
        return "", ""
    body = lease.json() or {}
    args = body.get("args") or {}
    action = str(args.get("action") or "")
    action = "https:" + action if action.startswith("//") else action
    fields = {f.get("name"): f.get("value") for f in args.get("fields") or []}
    up = await client.post(action, data=fields, files={"file": (f"image.{ext}", raw, mime)})
    if up.status_code not in (200, 201, 204):
        logger.warning(f"Reddit image upload {up.status_code}: {up.text[:200]}")
        return "", ""
    return str((body.get("asset") or {}).get("asset_id") or ""), f"{action}/{fields.get('key', '')}"


async def _reddit_find_new(client: httpx.AsyncClient, token: str, account, title: str, sub: str) -> Tuple[str, str]:
    """An image post's id is not in the submit reply: find it in the account's newest posts."""
    import asyncio

    name = (account.handle or "").replace("u/", "").strip()
    for _ in range(8):
        await asyncio.sleep(2)
        res = await client.get(f"{REDDIT_API}/user/{name}/submitted", headers=_reddit_headers(token),
                               params={"limit": 5, "sort": "new", "raw_json": 1})
        for child in ((res.json() or {}).get("data") or {}).get("children") or [] if res.status_code == 200 else []:
            d = child.get("data") or {}
            if d.get("title") == title and str(d.get("subreddit") or "").lower() == sub.lower():
                return str(d.get("name") or ""), "https://www.reddit.com" + str(d.get("permalink") or "")
    return "", ""


async def _publish_reddit(account, token: str, text: str, items: List[Dict[str, Any]], title: str,
                          options: Dict[str, Any]) -> Dict[str, Any]:
    sub = subreddit_name(options.get("subreddit"))
    if not sub:
        return {"ok": False, "platform": "reddit", "error": "400: Pick the subreddit to post in."}
    title = (title or text.split("\n")[0] or "Post").strip()[:REDDIT_TITLE_LIMIT]
    images = [m for m in items if m["kind"] == "image"][:MEDIA_RULES["reddit"]["images"]]
    flair = str(options.get("flair") or "").strip()
    async with httpx.AsyncClient(timeout=60.0) as client:
        caption_comment = ""
        if len(images) > 1:
            assets = []
            for m in images:
                aid, _ = await _reddit_upload(client, token, m["url"])
                if not aid:
                    return {"ok": False, "platform": "reddit", "error": "Reddit did not accept a picture upload. Try again later."}
                assets.append({"media_id": aid, "caption": (m.get("alt") or "")[:180], "outbound_url": ""})
            body = {"sr": sub, "title": title, "items": assets, "api_type": "json", "show_error_list": True,
                    "sendreplies": True, "nsfw": False, "spoiler": False}
            if flair:
                body["flair_id"] = flair
            res = await client.post(f"{REDDIT_API}/api/submit_gallery_post.json", headers=_reddit_headers(token), json=body)
            caption_comment = text
        else:
            data = {"sr": sub, "title": title, "api_type": "json", "resubmit": "true", "sendreplies": "true"}
            if flair:
                data["flair_id"] = flair
            if images:
                _, hosted = await _reddit_upload(client, token, images[0]["url"])
                if not hosted:
                    return {"ok": False, "platform": "reddit", "error": "Reddit did not accept the picture upload. Try again later."}
                data.update({"kind": "image", "url": hosted})
                caption_comment = text
            else:
                data.update({"kind": "self", "text": text})
            res = await client.post(f"{REDDIT_API}/api/submit", headers=_reddit_headers(token), data=data)
        if res.status_code != 200:
            return {"ok": False, "platform": "reddit", "error": f"{res.status_code}: {res.text[:300]}"}
        reply = (res.json() or {}).get("json") or {}
        if reply.get("errors"):
            # e.g. [["SUBREDDIT_NOEXIST", "that subreddit doesn't exist", "sr"]]
            why = "; ".join(str(e[1] if isinstance(e, list) and len(e) > 1 else e) for e in reply["errors"])
            return {"ok": False, "platform": "reddit", "error": f"400: Reddit refused the post: {why}"}
        data = reply.get("data") or {}
        name = str(data.get("name") or data.get("id") or "")
        if name and not name.startswith("t3_"):
            name = "t3_" + name
        url = str(data.get("url") or "")
        if not name:
            name, url = await _reddit_find_new(client, token, account, title, sub)
        out = {"ok": True, "platform": "reddit", "id": name, "url": url}
        if caption_comment.strip() and name:
            # Picture posts carry no body text on Reddit: the caption goes in as the author's first comment.
            out["captionComment"] = caption_comment.strip()
        return out


def pick_account_for_channel(accounts: List[Any], channel: str) -> Optional[Any]:
    plat = normalize_platform(channel)
    matches = [a for a in accounts if normalize_platform(a.platform) == plat and (a.status in ("connected", "ok") or (a.access_token or "").strip())]
    if not matches:
        return None
    defaults = [a for a in matches if a.is_default]
    return defaults[0] if defaults else matches[0]


# Test mode: nothing leaves the app. Outcomes a user can rehearse, and the error each one gives.
TEST_OUTCOMES = {
    "login": "401: Test mode: the network refused the login (a test of what a disconnected account looks like).",
    "busy": "503: Test mode: the network was busy (a test of automatic retries).",
    "refused": "400: Test mode: the network refused the post (a test of a refused post).",
}


def _test_result(plat: str, text: str, outcome: str) -> Dict[str, Any]:
    if outcome in TEST_OUTCOMES:
        return {"ok": False, "platform": plat, "error": TEST_OUTCOMES[outcome], "test": True}
    return {"ok": True, "platform": plat, "id": f"test_{uuid.uuid4().hex[:10]}", "url": "", "test": True,
            "text": text[:4000]}


async def publish_post_to_accounts(post, accounts: List[Any], public_base: Optional[str] = None,
                                   rewrite=None, test: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Send the post to each of its channels. rewrite(text, platform) -> text swaps links for tracked
    ones. test = {"outcome": "ok|login|busy|refused"} runs the whole flow without posting anything."""
    from app.services.media_store import persist_image_url
    channels = post.channels or ["linkedin"]
    if isinstance(channels, str):
        channels = [channels]
    items = post_media(post)
    for m in items:
        m["url"] = persist_image_url(m["url"], public_base)
    if items and items[0]["kind"] == "image" and (getattr(post, "image_url", None) or "") != items[0]["url"]:
        post.image_url = items[0]["url"]
    results = []
    for ch in channels:
        plat = normalize_platform(ch)
        text = copy_for_platform(post, plat)
        first_comment = getattr(post, "first_comment", None) or ""
        if rewrite:
            text = await rewrite(text, plat)
            first_comment = await rewrite(first_comment, plat) if first_comment else ""
        if test is not None:
            results.append(_test_result(plat, text, str(test.get("outcome") or "ok")))
            continue
        acc = pick_account_for_channel(accounts, plat)
        if not acc:
            results.append({
                "ok": False,
                "platform": plat,
                "error": f"No connected {TITLES.get(plat, plat)} account. Connect it under Accounts.",
            })
            continue
        result = await publish_to_account(acc, text, media=[dict(m) for m in items],
                                          alt_text=getattr(post, "alt_text", None) or "", first_comment=first_comment,
                                          title=getattr(post, "title", None) or "", options=channel_options(post, plat))
        result["accountId"] = acc.id
        result["handle"] = acc.handle
        results.append(result)
    for r in results:
        if not r.get("ok"):
            r["kind"] = failure_kind(r)

    ok_any = any(r.get("ok") for r in results)
    ok_all = bool(results) and all(r.get("ok") for r in results)
    return {
        "ok": ok_any,
        "allOk": ok_all,
        "results": results,
    }
