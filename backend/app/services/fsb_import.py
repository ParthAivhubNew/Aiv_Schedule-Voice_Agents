"""The FSB import: read a Salesforce Account export, match every row to the Companies House data we hold, and keep what a person has to decide.

The file is saved first (status "uploaded"), then a background job matches it in batches and writes progress into the import's `stats`. A restart
leaves the import "matching"; recover_after_restart() picks it up again and only the rows still "pending" are done. Matching reads business_records
directly and never applies the prospect exclusions: FSB's own records, charities included, must still match and be followed.
"""
from __future__ import annotations

import csv
import io
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AppSetting, BusinessRecord, FsbImport, FsbImportRow
from app.services import audit
from app.services import fsb_matching as M

logger = logging.getLogger("fsb_import")

MAX_ROWS = 100_000
MAX_BYTES = 40 * 1024 * 1024
BATCH = 1000
CHUNK = 2000
DISTRICT_CACHE = 40
STATUSES = ("pending", "auto", "review", "none", "accepted", "rejected", "duplicate")

# header (lower case, letters and digits only) -> field
_HEADERS = {
    "accountid": "source_record_id", "id": "source_record_id", "recordid": "source_record_id", "sourcerecordid": "source_record_id",
    "accountname": "name", "name": "name", "companyname": "name",
    "companynumber": "company_number", "companyregistrationnumber": "company_number", "registrationnumber": "company_number",
    "companieshousenumber": "company_number", "companyno": "company_number",
    "billingstreet": "street", "street": "street", "address": "street",
    "billingcity": "city", "city": "city", "town": "city",
    "billingpostalcode": "postcode", "billingpostcode": "postcode", "postalcode": "postcode", "postcode": "postcode", "zip": "postcode",
    "phone": "phone", "telephone": "phone", "website": "website", "url": "website",
}
REQUIRED = {"source_record_id": "Account ID", "name": "Account Name"}


class UploadProblem(ValueError):
    """The upload cannot be used; the message is shown to the person."""


def _field(header: str) -> str:
    return _HEADERS.get(re.sub(r"[^a-z0-9]", "", str(header or "").lower()), "")


def _row_from(raw: Dict[str, Any]) -> Dict[str, Any]:
    vals: Dict[str, str] = {}
    for k, v in raw.items():
        f = _field(k)
        text = str(v if v is not None else "").strip()
        if f and text and f not in vals:
            vals[f] = text
    address = ", ".join(p for p in (vals.get("street", "").replace("\r", " ").replace("\n", ", "), vals.get("city", "")) if p)
    return {"source_record_id": vals.get("source_record_id", "")[:80], "name": vals.get("name", "")[:300],
            "company_number_given": vals.get("company_number", "")[:40], "postcode": vals.get("postcode", "")[:20], "address": address[:400],
            "phone": vals.get("phone", "")[:60], "website": vals.get("website", "")[:300],
            "raw": {str(k)[:60]: str(v if v is not None else "")[:500] for k, v in list(raw.items())[:60]}}


def _check_columns(headers: List[str]) -> None:
    have = {_field(h) for h in headers}
    missing = [label for f, label in REQUIRED.items() if f not in have]
    if missing:
        raise UploadProblem("The file needs these columns: " + ", ".join(missing) + ". Expected: Account ID, Account Name, Company Number, "
                           "Billing Street, Billing City, Billing Postal Code, Phone, Website.")


def _finish(rows: List[Dict[str, Any]], dropped: int) -> Tuple[List[Dict[str, Any]], int]:
    if len(rows) > MAX_ROWS:
        raise UploadProblem(f"That file has {len(rows):,} rows. The most one import can take is {MAX_ROWS:,}.")
    if not rows:
        raise UploadProblem("No rows found in that file.")
    return rows, dropped


