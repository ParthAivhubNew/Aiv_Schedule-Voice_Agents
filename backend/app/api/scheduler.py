from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import SocialSchedule, SocialTopic, SocialPost, SocialEmail, CompanyProfile
from app.schemas.schemas import SocialPostSchema, SocialScheduleSchema, SocialTopicSchema
from app.services.post_writer import (
    parse_chat_intent,
    create_topic_image_prompt,
    generate_image_url,
    generate_image_with_provider,
    generate_complete_social_package,
    IMAGE_STYLES,
    ASPECT_RATIOS,
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
        "time": p.time or "10:00",
        "theme": p.theme or "General",
        "tone": p.tone or "Professional",
        "imageUrl": p.image_url,
        "imagePrompt": p.image_prompt,
        "createdAt": p.created_at.isoformat() if p.created_at else None
    } for p in posts]

@router.post("/generate-image")
async def generate_image_endpoint(payload: Dict[str, Any]):
    prompt = payload.get("prompt", "")
    title = payload.get("title", "")
    theme = payload.get("theme", "Operations")
    style = payload.get("style", "modern_saas")
    aspect_ratio = payload.get("aspect_ratio", "16:9")
    
    # Image provider credentials & model overrides
    provider = payload.get("provider") or payload.get("image_provider") or payload.get("imageEngine") or "pollinations"
    api_key = payload.get("api_key") or payload.get("apiKey") or payload.get("image_api_key") or payload.get("imageApiKey")
    model = payload.get("model") or payload.get("image_model") or payload.get("imageModel")
    base_url = payload.get("base_url") or payload.get("baseUrl") or payload.get("image_base_url") or payload.get("imageBaseUrl")
    
    w, h = ASPECT_RATIOS.get(aspect_ratio, (1200, 675))
    width = int(payload.get("width", w))
    height = int(payload.get("height", h))
    
    if not prompt and title:
        prompt = create_topic_image_prompt(title, theme=theme, style=style)
    elif not prompt:
        prompt = "Business intelligence operations dashboard with real-time analytics"
        
    res = await generate_image_with_provider(
        prompt=prompt,
        provider=provider,
        api_key=api_key,
        model=model,
        base_url=base_url,
        style=style,
        aspect_ratio=aspect_ratio,
        width=width,
        height=height
    )
    return res

