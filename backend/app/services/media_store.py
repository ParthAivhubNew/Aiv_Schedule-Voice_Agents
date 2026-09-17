"""Persist generated images as public files Instagram / Threads can fetch."""
from __future__ import annotations

import base64
import logging
import re
import uuid
from pathlib import Path
from typing import Optional, Tuple

from app.config import settings

logger = logging.getLogger("media_store")

MEDIA_DIR = Path(__file__).resolve().parent.parent / "static" / "generated"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_URL_PREFIX = "/api/scheduler/media"
_SAFE_NAME = re.compile(r"^[a-fA-F0-9]{8,32}\.(jpg|jpeg|png|webp)$")


def public_base_from_request(request=None) -> str:
    env = (getattr(settings, "PUBLIC_BASE_URL", None) or "").strip().rstrip("/")

    def _usable(host: str) -> bool:
        h = (host or "").lower()
        if not h:
            return False
        if "localhost" in h or "127.0.0.1" in h:
            return False
        if h.startswith("backend") or "aivhub_backend" in h:
            return False
        return True

    if request is not None:
        try:
            forwarded = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
            host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(",")[0].strip()
            if _usable(host):
                scheme = forwarded or request.url.scheme or "https"
                if "litng.ai" in host or "cloudspaces" in host:
                    scheme = "https"
                return f"{scheme}://{host}".rstrip("/")
            url = str(request.base_url).rstrip("/")
            host_only = url.replace("https://", "").replace("http://", "").split("/")[0]
            if url and _usable(host_only):
                return url
        except Exception:
            pass
    return env or "http://127.0.0.1:8000"


def safe_media_path(filename: str) -> Optional[Path]:
    name = Path(filename or "").name
    if not _SAFE_NAME.match(name):
        return None
    path = MEDIA_DIR / name
    return path if path.is_file() else None


def store_image_bytes(raw: bytes, mime: str = "image/jpeg") -> Optional[str]:
    if not raw or len(raw) < 200:
        return None
    ext = "jpg"
    lower = (mime or "").lower()
    if "png" in lower:
        ext = "png"
    elif "webp" in lower:
        ext = "webp"
    fid = uuid.uuid4().hex[:16]
    path = MEDIA_DIR / f"{fid}.{ext}"
    path.write_bytes(raw)
    return f"{MEDIA_URL_PREFIX}/{fid}.{ext}"


def local_media_bytes(image_url: Optional[str]) -> Tuple[Optional[bytes], str]:
    raw = (image_url or "").strip()
    m = re.search(r"/api/scheduler/media/([a-fA-F0-9]{8,32}\.(jpg|jpeg|png|webp))$", raw, re.I)
    name = m.group(1) if m else Path(raw).name
    path = safe_media_path(name)
    if not path:
        return None, "image/jpeg"
    blob = path.read_bytes()
    ext = path.suffix.lower()
    mime = "image/png" if ext == ".png" else ("image/webp" if ext == ".webp" else "image/jpeg")
    return blob, mime


def persist_image_url(image_url: Optional[str], public_base: Optional[str] = None) -> Optional[str]:
    """Turn a data-URI into a public HTTPS URL Graph APIs can download."""
    if not image_url:
        return image_url
    raw = image_url.strip()
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    if not raw.startswith("data:"):
        return raw
    try:
        header, b64 = raw.split(",", 1)
        blob = base64.b64decode(b64)
    except Exception as e:
        logger.warning(f"Could not decode generated image: {e}")
        return raw
    if len(blob) < 80:
        return raw
    ext = "jpg"
    lower = header.lower()
    if "png" in lower:
        ext = "png"
    elif "webp" in lower:
        ext = "webp"
    fid = uuid.uuid4().hex[:16]
    path = MEDIA_DIR / f"{fid}.{ext}"
    path.write_bytes(blob)
    base = (public_base or public_base_from_request()).rstrip("/")
    hosted = f"{base}{MEDIA_URL_PREFIX}/{fid}.{ext}"
    logger.info(f"Stored generated image {path.name} ({len(blob)} bytes) at {hosted}")
    return hosted
