"""Free official registers that keep our company records current, all writing to one table (registry_events):

  * Companies House streaming API: live changes (status, name, address, new companies, officers joining or leaving). Needs a stream key.
  * The Gazette: insolvency notices (winding-up petitions, liquidations, administrations). No key; Open Government Licence, company data only.
  * FCA Financial Services Register: whether a finance-sector company is an FCA-authorised firm. Needs a free key.
  * ONS Postcode Directory: postcode -> district, coordinates, local authority, region. A file load, no key.

Only companies we already hold are recorded (BN postcodes by default), so the table stays small. Officers are kept by name, role and date only.
The loops that run these are started from main.py; staff set the keys and start one-off jobs from the admin portal (api/admin_portal.py)."""
from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import re
import time
import zipfile
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert

logger = logging.getLogger("registry_feeds")

KEYS_DOC = "registry_feed_keys"  # app_settings: {"ch_stream": sealed, "fca_key": sealed, "fca_email": plain}
STATE_DOC = "registry_feed_state"  # app_settings: {feed id: {...}}
AREA = "BN"  # the postcode area whose companies are followed
STREAMS = {"ch_companies": "/companies", "ch_officers": "/officers"}  # two connections: Companies House allows two per key
UA = {"User-Agent": "Mozilla/5.0 (compatible; OutreachRegistryFeeds/1.0)"}

# ---------- settings: keys and per-feed state ----------

_state_lock = asyncio.Lock()


async def _doc(doc_id: str) -> Dict[str, Any]:
    from app.database import AsyncSessionLocal
    from app.models.models import AppSetting

    async with AsyncSessionLocal() as s:
        row = await s.get(AppSetting, doc_id)
    return dict((row.data or {}) if row else {})


async def _save_doc(doc_id: str, data: Dict[str, Any]) -> None:
    from app.database import AsyncSessionLocal
    from app.models.models import AppSetting

    async with AsyncSessionLocal() as s:
        row = await s.get(AppSetting, doc_id)
        if row:
            row.data = data
        else:
            s.add(AppSetting(id=doc_id, data=data))
        await s.commit()


async def get_key(name: str) -> str:
    from app.services.secret_box import open_secret

    raw = (await _doc(KEYS_DOC)).get(name) or ""
    return raw if name == "fca_email" else open_secret(raw)


async def set_key(name: str, value: str) -> None:
    from app.services.secret_box import seal_secret

    if name not in ("ch_stream", "fca_key", "fca_email"):
        raise ValueError("Unknown key.")
    doc = await _doc(KEYS_DOC)
    doc[name] = value.strip() if name == "fca_email" else seal_secret(value.strip())
    await _save_doc(KEYS_DOC, doc)


async def keys_present() -> Dict[str, bool]:
    doc = await _doc(KEYS_DOC)
    return {"ch_stream": bool(doc.get("ch_stream")), "fca": bool(doc.get("fca_key") and doc.get("fca_email"))}


async def get_state() -> Dict[str, Any]:
    return await _doc(STATE_DOC)


async def patch_state(feed: str, **fields: Any) -> None:
    async with _state_lock:
        doc = await _doc(STATE_DOC)
        doc[feed] = {**(doc.get(feed) or {}), **fields}
        await _save_doc(STATE_DOC, doc)


# ---------- the companies we follow ----------

_KNOWN: Dict[str, Tuple[str, str, str]] = {}  # company number -> (name, status, postcode)
_BY_NAME: Dict[str, List[str]] = {}
_known_at = 0.0


def norm_name(name: str) -> str:
    s = re.sub(r"^/N\s+", "", str(name or "").strip().upper())  # Gazette titles start with a stray "/n"
    s = re.sub(r"&", "AND", s)
    s = re.sub(r"[^A-Z0-9 ]", "", s)
    s = re.sub(r"\s+(LIMITED|LTD|PLC|LLP|LP)$", "", s.strip())
    return re.sub(r"\s+", "", s)


