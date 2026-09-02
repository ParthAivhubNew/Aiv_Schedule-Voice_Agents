import random
import re
from typing import Dict, Any, List, Tuple
from datetime import datetime, timedelta

def extract_requested_time(transcript_lines: List[str]) -> Dict[str, Any]:
    text = " ".join(transcript_lines)
    
    # Check for months ahead e.g. "after 6 months"
    match_months = re.search(r"(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+months?", text, re.IGNORECASE)
    if match_months:
        words_to_num = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
        raw_val = match_months.group(1).lower()
        n = words_to_num.get(raw_val, int(raw_val) if raw_val.isdigit() else 6)
        
        future_date = datetime.utcnow() + timedelta(days=n * 30)
        day_str = future_date.strftime("%a, %d %b %Y")
        
        # Extract quote
        quote = "Please contact us after 6 months — budget is frozen until then."
        for line in transcript_lines:
            if "month" in line.lower() or "budget" in line.lower():
                quote = line.replace("Prospect:", "").strip()
                break
                
        return {
            "day": day_str,
            "time": "10:00",
            "exact_words": quote,
            "deferred": True,
        }
        
    # Check for "next week" / "Monday morning"
    if "monday" in text.lower() or "next week" in text.lower():
        next_monday = datetime.utcnow() + timedelta(days=(7 - datetime.utcnow().weekday()) % 7 or 7)
        day_str = next_monday.strftime("Mon, %d %b")
        quote = "Call me back next week, Monday morning if you can."
        for line in transcript_lines:
            if "monday" in line.lower() or "next week" in line.lower():
                quote = line.replace("Prospect:", "").strip()
                break
        return {
            "day": day_str,
            "time": "10:00",
            "exact_words": quote,
            "deferred": False,
        }

    return None

SCENARIOS = [
    {
        "type": "meeting_booked",
        "state": "negotiating",
        "lines": [
            "AI: Hi, this is Sam calling on behalf of AIVHub — do you have a quick minute?",
            "Prospect: Sure, what is this regarding?",
            "AI: We build real-time operations dashboards for mid-market teams. Would Thursday at 2:00 PM work for a 15-minute discovery call?",
            "Prospect: Thursday afternoon works fine. Send over a calendar invite.",
            "AI: Excellent — Thursday 2:00 PM is confirmed. I'll send the Google Meet link shortly.",
        ],
        "outcome": "meeting_booked",
        "booking_time": "Thu 2:00 PM",
    },
    {
        "type": "human_review",
        "state": "human_review",
        "flag": "Pricing question",
        "lines": [
            "AI: Hi, this is Sam from AIVHub — got 2 minutes to talk about logistics dispatch reporting?",
            "Prospect: We might be interested, but what exactly does this cost per user?",
            "AI: Pricing depends on data volume and connectors — let me connect you with an ops director who can share specific tiers.",
        ],
        "outcome": "human_review",
    },
    {
        "type": "callback_requested",
        "state": "negotiating",
        "lines": [
            "AI: Hi, Sam calling from AIVHub — is now a convenient time for a brief word?",
            "Prospect: Caught me on the shop floor. Call me back next week, Monday morning if you can.",
            "AI: Understood — I'll park a callback for Monday at 10:00 AM. Speak with you then.",
        ],
        "outcome": "callback_requested",
    },
    {
        "type": "rejected",
        "state": "ended",
        "lines": [
            "AI: Hi, this is Sam from AIVHub —",
            "Prospect: Not interested, please remove us from your calling list immediately.",
            "AI: Understood completely — adding you to our do-not-call list right now. Have a good day.",
        ],
        "outcome": "rejected",
    },
    {
        "type": "pitching",
        "state": "pitching",
        "lines": [
            "AI: Hi, this is Sam calling on behalf of AIVHub — saw your recent warehouse expansion in Manchester.",
            "Prospect: Hello, yes we just opened the new unit. What do you do?",
            "AI: We help logistics operators eliminate manual spreadsheets with automated dispatch metrics.",
        ],
        "outcome": "in_progress",
    }
]

def generate_call_scenario(prospect_name: str, channel: str = "voice") -> Dict[str, Any]:
    scenario = random.choice(SCENARIOS)
    
    if channel == "whatsapp":
        lines = [
            f"AI: Hi! This is Sam from AIVHub — saw {prospect_name}'s recent operations milestone. Open to a quick 15-min chat about ops dashboards?",
            "Prospect: Sounds interesting, can you send over a summary one-pager first?",
            "AI: Absolutely — sending the PDF now. Would Tuesday or Wednesday afternoon suit for a quick follow-up call?"
        ]
        return {
            "state": "negotiating",
            "channel": "whatsapp",
            "duration": "3 messages",
            "flag": None,
            "transcript": lines,
            "outcome": "contacted",
        }
        
    return {
        "state": scenario["state"],
        "channel": channel,
        "duration": f"0{random.randint(1, 4)}:{random.randint(10, 59)}",
        "flag": scenario.get("flag"),
        "transcript": scenario["lines"],
        "outcome": scenario["outcome"],
        "booking_time": scenario.get("booking_time"),
    }
