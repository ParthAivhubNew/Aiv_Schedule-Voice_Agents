"""Checks one imported row before it is saved. Pure and offline: no network, no AI.

`check_row` returns {"hard": [...], "warn": [...]}. A row with any hard code is quarantined (never saved); warnings
keep the row and are shown. Codes are short and stable so a screen or file can list them.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List
from urllib.parse import urlparse

from app.services import normalise, uk_phone
from app.services.business_records import DIRECTORY_SITES

HARD_TEXT = {
    "NAME_INVALID": "The name is empty or a placeholder.", "EMAIL_SYNTAX": "The email address is not valid.",
    "EMAIL_FAKE": "The email address is an example or test address.", "EMAIL_DISPOSABLE": "The email address is from a throwaway mail service.",
    "WEB_DIRECTORY": "The website is a directory, rating or social page, not the company's own.", "WEB_INVALID": "The website is not a web address.",
    "PHONE_INVALID": "The phone number is not a usable number.", "PHONE_FAKE": "The phone number looks made up.", "PHONE_PREMIUM": "The phone number is a premium-rate line.",
    "PERSON_INVALID": "The contact name holds digits, an @ or a placeholder.", "FORMULA_INJECTION": "A cell starts like a spreadsheet formula.",
    "POSTCODE_INVALID": "The postcode is not a UK postcode.",
    "PHONE_FICTIONAL": "Reserved for TV and radio drama: not a real line.",
    "NAME_MISSING": "The row has no company name.",
}
WARN_TEXT = {
    "EMAIL_PERSONAL": "A personal mailbox (Gmail, Outlook…), not a work address.", "EMAIL_ROLE": "A shared inbox such as info@.",
    "PHONE_MOBILE": "A mobile number.", "GDPR_INDIVIDUAL": "No Ltd, LLP or PLC in the name: may be a sole trader. Email marketing to individuals needs consent.",
    "NO_IDENTIFIER": "No email, phone or website yet. Check and improve it before a campaign.",
    "EMAIL_DOMAIN_MISMATCH": "The email's domain does not match the website: possibly the wrong person.",
    "POSTCODE_PARTIAL": "Only the first part of the postcode (e.g. DN11): enough for an area, not an address.",
    "REGNO_INVALID": "The company number is not in a form the register uses (8 digits, or SC/NI/OC plus digits).",
    "REGNO_NAME_MISMATCH": "This company number belongs to a different company on the register.",
    "REGNO_DUPLICATE": "Another company in this file or your saved companies has the same company number.",
}
_PLACEHOLDERS = {"test", "tests", "testing", "n/a", "na", "none", "null", "xxx", "xx", "asdf", "qwerty", "unknown", "tbc", "-", ".", "?"}
_FREE = {"gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "icloud.com", "aol.com", "btinternet.com", "sky.com", "proton.me", "protonmail.com"}
_DISPOSABLE = {"mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "trashmail.com", "yopmail.com", "sharklasers.com", "getnada.com"}
_FAKE_DOMAINS = {"example.com", "example.org", "example.net", "test.com", "domain.com", "email.com", "sample.com"}
_ROLE = {"info", "sales", "admin", "contact", "hello", "enquiries", "office", "support", "accounts", "mail", "team"}
_EMAIL = re.compile(r"^[A-Za-z0-9._%+\-']{1,64}@([A-Za-z0-9\-]+\.)+[A-Za-z]{2,24}$")
_POSTCODE = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$")
_LEGAL = re.compile(r"\b(ltd|limited|llp|plc|llc|inc|cic|lp)\b\.?", re.I)


def _s(v: Any) -> str:
    return str(v or "").strip()


def _formula(v: str) -> bool:
    """Starts like a spreadsheet formula: = or @, or + or - followed by a letter or bracket (a phone's leading + is fine)."""
    if not v:
        return False
    if v[0] in "=@":
        return True
    return v[0] in "+-" and bool(re.match(r"^[+\-]\s*[A-Za-z(\[]", v))


def check_row(item: Dict[str, Any]) -> Dict[str, List[str]]:
    hard: List[str] = []
    warn: List[str] = []
    name, email, phone, site = _s(item.get("name")), _s(item.get("email")).lower(), _s(item.get("phone")), _s(item.get("website"))
    person = _s(item.get("contact_name"))
    for v in (name, email, phone, site, person, _s(item.get("notes")), _s(item.get("industry")), _s(item.get("region"))):
        if _formula(v):
            hard.append("FORMULA_INJECTION")
            break
    if name and (name.lower() in _PLACEHOLDERS or not re.search(r"[A-Za-z0-9]", name)):
        hard.append("NAME_INVALID")
    if person and (re.search(r"[\d@]", person) or person.lower() in _PLACEHOLDERS):
        hard.append("PERSON_INVALID")
    domain = ""
    if email:
        if not _EMAIL.match(email):
            hard.append("EMAIL_SYNTAX")
        else:
            local, domain = email.split("@", 1)
            if domain in _FAKE_DOMAINS or local in {"test", "example", "sample"}:
                hard.append("EMAIL_FAKE")
            elif domain in _DISPOSABLE:
                hard.append("EMAIL_DISPOSABLE")
            elif domain in _FREE:
                warn.append("EMAIL_PERSONAL")
            elif local in _ROLE:
                warn.append("EMAIL_ROLE")
    host = ""
    if site:
        parsed = urlparse(site if "://" in site else "https://" + site)
        host = (parsed.hostname or "").lower().removeprefix("www.")
        if not host or "." not in host or " " in site:
            hard.append("WEB_INVALID")
        elif any(d in host + (parsed.path or "") for d in DIRECTORY_SITES):
            hard.append("WEB_DIRECTORY")
    if domain and host and domain not in _FREE and domain.split(".")[0][:4] not in host and host.split(".")[0][:4] not in domain:
        warn.append("EMAIL_DOMAIN_MISMATCH")
    if phone:
        d = re.sub(r"\D", "", phone)
        local = d[2:] if d.startswith("44") else d[1:] if d.startswith("0") else d
        if len(d) < 7 or len(d) > 15:
            hard.append("PHONE_INVALID")
        elif len(set(d)) <= 2 or d in {"1234567890", "01234567890", "12345678901"}:
            hard.append("PHONE_FAKE")
        elif uk_phone.fictional(phone):
            hard.append("PHONE_FICTIONAL")
        elif local.startswith("9"):
            hard.append("PHONE_PREMIUM")
        elif local.startswith("7"):
            warn.append("PHONE_MOBILE")
    custom = item.get("custom") or {}
    pc = _s(item.get("postcode")) or next((_s(v) for k, v in custom.items() if re.sub(r"[^a-z]", "", str(k).lower()) in ("postcode", "postalcode", "zip")), "")
    if pc:
        pcu = pc.upper().replace("  ", " ")
        if _POSTCODE.match(pcu):
            pass
        elif normalise.is_outward_only(pcu):
            warn.append("POSTCODE_PARTIAL")
        else:
            hard.append("POSTCODE_INVALID")
    regno = _s(item.get("registration_number"))
    if regno and not normalise.company_number(regno):
        warn.append("REGNO_INVALID")
    if not (email or phone or site):
        warn.append("NO_IDENTIFIER")  # a name-only file is a normal start: the check fills in the rest
    if name and not _LEGAL.search(name) and not _s(item.get("business_record_id")):
        warn.append("GDPR_INDIVIDUAL")
    return {"hard": list(dict.fromkeys(hard)), "warn": list(dict.fromkeys(warn))}


def explain(codes: List[str]) -> List[str]:
    return [HARD_TEXT.get(c) or WARN_TEXT.get(c) or c for c in codes]
