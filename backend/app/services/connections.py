"""How the three plugins (Lead Gen, Voice, Social) work together.

One place for: which links this organisation can use, the switches in Settings -> Connections,
the one do-not-contact list, the per-contact timeline, how a call changes a lead's stage, and the
small in-process event bus that lets one plugin react to another without importing it.
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import ConnectionRules, ContactEvent, DoNotContact, LeadAccount
from app.services.identity import normalize_phone_digits

logger = logging.getLogger("connections")

PLUGINS = ("leads", "voice", "social")
PLUGIN_LABEL = {"leads": "Lead Gen", "voice": "Voice", "social": "Social"}

# ── Settings -> Connections ─────────────────────────────────────────────────
DEFAULT_RULES: Dict[str, Any] = {
    "recontact_days": 14,             # a company reached in this many days is held back from a new round
    "update_lead_after_call": True,    # VL-1: a call changes the lead's stage and last contact
    "auto_apply_suggestions": False,   # VL-3: facts found on a call are applied without asking
    "interested_email": False,         # VL-5: "interested" starts a follow-up email
    "interested_template": "",
    "no_answer_email": False,          # VL-6: after N no-answers, a short "sorry I missed you"
    "no_answer_after": 2,
    "stop_on_booking": True,           # LC-2: a booking stops the rest of the sequence and planned calls
    "booking_confirmation": True,      # LC-4
    "booking_reminders": True,         # LC-4: 24 h and 1 h before
    "no_show_email": False,            # LC-6
    "warm_lead_prompt": True,          # LV-11
    "warm_opens": 3,
    "reminder_call": False,            # VC-2
    "no_show_call": False,             # VC-3
    "weekly_summary": False,           # X-16
}
RULE_TYPES: Dict[str, type] = {k: type(v) for k, v in DEFAULT_RULES.items()}


def clean_rules(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Only known switches, each coerced to its own type, numbers kept in a sensible range."""
    out: Dict[str, Any] = {}
    for key, default in DEFAULT_RULES.items():
        if key not in (raw or {}):
            continue
        val = raw[key]
        if isinstance(default, bool):
            out[key] = bool(val)
        elif isinstance(default, int):
            try:
                out[key] = max(0, min(365, int(val)))
            except (TypeError, ValueError):
                continue
        else:
            out[key] = str(val or "")[:200]
    return out


async def get_rules(db: AsyncSession) -> Dict[str, Any]:
    row = await db.get(ConnectionRules, "default")
    return {**DEFAULT_RULES, **clean_rules(dict(row.rules or {}) if row else {})}


async def save_rules(db: AsyncSession, changes: Dict[str, Any]) -> Dict[str, Any]:
    row = await db.get(ConnectionRules, "default")
    merged = {**clean_rules(dict(row.rules or {}) if row else {}), **clean_rules(changes)}
    if row is None:
        db.add(ConnectionRules(id="default", rules=merged))
    else:
        row.rules = merged
    await db.commit()
    return {**DEFAULT_RULES, **merged}


# ── Which links a plan combination allows ───────────────────────────────────
# Every cross-plugin feature names the plugins it needs. The calendar belongs to Voice.
LINKS: Dict[str, Tuple[str, ...]] = {
    "call_leads": ("leads", "voice"),          # LV-1..5, 7..10
    "call_step": ("leads", "voice"),           # LV-6
    "lead_call_results": ("leads", "voice"),   # VL-1..4, 9, 11
    "booking_in_email": ("leads", "voice"),    # LC-1..7
    "calendar_on_lead": ("leads", "voice"),
    "social_audience": ("social", "leads"),    # SL-1..6
    "post_to_list": ("social", "leads"),
    "comment_to_call": ("social", "leads", "voice"),  # SV-1
    "post_booking_link": ("social", "voice"),  # SV-3
    "event_post": ("social", "voice"),         # SV-4
    "objections_to_posts": ("social", "voice"),  # SV-2, SV-5
    "pipeline": (),                            # any plugin
    "contacts": (),
}


