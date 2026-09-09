from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from app.database import get_db, AsyncSessionLocal
from app.models.models import CompanyProfile, KnowledgeSource, KnowledgeChunk, Service, FAQ, Notification
from app.schemas.schemas import CompanyProfileSchema, KnowledgeSourceSchema, ServiceSchema, FAQSchema, NotificationSchema
from app.services.crawler_service import crawl_and_index_source_task
from app.services.rag_service import search_knowledge
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

# Knowledge Sources & RAG
@router.get("/sources", response_model=list[dict])
async def list_sources(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KnowledgeSource).order_by(KnowledgeSource.created_at.desc()))
    sources = result.scalars().all()
    return [{
        "id": s.id,
        "name": s.name,
        "type": s.type,
        "value": s.value,
        "status": s.status or "indexed",
        "synced": s.synced or "Just now",
        "chunkCount": s.chunk_count or 0,
        "lastError": s.last_error,
        "crawledAt": s.crawled_at.isoformat() if s.crawled_at else None
    } for s in sources]

@router.post("/sources", response_model=dict)
async def add_source(
    req: KnowledgeSourceSchema,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    source = KnowledgeSource(
        id=f"k_{uuid.uuid4().hex[:6]}",
        name=req.name,
        type=req.type,
        value=req.value,
        status="pending",
        synced="Just now",
        chunk_count=0
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)
    
    # Schedule background crawler & embedding worker
    background_tasks.add_task(crawl_and_index_source_task, source.id, AsyncSessionLocal)
    return {
        "id": source.id,
        "status": "pending",
        "message": "Knowledge source added. Background indexing and vector generation started."
    }

@router.post("/sources/{source_id}/resync", response_model=dict)
async def resync_source(
    source_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(KnowledgeSource).where(KnowledgeSource.id == source_id))
    source = result.scalars().first()
    if not source:
        raise HTTPException(status_code=404, detail="Knowledge source not found")
        
    source.status = "crawling"
    await db.commit()
    
    background_tasks.add_task(crawl_and_index_source_task, source.id, AsyncSessionLocal)
    return {"id": source.id, "status": "crawling", "message": "Re-crawling and re-indexing triggered."}

@router.delete("/sources/{source_id}", response_model=dict)
async def delete_source(source_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KnowledgeSource).where(KnowledgeSource.id == source_id))
    source = result.scalars().first()
    if not source:
        raise HTTPException(status_code=404, detail="Knowledge source not found")
        
    await db.delete(source)
    await db.commit()
    return {"status": "ok", "message": "Knowledge source and associated vector chunks removed"}

@router.get("/sources/{source_id}/chunks", response_model=list[dict])
async def get_source_chunks(source_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(KnowledgeChunk)
        .where(KnowledgeChunk.source_id == source_id)
        .order_by(KnowledgeChunk.chunk_index.asc())
    )
    chunks = result.scalars().all()
    return [{
        "id": c.id,
        "sourceId": c.source_id,
        "title": c.title,
        "content": c.content,
        "chunkIndex": c.chunk_index,
        "url": c.url,
        "hasEmbedding": c.embedding is not None,
        "createdAt": c.created_at.isoformat() if c.created_at else None
    } for c in chunks]

@router.post("/sources/test-query", response_model=dict)
async def test_knowledge_search(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    query = payload.get("query", "")
    top_k = payload.get("top_k", 3)
    if not query:
        raise HTTPException(status_code=400, detail="Query string is required")
        
    matches = await search_knowledge(db, query=query, top_k=top_k)
    return {
        "query": query,
        "matches": matches,
        "count": len(matches)
    }


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

@router.put("/services")
@router.post("/services")
async def save_services(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    services_list = payload.get("services", [])
    await db.execute(delete(Service))
    for s in services_list:
        name = (s.get("name") or "").strip()
        desc = (s.get("desc") or "").strip()
        ideal = (s.get("ideal") or "").strip()
        if name:
            sid = s.get("id") or f"sv_{uuid.uuid4().hex[:6]}"
            db.add(Service(id=sid, name=name, desc=desc, ideal=ideal))
    await db.commit()
    return {"status": "ok", "message": f"{len(services_list)} services saved successfully"}

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

@router.put("/faqs")
@router.post("/faqs")
async def save_faqs(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    faqs_list = payload.get("faqs", [])
    await db.execute(delete(FAQ))
    saved_count = 0
    for item in faqs_list:
        q = (item.get("q") or item.get("question") or "").strip()
        a = (item.get("a") or item.get("answer") or "").strip()
        if q and a:
            faq_id = item.get("id") or f"f_{uuid.uuid4().hex[:6]}"
            db.add(FAQ(id=faq_id, question=q, answer=a))
            saved_count += 1
    await db.commit()
    return {"status": "ok", "message": f"{saved_count} FAQs saved successfully"}

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
