"""A company's theme for its social posts: name, logo, colours, footer line and what the business does, kept once and used on every post.

The kit is saved in the company's Post Scheduler settings. When it is switched on, every picture of a post gets it just before the
post goes out (see social_publisher.publish_post_to_accounts): the post's own pictures are never changed, so switching the kit
off or editing it changes the next posts, not the ones already made. A single post can opt out.

Filling it in: by hand, or from the company's website (name, colour, logo and a footer line found on the page, all editable).
The picture AI never draws the logo or the words: they are put on afterwards from the real file and the text typed here.
"""
from __future__ import annotations

import asyncio
import io
import logging
import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

from sqlalchemy.future import select

logger = logging.getLogger("brand_kit")

TEMPLATES = (
    ("logo", "Logo only", "Your logo on the picture and nothing else"),
    ("footer", "Footer bar", "A bar in your colour along the bottom with your line of text"),
    ("banner", "Top banner", "The same bar along the top"),
    ("frame", "Frame and footer", "A border in your colour with the footer bar inside it"),
)
POSITIONS = ("top_left", "top_center", "top_right", "middle_left", "middle_center", "middle_right", "bottom_left", "bottom_center", "bottom_right")
SIZE_MIN, SIZE_MAX, SIZE_DEFAULT = 8, 40, 18  # the logo's width as a percentage of the picture's width
DEFAULT_COLOUR = "#3457D5"
# The nine colours a theme is made of. `primary` is the bar and frame on pictures; the rest are for the screens and for telling the picture AI.
ROLES = ("primary", "accent", "accent2", "background", "surface", "text", "muted", "border", "warning")
ROLE_NAMES = {"primary": "Primary", "accent": "Accent", "accent2": "Accent 2", "background": "Background", "surface": "Surface", "text": "Text",
              "muted": "Muted text", "border": "Border", "warning": "Warning"}
_P = lambda *v: dict(zip(ROLES, v))  # noqa: E731
PRESETS = (
    ("default", "Outreach blue", _P("#3457D5", "#8FA6FF", "#26409E", "#F5F6F8", "#FFFFFF", "#111827", "#4B5563", "#E3E6EB", "#D97706")),
    ("midnight", "Midnight", _P("#0B1B3B", "#38BDF8", "#6366F1", "#0F172A", "#1E293B", "#F8FAFC", "#94A3B8", "#334155", "#F59E0B")),
    ("emerald", "Emerald", _P("#065F46", "#10B981", "#059669", "#F0FDF4", "#FFFFFF", "#064E3B", "#4B635B", "#D1E7DD", "#D97706")),
    ("ocean", "Ocean", _P("#0C4A6E", "#0EA5E9", "#0369A1", "#F0F9FF", "#FFFFFF", "#0C2A3E", "#4B6475", "#D4E4EE", "#D97706")),
    ("ember", "Ember", _P("#7F1D1D", "#F97316", "#DC2626", "#FFF7F5", "#FFFFFF", "#2B1111", "#6B4B4B", "#F0D9D4", "#D97706")),
    ("noir", "Noir", _P("#111111", "#E5E5E5", "#525252", "#FAFAFA", "#FFFFFF", "#0A0A0A", "#525252", "#E5E5E5", "#D97706")),
    ("violet", "Violet", _P("#4C1D95", "#8B5CF6", "#6D28D9", "#FAF7FF", "#FFFFFF", "#1E1033", "#5B4B73", "#E4DAF2", "#D97706")),
    ("amber", "Amber", _P("#92400E", "#F59E0B", "#D97706", "#FFFBEB", "#FFFFFF", "#2B1A06", "#6B5636", "#F1E3C4", "#B45309")),
    ("rose", "Rose", _P("#9D174D", "#F43F5E", "#BE123C", "#FFF5F7", "#FFFFFF", "#2B0F1A", "#6B4756", "#F3D9E0", "#D97706")),
    ("steel", "Steel", _P("#334155", "#64748B", "#1E40AF", "#F4F6F8", "#FFFFFF", "#0F172A", "#475569", "#E2E8F0", "#D97706")),
)
PRESET_COLOURS = {pid: cols for pid, _n, cols in PRESETS}
_HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")
_HEX3 = re.compile(r"^#?([0-9a-fA-F]{3})$")


def hex_colour(value: object, default: str = "") -> str:
    v = str(value or "").strip()
    m = _HEX.match(v)
    if m:
        return "#" + m.group(1).upper()
    m = _HEX3.match(v)
    if m:
        return "#" + "".join(c * 2 for c in m.group(1)).upper()
    return default


def _opacity(value: Any) -> int:
    try:
        return min(max(int(value), 10), 100)
    except (TypeError, ValueError):
        return 100


def _knock_out_white(mark):
    """The logo with its white (or near-white) background made see-through, softly at the edges, for logos saved on a white block."""
    px = mark.load()
    w, h = mark.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            low = min(r, g, b)
            if low >= 245:
                px[x, y] = (r, g, b, 0)
            elif low >= 215:
                px[x, y] = (r, g, b, int(a * (245 - low) / 30))
    return mark


def _lines(value: Any, limit: int, width: int) -> List[str]:
    items = value if isinstance(value, list) else str(value or "").splitlines()
    out: List[str] = []
    for v in items:
        t = " ".join(str(v or "").split())[:width]
        if t and t not in out:
            out.append(t)
        if len(out) >= limit:
            break
    return out


def clean_business(raw: Any) -> Dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    return {
        "summary": " ".join(str(raw.get("summary") or "").split())[:600],
        "tagline": " ".join(str(raw.get("tagline") or "").split())[:140],
        "products": _lines(raw.get("products"), 10, 80),
        "howItWorks": _lines(raw.get("howItWorks"), 8, 120),
        "pages": _lines(raw.get("pages"), 12, 40),
    }


