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

_SKIP_GREET = {"this", "there", "sam", "san", "everyone", "all", "hi", "hello", "hey", "valued", "hi there"}

NOT_A_NAME = {
    "hi", "hello", "hey", "there", "hi there", "yes", "yeah", "yep", "speaking",
    "please", "wait", "hold", "who", "what", "sorry", "pardon",
}


def greeting_first_name(raw: Optional[str]) -> str:
    """First name for spoken greeting. Never 'Hi' / 'there' / fillers."""
    full = clean_person_label(raw)
    if not full:
        return "there"
    first = re.sub(r"\(.*?\)", "", full).strip().split()[0] if full else ""
    if not first or first.lower() in NOT_A_NAME or first.lower() in _SKIP_GREET:
        return "there"
    return first


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


_CALLER_ROLES = ("them", "prospect", "caller", "user", "human", "customer")
_NOT_NAMES = {w.lower() for w in (
    "Calling", "Just", "From", "With", "Here", "Sorry", "Not", "Interested", "Busy", "Looking", "Wondering", "Returning",
    "Ringing", "After", "About", "The", "An", "Good", "Fine", "Great", "Well", "Okay", "Sure", "Afraid", "Glad", "Happy",
    "Trying", "Still", "Going", "Very", "Really", "Yes", "No", "Hi", "Hello", "Hey", "Please", "Thanks", "Thank",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Today", "Tomorrow", "Morning",
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
)}
_WORD = r"[A-Z][a-zA-Z'’-]{1,30}"
# "my name is Priya Shah", "this is Tom", "I'm Dana", "it's Raj", "call me Sam", "you're speaking to Lee": the keywords are
# matched in any case, but the name itself must be written with capitals, so "this is regarding" or "I'm calling" never match.
_STATES = re.compile(
    r"(?i:\b(?:my name(?:'s|’s| is)|name is|this is|it(?:'s|’s| is)|i am|i'm|i’m|call me|"
    r"you(?:'re|’re| are) (?:speaking|talking) (?:to|with)|speaking (?:to|with))\s+)"
    r"(?:(?i:mr|mrs|ms|miss|dr)\.?\s+)?(" + _WORD + r")(?:\s+(" + _WORD + r"))?"
)
_SPEAKING = re.compile(r"^\s*(?:(?i:mr|mrs|ms|miss|dr)\.?\s+)?(" + _WORD + r")(?:\s+(" + _WORD + r"))?\s+(?:speaking|here)\b")


def _turns(transcript: Optional[Iterable[Any]]):
    """(who, text) for each line: who is "caller", "ai" or "system". Lines may be {who, text} or "AI: ..." strings."""
    for item in transcript or []:
        if isinstance(item, dict):
            who = str(item.get("who") or "").lower()
            text = str(item.get("text") or "").strip()
            role = "caller" if who in _CALLER_ROLES else "system" if who == "system" else "ai"
        else:
            text = str(item or "").strip()
            low = text.lower()
            if low.startswith(tuple(r + ":" for r in _CALLER_ROLES)):
                role, text = "caller", text.split(":", 1)[1].strip()
            elif low.startswith("system:"):
                role, text = "system", text.split(":", 1)[1].strip()
            elif low.startswith("ai:"):
                role, text = "ai", text[3:].strip()
            else:
                role = "ai"
        if text:
            yield role, text


def _tidy(first: str, last: str = "") -> str:
    first = re.sub(r"['’]s$", "", first or "")
    last = re.sub(r"['’]s$", "", last or "")
    if not first or first.lower() in _NOT_NAMES or first.lower() in NOT_A_NAME:
        return ""
    if last and (last.lower() in _NOT_NAMES or last.lower() in NOT_A_NAME):
        last = ""
    return f"{first} {last}".strip()


def name_stated_by_caller(transcript: Optional[Iterable[Any]]) -> str:
    """The name the other person gave on the call ("this is Tom", "my name is Priya Shah"). Only their own lines count."""
    for role, text in _turns(transcript):
        if role != "caller":
            continue
        for rx in (_STATES, _SPEAKING):
            m = rx.search(text)
            if m:
                name = _tidy(m.group(1), m.group(2))
                if name:
                    return name
    return ""


def name_from_transcript(transcript: Optional[Iterable[Any]]) -> str:
    """The name the caller gave; failing that, the name the AI greeted them with (Hi Howard / Hi Jitendra)."""
    stated = name_stated_by_caller(transcript)
    if stated:
        return stated
    for role, text in _turns(transcript):
        if role != "ai":
            continue
        m = re.search(r"(?i)\b(?:hi|hello|hey)[, ]+([A-Z][a-zA-Z'’-]{1,40})(?:\s+([A-Z][a-zA-Z'’-]{1,40}))?", text)
        if not m or m.group(1).lower() in _SKIP_GREET:
            continue
        return f"{m.group(1)} {m.group(2) or ''}".strip()
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
    """Dialed / form name wins. Transcript never renames a real dialed contact."""
    person = clean_person_label(existing_person)
    company = clean_person_label(existing_company)
    live = clean_person_label(live_label)

    if prospect is not None:
        file_person = clean_person_label(getattr(prospect, "contact_person", None))
        file_company = clean_person_label(getattr(prospect, "name", None))
        if file_company and (not company or is_generic_label(company) or company.lower() == (person or "").lower()):
            if file_company.lower() != (person or "").lower():
                company = file_company
            elif not person and not live:
                person = file_company
        if file_person and not live and (not person or is_generic_label(person)):
            person = file_person

    # The name the person gave on the call is who was on it. A name typed in when placing the call stays on as the
    # company line when it is different; with nothing said, the name typed in when placing the call is the source of truth.
    stated = name_stated_by_caller(transcript)
    if stated:
        if live and live.lower() != stated.lower() and not company:
            company = live
        person = stated
    elif live:
        person = live

    spoken = name_from_transcript(transcript)
    if spoken and not person:
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
