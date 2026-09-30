"""Notifications to the organisation's own users (email from the platform mailbox).

Each user chooses which events email them (Profile → Notifications). Defaults: admins get
everything, everyone else only what concerns them. Sending runs in the background and never
slows down or breaks the action that triggered it; every message is written to System logs.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict, Iterable, List, Optional

from sqlalchemy.future import select

logger = logging.getLogger("notify")

# key, label, who gets it by default
EVENTS = [
    ("meeting_booked", "A meeting is booked", "admins"),
    ("call_needs_review", "A call needs a person to follow up", "admins"),
    ("posts_awaiting_approval", "Posts are waiting for approval", "admins"),
    ("low_credits", "Credits are running low", "admins"),
    ("numbers", "Phone numbers and business verification updates", "admins"),
    ("whatsapp_message", "A WhatsApp message needs a person to reply", "admins"),
    ("security", "Security: password reset or account disabled", "everyone"),
]
EVENT_KEYS = [e[0] for e in EVENTS]


def default_prefs(is_admin: bool) -> Dict[str, bool]:
    return {k: (who == "everyone" or is_admin) for k, _, who in EVENTS}


def effective_prefs(stored: Optional[dict], is_admin: bool) -> Dict[str, bool]:
    prefs = default_prefs(is_admin)
    for k, v in (stored or {}).items():
        if k in prefs:
            prefs[k] = bool(v)
    return prefs


async def recipients(db, event: str, only_ids: Optional[Iterable[str]] = None) -> List[str]:
    """Emails of active users in the current organisation who want this event."""
    from app.core.accounts import effective_access, org_of
    from app.core.tenancy import current_org
    from app.models.models import Operator

    org = current_org()
    ops = (await db.execute(select(Operator))).scalars().all()
    wanted = set(only_ids) if only_ids else None
    out = []
    for op in ops:
        if org_of(op) != org or op.is_active is False or not (op.email or "").strip():
            continue
        if wanted is not None and op.id not in wanted:
            continue
        is_admin, _, _ = await effective_access(db, op)
        if effective_prefs(getattr(op, "notify_prefs", None), is_admin).get(event):
            out.append(op.email.strip())
    return out


async def _log(event: str, to: str, subject: str, res: dict) -> None:
    try:
        from app.services.process_logger import log_process_event

        await log_process_event(
            subsystem="system",
            process_name=f"email_{event}",
            message=f"Email '{subject}' to {to}: {'sent' if res.get('ok') else ('skipped' if res.get('skipped') else 'failed')}",
            level="SUCCESS" if res.get("ok") else "WARN",
            details={"to": to, "event": event, "error": res.get("error")},
        )
    except Exception:
        pass


async def _send_all(event: str, emails: List[str], subject: str, lines: List[str], button: Optional[dict]) -> None:
    from app.core.mailer import render, send_system_email

    msg = render(subject, lines, button)
    for to in emails:
        res = await send_system_email(to, subject, msg["html"], msg["text"])
        await _log(event, to, subject, res)


async def notify(event: str, subject: str, lines: List[str], button: Optional[dict] = None,
                 only_user_ids: Optional[Iterable[str]] = None) -> None:
    """Email everyone in the organisation who wants this event. Fire-and-forget."""
    if event not in EVENT_KEYS:
        return
    try:
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            emails = await recipients(db, event, only_user_ids)
        if emails:
            asyncio.get_running_loop().create_task(_send_all(event, emails, subject, lines, button))
    except Exception as err:
        logger.warning(f"[notify] {event} skipped: {err}")
