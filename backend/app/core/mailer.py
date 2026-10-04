"""System email: messages sent by Outreach by Aivhub itself (invites, password resets, alerts).

One mailbox for the whole platform: the one staff set in the owner portal (Platform mailbox),
or else the environment:
    SYSTEM_MAIL_HOST, SYSTEM_MAIL_PORT (587), SYSTEM_MAIL_USER, SYSTEM_MAIL_PASSWORD,
    SYSTEM_MAIL_FROM (defaults to the user), SYSTEM_MAIL_FROM_NAME, SYSTEM_MAIL_TLS
    ("starttls" default, "ssl" for port 465, "none").
Organisations' own outreach email (campaigns, prospect invites) keeps using their own
connected mailbox; this is only for platform notifications.

Sending never raises: a mail problem is logged and returned, never breaks the action that
triggered it. When the mailbox is not configured yet, messages are logged as skipped.
"""
from __future__ import annotations

import asyncio
import html as _html
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Any, Dict, Optional

logger = logging.getLogger("mailer")

BRAND = "Outreach by Aivhub"


def _saved() -> Dict[str, Any]:
    """The platform mailbox staff set in the owner portal (wins over the environment)."""
    from app.services.platform_mailbox import cached

    return cached()


def configured() -> bool:
    if _saved():
        return True
    return bool(os.getenv("SYSTEM_MAIL_HOST") and os.getenv("SYSTEM_MAIL_USER") and os.getenv("SYSTEM_MAIL_PASSWORD"))


def _sender() -> tuple:
    saved = _saved()
    if saved:
        return saved.get("from_name") or BRAND, saved["email"]
    return os.getenv("SYSTEM_MAIL_FROM_NAME", BRAND), os.getenv("SYSTEM_MAIL_FROM") or os.getenv("SYSTEM_MAIL_USER", "")


def _send_sync(msg: EmailMessage) -> None:
    saved = _saved()
    if saved:
        from app.services.mail_transport import _send_sync as send_with

        send_with(saved["settings"], msg)
        return
    host = os.getenv("SYSTEM_MAIL_HOST", "")
    port_env = os.getenv("SYSTEM_MAIL_PORT", "").strip()
    # Port 465 means SSL from the first byte (e.g. one.com send.one.com:465); 587 means STARTTLS.
    mode = (os.getenv("SYSTEM_MAIL_TLS") or ("ssl" if port_env == "465" else "starttls")).lower()
    port = int(port_env or ("465" if mode == "ssl" else "587"))
    user = os.getenv("SYSTEM_MAIL_USER", "")
    pw = os.getenv("SYSTEM_MAIL_PASSWORD", "")
    ctx = ssl.create_default_context()
    if mode == "ssl":
        with smtplib.SMTP_SSL(host, port, timeout=20, context=ctx) as s:
            s.login(user, pw)
            s.send_message(msg)
        return
    with smtplib.SMTP(host, port, timeout=20) as s:
        s.ehlo()
        if mode != "none":
            s.starttls(context=ctx)
            s.ehlo()
        s.login(user, pw)
        s.send_message(msg)


def render(title: str, paragraphs: list, button: Optional[Dict[str, str]] = None, footer: str = "") -> Dict[str, str]:
    """Plain, branded HTML + text versions of a short notification."""
    body_html = "".join(f'<p style="font-size:14px;line-height:1.5;margin:0 0 12px">{p}</p>' for p in paragraphs)
    btn = ""
    if button:
        btn = (f'<p style="margin:18px 0"><a href="{_html.escape(button["url"])}" style="display:inline-block;background:#12141C;'
               f'color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px">{_html.escape(button["label"])}</a></p>')
    html_doc = (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#12141C;max-width:560px">'
        f'<div style="font-weight:700;font-size:13px;color:#3457D5;margin-bottom:14px">{BRAND}</div>'
        f'<h2 style="font-size:18px;margin:0 0 12px">{_html.escape(title)}</h2>{body_html}{btn}'
        f'<p style="font-size:12px;color:#8A8F9C;margin-top:22px">{footer or "Sent by " + BRAND + "."}</p></div>'
    )
    import re as _re

    text = title + "\n\n" + "\n\n".join(_re.sub(r"<[^>]+>", "", p) for p in paragraphs)
    if button:
        text += f"\n\n{button['label']}: {button['url']}"
    return {"html": html_doc, "text": text}


async def send_system_email(to: str, subject: str, html_body: str, text_body: str, reply_to: Optional[str] = None) -> Dict[str, Any]:
    to = (to or "").strip()
    if not to or "@" not in to:
        return {"ok": False, "error": "No email address."}
    if not configured():
        logger.info(f"[mailer] System mailbox not configured; skipped '{subject}' to {to}.")
        return {"ok": False, "skipped": True, "error": "System mailbox is not configured yet."}
    from_name, sender = _sender()
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, sender))
    msg["To"] = to
    msg["Message-ID"] = make_msgid(domain=sender.split("@")[-1] if "@" in sender else None)
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")
    last = ""
    for attempt in range(2):
        try:
            await asyncio.to_thread(_send_sync, msg)
            logger.info(f"[mailer] Sent '{subject}' to {to}.")
            return {"ok": True}
        except Exception as err:  # retry once, then give up quietly
            last = str(err)[:300]
            await asyncio.sleep(1.5)
    logger.warning(f"[mailer] Could not send '{subject}' to {to}: {last}")
    return {"ok": False, "error": last}
