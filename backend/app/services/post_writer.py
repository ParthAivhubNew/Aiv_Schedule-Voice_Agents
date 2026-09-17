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
    "General": [
        {"title": "Company update", "angle": "Write from the company profile and the user's post plan.", "hook": ""}
    ]
}

def linkedin_craft_brief(company_name: str = "", company_pitch: str = "", company_context: str = "") -> str:
    brand = (company_name or "").strip()
    mention = (
        f"Mention {brand} once, naturally, only if it earns the sentence."
        if brand else
        "Do not invent a company name, website, or product. If no company facts were supplied, write educational content with no brand mention."
    )
    facts = "\n".join(x for x in (
        f"Company: {brand}" if brand else "",
        f"Offering: {company_pitch.strip()}" if (company_pitch or "").strip() else "",
        (company_context or "").strip(),
    ) if x)
    brand_visual = f"Discreet {brand} wordmark if useful." if brand else "No invented logo or wordmark."
    return f"""You write high-engagement LinkedIn posts. Company facts below are the ONLY business details you may use. Never invent offerings, URLs, customers, or metrics.

{    facts or "No company profile supplied."}

{mention}
Write about the USER'S POST PLAN, grounded in this profile. Do not switch to a stock industry angle. Do not invent a different business.

Goal: reach, comments, brand awareness, site visits, qualified leads. Do NOT write a sales ad.

Mix: ~70% educational/insight, ~20% thought leadership, ~10% product.

ONE complete LinkedIn post:
- Strong 1–2 line hook that creates curiosity.
- Address the problem in the user's plan (or the company's real customer problem from the profile if the plan is thin).
- Explain how this company's actual offering helps — using only profile facts.
- One useful insight, framework, question, or practical takeaway.
- Short paragraphs for LinkedIn mobile.
- Human, knowledgeable, confident, conversational.
- Avoid generic corporate language.
- End with an engaging question that invites comments.
- 3–6 relevant hashtags (not stuffed into the body).
- 120–220 words for hook + body (exclude hashtags).

Image: premium, modern, enterprise-ready. ONE clear idea from THIS post. Strong hierarchy. Minimal text (headline max 8 words). {brand_visual} Visual must match the user's plan and the company, not a generic stock industry scene. No stock-photo look. No cluttered fake dashboard UI. No excessive icons. No cliché robots unless the plan is specifically about AI. Readable in 2 seconds on LinkedIn scroll. Clean space for headline overlay. Format 4:5 (1080x1350) or 1:1.

Banned: delve, game-changer, revolutionary, synergy, leverage, unlock, in today's fast-paced world, slogan closers, fake statistics."""

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
    "Premium 4:5 LinkedIn visual: dark navy desk, one clean abstract executive chart in teal light, generous negative space, no readable fake UI, discreet brand wordmark only if a company name was supplied",
    "Premium 4:5 LinkedIn visual: connected data nodes flowing into a single glass panel, studio lighting, enterprise SaaS, no cluttered dashboard, no stock handshake",
    "Premium 4:5 LinkedIn visual: split of messy printed reports vs one calm insight surface, high-end editorial graphic, minimal type, no fake spreadsheet cells",
    "Premium 4:5 LinkedIn visual: leadership table with one shared abstract live view, cinematic soft light, no robots, no icon soup",
    "Premium 4:5 LinkedIn visual: asking a question of data — luminous query line into a simple chart, modern BI brand, empty space for headline",
]


def pick_image_scene(topic: str) -> str:
    key = sum(ord(c) for c in (topic or "")) or 42
    return IMAGE_SCENE_VARIANTS[key % len(IMAGE_SCENE_VARIANTS)]


