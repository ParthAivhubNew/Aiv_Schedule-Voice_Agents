"""Designed emails: a client's brand (logo, colours, font, header, footer) around the text they already write.

Nothing here changes what is said. The email body stays the plain text the campaign already holds, with the merge words filled in by
the worker. This module only dresses that text:

* The text is HTML-escaped first, so a lead's name or a pasted line can never add markup.
* A line `[Book a call](https://example.com)` on its own becomes a button; inside a sentence it becomes a link. Only http and https
  links are ever made, so there is no `javascript:` or `data:` address.
* The footer (address, unsubscribe link, why-you-got-this link, the open pixel) is added here, after the client's content and outside
  it, from fixed markup. A design cannot hide or remove it.
* The plain-text part of the message is made from the same body, with buttons written as "Label: address".

Which campaigns use a design, and the brand itself, are kept in one settings document per company (see `load` and `save`).
"""
from __future__ import annotations

import html
import re
from typing import Any, Dict, List, Optional, Tuple

DOC_PREFIX = "email_design:"
MAX_HTML_BYTES = 100_000  # Gmail clips a message above about this size

# Only fonts every mail app already has. A web font is ignored by most of them.
FONTS: Dict[str, str] = {
    "arial": "Arial, Helvetica, sans-serif",
    "verdana": "Verdana, Geneva, sans-serif",
    "tahoma": "Tahoma, Geneva, sans-serif",
    "trebuchet": "'Trebuchet MS', Helvetica, sans-serif",
    "georgia": "Georgia, 'Times New Roman', serif",
    "times": "'Times New Roman', Times, serif",
}

DEFAULT_BRAND: Dict[str, Any] = {
    "brand_name": "", "logo_url": "", "logo_width": 140, "header_text": "",
    "accent": "#3457D5", "button_color": "#3457D5", "button_text": "#FFFFFF", "text_color": "#1B1D24", "background": "#F4F5F7",
    "font": "arial", "footer_text": "", "address": "",
}

_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_LINK = re.compile(r"\[([^\]\n]{1,80})\]\((https?://[^\s()<>\"']{1,500})\)")
_BARE = re.compile(r"(?<![\"'>=(])\bhttps?://[^\s<>\"']{1,500}")


def _doc_key(org_id: str) -> str:
    return f"{DOC_PREFIX}{org_id}"


