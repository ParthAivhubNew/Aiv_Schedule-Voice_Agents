"""Builds the files an admin may download: companies, their people, and the Salesforce update file.

Every value comes through services/data_policy: a value from a view-only source (Google, Apollo) is never written, it is counted.
`preview` and the download run the same builder, so the number a person is shown before downloading is the number left out of the file.

Phones carry their TPS/CTPS flag. With the brand policy `screening.block_unscreened` a phone without a fresh clear result is left out too.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import select

from app.models.models import BusinessRecord, CompanyContactPoint, FsbImportRow, LeadAccount, PersonEmail, PhoneScreening
from app.services import call_permission as CPERM
from app.services import contact_points as CP
from app.services import data_access as DA
from app.services import data_policy as DP
from app.services.timezone_service import normalize_phone

MAX_ROWS = 50_000
MAX_IDS = 20_000
CHUNK = 500
CONTACT_FIELDS = ("phone", "website", "email")
OPEN_FIELDS = ("registration_number", "address", "postcode", "region", "industry", "contact_name", "contact_title")
ALL_FIELDS = ("registration_number", "address", "postcode", "region", "industry", "contact_name", "contact_title", "website", "phone", "email")
PERSON_FIELDS = ("title", "email", "phone")
BOM = b"\xef\xbb\xbf"


class ExportProblem(Exception):
    """A plain message for the person (the route answers 400 or 404 with it)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def safe_cell(value: Any) -> Any:
    """A cell can never run as a formula in a spreadsheet."""
    return "'" + value if isinstance(value, str) and value[:1] in ("=", "+", "-", "@") else value


def to_csv(rows: List[List[Any]]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    for r in rows:
        w.writerow([safe_cell(c) for c in r])
    return BOM + buf.getvalue().encode("utf-8")


def clean_fields(fields: Optional[List[str]], kind: str) -> List[str]:
    allowed = ALL_FIELDS if kind == "companies" else PERSON_FIELDS
    if not fields:
        return list(allowed)
    bad = [f for f in fields if f not in allowed]
    if bad:
        raise ExportProblem("These columns can't be exported: " + ", ".join(str(b) for b in bad[:5]) + ".")
    return [f for f in allowed if f in fields]


# -- phone screening ----------------------------------------------------------------
async def tps_map(db, numbers: Iterable[str]) -> Dict[str, str]:
    """{normalised number: clear | listed | ctps | unknown}. A result older than the re-screen window counts as unknown."""
    wanted = list({n for n in (normalize_phone(x) for x in numbers) if n})
    now = datetime.utcnow()
    out: Dict[str, str] = {n: "unknown" for n in wanted}
    for i in range(0, len(wanted), CHUNK):
        for row in (await db.execute(select(PhoneScreening).where(PhoneScreening.number.in_(wanted[i:i + CHUNK])))).scalars().all():
            if not CPERM._fresh(row, now):
                continue
            out[row.number] = "ctps" if row.ctps else ("listed" if row.tps_status == "listed" else "clear")
    return out


EXCLUDED_NOTICE = "Some companies are left out of this file because your organisation's exclusion list leaves them out."


class Tally:
    """What was left out of a file and why."""

    def __init__(self) -> None:
        self.fields = {f: 0 for f in CONTACT_FIELDS}
        self.sources: set = set()
        self.unscreened = 0  # exportable phones with no fresh result
        self.listed = 0  # exportable phones on TPS or CTPS
        self.screening_blocked = 0  # phones left out by the brand's screening rule
        self.outside = 0  # companies left out because they are outside the person's own areas
        self.excluded = 0  # companies left out because the organisation's own exclusion rules leave them out

    @property
    def withheld(self) -> int:
        return sum(self.fields.values())

    @property
    def restricted_count(self) -> int:
        return self.withheld - self.screening_blocked

    def preview(self, rows: int) -> Dict[str, Any]:
        return {"rows": rows, "withheld": self.withheld, "withheld_fields": dict(self.fields), "restricted_sources": sorted(self.sources),
                "popup": DP.EXPORT_POPUP if self.restricted_count > 0 else "", "unscreened_phones": self.unscreened, "listed_phones": self.listed,
                "screening_blocked": self.screening_blocked,
                "screening_note": ("Phone numbers without a clear TPS/CTPS result are left out of the file." if self.screening_blocked else ""),
                **({"access_notice": DA.OUTSIDE_NOTICE, "outside_areas": self.outside} if self.outside else {}),
                **({"excluded_by_rules": self.excluded, "excluded_notice": EXCLUDED_NOTICE} if self.excluded else {})}


def _restricted_source(obj: Any, record: Any, field: str, value: str) -> str:
    src = DP.source_of_value(getattr(obj, "field_sources", None), field)
    if DP.is_restricted(src):
        return DP._key(src)
    return DP.record_source(record if record is not None else obj, field, value, default="google_places")


# -- companies and people -------------------------------------------------------------
async def _accounts(db, scope: Dict[str, Any]) -> List[LeadAccount]:
    from app.api import lead_lists as L

    if scope.get("list_id"):
        lid = str(scope["list_id"])
        lists = await L._clean(db, await L._load(db))
        if lid == L.VIRTUAL_ID:
            lists = await L._with_unsorted(db, lists)
        hit = next((l for l in lists if l["id"] == lid), None)
        if not hit:
            raise ExportProblem("That list doesn't exist any more.", 404)
        ids = list(hit["ids"])
    else:
        ids = list(dict.fromkeys(str(i) for i in (scope.get("ids") or [])))
        if len(ids) > MAX_IDS:
            raise ExportProblem(f"Pick up to {MAX_IDS:,} companies at a time.")
    found: Dict[str, LeadAccount] = {}
    for i in range(0, len(ids), CHUNK):  # the organisation filter applies to this read, so another organisation's ids are simply not found
        for a in (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(ids[i:i + CHUNK])))).scalars().all():
            found[a.id] = a
    return [found[i] for i in ids if i in found]


