"""Who may be called, and how (PECR).

An automated or AI-voiced call needs the person's recorded permission (or the number is the user's own). A call made by a person is
allowed unless the number is on the TPS list and nobody gave permission; a number nobody has screened is allowed with a prompt to
check TPS first. Screening itself is a provider slot: none is wired yet, so numbers stay "unknown" until one is added.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from app.models.models import CallConsent, PhoneScreening
from app.services.timezone_service import normalize_phone

logger = logging.getLogger(__name__)

WORDING_V1 = "I agree that {company} may call me on {number} with automated or AI-voiced calls about {product}. I can withdraw this at any time by {method}."
WORDING_VERSION = "v1"
WITHDRAW_HOW = "telling {company}, by phone or email"
RESCREEN_DAYS = 28
METHODS = {
    "verbal_recorded": "They said yes on a recorded call",
    "web_form": "They ticked a box on a web form",
    "written": "They agreed in writing",
    "email": "They agreed by email",
}
NO_AI_PERMISSION = "No permission recorded for AI calls to this number."
TPS_LISTED = "This number is on the TPS list."
CHECK_TPS = "Check TPS first"


def wording(company: str, number: str, product: str) -> str:
    company = (company or "").strip() or "the caller"
    return WORDING_V1.format(company=company, number=number, product=(product or "").strip() or "our services",
                             method=WITHDRAW_HOW.format(company=company))


class ScreeningProvider:
    """A TPS/CTPS lookup. Adapters subclass this and are returned by provider()."""
    name = ""

    def configured(self) -> bool:
        return False

    async def screen(self, numbers: List[str]) -> Dict[str, Dict[str, Any]]:  # {number: {"tps": "clear"|"listed", "ctps": bool}}
        return {}


class NotConfiguredProvider(ScreeningProvider):
    name = "none"


async def provider() -> ScreeningProvider:
    """Not configured until staff save a platform key named tps_screening; an adapter for the chosen vendor slots in here."""
    try:
        from app.services.platform_balances import _platform_key

        if await _platform_key("tps_screening"):
            logger.info("A tps_screening key is saved but no screening adapter is installed yet.")
    except Exception:
        pass
    return NotConfiguredProvider()


def _fresh(row: Optional[PhoneScreening], now: datetime) -> bool:
    return bool(row and row.screened_at and row.tps_status != "unknown" and now - row.screened_at < timedelta(days=RESCREEN_DAYS))


async def status(db, num: str, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.utcnow()
    n = normalize_phone(num)
    row = await db.get(PhoneScreening, n) if n else None
    return {"number": n, "tps_status": row.tps_status if row else "unknown", "ctps": bool(row and row.ctps), "fresh": _fresh(row, now),
            "screened_at": row.screened_at.isoformat() + "Z" if row and row.screened_at else None, "provider": row.provider if row else ""}


async def save_screening(db, num: str, tps_status: str, ctps: bool = False, provider_name: str = "", now: Optional[datetime] = None) -> None:
    n = normalize_phone(num)
    row = await db.get(PhoneScreening, n)
    if row is None:
        db.add(PhoneScreening(number=n, tps_status=tps_status, ctps=ctps, screened_at=now or datetime.utcnow(), provider=provider_name))
    else:
        row.tps_status, row.ctps, row.screened_at, row.provider = tps_status, ctps, now or datetime.utcnow(), provider_name


def _out(c: CallConsent) -> Dict[str, Any]:
    return {"id": c.id, "number": c.number, "lead_id": c.lead_id or "", "company_name": c.company_name or "", "person_name": c.person_name or "",
            "product": c.product or "", "collected_at": c.collected_at.isoformat() + "Z" if c.collected_at else None, "method": c.method,
            "method_label": METHODS.get(c.method, c.method), "wording_version": c.wording_version, "wording_text": c.wording_text,
            "evidence_ref": c.evidence_ref or "", "recorded_by": c.recorded_by or "",
            "withdrawn_at": c.withdrawn_at.isoformat() + "Z" if c.withdrawn_at else None, "withdrawn_by": c.withdrawn_by or "",
            "withdraw_method": c.withdraw_method or "", "active": c.withdrawn_at is None}


async def record_consent(db, *, number: str, company: str, person: str = "", product: str = "", method: str = "verbal_recorded",
                         evidence_ref: str = "", recorded_by: str = "", lead_id: str = "", collected_at: Optional[datetime] = None) -> Dict[str, Any]:
    """Stores the permission with the wording exactly as shown. The caller commits. Raises ValueError with a plain message."""
    n = normalize_phone(number)
    if len(n) < 8:
        raise ValueError("Give the phone number in full, with the country code if it is not a UK number.")
    if not (company or "").strip():
        raise ValueError("Say which company the person agreed to hear from.")
    if method not in METHODS:
        raise ValueError("Pick how they agreed.")
    row = CallConsent(id=f"cc_{uuid.uuid4().hex[:14]}", number=n, lead_id=lead_id or "", company_name=company.strip()[:200], person_name=(person or "").strip()[:200],
                      product=(product or "").strip()[:200], collected_at=collected_at or datetime.utcnow(), method=method,
                      wording_version=WORDING_VERSION, wording_text=wording(company, n, product), evidence_ref=(evidence_ref or "").strip()[:1000],
                      recorded_by=recorded_by or "")
    db.add(row)
    await db.flush()
    return _out(row)


async def withdraw_consent(db, consent_id: str, *, by: str = "", method: str = "") -> Dict[str, Any]:
    row = await db.get(CallConsent, consent_id)
    if row is None:
        raise LookupError("That permission isn't there.")
    if row.withdrawn_at is None:
        row.withdrawn_at, row.withdrawn_by, row.withdraw_method = datetime.utcnow(), by or "", (method or "").strip()[:200]
    return _out(row)


async def withdraw_number(db, num: str, *, by: str = "", method: str = "") -> int:
    """Withdraws every active permission for a number (the person asked on a call). Returns how many."""
    rows = (await db.execute(select(CallConsent).where(CallConsent.number == normalize_phone(num), CallConsent.withdrawn_at.is_(None)))).scalars().all()
    for r in rows:
        r.withdrawn_at, r.withdrawn_by, r.withdraw_method = datetime.utcnow(), by or "", (method or "").strip()[:200]
    return len(rows)


async def active_consent(db, num: str) -> Optional[Dict[str, Any]]:
    n = normalize_phone(num)
    if not n:
        return None
    row = (await db.execute(select(CallConsent).where(CallConsent.number == n, CallConsent.withdrawn_at.is_(None))
                            .order_by(CallConsent.collected_at.desc()).limit(1))).scalars().first()
    return _out(row) if row else None


async def list_consents(db, limit: int = 200) -> List[Dict[str, Any]]:
    rows = (await db.execute(select(CallConsent).order_by(CallConsent.collected_at.desc()).limit(max(1, min(limit, 500))))).scalars().all()
    return [_out(r) for r in rows]


async def own_number(db, num: str) -> bool:
    """The number belongs to the user: a team member's phone, or a number the company owns or uses as caller ID. Testing a call to your own
    phone never needs anyone's permission."""
    from app.models.models import CompanyProfile, Operator, OrgPhoneNumber

    n = normalize_phone(num)
    if not n:
        return False
    for (p,) in (await db.execute(select(Operator.phone).where(Operator.phone.isnot(None), Operator.phone != ""))).all():
        if normalize_phone(p) == n:
            return True
    if (await db.execute(select(OrgPhoneNumber.id).where(OrgPhoneNumber.e164 == n).limit(1))).first():
        return True
    prof = (await db.execute(select(CompanyProfile).limit(1))).scalars().first()
    return bool(prof and normalize_phone(getattr(prof, "caller_id", "") or "") == n)


