"""Calling Lead Gen companies from Voice: who can be called, what it costs, and starting the calls.

The same plan is used by "Call this list", "Call selected", the map and a single "Call now", so every
entry point skips the same people for the same reasons.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import ContactRegistry, LeadAccount, Mission, Prospect
from app.services import connections as C
from app.services.identity import lead_phone, match_lead_to_registry

logger = logging.getLogger("lead_calls")

SKIP_REASONS = ("no_phone", "failed_check", "do_not_call", "recently_called", "already_queued", "outside_hours")
SKIP_WORDS = {
    "no_phone": "no phone number",
    "failed_check": "the number failed the check",
    "do_not_call": "on the do-not-contact list",
    "recently_called": "contacted recently",
    "already_queued": "already in a running call round",
    "outside_hours": "outside calling hours right now",
}
GATE_LIMIT = 300  # calling hours are checked for this many; beyond it the dial itself still checks


def opening_line(lead: LeadAccount) -> str:
    """A short first line for the AI caller from what research already found. Empty when nothing is known."""
    r = lead.research or {}
    overview = str(r.get("overview") or r.get("summary") or "").strip()
    if not overview:
        return ""
    first = re.split(r"(?<=[.!?])\s", overview, maxsplit=1)[0].strip()
    first = first[:220]
    return f"I read that {lead.name} {first[0].lower() + first[1:]}" if first and not first.lower().startswith(lead.name.lower()) else first


def routing_line(lead: LeadAccount) -> str:
    """Who to ask for. When the company has a named decision maker the caller asks for them first, and if they are not in,
    asks the person who answered when to try again, instead of pitching to whoever picks up."""
    who = (lead.contact_name or "").strip()
    if not who:
        return ""
    title = f" ({lead.contact_title.strip()})" if (lead.contact_title or "").strip() else ""
    return (f"Ask for {who}{title} first. If they are not available, do not pitch to whoever answers: ask when is a good time "
            f"to reach {who.split()[0]} and say you will ring back then.")


def phone_state(lead: LeadAccount) -> str:
    return str(((lead.verification or {}).get("phone") or {}).get("state") or "")


async def registry_snapshot(db: AsyncSession) -> List[Dict[str, Any]]:
    return [
        {"id": r.id, "canonical_name": r.canonical_name, "aliases": r.aliases or [], "phones": r.phones or [],
         "websites": r.websites or [], "do_not_call": bool(r.do_not_call)}
        for r in (await db.execute(select(ContactRegistry))).scalars().all()
    ]


async def busy_lead_ids(db: AsyncSession) -> set:
    """Leads already waiting or on a call in a running mission."""
    rows = (await db.execute(select(Prospect.lead_id).join(Mission, Mission.id == Prospect.mission_id).where(
        Prospect.lead_id.is_not(None), Prospect.status.in_(("queued", "calling")), Mission.status.in_(("active", "paused_credits"))))).scalars().all()
    return {r for r in rows if r}


async def plan_calls(db: AsyncSession, leads: List[LeadAccount], *, override_recontact: bool = False) -> Dict[str, Any]:
    """Sort companies into 'can be called now' and, for the rest, the reason. Also links each company to
    its shared contact record, so a do-not-call set in Voice applies here."""
    rules = await C.get_rules(db)
    registry = await registry_snapshot(db)
    busy = await busy_lead_ids(db)
    from app.services.compliance import check_call_allowed

    callable_ids: List[str] = []
    skipped: Dict[str, List[str]] = {k: [] for k in SKIP_REASONS}
    warnings: Dict[str, str] = {}
    gated = 0
    for a in leads:
        match = match_lead_to_registry(a, registry)
        if match and match.get("registryId") and a.registry_id != match["registryId"]:
            a.registry_id = match["registryId"]
        phone = lead_phone(a)
        blocked = bool(match and match.get("doNotCall")) or a.stage == "do_not_contact"
        if not blocked and phone:
            blocked = bool(await C.block_for(db, phone=phone, email=a.email or "", registry_id=a.registry_id or "", channel="call"))
        if blocked:
            skipped["do_not_call"].append(a.id)
        elif not phone:
            skipped["no_phone"].append(a.id)
        elif phone_state(a) == "invalid":
            skipped["failed_check"].append(a.id)
        elif a.id in busy:
            skipped["already_queued"].append(a.id)
        elif not override_recontact and C.recently_reached(a, int(rules["recontact_days"])):
            skipped["recently_called"].append(a.id)
        else:
            if gated < GATE_LIMIT:
                gated += 1
                gate = await check_call_allowed(db, phone)
                if not gate.allowed and any("opted out" in r for r in gate.reasons):
                    skipped["do_not_call"].append(a.id)
                    continue
                if not gate.allowed:
                    skipped["outside_hours"].append(a.id)
                    continue
                if gate.warnings:
                    warnings[a.id] = gate.warnings[0]
            callable_ids.append(a.id)
    return {"total": len(leads), "callable": callable_ids, "skipped": skipped, "warnings": warnings,
            "recall_days": int(rules["recontact_days"])}


async def cost_preview(db: AsyncSession, calls: int) -> Dict[str, Any]:
    """Voice minutes the round may use against the minutes left. Never raises."""
    out: Dict[str, Any] = {"calls": calls, "wallet": "Voice", "minutes_left": None, "average_minutes": None,
                           "minutes_needed": None, "enough": True}
    try:
        from app.services.credits import average_call_minutes, minutes_left

        left = await minutes_left(db)
        avg = await average_call_minutes(db)
        out.update(minutes_left=left, average_minutes=avg)
        if left is not None and avg:
            need = round(avg * calls, 1)
            out.update(minutes_needed=need, enough=left >= need)
    except Exception as err:
        logger.debug(f"cost preview skipped: {err}")
    return out


def prospect_row(lead: LeadAccount, hooks: Dict[str, str]) -> Dict[str, Any]:
    contact = (lead.contact_name or "").strip()
    return {
        "name": lead.name, "company": lead.name, "contact": contact, "prospect_name": contact or lead.name,
        "phone": lead_phone(lead), "website": lead.website or lead.domain or "", "sector": lead.industry or "General",
        "region": lead.region or "UK-wide", "lead_id": lead.id, "email": lead.email or "",
        "opening_hook": " ".join(x for x in ((hooks.get(lead.id) if hooks.get(lead.id) is not None else opening_line(lead)), routing_line(lead)) if x),
    }


async def start_calls(db: AsyncSession, leads: List[LeadAccount], *, title: str, list_id: Optional[str] = None,
                      hooks: Optional[Dict[str, str]] = None, from_number: Optional[str] = None,
                      concurrency: int = 2) -> Dict[str, Any]:
    from app.services.outbound_dial import launch_outbound_mission, resolve_from_number

    # A missing caller ID is found out now, before anything is queued, so a failed start leaves nothing behind.
    await resolve_from_number(db, from_number)
    rows = [prospect_row(a, hooks or {}) for a in leads]
    result = await launch_outbound_mission(db, title=title, prospects=rows, concurrency=concurrency, from_number=from_number,
                                           source="leadgen", lead_list_id=list_id)
    for a in leads:
        await C.record_event(db, "call", lead_id=a.id, registry_id=a.registry_id or "", ref_id=f"queued:{result.get('mission_id', title)}:{a.id}",
                             summary=f"Queued for a call in {title}")
    await db.commit()
    return result
