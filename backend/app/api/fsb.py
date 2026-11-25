"""FSB: import a Salesforce Account export, review the uncertain matches, and download the monthly change report. Admins and managers only.

POST /fsb/imports                          upload a CSV (multipart, field "file") or JSON {"filename", "rows": [...]}; matching starts in the background
GET  /fsb/imports                          the imports, newest first
GET  /fsb/imports/{id}                     status, progress and counts by match_status
GET  /fsb/imports/{id}/rows                rows, filter ?status=, ?limit= ?offset=
GET  /fsb/imports/{id}/duplicates.csv      the duplicates found in the file
GET/PUT /fsb/settings                      the matching thresholds (PUT: admins only)
GET  /review-queue                         rows waiting for a person, with the suggested company
POST /review-queue/{row_id}/decision       accept, reject or pick
GET  /change-reports                       the reports and their counts
POST /change-reports/run                   build or refresh a report for {"start", "end"}
GET  /change-reports/{id}/rows.csv         the changes as a file
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.core.tenancy import current_org
from app.database import get_db
from app.models.models import ChangeReport, FsbImport, FsbImportRow
from app.services import audit, change_report as CR
from app.services import fsb_import as FI

router = APIRouter(tags=["FSB"])


def _who(request: Request, admin_only: bool = False) -> Dict[str, Any]:
    """The signed-in user, who must be an admin (or a manager, unless admin_only)."""
    ctx = current(request)
    ok = bool(ctx.get("is_admin")) or (not admin_only and "Manager" in (ctx.get("roles") or []))
    if not ok:
        raise HTTPException(status_code=403, detail="Only administrators and managers can do this." if not admin_only else "Only administrators can do this.")
    return ctx


def _name(ctx: Dict[str, Any]) -> str:
    return str(ctx.get("name") or ctx.get("username") or ctx.get("email") or "")


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() + "Z" if d else None


def _import_dict(imp: FsbImport, counts: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    stats = dict(imp.stats or {})
    stats.pop("dups_done", None)
    out = {"id": imp.id, "filename": imp.filename, "status": imp.status, "row_count": imp.row_count, "stats": stats, "created_by": imp.created_by,
           "created_at": _iso(imp.created_at), "finished_at": _iso(imp.finished_at), "error": imp.error or ""}
    if counts is not None:
        out["counts"] = counts
    return out


def _row_dict(r: FsbImportRow) -> Dict[str, Any]:
    return {"id": r.id, "import_id": r.import_id, "record_id": r.source_record_id, "name": r.name, "company_number_given": r.company_number_given,
            "postcode": r.postcode, "address": r.address, "phone": r.phone, "website": r.website, "match_status": r.match_status,
            "match_company_number": r.match_company_number, "match_name": r.match_name, "score": r.score, "reason": r.reason,
            "candidates": r.candidates or [], "duplicate_of": r.duplicate_of, "decided_by": r.decided_by, "decided_at": _iso(r.decided_at)}


async def _get_import(db: AsyncSession, import_id: str) -> FsbImport:
    imp = await db.get(FsbImport, import_id)
    if not imp:
        raise HTTPException(status_code=404, detail="Import not found.")
    return imp


# ---------- imports ----------

@router.post("/fsb/imports")
async def upload(request: Request, db: AsyncSession = Depends(get_db)):
    from app.services.data_sources import spawn

    ctx = _who(request)
    ctype = (request.headers.get("content-type") or "").lower()
    try:
        if ctype.startswith("multipart/"):
            form = await request.form()
            f = form.get("file")
            if f is None or not hasattr(f, "read"):
                raise HTTPException(status_code=400, detail="Attach the CSV file in a field called file.")
            filename = getattr(f, "filename", "") or "upload.csv"
            rows, dropped = FI.parse_csv(await f.read())
        else:
            body = await request.json()
            filename = str((body or {}).get("filename") or "upload.json") if isinstance(body, dict) else "upload.json"
            rows, dropped = FI.parse_json_rows((body or {}).get("rows") if isinstance(body, dict) else None)
    except FI.UploadProblem as err:
        raise HTTPException(status_code=400, detail=str(err))
    except ValueError:
        raise HTTPException(status_code=400, detail="That request could not be read.")
    imp = await FI.create_import(db, rows, filename=filename, user_id=ctx.get("operator_id") or "", dropped=dropped)
    await audit.record(db, "fsb.import_uploaded", target=imp.id, detail={"filename": imp.filename, "rows": imp.row_count},
                       actor_id=ctx.get("operator_id") or "", actor_name=_name(ctx))
    await db.commit()
    spawn(FI.run_matching(current_org(), imp.id))
    return {**_import_dict(imp), "skipped_blank": dropped}


@router.get("/fsb/imports")
async def list_imports(request: Request, db: AsyncSession = Depends(get_db)):
    _who(request)
    rows = (await db.execute(select(FsbImport).order_by(FsbImport.created_at.desc()).limit(200))).scalars().all()
    return {"imports": [_import_dict(i) for i in rows]}


@router.get("/fsb/imports/{import_id}")
async def get_import(import_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    _who(request)
    imp = await _get_import(db, import_id)
    return _import_dict(imp, await FI.counts(db, import_id))


@router.get("/fsb/imports/{import_id}/rows")
async def import_rows(import_id: str, request: Request, status: str = "", limit: int = 100, offset: int = 0, db: AsyncSession = Depends(get_db)):
    _who(request)
    await _get_import(db, import_id)
    if status and status not in FI.STATUSES:
        raise HTTPException(status_code=400, detail="Unknown status.")
    cond = [FsbImportRow.import_id == import_id] + ([FsbImportRow.match_status == status] if status else [])
    total = (await db.execute(select(func.count()).select_from(FsbImportRow).where(*cond))).scalar() or 0
    limit = min(max(limit, 1), 500)
    rows = (await db.execute(select(FsbImportRow).where(*cond).order_by(FsbImportRow.id).limit(limit).offset(max(offset, 0)))).scalars().all()
    return {"total": total, "limit": limit, "offset": max(offset, 0), "rows": [_row_dict(r) for r in rows]}


@router.get("/fsb/imports/{import_id}/duplicates.csv")
async def duplicates(import_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    _who(request)
    await _get_import(db, import_id)
    body = await FI.duplicates_csv(db, import_id)
    return Response(body, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="fsb-duplicates-{import_id}.csv"'})


class SettingsBody(BaseModel):
    auto: float
    review: float


@router.get("/fsb/settings")
async def get_settings(request: Request, db: AsyncSession = Depends(get_db)):
    _who(request)
    return await FI.get_thresholds(db, current_org())


@router.put("/fsb/settings")
async def put_settings(body: SettingsBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _who(request, admin_only=True)
    try:
        old = await FI.get_thresholds(db, current_org())
        th = await FI.set_thresholds(db, current_org(), body.auto, body.review)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    await audit.record(db, "fsb.settings_changed", target="thresholds", detail={"old": old, "new": th}, actor_id=ctx.get("operator_id") or "", actor_name=_name(ctx))
    await db.commit()
    return th


# ---------- review queue ----------

@router.get("/review-queue")
async def review_queue(request: Request, status: str = "open", limit: int = 50, offset: int = 0, import_id: str = Query("", alias="import"),
                       db: AsyncSession = Depends(get_db)):
    """?import=<id> narrows to one import; ?status=open (default, waiting), decided (accepted and rejected) or all."""
    _who(request)
    states = {"open": ("review",), "decided": ("accepted", "rejected"), "all": ("review", "accepted", "rejected")}.get(status)
    if not states:
        raise HTTPException(status_code=400, detail="status must be open, decided or all.")
    cond = [FsbImportRow.match_status.in_(states)] + ([FsbImportRow.import_id == import_id] if import_id else [])
    total = (await db.execute(select(func.count()).select_from(FsbImportRow).where(*cond))).scalar() or 0
    limit = min(max(limit, 1), 200)
    rows = (await db.execute(select(FsbImportRow).where(*cond).order_by(FsbImportRow.import_id, FsbImportRow.id).limit(limit).offset(max(offset, 0)))).scalars().all()
    facts = await FI.register_facts(db, [c["company_number"] for r in rows for c in (r.candidates or []) if c.get("company_number")]
                                    + [r.match_company_number for r in rows])
    items = []
    for r in rows:
        cands = [{**facts.get(c["company_number"], {"company_number": c["company_number"]}), "score": c.get("score")} for c in (r.candidates or [])]
        chosen = facts.get(r.match_company_number) if r.match_status == "accepted" else None
        items.append({"id": r.id, "import_id": r.import_id, "match_status": r.match_status,
                      "fsb": {"record_id": r.source_record_id, "name": r.name, "postcode": r.postcode, "address": r.address,
                              "company_number_given": r.company_number_given, "phone": r.phone, "website": r.website},
                      "candidate": chosen or (cands[0] if cands else None), "candidates": cands, "score": r.score, "reason": r.reason,
                      "duplicate_of": r.duplicate_of, "decided_by": r.decided_by, "decided_at": _iso(r.decided_at)})
    return {"total": total, "limit": limit, "offset": max(offset, 0), "items": items}


class DecisionBody(BaseModel):
    decision: str
    company_number: Optional[str] = None


@router.post("/review-queue/{row_id}/decision")
async def decide(row_id: str, body: DecisionBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _who(request)
    try:
        row, changed = await FI.decide(db, row_id, body.decision, body.company_number or "", actor_id=ctx.get("operator_id") or "", actor_name=_name(ctx))
    except FI.DecisionError as err:
        await db.rollback()
        raise HTTPException(status_code=err.status_code, detail=err.message)
    await db.commit()
    imp = await db.get(FsbImport, row.import_id)
    return {"ok": True, "changed": changed, "row": _row_dict(row), "counts": (imp.stats or {}).get("counts") if imp else None}


# ---------- monthly change reports ----------

@router.get("/change-reports")
async def list_reports(request: Request, db: AsyncSession = Depends(get_db)):
    _who(request)
    reps = (await db.execute(select(ChangeReport).order_by(ChangeReport.period.desc()).limit(120))).scalars().all()
    return {"reports": [CR.report_dict(r) for r in reps]}


class RunBody(BaseModel):
    start: str
    end: str


def _date(value: str, label: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} must be a date like 2026-10-31.")


@router.post("/change-reports/run")
async def run_report(body: RunBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _who(request)
    start, end = _date(body.start, "start"), _date(body.end, "end")
    if end < start or (end - start).days > 366:
        raise HTTPException(status_code=400, detail="The end must not be before the start, and the range can be a year at most.")
    rep, created = await CR.run_report(db, current_org(), start, end)
    await audit.record(db, "changes.built", target=rep.period, detail={"rows": rep.row_count}, actor_id=ctx.get("operator_id") or "", actor_name=_name(ctx))
    await db.commit()
    return {**CR.report_dict(rep), "created": created}


@router.get("/change-reports/{report_id}/rows.csv")
async def report_csv(report_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _who(request)
    rep = await db.get(ChangeReport, report_id)
    if not rep:
        raise HTTPException(status_code=404, detail="Report not found.")
    s = rep.summary or {}
    rows = await CR.build_rows(db, current_org(), date.fromisoformat(s["start"]), date.fromisoformat(s["end"]))
    await audit.record(db, "changes.downloaded", target=rep.period, detail={"report": rep.id, "rows": len(rows)}, actor_id=ctx.get("operator_id") or "",
                       actor_name=_name(ctx))
    await db.commit()
    return Response(CR.rows_csv(rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="fsb-changes-{rep.period.replace("..", "_to_")}.csv"'})


# The same routes at /records/... (plan 12, B5). The frontend uses those; the /fsb/... paths stay for one release.
from app.core.route_alias import add_aliases as _add_aliases  # noqa: E402

_add_aliases(router)