def parse_csv(data: bytes) -> Tuple[List[Dict[str, Any]], int]:
    """(rows, rows skipped for having neither an Account ID nor a name). Raises UploadProblem for a file that cannot be used."""
    if len(data) > MAX_BYTES:
        raise UploadProblem("That file is too large. Split it and upload the parts one at a time.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1252", errors="replace")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text, newline=""), dialect=dialect)
    if not reader.fieldnames:
        raise UploadProblem("That file is empty.")
    _check_columns(list(reader.fieldnames))
    rows, dropped = [], 0
    for raw in reader:
        row = _row_from({k: v for k, v in raw.items() if k is not None})
        if not row["source_record_id"] and not row["name"]:
            dropped += 1
            continue
        rows.append(row)
        if len(rows) > MAX_ROWS:
            break
    return _finish(rows, dropped)


def parse_json_rows(items: Any) -> Tuple[List[Dict[str, Any]], int]:
    if not isinstance(items, list) or not items:
        raise UploadProblem("Send the rows as a list.")
    if len(items) > MAX_ROWS:
        raise UploadProblem(f"That is {len(items):,} rows. The most one import can take is {MAX_ROWS:,}.")
    if not all(isinstance(i, dict) for i in items):
        raise UploadProblem("Each row must be an object with the Account ID and Account Name.")
    _check_columns(list({k for i in items[:200] for k in i.keys()}))
    rows, dropped = [], 0
    for raw in items:
        row = _row_from(raw)
        if not row["source_record_id"] and not row["name"]:
            dropped += 1
            continue
        rows.append(row)
    return _finish(rows, dropped)


# ---------- thresholds, one document per organisation ----------

def _key(org: str) -> str:
    return f"fsb_thresholds:{org}"


async def get_thresholds(db: AsyncSession, org: str) -> Dict[str, float]:
    row = await db.get(AppSetting, _key(org))
    d = dict(row.data or {}) if row else {}
    try:
        return M.clean_thresholds(d.get("auto", M.DEFAULTS["auto"]), d.get("review", M.DEFAULTS["review"]))
    except ValueError:
        return dict(M.DEFAULTS)


async def set_thresholds(db: AsyncSession, org: str, auto: Any, review: Any) -> Dict[str, float]:
    th = M.clean_thresholds(auto, review)
    row = await db.get(AppSetting, _key(org))
    if row:
        row.data = dict(th)
    else:
        db.add(AppSetting(id=_key(org), data=dict(th)))
    await db.flush()
    return th


# ---------- creating an import ----------

async def create_import(db: AsyncSession, rows: List[Dict[str, Any]], *, filename: str, user_id: str, dropped: int = 0) -> FsbImport:
    """Saves the import and its rows (file order is kept in the row ids). The caller commits, then starts the job."""
    imp = FsbImport(filename=(filename or "upload.csv")[:200], status="uploaded", row_count=len(rows), created_by=str(user_id or "")[:80],
                    stats={"total": len(rows), "processed": 0, "skipped_blank": dropped})
    db.add(imp)
    await db.flush()
    prefix = f"fsr_{uuid.uuid4().hex[:10]}_"
    for start in range(0, len(rows), CHUNK):
        await db.execute(insert(FsbImportRow), [{**r, "id": f"{prefix}{start + i:06d}", "import_id": imp.id, "match_status": "pending"}
                                               for i, r in enumerate(rows[start:start + CHUNK])])
    return imp


async def counts(db: AsyncSession, import_id: str) -> Dict[str, int]:
    got = {s: n for s, n in (await db.execute(select(FsbImportRow.match_status, func.count()).where(FsbImportRow.import_id == import_id)
                                              .group_by(FsbImportRow.match_status))).all()}
    return {s: int(got.get(s, 0)) for s in STATUSES}


async def refresh_counts(db: AsyncSession, imp: FsbImport) -> Dict[str, int]:
    c = await counts(db, imp.id)
    imp.stats = {**(imp.stats or {}), "counts": c}
    return c


