"""One company, everything we hold about it, in the shape the company page shows.

Nothing here is guessed. Facts come from the stored record (the register's own file, the people read from the registry, a lookup that passed
the guardrail), and every contact detail says where it came from. "Why now" signals are worked out from those facts only, so the page can say
"accounts are overdue" or "a director left this year" and point at the field it came from.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import BusinessRecord, ContactEvent, EmailCampaign, EmailEnrollment, LeadAccount
from app.services import business_records
from app.services import company_contacts as CC
from app.services import lead_filters

logger = logging.getLogger("company_profile")

SIZE_WORDS = {"micro": "Micro", "small": "Small", "medium_large": "Medium or large", "dormant": "Dormant"}
ACCOUNTS_WORDS = {
    "MICRO ENTITY": "Micro-entity accounts", "SMALL": "Small company accounts", "FULL": "Full accounts", "GROUP": "Group accounts", "DORMANT": "Dormant accounts",
    "TOTAL EXEMPTION SMALL": "Small company accounts", "TOTAL EXEMPTION FULL": "Exempt accounts", "UNAUDITED ABRIDGED": "Abridged accounts",
}
CLOSED_WORDS = ("liquidation", "administration", "receiver", "dissolved", "removed", "voluntary arrangement")
_NUMBER = re.compile(r"^[A-Z0-9]{8}$")


def is_registry_company(biz: BusinessRecord) -> bool:
    """A company with a real Companies House number, so the registry can be asked about its officers (charities and food outlets cannot)."""
    return bool(_NUMBER.match((biz.registration_number or "").strip().upper()))


def register_fields(biz: BusinessRecord) -> Dict[str, str]:
    """The register's own bulk-file fields for this company, with the stray spaces in some of its field names removed."""
    for source in (biz.raw_data or {}).values():
        if isinstance(source, dict) and any(k.strip() == "CompanyNumber" for k in source):
            return {str(k).strip(): ("" if v is None else str(v).strip()) for k, v in source.items()}
    return {}


def _date(value: Any) -> Optional[date]:
    return business_records.parse_date(value) if value else None


def _human(d: Optional[date]) -> str:
    return d.strftime("%d %b %Y").lstrip("0") if d else ""


def _num(value: Any) -> int:
    try:
        return int(str(value).strip() or 0)
    except ValueError:
        return 0


def status_tone(status: str) -> str:
    s = (status or "").lower()
    if any(w in s for w in CLOSED_WORDS):
        return "red"
    if "strike off" in s:
        return "amber"
    return "green" if s.startswith("active") or not s else "slate"


def age_words(born: Optional[date], today: date) -> str:
    if not born:
        return ""
    days = (today - born).days
    if days < 0:
        return ""
    if days < 60:
        return "set up in the last two months"
    if days < 730:
        return f"{days // 30} months old"
    return f"{days // 365} years old"


