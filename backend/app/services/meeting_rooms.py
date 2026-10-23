"""Real video-meeting rooms: Google Meet, Microsoft Teams and Zoom.

Each organisation connects its own account once (OAuth). When a video meeting is scheduled on
one of these platforms and no link was pasted, a room is created in that account and its join
link is saved on the meeting. Credentials for the three provider apps live in the server
environment (see config.py); tokens are per organisation, sealed at rest.
"""
from __future__ import annotations

import base64
import logging
import time
import urllib.parse
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.core.security import _encode, decode_token
from app.core.tenancy import current_org, org_scope
from app.models.models import MeetingProvider
from app.services.secret_box import open_secret, seal_secret

logger = logging.getLogger("meeting_rooms")

PROVIDERS = ("google", "microsoft", "zoom")
LABELS = {"google": "Google Meet", "microsoft": "Microsoft Teams", "zoom": "Zoom"}
_TIMEOUT = 25.0


def provider_for(platform: Optional[str]) -> Optional[str]:
    """The provider behind a platform label from the Schedule window, or None (Cal.com, our own room)."""
    p = (platform or "").lower()
    if "zoom" in p:
        return "zoom"
    if "teams" in p or "microsoft" in p:
        return "microsoft"
    if "jitsi" in p or "outreach" in p or "cal.com" in p:
        return None
    if "google" in p or "meet" in p:
        return "google"
    return None


# The three provider apps are registered once by the platform owner in the Admin portal
# (stored like the social OAuth apps); server environment values are the fallback.
_db_creds: Dict[str, Dict[str, str]] = {}


def _app_key(provider: str) -> str:
    return f"meet_{provider}"


def _creds(provider: str) -> Dict[str, str]:
    saved = _db_creds.get(provider) or {}
    if saved.get("id") and saved.get("secret"):
        return saved
    if provider == "google":
        return {"id": settings.GOOGLE_OAUTH_CLIENT_ID or "", "secret": settings.GOOGLE_OAUTH_CLIENT_SECRET or ""}
    if provider == "microsoft":
        return {"id": settings.MICROSOFT_OAUTH_CLIENT_ID or "", "secret": settings.MICROSOFT_OAUTH_CLIENT_SECRET or ""}
    if provider == "zoom":
        return {"id": settings.ZOOM_OAUTH_CLIENT_ID or "", "secret": settings.ZOOM_OAUTH_CLIENT_SECRET or ""}
    return {"id": "", "secret": ""}


async def load_creds() -> None:
    """Read the saved provider apps (a shared, non-tenant table) into memory."""
    from app.database import AsyncSessionLocal
    from app.models.models import SocialOAuthApp

    try:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(SocialOAuthApp).where(
                SocialOAuthApp.platform.in_([_app_key(p) for p in PROVIDERS])))).scalars().all()
        for r in rows:
            p = r.platform[len("meet_"):]
            _db_creds[p] = {"id": (r.client_id or "").strip(), "secret": open_secret(r.client_secret or "").strip()}
    except Exception as err:
        logger.warning("meeting provider apps could not be read: %s", err)


async def save_app(provider: str, client_id: str, client_secret: str) -> None:
    from app.database import AsyncSessionLocal
    from app.models.models import SocialOAuthApp

    async with AsyncSessionLocal() as db:
        row = (await db.execute(select(SocialOAuthApp).where(SocialOAuthApp.platform == _app_key(provider)))).scalars().first()
        if not row:
            row = SocialOAuthApp(platform=_app_key(provider))
            db.add(row)
        row.client_id = client_id.strip()
        if client_secret.strip():
            row.client_secret = seal_secret(client_secret.strip())
        row.redirect_uri = redirect_uri(provider)
        await db.commit()
    await load_creds()


def apps_view() -> Dict[str, Any]:
    out = []
    for p in PROVIDERS:
        c = _creds(p)
        cid = c["id"]
        out.append({
            "provider": p, "label": LABELS[p], "configured": is_configured(p),
            "clientIdHint": (cid[:6] + "…" + cid[-4:]) if len(cid) > 12 else (cid[:4] + "…" if cid else ""),
            "hasSecret": bool(c["secret"]), "callbackUrl": redirect_uri(p),
        })
    return {"apps": out}


