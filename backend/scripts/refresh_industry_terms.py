"""Rebuilds the list of industries offered in Find Leads from the real values of business_records.industry.
Reads the whole column once (a minute or two on 6.7M rows) and stores about a thousand terms. Safe to run any time; run it after a bulk import.
  docker cp backend/scripts/refresh_industry_terms.py aivhub_backend:/tmp/refresh_industry_terms.py
  docker exec -i -e PYTHONPATH=/app -w /app aivhub_backend python /tmp/refresh_industry_terms.py
"""
import asyncio
import time

from app.core.tenancy import DEFAULT_ORG, set_org
from app.database import AsyncSessionLocal
from app.services import industry_index


async def main():
    set_org(DEFAULT_ORG)
    t0 = time.monotonic()
    async with AsyncSessionLocal() as db:
        n = await industry_index.refresh(db)
    print(f"{n:,} industries stored in {time.monotonic() - t0:.0f}s")


asyncio.run(main())
