"""Apollo first: every Find button asks Apollo's company data before any other source.

One Apollo lookup per company (by its website when we hold one, else by name at our postcode) yields its phone, website and its LinkedIn,
Facebook and X pages. The answer is kept on the company record (a match for 30 days, a miss for 7) so a second button, or a second person
pressing it, never pays Apollo again. Only a company that passed the same checks as every Apollo lookup (UK, the same business, our
postcode or its own website) is used. When Apollo has nothing, the caller goes on to its usual sources."""
from __future__ import annotations

import copy
import logging
import os
from datetime import datetime
from typing import Any, Dict
from urllib.parse import urlparse

logger = logging.getLogger("apollo_first")

HIT_DAYS, MISS_DAYS = 30, 7


def first_for() -> set:
    """The kinds of lookup Apollo is asked first for: APOLLO_FIRST_FOR, a comma list of company_by_website, company_by_name, email_lookup.
    Empty by default. Only add a kind once a real call shows it costs no credits on the plan: Apollo-first spends credits on every press otherwise."""
    return {p.strip() for p in os.getenv("APOLLO_FIRST_FOR", "").split(",") if p.strip()}


def company_first() -> bool:
    return bool(first_for() & {"company_by_website", "company_by_name"})
SOCIAL = {"linkedin": ("linkedin_url", ("linkedin.com",)), "facebook": ("facebook_url", ("facebook.com", "fb.com")), "x": ("twitter_url", ("x.com", "twitter.com"))}


def _fresh(entry: Dict[str, Any]) -> bool:
    try:
        age = (datetime.utcnow() - datetime.fromisoformat(str(entry.get("at", "")).rstrip("Z"))).days
    except ValueError:
        return False
    return age <= (HIT_DAYS if entry.get("found") else MISS_DAYS)


def _page(url: Any, hosts: tuple) -> str:
    """The page address when it really is on that network, else nothing (Apollo's data holds the odd stale or mistyped link)."""
    text = str(url or "").strip()
    if not text:
        return ""
    parsed = urlparse(text if "//" in text else f"https://{text}")
    host = (parsed.netloc or "").lower().removeprefix("www.")
    if not any(host == h or host.endswith("." + h) for h in hosts) or len(parsed.path.strip("/")) < 2:
        return ""
    return f"https://{host}{parsed.path.rstrip('/')}" if parsed.scheme in ("http", "https", "") else ""


async def record(db: Any, biz: Any) -> Dict[str, Any]:
    """{found, phone, website, linkedin, facebook, x}: what Apollo holds for this company. {} when there is no Apollo key. Never raises."""
    if not company_first():
        return {}
    try:
        from app.services import apollo_pool
        from app.services import enrichment_service as ES

        saved = (biz.raw_data or {}).get("apollo")
        if saved and _fresh(saved):
            return saved
        if not await apollo_pool.keys():
            return {}
        domain = ES._host_of(biz.website or "") or biz.domain or ""
        got = await ES.search_apollo(biz.name, postcode=biz.postcode or "", domain=domain)
        raw = (got or {}).get("raw") or {}
        entry: Dict[str, Any] = {"found": bool(got), "at": datetime.utcnow().isoformat() + "Z", "phone": (got or {}).get("phone") or "",
                                 "website": (got or {}).get("website") or ""}
        for network, (field, hosts) in SOCIAL.items():
            entry[network] = _page(raw.get(field), hosts)
        keep = copy.deepcopy(biz.raw_data or {})
        keep["apollo"] = entry
        biz.raw_data = keep
        await db.flush()
        return entry
    except Exception as err:
        logger.warning("apollo-first lookup failed for %s: %s", getattr(biz, "name", "?"), err)
        return {}