async def decide(db, num: str, kind: str = "ai", now: Optional[datetime] = None) -> Dict[str, Any]:
    """{allowed, reasons, warnings, flags, needs}. kind is "ai" (automated or AI-voiced) or "human" (a person dials)."""
    now = now or datetime.utcnow()
    out: Dict[str, Any] = {"allowed": True, "reasons": [], "warnings": [], "flags": [], "needs": ""}
    if await own_number(db, num):
        return out
    consent = await active_consent(db, num)
    if kind == "ai":
        if not consent:
            out.update(allowed=False, needs="ai_consent")
            out["reasons"].append(NO_AI_PERMISSION)
        return out
    if consent:  # they asked to hear from us, which outweighs a listing
        return out
    st = await status(db, num, now)
    if not st["fresh"]:
        prov = await provider()
        if prov.configured():
            res = (await prov.screen([st["number"]])).get(st["number"])
            if res:
                await save_screening(db, st["number"], res.get("tps", "unknown"), bool(res.get("ctps")), prov.name, now)
                st = await status(db, num, now)
    if st["fresh"] and (st["tps_status"] == "listed" or st["ctps"]):
        out.update(allowed=False)
        out["reasons"].append(TPS_LISTED)
    elif not st["fresh"]:
        out["flags"].append("check_tps")
        out["warnings"].append(CHECK_TPS)
    return out
