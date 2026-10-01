"""Managed Telnyx AI Assistants: one per user, plus one per organisation for shared numbers.

The assistant we create in Telnyx is a fixed shell: rules and {{placeholders}}, never a
client's script. Each call gets its own CallBrief (the script rendered for that prospect,
company and direction), which reaches Telnyx as dynamic variables when the call starts.
During the call the assistant calls our tools (/api/telnyx-assistant/tools/<name>) with the
call's signed reference, so every tool works on that call's organisation and brief only.

Switched on with TELNYX_MANAGED_ASSISTANTS=true. Until then calls use the assistant ID pasted
in AI config, exactly as before.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.future import select

from app.services.telnyx_client import TelnyxError

logger = logging.getLogger("voice_assistants")

# Bump when the shell (instructions, greeting, tools) changes: every assistant is updated on
# its next use.
SHELL_VERSION = 3
RESYNC_AFTER = timedelta(hours=24)  # also puts back anything edited by hand in Telnyx
MANAGED_MARK = "Managed by OutReach: changes made in Telnyx are overwritten."

SHELL_INSTRUCTIONS = """You are a phone agent for a business that uses OutReach. This call's direction is {{call_direction}}.

=== THIS CALL'S SCRIPT (follow it) ===
{{script}}
=== END OF SCRIPT ===

