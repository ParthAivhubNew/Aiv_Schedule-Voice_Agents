"""Stores the Appendix 1 district grid and its 3 summary rows in the database (app_settings "fsb_bid:appendix1"), so they can be shown from the software.
Needs /tmp/appendix1_final.csv and /tmp/appendix1_summary.csv. Safe to run again: it replaces the same record.
  python /tmp/bn_store_bid.py
"""
import asyncio, csv
from datetime import datetime

from app.database import AsyncSessionLocal
from app.models.models import AppSetting


def read(path):
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


async def main():
    grid, summary = read("/tmp/appendix1_final.csv"), read("/tmp/appendix1_summary.csv")
    assert len(grid) == 30, f"expected 30 district rows, found {len(grid)}"
    doc = {"saved_at": datetime.utcnow().isoformat() + "Z", "population": "Companies House active companies in FSB's 30 BN districts after FSB exclusion rules",
           "districts": grid, "summary": summary,
           "notes": ["Held data only, Apollo never counted.", "TPS/CTPS not screened (no Data Soap account yet)."]}
    async with AsyncSessionLocal() as db:
        row = await db.get(AppSetting, "fsb_bid:appendix1")
        if row:
            row.data = doc
        else:
            db.add(AppSetting(id="fsb_bid:appendix1", data=doc))
        await db.commit()
    total = sum(int(r["total_mailable"]) for r in grid)
    print(f"Stored: {len(grid)} districts, {total} companies, {len(summary)} summary rows, as app_settings 'fsb_bid:appendix1'.")


asyncio.run(main())