async def known_companies(force: bool = False) -> Dict[str, Tuple[str, str, str]]:
    """The Companies House companies we hold in the followed area, reloaded every 6 hours."""
    global _known_at
    if _KNOWN and not force and time.time() - _known_at < 6 * 3600:
        return _KNOWN
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as s:
        rows = (await s.execute(text(
            "SELECT registration_number, name, COALESCE(status,''), COALESCE(postcode,'') FROM business_records "
            "WHERE postcode LIKE :p AND registration_number ~ '^[A-Z0-9]{8}$'"), {"p": AREA + "%"})).all()
    _KNOWN.clear()
    _BY_NAME.clear()
    for num, name, status, pc in rows:
        _KNOWN[num] = (name, status, pc)
        _BY_NAME.setdefault(norm_name(name), []).append(num)
    _known_at = time.time()
    return _KNOWN


async def record_event(source: str, ext_id: str, *, company_number: str, company_name: str, kind: str, field: str = "", old: str = "",
                       new: str = "", when: Optional[datetime] = None, link: str = "", detail: Optional[Dict[str, Any]] = None) -> bool:
    """Stores one event once (the feed's own id is the key). Returns True when it was new."""
    from app.database import AsyncSessionLocal
    from app.models.models import RegistryEvent

    stmt = pg_insert(RegistryEvent).values(
        id=f"{source}:{ext_id}"[:200], source=source, ext_id=str(ext_id)[:200], company_number=company_number, company_name=(company_name or "")[:300],
        kind=kind, field=field, old_value=(old or "")[:300], new_value=(new or "")[:300], event_date=when or datetime.utcnow(), link=link[:500],
        detail=detail, created_at=datetime.utcnow()).on_conflict_do_nothing(constraint="uq_registry_event")
    async with AsyncSessionLocal() as s:
        res = await s.execute(stmt)
        await s.commit()
    return bool(res.rowcount)


def _when(text_value: Any) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(text_value).replace("Z", "").split("+")[0])
    except (TypeError, ValueError):
        return None


# ---------- Companies House streaming API ----------

def event_from_company(data: Dict[str, Any], known: Dict[str, Tuple[str, str, str]]) -> List[Dict[str, Any]]:
    """What changed on a company profile, compared with what we hold. Nothing when it is the same as ours (most stream events are)."""
    num = str(data.get("company_number") or "")
    name = str(data.get("company_name") or "")
    status = str(data.get("company_status") or "")
    postcode = str((data.get("registered_office_address") or {}).get("postal_code") or "").upper().strip()
    if num in known:
        old_name, old_status, old_pc = known[num]
        detail = str(data.get("company_status_detail") or "")
        squash = lambda v: re.sub(r"[^a-z]", "", str(v).lower())  # noqa: E731
        new_status = (status + (" - " + detail if detail else "")).strip()
        # the register's status may be held as "Active - Proposal to Strike off" (status + detail) or as just "Active": either way is the same state
        same = squash(old_status) in {squash(status), squash(detail), squash(status) + squash(detail)}
        out = []
        if status and old_status and not same:
            out.append({"kind": "status_changed", "field": "company_status", "old": old_status, "new": new_status})
        if name and old_name and norm_name(name) != norm_name(old_name):
            out.append({"kind": "name_changed", "field": "company_name", "old": old_name, "new": name})
        if postcode and old_pc and re.sub(r"\s", "", postcode) != re.sub(r"\s", "", old_pc.upper()):
            out.append({"kind": "address_changed", "field": "registered_office_postcode", "old": old_pc, "new": postcode})
        return out
    created = _when(data.get("date_of_creation"))
    if postcode.startswith(AREA) and created and datetime.utcnow() - created < timedelta(days=60):
        return [{"kind": "new_company", "field": "company", "old": "", "new": name}]
    return []


def event_from_officer(uri: str, data: Dict[str, Any], known: Dict[str, Tuple[str, str, str]]) -> Optional[Dict[str, Any]]:
    m = re.match(r"^/company/([A-Z0-9]{8})/officers/", uri or "")
    if not m or m.group(1) not in known:
        return None
    role, name = str(data.get("officer_role") or ""), str(data.get("name") or "")
    if data.get("resigned_on"):
        return {"kind": "officer_resigned", "field": role, "old": name, "new": "", "when": _when(data.get("resigned_on")), "num": m.group(1)}
    appointed = _when(data.get("appointed_on"))
    if appointed and datetime.utcnow() - appointed < timedelta(days=45):
        return {"kind": "officer_appointed", "field": role, "old": "", "new": name, "when": appointed, "num": m.group(1)}
    return None  # an existing officer's details changed: not a change worth reporting