# ---------- the background job ----------

async def _register_for(db: AsyncSession, numbers: set, postcodes: set) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, List[Dict[str, Any]]]]:
    by_number: Dict[str, Dict[str, Any]] = {}
    by_pc: Dict[str, List[Dict[str, Any]]] = {}
    B = BusinessRecord
    if numbers:
        for n, name, pc in (await db.execute(select(B.registration_number, B.name, B.postcode).where(B.registration_number.in_(list(numbers))))).all():
            by_number[n] = {"name": name or "", "postcode": pc or ""}
    if postcodes:
        forms = set(postcodes) | {p.replace(" ", "") for p in postcodes}  # held as "BN1 4AB", but a source may have stored "BN14AB"
        q = select(B.registration_number, B.name, B.postcode).where(B.postcode.in_(list(forms)), B.registration_number != "")
        for n, name, pc in (await db.execute(q)).all():
            by_pc.setdefault(M.norm_postcode(pc), []).append({"company_number": n, "name": name or "", "postcode": pc})
    return by_number, by_pc


async def _district_rows(db: AsyncSession, d: str) -> List[Dict[str, Any]]:
    B = BusinessRecord
    q = select(B.registration_number, B.name, B.postcode).where(B.postcode.like(f"{d} %"), B.registration_number != "")
    return [{"company_number": n, "name": name or "", "postcode": pc} for n, name, pc in (await db.execute(q)).all()]


def _match_batch(batch: List[FsbImportRow], by_number, by_pc, districts: Dict[str, List[Dict[str, Any]]], th) -> Tuple[Dict[str, Dict[str, Any]], set]:
    """One pass over the batch. Rows that needed a district we have not read yet are left out and the districts returned."""
    out: Dict[str, Dict[str, Any]] = {}
    need: set = set()
    for r in batch:
        wanted: List[str] = []

        def by_district(d: str, wanted=wanted) -> List[Dict[str, Any]]:
            if d not in districts:
                wanted.append(d)
                return []
            return districts[d]

        res = M.match_row({"name": r.name, "company_number": r.company_number_given, "postcode": r.postcode}, by_number=by_number,
                          by_postcode=lambda pc: by_pc.get(pc, []), by_district=by_district, th=th)
        if wanted:
            need.update(wanted)
            continue
        out[r.id] = res
    return out, need


async def _mark_duplicates(db: AsyncSession, import_id: str) -> Dict[str, int]:
    rows = (await db.execute(select(FsbImportRow.id, FsbImportRow.source_record_id, FsbImportRow.name, FsbImportRow.company_number_given, FsbImportRow.postcode)
                             .where(FsbImportRow.import_id == import_id).order_by(FsbImportRow.id))).all()
    exact, near = M.find_duplicates([{"id": i, "source_record_id": s, "name": n, "company_number": c, "postcode": p} for i, s, n, c, p in rows])
    items = [{"id": rid, "match_status": "duplicate", "duplicate_of": of, "reason": why} for rid, (of, why) in exact.items()]
    items += [{"id": rid, "duplicate_of": of, "reason": why} for rid, (of, why) in near.items()]
    for start in range(0, len(items), CHUNK):
        for kind in ("dup", "near"):
            part = [i for i in items[start:start + CHUNK] if ("match_status" in i) == (kind == "dup")]
            if part:
                await db.execute(update(FsbImportRow), part)
    return {"exact": len(exact), "near": len(near)}