async def _records(db, accounts: List[LeadAccount]) -> Dict[str, BusinessRecord]:
    want = list({a.business_record_id for a in accounts if a.business_record_id})
    out: Dict[str, BusinessRecord] = {}
    for i in range(0, len(want), CHUNK):
        for r in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(want[i:i + CHUNK])))).scalars().all():
            out[r.id] = r
    return out


def _contact_value(obj: Any, record: Any, field: str, tally: Tally, tps: Dict[str, str], block: bool) -> Tuple[str, str, str, int]:
    """(value, source, tps_status, left_out) for one phone, website or email of a saved company. value is "" when nothing may be written."""
    value = str(getattr(obj, field, "") or "").strip()
    if not value:
        return "", "", "", 0
    if field in DP.restricted_fields(obj, record):
        tally.fields[field] += 1
        tally.sources.add(_restricted_source(obj, record, field, value))
        return "", "", "", 1
    src = DP.source_of_value(getattr(obj, "field_sources", None), field) or "saved"
    status = ""
    if field == "phone":
        status = tps.get(normalize_phone(value), "unknown")
        if status == "unknown":
            tally.unscreened += 1
        elif status != "clear":
            tally.listed += 1
        if block and status != "clear":
            tally.fields["phone"] += 1
            tally.screening_blocked += 1
            return "", "", "", 1
    return value, src, status, 0


async def export_scope(db, operator_id: Optional[str] = None) -> DA.Scope:
    """The personal limits a file is built under. A job that runs later passes the operator id it was started by; with no person known at all
    the file is refused when anyone in the organisation has a personal limit (it could not be built safely)."""
    from app.core.tenancy import current_org, scope_operator

    if operator_id:
        return await DA.resolve(db, current_org(), operator_id)
    if scope_operator():
        return await DA.current_scope(db)
    if await DA.org_has_personal_limits(db, current_org()):
        raise DA.AccessDenied(403, "We couldn't tell who is asking for this file, so nothing was exported. Sign in again and try once more.", "outside_access")
    return DA.OPEN


