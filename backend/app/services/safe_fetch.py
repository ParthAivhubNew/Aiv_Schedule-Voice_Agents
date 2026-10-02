"""Read a public web page a user pasted into a chat, safely.

Only http(s) on the default ports, only public internet addresses (never our own server, the
cloud metadata address or a private network), at most a few redirects, a small download and a
short timeout. Returns plain text for an AI prompt."""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
from typing import List, Tuple
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger("safe_fetch")

MAX_BYTES = 1_500_000
MAX_REDIRECTS = 3
TIMEOUT = 12.0
_URL = re.compile(r"https?://[^\s<>()\"']+", re.I)


class FetchRefused(Exception):
    pass


def urls_in(text: str, limit: int = 2) -> List[str]:
    out: List[str] = []
    for m in _URL.finditer(text or ""):
        u = m.group(0).rstrip(".,;:!?)]}")
        if u not in out:
            out.append(u)
        if len(out) >= limit:
            break
    return out


async def _check(url: str) -> None:
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise FetchRefused("Only http and https links can be read.")
    if p.port not in (None, 80, 443):
        raise FetchRefused("That link uses an unusual port.")
    if p.username or p.password:
        raise FetchRefused("Links with a login in them are not read.")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(p.hostname, p.port or (443 if p.scheme == "https" else 80),
                                                             type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise FetchRefused("That website could not be found.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise FetchRefused("That address is not a public website.")


async def fetch_text(url: str, max_chars: int = 6000) -> Tuple[str, str]:
    """(title, text) of a public page. Raises FetchRefused with a plain reason."""
    from app.services.crawler_service import USER_AGENT, extract_clean_text_from_html

    current = url
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": USER_AGENT}) as client:
        for _ in range(MAX_REDIRECTS + 1):
            await _check(current)
            async with client.stream("GET", current) as r:
                if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                    current = urljoin(current, r.headers["location"])
                    continue
                if r.status_code >= 400:
                    raise FetchRefused(f"The page answered with error {r.status_code}.")
                kind = (r.headers.get("content-type") or "").lower()
                if kind and "html" not in kind and "text" not in kind:
                    raise FetchRefused("That link is not a web page (it may be a file).")
                body = b""
                async for chunk in r.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES:
                        break
                html = body.decode(r.encoding or "utf-8", errors="replace")
                break
        else:
            raise FetchRefused("Too many redirects.")
    if "html" in kind or "<html" in html[:500].lower():
        title, text = extract_clean_text_from_html(html)
    else:
        title, text = "", html
    text = re.sub(r"\n{3,}", "\n\n", text or "").strip()
    return title.strip()[:200], text[:max_chars]