def can_use(entitled: Dict[str, bool], link: str) -> Tuple[bool, str, List[str]]:
    """(available, reason, plugins still needed) for one link, given {"voice","leads","social"} booleans."""
    needs = LINKS.get(link)
    if needs is None:
        return False, "Unknown connection.", []
    if not needs:
        ok = any(entitled.get(p) for p in PLUGINS)
        return ok, "" if ok else "Add a plugin to use this.", [] if ok else list(PLUGINS)
    missing = [p for p in needs if not entitled.get(p)]
    if not missing:
        return True, "", []
    names = " and ".join(PLUGIN_LABEL[p] for p in missing)
    return False, f"Add {names} to use this.", missing


async def availability(db: AsyncSession, org_id: str) -> Dict[str, Any]:
    from app.services.entitlement import get_org_entitlements

    ent = await get_org_entitlements(db, org_id)
    links = {}
    for link in LINKS:
        ok, why, missing = can_use(ent, link)
        links[link] = {"available": ok, "reason": why, "missing": missing}
    return {"plugins": ent, "links": links}


# ── Lead stage ──────────────────────────────────────────────────────────────
STAGE_ORDER = ["new", "contacted", "interested", "meeting", "won"]
FINAL_STAGES = {"won", "lost", "do_not_contact"}
OUTCOME_STAGE = {
    "interested": "interested",
    "meeting_booked": "meeting",
    "callback_requested": "interested",
    "contacted": "contacted",
    "left_voicemail": "contacted",
    "operator_ended": "contacted",
    "no_answer": "contacted",
    "busy": "contacted",
    "rejected": "lost",
    "wrong_number": None,    # does not change the stage: the number was wrong, not the company
    "do_not_call": "do_not_contact",
    "failed": None,          # the call never connected
    "canceled": None,
}
OUTCOME_WORD = {
    "interested": "Interested",
    "meeting_booked": "Meeting booked", "callback_requested": "Callback requested", "contacted": "Spoke to them",
    "left_voicemail": "Left a voicemail", "operator_ended": "Call ended by a person", "no_answer": "No answer",
    "busy": "Busy", "rejected": "Not interested", "wrong_number": "Wrong number", "do_not_call": "Asked not to be called",
    "failed": "Call did not connect", "canceled": "Call cancelled",
}


def stage_for_outcome(current: str, outcome: str) -> str:
    """The stage after a call. A stage never goes backwards, and a final one stays unless the call is a new yes."""
    current = current or "new"
    target = OUTCOME_STAGE.get(outcome)
    if target is None:
        return current
    if target in ("lost", "do_not_contact"):
        return current if current in ("won", "meeting") and target == "lost" else target
    if current in FINAL_STAGES:
        return current
    if current in STAGE_ORDER and target in STAGE_ORDER and STAGE_ORDER.index(target) < STAGE_ORDER.index(current):
        return current
    return target


# ── What the words of a call tell us ────────────────────────────────────────
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")
_WRONG = re.compile(r"\b(wrong number|you've got the wrong|you have the wrong|no one (?:here )?by that name|nobody (?:here )?by that name|not their number|number'?s? (?:not|no longer) (?:in use|working))\b", re.I)
_DNC = re.compile(r"\b(take me off|remove me from|stop calling|do not call|don'?t call (?:me )?again|never call|do not contact|don'?t contact me)\b", re.I)
_ASK_FOR = re.compile(r"\b(?i:speak|talk) to ([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b|\b(?i:ask for|it'?s|this is|my name is) ([A-Z][a-z]+ [A-Z][a-z]+)\b")
_BEST = re.compile(r"\b(?:best|better|good) time (?:is|would be|to call(?: is)?)?\s*([^.,;]{3,40})", re.I)
_BAD_EMAIL_PREFIX = ("noreply", "no-reply", "donotreply")