# ── Signals: reasons to get in touch now, or to leave alone, each from a stored field ──────────────────────
def signals(biz: BusinessRecord, ch: Dict[str, str], officers: List[Dict[str, Any]], leavers: List[Dict[str, Any]], today: date) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    status = (biz.status or "").strip()
    closed = status_tone(status) == "red"
    born = biz.incorporated_on or _date(biz.incorporation_date)
    if closed:
        out.append({"key": "closed", "tone": "caution", "label": f"Register status: {status}", "detail": "This company is closing down or closed, so it is not a prospect."})
    elif "strike off" in status.lower():
        out.append({"key": "strike_off", "tone": "caution", "label": "Proposal to strike off", "detail": "The register has proposed removing this company. It may stop trading soon."})
    if closed:
        return out
    if born and 0 <= (today - born).days <= 180:
        out.append({"key": "new_company", "tone": "opportunity", "label": "Newly registered", "detail": f"Set up on {_human(born)}. New companies often need suppliers early."})
    due = _date(ch.get("Accounts.NextDueDate"))
    if due:
        if due < today:
            out.append({"key": "accounts_overdue", "tone": "opportunity", "label": "Accounts overdue", "detail": f"They were due on {_human(due)}. A good moment to offer help with year-end."})
        elif (due - today).days <= 60:
            out.append({"key": "accounts_due", "tone": "opportunity", "label": "Accounts due soon", "detail": f"Next accounts are due on {_human(due)}."})
    cs_due = _date(ch.get("ConfStmtNextDueDate"))
    if cs_due and cs_due < today:
        out.append({"key": "confirmation_overdue", "tone": "caution", "label": "Confirmation statement overdue", "detail": f"It was due on {_human(cs_due)}."})
    renamed = _date(ch.get("PreviousName_1.CONDATE"))
    if renamed and 0 <= (today - renamed).days <= 365:
        out.append({"key": "renamed", "tone": "opportunity", "label": "Changed its name this year", "detail": f"Previously {ch.get('PreviousName_1.CompanyName') or 'another name'} until {_human(renamed)}."})
    new_people = [o for o in officers if o.get("years_in_role") == 0]
    if new_people:
        out.append({"key": "director_new", "tone": "opportunity", "label": f"{len(new_people)} new in role this year", "detail": ", ".join(CC_name(o) for o in new_people[:3]) + " joined recently."})
    if leavers:
        out.append({"key": "director_left", "tone": "opportunity", "label": f"{len(leavers)} left in the last year", "detail": "A change at the top is a reason to get in touch."})
    outstanding = _num(ch.get("Mortgages.NumMortOutstanding"))
    if outstanding:
        out.append({"key": "charges", "tone": "info", "label": f"{outstanding} outstanding charge{'s' if outstanding != 1 else ''}", "detail": "Loans or other debts secured on the company."})
    if (biz.size_band or "") == "dormant" or (ch.get("Accounts.AccountCategory") or "").upper() == "DORMANT":
        out.append({"key": "dormant", "tone": "caution", "label": "Dormant", "detail": "It files dormant accounts, so it is probably not trading."})
    return out


def CC_name(o: Dict[str, Any]) -> str:
    return f"{o.get('first_name', '')} {o.get('last_name', '')}".strip() or o.get("name", "")


def person_reason(o: Dict[str, Any]) -> str:
    """Why this person is worth a look, from the register only."""
    years = o.get("years_in_role")
    role = (o.get("role") or "").lower()
    bits = []
    if years == 0:
        bits.append("New in role")
    elif years is not None and years >= 8:
        bits.append("Long-standing")
    if "secretary" in role:
        bits.append("Company secretary")
    elif "director" in role and not bits:
        bits.append("Director")
    return " · ".join(bits)


# ── The plain-words summary: only what is stored ────────────────────────────────────────────────────────
def summary(biz: BusinessRecord, ch: Dict[str, str], today: date) -> str:
    kind = (biz.company_category or "company").strip().lower() or "company"
    where = (biz.region or "").strip().title()
    born = biz.incorporated_on or _date(biz.incorporation_date)
    parts = [f"{biz.name.title() if biz.name.isupper() else biz.name} is a {kind}" + (f" in {where}" if where else "") + (f", registered on {_human(born)}" if born else "") + "."]
    sic = (biz.sic_text or biz.industry or "").split(" | ")[0].strip()
    industry = re.sub(r"^\d+\s*-\s*", "", sic).lower()
    if sic:
        parts.append(f"Its industry on the register is {industry}.")
    if biz.status:
        parts.append(f"Register status: {biz.status.lower()}.")
    cat = ACCOUNTS_WORDS.get((ch.get("Accounts.AccountCategory") or "").upper())
    due = _date(ch.get("Accounts.NextDueDate"))
    if cat:
        parts.append(f"It files {cat.lower()}" + (f", next due {_human(due)}." if due else "."))
    n = len(CC.active_officers(biz.officers))
    if n:
        parts.append(f"The register lists {n} current director{'s' if n != 1 else ''} or officer{'s' if n != 1 else ''}.")
    return " ".join(parts)