def _text(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _colour(value: Any, fallback: str) -> str:
    v = str(value or "").strip()
    return v.upper() if _HEX.match(v) else fallback


def safe_url(value: Any) -> str:
    """An address that is safe to put in a link or an image: http or https only, no spaces or quotes, a sensible length."""
    v = str(value or "").strip()
    if not re.match(r"^https?://[^\s\"'<>]{3,500}$", v, re.I):
        return ""
    return v


def clean_brand(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The brand as it is kept: every field limited and checked, unknown fields dropped."""
    raw = raw if isinstance(raw, dict) else {}
    d = DEFAULT_BRAND
    font = str(raw.get("font") or d["font"]).lower()
    try:
        width = int(raw.get("logo_width") or d["logo_width"])
    except (TypeError, ValueError):
        width = d["logo_width"]
    return {
        "brand_name": _text(raw.get("brand_name"), 60),
        "logo_url": safe_url(raw.get("logo_url")),
        "logo_width": min(max(width, 40), 240),
        "header_text": _text(raw.get("header_text"), 120),
        "accent": _colour(raw.get("accent"), d["accent"]),
        "button_color": _colour(raw.get("button_color"), d["button_color"]),
        "button_text": _colour(raw.get("button_text"), d["button_text"]),
        "text_color": _colour(raw.get("text_color"), d["text_color"]),
        "background": _colour(raw.get("background"), d["background"]),
        "font": font if font in FONTS else d["font"],
        "footer_text": _text(raw.get("footer_text"), 300),
        "address": _text(raw.get("address"), 200),
    }


def _luminance(hex_colour: str) -> float:
    r, g, b = (int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
    lin = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(a: str, b: str) -> float:
    la, lb = _luminance(a), _luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def brand_problems(brand: Dict[str, Any]) -> List[str]:
    """What stops a brand being used for sending. A designed email must always say who sent it and where."""
    out: List[str] = []
    if not brand.get("address"):
        out.append("Add your business address. Every designed email carries it in the footer.")
    return out


def brand_warnings(brand: Dict[str, Any]) -> List[str]:
    """Things that work but may read badly. Shown to the person, never blocking."""
    out: List[str] = []
    if contrast(brand["button_text"], brand["button_color"]) < 4.5:
        out.append("The button text is hard to read on the button colour. Pick a stronger contrast.")
    if contrast(brand["text_color"], "#FFFFFF") < 4.5:
        out.append("The text colour is hard to read on white. Pick a darker colour.")
    if not brand.get("logo_url") and not brand.get("brand_name"):
        out.append("Add a logo or a brand name so the email has a header.")
    return out


# ── Text to safe HTML ────────────────────────────────────────────────────────
def _inline(raw: str, brand: Dict[str, Any]) -> str:
    """One paragraph's text as HTML: escaped, with [label](address) and bare addresses made into links."""
    link_style = f"color:{brand['accent']};text-decoration:underline"
    parts: List[str] = []
    pos = 0
    for m in _LINK.finditer(raw):
        parts.append(_bare_links(raw[pos:m.start()], link_style))
        parts.append(f'<a href="{html.escape(m.group(2), quote=True)}" style="{link_style}">{html.escape(m.group(1))}</a>')
        pos = m.end()
    parts.append(_bare_links(raw[pos:], link_style))
    return "".join(parts).replace("\n", "<br>")


def _bare_links(raw: str, link_style: str) -> str:
    out: List[str] = []
    pos = 0
    for m in _BARE.finditer(raw):
        url = m.group(0).rstrip(".,;:!?)")
        out.append(html.escape(raw[pos:m.start()]))
        out.append(f'<a href="{html.escape(url, quote=True)}" style="{link_style}">{html.escape(url)}</a>')
        pos = m.start() + len(url)
    out.append(html.escape(raw[pos:]))
    return "".join(out)


def _button(label: str, url: str, brand: Dict[str, Any]) -> str:
    return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px"><tr>'
            f'<td bgcolor="{brand["button_color"]}" style="border-radius:6px;background:{brand["button_color"]}">'
            f'<a href="{html.escape(url, quote=True)}" style="display:inline-block;padding:12px 22px;font-weight:700;font-size:15px;'
            f'line-height:1.2;color:{brand["button_text"]};text-decoration:none;border-radius:6px">{html.escape(label)}</a>'
            "</td></tr></table>")


def body_html(text: str, brand: Dict[str, Any]) -> str:
    """The email text as paragraphs, with a line holding only [label](address) turned into a button."""
    out: List[str] = []
    for para in re.split(r"\n\s*\n", (text or "").strip()):
        para = para.strip("\n")
        if not para.strip():
            continue
        one = _LINK.fullmatch(para.strip())
        if one:
            out.append(_button(one.group(1), one.group(2), brand))
        else:
            out.append(f'<p style="margin:0 0 14px">{_inline(para, brand)}</p>')
    return "".join(out)


def plain_of(text: str) -> str:
    """The same text with [label](address) written as "label: address", for the plain-text part."""
    return _LINK.sub(lambda m: f"{m.group(1)}: {m.group(2)}", text or "")


# ── The layout ──────────────────────────────────────────────────────────────
def render(text: str, brand: Dict[str, Any], *, subject: str = "", signature: str = "", unsubscribe_link: str = "#",
           why_link: str = "", open_marker: str = "") -> str:
    """The whole HTML email: a fixed 600px table layout, which is what mail apps (Outlook included) draw most reliably."""
    b = clean_brand(brand)
    font = FONTS[b["font"]]
    fg = b["text_color"]
    if b["logo_url"]:
        head = (f'<img src="{html.escape(b["logo_url"], quote=True)}" width="{b["logo_width"]}" alt="{html.escape(b["brand_name"] or "Logo")}" '
                f'style="display:block;border:0;outline:none;height:auto;max-width:100%">')
    elif b["brand_name"]:
        head = f'<span style="font-size:20px;font-weight:700;color:{fg}">{html.escape(b["brand_name"])}</span>'
    else:
        head = ""
    header_row = ""
    if head or b["header_text"]:
        tag = f'<div style="margin-top:8px;font-size:13px;color:#5B6470">{html.escape(b["header_text"])}</div>' if b["header_text"] else ""
        header_row = f'<tr><td style="padding:22px 32px 0;font-family:{font}">{head}{tag}</td></tr>'
    sig_row = ""
    if (signature or "").strip():
        sig_row = (f'<tr><td style="padding:0 32px 12px;font-family:{font};font-size:14px;line-height:1.5;color:#5B6470">'
                   f'{html.escape(signature.strip()).replace(chr(10), "<br>")}</td></tr>')
    foot: List[str] = []
    if b["footer_text"]:
        foot.append(html.escape(b["footer_text"]))
    if b["address"]:
        foot.append(html.escape(b["address"]))
    foot_html = "<br>".join(foot)
    # The footer is fixed markup in fixed colours, so a brand colour can never make the unsubscribe link unreadable or hidden.
    legal = (f'<a href="{html.escape(unsubscribe_link, quote=True)}" style="color:#3B4452;text-decoration:underline">Unsubscribe</a>'
             + (f' &nbsp;|&nbsp; <a href="{html.escape(why_link, quote=True)}" style="color:#3B4452;text-decoration:underline">Why you got this</a>' if why_link else ""))
    pixel = f'<img src="{html.escape(open_marker, quote=True)}" width="1" height="1" alt="" style="display:none">' if open_marker else ""
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">'
        f"<title>{html.escape(subject or b['brand_name'] or 'Email')}</title></head>"
        f'<body style="margin:0;padding:0;background:{b["background"]};-webkit-text-size-adjust:100%">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{b["background"]}" style="background:{b["background"]}">'
        '<tr><td align="center" style="padding:24px 12px">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" '
        'style="width:100%;max-width:600px;background:#FFFFFF;border-radius:8px">'
        f'<tr><td height="4" bgcolor="{b["accent"]}" style="height:4px;line-height:4px;font-size:4px;background:{b["accent"]};border-radius:8px 8px 0 0">&nbsp;</td></tr>'
        f"{header_row}"
        f'<tr><td style="padding:24px 32px 8px;font-family:{font};font-size:16px;line-height:1.6;color:{fg}">{body_html(text, b)}</td></tr>'
        f"{sig_row}"
        f'<tr><td style="padding:18px 32px 24px;border-top:1px solid #E3E6EB;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5B6470">'
        f"{foot_html}{'<br>' if foot_html else ''}{legal}{pixel}</td></tr>"
        "</table></td></tr></table></body></html>"
    )


