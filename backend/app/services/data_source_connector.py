"""Generic HTTP connector for `kind="api"` DataSource rows.

Nothing here is specific to any one website or API -- the search endpoint, how a search hit's id
maps to a full profile request, and how that profile's JSON maps onto BusinessRecord's own field
names, all live in DataSource.config (see app.models.models.DataSource). Companies House is the
first row using this; a second structured-API source is a new config row, not a code change.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("data_source_connector")


def _dig(obj: Any, path: str) -> Any:
    """Resolve a dotted path like "registered_office_address.postal_code" or "sic_codes.0"
    against nested dicts/lists. Missing at any step returns None rather than raising, since a
    field a lot of companies simply don't have is normal, not an error."""
    cur = obj
    for part in path.split("."):
        if cur is None:
            return None
        if isinstance(cur, list):
            if not part.lstrip("-").isdigit():
                return None
            idx = int(part)
            cur = cur[idx] if -len(cur) <= idx < len(cur) else None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _resolve(raw: Dict[str, Any], spec: Any) -> Optional[str]:
    """A field_map entry is either one path, or a list of paths joined with ", " (e.g. an
    address assembled from several address-line fields)."""
    paths = spec if isinstance(spec, list) else [spec]
    parts: List[str] = []
    for path in paths:
        value = _dig(raw, path)
        if isinstance(value, list):
            value = ", ".join(str(v) for v in value if v)
        if value:
            parts.append(str(value))
    return ", ".join(parts) if parts else None


def map_fields(raw: Dict[str, Any], field_map: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for business_field, spec in (field_map or {}).items():
        value = _resolve(raw, spec)
        if value:
            out[business_field] = value
    return out


def _auth(source) -> Optional[httpx.Auth]:
    if source.auth_type == "api_key_basic":
        return httpx.BasicAuth(source.api_key or "", "")
    return None


def _headers(source) -> Dict[str, str]:
    if source.auth_type == "bearer":
        return {"Authorization": f"Bearer {source.api_key or ''}"}
    if source.auth_type == "api_key_header":
        header_name = (source.config or {}).get("api_key_header", "X-Api-Key")
        return {header_name: source.api_key or ""}
    return {}


def _client(source) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=source.base_url, timeout=20, auth=_auth(source), headers=_headers(source))


async def search(source, query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Raw search hits, not yet mapped to BusinessRecord's fields -- used to find candidate
    identifiers before fetching each one's full profile."""
    cfg = source.config or {}
    endpoint = cfg.get("search_endpoint")
    if not endpoint or not source.api_key:
        return []
    param = cfg.get("search_param", "q")
    try:
        async with _client(source) as client:
            resp = await client.get(endpoint, params={param: query, **(cfg.get("search_extra_params") or {})})
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as err:
        logger.warning(f"[data_source_connector] search failed for {source.name}: {err}")
        return []
    items = _dig(data, cfg.get("search_items_path", "items"))
    return items[:limit] if isinstance(items, list) else []


async def fetch_profile(source, item: Dict[str, Any]) -> Dict[str, Any]:
    """The mapped BusinessRecord fields for one search hit, plus the raw payload they came from."""
    cfg = source.config or {}
    raw = item
    profile_endpoint = cfg.get("profile_endpoint")
    if profile_endpoint:
        id_value = _dig(item, cfg.get("id_field_from_search", "id"))
        if id_value:
            path = profile_endpoint.format(id=id_value)
            try:
                async with _client(source) as client:
                    resp = await client.get(path)
                    resp.raise_for_status()
                    raw = resp.json()
            except httpx.HTTPError as err:
                logger.warning(f"[data_source_connector] profile fetch failed for {source.name} {id_value}: {err}")
                raw = item
    mapped = map_fields(raw, cfg.get("field_map") or {})
    return {**mapped, "raw": raw}
