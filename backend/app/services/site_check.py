"""Is this address plausibly a company's own website?

A web lookup can come back with a page ABOUT a company (the food hygiene ratings site for a cafe, the company register,
a directory, a social page) instead of its own site. Those are never shown as "the website": a registry or directory host
is refused outright, and a site found on the open web must also look like it belongs to the company (its name shares a
real word with the company's, or the other way round)."""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse

# Public registers and rating sites: they list the company, they are not the company.
_REGISTRY_HOSTS = (
    "food.gov.uk", "ratings.food.gov.uk", "companieshouse.gov.uk", "company-information.service.gov.uk", "charitycommission.gov.uk",
    "cqc.org.uk", "ofsted.gov.uk", "gov.uk", "nhs.uk", "fsa.gov.uk", "tax.service", "find-and-update",
    "opencharities", "charitychoice", "gias", "get-information-schools", "compare-school-performance",
)
_GENERIC = {"the", "and", "ltd", "limited", "plc", "llp", "company", "group", "holdings", "services", "service", "uk", "co", "of", "for", "trading", "t/a"}


def _host(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw if "://" in raw else "https://" + raw)
    return (parsed.hostname or "").lower().removeprefix("www.")


def _squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def _tokens(name: str) -> list:
    return [w for w in re.findall(r"[a-z0-9]{3,}", str(name or "").lower()) if w not in _GENERIC]


def is_listing_host(url: str, name: str = "") -> bool:
    """True for a register, rating site, directory, search or social page (never a company's own site)."""
    from app.services.enrichment_service import _DIRECTORY_HOSTS, _JUNK_WEB_HOSTS

    host = _host(url)
    if not host:
        return True
    if any(d in host for d in _DIRECTORY_HOSTS) or any(j in host for j in _JUNK_WEB_HOSTS):
        return True
    for bad in _REGISTRY_HOSTS:
        if host == bad or host.endswith("." + bad) or (bad.count(".") == 0 and bad in host):
            # A council or public body can have a gov.uk site of its own.
            return not (bad == "gov.uk" and re.search(r"council|borough|county|district|parish", str(name or ""), re.I))
    return False


def plausible_site(name: str, url: str, *, strict: bool = True) -> bool:
    """strict=True for an address found on the open web: also needs the company's name in it (or it in the name)."""
    if not url or is_listing_host(url, name):
        return False
    if not strict:
        return True
    host = _host(url)
    label = host.split(".")[0] if host.count(".") else host
    site = _squash(label)
    words = _tokens(name)
    squashed_name = _squash(name)
    if not site or not words:
        return bool(site)
    need = 4 if len(words) > 1 else 3
    if any(len(w) >= need and w in site for w in words):
        return True
    if len(site) >= 5 and site in squashed_name:
        return True
    initials = "".join(w[0] for w in re.findall(r"[a-z0-9]+", str(name or "").lower()) if w not in _GENERIC)
    return len(initials) >= 3 and site.startswith(initials)


def clean(name: str, url: str, *, strict: bool = True) -> Optional[str]:
    return url if plausible_site(name, url, strict=strict) else None
