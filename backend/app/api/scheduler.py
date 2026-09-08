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
    prompt = payload.get("text", "")
    parsed = parse_chat_intent(prompt)
    api_key = payload.get("apiKey")
    provider = payload.get("provider", "deepseek")
    model = payload.get("model")
    base_url = payload.get("baseUrl")
    image_style = payload.get("imageStyle", "modern_saas")

    # Get company profile for context
    prof_res = await db.execute(select(CompanyProfile).limit(1))
    profile = prof_res.scalars().first()
    company_name = profile.name if profile else "AIVHub"
    company_pitch = profile.pitch if profile else "AI-powered business intelligence dashboards"

    topics_data = []
    generated_posts = []
    assistant_reply = None

    # If an API key is supplied, attempt live LLM planning
    if api_key:
        system_prompt = f"""You are an elite B2B Social Media Content Strategist & Scheduler for {company_name}.
Company Value Proposition: {company_pitch}.
Your job is to parse the user's scheduling request, create 3 engaging topic angles with visual image prompts, and write 3 channel-ready post drafts.

Return ONLY a valid JSON object with this exact structure:
{{
  "reply": "Friendly concise assistant confirmation of the schedule",
  "topics": [
    {{
      "title": "Topic headline",
      "angle": "Strategic perspective",
      "hook": "Opening hook question or statement",
      "theme": "Theme name (e.g. Operations, Tech, Growth)",
      "imagePrompt": "Visual concept description for AI image generation (no text in image, focus on objects/scenes/concepts)"
    }}
  ],
  "posts": [
    {{
      "title": "Matching topic title",
      "theme": "Matching theme",
      "channels": ["linkedin", "x"],
      "copy": "Full high-converting LinkedIn post with bullet takeaways, hashtags, and call to action",
      "imagePrompt": "Visual concept description for social media graphic"
    }}
  ]
}}"""
        llm_response = await call_llm_chat(
            user_prompt=prompt,
            system_prompt=system_prompt,
            provider=provider,
            api_key=api_key,
            model=model,
            base_url=base_url
        )
        if llm_response:
            try:
                # Clean markdown json blocks if returned
                clean_json = llm_response.strip()
                if clean_json.startswith("```"):
                    clean_json = clean_json.split("\n", 1)[-1]
                    if clean_json.endswith("```"):
                        clean_json = clean_json.rsplit("```", 1)[0]
                parsed_llm = json.loads(clean_json.strip())
                assistant_reply = parsed_llm.get("reply")
                
                for t in parsed_llm.get("topics", [])[:4]:
                    t_id = f"t_{uuid.uuid4().hex[:6]}"
                    img_prompt = t.get("imagePrompt") or create_topic_image_prompt(t.get("title", ""), theme=t.get("theme", "Operations"), style=image_style)
                    img_url = generate_image_url(img_prompt, style=image_style)
                    topics_data.append({
                        "id": t_id,
                        "title": t.get("title", ""),
                        "angle": t.get("angle", ""),
                        "hook": t.get("hook", ""),
                        "category": t.get("theme", "Operations"),
                        "imageUrl": img_url,
                        "imagePrompt": img_prompt
                    })
                    
                for p_item in parsed_llm.get("posts", [])[:3]:
                    post_id = f"post_{uuid.uuid4().hex[:6]}"
                    p_img_prompt = p_item.get("imagePrompt") or create_topic_image_prompt(p_item.get("title", ""), theme=p_item.get("theme", "Operations"), style=image_style)
                    p_img_url = generate_image_url(p_img_prompt, style=image_style)
                    p_model = SocialPost(
                        id=post_id,
                        title=p_item.get("title", "Post Update"),
                        copy=p_item.get("copy", ""),
                        channels=p_item.get("channels", ["linkedin", "x"]),
                        status="awaiting_approval",
                        time="10:00",
                        theme=p_item.get("theme", "General"),
                        tone="Professional",
                        image_url=p_img_url,
                        image_prompt=p_img_prompt
                    )
                    db.add(p_model)
                    generated_posts.append({
                        "id": post_id,
                        "title": p_model.title,
                        "copy": p_model.copy,
                        "channels": p_model.channels,
                        "status": p_model.status,
                        "imageUrl": p_img_url,
                        "imagePrompt": p_img_prompt,
                        "theme": p_model.theme
                    })
            except Exception as parse_err:
                logger.warning(f"Could not parse LLM json response: {parse_err}. Falling back to default generation.")

    # Fallback if no LLM or parsing failed
    if not generated_posts:
        for cat, t_list in TOPIC_BANK.items():
            for t in t_list:
                img_prompt = create_topic_image_prompt(t["title"], angle=t["angle"], theme=cat, style=image_style)
                img_url = generate_image_url(img_prompt, style=image_style)
                topics_data.append({
                    "id": f"t_{uuid.uuid4().hex[:6]}",
                    "title": t["title"],
                    "angle": t["angle"],
                    "hook": t["hook"],
                    "category": cat,
                    "imageUrl": img_url,
                    "imagePrompt": img_prompt
                })
                
        for t in topics_data[:3]:
            post_id = f"post_{uuid.uuid4().hex[:6]}"
            copy = generate_social_post(t["title"], "linkedin", company_name)
            p = SocialPost(
                id=post_id,
                topic_id=t["id"],
                title=t["title"],
                copy=copy,
                channels=["linkedin", "x"],
                status="awaiting_approval",
                time="10:00",
                theme=t["category"],
                tone="Professional",
                image_url=t["imageUrl"],
                image_prompt=t["imagePrompt"]
            )
            db.add(p)
            generated_posts.append({
                "id": post_id,
                "title": t["title"],
                "copy": copy,
                "channels": ["linkedin", "x"],
                "status": "awaiting_approval",
                "imageUrl": t["imageUrl"],
                "imagePrompt": t["imagePrompt"],
                "theme": t["category"]
            })

    await db.commit()

    if not assistant_reply:
        assistant_reply = f"Understood! I've set up a {parsed['horizon']} plan across {', '.join(parsed['days'])} for {', '.join(parsed['channels'])}. Generated {len(generated_posts)} post drafts with contextual AI images ready for your review."

    return {
        "reply": assistant_reply,
        "plan": parsed,
        "postsCreated": generated_posts,
        "topics": topics_data[:6]
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