async def build(db, kind: str, scope: Dict[str, Any], fields: Optional[List[str]], operator_id: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Tally, List[str]]:
    """The records of a file: [{"ids": {...}, "values": [(field, value, source, tps)], "left_out": n}], what was left out, and the columns.
    Companies outside the person's own areas are left out (and counted in tally.outside); the preview and the file take the same path."""
    from app.services import tenant_policy as TP

    cols = clean_fields(fields, kind)
    me = await export_scope(db, operator_id)
    accounts = await _accounts(db, scope)
    recs = await _records(db, accounts)
    tally = Tally()
    from app.services import org_rules

    left = await org_rules.excluded_record_ids(db, list(recs))  # the organisation's exclusion list applies to a file as it does to a search
    if left:
        kept = [a for a in accounts if a.business_record_id not in left]
        tally.excluded = len(accounts) - len(kept)
        accounts = kept
    if me.limited:
        kept = [a for a in accounts if DA.visible(me, a, *([recs[a.business_record_id]] if a.business_record_id in recs else []))]
        tally.outside = len(accounts) - len(kept)
        accounts = kept
    block = (await TP.effective(db)).block_unscreened
    phones: List[str] = []
    for a in accounts:
        phones.append(a.phone or "")
    tps = await tps_map(db, phones)
    out: List[Dict[str, Any]] = []
    people_by_key: Dict[Tuple[str, str], PersonEmail] = {}
    if kind == "people":
        bids = list({a.business_record_id for a in accounts if a.business_record_id})
        for i in range(0, len(bids), CHUNK):
            for pe in (await db.execute(select(PersonEmail).where(PersonEmail.business_id.in_(bids[i:i + CHUNK])))).scalars().all():
                people_by_key[(pe.business_id, pe.person_key)] = pe
    for a in accounts:
        rec = recs.get(a.business_record_id or "")
        if kind == "companies":
            values: List[Tuple[str, str, str, str]] = []
            left = 0
            for f in cols:
                if f in CONTACT_FIELDS:
                    v, src, st, gone = _contact_value(a, rec, f, tally, tps, block)
                    left += gone
                    if v:
                        values.append((f, v, src, st))
                else:
                    v = str(getattr(a, f, "") or "").strip()
                    src = "saved"
                    if not v and rec is not None and f in ("registration_number", "address", "postcode", "region", "industry"):
                        v, src = str(getattr(rec, f, "") or "").strip(), "register"
                    if v:
                        values.append((f, v, src, ""))
            out.append({"ids": {"company_id": a.id, "name": a.name}, "values": values, "left_out": left})
            continue
        # people: the saved contact, then the directors the register lists
        seen: set = set()
        base = {"company_id": a.id, "company_name": a.name}
        if (a.contact_name or "").strip():
            seen.add(" ".join(a.contact_name.lower().split()))
            values = []
            left = 0
            if "title" in cols and (a.contact_title or "").strip():
                values.append(("title", a.contact_title.strip(), "saved", ""))
            for f in ("email", "phone"):
                if f in cols:
                    v, src, st, gone = _contact_value(a, rec, f, tally, tps, block)
                    left += gone
                    if v:
                        values.append((f, v, src, st))
            out.append({"ids": {**base, "person": a.contact_name.strip()}, "values": values, "left_out": left})
        for o in (rec.officers if rec is not None and isinstance(rec.officers, list) else []):
            if not isinstance(o, dict) or o.get("resigned_on"):
                continue
            name = str(o.get("name") or "").strip()
            key = " ".join(name.lower().split())
            if not key or key in seen:
                continue
            seen.add(key)
            values, left = [], 0
            if "title" in cols and o.get("role"):
                values.append(("title", str(o["role"]), "register", ""))
            pe = people_by_key.get((rec.id, key))
            if pe is not None and "email" in cols:
                if DP.is_restricted(pe.source):
                    tally.fields["email"] += 1
                    tally.sources.add(DP._key(pe.source))
                    left += 1
                else:
                    values.append(("email", pe.email, "finder", ""))
            out.append({"ids": {**base, "person": name}, "values": values, "left_out": left})
    return out, tally, cols


