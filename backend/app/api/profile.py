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
async def update_profile(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
    profile = result.scalars().first()
    if not profile:
        profile = CompanyProfile(id="default")
        db.add(profile)
        
    if "name" in payload: profile.name = payload["name"]
    if "pitch" in payload: profile.pitch = payload["pitch"]
    if "industry" in payload: profile.industry = payload["industry"]
    if "website" in payload: profile.website = payload["website"]
    if "social" in payload: profile.social = payload["social"]
    if "callerName" in payload or "caller_name" in payload:
        profile.caller_name = payload.get("callerName") or payload.get("caller_name", profile.caller_name)
    if "callerId" in payload or "caller_id" in payload:
        profile.caller_id = payload.get("callerId") or payload.get("caller_id", profile.caller_id)
    if "tone" in payload: profile.tone = payload["tone"]
    if "disclosure" in payload: profile.disclosure = payload["disclosure"]
    if "legalName" in payload or "legal_name" in payload:
        profile.legal_name = payload.get("legalName") or payload.get("legal_name", profile.legal_name)
    if "icoRef" in payload or "ico_ref" in payload:
        profile.ico_ref = payload.get("icoRef") or payload.get("ico_ref", profile.ico_ref)
    if "dpoContact" in payload or "dpo_contact" in payload:
        profile.dpo_contact = payload.get("dpoContact") or payload.get("dpo_contact", profile.dpo_contact)
    if "dncNotes" in payload or "dnc_notes" in payload:
        profile.dnc_notes = payload.get("dncNotes") or payload.get("dnc_notes", profile.dnc_notes)
    if "timezone" in payload: profile.timezone = payload["timezone"]
    if "lunchStart" in payload or "lunch_start" in payload:
        profile.lunch_start = payload.get("lunchStart") or payload.get("lunch_start", profile.lunch_start)
    if "lunchEnd" in payload or "lunch_end" in payload:
        profile.lunch_end = payload.get("lunchEnd") or payload.get("lunch_end", profile.lunch_end)
    if "callHoursPolicy" in payload or "call_hours_policy" in payload:
        profile.call_hours_policy = payload.get("callHoursPolicy") or payload.get("call_hours_policy", profile.call_hours_policy)
    if "weekdayStart" in payload or "weekday_start" in payload:
        profile.weekday_start = payload.get("weekdayStart") or payload.get("weekday_start", profile.weekday_start)
    if "weekdayEnd" in payload or "weekday_end" in payload:
        profile.weekday_end = payload.get("weekdayEnd") or payload.get("weekday_end", profile.weekday_end)
    
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
