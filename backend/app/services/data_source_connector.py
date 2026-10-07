"""Generic HTTP connector for `kind="api"` DataSource rows.

Nothing here is specific to any one website or API -- the search endpoint, how a search hit's id
maps to a full profile request, and how that profile's JSON maps onto BusinessRecord's own field
names, all live in DataSource.config (see app.models.models.DataSource). Companies House is the
first row using this; a second structured-API source is a new config row, not a code change.
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import os
import re
import tempfile
import zipfile
from itertools import chain
from pathlib import Path
from typing import Any, AsyncIterator, Dict, Iterator, List, Optional

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
    """Auth header (if the source has a key) plus any fixed headers the source's config names --
    some public APIs need no key but insist on a version header (the Food Standards Agency does)."""
    out = dict((source.config or {}).get("headers") or {})
    if source.auth_type == "bearer":
        out["Authorization"] = f"Bearer {source.api_key or ''}"
    elif source.auth_type == "api_key_header":
        out[(source.config or {}).get("api_key_header", "X-Api-Key")] = source.api_key or ""
    return out


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
    if source.auth_type not in ("none", "", None) and not source.api_key:
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


# ── Bulk import: for a source that publishes a whole dataset (a government register's download),
# not a per-term search. Files can come from four places, picked by config["bulk_mode"] (or inferred):
#   index   -- an index page + a link pattern, found fresh every run (Companies House)
#   urls    -- a fixed list of direct file links (bulk_file_urls)
#   paged   -- a JSON API read page by page, optionally once per key from a list (bulk_paged_url)
#   folder  -- files uploaded in the admin screen, or dropped into the server's imports folder
# and read as CSV / TSV / delimited text, JSON, JSON-lines, or a ZIP of any of those.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
IMPORT_ROOT = Path(os.getenv("DATA_IMPORT_DIR", "/app/data/imports"))
FILE_EXTENSIONS = (".csv", ".tsv", ".txt", ".json", ".jsonl", ".ndjson", ".zip")
_ROW_EXTENSIONS = FILE_EXTENSIONS[:-1]
MAX_PAGES = 5000


def upload_dir(source_id: str) -> Path:
    return IMPORT_ROOT / "uploads" / re.sub(r"[^A-Za-z0-9_-]", "_", source_id)


def local_files(source) -> List[Path]:
    """Files waiting on this server for this source: what was uploaded in the admin screen, plus
    anything in bulk_local_dir (which must sit inside the imports folder, never anywhere else)."""
    found: List[Path] = []
    folders = [upload_dir(source.id)]
    configured = (source.config or {}).get("bulk_local_dir")
    if configured:
        target = (IMPORT_ROOT / str(configured).lstrip("/\\")).resolve()
        if IMPORT_ROOT.resolve() in target.parents or target == IMPORT_ROOT.resolve():
            folders.append(target)
    for folder in folders:
        if folder.is_dir():
            found += sorted(f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in FILE_EXTENSIONS and not f.name.startswith("."))
    return found


def bulk_mode(source) -> str:
    cfg = source.config or {}
    if cfg.get("bulk_mode") in ("index", "urls", "paged", "folder"):
        return cfg["bulk_mode"]
    if cfg.get("bulk_index_url"):
        return "index"
    if cfg.get("bulk_paged_url"):
        return "paged"
    if cfg.get("bulk_file_urls"):
        return "urls"
    return ""


def is_bulk(source) -> bool:
    return bool(bulk_mode(source))


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
    return re.sub(r"[^a-z0-9.]", "", str(h or "").strip().lower())


def _resolve_bulk_columns(headers: List[str], alias_map: Dict[str, Any]) -> Dict[str, List[str]]:
    norm_to_actual = {_normalize_header(h): h for h in headers}
    out: Dict[str, List[str]] = {}
    for field, aliases in alias_map.items():
        names = aliases if isinstance(aliases, list) else [aliases]
        matched = [norm_to_actual[_normalize_header(a)] for a in names if _normalize_header(a) in norm_to_actual]
        if matched:
            out[field] = matched
    return out


DEFAULT_ALIAS_MAP = {
    "name": ["CompanyName"], "registration_number": ["CompanyNumber"],
    "industry": ["SICCode.SicText_1"], "region": ["RegAddress.PostTown"],
    "address": ["RegAddress.AddressLine1", "RegAddress.PostTown", "RegAddress.PostCode"],
    "status": ["CompanyStatus"], "company_category": ["CompanyCategory"], "incorporation_date": ["IncorporationDate"],
}


def _registration_number(mapped: Dict[str, Any], candidates: List[Dict[str, Any]]) -> str:
    """The first usable identifier from a source that carries more than one kind (the Charity
    Commission lists a company number for charities that are also companies, and its own charity
    number for the rest). Each candidate names the mapped fields it is built from -- all must be
    present -- plus an optional zero-pad (Companies House numbers are 8 characters), a prefix that
    keeps a different register's numbers from ever colliding with another's, and a joiner."""
    for cand in candidates or []:
        fields = cand.get("fields") or [cand.get("field")]
        values = [str(mapped.get(f) or "").strip() for f in fields]
        if not all(values):
            continue
        if cand.get("pad") and len(values) == 1 and values[0].isdigit():
            values[0] = values[0].zfill(int(cand["pad"]))
        return f"{cand.get('prefix', '')}{cand.get('joiner', '-').join(values)}"
    return ""


def _finish_row(mapped: Dict[str, Any], raw: Any, cfg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Applies the source's own rules to one mapped row -- which identifier to use
    (bulk_registration), how its status words map to ours (bulk_value_map, e.g. a charity register's
    "Registered" -> "Active"), and fixed values every row of it shares (bulk_defaults, e.g. every row of a
    register of *active* locations is Active) -- keeps the whole original row, and drops rows with
    nothing to identify them by."""
    if cfg.get("bulk_registration"):
        found = _registration_number(mapped, cfg["bulk_registration"])
        if found:
            mapped["registration_number"] = found
    if cfg.get("bulk_uk_phone"):  # some registers drop the leading 0 of UK numbers (2073770990 -> 02073770990)
        digits = re.sub(r"\D", "", str(mapped.get("phone") or ""))
        if len(digits) == 10 and not digits.startswith("0"):
            mapped["phone"] = "0" + digits
    for field, table in (cfg.get("bulk_value_map") or {}).items():
        if mapped.get(field) in table:
            mapped[field] = table[mapped[field]]
    for key, value in (cfg.get("bulk_defaults") or {}).items():
        mapped.setdefault(key, value)
    if not (mapped.get("name") or mapped.get("registration_number")):
        return None
    mapped["raw"] = raw
    return mapped


