from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import CompanyProfile, KnowledgeSource, Service, FAQ, Notification
from app.schemas.schemas import CompanyProfileSchema, KnowledgeSourceSchema, ServiceSchema, FAQSchema, NotificationSchema
from typing import Dict, Any, List
import uuid

router = APIRouter(prefix="/profile", tags=["Profile & Knowledge"])

@router.get("", response_model=dict)
async def get_profile(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
    profile = result.scalars().first()
    if not profile:
        profile = CompanyProfile(id="default")
        db.add(profile)
        await db.commit()
        await db.refresh(profile)
        
    return {
        "name": profile.name,
        "pitch": profile.pitch,
        "industry": profile.industry,
        "website": profile.website,
        "social": profile.social,
        "callerName": profile.caller_name,
        "callerId": profile.caller_id,
        "tone": profile.tone,
        "disclosure": profile.disclosure,
        "legalName": profile.legal_name,
        "icoRef": profile.ico_ref,
        "dpoContact": profile.dpo_contact,
        "dncNotes": profile.dnc_notes,
        "timezone": profile.timezone,
        "lunchStart": profile.lunch_start,
        "lunchEnd": profile.lunch_end,
        "callHoursPolicy": profile.call_hours_policy,
        "weekdayStart": profile.weekday_start,
        "weekdayEnd": profile.weekday_end,
    }

@router.put("", response_model=dict)
async def update_profile(req: CompanyProfileSchema, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
    profile = result.scalars().first()
    if not profile:
        profile = CompanyProfile(id="default")
        db.add(profile)
        
    profile.name = req.name
    profile.pitch = req.pitch
    profile.industry = req.industry
    profile.website = req.website
    profile.social = req.social
    profile.caller_name = req.caller_name
    profile.caller_id = req.caller_id
    profile.tone = req.tone
    profile.disclosure = req.disclosure
    profile.legal_name = req.legal_name
    profile.ico_ref = req.ico_ref
    profile.dpo_contact = req.dpo_contact
    profile.dnc_notes = req.dnc_notes
    profile.timezone = req.timezone
    profile.lunch_start = req.lunch_start
    profile.lunch_end = req.lunch_end
    profile.call_hours_policy = req.call_hours_policy
    profile.weekday_start = req.weekday_start
    profile.weekday_end = req.weekday_end
    
    await db.commit()
    return {"status": "ok", "message": "Company profile updated"}

# Knowledge Sources
@router.get("/sources", response_model=list[dict])
async def list_sources(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KnowledgeSource))
    sources = result.scalars().all()
    return [{
        "id": s.id,
        "name": s.name,
        "type": s.type,
        "value": s.value,
        "status": s.status,
        "synced": s.synced
    } for s in sources]

@router.post("/sources", response_model=dict)
async def add_source(req: KnowledgeSourceSchema, db: AsyncSession = Depends(get_db)):
    source = KnowledgeSource(
        id=f"k_{uuid.uuid4().hex[:6]}",
        name=req.name,
        type=req.type,
        value=req.value,
        status="indexed",
        synced="Just now"
    )
    db.add(source)
    await db.commit()
    return {"id": source.id, "status": "indexed"}

# Services
@router.get("/services", response_model=list[dict])
async def list_services(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Service))
    services = result.scalars().all()
    return [{
        "id": s.id,
        "name": s.name,
        "ideal": s.ideal,
        "desc": s.desc
    } for s in services]

# FAQs
@router.get("/faqs", response_model=list[dict])
async def list_faqs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FAQ))
    faqs = result.scalars().all()
    return [{
        "id": f.id,
        "q": f.question,
        "a": f.answer
    } for f in faqs]

# Notifications
@router.get("/notifications", response_model=list[dict])
async def list_notifications(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Notification).order_by(Notification.created_at.desc()))
    notifs = result.scalars().all()
    return [{
        "id": n.id,
        "text": n.text,
        "time": n.time,
        "unread": n.unread,
        "type": n.type
    } for n in notifs]
