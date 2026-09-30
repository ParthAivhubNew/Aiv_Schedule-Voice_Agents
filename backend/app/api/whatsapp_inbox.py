"""WhatsApp inbox for the organisation: conversations, sending, AI on/off per conversation,
and asking for WhatsApp on one of its numbers."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import get_db
from app.services import whatsapp as WA

router = APIRouter(prefix="/wa", tags=["WhatsApp"])


def _thread_json(t) -> Dict[str, Any]:
    return {"id": t.id, "ourNumber": t.our_number, "contactNumber": t.contact_number, "contactName": t.contact_name,
            "aiEnabled": bool(t.ai_enabled), "unread": t.unread or 0, "preview": t.last_preview,
            "windowOpen": WA.window_open(t),
            "lastMessageAt": t.last_message_at.isoformat() if t.last_message_at else None}


def _msg_json(m) -> Dict[str, Any]:
    return {"id": m.id, "direction": m.direction, "sender": m.sender, "senderName": m.sender_name, "kind": m.kind,
            "text": m.text, "status": m.status, "error": m.error, "at": m.created_at.isoformat() if m.created_at else None}


async def _thread(db, thread_id: str):
    from app.models.models import WhatsappThread

    t = (await db.execute(select(WhatsappThread).where(WhatsappThread.id == thread_id))).scalars().first()
    if not t:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return t


@router.get("/status")
async def status(db: AsyncSession = Depends(get_db)):
    from app.models.models import OrgPhoneNumber

    numbers = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.status == "active"))).scalars().all()
    return {"numbers": [{"id": n.id, "e164": n.e164, "whatsapp": "whatsapp" in (n.capabilities or []),
                         "requested": "whatsapp_requested" in (n.capabilities or [])} for n in numbers]}


@router.get("/threads")
async def threads(db: AsyncSession = Depends(get_db)):
    from app.models.models import WhatsappThread

    rows = (await db.execute(select(WhatsappThread).order_by(WhatsappThread.last_message_at.desc()).limit(200))).scalars().all()
    return [_thread_json(t) for t in rows]


@router.get("/threads/{thread_id}")
async def thread_messages(thread_id: str, db: AsyncSession = Depends(get_db)):
    from app.models.models import WhatsappMessage

    t = await _thread(db, thread_id)
    msgs = (await db.execute(select(WhatsappMessage).where(WhatsappMessage.thread_id == t.id)
                             .order_by(WhatsappMessage.created_at).limit(500))).scalars().all()
    if t.unread:
        t.unread = 0
        await db.commit()
    return {"thread": _thread_json(t), "messages": [_msg_json(m) for m in msgs]}


class TemplateBody(BaseModel):
    name: str
    language: str = "en_GB"
    params: List[str] = []


class SendBody(BaseModel):
    text: Optional[str] = None
    template: Optional[TemplateBody] = None


@router.post("/threads/{thread_id}/send")
async def send(thread_id: str, body: SendBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    t = await _thread(db, thread_id)
    try:
        msg = await WA.send(db, t, text=body.text or "", template=body.template.model_dump() if body.template else None,
                            sender="human", sender_name=ctx.get("name", ""))
    except ValueError as err:
        raise HTTPException(status_code=400, detail={"message": str(err), "code": "window_closed" if "24 hours" in str(err) else "bad_message"})
    t.ai_enabled = False  # a person replied: the AI steps back on this conversation
    await db.commit()
    if msg.status == "failed":
        raise HTTPException(status_code=502, detail=msg.error or "WhatsApp did not accept the message.")
    return _msg_json(msg)


class NewThreadBody(BaseModel):
    ourNumber: str
    contactNumber: str
    contactName: str = ""
    template: TemplateBody


@router.post("/threads")
async def start(body: NewThreadBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Start a conversation. WhatsApp requires an approved template for the first message."""
    ctx = current(request)
    ours = {n.e164 for n in await WA.whatsapp_numbers(db)}
    our, contact = WA.e164(body.ourNumber), WA.e164(body.contactNumber)
    if our not in ours:
        raise HTTPException(status_code=400, detail="That number is not set up for WhatsApp yet.")
    if not contact:
        raise HTTPException(status_code=400, detail="Enter the contact's number with country code, e.g. +447700900123.")
    t = await WA.get_or_create_thread(db, our, contact, body.contactName.strip())
    msg = await WA.send(db, t, template=body.template.model_dump(), sender="human", sender_name=ctx.get("name", ""))
    await db.commit()
    if msg.status == "failed":
        raise HTTPException(status_code=502, detail=msg.error or "WhatsApp did not accept the message.")
    return _thread_json(t)


class ThreadPatch(BaseModel):
    aiEnabled: Optional[bool] = None
    contactName: Optional[str] = None


@router.patch("/threads/{thread_id}")
async def patch(thread_id: str, body: ThreadPatch, db: AsyncSession = Depends(get_db)):
    t = await _thread(db, thread_id)
    if body.aiEnabled is not None:
        t.ai_enabled = body.aiEnabled
    if body.contactName is not None:
        t.contact_name = body.contactName.strip()[:120]
    await db.commit()
    return _thread_json(t)


@router.post("/numbers/{number_id}/request")
async def request_whatsapp(number_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Ask for WhatsApp on a number. Meta's business signup is completed with the OutReach team;
    staff then switch the number on."""
    from app.models.models import OrgPhoneNumber

    ctx = current(request)
    if not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can turn on WhatsApp.")
    n = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.id == number_id))).scalars().first()
    if not n:
        raise HTTPException(status_code=404, detail="Number not found.")
    caps = list(n.capabilities or [])
    if "whatsapp" not in caps and "whatsapp_requested" not in caps:
        caps.append("whatsapp_requested")
        n.capabilities = caps
        await db.commit()
    return {"ok": True, "capabilities": n.capabilities}
