"""Find a company's or a person's public LinkedIn page through web search.

Only public search results are used: the web search (limited to linkedin.com) returns page addresses with their titles and snippets. LinkedIn
itself is never fetched or scraped. Each address is scored against what we know (the name, the company, the place). A clear winner is used; when
no candidate is clearly right the best few are returned for the person to pick, and the pick teaches the next lookup (see contact_choices).
Results are kept on the company record: a found page for 90 days, a miss for 7."""
from __future__ import annotations

import copy
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from app.services import contact_choices as CH
from app.services import guardrail as G

logger = logging.getLogger(__name__)

FOUND_DAYS = 90
MISS_DAYS = 7
_COMPANY = re.compile(r"^/(?:company|school|showcase)/([^/?#]+)", re.I)
_PERSON = re.compile(r"^/in/([^/?#]+)", re.I)


def clean_url(url: str) -> str:
    """https://uk.linkedin.com/company/acme-ltd/?trk=x -> https://www.linkedin.com/company/acme-ltd (or "" when it is not a profile page)."""
    p = urlparse(str(url or "").strip())
    host = (p.netloc or "").lower()
    if not (host == "linkedin.com" or host.endswith(".linkedin.com")):
        return ""
    for rx in (_COMPANY, _PERSON):
        m = rx.match(p.path or "")
        if m:
            return f"https://www.linkedin.com{p.path.split(m.group(1))[0]}{m.group(1)}"
    return ""


def _flat(text: str) -> str:
    return G.squash(text)


_UK = re.compile(r"\b(uk|united kingdom|england|scotland|wales|london|britain|british)\b", re.I)
_ELSEWHERE = re.compile(r"\b(usa|u\.s\.|united states|america|australia|south africa|singapore|malaysia|uae|dubai|canada|india|new zealand|mauritius|botswana|kenya|nigeria|germany|france|italy|spain)\b", re.I)


_OK_REST = {"plc", "ltd", "limited", "uk", "gb", "uki", "official", "group", "unitedkingdom", "britain", "ukofficial", "officialuk", "company", "co"}


def extra_words_penalty(slug: str, joined: str) -> int:
    """-12 when the page's address is the brand plus other words (greggsfoundation, nandoscareersuk): a different arm of the business, not the business."""
    if joined and slug.startswith(joined):
        rest = slug[len(joined):]
        if rest and rest not in _OK_REST:
            return -12
    return 0


def region_points(text: str) -> int:
    """+8 when the result talks about the UK only, -10 when it talks about another country only: the same brand has a page per country."""
    uk, away = bool(_UK.search(text or "")), bool(_ELSEWHERE.search(text or ""))
    return 8 if uk and not away else -10 if away and not uk else 0


def score_company(row: Dict[str, Any], name: str, postcode: str, area: str) -> int:
    """0-100: how likely this LinkedIn company page is the company. The name words in the page title and address are most of it."""
    words = G.words_of(name)
    if not words:
        return 0
    title = _flat(row.get("title") or "")
    slug = _flat((urlparse(row["url"]).path or "").split("/")[-1])
    text = _flat(f"{row.get('title') or ''} {row.get('snippet') or ''} {row.get('summary') or ''}")
    in_title = sum(1 for w in words if w in title) / len(words)
    in_slug = sum(1 for w in words if w in slug) / len(words)
    pts = 55 * max(in_title, in_slug) + 10 * min(in_title, in_slug)
    if G._place_hit(f"{row.get('title') or ''} {row.get('snippet') or ''} {row.get('summary') or ''}", postcode, area):
        pts += 20
    if "/company/" in row["url"]:
        pts += 10
    if "/showcase/" in row["url"]:  # a product page under a company, not the company
        pts -= 20
    if G.squash(name) and G.squash(name) in text:
        pts += 5
    pts += 8 * float(row.get("score") or 0)  # the search engine's own relevance
    from app.services import search_recipe as R

    squashed = G.squash((urlparse(row["url"]).path or "").split("/")[-1])
    pts += extra_words_penalty(slug, "".join(words))
    if squashed and squashed == G.squash(name):  # greggs-plc for GREGGS PLC: the page named exactly as the register names the company
        pts += 35
    elif squashed and squashed == G.squash(R.plain_name(name)):
        pts += 15
    pts += region_points(f"{row.get('title') or ''} {row.get('snippet') or ''} {row.get('summary') or ''}")
    return int(max(0, min(100, pts)))


def score_person(row: Dict[str, Any], first: str, last: str, company: str, area: str) -> int:
    """0-100: how likely this LinkedIn profile is this person at this company. Both names, then the company in the headline."""
    f, l = _flat(first), _flat(last)
    if not f or not l:
        return 0
    title = _flat(row.get("title") or "")
    slug = _flat((urlparse(row["url"]).path or "").split("/")[-1])
    text = _flat(f"{row.get('title') or ''} {row.get('snippet') or ''} {row.get('summary') or ''}")
    pts = 0
    if f in title and l in title:
        pts += 55
    elif f in slug and l in slug:
        pts += 45
    elif l in title or l in slug:
        pts += 15
    if G.mentions(company, text):
        pts += 30
    if area and _flat(area) in text:
        pts += 10
    return int(min(100, pts))


def _rank(rows: List[Dict[str, Any]], kind: str, scorer) -> List[Dict[str, Any]]:
    by: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        url = clean_url(r.get("url") or "")
        if not url or (kind == "company") != ("/company/" in url or "/school/" in url or "/showcase/" in url):
            continue
        cand = by.setdefault(url, {"field": "linkedin", "value": url, "key": url, "sources": [], "rejected": "", "score": 0, "points": {}})
        cand["score"] = max(cand["score"], scorer({**r, "url": url}))
        cand["_row"] = r
    return sorted(by.values(), key=lambda c: -c["score"])