def is_configured(provider: str) -> bool:
    c = _creds(provider)
    return bool(c["id"].strip() and c["secret"].strip())


def redirect_uri(provider: str) -> str:
    base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
    return f"{base}{settings.API_PREFIX}/meeting-links/{provider}/callback"


def _row_id(provider: str) -> str:
    return f"{provider}:{current_org()}"


async def _row(db: AsyncSession, provider: str) -> Optional[MeetingProvider]:
    return (await db.execute(select(MeetingProvider).where(MeetingProvider.id == _row_id(provider)))).scalars().first()


async def status(db: AsyncSession) -> Dict[str, Any]:
    await load_creds()
    out = []
    for p in PROVIDERS:
        row = await _row(db, p)
        out.append({
            "provider": p,
            "label": LABELS[p],
            "configured": is_configured(p),
            "connected": bool(row and row.status == "connected" and (row.refresh_token or row.access_token)),
            "account": (row.account if row else "") or "",
            "error": (row.last_error if row else "") or "",
        })
    return {"providers": out}


# ── Connect (OAuth) ─────────────────────────────────────────────────────────

def _scopes(provider: str) -> str:
    return {
        "google": "https://www.googleapis.com/auth/calendar.events openid email",
        "microsoft": "offline_access User.Read OnlineMeetings.ReadWrite",
        "zoom": "meeting:write user:read",
    }[provider]


async def start(provider: str, frontend: str = "", partner_return: str = "") -> Dict[str, Any]:
    if provider not in PROVIDERS:
        return {"ok": False, "error": "Unknown meeting provider."}
    await load_creds()
    if not is_configured(provider):
        return {"ok": False, "error": f"{LABELS[provider]} is not set up for this platform yet. Ask the Outreach team to enable it."}
    state = _encode({"sub": provider, "typ": "meetlink", "org": current_org(), "front": frontend[:200], "ret": partner_return[:1000]}, 1800)
    cid = _creds(provider)["id"]
    ru = redirect_uri(provider)
    if provider == "google":
        q = {"client_id": cid, "redirect_uri": ru, "response_type": "code", "scope": _scopes(provider),
             "access_type": "offline", "prompt": "consent", "state": state}
        url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(q)
    elif provider == "microsoft":
        q = {"client_id": cid, "redirect_uri": ru, "response_type": "code", "scope": _scopes(provider),
             "response_mode": "query", "prompt": "select_account", "state": state}
        url = f"https://login.microsoftonline.com/{settings.MICROSOFT_OAUTH_TENANT}/oauth2/v2.0/authorize?" + urllib.parse.urlencode(q)
    else:
        q = {"client_id": cid, "redirect_uri": ru, "response_type": "code", "state": state}
        url = "https://zoom.us/oauth/authorize?" + urllib.parse.urlencode(q)
    return {"ok": True, "authUrl": url, "callbackUrl": ru}


def _token_request(provider: str, form: Dict[str, str]) -> Dict[str, Any]:
    c = _creds(provider)
    headers: Dict[str, str] = {}
    data = dict(form)
    if provider == "google":
        url = "https://oauth2.googleapis.com/token"
        data.update({"client_id": c["id"], "client_secret": c["secret"]})
    elif provider == "microsoft":
        url = f"https://login.microsoftonline.com/{settings.MICROSOFT_OAUTH_TENANT}/oauth2/v2.0/token"
        data.update({"client_id": c["id"], "client_secret": c["secret"], "scope": _scopes(provider)})
    else:
        url = "https://zoom.us/oauth/token"
        headers["Authorization"] = "Basic " + base64.b64encode(f"{c['id']}:{c['secret']}".encode()).decode()
    return {"url": url, "data": data, "headers": headers}


