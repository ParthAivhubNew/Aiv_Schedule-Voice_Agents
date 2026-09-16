import os
import re
import urllib.parse
import random
import json
import logging
from typing import Dict, Any, List, Optional
import httpx

logger = logging.getLogger("post_writer")

TOPIC_BANK = {
    "Operations": [
        {"title": "Why ops teams lose 2 days/week to manual spreadsheets", "angle": "Highlight the cost of fragmented data across departments.", "hook": "Are spreadsheets running your dispatch line, or slowing it down?"},
        {"title": "Real-time dispatch vs. end-of-shift reporting", "angle": "Show the competitive advantage of sub-minute visibility.", "hook": "By the time the spreadsheet is updated, the shift is already over."}
    ],
    "Technology": [
        {"title": "Connecting legacy ERPs with modern BI dashboards", "angle": "Explain non-invasive data pipelines without complete system overhauls.", "hook": "You don't need a 2-year ERP migration to get clean metrics today."},
        {"title": "Predictive maintenance benchmarks for manufacturing", "angle": "Quantify downtime prevention with sensor-driven telemetry.", "hook": "What does one hour of unplanned line downtime cost your plant?"}
    ],
    "Growth": [
        {"title": "Scaling mid-market manufacturing without adding headcount", "angle": "Leverage automated reporting to maximize existing supervisor output.", "hook": "Growth doesn't require doubling your back-office reporting staff."},
        {"title": "Case study: 35% throughput increase in Manchester logistics", "angle": "Real-world ROI breakdown of live operational intelligence.", "hook": "How one regional carrier eliminated delivery bottlenecks in 30 days."}
    ]
}

IMAGE_STYLES = {
    "modern_saas": "modern sleek SaaS vector illustration, clean UI gradients, professional tech graphics, high quality, 4k",
    "editorial": "photorealistic editorial corporate photography, natural soft studio lighting, sharp focus, magazine style, 8k",
    "minimalist_3d": "3d isometric clay style render, smooth pastel lighting, minimalist geometric tech shapes, clean aesthetic",
    "neon_tech": "dark theme holographic interface, glowing data visualisations, neon accents, futuristic operational intelligence",
    "b2b_ad": "high contrast corporate B2B marketing visual, modern typography, bold branding, clean negative space, premium graphic design",
    "cinematic": "cinematic widescreen shot, dramatic volumetric lighting, depth of field, atmospheric, 8k masterpiece"
}

ASPECT_RATIOS = {
    "1:1": (1080, 1080),
    "16:9": (1200, 675),
    "9:16": (720, 1280),
    "4:5": (1080, 1350)
}

def create_topic_image_prompt(title: str, angle: str = "", theme: str = "Operations", style: str = "modern_saas") -> str:
    """Creates an evocative image prompt based on the topic title, theme and style."""
    base_concept = title.replace("Why ", "").replace("How ", "").replace("?", "").strip()
    style_suffix = IMAGE_STYLES.get(style, IMAGE_STYLES["modern_saas"])
    return f"{base_concept}, {theme.lower()} focus, {style_suffix}"

def generate_image_url(prompt: str, style: str = "modern_saas", width: int = 1200, height: int = 675, aspect_ratio: str = "16:9", **_kwargs) -> str:
    """Generates an instant high-resolution AI image URL using Pollinations FLUX/AI image service."""
    clean_prompt = prompt.strip()
    if not clean_prompt:
        clean_prompt = "Business intelligence dashboard analytics operations team"
    style_suffix = IMAGE_STYLES.get(style, "")
    full_prompt = f"{clean_prompt}, {style_suffix}".strip(", ")
    encoded = urllib.parse.quote(full_prompt, safe="")
    seed = random.randint(1000, 999999)
    
    if aspect_ratio in ASPECT_RATIOS:
        width, height = ASPECT_RATIOS[aspect_ratio]
        
    return f"https://image.pollinations.ai/prompt/{encoded}?width={width}&height={height}&nologo=true&seed={seed}"