def _wide_columns(kind: str, cols: List[str]) -> List[str]:
    head = ["company_id", "name"] if kind == "companies" else ["company_id", "company_name", "person"]
    body: List[str] = []
    for f in cols:
        body.append(f)
        if f == "phone":
            body.append("tps_status")
    return head + body + ["restricted_values_withheld"]


def render(kind: str, fmt: str, records: List[Dict[str, Any]], cols: List[str]) -> bytes:
    if fmt == "wide":
        header = _wide_columns(kind, cols)
        rows: List[List[Any]] = [header]
        for r in records:
            got = {f: (v, st) for f, v, _s, st in r["values"]}
            line: List[Any] = list(r["ids"].values())
            for f in cols:
                line.append(got.get(f, ("", ""))[0])
                if f == "phone":
                    line.append(got.get("phone", ("", ""))[1])
            rows.append(line + [r["left_out"]])
        return to_csv(rows)
    head = ["company_id", "name"] if kind == "companies" else ["company_id", "company_name", "person"]
    rows = [head + ["field", "value", "source", "tps_status", "restricted_values_withheld"]]
    for r in records:
        ids = list(r["ids"].values())
        if not r["values"]:
            rows.append(ids + ["", "", "", "", r["left_out"]])
        for f, v, src, st in r["values"]:
            rows.append(ids + [f, v, src, st, r["left_out"]])
    return to_csv(rows)


# -- the Salesforce update file ---------------------------------------------------------
SF_FIELDS = ("phone", "website", "email")
_OLD_EMAIL_KEYS = ("email", "e-mail", "email address")


def _same(field: str, a: str, b: str) -> bool:
    return CP.norm(field, a) == CP.norm(field, b)


def _label(rec: BusinessRecord, field: str, value: str) -> str:
    """"website" when the company's own site gave the value, else "register"; "" when the source is view-only or unknown."""
    src = DP.record_source(rec, field, value, default="")
    if not src or DP.is_restricted(src):
        return ""
    cw = (rec.raw_data or {}).get("contacts_web") or {}
    mine = {DP._norm("website", cw.get("website"))} | {DP._norm("phone", p.get("value") if isinstance(p, dict) else p) for p in cw.get("phones") or []}
    return "website" if DP._norm(field, value) in mine else "register"


