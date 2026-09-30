"""WhatsApp through Telnyx on the organisation's own numbers: inbox, AI replies, human replies.

WhatsApp's rule: a free-form message can only be sent within 24 hours of the contact's last
message. Outside that window only an approved template may be sent.
AI replies use the company profile and FAQs; when the contact asks for a person (or the AI is
unsure) it hands over: AI stops on that conversation and admins are told.
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
HANDOVER_TAG = "[HANDOVER]"
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


# ── AI replies ─────────────────────────────────────────────────────────────
async def _context(db) -> str:
    from app.models.models import FAQ, CompanyProfile

    prof = (await db.execute(select(CompanyProfile))).scalars().first()
    faqs = (await db.execute(select(FAQ).limit(30))).scalars().all()
    parts = []
    if prof:
        parts.append(f"Company: {prof.name}. {prof.pitch or ''}".strip())
        if getattr(prof, "website", ""):
            parts.append(f"Website: {prof.website}")
    for f in faqs:
        q, a = getattr(f, "question", "") or getattr(f, "q", ""), getattr(f, "answer", "") or getattr(f, "a", "")
        if q and a:
            parts.append(f"Q: {q}\nA: {a}")
    return "\n\n".join(parts)[:6000]


async def ai_reply(db, thread) -> Optional[Any]:
    """Write and send the AI's reply to the latest message. Returns the sent message or None."""
    from app.models.models import WhatsappMessage
    from app.services.llm_gateway import call_open_chat_llm

    history = (await db.execute(select(WhatsappMessage).where(WhatsappMessage.thread_id == thread.id)
                                .order_by(WhatsappMessage.created_at.desc()).limit(12))).scalars().all()
    history = list(reversed(history))
    msgs = [{"role": "user" if m.direction == "inbound" else "assistant", "content": m.text or ""} for m in history if m.text]
    system = (
        "You reply to WhatsApp messages on behalf of the business below. Be brief (1-3 short sentences), friendly and "
        "accurate. Only use the facts given; never invent prices, dates or promises. If the person asks for a human, "
        f"complains, or you cannot answer from the facts, reply that a colleague will get back to them and end with {HANDOVER_TAG}.\n\n"
        + (await _context(db))
    )
    res = await call_open_chat_llm(messages=msgs, system_prompt=system, temperature=0.4, max_tokens=300, db=db)
    reply = (res or {}).get("reply") or ""
    if not (res or {}).get("success") or not reply.strip():
        return None
    handover = HANDOVER_TAG in reply
    reply = reply.replace(HANDOVER_TAG, "").strip()
    sent = await send(db, thread, text=reply, sender="ai", sender_name="AI") if reply else None
    if handover:
        thread.ai_enabled = False
        try:
            from app.core.notify import notify
            from app.config import settings

            await notify("whatsapp_message", f"WhatsApp: {thread.contact_name or thread.contact_number} needs a person",
                         [f"The AI handed this conversation over. Last message: “{(history[-1].text if history else '')[:200]}”"],
                         {"label": "Open WhatsApp", "url": (settings.PUBLIC_BASE_URL or "").rstrip("/") + "/voice/whatsapp"})
        except Exception:
            pass
    return sent


def schedule_ai_reply(org_id: str, thread_id: str) -> None:
    """Reply in the background so the webhook answers Telnyx at once."""

    async def run():
        from app.core.tenancy import org_scope
        from app.database import AsyncSessionLocal
        from app.models.models import WhatsappThread

        await asyncio.sleep(1.2)  # people often send two messages in a row
        try:
            with org_scope(org_id):
                async with AsyncSessionLocal() as db:
                    t = (await db.execute(select(WhatsappThread).where(WhatsappThread.id == thread_id))).scalars().first()
                    if t and t.ai_enabled:
                        await ai_reply(db, t)
                        await db.commit()
        except Exception as err:
            logger.warning(f"[whatsapp] AI reply failed: {err}")

    try:
        asyncio.get_running_loop().create_task(run())
    except RuntimeError:
        pass
