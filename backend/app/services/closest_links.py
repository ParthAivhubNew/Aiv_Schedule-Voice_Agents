"""Where to look: links that are always available for a company, so a Find click never ends on an empty box.

None of these is a value. Each is a link to a place that can answer, labelled for what it is: the company's official record, its page on a
directory, its Google Maps page or a prepared web search. A phone, email or website is only ever shown as the company's when a source we can
name says so; these links are what is shown when that has not happened."""
from __future__ import annotations

import re
from typing import Any, Dict, List
from urllib.parse import quote_plus

from app.services import search_recipe as R

_CH = "https://find-and-update.company-information.service.gov.uk/company/"
WHAT = {"website": "official website", "phone": "phone number", "email": "contact email", "linkedin": "LinkedIn page", "facebook": "Facebook page",
        "x": "X profile", "instagram": "Instagram profile"}


def _where(biz: Any) -> str:
    return R.area_of(getattr(biz, "region", "") or getattr(biz, "address", "") or "", getattr(biz, "postcode", "") or "")


def links_for(biz: Any, kind: str) -> List[Dict[str, str]]:
    """[{label, url, note}] for one field, never empty while the company has a name."""
    name = R.plain_name(getattr(biz, "name", "") or "")
    if not name:
        return []
    raw = getattr(biz, "raw_data", None) or {}
    where, postcode = _where(biz), (getattr(biz, "postcode", "") or "").strip()
    out: List[Dict[str, str]] = []
    listing = raw.get("listing_page") or {}
    if listing.get("url"):
        out.append({"label": f"Its page on {listing.get('site', 'a directory')}", "url": listing["url"], "note": "The company's own page there" + ("" if listing.get("confirmed") else ", not confirmed")})
    number = str(getattr(biz, "registration_number", "") or "").strip().upper()
    if re.fullmatch(r"[0-9]{6,8}|[A-Z]{2}[0-9]{6}", number):
        out.append({"label": "Official company record", "url": _CH + (number.zfill(8) if number.isdigit() else number), "note": "Companies House: registered address and officers"})
    query = " ".join(x for x in (name, where, postcode) if x)
    out.append({"label": "Find it on Google Maps", "url": "https://www.google.com/maps/search/?api=1&query=" + quote_plus(query), "note": "Opens a Maps search for the company"})
    out.append({"label": f"Search the web for the {WHAT.get(kind, kind)}", "url": "https://www.google.com/search?q=" + quote_plus(f"{query} {WHAT.get(kind, kind)}".strip()),
                "note": "A prepared web search, not a result"})
    return out


def all_kinds(biz: Any) -> Dict[str, List[Dict[str, str]]]:
    return {k: links_for(biz, k) for k in ("website", "phone", "email", "linkedin", "facebook", "x", "instagram")}