async def run_matching(org: str, import_id: str) -> None:
    """Matches every pending row of one import. Safe to run again after a restart: duplicates are marked once, then only "pending" rows are done."""
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal

    with org_scope(org):
        try:
            async with AsyncSessionLocal() as db:
                imp = await db.get(FsbImport, import_id)
                if not imp or imp.status not in ("uploaded", "matching"):
                    return
                imp.status = "matching"
                stats = dict(imp.stats or {})
                th = await get_thresholds(db, org)
                if not stats.get("dups_done"):
                    stats["duplicates"] = await _mark_duplicates(db, import_id)
                    stats["dups_done"] = True
                stats["thresholds"] = th
                imp.stats = stats
                await db.commit()
            districts: Dict[str, List[Dict[str, Any]]] = {}
            while True:
                async with AsyncSessionLocal() as db:
                    batch = (await db.execute(select(FsbImportRow).where(FsbImportRow.import_id == import_id, FsbImportRow.match_status == "pending")
                                              .order_by(FsbImportRow.id).limit(BATCH))).scalars().all()
                    if not batch:
                        break
                    numbers = {M.norm_number(r.company_number_given) for r in batch} - {""}
                    pcs = {M.norm_postcode(r.postcode) for r in batch} - {""}
                    by_number, by_pc = await _register_for(db, numbers, pcs)
                    done, need = _match_batch(batch, by_number, by_pc, districts, th)
                    if need:
                        if len(districts) + len(need) > DISTRICT_CACHE:
                            districts.clear()
                        for d in need:
                            districts[d] = await _district_rows(db, d)
                        again, _ = _match_batch([r for r in batch if r.id not in done], by_number, by_pc, districts, th)
                        done.update(again)
                    updates = []
                    for r in batch:
                        res = done[r.id]
                        status, reason = res["match_status"], res["reason"]
                        if r.duplicate_of and status != "review":  # a look-alike of an earlier row: a person decides, whatever the match says
                            status, reason = "review", f"{r.reason} {reason}".strip()
                        updates.append({"id": r.id, "match_status": status, "match_company_number": res["company_number"], "match_name": res["name"],
                                        "score": res["score"], "reason": reason[:500], "candidates": res["candidates"]})
                    await db.execute(update(FsbImportRow), updates)
                    imp = await db.get(FsbImport, import_id)
                    imp.stats = {**(imp.stats or {}), "processed": int((imp.stats or {}).get("processed", 0)) + len(batch)}
                    await db.commit()
            async with AsyncSessionLocal() as db:
                imp = await db.get(FsbImport, import_id)
                await refresh_counts(db, imp)
                imp.stats = {**(imp.stats or {}), "processed": imp.row_count}
                imp.status, imp.finished_at = "done", datetime.utcnow()
                await db.commit()
        except Exception as err:
            logger.warning(f"[fsb] import {import_id} failed: {err}")
            try:
                from app.core.brand import scrub

                async with AsyncSessionLocal() as db:
                    imp = await db.get(FsbImport, import_id)
                    if imp:
                        imp.status, imp.error, imp.finished_at = "failed", scrub(str(err))[:500], datetime.utcnow()
                        await db.commit()
            except Exception as err2:
                logger.warning(f"[fsb] could not record the failure of {import_id}: {err2}")


async def recover_after_restart() -> int:
    """An import that was matching when the server stopped carries on from its pending rows (also one saved but never started)."""
    from sqlalchemy import select as _select

    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services.data_sources import spawn

    n = 0
    with system_scope():
        async with AsyncSessionLocal() as db:
            for imp in (await db.execute(_select(FsbImport).where(FsbImport.status.in_(("matching", "uploaded"))))).scalars().all():
                n += 1
                spawn(run_matching(imp.org_id, imp.id))
    return n


# ---------- the review queue ----------

class DecisionError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code, self.message = status_code, message


async def register_facts(db: AsyncSession, numbers: List[str]) -> Dict[str, Dict[str, Any]]:
    nums = [n for n in dict.fromkeys(numbers) if n]
    if not nums:
        return {}
    B = BusinessRecord
    out: Dict[str, Dict[str, Any]] = {}
    for n, name, addr, pc, status, sic in (await db.execute(select(B.registration_number, B.name, B.address, B.postcode, B.status, B.sic_text)
                                                           .where(B.registration_number.in_(nums)))).all():
        out[n] = {"company_number": n, "name": name or "", "address": addr or "", "postcode": pc or "", "status": status or "", "sic_text": sic or ""}
    return out


