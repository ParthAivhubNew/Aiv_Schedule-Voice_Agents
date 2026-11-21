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

from app.api.fsb import _get_import, _name, _who
from app.core.auth_middleware import current
from app.database import get_db
from app.services import audit
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


def _admin(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if ctx.get("type") == "api_key" or not ctx.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only administrators can download data.")
    return ctx


def _no_key(request: Request) -> None:
    if current(request).get("type") == "api_key":
        raise HTTPException(status_code=403, detail="Only signed-in people can download data.")


def _scope(body: PreviewIn) -> Dict[str, Any]:
    s = body.scope
    if bool(s.list_id) == (s.ids is not None):
        raise HTTPException(status_code=400, detail="Pick a list or a set of companies.")
    return {"list_id": s.list_id} if s.list_id else {"ids": s.ids or []}


async def _build(db, body: PreviewIn):
    try:
        records, tally, cols = await EE.build(db, body.kind, _scope(body), body.fields)
    except EE.ExportProblem as err:
        raise HTTPException(status_code=err.status, detail=str(err))
    if len(records) > EE.MAX_ROWS:
        raise HTTPException(status_code=400, detail=f"A file can hold up to {EE.MAX_ROWS:,} rows. Pick a smaller list.")
    return records, tally, cols


@router.post("/exports/preview")
async def preview(body: PreviewIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    _admin(request)
    records, tally, _ = await _build(db, body)
    return tally.preview(len(records))


@router.post("/exports")
async def export(body: ExportIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    records, tally, cols = await _build(db, body)
    if not records:
        raise HTTPException(status_code=404, detail="Nothing to export: those companies aren't in your saved accounts.")
    data = EE.render(body.kind, body.format, records, cols)
    await audit.record(db, "export.created", target=body.scope.list_id or "ids",
                       detail={"kind": body.kind, "rows": len(records), "withheld": tally.withheld, "scope": "list" if body.scope.list_id else "ids",
                               "format": body.format}, actor_id=ctx.get("operator_id") or "", actor_name=_name(ctx))
    await db.commit()
    return Response(data, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{body.kind}-export.csv"', "X-Withheld-Count": str(tally.withheld),
                             "X-Export-Rows": str(len(records))})


async def _sf(db, import_id: str, body: SalesforceIn):
    await _get_import(db, import_id)
    try:
        return await EE.salesforce(db, import_id, body.fields, body.format)
    except EE.ExportProblem as err:
        raise HTTPException(status_code=err.status, detail=str(err))


@router.post("/fsb/imports/{import_id}/salesforce/preview")
async def salesforce_preview(import_id: str, body: SalesforceIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    _who(request)
    _no_key(request)
    rows, tally, changed = await _sf(db, import_id, body)
    return {"rows": len(rows) - 1, "records": changed, "withheld": tally.withheld, "withheld_fields": dict(tally.fields),
            "popup": DP.EXPORT_POPUP if tally.restricted_count > 0 else "", "unscreened_phones": tally.unscreened}


@router.post("/fsb/imports/{import_id}/salesforce.csv")
async def salesforce_csv(import_id: str, body: SalesforceIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _who(request)
    _no_key(request)
    rows, tally, changed = await _sf(db, import_id, body)
    await audit.record(db, "export.salesforce", target=import_id,
                       detail={"rows": len(rows) - 1, "records": changed, "withheld": tally.withheld, "format": body.format},
                       actor_id=ctx.get("operator_id") or "", actor_name=_name(ctx))
    await db.commit()
    return Response(EE.to_csv(rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="salesforce-update-{import_id}.csv"', "X-Withheld-Count": str(tally.withheld),
                             "X-Export-Rows": str(len(rows) - 1)})
