"""Phone numbers a company shows on its OWN website.

find_phones() reads the home page and a few likely contact pages (at most MAX_PAGES), and
extract_from_html() pulls numbers out of one page: tel: links, schema.org telephone (JSON-LD and
microdata), header/footer text and the visible text. Only valid UK numbers are kept. Fax lines,
premium-rate (09), 08 numbers, drama-range numbers and obvious junk are dropped, so a number that
reaches a customer is one the company publishes itself. Nothing here ever reads a Google value.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote, urljoin, urlparse

import httpx
import phonenumbers
from bs4 import BeautifulSoup

logger = logging.getLogger("site_phones")

MAX_PAGES = 4  # home page + three more, per site
MAX_BYTES = 1_500_000
FIXED_PATHS = ("/contact", "/contact-us", "/about", "/about-us")
VIA_RANK = {"tel": 0, "jsonld": 0, "microdata": 0, "footer": 1, "text": 2}
_SKIP_EXT = re.compile(r"\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3)(\?|$)", re.I)

# 0 / +44 / (0) then 9-10 more digits, with the usual spaces, dots, dashes and brackets between them
_PHONE_TEXT = re.compile(r"(?<![\w.])(?:\+?44[\s().-]*(?:\(0\)[\s.-]*)?|\(?0\)?)(?:\d[\s().-]*){9,10}(?!\d)")


def normalise(raw: str) -> Optional[Dict[str, str]]:
    """{number (E.164), display, kind} for a valid UK landline or mobile, else None."""
    from app.services import uk_phone

    s = (raw or "").strip()
    if s.startswith("(0)"):
        s = "0" + s[3:]
    s = re.sub(r"\(0\)", "", s)
    s = ("+" if s.startswith("+") else "") + re.sub(r"\D", "", s)
    if s.startswith("0044"):
        s = "+" + s[2:]
    try:
        num = phonenumbers.parse(s, "GB")
    except phonenumbers.NumberParseException:
        return None
    if num.country_code != 44 or not phonenumbers.is_valid_number(num):
        return None
    nsn = str(num.national_number)
    if len(set(nsn)) <= 3 or re.search(r"(\d)\1{5}", nsn) or uk_phone.fictional("0" + nsn):
        return None
    kind = phonenumbers.number_type(num)
    if nsn[0] == "7" and kind == phonenumbers.PhoneNumberType.MOBILE:
        label = "mobile"
    elif nsn[0] in "123" and kind in (phonenumbers.PhoneNumberType.FIXED_LINE, phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE,
                                      phonenumbers.PhoneNumberType.UAN):
        label = "landline"
    else:
        return None  # 08 and 09 ranges, 070 personal numbers, pagers, VoIP
    return {"number": phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.E164),
            "display": phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.NATIONAL), "kind": label}


def _is_fax(before: str) -> bool:
    return "fax" in before.lower()


def _json_phones(node: Any, out: List[str]) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "telephone":
                out.extend(str(x) for x in (v if isinstance(v, list) else [v]) if x)
            else:
                _json_phones(v, out)
    elif isinstance(node, list):
        for v in node:
            _json_phones(v, out)


def extract_from_html(html: str, base_url: str = "") -> List[Dict[str, str]]:
    """Candidates on one page: [{number, display, kind, source_url, via}], already deduped, best way first."""
    soup = BeautifulSoup((html or "")[:MAX_BYTES], "html.parser")
    raws: List[Tuple[str, str]] = []  # (raw number, via)

    for tag in soup.find_all("script", type=re.compile("ld\\+json", re.I)):
        try:
            data = json.loads(tag.string or tag.get_text() or "")
        except ValueError:
            continue
        found: List[str] = []
        _json_phones(data, found)
        raws.extend((p, "jsonld") for p in found)

    for el in soup.find_all(attrs={"itemprop": "telephone"}):
        val = el.get("content") or (el.get("href") or "").replace("tel:", "") or el.get_text(" ")
        if not _is_fax(" ".join(str(c) for c in (el.get("class") or []))):
            raws.append((unquote(str(val)), "microdata"))

    for a in soup.find_all("a", href=re.compile(r"^\s*tel:", re.I)):
        prev = a.find_previous(string=True)
        before = (str(prev)[-25:] if prev else "") + " " + " ".join(a.get("class") or []) + " " + (a.get("aria-label") or "")
        if _is_fax(before):
            continue
        raws.append((unquote(re.sub(r"^\s*tel:", "", a["href"], flags=re.I)), "tel"))

    for tag in soup(["script", "style", "noscript", "template"]):
        tag.decompose()
    footers = [el for el in soup.find_all(["footer", "header"])] + soup.find_all(
        attrs={"id": re.compile("footer|header", re.I)}) + soup.find_all(attrs={"class": re.compile("footer|header", re.I)})
    for el in footers:
        raws.extend(_scan_text(el.get_text(" "), "footer"))
    raws.extend(_scan_text(soup.get_text(" "), "text"))

    out: Dict[str, Dict[str, str]] = {}
    for raw, via in raws:
        n = normalise(raw)
        if not n:
            continue
        have = out.get(n["number"])
        if have is None or VIA_RANK[via] < VIA_RANK[have["via"]]:
            out[n["number"]] = {**n, "source_url": base_url, "via": via}
    return sorted(out.values(), key=lambda c: VIA_RANK[c["via"]])


def _scan_text(text: str, via: str) -> List[Tuple[str, str]]:
    text = re.sub(r"\s+", " ", text or "")
    found, prev_end = [], 0
    for m in _PHONE_TEXT.finditer(text):
        before = text[max(prev_end, m.start() - 25):m.start()]
        prev_end = m.end()
        if _is_fax(before) or re.match(r"\s*[(\[]\s*fax", text[m.end():m.end() + 8], re.I):
            continue
        found.append((m.group(0).strip(), via))
    return found


def _same_site(a: str, b: str) -> bool:
    host = lambda u: (urlparse(u).hostname or "").lower().removeprefix("www.")  # noqa: E731
    return bool(host(a)) and host(a) == host(b)


def contact_links(html: str, base_url: str) -> List[str]:
    """Same-site links whose text or address mentions "contact", in page order."""
    soup = BeautifulSoup((html or "")[:MAX_BYTES], "html.parser")
    out: List[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")) or _SKIP_EXT.search(href):
            continue
        if "contact" not in (href + " " + a.get_text(" ")).lower():
            continue
        url = urljoin(base_url, href).split("#")[0]
        if urlparse(url).scheme in ("http", "https") and _same_site(url, base_url) and url not in out:
            out.append(url)
    return out


class _Resp:
    def __init__(self, status_code: int, text: str, url: str):
        self.status_code, self.text, self.url = status_code, text, url


class SafeClient:
    """httpx with the same guards as safe_fetch: public addresses only, default ports, few redirects, capped download."""

    def __init__(self) -> None:
        from app.services.crawler_service import USER_AGENT

        self._c = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=False,
                                    headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
                                             "Accept-Language": "en-GB,en;q=0.9"})

    async def get(self, url: str) -> _Resp:
        from app.services.safe_fetch import MAX_REDIRECTS, FetchRefused, _check

        current = url
        for _ in range(MAX_REDIRECTS + 1):
            await _check(current)
            async with self._c.stream("GET", current) as r:
                if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                    current = urljoin(current, r.headers["location"])
                    continue
                kind = (r.headers.get("content-type") or "").lower()
                if r.status_code >= 400 or (kind and "html" not in kind and "text" not in kind):
                    return _Resp(r.status_code if r.status_code >= 400 else 415, "", current)
                body = b""
                async for chunk in r.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES:
                        break
                return _Resp(r.status_code, body.decode(r.encoding or "utf-8", errors="replace"), current)
        raise FetchRefused("Too many redirects.")

    async def aclose(self) -> None:
        await self._c.aclose()


async def _page(client: Any, url: str) -> Optional[Tuple[str, str]]:
    try:
        r = await client.get(url)
    except Exception as err:  # a dead, refused or slow site is a normal outcome here
        logger.debug("site_phones: %s: %s", url, err)
        return None
    if getattr(r, "status_code", 0) >= 400 or not getattr(r, "text", ""):
        return None
    return str(getattr(r, "url", None) or url), r.text


async def find_phones(website_url: str, client: Any = None) -> List[Dict[str, str]]:
    """Valid UK numbers on the company's own site: [{number, display, kind, source_url, found_on, via}], best first.

    client: anything with `async get(url)` returning .status_code, .text and .url; by default a guarded httpx client."""
    url = (website_url or "").strip()
    if not url:
        return []
    if "://" not in url:
        url = "https://" + url
    own = client is None
    client = client or SafeClient()
    try:
        fetched = 0
        home = await _page(client, url)
        fetched += 1
        if home is None and url.startswith("https://"):  # some small sites only answer on plain http
            home = await _page(client, "http://" + url[len("https://"):])
            fetched += 1
        if home is None:
            return []
        base, html = home
        queue = contact_links(html, base)
        for path in FIXED_PATHS:
            cand = urljoin(base, path)
            if cand not in queue:
                queue.append(cand)
        pages = [(base, html)]
        tried = {base.rstrip("/"), url.rstrip("/")}
        for cand in queue:
            if fetched >= MAX_PAGES:
                break
            if cand.rstrip("/") in tried:
                continue
            tried.add(cand.rstrip("/"))
            fetched += 1
            got = await _page(client, cand)
            if got:
                pages.append(got)
        today = date.today().isoformat()
        best: Dict[str, Dict[str, str]] = {}
        for page_url, page_html in pages:
            for c in extract_from_html(page_html, page_url):
                have = best.get(c["number"])
                if have is None or VIA_RANK[c["via"]] < VIA_RANK[have["via"]]:
                    best[c["number"]] = {**c, "found_on": today}
        return sorted(best.values(), key=lambda c: VIA_RANK[c["via"]])  # stable: page order breaks ties
    finally:
        if own:
            await client.aclose()


def record_patch(found: List[Dict[str, str]], current_phone: str = "") -> Tuple[Dict[str, Any], str]:
    """(raw_data keys to merge, phone to set or "") for a BusinessRecord. Every number goes in raw_data["site_phones"]
    (an empty list marks the site as read, so it is not read again); the best one also becomes the phone when the
    record has none, with its source page and date in raw_data["phone_source"]. Source is always "website"."""
    patch: Dict[str, Any] = {"site_phones": {"source": "website", "numbers": found, "checked_at": datetime.utcnow().isoformat() + "Z"}}
    phone = ""
    if found and not (current_phone or "").strip():
        top = found[0]
        phone = top["display"]
        patch["phone_source"] = {"source": "website", "url": top["source_url"], "found_on": top["found_on"], "via": top["via"]}
    return patch, phone


def save_on_record(biz: Any, found: List[Dict[str, str]]) -> bool:
    """Apply record_patch to a BusinessRecord object. True when it found numbers."""
    patch, phone = record_patch(found, getattr(biz, "phone", ""))
    biz.raw_data = {**(getattr(biz, "raw_data", None) or {}), **patch}
    if phone:
        biz.phone = phone
    return bool(found)


async def find_many(urls: List[str], concurrency: int = 6) -> List[List[Dict[str, str]]]:
    """find_phones for several sites at once, a few at a time."""
    sem = asyncio.Semaphore(concurrency)

    async def one(u: str) -> List[Dict[str, str]]:
        async with sem:
            return await find_phones(u)

    return await asyncio.gather(*(one(u) for u in urls))