_SLOP_LINE = re.compile(
    r"(?im)^\s*(Not because\b.*|"
    r"The fix isn['’]t\b.*|"
    r"Most (?:ops |operations )?teams still\b.*|"
    r"Scattered data in\.\s*Real-time decisions out\.?|"
    r"The floor already moved\.?\s*The pack did not\.?|"
    r"That hour is not\b.*)\s*$"
)
_SLOP_INLINE = [
    re.compile(r"(?i)Not because they[^.!\n]*?(?:—|–|--)\s*because[^.!\n]*[.!]?", re.S),
    re.compile(r"(?i)The fix isn['’]t another[^.!\n]*[.!]?\s*It['’]s[^.!\n]*[.!]?", re.S),
    re.compile(r"(?i)Scattered data in\.\s*Real-time decisions out\.?", re.I),
    re.compile(r"(?i)The floor already moved\.?\s*The pack did not\.?", re.I),
    re.compile(r"(?i)That hour is not[^.!\n]*[.!]?\s*It is[^.!\n]*[.!]?", re.I),
    re.compile(r"(?i)(?:^|\n)Not [^.!\n]{8,70}[.!]\s*It(?:'s| is)[^.!\n]{8,80}[.!]", re.M),
]


def strip_ai_slop(text: str) -> str:
    """Kill slogan contrast lines models love. Keep the rest."""
    if not text:
        return text
    cleaned = text
    for pat in _SLOP_INLINE:
        cleaned = pat.sub("", cleaned)
    kept = []
    for line in cleaned.splitlines():
        if _SLOP_LINE.match(line):
            continue
        kept.append(line)
    cleaned = re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned or text


def image_prompt_from_copy(caption: str, topic: str = "", company: str = "") -> str:
    scene = re.sub(r"\s+", " ", (caption or topic or "")).strip()[:220]
    if not scene:
        scene = "one clear idea from the user's post plan"
    return linkedin_image_prompt(
        {"imageConcept": scene, "imageHeadline": "One view. Better decisions."},
        topic or scene,
        company or "",
    )


def company_hashtag(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]", "", name or "")
    if len(slug) < 2:
        return ""
    return "#" + slug[:32]


def requested_hashtag_count(note: str) -> Optional[int]:
    t = str(note or "").strip()
    if not t:
        return None
    m = re.search(r"(\d{1,2})\s*hash", t, re.I)
    if m:
        return max(1, min(30, int(m.group(1))))
    if re.search(r"\b(more|extra|add|increase|lot of|lots of)\b.{0,28}\bhash|\bhash.{0,28}\b(more|extra)", t, re.I):
        return 12
    return None


def normalize_hashtags(raw, company: str = "", max_n: int = 6, pad: bool = True) -> List[str]:
    tags: List[str] = []
    if isinstance(raw, str):
        raw = [p for p in re.split(r"[\s,]+", raw) if p]
    for t in raw or []:
        t = str(t).strip()
        if not t:
            continue
        if not t.startswith("#"):
            t = "#" + t.lstrip("#")
        if t.lower() not in [x.lower() for x in tags]:
            tags.append(t)
    brand = company_hashtag(company)
    if brand and brand.lower() not in [x.lower() for x in tags]:
        tags.append(brand)
    cap = max(1, min(30, int(max_n or 6)))
    if pad:
        for t in ("#Leadership", "#Analytics", "#Operations"):
            if len(tags) >= min(3, cap):
                break
            if t.lower() not in [x.lower() for x in tags]:
                tags.append(t)
    return tags[:cap]


def assemble_linkedin_post(payload: Dict[str, Any]) -> str:
    hook = strip_ai_slop(str(payload.get("hook") or "")).strip()
    body = strip_ai_slop(str(payload.get("copy") or payload.get("linkedin_copy") or "")).strip()
    if hook and body:
        head = hook[:48].lower()
        text = body if body.lower().startswith(head) else hook + "\n\n" + body
    else:
        text = body or hook
    text = re.sub(r"(?:\s*#\w+)+\s*$", "", text or "").strip()
    max_n = int(payload.get("_max_hashtags") or 6)
    pad = not payload.get("_no_pad_hashtags")
    tags = normalize_hashtags(
        payload.get("hashtags"),
        company=str(payload.get("_company") or ""),
        max_n=max_n,
        pad=pad,
    )
    tag_line = " ".join(tags)
    if tag_line and tag_line not in text:
        text = text.rstrip() + "\n\n" + tag_line
    return text.strip()


