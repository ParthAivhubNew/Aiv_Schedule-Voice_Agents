"""Generic HTTP connector for `kind="api"` DataSource rows.

Nothing here is specific to any one website or API -- the search endpoint, how a search hit's id
maps to a full profile request, and how that profile's JSON maps onto BusinessRecord's own field
names, all live in DataSource.config (see app.models.models.DataSource). Companies House is the
first row using this; a second structured-API source is a new config row, not a code change.
"""
from __future__ import annotations

import csv
import io
import logging
import re
import tempfile
import zipfile
from typing import Any, AsyncIterator, Dict, List, Optional

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
    identifiers before fetching each one's full profile. Swallows failures on purpose (a real
    lookup fans out across several sources; one bad source must never break the rest) -- use
    test_connection() instead when the caller needs to know WHY nothing came back."""
    try:
        return await _raw_search(source, query, limit)
    except ConnectorError as err:
        logger.warning(f"[data_source_connector] search failed for {source.name}: {err}")
        return []


class ConnectorError(Exception):
    """A source call failed for a specific, reportable reason (no key, bad key, wrong URL/
    endpoint, unreachable host) -- as opposed to a call that succeeded but matched nothing."""


async def _raw_search(source, query: str, limit: int = 10) -> List[Dict[str, Any]]:
    cfg = source.config or {}
    endpoint = cfg.get("search_endpoint")
    if not endpoint:
        raise ConnectorError("This source has no search_endpoint set in its config.")
    if not source.api_key:
        raise ConnectorError("No API key saved for this source yet.")
    param = cfg.get("search_param", "q")
    try:
        async with _client(source) as client:
            resp = await client.get(endpoint, params={param: query, **(cfg.get("search_extra_params") or {})})
    except httpx.HTTPError as err:
        raise ConnectorError(f"Couldn't reach {source.base_url}: {err}") from err
    if resp.status_code in (401, 403):
        raise ConnectorError(f"{resp.status_code}: the API key was rejected -- check it's correct and still active.")
    if resp.status_code == 404:
        raise ConnectorError(f"404: {endpoint} -- check search_endpoint/base_url in the config.")
    if resp.status_code >= 400:
        raise ConnectorError(f"{resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    items = _dig(data, cfg.get("search_items_path", "items"))
    if items is None:
        raise ConnectorError(f"The response had nothing at \"{cfg.get('search_items_path', 'items')}\" -- check search_items_path in the config.")
    return items[:limit] if isinstance(items, list) else []


async def test_connection(source, query: str = "") -> Dict[str, Any]:
    """What the Data Sources screen's Test button calls -- unlike search(), this never hides a
    real problem behind an empty result list."""
    q = query or (source.config or {}).get("test_query", "")
    if not q:
        return {"ok": False, "error": "Set a \"test_query\" in this source's config (e.g. a real company name it should find), then Test again."}
    try:
        hits = await _raw_search(source, q, limit=5)
    except ConnectorError as err:
        return {"ok": False, "error": str(err)}
    return {"ok": True, "hits": len(hits), "sample": hits[0] if hits else None,
            "note": "" if hits else f'Reached the API fine, but "{q}" matched nothing -- try a different test_query if that seems wrong.'}


# ── Bulk file import: for a source that publishes its whole dataset as a download, not a
# per-term search -- staff configure the index page + a pattern once; no company names, ever.
# ──────────────────────────────────────────────────────────────────────────────────────────────
def is_bulk(source) -> bool:
    return bool((source.config or {}).get("bulk_index_url"))


async def discover_bulk_files(source) -> List[str]:
    """The download links on a bulk source's index page, matched by bulk_link_pattern -- found
    fresh every run, so staff never hand-maintain a URL that changes every month."""
    cfg = source.config or {}
    index_url, pattern = cfg.get("bulk_index_url"), cfg.get("bulk_link_pattern")
    if not index_url or not pattern:
        return []
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(index_url)
        resp.raise_for_status()
    names = sorted(set(re.findall(pattern, resp.text)))
    base = index_url.rsplit("/", 1)[0] + "/"
    return [n if n.startswith("http") else base + n for n in names]


def _normalize_header(h: str) -> str:
    """Strips whitespace/case/punctuation so a file's actual column names match our aliases even
    with the kind of stray leading space Companies House's own files are documented to have."""
    return re.sub(r"[^a-z0-9.]", "", h.strip().lower())


def _resolve_bulk_columns(headers: List[str], alias_map: Dict[str, Any]) -> Dict[str, List[str]]:
    norm_to_actual = {_normalize_header(h): h for h in headers}
    out: Dict[str, List[str]] = {}
    for field, aliases in alias_map.items():
        names = aliases if isinstance(aliases, list) else [aliases]
        matched = [norm_to_actual[_normalize_header(a)] for a in names if _normalize_header(a) in norm_to_actual]
        if matched:
            out[field] = matched
    return out


async def stream_bulk_rows(source) -> AsyncIterator[Dict[str, Any]]:
    """Yields one mapped BusinessRecord dict per row across every file the source's index page
    currently lists. Each file is streamed to a temp file on disk (a zip needs random-access
    seeking a network stream can't give; a file never sits fully in memory), then read straight
    out of the zip entry row by row -- never materializing a whole file's rows at once, so this
    scales to however large the real dataset is."""
    cfg = source.config or {}
    alias_map = cfg.get("bulk_field_map") or {
        "name": ["CompanyName"], "registration_number": ["CompanyNumber"],
        "industry": ["SICCode.SicText_1"], "region": ["RegAddress.PostTown"],
        "address": ["RegAddress.AddressLine1", "RegAddress.PostTown", "RegAddress.PostCode"],
    }
    for url in await discover_bulk_files(source):
        logger.info(f"[data_source_connector] {source.name}: downloading {url}")
        with tempfile.NamedTemporaryFile(suffix=".zip") as tmp:
            async with httpx.AsyncClient(timeout=180, follow_redirects=True) as client:
                async with client.stream("GET", url) as resp:
                    resp.raise_for_status()
                    async for chunk in resp.aiter_bytes(1 << 20):
                        tmp.write(chunk)
            tmp.flush()
            with zipfile.ZipFile(tmp.name) as zf:
                for name in zf.namelist():
                    if not name.lower().endswith(".csv"):
                        continue
                    with zf.open(name) as raw:
                        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", errors="replace"))
                        columns = _resolve_bulk_columns(reader.fieldnames or [], alias_map)
                        for row in reader:
                            mapped: Dict[str, Any] = {}
                            for field, cols in columns.items():
                                parts = [str(row.get(c, "") or "").strip() for c in cols]
                                value = ", ".join(p for p in parts if p)
                                if value:
                                    mapped[field] = value
                            if mapped.get("name") or mapped.get("registration_number"):
                                yield mapped


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
