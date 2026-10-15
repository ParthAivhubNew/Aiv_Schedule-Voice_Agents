"""Workflow rules: "when X happens, do Y", built from a short list of events and actions.

A rule lives in the organisation's connection settings. The event bus (services/connections.py) hands every
call, booking, reply and post event here; each enabled rule that matches runs its actions on the lead behind
the event. Actions only use things the user already has (a stage, a list, a note, their own mailbox) and are
skipped, with a line on the timeline, when a plan or a block says no.
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.models import LeadAccount, Notification
from app.services import connection_handlers as H
from app.services import connections as C

logger = logging.getLogger("workflows")

EVENTS: Dict[str, str] = {
    "call.completed": "A call finished",
    "meeting.booked": "A meeting was booked",
    "campaign.reply": "Someone replied to an email",
}
CALL_OUTCOMES = ["meeting_booked", "callback_requested", "contacted", "left_voicemail", "no_answer", "rejected", "wrong_number", "do_not_call"]
REPLY_KINDS = ["interested", "question", "not_interested", "unsubscribe"]
ACTIONS: Dict[str, str] = {
    "set_stage": "Move the lead to a stage",
    "add_to_list": "Add the lead to a list",
    "notify": "Send me a notification",
    "send_email": "Send the lead an email",
    "add_dnc": "Add the lead to the do-not-contact list",
    "add_note": "Add a note to the lead's timeline",
}
STAGES = ["new", "contacted", "interested", "meeting", "won", "lost", "do_not_contact"]
MAX_RULES = 30


def clean_workflow(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A rule in the shape the engine runs, or None when it is not valid."""
    event = str(raw.get("event") or "")
    if event not in EVENTS:
        return None
    when = raw.get("when") or {}
    outcome = str(when.get("outcome") or "")
    if event == "call.completed" and outcome and outcome not in CALL_OUTCOMES:
        return None
    if event == "campaign.reply" and outcome and outcome not in REPLY_KINDS:
        return None
    steps = []
    for d in (raw.get("do") or [])[:5]:
        action = str(d.get("action") or "")
        value = str(d.get("value") or "").strip()[:2000]
        if action not in ACTIONS:
            return None
        if action == "set_stage" and value not in STAGES:
            return None
        if action in ("add_to_list", "notify", "send_email", "add_note") and not value:
            return None
        steps.append({"action": action, "value": value, "subject": str(d.get("subject") or "")[:200]})
    if not steps:
        return None
    return {"id": str(raw.get("id") or f"wf_{uuid.uuid4().hex[:8]}"), "name": str(raw.get("name") or "").strip()[:80] or "Untitled rule",
            "enabled": bool(raw.get("enabled", True)), "event": event, "when": {"outcome": outcome} if outcome else {}, "do": steps}


def matches(rule: Dict[str, Any], event: str, data: Dict[str, Any]) -> bool:
    if not rule.get("enabled") or rule.get("event") != event:
        return False
    want = (rule.get("when") or {}).get("outcome")
    if not want:
        return True
    if event == "call.completed":
        return str(data.get("outcome") or "") == want
    if event == "campaign.reply":
        return str((data.get("reply") or {}).get("category") or "") == want
    return True


def _email_of(event: str, data: Dict[str, Any]) -> str:
    if event == "campaign.reply":
        return str((data.get("reply") or {}).get("email") or "")
    if event == "meeting.booked":
        return str((data.get("meeting") or {}).get("email") or "")
    return ""


async def get_workflows(db: AsyncSession) -> List[Dict[str, Any]]:
    from app.models.models import ConnectionRules

    row = await db.get(ConnectionRules, "default")
    return [w for w in ((row.rules or {}).get("workflows") or []) if isinstance(w, dict)] if row else []


async def save_workflows(db: AsyncSession, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    from app.models.models import ConnectionRules

    clean = [w for w in (clean_workflow(i) for i in items[:MAX_RULES]) if w]
    row = await db.get(ConnectionRules, "default")
    rules = dict(row.rules or {}) if row else {}
    rules["workflows"] = clean
    if row is None:
        db.add(ConnectionRules(id="default", rules=rules))
    else:
        row.rules = rules
    await db.commit()
    return clean


async def run_action(db: AsyncSession, org_id: str, lead: LeadAccount, step: Dict[str, Any], rule: Dict[str, Any]) -> str:
    """One action. Returns a short result for the timeline."""
    action, value = step["action"], step["value"]
    if action == "set_stage":
        lead.stage = value
        return f"stage set to {value.replace('_', ' ')}"
    if action == "add_note":
        await C.record_event(db, "note", lead_id=lead.id, ref_id=f"{rule['id']}:note", summary=H.fill(value, lead)[:500])
        return "note added"
    if action == "notify":
        db.add(Notification(id=f"n_{uuid.uuid4().hex[:8]}", text=H.fill(value, lead)[:300], type="info", time="Just now"))
        return "notification sent"
    if action == "add_dnc":
        await C.add_block(db, phone=lead.phone, email=lead.email, registry_id=lead.registry_id or "", name=lead.name,
                          reason=f"Rule: {rule['name']}", source="manual")
        lead.stage = "do_not_contact"
        return "added to do-not-contact"
    if action == "add_to_list":
        from app.api.lead_lists import put_in_list

        await put_in_list(db, "", value, [lead.id])
        return f"added to {value}"
    if action == "send_email":
        ent = await H.entitled(db, org_id)
        if not ent.get("leads"):
            return "email skipped: needs the Lead Gen plan"
        res = await H.send_lead_email(db, org_id, lead, step.get("subject") or "Following up", H.fill(value, lead), f"rule:{rule['id']}")
        return "email sent" if res.get("status") == "sent" else f"email skipped: {res.get('why') or res.get('reason') or res.get('status')}"
    return "unknown action"


async def on_event(org_id: str, event: str, data: Dict[str, Any]) -> None:
    """The bus handler: run every matching rule on the lead behind the event."""
    async with AsyncSessionLocal() as db:
        rules = [r for r in await get_workflows(db) if matches(r, event, data)]
        if not rules:
            return
        lead = await C.lead_for(db, lead_id=str(data.get("lead_id") or (data.get("meeting") or {}).get("lead_id") or ""), phone=str(data.get("to") or ""), email=_email_of(event, data))
        if lead is None:
            return
        for rule in rules:
            key = f"wf:{rule['id']}:{event}:{data.get('id') or data.get('call_id') or ''}"
            if re.search(r":$", key):
                key += lead.id
            results = []
            for step in rule["do"]:
                try:
                    results.append(await run_action(db, org_id, lead, step, rule))
                except Exception as err:
                    logger.warning(f"[workflow] {rule['name']}: {step['action']} failed: {err}")
                    results.append(f"{step['action']} failed")
            await C.record_event(db, "note", lead_id=lead.id, ref_id=key, summary=f"Rule “{rule['name']}” ran: " + "; ".join(results))
        await db.commit()


async def _handler(org_id: str, event: str, data: Dict[str, Any]) -> None:
    await on_event(org_id, event, data)


def register() -> None:
    for ev in EVENTS:
        C.subscribe(ev, _handler)
