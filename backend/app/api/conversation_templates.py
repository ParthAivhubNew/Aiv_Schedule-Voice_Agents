"""
Conversation Templates & Variables API
Provides:
- CRUD for dynamic conversation templates.
- Live prompt preview with sample lead/company context.
- CRUD for reusable conversation variables.
"""

from datetime import datetime
import asyncio
import logging
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.models import ConversationTemplate
from app.services.conversation_engine import (
    BASE_INBOUND_TEMPLATE_ID,
    BASE_OUTBOUND_TEMPLATE_ID,
    context_resolver,
    template_engine,
)

logger = logging.getLogger("conversation_templates_api")
router = APIRouter(prefix="/conversation-templates", tags=["Conversation Templates"])


class TemplatePayload(BaseModel):
    name: str
    description: Optional[str] = ""
    call_direction: str = "outbound"  # "outbound" | "inbound"
    mission_type: str = "demo"
    greeting_template: str
    permission_check_template: Optional[str] = ""
    value_prop_template: str
    objection_responses: Optional[Dict[str, str]] = {}
    booking_transition_template: str
    confirmation_template: str
    closing_template: str
    custom_rules: Optional[str] = ""
    demo_script: Optional[str] = ""
    flow_steps: Optional[List[str]] = []
    max_objection_attempts: int = 3
    agent_persona: str = "professional and friendly"
    tone_instructions: Optional[str] = ""
    is_active: bool = True
    is_default: bool = False


@router.get("/")
async def list_templates(
    call_direction: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """List all available conversation templates."""
    await template_engine.ensure_default_templates(db)

    query = select(ConversationTemplate)
    if call_direction:
        query = query.where(ConversationTemplate.call_direction == call_direction)

    query = query.order_by(ConversationTemplate.is_default.desc(), ConversationTemplate.created_at.desc())
    res = await db.execute(query)
    templates = res.scalars().all()

    return [{
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "call_direction": t.call_direction,
        "mission_type": t.mission_type,
        "is_active": t.is_active,
        "is_default": t.is_default,
        "times_used": t.times_used,
        "success_rate": t.success_rate,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    } for t in templates]


@router.get("/{template_id}")
async def get_template(template_id: str, db: AsyncSession = Depends(get_db)):
    """Retrieve full details of a specific conversation template."""
    await template_engine.ensure_default_templates(db)

    res = await db.execute(select(ConversationTemplate).where(ConversationTemplate.id == template_id))
    t = res.scalars().first()
    if not t:
        raise HTTPException(status_code=404, detail="Conversation template not found")

    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "call_direction": t.call_direction,
        "mission_type": t.mission_type,
        "greeting_template": t.greeting_template,
        "permission_check_template": t.permission_check_template,
        "value_prop_template": t.value_prop_template,
        "objection_responses": t.objection_responses or {},
        "booking_transition_template": t.booking_transition_template,
        "confirmation_template": t.confirmation_template,
        "closing_template": t.closing_template,
        "custom_rules": t.custom_rules or "",
        "demo_script": t.demo_script or "",
        "flow_steps": t.flow_steps or [],
        "max_objection_attempts": t.max_objection_attempts,
        "agent_persona": t.agent_persona,
        "tone_instructions": t.tone_instructions,
        "is_active": t.is_active,
        "is_default": t.is_default,
        "times_used": t.times_used,
        "success_rate": t.success_rate,
    }


