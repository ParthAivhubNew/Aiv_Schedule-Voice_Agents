"""A company's logo, taken from its own website and kept on our server.

The browser asks us (never the company's site), so searching never tells a company, or anyone else, who looked at it. We read the
site's own icon (apple-touch-icon, then the page's icon links, then /favicon.ico), keep it for a month, and remember a miss for a
week. Only public internet addresses are read (see safe_fetch), with a small download and a short timeout."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx

from app.services.safe_fetch import FetchRefused, _check

logger = logging.getLogger("logos")

LOGO_DIR = Path(__file__).resolve().parents[2] / "data" / "logos"
HIT_TTL = 30 * 86400
MISS_TTL = 7 * 86400
MAX_PAGE = 300_000
MAX_IMAGE = 400_000
_LIMIT = asyncio.Semaphore(6)
_LINK = re.compile(r"<link\b[^>]*>", re.I)
_ATTR = re.compile(r"""([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')""")
_MAGIC = ((b"\x89PNG", "image/png"), (b"\xff\xd8\xff", "image/jpeg"), (b"GIF8", "image/gif"), (b"\x00\x00\x01\x00", "image/x-icon"))


def _kind(data: bytes) -> str:
    for magic, kind in _MAGIC:
        if data.startswith(magic):
            return kind
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return ""


async def _read(client: httpx.AsyncClient, url: str, cap: int) -> Optional[Tuple[bytes, str]]:
    """The body (up to cap bytes) and final address of a public page, following a few redirects."""
    current = url
    for _ in range(4):
        await _check(current)
        async with client.stream("GET", current) as r:
            if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                current = urljoin(current, r.headers["location"])
                continue
            if r.status_code >= 400:
                return None
            body = b""
            async for chunk in r.aiter_bytes():
                body += chunk
                if len(body) > cap:
                    break
            return body[:cap], current
    return None


def _icon_links(html: str, base: str) -> List[str]:
    found = []
    for tag in _LINK.findall(html or ""):
        attrs = {m.group(1).lower(): (m.group(2) if m.group(2) is not None else m.group(3)) for m in _ATTR.finditer(tag)}
        rel = (attrs.get("rel") or "").lower()
        href = attrs.get("href") or ""
        if not href or "icon" not in rel or "mask-icon" in rel:
            continue
        size = max([int(n) for n in re.findall(r"\d+", attrs.get("sizes") or "")] or [0])
        score = (3 if "apple-touch-icon" in rel else 2 if size >= 64 else 1, size)
        found.append((score, urljoin(base, href)))
    return [u for _, u in sorted(found, reverse=True)]


def _paths(host: str) -> Tuple[Path, Path, Path]:
    key = hashlib.sha1(host.encode()).hexdigest()
    return LOGO_DIR / f"{key}.bin", LOGO_DIR / f"{key}.type", LOGO_DIR / f"{key}.none"


def _fresh(path: Path, ttl: int) -> bool:
    try:
        return time.time() - path.stat().st_mtime < ttl
    except OSError:
        return False


async def logo_for(site: str) -> Optional[Tuple[bytes, str]]:
    """(image bytes, content type) for a company website, or None when it has no usable icon."""
    parsed = urlparse(site if "://" in str(site) else "https://" + str(site))
    host = (parsed.hostname or "").lower()
    if not host or "." not in host:
        return None
    data_f, type_f, none_f = _paths(host)
    if _fresh(data_f, HIT_TTL):
        try:
            return data_f.read_bytes(), type_f.read_text().strip() or "image/png"
        except OSError:
            pass
    if _fresh(none_f, MISS_TTL):
        return None
    result: Optional[Tuple[bytes, str]] = None
    async with _LIMIT:
        try:
            from app.services.crawler_service import USER_AGENT

            async with httpx.AsyncClient(timeout=4.0, follow_redirects=False, headers={"User-Agent": USER_AGENT}) as client:
                candidates: List[str] = []
                roots = [host] if host.startswith("www.") else [host, "www." + host]  # some sites only answer on one of the two
                served = host
                for root in roots:
                    try:
                        page = await _read(client, f"https://{root}/", MAX_PAGE)
                    except (FetchRefused, httpx.HTTPError):
                        continue
                    if page:
                        served = root
                        candidates = _icon_links(page[0].decode("utf-8", "ignore"), page[1])
                        break
                for url in candidates[:3] + [f"https://{served}/apple-touch-icon.png", f"https://{served}/favicon.ico"]:
                    try:
                        got = await _read(client, url, MAX_IMAGE)
                    except (FetchRefused, httpx.HTTPError):
                        continue
                    if got and len(got[0]) >= 200 and _kind(got[0]):
                        result = (got[0], _kind(got[0]))
                        break
        except Exception as err:  # a logo is a nicety: never an error
            logger.debug(f"[logos] {host}: {err}")
    try:
        LOGO_DIR.mkdir(parents=True, exist_ok=True)
        if result:
            data_f.write_bytes(result[0])
            type_f.write_text(result[1])
        else:
            none_f.write_text("")
    except OSError:
        pass
    return result
