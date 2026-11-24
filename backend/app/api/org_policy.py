"""An organisation's rules (its brand's combined with its own), the company's own rules, and the member list hidden from every search.

GET    /org/policy                what is on for this account (read-only; any signed-in user; no lists, nothing secret)
GET    /org/rules                 each level's rules: the brand's (read-only here), the company's own, and the combined result (organisation admin)
PUT    /org/rules                 replace the company's own rules (organisation admin). They can only add to the brand's; refused with the
                                  reasons when an area is outside the brand's areas or no sign-in method would be left. Every save is audited
GET    /org/member-suppression    how many company numbers are hidden, and a sample (organisation admin; only when the policy has member suppression)
POST   /org/member-suppression    add numbers: a CSV or JSON file (multipart field "file"), or a JSON body {"numbers": [...]} / a plain JSON list.
                                  ?replace=true clears the list first
DELETE /org/member-suppression    clear the list
"""
from __future__ import annotations

import csv
import io
import json
import logging
import uuid
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import SuppressedCompany
from app.services import audit
from app.services import tenant_policy as TP

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/org", tags=["Organisation policy"])

MAX_NUMBERS = 200_000
MAX_BYTES = 8 * 1024 * 1024
_HEADERS = ("company_number", "company number", "companynumber", "number", "registration_number", "registration number", "company_no", "crn")