def their_lines(transcript: List[Any]) -> List[str]:
    out = []
    for t in transcript or []:
        if isinstance(t, dict) and t.get("who") == "them":
            out.append(str(t.get("text") or ""))
        elif isinstance(t, str) and (t.startswith("Prospect:") or t.startswith("Them:")):
            out.append(t.split(":", 1)[1].strip())
    return out


def detect_signals(transcript: List[Any]) -> Dict[str, Any]:
    """Plain-language signals in what the other person said: wrong number, a do-not-call request,
    an email they gave, a person to ask for, a better time. Never guesses beyond the words."""
    lines = their_lines(transcript)
    blob = " ".join(lines)
    sig: Dict[str, Any] = {"wrong_number": bool(_WRONG.search(blob)), "do_not_call": bool(_DNC.search(blob))}
    emails = [e.lower() for e in _EMAIL.findall(blob) if not e.lower().startswith(_BAD_EMAIL_PREFIX)]
    if emails:
        sig["email"] = emails[0]
    m = _ASK_FOR.search(blob)
    if m:
        sig["contact_name"] = (m.group(1) or m.group(2)).strip()
    m = _BEST.search(blob)
    if m:
        sig["best_time"] = m.group(1).strip()
    return sig


def effective_outcome(outcome: str, signals: Dict[str, Any]) -> str:
    if signals.get("do_not_call"):
        return "do_not_call"
    if signals.get("wrong_number"):
        return "wrong_number"
    return outcome


# ── Do-not-contact: the one list ────────────────────────────────────────────
def norm_email(raw: str) -> str:
    return (raw or "").strip().lower()


def email_domain(raw: str) -> str:
    addr = norm_email(raw)
    return addr.split("@")[-1] if "@" in addr else ""


async def block_for(db: AsyncSession, *, phone: str = "", email: str = "", registry_id: str = "",
                    channel: str = "call") -> Optional[DoNotContact]:
    """The do-not-contact entry covering this phone, email, domain or contact on a channel, or None."""
    digits = normalize_phone_digits(phone) if phone else ""
    addr = norm_email(email)
    dom = email_domain(addr)
    conds = []
    if digits and len(digits) >= 7:
        conds.append(DoNotContact.phone == digits)
    if addr:
        conds.append(DoNotContact.email == addr)
    if dom:
        conds.append((DoNotContact.domain == dom) & (DoNotContact.email == ""))
    if registry_id:
        conds.append(DoNotContact.registry_id == registry_id)
    if not conds:
        return None
    rows = (await db.execute(select(DoNotContact).where(or_(*conds)))).scalars().all()
    for r in rows:
        if channel in (r.channels or ["call", "email", "social"]):
            return r
    return None


async def add_block(db: AsyncSession, *, phone: str = "", email: str = "", registry_id: str = "", name: str = "",
                    reason: str = "", source: str = "manual", channels: Optional[List[str]] = None,
                    domain: str = "") -> DoNotContact:
    """Put a contact on the list (or widen the entry already there) and mirror it where the older
    checks still look: the contact record's do_not_call flag and the email suppression list."""
    digits = normalize_phone_digits(phone) if phone else ""
    addr = norm_email(email)
    dom = (domain or "").strip().lower() if not addr else ""
    channels = channels or ["call", "email", "social"]
    if "call" in channels and digits:
        # First, so the contact record's flag is set before this list answers "already blocked".
        try:
            from app.services.compliance import add_do_not_call

            await add_do_not_call(db, phone, name)
        except Exception as err:  # the list itself is saved; the mirror is a convenience
            logger.warning(f"do-not-call mirror failed: {err}")
    existing = await block_for(db, phone=phone, email=email, registry_id=registry_id, channel=channels[0])
    if existing:
        merged = sorted(set(existing.channels or []) | set(channels))
        existing.channels = merged
        existing.registry_id = existing.registry_id or registry_id or None
        existing.name = existing.name or name
        entry = existing
    else:
        entry = DoNotContact(id=f"dnc_{uuid.uuid4().hex[:12]}", registry_id=registry_id or None, phone=digits, email=addr,
                             domain=dom or email_domain(addr), channels=channels, reason=reason[:200], source=source, name=name)
        db.add(entry)
    if "email" in channels and (addr or dom):
        try:
            from app.core.tenancy import current_org
            from app.services.email_dispatcher import suppress

            if addr:
                await suppress(db, current_org(), addr, "manual" if source == "manual" else "unsubscribe", f"dnc_{source}")
        except Exception as err:
            logger.warning(f"email suppression mirror failed: {err}")
    await db.flush()
    return entry


