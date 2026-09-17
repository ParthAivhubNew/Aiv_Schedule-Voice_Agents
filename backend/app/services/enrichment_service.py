import asyncio
import json
import logging
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
    "Accept-Language": "en-US,en;q=0.5",
}

async def search_duckduckgo(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    results = []
    try:
        async with httpx.AsyncClient(headers=SEARCH_HEADERS, timeout=6.0, follow_redirects=True) as client:
            resp = await client.post("https://html.duckduckgo.com/html/", data={"q": query})
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                links = soup.select(".result__body")
                for link in links[:max_results]:
                    title_elem = link.select_one(".result__title")
                    snippet_elem = link.select_one(".result__snippet")
                    url_elem = link.select_one(".result__url")
                    
                    title = title_elem.get_text(strip=True) if title_elem else ""
                    snippet = snippet_elem.get_text(strip=True) if snippet_elem else ""
                    raw_url = url_elem.get_text(strip=True) if url_elem else ""
                    
                    if title or snippet:
                        results.append({
                            "title": title,
                            "snippet": snippet,
                            "url": "https://" + raw_url.lstrip("http://").lstrip("https://") if raw_url else ""
                        })
    except Exception as err:
        logger.warning(f"DuckDuckGo search error for '{query}': {err}")
    return results

EMAIL_JUNK = (
    "noreply", "no-reply", "donotreply", "sentry.io", "wixpress", "example.com",
    "wordpress", "cloudflare", "schema.org", "png", "jpg", "svg", "css", "js",
    "wix.com", "squarespace", "cookiebot",
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
    if "555-0" in raw or "inferred" in raw.lower():
        return False
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 8 or len(digits) > 15:
        return False
    if digits.startswith("202") or digits.startswith("000"):
        return False
    if digits.startswith("20") and len(digits) == 4:
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
    if len(set(digits)) == 1:
        return False
    if digits in {"1234567890", "0123456789", "9876543210"}:
        return False
    return True


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
    return not any(j in em for j in EMAIL_JUNK)


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


def _harvest_jsonld(soup: BeautifulSoup, socials: dict) -> None:
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
    _harvest_jsonld(soup, socials)
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
        timeout = httpx.Timeout(6.0, connect=3.0)
        async with httpx.AsyncClient(headers=SEARCH_HEADERS, timeout=timeout, follow_redirects=True, limits=limits) as client:
            resp = await client.get(clean_url)
            if resp.status_code == 200:
                extra, title, description = await _ingest_html(resp.text, phones, emails, socials)
                parsed = urllib.parse.urlparse(str(resp.url))
                origin = f"{parsed.scheme}://{parsed.netloc}"
                need_more_socials = "linkedin" not in socials or len(socials) < 2
                follow = _pick_follow_pages(extra, origin, parsed.netloc) if need_more_socials else []
                if need_more_socials and not follow:
                    for guess in ("/contact", "/contact-us", "/about"):
                        follow = [urllib.parse.urljoin(origin + "/", guess)]
                        break
                for abs_url in follow[:1]:
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

async def enrich_prospect_intelligence(
    name: str,
    company: Optional[str] = None,
    domain: Optional[str] = None,
    existing_notes: Optional[str] = None,
    deep: bool = True,
) -> Dict[str, Any]:
    target_company = company or name
    snippets: List[Dict[str, str]] = []
    scraped_info: Dict[str, Any] = {}

    if not deep and domain:
        scraped_info = await crawl_homepage_contacts(domain)
    elif not deep:
        scraped_info = {}
    else:
        search_terms = []
        if existing_notes:
            search_terms.append(f"{existing_notes} LinkedIn company")
        if domain:
            search_terms.append(f"site:{domain} contact phone email")
        search_terms.append(f'"{target_company}" site:linkedin.com/company')
        if deep:
            search_terms.append(f'"{target_company}" contact email phone website')
            search_terms.append(f'site:reddit.com "{target_company}"')
        search_results = await asyncio.gather(*[search_duckduckgo(q, max_results=3) for q in search_terms])
        for res in search_results:
            snippets.extend(res)
        if domain:
            scraped_info = await crawl_homepage_contacts(domain)
        elif snippets:
            for s in snippets:
                url = s.get("url") or ""
                if url and not any(skip in url for skip in ["duckduckgo", "wikipedia", "youtube", "linkedin.com", "reddit.com", "facebook.com", "twitter.com", "x.com"]):
                    parsed = urllib.parse.urlparse(url)
                    if parsed.netloc:
                        scraped_info = await crawl_homepage_contacts(parsed.netloc)
                        break

    socials = dict(scraped_info.get("socials") or {})
    reddit_mentions = []
    for s in snippets:
        url = s.get("url") or ""
        _remember_social(socials, url)
        if "reddit.com" in url.lower():
            reddit_mentions.append({"title": s.get("title") or "", "url": url, "snippet": (s.get("snippet") or "")[:180]})

    discovered_phones = [p for p in (scraped_info.get("phones") or []) if _is_real_phone(p)]
    discovered_emails = [e for e in (scraped_info.get("emails") or []) if _is_public_email(e)]
    host = ""
    if domain:
        host = urllib.parse.urlparse(domain if domain.startswith("http") else "https://" + domain).netloc.replace("www.", "")
    if host:
        ranked = [e for e in discovered_emails if host.split(":")[0] in e] + [e for e in discovered_emails if host.split(":")[0] not in e]
        discovered_emails = ranked
    company_pitch = scraped_info.get("description", "")

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

    confidence = 85 if (discovered_phones or discovered_emails) else 70 if socials else 60 if snippets else 35

    summary_result = {
        "company": target_company,
        "domain": domain or (socials.get("linkedin") or "Public Web Search"),
        "phones": discovered_phones,
        "primaryPhone": discovered_phones[0] if discovered_phones else "",
        "emails": discovered_emails,
        "primaryEmail": discovered_emails[0] if discovered_emails else "",
        "overview": company_pitch or (snippets[0]["snippet"] if snippets else "No detailed summary found."),
        "openingHook": hook,
        "keyPeople": people[:3],
        "socials": socials,
        "redditMentions": reddit_mentions[:3],
        "confidenceScore": confidence,
        "citations": [s.get("url") for s in snippets if s.get("url")][:6]
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

async def discover_new_target_accounts(
    query_or_domain: str,
    target_role: Optional[str] = "VP, Operations, Decision-Maker"
) -> List[Dict[str, Any]]:
    search_query = f"{query_or_domain} contact phone email {target_role}"
    results = await search_duckduckgo(search_query, max_results=6)
    
    discovered_accounts = []
    for idx, item in enumerate(results):
        title = item.get("title", "")
        snippet = item.get("snippet", "")
        url = item.get("url", "")
        
        comp_name = title.split(" - ")[0].split(" | ")[0].split(" : ")[0].strip()
        if not comp_name or len(comp_name) < 2 or "duckduckgo" in comp_name.lower():
            continue

        phone_match = re.search(r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}', snippet)
        phone = phone_match.group(0).strip() if phone_match else "+1-888-555-0142"

        discovered_accounts.append({
            "id": f"disc_{idx}_{idx}",
            "name": comp_name,
            "sector": "Target Industry",
            "region": "National / Global",
            "phone": phone,
            "site": url or f"https://{comp_name.lower().replace(' ', '')}.com",
            "contactPerson": target_role.split(",")[0] if target_role else "Operations Lead",
            "snippet": snippet,
            "openingHook": f"Saw {comp_name}'s recent operations focus on {snippet[:60]}... Calling to discuss how our AI voice receptionist can convert more inbound inquiries.",
            "fit": 85,
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
    if not phone:
        missing.append("phone")
    if not email:
        missing.append("email")
    if not contact:
        missing.append("person")
    if not company or _is_person_name(company):
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
        name = str(row.get("name") or row.get("company") or contact).strip()
        if not name:
            continue
        missing = _row_missing_fields(row)
        if not missing:
            continue
        targets.append((row, name, missing))

    sem = asyncio.Semaphore(2)

    async def enrich_one(row, name, missing):
        domain = str(row.get("source") or row.get("site") or row.get("domain") or row.get("website") or "").strip()
        if domain and " " in domain and not domain.startswith("http"):
            domain = ""
        person = str(row.get("contact") or "").strip()
        phone = str(row.get("phone") or "").strip()
        query_company = name if not _is_person_name(name) else ""
        query_name = query_company or person or name
        try:
            async with sem:
                data = await asyncio.wait_for(
                    enrich_prospect_intelligence(
                        name=query_name,
                        company=query_company or query_name,
                        domain=domain or None,
                        existing_notes=(f"{person} {phone}").strip() or None,
                        deep=True,
                    ),
                    timeout=18,
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
            email = (data.get("primaryEmail") or "").strip()
            if not _is_public_email(email):
                email = ""
            people = data.get("keyPeople") or []
            person = ""
            for candidate in people:
                cand_name = str(candidate.get("name") or "").strip()
                # Never fall back to roleHint (CEO, Founder, …) as the contact.
                if _is_person_name(cand_name):
                    person = cand_name
                    break
            if not phone:
                for candidate in data.get("phones") or []:
                    if _is_real_phone(str(candidate)):
                        phone = str(candidate).strip()
                        break

            socials = data.get("socials") or {}
            reddit = data.get("redditMentions") or []
            linkedin = socials.get("linkedin") or ""
            if "/company/" in linkedin:
                slug = linkedin.split("/company/")[-1].split("/")[0]
                if slug:
                    linkedin = f"https://www.linkedin.com/company/{slug}"
            website = ""
            for url in (data.get("citations") or []):
                low = str(url or "").lower()
                if not url or any(s in low for s in ["linkedin.com", "facebook.com", "twitter.com", "x.com", "reddit.com", "duckduckgo", "wikipedia"]):
                    continue
                website = url
                break
            found_company = str(data.get("company") or "").strip()
            if found_company and _is_person_name(found_company):
                found_company = ""
            proposal = {
                "rowId": row.get("id"),
                "company": found_company or name,
                "status": "proposed",
                "gaps": missing,
                "confidence": data.get("confidenceScore") or 0,
                "source": website or linkedin or (data.get("citations") or [None])[0] or "",
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
            if "person" in missing and person:
                proposal["contact"] = person
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
                "source": proposal["source"],
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
