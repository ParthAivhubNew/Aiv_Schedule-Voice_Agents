from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import SocialSchedule, SocialTopic, SocialPost, SocialEmail, CompanyProfile
from app.schemas.schemas import SocialPostSchema, SocialScheduleSchema, SocialTopicSchema
from app.services.post_writer import (
    parse_chat_intent,
    generate_social_post,
    call_llm_chat,
    create_topic_image_prompt,
    generate_image_url,
    TOPIC_BANK
)
from typing import Dict, Any, List, Optional
import uuid
import json
import logging
import time
import random

logger = logging.getLogger("scheduler_api")

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
        "imageUrl": p.image_url,
        "imagePrompt": p.image_prompt,
    } for p in posts]

@router.post("/generate-image")
async def generate_image_endpoint(payload: Dict[str, Any]):
    prompt = payload.get("prompt", "")
    title = payload.get("title", "")
    theme = payload.get("theme", "Operations")
    style = payload.get("style", "modern_saas")
    width = int(payload.get("width", 1200))
    height = int(payload.get("height", 675))
    
    if not prompt and title:
        prompt = create_topic_image_prompt(title, theme=theme, style=style)
    elif not prompt:
        prompt = "Business intelligence operations dashboard with real-time analytics"
        
    img_url = generate_image_url(prompt, style=style, width=width, height=height)
    return {
        "status": "ok",
        "imageUrl": img_url,
        "imagePrompt": prompt,
        "style": style,
        "width": width,
        "height": height
    }

@router.post("/chat-plan")
async def chat_plan(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    prompt = payload.get("text") or payload.get("message") or ""
    messages = payload.get("messages") or []
    api_key = payload.get("apiKey") or payload.get("api_key")
    provider = payload.get("provider", "deepseek")
    model = payload.get("model")
    base_url = payload.get("baseUrl") or payload.get("base_url")
    image_style = payload.get("imageStyle", "modern_saas")

    # Get company profile for context
    prof_res = await db.execute(select(CompanyProfile).limit(1))
    profile = prof_res.scalars().first()
    company_name = profile.name if profile else "AIVHub"
    company_pitch = profile.pitch if profile else "AI-powered business intelligence dashboards"

    # Build messages
    chat_msgs = []
    if messages:
        chat_msgs = messages
    elif prompt:
        chat_msgs = [{"role": "user", "content": prompt}]

    # Import llm_gateway
    from app.services.llm_gateway import call_open_chat_llm

    system_prompt = f"""You are an elite Social Media Content Strategist, Copywriter, and Open AI Assistant for {company_name}.
Value Proposition: {company_pitch}.
You help craft compelling social copy, refine hooks, ideate campaigns, and answer ANY general or strategic questions.
If the user asks to schedule posts or plan topics, provide engaging post ideas with hooks and hashtags.
If the user asks general questions or discusses strategy, respond conversationally with high intelligence and clarity."""

    llm_res = await call_open_chat_llm(
        messages=chat_msgs,
        system_prompt=system_prompt,
        api_key=api_key,
        provider=provider,
        model=model,
        base_url=base_url,
        db=db
    )

    reply_text = llm_res.get("reply", "")
    if not reply_text:
        reply_text = f"I'm ready to help plan your content strategy for {company_name}. What topics or channels would you like to explore?"

    # Check if scheduling intent
    parsed = parse_chat_intent(prompt)
    topics_data = []
    generated_posts = []

    if parsed["intent"] == "plan_schedule" or "schedule" in prompt.lower() or "post" in prompt.lower():
        theme_keys = list(TOPIC_BANK.keys())
        days = parsed["days"]
        channels = parsed["channels"]
        for i in range(min(3, len(days))):
            theme = theme_keys[i % len(theme_keys)]
            chosen_topic = random.choice(TOPIC_BANK[theme])
            channel = channels[i % len(channels)]
            img_prompt = create_topic_image_prompt(chosen_topic["title"], chosen_topic["angle"], theme, image_style)
            img_url = generate_image_url(img_prompt, style=image_style)
            post_copy = generate_social_post(chosen_topic["title"], channel, company_name)
            topics_data.append({
                "theme": theme,
                "title": chosen_topic["title"],
                "angle": chosen_topic["angle"],
                "hook": chosen_topic["hook"],
                "imagePrompt": img_prompt,
                "imageUrl": img_url,
                "day": days[i] if i < len(days) else f"Day {i+1}",
                "channel": channel
            })
            generated_posts.append({
                "id": f"draft_ai_{int(time.time())}_{i}",
                "title": chosen_topic["title"],
                "scheduledDate": f"2026-03-{10 + i * 2:02d} 10:00",
                "channel": channel,
                "status": "draft",
                "copy": post_copy,
                "theme": theme,
                "imagePrompt": img_prompt,
                "imageUrl": img_url
            })

    return {
        "status": "ok",
        "reply": reply_text,
        "topics": topics_data,
        "posts": generated_posts,
        "model": llm_res.get("model", model),
        "provider": llm_res.get("provider", provider)
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
    if "imageUrl" in payload:
        post.image_url = payload["imageUrl"]
    if "imagePrompt" in payload:
        post.image_prompt = payload["imagePrompt"]
        
    await db.commit()
    return {
        "status": "ok",
        "postId": post_id,
        "newStatus": new_status,
        "imageUrl": post.image_url
    }

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
