"""The organisation's own exclusion list, kept by its admins (Administration > Exclusions).

GET    /org/exclusions            every rule, with a plain sentence for each, and the limits
POST   /org/exclusions            add rules: typed text {"items": ["85200", "church", "Charity register"]} and/or {"rules": [{kind, value, mode}]}
PUT    /org/exclusions/{id}       change value, note or on/off. Send the row's updated_at: a stale one is refused (409)
DELETE /org/exclusions/{id}       remove one rule
POST   /org/exclusions/preview    how many companies the list leaves out before and after an edit nobody has saved yet
GET    /org/exclusions/history    the latest changes (who, what, when)

Admins only, checked in each handler; a developer API key is refused. Rules belong to the organisation: every search, count and public API call of
every person in it is filtered on the server (services/tenant_policy.py), and no screen has a switch to turn them off. Every change writes an audit
row and drops the remembered policy at once.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import OrgExclusionRule
from app.services import audit, org_rules
from app.services import tenant_policy as TP

router = APIRouter(prefix="/org/exclusions", tags=["Exclusions"])

HISTORY_ACTION = "org_exclusion."
_COUNTS: Dict[str, Any] = {}  # "all" and "saved rules" counts per organisation: (when, number). Only the edit being checked is counted fresh.
_COUNTS_TTL = 600.0


class RuleIn(BaseModel):
    kind: str
    value: str = ""
    mode: str = "exclude"
    label: str = ""


class AddIn(BaseModel):
    items: List[str] = []
    rules: List[RuleIn] = []


class PatchIn(BaseModel):
    value: Optional[str] = None
    label: Optional[str] = None
    enabled: Optional[bool] = None
    updated_at: Optional[str] = None


class PreviewIn(BaseModel):
    add_items: List[str] = []
    remove: List[str] = []
    toggle: Dict[str, bool] = {}


def _admin(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if ctx.get("type") == "api_key" or not ctx.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only an account admin can manage the exclusion list.")
    return ctx


def _who(ctx: Dict[str, Any]) -> str:
    return str(ctx.get("email") or ctx.get("name") or ctx.get("username") or "")[:120]


def _iso(d) -> Optional[str]:
    return d.isoformat() + "Z" if d else None


def _row(r: OrgExclusionRule) -> Dict[str, Any]:
    return {"id": r.id, "kind": r.kind, "kindLabel": org_rules.KIND_LABELS.get(r.kind, r.kind), "value": r.value or "", "mode": r.mode,
            "enabled": r.enabled is not False, "label": r.label or "", "meaning": org_rules.meaning(r.kind, r.value or "", r.mode),
            "createdBy": r.created_by or "", "createdAt": _iso(r.created_at), "updatedAt": _iso(r.updated_at)}


async def _all(db: AsyncSession, org_id: str) -> List[OrgExclusionRule]:
    return list((await db.execute(select(OrgExclusionRule).where(OrgExclusionRule.org_id == org_id)
                                  .order_by(OrgExclusionRule.created_at, OrgExclusionRule.id))).scalars().all())


def _bad(message: str, rejected: List[Dict[str, str]]) -> JSONResponse:
    """422 whose detail is one readable sentence naming each bad item (the screen shows `detail` as it is); `rejected` has them one by one."""
    named = " ".join(f"{r['item']}: {r['reason'].rstrip('.')}." for r in rejected[:5]) + (f" And {len(rejected) - 5} more." if len(rejected) > 5 else "")
    return JSONResponse(status_code=422, content={"detail": f"{message} {named}".strip(), "rejected": rejected})


@router.get("")
async def list_rules(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = _admin(request)
    rows = await _all(db, ctx["org_id"])
    return {"rules": [_row(r) for r in rows], "max": org_rules.MAX_RULES, "enabled": sum(1 for r in rows if r.enabled is not False)}


@router.post("")
async def add_rules(body: AddIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    org = ctx["org_id"]
    wanted, rejected = org_rules.parse_items(body.items)
    seen = {(w["kind"], w["value"], w["mode"]) for w in wanted}
    labels: Dict[tuple, str] = {}
    for r in body.rules:
        try:
            value = org_rules.clean_value(r.kind, r.value, r.mode)
        except ValueError as err:
            rejected.append({"item": f"{r.kind} {r.value}".strip()[:org_rules.MAX_VALUE], "reason": str(err)})
            continue
        key = (r.kind, value, r.mode)
        labels[key] = r.label[:120]
        if key not in seen:
            seen.add(key)
            wanted.append({"kind": r.kind, "value": value, "mode": r.mode})
    if rejected:
        return _bad("Some of that can't be used. Nothing was added: fix these and try again.", rejected)
    if not wanted:
        raise HTTPException(status_code=400, detail="Type what to leave out, such as 85200, church or Charity register.")
    have = {(r.kind, r.value or "", r.mode) for r in await _all(db, org)}
    fresh = [w for w in wanted if (w["kind"], w["value"], w["mode"]) not in have]
    if len(have) + len(fresh) > org_rules.MAX_RULES:
        raise HTTPException(status_code=413, detail=f"An organisation can keep up to {org_rules.MAX_RULES} rules. Remove some first.")
    if fresh:
        by = _who(ctx)
        now = datetime.utcnow()
        await db.execute(pg_insert(OrgExclusionRule).values([
            {"id": f"exr_{uuid.uuid4().hex[:16]}", "org_id": org, "kind": w["kind"], "value": w["value"], "mode": w["mode"],
             "label": labels.get((w["kind"], w["value"], w["mode"]), ""), "enabled": True, "created_by": by, "created_at": now, "updated_at": now}
            for w in fresh]).on_conflict_do_nothing(index_elements=["org_id", "kind", "value", "mode"]))
        await audit.record(db, "org_exclusion.added", target="exclusion list",
                           detail={"added": len(fresh), "items": ", ".join(f"{w['kind']}:{w['value'] or 'on'}" + (" (keep)" if w["mode"] == "keep" else "") for w in fresh[:20])},
                           actor_id=ctx.get("operator_id", ""), actor_name=by)
    await db.commit()
    TP.invalidate(org)
    rows = await _all(db, org)
    return {"added": len(fresh), "skipped": len(wanted) - len(fresh), "rules": [_row(r) for r in rows],
            "max": org_rules.MAX_RULES, "enabled": sum(1 for r in rows if r.enabled is not False)}


async def _get(db: AsyncSession, org: str, rule_id: str) -> OrgExclusionRule:
    r = (await db.execute(select(OrgExclusionRule).where(OrgExclusionRule.id == rule_id, OrgExclusionRule.org_id == org))).scalars().first()
    if not r:
        raise HTTPException(status_code=404, detail="That rule isn't in your list.")
    return r


@router.put("/{rule_id}")
async def change_rule(rule_id: str, body: PatchIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    org = ctx["org_id"]
    r = await _get(db, org, rule_id)
    if body.updated_at and _iso(r.updated_at) != body.updated_at:
        raise HTTPException(status_code=409, detail="Someone else changed this rule. Reload the list and try again.")
    before = {"value": r.value or "", "enabled": r.enabled is not False, "label": r.label or ""}
    if body.value is not None and body.value != (r.value or ""):
        try:
            value = org_rules.clean_value(r.kind, body.value, r.mode)
        except ValueError as err:
            raise HTTPException(status_code=422, detail=str(err))
        clash = (await db.execute(select(OrgExclusionRule.id).where(OrgExclusionRule.org_id == org, OrgExclusionRule.kind == r.kind,
                                                                    OrgExclusionRule.value == value, OrgExclusionRule.mode == r.mode,
                                                                    OrgExclusionRule.id != r.id))).first()
        if clash:
            raise HTTPException(status_code=409, detail="That rule is already in your list.")
        r.value = value
    if body.label is not None:
        r.label = body.label[:120]
    if body.enabled is not None:
        r.enabled = bool(body.enabled)
    r.updated_at = datetime.utcnow()
    after = {"value": r.value or "", "enabled": r.enabled is not False, "label": r.label or ""}
    await audit.record(db, "org_exclusion.changed", target=f"{r.kind}:{r.value or 'on'}", detail={"from": ", ".join(f"{k}={v}" for k, v in before.items() if before[k] != after[k]) or "no change",
                                                                                                  "to": ", ".join(f"{k}={v}" for k, v in after.items() if before[k] != after[k]) or "no change"},
                       actor_id=ctx.get("operator_id", ""), actor_name=_who(ctx))
    await db.commit()
    TP.invalidate(org)
    return _row(r)


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    org = ctx["org_id"]
    r = await _get(db, org, rule_id)
    detail = {"kind": r.kind, "value": r.value or "", "mode": r.mode, "enabled": r.enabled is not False}
    await db.delete(r)
    await audit.record(db, "org_exclusion.removed", target=f"{detail['kind']}:{detail['value'] or 'on'}", detail=detail,
                       actor_id=ctx.get("operator_id", ""), actor_name=_who(ctx))
    await db.commit()
    TP.invalidate(org)
    return {"id": rule_id, "deleted": True}


@router.post("/preview")
async def preview(body: PreviewIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Companies left after the saved rules, after the saved rules with this edit applied, and with no organisation rules at all.
    Counted through the same search path a person's own search takes (BR.matching), never remembered. A number is None when counting took too long."""
    ctx = _admin(request)
    org = ctx["org_id"]
    from app.services import business_records as BR

    new, rejected = org_rules.parse_items(body.add_items)
    if rejected:
        return _bad("Some of that can't be used.", rejected)
    saved = await _all(db, org)
    drop = set(body.remove)
    live = []
    for r in saved:
        if r.id in drop:
            continue
        on = body.toggle.get(r.id, r.enabled is not False)
        if on:
            live.append({"kind": r.kind, "value": r.value or "", "mode": r.mode})
    have = {(x["kind"], x["value"], x["mode"]) for x in live}
    after_rules = live + [n for n in new if (n["kind"], n["value"], n["mode"]) not in have]
    base = await TP.org_effective(db, org)
    saved_rules = [{"kind": r.kind, "value": r.value or "", "mode": r.mode} for r in saved if r.enabled is not False]
    import time

    out: Dict[str, Any] = {}
    for name, rules in (("all", []), ("before", saved_rules), ("after", after_rules)):
        pol = base.with_rules(rules)
        key = f"{name}|{org}|{pol.hash()}" if name != "after" else ""
        hit = _COUNTS.get(key) if key else None
        if hit and time.monotonic() - hit[0] < _COUNTS_TTL:
            out[name] = hit[1]
            continue
        if name == "after" and after_rules == saved_rules:
            out[name] = out["before"]  # nothing to count again
            continue
        where, _n, _b = await BR.matching(db, BR.normalize_filters({}), pol.conditions(org), broaden=False, apply_policy=False)
        out[name] = await org_rules.count_where(db, where)
        if key and out[name] is not None:
            if len(_COUNTS) > 200:
                _COUNTS.clear()
            _COUNTS[key] = (time.monotonic(), out[name])
    out["leavesOut"] = (out["all"] - out["after"]) if out["all"] is not None and out["after"] is not None else None
    return out


@router.get("/history")
async def history(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    _admin(request)  # the audit log is already limited to this organisation by row-level security
    rows = await audit.recent(db, action=HISTORY_ACTION, limit=60) + await audit.recent(db, action="exclusions.moved_to_rules", limit=5)
    return {"changes": sorted(rows, key=lambda r: r.get("at") or "", reverse=True)}