async def _post_token(provider: str, form: Dict[str, str]) -> Dict[str, Any]:
    req = _token_request(provider, form)
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.post(req["url"], data=req["data"], headers=req["headers"])
    try:
        body = res.json()
    except Exception:
        body = {}
    if res.status_code != 200 or not body.get("access_token"):
        msg = body.get("error_description") or body.get("error") or res.text[:200]
        return {"ok": False, "error": f"{LABELS[provider]} sign-in failed: {msg}"}
    return {"ok": True, **body}


async def _account_email(provider: str, access: str) -> str:
    urls = {
        "google": "https://openidconnect.googleapis.com/v1/userinfo",
        "microsoft": "https://graph.microsoft.com/v1.0/me",
        "zoom": "https://api.zoom.us/v2/users/me",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.get(urls[provider], headers={"Authorization": f"Bearer {access}"})
        if res.status_code == 200:
            d = res.json() or {}
            return d.get("email") or d.get("mail") or d.get("userPrincipalName") or ""
    except Exception as err:
        logger.debug("account lookup skipped: %s", err)
    return ""


def state_return(state: str) -> str:
    """The partner return address inside a sign-in state, if the connect started from a partner's page."""
    claims = decode_token(state or "", "meetlink") or {}
    return claims.get("ret") or ""


async def finish(provider: str, code: str, state: str) -> Dict[str, Any]:
    """Callback: verify the signed state, swap the code for tokens, save them for that organisation."""
    claims = decode_token(state, "meetlink")
    if not claims or claims.get("sub") != provider:
        return {"ok": False, "error": "This sign-in link expired. Click Connect again."}
    org = claims.get("org") or ""
    front = claims.get("front") or ""
    ret = claims.get("ret") or ""
    await load_creds()
    tok = await _post_token(provider, {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri(provider)})
    if not tok.get("ok"):
        return {**tok, "frontend": front, "ret": ret}
    from app.database import AsyncSessionLocal

    with org_scope(org):
        async with AsyncSessionLocal() as db:
            row = await _row(db, provider)
            if not row:
                row = MeetingProvider(id=_row_id(provider), provider=provider)
                db.add(row)
            row.access_token = seal_secret(tok["access_token"])
            if tok.get("refresh_token"):
                row.refresh_token = seal_secret(tok["refresh_token"])
            row.expires_at = time.time() + float(tok.get("expires_in") or 3000) - 60
            row.account = await _account_email(provider, tok["access_token"]) or row.account or ""
            row.status = "connected"
            row.last_error = ""
            row.connected_at = datetime.utcnow()
            await db.commit()
            return {"ok": True, "provider": provider, "account": row.account, "frontend": front, "ret": ret, "org": org}


async def disconnect(db: AsyncSession, provider: str) -> bool:
    row = await _row(db, provider)
    if not row:
        return False
    await db.delete(row)
    await db.commit()
    return True


def _tell_partner(provider: str) -> None:
    from app.services.reconnect_events import reconnect_needed

    reconnect_needed("meeting.provider.needs_reauth", current_org(), {"provider": provider})


async def _access_token(db: AsyncSession, provider: str) -> Optional[str]:
    row = await _row(db, provider)
    if not row or row.status != "connected":
        return None
    if row.access_token and row.expires_at and row.expires_at > time.time():
        return open_secret(row.access_token)
    refresh = open_secret(row.refresh_token)
    if not refresh:
        row.status = "expired"
        row.last_error = "Please reconnect."
        await db.commit()
        _tell_partner(provider)
        return None
    await load_creds()
    tok = await _post_token(provider, {"grant_type": "refresh_token", "refresh_token": refresh})
    if not tok.get("ok"):
        row.status = "expired"
        row.last_error = tok.get("error") or "Please reconnect."
        await db.commit()
        _tell_partner(provider)
        return None
    row.access_token = seal_secret(tok["access_token"])
    if tok.get("refresh_token"):  # Microsoft and Zoom rotate it
        row.refresh_token = seal_secret(tok["refresh_token"])
    row.expires_at = time.time() + float(tok.get("expires_in") or 3000) - 60
    await db.commit()
    return tok["access_token"]


# ── Create a room ───────────────────────────────────────────────────────────

async def create_room(
    db: AsyncSession,
    provider: str,
    *,
    title: str,
    start_utc: datetime,
    minutes: int = 15,
    attendee_email: str = "",
) -> Dict[str, Any]:
    """Returns {"ok": True, "url": ...} or {"ok": False, "error": ...}. Never raises."""
    try:
        access = await _access_token(db, provider)
        if not access:
            return {"ok": False, "error": f"{LABELS[provider]} is not connected (or needs reconnecting)."}
        end_utc = start_utc + timedelta(minutes=minutes)
        auth = {"Authorization": f"Bearer {access}"}
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            if provider == "google":
                body: Dict[str, Any] = {
                    "summary": title,
                    "start": {"dateTime": start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"), "timeZone": "UTC"},
                    "end": {"dateTime": end_utc.strftime("%Y-%m-%dT%H:%M:%SZ"), "timeZone": "UTC"},
                    "conferenceData": {"createRequest": {
                        "requestId": uuid.uuid4().hex,
                        "conferenceSolutionKey": {"type": "hangoutsMeet"},
                    }},
                }
                if attendee_email:
                    body["attendees"] = [{"email": attendee_email}]
                res = await client.post(
                    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                    params={"conferenceDataVersion": 1, "sendUpdates": "none"},
                    json=body, headers=auth,
                )
                data = res.json() if res.content else {}
                url = data.get("hangoutLink") or ""
            elif provider == "microsoft":
                res = await client.post(
                    "https://graph.microsoft.com/v1.0/me/onlineMeetings",
                    json={"subject": title,
                          "startDateTime": start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
                          "endDateTime": end_utc.strftime("%Y-%m-%dT%H:%M:%SZ")},
                    headers=auth,
                )
                data = res.json() if res.content else {}
                url = data.get("joinWebUrl") or ""
            else:
                res = await client.post(
                    "https://api.zoom.us/v2/users/me/meetings",
                    json={"topic": title, "type": 2,
                          "start_time": start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
                          "duration": minutes, "timezone": "UTC"},
                    headers=auth,
                )
                data = res.json() if res.content else {}
                url = data.get("join_url") or ""
        if res.status_code in (200, 201) and url:
            return {"ok": True, "url": url}
        err = data.get("error") if isinstance(data.get("error"), str) else (data.get("error") or {}).get("message") or data.get("message") or ""
        if provider == "microsoft" and res.status_code in (400, 403) and not err:
            err = "Teams meetings need a work or school Microsoft account."
        return {"ok": False, "error": f"{LABELS[provider]} could not create the meeting ({res.status_code}). {err}".strip()}
    except Exception as err:  # network, bad JSON...
        logger.warning("create_room %s failed: %s", provider, err)
        return {"ok": False, "error": f"{LABELS[provider]} could not create the meeting."}


def callback_html(ok: bool, provider: str, account: str = "", error: str = "") -> str:
    import json

    label = LABELS.get(provider, provider)
    safe_err = (error or "").replace("<", "").replace(">", "")[:240]
    safe_acc = (account or "").replace("<", "").replace(">", "")
    payload = json.dumps({"type": "aivhub-meeting-oauth", "ok": bool(ok), "provider": provider, "account": account or "", "error": safe_err})
    title = f"{label} connected" if ok else f"Could not connect {label}"
    body = safe_acc if ok else (safe_err or "You can close this window.")
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Outreach by Aivhub</title></head>
<body style="font-family:Inter,system-ui,sans-serif;padding:40px;background:#F6F5F2;color:#12141C">
  <h2>{title}</h2><p>{body}</p><p>You can close this window.</p>
  <script>
    var payload = {payload};
    try {{ if (window.opener) window.opener.postMessage(payload, "*"); }} catch (e) {{}}
    setTimeout(function () {{ try {{ window.close(); }} catch (e) {{}} }}, 1200);
  </script>
</body></html>"""
