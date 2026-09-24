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
    meta_token = (settings.WHATSAPP_CLOUD_ACCESS_TOKEN or "").strip()
    meta_phone_id = (settings.WHATSAPP_CLOUD_PHONE_NUMBER_ID or "").strip()
    if meta_token and meta_phone_id:
        return {
            "configured": True,
            "fromMasked": f"Meta Phone ID: {meta_phone_id[:6]}••••",
            "mode": "meta_cloud",
            "note": "Meta WhatsApp Cloud API is live. Sends directly from your Facebook Developer WhatsApp number.",
        }

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
            else "No active WhatsApp Cloud API or Twilio sender. Deep links open WhatsApp with ready-to-send messages."
        ),
    }


async def send_whatsapp(to: str, body: str, from_override: Optional[str] = None) -> Dict[str, Any]:
    link = wa_me_url(to, body)
    status = whatsapp_ready()
    digits = digits_only(to)
    if not digits:
        return {"sent": False, "error": "Need a WhatsApp number.", "waMeUrl": "", "mode": status["mode"]}

    # 1. Try Meta WhatsApp Cloud API if configured (e.g. from Facebook Developers)
    meta_token = (settings.WHATSAPP_CLOUD_ACCESS_TOKEN or "").strip()
    meta_phone_id = (settings.WHATSAPP_CLOUD_PHONE_NUMBER_ID or "").strip()
    if meta_token and meta_phone_id:
        meta_url = f"https://graph.facebook.com/v20.0/{meta_phone_id}/messages"
        headers = {
            "Authorization": f"Bearer {meta_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": digits,
            "type": "text",
            "text": {"preview_url": False, "body": body}
        }
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(meta_url, headers=headers, json=payload)
            if resp.status_code in (200, 201):
                data = resp.json()
                msg_id = (data.get("messages") or [{}])[0].get("id")
                return {"sent": True, "provider": "meta_cloud", "messageId": msg_id, "waMeUrl": link, "mode": "meta_cloud"}
            detail = resp.text[:240]
            logger.warning("Meta WhatsApp Cloud API failed: %s %s", resp.status_code, detail)
            # If rejected because 24h conversation window is closed or template is required:
            if "131047" in detail or "template" in detail.lower():
                tpl_payload = {
                    "messaging_product": "whatsapp",
                    "to": digits,
                    "type": "template",
                    "template": {
                        "name": "hello_world",
                        "language": {"code": "en_US"}
                    }
                }
                async with httpx.AsyncClient(timeout=20.0) as client:
                    tpl_resp = await client.post(meta_url, headers=headers, json=tpl_payload)
                if tpl_resp.status_code in (200, 201):
                    tpl_data = tpl_resp.json()
                    msg_id = (tpl_data.get("messages") or [{}])[0].get("id")
                    return {"sent": True, "provider": "meta_cloud", "messageId": msg_id, "waMeUrl": link, "mode": "meta_cloud", "note": "Delivered via template"}
        except Exception as err:
            logger.warning("Meta WhatsApp Cloud API error: %s", err)

    # 2. Try Twilio WhatsApp if configured
    sid = (settings.TWILIO_ACCOUNT_SID or "").strip()
    token = (settings.TWILIO_AUTH_TOKEN or "").strip()
    from_num = (from_override or settings.TWILIO_WHATSAPP_NUMBER or settings.TWILIO_PHONE_NUMBER or "").strip()
    if sid and token and from_num:
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
        except Exception as err:
            logger.warning("Twilio WhatsApp error: %s", err)

    # 3. Fallback to direct wa.me link
    return {"sent": False, "error": None, "waMeUrl": link, "mode": "wa_me", "note": status["note"]}
