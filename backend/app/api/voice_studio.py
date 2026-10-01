"""Agent Studio (Voice): what clients control about their AI caller, without any keys.

Each user: their assistant's voice and model (from the list staff allow) and their own phone
(for test calls and taking over calls). Admins: the company's call rules, the default inbound
and outbound scripts, and the script each campaign uses.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import get_db
from app.services import agent_studio

router = APIRouter(prefix="/voice-studio", tags=["Agent Studio"])

_PHONE = re.compile(r"^\+[1-9]\d{7,14}$")


def _can_change_company(ctx: Dict[str, Any]) -> bool:
    return bool(ctx.get("is_admin")) or (ctx.get("perms") or {}).get("company") == "full"


async def _me(db: AsyncSession, ctx: Dict[str, Any]):
    from app.models.models import Operator

    op = (await db.execute(select(Operator).where(Operator.id == ctx["operator_id"]))).scalars().first()
    if op is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return op


@router.get("")
async def studio(request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.models import ConversationTemplate, Mission, VoiceAssistant
    from app.services import platform_ai
    from app.services import voice_assistants as VA

    ctx = current(request)
    op = await _me(db, ctx)
    mine = (await db.execute(select(VoiceAssistant).where(VoiceAssistant.operator_id == op.id))).scalars().first()
    company = await agent_studio.profile(db)
    templates = (await db.execute(select(ConversationTemplate).order_by(ConversationTemplate.name))).scalars().all()
    missions = (await db.execute(select(Mission).order_by(Mission.title))).scalars().all()
    return {
        "managed": VA.enabled(),
        "canChangeCompany": _can_change_company(ctx),
        "me": {"voice": mine.voice if mine else "", "model": mine.model if mine else "", "phone": op.phone or "",
               "assistant": {"status": mine.status, "error": mine.last_error,
                             "syncedAt": mine.synced_at.isoformat() if mine.synced_at else None} if mine else None},
        "company": {
            "agentName": (company.caller_name if company else "") or "",
            "tone": (company.tone if company else "") or "",
            "disclosure": agent_studio.disclosure(company),
            "defaultOutboundTemplateId": (company.default_outbound_template_id if company else "") or "",
            "defaultInboundTemplateId": (company.default_inbound_template_id if company else "") or "",
            **await agent_studio.settings(db),
        },
        "catalogue": await platform_ai.catalogue(db),
        "templates": [{"id": t.id, "name": t.name, "direction": t.call_direction} for t in templates],
        "campaigns": [{"id": m.id, "title": m.title, "templateId": m.template_id or ""} for m in missions],
    }


class MeBody(BaseModel):
    voice: Optional[str] = None
    model: Optional[str] = None
    phone: Optional[str] = None


@router.put("/me")
async def update_me(body: MeBody, request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.models import VoiceAssistant
    from app.services import platform_ai

    ctx = current(request)
    op = await _me(db, ctx)
    cat = await platform_ai.catalogue(db)
    if body.phone is not None:
        phone = re.sub(r"[\s()-]", "", body.phone)
        if phone and not _PHONE.match(phone):
            raise HTTPException(status_code=400, detail="Enter your phone in international format, e.g. +447700900123.")
        op.phone = phone
    changed = False
    row = None
    if body.voice is not None or body.model is not None:
        row = (await db.execute(select(VoiceAssistant).where(VoiceAssistant.operator_id == op.id))).scalars().first()
        if row is None:
            import uuid

            row = VoiceAssistant(id=f"va_{uuid.uuid4().hex[:12]}", operator_id=op.id, status="pending")
            db.add(row)
    for field, kind in (("voice", "voices"), ("model", "models")):
        value = getattr(body, field)
        if value is None:
            continue
        value = value.strip()
        if value and value not in {i["id"] for i in cat[kind]}:
            raise HTTPException(status_code=400, detail=f"Pick a {field} from the list.")
        if getattr(row, field) != value:
            setattr(row, field, value)
            changed = True
    if changed:
        row.synced_at = None  # the assistant picks up the new voice/model on the next call
    await db.commit()
    return {"ok": True, "phone": op.phone or "", "voice": row.voice if row else None, "model": row.model if row else None}


class CompanyBody(BaseModel):
    agentName: Optional[str] = None
    tone: Optional[str] = None
    disclosure: Optional[str] = None
    handoverWhen: Optional[str] = None
    neverSay: Optional[str] = None
    captureFields: Optional[List[str]] = None
    recordCalls: Optional[bool] = None
    defaultOutboundTemplateId: Optional[str] = None
    defaultInboundTemplateId: Optional[str] = None


@router.put("/company")
async def update_company(body: CompanyBody, request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.models import CompanyProfile, ConversationTemplate

    ctx = current(request)
    if not _can_change_company(ctx):
        raise HTTPException(status_code=403, detail="Only admins can change the company's call rules.")
    p = await agent_studio.profile(db)
    if p is None:
        p = CompanyProfile(id="default")
        db.add(p)
    data = body.model_dump(exclude_none=True)
    if "agentName" in data:
        p.caller_name = data["agentName"].strip()[:60] or "Sam"
    if "tone" in data:
        p.tone = data["tone"].strip()[:200]
    if "disclosure" in data:
        p.disclosure = data["disclosure"].strip()[:300]
    for key, direction, attr in (("defaultOutboundTemplateId", "outbound", "default_outbound_template_id"),
                                 ("defaultInboundTemplateId", "inbound", "default_inbound_template_id")):
        if key in data:
            tid = data[key].strip()
            if tid:
                t = (await db.execute(select(ConversationTemplate).where(ConversationTemplate.id == tid))).scalars().first()
                if t is None or t.call_direction != direction:
                    raise HTTPException(status_code=400, detail=f"Pick an {direction} script.")
            setattr(p, attr, tid or None)
    p.studio = agent_studio.clean(data, p.studio if isinstance(p.studio, dict) else {})
    await db.commit()
    return {"ok": True, **agent_studio.clean({}, p.studio)}


class CampaignBody(BaseModel):
    templateId: str = ""


@router.put("/campaigns/{mission_id}")
async def set_campaign_script(mission_id: str, body: CampaignBody, request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.models import ConversationTemplate, Mission

    current(request)
    m = (await db.execute(select(Mission).where(Mission.id == mission_id))).scalars().first()
    if m is None:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    tid = body.templateId.strip()
    if tid:
        t = (await db.execute(select(ConversationTemplate).where(ConversationTemplate.id == tid))).scalars().first()
        if t is None or t.call_direction != "outbound":
            raise HTTPException(status_code=400, detail="Pick an outbound script.")
    m.template_id = tid
    await db.commit()
    return {"id": m.id, "templateId": tid}


class TestCallBody(BaseModel):
    templateId: str = ""
    fromNumber: str = ""


@router.post("/test-call")
async def test_call(body: TestCallBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Ring the user's own phone with their assistant and a script, to hear exactly what
    prospects hear."""
    from app.services import voice_assistants as VA
    from app.services.numbers import pick_caller_id
    from app.services.telnyx_assistant_dial import dial_via_telnyx_assistant

    ctx = current(request)
    op = await _me(db, ctx)
    if not op.phone:
        raise HTTPException(status_code=400, detail="Add your phone number first.")
    if not VA.enabled():
        raise HTTPException(status_code=400, detail="Test calls work once your call assistant is switched on by OutReach.")
    picked, err = await pick_caller_id(db, ctx, body.fromNumber or None)
    if err:
        raise HTTPException(status_code=403, detail=err)
    result = await dial_via_telnyx_assistant(db, op.phone, prospect_name=op.name or "Test call", mission_title="Test call",
                                             from_number_override=picked, operator_id=op.id,
                                             template_id=body.templateId.strip())
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error") or "The test call could not be placed.")
    return result
