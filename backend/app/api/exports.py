"""Downloads for administrators: companies, their people, and the Salesforce update file.

POST /exports/preview                       what a file would hold and what would be left out, before anything is downloaded
POST /exports                               the file (CSV attachment); one audit row per download
POST /fsb/imports/{id}/salesforce/preview   rows and left-out values of the Salesforce update file
POST /fsb/imports/{id}/salesforce.csv       the Salesforce update file (administrators and managers)

Values from view-only sources (Google, Apollo) are never written. Signed-in people only: an API key cannot call these.
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.fsb import _get_import, _name
from app.core.auth_middleware import current
from app.database import get_db
from app.services import audit
from app.services import data_access as DA
from app.services import data_policy as DP
from app.services import export_engine as EE

router = APIRouter(tags=["Exports"])


class ScopeIn(BaseModel):
    list_id: Optional[str] = None
    ids: Optional[List[str]] = Field(None, max_length=EE.MAX_IDS)


class PreviewIn(BaseModel):
    kind: Literal["companies", "people"] = "companies"
    scope: ScopeIn
    fields: Optional[List[str]] = None


class ExportIn(PreviewIn):
    format: Literal["long", "wide"] = "wide"


class SalesforceIn(BaseModel):
    format: Literal["long", "wide"] = "long"
    fields: Optional[List[str]] = None


async def _exporter(request: Request, db: AsyncSession) -> Dict[str, Any]:
    """An admin, or a signed-in person whose export switch is on (it is on until an admin turns it off: services/data_access.py).
    Developer API keys never export. A switched-off person gets 403 with code export_off."""
    ctx = current(request)
    if ctx.get("type") == "api_key":
        raise HTTPException(status_code=403, detail="Only signed-in people can download data.")
    if not ctx.get("is_admin"):
        await DA.require_export(db)
    return ctx


def _scope(body: PreviewIn) -> Dict[str, Any]:
    s = body.scope
    if bool(s.list_id) == (s.ids is not None):
        raise HTTPException(status_code=400, detail="Pick a list or a set of companies.")
    return {"list_id": s.list_id} if s.list_id else {"ids": s.ids or []}


async def _build(db, body: PreviewIn, operator_id: str = ""):
    try:
        records, tally, cols = await EE.build(db, body.kind, _scope(body), body.fields, operator_id or None)
    except EE.ExportProblem as err:
        raise HTTPException(status_code=err.status, detail=str(err))
    if len(records) > EE.MAX_ROWS:
        raise HTTPException(status_code=400, detail=f"A file can hold up to {EE.MAX_ROWS:,} rows. Pick a smaller list.")
    return records, tally, cols


@router.post("/exports/preview")
async def preview(body: PreviewIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = await _exporter(request, db)
    records, tally, _ = await _build(db, body, ctx.get("operator_id") or "")
    return tally.preview(len(records))


@router.post("/exports")
async def export(body: ExportIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _exporter(request, db)
    from app.services import plan_rules

    allowed = await plan_rules.limit("exports_month", ctx.get("org_id"))
    if allowed:
        from datetime import datetime as _dt

        from sqlalchemy import func, select

        from app.models.models import AuditLog

        start = _dt.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        done = (await db.execute(select(func.count()).select_from(AuditLog).where(AuditLog.action == "export.created",
                                                                                  AuditLog.created_at >= start))).scalar() or 0
        if done >= allowed:
            raise HTTPException(status_code=403, detail=plan_rules.limit_message("exports_month", allowed))
    records, tally, cols = await _build(db, body, ctx.get("operator_id") or "")
    if not records and tally.outside:
        raise DA.AccessDenied(403, DA.OUTSIDE_DETAIL, "outside_access")
    if not records:
        raise HTTPException(status_code=404, detail="Nothing to export: those companies aren't in your saved accounts.")
    data = EE.render(body.kind, body.format, records, cols)
    await audit.record(db, "export.created", target=body.scope.list_id or "ids",
                       detail={"kind": body.kind, "rows": len(records), "withheld": tally.withheld, "scope": "list" if body.scope.list_id else "ids",
                               "format": body.format}, actor_id=ctx.get("operator_id") or "", actor_name=_name(ctx))
    await db.commit()
    return Response(data, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{body.kind}-export.csv"', "X-Withheld-Count": str(tally.withheld),
                             "X-Export-Rows": str(len(records)), **({"X-Access-Notice": DA.OUTSIDE_NOTICE} if tally.outside else {})})


async def _sf(db, import_id: str, body: SalesforceIn, operator_id: str = ""):
    await _get_import(db, import_id)
    try:
        return await EE.salesforce(db, import_id, body.fields, body.format, operator_id or None)
    except EE.ExportProblem as err:
        raise HTTPException(status_code=err.status, detail=str(err))


@router.post("/fsb/imports/{import_id}/salesforce/preview")
async def salesforce_preview(import_id: str, body: SalesforceIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = await _exporter(request, db)
    rows, tally, changed = await _sf(db, import_id, body, ctx.get("operator_id") or "")
    return {"rows": len(rows) - 1, "records": changed, "withheld": tally.withheld, "withheld_fields": dict(tally.fields),
            "popup": DP.EXPORT_POPUP if tally.restricted_count > 0 else "", "unscreened_phones": tally.unscreened,
            **({"access_notice": DA.OUTSIDE_NOTICE} if tally.outside else {})}


@router.post("/fsb/imports/{import_id}/salesforce.csv")
async def salesforce_csv(import_id: str, body: SalesforceIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _exporter(request, db)
    rows, tally, changed = await _sf(db, import_id, body, ctx.get("operator_id") or "")
    await audit.record(db, "export.salesforce", target=import_id,
                       detail={"rows": len(rows) - 1, "records": changed, "withheld": tally.withheld, "format": body.format},
                       actor_id=ctx.get("operator_id") or "", actor_name=_name(ctx))
    await db.commit()
    return Response(EE.to_csv(rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="salesforce-update-{import_id}.csv"', "X-Withheld-Count": str(tally.withheld),
                             "X-Export-Rows": str(len(rows) - 1), **({"X-Access-Notice": DA.OUTSIDE_NOTICE} if tally.outside else {})})


# The same routes at /records/... (plan 12, B5). The frontend uses those; the /fsb/... paths stay for one release.
from app.core.route_alias import add_aliases as _add_aliases  # noqa: E402

_add_aliases(router)
