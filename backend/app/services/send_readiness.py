"""Who may be emailed. One rule set used by the Leads screens and by journeys, so they never disagree.

A company is blocked when its check found a problem (closed, or its number belongs to another company),
when it was never confirmed, or when it looks like an individual (a sole trader: emailing one needs consent
under PECR) and no consent is recorded. Pure: callers load the account and its register record.

Two kinds of no. HARD: a closed or wrong company, or an address that cannot receive mail: nothing is gained by sending.
SOFT: not checked yet, or an individual with no consent recorded: the person may still send, at their own risk, and is told so
(ok stays True and code/reason carry the warning).
"""
import re
from typing import Any, Dict, Optional

from app.services import normalise

_LEGAL = re.compile(r"\b(ltd|limited|llp|plc|cic|inc|lp)\b\.?", re.I)

BLOCKING = ("problem", "email_bad")  # never sent
WARNING = ("unchecked", "individual")  # sent at the sender's own risk, with a notice


def has_legal_suffix(name: Any) -> bool:
    return bool(_LEGAL.search(str(name or "")))


def _result(ok: bool, code: str = "", reason: str = "") -> Dict[str, Any]:
    return {"ok": ok, "code": code, "reason": reason}


def _risky(code: str, reason: str) -> Dict[str, Any]:
    """Allowed, with a warning the person must see."""
    return _result(True, code, reason + ". You can still send, at your own risk")


def eligibility(account: Any, biz: Optional[Any] = None) -> Dict[str, Any]:
    """{ok, code, reason} for one saved company. code is '', problem or email_bad (ok False), or unchecked or individual (ok True, a warning)."""
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
        return _risky("unchecked", "Not checked yet: Check & improve would confirm it")
    if verdict in ("not_found", "unclear"):
        return _risky("unchecked", "Its check could not confirm the company")
    consent = bool(getattr(account, "consent_basis", "") or "")
    if verdict == "person":
        return _result(True) if consent else _risky("individual", "An individual, not a company: emailing one without their consent can breach the UK marketing-email rules (PECR)")
    corporate = verdict == "verified" or has_legal_suffix(getattr(account, "name", "")) or (
        biz is not None and normalise.is_corporate(getattr(biz, "company_category", "")))
    if not corporate and not consent:
        return _risky("individual", "Looks like a sole trader or individual: emailing one without their consent can breach the UK marketing-email rules (PECR)")
    return _result(True)


def pasted_person(company: Any) -> Dict[str, Any]:
    """A person typed or pasted in with no saved company: clean when the company they work for is plainly a company,
    otherwise allowed with a warning."""
    name = str(company or "").strip()
    if not name:
        return _risky("unchecked", "No company name, so there is nothing to check this person against")
    if not has_legal_suffix(name):
        return _risky("individual", "The company name has no Ltd, LLP or PLC: it may be a sole trader, who needs consent")
    return _result(True)
