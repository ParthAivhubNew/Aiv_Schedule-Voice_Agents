"""The AI search harness: find a company's own website, phone and email from the open web, and show only what checks out.

1. Search APIs (DeepSeek search, then Tavily) return pages about the company.
2. The company's own site, if one of the results looks like it, is read in full through DeepSeek's page fetch.
3. An AI model reads those sources and says which one is the company's own website and where each phone number and email is written.
4. Code, not the model, then checks every answer: the website must be one of the results and must not be a directory or another
   business; a phone number must be UK-shaped and must be written in the very source the model named; an email must be written
   in a source and sit on the company's own domain. Anything that fails is dropped, so nothing the model made up reaches a customer.

Without an AI key, step 3 is done by plain rules on the same sources, and step 4 still applies.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from app.services import company_contacts as CC
from app.services import enrichment_service as ES
from app.services import llm_gateway, site_check

logger = logging.getLogger("web_harness")

MAX_SOURCES = 10
FETCH_PAGES = 2
PAGE_CHARS = 1800
EVIDENCE_CHARS = 14000

_SCHEMA = {
    "type": "object",
    "properties": {
        "website_source": {"type": "integer", "description": "Number of the source that is this business's OWN website. -1 if none of them is."},
        "phones": {"type": "array", "description": "UK phone numbers of this business, each exactly as written in a source.",
                   "items": {"type": "object", "properties": {"number": {"type": "string"}, "source": {"type": "integer"}}, "required": ["number", "source"]}},
        "emails": {"type": "array", "description": "Email addresses of this business, each exactly as written in a source.",
                   "items": {"type": "object", "properties": {"address": {"type": "string"}, "source": {"type": "integer"}}, "required": ["address", "source"]}},
        "reason": {"type": "string", "description": "One short sentence: what you found, or why nothing fits."},
    },
    "required": ["website_source", "phones", "emails"],
}

_SYSTEM = (
    "You read web search results about ONE specific UK business and pick out its contact details. Use only the numbered sources given. "
    "website_source is the source that is the business's OWN website: not a directory, a social page, a register, a review or rating "
    "site, or a different business with a similar name. Use -1 if none is. phones and emails must be copied exactly as a source writes "
    "them, with that source's number. Never guess, complete or reformat a number or address, and never use one that a source does not "
    "contain. Hold every source up against what we already know about the business (its place, postcode and what it does): if a "
    "source is about a business with a similar name somewhere else, or in a different line of work, do not use it. If none fits, "
    "return -1 and empty lists."
)


def _squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def _national(raw: str) -> str:
    """A UK number reduced to its digits without the country code or the leading zero, so +44 113 496 0123 and 0113 496 0123 match."""
    d = re.sub(r"\D", "", str(raw or ""))
    if d.startswith("0044"):
        d = d[4:]
    elif d.startswith("44") and len(d) >= 11:
        d = d[2:]
    return d.lstrip("0") if d.startswith("0") else d


def _numbers_in(text: str) -> set:
    return {_national(m) for m in re.findall(r"(?:\+?44|0)[\d\s().\-]{8,16}\d", text or "")}


def _mentions(name: str, text: str) -> bool:
    """Does this source talk about this business? Every real word of its name is in the text (run together or not)."""
    words = site_check._tokens(name)
    squashed = _squash(text)
    return bool(words) and all(w in squashed for w in words)


def _queries(name: str, place: str, facts: Dict[str, Any]) -> List[str]:
    """Most exact first: the name with its postcode, then with its area, then the plain "official website" search. A name written
    differently on the company's own site ("Teddybears" for "Teddy Bears") gets its own query."""
    postcode = str(facts.get("postcode") or "").strip()
    run_together = re.sub(r"[\s\-]+", "", str(name))
    queries = []
    if postcode:
        queries.append(f"{name} {postcode}")
    queries += [f"{name} {place}".strip(), f"{name} official website contact phone".strip()]
    if run_together.lower() != str(name).lower() and len(run_together) >= 6:
        queries.append(f"{run_together} {place}".strip())
    return list(dict.fromkeys(q[:128] for q in queries if q.strip()))[:4]


async def _gather(name: str, place: str, facts: Dict[str, Any]) -> List[Dict[str, Any]]:
    gate = asyncio.Semaphore(2)

    async def run(q: str) -> List[Dict[str, str]]:
        async with gate:
            return await ES.search_open_web(q, max_results=6)

    found: List[Dict[str, Any]] = []
    seen = set()
    for batch in await asyncio.gather(*[run(q) for q in _queries(name, place, facts)]):
        for r in batch:
            url = r.get("url") or ""
            key = urlparse(url).netloc.lower().removeprefix("www.") + urlparse(url).path.rstrip("/")
            if not url or key in seen:
                continue
            seen.add(key)
            found.append({"url": url, "title": r.get("title") or "", "text": (r.get("content") or r.get("summary") or r.get("snippet") or "")[:PAGE_CHARS]})
            if len(found) >= MAX_SOURCES:
                return found
    return found


async def _read_own_site(name: str, sources: List[Dict[str, Any]]) -> None:
    """The results that look like the company's own site are fetched in full, so a phone number in the page footer is seen."""
    own = [s for s in sources if site_check.plausible_site(name, s["url"])][:FETCH_PAGES]
    pages = await asyncio.gather(*[ES.fetch_deepseek(s["url"]) for s in own], return_exceptions=True)
    for s, page in zip(own, pages):
        if isinstance(page, dict) and page.get("content"):
            s["text"] = (s["text"] + "\n" + page["content"][:PAGE_CHARS * 2])[:PAGE_CHARS * 2 + 600]
            s["read"] = True


