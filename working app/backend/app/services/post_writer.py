import re
from typing import Dict, Any, List

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
