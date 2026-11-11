"""The one next step for a company, in plain words. Pure: the caller passes in what it already knows."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, Optional

WAIT_DAYS = 14
_DONE_STAGES = ("won", "lost", "do_not_contact")


def _when(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None
    return None


def decide(f: Dict[str, Any], now: Optional[datetime] = None) -> Dict[str, str]:
    """f: closed (bool), status, verdict, stage, open_picks (int), last_contact_at, email_ok, has_email, has_phone, director."""
    now = now or datetime.utcnow()
    status = str(f.get("status") or "").lower()
    if f.get("closed") or str(f.get("verdict") or "") == "problem" or any(w in status for w in ("liquidation", "dissolved", "administration", "receiver")):
        return {"key": "skip", "label": "Leave this one out", "why": "It is closed or closing, or a check found a problem."}
    if str(f.get("stage") or "") in _DONE_STAGES:
        return {"key": "none", "label": "", "why": "This one is finished."}
    if int(f.get("open_picks") or 0) > 0:
        return {"key": "choose", "label": "Choose the right phone or email", "why": "We found more than one answer and need you to pick."}
    last = _when(f.get("last_contact_at"))
    if last and now - last < timedelta(days=WAIT_DAYS):
        return {"key": "wait", "label": "Wait for a reply", "why": "You were in touch in the last two weeks."}
    if f.get("email_ok"):
        return {"key": "email", "label": "Add to a campaign", "why": "There is an email we can write to."}
    if f.get("has_phone"):
        who = str(f.get("director") or "").strip() or "them"
        return {"key": "call", "label": f"Call {who}", "why": "There is a phone number and no email to write to."}
    return {"key": "find", "label": "Find a contact", "why": "We have no phone or email for this one yet."}
