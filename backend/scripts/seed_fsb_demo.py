"""Sets up (or resets) the FSB demo account: its own organisation, FSB brand, Admin login, a sample import with a review queue,
a change report for the last 31 days and a list of saved companies. Safe to run again: whatever is already there is left alone.

On the server, like the scripts in scratch/fsb_bid_scripts (copy make_fsb_test_file.py next to it to build the file from the BN companies we hold):

  docker cp backend/scripts/seed_fsb_demo.py aivhub_backend:/tmp/seed_fsb_demo.py
  docker cp backend/scripts/make_fsb_test_file.py aivhub_backend:/tmp/make_fsb_test_file.py
  docker exec -i -e PYTHONPATH=/app -w /app aivhub_backend python /tmp/seed_fsb_demo.py
  docker exec -i -e PYTHONPATH=/app -w /app aivhub_backend python /tmp/seed_fsb_demo.py --reset

The login password is FSB_DEMO_PASSWORD (the default demo password when it is unset). --reset removes only what this script made in the demo
organisation (its import and rows, its report, its list and the companies it saved), then seeds again. Nothing outside org_fsb_demo is touched.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
from datetime import datetime, timedelta
from typing import Any, Dict, List, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
for extra in (os.path.join(HERE, ".."), HERE, "/tmp", "/app/scripts"):
    if extra not in sys.path:
        sys.path.append(extra)

FILENAME = "fsb_salesforce_accounts_demo.csv"
LIST_NAME = "FSB prospects"
MARK = "Saved by the FSB demo seed"  # on every company this script saves, so a reset removes only those
STATE_KEY = "fsb_demo_seed:org_fsb_demo"
WANT_ROWS = 200
SAVE_COMPANIES = 8

SYNTHETIC = [
    ("Seaview Joinery Ltd", "BN1 1AA", "12 Marine Parade", "Brighton"), ("Downland Accounting Limited", "BN2 3BB", "4 Church Road", "Brighton"),
    ("Hove Bakes & Cakes Ltd", "BN3 2CC", "7 Western Road", "Hove"), ("Lewes Design Studio Ltd", "BN7 1DD", "3 High Street", "Lewes"),
    ("Worthing Electrical Services Ltd", "BN11 4EE", "21 Montague Street", "Worthing"), ("Shoreham Marine Supplies Limited", "BN43 5FF", "9 Brunswick Road", "Shoreham-by-Sea"),
    ("Bexhill Garden Care Ltd", "BN3 3GG", "15 Station Road", "Hove"), ("Newhaven Print Works Ltd", "BN9 9HH", "2 Fort Road", "Newhaven"),
    ("J Smith Plumbing", "BN1 4JJ", "", "Brighton"), ("A Patel Decorating", "BN2 5KK", "", "Brighton"),
]


def _synthetic_rows() -> List[Dict[str, str]]:
    from make_fsb_test_file import salesforce_id

    rng = random.Random(7)
    return [{"Account ID": salesforce_id(rng), "Account Name": n, "Company Number": "", "Billing Street": street, "Billing City": city,
             "Billing Postal Code": pc, "Phone": "", "Website": ""} for n, pc, street, city in SYNTHETIC]


async def _file_rows() -> Tuple[List[Dict[str, str]], str]:
    """(rows, where they came from): built from the BN companies we hold when there are enough, else a small made-up file."""
    try:
        import make_fsb_test_file as T
    except ImportError:
        print("note: make_fsb_test_file.py was not found next to this script; using the small made-up file.")
        return [], "synthetic"
    active, dissolved, renamed = await T._load("BN")
    if len(active) < 150:
        print(f"note: only {len(active)} active BN companies are held here; using the small made-up file (every row will be 'no match').")
        return _synthetic_rows(), "synthetic"
    rows, _expected, warnings = T.build_rows(active, dissolved, renamed, random.Random(2026))
    for w in warnings:
        print("note:", w)
    return rows[:max(WANT_ROWS, 1)], "business_records"


async def _state(db) -> Dict[str, Any]:
    from app.models.models import AppSetting

    row = await db.get(AppSetting, STATE_KEY)
    return dict(row.data or {}) if row else {}


async def _save_state(db, data: Dict[str, Any]) -> None:
    from app.models.models import AppSetting

    row = await db.get(AppSetting, STATE_KEY)
    if row:
        row.data = data
    else:
        db.add(AppSetting(id=STATE_KEY, data=data))
    await db.flush()


async def reset(org: str) -> Dict[str, int]:
    """Deletes what a previous run made, found through the ids it recorded, inside the demo organisation only."""
    from sqlalchemy import delete

    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import AppSetting, ChangeReport, FsbImport, FsbImportRow, LeadAccount
    from app.services import credits as K

    gone = {"imports": 0, "rows": 0, "reports": 0, "accounts": 0, "lists": 0}
    with org_scope(org):
        async with AsyncSessionLocal() as db:
            st = await _state(db)
            for imp_id in st.get("import_ids", []):
                gone["rows"] += (await db.execute(delete(FsbImportRow).where(FsbImportRow.import_id == imp_id, FsbImportRow.org_id == org))).rowcount or 0
                gone["imports"] += (await db.execute(delete(FsbImport).where(FsbImport.id == imp_id, FsbImport.org_id == org))).rowcount or 0
            for period in st.get("report_periods", []):
                gone["reports"] += (await db.execute(delete(ChangeReport).where(ChangeReport.period == period, ChangeReport.org_id == org))).rowcount or 0
            ids = st.get("account_ids", [])
            if ids:
                gone["accounts"] += (await db.execute(delete(LeadAccount).where(LeadAccount.id.in_(ids), LeadAccount.org_id == org, LeadAccount.notes == MARK))).rowcount or 0
            key = f"leadlists:{org}"
            doc = await K._get_doc(db, key)
            lists = list(doc.get("lists") or [])
            keep = [l for l in lists if l.get("id") not in st.get("list_ids", [])]
            if len(keep) != len(lists):
                await K._put_doc(db, key, {**doc, "lists": keep})
                gone["lists"] = len(lists) - len(keep)
            row = await db.get(AppSetting, STATE_KEY)
            if row:
                await db.delete(row)
            await db.commit()
    return gone


async def seed(org: str) -> Dict[str, Any]:
    from sqlalchemy import select

    from app.api import lead_accounts as LA
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import FsbImport, FsbImportRow
    from app.services import change_report as CR
    from app.services import fsb_import as FI

    out: Dict[str, Any] = {}
    with org_scope(org):
        async with AsyncSessionLocal() as db:
            st = await _state(db)
            have = (await db.execute(select(FsbImport).where(FsbImport.filename == FILENAME).order_by(FsbImport.created_at.desc()))).scalars().first()
        if have:
            imp_id, out["import"] = have.id, "already there"
        else:
            rows, origin = await _file_rows()
            if not rows:
                rows, origin = _synthetic_rows(), "synthetic"
            parsed, dropped = FI.parse_json_rows(rows)
            async with AsyncSessionLocal() as db:
                imp = await FI.create_import(db, parsed, filename=FILENAME, user_id="FSB demo seed", dropped=dropped)
                imp_id = imp.id
                await db.commit()
            await FI.run_matching(org, imp_id)
            out["import"] = f"{len(parsed)} rows from {origin}"
            st["import_ids"] = [*st.get("import_ids", []), imp_id]
        async with AsyncSessionLocal() as db:
            imp = await db.get(FsbImport, imp_id)
            out["status"] = imp.status if imp else "missing"
            out["counts"] = await FI.counts(db, imp_id)
            if imp and imp.status == "failed":
                print("note: the import failed:", imp.error)
            today = datetime.utcnow().date()
            rep, _created = await CR.run_report(db, org, today - timedelta(days=31), today)
            out["report"] = {"period": rep.period, "changes": rep.row_count, "text": (rep.summary or {}).get("text", "")}
            st["report_periods"] = sorted({*st.get("report_periods", []), rep.period})
            await db.commit()
        async with AsyncSessionLocal() as db:
            picked = (await db.execute(select(FsbImportRow).where(FsbImportRow.import_id == imp_id, FsbImportRow.match_status.in_(("auto", "accepted")))
                                       .order_by(FsbImportRow.id).limit(SAVE_COMPANIES))).scalars().all()
            from app.models.models import BusinessRecord

            nums = [r.match_company_number for r in picked]
            recs = (await db.execute(select(BusinessRecord).where(BusinessRecord.registration_number.in_(nums)))).scalars().all() if nums else []
            accounts = [LA.AccountIn(name=b.name, postcode=b.postcode or "", registration_number=b.registration_number or "", business_record_id=b.id,
                                     region=(b.region or ""), notes=MARK) for b in recs]
            if not accounts:  # no matched company (the made-up file): save the file's own rows by name
                accounts = [LA.AccountIn(name=r.name, postcode=r.postcode, address=r.address, notes=MARK) for r in
                            (await db.execute(select(FsbImportRow).where(FsbImportRow.import_id == imp_id).order_by(FsbImportRow.id).limit(SAVE_COMPANIES))).scalars().all()]
            saved = await LA.save_accounts(db, LA.AccountsIn(accounts=accounts, list_name=LIST_NAME), "FSB demo seed") if accounts else {}
            from app.api import lead_lists as LL

            lists = await LL._load(db)
            mine = next((l for l in lists if l["name"].lower() == LIST_NAME.lower()), None)
            out["list"] = {"name": LIST_NAME, "companies": len(mine["ids"]) if mine else 0}
            if mine:
                st["list_ids"] = sorted({*st.get("list_ids", []), mine["id"]})
                st["account_ids"] = sorted({*st.get("account_ids", []), *[i for i in mine["ids"]]})
            await _save_state(db, st)
            await db.commit()
            out["saved"] = {k: saved.get(k) for k in ("added", "matched", "skipped") if k in saved}
    return out


async def main() -> None:
    ap = argparse.ArgumentParser(description="Seed or reset the FSB demo account and its sample data.")
    ap.add_argument("--reset", action="store_true", help="remove what this script made in the demo organisation, then seed again")
    a = ap.parse_args()
    from app.services import fsb_demo as D
    from app.database import engine

    async with engine.begin() as conn:
        who = await D.ensure_demo_account(conn)
    await D.ensure_demo_data()
    if a.reset:
        print("reset:", await reset(D.ORG_ID))
    result = await seed(D.ORG_ID)
    print("=" * 60)
    print(" FSB DEMO ACCOUNT READY")
    print("=" * 60)
    print(f" Organisation : {D.ORG_NAME} ({who['org_id']}), brand {D.BRAND_NAME} ({who['brand_id']})")
    print(f" Sign in      : {D.EMAIL} (or {D.USERNAME}); password from FSB_DEMO_PASSWORD" + ("" if os.environ.get("FSB_DEMO_PASSWORD") is not None else " (unset: default demo password)"))
    print(f" Import       : {result.get('import')}, status {result.get('status')}, rows by outcome {result.get('counts')}")
    print(f" Change report: {result.get('report')}")
    print(f" List         : {result.get('list')}")
    print(f" Credits      : {D.STARTER_CREDITS} in each of voice, leadgen, scheduler (hidden in the screens by the brand)")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
