"""WhatsApp in the public API: read the conversations on the company's WhatsApp numbers and reply.

It runs the same code as the app's WhatsApp inbox, so the 24-hour reply window and the approved-template rule for a first message
apply here exactly as they do there. A key needs the voice:calls permission and the Voice plan. Test keys see an empty inbox and
nothing is sent.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.public_api.core import V1Route, app_call, authorize, is_test

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp"], route_class=V1Route)

SCOPE = "voice:calls"


class TemplateIn(BaseModel):
    name: str = Field(..., max_length=200, description="The approved template's name")
    language: str = Field("en_GB", max_length=20)
    params: List[str] = Field(default_factory=list, description="Values for the template's blanks, in order")


class SendIn(BaseModel):
    text: Optional[str] = Field(None, max_length=4096, description="A message. Allowed within 24 hours of the person's last message")
    template: Optional[TemplateIn] = Field(None, description="An approved template. Needed to write first or after 24 hours")


class StartIn(BaseModel):
    our_number: str = Field(..., description="One of your WhatsApp numbers, e.g. +442079460000")
    contact_number: str = Field(..., description="The person's number with country code")
    contact_name: str = Field("", max_length=120)
    template: TemplateIn


@router.get("/numbers")
async def numbers(request: Request, db: AsyncSession = Depends(get_db)):
    """Your numbers and whether WhatsApp is on for each."""
    from app.api import whatsapp_inbox as W

    ctx = await authorize(request, db, SCOPE, "voice")
    if is_test(ctx):
        return {"numbers": [], "simulated": True}
    return await app_call(W.status(request, db))


@router.get("/threads")
async def threads(request: Request, db: AsyncSession = Depends(get_db)):
    """Conversations, newest first, with the unread count, a preview and whether you can still reply freely (`windowOpen`)."""
    from app.api import whatsapp_inbox as W

    ctx = await authorize(request, db, SCOPE, "voice")
    if is_test(ctx):
        return {"threads": [], "simulated": True}
    return {"threads": await app_call(W.threads(db))}


@router.get("/threads/{thread_id}")
async def thread(thread_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """One conversation's messages. Reading it marks it read."""
    from app.api import whatsapp_inbox as W

    ctx = await authorize(request, db, SCOPE, "voice")
    if is_test(ctx):
        return {"thread": {"id": thread_id}, "messages": [], "simulated": True}
    return await app_call(W.thread_messages(thread_id, db))


@router.post("/threads/{thread_id}/send", status_code=201)
async def send(thread_id: str, body: SendIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Reply in a conversation. After 24 hours of silence only an approved template is accepted (`window_closed`)."""
    from app.api import whatsapp_inbox as W

    ctx = await authorize(request, db, SCOPE, "voice")
    if is_test(ctx):
        return {"id": "wm_test", "direction": "outbound", "text": body.text or "", "status": "sent", "simulated": True}
    return await app_call(W.send(thread_id, W.SendBody(text=body.text, template=W.TemplateBody(**body.template.model_dump()) if body.template else None),
                                 request, db))


@router.post("/threads", status_code=201)
async def start(body: StartIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Start a conversation. WhatsApp requires an approved template for the first message."""
    from app.api import whatsapp_inbox as W

    ctx = await authorize(request, db, SCOPE, "voice")
    if is_test(ctx):
        return {"id": "wt_test", "ourNumber": body.our_number, "contactNumber": body.contact_number, "simulated": True}
    return await app_call(W.start(W.NewThreadBody(ourNumber=body.our_number, contactNumber=body.contact_number, contactName=body.contact_name,
                                                  template=W.TemplateBody(**body.template.model_dump())), request, db))