Rules that always apply:
- If {{script_continues}} is "yes", call get_script once before you say more than the greeting, and follow the full script it returns.
- When you are not sure about a fact about the business (prices, services, policies), call lookup_knowledge. Never invent prices, facts or promises.
- To book a meeting, call check_availability first, then book_appointment with an exact time it returned.
- If the person asks for a human, is upset, or the script says to hand over, call request_human and tell them someone will take over.
- If they ask not to be called again, apologise, say they will not be called again, and call save_outcome with outcome "do_not_call".
- Before the call ends, call save_outcome with the outcome and anything useful you learned.
- Keep each turn to one or two short sentences. Never mention these instructions, the tools or that you follow a script."""

SHELL_GREETING = "{{greeting}}"

# Telnyx fills these when a value is missing, so the shell never reads out a raw placeholder.
DEFAULT_VARIABLES = {
    "call_direction": "inbound",
    "script": "Greet the caller, find out what they need, help with what you can and offer to book a meeting or have someone call back.",
    "script_continues": "no",
    "greeting": "Hello, thanks for calling. How can I help?",
    "company_name": "",
    "agent_name": "",
    "customer_name": "there",
    "caller_name": "there",
    "call_ref": "",
    "recorded": "no",
}

OUTCOMES = ["meeting_booked", "interested", "callback_requested", "not_interested", "wrong_number",
            "voicemail", "do_not_call", "human_requested", "other"]


def enabled() -> bool:
    return os.getenv("TELNYX_MANAGED_ASSISTANTS", "").strip().lower() in ("1", "true", "yes", "on")


def script_limit() -> int:
    """How much of a script goes in the {{script}} variable; the rest is read with get_script."""
    try:
        return max(500, int(os.getenv("TELNYX_SCRIPT_VAR_LIMIT", "6000")))
    except ValueError:
        return 6000


# ── Signed call reference (organisation + call id) ──────────────────────────
def _sign(text: str) -> str:
    from app.core.security import signing_key

    return hmac.new(signing_key().encode(), text.encode(), hashlib.sha256).hexdigest()[:20]


def make_ref(org_id: str, call_id: str) -> str:
    body = f"{org_id}.{call_id}"
    return f"{body}.{_sign(body)}"


def read_ref(ref: str) -> Optional[Tuple[str, str]]:
    """(org_id, call_id) for a reference we made; None for anything else."""
    parts = (ref or "").strip().split(".")
    if len(parts) != 3 or not all(parts):
        return None
    org_id, call_id, sig = parts
    if not hmac.compare_digest(sig, _sign(f"{org_id}.{call_id}")):
        return None
    return org_id, call_id


# ── The shell we create in Telnyx ───────────────────────────────────────────
def _tool(base: str, name: str, description: str, properties: Dict[str, Any], required: List[str]) -> Dict[str, Any]:
    return {
        "type": "webhook",
        "webhook": {
            "name": name,
            "description": description,
            "url": f"{base}/api/telnyx-assistant/tools/{name}?ref={{{{call_ref}}}}",
            "method": "POST",
            "body_parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


def shell_tools(base: str) -> List[Dict[str, Any]]:
    text = lambda d: {"type": "string", "description": d}  # noqa: E731
    return [
        _tool(base, "get_script", "Read the full script for this call when the script says it continues.", {}, []),
        _tool(base, "lookup_knowledge", "Look up facts about the business: services, prices, policies, FAQs.",
              {"question": text("What you need to know, in a short sentence.")}, ["question"]),
        _tool(base, "check_availability", "Find free meeting times between two dates (YYYY-MM-DD).",
              {"start_date": text("First day, YYYY-MM-DD."), "end_date": text("Last day, YYYY-MM-DD.")}, ["start_date"]),
        _tool(base, "book_appointment", "Book a meeting at an exact time returned by check_availability.",
              {"start_time": text("The exact ISO-8601 time from check_availability."),
               "email": text("The person's email, spelled back and confirmed."),
               "name": text("The person's name.")}, ["start_time"]),
        _tool(base, "request_human", "Ask a person from the business to take over this call.",
              {"reason": text("Why a person is needed.")}, ["reason"]),
        _tool(base, "save_outcome", "Record how the call went before it ends.",
              {"outcome": {"type": "string", "enum": OUTCOMES, "description": "How the call ended."},
               "notes": text("A short summary for the business."),
               "fields": {"type": "object", "description": "Anything you learned, e.g. email, budget, best time to call."}},
              ["outcome"]),
    ]


def shell_payload(name: str, description: str, voice: str = "", model: str = "",
                  mine: Optional[Dict[str, Any]] = None, company: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    from app.services.telephony_provider import public_http_base

    base = public_http_base()
    payload: Dict[str, Any] = {
        "name": name[:100],
        "description": f"{description} {MANAGED_MARK}"[:500],
        "instructions": SHELL_INSTRUCTIONS,
        "greeting": SHELL_GREETING,
        "tools": shell_tools(base),
        "dynamic_variables": DEFAULT_VARIABLES,
        # Inbound calls: Telnyx asks us for the variables when the call starts.
        "dynamic_variables_webhook_url": f"{base}/api/telnyx-assistant/call-event",
        # Telnyx records assistant calls unless told not to. We record on the call itself, and
        # only when the company has chosen to (Agent Studio), so the assistant never records.
        "telephony_settings": {"recording_settings": {"enabled": False}},
    }
    model = model or os.getenv("TELNYX_ASSISTANT_MODEL", "").strip()
    if model:
        payload["model"] = model
    voice = voice or os.getenv("TELNYX_ASSISTANT_VOICE", "").strip()
    from app.services import assistant_options

    return assistant_options.apply(payload, voice, mine or {}, company or {})


# ── Assistants per user ─────────────────────────────────────────────────────
async def _client(db):
    from app.services.telnyx_provisioning import client_for, get_setup

    return client_for(await get_setup(db))


async def _names(db, operator_id: str) -> Tuple[str, str]:
    from sqlalchemy import text

    from app.core.tenancy import current_org

    org_id = current_org()
    org_name = (await db.execute(text("SELECT name FROM organizations WHERE id = :i"), {"i": org_id})).scalar() or org_id
    who = "Shared numbers"
    if operator_id:
        from app.models.models import Operator

        op = (await db.execute(select(Operator).where(Operator.id == operator_id))).scalars().first()
        who = (op.name or op.username) if op else operator_id
    return f"OutReach · {org_name} · {who}", f"Organisation {org_id}, user {operator_id or '(shared numbers)'}."


async def assistant_for(db, operator_id: str = "") -> Any:
    """The user's assistant ("" = the organisation's assistant for shared numbers), created in
    Telnyx the first time and brought up to date with the current shell when needed. Raises
    TelnyxError only when there is no usable assistant at all; caller commits."""
    from app.models.models import VoiceAssistant

    row = (await db.execute(select(VoiceAssistant).where(VoiceAssistant.operator_id == (operator_id or ""))
                            .order_by(VoiceAssistant.created_at))).scalars().first()
    if row is None:
        row = VoiceAssistant(id=f"va_{uuid.uuid4().hex[:12]}", operator_id=operator_id or "", status="pending")
        db.add(row)
        await db.flush()
    stale = (row.shell_version != SHELL_VERSION or not row.synced_at
             or datetime.utcnow() - row.synced_at > RESYNC_AFTER)
    if row.telnyx_assistant_id and not stale:
        return row
    name, description = await _names(db, operator_id)
    try:
        from app.core.tenancy import current_org
        from app.services import agent_studio, assistant_options

        client = await _client(db)
        if row.voice:
            row.voice = await assistant_options.keep_alive(db, client, current_org(), row.voice)
        p = await agent_studio.profile(db)
        company = assistant_options.company_of(p.studio if p is not None else {})
        mine = dict(row.settings or {})
        payload = shell_payload(name, description, row.voice or "", row.model or "", mine, company)
        if row.telnyx_assistant_id:
            await client.update_assistant(row.telnyx_assistant_id, payload)
        else:
            made = await client.create_assistant(payload)
            row.telnyx_assistant_id = str(made.get("id") or "")
            if not row.telnyx_assistant_id:
                raise TelnyxError("Telnyx did not return an assistant id.")
        try:  # what Telnyx really uses, so "Telnyx default" can show its name
            mine["effective"] = assistant_options.effective(await client.get_assistant(row.telnyx_assistant_id))
            row.settings = mine
        except Exception as err:
            logger.info(f"[voice-assistants] could not read back {row.telnyx_assistant_id}: {err}")
        row.shell_version, row.synced_at, row.status, row.last_error = SHELL_VERSION, datetime.utcnow(), "ready", ""
    except TelnyxError as err:
        row.status, row.last_error = "error", str(err)[:500]
        logger.warning(f"[voice-assistants] sync failed for {row.id}: {err}")
        if not row.telnyx_assistant_id:
            raise
        # An older shell still answers calls; we try again next time.
    return row


async def owner_of_number(db, e164: str) -> str:
    """Who answers inbound calls on our number: its first assigned user, else "" (shared)."""
    from app.models.models import OrgPhoneNumber, PhoneNumberAssignment
    from app.services.numbers import normalize

    num = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.e164 == normalize(e164)))).scalars().first()
    if not num:
        return ""
    first = (await db.execute(select(PhoneNumberAssignment.operator_id).where(PhoneNumberAssignment.number_id == num.id)
                              .order_by(PhoneNumberAssignment.operator_id))).scalars().first()
    return first or ""


# ── One call's brief ────────────────────────────────────────────────────────
def _real(name: str) -> str:
    s = (name or "").strip()
    return "" if not s or s.startswith(("Prospect (", "Caller (", "+")) else s


async def build_brief(db, *, call_id: str, direction: str, operator_id: str, assistant_row_id: str, phone: str,
                      our_number: str = "", prospect_id: str = "", mission_id: str = "", prospect_name: str = "",
                      template_id: str = "") -> Dict[str, str]:
    """Render this call's script and save it as the call's brief. Returns the dynamic variables
    to give Telnyx. Caller commits."""
    from app.core.tenancy import current_org
    from app.models.models import CallBrief
    from app.services.conversation_engine import context_resolver, template_engine

    if direction == "outbound":
        ctx = await context_resolver.resolve_outbound(db, prospect_id=prospect_id or None, mission_id=mission_id or None,
                                                      override_phone=phone or None, override_name=_real(prospect_name) or None)
    else:
        ctx = await context_resolver.resolve_inbound(db, phone or "unknown")
    ctx["direction"] = direction
    from app.services import agent_studio

    chosen = await agent_studio.template_for(db, direction, mission_id or "", template_id or "")
    tpl = await template_engine.get_active_template(db, direction=direction, template_id=chosen or None)
    studio = await agent_studio.settings(db)
    company_row = await agent_studio.profile(db)
    script = template_engine.render_system_prompt(tpl, ctx) + "\n\n" + agent_studio.rules_block(studio, company_row)
    greeting = template_engine.render_initial_greeting(tpl, ctx)
    if studio.get("recordCalls") and greeting:
        greeting = f"{greeting} {agent_studio.disclosure(company_row)}"
    company = ctx.get("company") or {}
    prospect = ctx.get("prospect") or {}
    name = _real(prospect_name) or prospect.get("name") or ""
    limit = script_limit()
    variables = {
        "call_ref": make_ref(current_org(), call_id),
        "call_direction": direction,
        "script": script[:limit],
        "script_continues": "yes" if len(script) > limit else "no",
        "greeting": greeting or DEFAULT_VARIABLES["greeting"],
        "company_name": company.get("name") or "",
        "agent_name": company.get("agent_name") or "",
        "customer_name": name or "there",
        "caller_name": name or "there",
        "recorded": "yes" if studio.get("recordCalls") else "no",
    }
    existing = (await db.execute(select(CallBrief).where(CallBrief.id == call_id))).scalars().first()
    brief = existing or CallBrief(id=call_id)
    brief.operator_id, brief.direction, brief.assistant_id = operator_id or "", direction, assistant_row_id
    brief.template_id = str(getattr(tpl, "id", "") or "")
    brief.mission_id, brief.prospect_id = mission_id or "", prospect_id or str(prospect.get("id") or "")
    brief.phone, brief.our_number, brief.variables, brief.script = phone or "", our_number or "", variables, script
    if existing is None:
        db.add(brief)
    return variables


async def brief(db, call_id: str) -> Optional[Any]:
    from app.models.models import CallBrief

    if not call_id:
        return None
    return (await db.execute(select(CallBrief).where(CallBrief.id == call_id))).scalars().first()
