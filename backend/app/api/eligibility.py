"""Who may get email, consent and retention: the screens' API (see services/eligibility.py).

GET  /leads/eligibility                  counts per group (list_id= for one list)
GET  /leads/eligibility/{id}             one company's group, reason and the register companies it might be
POST /leads/eligibility/{id}/choose      the quick choice: {business_record_id} or {sole_trader: true}
POST /leads/eligibility/check            work the groups out again (ids, or every saved company)
POST /leads/consent/proof                upload a proof file (kept privately), then pass its name to /leads/consent
POST /leads/consent                      "How did these contacts agree to hear from you?" for some contacts or a list
GET  /leads/consent                      what was declared, newest first
GET  /leads/retention                    companies flagged 12 months after the last contact (or after being added)
POST /leads/retention/sweep|delete       flag now; delete flagged ones (the do-not-email list is kept)

Staff (admin portal): GET /admin-api/consent, GET /admin-api/consent/{id}/proof, POST /admin-api/consent/{id}/revoke
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import BusinessRecord, ConsentDeclaration, LeadAccount
from app.services import eligibility as EL
from app.services import send_readiness as SR

router = APIRouter(prefix="/leads", tags=["Leads"])
staff_router = APIRouter(prefix="/admin-api/consent", tags=["Admin portal"])


def _fail(err: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(err))


async def _account(db: AsyncSession, lead_id: str) -> LeadAccount:
    row = await db.get(LeadAccount, lead_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That company is not in your saved companies.")
    return row


@router.get("/eligibility")
async def groups(list_id: str = "", db: AsyncSession = Depends(get_db)):
    q = select(LeadAccount)
    if list_id:
        from app.api import lead_lists as LL

        lst = next((l for l in await LL._load(db) if l["id"] == list_id), None)
        if not lst:
            raise HTTPException(status_code=404, detail="That list isn't there any more.")
        q = q.where(LeadAccount.id.in_(list(lst.get("ids") or [])))
    rows = (await db.execute(q.limit(20000))).scalars().all()
    ids = {r.business_record_id for r in rows if r.business_record_id}
    recs = {b.id: b for b in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(ids)))).scalars().all()} if ids else {}
    counts = {"email": 0, SR.QUICK: 0, SR.OTHER: 0, "left_out": 0, "consent": 0}
    for r in rows:
        d = SR.eligibility(r, recs.get(r.business_record_id))
        if not d["ok"]:
            counts["left_out"] += 1
        elif d["email"]:
            counts["email"] += 1
            counts["consent"] += d["group"] != SR.READY
        else:
            counts[d["group"]] += 1
    return {"counts": counts, "total": len(rows)}


class CheckIn(BaseModel):
    ids: List[str] = []


@router.post("/eligibility/check")
async def check(body: CheckIn, db: AsyncSession = Depends(get_db)):
    q = select(LeadAccount)
    if body.ids:
        q = q.where(LeadAccount.id.in_(body.ids[:5000]))
    rows = (await db.execute(q.limit(20000))).scalars().all()
    counts = await EL.classify(db, list(rows))
    await db.commit()
    return {"counts": counts, "checked": len(rows)}


@router.get("/eligibility/{lead_id}")
async def one(lead_id: str, db: AsyncSession = Depends(get_db)):
    row = await _account(db, lead_id)
    biz = await db.get(BusinessRecord, row.business_record_id) if row.business_record_id else None
    out = EL.out(row, biz)
    out["candidates"] = await EL.candidates(db, row) if out["group"] == SR.QUICK else []
    return out


class ChooseIn(BaseModel):
    business_record_id: str = ""
    sole_trader: bool = False


@router.post("/eligibility/{lead_id}/choose")
async def choose(lead_id: str, body: ChooseIn, db: AsyncSession = Depends(get_db)):
    row = await _account(db, lead_id)
    try:
        out = await EL.choose(db, row, business_record_id=body.business_record_id, sole_trader=body.sole_trader)
    except EL.EligibilityError as err:
        raise _fail(err)
    await db.commit()
    return out


@router.post("/consent/proof")
async def proof(request: Request, file: UploadFile = File(...)):
    ctx = current(request)
    try:
        name = await EL.store_proof(ctx["org_id"], file, file.content_type or "")
    except EL.EligibilityError as err:
        raise _fail(err)
    return {"file": name, "name": (file.filename or "")[:200]}


class ConsentIn(BaseModel):
    basis: str
    source: str = ""
    agreed_on: str = ""
    lead_ids: List[str] = []
    list_id: str = ""
    scope: str = "import"
    confirmed: bool = False
    proof_file: str = ""
    proof_name: str = ""
    proof_ref: str = ""


@router.post("/consent")
async def declare(body: ConsentIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    if body.proof_file and not EL.proof_path(ctx["org_id"], body.proof_file):
        raise HTTPException(status_code=400, detail="That proof file didn't upload. Add it again.")
    try:
        out = await EL.declare(db, basis=body.basis, source=body.source, agreed_on=body.agreed_on, lead_ids=body.lead_ids, list_id=body.list_id,
                               scope=body.scope, confirmed=body.confirmed, proof_file=body.proof_file, proof_name=body.proof_name, proof_ref=body.proof_ref,
                               operator_id=ctx.get("operator_id") or "", operator_name=ctx.get("name") or ctx.get("email") or "")
    except EL.EligibilityError as err:
        raise _fail(err)
    await db.commit()
    return {"declaration": out}


@router.get("/consent")
async def declared(db: AsyncSession = Depends(get_db)):
    return {"declarations": await EL.declarations(db), "question": EL.QUESTION, "options": EL.BASES, "confirm": EL.CONFIRM}


class WithdrawIn(BaseModel):
    reason: str = ""


@router.post("/consent/{decl_id}/withdraw")
async def withdraw_declaration(decl_id: str, body: WithdrawIn, request: Request, db: AsyncSession = Depends(get_db)):
    """The customer takes back an answer they gave: the contacts it covered lose that consent (sole traders go back to being reached another way)."""
    ctx = current(request)
    d = await db.get(ConsentDeclaration, decl_id)  # row-level security hides other organisations' declarations
    if d is None:
        raise HTTPException(status_code=404, detail="That answer isn't there any more.")
    out = await EL.revoke(db, d, by=str(ctx.get("name") or ctx.get("email") or ctx.get("operator_id") or "customer"),
                          reason=body.reason or "Withdrawn by the customer")
    await db.commit()
    return {"declaration": out}


@router.get("/retention")
async def retention(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(LeadAccount).where(LeadAccount.retention_flagged_at.isnot(None)).order_by(LeadAccount.created_at).limit(2000))).scalars().all()
    total = (await db.execute(select(func.count(LeadAccount.id)).where(LeadAccount.retention_flagged_at.isnot(None)))).scalar() or 0
    last = await EL.last_touches(db, [a.id for a in rows])
    return {"total": total, "accounts": [{"id": a.id, "name": a.name, "email": a.email or "", "reason": EL.retention_reason(a, last.get(a.id)),
                                          "flagged_at": a.retention_flagged_at.isoformat() + "Z"} for a in rows]}


@router.post("/retention/sweep")
async def retention_sweep(db: AsyncSession = Depends(get_db)):
    out = await EL.retention_sweep(db)
    await db.commit()
    return out


class RetentionDelete(BaseModel):
    ids: List[str] = []


@router.post("/retention/delete")
async def retention_delete(body: RetentionDelete, db: AsyncSession = Depends(get_db)):
    out = await EL.retention_delete(db, body.ids or None)
    await db.commit()
    return out


# ── Staff: spot-check and revoke (no approval step for customers) ─────────────
def _staff(request: Request) -> Dict[str, Any]:
    from app.api.admin_portal import _who

    return _who(request)


@staff_router.get("")
async def staff_list(request: Request, org_id: str = "", limit: int = 100, db: AsyncSession = Depends(get_db)):
    _staff(request)
    q = select(ConsentDeclaration)
    if org_id:
        q = q.where(ConsentDeclaration.org_id == org_id)
    rows = (await db.execute(q.order_by(ConsentDeclaration.declared_at.desc()).limit(max(1, min(limit, 500))))).scalars().all()
    return {"declarations": [EL.decl_out(d) for d in rows]}


@staff_router.get("/{decl_id}/proof")
async def staff_proof(decl_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    _staff(request)
    d = await db.get(ConsentDeclaration, decl_id)
    path = EL.proof_path(d.org_id, d.proof_file) if d is not None and d.proof_file else None
    if path is None:
        raise HTTPException(status_code=404, detail="No proof file was added to this declaration.")
    return FileResponse(str(path), filename=d.proof_name or path.name, media_type=EL.proof_mime(path.name),
                        headers={"X-Content-Type-Options": "nosniff"})


class RevokeIn(BaseModel):
    reason: str = ""


@staff_router.post("/{decl_id}/revoke")
async def staff_revoke(decl_id: str, body: RevokeIn, request: Request, db: AsyncSession = Depends(get_db)):
    from app.api.admin_portal import _admin_only, _in_org

    staff = _admin_only(request)
    d = await db.get(ConsentDeclaration, decl_id)
    if d is None:
        raise HTTPException(status_code=404, detail="That declaration isn't there.")
    by = str(staff.get("email") or staff.get("id") or "staff")

    async def run(org_db: AsyncSession):  # the contacts it covered belong to that organisation, so they are reached inside its scope
        row = await org_db.get(ConsentDeclaration, decl_id)
        out = await EL.revoke(org_db, row, by=by, reason=body.reason)
        await org_db.commit()
        return out

    return {"declaration": await _in_org(d.org_id, run)}
