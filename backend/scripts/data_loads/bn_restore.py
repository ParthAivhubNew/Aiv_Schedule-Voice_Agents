"""Puts the sample companies back exactly as they were before bn_sample500.py ran (use after a run was killed before its own restore).
Reads /tmp/bn_sample500_backup.json, written when the run started.
  python /tmp/bn_restore.py            -> shows what would change, changes nothing
  python /tmp/bn_restore.py --go       -> restores
"""
import asyncio, json, os, sys
from datetime import datetime

from sqlalchemy import text

from app.database import AsyncSessionLocal

GO = "--go" in sys.argv
PATH = "/tmp/bn_sample500_backup.json"


async def main():
    snap = json.load(open(PATH))
    started = datetime.utcfromtimestamp(os.path.getmtime(PATH))
    ids = [r["id"] for r in snap]
    print(f"Backup: {len(snap)} companies, taken {started:%Y-%m-%d %H:%M} UTC")
    async with AsyncSessionLocal() as db:
        cur = {r["id"]: r for r in (await db.execute(text(
            "SELECT id, raw_data::text AS raw, shared_research::text AS sr, website, domain, phone, email FROM business_records WHERE id = ANY(:ids)"),
            {"ids": ids})).mappings().all()}
        changed = [r["id"] for r in snap if r["id"] in cur and any(
            (cur[r["id"]][k] or "") != (r[k2] or "") for k, k2 in (("raw", "raw"), ("sr", "sr"), ("website", "website"), ("domain", "domain"), ("phone", "phone"), ("email", "email")))]
        extra = (await db.execute(text("SELECT count(*) FROM company_contact_points WHERE business_record_id = ANY(:ids) AND found_at >= :s"),
                                  {"ids": ids, "s": started})).scalar()
        print(f"Companies that differ from the backup: {len(changed)}; contact points added since: {extra}")
        if not GO:
            print("Nothing changed. Re-run with --go to restore.")
            return
        for r in snap:
            await db.execute(text(
                "UPDATE business_records SET raw_data = CAST(:raw AS json), shared_research = CAST(:sr AS json), website = :website, "
                "domain = :domain, phone = :phone, email = :email, rank_score = :rank_score, updated_at = :updated_at WHERE id = :id"),
                {k: r[k] for k in ("raw", "sr", "website", "domain", "phone", "email", "rank_score", "updated_at", "id")})
        gone = await db.execute(text("DELETE FROM company_contact_points WHERE business_record_id = ANY(:ids) AND found_at >= :s"), {"ids": ids, "s": started})
        await db.commit()
        print(f"Restored {len(snap)} companies; removed {gone.rowcount} contact points added since the run started.")


asyncio.run(main())