async def remove_block(db: AsyncSession, entry_id: str) -> bool:
    row = await db.get(DoNotContact, entry_id)
    if not row:
        return False
    await db.delete(row)
    await db.flush()
    return True


# ── Timeline ────────────────────────────────────────────────────────────────
async def record_event(db: AsyncSession, kind: str, *, lead_id: str = "", registry_id: str = "", ref_id: str = "",
                       summary: str = "", detail: Optional[Dict[str, Any]] = None, at: Optional[datetime] = None) -> ContactEvent:
    """Add one touch to the contact's timeline. The same (kind, ref, summary) is written once."""
    if ref_id:
        dup = (await db.execute(select(ContactEvent).where(
            ContactEvent.kind == kind, ContactEvent.ref_id == ref_id, ContactEvent.summary == summary[:500],
            ContactEvent.lead_id == (lead_id or None)).limit(1))).scalars().first()
        if dup:
            return dup
    ev = ContactEvent(id=f"ev_{uuid.uuid4().hex[:12]}", lead_id=lead_id or None, registry_id=registry_id or None,
                      kind=kind, ref_id=ref_id or "", summary=summary[:500], detail=detail, at=at or datetime.utcnow())
    db.add(ev)
    await db.flush()
    return ev


def event_view(e: ContactEvent) -> Dict[str, Any]:
    return {"id": e.id, "kind": e.kind, "ref_id": e.ref_id, "summary": e.summary, "detail": e.detail or {},
            "at": e.at.isoformat() + "Z" if e.at else None, "lead_id": e.lead_id, "registry_id": e.registry_id}


async def timeline(db: AsyncSession, *, lead_id: str = "", registry_id: str = "", kinds: Optional[List[str]] = None,
                   limit: int = 200) -> List[Dict[str, Any]]:
    conds = []
    if lead_id:
        conds.append(ContactEvent.lead_id == lead_id)
    if registry_id:
        conds.append(ContactEvent.registry_id == registry_id)
    if not conds:
        return []
    q = select(ContactEvent).where(or_(*conds))
    if kinds:
        q = q.where(ContactEvent.kind.in_(kinds))
    rows = (await db.execute(q.order_by(ContactEvent.at.desc()).limit(max(1, min(limit, 500))))).scalars().all()
    return [event_view(r) for r in rows]


# ── Event bus ───────────────────────────────────────────────────────────────
Handler = Callable[[str, str, Dict[str, Any]], Awaitable[None]]
_HANDLERS: Dict[str, List[Handler]] = {}
_HANDLED: Dict[str, float] = {}
_TASKS: set = set()
HANDLED_KEEP = 5000


def subscribe(event: str, handler: Handler) -> None:
    if handler not in _HANDLERS.setdefault(event, []):
        _HANDLERS[event].append(handler)


def handlers_for(event: str) -> List[Handler]:
    return list(_HANDLERS.get(event, []))