def _evidence(sources: List[Dict[str, Any]]) -> str:
    out, used = [], 0
    for i, s in enumerate(sources):
        block = f"[{i}] {s['url']}\n{s['title']}\n{s['text']}".strip()
        if used + len(block) > EVIDENCE_CHARS:
            break
        out.append(block)
        used += len(block)
    return "\n\n".join(out)


def _homepage(url: str) -> str:
    p = urlparse(url if "://" in url else "https://" + url)
    return f"{p.scheme or 'https'}://{p.netloc}" if p.netloc else url


def _verify(name: str, sources: List[Dict[str, Any]], picked: Dict[str, Any]) -> Dict[str, Any]:
    """Keep only what the sources really say about this business. The model proposes; this decides."""
    def at(i: Any) -> Optional[Dict[str, Any]]:
        return sources[i] if isinstance(i, int) and 0 <= i < len(sources) else None

    website, site_src = "", None
    cand = at(picked.get("website_source"))
    if cand and not site_check.is_listing_host(cand["url"], name) and (site_check.plausible_site(name, cand["url"]) or site_check.same_business(name, cand["title"])):
        website, site_src = _homepage(cand["url"]), cand
    host = site_check._host(website)

    phones: List[str] = []
    for item in picked.get("phones") or []:
        src, num = at((item or {}).get("source")), str((item or {}).get("number") or "").strip()
        if not src or not num or not CC.is_uk_phone(num):
            continue
        if _national(num) not in _numbers_in(src["text"]):
            continue  # the source does not contain this number: the model made it up or mistyped it
        if src is not site_src and not _mentions(name, f"{src['title']} {src['text']}"):
            continue  # a page about some other business
        if num not in phones:
            phones.append(num)

    emails: List[str] = []
    for item in picked.get("emails") or []:
        src, addr = at((item or {}).get("source")), str((item or {}).get("address") or "").strip().lower()
        domain = addr.rpartition("@")[2]
        if not src or "@" not in addr or addr not in src["text"].lower() or not host:
            continue
        if domain == host or domain.endswith("." + host) or host.endswith("." + domain):
            if addr not in emails:
                emails.append(addr)
    used = [s["url"] for s in sources if (s is site_src)]
    return {"website": website, "phones": phones[:5], "emails": emails[:5], "sources": used}


def _by_rules(name: str, sources: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The same answer without an AI model: the first result that looks like the company's own site, and the numbers and addresses
    written on it. The checks in _verify() still apply."""
    for i, s in enumerate(sources):
        if site_check.is_listing_host(s["url"], name) or not site_check.plausible_site(name, s["url"]):
            continue
        emails, phones = ES._harvest_contacts_from_text(s["text"])
        return {"website_source": i, "phones": [{"number": p, "source": i} for p in phones], "emails": [{"address": e, "source": i} for e in emails]}
    return {"website_source": -1, "phones": [], "emails": []}


def _known(name: str, place: str, facts: Dict[str, Any]) -> str:
    """What we already hold about the company, for the model to hold each source up against. Public register facts only: the name,
    where it is and what it does. Never a person's name, and nothing the customer typed about it."""
    lines = [f"Business: {name}", f"Place: {place or 'not given'}"]
    for key, label in (("address", "Registered address"), ("postcode", "Postcode"), ("industry", "What it does (industry)"), ("company_number", "Company number")):
        if str(facts.get(key) or "").strip():
            lines.append(f"{label}: {str(facts[key]).strip()[:160]}")
    for key, label in (("website", "Website we already hold"), ("phone", "Phone we already hold")):
        if str(facts.get(key) or "").strip():
            lines.append(f"{label}: {str(facts[key]).strip()[:120]} (a source agreeing with this is good evidence)")
    return "\n".join(lines)


async def find_company(db: Any, *, name: str, place: str = "", facts: Optional[Dict[str, Any]] = None, scope: str = "leadgen") -> Dict[str, Any]:
    """{website, phones, emails, sources, found, via}. `facts` is what the register holds (address, postcode, industry, company
    number, any website or phone we already have): it sharpens the searches and lets the model check each source fits this exact
    business. Never raises: a failed step just finds less."""
    facts = facts or {}
    out: Dict[str, Any] = {"website": "", "phones": [], "emails": [], "sources": [], "found": False, "via": "none"}
    if not (name or "").strip():
        return out
    sources = await _gather(name, place, facts)
    if not sources:
        return out
    await _read_own_site(name, sources)
    picked = None
    try:
        picked = await llm_gateway.extract_structured(
            system_prompt=_SYSTEM, schema=_SCHEMA, tool_name="company_contacts", db=db, scope=scope, max_tokens=700,
            user_text=f"{_known(name, place, facts)}\n\nSources:\n{_evidence(sources)}")
    except Exception as err:
        logger.warning("harness: the AI step failed (%s); using rules", err)
    out["via"] = "ai" if picked else "rules"
    if not picked:
        picked = _by_rules(name, sources)
    checked = _verify(name, sources, picked)
    out.update(checked)
    out["found"] = bool(checked["website"] or checked["phones"] or checked["emails"])
    logger.info("harness: %r via %s -> website=%s phones=%d emails=%d (%d sources)", name, out["via"], bool(out["website"]), len(out["phones"]), len(out["emails"]), len(sources))
    return out
