"""Which web pages may call the API from a browser (CORS).

Before this, every web page anywhere could call the API with the visitor's credentials (allow_origins=["*"] with allow_credentials).
Now there are three answers, decided per request:

- A trusted page gets full access with credentials:
  - this app's own addresses (PUBLIC_BASE_URL, FRONTEND_URL and any in CORS_ORIGINS, comma-separated),
  - local development servers,
  - the verified web addresses of white-label brands,
  - the web addresses partners listed (partners.allowed_origins, except suspended partners),
  - our browser extension (services/partners.page_origin).
- The public endpoints made to be called from any website answer every page, without credentials:
  - the /v1 API, which authenticates with a key,
  - published web forms (/api/f),
  - the legal notice and opt-out pages,
  - the partner guides.
- Any other page gets no CORS headers, so the browser won't let it read the answer.

Brand and partner addresses are read from the database at most once a minute. If that read fails, the last known list is kept, and
before the first successful read only the static addresses are trusted.
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Iterable, Set, Tuple
from urllib.parse import urlparse

from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger(__name__)

PUBLIC_PREFIXES: Tuple[str, ...] = ("/v1/", "/api/v1/", "/api/f/", "/api/legal/", "/api/docs/partners")
DEV_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://localhost:8080")
_TTL = 60.0


def origin_of(url: str) -> str:
    """scheme://host[:port] in lower case, or "" when it isn't a web address."""
    u = urlparse((url or "").strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        return ""
    return f"{u.scheme}://{u.hostname.lower()}" + (f":{u.port}" if u.port else "")


def static_origins() -> Set[str]:
    from app.config import settings

    named = [getattr(settings, "PUBLIC_BASE_URL", "") or os.getenv("PUBLIC_BASE_URL", ""), getattr(settings, "FRONTEND_URL", "") or ""]
    named += re.split(r"[,\s]+", os.getenv("CORS_ORIGINS", ""))
    return {o for o in (origin_of(x) for x in named) if o} | set(DEV_ORIGINS)


class OriginPolicyCORS:
    """ASGI middleware: picks the trusted, public or no-CORS answer for each request (see the module docstring)."""

    def __init__(self, app: ASGIApp):
        self.app = app
        # The origin is checked here before `trusted` sees it, so `trusted` may echo any origin it is handed.
        self.trusted = CORSMiddleware(app, allow_origin_regex=r".*", allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
        self.public = CORSMiddleware(app, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
        self._static = static_origins()
        self._dynamic: Set[str] = set()
        self._read_at = 0.0

    async def _refresh(self) -> None:
        if time.monotonic() - self._read_at < _TTL:
            return
        self._read_at = time.monotonic()
        try:
            self._dynamic = await _dynamic_origins()
        except Exception as err:  # keep the last known list; never fail the request over it
            logger.warning(f"[cors] could not read brand and partner addresses: {err}")

    async def trusted_origin(self, origin: str) -> bool:
        from app.services.partners import page_origin

        if origin_of(origin) in self._static:
            return True
        if origin.startswith(("chrome-extension://", "moz-extension://")):
            return bool(page_origin(origin))
        await self._refresh()
        return origin_of(origin) in self._dynamic

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        origin = next((v.decode("latin-1") for k, v in scope.get("headers") or [] if k == b"origin"), "")
        if not origin:
            return await self.app(scope, receive, send)
        if await self.trusted_origin(origin):
            return await self.trusted(scope, receive, send)
        if str(scope.get("path") or "").startswith(PUBLIC_PREFIXES):
            return await self.public(scope, receive, send)
        return await self.app(scope, receive, send)


async def _dynamic_origins() -> Set[str]:
    from sqlalchemy import text

    from app.database import AsyncSessionLocal

    out: Set[str] = set()
    async with AsyncSessionLocal() as db:
        for (host,) in (await db.execute(text("SELECT host FROM brand_domains WHERE verified IS TRUE"))).all():
            o = origin_of(f"https://{host}")
            if o:
                out.add(o)
        for (origins,) in (await db.execute(text("SELECT allowed_origins FROM partners WHERE coalesce(status, '') <> 'suspended'"))).all():
            out |= {o for o in (origin_of(x) for x in _as_list(origins)) if o}
    return out


def _as_list(value) -> Iterable[str]:
    if isinstance(value, list):
        return [str(x) for x in value]
    if isinstance(value, str):
        import json

        try:
            got = json.loads(value)
            return [str(x) for x in got] if isinstance(got, list) else []
        except ValueError:
            return []
    return []
