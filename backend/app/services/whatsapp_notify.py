"""Meeting confirmations on WhatsApp. WhatsApp runs only through Telnyx, from the company's own
number with WhatsApp turned on (Subscription → Numbers). When that is not possible we return a
wa.me link instead, so a person can send the message from their own phone."""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from sqlalchemy.future import select

logger = logging.getLogger("whatsapp_notify")

TURN_ON = "Turn on WhatsApp for one of your numbers in Subscription → Numbers to send from OutReach."


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


async def _our_number(db) -> str:
    from app.services.whatsapp import whatsapp_numbers

    nums = await whatsapp_numbers(db)
    nums.sort(key=lambda n: (not n.is_default, n.e164))
    return nums[0].e164 if nums else ""


async def whatsapp_ready(db) -> Dict[str, Any]:
    our = await _our_number(db)
    if our:
        return {"configured": True, "fromMasked": our, "mode": "telnyx",
                "note": f"Sends from your WhatsApp number {our}."}
    return {"configured": False, "fromMasked": "", "mode": "wa_me",
            "note": "Opens WhatsApp with the message ready to send. " + TURN_ON}


async def _approved_confirmation(db, our: str) -> bool:
    from app.models.models import WhatsappSignup
    from app.services.whatsapp_signup import CONFIRMATION

    s = (await db.execute(select(WhatsappSignup).where(WhatsappSignup.e164 == our))).scalars().first()
    return bool(s and (s.templates or {}).get(CONFIRMATION) == "APPROVED")


async def send_whatsapp(db, to: str, body: str, sender_name: str = "",
                        template_params: Optional[List[str]] = None) -> Dict[str, Any]:
    """Send from the company's own WhatsApp number: free text when the contact wrote in the last
    24 hours, else our approved meeting-confirmation template (when template_params are given).
    Otherwise return a wa.me link. Commits."""
    from app.services import whatsapp as WA
    from app.services.whatsapp_signup import CONFIRMATION

    link = wa_me_url(to, body)
    digits = digits_only(to)
    if not digits:
        return {"sent": False, "error": "Need a WhatsApp number.", "waMeUrl": "", "mode": "wa_me"}
    our = await _our_number(db)
    if not our:
        return {"sent": False, "error": None, "waMeUrl": link, "mode": "wa_me", "note": TURN_ON}

    thread = await WA.get_or_create_thread(db, our, "+" + digits)
    if WA.window_open(thread):
        msg = await WA.send(db, thread, text=body, sender="human", sender_name=sender_name)
    elif template_params and await _approved_confirmation(db, our):
        msg = await WA.send(db, thread, template={"name": CONFIRMATION, "language": "en_GB", "params": template_params},
                            sender="human", sender_name=sender_name)
    else:
        await db.commit()
        return {"sent": False, "error": None, "waMeUrl": link, "mode": "wa_me",
                "note": "WhatsApp only lets a business write first with an approved template. Start the conversation from the WhatsApp inbox."}
    await db.commit()
    if msg.status == "failed":
        logger.warning(f"[whatsapp] confirmation not sent: {msg.error}")
        return {"sent": False, "error": msg.error or "WhatsApp did not accept the message.", "waMeUrl": link, "mode": "telnyx"}
    return {"sent": True, "provider": "telnyx", "messageId": msg.telnyx_message_id, "waMeUrl": link, "mode": "telnyx"}
