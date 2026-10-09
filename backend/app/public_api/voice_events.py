"""Call events for customers' webhooks: call.completed / call.failed (with the answers and outcome) and call.needs_human."""
from __future__ import annotations

import logging
from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import CallBrief, PublicObject
from app.public_api import links

logger = logging.getLogger("public_api.voice_events")


async def dispatch_finished(db: AsyncSession, org: str, event: str, call: Any, legacy: Dict[str, Any]) -> None:
    """Send call.completed / call.failed. The older fields stay; the answers, recording and booking are added.
    Sent once per outcome: a later update that changes the outcome sends again, so match on the call id."""
    from app.services.webhook_dispatcher import dispatch_event

    call_id = str(legacy.get("call_id") or getattr(call, "id", ""))
    brief = await db.get(CallBrief, call_id) if call_id else None
    outcome = str(legacy.get("outcome") or "")
    marker_id = f"callev_{call_id}"
    marker = await db.get(PublicObject, marker_id)
    seen = list((marker.data or {}).get("sent") or []) if marker else []
    key = f"{event}:{outcome}"
    if key in seen:
        return
    if marker is None:
        db.add(PublicObject(id=marker_id, kind="call_events", data={"sent": [key]}))
        await db.flush()
    else:
        marker.data = {"sent": seen + [key]}
    secs = _seconds(legacy.get("duration"))
    payload = dict(legacy)
    payload.update({
        "id": call_id,
        "status": "failed" if event == "call.failed" else "completed",
        "to": getattr(brief, "phone", "") or "",
        "to_name": legacy.get("person") or legacy.get("prospect") or "",
        "duration_seconds": secs,
        "answers": dict(getattr(brief, "captured", None) or {}),
        "meeting_booked": outcome == "meeting_booked" or bool(getattr(call, "booked", False)),
        "notes": getattr(brief, "notes", "") or "",
        "recording_url": f"{links.public_base()}/v1/voice/calls/{call_id}/recording",
    })
    dispatch_event(org, event, payload)


def _seconds(text: Any) -> int:
    from app.public_api.calls_view import parse_seconds

    return parse_seconds(text)


def needs_human(org: str, call_id: str, phone: str, reason: str, name: str) -> None:
    """The assistant asked for a person. The live call page link lets anyone with it listen, guide or take over."""
    from app.services.webhook_dispatcher import dispatch_event

    dispatch_event(org, "call.needs_human", {
        "id": call_id, "status": "in_progress", "to": phone, "to_name": name, "reason": reason,
        "live_url": links.preview_url("call", call_id, org),
    })
