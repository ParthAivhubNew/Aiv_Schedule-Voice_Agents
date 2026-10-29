"""The one query practice every company web search uses.

    {what we want} of {company name}, a {what it does} in {area}

{what we want} is "Official website", "Phone number", "Email address" or "Contact page". Empty slots are left out. The query text has
no postcode, quotes or site: operators: the postcode is used afterwards, to check results. Narrowing to a company's own site is done
with Tavily's include_domains setting, never with query text. exact_match is not used.

The fixed Tavily settings and the directory/social domains that are always excluded live here too, so the practice is in one place.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

WANT = {"website": "Official website", "phone": "Phone number", "email": "Email address", "contact": "Contact page"}

# Fixed for every search. basic = 1 credit (advanced = 2): advanced is used once, as a retry, never by default.
SETTINGS: Dict[str, Any] = {"search_depth": "basic", "max_results": 5, "country": "united kingdom", "include_usage": True}

# Directories, review sites and social pages: they list companies, they are not the company.
EXCLUDE_DOMAINS: List[str] = [
    "yell.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "tiktok.com", "youtube.com", "pinterest.com",
    "tripadvisor.co.uk", "tripadvisor.com", "trustpilot.com", "192.com", "thomsonlocal.com", "cylex-uk.co.uk", "hotfrog.co.uk",
    "scoot.co.uk", "freeindex.co.uk", "checkatrade.com", "companieshouse.gov.uk", "find-and-update.company-information.service.gov.uk",
    "endole.co.uk", "opencorporates.com", "dnb.com", "companycheck.co.uk", "ratings.food.gov.uk", "wikipedia.org", "gov.uk",
]

MAX_SEARCHES = 6  # per lookup, the retries included

_LEGAL = re.compile(r"\b(ltd|limited|plc|llp|lp|inc|incorporated|cic|c\.i\.c)\b\.?", re.I)
_POSTCODE = re.compile(r"\b[A-Z]{1,2}\d[A-Z\d]?(?:\s*\d[A-Z]{2})?\b", re.I)  # a full postcode (SG4 0QY) or just its first half (SG4, LS1)
_SIC_NOISE = re.compile(r"\b(n\.?e\.?c\.?|activities|other|general|support|service|services)\b|^\s*\d{4,5}\s*[-:]?\s*", re.I)


def plain_name(name: str) -> str:
    """The company's name without its legal ending or odd punctuation: Teddy Bears Pre-School Ltd -> Teddy Bears Pre-School."""
    n = _LEGAL.sub(" ", str(name or ""))
    n = re.sub(r"[/|@]", " ", n).replace("&", " and ")
    n = re.sub(r"[^\w\s'\-]", " ", n)
    return re.sub(r"\s+", " ", n).strip(" -")


def run_together(name: str) -> str:
    """The first two words run together, the rest as written: Teddy Bears Pre-School -> TeddyBears Pre-School. Many sites spell a name
    this way. Only for a name of two to five words, and only when the joined word is long enough to mean something."""
    words = plain_name(name).split()
    if not 2 <= len(words) <= 5 or len(words[0] + words[1]) < 6:
        return ""
    return " ".join([words[0] + words[1]] + words[2:])


def area_of(region: str, postcode: str = "") -> str:
    """Where the company is, in words: the register's area with the postcode taken out (North Hertfordshire SG4 0QY -> North Hertfordshire)."""
    text = _POSTCODE.sub(" ", str(region or ""))
    if postcode:
        text = text.replace(postcode, " ")
    return re.sub(r"\s+", " ", text).strip(" ,-")


def what_it_does(industry: str) -> str:
    """A register industry line in plain words ('56101 - Licensed restaurants' -> 'licensed restaurants'). Left out when nothing is left."""
    first = str(industry or "").split(" | ")[0]
    if re.search(r"premises|n\.?e\.?c|^\s*other\b|not elsewhere", first, re.I):
        return ""  # 'Caring Premises' and the like say nothing a search engine can use
    words = _SIC_NOISE.sub(" ", first).lower()
    words = re.sub(r"[^a-z\s\-/]", " ", words)
    words = re.sub(r"\s+", " ", words).strip(" -/")
    return words if 3 <= len(words) <= 40 else ""


def build_query(want: str, facts: Dict[str, Any], *, name: Optional[str] = None) -> str:
    """{want} of {name}, a {what it does} in {area}: with any empty slot dropped."""
    label = WANT.get(want, WANT["website"])
    who = name or plain_name(facts.get("name") or "")
    what = what_it_does(facts.get("industry") or "")
    where = area_of(facts.get("region") or "", facts.get("postcode") or "")
    text = f"{label} of {who}"
    if what:
        text += f", {what}"
    if where:
        text += f" in {where}"
    return text[:400]


def plan(facts: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The searches for one company, in the order they are tried. The first asks for the website; the others only run when needed
    (see web_harness): a name spelled differently, then the phone and email. Each is {want, query, retry}."""
    base = plain_name(facts.get("name") or "")
    steps = [{"want": "website", "query": build_query("website", facts), "retry": False},
             {"want": "contact", "query": build_query("phone", facts), "retry": False}]
    joined = run_together(facts.get("name") or "")
    if joined and joined.lower() != base.lower() and len(joined) >= 6:
        steps.append({"want": "website", "query": build_query("website", facts, name=joined), "retry": True})
    trading = str(facts.get("trading_as") or "").strip()
    if trading and trading.lower() != base.lower():
        steps.append({"want": "website", "query": build_query("website", facts, name=plain_name(trading)), "retry": True})
    return steps[:MAX_SEARCHES]