@router.post("/")
async def create_template(payload: TemplatePayload, db: AsyncSession = Depends(get_db)):
    """Create a new conversation template."""
    t_id = f"tpl_{uuid.uuid4().hex[:12]}"
    template = ConversationTemplate(
        id=t_id,
        org_id="org_default",
        name=payload.name,
        description=payload.description,
        call_direction=payload.call_direction,
        mission_type=payload.mission_type,
        greeting_template=payload.greeting_template,
        permission_check_template=payload.permission_check_template,
        value_prop_template=payload.value_prop_template,
        objection_responses=payload.objection_responses or {},
        booking_transition_template=payload.booking_transition_template,
        confirmation_template=payload.confirmation_template,
        closing_template=payload.closing_template,
        custom_rules=payload.custom_rules,
        demo_script=payload.demo_script,
        flow_steps=payload.flow_steps or [],
        max_objection_attempts=payload.max_objection_attempts,
        agent_persona=payload.agent_persona,
        tone_instructions=payload.tone_instructions,
        is_active=payload.is_active,
        is_default=payload.is_default,
    )
    db.add(template)
    await db.commit()
    if template.is_active:
        from app.services.telnyx_assistant_sync import sync_active_prompt_to_telnyx
        asyncio.create_task(sync_active_prompt_to_telnyx(direction=template.call_direction))
    return {"success": True, "template_id": t_id, "message": "Template created successfully"}


@router.put("/{template_id}")
async def update_template(template_id: str, payload: TemplatePayload, db: AsyncSession = Depends(get_db)):
    """Update an existing conversation template."""
    res = await db.execute(select(ConversationTemplate).where(ConversationTemplate.id == template_id))
    t = res.scalars().first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    for k, v in payload.dict().items():
        setattr(t, k, v)
    t.updated_at = datetime.utcnow()
    await db.commit()
    if t.is_active:
        from app.services.telnyx_assistant_sync import sync_active_prompt_to_telnyx
        asyncio.create_task(sync_active_prompt_to_telnyx(direction=t.call_direction))
    return {"success": True, "template_id": template_id, "message": "Template updated successfully"}


@router.delete("/{template_id}")
async def delete_template(template_id: str, db: AsyncSession = Depends(get_db)):
    """Deactivate/delete a template (prevents deleting base defaults)."""
    if template_id in (BASE_OUTBOUND_TEMPLATE_ID, BASE_INBOUND_TEMPLATE_ID):
        raise HTTPException(status_code=400, detail="Cannot delete default base templates. You can edit them instead.")

    res = await db.execute(select(ConversationTemplate).where(ConversationTemplate.id == template_id))
    t = res.scalars().first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    await db.delete(t)
    await db.commit()
    return {"success": True, "message": "Template removed successfully"}


@router.post("/{template_id}/preview")
async def preview_template(
    template_id: str,
    sample_data: Optional[Dict[str, Any]] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Renders a live prompt preview using the SAME context resolution and booking policy
    a real call uses — your actual Company Profile and Booking & Call Rules, with only
    the prospect identity swapped for a sample lead so there's something to render.
    """
    await template_engine.ensure_default_templates(db)
    res = await db.execute(select(ConversationTemplate).where(ConversationTemplate.id == template_id))
    t = res.scalars().first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    sample = sample_data or {}
    direction = t.call_direction or "outbound"

    if direction == "inbound":
        context = await context_resolver.resolve_inbound(
            db, caller_phone=sample.get("prospect_phone") or "+447307216767"
        )
    else:
        context = await context_resolver.resolve_outbound(
            db,
            override_name=sample.get("prospect_name") or "Sarah Jenkins",
            override_company=sample.get("prospect_company") or "Apex Retail Group",
            override_email=sample.get("prospect_email") or "sarah@apexretail.com",
            override_phone=sample.get("prospect_phone") or "+447307216767",
        )

    try:
        from app.services.calendar_service import calendar_service
        from app.services.booking_policy import (
            normalize_booking_policy,
            voice_booking_instructions,
            voice_hangup_instructions,
        )
        setting = await calendar_service.get_or_create_settings(db)
        policy = normalize_booking_policy(getattr(setting, "booking_policy", None))
        context["policy_booking_instructions"] = voice_booking_instructions(policy)
        context["policy_hangup_instructions"] = voice_hangup_instructions(policy)
    except Exception as policy_err:
        logger.debug(f"Preview: booking policy unavailable ({policy_err})")

    rendered = template_engine.render_system_prompt(t, context)
    return {
        "success": True,
        "template_id": template_id,
        "template_name": t.name,
        "direction": direction,
        "rendered_prompt": rendered
    }