def decide(cands: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    winner, _ = G.decide(cands)
    return winner


def to_options(cands: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for c in [c for c in cands if c["score"] >= CH.FLOOR][: CH.MAX_OPTIONS]:
        row = c.get("_row") or {}
        out.append({"value": c["value"], "score": c["score"], "label": CH.label_of(c["score"]), "sources": [],
                    "title": (row.get("title") or "")[:140], "note": (row.get("snippet") or row.get("summary") or "")[:160]})
    return out


def fresh(entry: Optional[Dict[str, Any]], now: Optional[datetime] = None) -> bool:
    """Is a saved lookup still good: a found page for 90 days, a miss for 7."""
    if not entry or not entry.get("at"):
        return False
    try:
        age = ((now or datetime.utcnow()) - datetime.fromisoformat(str(entry["at"]).rstrip("Z"))).days
    except ValueError:
        return False
    return age <= (FOUND_DAYS if entry.get("url") else MISS_DAYS)


def entry_key(person: str = "") -> str:
    return f"linkedin:{person}" if person else "linkedin"


async def find(db: Any, biz: Any, person: Optional[Dict[str, str]] = None, *, refresh: bool = False, hint: str = "") -> Dict[str, Any]:
    """{url, options, cached, searched}. `person` is {first_name, last_name}. A saved answer is reused; a trusted pick from other organisations
    is used without searching. Never raises: a failed search finds nothing."""
    from app.services import enrichment_service as ES

    raw = copy.deepcopy(biz.raw_data or {})  # a copy all the way down: changing a nested dict in place would not be seen as a change
    store = dict(raw.get("linkedin") or {})
    who = f"{person.get('first_name', '')} {person.get('last_name', '')}".strip() if person else ""
    slot = store.setdefault("people", {}).get(who) if person else store.get("company")
    hint = " ".join(str(hint or "").split())[:300]
    if slot and fresh(slot) and not refresh and not hint:
        return {"url": slot.get("url", ""), "options": slot.get("options", []), "cached": True, "searched": False}
    kind = entry_key(who)
    taught = "" if hint else CH.trusted(await CH.rows_for(db, biz.id, kind))
    if taught:
        found = {"url": taught, "options": [], "at": datetime.utcnow().isoformat() + "Z", "by": "users"}
        _save(biz, raw, store, who, found, bool(person))
        return {"url": taught, "options": [], "cached": False, "searched": False, "taught": True}
    area = biz.region or ""
    if person:
        query = f'{who} {biz.name} LinkedIn'
    else:
        from app.services import search_recipe as R

        query = f'{R.plain_name(biz.name) or biz.name} UK LinkedIn company page'.strip()  # the registered town is often not where the page is
    if hint:
        query = f"{query} {hint}"
    try:
        rows = await ES.search_web(query, max_results=8, include_domains=["linkedin.com"], must_mention=None, depth="basic")
    except Exception as err:  # a failed search is a miss that is not remembered
        logger.warning("linkedin search failed for %s: %s", biz.name, err)
        return {"url": "", "options": [], "cached": False, "searched": False, "failed": True}
    if person:
        cands = _rank(rows, "person", lambda r: score_person(r, person.get("first_name", ""), person.get("last_name", ""), biz.name, area))
    else:
        cands = _rank(rows, "company", lambda r: score_company(r, biz.name, biz.postcode or "", area))
    winner = decide(cands)
    options = [] if winner else CH.annotate(to_options(cands), await CH.rows_for(db, biz.id, kind))
    row = (winner or {}).get("_row") or {}
    found = {"url": winner["value"] if winner else "", "options": options, "at": datetime.utcnow().isoformat() + "Z",
             "title": (row.get("title") or "")[:160] if winner else "", "note": (row.get("snippet") or row.get("summary") or "")[:300] if winner else ""}
    _save(biz, raw, store, who, found, bool(person))
    return {"url": found["url"], "options": options, "cached": False, "searched": True}


def _save(biz: Any, raw: Dict[str, Any], store: Dict[str, Any], who: str, entry: Dict[str, Any], is_person: bool) -> None:
    if is_person:
        store.setdefault("people", {})[who] = entry
    else:
        store["company"] = entry
    raw["linkedin"] = store
    biz.raw_data = raw


def chosen(biz: Any, who: str, url: str) -> None:
    """Keep the page a person picked as this company's (or person's) LinkedIn."""
    raw = copy.deepcopy(biz.raw_data or {})  # a copy all the way down: changing a nested dict in place would not be seen as a change
    store = dict(raw.get("linkedin") or {})
    slot = ((store.get("people") or {}).get(who) if who else store.get("company")) or {}
    meta = next((o for o in slot.get("options", []) if o.get("value") == url), {})
    _save(biz, raw, store, who, {"url": url, "options": [], "at": datetime.utcnow().isoformat() + "Z", "by": "pick",
                                  "title": meta.get("title", ""), "note": meta.get("note", "")}, bool(who))


def allowed(biz: Any, who: str, url: str) -> bool:
    """A pick must be one of the options that lookup showed (or the answer it already holds): nothing else can be stored through the pick call."""
    store = (biz.raw_data or {}).get("linkedin") or {}
    slot = (store.get("people") or {}).get(who) if who else store.get("company")
    return bool(slot) and (url == slot.get("url") or any(o.get("value") == url for o in slot.get("options", [])))
