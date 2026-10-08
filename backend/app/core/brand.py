"""Words that reach clients (errors, notifications, call transcripts) never name the companies
behind the platform: clients use Outreach, not its suppliers. Staff-only text keeps real names.
"""
from __future__ import annotations

import re

_SUPPLIERS = re.compile(
    r"\b(telnyx|twilio|vonage|plivo|xai|grok|openai|deepgram|cartesia|eleven\s?labs|livekit|vapi|retell|"
    r"anthropic|deepseek|groq|mistral|whisper)\b", re.IGNORECASE)


def scrub(text: object) -> str:
    """`text` with any supplier name replaced by "our network"."""
    return _SUPPLIERS.sub("our network", str(text if text is not None else ""))