def _contact(card: Dict[str, Any]) -> Dict[str, Any]:
    """Website, phone and email, each with where it came from: the register, a web lookup that passed the checks, or missing."""
    def one(own: str, web: str, own_word: str = "On the register") -> Dict[str, str]:
        if own:
            return {"value": own, "source": "register", "label": own_word}
        if web:
            return {"value": web, "source": "web", "label": "Found on the web: check before you use it"}
        return {"value": "", "source": "missing", "label": "Not known yet"}
    out = {"website": one(card.get("website") or "", card.get("web_website") or ""), "phone": one(card.get("phone") or "", card.get("web_phone") or ""),
           "email": one(card.get("email") or "", card.get("web_email") or "")}
    for kind, when in (card.get("missed") or {}).items():
        if kind in out and not out[kind]["value"]:
            out[kind]["missed"] = when
    return out


async def _saved(db: AsyncSession, biz: BusinessRecord) -> Dict[str, Any]:
    lead = (await db.execute(select(LeadAccount).where(LeadAccount.business_record_id == biz.id).limit(1))).scalars().first()
    if not lead:
        return {"saved": False, "lead_id": "", "stage": "", "lists": [], "journeys": [], "activity": []}
    lists: List[str] = []
    try:
        from app.api import lead_lists as LL

        lists = [x["name"] for x in await LL._load(db) if lead.id in (x.get("ids") or [])]
    except Exception as err:
        logger.debug("lists not read for the company page: %s", err)
    rows = (await db.execute(select(EmailEnrollment, EmailCampaign).join(EmailCampaign, EmailCampaign.id == EmailEnrollment.campaign_id).where(
        or_(EmailEnrollment.lead_id == lead.id, func.lower(EmailEnrollment.email) == (lead.email or "~").lower())))).all()
    journeys = [{"id": c.id, "name": c.name, "status": c.status, "person_status": e.status, "step": e.current_step} for e, c in rows]
    events = (await db.execute(select(ContactEvent).where(ContactEvent.lead_id == lead.id).order_by(ContactEvent.at.desc()).limit(25))).scalars().all()
    activity = [{"kind": ev.kind, "summary": ev.summary, "at": ev.at.isoformat() + "Z" if ev.at else None} for ev in events]
    return {"saved": True, "lead_id": lead.id, "stage": lead.stage or "new", "lists": lists, "journeys": journeys, "activity": activity}


