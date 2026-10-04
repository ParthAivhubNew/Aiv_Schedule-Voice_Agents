import asyncio
import base64
import json
import logging
import os
import re
import urllib.parse
from typing import Dict, List, Any, Optional, Tuple
import httpx
from bs4 import BeautifulSoup

from app.config import settings
from app.services.process_logger import log_process_event

logger = logging.getLogger("enrichment_service")

SEARCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
}

# Never treat these as a prospect website / domain
_JUNK_WEB_HOSTS = (
    "bing.com", "google.", "duckduckgo.", "yahoo.com", "yandex.", "baidu.com",
    "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
    "youtube.com", "youtu.be", "reddit.com", "wikipedia.", "wikimedia.", "wikidata.", "wiktionary.",
    "pinterest.com", "tiktok.com", "microsoft.com", "office.com", "live.com",
    "schema.org", "w3.org", "cloudflare.com", "sentry.io",
)

_FREE_MAIL = {
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
    "outlook.com", "live.com", "icloud.com", "me.com", "aol.com", "mail.com",
    "protonmail.com", "proton.me", "gmx.com", "gmx.co.uk", "yandex.com",
}


def _host_of(url: str) -> str:
    try:
        raw = (url or "").strip()
        if not raw:
            return ""
        p = urllib.parse.urlparse(raw if "://" in raw else "https://" + raw)
        host = (p.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return ""


def _visible_text(el) -> str:
    """An element's text as it reads on the page. get_text(strip=True) joins the pieces around
    <b> highlights with nothing between them ("Oakwood<b>Dental</b>Practice" -> "OakwoodDentalPractice")."""
    if el is None:
        return ""
    joined = re.sub(r"\s+", " ", el.get_text(" ", strip=True))
    return re.sub(r"\s+([,.;:!?)])", r"\1", joined).strip()


def _is_junk_web_host(host_or_url: str) -> bool:
    h = (host_or_url or "").lower()
    if "://" in h or "/" in h:
        h = _host_of(h)
    if not h:
        return True
    return any(j in h for j in _JUNK_WEB_HOSTS)


# Words in a search that say nothing about which business or place is meant.
_GENERIC_SEARCH_WORDS = {
    "the", "and", "for", "with", "from", "near", "uk", "ltd", "limited", "inc", "llc", "plc",
    "company", "companies", "business", "businesses", "firm", "firms", "contact", "contacts",
    "phone", "email", "emails", "number", "numbers", "address", "official", "website", "site",
    "linkedin", "find", "get", "list", "please", "top", "best", "local", "area", "com", "org", "net",
}


def _search_keys(query: str) -> List[str]:
    """The searched words that a result about it would mention (first 5 letters, so
    "accountants" also matches "accounting"). For site:example.co.uk, the site's name."""
    keys: List[str] = []
    for tok in re.findall(r"site:\S+|[^\W_]+", (query or "").lower()):
        if tok.startswith("site:"):
            tok = _host_of(tok[5:]).split(".")[0]
        if len(tok) >= 3 and not tok.isdigit() and tok not in _GENERIC_SEARCH_WORDS and tok[:5] not in keys:
            keys.append(tok[:5])
    return keys


def _on_topic(results: List[Dict[str, str]], query: str) -> List[Dict[str, str]]:
    """Only the results that mention something that was searched for. Bing answers searches it
    takes for a robot with unrelated pages (Wikipedia, shops, tutorials) that mention none of it."""
    keys = _search_keys(query)
    if not keys:
        return results
    return [r for r in results
            if any(k in f"{r.get('title') or ''} {r.get('snippet') or ''} {r.get('url') or ''}".lower() for k in keys)]


def _unwrap_result_url(url: str) -> str:
    """Resolve Bing/Google/DDG wrapper links to the real destination URL."""
    href = (url or "").strip()
    if not href:
        return ""
    try:
        if "uddg=" in href:
            href = urllib.parse.unquote(href.split("uddg=")[-1].split("&")[0])
        parsed = urllib.parse.urlparse(href if "://" in href else "https://" + href)
        host = (parsed.netloc or "").lower()
        qs = urllib.parse.parse_qs(parsed.query or "")
        if "bing.com" in host:
            for key in ("u", "r", "url"):
                vals = qs.get(key) or []
                if not vals:
                    continue
                raw = urllib.parse.unquote(str(vals[0]))
                candidates = [raw]
                if raw.startswith("a1") and len(raw) > 4:
                    candidates.append(raw[2:])
                for cand in candidates:
                    if cand.startswith("http"):
                        return cand
                    try:
                        pad = "=" * ((4 - len(cand) % 4) % 4)
                        dec = base64.urlsafe_b64decode(cand + pad).decode("utf-8", errors="ignore").strip()
                        if dec.startswith("http"):
                            return dec
                        if dec and not dec.startswith("http"):
                            pad2 = "=" * ((4 - len(dec) % 4) % 4)
                            dec2 = base64.urlsafe_b64decode(dec + pad2).decode("utf-8", errors="ignore").strip()
                            if dec2.startswith("http"):
                                return dec2
                    except Exception:
                        continue
            return href
        if "google." in host and ("/url" in (parsed.path or "") or "/search" in (parsed.path or "")):
            for key in ("q", "url", "u"):
                vals = qs.get(key) or []
                if vals and str(vals[0]).startswith("http"):
                    return str(vals[0])
    except Exception:
        pass
    return href


async def _resolve_redirect_once(url: str) -> str:
    """Follow a single redirect for Bing ck links that did not unwrap from query params."""
    href = _unwrap_result_url(url)
    host = _host_of(href)
    if not href or "bing.com" not in host:
        return href
    try:
        async with httpx.AsyncClient(headers=SEARCH_HEADERS, timeout=6.0, follow_redirects=False) as client:
            resp = await client.head(href)
            loc = resp.headers.get("location") or ""
            if not loc and resp.status_code in (200, 405):
                resp = await client.get(href)
                loc = resp.headers.get("location") or ""
            if loc:
                if loc.startswith("/"):
                    loc = f"https://{host}{loc}"
                unwrapped = _unwrap_result_url(loc)
                if unwrapped and not _is_junk_web_host(unwrapped):
                    return unwrapped
                if unwrapped.startswith("http") and "bing.com" not in _host_of(unwrapped):
                    return unwrapped
    except Exception:
        pass
    return ""


async def search_duckduckgo_lite(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """Open text-only DuckDuckGo search that bypasses heavy JS and CAPTCHAs."""
    results = []
    try:
        async with httpx.AsyncClient(headers=SEARCH_HEADERS, timeout=8.0, follow_redirects=True) as client:
            resp = await client.post("https://lite.duckduckgo.com/lite/", data={"q": query})
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                rows = soup.find_all("tr")
                cur_item = None
                for tr in rows:
                    a = tr.find("a", class_="result-link")
                    if a:
                        href = a.get("href") or ""
                        url = _unwrap_result_url(href)
                        if url and not url.startswith("http"):
                            url = "https://" + url.lstrip("/")
                        if url and _is_junk_web_host(url):
                            url = ""
                        title = _visible_text(a)
                        cur_item = {"title": title, "snippet": "", "url": url or ""}
                        if title or url:
                            results.append(cur_item)
                    else:
                        td = tr.find("td", class_="result-snippet")
                        if td and cur_item:
                            cur_item["snippet"] = _visible_text(td)
                    if len(results) >= max_results:
                        break
    except Exception as err:
        logger.debug(f"DuckDuckGo Lite search error for '{query}': {err}")
    return results[:max_results]


async def _bump_vendor_call(provider: str) -> None:
    """Count one real billed call to a pay-as-you-go data vendor (Tavily, Telnyx lookup), so the
    admin portal's vendor-spend estimate (Revenue -> Data provider spend) knows roughly how much
    to keep funded in that vendor's account. Best-effort, never blocks the caller."""
    try:
        from datetime import datetime as _dt

        from app.services.credits import _get_doc, _put_doc
        from app.database import AsyncSessionLocal

        key = f"vendor_calls:{_dt.utcnow().strftime('%Y-%m')}"
        async with AsyncSessionLocal() as db:
            doc = await _get_doc(db, key)
            doc[provider] = int(doc.get(provider, 0)) + 1
            await _put_doc(db, key, doc)
            await db.commit()
    except Exception as err:
        logger.debug(f"[vendor_calls] could not count {provider}: {err}")


async def tavily_key() -> str:
    """The Tavily key staff saved under Platform Keys -> Leads -> Business Discovery, falling
    back to the TAVILY_API_KEY environment variable (how it was set before that field existed)."""
    from sqlalchemy.future import select

    from app.core.platform import platform_org_id
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import Connection
    from app.services.secret_box import config_get_secret, open_config

    try:
        with org_scope(platform_org_id()):
            async with AsyncSessionLocal() as s:
                rows = (await s.execute(
                    select(Connection).where(Connection.group_name == "Business Discovery")
                )).scalars().all()
        for c in rows:
            if "tavily" in (c.name or "").lower():
                key = config_get_secret(open_config(c.config if isinstance(c.config, dict) else {}), "api_key", "auth_token")
                if key:
                    return key.strip()
    except Exception as err:
        logger.debug(f"[tavily] saved key not read: {err}")
    return getattr(settings, "TAVILY_API_KEY", None) or os.getenv("TAVILY_API_KEY", "")


async def search_tavily(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """Tavily: AI-agent search API, platform-wide key (billed to orgs via the lead_lookup credit)."""
    key = await tavily_key()
    if not key:
        return []
    results = []
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                "https://api.tavily.com/search",
                headers={"Authorization": f"Bearer {key}"},
                # British results, as SEARCH_HEADERS asks of the other engines ("Birmingham" is not Alabama).
                json={"query": query, "max_results": max_results, "search_depth": "basic", "country": "united kingdom"},
            )
            await _bump_vendor_call("tavily")  # Tavily bills the request whether or not it helped
            if resp.status_code == 200:
                data = resp.json()
                for item in data.get("results", [])[:max_results]:
                    url = item.get("url") or ""
                    if url and not _is_junk_web_host(url):
                        results.append({
                            "title": item.get("title") or "",
                            "snippet": item.get("content") or "",
                            "url": url,
                        })
            else:
                logger.warning(f"Tavily search error for '{query}': HTTP {resp.status_code}")
    except Exception as err:
        logger.debug(f"Tavily search error for '{query}': {err}")
    return results


async def search_open_web(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """
    Open, unlimited multi-engine search rotator:
    1. Tavily (AI-agent search API, if a platform key is configured)
    2. DuckDuckGo Lite (resilient text-only endpoint)
    3. DuckDuckGo Standard HTML
    4. Bing Web Search (fallback)
    """
    if not query or not query.strip():
        return []

    # Each engine's off-topic results are dropped; an engine left with none hands over to the next.
    # 1. Tavily if configured
    results = _on_topic(await search_tavily(query, max_results=max_results), query)
    if results:
        return results

    # 2. DuckDuckGo Lite
    results = _on_topic(await search_duckduckgo_lite(query, max_results=max_results), query)
    if results:
        return results

    # 3. DuckDuckGo HTML
    try:
        async with httpx.AsyncClient(headers=SEARCH_HEADERS, timeout=8.0, follow_redirects=True) as client:
            resp = await client.post("https://html.duckduckgo.com/html/", data={"q": query})
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                links = soup.select(".result__body")
                for link in links[:max_results]:
                    title_elem = link.select_one(".result__title")
                    snippet_elem = link.select_one(".result__snippet")
                    url_elem = link.select_one(".result__url")
                    a_elem = link.select_one("a.result__a")

                    title = _visible_text(title_elem)
                    snippet = _visible_text(snippet_elem)
                    raw_url = url_elem.get_text(strip=True) if url_elem else ""
                    if not raw_url and a_elem and a_elem.get("href"):
                        href = a_elem.get("href") or ""
                        raw_url = _unwrap_result_url(href) if ("uddg=" in href or "http" in href) else href

                    if title or snippet:
                        url = _unwrap_result_url(raw_url) if raw_url else ""
                        if url and not url.startswith("http"):
                            url = "https://" + url.lstrip("/")
                        if url and _is_junk_web_host(url):
                            url = ""
                        results.append({
                            "title": title,
                            "snippet": snippet,
                            "url": url or "",
                        })
    except Exception as err:
        logger.debug(f"DuckDuckGo HTML search error for '{query}': {err}")

    results = _on_topic(results, query)
    if results:
        return results

    # 4. Fallback: Bing HTML
    try:
        async with httpx.AsyncClient(headers=SEARCH_HEADERS, timeout=8.0, follow_redirects=True) as client:
            resp = await client.get("https://www.bing.com/search", params={"q": query})
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                for li in soup.select("li.b_algo")[:max_results]:
                    a = li.select_one("h2 a")
                    cite = li.select_one("cite")
                    snippet_el = li.select_one(".b_caption p") or li.select_one("p")
                    title = _visible_text(a)
                    href = (a.get("href") or "").strip() if a else ""
                    cite_text = cite.get_text(strip=True) if cite else ""
                    url = _unwrap_result_url(href)
                    if not url or _is_junk_web_host(url):
                        if cite_text and not _is_junk_web_host(cite_text):
                            url = cite_text if cite_text.startswith("http") else "https://" + cite_text.lstrip("/")
                            url = url.split()[0].split("›")[0].strip()
                            if not url.startswith("http"):
                                url = "https://" + url.lstrip("/")
                        else:
                            url = await _resolve_redirect_once(href) if href else ""
                    if url and _is_junk_web_host(url):
                        url = ""
                    snippet = _visible_text(snippet_el)
                    if title or snippet or url:
                        results.append({"title": title, "snippet": snippet, "url": url})
    except Exception as err:
        logger.warning(f"Bing search fallback error for '{query}': {err}")

    return _on_topic(results, query)


search_duckduckgo = search_open_web


def _harvest_contacts_from_text(blob: str) -> Tuple[List[str], List[str]]:
    """Pull emails + phones from search snippets / titles."""
    emails: List[str] = []
    phones: List[str] = []
    text = blob or ""
    for em in re.findall(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", text):
        clean_em = em.strip(".,;:\"'()<>").lower()
        if _is_public_email(clean_em) and clean_em not in emails:
            emails.append(clean_em)
    for pm in re.findall(r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}", text):
        clean_pm = pm.strip(".,;:\"'()<>")
        if _is_real_phone(clean_pm) and clean_pm not in phones:
            phones.append(clean_pm)
    return emails, phones


def _homepage_from_url(url: str) -> str:
    try:
        cleaned = _unwrap_result_url(url or "")
        if not cleaned:
            return ""
        p = urllib.parse.urlparse(cleaned if "://" in cleaned else "https://" + cleaned)
        host = (p.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
        if not host or _is_junk_web_host(host):
            return ""
        return f"https://{host}"
    except Exception:
        return ""


def _usable_website(url: str) -> str:
    """Return a clean https homepage or empty — never search-engine wrappers."""
    home = _homepage_from_url(url or "")
    if home:
        return home
    raw = _unwrap_result_url(url or "").strip()
    if not raw or _is_junk_web_host(raw):
        return ""
    if not raw.startswith("http"):
        raw = "https://" + raw.lstrip("/")
    return _homepage_from_url(raw)

EMAIL_JUNK = (
    "noreply", "no-reply", "donotreply", "do-not-reply", "sentry.io", "wixpress", "example.com",
    "wordpress", "cloudflare", "schema.org", "png", "jpg", "svg", "css", "js",
    "wix.com", "squarespace", "cookiebot", "godaddy", "domain@", "abuse@", "postmaster@",
    "webmaster@", "privacy@", "legal@", "support@github", "mailer-daemon",
)

SOCIAL_HOSTS = {
    "linkedin": ("linkedin.com", "lnkd.in"),
    "twitter": ("twitter.com", "x.com"),
    "facebook": ("facebook.com", "fb.com", "fb.me"),
    "instagram": ("instagram.com",),
    "youtube": ("youtube.com", "youtu.be"),
    "reddit": ("reddit.com/r/", "reddit.com/user/", "reddit.com/u/"),
    "tiktok": ("tiktok.com/@",),
    "github": ("github.com/",),
    "crunchbase": ("crunchbase.com/organization",),
}

SOCIAL_JUNK = (
    "/sharer", "/share.php", "/share?", "/intent/", "/dialog/", "/plugins/",
    "/privacy", "/policy", "/login", "/signup", "/register", "/help", "/legal",
    "/watch", "/embed/", "/reel/", "/reels/", "/stories/", "/hashtag/",
    "/search", "/home", "/feed", "/i/web", "/i/flow", "/addthis",
    "/tr?", "/checkpoint", "/recover", "/oauth", "/jobs/", "/pulse/",
    "/posts/", "/sharing", "/company/login",
    "github.com/login", "github.com/features", "github.com/about", "github.com/pricing",
    "youtube.com/watch", "youtu.be/",
)

SOCIAL_FIND_RE = re.compile(
    r"https?://(?:(?:www|[a-z]{2})\.)?(?:"
    r"linkedin\.com/(?:company|in|school)/[A-Za-z0-9_\-%]+"
    r"|lnkd\.in/[A-Za-z0-9_\-]+"
    r"|(?:twitter|x)\.com/@?[A-Za-z0-9_]{1,30}"
    r"|facebook\.com/[A-Za-z0-9.\-]+"
    r"|fb\.com/[A-Za-z0-9.\-]+"
    r"|instagram\.com/[A-Za-z0-9_.]+"
    r"|youtube\.com/(?:@|channel/|c/|user/)[A-Za-z0-9_\-]+"
    r"|tiktok\.com/@[A-Za-z0-9._]+"
    r"|reddit\.com/r/[A-Za-z0-9_]+"
    r"|crunchbase\.com/organization/[A-Za-z0-9_\-]+"
    r")",
    re.I,
)


def _clean_href(href: str) -> str:
    href = (href or "").strip().strip("'\"")
    if href.startswith("//"):
        return "https:" + href
    return href


_ROLE_WORDS = {
    "ceo", "cfo", "coo", "cto", "cmo", "cio", "founder", "co-founder", "cofounder",
    "director", "managing", "president", "vp", "svp", "evp", "head", "officer",
    "manager", "lead", "owner", "partner", "chairman", "chair", "executive",
}
_ROLE_PHRASES = {
    "managing director", "chief executive", "chief executive officer",
    "decision maker", "decision-maker", "operations lead", "vp of operations",
    "general manager", "managing partner",
}
_NON_NAME_WORDS = {
    "new", "york", "los", "angeles", "san", "francisco", "hong", "kong",
    "united", "states", "kingdom", "north", "south", "east", "west",
    "inc", "ltd", "corp", "llc", "group", "company", "plc", "gmbh",
    "limited", "international", "america", "europe", "asia", "city",
}


def _is_real_phone(raw: str) -> bool:
    if not raw:
        return False
    if "555-0" in raw or "inferred" in raw.lower() or "reg" in raw.lower() or "company" in raw.lower():
        return False
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 9 or len(digits) > 15:
        return False
    if digits.startswith("202") or digits.startswith("000"):
        return False
    # UK 8-digit or 9-digit starting with 0 without standard UK prefix (likely Companies House number e.g. 09446231)
    if len(digits) == 8:
        return False
    if len(digits) == 9 and digits.startswith("0") and not raw.startswith("+"):
        return False
    # Dates / year-year / year+headcount (8–9 digits). Do not treat 10+ digit
    # NANP numbers whose area code is 201–209 as years (e.g. 2015551234).
    if re.fullmatch(r"(?:19|20)\d{2}(?:19|20)\d{2}", digits):
        return False
    if (
        len(digits) <= 9
        and re.match(r"^(?:19|20)\d{2}", digits)
        and "+" not in raw
        and not re.search(r"[()+\-]", raw)
    ):
        return False
    if "." in raw:
        dot_parts = raw.split(".")
        # Allow standard US phone 3.3.4 (e.g. 800.555.1212) but reject European financial numbers like 1.035.413.496
        if len(dot_parts) > 3 or (len(dot_parts) == 3 and not (len(dot_parts[0]) == 3 and len(dot_parts[1]) == 3 and len(dot_parts[2]) == 4)):
            return False
    if len(set(digits)) == 1:
        return False
    if digits in {"1234567890", "0123456789", "9876543210"}:
        return False
    return True


async def _telnyx_confirmed_phone(raw: str) -> str:
    """Confirm a phone-shaped string found in a search snippet is a real, assigned number via
    Telnyx Number Lookup — the one master Telnyx key already used platform-wide, no account or
    setup needed for this org (Number Lookup is a stateless lookup, not tied to a billing group).
    Best-effort: a configuration gap or a transient Telnyx error never blocks discovery, only a
    number Telnyx actively confirms is invalid gets blanked out."""
    if not raw:
        return ""
    try:
        from app.services.numbers import normalize
        from app.services.telnyx_client import TelnyxClient, TelnyxError, platform_key

        e164 = normalize(raw)
        if not e164 or not platform_key():
            return raw  # can't normalize, or Telnyx isn't connected on this platform yet
        data = await TelnyxClient(platform_key()).lookup_number(e164)
        await _bump_vendor_call("telnyx_lookup")
        return e164 if (data.get("carrier") or data.get("caller_name")) else ""
    except TelnyxError as err:
        await _bump_vendor_call("telnyx_lookup")
        return "" if err.status in (404, 422) else raw
    except Exception:
        return raw


def _is_person_name(raw: str) -> bool:
    """Accept a real person name. Reject job titles and role hints."""
    name = (raw or "").strip()
    if not name:
        return False
    compact = re.sub(r"[^a-z]+", " ", name.lower()).strip()
    if compact in _ROLE_WORDS or compact in _ROLE_PHRASES:
        return False
    parts = [p for p in re.split(r"\s+", name) if p]
    if len(parts) < 2 or len(parts) > 5:
        return False
    if any(p.lower().rstrip(".") in _ROLE_WORDS for p in parts):
        return False
    if any(p.lower().rstrip(".") in _NON_NAME_WORDS for p in parts):
        return False
    particles = {"de", "da", "van", "von", "der", "la", "le", "di", "du"}
    for p in parts:
        if p.lower() in particles:
            continue
        if not re.match(r"^[A-Z][a-zA-Z'-]+$", p):
            return False
    return True



def _is_public_email(raw: str) -> bool:
    em = (raw or "").strip().lower()
    if "@" not in em or em.endswith((".png", ".jpg", ".svg", ".css", ".js", ".webp")):
        return False
    if any(j in em for j in EMAIL_JUNK):
        return False
    local, _, domain = em.partition("@")
    if not local or not domain or "." not in domain:
        return False
    if len(local) < 2 or len(domain) < 4:
        return False
    return True


def _email_fits_context(email: str, person: str = "", company: str = "", site_host: str = "") -> bool:
    """Reject random free-mail addresses that do not match the person/company."""
    em = (email or "").strip().lower()
    if not _is_public_email(em):
        return False
    local, _, domain = em.partition("@")
    host = (site_host or "").lower().split(":")[0]
    if host and host in domain:
        return True
    # Corporate / non-free mail from crawled pages — keep
    if domain not in _FREE_MAIL:
        return True
    # Free mail only if local part looks like the person name
    parts = re.findall(r"[a-z]+", (person or "").lower())
    local_c = re.sub(r"[^a-z0-9]", "", local)
    if len(parts) >= 2:
        first, last = parts[0], parts[-1]
        if len(first) >= 2 and len(last) >= 2:
            if first in local_c and last in local_c:
                return True
            if local_c in {f"{first}{last}", f"{first[0]}{last}", f"{first}{last[0]}", f"{last}{first}"}:
                return True
            if f"{first}.{last}" in local or f"{first}_{last}" in local:
                return True
    # Company token in local part (rare for free mail) — still weak, skip
    return False


def _pick_best_email(emails: List[str], person: str = "", company: str = "", site_host: str = "") -> str:
    ranked = [e for e in emails if _email_fits_context(e, person, company, site_host)]
    if not ranked:
        return ""
    host = (site_host or "").lower().split(":")[0]
    if host:
        domain_hit = [e for e in ranked if host in e.split("@")[-1]]
        if domain_hit:
            return domain_hit[0]
    non_free = [e for e in ranked if e.split("@")[-1] not in _FREE_MAIL]
    return (non_free or ranked)[0]


def _html_for_parse(html: str, cap: int = 280000) -> str:
    if not html:
        return ""
    if len(html) <= cap:
        return html
    head = html[: int(cap * 0.62)]
    tail = html[-int(cap * 0.38) :]
    return head + "\n<!--trim-->\n" + tail


def _normalize_social_url(url: str) -> str:
    href = _clean_href(url)
    if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
        return ""
    low = href.lower()
    if not href.startswith("http"):
        if any(h in low for h in (
            "linkedin.com", "lnkd.in", "twitter.com", "x.com", "facebook.com",
            "fb.com", "instagram.com", "youtube.com", "tiktok.com", "reddit.com",
            "github.com", "crunchbase.com",
        )):
            href = "https://" + href.lstrip("/")
        else:
            return ""
    parsed = urllib.parse.urlparse(href)
    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    path = (parsed.path or "").rstrip("/")
    scheme = "https"
    return urllib.parse.urlunparse((scheme, host, path, "", "", ""))


def _social_key_from_url(url: str) -> Optional[str]:
    low = (url or "").lower()
    if not low:
        return None
    if any(j in low for j in SOCIAL_JUNK):
        return None
    parsed = urllib.parse.urlparse(low if "://" in low else "https://" + low)
    host = (parsed.netloc or "").lower()
    path = parsed.path or ""
    if host.startswith("www."):
        host = host[4:]
    if host.endswith(".linkedin.com") or host == "linkedin.com" or host == "lnkd.in":
        if "/company/" in path or "/in/" in path or "/school/" in path or host == "lnkd.in":
            return "linkedin"
        return None
    if host in ("twitter.com", "x.com", "mobile.twitter.com"):
        handle = path.strip("/").split("/")[0].lstrip("@")
        if handle and handle not in ("intent", "share", "i", "home", "search", "explore", "settings", "privacy"):
            return "twitter"
        return None
    if host in ("facebook.com", "fb.com", "m.facebook.com", "fb.me"):
        slug = path.strip("/").split("/")[0]
        if slug and slug not in ("sharer", "share", "dialog", "plugins", "tr", "watch", "photo", "permalink.php", "groups"):
            return "facebook"
        return None
    if host in ("instagram.com", "www.instagram.com"):
        slug = path.strip("/").split("/")[0]
        if slug and slug not in ("p", "reel", "reels", "stories", "share", "accounts", "explore", "instagram"):
            return "instagram"
        return None
    if host in ("youtube.com", "m.youtube.com", "youtu.be"):
        if host == "youtu.be":
            return None
        if any(path.startswith(p) for p in ("/@", "/channel/", "/c/", "/user/")):
            return "youtube"
        return None
    for key, needles in SOCIAL_HOSTS.items():
        if any(n in low for n in needles):
            if key in ("linkedin", "twitter", "facebook", "instagram", "youtube"):
                continue
            return key
    return None


def _social_quality(key: str, url: str) -> int:
    low = (url or "").lower()
    if not url or any(j in low for j in SOCIAL_JUNK):
        return 0
    if key == "linkedin":
        if "/company/" in low:
            return 12
        if "/school/" in low:
            return 8
        if "lnkd.in/" in low:
            return 6
        if "/in/" in low:
            return 3
        return 1
    if key == "youtube":
        if "/@" in low or "/channel/" in low:
            return 8
        return 4
    if key == "twitter":
        return 7
    if key == "facebook":
        return 6
    if key == "instagram":
        return 6
    return 5


def _remember_social(socials: dict, url: str) -> None:
    cleaned = _normalize_social_url(url)
    if not cleaned:
        return
    key = _social_key_from_url(cleaned)
    if not key:
        return
    score = _social_quality(key, cleaned)
    if score <= 0:
        return
    prev = socials.get(key) or ""
    if not prev or score > _social_quality(key, prev):
        socials[key] = cleaned


def _harvest_jsonld(soup: BeautifulSoup, socials: dict, phones: Optional[set] = None, emails: Optional[set] = None) -> None:
    for script in soup.find_all("script"):
        stype = " ".join(script.get("type") or "").lower()
        if "ld+json" not in stype:
            continue
        raw = (script.string or script.get_text() or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        nodes: List[Any] = data if isinstance(data, list) else [data]
        expanded: List[Any] = []
        for node in nodes:
            if isinstance(node, dict) and isinstance(node.get("@graph"), list):
                expanded.extend(node["@graph"])
            else:
                expanded.append(node)
        for node in expanded:
            if not isinstance(node, dict):
                continue
            same = node.get("sameAs") or []
            if isinstance(same, str):
                same = [same]
            for item in same:
                if isinstance(item, str):
                    _remember_social(socials, item)

            # Official telephone from Schema.org
            if phones is not None:
                tel = node.get("telephone") or node.get("phone")
                if tel:
                    tels = tel if isinstance(tel, list) else [tel]
                    for t in tels:
                        if _is_real_phone(str(t)):
                            phones.add(str(t).strip())

            # Official email from Schema.org
            if emails is not None:
                em = node.get("email")
                if em:
                    ems = em if isinstance(em, list) else [em]
                    for e in ems:
                        if _is_public_email(str(e)):
                            emails.add(str(e).lower().strip())


def _harvest_regex_urls(html: str, socials: dict) -> None:
    if not html:
        return
    sample = html if len(html) <= 500000 else html[:280000] + html[-160000:]
    for match in SOCIAL_FIND_RE.finditer(sample):
        _remember_social(socials, match.group(0).rstrip(").,;\"'<>\\"))


def _harvest_soup(soup: BeautifulSoup, phones: set, emails: set, socials: dict) -> List[str]:
    extra_pages = []
    text = soup.get_text(separator=" ")
    for pm in re.findall(r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}', text):
        if _is_real_phone(pm):
            phones.add(pm.strip())
    for em in re.findall(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', text):
        if _is_public_email(em):
            emails.add(em.lower())
    _harvest_jsonld(soup, socials, phones, emails)
    for tag in soup.find_all(["a", "link"]):
        href = _clean_href(tag.get("href") or tag.get("data-href") or tag.get("data-url") or "")
        low = href.lower()
        if low.startswith("tel:"):
            cand = href.split(":", 1)[-1]
            if _is_real_phone(cand):
                phones.add(cand.strip())
            continue
        if low.startswith("mailto:"):
            cand = href.split(":", 1)[-1].split("?")[0]
            if _is_public_email(cand):
                emails.add(cand.lower())
            continue
        rel = " ".join(tag.get("rel") or []).lower()
        if href:
            _remember_social(socials, href)
        if href and (
            any(p in low for p in ("/contact", "/about", "/impressum", "/support", "/connect"))
            or "me" in rel.split()
        ):
            extra_pages.append(href)
        label = " ".join(
            filter(None, [tag.get("aria-label"), tag.get("title"), tag.get("class") and " ".join(tag.get("class"))])
        ).lower()
        if href and any(w in label for w in ("linkedin", "facebook", "instagram", "twitter", "youtube", "tiktok")):
            _remember_social(socials, href)
    return extra_pages


def _pick_follow_pages(extra: List[str], origin: str, netloc: str) -> List[str]:
    ranked: List[Tuple[int, str]] = []
    for href in extra:
        abs_url = urllib.parse.urljoin(origin + "/", href)
        parsed = urllib.parse.urlparse(abs_url)
        if parsed.netloc != netloc:
            continue
        low = abs_url.lower()
        if any(skip in low for skip in ("linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com")):
            continue
        score = 0
        if "/contact" in low:
            score = 4
        elif "/about-us" in low or "/aboutus" in low:
            score = 3
        elif "/about" in low:
            score = 2
        elif "/support" in low or "/impressum" in low:
            score = 1
        if score:
            ranked.append((score, abs_url.split("#")[0]))
    ranked.sort(key=lambda x: x[0], reverse=True)
    seen = set()
    out = []
    for _, url in ranked:
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
        if len(out) >= 1:
            break
    return out


async def _ingest_html(html: str, phones: set, emails: set, socials: dict) -> List[str]:
    clipped = _html_for_parse(html)
    _harvest_regex_urls(html, socials)
    soup = BeautifulSoup(clipped, "html.parser")
    extra = _harvest_soup(soup, phones, emails, socials)
    title = soup.title.get_text(strip=True) if soup.title else ""
    meta_desc = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
    description = ""
    if meta_desc and meta_desc.get("content"):
        description = meta_desc["content"].strip()
    return extra, title, description


async def crawl_homepage_contacts(domain_url: str) -> Dict[str, Any]:
    clean_url = domain_url.strip()
    if not clean_url.startswith("http"):
        clean_url = "https://" + clean_url

    phones = set()
    emails = set()
    socials = {}
    title = ""
    description = ""

    try:
        limits = httpx.Limits(max_keepalive_connections=5, max_connections=8)
        timeout = httpx.Timeout(10.0, connect=4.0)
        async with httpx.AsyncClient(headers=SEARCH_HEADERS, timeout=timeout, follow_redirects=True, limits=limits) as client:
            resp = await client.get(clean_url)
            if resp.status_code == 200:
                extra, title, description = await _ingest_html(resp.text, phones, emails, socials)
                parsed = urllib.parse.urlparse(str(resp.url))
                origin = f"{parsed.scheme}://{parsed.netloc}"
                follow = _pick_follow_pages(extra, origin, parsed.netloc) if extra else []
                guesses = [urllib.parse.urljoin(origin + "/", g) for g in ("contact", "contact-us", "about", "about-us")]
                seen = set()
                for abs_url in follow + guesses:
                    if abs_url in seen or len(seen) >= 3:
                        continue
                    seen.add(abs_url)
                    try:
                        extra_resp = await client.get(abs_url)
                        if extra_resp.status_code == 200:
                            await _ingest_html(extra_resp.text, phones, emails, socials)
                    except Exception:
                        pass
    except Exception as e:
        logger.warning(f"Could not crawl domain {clean_url}: {e}")

    return {
        "title": title,
        "description": description,
        "phones": list(phones)[:8],
        "emails": list(emails)[:8],
        "socials": socials
    }

# UK dialling codes of towns and cities. A firm's number in one town starts with that town's code,
# so its other offices' numbers can be told apart ("0121" Birmingham, "01752" Plymouth).
_UK_AREA_CODES = {
    "london": "020", "birmingham": "0121", "solihull": "0121", "sutton coldfield": "0121", "leeds": "0113",
    "sheffield": "0114", "nottingham": "0115", "leicester": "0116", "bristol": "0117", "reading": "0118",
    "edinburgh": "0131", "glasgow": "0141", "liverpool": "0151", "manchester": "0161", "salford": "0161",
    "stockport": "0161", "newcastle": "0191", "sunderland": "0191", "gateshead": "0191", "cardiff": "029",
    "belfast": "028", "southampton": "023", "portsmouth": "023", "coventry": "024", "plymouth": "01752",
    "worcester": "01905", "exeter": "01392", "cambridge": "01223", "oxford": "01865", "york": "01904",
    "bradford": "01274", "hull": "01482", "preston": "01772", "stoke": "01782", "derby": "01332",
    "norwich": "01603", "brighton": "01273", "bournemouth": "01202", "poole": "01202", "aberdeen": "01224",
    "dundee": "01382", "swansea": "01792", "newport": "01633", "wolverhampton": "01902", "walsall": "01922",
    "dudley": "01384", "milton keynes": "01908", "northampton": "01604", "peterborough": "01733",
    "cheltenham": "01242", "gloucester": "01452", "bath": "01225", "chester": "01244", "warrington": "01925",
    "bolton": "01204", "blackburn": "01254", "blackpool": "01253", "lancaster": "01524", "carlisle": "01228",
    "middlesbrough": "01642", "darlington": "01325", "halifax": "01422", "huddersfield": "01484",
    "wakefield": "01924", "doncaster": "01302", "rotherham": "01709", "barnsley": "01226", "lincoln": "01522",
    "ipswich": "01473", "colchester": "01206", "chelmsford": "01245", "southend": "01702", "st albans": "01727",
    "luton": "01582", "bedford": "01234", "swindon": "01793", "salisbury": "01722", "guildford": "01483",
    "canterbury": "01227", "maidstone": "01622", "truro": "01872", "taunton": "01823", "shrewsbury": "01743",
    "telford": "01952", "hereford": "01432", "inverness": "01463", "perth": "01738", "stirling": "01786",
}
_TOWN_OF_CODE: Dict[str, str] = {}
for _town, _code in _UK_AREA_CODES.items():
    _TOWN_OF_CODE.setdefault(_code, _town)  # the first town listed names the code


def _uk_number(phone: str) -> str:
    """A UK number as dialled at home: "+44 (0)121 456 7890" -> "01214567890"."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("00"):
        digits = digits[2:]
    return "0" + digits[2:].lstrip("0") if digits.startswith("44") else digits


def _dialling_code(phone: str) -> str:
    number = _uk_number(phone)
    return max((c for c in _TOWN_OF_CODE if number.startswith(c)), key=len, default="")


def _code_for_place(place: str) -> str:
    low = (place or "").lower()
    towns = [t for t in _UK_AREA_CODES if re.search(rf"\b{re.escape(t)}\b", low)]
    return _UK_AREA_CODES[max(towns, key=len)] if towns else ""


def _town_in_email(email: str) -> str:
    """The town an office address is for: "exeter@firm.co.uk" -> "exeter"."""
    words = set(re.split(r"[._+-]", (email or "").split("@")[0].lower()))
    return next((t for t in _UK_AREA_CODES if t.replace(" ", "") in words), "")


_GENERAL_MAILBOXES = {"info", "hello", "enquiries", "enquiry", "contact", "office", "admin", "mail", "reception", "sales", "help"}
_JOB_MAILBOXES = {"jobs", "careers", "career", "recruitment", "vacancies", "hr", "cv"}


def _mailbox_rank(email: str) -> int:
    """General addresses (info@) first, people's next, recruitment (jobs@) last."""
    local = (email or "").split("@")[0].lower()
    return 0 if local in _GENERAL_MAILBOXES else 2 if local in _JOB_MAILBOXES else 1


def _split_by_office(phones: List[str], emails: List[str], place: str,
                     page_phones: List[str], page_emails: List[str]) -> Tuple[List[str], List[str], List[Dict[str, str]]]:
    """The office's own numbers and addresses first (the office page's, then the town's, then
    national numbers and general addresses), and another town's apart, as other offices. The
    office is the searched town, else the town of the office page's number. A jobs@ address
    never comes first."""
    code = _code_for_place(place) or next((c for c in map(_dialling_code, page_phones) if c), "")
    if not code:
        return phones, sorted(emails, key=_mailbox_rank), []
    main_phones, main_emails, others = [], [], []
    for p in phones:
        c = _dialling_code(p)
        if c and c != code and p not in page_phones:
            others.append({"town": _TOWN_OF_CODE[c].title(), "phone": p})
        else:
            main_phones.append(p)
    for e in emails:
        town = _town_in_email(e)
        if town and _UK_AREA_CODES[town] != code and e not in page_emails:
            others.append({"town": town.title(), "email": e})
        else:
            main_emails.append(e)
    main_phones.sort(key=lambda p: (p not in page_phones, _dialling_code(p) != code))
    main_emails.sort(key=lambda e: (e not in page_emails, not _town_in_email(e), _mailbox_rank(e)))
    return main_phones, main_emails, others


async def _page_contacts(url: str) -> Dict[str, Any]:
    """The phones, addresses and description on one page (the office page a company was found on)."""
    phones: set = set()
    emails: set = set()
    description = ""
    try:
        async with httpx.AsyncClient(headers=SEARCH_HEADERS, timeout=httpx.Timeout(10.0, connect=4.0), follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                _, _, description = await _ingest_html(resp.text, phones, emails, {})
    except Exception as e:
        logger.warning(f"Could not read page {url}: {e}")
    return {"phones": [p for p in phones if _is_real_phone(p)], "emails": [e for e in emails if _is_public_email(e)],
            "description": description}


async def enrich_prospect_intelligence(
    name: str,
    company: Optional[str] = None,
    domain: Optional[str] = None,
    existing_notes: Optional[str] = None,
    deep: bool = True,
    place: Optional[str] = None,
    person: Optional[str] = None,
    page_url: Optional[str] = None,
) -> Dict[str, Any]:
    """page_url: the page the company was found on. When it is one office's page on the company's
    own site, that office's details come first and other offices' are kept apart."""
    target_company = company or name
    snippets: List[Dict[str, str]] = []
    scraped_info: Dict[str, Any] = {}
    loc = " ".join([p for p in [place or "", person or ""] if p]).strip()

    host = ""
    if domain:
        host = _host_of(domain if domain.startswith("http") else "https://" + domain)
        if _is_junk_web_host(host):
            host = ""
        else:
            home = _usable_website(domain)
            if home:
                scraped_info = await crawl_homepage_contacts(home)
    office: Dict[str, Any] = {}
    if host and page_url and _host_of(page_url) == host and urllib.parse.urlparse(page_url).path.strip("/"):
        office = await _page_contacts(page_url)

    search_terms = []
    if host:
        search_terms.append(f"site:{host} contact email phone")
        search_terms.append(f"site:{host} linkedin")
    place_bit = (place or "").strip()
    person_bit = (person or "").strip()
    if target_company and not str(target_company).isdigit():
        q = f'"{target_company}"'
        if place_bit:
            q += f" {place_bit}"
        search_terms.append(q + " email OR contact OR phone")
        search_terms.append(f'"{target_company}" official website')
        if deep:
            search_terms.append(f'"{target_company}" site:linkedin.com/company')
        if person_bit:
            search_terms.append(f'"{person_bit}" "{target_company}"')
            search_terms.append(f'"{person_bit}" "{target_company}" site:linkedin.com/in')
    elif person_bit:
        # Person-only rows (Contact Name, no company) — still try public web.
        search_terms.append(f'"{person_bit}" email OR phone OR contact {place_bit}'.strip())
        search_terms.append(f'"{person_bit}" website OR company {place_bit}'.strip())
        search_terms.append(f'"{person_bit}" site:linkedin.com/in')
    if existing_notes and not person_bit:
        search_terms.append(f"{existing_notes} {target_company} LinkedIn email")

    # Dedupe queries while preserving order
    seen_q = set()
    uniq_terms = []
    for q in search_terms:
        key = q.strip().lower()
        if key and key not in seen_q:
            seen_q.add(key)
            uniq_terms.append(q.strip())

    if uniq_terms:
        _search_sem = asyncio.Semaphore(2)
        async def _run_search(query_str: str) -> List[Dict[str, str]]:
            async with _search_sem:
                return await search_open_web(query_str, max_results=4)

        search_results = await asyncio.gather(*[_run_search(q) for q in uniq_terms[:5]])
        for res in search_results:
            snippets.extend(res)

    snippet_emails: List[str] = []
    snippet_phones: List[str] = []
    for s in snippets:
        blob = f"{s.get('title') or ''} {s.get('snippet') or ''} {s.get('url') or ''}"
        ems, phs = _harvest_contacts_from_text(blob)
        for e in ems:
            if e not in snippet_emails:
                snippet_emails.append(e)
        for p in phs:
            if p not in snippet_phones:
                snippet_phones.append(p)

    if not scraped_info and snippets:
        for s in snippets:
            url = s.get("url") or ""
            home = _homepage_from_url(url)
            if home:
                scraped_info = await crawl_homepage_contacts(home)
                if scraped_info.get("emails") or scraped_info.get("phones") or scraped_info.get("socials"):
                    break

    socials = dict(scraped_info.get("socials") or {})
    reddit_mentions = []
    for s in snippets:
        url = s.get("url") or ""
        _remember_social(socials, url)
        title = s.get("title") or ""
        # Titles often embed LinkedIn company/person paths as plain text
        for m in SOCIAL_FIND_RE.finditer(f"{title} {s.get('snippet') or ''} {url}"):
            _remember_social(socials, m.group(0))
        if "reddit.com" in url.lower():
            reddit_mentions.append({"title": title, "url": url, "snippet": (s.get("snippet") or "")[:180]})

    discovered_phones: List[str] = []
    for p in (office.get("phones") or []) + (scraped_info.get("phones") or []) + snippet_phones:
        if _is_real_phone(p) and p not in discovered_phones:
            discovered_phones.append(p)
    host = ""
    if domain:
        host = _host_of(domain if domain.startswith("http") else "https://" + domain)
        if _is_junk_web_host(host):
            host = ""
    raw_emails = [e for e in (office.get("emails") or []) + (scraped_info.get("emails") or []) if _is_public_email(e)]
    raw_emails = list(dict.fromkeys(raw_emails))
    for e in snippet_emails:
        if _is_public_email(e) and e not in raw_emails:
            raw_emails.append(e)
    discovered_emails = [
        e for e in raw_emails
        if _email_fits_context(e, person=person_bit or "", company=str(target_company or ""), site_host=host)
    ]
    # If nothing fits context, keep only non-free corporate emails (never random gmail)
    if not discovered_emails:
        discovered_emails = [e for e in raw_emails if e.split("@")[-1] not in _FREE_MAIL]
    if host:
        ranked = [e for e in discovered_emails if host.split(":")[0] in e] + [e for e in discovered_emails if host.split(":")[0] not in e]
        discovered_emails = ranked
    discovered_phones, discovered_emails, other_offices = _split_by_office(
        discovered_phones, discovered_emails, place_bit, office.get("phones") or [], office.get("emails") or [])
    company_pitch = scraped_info.get("description", "") or office.get("description", "")

    # Prefer a real company homepage — never LinkedIn/social/search as "domain"
    resolved_domain = ""
    if domain:
        resolved_domain = _usable_website(domain)
    if not resolved_domain:
        for s in snippets:
            resolved_domain = _usable_website(s.get("url") or "")
            if resolved_domain:
                break

    clean_citations = []
    for s in snippets:
        u = _usable_website(s.get("url") or "") or _unwrap_result_url(s.get("url") or "")
        if u and not _is_junk_web_host(u) and u not in clean_citations:
            clean_citations.append(u)
        elif (s.get("url") or "") and "linkedin.com" in (s.get("url") or "").lower():
            li = _unwrap_result_url(s.get("url") or "")
            if li and li not in clean_citations:
                clean_citations.append(li)

    people = []
    name_re = re.compile(r"\b([A-Z][a-z]+ [A-Z][a-z]+)\b.{0,40}\b(CEO|Founder|Managing Director|COO|CTO|CMO)\b")
    for s in snippets:
        snippet_text = s.get("snippet", "")
        match = name_re.search(snippet_text)
        if match and _is_person_name(match.group(1)):
            people.append({
                "name": match.group(1),
                "roleHint": match.group(2),
                "snippet": snippet_text[:140],
                "source": s.get("url"),
            })
            if len(people) >= 3:
                break

    hook = ""
    if company_pitch:
        hook = f"I noticed {target_company}'s focus on {company_pitch[:80]}... Calling to see if automating inbound scheduling would accelerate your current pipeline."
    elif snippets:
        hook = f"Reaching out to {target_company} regarding operational workflow automation. Wanted to discuss a 15-minute exchange on scaling voice response times."
    else:
        hook = f"Hi, reaching out to {target_company} directly regarding voice AI scheduling workflows."

    primary_email = _pick_best_email(
        discovered_emails,
        person=person_bit or "",
        company=str(target_company or ""),
        site_host=_host_of(resolved_domain) or host,
    )

    confidence = 85 if (discovered_phones or discovered_emails) else 70 if socials else 60 if snippets else 35

    summary_result = {
        "company": target_company,
        "domain": resolved_domain or "",
        "phones": discovered_phones,
        "primaryPhone": discovered_phones[0] if discovered_phones else "",
        "emails": discovered_emails,
        "primaryEmail": primary_email,
        "otherOffices": other_offices,
        "overview": company_pitch or next((s["snippet"] for s in snippets if place_bit and place_bit.lower() in (s.get("snippet") or "").lower()),
                                          snippets[0]["snippet"] if snippets else "No detailed summary found."),
        "openingHook": hook,
        "keyPeople": people[:3],
        "socials": socials,
        "redditMentions": reddit_mentions[:3],
        "confidenceScore": confidence,
        "citations": clean_citations[:8],
    }

    if deep:
        try:
            await log_process_event(
                subsystem="crawler_rag",
                process_name="prospect_web_enrichment",
                message=f"Enriched dossier for '{target_company}': Found {len(discovered_phones)} phones, {len(discovered_emails)} emails, confidence={confidence}%.",
                level="SUCCESS" if confidence > 50 else "INFO",
                details={"company": target_company, "confidence": confidence},
            )
        except Exception:
            pass

    return summary_result

# Business directories and data brokers: a result there is about a company (or a list of them)
# but the address is not that company's own website.
_DIRECTORY_HOSTS = (
    "contactout.com", "bizseek.", "yell.com", "yelp.", "cylex", "thomsonlocal.", "freeindex.", "192.com",
    "scoot.co.uk", "hotfrog.", "bark.com", "checkatrade.", "trustpilot.", "tripadvisor.", "endole.",
    "companycheck.", "opencorporates.", "company-information.service.gov.uk", "dnb.com", "zoominfo.",
    "rocketreach.", "apollo.io", "crunchbase.", "glassdoor.", "indeed.", "healthgps.", "nearbydentist.",
    "nhs.uk", "whatclinic.", "doctify.", "iwantgreatcare.", "firmania.", "brownbook.", "misterwhat.",
    "yably.", "cybo.", "find-open.", "infobel.", "kompass.", "europages.", "manta.com", "bbb.org",
    "yellowpages.", "lusha.", "signalhire.", "datanyze.", "craft.co", "companieslist.", "cbinsights.",
    "prospeo.", "leadiq.", "seamless.ai", "kaspr.", "hunter.io", "snov.io", "adapt.io", "uplead.", "getprospect.",
    "trustatrader.", "mybuilder.", "ratedpeople.", "rightio.", "hamuch.", "watersafe.", "myjobquote.", "which.co.uk",
    "houzz.", "threebestrated.", "expertise.com", "cpadirectory.", "vouchedfor.", "accountantsup.", "unbiased.co.uk", "icaew.",
    "rightmove.", "zoopla.", "onthemarket.", "primelocation.",
)

# Page names that are not a company's name ("Contact Us | Meliora Dental").
_GENERIC_PAGE_TITLES = {
    "contact us", "contact", "home", "home page", "homepage", "about us", "about", "welcome", "our team", "team",
    "book online", "book an appointment", "services", "our services", "find us", "location", "locations", "index",
    "companies house", "gov.uk",
}
# What directories and brokers add after a company's name.
_NAME_NOISE = re.compile(r"\s*(overview,? address (&|and) contact|email format.*|company profile.*|"
                         r"contact (details|information|info|number).*|reviews?( and ratings)?|official (site|website))$", re.I)


def _site_name(url: str) -> str:
    """The name part of a website's address: "bishopfleming" for www.bishopfleming.co.uk/contact."""
    labels = _host_of(url).split(".")
    while labels and (len(labels[-1]) <= 2 or labels[-1] in ("com", "org", "net", "gov", "edu", "nhs", "ltd", "plc", "info", "biz")):
        labels.pop()
    return labels[-1] if labels else ""


def _only_searched_words(text: str, query: str) -> bool:
    """"Birmingham" or "Accountants" when that is what was searched: the search, not a name."""
    keys = set(_search_keys(query))
    words = [w[:5] for w in re.findall(r"[^\W_]+", text.lower()) if len(w) >= 3 and w not in _GENERIC_SEARCH_WORDS]
    return bool(keys) and bool(words) and all(w in keys for w in words)


def _squash(text: str, amp: str = "") -> str:
    """Letters and digits only: "Smith & Co" -> "smithco" (or "smithandco" with amp="and")."""
    return re.sub(r"[^a-z0-9]", "", (text or "").lower().replace("&", amp))


def _has_site_name(text: str, site: str) -> bool:
    return site in _squash(text) or site in _squash(text, "and")


def _words_spelling(text: str, squashed: str) -> str:
    """The words in text that spell a website's name ("Leeds Dental Clinic" for "leedsdentalclinic")."""
    words = re.findall(r"[^\s|,;:()]+", text or "")
    for amp in ("", "and"):
        for i in range(len(words)):
            spelt = ""
            for j in range(i, min(i + 6, len(words))):
                spelt += _squash(words[j], amp)
                if spelt == squashed:
                    return " ".join(words[i:j + 1]).strip(" .-")
                if not squashed.startswith(spelt):
                    break
    return ""


def _company_name_from_title(title: str, url: str, query: str = "", snippet: str = "") -> str:
    """The company's name from a search result ("Accountants in Birmingham - Menzies LLP" ->
    "Menzies LLP"). On a company's own site: the title part with the site's name in it, else the
    words in the title or snippet that spell the site's name, else the site's name; "" when the
    page lists businesses instead. On a directory: the first title part that is not a page name,
    the search itself, or the directory's add-on."""
    parts = [_NAME_NOISE.sub("", re.sub(r"^welcome to\s+", "", p.strip(), flags=re.I)).strip(" ,.-")
             for p in re.split(r"\s+[-|:—–]\s+|:\s+", title or "")]
    listing = any(_is_listing_title(p, query) for p in parts)
    names = [p for p in parts if len(p) >= 2 and p.lower() not in _GENERIC_PAGE_TITLES
             and not _is_listing_title(p, query) and not _only_searched_words(p, query)]
    site = _squash(_site_name(url))
    if _is_directory_host(url) or len(site) < 3:
        # On a directory, neither its own name ("HaMuch.com") nor a part with every searched word
        # in it ("Affordable Manchester Plumbers") is a business.
        keys = _search_keys(query)
        names = [n for n in names if not (len(site) >= 3 and _has_site_name(n, site))
                 and (len(keys) < 2 or not all(k in n.lower() for k in keys))]
        return names[0] if names and not listing else ""
    for name in names:
        if _has_site_name(name, site):
            # "Watkins Solicitors in Bristol, Bath and Somerset" -> "Watkins Solicitors"
            return (len(name.split()) > 5 and _words_spelling(name, site)) or name
    spelt = _words_spelling(f"{title} {snippet}", site)
    if spelt and not _only_searched_words(spelt, query):
        return spelt
    return "" if listing else _site_name(url).replace("-", " ").title()


def _is_directory_host(url: str) -> bool:
    host = _host_of(url)
    return bool(host) and any(d in host for d in _DIRECTORY_HOSTS)


# Anywhere in a title, these mean a page about many businesses (or a data broker's page about
# one person: "Jane Smith Email & Phone Number").
_LISTS_MANY = re.compile(
    r"\b(email|phone)( address)? (&|and) (phone|email)( number| address)?\b"
    r"|\bnear (me|you)\b|\bin your area\b|^(the )?(best|top)\b|\btop \d+\b|\b\d+\s+(best|top)\b|^search results\b|^find\b|\b\d{2,}\+\s"
    r"|\b\d{2,}\+?\s+(\w+\s+)?(practices|companies|businesses|firms|clinics|results|listings|agencies|shops|providers)\b")


def _is_listing_title(name: str, query: str) -> bool:
    """A results page that lists many businesses ("Dentists in Leeds", "Top 10 accountants",
    "153 practices near you") rather than one business."""
    low, q = name.lower().strip(), (query or "").lower().strip()
    if q and low == q:
        return True
    if _LISTS_MANY.search(low):
        return True
    keys = _search_keys(q)
    if any(m.group(1)[:5] in keys for m in re.finditer(r"\b\d{2,}\+?\s+(?:\w+\s+)?(\w+s)\b", low)):
        return True  # "121 Solicitors serving Bristol"
    # "<plural trade> in <place>" where the trade or the place is what was searched, e.g.
    # "Dentists in Leeds" for "dental practices in Leeds". (A business really called "Smiles in
    # Leeds" would be dropped too; such names are rare next to directory pages.)
    m = re.match(r"^([a-z&' -]{3,40}?s) (in|near|around) ([a-z][a-z' -]+)$", low)
    words = set(q.split())
    return bool(m and (any(w in words for w in m.group(1).split() if len(w) > 3)
                       or any(w in words for w in m.group(3).split() if len(w) > 2)))


# Encyclopedias and dictionaries: about a place or a word, never one business.
_REFERENCE_PAGE = re.compile(r"wiki(pedia|media|data|tionary|wand)|britannica|\bdictionary\b", re.I)


async def discover_new_target_accounts(
    query_or_domain: str,
    target_role: Optional[str] = None
) -> List[Dict[str, Any]]:
    # The searcher's own words (and a role only if they gave one): padding them with words
    # like "contact phone email CEO" pulled in data-broker pages and left engines with nothing.
    search_query = f"{query_or_domain} {target_role}".strip() if target_role else query_or_domain
    results = await search_open_web(search_query, max_results=8)
    
    discovered_accounts = []
    seen = set()
    for idx, item in enumerate(results):
        title = item.get("title", "")
        snippet = item.get("snippet", "")
        url = item.get("url", "")
        
        comp_name = _company_name_from_title(title, url, query_or_domain, snippet)
        if not comp_name or len(comp_name) < 2 or "duckduckgo" in comp_name.lower():
            continue  # no name, or a page listing businesses: not offered (and not charged)
        if _LISTS_MANY.search(title.lower()):
            continue
        if _REFERENCE_PAGE.search(f"{title} {url}"):
            continue

        phone_match = re.search(r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}', snippet)
        phone_candidate = phone_match.group(0).strip() if (phone_match and _is_real_phone(phone_match.group(0))) else ""
        phone = await _telnyx_confirmed_phone(phone_candidate) if phone_candidate else ""

        usable_site = "" if _is_directory_host(url) else _usable_website(url)
        if (usable_site or comp_name.lower()) in seen:
            continue
        seen.add(usable_site or comp_name.lower())

        # Realistic fit score based on authentic verified data availability
        fit_score = 40
        if usable_site:
            fit_score += 30
        if phone:
            fit_score += 20
        if len(snippet) > 80:
            fit_score += 10

        discovered_accounts.append({
            "id": f"disc_{idx}_{idx}",
            "name": comp_name,
            # A web result does not say a company's sector or region: left empty, not guessed.
            "sector": "",
            "region": "",
            "phone": phone,
            "site": usable_site,
            "contactPerson": "",  # Empty until verified contact is found
            "snippet": snippet,
            "openingHook": "",
            "fit": min(fit_score, 100),
            "sourceUrl": url
        })

    return discovered_accounts


def _row_missing_fields(row: Dict[str, Any]) -> List[str]:
    missing = []
    phone = str(row.get("phone") or "").strip()
    email = str(row.get("email") or "").strip()
    contact = str(row.get("contact") or row.get("contactPerson") or "").strip()
    company = str(row.get("name") or row.get("company") or "").strip()
    website = str(row.get("source") or row.get("site") or row.get("website") or row.get("domain") or "").strip()
    linkedin = str(row.get("linkedin") or "").strip()
    if website and _is_junk_web_host(website):
        website = ""
    if email and not _email_fits_context(
        email,
        person=contact,
        company=company,
        site_host=_host_of(website),
    ):
        # Treat random free-mail / junk emails as still missing so we can replace
        if email.split("@")[-1].lower() in _FREE_MAIL:
            email = ""
    if not phone or not _is_real_phone(phone):
        missing.append("phone")
    if not email:
        missing.append("email")
    if not contact:
        missing.append("person")
    if not company:
        missing.append("company")
    if not website:
        missing.append("website")
    if not linkedin:
        missing.append("linkedin")
    return missing


async def fill_contact_gaps(
    rows: List[Dict[str, Any]],
    max_rows: int = 50,
) -> List[Dict[str, Any]]:
    """
    Enrich incomplete contact rows from public web pages and search.
    Never invents placeholder phones. Does not log into Gmail or LinkedIn.
    """
    targets = []
    for row in rows:
        contact = str(row.get("contact") or "").strip()
        name = str(row.get("company") or row.get("name") or contact).strip()
        if name.isdigit():
            name = str(row.get("company") or contact).strip()
        if not name or name.isdigit():
            continue
        missing = _row_missing_fields(row)
        if not missing:
            continue
        targets.append((row, name, missing))

    sem = asyncio.Semaphore(4)

    async def enrich_one(row, name, missing):
        domain = str(row.get("source") or row.get("site") or row.get("domain") or row.get("website") or "").strip()
        if domain and (" " in domain or domain.lower() == "public web search") and not domain.startswith("http"):
            domain = ""
        if domain and _is_junk_web_host(domain):
            domain = ""
        person = str(row.get("contact") or row.get("contactPerson") or "").strip()
        company_field = str(row.get("company") or row.get("name") or "").strip()
        phone = str(row.get("phone") or "").strip()
        town = " ".join(str(x).strip() for x in [row.get("town"), row.get("postcode")] if x).strip()
        query_company = company_field
        query_name = query_company or person or name
        try:
            async with sem:
                data = await asyncio.wait_for(
                    enrich_prospect_intelligence(
                        name=query_name,
                        company=query_company,
                        domain=domain or None,
                        existing_notes=(f"{person} {phone} {row.get('sector') or ''}").strip() or None,
                        deep=True,
                        place=town or None,
                        person=person or None,
                    ),
                    timeout=35,
                )
        except Exception as err:
            logger.warning(f"Gap fill failed for '{name}': {err}")
            return {
                "rowId": row.get("id"),
                "company": name,
                "status": "unenrichable",
                "gaps": missing,
                "note": f"Lookup failed for {name}.",
            }

        try:
            phone = (data.get("primaryPhone") or "").strip()
            if not _is_real_phone(phone):
                phone = ""
            site_host = _host_of(str(data.get("domain") or domain or ""))
            email = _pick_best_email(
                [data.get("primaryEmail") or ""] + list(data.get("emails") or []),
                person=person,
                company=query_company or name,
                site_host=site_host,
            )
            people = data.get("keyPeople") or []
            found_person = ""
            for candidate in people:
                cand_name = str(candidate.get("name") or "").strip()
                # Never fall back to roleHint (CEO, Founder, …) as the contact.
                if _is_person_name(cand_name):
                    found_person = cand_name
                    break
            # Keep file Contact Name when present
            person_out = person if _is_person_name(person) else found_person
            if not phone:
                for candidate in data.get("phones") or []:
                    if _is_real_phone(str(candidate)):
                        phone = str(candidate).strip()
                        break

            socials = data.get("socials") or {}
            reddit = data.get("redditMentions") or []
            linkedin = socials.get("linkedin") or ""
            if "/company/" in linkedin:
                slug = linkedin.split("/company/")[-1].split("/")[0].split("?")[0]
                if slug:
                    linkedin = f"https://www.linkedin.com/company/{slug}"
            elif "/in/" in linkedin:
                slug = linkedin.split("/in/")[-1].split("/")[0].split("?")[0]
                if slug:
                    linkedin = f"https://www.linkedin.com/in/{slug}"
            website = _usable_website(str(data.get("domain") or ""))
            if not website:
                website = _usable_website(domain)
            if not website:
                for url in (data.get("citations") or []):
                    website = _usable_website(str(url or ""))
                    if website:
                        break
            # Prefer company LinkedIn over person profile when we have a company name
            if linkedin and "/in/" in linkedin and query_company:
                for url in (data.get("citations") or []):
                    low = str(url or "").lower()
                    if "linkedin.com/company/" in low:
                        linkedin = url if str(url).startswith("http") else f"https://{url}"
                        break
            found_company = str(data.get("company") or "").strip()
            if found_company and _is_person_name(found_company):
                found_company = ""
            # Infer company label from website host when file had only a person name
            if not found_company and website:
                host_guess = _host_of(website).split(".")[0]
                if host_guess and len(host_guess) > 2 and host_guess.lower() not in ("www", "mail", "app"):
                    found_company = host_guess.replace("-", " ").title()
            safe_source = website or linkedin or ""
            proposal = {
                "rowId": row.get("id"),
                "company": found_company or name,
                "status": "proposed",
                "gaps": missing,
                "confidence": data.get("confidenceScore") or 0,
                "source": safe_source,
                "website": website,
                "openingHook": data.get("openingHook") or "",
                "overview": data.get("overview") or "",
                "linkedin": linkedin,
                "twitter": socials.get("twitter") or "",
                "facebook": socials.get("facebook") or "",
                "instagram": socials.get("instagram") or "",
                "youtube": socials.get("youtube") or "",
                "reddit": (reddit[0].get("url") if reddit else "") or socials.get("reddit") or "",
                "socials": socials,
            }
            found = []
            if "phone" in missing and phone:
                proposal["phone"] = phone
                found.append("phone")
            if "email" in missing and email:
                proposal["email"] = email
                found.append("email")
            if "person" in missing and person_out:
                proposal["contact"] = person_out
                found.append("person")
            if "company" in missing and found_company:
                proposal["company"] = found_company
                found.append("company")
            if "website" in missing and website:
                found.append("website")
            if "linkedin" in missing and linkedin:
                found.append("linkedin")
            if socials:
                found.append("socials")

            if found:
                proposal["gapsFilled"] = found
                return proposal
            return {
                "rowId": row.get("id"),
                "company": name,
                "status": "unenrichable",
                "gaps": missing,
                "note": f"No public phone/email/person/socials found for {name}.",
                "confidence": data.get("confidenceScore") or 0,
                "source": safe_source,
            }
        except Exception as err:
            logger.warning(f"Gap fill parse failed for '{name}': {err}")
            return {
                "rowId": row.get("id"),
                "company": name,
                "status": "unenrichable",
                "gaps": missing,
                "note": f"Lookup failed for {name}.",
            }

    tasks = [enrich_one(row, name, missing) for row, name, missing in targets[:max_rows]]
    raw = await asyncio.gather(*tasks, return_exceptions=True) if tasks else []
    fills = []
    for item, target in zip(raw, targets[:max_rows]):
        row, name, missing = target
        if isinstance(item, Exception):
            fills.append({
                "rowId": row.get("id"),
                "company": name,
                "status": "unenrichable",
                "gaps": missing,
                "note": f"Lookup failed for {name}.",
            })
        else:
            fills.append(item)
    return fills
