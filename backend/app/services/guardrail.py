"""The guardrail: from everything the searches returned to ONE answer per field, or to nothing.

Candidates, per field
    website  one registered domain          (www.x.com, x.com and every page on it are one candidate)
    phone    one normalised number          (+44 1462 123456 and 01462 123456 are one)
    email    one full lowercase address

Hard rejects (a candidate that trips one is out, whatever it scores)
    a directory page as the website, a page about a different business or a conflicting place, a value not written in its source,
    a non-UK or premium phone, an email not on the company's own domain, a personal-looking email, a dead site (checked by the caller).

Score: the signals add up to 110 (SCALE_MAX), not capped.
    own site 30 | place on the page 20 | a second independent source 20 | name in the title 15 | matches the register 15 |
    Tavily relevance up to 10 | directory only -25 | sources disagree -20

A field shows its winner only when the winner scores at least THRESHOLD and leads the next candidate of that field by at least MARGIN.
Otherwise it shows nothing. THRESHOLD and MARGIN are starting values: the company test (scripts/search_eval.py) sets the real ones.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from app.services import site_check
from app.services.person_record import is_role_inbox

SCALE_MAX = 110
THRESHOLD = 70
MARGIN = 15
HIGH = 85  # a winner at or above this is "high" confidence, below it "good"

POINTS = {"own_site": 30, "place_on_page": 20, "second_source": 20, "name_in_title": 15, "matches_register": 15, "relevance": 10,
          "directory_only": -25, "disagree": -20}

_TWO_PART = {"co.uk", "org.uk", "ltd.uk", "plc.uk", "me.uk", "net.uk", "ac.uk", "sch.uk", "gov.uk", "nhs.uk", "com.au", "co.nz", "co.ie"}
_POSTCODE = re.compile(r"\b([A-Z]{1,2})(\d[A-Z\d]?)\s*(\d[A-Z]{2})\b", re.I)
_EMAIL = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+")
_PHONE = re.compile(r"(?:\+?44|0)[\d\s().\-]{8,16}\d")
_GENERIC = {"the", "and", "ltd", "limited", "plc", "llp", "company", "group", "holdings", "services", "service", "uk", "co", "of", "for", "trading"}


# The kind of organisation, not which one. A site calls itself "Winchester Chamber Music Festival" where the register says "... Trust".
_KIND = {"trust", "society", "club", "association", "charity", "charitable", "foundation", "fund", "centre", "center", "friends", "community",
         "church", "school", "pta", "council", "parish", "project", "organisation", "organization", "cio", "institute", "hall"}


def squash(text: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def company_number_in(number: str, text: str) -> bool:
    """True if a UK company registration number (e.g. 17492624, 01234567, SC123456)
    is found in the text, allowing for optional leading zero differences."""
    raw = str(number or "").strip().lower()
    if not raw or len(raw) < 5:
        return False
    if re.search(r"\b" + re.escape(raw) + r"\b", text, re.I):
        return True
    # Whole tokens only: squashing the page into one run of characters would match inside phone numbers and order references.
    stripped = raw.lstrip("0")
    return len(stripped) >= 6 and bool(re.search(r"(?<![\w+])0*" + re.escape(stripped) + r"(?!\w)", text, re.I))


def national(raw: Any) -> str:
    """A UK number as digits without the country code or the leading zero, so +44 113 496 0123 and 0113 496 0123 are the same."""
    d = re.sub(r"\D", "", str(raw or ""))
    if d.startswith("0044"):
        d = d[4:]
    elif d.startswith("44") and len(d) >= 11:
        d = d[2:]
    return d.lstrip("0") if d.startswith("0") else d


def numbers_in(text: str) -> Dict[str, str]:
    """{normalised number: the way the page wrote it} for every UK-shaped number in a text."""
    from app.services.company_contacts import is_uk_phone

    out: Dict[str, str] = {}
    for m in _PHONE.findall(text or ""):
        written = " ".join(re.sub(r"[()]", " ", m).split())  # "(01756) 753782" caught half-way would otherwise keep a stray bracket
        if is_uk_phone(written):
            out.setdefault(national(written), written)
    return out


def registered_domain(url: str) -> str:
    raw = str(url or "").strip().lower()
    host = (urlparse(raw if "://" in raw else "https://" + raw).hostname or "").removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 4 and ".".join(parts[-2:]) == "sch.uk":
        return ".".join(parts[-4:])  # fawkham.kent.sch.uk: a council hosts many schools under kent.sch.uk, so the school is one label deeper
    if len(parts) >= 3 and ".".join(parts[-2:]) in _TWO_PART:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def words_of(name: str) -> List[str]:
    words = [w for w in re.findall(r"[a-z0-9]{3,}", str(name or "").lower()) if w not in _GENERIC]
    return [w for w in words if w not in _KIND] or words  # the words that tell this charity from another; all of them if none are left


def mentions(name: str, text: str) -> bool:
    """Does this text talk about this business? Every real word of its name is in it (run together or not)."""
    words, flat = words_of(name), squash(text)
    return bool(words) and all(w in flat for w in words)


def domain_matches_name(domain: str, name: str) -> bool:
    """Does the domain look like the company's name? The name without Ltd/Limited/The and punctuation, split into words with the
    generic ones (group, services...) dropped. The domain matches when every word is in it, or when the first word and at least half
    of the words are. A starting rule: the company test tunes it."""
    label = squash(registered_domain(domain).split(".")[0])
    words = words_of(name)
    if not label or not words:
        return False
    if len(words) == 1:
        return words[0] in label
    hits = [w for w in words if w in label]
    if len(hits) == len(words):
        return True
    if len(words) == 2:
        return label == words[0]
    return words[0] in label and len(hits) >= 2 and len(hits) * 2 >= len(words)


def _place_hit(text: str, postcode: str, area: str) -> bool:
    flat = squash(text)
    if postcode and squash(postcode) in flat:
        return True
    return any(len(w) >= 4 and w in flat for w in re.findall(r"[a-z]+", str(area or "").lower()) if w not in {"north", "south", "east", "west", "upon", "with", "near"})


def _conflicts(text: str, postcode: str, area: str) -> bool:
    """A page that shows a UK postcode from a different part of the country and nothing of ours: another place, not a branch of ours."""
    if _place_hit(text, postcode, area):
        return False
    mine = _POSTCODE.search(postcode or "")
    ours_area = (mine.group(1) if mine else "").upper()
    found = {m.group(1).upper() for m in _POSTCODE.finditer(text or "")}
    return bool(found) and bool(ours_area) and ours_area not in found


def prepare_sources(raw: List[Dict[str, Any]], facts: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The search results as sources the guardrail can reason about: domain, directory or not, and whether the page fits the place."""
    name, postcode, area = facts.get("name") or "", facts.get("postcode") or "", facts.get("area") or ""
    company_num = str(facts.get("company_number") or "").strip()
    out = []
    for r in raw:
        url = r.get("url") or ""
        text = f"{r.get('title') or ''}\n{r.get('text') or r.get('snippet') or ''}"
        matched_reg = bool(company_num and company_number_in(company_num, text))
        out.append({"url": url, "domain": registered_domain(url), "title": r.get("title") or "", "text": r.get("text") or r.get("snippet") or "",
                    "score": float(r.get("score") or 0.0), "listing": site_check.is_listing_host(url, name), "read": bool(r.get("read")),
                    "conflict": False if matched_reg else _conflicts(text, postcode, area),
                    "place": True if matched_reg else _place_hit(text, postcode, area),
                    "matched_reg": matched_reg})
    return out


