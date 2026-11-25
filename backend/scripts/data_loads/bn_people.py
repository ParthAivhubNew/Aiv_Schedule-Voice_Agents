"""Reads the officers (directors) of FSB's BN businesses from Companies House and saves them on each company, using the app's own people reader
(data_sources / data_source_connector). Only companies in /tmp/bn_population_ids.txt are read, and only ones never read before.
Free Companies House data; name, role and dates only. Stays under the registry's limit of 600 requests per 5 minutes (about 1.3 a second).
  python /tmp/bn_people.py --n 20        -> reads 20 companies (a test)
  python /tmp/bn_people.py --n 3000      -> reads up to 3,000
  python /tmp/bn_people.py --n 3000 --district BN1,BN3   -> only those districts
Safe to stop and start again: each company is marked once read.
"""
import asyncio, sys, time
from datetime import datetime

from sqlalchemy import text

from app.core.tenancy import system_scope
from app.database import AsyncSessionLocal
from app.models.models import BusinessRecord, DataSource
from app.services import business_records
from app.services import company_contacts as CC
from app.services import data_source_connector as connector

N = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 20
DIST = set(sys.argv[sys.argv.index("--district") + 1].upper().split(",")) if "--district" in sys.argv else set()
PACE = 0.8  # seconds per company: about 1.25 requests a second, under 600 per 5 minutes


async def main():
    nums = sorted({l.strip() for l in open("/tmp/bn_population_ids.txt") if l.strip()})
    with system_scope():
        async with AsyncSessionLocal() as db:
            source = await db.get(DataSource, "ds_companies_house")
            if not source or not source.api_key:
                print("The Companies House source has no API key saved. Save it under Data Sources first.")
                return
            q = ("SELECT id, registration_number FROM business_records WHERE registration_number = ANY(:n) AND people_checked_at IS NULL "
                 + ("AND split_part(upper(postcode),' ',1) = ANY(:d) " if DIST else "") + "ORDER BY md5(id) LIMIT :lim")
            params = {"n": nums, "lim": N}
            if DIST:
                params["d"] = list(DIST)
            todo = (await db.execute(text(q), params)).all()
            print(f"{len(todo)} companies to read (asked for {N}).", flush=True)
            done = with_people = failed = 0
            t0 = time.monotonic()
            for bid, regno in todo:
                started = time.monotonic()
                try:
                    got = await connector.fetch_people(source, regno, owners=False)
                except connector.RateLimited as err:
                    print(f"registry said slow down; waiting {int(err.wait)}s", flush=True)
                    await asyncio.sleep(err.wait)
                    continue
                except connector.KeyRejected as err:
                    print("Companies House rejected the API key:", err)
                    break
                except connector.ConnectorError as err:
                    failed += 1
                    print("failed", regno, str(err)[:100], flush=True)
                    continue
                biz = await db.get(BusinessRecord, bid)
                people = got.get("officers") or []
                for o in people:
                    o["v"] = CC.PEOPLE_V
                biz.officers = people
                biz.people_checked_at = datetime.utcnow()
                business_records.refresh_rank(biz)
                await db.commit()
                done += 1
                with_people += 1 if people else 0
                if done % 50 == 0:
                    print(f"progress: {done} of {len(todo)} read, {with_people} with directors, {time.monotonic() - t0:.0f}s", flush=True)
                spare = PACE - (time.monotonic() - started)
                if spare > 0:
                    await asyncio.sleep(spare)
            print(f"Done: {done} read, {with_people} with directors listed, {failed} failed, {time.monotonic() - t0:.0f}s.")


asyncio.run(main())