def _remember(key: str) -> bool:
    """True the first time a key is seen. Keeps the newest HANDLED_KEEP keys."""
    if key in _HANDLED:
        return False
    _HANDLED[key] = datetime.utcnow().timestamp()
    if len(_HANDLED) > HANDLED_KEEP:
        for old in sorted(_HANDLED, key=_HANDLED.get)[: HANDLED_KEEP // 5]:
            _HANDLED.pop(old, None)
    return True


RETRY_WAITS = (1.0, 4.0)  # seconds before the second and third try


async def _dead_letter(org_id: str, event: str, handler_name: str, data: Dict[str, Any], error: str) -> None:
    """Keep a reaction that failed three times, so it can be looked at and run again."""
    import json

    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import PublicObject

    try:
        safe = json.loads(json.dumps(data, default=str))
        with org_scope(org_id):
            async with AsyncSessionLocal() as db:
                db.add(PublicObject(id=f"dl_{uuid.uuid4().hex[:12]}", kind="dead_letter",
                                    data={"event": event, "handler": handler_name, "payload": safe, "error": error[:300],
                                          "at": datetime.utcnow().isoformat() + "Z"}))
                await db.commit()
    except Exception as err:
        logger.warning(f"[connections] could not keep the failed {event} reaction: {err}")


async def run_handler(handler: Handler, org_id: str, event: str, data: Dict[str, Any]) -> Optional[str]:
    """Run one reaction with up to three tries. Returns None on success, else the last error."""
    from app.core.tenancy import org_scope

    error = ""
    for attempt in range(1 + len(RETRY_WAITS)):
        try:
            with org_scope(org_id):
                await handler(org_id, event, data)
            return None
        except Exception as err:
            error = str(err) or err.__class__.__name__
            if attempt < len(RETRY_WAITS):
                await asyncio.sleep(RETRY_WAITS[attempt])
    return error


async def _run(org_id: str, event: str, data: Dict[str, Any]) -> None:
    for handler in handlers_for(event):
        error = await run_handler(handler, org_id, event, data)
        if error:  # a failed reaction never blocks the call, booking or post that caused it
            logger.warning(f"[connections] {handler.__name__} failed on {event}: {error}")
            await _dead_letter(org_id, event, handler.__name__, data, error)


def emit(org_id: str, event: str, data: Dict[str, Any], event_id: str = "") -> None:
    """Hand an event to every subscriber as a background task. The same event id runs once."""
    if not org_id or not _HANDLERS.get(event):
        return
    if event_id and not _remember(f"{event}:{event_id}"):
        return
    try:
        task = asyncio.get_running_loop().create_task(_run(org_id, event, data))
    except RuntimeError:
        return
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


# ── Finding the lead behind a phone, email or contact ───────────────────────
async def lead_for(db: AsyncSession, *, lead_id: str = "", phone: str = "", email: str = "",
                   registry_id: str = "") -> Optional[LeadAccount]:
    if lead_id:
        hit = await db.get(LeadAccount, lead_id)
        if hit:
            return hit
    if registry_id:
        hit = (await db.execute(select(LeadAccount).where(LeadAccount.registry_id == registry_id).limit(1))).scalars().first()
        if hit:
            return hit
    addr = norm_email(email)
    if addr:
        hit = (await db.execute(select(LeadAccount).where(LeadAccount.email == addr).limit(1))).scalars().first()
        if hit:
            return hit
    digits = normalize_phone_digits(phone) if phone else ""
    if len(digits) >= 7:
        rows = (await db.execute(select(LeadAccount).where(LeadAccount.phone != ""))).scalars().all()
        for r in rows:
            if normalize_phone_digits(r.phone) == digits:
                return r
    return None


async def resolve_lead_id(db: AsyncSession, raw: str) -> Optional[str]:
    """A saved company's id from what a partner sent: the company's own id, or the id of a call target made from it."""
    raw = (raw or "").strip()
    if not raw:
        return None
    if await db.get(LeadAccount, raw):
        return raw
    from app.models.models import Prospect

    p = await db.get(Prospect, raw)
    if p is None:
        return None
    if p.lead_id:
        return p.lead_id
    # A lead a partner added through the API (kept as a call target): it becomes a saved company the first time a
    # call or meeting refers to it, so everything that follows is on one contact.
    company = LeadAccount(id=f"la_{uuid.uuid4().hex[:12]}", name=(p.name or "Lead")[:200], contact_name=(p.contact_person or "")[:120] if p.contact_person not in (None, "—") else "",
                          phone=p.phone or "", email=(p.email or "").strip().lower(), website=p.site or "", notes=(p.note or "")[:2000], source="api")
    db.add(company)
    p.lead_id = company.id
    await db.flush()
    return company.id


def recently_reached(lead: LeadAccount, days: int, now: Optional[datetime] = None) -> bool:
    last = lead.last_contact_at or lead.last_called_at
    if not last or days <= 0:
        return False
    return last > (now or datetime.utcnow()) - timedelta(days=days)


# ── Lead score ──────────────────────────────────────────────────────────────
GOOD_EMAIL_STATES = {"ok", "verified", "found"}
STAGE_POINTS = {"new": 0, "contacted": 10, "interested": 30, "meeting": 40, "won": 40, "lost": -40, "do_not_contact": -100}


def score_lead(lead: Any, *, opens: int = 0, engagements: int = 0, replies: int = 0) -> int:
    """0-100. How reachable (checked email and number), how far along, and how engaged. Calls count too:
    a conversation lifts a lead and a wrong number sinks it. Plain sums so the reason is easy to explain."""
    ver = getattr(lead, "verification", None) or {}
    pts = 0
    if getattr(lead, "email", "") and (ver.get("email") or {}).get("state") in GOOD_EMAIL_STATES:
        pts += 15
    elif getattr(lead, "email", ""):
        pts += 5
    phone_state = (ver.get("phone") or {}).get("state")
    if getattr(lead, "phone", ""):
        pts += 15 if phone_state in ("ok", "verified") else (0 if phone_state == "invalid" else 8)
    if getattr(lead, "contact_name", ""):
        pts += 8
    pts += STAGE_POINTS.get(getattr(lead, "stage", "") or "new", 0)
    outcome = getattr(lead, "last_call_outcome", "") or ""
    pts += {"callback_requested": 15, "meeting_booked": 10, "contacted": 8, "left_voicemail": 2, "no_answer": -2,
            "rejected": -20, "wrong_number": -25}.get(outcome, 0)
    pts += min(opens, 5) * 3 + min(engagements, 3) * 6 + min(replies, 2) * 10
    return max(0, min(100, pts))


def is_warm(lead: Any, opens: int, warm_opens: int, now: Optional[datetime] = None) -> bool:
    """Opened the emails enough times, still early in the journey, and nobody has called since."""
    if opens < max(1, warm_opens):
        return False
    if (getattr(lead, "stage", "") or "new") not in ("new", "contacted"):
        return False
    last_open = getattr(lead, "_last_open", None)
    called = getattr(lead, "last_called_at", None)
    return not (called and last_open and called >= last_open)


# ── Merging two records of the same company ─────────────────────────────────
MERGE_FIELDS = ("website", "phone", "email", "contact_name", "contact_title", "industry", "region")


def merge_plan(keep: Any, other: Any) -> Dict[str, str]:
    """What the kept record gains from the other: only fields it leaves empty. Nothing is overwritten."""
    gains = {}
    for f in MERGE_FIELDS:
        if not str(getattr(keep, f, "") or "").strip() and str(getattr(other, f, "") or "").strip():
            gains[f] = getattr(other, f)
    return gains


def duplicate_key(lead: Any) -> List[str]:
    """Keys that say two saved companies are the same one: the website domain, the phone, the email."""
    keys = []
    dom = (getattr(lead, "domain", "") or "").strip().lower()
    if dom:
        keys.append("d:" + dom)
    digits = normalize_phone_digits(getattr(lead, "phone", "") or "")
    if len(digits) >= 9:
        keys.append("p:" + digits)
    em = norm_email(getattr(lead, "email", "") or "")
    if em and em.split("@")[0] not in ("info", "hello", "contact", "office", "admin", "enquiries", "sales"):
        keys.append("e:" + em)
    return keys
