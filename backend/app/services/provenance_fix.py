"""One-off repairs for where values came from (plan 10, Phase 1, items 3 and 5). Each is a dry run unless apply=True, and reports what it
would change, so staff see the numbers before anything is written (POST /admin-api/maintenance/provenance).

- relabel_contact_points: before Phase 1 the contact list filed a company record's own website, phone and email as "record" with
  confidence "register" whenever the record was a register's, and every bulk dataset as "register". So a value from the BN file or the
  web scrape counted as published by Companies House. Each such row now gets the source that really lists the value (contact_points.
  points_of). A "register" row is only changed when a source still lists the value, so nothing a register published is lost.
- backfill_field_sources: saved companies whose phone, email or website has no recorded source get the source that lists the same value
  on their company record (data_policy.value_source), or "import" for a company that came from the company's own file when no source
  lists it. A value nothing explains is left alone.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List

from sqlalchemy import select, text

BATCH = 500
LABELLED = ("record", "register")  # the labels the old code gave by default; picked, research, web, social and linkedin were explicit
FIELDS = ("phone", "email", "website")


def _chunks(items: List[Any], n: int = BATCH):
    for i in range(0, len(items), n):
        yield items[i:i + n]


async def relabel_contact_points(apply: bool = False) -> Dict[str, Any]:
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import BusinessRecord, CompanyContactPoint as P
    from app.services import contact_points as CP

    changes: Counter = Counter()
    rows = 0
    with system_scope():
        async with AsyncSessionLocal() as db:
            ids = [r for (r,) in (await db.execute(text(
                "SELECT DISTINCT business_record_id FROM company_contact_points WHERE source IN ('record', 'register')"))).all()]
            for chunk in _chunks(ids):
                recs = (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(chunk)))).scalars().all()
                want = {r.id: {(p["kind"], p["norm"]): p for p in CP.points_of(r)} for r in recs}
                for pt in (await db.execute(select(P).where(P.business_record_id.in_(chunk), P.source.in_(LABELLED)))).scalars().all():
                    w = want.get(pt.business_record_id, {}).get((pt.kind, pt.norm))
                    if w is None:
                        if pt.source == "register":
                            continue  # no source lists it any more: keep the register's claim rather than guess
                        new = ("record", "found")
                    else:
                        new = (w["source"], w["confidence"])
                    if (pt.source, pt.confidence) != new:
                        changes[f"{pt.source}/{pt.confidence} -> {new[0]}/{new[1]}"] += 1
                        rows += 1
                        if apply:
                            pt.source, pt.confidence = new
                if apply:
                    await db.commit()
                else:
                    await db.rollback()
    return {"records": len(ids), "rows": rows, "changes": dict(changes.most_common()), "applied": apply}


async def backfill_field_sources(apply: bool = False) -> Dict[str, Any]:
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import BusinessRecord, LeadAccount
    from app.services import data_policy as DP

    found: Counter = Counter()
    leads = values = 0
    unexplained = 0
    with system_scope():
        async with AsyncSessionLocal() as db:
            ids = [r for (r,) in (await db.execute(text(
                "SELECT id FROM lead_accounts WHERE coalesce(phone, '') <> '' OR coalesce(email, '') <> '' OR coalesce(website, '') <> '' ORDER BY id"))).all()]
            for chunk in _chunks(ids):
                accts = (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(chunk)))).scalars().all()
                want = list({a.business_record_id for a in accts if a.business_record_id})
                recs = {r.id: r for r in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(want)))).scalars().all()} if want else {}
                for a in accts:
                    have = dict(a.field_sources or {})
                    add: Dict[str, str] = {}
                    for f in FIELDS:
                        value = str(getattr(a, f, "") or "").strip()
                        if not value or have.get(f):
                            continue
                        rec = recs.get(a.business_record_id or "")
                        src = DP.value_source(rec, f, value) if rec is not None else ""
                        if not src and (a.source or "") == "import":
                            src = "import"
                        if src:
                            add[f] = src
                            found[DP.public_source(src)] += 1
                        else:
                            unexplained += 1
                    if add:
                        leads += 1
                        values += len(add)
                        if apply:
                            a.field_sources = {**have, **add}
                if apply:
                    await db.commit()
                else:
                    await db.rollback()
    return {"leadsChecked": len(ids), "leadsChanged": leads, "values": values, "bySource": dict(found.most_common()),
            "leftAlone": unexplained, "applied": apply}
