"""A company's public Facebook and X pages, and the one place that lists every link we hold for it.

Same method as the LinkedIn lookup: a web search limited to the network's own domain returns page addresses with titles and snippets; each is
scored against the company's name and place; a clear winner is used, otherwise the best few go to the person to choose from. Nothing is fetched
from the network itself. Results live on the company record: a found page for 90 days, a miss for 7."""
from __future__ import annotations

import copy
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from app.services import contact_choices as CH
from app.services import guardrail as G
from app.services import linkedin_lookup as LI

logger = logging.getLogger(__name__)

NETWORKS: Dict[str, Dict[str, Any]] = {
    "facebook": {"domains": ["facebook.com"], "label": "Facebook page"},
    "x": {"domains": ["x.com", "twitter.com"], "label": "X profile"},
    "instagram": {"domains": ["instagram.com"], "label": "Instagram profile"},
}
_FB_RESERVED = {"sharer", "sharer.php", "share", "share.php", "dialog", "plugins", "groups", "events", "watch", "marketplace", "login", "login.php", "help",
                "policies", "privacy", "hashtag", "photo", "photos", "photo.php", "pages", "people", "profile.php", "story.php", "permalink.php", "public",
                "l.php", "tr", "popular", "reel", "reels", "stories", "gaming", "games", "business", "ads", "about", "legal", "recover"}
_X_RESERVED = {"i", "intent", "share", "search", "home", "explore", "hashtag", "login", "signup", "settings", "messages", "notifications", "compose",
               "tos", "privacy", "about", "download", "jobs", "who_to_follow", "account"}
_HOME = {"uk", "gb", "uki", "unitedkingdom", "britain", "uksandi", "ukireland", "ukandireland"}
_ABROAD = {"usa", "us", "uae", "sa", "rsa", "za", "my", "sg", "au", "aus", "nz", "ca", "canada", "india", "botswana", "ireland", "ire", "irel", "france", "germany", "kenya", "nigeria", "ghana", "pk"}
_X_HANDLE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
_IG_RESERVED = {"popular", "p", "reel", "reels", "explore", "accounts", "stories", "tv", "direct", "about", "legal", "web", "developer", "directory", "challenge"}
_IG_HANDLE = re.compile(r"^[A-Za-z0-9_.]{1,30}$")


def clean_url(network: str, url: str) -> str:
    """The profile address in one plain form, or "" when the address is a post, a share link, a group or anything that is not a page."""
    p = urlparse(str(url or "").strip())
    host = (p.netloc or "").lower()
    first = next((seg for seg in (p.path or "").split("/") if seg), "")
    if network == "facebook":
        if not (host == "facebook.com" or host.endswith(".facebook.com")) or not first or first.lower() in _FB_RESERVED:
            return ""
        return f"https://www.facebook.com/{first}"
    if network == "x":
        if not (host in ("x.com", "twitter.com") or host.endswith(".x.com") or host.endswith(".twitter.com")):
            return ""
        if not _X_HANDLE.match(first) or first.lower() in _X_RESERVED:
            return ""
        return f"https://x.com/{first}"
    if network == "instagram":
        if not (host == "instagram.com" or host.endswith(".instagram.com")) or first.lower() in _IG_RESERVED or not _IG_HANDLE.match(first):
            return ""
        return f"https://www.instagram.com/{first}"
    return ""


