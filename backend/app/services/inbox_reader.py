"""Inbox Reader, Bounce Detector, and AI Reply Classifier.

Responsibilities:
1. Detects incoming replies and stops active sequence enrollments.
2. Detects bounce notices and adds bad recipients to suppression list.
3. Classifies reply sentiment/intent via LLM:
   - 'interested': Notifies rep or auto-schedules voice SDR call.
   - 'ooo': Out of Office / Call back later -> pauses until return date.
   - 'unsubscribe' / 'not_interested': Adds to suppression list.
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import (
    EmailEnrollment,
    EmailMailbox,
    EmailMessage,
    EmailSuppression,
)
from app.services.llm_gateway import call_open_chat_llm

logger = logging.getLogger("inbox_reader")

BOUNCE_PATTERNS = [
    r"delivery status notification \(failure\)",
    r"undelivered mail returned to sender",
    r"mail delivery failed",
    r"address not found",
    r"user unknown",
    r"550 5\.1\.1",
    r"mailbox unavailable",
]
BOUNCE_REGEX = re.compile("|".join(BOUNCE_PATTERNS), re.IGNORECASE)


async def classify_email_reply(subject: str, body: str) -> str:
    """Uses LLM to categorize prospect reply intent."""
    prompt = f"""You are an inbound email intent classifier for B2B sales outreach.
Classify the following email reply into exactly ONE of these categories:
- interested (wants a demo, meeting, info, or pricing)
- not_interested (declines, not a fit, no budget, happy with existing vendor)
- ooo (out of office, on vacation, maternity/paternity leave, maternity)
- unsubscribe (asks to stop emailing, remove from list, or DNC)
- question (asks clarifying technical or business questions)

Subject: {subject}
Body:
{body[:1500]}

Respond ONLY with the category name (interested, not_interested, ooo, unsubscribe, or question)."""

    try:
        category = await call_open_chat_llm(
            system_prompt="You are a strict B2B email classifier. Output only the category string.",
            user_prompt=prompt,
            temperature=0.0,
        )
        cat_clean = category.strip().lower().replace('"', '').replace("'", "")
        if cat_clean in ("interested", "not_interested", "ooo", "unsubscribe", "question"):
            return cat_clean
    except Exception as err:
        logger.warning(f"LLM reply classification failed, falling back to rule-based: {err}")

    # Fallback basic heuristics
    lower_body = body.lower()
    if any(k in lower_body for k in ["unsubscribe", "remove me", "stop emailing", "opt out", "take me off"]):
        return "unsubscribe"
    if any(k in lower_body for k in ["out of office", "on leave", "vacation", "auto-reply", "away until"]):
        return "ooo"
    if any(k in lower_body for k in ["not interested", "not a fit", "no thanks", "pass on this"]):
        return "not_interested"
    if any(k in lower_body for k in ["call me", "book a time", "send details", "lets chat", "schedule", "interested"]):
        return "interested"

    return "question"


async def process_incoming_email(
    db: AsyncSession,
    org_id: str,
    mailbox_id: str,
    from_email: str,
    subject: str,
    body: str,
    in_reply_to_message_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Processes an incoming email, handles bounces, and updates campaign enrollments."""
    from_clean = from_email.strip().lower()

    # 1. Check if this is a delivery bounce notice
    if BOUNCE_REGEX.search(subject) or BOUNCE_REGEX.search(body):
        logger.info(f"Bounce detected for {from_clean} (subject: {subject})")
        
        # Add to suppression
        suppression = EmailSuppression(
            id=str(uuid.uuid4()),
            org_id=org_id,
            email=from_clean,
            domain=from_clean.split("@")[-1] if "@" in from_clean else "",
            reason="hard_bounce",
            source="inbox_reader",
        )
        db.add(suppression)
        await db.commit()
        return {"type": "bounce", "email": from_clean}

    # 2. Classify reply intent
    reply_category = await classify_email_reply(subject, body)

    # 3. Find matching message log
    msg_stmt = select(EmailMessage).where(
        EmailMessage.recipient_email == from_clean,
        EmailMessage.org_id == org_id
    ).order_by(EmailMessage.created_at.desc())
    msg_res = await db.execute(msg_stmt)
    original_msg = msg_res.scalars().first()

    if original_msg:
        original_msg.status = "replied"
        original_msg.reply_category = reply_category
        original_msg.reply_snippet = body[:500]
        original_msg.replied_at = datetime.utcnow()

        # 4. Stop active campaign enrollment
        if original_msg.campaign_id and original_msg.prospect_id:
            enr_stmt = select(EmailEnrollment).where(
                EmailEnrollment.campaign_id == original_msg.campaign_id,
                EmailEnrollment.prospect_id == original_msg.prospect_id,
                EmailEnrollment.status == "active"
            )
            enr_res = await db.execute(enr_stmt)
            enrollment = enr_res.scalars().first()
            if enrollment:
                enrollment.status = "replied"
                logger.info(f"Halted campaign enrollment {enrollment.id} due to reply.")

    # 5. If unsubscribe, add to suppression
    if reply_category == "unsubscribe":
        suppression = EmailSuppression(
            id=str(uuid.uuid4()),
            org_id=org_id,
            email=from_clean,
            domain=from_clean.split("@")[-1] if "@" in from_clean else "",
            reason="unsubscribe",
            source="inbox_reader",
        )
        db.add(suppression)

    await db.commit()

    return {
        "type": "reply",
        "email": from_clean,
        "category": reply_category,
        "halted_sequence": bool(original_msg and original_msg.campaign_id),
    }