def _text_stream(binary):
    return io.TextIOWrapper(binary, encoding="utf-8-sig", errors="replace", newline="")


def _delimiter(name: str, first_line: str) -> str:
    if name.lower().endswith(".tsv"):
        return "\t"
    counts = {d: first_line.count(d) for d in (",", "\t", "|", ";")}
    return max(counts, key=counts.get) if any(counts.values()) else ","


def _iter_delimited(stream, name: str, cfg: Dict[str, Any], alias_map: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
    """Rows of a delimited text file. Some publishers put a title/blank lines above the real header
    (the CQC directory does), so the header is the first of the opening rows that contains the
    columns we map -- not blindly row 0."""
    head = stream.readline()
    reader = csv.reader(chain([head], stream), delimiter=_delimiter(name, head))
    headers: List[str] = []
    columns: Dict[str, List[str]] = {}
    for position, row in enumerate(reader):
        found = _resolve_bulk_columns(row, alias_map)
        if found.get("name") or found.get("registration_number"):
            headers, columns = row, found
            break
        if position >= 30:
            break
    if not columns:
        raise ConnectorError(f"{name}: couldn't find a header row with a column mapped to the company name. "
                             "Check bulk_field_map against the file's real column names (use Preview).")
    index = {h: i for i, h in enumerate(headers)}
    for row in reader:
        if not any(c.strip() for c in row):
            continue
        mapped: Dict[str, Any] = {}
        for field, cols in columns.items():
            parts = [(row[index[c]] if index[c] < len(row) else "").strip() for c in cols]
            value = ", ".join(p for p in parts if p)
            if value:
                mapped[field] = value
        done = _finish_row(mapped, dict(zip(headers, row)), cfg)
        if done:
            yield done


def _iter_json_items(items: Any, cfg: Dict[str, Any], alias_map: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
    for item in items:
        if not isinstance(item, dict):
            continue
        done = _finish_row(map_fields(item, alias_map), item, cfg)
        if done:
            yield done


def _json_items(data: Any, cfg: Dict[str, Any]) -> List[Any]:
    path = cfg.get("bulk_items_path")
    found = _dig(data, path) if path else data
    if isinstance(found, dict) and not path:
        found = next((v for v in found.values() if isinstance(v, list)), [])
    return found if isinstance(found, list) else []


def _stream_json_array(stream, first_chunk: str) -> Iterator[Any]:
    """The objects of a top-level JSON array, one at a time, without ever holding the whole file --
    the Charity Commission publishes its register as a single ~500 MB array."""
    decoder = json.JSONDecoder()
    state = {"buf": first_chunk, "pos": first_chunk.index("[") + 1, "eof": False}

    def refill() -> None:
        more = stream.read(1 << 20)
        if not more:
            state["eof"] = True
            return
        state["buf"], state["pos"] = state["buf"][state["pos"]:] + more, 0

    while True:
        while True:
            buf, pos = state["buf"], state["pos"]
            while pos < len(buf) and buf[pos] in " \t\r\n,":
                pos += 1
            state["pos"] = pos
            if pos < len(buf) or state["eof"]:
                break
            refill()
        buf, pos = state["buf"], state["pos"]
        if pos >= len(buf) or buf[pos] == "]":
            return
        try:
            obj, end = decoder.raw_decode(buf, pos)
        except ValueError:
            if state["eof"]:
                raise
            refill()
            continue
        state["pos"] = end
        yield obj


def _json_documents(stream, cfg: Dict[str, Any]) -> Iterator[Any]:
    """Items of a .json file: streamed when it is a plain top-level array, otherwise (an object
    wrapping the list, located by bulk_items_path) read whole -- fine for the API-sized ones."""
    first = stream.read(1 << 20)
    if first.lstrip().startswith("[") and not cfg.get("bulk_items_path"):
        yield from _stream_json_array(stream, first)
    else:
        yield from _json_items(json.loads(first + stream.read()), cfg)


def _iter_one(binary, name: str, cfg: Dict[str, Any], alias_map: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
    lower = name.lower()
    if lower.endswith((".jsonl", ".ndjson")):
        def lines():
            for line in _text_stream(binary):
                line = line.strip()
                if line:
                    try:
                        yield json.loads(line)
                    except ValueError:
                        continue
        yield from _iter_json_items(lines(), cfg, alias_map)
    elif lower.endswith(".json"):
        yield from _iter_json_items(_json_documents(_text_stream(binary), cfg), cfg, alias_map)
    else:
        yield from _iter_delimited(_text_stream(binary), name, cfg, alias_map)


def iter_file_rows(path: Path, cfg: Dict[str, Any], alias_map: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
    """Mapped rows from one local file (a ZIP is read member by member, straight from the archive,
    so nothing is ever unpacked to disk or held whole in memory)."""
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as zf:
            for member in zf.namelist():
                if member.lower().endswith(_ROW_EXTENSIONS) and not member.endswith("/"):
                    with zf.open(member) as binary:
                        yield from _iter_one(binary, member, cfg, alias_map)
    else:
        with open(path, "rb") as binary:
            yield from _iter_one(binary, path.name, cfg, alias_map)


async def _download(url: str, headers: Optional[Dict[str, str]] = None, limit_bytes: int = 0):
    """Streams a remote file to a temp file on disk and returns it (caller closes). With
    limit_bytes it stops after that many bytes -- enough for a preview of a plain text file."""
    leaf = url.split("?")[0].rsplit("/", 1)[-1]
    tmp = tempfile.NamedTemporaryFile(suffix=("." + leaf.rsplit(".", 1)[-1][:6]) if "." in leaf else ".dat")
    async with httpx.AsyncClient(timeout=180, follow_redirects=True, headers=headers or {}) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            async for chunk in resp.aiter_bytes(1 << 20):
                tmp.write(chunk)
                if limit_bytes and tmp.tell() >= limit_bytes:
                    break
    tmp.flush()
    return tmp


async def _iter_paged(source, alias_map: Dict[str, Any], first_page_only: bool = False) -> AsyncIterator[Dict[str, Any]]:
    """A JSON API read page after page (optionally once for each key in a list the API itself
    publishes, e.g. the Food Standards Agency's local authorities). Waits min_delay_ms between
    calls so a public API is never hammered."""
    cfg = source.config or {}
    headers = {**_headers(source), **(cfg.get("bulk_headers") or {})}
    delay = max(0, source.min_delay_ms or 0) / 1000
    async with httpx.AsyncClient(timeout=60, follow_redirects=True, headers=headers, auth=_auth(source)) as client:
        keys: List[Any] = [""]
        if cfg.get("bulk_keys_url"):
            resp = await client.get(cfg["bulk_keys_url"])
            resp.raise_for_status()
            listed = _dig(resp.json(), cfg["bulk_keys_path"]) if cfg.get("bulk_keys_path") else resp.json()
            keys = [_dig(k, cfg["bulk_key_field"]) if cfg.get("bulk_key_field") else k for k in (listed or [])]
            keys = [k for k in keys if k not in (None, "")]
            if first_page_only:
                keys = keys[:1]
        for key in keys:
            for page in range(1, MAX_PAGES + 1):
                url = cfg["bulk_paged_url"].replace("{page}", str(page)).replace("{key}", str(key))
                resp = await client.get(url)
                if resp.status_code in (401, 403):
                    raise ConnectorError(f"{resp.status_code}: {url} rejected the request -- check the key/headers.")
                resp.raise_for_status()
                items = _json_items(resp.json(), cfg)
                if not items:
                    break
                for row in _iter_json_items(items, cfg, alias_map):
                    yield row
                if first_page_only or len(items) < int(cfg.get("bulk_page_size", 1)):
                    break
                if delay:
                    await asyncio.sleep(delay)


async def stream_bulk_rows(source, *, preview_rows: int = 0) -> AsyncIterator[Dict[str, Any]]:
    """Yields one mapped BusinessRecord dict per row of the source's dataset, whichever of the
    four places it comes from (see the comment above). Remote files are streamed to a temp file on
    disk first (a zip needs random access a network stream can't give) and read row by row, so
    this scales to however large the real dataset is. preview_rows > 0 stops after that many rows
    and never downloads a whole remote ZIP -- it is only for the admin screen's Preview."""
    cfg = source.config or {}
    alias_map = cfg.get("bulk_field_map") or DEFAULT_ALIAS_MAP
    mode = bulk_mode(source)
    sent = 0
    if mode == "paged":
        async for row in _iter_paged(source, alias_map, first_page_only=bool(preview_rows)):
            yield row
            sent += 1
            if preview_rows and sent >= preview_rows:
                return
        return
    targets: List[Any] = []
    if mode == "folder":
        targets = [(f, None) for f in local_files(source)]
        if not targets:
            raise ConnectorError("No files to import yet. Upload one, or put files in this source's folder on the server.")
    else:
        urls = await discover_bulk_files(source) if mode == "index" else list(cfg.get("bulk_file_urls") or [])
        if not urls:
            raise ConnectorError("No download links found. Check the index page and link pattern, or the file URLs.")
        for url in urls:
            if preview_rows and url.lower().split("?")[0].endswith(".zip"):
                raise ConnectorError("Preview can't open a remote ZIP without downloading all of it. Upload a small sample file to preview the mapping, or just start the import.")
        targets = [(None, u) for u in urls]
    for path, url in targets:
        tmp = None
        try:
            if url:
                logger.info(f"[data_source_connector] {source.name}: downloading {url}")
                tmp = await _download(url, cfg.get("bulk_headers"), limit_bytes=2 << 20 if preview_rows else 0)
                path = Path(tmp.name)
            for row in iter_file_rows(path, cfg, alias_map):
                yield row
                sent += 1
                if preview_rows and sent >= preview_rows:
                    return
        finally:
            if tmp:
                tmp.close()
        if preview_rows:
            return


def file_columns(path: Path) -> List[str]:
    """The column names / top-level keys a file really has -- shown in Preview so the mapping can be
    written against what is actually there."""
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as zf:
            member = next((m for m in zf.namelist() if m.lower().endswith(_ROW_EXTENSIONS)), None)
            if not member:
                return []
            with zf.open(member) as binary:
                return _sample_columns(binary, member)
    with open(path, "rb") as binary:
        return _sample_columns(binary, path.name)


def _sample_columns(binary, name: str) -> List[str]:
    lower = name.lower()
    stream = _text_stream(binary)
    if lower.endswith((".jsonl", ".ndjson")):
        try:
            first = json.loads(stream.readline())
        except ValueError:
            return []
        return list(first.keys()) if isinstance(first, dict) else []
    if lower.endswith(".json"):
        try:
            first = next(iter(_json_documents(stream, {})), None)
        except ValueError:
            return []
        return list(first.keys()) if isinstance(first, dict) else []
    rows = []
    head = stream.readline()
    for row in csv.reader(chain([head], stream), delimiter=_delimiter(name, head)):
        rows.append(row)
        if len(rows) >= 8:
            break
    # the widest of the opening rows is the header (title lines above it are one cell wide)
    return max(rows, key=lambda r: sum(1 for c in r if c.strip()), default=[])


async def _fetch_list(source, url_template: str, id_value: str, items_path: str, field_map: Dict[str, Any], limit: int = 25) -> List[Dict[str, Any]]:
    try:
        async with _client(source) as client:
            resp = await client.get(url_template.format(id=id_value))
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as err:
        logger.warning(f"[data_source_connector] {url_template}: {err}")
        return []
    items = _dig(data, items_path)
    if not isinstance(items, list):
        return []
    return [map_fields(it, field_map) for it in items[:limit] if isinstance(it, dict)]


async def fetch_profile(source, item: Dict[str, Any]) -> Dict[str, Any]:
    """The mapped BusinessRecord fields for one search hit, plus the raw payload they came from.
    If the source config sets officers_endpoint/psc_endpoint, this is also where that per-company
    detail gets pulled in -- one lookup at a time, for whichever company someone actually asked
    about. Never done for every row of a bulk import (5.5 million companies x 2 extra calls each
    would take forever and blow through any real API's rate limit), only here, on demand."""
    cfg = source.config or {}
    raw = item
    profile_endpoint = cfg.get("profile_endpoint")
    id_value = _dig(item, cfg.get("id_field_from_search", "id"))
    if profile_endpoint and id_value:
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
    if id_value:
        officers_endpoint = cfg.get("officers_endpoint")
        if officers_endpoint:
            mapped["officers"] = await _fetch_list(source, officers_endpoint, id_value,
                                                     cfg.get("officers_items_path", "items"), cfg.get("officers_field_map") or {})
        psc_endpoint = cfg.get("psc_endpoint")
        if psc_endpoint:
            mapped["significant_control"] = await _fetch_list(source, psc_endpoint, id_value,
                                                                cfg.get("psc_items_path", "items"), cfg.get("psc_field_map") or {})
    return {**mapped, "raw": raw}