def score(row: Dict[str, Any], name: str, postcode: str, area: str) -> int:
    """0-100 how likely this page is the company's: its name words in the page title or address, then the place."""
    words = G.words_of(name)
    if not words:
        return 0
    title = G.squash(row.get("title") or "")
    slug = G.squash((urlparse(row["url"]).path or "").strip("/"))
    text = G.squash(f"{row.get('title') or ''} {row.get('snippet') or ''} {row.get('summary') or ''}")
    in_title = sum(1 for w in words if w in title) / len(words)
    in_slug = sum(1 for w in words if w in slug) / len(words)
    lead = words[0]  # brands often use only the first word of the registered name ("Pret" for "Pret A Manger (Europe) Limited")
    if len(lead) >= 4:
        if slug.startswith(lead):
            in_slug = max(in_slug, 0.7)
        if lead in title:
            in_title = max(in_title, 0.7)
    pts = 50 * in_slug + 30 * in_title
    if G._place_hit(f"{row.get('title') or ''} {row.get('snippet') or ''} {row.get('summary') or ''}", postcode, area):
        pts += 10
    if G.squash(name) and G.squash(name) in text:
        pts += 10
    joined = "".join(words)
    if joined and slug.startswith(joined):  # the shorter the address beyond the name, the more likely it is the brand's own page
        pts += max(0, 12 - (len(slug) - len(joined)))
    if "official" in text:
        pts += 5
    if " uk " in f" {text} " or "unitedkingdom" in text:
        pts += 3
    pts += 10 * float(row.get("score") or 0)  # the search engine's own relevance
    from app.services import search_recipe as R

    if slug and slug == G.squash(R.plain_name(name)):  # the address is exactly the brand name
        pts += 15
    pts += LI.region_points(f"{row.get('title') or ''} {row.get('snippet') or ''} {row.get('summary') or ''}")
    if joined and slug.startswith(joined):
        rest = slug[len(joined):]
        if rest in _HOME:
            pts += 15
        elif rest in _ABROAD:  # the same brand's page for another country
            pts -= 15
        else:
            pts += LI.extra_words_penalty(slug, joined)
    if in_slug == 0:  # a page whose address does not carry the name is never offered: it is a post or another business
        pts = min(pts, 28)
    return int(max(0, min(100, pts)))


def rank(rows: List[Dict[str, Any]], network: str, name: str, postcode: str, area: str) -> List[Dict[str, Any]]:
    by: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        url = clean_url(network, r.get("url") or "")
        if not url:
            continue
        cand = by.setdefault(url, {"field": network, "value": url, "key": url, "sources": [], "rejected": "", "score": 0, "points": {}})
        s = score({**r, "url": url}, name, postcode, area)
        if s >= cand["score"]:
            cand["score"], cand["_row"] = s, r
    return sorted(by.values(), key=lambda c: -c["score"])


SITE_READ_DAYS = 30


async def read_own_site(biz: Any, *, site: str = "", force: bool = False) -> Dict[str, str]:
    """The pages the company's own website links to (its footer and contact page): free, and the company itself says they are its pages.
    Read at most once in SITE_READ_DAYS; a network already held is never overwritten. Search engines often do not list X or Facebook pages
    at all, so this is the first place to look. Returns what was kept, by network."""
    from app.services import company_contacts as CC
    from app.services import enrichment_service as ES

    site = (site or getattr(biz, "website", "") or getattr(biz, "domain", "") or "").strip()  # `site` is a website found by the Google step
    raw = biz.raw_data or {}
    if not site or (not force and CC._age_days(raw.get("site_socials_at")) <= SITE_READ_DAYS):
        return {}
    try:
        import asyncio

        crawled = await asyncio.wait_for(ES.crawl_homepage_contacts(site), timeout=25)
    except Exception as err:
        logger.info("own-site read failed for %s: %s", getattr(biz, "name", ""), err)
        return {}  # nothing is remembered, so the next press reads it again
    links: Dict[str, str] = {}
    for key, url in (crawled.get("socials") or {}).items():
        net = "x" if key in ("twitter", "x") else key
        if net in NETWORKS and not links.get(net):
            links[net] = clean_url(net, url if isinstance(url, str) else "")
        elif net == "linkedin" and "/company/" in str(url):
            links[net] = str(url).split("?")[0]
    links = {n: u for n, u in links.items() if u}
    stamp = datetime.utcnow().isoformat() + "Z"
    CC._keep_socials(biz, links, stamp)
    raw2 = copy.deepcopy(biz.raw_data or {})
    raw2["site_socials_at"] = stamp
    biz.raw_data = raw2
    return links


