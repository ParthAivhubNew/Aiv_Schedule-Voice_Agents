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

def generate_image_url(prompt: str, style: str = "modern_saas", width: int = 1200, height: int = 675, aspect_ratio: str = "16:9") -> str:
    """Generates an instant high-resolution AI image URL using Pollinations FLUX/AI image service."""
    clean_prompt = prompt.strip()
    if not clean_prompt:
        clean_prompt = "Business intelligence dashboard analytics operations team"
    style_suffix = IMAGE_STYLES.get(style, "")
    full_prompt = f"{clean_prompt}, {style_suffix}".strip(", ")
    encoded = urllib.parse.quote(full_prompt)
    seed = random.randint(1000, 999999)
    
    if aspect_ratio in ASPECT_RATIOS:
        width, height = ASPECT_RATIOS[aspect_ratio]
        
    return f"https://image.pollinations.ai/prompt/{encoded}?width={width}&height={height}&nologo=true&seed={seed}"

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
) -> Dict[str, Any]:
    """
    Renders an AI image using the user's selected provider (OpenAI DALL-E 3, Stability SDXL, Fal.ai FLUX, or Pollinations Free).
    Falls back safely to Pollinations FLUX if an external API key is missing or encounters a rate/quota error.
    """
    prov = (provider or "pollinations").lower().strip()
    clean_prompt = (prompt or "").strip() or "Business intelligence operations dashboard analytics"
    style_suffix = IMAGE_STYLES.get(style, IMAGE_STYLES.get("modern_saas", ""))
    full_prompt = f"{clean_prompt}, {style_suffix}".strip(", ")

    def_w, def_h = ASPECT_RATIOS.get(aspect_ratio, (1200, 675))
    w = int(width or def_w)
    h = int(height or def_h)

    # 1. OpenAI (DALL-E 3 / DALL-E 2)
    if ("openai" in prov or "dall" in prov) and api_key and api_key.strip():
        try:
            target_model = model or "dall-e-3"
            dalle_size = "1792x1024" if aspect_ratio == "16:9" else ("1024x1792" if aspect_ratio == "9:16" else "1024x1024")
            target_url = (base_url or "https://api.openai.com/v1").rstrip("/") + "/images/generations"
            headers = {
                "Authorization": f"Bearer {api_key.strip()}",
                "Content-Type": "application/json"
            }
            body = {
                "model": target_model,
                "prompt": full_prompt[:1000],
                "n": 1,
                "size": dalle_size
            }
            async with httpx.AsyncClient(timeout=40.0) as client:
                res = await client.post(target_url, headers=headers, json=body)
                if res.status_code == 200:
                    d = res.json()
                    img_url = d.get("data", [{}])[0].get("url")
                    if img_url:
                        logger.info(f"OpenAI DALL-E image generated successfully.")
                        return {
                            "status": "ok",
                            "imageUrl": img_url,
                            "imagePrompt": clean_prompt,
                            "provider": "openai",
                            "model": target_model,
                            "style": style,
                            "aspect_ratio": aspect_ratio,
                            "width": w,
                            "height": h
                        }
                logger.warning(f"OpenAI image generation returned {res.status_code}: {res.text[:200]}")
                fallback_warning = f"OpenAI DALL-E returned {res.status_code}. Switched to Pollinations FLUX."
        except Exception as e:
            logger.warning(f"OpenAI image generation exception: {e}")
            fallback_warning = f"OpenAI connection error ({e}). Switched to Pollinations FLUX."
    elif ("openai" in prov or "dall" in prov) and (not api_key or not api_key.strip()):
        fallback_warning = "OpenAI image key not provided. Generated with Pollinations FLUX."

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

    # Built-in Default / Resilient Fallback: Pollinations FLUX
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
        "height": h
    }
    if fallback_warning:
        resp["warning"] = fallback_warning
        resp["fallback"] = True
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
    system_prompt = f"""You are an elite B2B Social Media Marketing Strategist and Copywriter for {company_name}.
Value Proposition: {company_pitch}.
Your job is to generate a comprehensive, publication-ready social media content package based on the given topic.

Return ONLY a valid JSON object with these EXACT keys:
{{
  "hook": "A 1-2 sentence scroll-stopping opening hook designed to beat 'see more' cutoffs",
  "linkedin_copy": "Full-length LinkedIn post with structured paragraphs, emoji bullets, and compelling business insight",
  "x_copy": "A punchy, viral tweet strictly under 250 characters with a strong takeaway",
  "hashtags": ["#Tag1", "#Tag2", "#Tag3", "#Tag4", "#Tag5"],
  "cta": "Engaging question or prompt to drive comment interaction",
  "first_comment": "First comment snippet for resource or demo links (keeps outbound link out of main post)",
  "image_prompt": "Evocative, descriptive prompt for generating a visual graphic matching this topic",
  "alt_text": "Accessibility description for the image graphic",
  "recommended_time": "Optimal day and time to post (e.g. Tuesday 09:30 AM)"
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
            "hook": f"Most operations leaders don't realize this: {clean_topic.lower()}.",
            "linkedin_copy": f"""🚀 {clean_topic}

In mid-market operations, real-time visibility is the difference between proactive decisions and expensive firefighting.

At {company_name}, we help operational teams replace manual reporting with automated intelligence.

Key insights for ops leaders:
• Eliminate 8+ hours of weekly spreadsheet assembly
• Spot production and dispatch bottlenecks before delivery deadlines
• Empower supervisors with live, decision-ready metrics

How is your team currently tracking daily throughput? Let's discuss in the comments below.

#Operations #BusinessIntelligence #Automation #B2B #Logistics""",
            "x_copy": f"Manual reporting shouldn't be running your operations. Real-time dashboards give mid-market teams instant visibility without reporting delay. Read on: {clean_topic.lower()} #OpsEx",
            "hashtags": ["#Operations", "#BusinessIntelligence", "#Automation", "#B2BTech", "#Logistics"],
            "cta": "What's the biggest reporting bottleneck in your operations right now? Drop your thoughts below 👇",
            "first_comment": f"🔗 Learn how {company_name} helps teams eliminate manual reporting: https://aivhub.io/demo",
            "alt_text": f"A high-tech digital operational dashboard displaying telemetry and analytics for {clean_headline}.",
            "recommended_time": "Tuesday 09:30 AM (Peak B2B Traffic)"
        }

    # Generate Image with Provider & Key
    img_prompt = llm_payload.get("image_prompt") or create_topic_image_prompt(clean_topic, style=style)
    width, height = ASPECT_RATIOS.get(aspect_ratio, (1200, 675))
    img_res = await generate_image_with_provider(
        prompt=img_prompt,
        provider=image_provider or "pollinations",
        api_key=image_api_key,
        model=image_model,
        base_url=image_base_url,
        style=style,
        aspect_ratio=aspect_ratio,
        width=width,
        height=height
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
