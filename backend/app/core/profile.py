"""A person's own profile: details kept in operators.profile, and the photo under static/avatars."""
from __future__ import annotations

import io
import re
import uuid
from pathlib import Path
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo, available_timezones

AVATAR_DIR = Path(__file__).resolve().parent.parent / "static" / "avatars"
AVATAR_PX = 256
AVATAR_MAX_BYTES = 2 * 1024 * 1024
AVATAR_URL = "/media/avatars/"

# key -> longest value kept
TEXT_FIELDS: Dict[str, int] = {
    "first_name": 60, "last_name": 60, "gender": 40, "job_title": 80, "department": 80,
    "company": 120, "bio": 500, "website": 200, "signature": 600,
}
CHOICES = {
    "date_format": ("dmy", "mdy"),
    "time_format": ("24h", "12h"),
}
EMPTY = {k: "" for k in [*TEXT_FIELDS, "secondary_email", "timezone", "language", *CHOICES]}
LANGUAGES = {"en", "es", "fr", "de", "it", "pt", "nl", "pl", "hi", "ar"}
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def clean(patch: Dict[str, Any]) -> Dict[str, str]:
    """Checks the fields a person sent and returns only the valid ones. Raises ValueError with a message to show."""
    out: Dict[str, str] = {}
    for key, limit in TEXT_FIELDS.items():
        if key in patch and patch[key] is not None:
            val = str(patch[key]).strip()
            if len(val) > limit:
                raise ValueError(f"{key.replace('_', ' ').capitalize()} is too long (max {limit} characters).")
            out[key] = val
    if out.get("website"):
        site = out["website"]
        if " " in site or "." not in site:
            raise ValueError("That website address does not look right.")
        if not re.match(r"^https?://", site, re.I):
            out["website"] = "https://" + site
    if patch.get("secondary_email") is not None:
        mail = str(patch["secondary_email"]).strip()
        if mail and (not _EMAIL.match(mail) or len(mail) > 254):
            raise ValueError("That second email address does not look right.")
        out["secondary_email"] = mail
    if patch.get("timezone") is not None:
        tz = str(patch["timezone"]).strip()
        if tz and tz not in available_timezones():
            raise ValueError("Pick a timezone from the list.")
        out["timezone"] = tz
    if patch.get("language") is not None:
        lang = str(patch["language"]).strip().lower()
        if lang and lang not in LANGUAGES:
            raise ValueError("That language is not available yet.")
        out["language"] = lang
    for key, allowed in CHOICES.items():
        if patch.get(key) is not None:
            val = str(patch[key]).strip()
            if val and val not in allowed:
                raise ValueError(f"Pick one of: {', '.join(allowed)}.")
            out[key] = val
    return out


def phone_problem(phone: str) -> Optional[str]:
    digits = re.sub(r"\D", "", phone)
    if phone and (len(digits) < 6 or len(digits) > 15 or not re.match(r"^[+\d][\d\s().-]*$", phone)):
        return "That phone number does not look right."
    return None


def details(op) -> Dict[str, str]:
    return {**EMPTY, **{k: v for k, v in (op.profile or {}).items() if k in EMPTY}}


def avatar_url(op) -> Optional[str]:
    return f"{AVATAR_URL}{op.avatar_file}" if getattr(op, "avatar_file", None) else None


def make_avatar(raw: bytes) -> bytes:
    """A centred square JPEG of AVATAR_PX from an uploaded JPG, PNG or WebP. Raises ValueError when it is not a usable picture."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    if len(raw) > AVATAR_MAX_BYTES:
        raise ValueError("That photo is over 2 MB. Pick a smaller one.")
    try:
        img = Image.open(io.BytesIO(raw))
        if img.format not in ("JPEG", "PNG", "WEBP"):
            raise ValueError("Use a JPG, PNG or WebP photo.")
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "LA", "P"):
            flat = Image.new("RGB", img.size, "white")
            flat.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
            img = flat
        else:
            img = img.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ValueError("That file is not a picture we can read.")
    img = ImageOps.fit(img, (AVATAR_PX, AVATAR_PX), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88, optimize=True)
    return buf.getvalue()


def save_avatar(data: bytes) -> str:
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.jpg"
    (AVATAR_DIR / name).write_bytes(data)
    return name


def delete_avatar(name: Optional[str]) -> None:
    if name and re.fullmatch(r"[0-9a-f]{32}\.jpg", name):
        try:
            (AVATAR_DIR / name).unlink()
        except FileNotFoundError:
            pass
