"""Cold Email Dispatcher & Pre-send Compliance Gate.

Enforces:
1. Suppression Check (Global platform suppression + Org-level unsubscribes)
2. UK PECR Entity Check (Blocks 'unknown' & 'individual' unless explicit consent exists)
3. Daily Mailbox Cap Check
4. RFC 8058 One-Click Unsubscribe Header injection (List-Unsubscribe & List-Unsubscribe-Post)
5. Message Logging & Send Counter Increment
"""
from __future__ import annotations

import asyncio
import email.utils
import json
import logging
import uuid
from datetime import datetime, date
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import (
    EmailMailbox,
    EmailMessage,
    EmailSendLog,
    EmailSuppression,
)
from app.services.secret_box import open_secret

logger = logging.getLogger("email_dispatcher")


async def is_email_suppressed(db: AsyncSession, email: str, org_id: str) -> Tuple[bool, str]:
    """Checks if an email is suppressed either globally or within the organization."""
    email_clean = email.strip().lower()
    domain = email_clean.split("@")[-1] if "@" in email_clean else ""

    stmt = select(EmailSuppression).where(
        (EmailSuppression.email == email_clean) |
        (EmailSuppression.domain == domain)
    ).where(
        (EmailSuppression.org_id == org_id) | (EmailSuppression.org_id == None)  # noqa: E711
    )
    result = await db.execute(stmt)
    entry = result.scalars().first()
    if entry:
        return True, entry.reason
    return False, ""


async def send_cold_email(
    db: AsyncSession,
    org_id: str,
    mailbox: EmailMailbox,
    recipient_email: str,
    subject: str,
    body_text: str,
    body_html: Optional[str] = None,
    campaign_id: Optional[str] = None,
    sequence_step_id: Optional[str] = None,
    prospect_id: Optional[str] = None,
    entity_type: str = "corporate",
    is_warmup: bool = False,
    unsubscribe_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Dispatches an email with strict compliance checks and deliverability headers."""
    recipient_clean = recipient_email.strip().lower()

    # 1. Check Suppression List
    suppressed, reason = await is_email_suppressed(db, recipient_clean, org_id)
    if suppressed:
        logger.info(f"Send blocked: {recipient_clean} is suppressed ({reason}).")
        return {"status": "suppressed", "reason": reason}

    # 2. PECR Compliance Check (Cold B2B requires corporate subscriber; non-corporate blocked)
    if not is_warmup and entity_type in ("individual", "unknown"):
        logger.info(f"Send blocked by PECR policy: {recipient_clean} has entity_type '{entity_type}'.")
        return {"status": "blocked_pecr", "reason": f"PECR Policy: entity_type '{entity_type}' requires prior consent."}

    # 3. Check and increment daily send logs
    today_str = date.today().isoformat()
    log_stmt = select(EmailSendLog).where(
        EmailSendLog.mailbox_id == mailbox.id,
        EmailSendLog.date == today_str
    )
    log_res = await db.execute(log_stmt)
    day_log = log_res.scalars().first()
    if not day_log:
        day_log = EmailSendLog(
            id=str(uuid.uuid4()),
            org_id=org_id,
            mailbox_id=mailbox.id,
            date=today_str,
            sent_count=0,
            warmup_sent_count=0,
            campaign_sent_count=0,
            bounced_count=0,
            complaint_count=0,
            reply_count=0,
        )
        db.add(day_log)

    if day_log.sent_count >= mailbox.daily_cap:
        return {"status": "cap_reached", "reason": f"Daily send cap ({mailbox.daily_cap}) reached for today."}

    # 4. Construct RFC 2822 / RFC 8058 compliant message
    msg = MIMEMultipart("alternative")
    message_id = email.utils.make_msgid(domain=mailbox.email.split("@")[-1])
    
    msg["Message-ID"] = message_id
    msg["From"] = f"{mailbox.display_name} <{mailbox.email}>" if mailbox.display_name else mailbox.email
    msg["To"] = recipient_clean
    msg["Subject"] = subject
    msg["Date"] = email.utils.formatdate(localtime=True)

    # Inject RFC 8058 One-Click Unsubscribe Headers
    unsub_link = unsubscribe_url or f"https://outreach.aivhub.com/api/email/unsubscribe?email={recipient_clean}&org={org_id}"
    msg["List-Unsubscribe"] = f"<{unsub_link}>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    # Attach Plain Text & HTML bodies
    part_text = MIMEText(body_text, "plain", "utf-8")
    msg.attach(part_text)
    if body_html:
        part_html = MIMEText(body_html, "html", "utf-8")
        msg.attach(part_html)

    # 5. Dispatch via Mailbox Provider / SMTP
    send_success = True
    error_msg = ""
    try:
        # If SMTP credentials configured
        if mailbox.provider == "smtp" and mailbox.credentials_encrypted:
            try:
                import aiosmtplib
            except ImportError:
                raise RuntimeError("aiosmtplib is required for SMTP email delivery.")
            creds = json.loads(open_secret(mailbox.credentials_encrypted) or "{}")
            host = creds.get("host", "smtp.gmail.com")
            port = int(creds.get("port", 587))
            user = creds.get("username", mailbox.email)
            password = creds.get("password", "")
            use_tls = creds.get("use_tls", True)

            await aiosmtplib.send(
                msg,
                hostname=host,
                port=port,
                username=user,
                password=password,
                start_tls=use_tls,
            )
        else:
            # Simulated / OAuth direct delivery mock in development
            logger.info(f"[Dispatcher] Dispatched cold email via {mailbox.provider} ({mailbox.email} -> {recipient_clean})")
    except Exception as exc:
        send_success = False
        error_msg = str(exc)
        logger.error(f"Failed to dispatch email {message_id}: {exc}")

    # 6. Record Message Log & Counters
    new_message = EmailMessage(
        id=str(uuid.uuid4()),
        org_id=org_id,
        mailbox_id=mailbox.id,
        campaign_id=campaign_id or "",
        sequence_step_id=sequence_step_id or "",
        prospect_id=prospect_id or "",
        message_id=message_id,
        recipient_email=recipient_clean,
        subject=subject,
        body_text=body_text,
        body_html=body_html or "",
        is_warmup=is_warmup,
        status="sent" if send_success else "failed",
        bounce_reason=error_msg,
        sent_at=datetime.utcnow() if send_success else None,
    )
    db.add(new_message)

    if send_success:
        day_log.sent_count += 1
        if is_warmup:
            day_log.warmup_sent_count += 1
        else:
            day_log.campaign_sent_count += 1

    await db.commit()

    return {
        "status": "sent" if send_success else "failed",
        "message_id": message_id,
        "recipient": recipient_clean,
        "error": error_msg,
    }
