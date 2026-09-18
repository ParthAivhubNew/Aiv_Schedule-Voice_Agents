"""Resolve who was on the call: file contact first, never a generic placeholder."""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Optional

GENERIC_LABELS = {
    "",
    "—",
    "-",
    "prospect",
    "valued prospect",
    "caller",
    "there",
    "unknown",
    "unknown caller",
    "n/a",
    "na",
    "none",
    "the caller",
}

_SKIP_GREET = {"this", "there", "sam", "san", "everyone", "all", "hi", "hello", "hey", "valued"}


def clean_person_label(raw: Optional[str]) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    if s.strip().lower() in GENERIC_LABELS:
        return ""
    stripped = re.sub(r"\(.*?\)", "", s).strip()
    if stripped.lower() in GENERIC_LABELS:
        return ""
    if re.match(r"(?i)^(caller|prospect)\b", stripped):
        return ""
    return s


def is_generic_label(raw: Optional[str]) -> bool:
    return not bool(clean_person_label(raw))


def _line_text(item: Any) -> str:
    if item is None:
        return ""
    if isinstance(item, str):
        return item.strip()
    if isinstance(item, dict):
        return str(item.get("text") or "").strip()
    return str(item).strip()


def name_from_transcript(transcript: Optional[Iterable[Any]]) -> str:
    """Pull the spoken greeting name (Hi Howard / Hi Jitendra)."""
    for item in transcript or []:
        text = _line_text(item)
        if not text:
            continue
        low = text.lower()
        if low.startswith("prospect:") or low.startswith("them:") or low.startswith("system:"):
            continue
        if low.startswith("ai:"):
            text = text[3:].strip()
        m = re.search(
            r"(?i)\b(?:hi|hello|hey)[, ]+([A-Z][a-zA-Z'’-]{1,40})(?:\s+([A-Z][a-zA-Z'’-]{1,40}))?",
            text,
        )
        if not m:
            continue
        first = m.group(1)
        last = m.group(2) or ""
        if first.lower() in _SKIP_GREET:
            continue
        full = f"{first} {last}".strip()
        return full
    return ""


def people_from_row(p: Dict[str, Any]) -> Dict[str, str]:
    person = clean_person_label(
        p.get("contact") or p.get("contact_person") or p.get("prospect_name")
    )
    company = clean_person_label(p.get("company") or p.get("name"))
    if person and company and person.lower() == company.lower():
        company = company
    display = person or company or ""
    return {"person": person, "company": company, "display": display}


def resolve_call_people(
    *,
    prospect: Any = None,
    live_label: Optional[str] = None,
    transcript: Optional[Iterable[Any]] = None,
    existing_person: Optional[str] = None,
    existing_company: Optional[str] = None,
) -> Dict[str, str]:
    person = clean_person_label(existing_person)
    company = clean_person_label(existing_company)

    if prospect is not None:
        file_person = clean_person_label(getattr(prospect, "contact_person", None))
        file_company = clean_person_label(getattr(prospect, "name", None))
        if file_person:
            person = file_person
        if file_company and (not company or is_generic_label(company) or company.lower() == (person or "").lower()):
            if file_company.lower() != (person or "").lower():
                company = file_company
            elif not person:
                person = file_company

    live = clean_person_label(live_label)
    if live:
        if not person:
            person = live
        elif not company and live.lower() != person.lower():
            company = live

    spoken = name_from_transcript(transcript)
    if spoken and not person:
        person = spoken
    elif spoken and person and spoken.lower() not in person.lower() and is_generic_label(person):
        person = spoken

    display = person or company or spoken or "Unknown caller"
    return {
        "person": person or display,
        "company": company or "",
        "display": display,
        "canonical": company or display,
        "listed": person or display,
    }


def apply_names_to_log(log: Any, names: Dict[str, str]) -> bool:
    changed = False
    person = names.get("person") or ""
    company = names.get("canonical") or names.get("company") or names.get("display") or person
    listed = names.get("listed") or person
    if person and getattr(log, "person_listed_as", None) != person:
        log.person_listed_as = person
        changed = True
    if person and getattr(log, "person_canonical", None) != person:
        log.person_canonical = person
        changed = True
    if listed and (is_generic_label(getattr(log, "listed_as", None)) or log.listed_as != listed):
        if is_generic_label(getattr(log, "listed_as", None)) or not getattr(log, "listed_as", None):
            log.listed_as = listed
            changed = True
    if company and is_generic_label(getattr(log, "canonical_name", None)):
        log.canonical_name = company
        changed = True
    return changed
