"""Agent Studio (Voice): what clients control about their AI caller, without any keys.

Each user: their assistant's voice, model, how it speaks and listens (from what Telnyx offers,
"" = Telnyx default) and their own phone (for test calls and taking over calls). Everyone can add
the company's own voices (clones, free). Admins: the company's call rules, how every call behaves,
the default inbound and outbound scripts, and the script each campaign uses.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import get_db
from app.services import agent_studio, assistant_options

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


async def _has_number(db: AsyncSession, org_id: str) -> bool:
    from app.models.models import OrgPhoneNumber

    return (await db.execute(select(OrgPhoneNumber.id).where(OrgPhoneNumber.org_id == org_id,
                                                              OrgPhoneNumber.status == "active").limit(1))).first() is not None


async def _need_number(db: AsyncSession, org_id: str) -> None:
    """The assistant is set up only once the company has a number to call from (same as the page)."""
    if not await _has_number(db, org_id):
        raise HTTPException(status_code=409, detail="Add a phone number first: your assistant is set up once your company has one.")


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
        "managed": VA.enabled_for_org(ctx["org_id"]),
        "hasNumber": await _has_number(db, ctx["org_id"]),
        "canChangeCompany": _can_change_company(ctx),
        "isAdmin": bool(ctx.get("is_admin")),  # only admins open the Numbers page
        "me": {"voice": mine.voice if mine else "", "model": mine.model if mine else "", "phone": op.phone or "",
               "settings": assistant_options.clean_mine({}, (mine.settings or {}) if mine else {}),
               "effective": ((mine.settings or {}).get("effective") if mine else None) or {},
               "assistant": {"status": mine.status, "error": mine.last_error,
                             "syncedAt": mine.synced_at.isoformat() if mine.synced_at else None} if mine else None},
        "company": {
            "agentName": (company.caller_name if company else "") or "",
            "tone": (company.tone if company else "") or "",
            "disclosure": agent_studio.disclosure(company),
            "defaultOutboundTemplateId": (company.default_outbound_template_id if company else "") or "",
            "defaultInboundTemplateId": (company.default_inbound_template_id if company else "") or "",
            **await agent_studio.settings(db),
            "assistant": assistant_options.company_of(company.studio if company else {}),
        },
        "clones": [{k: c.get(k, "") for k in ("id", "name", "language", "gender", "status", "voice", "createdAt")}
                   for c in await assistant_options.clones(db, ctx["org_id"])],
        "catalogue": await platform_ai.catalogue_for_org(db, ctx["org_id"]),
        "templates": [{"id": t.id, "name": t.name, "direction": t.call_direction} for t in templates],
        "campaigns": [{"id": m.id, "title": m.title, "templateId": m.template_id or ""} for m in missions],
    }


class MeBody(BaseModel):
    settings: Optional[Dict[str, Any]] = None
    voice: Optional[str] = None
    model: Optional[str] = None
    phone: Optional[str] = None


@router.put("/me")
async def update_me(body: MeBody, request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.models import VoiceAssistant
    from app.services import platform_ai

    ctx = current(request)
    await _need_number(db, ctx["org_id"])
    op = await _me(db, ctx)
    cat = await platform_ai.catalogue_for_org(db, ctx["org_id"])
    if body.phone is not None:
        phone = re.sub(r"[\s()-]", "", body.phone)
        if phone and not _PHONE.match(phone):
            raise HTTPException(status_code=400, detail="Enter your phone in international format, e.g. +447700900123.")
        op.phone = phone
    changed = False
    row = None
    if body.voice is not None or body.model is not None or body.settings is not None:
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
        if field == "model" and any(i["id"] == value and i.get("needsKey") for i in cat["models"]):
            raise HTTPException(status_code=400, detail="That AI model needs your own provider key. Pick a Telnyx-hosted model.")
        if getattr(row, field) != value:
            setattr(row, field, value)
            changed = True
    if body.settings is not None:
        stt = str(body.settings.get("sttModel") or "").strip()
        if stt and stt not in {i["id"] for i in cat["stt"]}:
            raise HTTPException(status_code=400, detail="Pick a speech-to-text engine from the list.")
        mine = dict(row.settings or {})
        new = assistant_options.clean_mine(body.settings, mine)
        if any(mine.get(k) != v for k, v in new.items()):
            row.settings = {**mine, **new}
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
    assistant: Optional[Dict[str, Any]] = None


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
    if body.assistant is not None:
        from sqlalchemy import update

        from app.models.models import VoiceAssistant

        try:
            p.studio = {**p.studio, "assistant": assistant_options.clean_company(body.assistant, p.studio.get("assistant"))}
        except assistant_options.OptionError as err:
            raise HTTPException(status_code=400, detail=str(err))
        await db.execute(update(VoiceAssistant).values(synced_at=None))  # every assistant picks it up on its next call
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
    if not VA.enabled_for_org(ctx["org_id"]):
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


@router.get("/preview")
async def voice_preview(voice: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Hear a voice before picking it. Only voices this organisation may pick."""
    from fastapi.responses import Response

    from app.services import platform_ai
    from app.services.telnyx_client import TelnyxClient, TelnyxError, platform_key

    ctx = current(request)
    cat = await platform_ai.catalogue_for_org(db, ctx["org_id"])
    item = next((v for v in cat["voices"] if v["id"] == voice), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Pick a voice from the list.")
    try:
        audio, ctype = await assistant_options.preview(TelnyxClient(platform_key()), voice, item.get("language") or "")
    except TelnyxError as err:
        raise HTTPException(status_code=502, detail=f"Telnyx could not read this voice out: {err}")
    except Exception:
        raise HTTPException(status_code=503, detail="Voice previews are not available yet.")
    return Response(content=audio, media_type=ctype, headers={"Cache-Control": "private, max-age=86400"})


# ── The company's own voices (clones, free) ─────────────────────────────────
@router.post("/clones")
async def add_clone(request: Request, audio: UploadFile = File(...), name: str = Form(...), language: str = Form(...),
                    gender: str = Form(...), consent: bool = Form(False), refText: str = Form(""),
                    db: AsyncSession = Depends(get_db)):
    from app.services import voice_assistants as VA
    from app.services.telnyx_client import TelnyxError

    ctx = current(request)
    await _need_number(db, ctx["org_id"])
    content = await audio.read(assistant_options.CLONE_MAX_BYTES + 1)
    try:
        item = await assistant_options.add_clone(db, await VA._client(db), ctx["org_id"], name=name, language=language,
                                                 gender=gender, filename=audio.filename or "", content=content,
                                                 consent=consent, ref_text=refText, by=ctx.get("operator_id") or "")
    except assistant_options.OptionError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except TelnyxError as err:
        raise HTTPException(status_code=502, detail=f"Telnyx could not clone this voice: {err}")
    await db.commit()
    return {k: item.get(k, "") for k in ("id", "name", "language", "gender", "status", "voice", "createdAt")}


@router.delete("/clones/{clone_id}")
async def delete_clone(clone_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import update

    from app.models.models import VoiceAssistant
    from app.services import voice_assistants as VA

    ctx = current(request)
    item = next((c for c in await assistant_options.clones(db, ctx["org_id"]) if c["id"] == clone_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Voice not found.")
    if item.get("by") != (ctx.get("operator_id") or "") and not _can_change_company(ctx):
        raise HTTPException(status_code=403, detail="Only whoever added this voice, or an admin, can delete it.")
    voice = await assistant_options.delete_clone(db, await VA._client(db), ctx["org_id"], clone_id)
    if voice:  # assistants using it go back to the default voice
        await db.execute(update(VoiceAssistant).where(VoiceAssistant.voice == voice).values(voice="", synced_at=None))
    await db.commit()
    return {"ok": True}
