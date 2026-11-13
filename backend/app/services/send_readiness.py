"""Who may be emailed. One rule set used by the Leads screens and by journeys, so they never disagree. Pure: callers load the
account and its register record.

Every saved company falls in one of three groups, worked out from our own copy of the company register:
- ready: a confirmed active Ltd, LLP, PLC or other body corporate (a Scottish partnership counts). Emailed as normal.
- quick_choice: no clear register match yet. One click settles it: pick the right company, or say it is a sole trader.
- reach_other_way: a sole trader, an individual or an ordinary partnership. Under PECR these need consent before a marketing
  email, so the journey reaches them another way (a call, a letter or LinkedIn) and carries on.

A recorded consent makes anyone emailable. A company the register shows as closed, a number that belongs to another company,
or an address that cannot receive mail is never sent to: nothing is gained by it.
"""
import re
from typing import Any, Dict, Optional, Tuple

from app.services import normalise

_LEGAL = re.compile(r"\b(ltd|limited|llp|plc|cic|inc|lp)\b\.?", re.I)

READY, QUICK, OTHER = "ready", "quick_choice", "reach_other_way"
GROUPS = (READY, QUICK, OTHER)
BLOCKING = ("problem", "email_bad")  # never sent
CONSENT_BASES = ("opted_in", "existing_customer", "enquiry")
# Bodies corporate the bulk register labels in words normalise.is_corporate does not cover.
WEBMAIL = ("gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "live.co.uk",
           "icloud.com", "me.com", "aol.com", "msn.com", "btinternet.com", "sky.com", "talktalk.net", "virginmedia.com", "protonmail.com")
# A real company number: eight digits, or a prefix the register uses for a body corporate (not CC- charity numbers, IP- societies and so on).
_COMPANY_NUMBER = re.compile(r"(\d{8}|(SC|NI|OC|SO|NC|R0|LP|SL|SE)\d{6})")
_MORE_CORPORATE = ("charitable incorporated", "royal charter", "society", "industrial and provident", "overseas company", "unlimited")


def is_webmail(address: Any) -> bool:
    """A personal mailbox (gmail, hotmail...) rather than one at the company's own domain."""
    a = str(address or "").strip().lower()
    return "@" in a and a.rsplit("@", 1)[1] in WEBMAIL


def has_legal_suffix(name: Any) -> bool:
    return bool(_LEGAL.search(str(name or "")))


def pecr_corporate(category: Any, number: Any = "") -> bool:
    """A corporate subscriber under PECR. A partnership in England, Wales or Northern Ireland (ordinary or limited) is not a legal
    person, so it is treated like a sole trader; a Scottish partnership and any LLP are."""
    s = str(category or "").lower()
    if not s:
        return False
    if "partnership" in s:
        return "limited liability" in s or "scottish" in s or str(number or "").upper().startswith(("SL", "SO"))
    return normalise.is_corporate(s) or any(k in s for k in _MORE_CORPORATE)


def has_consent(account: Any) -> bool:
    """Any recorded basis except "not sure" (older rows hold the customer's own words, not one of CONSENT_BASES)."""
    basis = str(getattr(account, "consent_basis", "") or "").strip()
    return bool(basis) and basis != "not_sure"


def group_of(account: Any, biz: Optional[Any] = None) -> Tuple[str, str]:
    """(group, reason). A choice the person made wins; then the register record; then the check; then what was stored at save."""
    from app.services.person_record import is_person_account

    note = getattr(account, "eligibility_note", None) or {}
    stored = getattr(account, "eligibility", "") or ""
    if note.get("by") == "user" and stored in GROUPS:
        return stored, str(note.get("reason") or "")
    verdict = ((getattr(account, "verification", None) or {}).get("verdict") or "")
    if verdict == "person" or is_person_account(account):
        return OTHER, "An individual or sole trader, not a registered company"
    if biz is not None and (getattr(biz, "registration_number", "") or getattr(biz, "company_category", "")):
        category = str(getattr(biz, "company_category", "") or "")
        number = str(getattr(biz, "registration_number", "") or "")
        if not category and not _COMPANY_NUMBER.fullmatch(number.upper()):
            return QUICK, "The register record has no company type and a number that is not a company number"
        if pecr_corporate(category, number) or not category:
            return READY, f"Active on the company register{f' as a {category}' if category else ''}"
        return OTHER, f"On the register as a {category}, which is treated like a sole trader for email"
    if verdict == "verified":
        return READY, "Confirmed on the company register"
    email = str(getattr(account, "email", "") or "").strip()
    if "@" in email and not is_webmail(email):
        return READY, "A work email at a company's own domain, and not an individual"
    if stored in GROUPS and stored != QUICK:
        return stored, str(note.get("reason") or "")
    return QUICK, "Not matched to the company register yet"


def _result(ok: bool, code: str = "", reason: str = "", *, email: Optional[bool] = None, group: str = "") -> Dict[str, Any]:
    return {"ok": ok, "email": ok if email is None else email, "code": code, "reason": reason, "group": group}


def eligibility(account: Any, biz: Optional[Any] = None, address: str = "") -> Dict[str, Any]:
    """{ok, email, code, group, reason} for one saved company. ok False only for a closed or wrong company or a dead address (code problem or
    email_bad): it is left out. `address` is the mailbox about to be written to: a personal webmail one at a ready company still needs consent. Otherwise ok is True and `email` says whether email steps go to it; code is then '' or its group."""
    v = getattr(account, "verification", None) or {}
    verdict = v.get("verdict", "")
    if biz is not None:
        status = str(getattr(biz, "status", "") or "").lower()
        if status and status not in ("active", "registered", "open"):
            return _result(False, "problem", f"The company register shows it as {biz.status}")
    if verdict in ("problem", "mismatch"):
        why = (v.get("reasons") or [""])[0]
        return _result(False, "problem", why or "Its check found a problem with this company")
    if (v.get("email") or {}).get("state") == "invalid":
        return _result(False, "email_bad", "Its email address can't receive mail")
    group, why = group_of(account, biz)
    if group == READY:
        if is_webmail(address) and not has_consent(account):
            return _result(True, OTHER, "A personal email address (gmail, hotmail...), so it needs their consent", email=False, group=OTHER)
        return _result(True, "", why, group=group)
    if has_consent(account):
        return _result(True, "", "Consent recorded", group=group)
    return _result(True, group, why, email=False, group=group)


def pasted_person(company: Any) -> Dict[str, Any]:
    """A person typed or pasted in with no saved company: emailed when the company beside them is plainly a company (Ltd, LLP, PLC),
    otherwise reached another way."""
    name = str(company or "").strip()
    if has_legal_suffix(name):
        return _result(True, "", "", group=READY)
    why = "No company name beside them" if not name else "No Ltd, LLP or PLC in the company name, so they may be a sole trader"
    return _result(True, OTHER, why, email=False, group=OTHER)
