"""OAuth 2.0 connect-flow for X, LinkedIn, Facebook, Instagram, and Threads."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import time
import urllib.parse
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.models.models import SocialAccount, SocialOAuthApp, SocialOAuthState
from app.services.social_publisher import normalize_platform, test_account

logger = logging.getLogger("social_oauth")

PLATFORMS = ("linkedin", "x", "facebook", "instagram", "threads")

SCOPES = {
    "x": "tweet.read tweet.write users.read offline.access",
    "linkedin": "openid profile email w_member_social",
    "facebook": "pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement,instagram_basic,instagram_content_publish,business_management",
    "instagram": "pages_show_list,instagram_basic,instagram_content_publish,business_management",
    "threads": "threads_basic,threads_content_publish,threads_manage_replies",
}

ENV_KEYS = {
    "x": ("X_OAUTH_CLIENT_ID", "X_OAUTH_CLIENT_SECRET"),
    "linkedin": ("LINKEDIN_OAUTH_CLIENT_ID", "LINKEDIN_OAUTH_CLIENT_SECRET"),
    "facebook": ("FACEBOOK_OAUTH_CLIENT_ID", "FACEBOOK_OAUTH_CLIENT_SECRET"),
    "instagram": ("FACEBOOK_OAUTH_CLIENT_ID", "FACEBOOK_OAUTH_CLIENT_SECRET"),
    "threads": ("THREADS_OAUTH_CLIENT_ID", "THREADS_OAUTH_CLIENT_SECRET"),
}


def default_redirect_uri(platform: str) -> str:
    base = (settings.PUBLIC_BASE_URL or "http://127.0.0.1:8000").rstrip("/")
    return f"{base}{settings.API_PREFIX}/scheduler/oauth/{platform}/callback"


def _safe_frontend(url: str) -> str:
    u = (url or "").strip().split("#")[0].split("?")[0].rstrip("/")
    if u.startswith("http://") or u.startswith("https://"):
        return u
    return (settings.FRONTEND_URL or "http://localhost:5173").rstrip("/")


def _pkce_pair() -> Tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


async def get_oauth_app(db: AsyncSession, platform: str) -> Dict[str, Any]:
    plat = normalize_platform(platform)
    lookup = plat if plat != "instagram" else "facebook"
    row = None
    res = await db.execute(select(SocialOAuthApp).where(SocialOAuthApp.platform.in_([plat, lookup])))
    rows = res.scalars().all()
    for r in rows:
        if r.platform == plat:
            row = r
            break
    if not row and plat == "instagram":
        row = next((r for r in rows if r.platform == "facebook"), None)

    client_id = (row.client_id if row else "") or ""
    client_secret = (row.client_secret if row else "") or ""
    redirect_uri = (row.redirect_uri if row else "") or ""

    env_id_key, env_secret_key = ENV_KEYS.get(plat, ("", ""))
    if not client_id and env_id_key:
        client_id = getattr(settings, env_id_key, None) or os.getenv(env_id_key) or ""
    if not client_secret and env_secret_key:
        client_secret = getattr(settings, env_secret_key, None) or os.getenv(env_secret_key) or ""
    if plat == "instagram" and not client_id:
        client_id = settings.FACEBOOK_OAUTH_CLIENT_ID or ""
        client_secret = client_secret or settings.FACEBOOK_OAUTH_CLIENT_SECRET or ""
    if plat == "threads" and not client_id:
        client_id = settings.THREADS_OAUTH_CLIENT_ID or settings.FACEBOOK_OAUTH_CLIENT_ID or ""
        client_secret = client_secret or settings.THREADS_OAUTH_CLIENT_SECRET or settings.FACEBOOK_OAUTH_CLIENT_SECRET or ""

    if not redirect_uri:
        redirect_uri = default_redirect_uri(plat)

    return {
        "platform": plat,
        "clientId": client_id.strip(),
        "clientSecret": client_secret.strip(),
        "redirectUri": redirect_uri.strip(),
        "configured": bool(client_id.strip() and client_secret.strip()),
        "callbackUrl": default_redirect_uri(plat),
    }


def public_app_dict(app: Dict[str, Any]) -> Dict[str, Any]:
    cid = app.get("clientId") or ""
    hint = ""
    if cid:
        hint = cid[:6] + "…" + cid[-4:] if len(cid) > 12 else cid[:4] + "…"
    return {
        "platform": app["platform"],
        "configured": app.get("configured", False),
        "clientIdHint": hint,
        "hasSecret": bool(app.get("clientSecret")),
        "redirectUri": app.get("redirectUri") or app.get("callbackUrl"),
        "callbackUrl": app.get("callbackUrl") or default_redirect_uri(app["platform"]),
    }


async def save_oauth_app(db: AsyncSession, platform: str, client_id: str, client_secret: str, redirect_uri: str = "") -> Dict[str, Any]:
    plat = normalize_platform(platform)
    res = await db.execute(select(SocialOAuthApp).where(SocialOAuthApp.platform == plat))
    row = res.scalars().first()
    if not row:
        row = SocialOAuthApp(platform=plat)
        db.add(row)
    if client_id is not None:
        row.client_id = client_id.strip()
    if client_secret and not str(client_secret).startswith("••"):
        row.client_secret = client_secret.strip()
    if redirect_uri is not None:
        row.redirect_uri = (redirect_uri or "").strip()
    row.updated_at = datetime.utcnow()
    await db.commit()
    return await get_oauth_app(db, plat)


async def start_oauth(db: AsyncSession, platform: str, frontend_url: str = "") -> Dict[str, Any]:
    plat = normalize_platform(platform)
    if plat not in PLATFORMS:
        return {"ok": False, "error": f"Unsupported platform {plat}"}
    app = await get_oauth_app(db, plat)
    if not app["configured"]:
        return {
            "ok": False,
            "error": f"AIVHub {plat} app is not configured. Paste Client ID + Secret once, then users can click Connect.",
            "callbackUrl": app["callbackUrl"],
        }

    verifier, challenge = _pkce_pair() if plat == "x" else ("", "")
    state_id = secrets.token_urlsafe(24)
    st = SocialOAuthState(
        id=state_id,
        platform=plat,
        code_verifier=verifier,
        frontend_url=_safe_frontend(frontend_url or settings.FRONTEND_URL or "http://localhost:5173"),
    )
    db.add(st)
    cutoff = datetime.utcnow() - timedelta(minutes=30)
    old = await db.execute(select(SocialOAuthState).where(SocialOAuthState.created_at < cutoff))
    for row in old.scalars().all():
        await db.delete(row)
    await db.commit()

    redirect = app["redirectUri"] or app["callbackUrl"]
    cid = app["clientId"]
    if plat == "x":
        q = {
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": redirect,
            "scope": SCOPES["x"],
            "state": state_id,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        url = "https://x.com/i/oauth2/authorize?" + urllib.parse.urlencode(q)
    elif plat == "linkedin":
        q = {
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": redirect,
            "state": state_id,
            "scope": SCOPES["linkedin"],
        }
        url = "https://www.linkedin.com/oauth/v2/authorization?" + urllib.parse.urlencode(q)
    elif plat == "threads":
        q = {
            "client_id": cid,
            "redirect_uri": redirect,
            "scope": SCOPES["threads"],
            "response_type": "code",
            "state": state_id,
        }
        url = "https://threads.net/oauth/authorize?" + urllib.parse.urlencode(q)
    else:
        # facebook + instagram use Facebook Login
        q = {
            "client_id": cid,
            "redirect_uri": redirect,
            "state": state_id,
            "response_type": "code",
            "scope": SCOPES[plat],
        }
        url = "https://www.facebook.com/v21.0/dialog/oauth?" + urllib.parse.urlencode(q)

    return {"ok": True, "authUrl": url, "state": state_id, "callbackUrl": redirect}


async def _exchange_x(app, code, verifier) -> Dict[str, Any]:
    token_url = "https://api.twitter.com/2/oauth2/token"
    basic = base64.b64encode(f"{app['clientId']}:{app['clientSecret']}".encode()).decode()
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": app["redirectUri"] or app["callbackUrl"],
        "code_verifier": verifier,
        "client_id": app["clientId"],
    }
    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.post(
            token_url,
            data=data,
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        if res.status_code not in (200, 201):
            return {"ok": False, "error": f"X token {res.status_code}: {res.text[:300]}"}
        tok = res.json()
        access = tok.get("access_token") or ""
        refresh = tok.get("refresh_token") or ""
        me = await client.get(
            "https://api.twitter.com/2/users/me",
            headers={"Authorization": f"Bearer {access}"},
        )
        handle = "X"
        xid = ""
        if me.status_code == 200:
            d = (me.json() or {}).get("data") or {}
            handle = d.get("username") or d.get("name") or "X"
            xid = d.get("id") or ""
        return {
            "ok": True,
            "platform": "x",
            "access_token": access,
            "refresh_token": refresh,
            "account_id": xid,
            "handle": f"@{handle}" if handle and not str(handle).startswith("@") else handle,
            "label": f"X · @{handle.lstrip('@')}",
            "extra": {"authType": "oauth2", "tokenType": tok.get("token_type")},
        }


async def _exchange_linkedin(app, code) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": app["redirectUri"] or app["callbackUrl"],
                "client_id": app["clientId"],
                "client_secret": app["clientSecret"],
            },
        )
        if res.status_code not in (200, 201):
            return {"ok": False, "error": f"LinkedIn token {res.status_code}: {res.text[:300]}"}
        tok = res.json()
        access = tok.get("access_token") or ""
        refresh = tok.get("refresh_token") or ""
        info = await client.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {access}"},
        )
        sub = ""
        name = "LinkedIn"
        if info.status_code == 200:
            d = info.json() or {}
            sub = d.get("sub") or ""
            name = d.get("name") or d.get("given_name") or "LinkedIn"
        return {
            "ok": True,
            "platform": "linkedin",
            "access_token": access,
            "refresh_token": refresh,
            "account_id": sub,
            "handle": name,
            "label": f"LinkedIn · {name}",
            "extra": {"authType": "oauth2", "authorType": "person"},
        }


async def _facebook_long_lived(app, short_token: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.get(
                "https://graph.facebook.com/v21.0/oauth/access_token",
                params={
                    "grant_type": "fb_exchange_token",
                    "client_id": app["clientId"],
                    "client_secret": app["clientSecret"],
                    "fb_exchange_token": short_token,
                },
            )
            if res.status_code == 200:
                return (res.json() or {}).get("access_token") or short_token
    except Exception as e:
        logger.warning(f"FB long-lived exchange failed: {e}")
    return short_token


async def _exchange_facebook(app, code, want_instagram: bool = False) -> Dict[str, Any]:
    redirect = app["redirectUri"] or app["callbackUrl"]
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(
            "https://graph.facebook.com/v21.0/oauth/access_token",
            params={
                "client_id": app["clientId"],
                "redirect_uri": redirect,
                "client_secret": app["clientSecret"],
                "code": code,
            },
        )
        if res.status_code not in (200, 201):
            return {"ok": False, "error": f"Facebook token {res.status_code}: {res.text[:300]}"}
        short = (res.json() or {}).get("access_token") or ""
        user_token = await _facebook_long_lived(app, short)
        pages = await client.get(
            "https://graph.facebook.com/v21.0/me/accounts",
            params={"fields": "id,name,access_token,instagram_business_account", "access_token": user_token},
        )
        page_list = ((pages.json() or {}).get("data") or []) if pages.status_code == 200 else []
        extras = []
        if want_instagram:
            for page in page_list:
                ig = page.get("instagram_business_account") or {}
                ig_id = ig.get("id") if isinstance(ig, dict) else None
                if not ig_id:
                    continue
                ig_tok = page.get("access_token") or user_token
                ig_info = await client.get(
                    f"https://graph.facebook.com/v21.0/{ig_id}",
                    params={"fields": "id,username,name", "access_token": ig_tok},
                )
                uname = ig_id
                if ig_info.status_code == 200:
                    uname = (ig_info.json() or {}).get("username") or (ig_info.json() or {}).get("name") or ig_id
                extras.append({
                    "ok": True,
                    "platform": "instagram",
                    "access_token": ig_tok,
                    "refresh_token": "",
                    "account_id": ig_id,
                    "handle": f"@{uname}" if uname and not str(uname).startswith("@") else uname,
                    "label": f"Instagram · @{str(uname).lstrip('@')}",
                    "extra": {"authType": "oauth2", "pageId": page.get("id")},
                })
            if extras:
                return extras[0] | {"also": extras[1:]}
            return {"ok": False, "error": "No Instagram professional account linked to a Facebook Page. Link IG to a Page, then Connect again."}

        if not page_list:
            return {
                "ok": False,
                "error": "Facebook login worked but no Page was returned. Create a Page and grant pages_manage_posts, then Connect again.",
            }
        page = page_list[0]
        extras = []
        for p in page_list[1:]:
            extras.append({
                "ok": True,
                "platform": "facebook",
                "access_token": p.get("access_token") or user_token,
                "refresh_token": "",
                "account_id": p.get("id") or "",
                "handle": p.get("name") or "",
                "label": f"Facebook · {p.get('name') or p.get('id')}",
                "extra": {"authType": "oauth2", "pageId": p.get("id")},
            })
        return {
            "ok": True,
            "platform": "facebook",
            "access_token": page.get("access_token") or user_token,
            "refresh_token": "",
            "account_id": page.get("id") or "",
            "handle": page.get("name") or "",
            "label": f"Facebook · {page.get('name') or page.get('id')}",
            "extra": {"authType": "oauth2", "pageId": page.get("id")},
            "also": extras,
        }


async def _exchange_threads(app, code) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.post(
            "https://graph.threads.net/oauth/access_token",
            data={
                "client_id": app["clientId"],
                "client_secret": app["clientSecret"],
                "grant_type": "authorization_code",
                "redirect_uri": app["redirectUri"] or app["callbackUrl"],
                "code": code,
            },
        )
        if res.status_code not in (200, 201):
            return {"ok": False, "error": f"Threads token {res.status_code}: {res.text[:300]}"}
        tok = res.json() or {}
        access = tok.get("access_token") or ""
        uid = str(tok.get("user_id") or "")
        # long-lived
        try:
            ll = await client.get(
                "https://graph.threads.net/access_token",
                params={
                    "grant_type": "th_exchange_token",
                    "client_secret": app["clientSecret"],
                    "access_token": access,
                },
            )
            if ll.status_code == 200:
                access = (ll.json() or {}).get("access_token") or access
        except Exception:
            pass
        uname = uid
        me = await client.get(
            f"https://graph.threads.net/v1.0/{uid or 'me'}",
            params={"fields": "id,username,name", "access_token": access},
        )
        if me.status_code == 200:
            d = me.json() or {}
            uname = d.get("username") or d.get("name") or uid
            uid = d.get("id") or uid
        return {
            "ok": True,
            "platform": "threads",
            "access_token": access,
            "refresh_token": "",
            "account_id": uid,
            "handle": f"@{uname}" if uname and not str(uname).startswith("@") else uname,
            "label": f"Threads · @{str(uname).lstrip('@')}",
            "extra": {"authType": "oauth2"},
        }


async def upsert_oauth_account(db: AsyncSession, payload: Dict[str, Any]) -> Optional[SocialAccount]:
    if not payload or not payload.get("ok"):
        return None
    plat = payload["platform"]
    account_id = payload.get("account_id") or ""
    existing = None
    if account_id:
        res = await db.execute(
            select(SocialAccount).where(SocialAccount.platform == plat, SocialAccount.account_id == account_id)
        )
        existing = res.scalars().first()
    if not existing:
        res = await db.execute(
            select(SocialAccount).where(SocialAccount.platform == plat, SocialAccount.is_default == True)  # noqa: E712
        )
        existing = res.scalars().first()
    if not existing:
        existing = SocialAccount(id=f"soc_{plat}_{secrets.token_hex(4)}", platform=plat, extra={})
        db.add(existing)
    existing.access_token = payload.get("access_token") or existing.access_token
    existing.refresh_token = payload.get("refresh_token") or existing.refresh_token or ""
    existing.account_id = account_id or existing.account_id
    existing.handle = payload.get("handle") or existing.handle
    existing.label = payload.get("label") or existing.label
    extra = dict(existing.extra) if isinstance(existing.extra, dict) else {}
    extra.update(payload.get("extra") or {})
    extra["connectedAt"] = int(time.time())
    extra["authType"] = extra.get("authType") or "oauth2"
    existing.extra = extra
    existing.is_default = True
    others = await db.execute(
        select(SocialAccount).where(SocialAccount.platform == plat, SocialAccount.id != existing.id)
    )
    for o in others.scalars().all():
        o.is_default = False
    test = await test_account(existing)
    existing.last_tested_at = datetime.utcnow().isoformat()
    if test.get("ok") or existing.access_token:
        existing.status = "connected" if test.get("ok") else "connected"
        existing.last_error = "" if test.get("ok") else (test.get("error") or "")
        if test.get("handle"):
            existing.handle = existing.handle or test["handle"]
        if test.get("accountId") and not existing.account_id:
            existing.account_id = test["accountId"]
    else:
        existing.status = "error"
        existing.last_error = test.get("error") or "Connected but profile test failed."
    return existing


async def finish_oauth(db: AsyncSession, platform: str, code: str, state: str) -> Dict[str, Any]:
    plat = normalize_platform(platform)
    res = await db.execute(select(SocialOAuthState).where(SocialOAuthState.id == state))
    st = res.scalars().first()
    if not st or st.platform != plat:
        return {"ok": False, "error": "OAuth state expired. Click Connect again."}
    frontend = st.frontend_url or settings.FRONTEND_URL
    verifier = st.code_verifier or ""
    await db.delete(st)
    await db.commit()

    app = await get_oauth_app(db, plat)
    if plat == "x":
        payload = await _exchange_x(app, code, verifier)
    elif plat == "linkedin":
        payload = await _exchange_linkedin(app, code)
    elif plat == "threads":
        payload = await _exchange_threads(app, code)
    elif plat == "instagram":
        payload = await _exchange_facebook(app, code, want_instagram=True)
    else:
        payload = await _exchange_facebook(app, code, want_instagram=False)

    if not payload.get("ok"):
        return {**payload, "frontend": frontend}

    acc = await upsert_oauth_account(db, payload)
    also = payload.get("also") or []
    extras = []
    for extra in also:
        extras.append(await upsert_oauth_account(db, extra))
    await db.commit()
    if acc:
        await db.refresh(acc)
    return {
        "ok": True,
        "platform": plat,
        "handle": acc.handle if acc else "",
        "accountId": acc.id if acc else "",
        "frontend": frontend,
        "extraCount": len([e for e in extras if e]),
    }


def callback_html(ok: bool, platform: str, handle: str = "", error: str = "", frontend: str = "") -> str:
    front = (frontend or settings.FRONTEND_URL or "http://localhost:5173").rstrip("/")
    safe_err = (error or "").replace("<", "").replace(">", "")[:280]
    q = urllib.parse.urlencode(
        {
            "oauth": "ok" if ok else "err",
            "platform": platform or "",
            "handle": handle or "",
            "error": safe_err[:120],
        }
    )
    dest = f"{front}/#/scheduler/channels?{q}"
    payload = json.dumps({
        "type": "aivhub-social-oauth",
        "ok": bool(ok),
        "platform": platform or "",
        "handle": handle or "",
        "error": safe_err,
    })
    title = "Connected" if ok else "Could not connect"
    safe_handle = (handle or "").replace("<", "").replace(">", "")
    body = ("@" + safe_handle.lstrip("@")) if ok and safe_handle else (safe_err or "You can close this window.")
    dest_js = json.dumps(dest)
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>AIVHub social connect</title></head>
<body style="font-family:Inter,system-ui,sans-serif;padding:40px;background:#F6F5F2;color:#12141C">
  <h2>{title} {platform}</h2>
  <p>{body}</p>
  <p><a href="{dest}">Back to Post Scheduler</a></p>
  <script>
    var payload = {payload};
    try {{
      localStorage.setItem("aivhub_scheduler_view", "channels");
      localStorage.setItem("aivhub_oauth_result", JSON.stringify(payload));
    }} catch (e) {{}}
    try {{
      if (window.opener) {{
        window.opener.postMessage(payload, "*");
      }}
    }} catch (e) {{}}
    setTimeout(function () {{
      if (window.opener) {{
        try {{ window.close(); }} catch (e) {{}}
      }}
      window.location.replace({dest_js});
    }}, 500);
  </script>
</body></html>"""