async def resolve_image_credentials(
    db: Any = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Use saved ChatGPT/OpenAI key for images whenever present. Pollinations only if no paid key."""
    from app.config import settings
    from app.services.llm_gateway import resolve_llm_credentials

    prov = (provider or "").strip().lower()
    key = (api_key or "").strip()
    mod = (model or "").strip()
    burl = (base_url or "").strip()
    if "chatgpt" in prov or "gpt" in prov or "dall" in prov:
        prov = "openai"
    explicit_paid = any(x in prov for x in ("stability", "fal", "custom"))
    env_openai = (getattr(settings, "OPENAI_API_KEY", None) or os.environ.get("OPENAI_API_KEY") or "").strip()

    llm = {}
    try:
        llm = await resolve_llm_credentials(
            db=db,
            api_key=key or None,
            provider="openai" if (not prov or prov == "pollinations") else prov,
            model=mod or None,
            base_url=burl or None,
        ) or {}
    except Exception as e:
        logger.warning(f"resolve_image_credentials llm lookup: {e}")

    llm_key = (llm.get("api_key") or "").strip()
    llm_prov = (llm.get("provider") or "").strip().lower()
    if "chatgpt" in llm_prov or "gpt" in llm_prov or "dall" in llm_prov:
        llm_prov = "openai"

    openai_key = ""
    if prov in ("", "pollinations", "openai") and key:
        openai_key = key
    if not openai_key and llm_prov in ("", "openai") and llm_key:
        openai_key = llm_key
    if not openai_key:
        openai_key = env_openai

    if not explicit_paid and openai_key:
        return {
            "provider": "openai",
            "api_key": openai_key,
            "model": mod if mod and ("dall-e" in mod or "gpt-image" in mod) else "dall-e-3",
            "base_url": burl or llm.get("base_url") or "https://api.openai.com/v1",
        }
    if explicit_paid and (key or llm_key):
        return {
            "provider": prov,
            "api_key": key or llm_key,
            "model": mod or llm.get("model"),
            "base_url": burl or llm.get("base_url"),
        }
    return {
        "provider": prov or "pollinations",
        "api_key": key or llm_key,
        "model": mod,
        "base_url": burl,
    }


async def generate_image_with_provider(
    prompt: str,
    provider: Optional[str] = "pollinations",
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    style: str = "modern_saas",
    aspect_ratio: str = "16:9",
    width: Optional[int] = None,
    height: Optional[int] = None,
    db: Any = None,
) -> Dict[str, Any]:
    """
    Renders an AI image using the saved ChatGPT/OpenAI key when present.
    Pollinations is only used when no paid image key exists.
    """
    creds = await resolve_image_credentials(
        db=db, provider=provider, api_key=api_key, model=model, base_url=base_url
    )
    prov = (creds.get("provider") or provider or "pollinations").lower().strip()
    api_key = creds.get("api_key") or api_key
    model = creds.get("model") or model
    base_url = creds.get("base_url") or base_url
    paid = prov in ("openai", "stability", "fal", "custom") and bool((api_key or "").strip() or (base_url or "").strip())

    clean_prompt = (prompt or "").strip() or "Business intelligence operations dashboard analytics"
    style_suffix = IMAGE_STYLES.get(style, IMAGE_STYLES.get("modern_saas", ""))
    full_prompt = f"{clean_prompt}, {style_suffix}, no watermarks, no unreadable UI text".strip(", ")

    def_w, def_h = ASPECT_RATIOS.get(aspect_ratio, (1200, 675))
    w = int(width or def_w)
    h = int(height or def_h)
    fallback_warning = None

    # 1. OpenAI (DALL-E 3 / gpt-image-1)
    if ("openai" in prov or "dall" in prov) and api_key and api_key.strip():
        last_err = ""
        dalle_size = "1792x1024" if aspect_ratio == "16:9" else ("1024x1792" if aspect_ratio == "9:16" else "1024x1024")
        target_url = (base_url or "https://api.openai.com/v1").rstrip("/") + "/images/generations"
        headers = {
            "Authorization": f"Bearer {api_key.strip()}",
            "Content-Type": "application/json",
        }
        models_to_try = []
        for m in (model, "dall-e-3", "gpt-image-1"):
            if m and m not in models_to_try:
                models_to_try.append(m)
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                for target_model in models_to_try:
                    body = {
                        "model": target_model,
                        "prompt": full_prompt[:1000],
                        "n": 1,
                        "size": dalle_size,
                    }
                    if target_model.startswith("dall-e"):
                        body["response_format"] = "b64_json"
                    res = await client.post(target_url, headers=headers, json=body)
                    if res.status_code == 200:
                        row = (res.json().get("data") or [{}])[0]
                        img_url = row.get("url")
                        b64 = row.get("b64_json")
                        if b64:
                            img_url = f"data:image/png;base64,{b64}"
                        if img_url:
                            logger.info(f"OpenAI image generated via {target_model}")
                            return {
                                "status": "ok",
                                "imageUrl": img_url,
                                "imagePrompt": clean_prompt,
                                "provider": "openai",
                                "model": target_model,
                                "style": style,
                                "aspect_ratio": aspect_ratio,
                                "width": w,
                                "height": h,
                            }
                    last_err = f"{res.status_code}: {res.text[:240]}"
                    logger.warning(f"OpenAI image {target_model} failed {last_err}")
            fallback_warning = f"OpenAI image failed ({last_err})"
        except Exception as e:
            logger.warning(f"OpenAI image generation exception: {e}")
            fallback_warning = f"OpenAI image error ({e})"
    elif ("openai" in prov or "dall" in prov) and (not api_key or not api_key.strip()):
        fallback_warning = "OpenAI/ChatGPT image key not found in Scheduler AI, Connections, or OPENAI_API_KEY."

    # 2. Stability AI (SDXL)
    elif ("stability" in prov or "sdxl" in prov) and api_key and api_key.strip():
        try:
            sd_w, sd_h = (1216, 832) if aspect_ratio == "16:9" else ((832, 1216) if aspect_ratio == "9:16" else (1024, 1024))
            target_url = (base_url or "https://api.stability.ai").rstrip("/") + "/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image"
            headers = {
                "Authorization": f"Bearer {api_key.strip()}",
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
            body = {
                "text_prompts": [{"text": full_prompt[:1000], "weight": 1.0}],
                "cfg_scale": 7,
                "height": sd_h,
                "width": sd_w,
                "samples": 1,
                "steps": 30
            }
            async with httpx.AsyncClient(timeout=40.0) as client:
                res = await client.post(target_url, headers=headers, json=body)
                if res.status_code == 200:
                    artifacts = res.json().get("artifacts", [])
                    if artifacts and "base64" in artifacts[0]:
                        b64_img = artifacts[0]["base64"]
                        data_uri = f"data:image/png;base64,{b64_img}"
                        return {
                            "status": "ok",
                            "imageUrl": data_uri,
                            "imagePrompt": clean_prompt,
                            "provider": "stability",
                            "model": model or "sdxl-1.0",
                            "style": style,
                            "aspect_ratio": aspect_ratio,
                            "width": sd_w,
                            "height": sd_h
                        }
                logger.warning(f"Stability AI generation returned {res.status_code}: {res.text[:200]}")
                fallback_warning = f"Stability AI returned {res.status_code}. Switched to Pollinations FLUX."
        except Exception as e:
            logger.warning(f"Stability AI image generation exception: {e}")
            fallback_warning = f"Stability AI connection error ({e}). Switched to Pollinations FLUX."
    elif ("stability" in prov or "sdxl" in prov) and (not api_key or not api_key.strip()):
        fallback_warning = "Stability AI key not provided. Generated with Pollinations FLUX."

    # 3. Fal.ai (FLUX.1 Pro / Schnell)
    elif "fal" in prov and api_key and api_key.strip():
        try:
            target_url = (base_url or "https://fal.run/fal-ai/flux/schnell").rstrip("/")
            headers = {
                "Authorization": f"Key {api_key.strip()}",
                "Content-Type": "application/json"
            }
            fal_size = "landscape_16_9" if aspect_ratio == "16:9" else ("portrait_16_9" if aspect_ratio == "9:16" else "square_hd")
            body = {
                "prompt": full_prompt[:1000],
                "image_size": fal_size
            }
            async with httpx.AsyncClient(timeout=40.0) as client:
                res = await client.post(target_url, headers=headers, json=body)
                if res.status_code == 200:
                    imgs = res.json().get("images", [])
                    if imgs and "url" in imgs[0]:
                        return {
                            "status": "ok",
                            "imageUrl": imgs[0]["url"],
                            "imagePrompt": clean_prompt,
                            "provider": "fal",
                            "model": model or "flux-schnell",
                            "style": style,
                            "aspect_ratio": aspect_ratio,
                            "width": w,
                            "height": h
                        }
                fallback_warning = f"Fal.ai returned {res.status_code}. Switched to Pollinations FLUX."
        except Exception as e:
            logger.warning(f"Fal.ai image generation exception: {e}")
            fallback_warning = f"Fal.ai connection error ({e}). Switched to Pollinations FLUX."
    elif "fal" in prov and (not api_key or not api_key.strip()):
        fallback_warning = "Fal.ai key not provided. Generated with Pollinations FLUX."

    # 4. Custom endpoint
    elif "custom" in prov and base_url and base_url.strip():
        try:
            headers = {"Content-Type": "application/json"}
            if api_key and api_key.strip():
                headers["Authorization"] = f"Bearer {api_key.strip()}"
            body = {"prompt": full_prompt, "width": w, "height": h, "aspect_ratio": aspect_ratio}
            async with httpx.AsyncClient(timeout=40.0) as client:
                res = await client.post(base_url.strip(), headers=headers, json=body)
                if res.status_code == 200:
                    d = res.json()
                    custom_url = d.get("imageUrl") or d.get("url") or (d.get("images", [{}])[0].get("url") if isinstance(d.get("images"), list) else None)
                    if custom_url:
                        return {
                            "status": "ok",
                            "imageUrl": custom_url,
                            "imagePrompt": clean_prompt,
                            "provider": "custom",
                            "model": model or "custom",
                            "style": style,
                            "aspect_ratio": aspect_ratio,
                            "width": w,
                            "height": h
                        }
        except Exception as e:
            logger.warning(f"Custom image endpoint exception: {e}")
            fallback_warning = f"Custom endpoint error ({e}). Switched to Pollinations FLUX."
    else:
        fallback_warning = None

    if paid:
        return {
            "status": "error",
            "imageUrl": None,
            "imagePrompt": clean_prompt,
            "provider": prov,
            "model": model,
            "warning": fallback_warning or f"{prov} image generation failed. Pollinations was not used because a paid image key is configured.",
            "fallback": False,
        }

    # Free fallback only when no ChatGPT/OpenAI (or other paid) image key exists
    fallback_url = generate_image_url(clean_prompt, style=style, width=w, height=h, aspect_ratio=aspect_ratio)
    resp = {
        "status": "ok",
        "imageUrl": fallback_url,
        "imagePrompt": clean_prompt,
        "provider": "pollinations",
        "model": "flux",
        "style": style,
        "aspect_ratio": aspect_ratio,
        "width": w,
        "height": h,
        "fallback": True,
        "warning": fallback_warning or "No OpenAI/ChatGPT image key saved — used free Pollinations.",
    }
    return resp


def parse_chat_intent(text: str) -> Dict[str, Any]:
    t = (text or "").lower()
    days = []
    for day in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]:
        if day in t or day[:3] in t:
            days.append(day.capitalize())
            
    horizon = "month"
    if "2 day" in t or "two day" in t:
        horizon = "2-day"
    elif "week" in t:
        horizon = "week"
    elif "month" in t:
        horizon = "month"
        
    channels = []
    for ch in ["linkedin", "facebook", "instagram", "x", "twitter"]:
        if ch in t:
            channels.append("x" if ch == "twitter" else ch)
    if not channels:
        channels = ["linkedin", "x"]
        
    return {
        "intent": "plan_schedule" if days or "schedule" in t or "plan" in t else "help",
        "horizon": horizon,
        "days": days or ["Monday", "Wednesday", "Friday"],
        "channels": channels,
        "raw": text,
    }

async def generate_complete_social_package(
    topic: str,
    company_name: str = "AIVHub",
    company_pitch: str = "AI-powered business intelligence dashboards",
    api_key: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    image_api_key: Optional[str] = None,
    image_provider: Optional[str] = None,
    image_model: Optional[str] = None,
    image_base_url: Optional[str] = None,
    style: str = "modern_saas",
    aspect_ratio: str = "16:9",
    db: Any = None
) -> Dict[str, Any]:
    """
    Generates a full social media package:
    - Scroll hook
    - LinkedIn structured copy
    - X (Twitter) punchy copy (<280 chars)
    - Smart hashtags
    - Call to action (CTA)
    - First comment text
    - Image prompt & URL
    - Alt text
    """
    from app.services.llm_gateway import call_open_chat_llm

    clean_topic = topic.strip() or "Why ops teams lose 2 days/week to manual spreadsheets"
    
    # 1. Attempt LLM generation if credentials available
    system_prompt = f"""You are a sharp B2B ghostwriter for {company_name} ({company_pitch}).
Write like an ops director who has lived on a plant floor — not a marketing brochure.

Return ONLY valid JSON with these keys:
{{
  "hook": "First visible line before LinkedIn See more. Specific, slightly uncomfortable, no cliché.",
  "linkedin_copy": "The FULL LinkedIn post (150-220 words). Do NOT repeat the topic title as line 1. Open with a scene or number. Then 3 concrete takeaways with real quantities. One human question at the end. Max 1 emoji. No 'Most leaders don't realize'. No corporate fluff.",
  "x_copy": "Tweet under 240 chars, one sharp claim.",
  "facebook_copy": "Conversational post with one story beat and a question.",
  "instagram_copy": "Short caption + 5 niche hashtags.",
  "threads_copy": "Casual take under 400 chars.",
  "hashtags": ["#Tag1", "#Tag2", "#Tag3", "#Tag4", "#Tag5"],
  "cta": "A question an ops/plant leader would actually answer in comments.",
  "first_comment": "Useful follow-up or demo line.",
  "image_prompt": "Photoreal editorial photo of a live operations control room / dispatch wall, no fake UI text, no logos, cinematic lighting",
  "alt_text": "Plain-language image description",
  "recommended_time": "Tue 09:30"
}}"""

    llm_payload = None
    try:
        res = await call_open_chat_llm(
            messages=[{"role": "user", "content": f"Topic: {clean_topic}"}],
            system_prompt=system_prompt,
            api_key=api_key,
            provider=provider,
            model=model,
            base_url=base_url,
            temperature=0.7,
            db=db
        )
        if res and res.get("success") and res.get("reply"):
            reply_str = res["reply"].strip()
            # Extract JSON if enclosed in code fences
            if "```" in reply_str:
                m = re.search(r"```(?:json)?\s*({[\s\S]*?})\s*```", reply_str)
                if m:
                    reply_str = m.group(1)
            llm_payload = json.loads(reply_str)
    except Exception as e:
        logger.warning(f"LLM package generation fallback triggered: {e}")

    # 2. Intelligent deterministic fallback if LLM is unavailable
    if not llm_payload:
        clean_headline = clean_topic.replace("Why ", "").replace("How ", "").strip()
        llm_payload = {
            "hook": "Your Thursday pack is already late — and the floor moved on two hours ago.",
            "linkedin_copy": f"""The spreadsheet that “closes the day” is usually a post-mortem.

A supervisor still walks the line with a clipboard. Someone else re-keys it. By the time leadership sees the number, the bottleneck already shipped.

{company_name} exists so the number on the wall is the same number in the meeting.

What actually changes when the board is live:
• 8+ hours/week stop going into copy-paste reporting
• Dispatch sees a slip before the truck leaves, not in Friday's pack
• Supervisors coach from one screen instead of three exports

If your team still rebuilds yesterday every morning, the process is the product — and it's slow.

What's the one report you'd kill first if the floor already had the truth?""",
            "x_copy": f"If the pack is late, the decision is already stale. Live ops beats end-of-shift spreadsheets. {clean_topic}",
            "facebook_copy": f"{clean_topic}\n\nThe floor already knows. The spreadsheet is just catching up.\n\nWhat report would you retire this month?",
            "instagram_copy": f"{clean_topic}\n\nLive board > late pack.\n\n#Operations #Manufacturing #SupplyChain #B2B #Automation",
            "threads_copy": f"{clean_topic} — if it takes a pack to see the shift, you didn't see the shift.",
            "hashtags": ["#Operations", "#Manufacturing", "#SupplyChain", "#Automation", "#B2B"],
            "cta": "What's the one report you'd kill first if the floor already had the truth?",
            "first_comment": f"How {company_name} replaces the pack: live ops dashboards, not another export.",
            "alt_text": f"Live operations control room with a large wall display of throughput and dispatch metrics for {clean_headline}.",
            "recommended_time": "Tuesday 09:30 AM",
            "image_prompt": "Photoreal cinematic photo of a mid-market operations control room, large wall screens with abstract charts (no readable fake UI text), supervisors in workwear, warehouse visible through glass, cool industrial lighting, no logos",
        }

    # Generate Image with Provider & Key
    img_creds = await resolve_image_credentials(
        db=db,
        provider=image_provider,
        api_key=image_api_key or api_key,
        model=image_model,
        base_url=image_base_url or base_url,
    )
    img_prompt = llm_payload.get("image_prompt") or create_topic_image_prompt(clean_topic, style=style)
    width, height = ASPECT_RATIOS.get(aspect_ratio, (1200, 675))
    img_res = await generate_image_with_provider(
        prompt=img_prompt,
        provider=img_creds.get("provider") or image_provider,
        api_key=img_creds.get("api_key") or image_api_key or api_key,
        model=img_creds.get("model") or image_model,
        base_url=img_creds.get("base_url") or image_base_url,
        style=style,
        aspect_ratio=aspect_ratio,
        width=width,
        height=height,
        db=db,
    )

    llm_payload["imageUrl"] = img_res.get("imageUrl")
    llm_payload["imagePrompt"] = img_prompt
    llm_payload["imageProvider"] = img_res.get("provider")
    llm_payload["imageModel"] = img_res.get("model")
    llm_payload["style"] = style
    llm_payload["aspect_ratio"] = aspect_ratio
    llm_payload["width"] = img_res.get("width", width)
    llm_payload["height"] = img_res.get("height", height)
    llm_payload["topic"] = clean_topic
    if img_res.get("warning"):
        llm_payload["imageWarning"] = img_res["warning"]

    return llm_payload