async def salesforce(db, import_id: str, fields: Optional[List[str]], fmt: str, operator_id: Optional[str] = None) -> Tuple[List[List[Any]], Tally, int]:
    """(rows including the header, what was left out, how many import rows had a change). Companies outside the person's areas are left out."""
    from app.services import tenant_policy as TP

    me = await export_scope(db, operator_id)

    cols = [f for f in SF_FIELDS if not fields or f in fields]
    bad = [f for f in (fields or []) if f not in SF_FIELDS]
    if bad or not cols:
        raise ExportProblem("Pick from phone, website and email.")
    block = (await TP.effective(db)).block_unscreened
    imp_rows = (await db.execute(select(FsbImportRow).where(FsbImportRow.import_id == import_id, FsbImportRow.match_status.in_(("auto", "accepted")),
                                                           FsbImportRow.match_company_number != "").order_by(FsbImportRow.source_record_id))).scalars().all()
    numbers = list({r.match_company_number for r in imp_rows})
    recs: Dict[str, BusinessRecord] = {}
    for i in range(0, len(numbers), CHUNK):
        for r in (await db.execute(select(BusinessRecord).where(BusinessRecord.registration_number.in_(numbers[i:i + CHUNK])))).scalars().all():
            if r.registration_number not in recs or (r.rank_score or 0) > (recs[r.registration_number].rank_score or 0):
                recs[r.registration_number] = r
    accts: Dict[str, LeadAccount] = {}
    for i in range(0, len(numbers), CHUNK):
        for a in (await db.execute(select(LeadAccount).where(LeadAccount.registration_number.in_(numbers[i:i + CHUNK])))).scalars().all():
            accts.setdefault(a.registration_number, a)
    found_at: Dict[Tuple[str, str, str], datetime] = {}
    ids = [r.id for r in recs.values()]
    for i in range(0, len(ids), CHUNK):
        for p in (await db.execute(select(CompanyContactPoint).where(CompanyContactPoint.business_record_id.in_(ids[i:i + CHUNK])))).scalars().all():
            found_at[(p.business_record_id, p.kind, p.norm)] = p.found_at
    tally = Tally()
    if me.limited:
        for n in numbers:
            held = [x for x in (recs.get(n), accts.get(n)) if x is not None]
            if held and not DA.visible(me, *held):
                recs.pop(n, None)
                accts.pop(n, None)
                tally.outside += 1
    candidates = [recs[n].phone if n in recs else "" for n in numbers] + [(accts[n].phone if n in accts else "") for n in numbers]
    tps = await tps_map(db, candidates)
    long_rows: List[List[Any]] = []
    wide_rows: List[List[Any]] = []
    changed_rows = 0
    for r in imp_rows:
        rec, acc = recs.get(r.match_company_number), accts.get(r.match_company_number)
        if rec is None and acc is None:
            continue
        old = {"phone": r.phone or "", "website": r.website or "",
               "email": next((str(v) for k, v in (r.raw or {}).items() if str(k).strip().lower() in _OLD_EMAIL_KEYS and str(v).strip()), "")}
        got: Dict[str, Tuple[str, str, str, str]] = {}  # field -> new, source, date, tps
        for f in cols:
            new, src, when = "", "", ""
            if acc is not None and str(getattr(acc, f, "") or "").strip() and f not in DP.restricted_fields(acc, rec):
                new = str(getattr(acc, f)).strip()
                src = DP.source_of_value(acc.field_sources, f) or "saved"
                when = acc.updated_at.date().isoformat() if acc.updated_at else ""
            elif rec is not None and str(getattr(rec, f, "") or "").strip():
                val = str(getattr(rec, f)).strip()
                label = _label(rec, f, val)
                if label:
                    new, src = val, label
                    at = found_at.get((rec.id, f, CP.norm(f, val))) or rec.updated_at
                    when = at.date().isoformat() if at else ""
            if not new:
                # something exists for this company but is view-only: count it, never write it
                held = [o for o in (acc, rec) if o is not None and str(getattr(o, f, "") or "").strip()]
                if held and (not old[f] or not _same(f, old[f], str(getattr(held[0], f)))):
                    tally.fields[f] += 1
                    tally.sources.add(_restricted_source(held[0], rec, f, str(getattr(held[0], f))))
                continue
            if old[f] and _same(f, old[f], new):
                continue
            status = ""
            if f == "phone":
                status = tps.get(normalize_phone(new), "unknown")
                if status == "unknown":
                    tally.unscreened += 1
                elif status != "clear":
                    tally.listed += 1
                if block and status != "clear":
                    tally.fields["phone"] += 1
                    tally.screening_blocked += 1
                    continue
            got[f] = (new, src, when, status)
        if not got:
            continue
        changed_rows += 1
        conf = "" if r.score is None else r.score
        if fmt == "wide":
            wide_rows.append([r.source_record_id] + [got.get(f, ("",))[0] for f in SF_FIELDS] + [got.get("phone", ("", "", "", ""))[3]]
                             + [got.get(f, ("", ""))[1] for f in SF_FIELDS] + [max((v[2] for v in got.values()), default=""), conf])
        else:
            for f in SF_FIELDS:
                if f in got:
                    new, src, when, status = got[f]
                    long_rows.append([r.source_record_id, f, old[f], new, src, when, conf, status])
    if fmt == "wide":
        head = ["salesforce_id", "new_phone", "new_website", "new_email", "tps_status", "phone_source", "website_source", "email_source", "date_found", "confidence"]
        return [head] + wide_rows, tally, changed_rows
    head = ["salesforce_id", "field", "old_value", "new_value", "source", "date_found", "confidence", "tps_status"]
    return [head] + long_rows, tally, changed_rows