def _decision_label(decision: str) -> str:
    return {"accept": "accepted", "reject": "rejected", "pick": "picked"}[decision]


async def decide(db: AsyncSession, row_id: str, decision: str, company_number: str, *, actor_id: str, actor_name: str) -> Tuple[FsbImportRow, bool]:
    """Applies a person's decision to a row in the queue. Returns (row, changed). The caller commits."""
    if decision not in ("accept", "reject", "pick"):
        raise DecisionError(400, "The decision must be accept, reject or pick.")
    row = (await db.execute(select(FsbImportRow).where(FsbImportRow.id == row_id).with_for_update())).scalars().first()
    if not row:
        raise DecisionError(404, "That record is not in your review queue.")
    cands = [c.get("company_number") for c in (row.candidates or []) if c.get("company_number")]
    target = ""
    if decision == "accept":
        if not cands:
            raise DecisionError(400, "There is no suggested company to accept. Pick one or reject.")
        target = cands[0]
    elif decision == "pick":
        target = M.norm_number(company_number)
        if not target:
            raise DecisionError(400, "Say which company number to pick.")
        if target not in await register_facts(db, [target]):
            raise DecisionError(400, f"{target} is not a company we hold.")
    outcome = "rejected" if decision == "reject" else "accepted"
    if row.match_status not in ("review", "accepted", "rejected"):
        raise DecisionError(409, "That record is not waiting for a decision.")
    same = row.match_status == outcome and (decision == "reject" or row.match_company_number == target)
    if row.match_status in ("accepted", "rejected"):
        if same:
            return row, False  # the same answer again: nothing to change, nothing new to record
        if row.decided_by and row.decided_by != actor_id:
            raise DecisionError(409, "Someone else has already decided this record.")
    facts = (await register_facts(db, [target])).get(target, {}) if target else {}
    row.match_status = outcome
    row.match_company_number = target if outcome == "accepted" else ""
    row.match_name = facts.get("name", "") if outcome == "accepted" else ""
    if outcome == "accepted":
        row.score = next((c.get("score") for c in (row.candidates or []) if c.get("company_number") == target), row.score)
    row.decided_by, row.decided_at = actor_id, datetime.utcnow()
    await db.flush()
    imp = await db.get(FsbImport, row.import_id)
    if imp:
        await refresh_counts(db, imp)
    await audit.record(db, f"review.{_decision_label(decision)}", target=row.source_record_id or row.id,
                       detail={"import": row.import_id, "row": row.id, "company_number": row.match_company_number, "name": row.name},
                       actor_id=actor_id, actor_name=actor_name)
    return row, True


# ---------- the duplicates file ----------

def csv_safe(value: Any) -> str:
    """A cell that a spreadsheet will show as text, never run as a formula."""
    s = "" if value is None else str(value)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


async def duplicates_csv(db: AsyncSession, import_id: str) -> str:
    rows = (await db.execute(select(FsbImportRow).where(FsbImportRow.import_id == import_id, FsbImportRow.duplicate_of.is_not(None))
                             .order_by(FsbImportRow.id))).scalars().all()
    firsts = {r.id: r for r in (await db.execute(select(FsbImportRow).where(FsbImportRow.id.in_([r.duplicate_of for r in rows] or [""])))).scalars().all()}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["kind", "account_id", "account_name", "company_number", "postcode", "repeats_account_id", "repeats_account_name", "reason"])
    for r in rows:
        first = firsts.get(r.duplicate_of)
        w.writerow([csv_safe(v) for v in ("exact" if r.match_status == "duplicate" else "similar", r.source_record_id, r.name, r.company_number_given, r.postcode,
                                          first.source_record_id if first else "", first.name if first else "", r.reason)])
    return buf.getvalue()