def clean(raw: Any) -> Dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    template = raw.get("template") if raw.get("template") in {t[0] for t in TEMPLATES} else "footer"
    try:
        size = min(max(int(raw.get("logoSize")), SIZE_MIN), SIZE_MAX)
    except (TypeError, ValueError):
        size = SIZE_DEFAULT
    preset = raw.get("preset") if raw.get("preset") in PRESET_COLOURS else "custom"
    base = PRESET_COLOURS.get(preset, PRESET_COLOURS["default"])
    given = raw.get("colours") if isinstance(raw.get("colours"), dict) else {}
    colours = {r: hex_colour(given.get(r), base[r]) for r in ROLES}
    if not given.get("primary") and hex_colour(raw.get("primary")):  # a kit saved before themes had one colour: it stays the main one
        colours["primary"] = hex_colour(raw.get("primary"))
    return {
        "enabled": bool(raw.get("enabled")),
        "template": template,
        "name": str(raw.get("name") or "").strip()[:80],
        "website": str(raw.get("website") or "").strip()[:200],
        "logoUrl": str(raw.get("logoUrl") or "").strip()[:300],
        "logoOptions": [str(u).strip()[:300] for u in (raw.get("logoOptions") or []) if str(u or "").strip()][:6],
        "logoPosition": raw.get("logoPosition") if raw.get("logoPosition") in POSITIONS else "bottom_left",
        "logoSize": size,
        "logoBackdrop": bool(raw.get("logoBackdrop")),
        "logoOpacity": _opacity(raw.get("logoOpacity")),  # 100 = solid; less lets the picture show through the logo
        "logoKnockout": bool(raw.get("logoKnockout")),  # make the logo's white background see-through
        "accentLine": bool(raw.get("accentLine")),  # a thin line of the accent colour on the bar's edge: off unless asked for
        "preset": preset,
        "colours": colours,
        "primary": colours["primary"],
        "textColour": hex_colour(raw.get("textColour"), ""),  # empty = black or white, whichever reads on the colour
        "footerText": " ".join(str(raw.get("footerText") or "").split())[:120],
        "business": clean_business(raw.get("business")),
        "useInPosts": bool(raw.get("useInPosts")),  # the AI writes posts with what the business does
        "useInPictures": bool(raw.get("useInPictures")),  # the picture AI is told the theme's colours
    }


async def _row(db):
    from app.models.models import SchedulerSetting

    row = (await db.execute(select(SchedulerSetting).where(SchedulerSetting.id == "default"))).scalars().first()
    if not row:
        row = SchedulerSetting(id="default", data={})
        db.add(row)
    return row


async def load(db) -> Dict[str, Any]:
    """The saved kit. A company that already uploaded a logo for its pictures gets that logo and spot as the starting point."""
    row = await _row(db)
    data = row.data if isinstance(row.data, dict) else {}
    saved = data.get("brandKit")
    if isinstance(saved, dict):
        return clean(saved)
    kit = clean({})
    if data.get("logoUrl"):  # the logo set up under Accounts before themes existed: kept, and on if it was on
        kit.update({"logoUrl": str(data["logoUrl"]), "logoSize": clean({"logoSize": data.get("logoSize")})["logoSize"], "enabled": bool(data.get("logoOn")),
                    "logoPosition": data.get("logoCorner") if data.get("logoCorner") in POSITIONS else "bottom_right", "template": "logo"})
    return kit


async def save(db, raw: Dict[str, Any]) -> Dict[str, Any]:
    from app.services.media_store import local_media_path

    kit = clean(raw)
    if kit["logoUrl"] and not local_media_path(kit["logoUrl"]):
        raise ValueError("Upload your logo with the Upload logo button.")
    if kit["enabled"] and not (kit["logoUrl"] or kit["footerText"] or kit["template"] in ("banner", "frame", "footer")):
        raise ValueError("Add a logo or a footer line first, then switch the brand kit on.")
    kit["logoOptions"] = [u for u in kit["logoOptions"] if local_media_path(u)]
    row = await _row(db)
    data = dict(row.data or {})
    data["brandKit"] = kit
    row.data = data
    await db.commit()
    return kit


# ── Putting the kit on a picture ────────────────────────────────────────────
def _rgb(colour: str) -> Tuple[int, int, int]:
    c = hex_colour(colour, DEFAULT_COLOUR)
    return int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)


def _readable_on(rgb: Tuple[int, int, int]) -> Tuple[int, int, int]:
    r, g, b = [(v / 255) for v in rgb]
    lum = 0.2126 * (r / 12.92 if r <= 0.04045 else ((r + 0.055) / 1.055) ** 2.4) + 0.7152 * (g / 12.92 if g <= 0.04045 else ((g + 0.055) / 1.055) ** 2.4) \
        + 0.0722 * (b / 12.92 if b <= 0.04045 else ((b + 0.055) / 1.055) ** 2.4)
    return (17, 20, 28) if lum > 0.4 else (255, 255, 255)