async def _consume(feed: str, key: str) -> None:
    """One connection to one stream until it drops. The last timepoint is saved, so a restart carries on where it left off."""
    state = (await get_state()).get(feed) or {}
    tp = state.get("timepoint")
    url = "https://stream.companieshouse.gov.uk" + STREAMS[feed] + (f"?timepoint={tp}" if tp else "")
    seen, kept, last_save = int(state.get("seen") or 0), int(state.get("kept") or 0), time.time()
    known = await known_companies()
    await patch_state(feed, status="connecting", error="")
    timeout = httpx.Timeout(connect=20, read=120, write=20, pool=20)  # Companies House sends a blank line every 30 seconds; 120 of silence is a dead connection
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("GET", url, auth=(key, "")) as resp:
            if resp.status_code == 416:  # the saved timepoint is too old: start from now
                await patch_state(feed, timepoint=None, status="restarting", error="Saved position too old; starting from now.")
                return
            if resp.status_code == 429:
                await patch_state(feed, status="waiting", error="Companies House asked us to slow down (429); waiting 10 minutes.")
                await asyncio.sleep(600)
                return
            if resp.status_code in (401, 403):
                await patch_state(feed, status="error", error=f"Companies House refused the stream key ({resp.status_code}).")
                await asyncio.sleep(900)
                return
            if resp.status_code != 200:
                await patch_state(feed, status="error", error=f"Companies House answered {resp.status_code}.")
                await asyncio.sleep(120)
                return
            await patch_state(feed, status="connected", error="")
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                seen += 1
                data, event = ev.get("data") or {}, ev.get("event") or {}
                tp = event.get("timepoint", tp)
                published = _when(event.get("published_at"))
                new_events: List[Dict[str, Any]] = []
                if feed == "ch_companies":
                    for e in event_from_company(data, known):
                        new_events.append({**e, "num": str(data.get("company_number") or ""), "name": str(data.get("company_name") or ""), "when": published})
                else:
                    e = event_from_officer(str(ev.get("resource_uri") or ""), data, known)
                    if e:
                        new_events.append({**e, "name": (known.get(e["num"]) or ("",))[0], "when": e.get("when") or published,
                                           "detail": {"role": e["field"], "officer": e["old"] or e["new"]}})
                for i, e in enumerate(new_events):
                    ok = await record_event(feed, f"{tp}-{i}", company_number=e["num"], company_name=e.get("name", ""), kind=e["kind"], field=e["field"],
                                            old=e["old"], new=e["new"], when=e.get("when"), link=f"https://find-and-update.company-information.service.gov.uk/company/{e['num']}",
                                            detail=e.get("detail"))
                    kept += 1 if ok else 0
                if time.time() - last_save > 60:
                    await patch_state(feed, timepoint=tp, seen=seen, kept=kept, last_event_at=datetime.utcnow().isoformat() + "Z", status="connected")
                    last_save = time.time()
                    known = await known_companies()


async def stream_loop(feed: str) -> None:
    """Keeps one stream connected for as long as a key is saved. Reconnects with a growing pause so Companies House never rate limits us."""
    pause = 20
    while True:
        try:
            key = await get_key("ch_stream")
            if not key:
                await patch_state(feed, status="no key", error="Save the Companies House stream key to start this feed.")
                await asyncio.sleep(300)
                continue
            await _consume(feed, key)
            pause = 20
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.warning(f"[registry] {feed} dropped: {err}")
            await patch_state(feed, status="reconnecting", error=str(err)[:200])
            pause = min(pause * 2, 600)
        await asyncio.sleep(pause)


# ---------- The Gazette ----------

