"""A company's own page on a directory, review or social site: Yell, Facebook, Checkatrade, TripAdvisor and the like.

Shown in the Website column only when no website of its own was found, always labelled as a listing with the site's name, and only as the exact page
of this one business. A directory's home page, a category page, a search page or a "near me" list is never shown, as a link or in any other way.

Two checks, both must pass:
  1. the address has the shape of one business's page on that site (profile_path below), never a bare domain or a list;
  2. the page is about this company. The page is read when the site lets us (name and place both on it: "confirmed"); when the site keeps readers
     out (Facebook, LinkedIn...) the search result must show the company's name and not another place ("unconfirmed", shown as such).

Whatever else the page shows (a phone, an email) is kept as a note on that page. It is never put in the company's own fields.
This module is also the one list of directory sites the web search leaves out, so the lists cannot drift apart."""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# host -> label, kind, the shape of one business's page (a regex on the path), and whether the site keeps our reader out.
SITES: Dict[str, Dict[str, Any]] = {
    "yell.com": {"label": "Yell", "kind": "directory", "path": r"^/biz/[^/]+/?$"},
    "checkatrade.com": {"label": "Checkatrade", "kind": "directory", "path": r"^/trades/[^/]+/?$"},
    "trustpilot.com": {"label": "Trustpilot", "kind": "review", "path": r"^/review/[^/]+/?$"},
    "tripadvisor.co.uk": {"label": "TripAdvisor", "kind": "review", "path": r"-d\d+-Reviews-[^/]+\.html$"},
    "tripadvisor.com": {"label": "TripAdvisor", "kind": "review", "path": r"-d\d+-Reviews-[^/]+\.html$"},
    "freeindex.co.uk": {"label": "FreeIndex", "kind": "directory", "path": r"^/profile\([^)]+\)_\d+\.htm"},
    "cylex-uk.co.uk": {"label": "Cylex", "kind": "directory", "path": r"^/company/[^/]+-\d+\.html$"},
    "thomsonlocal.com": {"label": "Thomson Local", "kind": "directory", "path": r"^/search/[^/]+/[^/]+/[^/]+/\d+/\d+$"},
    "hotfrog.co.uk": {"label": "Hotfrog", "kind": "directory", "path": r"^/company/[^/]+(?:/[^/]+/(?!admin/)[^/]+/[^/]+)?/?$"},
    "just-eat.co.uk": {"label": "Just Eat", "kind": "directory", "path": r"^/restaurants-[^/]+/menu/?$"},
    "deliveroo.co.uk": {"label": "Deliveroo", "kind": "directory", "path": r"^/menu/[^/]+/[^/]+/[^/]+/?$"},
    "ubereats.com": {"label": "Uber Eats", "kind": "directory", "path": r"^/(?:gb/)?store/[^/]+/[^/]+/?$"},
    "linkedin.com": {"label": "LinkedIn", "kind": "social", "path": r"^/company/[^/]+(?:/.*)?$", "blocked": True},
    "facebook.com": {"label": "Facebook", "kind": "social", "network": "facebook", "blocked": True},
    "instagram.com": {"label": "Instagram", "kind": "social", "network": "instagram", "blocked": True},
    "x.com": {"label": "X", "kind": "social", "network": "x", "blocked": True},
    "twitter.com": {"label": "X", "kind": "social", "network": "x", "blocked": True},
    "tiktok.com": {"label": "TikTok", "kind": "social", "path": r"^/@[^/]+/?$", "blocked": True},
    "youtube.com": {"label": "YouTube", "kind": "social", "path": r"^/(?:@[^/]+|channel/[^/]+|c/[^/]+)/?$", "blocked": True},
}
# Sites that only list businesses and have no profile pages we can recognise, and registers: never offered as a website, only kept out of the search.
OTHER_HOSTS: Tuple[str, ...] = (
    "pinterest.com", "192.com", "scoot.co.uk", "companieshouse.gov.uk", "find-and-update.company-information.service.gov.uk", "endole.co.uk",
    "opencorporates.com", "dnb.com", "companycheck.co.uk", "ratings.food.gov.uk", "wikipedia.org", "gov.uk", "tavily.com", "scamadviser.com",
    "scamdoc.com", "trustprofile.com", "ico.org.uk", "ukphonebook.com", "checkall.co.uk", "uksponsorlist.co.uk", "accountingfirms.co.uk", "churchlist.co.uk",
    "careinspectorate.scot",
)
_LISTS = {"search", "s", "find", "category", "categories", "directory", "browse", "near", "results", "list", "tag", "tags", "city", "cities",
          "location", "locations", "sitemap", "a-z", "atoz", "index", "login", "signup", "help", "about", "blog", "news"}
