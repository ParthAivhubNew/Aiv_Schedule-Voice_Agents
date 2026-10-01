"""Calls coming in on one of an organisation's numbers, answered by a managed assistant.

The number's Call Control app sends call.initiated here. We pick who answers (the user the
number is assigned to, else the organisation's assistant for shared numbers), render their
inbound script into the call's brief, and answer with our marker; call.answered then starts
the assistant with that brief, the same way as calls we dial.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Dict

from sqlalchemy.future import select

from app.database import AsyncSessionLocal

logger = logging.getLogger("voice_inbound")


async def handle_incoming(body: Dict[str, Any]) -> Dict[str, Any]:
    from app.core.tenancy import current_org
    from app.models.models import LiveCall, OrgPhoneNumber
    from app.services import voice_assistants as VA
    from app.services.numbers import normalize
    from app.services.telephony_provider import public_http_base
    from app.services.telnyx_assistant_calls import CARRIER_TAG, encode_client_state, register_outbound
    from app.websockets.call_hub import call_hub

    envelope = body.get("data") if isinstance(body.get("data"), dict) else {}
    event_type = str(envelope.get("event_type") or "")
    payload = envelope.get("payload") if isinstance(envelope.get("payload"), dict) else {}
    if event_type != "call.initiated" or str(payload.get("direction") or "") != "incoming":
        return {"status": "ignored", "reason": "not an incoming call"}
    if not VA.enabled():
        return {"status": "ignored", "reason": "managed assistants are off"}
    ccid = str(payload.get("call_control_id") or "")
    caller, ours = str(payload.get("from") or ""), str(payload.get("to") or "")
    if not ccid or not ours:
        return {"status": "ignored", "reason": "incomplete event"}

    async with AsyncSessionLocal() as db:
        number = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.e164 == normalize(ours),
                                                               OrgPhoneNumber.status == "active"))).scalars().first()
        if number is None:  # not a number of this organisation: leave the call alone
            return {"status": "ignored", "reason": "unknown number"}
        call_id = f"call_{uuid.uuid4().hex[:8]}"
        # Prepaid: with no minutes left the number does not answer (the caller hears busy);
        # otherwise the call holds the minutes left and is hung up when they run out.
        from app.services.credits import reserve_call

        allowed, why, time_limit = await reserve_call(db, call_id)
        if not allowed:
            await db.commit()
            client = await VA._client(db)
            try:
                await client._req("POST", f"/calls/{ccid}/actions/reject", json={"cause": "USER_BUSY"})
            except Exception as err:
                logger.warning(f"[inbound] could not refuse {ccid}: {err}")
            logger.info(f"[inbound] {number.e164}: not answered, out of call minutes")
            return {"status": "refused", "reason": why}
        await db.commit()
        owner = await VA.owner_of_number(db, ours)
        assistant = await VA.assistant_for(db, owner)
        label = f"Caller ({caller[-4:]})" if caller else "Caller"
        variables = await VA.build_brief(db, call_id=call_id, direction="inbound", operator_id=owner,
                                         assistant_row_id=assistant.id, phone=caller, our_number=number.e164)
        if variables.get("customer_name") not in ("", "there"):
            label = variables["customer_name"]
        db.add(LiveCall(id=call_id, carrier_sid=ccid, mission_id="m_inbound", prospect=label, mission="Inbound call",
                        state="calling", carrier=CARRIER_TAG, channel="voice", duration="00:00",
                        transcript=[f"System: Incoming call from {caller or 'unknown'} on {number.e164}."]))
        await db.commit()
        client = await VA._client(db)

    try:
        await client.answer_call(ccid, client_state=encode_client_state(assistant.telnyx_assistant_id, call_id, current_org()),
                                 webhook_url=f"{public_http_base()}/api/telnyx-assistant/call-control",
                                 record=variables.get("recorded") == "yes")
    except Exception:
        from app.services.credits import CALL_HOLD, release

        async with AsyncSessionLocal() as db:
            rec = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
            if rec:
                rec.state, rec.ended = "failed", True
            await release(db, [f"{CALL_HOLD}{call_id}"])
            await db.commit()
        raise
    if time_limit:
        from app.services.call_limits import watch

        watch(ccid, time_limit, client.api_key, hang_up=True, assistant=True)
    register_outbound(ccid, call_id=call_id, to_number=caller, prospect=label, assistant_id=assistant.telnyx_assistant_id)
    await call_hub.broadcast("call_started", {"callId": call_id, "id": call_id, "prospect": label, "state": "calling",
                                              "duration": "00:00", "mission": "Inbound call", "channel": "voice", "ended": False})
    return {"status": "answered", "callId": call_id}
