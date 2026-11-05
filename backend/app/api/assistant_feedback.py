"""POST /assistant/feedback               a thumbs up or down on one assistant answer (any plugin's assistant)
POST /assistant/feedback/{id}/lesson   the person kept the offered sentence in their Memory
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import current_org
from app.database import get_db
from app.services import assistant_feedback as AF

router = APIRouter(prefix="/assistant/feedback", tags=["Assistant"])


class FeedbackIn(BaseModel):
    plugin: str = "leads"
    rating: str = Field(..., pattern="^(up|down)$")
    reason: str = ""
    note: str = Field("", max_length=1000)
    question: str = Field("", max_length=4000)
    answer: str = Field("", max_length=8000)
    chat_id: str = ""
    message_id: str = ""
    context: Dict[str, Any] = {}


@router.post("")
async def rate(body: FeedbackIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    return await AF.record(db, org=current_org(), plugin=body.plugin, rating=body.rating, reason=body.reason, note=body.note, question=body.question,
                           answer=body.answer, chat_id=body.chat_id, message_id=body.message_id, context=body.context)


@router.post("/{feedback_id}/lesson")
async def lesson_kept(feedback_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    if not await AF.mark_lesson_saved(db, feedback_id, current_org()):
        raise HTTPException(status_code=404, detail="That rating was not found.")
    return {"ok": True}
