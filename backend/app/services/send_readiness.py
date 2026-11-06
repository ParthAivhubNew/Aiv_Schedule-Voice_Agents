"""Who may be emailed. One rule set used by the Leads screens and by journeys, so they never disagree.

A company is blocked when its check found a problem (closed, or its number belongs to another company),
when it was never confirmed, or when it looks like an individual (a sole trader: emailing one needs consent
under PECR) and no consent is recorded. Pure: callers load the account and its register record.
"""
import re
from typing import Any, Dict, Optional

from app.services import normalise

_LEGAL = re.compile(r"\b(ltd|limited|llp|plc|cic|inc|lp)\b\.?", re.I)

BLOCKING = ("problem", "unchecked", "individual", "email_bad")


def has_legal_suffix(name: Any) -> bool:
    return bool(_LEGAL.search(str(name or "")))


def _result(ok: bool, code: str = "", reason: str = "") -> Dict[str, Any]:
    return {"ok": ok, "code": code, "reason": reason}


def eligibility(account: Any, biz: Optional[Any] = None) -> Dict[str, Any]:
    """{ok, code, reason} for one saved company. code is '', problem, unchecked, individual or email_bad."""
    v = getattr(account, "verification", None) or {}
    verdict = v.get("verdict", "")
    if not verdict and biz is not None:
        # Never run through Check & improve, but linked to a register record: that record's own status is a check.
        status = str(getattr(biz, "status", "") or "").lower()
        if status in ("active", "registered", "open"):
            verdict = "verified"
        elif status:
            return _result(False, "problem", f"The company register shows it as {biz.status}")
    if verdict in ("problem", "mismatch"):
        why = (v.get("reasons") or [""])[0]
        return _result(False, "problem", why or "Its check found a problem with this company")
    if (v.get("email") or {}).get("state") == "invalid":
        return _result(False, "email_bad", "Its email address can't receive mail")
    if not verdict:
        return _result(False, "unchecked", "Not checked yet: run Check & improve first")
    if verdict in ("not_found", "unclear"):
        return _result(False, "unchecked", "Its check could not confirm the company")
    consent = bool(getattr(account, "consent_basis", "") or "")
    if verdict == "person":
        return _result(True) if consent else _result(False, "individual", "An individual, not a company: emailing one needs their consent")
    corporate = verdict == "verified" or has_legal_suffix(getattr(account, "name", "")) or (
        biz is not None and normalise.is_corporate(getattr(biz, "company_category", "")))
    if not corporate and not consent:
        return _result(False, "individual", "Looks like a sole trader or individual: emailing one needs their consent")
    return _result(True)


def pasted_person(company: Any) -> Dict[str, Any]:
    """A person typed or pasted in with no saved company: allowed when the company they work for is named and
    is plainly a company, otherwise there is nothing to check them against."""
    name = str(company or "").strip()
    if not name:
        return _result(False, "unchecked", "No company name, so there is nothing to check this person against")
    if not has_legal_suffix(name):
        return _result(False, "individual", "The company name has no Ltd, LLP or PLC: it may be a sole trader, who needs consent")
    return _result(True)