@router.post("/generate-package")
async def generate_package_endpoint(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """
    Generates a full social media package with hook, multi-channel copy,
    hashtags, CTA, first comment link, and AI image.
    """
    topic = payload.get("topic", "") or payload.get("prompt", "")
    style = payload.get("style", "modern_saas")
    aspect_ratio = payload.get("aspect_ratio", "16:9")
    api_key = payload.get("apiKey") or payload.get("api_key")
    provider = payload.get("provider")
    model = payload.get("model")
    base_url = payload.get("baseUrl") or payload.get("base_url")

    # Image generation credentials
    image_api_key = payload.get("imageApiKey") or payload.get("image_api_key") or payload.get("apiKey")
    image_provider = payload.get("imageProvider") or payload.get("image_provider") or payload.get("imageEngine")
    image_model = payload.get("imageModel") or payload.get("image_model")
    image_base_url = payload.get("imageBaseUrl") or payload.get("image_base_url")

    # Get company profile for context
    prof_res = await db.execute(select(CompanyProfile).limit(1))
    profile = prof_res.scalars().first()
    company_name = profile.name if profile else "AIVHub"
    company_pitch = profile.pitch if profile else "AI-powered business intelligence dashboards"

    package = await generate_complete_social_package(
        topic=topic,
        company_name=company_name,
        company_pitch=company_pitch,
        api_key=api_key,
        provider=provider,
        model=model,
        base_url=base_url,
        image_api_key=image_api_key,
        image_provider=image_provider,
        image_model=image_model,
        image_base_url=image_base_url,
        style=style,
        aspect_ratio=aspect_ratio,
        db=db
    )

    return {
        "status": "ok",
        "package": package
    }

@router.post("/posts/create")
async def create_post_endpoint(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """
    Creates a new post in the database (defaulting to awaiting_approval status).
    """
    post_id = payload.get("id") or f"post_{uuid.uuid4().hex[:8]}"
    title = payload.get("title") or payload.get("hook") or "Untitled Social Post"
    copy = payload.get("copy") or payload.get("linkedin_copy") or ""
    channels = payload.get("channels") or ["linkedin", "x"]
    status = payload.get("status", "awaiting_approval")
    slot_date_ms = payload.get("slotDateMs") or (time.time() * 1000 + 86400000) # tomorrow
    time_str = payload.get("time", "10:00")
    theme = payload.get("theme", "Operations")
    image_url = payload.get("imageUrl")
    image_prompt = payload.get("imagePrompt")

    new_post = SocialPost(
        id=post_id,
        title=title,
        copy=copy,
        channels=channels,
        status=status,
        slot_date_ms=float(slot_date_ms),
        time=time_str,
        theme=theme,
        image_url=image_url,
        image_prompt=image_prompt
    )
    db.add(new_post)
    await db.commit()
    await db.refresh(new_post)

    return {
        "status": "ok",
        "id": new_post.id,
        "message": f"Post created successfully with status: {new_post.status}",
        "post": {
            "id": new_post.id,
            "title": new_post.title,
            "copy": new_post.copy,
            "channels": new_post.channels,
            "status": new_post.status,
            "imageUrl": new_post.image_url,
            "slotDateMs": new_post.slot_date_ms,
            "time": new_post.time
        }
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
    if "slotDateMs" in payload:
        post.slot_date_ms = float(payload["slotDateMs"])
    if "time" in payload:
        post.time = payload["time"]
    if "channels" in payload:
        post.channels = payload["channels"]

    await db.commit()
    return {"status": "ok", "postId": post_id, "newStatus": new_status}

@router.delete("/posts/{post_id}")
async def delete_post_endpoint(post_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(SocialPost).where(SocialPost.id == post_id))
    post = res.scalars().first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    await db.delete(post)
    await db.commit()
    return {"status": "ok", "message": f"Post {post_id} deleted."}

@router.post("/chat-plan")
async def chat_plan(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    prompt = payload.get("text") or payload.get("message") or ""
    messages = payload.get("messages") or []
    api_key = payload.get("apiKey") or payload.get("api_key")
    provider = payload.get("provider", "deepseek")
    model = payload.get("model")
    base_url = payload.get("baseUrl") or payload.get("base_url")
    image_style = payload.get("imageStyle", "modern_saas")

    prof_res = await db.execute(select(CompanyProfile).limit(1))
    profile = prof_res.scalars().first()
    company_name = profile.name if profile else "AIVHub"
    company_pitch = profile.pitch if profile else "AI-powered business intelligence dashboards"

    chat_msgs = []
    if messages:
        chat_msgs = messages
    elif prompt:
        chat_msgs = [{"role": "user", "content": prompt}]

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
            img_url = generate_image_url(img_prompt, style=image_style, aspect_ratio="16:9")
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
            # Insert into database in awaiting_approval status so they show in Inbox!
            p_id = f"draft_ai_{int(time.time())}_{i}"
            db_post = SocialPost(
                id=p_id,
                title=chosen_topic["title"],
                copy=f"🚀 {chosen_topic['title']}\n\n{chosen_topic['angle']}\n\n#Operations #BI #DataDriven",
                channels=[channel],
                status="awaiting_approval",
                slot_date_ms=float(time.time() * 1000 + (i + 1) * 86400000),
                time="10:00",
                theme=theme,
                image_url=img_url,
                image_prompt=img_prompt
            )
            db.add(db_post)
            generated_posts.append({
                "id": p_id,
                "title": chosen_topic["title"],
                "channel": channel,
                "status": "awaiting_approval",
                "imageUrl": img_url
            })
        await db.commit()

    return {
        "status": "ok" if llm_res.get("success", True) else "error",
        "reply": reply_text,
        "topics": topics_data,
        "posts": generated_posts,
        "postsCreated": generated_posts,
        "model": llm_res.get("model", model),
        "provider": llm_res.get("provider", provider),
        "error": llm_res.get("error")
    }
