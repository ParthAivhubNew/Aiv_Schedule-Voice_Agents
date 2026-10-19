"""Persist pictures and videos as public files the networks (Instagram, Threads, Facebook) can fetch."""
from __future__ import annotations

import base64
import logging
import re
import struct
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from app.config import settings

logger = logging.getLogger("media_store")

MEDIA_DIR = Path(__file__).resolve().parent.parent / "static" / "generated"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_URL_PREFIX = "/api/scheduler/media"
_SAFE_NAME = re.compile(r"^[a-fA-F0-9]{8,32}\.(jpg|jpeg|png|webp|mp4|mov)$")
IMAGE_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp"}
VIDEO_TYPES = {"video/mp4": "mp4", "video/quicktime": "mov"}
MIME_OF = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
           "mp4": "video/mp4", "mov": "video/quicktime"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_VIDEO_BYTES = 200 * 1024 * 1024


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


def local_media_path(url: Optional[str]) -> Optional[Path]:
    """The stored file behind one of our media URLs (relative or absolute), or None."""
    raw = (url or "").strip()
    m = re.search(r"/api/scheduler/media/([a-fA-F0-9]{8,32}\.(jpg|jpeg|png|webp|mp4|mov))$", raw, re.I)
    return safe_media_path(m.group(1) if m else Path(raw).name)


def mime_of(path: Path) -> str:
    return MIME_OF.get(path.suffix.lower().lstrip("."), "application/octet-stream")


def local_media_bytes(image_url: Optional[str]) -> Tuple[Optional[bytes], str]:
    path = local_media_path(image_url)
    if not path:
        return None, "image/jpeg"
    return path.read_bytes(), mime_of(path)


async def store_upload(upload, mime: str) -> Tuple[str, int]:
    """Save an uploaded picture or video in chunks. Returns (url, bytes). Raises ValueError in plain words."""
    mime = (mime or "").lower()
    ext = IMAGE_TYPES.get(mime) or VIDEO_TYPES.get(mime)
    if not ext:
        raise ValueError("Use a PNG, JPG or WebP picture, or an MP4 or MOV video.")
    limit = MAX_VIDEO_BYTES if mime in VIDEO_TYPES else MAX_IMAGE_BYTES
    fid = uuid.uuid4().hex[:16]
    path = MEDIA_DIR / f"{fid}.{ext}"
    size = 0
    try:
        with path.open("wb") as out:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise ValueError(f"That file is over {limit // (1024 * 1024)} MB. Pick a smaller one.")
                out.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    if size < 200:
        path.unlink(missing_ok=True)
        raise ValueError("That file is empty.")
    return f"{MEDIA_URL_PREFIX}/{fid}.{ext}", size


def probe(path: Path) -> Dict[str, Any]:
    """Width, height and (videos) length in seconds; values that cannot be read are None."""
    out: Dict[str, Any] = {"width": None, "height": None, "duration": None}
    if path.suffix.lower() in (".mp4", ".mov"):
        try:
            out.update(_mp4_info(path))
        except Exception as e:
            logger.info(f"Could not read video details of {path.name}: {e}")
        return out
    try:
        from PIL import Image

        with Image.open(path) as im:
            out["width"], out["height"] = im.size
    except Exception as e:
        logger.info(f"Could not read picture size of {path.name}: {e}")
    return out


def _mp4_info(path: Path) -> Dict[str, Any]:
    """Length from the movie header (mvhd) and frame size from the first video track header (tkhd)."""
    info: Dict[str, Any] = {}
    with path.open("rb") as f:
        size = path.stat().st_size

        def boxes(start: int, end: int):
            pos = start
            while pos + 8 <= end:
                f.seek(pos)
                head = f.read(8)
                if len(head) < 8:
                    return
                length, kind = struct.unpack(">I4s", head)
                header = 8
                if length == 1:
                    length = struct.unpack(">Q", f.read(8))[0]
                    header = 16
                elif length == 0:
                    length = end - pos
                if length < header:
                    return
                yield kind, pos + header, pos + length
                pos += length

        for kind, body, end in boxes(0, size):
            if kind != b"moov":
                continue
            for sub, sbody, send in boxes(body, end):
                if sub == b"mvhd" and "duration" not in info:
                    f.seek(sbody)
                    version = f.read(1)[0]
                    f.seek(sbody + (20 if version == 1 else 12))
                    scale = struct.unpack(">I", f.read(4))[0]
                    dur = struct.unpack(">Q" if version == 1 else ">I", f.read(8 if version == 1 else 4))[0]
                    if scale:
                        info["duration"] = round(dur / scale, 2)
                elif sub == b"trak" and "width" not in info:
                    for t, tbody, _ in boxes(sbody, send):
                        if t != b"tkhd":
                            continue
                        f.seek(tbody)
                        version = f.read(1)[0]
                        f.seek(tbody + (88 if version == 1 else 76))
                        w, h = struct.unpack(">II", f.read(8))
                        if w and h:  # audio tracks have no frame size
                            info["width"], info["height"] = w >> 16, h >> 16
            break
    return info


def persist_image_url(image_url: Optional[str], public_base: Optional[str] = None) -> Optional[str]:
    """Turn a data-URI into a public HTTPS URL Graph APIs can download."""
    if not image_url:
        return image_url
    raw = image_url.strip()
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    if not raw.startswith("data:"):
        # Already a locally-hosted relative path (e.g. "/api/scheduler/media/x.jpg") -
        # Graph APIs fetch the image themselves, so it must be an absolute URL.
        if raw.startswith("/"):
            base = (public_base or public_base_from_request()).rstrip("/")
            return f"{base}{raw}"
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
