"""Reads a mailbox's new mail and acts on it.

- Bounce: the address goes on the company's do-not-email list (permanent failures only), the
  sent email is marked bounced and the lead's sequence stops.
- Reply to a campaign email (matched by In-Reply-To / References, else by the sender being an
  active lead): the email is marked replied, the reply is sorted (interested, question,
  not interested, out of office, unsubscribe) and the sequence stops, except for out-of-office
  auto-replies. "Unsubscribe" also adds the address to the do-not-email list.
- Warmup email from another mailbox: only counted (the worker marks it read and rescues it
  from spam).
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import EmailEnrollment, EmailMailbox, EmailMessage
from app.services import mail_transport as T
from app.services.email_dispatcher import day_log, suppress

logger = logging.getLogger("inbox_reader")

CATEGORIES = ("interested", "question", "not_interested", "ooo", "unsubscribe")
_RULES = [
    ("unsubscribe", r"\b(unsubscribe|remove me|take me off|stop (emailing|contacting)|do not (email|contact)|opt.?out)\b"),
    ("ooo", r"\b(out of (the )?office|on (annual )?leave|on holiday|on vacation|away until|back on|auto.?reply|automatic reply)\b"),
    ("not_interested", r"\b(not interested|no thanks|no thank you|not a fit|not for us|we('| a)re all set|already have|not right now|not looking)\b"),
    ("interested", r"\b(interested|sounds good|let'?s (talk|chat|meet)|book a|schedule a|set up a call|happy to chat|send (me )?(more|details|info)|calendar|available)\b"),
    ("question", r"\?"),
]


def classify_rules(text: str, auto: bool = False) -> str:
    t = (text or "").lower()
    for cat, pattern in _RULES:
        if re.search(pattern, t):
            return cat
    return "ooo" if auto else "question"


async def classify(db: AsyncSession, text: str, auto: bool) -> str:
    """The platform AI sorts the reply; plain rules when no AI answers."""
    if auto:
        return "ooo"
    try:
        from app.services.llm_gateway import call_open_chat_llm

        res = await call_open_chat_llm(
            messages=[{"role": "user", "content": (text or "")[:1500]}],
            system_prompt=("Sort this reply to a sales email. Answer with JSON only: {\"category\": one of "
                           "interested, question, not_interested, ooo, unsubscribe}."),
            temperature=0, max_tokens=40, db=db)
        if res and res.get("success") and res.get("reply"):
            m = re.search(r"\{.*\}", res["reply"], re.S)
            cat = (json.loads(m.group(0)).get("category") if m else res["reply"]).strip().lower()
            if cat in CATEGORIES:
                return cat
    except Exception as err:
        logger.debug(f"reply AI unavailable: {err}")
    return classify_rules(text, auto)


async def _sent_message(db: AsyncSession, ids: List[str]) -> Optional[EmailMessage]:
    ids = [i for i in ids if i]
    if not ids:
        return None
    return (await db.execute(select(EmailMessage).where(EmailMessage.message_id.in_(ids), EmailMessage.is_warmup.is_(False))
                             .order_by(EmailMessage.sent_at.desc()))).scalars().first()


async def _stop(db: AsyncSession, enrollment_id: str, status: str) -> None:
    if not enrollment_id:
        return
    enr = (await db.execute(select(EmailEnrollment).where(EmailEnrollment.id == enrollment_id))).scalars().first()
    if enr and enr.status == "active":
        enr.status = status
        enr.next_action_at = None
        enr.last_action_at = datetime.utcnow()


async def process(db: AsyncSession, org_id: str, mb: EmailMailbox, messages: List[T.Incoming]) -> Dict[str, Any]:
    """Applies new mail to the outreach records. Returns counts and the warmup UIDs to mark read.
    The caller commits."""
    out = {"bounces": 0, "replies": 0, "warmup_uids": []}
    own = mb.email.lower()
    for inc in messages:
        if inc.from_addr == own:
            continue
        if inc.warmup_id:
            out["warmup_uids"].append(inc.uid)
            continue

        if inc.is_bounce:
            sent = await _sent_message(db, [inc.bounced_message_id])
            permanent = (inc.bounce_status or "5").startswith("5")
            targets = [sent.recipient_email] if sent else inc.failed_recipients
            for addr in targets:
                if not sent:
                    sent = (await db.execute(select(EmailMessage).where(
                        EmailMessage.recipient_email == addr, EmailMessage.mailbox_id == mb.id, EmailMessage.is_warmup.is_(False))
                        .order_by(EmailMessage.sent_at.desc()))).scalars().first()
                if permanent:
                    await suppress(db, org_id, addr, "hard_bounce", "inbox_reader")
            if sent and sent.status != "bounced":
                sent.status = "bounced"
                sent.bounce_reason = f"{inc.bounce_status} {T.reply_text(inc.text, 300)}".strip()
                if permanent:
                    await _stop(db, sent.enrollment_id, "bounced")
                log = await day_log(db, mb.id, (sent.sent_at or datetime.utcnow()).date().isoformat())
                log.bounced_count = (log.bounced_count or 0) + 1
                out["bounces"] += 1
            continue

        sent = await _sent_message(db, [inc.in_reply_to, *inc.references])
        if not sent:
            enr = (await db.execute(select(EmailEnrollment).where(
                EmailEnrollment.email == inc.from_addr, EmailEnrollment.status == "active"))).scalars().first()
            if enr and enr.last_message_id:
                sent = await _sent_message(db, [enr.last_message_id])
        if not sent or sent.status == "replied":
            continue
        text = T.reply_text(inc.text)
        category = await classify(db, f"{inc.subject}\n{text}", inc.auto_submitted)
        if category == "ooo":
            continue  # an auto-reply: the sequence carries on
        sent.status = "replied"
        sent.replied_at = datetime.utcnow()
        sent.reply_category = category
        sent.reply_snippet = text[:2000]
        sent.reply_from = inc.from_addr
        await _stop(db, sent.enrollment_id, "unsubscribed" if category == "unsubscribe" else "replied")
        if category == "unsubscribe":
            await suppress(db, org_id, inc.from_addr, "unsubscribe", "inbox_reader")
        log = await day_log(db, mb.id)
        log.reply_count = (log.reply_count or 0) + 1
        out["replies"] += 1
    return out
