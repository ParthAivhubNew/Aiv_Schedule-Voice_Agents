"""Fill company_contact_points for the companies already stored: reads each company record (its columns, raw_data and shared_research) and lists every
website, phone, email and social page it holds. Safe to run again at any time, and to stop: it only adds what is missing.

    python scripts/sync_contact_points.py --dry-run --limit 5000     # count what would be added for the first 5000 companies, write nothing
    python scripts/sync_contact_points.py                            # every company
"""
import argparse
import asyncio
import os
import sys
import time
import uuid
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from sqlalchemy import select  # noqa: E402
from sqlalchemy.dialects.postgresql import insert  # noqa: E402

from app.database import AsyncSessionLocal  # noqa: E402
from app.models.models import BusinessRecord, CompanyContactPoint  # noqa: E402
from app.services import contact_points as CP  # noqa: E402

BATCH = 500


async def main(dry: bool, limit: int) -> None:
    done = added = with_points = 0
    last = ""
    started = time.monotonic()
    while True:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(BusinessRecord).where(BusinessRecord.id > last).order_by(BusinessRecord.id).limit(BATCH))).scalars().all()
            if not rows:
                break
            last = rows[-1].id
            now = datetime.utcnow()
            batch = []
            for biz in rows:
                pts = CP.points_of(biz)
                with_points += 1 if pts else 0
                for p in pts:
                    batch.append({"id": f"cp_{uuid.uuid4().hex[:16]}", "business_record_id": biz.id, "kind": p["kind"], "value": p["value"], "norm": p["norm"],
                                  "owner": p["owner"], "source": p["source"], "confidence": p["confidence"], "found_at": now, "last_seen_at": now})
            if batch and not dry:
                res = await db.execute(insert(CompanyContactPoint).values(batch).on_conflict_do_nothing(constraint="uq_contact_point"))
                await db.commit()
                added += res.rowcount or 0
            elif batch:
                added += len(batch)
            done += len(rows)
        print(f"{done:,} companies read, {with_points:,} with a contact, {added:,} {'would be ' if dry else ''}added, {time.monotonic() - started:.0f}s", flush=True)
        if limit and done >= limit:
            break


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    asyncio.run(main(a.dry_run, a.limit))
