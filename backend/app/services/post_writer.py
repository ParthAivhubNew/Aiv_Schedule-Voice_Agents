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

    # Generate Image URL
    img_prompt = llm_payload.get("image_prompt") or create_topic_image_prompt(clean_topic, style=style)
    width, height = ASPECT_RATIOS.get(aspect_ratio, (1200, 675))
    img_url = generate_image_url(img_prompt, style=style, width=width, height=height, aspect_ratio=aspect_ratio)

    llm_payload["imageUrl"] = img_url
    llm_payload["imagePrompt"] = img_prompt
    llm_payload["style"] = style
    llm_payload["aspect_ratio"] = aspect_ratio
    llm_payload["width"] = width
    llm_payload["height"] = height
    llm_payload["topic"] = clean_topic

    return llm_payload
