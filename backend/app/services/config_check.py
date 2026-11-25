"""The production config check (plan 11, C.5): what is wrong with the server's settings before strangers sign up.

problems() lists each finding as {"code", "level", "text"}:
- "block": must be fixed before a public launch (a weak signing key, Stripe test keys, a Stripe key without its webhook secret,
  CORS open to every site, the test-copy switch on a production server);
- "warn": worth a look (public API docs, no staff e-mail for alerts, a public address that isn't https).

At start-up (main.py) every finding is logged and staff get one CFG-01 alert. Only with APP_ENV=production does a "block" stop the
server from starting, so the check can't take a server down until someone has said it is the production one. Staff read the list on
GET /admin-api/config-check. Values are never shown: only what kind they are.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Mapping, Optional

logger = logging.getLogger("config_check")


def _on(v: Optional[str]) -> bool:
    return str(v or "").strip().lower() in ("1", "true", "yes", "on")


def production(env: Optional[Mapping[str, str]] = None) -> bool:
    env = os.environ if env is None else env
    return str(env.get("APP_ENV") or "").strip().lower() == "production"


def _stripe_kind(v: str) -> str:
    v = (v or "").strip()
    if not v:
        return ""
    return "test" if "_test_" in v else "live" if "_live_" in v else "other"


def problems(env: Optional[Mapping[str, str]] = None) -> List[Dict[str, Any]]:
    from app.core.security import PUBLIC_DEFAULT_KEYS

    env = os.environ if env is None else env
    out: List[Dict[str, Any]] = []

    def add(code: str, level: str, text: str) -> None:
        out.append({"code": code, "level": level, "text": text})

    key = str(env.get("SECRET_KEY") or "")
    if key in PUBLIC_DEFAULT_KEYS or len(key) < 16:
        add("secret_key", "block", "SECRET_KEY is missing, too short or a value published in the code. Set a long random one.")
    secret, public, hook = (str(env.get(k) or "") for k in ("STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"))
    kinds = {_stripe_kind(secret), _stripe_kind(public)} - {""}
    if "test" in kinds:
        add("stripe_test", "block", "Stripe is in test mode (a test key is set). Clients can't pay until live keys are set.")
    if len(kinds) > 1:
        add("stripe_mixed", "block", "The Stripe secret and publishable keys are from different modes (test and live).")
    if secret and not hook:
        add("stripe_webhook", "block", "STRIPE_WEBHOOK_SECRET is not set, so Stripe's payment messages can't be checked and plans won't update.")
    if "*" in re.split(r"[,\s]+", str(env.get("CORS_ORIGINS") or "")):
        add("cors_open", "block", "CORS_ORIGINS lets every website call the API with a signed-in user's session. List the real sites.")
    if _on(env.get("TEST_COPY")) and production(env):
        add("test_copy", "block", "TEST_COPY is on, but this server says it is the production one (APP_ENV=production).")
    if _on(env.get("EXPOSE_API_DOCS")):
        add("api_docs", "warn", "The API docs (/docs, /redoc, /openapi.json) are public. Decided 2026-11-24 to keep them on for now.")
    if not str(env.get("STAFF_ADMIN_EMAIL") or "").strip():
        add("staff_email", "warn", "STAFF_ADMIN_EMAIL is not set, so staff alerts are only shown in the admin portal, never e-mailed.")
    for name in ("PUBLIC_BASE_URL", "FRONTEND_URL"):
        url = str(env.get(name) or "").strip()
        if url and (not url.startswith("https://") or "localhost" in url or "127.0.0.1" in url):
            add(f"{name.lower()}_plain", "warn", f"{name} is not a public https address.")
    return out


class ConfigRefused(RuntimeError):
    pass


async def at_startup(env: Optional[Mapping[str, str]] = None) -> List[Dict[str, Any]]:
    """Logs every finding and alerts staff once (CFG-01). With APP_ENV=production, a "block" finding raises ConfigRefused."""
    found = problems(env)
    for p in found:
        (logger.error if p["level"] == "block" else logger.warning)(f"[config] {p['level']}: {p['text']}")
    blocks = [p for p in found if p["level"] == "block"]
    if blocks and production(env):
        raise ConfigRefused("Refusing to start in production: " + " ".join(p["text"] for p in blocks))
    if found:
        from app.services.ai_errors import alert_staff

        await alert_staff("CFG-01", "; ".join(f"{p['level']}: {p['code']}" for p in found), org_id="platform")
    return found
