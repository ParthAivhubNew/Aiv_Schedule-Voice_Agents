import asyncio
import logging
import re
import urllib.parse
from typing import Dict, List, Any, Optional
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
        async with httpx.AsyncClient(headers=SEARCH_HEADERS, timeout=10.0, follow_redirects=True) as client:
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
    "linkedin": ("linkedin.com/company", "linkedin.com/in/"),
    "twitter": ("twitter.com/", "x.com/"),
    "facebook": ("facebook.com/", "fb.com/"),
    "instagram": ("instagram.com/",),
    "youtube": ("youtube.com/", "youtu.be/"),
    "reddit": ("reddit.com/r/", "reddit.com/user/"),
    "tiktok": ("tiktok.com/@",),
    "github": ("github.com/",),
    "crunchbase": ("crunchbase.com/organization",),
}


def _clean_href(href: str) -> str:
    href = (href or "").strip()
    if href.startswith("//"):
        return "https:" + href
    return href


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
    return True


def _is_public_email(raw: str) -> bool:
    em = (raw or "").strip().lower()
    if "@" not in em or em.endswith((".png", ".jpg", ".svg", ".css", ".js", ".webp")):
        return False
    return not any(j in em for j in EMAIL_JUNK)


def _social_key_from_url(url: str) -> Optional[str]:
    low = (url or "").lower()
    for key, needles in SOCIAL_HOSTS.items():
        if any(n in low for n in needles):
            if key == "github" and any(x in low for x in ("github.com/login", "github.com/features", "github.com/about")):
                return None
            if key == "facebook" and any(x in low for x in ("facebook.com/sharer", "facebook.com/dialog", "facebook.com/privacy")):
                return None
            return key
    return None


def _harvest_soup(soup: BeautifulSoup, phones: set, emails: set, socials: dict) -> List[str]:
    extra_pages = []
    text = soup.get_text(separator=" ")
    for pm in re.findall(r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}', text):
        if _is_real_phone(pm):
            phones.add(pm.strip())
    for em in re.findall(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', text):
        if _is_public_email(em):
            emails.add(em.lower())
    for a in soup.find_all("a", href=True):
        href = _clean_href(a["href"])
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
        key = _social_key_from_url(href)
        if key and key not in socials:
            socials[key] = href if href.startswith("http") else href
        if any(p in low for p in ("/contact", "/about", "/impressum", "/support")):
            extra_pages.append(href)
    return extra_pages


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
        async with httpx.AsyncClient(headers=SEARCH_HEADERS, timeout=8.0, follow_redirects=True) as client:
            resp = await client.get(clean_url)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                title = soup.title.get_text(strip=True) if soup.title else ""
                meta_desc = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
                if meta_desc and meta_desc.get("content"):
                    description = meta_desc["content"].strip()
                extra = _harvest_soup(soup, phones, emails, socials)
                parsed = urllib.parse.urlparse(str(resp.url))
                origin = f"{parsed.scheme}://{parsed.netloc}"
                followed = 0
                for href in extra:
                    if followed >= 1:
                        break
                    abs_url = urllib.parse.urljoin(origin + "/", href)
                    if urllib.parse.urlparse(abs_url).netloc != parsed.netloc:
                        continue
                    try:
                        extra_resp = await client.get(abs_url)
                        if extra_resp.status_code == 200:
                            _harvest_soup(BeautifulSoup(extra_resp.text, "html.parser"), phones, emails, socials)
                            followed += 1
                    except Exception:
                        continue
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
    existing_notes: Optional[str] = None
) -> Dict[str, Any]:
    search_terms = []
    target_company = company or name
    if domain:
        search_terms.append(f"site:{domain} contact phone email")
    search_terms.append(f'"{target_company}" site:linkedin.com/company')
    search_terms.append(f'"{target_company}" contact email phone')
    search_terms.append(f'site:reddit.com "{target_company}"')

    snippets = []
    for q in search_terms:
        res = await search_duckduckgo(q, max_results=3)
        snippets.extend(res)

    scraped_info = {}
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
        key = _social_key_from_url(url)
        if key and key not in socials:
            socials[key] = url
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
        if match:
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

    try:
        await log_process_event(
            subsystem="crawler_rag",
            process_name="prospect_web_enrichment",
            message=f"Enriched dossier for '{target_company}': Found {len(discovered_phones)} phones, {len(discovered_emails)} emails, confidence={confidence}%.",
            level="SUCCESS" if confidence > 50 else "INFO",
            details=summary_result
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
    if not str(row.get("phone") or "").strip():
        missing.append("phone")
    if not str(row.get("email") or "").strip():
        missing.append("email")
    if not str(row.get("contact") or row.get("contactPerson") or "").strip():
        missing.append("person")
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
        name = str(row.get("name") or row.get("company") or "").strip()
        if not name:
            continue
        missing = _row_missing_fields(row)
        if not missing:
            continue
        targets.append((row, name, missing))

    sem = asyncio.Semaphore(4)

    async def enrich_one(row, name, missing):
        domain = str(row.get("source") or row.get("site") or row.get("domain") or "").strip()
        if domain and " " in domain and not domain.startswith("http"):
            domain = ""
        async with sem:
            try:
                data = await enrich_prospect_intelligence(
                    name=name,
                    company=name,
                    domain=domain or None,
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

        phone = (data.get("primaryPhone") or "").strip()
        if not _is_real_phone(phone):
            phone = ""
        email = (data.get("primaryEmail") or "").strip()
        if not _is_public_email(email):
            email = ""
        people = data.get("keyPeople") or []
        person = ""
        if people and people[0].get("name"):
            person = people[0]["name"]
        if not phone:
            for candidate in data.get("phones") or []:
                if _is_real_phone(str(candidate)):
                    phone = str(candidate).strip()
                    break
        overview = data.get("overview") or ""
        if not phone:
            snippet_match = re.search(
                r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}",
                overview,
            )
            if snippet_match and _is_real_phone(snippet_match.group(0)):
                phone = snippet_match.group(0).strip()

        socials = data.get("socials") or {}
        reddit = data.get("redditMentions") or []
        proposal = {
            "rowId": row.get("id"),
            "company": name,
            "status": "proposed",
            "gaps": missing,
            "confidence": data.get("confidenceScore") or 0,
            "source": socials.get("linkedin") or (data.get("citations") or [None])[0] or data.get("domain") or "",
            "openingHook": data.get("openingHook") or "",
            "overview": data.get("overview") or "",
            "linkedin": socials.get("linkedin") or "",
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

    tasks = [enrich_one(row, name, missing) for row, name, missing in targets[:max_rows]]
    return list(await asyncio.gather(*tasks)) if tasks else []
