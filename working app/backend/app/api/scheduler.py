from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import SocialSchedule, SocialTopic, SocialPost, SocialEmail, CompanyProfile
from app.schemas.schemas import SocialPostSchema, SocialScheduleSchema, SocialTopicSchema
from app.services.post_writer import parse_chat_intent, generate_social_post, TOPIC_BANK
from typing import Dict, Any, List
import uuid

router = APIRouter(prefix="/scheduler", tags=["Post Scheduler"])

@router.get("/posts", response_model=list[dict])
async def list_posts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SocialPost).order_by(SocialPost.created_at.desc()))
    posts = result.scalars().all()
    
    return [{
        "id": p.id,
        "topicId": p.topic_id,
        "scheduleId": p.schedule_id,
        "title": p.title,
        "copy": p.copy,
        "channels": p.channels or ["linkedin", "x"],
        "status": p.status,
        "slotDateMs": p.slot_date_ms,
        "time": p.time,
        "theme": p.theme,
        "tone": p.tone,
    } for p in posts]

@router.post("/chat-plan")
async def chat_plan(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    prompt = payload.get("text", "")
    parsed = parse_chat_intent(prompt)
    
    # Generate 3-5 relevant topics based on company identity
    topics = []
    for cat, t_list in TOPIC_BANK.items():
        for t in t_list:
            topics.append({
                "id": f"t_{uuid.uuid4().hex[:6]}",
                "title": t["title"],
                "angle": t["angle"],
                "hook": t["hook"],
                "category": cat
            })
            
    # Generate sample posts
    generated_posts = []
    for t in topics[:3]:
        post_id = f"post_{uuid.uuid4().hex[:6]}"
        copy = generate_social_post(t["title"], "linkedin", "AIVHub")
        p = SocialPost(
            id=post_id,
            topic_id=t["id"],
            title=t["title"],
            copy=copy,
            channels=["linkedin", "x"],
            status="awaiting_approval",
            time="10:00",
            theme=t["category"],
            tone="Professional"
        )
        db.add(p)
        generated_posts.append({
            "id": post_id,
            "title": t["title"],
            "copy": copy,
            "channels": ["linkedin", "x"],
            "status": "awaiting_approval"
        })
        
    await db.commit()
    
    return {
        "reply": f"Understood! I've set up a {parsed['horizon']} plan across {', '.join(parsed['days'])} for {', '.join(parsed['channels'])}. Generated {len(generated_posts)} post drafts ready for your review.",
        "plan": parsed,
        "postsCreated": generated_posts
    }

@router.post("/posts/{post_id}/status")
async def update_post_status(post_id: str, payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(SocialPost).where(SocialPost.id == post_id))
    post = res.scalars().first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
        
    new_status = payload.get("status", post.status)
    post.status = new_status
    if "copy" in payload:
        post.copy = payload["copy"]
        
    await db.commit()
    return {"status": "ok", "postId": post_id, "newStatus": new_status}

@router.get("/emails", response_model=list[dict])
async def list_emails(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(SocialEmail).order_by(SocialEmail.created_at.desc()))
    emails = res.scalars().all()
    
    return [{
        "id": e.id,
        "postId": e.post_id,
        "subject": e.subject,
        "from": e.from_addr,
        "to": e.to_addr,
        "date": e.date,
        "status": e.status,
        "post": e.post_data
    } for e in emails]
