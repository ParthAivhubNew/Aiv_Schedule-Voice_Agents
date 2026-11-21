"""The monthly change report: every change the official registers reported, in a period, for the companies an organisation follows.

Followed = companies matched from an FSB import (match_status auto or accepted) and companies in the organisation's saved lead accounts (which
is what the saved lists hold). The report never goes through prospect search, so the brand exclusions do not hide FSB's own records.
Only the counts are stored; the rows are rebuilt from registry_events when the file is downloaded.
"""
from __future__ import annotations

import asyncio
import calendar
import csv
import io
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select

from app.models.models import BusinessRecord, ChangeReport, FsbImportRow, LeadAccount, RegistryEvent
from app.services.fsb_import import csv_safe
from app.services.fsb_matching import norm_number

logger = logging.getLogger("change_report")

COLUMNS = ["company_number", "company_name", "change", "field", "old_value", "new_value", "source", "date", "link", "fsb_record_id"]
KIND_LABELS = {"status_changed": "status changed", "name_changed": "name changed", "address_changed": "address changed",
               "new_company": "new company", "officer_appointed": "officer appointed", "officer_resigned": "officer resigned",
               "gazette_notice": "Gazette notice"}
CHUNK = 5000


async def followed(db, org: str) -> Dict[str, List[str]]:
    """{company number: [FSB record ids]} for every company the organisation follows (the ids list is empty for a company that is only a saved lead)."""
    out: Dict[str, List[str]] = {}
    q = select(FsbImportRow.match_company_number, FsbImportRow.source_record_id).where(
        FsbImportRow.org_id == org, FsbImportRow.match_status.in_(("auto", "accepted")), FsbImportRow.match_company_number != "")
    for num, rid in (await db.execute(q)).all():
        ids = out.setdefault(norm_number(num), [])
        if rid and rid not in ids:
            ids.append(rid)
    for num in (await db.execute(select(LeadAccount.registration_number).where(LeadAccount.org_id == org, LeadAccount.registration_number != ""))).scalars().all():
        out.setdefault(norm_number(num), [])
    linked = select(BusinessRecord.registration_number).join(LeadAccount, LeadAccount.business_record_id == BusinessRecord.id).where(
        LeadAccount.org_id == org, BusinessRecord.registration_number != "")
    for num in (await db.execute(linked)).scalars().all():
        out.setdefault(norm_number(num), [])
    out.pop("", None)
    return out


def _day(d: Any) -> date:
    return d.date() if isinstance(d, datetime) else d


async def build_rows(db, org: str, start: Any, end: Any) -> List[Dict[str, Any]]:
    """Every registry event from `start` to `end` (both days included) for the followed companies, oldest first, each with FSB's record id."""
    s, e = _day(start), _day(end)
    lo, hi = datetime(s.year, s.month, s.day), datetime(e.year, e.month, e.day) + timedelta(days=1)
    follow = await followed(db, org)
    nums = list(follow)
    rows: List[Dict[str, Any]] = []
    for i in range(0, len(nums), CHUNK):
        q = select(RegistryEvent).where(RegistryEvent.company_number.in_(nums[i:i + CHUNK]), RegistryEvent.event_date >= lo,
                                        RegistryEvent.event_date < hi)
        for ev in (await db.execute(q)).scalars().all():
            rows.append({"company_number": ev.company_number, "company_name": ev.company_name or "", "change": ev.kind or "", "field": ev.field or "",
                         "old_value": ev.old_value or "", "new_value": ev.new_value or "", "source": ev.source or "",
                         "date": ev.event_date.strftime("%Y-%m-%d") if ev.event_date else "", "link": ev.link or "",
                         "fsb_record_id": ";".join(follow.get(norm_number(ev.company_number), []))})
    rows.sort(key=lambda r: (r["date"], r["company_number"], r["change"], r["field"]))
    return rows