PAGE_CHARS = 8000
MAX_READS = 2


def hosts() -> List[str]:
    """Every site the web search leaves out: the directories above and the registers."""
    return list(dict.fromkeys([*SITES, *OTHER_HOSTS]))


def search_domains() -> List[str]:
    """The sites the listing search looks in: the ones with a page shape we can check (one entry for each site, X once)."""
    return [h for h in SITES if h != "twitter.com"]


def _host(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    return (urlparse(raw if "://" in raw else "https://" + raw).hostname or "").lower().removeprefix("www.")


def site_of(url: str) -> Tuple[str, Dict[str, Any]]:
    """(host key, entry) when the address is on a site in the list, else ("", {})."""
    host = _host(url)
    for key, entry in SITES.items():
        if host == key or host.endswith("." + key):
            return key, entry
    return "", {}


def exact(url: str, name: str = "") -> str:
    """The address of ONE business's page in its plain form (no tracking, no fragment), or "" when it is anything else: a home page, a category,
    a search, a list, a post, a share link. Unknown directories are accepted only on a plain rule: a path of two or more parts, no list word, and a
    word of the company's name in the address."""
    raw = str(url or "").strip()
    if not raw:
        return ""
    p = urlparse(raw if "://" in raw else "https://" + raw)
    path = p.path or ""
    key, entry = site_of(raw)
    if key:
        net = entry.get("network")
        if net:
            from app.services import social_lookup as SL

            parts = [seg for seg in path.split("/") if seg]
            if net == "facebook" and parts[:1] == ["p"] and len(parts) == 2:  # a Page address written /p/Name-123456
                return f"https://www.facebook.com/p/{parts[1]}"
            if len(parts) > 1 and parts[1].lower() not in ("about", "about_details", "home"):
                # /Page/posts/..., /handle/status/...: a post names whoever posted it. It counts only when the page's own name is the company's,
                # and then it is the page itself that is kept, never the post.
                from app.services import guardrail as G

                words = G.words_of(name)
                if not (words and all(w in G.squash(parts[0]) for w in words)):
                    return ""
            return SL.clean_url(net, f"https://{_host(raw)}/{parts[0]}") if parts else ""
        if not re.search(entry["path"], path, re.I):
            return ""
        if key == "linkedin.com":
            return "https://www.linkedin.com/" + "/".join(path.strip("/").split("/")[:2])
        return f"https://{p.netloc.lower()}{path}" if path.endswith((".html", ".htm")) else f"https://{p.netloc.lower()}{path.rstrip('/')}"
    from app.services import site_check

    if not site_check.is_listing_host(raw, name) or any(h in _host(raw) for h in OTHER_HOSTS):
        return ""
    parts = [s for s in path.split("/") if s]
    if len(parts) < 2 or parts[0].lower() in _LISTS or parts[-1].lower() in _LISTS:
        return ""
    from app.services import guardrail as G

    flat = G.squash(path)
    if not any(w in flat for w in G.words_of(name)):
        return ""
    return f"https://{p.netloc.lower()}{path.rstrip('/')}"


def candidates(rows: List[Dict[str, Any]], name: str, postcode: str, area: str) -> List[Dict[str, Any]]:
    """The exact pages in the search results that are about this company, best first. A page with another business's name, or another
    place's postcode and none of ours, is left out. {url, site, kind, score, place, title, snippet}."""
    from app.services import guardrail as G

    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        url = exact(r.get("url") or "", name)
        if not url:
            continue
        title, snippet = str(r.get("title") or ""), str(r.get("snippet") or r.get("summary") or r.get("text") or "")
        text = f"{title}\n{snippet}"
        slug = G.squash(urlparse(url).path)
        named = G.mentions(name, f"{title} {urlparse(url).path}") or all(w in slug for w in G.words_of(name))
        if not named:
            continue
        if G._conflicts(text, postcode, area):
            continue
        place = G._place_hit(text, postcode, area)
        score = 40 + (25 if place else 0) + (15 if G.mentions(name, title) else 0) + round(10 * float(r.get("score") or 0))
        key, entry = site_of(url)
        cur = out.get(url)
        if cur and cur["score"] >= score:
            continue
        out[url] = {"url": url, "site": entry.get("label") or _host(url), "kind": entry.get("kind") or "directory", "score": score, "place": place,
                    "blocked": bool(entry.get("blocked")), "title": title[:160], "snippet": snippet[:300]}
    return sorted(out.values(), key=lambda c: -c["score"])


async def _read(url: str) -> Optional[Tuple[str, str]]:
    from app.services.safe_fetch import fetch_text

    try:
        title, text = await fetch_text(url, max_chars=PAGE_CHARS * 5, timeout=6.0)
        return title or "", text
    except Exception as err:
        logger.info("listing page not read %s: %s", url, err)
        return None


async def verify(cand: Dict[str, Any], name: str, postcode: str, area: str) -> Dict[str, Any]:
    """Is the page about this company? The page is read when the site allows it. Most directories answer our reader with a refusal (403), and we do
    not work around a refusal: then the text the search returned for that exact page is used, and it says so. Confirmed = that text names the
    company and shows its place. A page that names another business, or another place, is dropped ({})."""
    from app.services import guardrail as G

    page = None if cand["blocked"] else await _read(cand["url"])
    if page:
        body, how = " ".join((page[0], page[1][:PAGE_CHARS])), "we read the page"
    else:
        body, how = " ".join((cand["title"], cand["snippet"])), f"the text the search returned for this page ({cand['site']} does not let us read it ourselves)"
    if not G.mentions(name, f"{body} {urlparse(cand['url']).path}") or G._conflicts(body, postcode, area):
        return {}
    if not G._place_hit(body, postcode, area):
        return {**cand, "confirmed": False, "how": how, "why": f"{how[0].upper()}{how[1:]} names the company but does not show its place"}
    seen = {"phones": [w for w in G.numbers_in(body).values()][:2],
            "emails": list(dict.fromkeys(m.strip(".,;:\"'()<>").lower() for m in G._EMAIL.findall(body)))[:2]}
    return {**cand, "confirmed": True, "how": how, "why": f"{how[0].upper()}{how[1:]} names the company and shows its place", "also_seen": seen}


async def find(rows: List[Dict[str, Any]], name: str, postcode: str, area: str) -> Dict[str, Any]:
    """The one best exact listing page for the company, or {}: confirmed pages first, then the best-scored unconfirmed one."""
    cands = candidates(rows, name, postcode, area)
    if not cands:
        return {}
    checked: List[Dict[str, Any]] = []
    reads = 0
    for c in cands[:6]:
        if not c["blocked"]:
            reads += 1
            if reads > MAX_READS:
                c = {**c, "blocked": True}  # enough pages tried: the rest are judged on the text the search returned
        got = await verify(c, name, postcode, area)
        if got:
            checked.append(got)
    if not checked:
        return {}
    best = sorted(checked, key=lambda c: (not c["confirmed"], -c["score"]))[0]
    return {**{k: best[k] for k in ("url", "site", "kind", "confirmed", "how", "why", "snippet", "title") if k in best}, "also_seen": best.get("also_seen") or {},
            "at": datetime.utcnow().isoformat() + "Z"}


async def find_for(name: str, postcode: str, region: str) -> Dict[str, Any]:
    """Search the listed sites for the company and return its best exact page, or {}. One search. Never raises: a failed search finds nothing."""
    from app.services import enrichment_service as ES, search_recipe as R

    area = R.area_of(region or "", postcode or "")
    try:
        rows = await ES.search_web(f"{R.plain_name(name)} {area}".strip(), max_results=10, include_domains=search_domains(), must_mention=None, depth="basic")
        return await find(rows, name, postcode or "", area)
    except Exception as err:
        logger.warning("listing search failed for %s: %s", name, err)
        return {}


def keep(biz: Any, listing: Dict[str, Any]) -> None:
    """Store the listing on the company record, and when it is a social page and that icon is empty, put it under that icon too (free: already seen)."""
    import copy

    raw = copy.deepcopy(biz.raw_data or {})
    raw["listing_page"] = listing
    biz.raw_data = raw
    key, entry = site_of(listing["url"])
    net = entry.get("network")
    if net:
        from app.services import social_lookup as SL

        if not SL._slot(biz, net).get("url"):
            SL._put(biz, net, {"url": listing["url"], "options": [], "at": listing["at"], "by": "listing", "title": listing.get("title", ""), "note": listing.get("snippet", "")})
    elif key == "linkedin.com":
        raw = copy.deepcopy(biz.raw_data or {})
        store = raw.setdefault("linkedin", {})
        if not (store.get("company") or {}).get("url"):
            store["company"] = {"url": listing["url"], "options": [], "at": listing["at"], "by": "listing", "title": listing.get("title", ""), "note": listing.get("snippet", "")}
            biz.raw_data = raw