def _slot(biz: Any, network: str) -> Dict[str, Any]:
    return (((biz.raw_data or {}).get("socials") or {}).get(network)) or {}


def _put(biz: Any, network: str, entry: Dict[str, Any]) -> None:
    raw = copy.deepcopy(biz.raw_data or {})  # a copy all the way down, so the change is seen
    raw.setdefault("socials", {})[network] = entry
    biz.raw_data = raw


async def find(db: Any, biz: Any, network: str, *, refresh: bool = False, hint: str = "") -> Dict[str, Any]:
    """{url, options, cached, searched}. A saved answer is reused, a value other organisations confirmed is used without searching, and a failed
    search finds nothing without being remembered."""
    from app.services import enrichment_service as ES

    cfg = NETWORKS[network]
    slot = _slot(biz, network)
    hint = " ".join(str(hint or "").split())[:300]
    if slot and LI.fresh(slot) and not refresh and not hint:
        return {"url": slot.get("url", ""), "options": slot.get("options", []), "cached": True, "searched": False}
    taught = "" if hint else CH.trusted(await CH.rows_for(db, biz.id, network))
    now = datetime.utcnow().isoformat() + "Z"
    if taught:
        _put(biz, network, {"url": taught, "options": [], "at": now, "by": "users"})
        return {"url": taught, "options": [], "cached": False, "searched": False}
    from app.services import search_recipe as R

    plain = R.plain_name(biz.name) or biz.name
    # The registered town often is not where the brand's page is, so the first search is the name alone; the town is added only if that finds nothing usable.
    queries = [f"{plain} UK {cfg['label']}"] + ([f"{plain} {biz.region} {cfg['label']}"] if biz.region else [])
    cands: List[Dict[str, Any]] = []
    try:
        for q in queries:
            rows = await ES.search_web(f"{q} {hint}".strip(), max_results=10, include_domains=cfg["domains"], must_mention=None, depth="basic")
            cands = rank(rows, network, biz.name, biz.postcode or "", biz.region or "")
            if any(c["score"] >= CH.FLOOR for c in cands):
                break
    except Exception as err:
        logger.warning("%s search failed for %s: %s", network, biz.name, err)
        return {"url": "", "options": [], "cached": False, "searched": False, "failed": True}
    winner, _ = G.decide(cands)
    options = [] if winner else CH.annotate(LI.to_options(cands), await CH.rows_for(db, biz.id, network))
    row = (winner or {}).get("_row") or {}
    _put(biz, network, {"url": winner["value"] if winner else "", "options": options, "at": now,
                        "title": (row.get("title") or "")[:160] if winner else "", "note": (row.get("snippet") or row.get("summary") or "")[:300] if winner else ""})
    return {"url": winner["value"] if winner else "", "options": options, "cached": False, "searched": True}


def chosen(biz: Any, network: str, url: str) -> None:
    meta = next((o for o in _slot(biz, network).get("options", []) if o.get("value") == url), {})
    _put(biz, network, {"url": url, "options": [], "at": datetime.utcnow().isoformat() + "Z", "by": "pick", "title": meta.get("title", ""), "note": meta.get("note", "")})


def allowed(biz: Any, network: str, url: str) -> bool:
    """A pick must be one of the options the lookup showed, or the answer it already holds."""
    slot = _slot(biz, network)
    return bool(slot) and (url == slot.get("url") or any(o.get("value") == url for o in slot.get("options", [])))


def links_of(raw: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Every public page we hold for the company, by network. Empty string when none is known."""
    raw = raw or {}
    socials = raw.get("socials") or {}
    return {"linkedin": ((raw.get("linkedin") or {}).get("company") or {}).get("url", "") or "",
            **{n: (socials.get(n) or {}).get("url", "") or "" for n in NETWORKS}}
