"""Repair company records that a live lookup once overwrote with raw register codes.

A lookup used to replace "Private Limited Company" with "ltd", "69201 - Accounting and auditing activities" with "69201"
and "Active" with "active" (see business_records.upsert; it no longer does). This puts the readable form back:

  * company_category   a register type code becomes its label
  * status             a lower-case word gets its capital
  * industry           a bare code list is replaced by the sector text when sic_text still has it

Safe to run twice. It works in batches of ids and commits after each, so it can be stopped at any point.

    python scripts/renormalise_business_records.py --dry-run     # count what would change, write nothing
    python scripts/renormalise_business_records.py
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402
from app.services.normalise import CATEGORY_LABELS  # noqa: E402

BATCH = 20000

_CATEGORY_CASE = "CASE lower(company_category) " + " ".join(
    f"WHEN '{code}' THEN '{label}'" for code, label in CATEGORY_LABELS.items()) + " ELSE company_category END"

STEPS = {
    "company_category": (
        f"UPDATE business_records SET company_category = {_CATEGORY_CASE} WHERE id IN "
        f"(SELECT id FROM business_records WHERE lower(company_category) IN ({', '.join(repr(c) for c in CATEGORY_LABELS)}) AND company_category = lower(company_category) LIMIT :n)",
        f"SELECT count(*) FROM business_records WHERE company_category = lower(company_category) AND lower(company_category) IN ({', '.join(repr(c) for c in CATEGORY_LABELS)})",
    ),
    "status": (
        "UPDATE business_records SET status = upper(left(status, 1)) || substr(status, 2) WHERE id IN "
        "(SELECT id FROM business_records WHERE status ~ '^[a-z][a-z-]*$' LIMIT :n)",
        "SELECT count(*) FROM business_records WHERE status ~ '^[a-z][a-z-]*$'",
    ),
    "industry": (
        "UPDATE business_records SET industry = sic_text WHERE id IN "
        "(SELECT id FROM business_records WHERE industry ~ '^[0-9][0-9,; ]*$' AND sic_text ~ ' - ' LIMIT :n)",
        "SELECT count(*) FROM business_records WHERE industry ~ '^[0-9][0-9,; ]*$' AND sic_text ~ ' - '",
    ),
}


async def main(dry: bool) -> None:
    async with engine.connect() as conn:
        for name, (update, count) in STEPS.items():
            todo = (await conn.execute(text(count))).scalar() or 0
            print(f"{name}: {todo:,} records to repair")
            if dry or not todo:
                continue
            done = 0
            while True:
                res = await conn.execute(text(update), {"n": BATCH})
                await conn.commit()
                if not res.rowcount:
                    break
                done += res.rowcount
                print(f"  {done:,} repaired")
    print("dry run: nothing written" if dry else "finished")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    asyncio.run(main(ap.parse_args().dry_run))