def _cand(field: str, key: str, value: str, idx: List[int]) -> Dict[str, Any]:
    return {"field": field, "key": key, "value": value, "sources": idx, "points": {}, "score": 0, "rejected": ""}


def website_candidates(sources: List[Dict[str, Any]], facts: Dict[str, Any]) -> List[Dict[str, Any]]:
    name = facts.get("name") or ""
    by: Dict[str, List[int]] = {}
    for i, s in enumerate(sources):
        if s["domain"]:
            by.setdefault(s["domain"], []).append(i)
    out = []
    for domain, idx in by.items():
        c = _cand("website", domain, "https://" + domain, idx)
        if all(sources[i]["listing"] for i in idx):
            c["rejected"] = "a directory or listing page, not the company's own site"
        elif all(sources[i]["conflict"] for i in idx):
            c["rejected"] = "the page is about a different place"
        elif not (domain_matches_name(domain, name) or any(mentions(name, sources[i]["title"]) for i in idx)):
            c["rejected"] = "the page is about a different business"
        out.append(c)
    return out


def phone_candidates(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by: Dict[str, Dict[str, Any]] = {}
    for i, s in enumerate(sources):
        for key, written in numbers_in(f"{s['title']} {s['text']}").items():
            by.setdefault(key, {"value": written, "idx": []})["idx"].append(i)
    out = []
    for key, v in by.items():
        c = _cand("phone", key, v["value"], v["idx"])
        if all(sources[i]["conflict"] for i in v["idx"]):
            c["rejected"] = "the page is about a different place"
        out.append(c)
    return out


def email_candidates(sources: List[Dict[str, Any]], own_domains: List[str]) -> List[Dict[str, Any]]:
    by: Dict[str, List[int]] = {}
    for i, s in enumerate(sources):
        for m in _EMAIL.findall(f"{s['title']} {s['text']}"):
            addr = m.strip(".,;:\"'()<>").lower()
            if "@" in addr and not addr.endswith((".png", ".jpg", ".gif", ".webp")):
                by.setdefault(addr, [])
                if i not in by[addr]:
                    by[addr].append(i)
    out = []
    for addr, idx in by.items():
        c = _cand("email", addr, addr, idx)
        domain = registered_domain(addr.rpartition("@")[2])
        if not any(domain == registered_domain(d) for d in own_domains):
            c["rejected"] = "not on the company's own domain"
        elif not is_role_inbox(addr):
            c["rejected"] = "a personal-looking address (only shared inboxes such as info@ are shown)"
        elif all(sources[i]["conflict"] for i in idx):
            c["rejected"] = "the page is about a different place"
        out.append(c)
    return out


def score(cands: List[Dict[str, Any]], sources: List[Dict[str, Any]], facts: Dict[str, Any], own_domains: List[str]) -> None:
    """Fills in each candidate's points and total. A candidate that is already rejected is still scored (it shows in the audit)."""
    name = facts.get("name") or ""
    reg = {"website": registered_domain(facts.get("website") or facts.get("domain") or ""), "phone": national(facts.get("phone")),
           "email": str(facts.get("email") or "").lower()}
    own = [registered_domain(d) for d in own_domains]
    own_backed = {id(c): any(sources[i]["domain"] in own for i in c["sources"]) for c in cands}
    for c in cands:
        src = [sources[i] for i in c["sources"]]
        pts: Dict[str, int] = {}
        if c["field"] == "website":
            if domain_matches_name(c["key"], name):
                pts["own_site"] = POINTS["own_site"]
        elif own_backed[id(c)]:
            pts["own_site"] = POINTS["own_site"]
        if any(s["place"] for s in src):
            pts["place_on_page"] = POINTS["place_on_page"]
        if c["field"] == "website":
            others = [s for j, s in enumerate(sources) if j not in c["sources"] and s["domain"] != c["key"]]
            if any(c["key"] in squash(s["text"]) or c["key"] in s["text"].lower() for s in others):
                pts["second_source"] = POINTS["second_source"]
        elif len({s["domain"] for s in src if s["domain"]}) >= 2:
            pts["second_source"] = POINTS["second_source"]
        if any(mentions(name, s["title"]) or (s["read"] and mentions(name, s["text"][:800])) for s in src):  # the title, or the top of the page we read
            pts["name_in_title"] = POINTS["name_in_title"]
        if reg[c["field"]] and (c["key"] == reg[c["field"]]):
            pts["matches_register"] = POINTS["matches_register"]
        elif c["field"] == "website":
            # a page we read from this site that shows a phone or email our own records already hold for the company
            known_phone, known_email = national(facts.get("phone")), str(facts.get("email") or "").lower().strip()
            known_num = str(facts.get("company_number") or "").strip()
            read = [s for s in src if s["read"]]
            matches_num = bool(known_num and any(company_number_in(known_num, s["text"]) for s in read))
            matches_contact = bool(read and any((known_phone and known_phone in numbers_in(s["text"])) or (known_email and known_email in s["text"].lower()) for s in read))
            if matches_num or matches_contact:
                pts["matches_register"] = POINTS["matches_register"]
            if matches_num and not pts.get("place_on_page"):
                pts["place_on_page"] = POINTS["place_on_page"]
        best = max((s["score"] for s in src), default=0.0)
        if best >= 0.7:
            pts["relevance"] = min(POINTS["relevance"], round(10 * best))
        if c["field"] != "website" and src and all(s["listing"] for s in src):
            pts["directory_only"] = POINTS["directory_only"]
        c["points"] = pts
    # a rival that is backed by the company's own site beats one that is not: the one without it loses points
    for field in {c["field"] for c in cands}:
        group = [c for c in cands if c["field"] == field and not c["rejected"]]
        if field != "website" and any(own_backed[id(c)] for c in group):
            for c in group:
                if not own_backed[id(c)]:
                    c["points"]["disagree"] = POINTS["disagree"]
    for c in cands:
        c["score"] = sum(c["points"].values())


def decide(cands: List[Dict[str, Any]], threshold: int = THRESHOLD, margin: int = MARGIN) -> Tuple[Optional[Dict[str, Any]], str]:
    """The one winner of a field, or (None, why not). Needs the threshold, and a lead of the margin over the next candidate."""
    live = sorted((c for c in cands if not c["rejected"]), key=lambda c: c["score"], reverse=True)
    if not live:
        return None, "no usable candidate"
    best = live[0]
    if best["score"] < threshold:
        return None, f"the best candidate scored {best['score']}, under {threshold}"
    if len(live) > 1 and best["score"] - live[1]["score"] < margin:
        return None, f"the top two are too close ({best['score']} and {live[1]['score']}, under {margin} apart)"
    return best, ""


def label(points: int) -> str:
    return "high" if points >= HIGH else "good"


def audit_of(cands: List[Dict[str, Any]], sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """What was considered and why, for support: every candidate with its points, its sources and any rejection."""
    return [{"field": c["field"], "value": c["value"], "score": c["score"], "points": c["points"], "rejected": c["rejected"],
             "sources": [sources[i]["url"] for i in c["sources"]][:4]} for c in sorted(cands, key=lambda c: -c["score"])[:12]]