async def build(db: AsyncSession, biz: BusinessRecord, today: Optional[date] = None) -> Dict[str, Any]:
    today = today or datetime.utcnow().date()
    ch = register_fields(biz)
    officers = CC.active_officers(biz.officers)
    for o in officers:
        o["reason"] = person_reason(o)
    leavers = CC.recent_leavers(biz.officers)
    controllers = CC.controllers(biz.significant_control)
    card = lead_filters.card(biz)
    contact = _contact(card)
    born = biz.incorporated_on or _date(biz.incorporation_date)
    previous = [{"name": ch.get(f"PreviousName_{i}.CompanyName"), "until": _human(_date(ch.get(f"PreviousName_{i}.CONDATE")))} for i in range(1, 11) if ch.get(f"PreviousName_{i}.CompanyName")]
    sic = []
    for part in (biz.sic_text or biz.industry or "").split(" | "):
        m = re.match(r"^\s*(\d{4,5})\s*-\s*(.+)$", part)
        if m:
            sic.append({"code": m.group(1), "text": m.group(2).strip()})
    cat = (ch.get("Accounts.AccountCategory") or "").upper()
    accounts = {"category": ACCOUNTS_WORDS.get(cat, cat.title()), "last_made": _human(_date(ch.get("Accounts.LastMadeUpDate"))), "next_due": _human(_date(ch.get("Accounts.NextDueDate"))),
                "overdue": bool(_date(ch.get("Accounts.NextDueDate")) and _date(ch.get("Accounts.NextDueDate")) < today and status_tone(biz.status or "") == "green")}
    out = {
        "id": biz.id, "name": biz.name, "registration_number": biz.registration_number or "", "status": biz.status or "", "status_tone": status_tone(biz.status or ""),
        "type": biz.company_category or "", "incorporated": _human(born), "age": age_words(born, today), "size": SIZE_WORDS.get(biz.size_band or "", ""),
        "region": biz.region or "", "postcode": biz.postcode or "", "address": biz.address or "", "sic": sic,
        "profile": business_records.profile_of(biz.rank_score), "contact": contact,
        "missing": [k for k in ("website", "phone", "email") if contact[k]["source"] == "missing"],
        "accounts": accounts, "confirmation": {"last": _human(_date(ch.get("ConfStmtLastMadeUpDate"))), "next_due": _human(_date(ch.get("ConfStmtNextDueDate")))},
        "charges": {"outstanding": _num(ch.get("Mortgages.NumMortOutstanding")), "satisfied": _num(ch.get("Mortgages.NumMortSatisfied")), "total": _num(ch.get("Mortgages.NumMortCharges"))},
        "previous_names": previous, "country": ch.get("CountryOfOrigin", ""),
        "signals": signals(biz, ch, officers, leavers, today), "summary": summary(biz, ch, today),
        "people": {"officers": officers, "leavers": leavers, "controllers": controllers, "read": biz.people_checked_at is not None,
                   "from_registry": is_registry_company(biz)},
        "description": (biz.description or "")[:600],
    }
    out.update(await _saved(db, biz))
    return out


# ── For the chat: a company in a few plain sentences ──────────────────────────────────────────────────────
async def find(db: AsyncSession, query: str) -> Optional[BusinessRecord]:
    q = (query or "").strip()
    if not q:
        return None
    hit = await db.get(BusinessRecord, q)
    if hit:
        return hit
    esc = re.sub(r"([\\%_])", r"\\\1", q)
    rows = (await db.execute(select(BusinessRecord).where(BusinessRecord.name.ilike(f"%{esc}%", escape="\\")).order_by(
        BusinessRecord.rank_score.desc().nullslast()).limit(3))).scalars().all()
    exact = [r for r in rows if r.name.lower() == q.lower()]
    return (exact or rows or [None])[0]


def brief_text(p: Dict[str, Any]) -> str:
    people = p["people"]
    bits = [p["summary"]]
    if p["signals"]:
        bits.append("Signals: " + "; ".join(f"{s['label']} ({s['tone']})" for s in p["signals"]) + ".")
    known = [k for k in ("website", "phone", "email") if p["contact"][k]["value"]]
    bits.append("Contact details we hold: " + (", ".join(f"{k} {p['contact'][k]['value']} ({p['contact'][k]['label'].lower()})" for k in known) or "none yet") + ".")
    if people["officers"]:
        bits.append("People on the register: " + "; ".join(f"{CC_name(o)}, {o['role'] or 'officer'}" + (f" ({o['reason']})" if o.get("reason") else "") for o in people["officers"][:6]) + ".")
    elif people["from_registry"]:
        bits.append("No officers have been read from the registry for this company yet.")
    if people["controllers"]:
        bits.append("Owners: " + "; ".join(f"{c['name']} ({', '.join(c['controls']) or 'significant control'})" for c in people["controllers"][:4]) + ".")
    if p["saved"]:
        bits.append(f"The person has saved it (stage {p['stage']})" + (f", in lists {', '.join(p['lists'])}" if p["lists"] else "") + (f", and it is in journeys {', '.join(j['name'] for j in p['journeys'])}" if p["journeys"] else "") + ".")
    return " ".join(bits)
