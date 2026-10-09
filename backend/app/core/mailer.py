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
LOGO_SRC = "cid:brand-logo"  # the logo is attached to each message, so it shows even when remote images are blocked
LOGO_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "brand-logo.png")


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


_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


def render(title: str, paragraphs: list, button: Optional[Dict[str, str]] = None, footer: str = "",
           highlights: Optional[list] = None, note: str = "", preheader: str = "") -> Dict[str, str]:
    """Branded HTML + text versions of a notification, in the platform's one email design.

    paragraphs are HTML (the caller escapes anything user-supplied); title is plain text.
    highlights: optional [(heading, text), ...] shown as a short "what you get" list under the
    button. note: a small line under the button (e.g. when a link expires). preheader: the grey
    preview line some inboxes show beside the subject. Tables and inline styles only, so it
    renders the same in Gmail, Outlook and phone apps; no images to block."""
    e = _html.escape
    body_html = "".join(f'<p style="font-size:15px;line-height:1.65;margin:0 0 16px;color:#3B4252">{p}</p>' for p in paragraphs)
    btn = ""
    link_help = ""
    if button:
        url, label = e(button["url"], quote=True), e(button["label"])
        btn = (
            '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 8px"><tr>'
            f'<td align="center" bgcolor="#3457D5" style="border-radius:12px;background:linear-gradient(135deg,#3457D5,#5B3FD9)">'
            f'<a href="{url}" style="display:inline-block;padding:15px 34px;font-family:{_FONT};font-size:15px;font-weight:700;'
            f'color:#FFFFFF;text-decoration:none;border-radius:12px">{label} &rarr;</a></td></tr></table>'
        )
        link_help = (f'<p style="font-size:12px;line-height:1.6;color:#8A8F9C;margin:14px 0 0">Button not working? Paste this link '
                     f'into your browser:<br><a href="{url}" style="color:#3457D5;word-break:break-all;text-decoration:none">{url}</a></p>')
    note_html = f'<p style="font-size:13px;line-height:1.6;color:#6B7280;margin:6px 0 0">{note}</p>' if note else ""
    tiles = ""
    if highlights:
        cells = "".join(
            f'<td valign="top" width="33%" bgcolor="#F4F6FB" style="background:#F4F6FB;border-radius:12px;padding:14px 12px">'
            f'<div style="font-size:13px;font-weight:700;color:#12141C;margin-bottom:4px">{e(h)}</div>'
            f'<div style="font-size:12px;line-height:1.5;color:#6B7280">{e(t)}</div></td>' for h, t in highlights)
        # Cells in one row share a height, so the tiles line up; the spacing is the gap between them.
        tiles = (f'<table role="presentation" width="100%" cellspacing="8" cellpadding="0" border="0" style="margin:22px -8px 0;'
                 f'width:calc(100% + 16px)"><tr>{cells}</tr></table>')
    pre = (f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">{e(preheader)}</div>' if preheader else "")
    html_doc = (
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{e(title)}</title></head>'
        f'<body style="margin:0;padding:0;background:#EEF1F8">{pre}'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#EEF1F8" style="background:#EEF1F8">'
        '<tr><td align="center" style="padding:28px 14px">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">'
        # header band
        f'<tr><td align="center" bgcolor="#3457D5" style="background:linear-gradient(135deg,#3457D5 0%,#5B3FD9 100%);'
        f'border-radius:20px 20px 0 0;padding:34px 24px 58px">'
        # The software's own logo (attached inline by send_system_email), then its two-line name.
        f'<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>'
        f'<td valign="middle" bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:14px;padding:3px">'
        f'<img src="{LOGO_SRC}" width="40" height="40" alt="Outreach" style="display:block;width:40px;height:40px;border:0;border-radius:11px"></td>'
        f'<td valign="middle" style="padding-left:12px;font-family:{_FONT};text-align:left;line-height:1.15">'
        f'<div style="font-size:20px;font-weight:700;color:#FFFFFF;letter-spacing:-0.2px">Outreach</div>'
        f'<div style="font-size:10.5px;font-weight:600;color:#C9D3FF;letter-spacing:0.14em">BY AIVHUB</div></td>'
        '</tr></table></td></tr>'
        # card, pulled up over the band
        f'<tr><td style="padding:0 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        f'style="margin-top:-34px;background:#FFFFFF;border-radius:18px;box-shadow:0 10px 30px rgba(38,64,158,0.14)">'
        f'<tr><td style="padding:36px 34px 34px;font-family:{_FONT}">'
        f'<h1 style="font-size:24px;line-height:1.3;margin:0 0 18px;color:#12141C;letter-spacing:-0.4px">{e(title)}</h1>'
        f'{body_html}{btn}{note_html}{link_help}{tiles}'
        '</td></tr></table></td></tr>'
        # footer
        f'<tr><td align="center" style="padding:26px 24px 8px;font-family:{_FONT};font-size:12px;line-height:1.7;color:#8A8F9C">'
        f'{footer or "Sent by " + BRAND + "."}<br>You are getting this because of activity on your {BRAND} account.</td></tr>'
        '</table></td></tr></table></body></html>'
    )
    import re as _re

    def plain(fragment: str) -> str:
        return _html.unescape(_re.sub(r"<[^>]+>", "", fragment))

    gap = "\n\n"
    text = title + gap + gap.join(plain(p) for p in paragraphs)
    if button:
        text += f"{gap}{button['label']}: {button['url']}"
    if note:
        text += gap + plain(note)
    if highlights:
        text += gap + "\n".join(f"- {h}: {t}" for h, t in highlights)
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
    if LOGO_SRC in html_body:
        try:
            with open(LOGO_FILE, "rb") as fh:
                msg.get_payload()[1].add_related(fh.read(), "image", "png", cid="<brand-logo>", filename="outreach.png")
        except OSError as err:  # no logo file: the mail still goes, with the alt text in its place
            logger.warning(f"[mailer] Logo not attached: {err}")
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
