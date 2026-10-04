"""WhatsApp through Telnyx on the organisation's own numbers: inbox and replies by people.

WhatsApp's rule: a free-form message can only be sent within 24 hours of the contact's last
message. Outside that window only an approved template may be sent.
WhatsApp is part of the Voice app and runs only on Telnyx. Auto-replies are off: Outreach's own
AI never answers WhatsApp (see tell_admins).
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.future import select

from app.services.telnyx_client import TelnyxError

logger = logging.getLogger("whatsapp")

WINDOW = timedelta(hours=24)
_E164 = re.compile(r"\+?\d{8,15}")


def e164(raw: Any) -> str:
    if isinstance(raw, dict):
        raw = raw.get("phone_number") or raw.get("number") or ""
    if isinstance(raw, list):
        raw = raw[0] if raw else ""
        if isinstance(raw, dict):
            raw = raw.get("phone_number") or ""
    m = _E164.search(str(raw or ""))
    if not m:
        return ""
    d = m.group(0)
    return d if d.startswith("+") else "+" + d


def window_open(thread, now: Optional[datetime] = None) -> bool:
    now = now or datetime.utcnow()
    return bool(thread.last_inbound_at and now - thread.last_inbound_at < WINDOW)


async def whatsapp_numbers(db) -> List[Any]:
    from app.models.models import OrgPhoneNumber

    rows = (await db.execute(select(OrgPhoneNumber))).scalars().all()
    return [r for r in rows if "whatsapp" in (r.capabilities or []) and r.status == "active"]


async def get_or_create_thread(db, our: str, contact: str, name: str = "") -> Any:
    from app.models.models import WhatsappThread

    t = (await db.execute(select(WhatsappThread).where(
        WhatsappThread.our_number == our, WhatsappThread.contact_number == contact))).scalars().first()
    if t:
        if name and not t.contact_name:
            t.contact_name = name
        return t
    t = WhatsappThread(id=f"wt_{uuid.uuid4().hex[:12]}", our_number=our, contact_number=contact, contact_name=name or "")
    db.add(t)
    await db.flush()
    return t


async def _client(db):
    from app.services.telnyx_provisioning import client_for, get_setup

    return client_for(await get_setup(db))


async def send(db, thread, *, text: str = "", template: Optional[Dict[str, Any]] = None,
               sender: str = "human", sender_name: str = "") -> Any:
    """Send text (inside the 24-hour window) or a template. Records the message. Caller commits."""
    from app.models.models import WhatsappMessage
    from app.services.telephony_provider import public_http_base

    if template:
        body = {"type": "template", "template": {
            "name": template["name"], "language": {"code": template.get("language") or "en_GB"},
            **({"components": [{"type": "body", "parameters": [{"type": "text", "text": str(p)} for p in template.get("params") or []]}]}
               if template.get("params") else {}),
        }}
        kind, shown = "template", f"Template: {template['name']}"
    else:
        text = (text or "").strip()
        if not text:
            raise ValueError("Write a message first.")
        if not window_open(thread):
            raise ValueError("More than 24 hours since this contact last wrote: WhatsApp only allows an approved template now.")
        body = {"type": "text", "text": {"body": text[:4096]}}
        kind, shown = "text", text

    msg = WhatsappMessage(id=f"wm_{uuid.uuid4().hex[:12]}", thread_id=thread.id, direction="outbound", sender=sender,
                          sender_name=sender_name, kind=kind, text=shown[:4096], template=template, status="queued")
    db.add(msg)
    try:
        res = await (await _client(db)).send_whatsapp(thread.our_number, thread.contact_number, body,
                                                      webhook_url=f"{public_http_base()}/api/telnyx/messaging-webhook")
        msg.telnyx_message_id = str(res.get("id") or "")
        msg.status = "sent"
    except TelnyxError as err:
        msg.status, msg.error = "failed", str(err)[:500]
    thread.last_message_at = datetime.utcnow()
    thread.last_preview = shown[:120]
    return msg


async def record_inbound(db, our: str, contact: str, text: str, telnyx_id: str = "", name: str = "") -> Any:
    """Store an incoming message. Returns the thread, or None when Telnyx re-sent one we have."""
    from app.models.models import WhatsappMessage

    thread = await get_or_create_thread(db, our, contact, name)
    if telnyx_id and (await db.execute(select(WhatsappMessage).where(WhatsappMessage.telnyx_message_id == telnyx_id))).scalars().first():
        return None
    db.add(WhatsappMessage(id=f"wm_{uuid.uuid4().hex[:12]}", thread_id=thread.id, direction="inbound", sender="contact",
                           sender_name=name or "", text=(text or "")[:4096], status="received", telnyx_message_id=telnyx_id))
    now = datetime.utcnow()
    thread.last_inbound_at = now
    thread.last_message_at = now
    thread.last_preview = (text or "")[:120]
    thread.unread = (thread.unread or 0) + 1
    return thread


async def update_status(db, telnyx_id: str, status: str, error: str = "") -> None:
    from app.models.models import WhatsappMessage

    if not telnyx_id:
        return
    msg = (await db.execute(select(WhatsappMessage).where(WhatsappMessage.telnyx_message_id == telnyx_id))).scalars().first()
    if msg:
        order = ["queued", "sent", "delivered", "read"]
        if status == "failed" or (status in order and msg.status in order and order.index(status) > order.index(msg.status)):
            msg.status = status
            if error:
                msg.error = error[:500]


# ── New messages: a person replies ──────────────────────────────────────────
# Auto-replies are off: Outreach's own AI is never used for WhatsApp. Telnyx's AI assistant is
# the only AI WhatsApp may use, once it is confirmed for WhatsApp on these numbers; until then
# the company's admins are told about each conversation with something new to read.
def tell_admins(thread, text: str) -> None:
    """Email admins (whatsapp_message) when a conversation gets its first unread message."""
    if (thread.unread or 0) != 1:
        return  # already waiting for someone: no email per message

    async def run():
        try:
            from app.config import settings
            from app.core.notify import notify

            await notify("whatsapp_message", f"WhatsApp from {thread.contact_name or thread.contact_number}",
                         [f"“{(text or '')[:200]}”", "Auto-replies are off. Reply in the WhatsApp inbox."],
                         {"label": "Open WhatsApp", "url": (settings.PUBLIC_BASE_URL or "").rstrip("/") + "/voice/whatsapp"})
        except Exception as err:
            logger.warning(f"[whatsapp] could not tell admins: {err}")

    try:
        asyncio.get_running_loop().create_task(run())
    except RuntimeError:
        pass
