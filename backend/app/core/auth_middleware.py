"""Sign-in check for every HTTP request and WebSocket.

Every path needs a valid access token except the public list below: carrier and provider
webhooks (each checks its own signature), signed email links, the OAuth return page, images
that social networks fetch, and the public legal pages. On top of being signed in, a path
that belongs to a section needs the right level in it (see app.core.permissions).

The token comes from "Authorization: Bearer ...". Browsers cannot set that header on
<audio src>, file downloads or WebSockets, so for GET requests and WebSockets it may also come
from the "access_token" query parameter.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs

from app.core import permissions as P
from app.core.security import decode_token

logger = logging.getLogger("auth")

_OPT_API = r"^/(?:api/)?"
PUBLIC_HTTP = [re.compile(p) for p in (
    r"^/$",
    r"^/health$",
    r"^/(privacy|privacy-policy|terms|terms-of-service|data-deletion)$",
    _OPT_API + r"auth/(login|refresh)$",
    # Carrier / provider webhooks (verified by their own signatures inside the handlers)
    _OPT_API + r"sip-webhook/?$",
    _OPT_API + r"sip-webhook/(test|health)$",
    _OPT_API + r"sip/webhook$",
    _OPT_API + r"telnyx-assistant/(call-control|call-event|tool/[^/]+)$",
    _OPT_API + r"calls/(telnyx|twilio)/[^/]+$",
    _OPT_API + r"twilio/(voice|inbound)$",
    _OPT_API + r"(vapi|retell|custom-voice|livekit)/webhook$",
    _OPT_API + r"whatsapp/webhook$",
    # Signed links in emails and the social OAuth return page
    _OPT_API + r"scheduler/(review|schedule-extend)$",
    _OPT_API + r"scheduler/oauth/[^/]+/callback$",
    # Images social networks and email clients fetch
    _OPT_API + r"scheduler/media/[^/]+$",
    r"^/media/generated/",
)]
if os.getenv("EXPOSE_API_DOCS", "").lower() in ("1", "true", "yes"):
    PUBLIC_HTTP += [re.compile(r"^/(docs|redoc)(/|$)"), re.compile(r"^/openapi\.json$")]

PUBLIC_WS = [re.compile(r"^/ws/media-stream$")]  # carrier audio stream

# Carrier webhooks: the organisation is found from the phone numbers in the request.
CARRIER_WEBHOOK = re.compile(_OPT_API + r"(sip-webhook|sip/webhook|telnyx-assistant/|calls/(telnyx|twilio)/|twilio/)")
_PHONE_RE = re.compile(r"\+\d{8,15}")


async def _carrier_webhook_in_org(app, scope, receive, send):
    """Read the body once, find which organisation owns a number in it, and run the handler
    inside that organisation. Unknown numbers keep the default organisation."""
    from urllib.parse import unquote

    from app.core.tenancy import org_scope

    chunks = []
    more = True
    while more:
        msg = await receive()
        if msg["type"] != "http.request":
            break
        chunks.append(msg.get("body", b""))
        more = msg.get("more_body", False)
    body = b"".join(chunks)
    org = None
    try:
        text_body = unquote(body[:20000].decode("utf-8", errors="ignore"))
        numbers = list(dict.fromkeys(_PHONE_RE.findall(text_body)))[:6]
        if numbers:
            from app.services.numbers import org_for_numbers

            org = await org_for_numbers(*numbers)
    except Exception as err:
        logger.debug(f"[auth] webhook org lookup skipped: {err}")

    sent = False

    async def replay():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()

    if org:
        with org_scope(org):
            return await app(scope, replay, send)
    return await app(scope, replay, send)

# operator id -> (expires_at, context). Short cache so role changes apply within seconds.
_CTX_CACHE: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}
_CTX_TTL_S = 20.0


def forget(operator_id: Optional[str] = None) -> None:
    """Drop cached access so a change (role, disable, logout) applies at once."""
    if operator_id is None:
        _CTX_CACHE.clear()
    else:
        _CTX_CACHE.pop(operator_id, None)


def is_public(path: str, websocket: bool = False) -> bool:
    rules = PUBLIC_WS if websocket else PUBLIC_HTTP
    return any(r.search(path) for r in rules)


def api_path(path: str) -> str:
    return path[4:] if path.startswith("/api/") else path


async def load_context(operator_id: str, session_id: str) -> Optional[Dict[str, Any]]:
    now = time.time()
    hit = _CTX_CACHE.get(operator_id)
    if hit and hit[0] > now and hit[1] and session_id in hit[1].get("_sessions", ()):
        return hit[1]
    from datetime import datetime

    from sqlalchemy.future import select

    from app.core.accounts import effective_access, org_of
    from app.database import AsyncSessionLocal
    from app.models.models import AuthSession, Operator

    async with AsyncSessionLocal() as db:
        op = (await db.execute(select(Operator).where(Operator.id == operator_id))).scalars().first()
        if not op or op.is_active is False:
            _CTX_CACHE[operator_id] = (now + _CTX_TTL_S, None)
            return None
        live = (await db.execute(
            select(AuthSession.id).where(
                AuthSession.operator_id == operator_id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > datetime.utcnow(),
            )
        )).scalars().all()
        if session_id not in live:
            return None
        is_admin, perms, roles = await effective_access(db, op)
        ctx = {
            "operator_id": op.id,
            "username": op.username,
            "name": op.name,
            "org_id": org_of(op),
            "is_admin": is_admin,
            "perms": perms,
            "roles": [r.name for r in roles],
            "must_change_password": bool(op.must_change_password),
            "_sessions": set(live),
        }
    _CTX_CACHE[operator_id] = (now + _CTX_TTL_S, ctx)
    return ctx


def _token_from(scope) -> str:
    for name, value in scope.get("headers") or []:
        if name == b"authorization":
            v = value.decode("latin-1")
            if v.lower().startswith("bearer "):
                return v[7:].strip()
    qs = parse_qs((scope.get("query_string") or b"").decode("latin-1"))
    return (qs.get("access_token") or [""])[0]


class AuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        kind = scope.get("type")
        if kind not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        path = scope.get("path") or "/"
        websocket = kind == "websocket"
        method = "GET" if websocket else scope.get("method", "GET")
        if method == "OPTIONS" or is_public(path, websocket):
            if not websocket and method == "POST" and CARRIER_WEBHOOK.search(path):
                return await _carrier_webhook_in_org(self.app, scope, receive, send)
            return await self.app(scope, receive, send)

        token = _token_from(scope)
        if not websocket and method != "GET" and not _has_bearer(scope):
            token = ""  # query-string tokens only for reads (links, audio, downloads)
        claims = decode_token(token, "access") if token else None
        ctx = await load_context(claims["sub"], claims.get("sid", "")) if claims else None
        if not ctx:
            return await _deny(scope, receive, send, 401, "Sign in required.")

        rel = api_path(path)
        if ctx["must_change_password"] and not re.search(r"^/auth/(me|change-password|logout)$", rel):
            return await _deny(scope, receive, send, 403, "Choose a new password first.", code="password_change_required")

        if websocket:
            need = _ws_need(path)
        else:
            need = P.required(rel, method)
        if need and not P.allows(ctx["perms"], need[0], need[1]):
            return await _deny(scope, receive, send, 403, "You do not have access to this.", code="forbidden", section=need[0])

        scope.setdefault("state", {})["auth"] = ctx
        # Every database session in this request runs inside the user's organisation.
        from app.core.tenancy import org_scope

        with org_scope(ctx["org_id"]):
            return await self.app(scope, receive, send)


def _has_bearer(scope) -> bool:
    return any(n == b"authorization" for n, _ in (scope.get("headers") or []))


def _ws_need(path: str) -> Optional[Tuple[str, str]]:
    if path.startswith("/ws/listen/"):
        return ("calling", P.FULL)
    if path.startswith("/ws/live"):
        return ("calling", P.VIEW)
    return None


async def _deny(scope, receive, send, status: int, detail: str, code: str = "", section: str = ""):
    if scope["type"] == "websocket":
        msg = await receive()
        if msg.get("type") == "websocket.connect":
            await send({"type": "websocket.close", "code": 4401 if status == 401 else 4403})
        return
    body = json.dumps({"detail": detail, "code": code or ("unauthorized" if status == 401 else "forbidden"), "section": section}).encode()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
    })
    await send({"type": "http.response.body", "body": body})


def current(request) -> Dict[str, Any]:
    """The signed-in user's context inside a route (set by the middleware)."""
    ctx = getattr(request.state, "auth", None) if hasattr(request, "state") else None
    if not ctx:
        from fastapi import HTTPException

        raise HTTPException(status_code=401, detail="Sign in required.")
    return ctx


class _RedactTokens:
    """Keeps access tokens from query strings (audio, downloads, WebSockets) out of the logs."""

    _re = re.compile(r"(access_token=)[^&\s\"']+")

    def filter(self, record) -> bool:
        try:
            if record.args:
                record.args = tuple(self._re.sub(r"\1[hidden]", a) if isinstance(a, str) else a for a in record.args)
            if isinstance(record.msg, str):
                record.msg = self._re.sub(r"\1[hidden]", record.msg)
        except Exception:
            pass
        return True


def install_log_redaction() -> None:
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn"):
        logging.getLogger(name).addFilter(_RedactTokens())