def summarise(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_kind: Dict[str, int] = {}
    for r in rows:
        by_kind[r["change"]] = by_kind.get(r["change"], 0) + 1
    companies = len({r["company_number"] for r in rows})
    if not rows:
        text = "No changes in this period."
    else:
        parts = [f"{n} {KIND_LABELS.get(k, k.replace('_', ' '))}" for k, n in sorted(by_kind.items(), key=lambda kv: (-kv[1], kv[0]))]
        text = f"{len(rows)} change{'s' if len(rows) != 1 else ''} at {companies} compan{'ies' if companies != 1 else 'y'}: " + ", ".join(parts) + "."
    return {"by_kind": by_kind, "companies": companies, "total": len(rows), "text": text}


def rows_csv(rows: List[Dict[str, Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(COLUMNS)
    for r in rows:
        w.writerow([csv_safe(r[c]) for c in COLUMNS])
    return buf.getvalue()


def period_for(start: date, end: date) -> str:
    """"YYYY-MM" when the range is exactly one calendar month, else the range itself."""
    if start.day == 1 and start.year == end.year and start.month == end.month and end.day == calendar.monthrange(end.year, end.month)[1]:
        return f"{start:%Y-%m}"
    return f"{start.isoformat()}..{end.isoformat()}"


def previous_month(today: date) -> Tuple[date, date]:
    last = today.replace(day=1) - timedelta(days=1)
    return last.replace(day=1), last


def report_dict(rep: ChangeReport) -> Dict[str, Any]:
    return {"id": rep.id, "period": rep.period, "row_count": rep.row_count, "summary": rep.summary or {},
            "created_at": rep.created_at.isoformat() + "Z" if rep.created_at else None}


async def run_report(db, org: str, start: date, end: date) -> Tuple[ChangeReport, bool]:
    """Builds the report for the range and saves it, replacing the one already saved for the same period. Returns (report, created). The caller commits."""
    rows = await build_rows(db, org, start, end)
    summary = {**summarise(rows), "start": start.isoformat(), "end": end.isoformat()}
    period = period_for(start, end)
    rep = (await db.execute(select(ChangeReport).where(ChangeReport.org_id == org, ChangeReport.period == period))).scalars().first()
    created = rep is None
    if created:
        rep = ChangeReport(period=period, summary=summary, row_count=len(rows))
        db.add(rep)
    else:
        rep.summary, rep.row_count, rep.created_at = summary, len(rows), datetime.utcnow()
    await db.flush()
    return rep, created


# ---------- the monthly loop ----------

async def organisations_with_imports() -> List[str]:
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import FsbImport

    with system_scope():
        async with AsyncSessionLocal() as db:
            return list((await db.execute(select(FsbImport.org_id).distinct())).scalars().all())


async def run_monthly(today: Optional[date] = None) -> int:
    """Makes last month's report for every organisation that has an import and does not have it yet. Returns how many were made.
    Safe to call as often as wanted: the (organisation, period) pair is unique, so a restart or a second server never duplicates a month."""
    from sqlalchemy.exc import IntegrityError

    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal

    start, end = previous_month(today or datetime.utcnow().date())
    period = period_for(start, end)
    made = 0
    for org in await organisations_with_imports():
        try:
            with org_scope(org):
                async with AsyncSessionLocal() as db:
                    have = (await db.execute(select(ChangeReport.id).where(ChangeReport.org_id == org, ChangeReport.period == period))).first()
                    if have:
                        continue
                    await run_report(db, org, start, end)
                    await db.commit()
                    made += 1
        except IntegrityError:
            continue  # another server made it first
        except Exception as err:
            logger.warning(f"[changes] could not build {period} for {org}: {err}")
    return made


async def monthly_loop() -> None:
    """Checks every hour: last month's report once it is missing (the 1st of the month, or later if the server was down), and the registry feed's health."""
    from app.services import registry_health

    await asyncio.sleep(90)
    while True:
        try:
            await run_monthly()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.warning(f"[changes] monthly run failed: {err}")
        try:
            await registry_health.alert_if_unhealthy()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.warning(f"[changes] registry health check failed: {err}")
        await asyncio.sleep(3600)
