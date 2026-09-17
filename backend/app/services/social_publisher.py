"""Publish approved social posts to connected LinkedIn, X, Facebook, Instagram, and Threads accounts."""
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
    t = (token or "").strip()
    if not t:
        return ""
    if len(t) <= 8:
        return "••••"
    return t[:3] + "••••" + t[-4:]


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
        "hasToken": bool((acc.access_token or "").strip()),
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
    token = (account.access_token or "").strip()
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
            account.handle = account.handle or name
            return {"ok": True, "handle": name, "accountId": account.account_id, "raw": {"sub": sub}}
        # Legacy me
        res2 = await client.get("https://api.linkedin.com/v2/me", headers=headers)
        if res2.status_code == 200:
            data = res2.json()
            lid = data.get("id") or ""
            if lid and not (account.account_id or "").strip():
                account.account_id = lid
            return {"ok": True, "handle": account.handle or lid, "accountId": lid}
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


async def publish_to_account(account, text: str, image_url: Optional[str] = None) -> Dict[str, Any]:
    platform = normalize_platform(account.platform)
    token = (account.access_token or "").strip()
    if not token:
        return {"ok": False, "platform": platform, "error": "No access token on this account."}
    try:
        if platform == "linkedin":
            return await _publish_linkedin(account, token, text, image_url)
        if platform == "x":
            return await _publish_x(account, token, text, image_url)
        if platform == "facebook":
            return await _publish_facebook(account, token, text, image_url)
        if platform == "instagram":
            return await _publish_instagram(account, token, text, image_url)
        if platform == "threads":
            return await _publish_threads(account, token, text, image_url)
        return {"ok": False, "platform": platform, "error": f"Unsupported platform {platform}"}
    except Exception as e:
        logger.exception(f"Publish failed ({platform})")
        return {"ok": False, "platform": platform, "error": str(e)}


def _linkedin_author(account) -> str:
    extra = account.extra if isinstance(account.extra, dict) else {}
    aid = (account.account_id or extra.get("orgId") or "").strip()
    if aid.startswith("urn:"):
        return aid
    if extra.get("authorType") == "organization" or extra.get("orgId"):
        return f"urn:li:organization:{aid or extra.get('orgId')}"
    return f"urn:li:person:{aid}" if aid else ""


async def _publish_linkedin(account, token: str, text: str, image_url: Optional[str]) -> Dict[str, Any]:
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
    media_urn = None
    if image_url:
        media_urn = await _linkedin_upload_image(token, author, image_url)
        if media_urn:
            share["shareMediaCategory"] = "IMAGE"
            share["media"] = [{
                "status": "READY",
                "description": {"text": (share["shareCommentary"]["text"] or "")[:200]},
                "media": media_urn,
                "title": {"text": "Post image"},
            }]
        else:
            logger.warning("LinkedIn image upload failed — posting text only, no image URL in caption.")

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


async def _linkedin_upload_image(token: str, author: str, image_url: str) -> Optional[str]:
    raw, mime = await fetch_image_bytes(image_url)
    if not raw:
        return None
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
    }
    register = {
        "registerUploadRequest": {
            "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
            "owner": author,
            "serviceRelationships": [{
                "relationshipType": "OWNER",
                "identifier": "urn:li:userGeneratedContent",
            }],
        }
    }
    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
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
        logger.warning(f"LinkedIn image upload failed: {e}")
    return None


async def _publish_x(account, token: str, text: str, image_url: Optional[str]) -> Dict[str, Any]:
    extra = account.extra if isinstance(account.extra, dict) else {}
    api_key = extra.get("apiKey") or extra.get("consumerKey") or ""
    api_secret = extra.get("apiSecret") or extra.get("consumerSecret") or ""
    token_secret = (account.token_secret or extra.get("accessTokenSecret") or "").strip()
    tweet = {"text": (text or "")[:280]}
    media_id = None
    if image_url and api_key and api_secret and token_secret:
        media_id = await _x_upload_media(api_key, api_secret, token, token_secret, image_url)
        if media_id:
            tweet["media"] = {"media_ids": [str(media_id)]}
    elif image_url and not tweet["text"].endswith(image_url) and len(tweet["text"]) < 240:
        tweet["text"] = (tweet["text"] + " " + image_url)[:280]

    headers = {"Content-Type": "application/json"}
    if api_key and api_secret and token_secret:
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


async def _x_upload_media(api_key, api_secret, token, token_secret, image_url: str) -> Optional[str]:
    raw, mime = await fetch_image_bytes(image_url)
    if not raw:
        return None
    url = "https://upload.twitter.com/1.1/media/upload.json"
    auth = _oauth1_header("POST", url, api_key, api_secret, token, token_secret)
    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            res = await client.post(
                url,
                headers={"Authorization": auth},
                files={"media": ("image.png", raw, mime or "image/png")},
            )
            if res.status_code in (200, 201):
                return str((res.json() or {}).get("media_id_string") or (res.json() or {}).get("media_id") or "")
    except Exception as e:
        logger.warning(f"X media upload failed: {e}")
    return None