def _admin(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if not ctx.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only an account admin can manage this list.")
    return ctx


async def _need_suppression(db: AsyncSession, ctx: Dict[str, Any]) -> TP.Policy:
    pol = await TP.effective(db, ctx["org_id"])
    if not pol.suppression_on:
        raise HTTPException(status_code=404, detail="Member suppression is not switched on for this account. An admin can switch it on in your company's rules.")
    return pol


def parse_numbers(raw: bytes, filename: str = "") -> Tuple[List[Tuple[str, str]], int]:
    """([(company_number, label)], rejected) from a CSV or JSON file. JSON: a list of numbers, a list of {"number", "label"}, or {"numbers": [...]}.
    CSV: the column headed company number (or number), else the first cell on each row that is a company number."""
    text_ = raw.decode("utf-8-sig", errors="replace")
    rows: List[Tuple[str, str]] = []
    bad = 0
    stripped = text_.lstrip()
    if filename.lower().endswith(".json") or stripped[:1] in "[{":
        try:
            data = json.loads(text_)
        except ValueError:
            raise HTTPException(status_code=400, detail="That file is not valid JSON or CSV.")
        items = data.get("numbers") if isinstance(data, dict) else data
        if not isinstance(items, list):
            raise HTTPException(status_code=400, detail='Send a list of company numbers, or {"numbers": [...]}.')
        for it in items:
            num, label = (it.get("number") or it.get("company_number") or "", it.get("label") or "") if isinstance(it, dict) else (it, "")
            n = TP.normalize_company_number(num)
            if n:
                rows.append((n, str(label)[:120]))
            else:
                bad += 1
        return rows, bad
    reader = list(csv.reader(io.StringIO(text_)))
    col = None
    if reader and any(c.strip().lower() in _HEADERS for c in reader[0]):
        col = next(i for i, c in enumerate(reader[0]) if c.strip().lower() in _HEADERS)
        reader = reader[1:]
    for r in reader:
        if not any(c.strip() for c in r):
            continue
        cells = [r[col]] if col is not None and col < len(r) else r
        hit = next(((TP.normalize_company_number(c), i) for i, c in enumerate(cells) if TP.normalize_company_number(c)), None)
        if hit:
            others = [c.strip() for i, c in enumerate(cells) if i != hit[1] and c.strip()] if col is None else [c.strip() for i, c in enumerate(r) if i != col and c.strip()]
            rows.append((hit[0], (others[0] if others else "")[:120]))
        else:
            bad += 1
    return rows, bad


@router.get("/policy")
async def my_policy(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    from app.services import data_access as DA

    out = (await TP.org_effective(db, ctx["org_id"])).summary()
    out["data_access"] = (await DA.resolve(db, ctx["org_id"], ctx["operator_id"])).payload() if ctx.get("operator_id") and ctx.get("type") != "api_key" else DA.OPEN.payload()
    return out


def _rules_admin(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if ctx.get("type") == "api_key" or not ctx.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only an account admin can see or change your company's rules.")
    return ctx


async def _rules_view(db: AsyncSession, org_id: str) -> Dict[str, Any]:
    lv = await TP.levels(db, org_id)
    combined = TP.merge_policy(lv["brand"] or TP.default_policy(), lv["company"])
    return {"brand": lv["brand"], "brandName": lv["brandName"], "company": lv["company"], "combined": combined,
            "summary": TP.Policy(org_id, lv["brandId"], merged=combined).summary()}


@router.get("/rules")
async def get_rules(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _rules_admin(request)
    return await _rules_view(db, ctx["org_id"])


@router.put("/rules")
async def put_rules(body: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    """Replaces the company's own rules with the body (the policy shape; anything left out takes its default, which restricts nothing)."""
    from app.models.models import Organization

    ctx = _rules_admin(request)
    org_id = ctx["org_id"]
    lv = await TP.levels(db, org_id)
    company = TP.clean_policy(body)
    problems = TP.company_policy_problems(lv["brand"] or TP.default_policy(), company)
    if problems:
        raise HTTPException(status_code=400, detail={"message": " ".join(problems), "problems": problems, "code": "rules_conflict"})
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found.")
    before = lv["company"]
    org.policy = None if company == TP.default_policy() else company
    if before != company:
        await audit.record(db, "policy.changed", target=f"org:{org_id}", detail={"level": "company", "before": before, "after": company},
                           actor_id=ctx.get("operator_id", ""), actor_name=ctx.get("email") or ctx.get("name") or "")
    await db.commit()
    TP.invalidate(org_id)
    return await _rules_view(db, org_id)


@router.get("/member-suppression")
async def list_suppression(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    await _need_suppression(db, ctx)
    total = int((await db.execute(select(func.count()).select_from(SuppressedCompany).where(SuppressedCompany.org_id == ctx["org_id"]))).scalar() or 0)
    sample = (await db.execute(select(SuppressedCompany).where(SuppressedCompany.org_id == ctx["org_id"]).order_by(SuppressedCompany.created_at.desc()).limit(10))).scalars().all()
    return {"count": total, "sample": [{"number": s.company_number, "label": s.label or ""} for s in sample]}


@router.post("/member-suppression")
async def add_suppression(request: Request, replace: bool = False, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    await _need_suppression(db, ctx)
    kind = (request.headers.get("content-type") or "").lower()
    if "multipart" in kind:
        form = await request.form()
        up = form.get("file")
        if up is None or not hasattr(up, "read"):
            raise HTTPException(status_code=400, detail='Send the file in the form field "file".')
        raw, name = await up.read(MAX_BYTES + 1), getattr(up, "filename", "") or ""
    else:
        raw, name = await request.body(), ""
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="That file is too big. Split it into parts under 8 MB.")
    rows, rejected = parse_numbers(raw, name)
    if not rows:
        raise HTTPException(status_code=400, detail="No company numbers found. Use one company number per row, such as 01234567 or SC123456.")
    unique = list({n: l for n, l in rows}.items())
    if len(unique) > MAX_NUMBERS:
        raise HTTPException(status_code=413, detail=f"At most {MAX_NUMBERS:,} company numbers at once.")
    by = ctx.get("email") or ctx.get("name") or ctx.get("username") or ""
    if replace:
        await db.execute(delete(SuppressedCompany).where(SuppressedCompany.org_id == ctx["org_id"]))
    before = int((await db.execute(select(func.count()).select_from(SuppressedCompany).where(SuppressedCompany.org_id == ctx["org_id"]))).scalar() or 0)
    for i in range(0, len(unique), 2000):
        chunk = [{"id": f"sup_{uuid.uuid4().hex[:16]}", "org_id": ctx["org_id"], "company_number": n, "label": l, "added_by": by[:120]}
                 for n, l in unique[i:i + 2000]]
        await db.execute(pg_insert(SuppressedCompany).values(chunk).on_conflict_do_nothing(index_elements=["org_id", "company_number"]))
    after = int((await db.execute(select(func.count()).select_from(SuppressedCompany).where(SuppressedCompany.org_id == ctx["org_id"]))).scalar() or 0)
    await audit.record(db, "member_suppression.added", target="member list", detail={"rows": len(unique), "added": after - before, "rejected": rejected,
                                                                                    "replaced": bool(replace), "total": after},
                       actor_id=ctx.get("operator_id", ""), actor_name=by)
    await db.commit()
    TP.invalidate(ctx["org_id"])
    return {"added": after - before, "alreadyThere": len(unique) - (after - before), "rejected": rejected, "count": after}


@router.delete("/member-suppression")
async def clear_suppression(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    await _need_suppression(db, ctx)
    n = int((await db.execute(select(func.count()).select_from(SuppressedCompany).where(SuppressedCompany.org_id == ctx["org_id"]))).scalar() or 0)
    await db.execute(delete(SuppressedCompany).where(SuppressedCompany.org_id == ctx["org_id"]))
    await audit.record(db, "member_suppression.cleared", target="member list", detail={"removed": n}, actor_id=ctx.get("operator_id", ""),
                       actor_name=ctx.get("email") or ctx.get("name") or "")
    await db.commit()
    TP.invalidate(ctx["org_id"])
    return {"removed": n, "count": 0}
