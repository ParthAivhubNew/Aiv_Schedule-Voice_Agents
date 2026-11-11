"""The ideal customer and the fit score: the screens' API (see services/icp.py and services/fit_score.py).

GET  /leads/icp              the saved ICP, whether it is set, the Find Leads filters it opens on, and the choices
PUT  /leads/icp              save it (an admin, like the rest of the company profile)
POST /leads/icp/draft        a first ICP read from the customer's own website, to check and save (nothing is saved)
GET  /leads/sic-codes?q=     the SIC picker: codes and words as the register writes them

Staff (admin portal): GET /admin-api/fit-weights, PUT /admin-api/fit-weights (staff admins)
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import get_db
from app.services import fit_score as FS
from app.services import icp as ICP

router = APIRouter(prefix="/leads", tags=["Leads"])
staff_router = APIRouter(prefix="/admin-api/fit-weights", tags=["Admin portal"])


def _can_edit(request: Request) -> bool:
    from app.api.email_outreach import _can_edit_company

    return _can_edit_company(current(request))


def _choices() -> Dict[str, Any]:
    return {"company_types": [{"id": k, "label": v[0]} for k, v in FS.COMPANY_TYPES.items()],
            "size_bands": [{"id": k, "label": v} for k, v in FS.SIZE_BANDS.items() if k != "dormant"],
            "max_radius_miles": FS.MAX_RADIUS_MILES}


def _answer(request: Request, icp: Dict[str, Any]) -> Dict[str, Any]:
    return {"icp": icp, "is_set": FS.icp_is_set(icp), "filters": FS.search_filters(icp), "can_edit": _can_edit(request), "choices": _choices()}


@router.get("/icp")
async def get_icp(request: Request, db: AsyncSession = Depends(get_db)):
    return _answer(request, await ICP.load(db))


class IcpIn(BaseModel):
    sic_codes: List[str] = []
    sic_labels: Dict[str, str] = {}
    postcode_areas: List[str] = []
    areas: List[Dict[str, Any]] = []
    size_bands: List[str] = []
    company_types: List[str] = []
    exclude_charities: bool = False


@router.put("/icp")
async def put_icp(body: IcpIn, request: Request, db: AsyncSession = Depends(get_db)):
    if not _can_edit(request):
        raise HTTPException(status_code=403, detail="Only an admin can change your ideal customer, because every tool reads it. Ask an admin to update it.")
    raw = body.model_dump()
    missing = [c for c in raw["sic_codes"] if c not in raw["sic_labels"]]
    if missing:  # codes typed without the picker still show with the register's words
        raw["sic_labels"] = {**raw["sic_labels"], **await ICP.sic_labels(db, missing)}
    try:
        icp = await ICP.save(db, raw)
    except ICP.IcpError as err:
        raise HTTPException(status_code=400, detail=str(err))
    await db.commit()
    from app.api import lead_accounts

    lead_accounts._PAGE_CACHE.clear()
    return _answer(request, icp)


class DraftIn(BaseModel):
    website: str = ""


DRAFTS_PER_DAY = 10


async def _use_draft(db: AsyncSession) -> bool:
    """Counts one draft against today's allowance for this organisation (each one reads a web page and calls the AI)."""
    from datetime import datetime

    from app.core.tenancy import current_org
    from app.services import credits as credit

    key = f"icpdraft:{current_org()}"
    day = datetime.utcnow().date().isoformat()
    doc = await credit._get_doc(db, key)
    used = int(doc.get("used") or 0) if doc.get("day") == day else 0
    if used >= DRAFTS_PER_DAY:
        return False
    await credit._put_doc(db, key, {"day": day, "used": used + 1})
    await db.commit()
    return True


@router.post("/icp/draft")
async def draft_icp(body: DraftIn, db: AsyncSession = Depends(get_db)):
    from app.api.email_outreach import _company_profile, _filled

    cp = await _company_profile(db)
    if not await _use_draft(db):
        raise HTTPException(status_code=429, detail=f"You've used today's {DRAFTS_PER_DAY} drafts. Fill the boxes in yourself, or try again tomorrow.")
    try:
        return await ICP.draft_from_website(db, body.website or _filled("website", getattr(cp, "website", "")))
    except ICP.IcpError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/radius-districts")
async def radius_districts(postcode: str = "", miles: float = 5):
    """The postcode districts inside a radius, for the Find Leads "within N miles" filter."""
    miles = min(50.0, max(0.5, miles))
    try:
        districts = await ICP._districts_within(postcode, miles)
    except ICP.IcpError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"districts": districts, "postcode": postcode.strip().upper(), "miles": miles}


@router.get("/sic-codes")
async def sic_codes(q: str = "", db: AsyncSession = Depends(get_db)):
    return {"codes": await ICP.sic_search(db, q)}


# â”€â”€ Staff: the weights behind every score â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def _staff(request: Request, admin: bool = False) -> Dict[str, Any]:
    from app.api.admin_portal import _admin_only, _who

    return _admin_only(request) if admin else _who(request)


@staff_router.get("")
async def get_weights(request: Request, db: AsyncSession = Depends(get_db)):
    _staff(request)
    return {"weights": await ICP.weights(db), "defaults": FS.DEFAULT_WEIGHTS, "labels": FS.WEIGHT_LABELS}


class WeightsIn(BaseModel):
    weights: Dict[str, Any]


@staff_router.put("")
async def put_weights(body: WeightsIn, request: Request, db: AsyncSession = Depends(get_db)):
    staff = _staff(request, admin=True)
    try:
        w = await ICP.save_weights(db, body.weights, by=str(staff.get("email") or staff.get("id") or "staff"))
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    await db.commit()
    return {"weights": w, "defaults": FS.DEFAULT_WEIGHTS, "labels": FS.WEIGHT_LABELS}
