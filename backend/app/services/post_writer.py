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
    "neon_tech": "dark theme holographic interface, glowing data visualisations, neon accents, futuristic operational intelligence"
}

def create_topic_image_prompt(title: str, angle: str = "", theme: str = "Operations", style: str = "modern_saas") -> str:
    """Creates an evocative image prompt based on the topic title, theme and style."""
    base_concept = title.replace("Why ", "").replace("How ", "").replace("?", "").strip()
    style_suffix = IMAGE_STYLES.get(style, IMAGE_STYLES["modern_saas"])
    return f"{base_concept}, {theme.lower()} focus, {style_suffix}"

def generate_image_url(prompt: str, style: str = "modern_saas", width: int = 1200, height: int = 675) -> str:
    """Generates an instant high-resolution AI image URL using Pollinations FLUX/AI image service."""
    clean_prompt = prompt.strip()
    if not clean_prompt:
        clean_prompt = "Business intelligence dashboard analytics operations team"
    style_suffix = IMAGE_STYLES.get(style, "")
    full_prompt = f"{clean_prompt}, {style_suffix}".strip(", ")
    encoded = urllib.parse.quote(full_prompt)
    seed = random.randint(1000, 999999)
    return f"https://image.pollinations.ai/prompt/{encoded}?width={width}&height={height}&nologo=true&seed={seed}"

def parse_chat_intent(text: str) -> Dict[str, Any]:
    t = (text or "").lower()
    
    # Check for schedule requests e.g. "Schedule 3 posts on Mon/Wed/Fri at 10am"
    days = []
    for day in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]:
        if day in t or day[:3] in t:
            days.append(day.capitalize())
            
    # Check horizon
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

async def call_llm_chat(
    user_prompt: str,
    system_prompt: str,
    provider: str = "deepseek",
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None
) -> Optional[str]:
    """
    Calls any standard OpenAI-compatible chat API (DeepSeek, OpenAI, Groq, Ollama, etc.)
    """
    if not api_key:
        return None

    # Determine endpoint & model
    prov = (provider or "deepseek").lower()
    if prov == "deepseek" or "deepseek" in (model or "").lower():
        endpoint = "https://api.deepseek.com/chat/completions"
        target_model = model or "deepseek-chat"
    elif prov == "openai":
        endpoint = "https://api.openai.com/v1/chat/completions"
        target_model = model or "gpt-4o-mini"
    elif base_url:
        endpoint = base_url.rstrip("/") + "/chat/completions"
        target_model = model or "deepseek-chat"
    else:
        endpoint = "https://api.deepseek.com/chat/completions"
        target_model = model or "deepseek-chat"

    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": target_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.7
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=8.0)) as client:
            res = await client.post(endpoint, headers=headers, json=payload)
            if res.status_code == 200:
                data = res.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                return content.strip()
            else:
                logger.warning(f"LLM call returned status {res.status_code}: {res.text[:200]}")
                return None
    except Exception as e:
        logger.error(f"Error calling LLM API ({endpoint}): {e}")
        return None

def generate_social_post(topic_title: str, channel: str = "linkedin", company_name: str = "AIVHub") -> str:
    if channel == "linkedin":
        return f"""🚀 {topic_title}

In mid-market operations, real-time visibility is the difference between proactive fixes and costly firefighting.

At {company_name}, we help teams replace manual end-of-shift reporting with automated, real-time business intelligence dashboards.

Key takeaways for ops leaders:
• Eliminate 10+ hours of weekly spreadsheet assembly
• Spot throughput bottlenecks before they impact delivery
• Give frontline managers live operational control

How is your team currently tracking live line efficiency? Let's discuss in the comments below.

#BusinessIntelligence #Operations #Manufacturing #Logistics #DataAnalytics"""
    
    elif channel == "x":
        return f"Manual spreadsheets shouldn't be running your operations. Real-time dashboards give mid-market teams instant visibility without the reporting delay. Read more on {topic_title.lower()}: #OpsEx #BI"
        
    elif channel == "facebook":
        return f"💡 {topic_title}\n\nRunning operations with yesterday's data costs time and efficiency. Discover how modern BI dashboards give your frontline team real-time control.\n\nLearn more at aivhub.io"
        
    else:
        return f"Operational excellence in action: {topic_title}. #Operations #BI #DataDriven"

