"""OutReach's own mailbox (e.g. one.com), set by staff in the owner portal.

It does two jobs:
- System email (invites, password resets, alerts) goes out from it (app.core.mailer), in
  place of the SYSTEM_MAIL_* environment settings when it is filled in.
- It is the warmup partner every client mailbox sends its warmup emails to: it rescues them
  from spam, marks them read and answers some of them, which is what builds a sender's
  reputation (see email_worker).

Stored once in app_settings "platform_mailbox"; the password is sealed and never sent back.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger("platform_mailbox")

KEY = "platform_mailbox"
_cache: Optional[Dict[str, Any]] = None  # opened settings, for the system mailer (sync code)


def _system_db():
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    return system_scope, AsyncSessionLocal


async def load(db) -> Dict[str, Any]:
    """{email, from_name, settings (password opened)} or {} when not set."""
    from app.services import mail_transport as T
    from app.services.credits import _get_doc
    from app.services.secret_box import open_secret

    doc = await _get_doc(db, KEY)
    if not doc.get("email"):
        return {}
    raw = dict(doc.get("settings") or {})
    raw["password"] = open_secret(raw.get("password") or "")
    return {"email": doc["email"], "from_name": doc.get("from_name") or "", "settings": T.clean_settings(raw, doc["email"])}


def public(saved: Dict[str, Any]) -> Dict[str, Any]:
    if not saved:
        return {"configured": False}
    s = saved["settings"]
    return {
        "configured": True, "email": saved["email"], "from_name": saved["from_name"],
        "smtp_host": s["smtp_host"], "smtp_port": s["smtp_port"], "smtp_security": s["smtp_security"],
        "imap_host": s["imap_host"], "imap_port": s["imap_port"], "username": s["username"],
        "has_password": bool(s.get("password")),
    }


async def save(db, body: Dict[str, Any]) -> Dict[str, Any]:
    """Checks the login (SMTP and IMAP) before saving; a blank password keeps the saved one."""
    from app.services import mail_transport as T
    from app.services.credits import _put_doc
    from app.services.secret_box import seal_secret

    addr = str(body.get("email") or "").strip().lower()
    if "@" not in addr:
        raise T.MailError("Enter the mailbox's email address.")
    current = await load(db)
    raw = {k: body.get(k) for k in ("preset", "smtp_host", "smtp_port", "smtp_security", "imap_host", "imap_port", "username", "password")}
    if not raw.get("password") and current:
        raw["password"] = current["settings"]["password"]
    settings = T.clean_settings(raw, addr)
    await T.check_login(settings)
    stored = {k: settings[k] for k in ("smtp_host", "smtp_port", "smtp_security", "imap_host", "imap_port", "username")}
    stored["password"] = seal_secret(settings["password"])
    await _put_doc(db, KEY, {"email": addr, "from_name": str(body.get("from_name") or "").strip()[:80], "settings": stored})
    global _cache
    _cache = {"email": addr, "from_name": str(body.get("from_name") or "").strip()[:80], "settings": settings}
    return public(_cache)


async def clear(db) -> None:
    from app.services.credits import _put_doc

    await _put_doc(db, KEY, {})
    global _cache
    _cache = {}


async def refresh() -> Dict[str, Any]:
    """Reloads the cached copy the system mailer reads (at startup)."""
    global _cache
    try:
        system_scope, Session = _system_db()
        with system_scope():
            async with Session() as db:
                _cache = await load(db)
    except Exception as err:
        logger.debug(f"platform mailbox not loaded: {err}")
        _cache = _cache or {}
    return _cache or {}


def cached() -> Dict[str, Any]:
    return _cache or {}


async def get() -> Dict[str, Any]:
    return _cache if _cache is not None else await refresh()
