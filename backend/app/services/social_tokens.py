"""Keeping connected social accounts logged in, and telling Outreach staff when one cannot be.

Customers connect an account once and expect it to keep working. What each network allows:
- X: the access token lasts ~2 hours; the refresh token renews it (and returns a new refresh token).
- LinkedIn: the access token lasts ~60 days. It can be renewed only when LinkedIn gave this app a
  refresh token (partner programmes); otherwise the customer must reconnect when it ends.
- Threads: the long-lived token lasts ~60 days and renews itself while still valid.
- Facebook / Instagram: Page tokens made from a long-lived login do not expire (no expires_at).

Refresh happens (1) just before a post is published and (2) in a daily background pass over every
organisation. Nothing is sent to customers or their approvers: accounts that cannot be renewed are
shown to staff in the owner portal (Social connections) and emailed to staff only. The customer's own
Accounts page already shows a Reconnect button for an account whose status is "expired".
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Tuple

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import SocialAccount
from app.services.social_oauth import _expiry_from, get_oauth_app
from app.services.social_publisher import account_access_token, normalize_platform, seal_account_secrets

logger = logging.getLogger("social_tokens")

PUBLISH_MARGIN = timedelta(minutes=10)  # refresh this long before expiry when about to publish
REFRESH_AHEAD = timedelta(days=7)  # the daily pass renews anything ending within this
ALERT_PREFIX = "social_token_alert:"
RE_ALERT_AFTER = timedelta(hours=72)
# 4xx from the token endpoint means the grant is gone (revoked, rotated, expired): reconnecting is
# the only cure. Anything else (network, 5xx, 429) is transient and must not flag the account.
_PERMANENT = (400, 401, 403)

_locks: Dict[str, asyncio.Lock] = {}


def _refresh_token(account) -> str:
    from app.services.secret_box import open_secret

    return open_secret(getattr(account, "refresh_token", None) or "")


def can_refresh(account) -> bool:
    plat = normalize_platform(account.platform)
    if plat in ("x", "linkedin"):
        return bool(_refresh_token(account))
    if plat == "threads":
        return bool(account_access_token(account))
    return False  # Facebook / Instagram page tokens do not expire


def expires_soon(account, within: timedelta) -> bool:
    exp = getattr(account, "expires_at", None)
    return bool(exp) and exp - datetime.utcnow() <= within


def health(account) -> str:
    """ok | expiring (inside REFRESH_AHEAD) | expired. An account with no known expiry is ok."""
    exp = getattr(account, "expires_at", None)
    if not exp:
        return "ok"
    left = exp - datetime.utcnow()
    return "expired" if left <= timedelta(0) else "expiring" if left <= REFRESH_AHEAD else "ok"


async def _token_call(method: str, url: str, *, data=None, params=None, headers=None) -> Tuple[int, Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.request(method, url, data=data, params=params, headers=headers)
    try:
        body = res.json()
    except Exception:
        body = {}
    return res.status_code, body if isinstance(body, dict) else {}


async def _request_new_token(db: AsyncSession, account) -> Tuple[int, Dict[str, Any]]:
    plat = normalize_platform(account.platform)
    app = await get_oauth_app(db, plat)
    if plat == "x":
        basic = base64.b64encode(f"{app['clientId']}:{app['clientSecret']}".encode()).decode()
        return await _token_call(
            "POST", "https://api.twitter.com/2/oauth2/token",
            data={"grant_type": "refresh_token", "refresh_token": _refresh_token(account), "client_id": app["clientId"]},
            headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
        )
    if plat == "linkedin":
        return await _token_call(
            "POST", "https://www.linkedin.com/oauth/v2/accessToken",
            data={"grant_type": "refresh_token", "refresh_token": _refresh_token(account),
                  "client_id": app["clientId"], "client_secret": app["clientSecret"]},
        )
    return await _token_call(
        "GET", "https://graph.threads.net/refresh_access_token",
        params={"grant_type": "th_refresh_token", "access_token": account_access_token(account)},
    )


async def ensure_fresh_token(db: AsyncSession, account, *, within: timedelta = PUBLISH_MARGIN,
                             force: bool = False) -> Dict[str, Any]:
    """Renew the account's token if it ends within `within`. Commits when it changed the account.
    Returns {"ok", "refreshed", "error"}; ok=False means the token is (or is about to be) unusable."""
    if not force and not expires_soon(account, within):
        return {"ok": True, "refreshed": False}
    lock = _locks.setdefault(str(account.id), asyncio.Lock())
    async with lock:
        try:
            # Another task may have renewed it while we waited (X refresh tokens are single use).
            await db.refresh(account)
        except Exception:
            pass
        if not force and not expires_soon(account, within):
            return {"ok": True, "refreshed": False}
        if not can_refresh(account):
            expired = health(account) == "expired"
            return {"ok": not expired, "refreshed": False,
                    "error": "The login has expired and cannot be renewed automatically. Reconnect the account."
                    if expired else ""}
        try:
            status, body = await _request_new_token(db, account)
        except Exception as err:
            logger.warning(f"[social-tokens] {account.platform} {account.id}: refresh request failed: {err}")
            return {"ok": False, "refreshed": False, "error": f"Could not reach {account.platform}: {err}"}
        access = body.get("access_token") or ""
        if status == 200 and access:
            account.access_token = access
            if body.get("refresh_token"):
                account.refresh_token = body["refresh_token"]
            account.expires_at = _expiry_from(body.get("expires_in"))
            seal_account_secrets(account)
            extra = dict(account.extra) if isinstance(account.extra, dict) else {}
            extra["tokenRefreshedAt"] = int(time.time())
            account.extra = extra
            account.status = "connected"
            account.last_error = ""
            await db.commit()
            return {"ok": True, "refreshed": True}
        detail = str(body.get("error_description") or body.get("error") or body.get("message") or "")[:200]
        err = f"{account.platform} refused to renew the login ({status}{': ' + detail if detail else ''})."
        if status in _PERMANENT:
            account.status = "expired"
            account.last_error = err + " Reconnect the account."
            await db.commit()
        logger.warning(f"[social-tokens] {account.id}: {err}")
        return {"ok": False, "refreshed": False, "error": err}


async def refresh_expiring(db: AsyncSession) -> List[Dict[str, Any]]:
    """Daily pass (run in system scope, so it covers every organisation): renew what ends within
    REFRESH_AHEAD and return the accounts that still need a human, for the staff alert."""
    rows = (await db.execute(select(SocialAccount).where(
        SocialAccount.expires_at.isnot(None),
        SocialAccount.expires_at <= datetime.utcnow() + REFRESH_AHEAD,
    ))).scalars().all()
    problems: List[Dict[str, Any]] = []
    for acc in rows:
        res = await ensure_fresh_token(db, acc, within=REFRESH_AHEAD)
        state = health(acc)
        if res["ok"] and state == "ok":
            continue
        if state == "expired" and acc.status == "connected":
            acc.status = "expired"
            acc.last_error = acc.last_error or "The login has expired. Reconnect the account."
            await db.commit()
        problems.append({"account": acc, "state": state if state != "ok" else "expiring", "error": res.get("error", "")})
    return problems


async def _org_names(db: AsyncSession) -> Dict[str, str]:
    from sqlalchemy import text

    try:
        return {r[0]: r[1] for r in (await db.execute(text("SELECT id, name FROM organizations"))).all()}
    except Exception:
        return {}


async def alert_staff(db: AsyncSession, problems: List[Dict[str, Any]]) -> int:
    """One email to Outreach staff listing accounts that need a reconnect. Each account is
    mentioned at most once per RE_ALERT_AFTER. Customers are not emailed. Returns how many were listed."""
    from app.services.platform_balances import _get_doc, _put_doc

    now = datetime.utcnow()
    names = await _org_names(db)
    fresh = []
    for p in problems:
        acc = p["account"]
        key = f"{ALERT_PREFIX}{acc.id}"
        doc = await _get_doc(db, key)
        if doc.get("state") == p["state"] and doc.get("at") and datetime.fromisoformat(doc["at"]) > now - RE_ALERT_AFTER:
            continue
        await _put_doc(db, key, {"at": now.isoformat(), "state": p["state"]})
        fresh.append(p)
    await db.commit()
    if not fresh:
        return 0
    try:
        from app.core.mailer import render, send_system_email
        from app.services.ai_errors import _staff_emails

        recipients = await _staff_emails()
        if not recipients:
            return 0
        subject = f"Social login needs attention: {len(fresh)} account{'s' if len(fresh) != 1 else ''}"
        lines = []
        for p in fresh:
            acc = p["account"]
            when = acc.expires_at.strftime("%d %b %Y") if acc.expires_at else "unknown"
            what = "has expired" if p["state"] == "expired" else f"ends {when}"
            org = getattr(acc, "org_id", None) or ""
            lines.append(f"<b>{names.get(org, org or '?')}</b> — {normalize_platform(acc.platform)} {acc.handle or acc.id}: "
                         f"login {what}." + (f" {p['error']}" if p.get("error") else ""))
        lines.append("The customer sees Reconnect on their Accounts page. See the owner portal (Social connections).")
        msg = render(subject, lines, None)
        for to in recipients:
            await send_system_email(to, subject, msg["html"], msg["text"])
    except Exception as err:
        logger.warning(f"[social-tokens] staff alert email failed: {err}")
    return len(fresh)


async def run_daily_pass(db: AsyncSession) -> int:
    return await alert_staff(db, await refresh_expiring(db))


async def connection_report(db: AsyncSession) -> List[Dict[str, Any]]:
    """Every organisation's connected accounts for the owner portal, worst first. No tokens."""
    names = await _org_names(db)
    rows = (await db.execute(select(SocialAccount))).scalars().all()
    order = {"expired": 0, "expiring": 1, "ok": 2}
    out = []
    for a in rows:
        org = getattr(a, "org_id", None) or ""
        state = "expired" if a.status == "expired" else health(a)
        out.append({
            "id": a.id, "orgId": org, "orgName": names.get(org, ""),
            "platform": normalize_platform(a.platform), "handle": a.handle or "", "status": a.status or "",
            "state": state, "expiresAt": a.expires_at.isoformat() + "Z" if a.expires_at else None,
            "autoRefresh": can_refresh(a), "lastError": a.last_error or "",
        })
    out.sort(key=lambda r: (order.get(r["state"], 3), r["orgName"], r["platform"]))
    return out
