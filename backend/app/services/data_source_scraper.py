"""Generic scraper for `kind="scrape"` DataSource rows -- sites with no structured API.

Fetches a page safely (SSRF-checked, via safe_fetch), then forces an LLM tool call to turn the
cleaned page text into exactly BusinessRecord's own fields (see llm_gateway.extract_structured).
Nothing here is specific to any one website: a new scrape-type source is a URL pattern staff
enter in the Data Sources screen, not a new parser to write.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from app.services import llm_gateway
from app.services.safe_fetch import FetchRefused, fetch_text

logger = logging.getLogger("data_source_scraper")

_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "The company's name."},
        "registration_number": {"type": "string", "description": "Company registration number, if shown."},
        "domain": {"type": "string", "description": "The company's own website domain, e.g. acme.co.uk."},
        "website": {"type": "string"},
        "phone": {"type": "string"},
        "email": {"type": "string"},
        "address": {"type": "string"},
        "industry": {"type": "string", "description": "What kind of business this is."},
        "region": {"type": "string", "description": "Town/city/region, if shown."},
        "employee_estimate": {"type": "string", "description": "Employee count or size band, if shown."},
        "description": {"type": "string", "description": "A short factual summary of what the business does."},
        "found": {"type": "boolean", "description": "False if this page isn't actually about one identifiable company."},
    },
    "required": ["found"],
}

_SYSTEM_PROMPT = (
    "You extract facts about one company from a web page's text. Use null/empty for anything not "
    "actually present on the page -- never guess or infer a value that isn't stated. If the page "
    "isn't about one identifiable company, set found=false and leave the other fields empty."
)


async def scrape_url(db, url: str, *, scope: str = "leadgen") -> Optional[Dict[str, Any]]:
    """The mapped BusinessRecord fields for one page, or None if the page couldn't be read or
    wasn't usefully about a company. Caller decides the confidence_tier (this is always a guess
    from unstructured text, never better than "scraped" at best)."""
    try:
        title, text = await fetch_text(url, max_chars=8000)
    except FetchRefused as err:
        logger.info(f"[data_source_scraper] {url} refused: {err}")
        return None
    if not text.strip():
        return None
    data = await llm_gateway.extract_structured(
        system_prompt=_SYSTEM_PROMPT, user_text=f"Page title: {title}\n\n{text}",
        schema=_SCHEMA, tool_name="extract_business", db=db, scope=scope,
    )
    if not data or data.get("found") is False:
        return None
    data.pop("found", None)
    if not data.get("name") and not data.get("domain"):
        return None
    data["source_url"] = url
    return data


async def run_source(db, source, query: str, *, scope: str = "leadgen") -> Optional[Dict[str, Any]]:
    """For a scrape-type DataSource: build the page URL from its config's `url_template`
    (e.g. "https://example.com/search?q={query}") and scrape it. A source whose config has no
    template simply can't be searched this way yet -- nothing crashes, it's just skipped."""
    template = (source.config or {}).get("url_template")
    if not template:
        return None
    url = template.format(query=query)
    return await scrape_url(db, url, scope=scope)
