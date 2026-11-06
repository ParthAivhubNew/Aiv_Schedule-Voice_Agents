"""The company's own logo, placed on a finished AI picture.

The picture AI draws the scene; it never draws the logo (models misspell and invent logos). When a company turns "Put my logo on
pictures" on, this step places the real logo file they uploaded in a corner of the finished picture. Off by default, and a
single picture can switch it on or off. Only a logo file kept in our own media store is read, never an address typed in.
"""
from __future__ import annotations

import base64
import io
import logging
from typing import Optional

logger = logging.getLogger("logo_overlay")

CORNERS = ("bottom_right", "bottom_left", "top_right", "top_left", "bottom_center")
SIZE_MIN, SIZE_MAX, SIZE_DEFAULT = 8, 40, 18  # the logo's width as a percentage of the picture's width


def clean_corner(value: object) -> str:
    return value if value in CORNERS else "bottom_right"


def clean_size(value: object) -> int:
    try:
        return min(max(int(value), SIZE_MIN), SIZE_MAX)
    except (TypeError, ValueError):
        return SIZE_DEFAULT


def place_logo(picture: bytes, logo: bytes, corner: str = "bottom_right", size_pct: int = SIZE_DEFAULT) -> Optional[bytes]:
    """JPEG bytes of the picture with the logo on it, or None when either file can't be read."""
    from PIL import Image

    try:
        with Image.open(io.BytesIO(picture)) as base_im, Image.open(io.BytesIO(logo)) as logo_im:
            base = base_im.convert("RGBA")
            mark = logo_im.convert("RGBA")
            w, h = base.size
            target_w = max(int(w * clean_size(size_pct) / 100), 24)
            target_h = max(int(mark.size[1] * target_w / max(mark.size[0], 1)), 1)
            if target_h > h * 0.3:  # a very tall logo is held to 30% of the picture's height
                target_h = int(h * 0.3)
                target_w = max(int(mark.size[0] * target_h / max(mark.size[1], 1)), 1)
            mark = mark.resize((target_w, target_h), Image.LANCZOS)
            margin = max(int(min(w, h) * 0.04), 8)
            corner = clean_corner(corner)
            x = margin if corner.endswith("left") else (w - target_w) // 2 if corner.endswith("center") else w - target_w - margin
            y = margin if corner.startswith("top") else h - target_h - margin
            base.alpha_composite(mark, (max(x, 0), max(y, 0)))
            out = io.BytesIO()
            base.convert("RGB").save(out, "JPEG", quality=92, optimize=True)
            return out.getvalue()
    except Exception as err:
        logger.info(f"[logo_overlay] could not place the logo: {err}")
        return None


async def apply_logo(image_url: str, logo_url: str, corner: str = "bottom_right", size_pct: int = SIZE_DEFAULT) -> Optional[str]:
    """A data URI of the picture with the logo on it, or None (the picture is then used as it is, never lost)."""
    from app.services.media_store import local_media_bytes
    from app.services.social_publisher import fetch_image_bytes

    logo, _ = local_media_bytes(logo_url)  # our own stored file only
    if not logo:
        return None
    raw, _ = await fetch_image_bytes(image_url)
    if not raw:
        return None
    done = place_logo(raw, logo, corner, size_pct)
    return "data:image/jpeg;base64," + base64.b64encode(done).decode() if done else None