def _gradient(colour: Tuple[int, int, int], w: int, h: int, side: str):
    """A bar in the colour, a touch lighter on the side towards the picture and a touch deeper away from it."""
    from PIL import Image

    def shift(rgb, amount):
        return tuple(min(max(int(v + (255 - v) * amount if amount > 0 else v * (1 + amount)), 0), 255) for v in rgb)

    near, far = shift(colour, 0.07), shift(colour, -0.12)
    top, bottom = (near, far) if side == "top" else (far, near)
    col = Image.new("RGBA", (1, h))
    for yy in range(h):
        t = yy / max(h - 1, 1)
        col.putpixel((0, yy), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    return col.resize((w, h))


def _lacks_contrast(mark, bar: Tuple[int, int, int]) -> bool:
    """Whether the logo's visible pixels are about as light or dark as the bar behind them."""
    small = mark.copy()
    small.thumbnail((48, 48))
    lums = []
    for r, g, b, a in small.getdata():
        if a > 128:
            lums.append((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255)
    if not lums:
        return False
    bar_lum = (0.2126 * bar[0] + 0.7152 * bar[1] + 0.0722 * bar[2]) / 255
    return abs(sum(lums) / len(lums) - bar_lum) < 0.35


def _font(size: int):
    from PIL import ImageFont

    return ImageFont.load_default(size=max(size, 8))


def _fit_text(draw, text: str, max_w: int, start: int, least: int = 12) -> Tuple[str, Any]:
    """The text and a font it fits in: the biggest size from `start` down to `least`, and then shortened with an ellipsis."""
    size = start
    while size >= least:
        font = _font(size)
        if draw.textlength(text, font=font) <= max_w:
            return text, font
        size -= 1
    font = _font(least)
    t = text
    while len(t) > 1 and draw.textlength(t + "…", font=font) > max_w:
        t = t[:-1]
    return (t.rstrip() + "…") if t != text else text, font


def compose(picture: bytes, logo: Optional[bytes], kit: Dict[str, Any]) -> Optional[bytes]:
    """JPEG bytes of the picture with the kit on it, or None when the picture can't be read."""
    from PIL import Image, ImageDraw

    k = clean(kit)
    try:
        with Image.open(io.BytesIO(picture)) as src:
            im = src.convert("RGBA")
    except Exception as err:
        logger.info(f"[brand_kit] picture not readable: {err}")
        return None
    w, h = im.size
    tpl = k["template"]
    primary = _rgb(k["primary"])
    ink = _rgb(k["textColour"]) if k["textColour"] else _readable_on(primary)
    bar_h = max(int(h * 0.1), 44)
    bar_side = "bottom" if tpl in ("footer", "frame") else "top" if tpl == "banner" else ""
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if tpl == "frame":
        t = max(int(min(w, h) * 0.018), 6)
        d.rectangle((0, 0, w - 1, h - 1), outline=primary + (255,), width=t)
    if bar_side:
        y0 = h - bar_h if bar_side == "bottom" else 0
        layer.paste(_gradient(primary, w, bar_h, bar_side), (0, y0))
        if k["accentLine"]:
            line = max(int(h * 0.006), 3)
            edge = y0 if bar_side == "bottom" else y0 + bar_h - line
            d.rectangle((0, edge, w, edge + line), fill=_rgb(k["colours"]["accent"]) + (255,))
    im.alpha_composite(layer)
    d = ImageDraw.Draw(im)
    margin = max(int(min(w, h) * 0.04), 8)
    taken: Optional[Tuple[int, int]] = None  # the bar's horizontal span the logo covers

    if logo and k["logoUrl"]:
        try:
            with Image.open(io.BytesIO(logo)) as lg:
                mark = lg.convert("RGBA")
        except Exception as err:
            logger.info(f"[brand_kit] logo not readable: {err}")
            mark = None
        if mark is not None:
            row, col = k["logoPosition"].split("_")
            in_bar = bool(bar_side) and row == bar_side
            tw = max(int(w * k["logoSize"] / 100), 24)
            th = max(int(mark.size[1] * tw / max(mark.size[0], 1)), 1)
            cap = int(bar_h * 0.78) if in_bar else int(h * 0.3)
            if th > cap:
                th = max(cap, 1)
                tw = max(int(mark.size[0] * th / max(mark.size[1], 1)), 1)
            mark = mark.resize((tw, th), Image.LANCZOS)
            if k["logoKnockout"]:
                mark = _knock_out_white(mark)
            if k["logoOpacity"] < 100:
                alpha = mark.getchannel("A").point(lambda v: int(v * k["logoOpacity"] / 100))
                mark.putalpha(alpha)
            backed = k["logoBackdrop"] or (in_bar and _lacks_contrast(mark, primary))  # a logo that would melt into the bar gets a light backing
            pad = max(int(th * 0.14), 4) if backed else 0
            bw, bh = tw + 2 * pad, th + 2 * pad
            x = margin if col == "left" else (w - bw) // 2 if col == "center" else w - bw - margin
            if in_bar:
                y = (0 if bar_side == "top" else h - bar_h) + (bar_h - bh) // 2
            else:
                y = margin if row == "top" else (h - bh) // 2 if row == "middle" else h - bh - margin
                if bar_side == "bottom" and row == "bottom":
                    y = h - bar_h - bh - margin // 2  # above the bar, not on it
                if bar_side == "top" and row == "top":
                    y = bar_h + margin // 2
            if pad:
                d.rounded_rectangle((x, y, x + bw, y + bh), radius=max(pad, 6), fill=_rgb(k["colours"]["surface"]) + (235,))
            im.alpha_composite(mark, (max(x + pad, 0), max(y + pad, 0)))
            if in_bar:
                taken = (x, x + bw)

    text = k["footerText"]
    if text and bar_side:
        y0 = h - bar_h if bar_side == "bottom" else 0
        gap = margin
        left, right = (margin, w - margin)
        if taken:
            room_left, room_right = taken[0] - gap - margin, w - margin - (taken[1] + gap)
            left, right = (margin, taken[0] - gap) if room_left >= room_right else (taken[1] + gap, w - margin)
        if right - left >= w * 0.2:
            t, font = _fit_text(d, text, right - left, int(bar_h * 0.44))
            tw = d.textlength(t, font=font)
            tx = left if taken else left + max((right - left - tw) / 2, 0)
            bbox = d.textbbox((0, 0), t, font=font)
            ty = y0 + (bar_h - (bbox[3] - bbox[1])) / 2 - bbox[1]
            d.text((tx, ty), t, font=font, fill=ink + (255,))
    out = io.BytesIO()
    im.convert("RGB").save(out, "JPEG", quality=92, optimize=True)
    return out.getvalue()


async def branded_copy(url: str, kit: Dict[str, Any], public_base: Optional[str] = None) -> Optional[str]:
    """A public address of this picture with the kit on it, kept in our media store; None (use the picture as it is) when it can't be done."""
    from app.services.media_store import MEDIA_URL_PREFIX, local_media_bytes, persist_image_url, store_image_bytes
    from app.services.social_publisher import fetch_image_bytes

    logo = None
    if kit.get("logoUrl"):
        logo, _ = local_media_bytes(kit["logoUrl"])
    raw, _ = await fetch_image_bytes(url)
    if not raw:
        return None
    done = compose(raw, logo, kit)
    if not done:
        return None
    stored = store_image_bytes(done, "image/jpeg")
    return persist_image_url(stored, public_base) if stored else None


def preview_backdrop(kit: Dict[str, Any], width: int = 1080, height: int = 1350) -> bytes:
    """A plain picture to show the kit on before the company has a post of its own: a soft vertical blend, no words."""
    from PIL import Image

    top, bottom = (232, 236, 244), (196, 205, 222)
    col = Image.new("RGB", (1, height))
    for yy in range(height):
        t = yy / max(height - 1, 1)
        col.putpixel((0, yy), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    im = col.resize((width, height))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=88)
    return out.getvalue()


# ── Reading the company's website ───────────────────────────────────────────
_GENERIC_LINKS = re.compile(r"^(home|log ?in|sign ?in|sign ?up|register|cart|basket|search|menu|skip|close|back|top|more|blog|news|careers?|jobs|privacy|terms|cookies?|contact( us)?|get started|book a demo|follow us)$", re.I)
_GENERIC_HEADS = re.compile(r"(follow |cookie|newsletter|subscribe|follow us|contact us|get in touch|privacy|terms|copyright|all rights|sign up|log ?in|share|related|menu)", re.I)
_HOW = re.compile(r"(how (it|we|this) works?|our process|how to get started|getting started|the process|in (three|3|four|4|five|5) (easy )?steps|steps)", re.I)
_PRODUCT_PAGE = re.compile(r"(product|service|solution|feature|platform|pricing|offer|what we do|how it works|about)", re.I)


class _Page(HTMLParser):
    """What a home page says about itself: names, picture links, style sheets, colours in style blocks, menu labels, headings and text."""

    CAPTURE = ("title", "h1", "h2", "h3", "h4", "p", "li", "a", "style", "script")

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: Dict[str, str] = {}
        self.title = ""
        self._in_title = False
        self.icons: List[Tuple[int, str]] = []
        self.logos: List[str] = []
        self.sheets: List[str] = []
        self.styles: List[str] = []
        self.jsonld: List[str] = []
        self.nav: List[Tuple[str, str]] = []
        self.links: List[str] = []
        self.tels: List[str] = []
        self.mails: List[str] = []
        self.items: List[Tuple[str, str]] = []
        self._depth_header = 0
        self._depth_nav = 0
        self._cap = ""
        self._cap_href = ""
        self._buf: List[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag in ("header", "nav"):
            self._depth_header += 1
            if tag == "nav":
                self._depth_nav += 1
        elif tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key and a.get("content"):
                self.meta.setdefault(key, a["content"].strip())
        elif tag == "link" and a.get("href"):
            rel = a.get("rel", "").lower()
            if "icon" in rel or "apple-touch-icon" in rel:
                m = re.search(r"(\d+)x\d+", a.get("sizes", ""))
                weight = int(m.group(1)) if m else (180 if "apple" in rel else 32)
                self.icons.append((weight, a["href"]))
            elif "stylesheet" in rel and len(self.sheets) < 6:
                self.sheets.append(a["href"])
        elif tag == "img" and a.get("src"):
            blob = " ".join([a.get("src", ""), a.get("alt", ""), a.get("class", ""), a.get("id", "")]).lower()
            if "logo" in blob and (self._depth_header or "logo" in a.get("class", "").lower() or "logo" in a.get("id", "").lower() or "logo" in a.get("src", "").lower()):
                self.logos.append(a["src"])
        if tag == "a" and a.get("href"):
            href = a["href"].strip()
            low = href.lower()
            if low.startswith("tel:") and len(self.tels) < 5:
                self.tels.append(" ".join(href[4:].replace("%20", " ").split()))
            elif low.startswith("mailto:") and len(self.mails) < 5:
                self.mails.append(href[7:].split("?")[0].strip())
            elif not low.startswith(("#", "javascript:", "data:")) and len(self.links) < 500:
                self.links.append(href)
        if tag in self.CAPTURE and tag != "title" and not self._cap:
            if tag == "script" and "ld+json" not in a.get("type", "").lower():
                return
            self._cap, self._cap_href, self._buf = tag, a.get("href", ""), []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag in ("header", "nav"):
            if self._depth_header:
                self._depth_header -= 1
            if tag == "nav" and self._depth_nav:
                self._depth_nav -= 1
        if tag == self._cap:
            text = " ".join(" ".join(self._buf).split())
            if tag == "style":
                self.styles.append("".join(self._buf)[:200_000])
            elif tag == "script":
                self.jsonld.append("".join(self._buf)[:60_000])
            elif tag == "a":
                if self._depth_nav and 1 < len(text) <= 40 and self._cap_href and not self._cap_href.startswith(("#", "javascript:", "mailto:", "tel:")):
                    self.nav.append((text, self._cap_href))
            elif text and len(self.items) < 400:
                self.items.append((tag, text))
            self._cap = ""

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._cap:
            self._buf.append(data)


def org_facts(page: _Page) -> Dict[str, str]:
    """The company's name, description and logo address as it states them in the page's structured data (schema.org), when it does."""
    import json

    def walk(node):
        if isinstance(node, list):
            for n in node:
                yield from walk(n)
        elif isinstance(node, dict):
            yield node
            for v in node.values():
                if isinstance(v, (list, dict)):
                    yield from walk(v)

    for blob in page.jsonld:
        try:
            data = json.loads(blob)
        except Exception:
            continue
        for node in walk(data):
            kind = node.get("@type")
            kinds = kind if isinstance(kind, list) else [kind]
            if any(str(k) in ("Organization", "Corporation", "LocalBusiness", "NGO", "OnlineBusiness", "Store", "WebSite") for k in kinds) and node.get("name"):
                logo = node.get("logo")
                logo = logo.get("url") if isinstance(logo, dict) else logo
                return {"name": " ".join(str(node["name"]).split())[:80], "description": " ".join(str(node.get("description") or "").split())[:600],
                        "logo": str(logo or "")}
    return {}


def site_name_from(page: _Page, host: str) -> str:
    for key in ("og:site_name", "application-name", "apple-mobile-web-app-title"):
        if page.meta.get(key):
            return page.meta[key][:80]
    title = " ".join(page.title.split())
    if title:
        parts = [p.strip() for p in re.split(r"\s+[|–—\-:·]\s+", title) if p.strip()]
        generic = re.compile(r"^(home|welcome|homepage|home page|index|official site|official website)$", re.I)
        parts = [p for p in parts if not generic.match(p)] or parts
        if parts:
            key = re.sub(r"[^a-z0-9]", "", host.split(".")[0])
            for p in parts:  # the part that matches the web address is the company's name
                flat = re.sub(r"[^a-z0-9]", "", p.lower())
                if flat and key and (flat in key or key in flat):
                    return p[:80]
            first = parts[0]
            return (first if len(first) <= 40 else min(parts, key=len))[:80]
    base = host.split(".")[0] if host else ""
    return base.replace("-", " ").title()[:80]


def _trim_to_host(name: str, host: str) -> str:
    key = re.sub(r"[^a-z0-9]", "", host.split(".")[0].lower())
    flat = name.lower()
    if len(key) >= 3 and flat.startswith(key) and len(name) > len(key) + 3 and name[len(key)].isupper():
        return name[:len(key)]
    return name


def dominant_colour(image: bytes) -> str:
    """The most common clearly coloured shade in a picture (not white, black or grey), or ''."""
    from PIL import Image

    try:
        with Image.open(io.BytesIO(image)) as im:
            rgba = im.convert("RGBA")
            rgba.thumbnail((96, 96))
            counts: Dict[Tuple[int, int, int], int] = {}
            for r, g, b, a in rgba.getdata():
                if a < 200:
                    continue
                q = (r // 24 * 24 + 12, g // 24 * 24 + 12, b // 24 * 24 + 12)
                counts[q] = counts.get(q, 0) + 1
    except Exception:
        return ""
    best, score = None, 0.0
    for (r, g, b), n in counts.items():
        mx, mn = max(r, g, b), min(r, g, b)
        sat = (mx - mn) / mx if mx else 0
        if sat < 0.25 or mx < 50 or mn > 215:
            continue
        s = n * (0.4 + sat)
        if s > score:
            best, score = (r, g, b), s
    return "#%02X%02X%02X" % best if best else ""


# Read the way a person's browser asks: many sites turn away a request that announces itself as a program, even for a public home page.
_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/*,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
}


def _variants(address: str) -> List[str]:
    """The address as typed, then with and without www, then the home page: tried in turn when a site turns the first one away."""
    u = urlparse(address)
    host = u.hostname or ""
    other = host.removeprefix("www.") if host.startswith("www.") else "www." + host
    out = [address, address.replace(host, other, 1), f"{u.scheme}://{host}/", f"{u.scheme}://{other}/"]
    return list(dict.fromkeys(out))


_NEVER_FETCHED = ("That address is not a public website.", "That website could not be found.", "That link uses an unusual port.",
                  "Links with a login in them are not read.", "Only http and https links can be read.")


def business_from_text(text: str) -> Dict[str, Any]:
    """The summary and products of a business from text its owner pasted (their About page, a brochure): the first sentences, and the short lines."""
    lines = [" ".join(l.split()) for l in str(text or "").splitlines() if l.strip()]
    paras = [l for l in lines if len(l) >= 60]
    summary = " ".join(re.split(r"(?<=[.!?])\s+", paras[0])[:3])[:600] if paras else ""
    short = [l.strip("-*\u2022 ").rstrip(":") for l in lines if 3 <= len(l.strip("-*\u2022 ")) <= 60 and not l.rstrip().endswith((".", "!", "?"))]
    return {"summary": summary, "tagline": "", "products": list(dict.fromkeys(short))[:10], "howItWorks": [], "pages": []}


_SKIP_SECTIONS = re.compile(r"^(login|log-in|sign-?in|sign-?up|register|account|my-?account|cart|basket|checkout|search|privacy|terms|cookies?|cookie-policy|sitemap|404|error|"
                            r"wp-|cdn-cgi|tag|category|author|page|feed|amp|preview|admin|api|s|sfsites)", re.I)
_FILE_EXT = re.compile(r"\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp[34]|css|js|xml|ico|txt)(\?|$)", re.I)
_PAGE_ROLES = (
    ("about", ("about", "who-we-are", "our-story", "company", "mission", "team")),
    ("how", ("how-it-works", "how-we", "process", "getting-started")),
    ("product", ("product", "service", "solution", "feature", "platform", "what-we-do", "offer", "treatment", "shop", "range", "menu", "industr", "support", "benefit")),
    ("pricing", ("pricing", "plans", "price")),
    ("contact", ("contact",)),
)


def page_role(path: str) -> str:
    low = (path or "").lower()
    for role, words in _PAGE_ROLES:
        if any(w in low for w in words):
            return role
    return "other"


async def _sitemap_urls(final: str, host: str) -> List[str]:
    """The addresses a site lists in its public sitemap (the first sitemap, when it is an index of sitemaps), on this site only."""
    try:
        body, _ = await _download(urljoin(final, "/sitemap.xml"), 800_000)
        locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", body.decode("utf-8", errors="ignore"))
        if locs and all(l.lower().split("?")[0].endswith(".xml") for l in locs[:3]):
            body, _ = await _download(locs[0], 800_000)
            locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", body.decode("utf-8", errors="ignore"))
    except Exception:
        return []
    return [l for l in locs[:3000] if (urlparse(l).hostname or "").lower().removeprefix("www.") == host]


def sections_of(locs: List[str]) -> List[str]:
    """The main sections of a site, named from the first part of its addresses."""
    counts: Dict[str, int] = {}
    for loc in locs:
        first = (urlparse(loc).path or "/").strip("/").split("/")[0]
        if not first or len(first) > 40 or _SKIP_SECTIONS.match(first) or "." in first:
            continue
        counts[first] = counts.get(first, 0) + 1
    ranked = sorted(counts, key=lambda k: (-counts[k], k))[:10]
    return [" ".join(w.capitalize() for w in re.split(r"[-_]+", r)) for r in ranked]


def _embedded_text(html: str) -> Dict[str, Any]:
    """Words a script-built page carries inside its own data (a JSON block the scripts draw from): descriptions, headlines and titles."""
    import json

    out: List[str] = []
    best = ""
    blobs = re.findall(r"<script[^>]*type=[\"']application/(?:json|ld\+json)[\"'][^>]*>(.*?)</script>", html, re.S | re.I)
    blobs += re.findall(r"window\.__[A-Z_]+__\s*=\s*(\{.*?\});?\s*</script>", html, re.S)

    def walk(node, key=""):
        nonlocal best
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, str(k).lower())
        elif isinstance(node, list):
            for v in node[:80]:
                walk(v, key)
        elif isinstance(node, str):
            t = " ".join(node.split())
            if key in ("description", "metadescription", "summary", "tagline", "subtitle", "intro", "excerpt") and 50 <= len(t) <= 500 and " " in t and not t.startswith(("http", "{", "<")):
                best = best or t
            elif key in ("headline", "title", "heading", "label") and 3 <= len(t) <= 45 and not t.startswith(("http", "{", "<")) and t not in out:
                out.append(t)

    for blob in blobs[:8]:
        try:
            walk(json.loads(blob))
        except Exception:
            continue
    names = [t for t in out if not _GENERIC_HEADS.search(t) and not _GENERIC_LINKS.match(t)]
    return {"summary": best[:600], "products": names[:10]}


_GUESS_PAGES = ("/about", "/about-us", "/what-we-do", "/services", "/our-services", "/products", "/solutions", "/pricing", "/how-it-works", "/contact")


async def _download(url: str, limit: int, want_html: bool = False, timeout: float = 0.0) -> Tuple[bytes, str]:
    """Bytes of a public page or picture, by the same safe rules as reading a link in a chat (public addresses only, few redirects, small)."""
    import httpx

    from app.services.safe_fetch import FetchRefused, MAX_REDIRECTS, TIMEOUT, _check

    current = url
    async with httpx.AsyncClient(timeout=timeout or TIMEOUT, follow_redirects=False, headers=_BROWSER_HEADERS) as client:
        for _ in range(MAX_REDIRECTS + 1):
            await _check(current)
            async with client.stream("GET", current) as r:
                if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                    current = urljoin(current, r.headers["location"])
                    continue
                if r.status_code >= 400:
                    raise FetchRefused(f"The page answered with error {r.status_code}.")
                kind = (r.headers.get("content-type") or "").lower()
                if want_html and kind and "html" not in kind:
                    raise FetchRefused("That link is not a web page.")
                body = b""
                async for chunk in r.aiter_bytes():
                    body += chunk
                    if len(body) > limit:
                        break
                return body[:limit], current
    raise FetchRefused("That website sent us round in circles.")


def _usable_logo(raw: bytes, least: int = 48) -> Optional[bytes]:
    """PNG bytes of a picture that can be a logo (readable, at least `least` px across), else None."""
    from PIL import Image

    try:
        with Image.open(io.BytesIO(raw)) as im:
            if im.size[0] < least or im.size[1] < max(least // 2, 12):
                return None
            if getattr(im, "is_animated", False):
                im.seek(0)
            out = io.BytesIO()
            im.convert("RGBA").save(out, "PNG", optimize=True)
            return out.getvalue()
    except Exception:
        return None


# ── Colours, found in the page's style rules ────────────────────────────────
_HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
_RGB_RE = re.compile(r"rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})")
_VAR_RE = re.compile(r"--([a-zA-Z0-9_-]+)\s*:\s*([^;}{]+)")
_ROLE_WORDS = (("primary", ("primary", "brand", "main")), ("accent", ("accent", "secondary", "highlight", "cta")), ("background", ("background", "bg")),
               ("text", ("text", "foreground", "ink", "body")), ("border", ("border", "divider", "line")), ("muted", ("muted", "subtle", "grey", "gray")),
               ("warning", ("warning", "danger", "alert")), ("surface", ("surface", "card", "panel")))


def _norm_hex(value: str) -> str:
    return hex_colour(value, "")


def _hsl(h: str) -> Tuple[float, float, float]:
    import colorsys

    r, g, b = _rgb(h)
    hh, ll, ss = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return hh * 360, ss, ll


def colour_name(h: str) -> str:
    """A plain name for a colour ("dark blue", "light green", "grey"), for telling the picture AI."""
    hue, sat, light = _hsl(h)
    if light < 0.1:
        return "black"
    if light > 0.93:
        return "white"
    if sat < 0.12:
        return "dark grey" if light < 0.35 else "light grey" if light > 0.7 else "grey"
    names = ((15, "red"), (45, "orange"), (70, "yellow"), (168, "green"), (195, "teal"), (255, "blue"), (285, "purple"), (335, "pink"), (361, "red"))
    base = next(n for edge, n in names if hue < edge)
    return ("dark " if light < 0.3 else "light " if light > 0.72 else "") + base


def css_colours(css: str) -> Tuple[Dict[str, int], Dict[str, str]]:
    """How often each colour appears in some style rules, and the colours named as a role by a custom property (--primary, --accent ...)."""
    counts: Dict[str, int] = {}
    for m in _HEX_RE.finditer(css):
        c = _norm_hex(m.group(0))
        if c:
            counts[c] = counts.get(c, 0) + 1
    for m in _RGB_RE.finditer(css):
        try:
            c = "#%02X%02X%02X" % tuple(min(int(x), 255) for x in m.groups())
        except ValueError:
            continue
        counts[c] = counts.get(c, 0) + 1
    hints: Dict[str, str] = {}
    for name, value in _VAR_RE.findall(css):
        c = _norm_hex(value.strip().split()[0]) if value.strip().startswith("#") else ""
        if not c:
            m = _RGB_RE.search(value)
            c = "#%02X%02X%02X" % tuple(min(int(x), 255) for x in m.groups()) if m else ""
        if not c:
            continue
        low = name.lower()
        for role, words in _ROLE_WORDS:
            if any(w in low for w in words) and role not in hints:
                hints[role] = c
                break
    return counts, hints


def _far(c: str, taken: List[str], hue_gap: float = 22.0) -> bool:
    h, _, l = _hsl(c)
    for t in taken:
        th, _, tl = _hsl(t)
        if min(abs(h - th), 360 - abs(h - th)) < hue_gap and abs(l - tl) < 0.2:
            return False
    return True


def palette_from(counts: Dict[str, int], hints: Dict[str, str], theme_colour: str = "", logo_colour: str = "") -> Tuple[Dict[str, str], List[str]]:
    """A nine-colour theme and the top colours seen, from what a page's style rules use. Greys and near-whites fill the neutral roles."""
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    vivid = [c for c, _ in ranked if _hsl(c)[1] >= 0.25 and 0.12 <= _hsl(c)[2] <= 0.85]
    lights = [c for c, _ in ranked if _hsl(c)[2] >= 0.9]
    darks = [c for c, _ in ranked if _hsl(c)[2] <= 0.22]
    mids = [c for c, _ in ranked if _hsl(c)[1] < 0.18 and 0.3 <= _hsl(c)[2] <= 0.62]
    edges = [c for c, _ in ranked if _hsl(c)[1] < 0.2 and 0.8 <= _hsl(c)[2] <= 0.95]
    base = PRESET_COLOURS["default"]
    def bold(c: str) -> bool:
        return bool(c) and _hsl(c)[1] >= 0.25 and 0.12 <= _hsl(c)[2] <= 0.85

    primary = next((c for c in (hints.get("primary"), theme_colour, vivid[0] if vivid else "", logo_colour) if bold(c)), "") \
        or hints.get("primary") or (darks[0] if darks and not vivid else "") or theme_colour or logo_colour or base["primary"]
    taken = [primary]
    accent = hints.get("accent") or next((c for c in vivid if _far(c, taken)), "")
    if not accent:
        accent = _shade(primary, 0.35)
    taken.append(accent)
    accent2 = next((c for c in vivid if _far(c, taken)), "") or _shade(primary, -0.2)
    roles = {
        "primary": primary, "accent": accent, "accent2": accent2,
        "background": hints.get("background") or (lights[0] if lights and lights[0] != "#FFFFFF" else base["background"]),
        "surface": hints.get("surface") or "#FFFFFF",
        "text": hints.get("text") or (darks[0] if darks else base["text"]),
        "muted": hints.get("muted") or (mids[0] if mids else base["muted"]),
        "border": hints.get("border") or (edges[0] if edges else base["border"]),
        "warning": hints.get("warning") or base["warning"],
    }
    swatches: List[str] = []
    for c in [primary, accent, accent2] + [c for c, _ in ranked]:
        if c not in swatches and all(_far(c, [x], 8) for x in swatches):
            swatches.append(c)
        if len(swatches) >= 10:
            break
    return {r: hex_colour(roles[r], base[r]) for r in ROLES}, swatches


def _shade(colour: str, amount: float) -> str:
    """The colour made lighter (amount > 0) or darker (amount < 0)."""
    import colorsys

    r, g, b = _rgb(colour)
    h, l, sat = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    l = min(max(l + amount, 0.05), 0.95)
    rr, gg, bb = colorsys.hls_to_rgb(h, l, sat)
    return "#%02X%02X%02X" % (round(rr * 255), round(gg * 255), round(bb * 255))


# ── What the business does, in the page's own words ─────────────────────────
def business_from(pages: List[_Page], host: str) -> Dict[str, Any]:
    """The summary, tagline, products and services, steps and menu of a website, taken from what it says (never written by an AI)."""
    home = pages[0]
    summary = (home.meta.get("og:description") or home.meta.get("description") or home.meta.get("twitter:description") or "").strip()
    if len(summary) < 40:
        summary = next((t for tag, t in home.items if tag == "p" and 60 <= len(t) <= 400), summary)
    h1 = next((t for tag, t in home.items if tag == "h1" and 5 <= len(t) <= 140), "")
    products: List[str] = []
    heads: List[str] = []
    steps: List[str] = []
    for pg in pages:
        for blob in pg.jsonld:
            for m in re.finditer(r'"@type"\s*:\s*"(?:Product|Service|Offer)"[^{}]*?"name"\s*:\s*"([^"]{3,80})"', blob):
                if m.group(1) not in products:
                    products.append(m.group(1))
        in_how = 0
        for tag, text in pg.items:
            if tag in ("h2", "h3", "h4"):
                in_how = 6 if _HOW.search(text) else 0
                if tag in ("h2", "h3") and 3 <= len(text) <= 70 and not _GENERIC_HEADS.search(text) and not _HOW.search(text) and text not in products:
                    heads.append(text)
            elif in_how and tag in ("li", "p") and 8 <= len(text) <= 140:
                if text not in steps and len(steps) < 8:
                    steps.append(text)
                in_how -= 1
    names = [t for t in heads if len(t) <= 45 and not t.endswith((".", "!", "?"))]
    for t in names + [t for t in heads if t not in names]:
        if t not in products and len(products) < 10:
            products.append(t)
    pages_seen: List[str] = []
    for text, _href in home.nav:
        if not _GENERIC_LINKS.match(text) and text not in pages_seen and len(pages_seen) < 12:
            pages_seen.append(text)
    return {"summary": summary[:600], "tagline": h1, "products": products[:10], "howItWorks": steps[:8], "pages": pages_seen}


MAX_PAGES = 16
CRAWL_SECONDS = 18.0


def _clean_link(url: str) -> str:
    u = url.split("#")[0]
    return u if urlparse(u).path in ("", "/") else u.rstrip("/")


async def crawl_site(final: str, host: str, home: "_Page", sitemap: List[str]) -> List[Tuple[str, "_Page"]]:
    """The home page's neighbours: up to MAX_PAGES pages of this site (About, Services, Products, Pricing ...), found from its menu, its links,
    its sitemap and the usual page names, read a few at a time within a time limit. Pages that will not load are skipped."""
    import asyncio

    pool = [h for _l, h in home.nav] + home.links + sitemap + list(_GUESS_PAGES)
    seen = {_clean_link(final)}
    ranked: List[Tuple[Tuple[int, int], str]] = []
    for order, href in enumerate(pool):
        u = _clean_link(urljoin(final, href))
        parts = urlparse(u)
        if u in seen or (parts.hostname or "").lower().removeprefix("www.") != host or parts.scheme not in ("http", "https"):
            continue
        if _FILE_EXT.search(parts.path) or parts.query.count("=") > 1:
            continue
        first = parts.path.strip("/").split("/")[0]
        if first and _SKIP_SECTIONS.match(first):
            continue
        seen.add(u)
        role = page_role(parts.path)
        weight = {"about": 0, "product": 0, "how": 0, "pricing": 1, "contact": 1}.get(role, 2)
        depth = len([x for x in parts.path.strip("/").split("/") if x])
        ranked.append(((weight * 10 + depth, order), u))
    ranked.sort()
    wanted = [u for _k, u in ranked][: MAX_PAGES * 2]
    gate = asyncio.Semaphore(8)
    found: List[Tuple[str, "_Page"]] = []

    async def one(u: str) -> None:
        async with gate:
            if len(found) >= MAX_PAGES:
                return
            try:
                body, got = await _download(u, 700_000, want_html=True, timeout=7.0)
                pg = _Page()
                pg.feed(body.decode("utf-8", errors="ignore"))
            except Exception:
                return
            if pg.items or pg.meta.get("description") or pg.title.strip():
                found.append((got, pg))

    tasks = [asyncio.create_task(one(u)) for u in wanted]
    _, pending = await asyncio.wait(tasks, timeout=CRAWL_SECONDS)
    for t in pending:
        t.cancel()
    order = {u: i for i, u in enumerate(wanted)}
    found.sort(key=lambda e: order.get(_clean_link(e[0]), 999))
    return found[:MAX_PAGES]


def site_business(entries: List[Tuple[str, "_Page"]], host: str) -> Dict[str, Any]:
    """Everything the crawled pages say about the business, merged: the About page's words for the summary, product and service names from the
    pages about what is sold, the steps from any page that explains how it works, and the home page's menu."""
    per = [(page_role(urlparse(u).path), pg, business_from([pg], host)) for u, pg in entries]
    home_b = per[0][2]
    summary = next((b["summary"] for r, _p, b in per if r == "about" and b["summary"]), "") or home_b["summary"] or next((b["summary"] for _r, _p, b in per if b["summary"]), "")
    products: List[str] = []
    seen_low: set = set()

    def add(text: str) -> None:
        t = " ".join(str(text or "").split())
        if 3 <= len(t) <= 80 and t.lower() not in seen_low and not _GENERIC_HEADS.search(t) and not _GENERIC_LINKS.match(t) and len(products) < 10:
            seen_low.add(t.lower())
            products.append(t)

    for r, _p, b in per:
        if r == "product":
            if len(b["tagline"]) <= 45:
                add(b["tagline"])
            for x in b["products"]:
                add(x)
    for _r, _p, b in per:
        for x in b["products"]:
            add(x)
    steps: List[str] = []
    for _r, _p, b in per:
        for x in b["howItWorks"]:
            if x not in steps and len(steps) < 8:
                steps.append(x)
    return {"summary": summary[:600], "tagline": home_b["tagline"], "products": products, "howItWorks": steps, "pages": home_b["pages"]}


async def from_website(address: str, pasted: str = "") -> Dict[str, Any]:
    """What the company's website says about its brand: name, logos (kept in our media store), the colour theme, a footer line, and what the
    business does (summary, products, steps, menu). Nothing is saved: the person looks it over, changes anything, and saves.
    Raises FetchRefused with a plain reason."""
    from app.services.media_store import store_image_bytes
    from app.services.safe_fetch import FetchRefused

    raw = (address or "").strip()
    if not raw:
        raise FetchRefused("Type your website address first.")
    if not re.match(r"^[a-z][a-z0-9+.-]*://", raw, re.I):
        raw = "https://" + raw
    host = (urlparse(raw).hostname or "").lower()
    if not host or "." not in host:
        raise FetchRefused("That does not look like a website address.")
    html_bytes, final, blocked, unreachable = b"", raw, False, False
    for attempt in _variants(raw):
        try:
            html_bytes, final = await _download(attempt, 1_500_000, want_html=True)
            blocked = False
            break
        except FetchRefused as err:
            blocked = True
            if str(err) in _NEVER_FETCHED:  # a private or unknown address is never fetched at all
                unreachable = True
                break
        except Exception:
            blocked = True  # a slow or reset connection: carry on with what the address alone gives us
    page = _Page()
    try:
        page.feed(html_bytes.decode("utf-8", errors="ignore"))
    except Exception:
        pass
    host = (urlparse(final).hostname or host).lower().removeprefix("www.")
    org = org_facts(page)
    name = org.get("name") or _trim_to_host(site_name_from(page, host), host)

    # Logos: the picture in the page header, the structured-data logo, then the touch icons and favicon. Up to four are kept to choose from.
    candidates: List[str] = [urljoin(final, u) for u in page.logos[:3]]
    if org.get("logo"):
        candidates.append(urljoin(final, org["logo"]))
    for blob in page.jsonld:
        m = re.search(r'"logo"\s*:\s*(?:"([^"]+)"|\{[^{}]*?"url"\s*:\s*"([^"]+)")', blob)
        if m:
            candidates.append(urljoin(final, m.group(1) or m.group(2)))
    candidates += [urljoin(final, href) for _, href in sorted(page.icons, key=lambda t: -t[0])[:3]]
    if not page.logos and page.meta.get("og:image"):
        candidates.append(urljoin(final, page.meta["og:image"]))
    candidates += [urljoin(final, path) for path in ("/apple-touch-icon.png", "/logo.png", "/favicon.png", "/favicon.ico")]
    async def fetch_logos():
        pngs: List[bytes] = []
        small: List[bytes] = []
        urls = [u for u in dict.fromkeys(candidates) if not u.lower().split("?")[0].endswith(".svg")][:10]

        async def one(u: str):
            try:
                return (await _download(u, 2_000_000, timeout=8.0))[0]
            except Exception:
                return None

        for blob in await asyncio.gather(*[one(u) for u in urls]):
            if not blob:
                continue
            png = _usable_logo(blob)
            if png and png not in pngs and len(pngs) < 4:
                pngs.append(png)
            elif not png:
                tiny = _usable_logo(blob, 24)
                if tiny and tiny not in small:
                    small.append(tiny)
        return pngs, small

    async def fetch_css() -> str:
        async def one(href: str) -> str:
            try:
                return (await _download(urljoin(final, href), 400_000, timeout=8.0))[0].decode("utf-8", errors="ignore")
            except Exception:
                return ""

        return "\n".join(await asyncio.gather(*[one(h) for h in page.sheets[:3]]))

    if unreachable:
        (logo_pngs, small_ones), sheet_css, sitemap = ([], []), "", []
    else:
        (logo_pngs, small_ones), sheet_css, sitemap = await asyncio.gather(fetch_logos(), fetch_css(), _sitemap_urls(final, host))
    if not logo_pngs and small_ones:
        logo_pngs = small_ones[:1]
    logos = [u for u in (store_image_bytes(png, "image/png") for png in logo_pngs) if u]

    # Colours: custom properties and colours in the page's own style rules and its first style sheets, the theme colour and the logo's colour.
    css = "\n".join(page.styles) + "\n" + sheet_css
    counts, hints = css_colours(css)
    theme_colour = hex_colour(page.meta.get("theme-color") or page.meta.get("msapplication-tilecolor"), "")
    logo_colour = dominant_colour(logo_pngs[0]) if logo_pngs else ""
    palette, swatches = palette_from(counts, hints, theme_colour, logo_colour)
    seen_colour = bool(counts or theme_colour or logo_colour)

    # The whole site: the home page and up to MAX_PAGES pages around it, merged.
    entries: List[Tuple[str, _Page]] = [(final, page)]
    if not unreachable:
        entries += await crawl_site(final, host, page, sitemap)
    for _u, pg in entries[1:]:
        css += "\n" + "\n".join(pg.styles[:2])
    if css:
        counts, hints = css_colours(css)
        palette, swatches = palette_from(counts, hints, theme_colour, logo_colour)
        seen_colour = bool(counts or theme_colour or logo_colour)
    business = site_business(entries, host)
    if not business["summary"] and org.get("description"):
        business["summary"] = org["description"]
    if not business["summary"] and not unreachable:  # a page built by scripts: what its own data blocks say
        embedded = _embedded_text(html_bytes.decode("utf-8", errors="ignore"))
        mine = [x for x in embedded["products"] if x.lower() not in {p.lower() for p in business["products"]}]
        business = {**business, "summary": embedded["summary"] or business["summary"], "products": (mine + business["products"])[:10]}  # the home page's own cards come first
    if not business["products"] and sitemap:
        sections = sections_of(sitemap)
        if sections:
            business = {**business, "products": sections, "pages": business.get("pages") or sections}
    thin = not business["summary"] and not business["products"]
    phone = next((t for _u, pg in entries for t in pg.tels), "")
    if str(pasted or "").strip():  # what the owner pasted fills in whatever the website did not give
        said = business_from_text(pasted)
        business = {**business, **{k: v for k, v in said.items() if v and not business.get(k)}}

    footer = " \u00b7 ".join(x for x in (name, host, phone) if x)
    found = {"name": bool(name), "logo": bool(logos), "colour": seen_colour, "about": bool(business["summary"]), "products": bool(business["products"])}
    if unreachable:
        note = "We could not reach that website, so we used the name in its address. Add your logo and what you do by hand, or paste your About text below."
    elif not blocked and not found["about"]:
        note = "This website builds its pages with scripts, so we could read little of it. Add what you do by hand or paste your About text below."
    elif blocked:
        note = ("That website does not let programs read it, so we filled in what we could from its address" + (" and its icon" if logos else "")
                + ". Add your logo and what you do by hand, or paste your About text below.")
    else:
        note = ""
    return {"name": name, "website": host, "logoUrl": logos[0] if logos else "", "logos": logos, "primary": palette["primary"], "palette": palette,
            "swatches": swatches, "footerText": footer[:120], "business": business, "found": found, "note": note,
            "crawled": len(entries) if not unreachable else 0, "phone": phone}


# ── Using the theme in posts ────────────────────────────────────────────────
def business_block(kit: Dict[str, Any]) -> str:
    """The business's facts for the text AI, or "" when the company did not switch this on or has none."""
    k = clean(kit)
    b = k["business"]
    if not k["useInPosts"] or not (b["summary"] or b["products"] or b["howItWorks"]):
        return ""
    lines = []
    if k["name"]:
        lines.append(f"Business: {k['name']}")
    if b["summary"]:
        lines.append(f"What it does: {b['summary']}")
    if b["tagline"]:
        lines.append(f"Its own line: {b['tagline']}")
    if b["products"]:
        lines.append("Products and services: " + "; ".join(b["products"]))
    if b["howItWorks"]:
        lines.append("How it works: " + " / ".join(b["howItWorks"]))
    return "About the business (from the company's own website; use only these facts and never invent products, prices or claims):\n" + "\n".join(lines)


def palette_phrase(kit: Dict[str, Any]) -> str:
    """A sentence telling the picture AI the theme's colours, or "" when the company did not switch this on."""
    k = clean(kit)
    if not k["useInPictures"]:
        return ""
    names: List[str] = []
    for role in ("primary", "accent", "accent2"):
        n = colour_name(k["colours"][role])
        if n not in names:
            names.append(n)
    if not names:
        return ""
    return "Colour palette: build the picture around " + (", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else names[0]) + ", with calm neutrals elsewhere."