async def _gazette_get(params: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    """One Gazette request. Its firewall refuses httpx (403) but accepts the standard-library client, so that is what is used here."""
    import urllib.error
    import urllib.parse
    import urllib.request

    url = "https://www.thegazette.co.uk/insolvency/notice/data.json?" + urllib.parse.urlencode(params)

    def go() -> Tuple[int, Dict[str, Any]]:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            return err.code, {}

    return await asyncio.to_thread(go)


async def pull_gazette(days: int = 7) -> Dict[str, int]:
    """Insolvency notices of the last `days` days whose company name matches exactly one company we hold. Company notices only:
    the person names in a notice are never read or stored. Gentle on The Gazette: one request a second."""
    known = await known_companies()
    start = (datetime.utcnow() - timedelta(days=max(1, days))).strftime("%Y-%m-%d")
    end = datetime.utcnow().strftime("%Y-%m-%d")
    page, seen, matched, added = 1, 0, 0, 0
    await patch_state("gazette", status="running", error="")
    while page <= 60:
        code, body = await _gazette_get({"start-publish-date": start, "end-publish-date": end, "results-page-size": 100, "results-page": page})
        if code != 200:
            await patch_state("gazette", status="error", error=f"The Gazette answered {code}.")
            break
        entries = body.get("entry") or []
        entries = entries if isinstance(entries, list) else [entries]
        if not entries:
            break
        for e in entries:
            seen += 1
            nums = _BY_NAME.get(norm_name(e.get("title") or ""), [])
            if len(nums) != 1:
                continue
            matched += 1
            num = nums[0]
            notice_id = str(e.get("id") or "").rsplit("/", 1)[-1]
            cat = (e.get("category") or {}).get("@term") if isinstance(e.get("category"), dict) else ""
            ok = await record_event("gazette", notice_id, company_number=num, company_name=known[num][0], kind="gazette_notice", field=cat or "notice",
                                    new=cat or "", when=_when(e.get("published")), link=f"https://www.thegazette.co.uk/notice/{notice_id}",
                                    detail={"notice_code": e.get("f:notice-code")})
            added += 1 if ok else 0
        total = int(body.get("f:total") or 0)
        if page * 100 >= total:
            break
        page += 1
        await asyncio.sleep(1)
    await patch_state("gazette", status="idle", last_run_at=datetime.utcnow().isoformat() + "Z", seen=seen, kept=added, matched=matched, error="")
    return {"notices_read": seen, "matched": matched, "new_events": added}


async def gazette_loop() -> None:
    """Once a day (and once soon after start-up if it has never run)."""
    await asyncio.sleep(120)
    while True:
        try:
            last = _when((await get_state()).get("gazette", {}).get("last_run_at"))
            if not last or datetime.utcnow() - last > timedelta(hours=23):
                await pull_gazette(days=3 if last else 14)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.warning(f"[registry] gazette pull failed: {err}")
            await patch_state("gazette", status="error", error=str(err)[:200])
        await asyncio.sleep(3600)


# ---------- FCA Financial Services Register ----------

async def check_fca(limit: int = 200) -> Dict[str, int]:
    """Looks up finance-sector companies (SIC 64, 65, 66 as any listed code) we hold in the followed area on the FCA register, by exact name.
    Saves the register's own facts (reference number, status) on the company, labelled FCA. Only ones never checked."""
    key, email = await get_key("fca_key"), await get_key("fca_email")
    if not key or not email:
        raise ValueError("Save the FCA register key and email first.")
    from app.database import AsyncSessionLocal
    from app.models.models import BusinessRecord

    await patch_state("fca", status="running", error="")
    checked = authorised = 0
    async with AsyncSessionLocal() as s:
        ids = (await s.execute(text(
            "SELECT id FROM business_records WHERE postcode LIKE :p AND registration_number ~ '^[A-Z0-9]{8}$' AND lower(status)='active' "
            "AND sic_codes ~ '\\|(64|65|66)[0-9]{3}\\|' AND (raw_data IS NULL OR raw_data::jsonb->'fca' IS NULL) ORDER BY id LIMIT :n"),
            {"p": AREA + "%", "n": limit})).scalars().all()
    async with httpx.AsyncClient(timeout=30, headers={"X-Auth-Email": email, "X-Auth-Key": key, "Content-Type": "application/json"}) as client:
        for bid in ids:
            async with AsyncSessionLocal() as s:
                biz = await s.get(BusinessRecord, bid)
                r = await client.get("https://register.fca.org.uk/services/V0.1/Search", params={"q": biz.name, "type": "firm"})
                if r.status_code in (401, 403):
                    await patch_state("fca", status="error", error=f"The FCA refused the key ({r.status_code}).")
                    return {"checked": checked, "authorised": authorised}
                if r.status_code == 429:
                    await asyncio.sleep(30)
                    continue
                hit = None
                if r.status_code == 200:
                    for item in (r.json().get("Data") or []):
                        if norm_name(item.get("Name") or "") == norm_name(biz.name):
                            hit = item
                            break
                raw = dict(biz.raw_data or {})
                raw["fca"] = {"checked_at": datetime.utcnow().isoformat() + "Z", "source": "FCA Financial Services Register", "found": bool(hit),
                              "reference": (hit or {}).get("Reference Number", ""), "status": (hit or {}).get("Status", "")}
                biz.raw_data = raw
                await s.commit()
                checked += 1
                authorised += 1 if hit else 0
            await asyncio.sleep(0.7)
    await patch_state("fca", status="idle", last_run_at=datetime.utcnow().isoformat() + "Z", seen=checked, kept=authorised, error="")
    return {"checked": checked, "authorised": authorised}


# ---------- ONS Postcode Directory ----------

async def load_onspd(url: str, prefix: str = AREA) -> Dict[str, int]:
    """Loads the ONS Postcode Directory (the zip from the ONS Open Geography portal, or a CSV) for postcodes starting with `prefix`.
    Downloads to a temp file, reads the main CSV row by row, and replaces the rows for those postcodes."""
    import tempfile

    from app.database import AsyncSessionLocal
    from app.models.models import PostcodeLookup

    await patch_state("onspd", status="running", error="")
    prefix = prefix.upper()
    tmp = tempfile.NamedTemporaryFile(suffix=".dl", delete=False)
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=30, read=300, write=30, pool=30), headers=UA, follow_redirects=True) as client:
        async with client.stream("GET", url) as r:
            if r.status_code != 200:
                await patch_state("onspd", status="error", error=f"The download answered {r.status_code}.")
                return {"loaded": 0}
            async for chunk in r.aiter_bytes(1 << 20):
                tmp.write(chunk)
    tmp.close()
    handle = None
    if zipfile.is_zipfile(tmp.name):
        zf = zipfile.ZipFile(tmp.name)
        csvs = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not csvs:
            await patch_state("onspd", status="error", error="No CSV file in that zip.")
            return {"loaded": 0}
        # the full directory has one big CSV and, in a multi_csv folder, one per postcode area (..._BN.csv): the area's own file is far quicker
        area = [n for n in csvs if re.search(rf"_{re.escape(re.sub(r'[^A-Z]', '', prefix)[:2])}\.csv$", n, re.I)]
        pick = area or [n for n in csvs if "multi_csv" not in n.lower().replace("\\", "/")] or csvs
        handle = io.TextIOWrapper(zf.open(pick[0]), encoding="utf-8-sig", errors="replace")
    else:
        handle = open(tmp.name, encoding="utf-8-sig", errors="replace")
    reader = csv.DictReader(handle)
    cols = {c.lower(): c for c in (reader.fieldnames or [])}
    pc_col = cols.get("pcds") or cols.get("pcd") or cols.get("pcd2")
    if not pc_col:
        await patch_state("onspd", status="error", error="This file has no postcode column (pcds).")
        return {"loaded": 0}
    rows = []
    for rec in reader:
        pc = str(rec.get(pc_col) or "").upper().strip()
        if not pc.startswith(prefix) or rec.get(cols.get("doterm", ""), "x") not in ("", "x", None):
            continue  # postcodes that have been terminated carry a termination date
        rows.append({"postcode": pc, "district": pc.split(" ")[0],
                     "lat": float(rec.get(cols.get("lat", ""), "") or 0) or None, "lng": float(rec.get(cols.get("long", ""), "") or 0) or None,
                     "local_authority": rec.get(cols.get("oslaua", ""), "") or "", "ward": rec.get(cols.get("osward", ""), "") or "",
                     "region": rec.get(cols.get("rgn", ""), "") or "", "country": rec.get(cols.get("ctry", ""), "") or "", "loaded_from": url[-120:]})
    handle.close()
    async with AsyncSessionLocal() as s:
        await s.execute(text("DELETE FROM postcode_lookup WHERE postcode LIKE :p"), {"p": prefix + "%"})
        for i in range(0, len(rows), 2000):
            await s.execute(pg_insert(PostcodeLookup).values(rows[i:i + 2000]).on_conflict_do_nothing())
        await s.commit()
    await patch_state("onspd", status="idle", last_run_at=datetime.utcnow().isoformat() + "Z", seen=len(rows), kept=len(rows), error="")
    return {"loaded": len(rows)}
