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

IMAGE_SCENE_VARIANTS = [
    "Photoreal editorial: shift supervisor with clipboard on a production line, shallow depth of field, no readable fake UI text, no logos",
    "Photoreal editorial: small dispatch team at dawn around a wall board of routes and KPIs, industrial lighting, no logos",
    "Photoreal editorial: planners in a glass-walled ops room overlooking warehouse activity, abstract screens only, no fake UI text",
    "Photoreal editorial: maintenance lead reviewing sensor alerts on a tablet beside running equipment, cinematic, no logos",
    "Photoreal editorial: mid-market control room with people at desks and large abstract data walls, warehouse visible through glass, no fake UI text",
]


def pick_image_scene(topic: str) -> str:
    key = sum(ord(c) for c in (topic or "")) or 42
    return IMAGE_SCENE_VARIANTS[key % len(IMAGE_SCENE_VARIANTS)]


def create_topic_image_prompt(title: str, angle: str = "", theme: str = "Operations", style: str = "modern_saas") -> str:
    """Creates an evocative image prompt based on the topic title, theme and style."""
    base_concept = title.replace("Why ", "").replace("How ", "").replace("?", "").strip()
    if style in ("editorial", "modern_saas", "cinematic"):
        return f"{base_concept}. {pick_image_scene(base_concept)}"
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
    """Prefer the saved IMAGE connection (custom / OpenAI). Never send an xAI voice key to an image API."""
    from app.config import settings
    from sqlalchemy.future import select
    from app.models.models import Connection

    prov = (provider or "").strip().lower()
    key = (api_key or "").strip()
    mod = (model or "").strip()
    burl = (base_url or "").strip()
    if prov in ("chatgpt", "gpt", "dall-e", "dalle"):
        prov = "openai"

    def _is_xai(k: str) -> bool:
        return (k or "").startswith("xai-")

    if _is_xai(key):
        key = ""

    img_row = None
    if db is not None:
        try:
            res = await db.execute(select(Connection))
            conns = list(res.scalars().all())
            image_conns = [
                c for c in conns
                if c.status == "connected" and str(c.group_name or "").upper().startswith("IMAGE")
            ]
            prefer = image_conns or [
                c for c in conns
                if c.status == "connected" and "image" in str(c.name or "").lower()
            ]
            for c in prefer:
                cfg = c.config if isinstance(c.config, dict) else {}
                k = (cfg.get("api_key") or cfg.get("apiKey") or "").strip()
                if k and not _is_xai(k):
                    img_row = {
                        "provider": (cfg.get("provider") or c.name or "custom").strip().lower(),
                        "api_key": k,
                        "base_url": (cfg.get("base_url") or cfg.get("baseUrl") or "").strip(),
                        "model": (cfg.get("model") or "").strip(),
                    }
                    break
        except Exception as e:
            logger.warning(f"IMAGE connection lookup failed: {e}")

    if img_row:
        row_prov = img_row["provider"]
        if row_prov in ("chatgpt", "gpt", "dall-e", "dalle"):
            row_prov = "openai"
        # Saved IMAGE connection is the engine. Do not let an LLM/xAI key steal this slot.
        prov = row_prov or prov or "custom"
        key = img_row["api_key"] or key
        burl = img_row["base_url"] or burl
        mod = img_row["model"] or mod
        if not mod and (prov == "custom" or "gpt-image" in (burl or "").lower()):
            mod = "gpt-image-2.5-flare"

    explicit_paid = any(x in (prov or "") for x in ("stability", "fal", "custom", "openai", "dall"))
    env_openai = (getattr(settings, "OPENAI_API_KEY", None) or os.environ.get("OPENAI_API_KEY") or "").strip()
    if _is_xai(env_openai):
        env_openai = ""

    if explicit_paid and (key or burl):
        return {
            "provider": prov or "custom",
            "api_key": key,
            "model": mod,
            "base_url": burl,
        }
    if env_openai:
        return {
            "provider": "openai",
            "api_key": env_openai,
            "model": mod if mod and ("dall-e" in mod or "gpt-image" in mod) else "dall-e-3",
            "base_url": burl or "https://api.openai.com/v1",
        }
    return {
        "provider": prov or "pollinations",
        "api_key": key,
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

    # 4. Custom endpoint (Automatic1111 / Comfy / OpenAI-compatible gpt-image)
    elif "custom" in prov and (base_url or "").strip():
        try:
            headers = {"Content-Type": "application/json"}
            if api_key and api_key.strip():
                headers["Authorization"] = f"Bearer {api_key.strip()}"
            raw_url = base_url.strip().rstrip("/")
            looks_openai = any(x in raw_url.lower() for x in ("openai", "/v1/image", "images/generations"))
            dalle_size = "1792x1024" if aspect_ratio == "16:9" else ("1024x1792" if aspect_ratio == "9:16" else "1024x1024")
            urls = [raw_url]
            if looks_openai or (model or "").startswith("gpt-image") or (model or "").startswith("dall-e"):
                if raw_url.endswith("/v1"):
                    urls.append(raw_url + "/images/generations")
                elif raw_url.endswith("/v1/image"):
                    urls.append(raw_url + "s/generations")
                elif "/images/generations" not in raw_url:
                    urls.append(raw_url.rstrip("/") + "/images/generations")
            # de-dupe while preserving order
            seen = set()
            urls = [u for u in urls if u and not (u in seen or seen.add(u))]
            openai_body = {
                "model": model or "gpt-image-2.5-flare",
                "prompt": full_prompt[:1000],
                "n": 1,
                "size": dalle_size,
            }
            generic_body = {
                "prompt": full_prompt,
                "model": model or "custom",
                "width": w,
                "height": h,
                "aspect_ratio": aspect_ratio,
            }
            last_err = ""
            bodies = (openai_body,) if (looks_openai or (model or "").startswith("gpt-image") or (model or "").startswith("dall-e") or not model) else (generic_body, openai_body)
            async with httpx.AsyncClient(timeout=90.0) as client:
                for url in urls:
                    for body in bodies:
                        res = await client.post(url, headers=headers, json=body)
                        if res.status_code in (200, 201):
                            try:
                                d = res.json()
                            except Exception:
                                d = {}
                            row = {}
                            if isinstance(d, dict):
                                data = d.get("data")
                                if isinstance(data, list) and data:
                                    row = data[0] if isinstance(data[0], dict) else {}
                            custom_url = (
                                (row.get("url") if row else None)
                                or (d.get("imageUrl") if isinstance(d, dict) else None)
                                or (d.get("url") if isinstance(d, dict) else None)
                                or (d.get("images", [{}])[0].get("url") if isinstance(d, dict) and isinstance(d.get("images"), list) and d.get("images") and isinstance(d.get("images")[0], dict) else None)
                            )
                            b64 = (row.get("b64_json") if row else None) or (d.get("b64_json") if isinstance(d, dict) else None) or (d.get("b64") if isinstance(d, dict) else None)
                            if b64 and not custom_url:
                                custom_url = f"data:image/png;base64,{b64}"
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
                                    "height": h,
                                }
                        last_err = f"{res.status_code}: {res.text[:240]}"
                        if res.status_code in (401, 403):
                            break
            fallback_warning = f"Custom image endpoint failed ({last_err})"
        except Exception as e:
            logger.warning(f"Custom image endpoint exception: {e}")
            fallback_warning = f"Custom endpoint error ({e})"
    elif "custom" in prov and not (base_url or "").strip():
        fallback_warning = "Custom image engine needs a Custom Endpoint URL in AI Configuration."
    else:
        fallback_warning = fallback_warning

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
    company_context: str = "",
    linkedin_directive: str = "",
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
    adapt_per_channel: bool = False,
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
    kb_block = (company_context or "").strip()
    li_rules = (linkedin_directive or "").strip() or (
        "Short lines. One specific scene or number in line 1. No numbered lists. "
        "No 'three things' framing. Max 1 hashtag in the post body. "
        "One honest question at the end. No product pitch in the first half."
    )
    scene_hint = pick_image_scene(clean_topic)

    if adapt_per_channel:
        copy_schema = f'''
  "copy": "Canonical post body (140-200 words) about THIS topic: {clean_topic}.",
  "linkedin_copy": "LinkedIn version of the same idea.",
  "facebook_copy": "Facebook version of the same idea, conversational.",
  "instagram_copy": "Instagram caption of the same idea, line breaks, 3-5 hashtags at end.",
  "threads_copy": "Short take of the same idea under 400 chars.",
  "x_copy": "Tweet under 240 chars, same claim."'''
    else:
        copy_schema = f'''
  "copy": "ONE post used on every selected channel (140-200 words). Must be clearly about: {clean_topic}. Do NOT swap in a different story. Do NOT repeat the topic title as line 1. Open with a scene or one number from this topic. Short paragraphs. NO numbered lists. One question at the end. Max 1 emoji. Mention {company_name} at most once."'''

    # 1. Attempt LLM generation if credentials available
    system_prompt = f"""You are a sharp B2B ghostwriter for {company_name} ({company_pitch}).
Write like an ops director who has lived on a plant floor — not a marketing brochure.

The user topic is the assignment. Every sentence must serve that topic. Do not write a generic Thursday-pack post unless the topic is about late reporting packs.

Company facts (use only these; do not invent metrics or customers):
{kb_block or "No extra facts supplied — use plausible industry detail but no fake case studies or percentages."}

Voice: {li_rules}

Banned phrases: delve, game-changer, revolutionary, in today's fast-paced world, most leaders don't realize, three things we keep seeing, unlock, leverage synergy.

Return ONLY valid JSON with these keys:
{{
  "hook": "First visible line. Specific to the topic, slightly uncomfortable, no cliché.",
{copy_schema}
  "hashtags": ["#Tag1", "#Tag2"],
  "cta": "A question a reader of THIS topic would actually answer.",
  "first_comment": "Useful follow-up (not a sales pitch).",
  "image_prompt": "Photoreal editorial photo that illustrates THIS topic ({clean_topic}). {scene_hint}",
  "alt_text": "Plain-language image description matching the topic",
  "recommended_time": "Tue 09:30"
}}"""

    llm_payload = None
    generation_source = "fallback"
    try:
        res = await call_open_chat_llm(
            messages=[{"role": "user", "content": f"Topic (write ONLY about this): {clean_topic}\nAudience: operators and plant leaders."}],
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
            generation_source = "llm"
    except Exception as e:
        logger.warning(f"LLM package generation fallback triggered: {e}")

    # 2. Intelligent deterministic fallback if LLM is unavailable
    if not llm_payload:
        clean_headline = clean_topic.replace("Why ", "").replace("How ", "").strip()
        body = (
            f"{clean_headline[0].upper() + clean_headline[1:] if clean_headline else clean_topic}.\n\n"
            f"This is not a slogan. It is the work: {clean_headline}.\n\n"
            f"If your team still treats this as a slide instead of a shift problem, the process is the product — and it is slow.\n\n"
            f"What would you change first if this were true on your floor tomorrow?\n\n"
            f"#Operations"
        )
        llm_payload = {
            "hook": clean_headline[:120] or "The floor already moved. The pack did not.",
            "copy": body,
            "linkedin_copy": body,
            "facebook_copy": body,
            "instagram_copy": body,
            "threads_copy": body[:400],
            "x_copy": (clean_headline[:200] + " What would you change first?")[:240],
            "hashtags": ["#Operations"],
            "cta": "What would you change first if this were true on your floor tomorrow?",
            "first_comment": "Curious how you close this today — pack, board, or walk-around?",
            "alt_text": f"Editorial photo illustrating {clean_headline}.",
            "recommended_time": "Tuesday 09:30 AM",
            "image_prompt": f"Photoreal editorial photo that illustrates: {clean_topic}. {scene_hint}",
        }

    canonical = (llm_payload.get("copy") or llm_payload.get("linkedin_copy") or "").strip()
    if canonical and not adapt_per_channel:
        llm_payload["copy"] = canonical
        llm_payload["linkedin_copy"] = canonical
        llm_payload["facebook_copy"] = canonical
        llm_payload["instagram_copy"] = canonical
        llm_payload["threads_copy"] = canonical[:400]
        llm_payload["x_copy"] = (llm_payload.get("x_copy") or canonical)[:240]
    elif canonical:
        llm_payload["copy"] = canonical
    llm_payload["adaptPerChannel"] = bool(adapt_per_channel)

    # Generate Image with Provider & Key
    img_creds = await resolve_image_credentials(
        db=db,
        provider=image_provider,
        api_key=image_api_key or api_key,
        model=image_model,
        base_url=image_base_url or base_url,
    )
    img_prompt = llm_payload.get("image_prompt") or create_topic_image_prompt(clean_topic, style=style)
    if clean_topic and clean_topic.lower()[:24] not in (img_prompt or "").lower():
        img_prompt = f"{clean_topic}. {img_prompt}"
    width, height = ASPECT_RATIOS.get(aspect_ratio, (1200, 675))
    img_res = await generate_image_with_provider(
        prompt=img_prompt,
        provider=img_creds.get("provider") or image_provider,
        api_key=img_creds.get("api_key") or image_api_key,
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
    llm_payload["generationSource"] = generation_source
    llm_payload["needsHumanReview"] = generation_source != "llm"
    if img_res.get("warning"):
        llm_payload["imageWarning"] = img_res["warning"]

    return llm_payload