async def _publish_facebook(account, token: str, text: str, image_url: Optional[str]) -> Dict[str, Any]:
    extra = account.extra if isinstance(account.extra, dict) else {}
    page_id = (account.account_id or extra.get("pageId") or "").strip()
    if not page_id:
        tested = await _test_facebook(account, token)
        if not tested.get("ok"):
            return {"ok": False, "platform": "facebook", "error": tested.get("error")}
        page_id = account.account_id
    params = {"access_token": token}
    async with httpx.AsyncClient(timeout=40.0) as client:
        if image_url and not str(image_url).startswith("data:"):
            res = await client.post(
                f"https://graph.facebook.com/v21.0/{page_id}/photos",
                data={**params, "url": image_url, "caption": text[:2000]},
            )
        elif image_url and str(image_url).startswith("data:"):
            raw, mime = await fetch_image_bytes(image_url)
            res = await client.post(
                f"https://graph.facebook.com/v21.0/{page_id}/photos",
                data={**params, "caption": text[:2000]},
                files={"source": ("image.png", raw, mime)},
            ) if raw else await client.post(
                f"https://graph.facebook.com/v21.0/{page_id}/feed",
                data={**params, "message": text[:2000]},
            )
        else:
            res = await client.post(
                f"https://graph.facebook.com/v21.0/{page_id}/feed",
                data={**params, "message": text[:2000]},
            )
        if res.status_code in (200, 201):
            pid = (res.json() or {}).get("id") or (res.json() or {}).get("post_id") or ""
            url = f"https://facebook.com/{pid}" if pid else ""
            return {"ok": True, "platform": "facebook", "id": pid, "url": url}
        return {"ok": False, "platform": "facebook", "error": f"{res.status_code}: {res.text[:300]}"}


async def _publish_instagram(account, token: str, text: str, image_url: Optional[str]) -> Dict[str, Any]:
    ig_id = (account.account_id or "").strip()
    if not ig_id:
        return {"ok": False, "platform": "instagram", "error": "Instagram business account ID missing."}
    if image_url and str(image_url).startswith("data:"):
        from app.services.media_store import persist_image_url
        image_url = persist_image_url(image_url)
    if not image_url or str(image_url).startswith("data:"):
        return {"ok": False, "platform": "instagram", "error": "Instagram needs a public image URL. Generate a visual first."}
    async with httpx.AsyncClient(timeout=45.0) as client:
        create = await client.post(
            f"https://graph.facebook.com/v21.0/{ig_id}/media",
            data={"image_url": image_url, "caption": text[:2200], "access_token": token},
        )
        if create.status_code not in (200, 201):
            return {"ok": False, "platform": "instagram", "error": f"container {create.status_code}: {create.text[:300]}"}
        creation_id = (create.json() or {}).get("id")
        if not creation_id:
            return {"ok": False, "platform": "instagram", "error": "No creation_id from Instagram."}
        pub = await client.post(
            f"https://graph.facebook.com/v21.0/{ig_id}/media_publish",
            data={"creation_id": creation_id, "access_token": token},
        )
        if pub.status_code in (200, 201):
            mid = (pub.json() or {}).get("id") or creation_id
            return {"ok": True, "platform": "instagram", "id": mid, "url": f"https://instagram.com"}
        return {"ok": False, "platform": "instagram", "error": f"publish {pub.status_code}: {pub.text[:300]}"}


async def _publish_threads(account, token: str, text: str, image_url: Optional[str]) -> Dict[str, Any]:
    uid = (account.account_id or "").strip()
    if not uid:
        tested = await _test_threads(account, token)
        if not tested.get("ok"):
            return {"ok": False, "platform": "threads", "error": tested.get("error")}
        uid = account.account_id
    data = {"access_token": token, "text": text[:500]}
    if image_url and str(image_url).startswith("data:"):
        from app.services.media_store import persist_image_url
        image_url = persist_image_url(image_url)
    if image_url and not str(image_url).startswith("data:"):
        data["media_type"] = "IMAGE"
        data["image_url"] = image_url
    else:
        data["media_type"] = "TEXT"
    async with httpx.AsyncClient(timeout=40.0) as client:
        create = await client.post(f"https://graph.threads.net/v1.0/{uid}/threads", data=data)
        if create.status_code not in (200, 201):
            return {"ok": False, "platform": "threads", "error": f"container {create.status_code}: {create.text[:300]}"}
        cid = (create.json() or {}).get("id")
        if not cid:
            return {"ok": False, "platform": "threads", "error": "No Threads container id."}
        pub = await client.post(
            f"https://graph.threads.net/v1.0/{uid}/threads_publish",
            data={"creation_id": cid, "access_token": token},
        )
        if pub.status_code in (200, 201):
            tid = (pub.json() or {}).get("id") or cid
            return {"ok": True, "platform": "threads", "id": tid, "url": "https://www.threads.net"}
        return {"ok": False, "platform": "threads", "error": f"publish {pub.status_code}: {pub.text[:300]}"}


def pick_account_for_channel(accounts: List[Any], channel: str) -> Optional[Any]:
    plat = normalize_platform(channel)
    matches = [a for a in accounts if normalize_platform(a.platform) == plat and (a.status in ("connected", "ok") or (a.access_token or "").strip())]
    if not matches:
        return None
    defaults = [a for a in matches if a.is_default]
    return defaults[0] if defaults else matches[0]


async def publish_post_to_accounts(post, accounts: List[Any], public_base: Optional[str] = None) -> Dict[str, Any]:
    from app.services.media_store import persist_image_url
    channels = post.channels or ["linkedin"]
    if isinstance(channels, str):
        channels = [channels]
    image_url = persist_image_url(getattr(post, "image_url", None), public_base)
    if image_url:
        post.image_url = image_url
    results = []
    for ch in channels:
        plat = normalize_platform(ch)
        acc = pick_account_for_channel(accounts, plat)
        if not acc:
            results.append({
                "ok": False,
                "platform": plat,
                "error": f"No connected {plat} account. Open Accounts and paste an access token.",
            })
            continue
        text = copy_for_platform(post, plat)
        result = await publish_to_account(acc, text, image_url)
        result["accountId"] = acc.id
        result["handle"] = acc.handle
        results.append(result)

    ok_any = any(r.get("ok") for r in results)
    ok_all = bool(results) and all(r.get("ok") for r in results)
    return {
        "ok": ok_any,
        "allOk": ok_all,
        "results": results,
    }