def linkedin_image_prompt(payload: Dict[str, Any], topic: str, company: str) -> str:
    existing = (payload.get("imagePrompt") or payload.get("image_prompt") or "").strip()
    if len(existing) > 120:
        return existing
    headline = (payload.get("imageHeadline") or payload.get("image_headline") or "One source of truth").strip()
    concept = (payload.get("imageConcept") or payload.get("image_concept") or topic or "").strip().rstrip(".")
    brand = (company or "").strip()
    brand_line = (
        f"Small discreet {brand} wordmark bottom-right. "
        if brand else
        "No invented logo or company wordmark. "
    )
    for_line = f" for {brand}" if brand else ""
    return (
        f"LinkedIn 4:5 portrait 1080x1350, premium enterprise visual{for_line}. "
        f"ONE idea: {concept}. Composition: strong hierarchy, generous negative space, subject upper-center, "
        f"headline overlay max 8 words in clean sans-serif: '{headline}'. "
        f"{brand_line}Palette: deep navy, teal, warm white. "
        "Match the user's plan and the company. No readable fake UI text, "
        "no cluttered dashboards, no stock handshake, no icon soup, no robots unless the plan is about AI. "
        "Photoreal + editorial graphic hybrid, studio lighting, 8k, understandable in two seconds while scrolling."
    )


def _user_angle(topic: str, pitch: str = "") -> str:
    """Pull the human thought out of a post plan. Skip instruction chrome."""
    skip = re.compile(
        r"(?i)^(create a |post must|output format|company:|website:|core offering:|"
        r"goal$|goal:|target audience|generate one|content direction|image generation|"
        r"prefer topics|important$|use approximately|\*\*post title|\*\*hook|"
        r"\*\*linkedin|\*\*hashtags|\*\*image |increase linkedin|business owners|"
        r"70%|start with a strong|look premium|visual should|also cover|audience:|"
        r"craft:|mix:|image:|goal:)"
    )
    prefix = re.compile(
        r"(?i)^(angle for this post:|angle:|topic:|post plan:|thought:|headline:)\s*"
    )
    kept = []
    for raw in (topic or "").splitlines():
        ln = re.sub(r"^[\s\-*#]+", "", raw).strip().strip("*")
        ln = prefix.sub("", ln).strip()
        if not ln or len(ln) < 18:
            continue
        if skip.match(ln):
            continue
        kept.append(ln)
    if kept:
        prefer = [ln for ln in kept if re.match(r"(?i)^(why |how |what |hidden |dashboard|turning |ai \+|real-time|data |common |before |executive )", ln)]
        return (prefer[0] if prefer else kept[0])[:220]
    blob = prefix.sub("", re.sub(r"\s+", " ", (topic or "").strip()))
    if blob:
        return blob[:220]
    return (pitch or "what this company actually does for customers")[:220]