def lint(page: str, brand: Dict[str, Any]) -> List[str]:
    out = brand_warnings(clean_brand(brand))
    if len(page.encode("utf-8")) > MAX_HTML_BYTES:
        out.append("This email is large. Gmail cuts off messages over about 100 KB.")
    return out


# ── Storage: one settings document per company ──────────────────────────────
async def load(db, org_id: str) -> Dict[str, Any]:
    from app.services import credits

    doc = await credits._get_doc(db, _doc_key(org_id))
    return {"brand": clean_brand(doc.get("brand")), "campaigns": {k: bool(v) for k, v in (doc.get("campaigns") or {}).items()}}


async def save(db, org_id: str, brand: Optional[Dict[str, Any]] = None, campaigns: Optional[Dict[str, bool]] = None) -> Dict[str, Any]:
    from app.services import credits

    now = await load(db, org_id)
    if brand is not None:
        now["brand"] = clean_brand(brand)
    if campaigns is not None:
        now["campaigns"] = {k: bool(v) for k, v in campaigns.items() if v}
    await credits._put_doc(db, _doc_key(org_id), now)
    return now


async def brand_for_campaign(db, org_id: str, campaign_id: str) -> Optional[Dict[str, Any]]:
    """The brand to send this campaign with, or None for a plain email. Never raises: a problem here must not stop a send."""
    try:
        doc = await load(db, org_id)
        if doc["campaigns"].get(campaign_id) and not brand_problems(doc["brand"]):
            return doc["brand"]
    except Exception:
        return None
    return None
