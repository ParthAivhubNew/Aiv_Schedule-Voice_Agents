"""Tell a partner's webhook that a connected account needs its user to sign in again.

Only the first time it happens (the caller checks that the state just changed), so a broken login does not send an event
every hour. Never raises: a webhook problem must not break the job that noticed the broken login.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

logger = logging.getLogger("reconnect_events")


def reconnect_needed(event: str, org_id: str, data: Dict[str, Any]) -> None:
    partner_event(event, org_id, data)


def partner_event(event: str, org_id: str, data: Dict[str, Any]) -> None:
    """Send an event to the partner webhook registered for this organisation. Never raises."""
    if not org_id:
        return
    try:
        from app.services.webhook_dispatcher import dispatch_event

        dispatch_event(org_id, event, {**data, "org_id": org_id})
    except Exception as err:
        logger.debug(f"[reconnect] {event} not sent: {err}")
