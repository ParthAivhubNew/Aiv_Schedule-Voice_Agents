"""Sends one outreach or warmup email from a connected mailbox, and records it.

Before a campaign email goes out: the address must not be on the company's or the platform's
do-not-email list, and (UK PECR) it must belong to a company, not a person's own mailbox.
Every campaign email carries a one-click unsubscribe (RFC 8058 List-Unsubscribe headers plus a
link in the text); warmup emails carry the warmup header instead and are never cold email.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import uuid
from datetime import date, datetime
from email.message import EmailMessage as MimeMessage
from email.utils import formataddr, formatdate, make_msgid
from typing import Any, Dict, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.models.models import EmailMailbox, EmailMessage, EmailSendLog, EmailSuppression
from app.services import mail_transport as T
from app.services.secret_box import open_secret

logger = logging.getLogger("email_dispatcher")


# ── Mailbox settings ────────────────────────────────────────────────────────
def mailbox_settings(mb: EmailMailbox) -> Dict[str, Any]:
    try:
        raw = json.loads(open_secret(mb.credentials_encrypted or "") or "{}")
    except Exception:
        raw = {}
    return T.clean_settings(raw, mb.email)


# ── Unsubscribe links ───────────────────────────────────────────────────────
def _key() -> bytes:
    return hashlib.sha256(("email-unsubscribe:" + (settings.SECRET_KEY or "")).encode("utf-8")).digest()


def unsubscribe_token(org_id: str, email_addr: str) -> str:
    body = base64.urlsafe_b64encode(json.dumps([org_id, email_addr.lower()], separators=(",", ":")).encode()).decode().rstrip("=")
    mac = hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()[:24]
    return f"{body}.{mac}"


def read_unsubscribe_token(token: str) -> Optional[Tuple[str, str]]:
    try:
        body, mac = str(token or "").rsplit(".", 1)
        if not hmac.compare_digest(mac, hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()[:24]):
            return None
        org_id, addr = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        return str(org_id), str(addr)
    except Exception:
        return None


def unsubscribe_url(org_id: str, email_addr: str) -> str:
    return f"{settings.PUBLIC_BASE_URL.rstrip('/')}/api/email/u/{unsubscribe_token(org_id, email_addr)}"


# ── Do-not-email list ───────────────────────────────────────────────────────
async def is_email_suppressed(db: AsyncSession, email_addr: str, org_id: str) -> Tuple[bool, str]:
    """On this company's or the platform-wide list: the exact address, or its whole domain
    (a domain entry has no address)."""
    addr = (email_addr or "").strip().lower()
    domain = addr.split("@")[-1] if "@" in addr else ""
    q = select(EmailSuppression).where(
        (EmailSuppression.email == addr) | ((EmailSuppression.email == "") & (EmailSuppression.domain == domain))
    ).where((EmailSuppression.org_id == org_id) | (EmailSuppression.org_id.is_(None)))
    entry = (await db.execute(q)).scalars().first()
    return (True, entry.reason) if entry else (False, "")


async def suppress(db: AsyncSession, org_id: Optional[str], email_addr: str, reason: str, source: str) -> None:
    addr = (email_addr or "").strip().lower()
    if not addr:
        return
    q = select(EmailSuppression.id).where(EmailSuppression.email == addr)
    q = q.where(EmailSuppression.org_id == org_id) if org_id else q.where(EmailSuppression.org_id.is_(None))
    if (await db.execute(q)).first():
        return
    db.add(EmailSuppression(id=str(uuid.uuid4()), org_id=org_id, email=addr,
                            domain=addr.split("@")[-1] if "@" in addr else "", reason=reason, source=source))


# ── Daily counts ────────────────────────────────────────────────────────────
async def day_log(db: AsyncSession, mailbox_id: str, day: Optional[str] = None) -> EmailSendLog:
    day = day or date.today().isoformat()
    row = (await db.execute(select(EmailSendLog).where(EmailSendLog.mailbox_id == mailbox_id, EmailSendLog.date == day))).scalars().first()
    if not row:
        row = EmailSendLog(id=str(uuid.uuid4()), mailbox_id=mailbox_id, date=day, sent_count=0, warmup_sent_count=0,
                           campaign_sent_count=0, bounced_count=0, complaint_count=0, reply_count=0)
        db.add(row)
        await db.flush()
    return row


def _html_of(text: str) -> str:
    import html

    paras = [p for p in (text or "").split("\n\n")]
    return "".join(f"<p>{html.escape(p).replace(chr(10), '<br>')}</p>" for p in paras)


def build(mb: EmailMailbox, to: str, subject: str, text: str, *, org_id: str, warmup_id: str = "",
          in_reply_to: str = "", references: str = "") -> MimeMessage:
    msg = MimeMessage()
    msg["From"] = formataddr((mb.display_name or "", mb.email))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=False, usegmt=True)
    msg["Message-ID"] = make_msgid(domain=mb.email.split("@")[-1])
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = (references + " " + in_reply_to).strip()
    body = text.rstrip()
    if mb.signature:
        body += "\n\n" + mb.signature.strip()
    if warmup_id:
        msg[T.WARMUP_HEADER] = warmup_id
    else:
        link = unsubscribe_url(org_id, to)
        msg["List-Unsubscribe"] = f"<{link}>, <mailto:{mb.email}?subject=unsubscribe>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
        body += f"\n\n--\nNot interested? Unsubscribe: {link}"
    msg.set_content(body)
    msg.add_alternative(_html_of(body), subtype="html")
    return msg


async def send_cold_email(
    db: AsyncSession,
    org_id: str,
    mailbox: EmailMailbox,
    recipient_email: str,
    subject: str,
    body_text: str,
    *,
    campaign_id: str = "",
    sequence_step_id: str = "",
    enrollment_id: str = "",
    prospect_id: str = "",
    entity_type: str = "corporate",
    is_warmup: bool = False,
    warmup_id: str = "",
    in_reply_to: str = "",
) -> Dict[str, Any]:
    """Checks, sends and records one email. Returns {status: sent|suppressed|blocked_pecr|failed, ...}.
    The caller commits."""
    to = (recipient_email or "").strip().lower()
    if not is_warmup:
        suppressed, reason = await is_email_suppressed(db, to, org_id)
        if suppressed:
            return {"status": "suppressed", "reason": reason}
        if entity_type == "individual":
            return {"status": "blocked_pecr", "reason": "UK PECR: a person's own mailbox needs their consent first."}

    msg = build(mailbox, to, subject, body_text, org_id=org_id, warmup_id=warmup_id if is_warmup else "",
                in_reply_to=in_reply_to)
    try:
        await T.send(mailbox_settings(mailbox), msg)
    except T.MailError as err:
        mailbox.last_error = str(err)
        logger.warning(f"[Email] {mailbox.email} -> {to} failed: {err}")
        return {"status": "failed", "reason": str(err)}

    now = datetime.utcnow()
    mailbox.last_error = ""
    mailbox.last_sent_at = now
    row = EmailMessage(id=str(uuid.uuid4()), mailbox_id=mailbox.id, campaign_id=campaign_id or "",
                       sequence_step_id=sequence_step_id or "", enrollment_id=enrollment_id or "",
                       prospect_id=prospect_id or "", message_id=msg["Message-ID"], thread_id=in_reply_to or msg["Message-ID"],
                       recipient_email=to, subject=subject, body_text=body_text, is_warmup=is_warmup,
                       status="sent", sent_at=now)
    db.add(row)
    log = await day_log(db, mailbox.id)
    log.sent_count = (log.sent_count or 0) + 1
    if is_warmup:
        log.warmup_sent_count = (log.warmup_sent_count or 0) + 1
    else:
        log.campaign_sent_count = (log.campaign_sent_count or 0) + 1
    if not is_warmup:
        from app.services.credits import charge

        await charge(db, "email_send", 1, f"email:{row.id[:16]}", f"Email to {to}")
    return {"status": "sent", "message_id": msg["Message-ID"], "id": row.id}
