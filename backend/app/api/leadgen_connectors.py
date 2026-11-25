"""Leads: the Connectors screen and the list of lead sources (plan 10, Phases 1 and 3; plan 11, step 6).

GET  /leadgen/connectors             every connector the company can see, with its real status and counts (any signed-in user)
POST /leadgen/connectors/{id}/test   runs the connector's real check and shows its real result, failures included (organisation admin)
GET  /leadgen/sources                every origin and provenance key a screen may meet, with its label (any signed-in user)

Clients never see supplier names here. Staff see a company's connectors with supplier names, each e-mail finder and the registers' last
errors on GET /admin-api/connectors?orgId=... (api/admin_portal.py).
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import get_db
from app.services import connector_catalog as CC
from app.services import source_catalog as SC

router = APIRouter(prefix="/leadgen", tags=["Leads connectors"])


@router.get("/connectors")
async def list_connectors(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = current(request)
    out = await CC.catalogue(db, ctx["org_id"])
    out["canTest"] = bool(ctx.get("is_admin"))
    return out


@router.post("/connectors/{connector_id}/test")
async def test_connector(connector_id: str, request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if not ctx.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only an account admin can test a connector.")
    return await CC.test(ctx["org_id"], connector_id[:80])


@router.get("/sources")
async def list_sources(request: Request) -> Dict[str, Any]:
    current(request)
    return SC.catalog()