def _fallback_linkedin_package(topic: str, company: str, pitch: str = "") -> Dict[str, Any]:
    brand = (company or "").strip()
    offering = (pitch or "").strip()
    angle = _user_angle(topic, offering)
    who = brand or "this company"
    short_offer = (offering.split(",")[0] if offering else "").strip() or "the work in the company profile"
    hook = angle.rstrip(".")
    if hook:
        hook = hook[0].upper() + hook[1:]
    if hook and not hook.lower().startswith(("why ", "what ", "how ", "if ", "the ")):
        hook = f"{hook}."
    elif hook and hook.lower().startswith("why ") and not hook.endswith("?"):
        hook = hook + "?"
    product_line = (
        f"That is the work {who} is built for: {short_offer.lower()}, so the room looks at one picture instead of five files."
        if brand else
        f"A shared live view of {short_offer.lower()} beats another export."
    )
    extra_tags = []
    low = (angle + " " + (topic or "")).lower()
    if "excel" in low or "spreadsheet" in low:
        extra_tags += ["#Excel", "#DataAnalytics"]
    if "dashboard" in low or "analytics" in low or "intelligence" in low:
        extra_tags += ["#BusinessIntelligence"]
    copy = (
        f"{hook}\n\n"
        "The cost shows up in the room. Different versions of the same answer. "
        "A number that was right yesterday and fuzzy today. People debate the source instead of the next step.\n\n"
        f"{product_line} No brochure. Just a shorter path from the messy source to a decision you can defend.\n\n"
        "A useful test: if this workflow still needs a hero file or more than one person to assemble the pack, "
        "you are paying a hidden tax before any decision gets made. The meeting should start at the insight, not the hunt.\n\n"
        "What part of this still lives in a file only one person can explain?"
    )
    headline_words = [w for w in re.sub(r"[^A-Za-z0-9 ]+", " ", angle).split() if w][:8]
    chosen = {
        "postTitle": angle[:80],
        "hook": hook,
        "copy": copy,
        "hashtags": extra_tags or ["#Leadership", "#Operations"],
        "imageConcept": f"Premium uncluttered visual of this idea: {angle}. Matches {who}.",
        "imageHeadline": " ".join(headline_words) or "One source of truth",
        "_company": brand,
    }
    chosen["hashtags"] = normalize_hashtags(chosen.get("hashtags"), company=brand)
    chosen["image_prompt"] = linkedin_image_prompt(chosen, topic, brand)
    chosen["imagePrompt"] = chosen["image_prompt"]
    chosen["cta"] = chosen["copy"].strip().split("\n")[-1]
    chosen["first_comment"] = "Curious how your team handles this today."
    chosen["alt_text"] = f"{chosen.get('imageHeadline')}: {chosen.get('imageConcept')}"
    chosen["recommended_time"] = "Tue 09:30"
    return chosen


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
    image_url = fallback_url
    try:
        from app.services.social_publisher import fetch_image_bytes
        from app.services.media_store import store_image_bytes
        raw, mime = await fetch_image_bytes(fallback_url)
        if raw:
            rel = store_image_bytes(raw, mime)
            if rel:
                image_url = rel
    except Exception as img_err:
        logger.warning(f"Could not cache generated image locally: {img_err}")
    resp = {
        "status": "ok",
        "imageUrl": image_url,
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
    company_name: str = "",
    company_pitch: str = "",
    company_context: str = "",
    linkedin_directive: str = "",
    existing_copy: str = "",
    existing_headline: str = "",
    api_key: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    image_api_key: Optional[str] = None,
    image_provider: Optional[str] = None,
    image_model: Optional[str] = None,
    image_base_url: Optional[str] = None,
    style: str = "modern_saas",
    aspect_ratio: str = "4:5",
    adapt_per_channel: bool = False,
    skip_image: bool = False,
    revision_note: str = "",
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

    user_plan = (topic or "").strip()
    brand = (company_name or "").strip()
    kb_bits = []
    if brand:
        kb_bits.append(f"Company: {brand}")
    if (company_pitch or "").strip():
        kb_bits.append(f"Offering: {company_pitch.strip()}")
    if (company_context or "").strip():
        kb_bits.append(company_context.strip())
    kb_block = "\n".join(kb_bits)
    clean_topic = user_plan or (company_pitch or "").strip() or "Write about this company's actual offering from the profile. Do not invent another business."
    li_rules = (linkedin_directive or "").strip() or linkedin_craft_brief(brand, company_pitch, company_context)
    draft = (existing_copy or "").strip()
    headline = (existing_headline or "").strip()
    note = (revision_note or "").strip()
    want_n = requested_hashtag_count(note)
    max_n = want_n or 6
    no_pad = want_n is not None
    draft_block = ""
    if headline:
        draft_block += f"\nExisting headline (this is the visible post title — revise it when the request mentions headline/title, or when a rewrite would make it stale):\n{headline}\n"
    if draft:
        draft_block += f"\nExisting draft (KEEP names, files, meetings, numbers unless the revision asks to change them):\n{draft}\n"
    if note:
        draft_block += (
            "\nREVISION REQUEST (apply this to headline, hook, body, hashtags, CTA — not a new topic). "
            "If the request is only about the headline, keep hook/body/hashtags unless they asked to change those too:\n"
            f"{note}\n"
        )

    plan_hint = clean_topic.replace('"', "'")[:280]
    if adapt_per_channel:
        copy_schema = f'''
  "copy": "Canonical LinkedIn body 120-220 words about the user's plan ({plan_hint}). Educational first. {company_name} once, naturally.",
  "linkedin_copy": "Same LinkedIn post body without hashtags.",
  "facebook_copy": "Facebook version, conversational.",
  "instagram_copy": "Instagram caption, line breaks, hashtags at end.",
  "threads_copy": "Short take under 400 chars.",
  "x_copy": "Tweet under 240 chars, same claim."'''
    else:
        copy_schema = f'''
  "copy": "LinkedIn body 120-220 words about the user's plan ({plan_hint}). Short mobile paragraphs. No hashtags in this field. {company_name} once if it earns a sentence. No fake stats."'''

    # 1. Attempt LLM generation if credentials available
    system_prompt = f"""{li_rules}

You ghostwrite for this company using ONLY the profile facts. Sound like a practitioner a peer would stop scrolling to read.

USER POST PLAN (this is the thought to write — do not replace it with a stock angle):
{clean_topic[:4000]}
{draft_block}
Company profile (use only these facts; do not invent metrics, customers, systems, URLs, or offerings):
{kb_block or "No extra facts supplied."}

If the plan is detailed, execute that plan. If the plan is a short thought, expand it using the profile. Never switch industry.
{f"HASHTAG OVERRIDE: the user asked for {want_n} hashtags. Put exactly {want_n} items in the hashtags array. Do not clamp to 3–6." if want_n else "Default: 3–6 hashtags unless the revision asks for a different count."}

Banned: delve, game-changer, revolutionary, synergy, leverage, unlock, in today's fast-paced world, slogan closers, fake statistics.

Return ONLY valid JSON:
{{
  "postTitle": "Visible post headline, max 8 words. Revise it when the user asks to change the headline/title, and whenever a rewrite makes the old headline stale.",
  "hook": "1-2 line curiosity hook",
{copy_schema}
  "hashtags": ["#Tag1", "#Tag2", "#Tag3"],
  "cta": "The closing question already in the post",
  "first_comment": "Useful follow-up, not a sales pitch",
  "imageConcept": "One concise paragraph describing the visual",
  "imageHeadline": "Max 8 words on the image",
  "image_prompt": "Production-ready 4:5 LinkedIn prompt: composition, lighting, style, typography placement, {company_name} branding, 1080x1350. No fake UI.",
  "alt_text": "Plain-language image description",
  "recommended_time": "Tue 09:30"
}}"""
    if note:
        tag_rule = (
            f"Use exactly {want_n} hashtags in the hashtags array. Ignore the usual 3–6 cap for this revision."
            if want_n
            else "Keep 3–6 hashtags unless the revision asks for a different count."
        )
        user_msg = (
            "Revise the existing draft using the revision request. Return the FULL post JSON "
            "(postTitle, hook, copy, hashtags, cta). Apply the note to headline, hook, body, and hashtags. "
            f"{tag_rule} "
            "Stay on the same topic and company facts. Do not invent a new angle. "
            "Do not change the image concept unless the request is about the image."
        )
    elif draft:
        user_msg = "Rewrite the draft. Keep names and numbers. Keep 120-220 words, 3-6 hashtags. Stay on the user's plan."
    else:
        user_msg = (
            "Write one complete LinkedIn post + matching image brief.\n"
            "About the user's post plan. Grounded in the company profile. 120-220 words, 3-6 hashtags."
        )

    llm_payload = None
    generation_source = "fallback"
    try:
        res = await call_open_chat_llm(
            messages=[{"role": "user", "content": user_msg}],
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

    # 2. Fallback: craft brief + company profile facts only.
    if not llm_payload:
        llm_payload = _fallback_linkedin_package(clean_topic, brand, company_pitch)
        if draft and len(draft) >= 80:
            llm_payload["copy"] = strip_ai_slop(draft)
            llm_payload["hook"] = draft.split("\n")[0][:180]

    for k in ("copy", "linkedin_copy", "facebook_copy", "instagram_copy", "threads_copy", "x_copy", "hook", "cta", "postTitle", "imageHeadline", "imageConcept"):
        if llm_payload.get(k):
            llm_payload[k] = strip_ai_slop(str(llm_payload.get(k)))

    llm_payload["_company"] = brand
    llm_payload["_max_hashtags"] = max_n
    llm_payload["_no_pad_hashtags"] = no_pad
    merged_tags = list(llm_payload.get("hashtags") or [])
    if want_n:
        merged_tags.extend(re.findall(r"#[A-Za-z0-9_]+", str(llm_payload.get("copy") or "")))
    llm_payload["hashtags"] = normalize_hashtags(
        merged_tags,
        company=brand,
        max_n=max_n,
        pad=not no_pad,
    )
    llm_payload["postTitle"] = (llm_payload.get("postTitle") or headline or clean_topic)[:80]
    llm_payload["imageHeadline"] = (llm_payload.get("imageHeadline") or llm_payload.get("image_headline") or "")[:80]
    llm_payload["imageConcept"] = llm_payload.get("imageConcept") or llm_payload.get("image_concept") or clean_topic
    llm_payload["image_concept"] = llm_payload["imageConcept"]
    llm_payload["image_headline"] = llm_payload["imageHeadline"]

    canonical_body = (llm_payload.get("copy") or llm_payload.get("linkedin_copy") or "").strip()
    llm_payload["copy"] = canonical_body
    assembled = assemble_linkedin_post(llm_payload)
    if not adapt_per_channel:
        llm_payload["linkedin_copy"] = assembled
        llm_payload["facebook_copy"] = assembled
        llm_payload["instagram_copy"] = assembled
        llm_payload["threads_copy"] = assembled[:400]
        llm_payload["x_copy"] = (llm_payload.get("x_copy") or llm_payload.get("hook") or assembled)[:240]
        llm_payload["copy"] = assembled
    else:
        llm_payload["linkedin_copy"] = assemble_linkedin_post({**llm_payload, "copy": llm_payload.get("linkedin_copy") or canonical_body})
        llm_payload["copy"] = assembled
    llm_payload["adaptPerChannel"] = bool(adapt_per_channel)

    if skip_image:
        llm_payload["imageUrl"] = None
        llm_payload["imagePrompt"] = llm_payload.get("image_prompt") or llm_payload.get("imagePrompt") or ""
        llm_payload["image_prompt"] = llm_payload["imagePrompt"]
        llm_payload["generationSource"] = generation_source
        llm_payload["needsHumanReview"] = generation_source != "llm"
        llm_payload["topic"] = clean_topic
        llm_payload["skipImage"] = True
        return llm_payload

    # Generate Image with Provider & Key
    img_creds = await resolve_image_credentials(
        db=db,
        provider=image_provider,
        api_key=image_api_key or api_key,
        model=image_model,
        base_url=image_base_url or base_url,
    )
    img_prompt = linkedin_image_prompt(llm_payload, clean_topic, brand)
    width, height = ASPECT_RATIOS.get(aspect_ratio, (1080, 1350))
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
    llm_payload["image_prompt"] = img_prompt
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
