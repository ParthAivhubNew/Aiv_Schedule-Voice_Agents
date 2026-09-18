"""Send WhatsApp confirmations via Twilio if configured, else return a wa.me deep link."""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx

from app.config import settings

logger = logging.getLogger("whatsapp_notify")


def digits_only(raw: str) -> str:
    d = re.sub(r"\D", "", str(raw or ""))
    if d.startswith("00"):
        d = d[2:]
    if len(d) == 11 and d.startswith("0"):
        d = "44" + d[1:]
    elif len(d) == 10 and d.startswith("7"):
        d = "44" + d
    return d


def wa_me_url(phone: str, text: str) -> str:
    digits = digits_only(phone)
    if not digits:
        return ""
    return f"https://wa.me/{digits}?text={quote(text or '')}"


def whatsapp_ready() -> Dict[str, Any]:
    sid = (settings.TWILIO_ACCOUNT_SID or "").strip()
    token = (settings.TWILIO_AUTH_TOKEN or "").strip()
    from_num = (settings.TWILIO_WHATSAPP_NUMBER or settings.TWILIO_PHONE_NUMBER or "").strip()
    configured = bool(sid and token and from_num)
    return {
        "configured": configured,
        "fromMasked": (from_num[:6] + "••••") if from_num and len(from_num) > 8 else (from_num or ""),
        "mode": "twilio" if configured else "wa_me",
        "note": (
            "Twilio WhatsApp is live. Confirms send from your WhatsApp sender."
            if configured
            else "No Twilio WhatsApp sender yet. Buttons open WhatsApp on this device with a ready-to-send message. Set TWILIO_WHATSAPP_NUMBER plus Twilio SID/token to send from the server."
        ),
    }


async def send_whatsapp(to: str, body: str, from_override: Optional[str] = None) -> Dict[str, Any]:
    link = wa_me_url(to, body)
    status = whatsapp_ready()
    digits = digits_only(to)
    if not digits:
        return {"sent": False, "error": "Need a WhatsApp number.", "waMeUrl": "", "mode": status["mode"]}

    sid = (settings.TWILIO_ACCOUNT_SID or "").strip()
    token = (settings.TWILIO_AUTH_TOKEN or "").strip()
    from_num = (from_override or settings.TWILIO_WHATSAPP_NUMBER or settings.TWILIO_PHONE_NUMBER or "").strip()
    if not (sid and token and from_num):
        return {"sent": False, "error": None, "waMeUrl": link, "mode": "wa_me", "note": status["note"]}

    from_wa = from_num if from_num.lower().startswith("whatsapp:") else f"whatsapp:{from_num if from_num.startswith('+') else '+' + digits_only(from_num)}"
    to_wa = f"whatsapp:+{digits}"
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                url,
                auth=(sid, token),
                data={"From": from_wa, "To": to_wa, "Body": body},
            )
        if resp.status_code in (200, 201):
            data = resp.json()
            return {"sent": True, "provider": "twilio", "sid": data.get("sid"), "waMeUrl": link, "mode": "twilio"}
        detail = ""
        try:
            detail = str((resp.json() or {}).get("message") or resp.text)[:240]
        except Exception:
            detail = resp.text[:240]
        logger.warning("Twilio WhatsApp failed: %s %s", resp.status_code, detail)
        return {"sent": False, "error": detail or f"Twilio HTTP {resp.status_code}", "waMeUrl": link, "mode": "wa_me"}
    except Exception as err:
        logger.warning("Twilio WhatsApp error: %s", err)
        return {"sent": False, "error": str(err)[:240], "waMeUrl": link, "mode": "wa_me"}
