"""Fill the search columns (sic_text, sic_codes, postcode, incorporated_on, size_band) for the
company records already imported, straight from the original rows kept in raw_data -- nothing is
re-downloaded and no existing column is changed (every write is COALESCE(new, existing)).

Safe to stop and restart: a row counts as done once its size_band is set ('unknown' when the file
gave no usable accounts category), and each batch commits on its own. Then it builds the indexes
the filters need (CONCURRENTLY, so the app keeps working meanwhile).

    python scripts/backfill_business_records.py --dry-run     # show what 5 rows would become, write nothing
    python scripts/backfill_business_records.py               # backfill, then build the indexes
    python scripts/backfill_business_records.py --indexes-only
"""
import argparse
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402
from app.services.business_records import SIZE_BANDS  # noqa: E402

SOURCE = "ds_companies_house"
BATCH = 20000


def _k(key: str) -> str:
    """A Companies House column, tolerating the stray leading space some of its headers carry."""
    return f"COALESCE(ch->>'{key}', ch->>' {key}')"


_BAND_CASE = "CASE upper(btrim({k})) {whens} ELSE 'unknown' END".format(
    k=_k("Accounts.AccountCategory"),
    whens=" ".join(f"WHEN '{raw}' THEN '{band}'" for raw, band in SIZE_BANDS.items()),
)
_SIC_TEXT = "NULLIF(concat_ws(' | ', {}), '')".format(
    ", ".join(f"NULLIF(btrim({_k(f'SICCode.SicText_{i}')}), '')" for i in range(1, 5))
)

_CALC = rf"""
WITH batch AS (
    SELECT id, raw_data->'{SOURCE}' AS ch, incorporation_date
    FROM business_records WHERE id > :last AND size_band IS NULL ORDER BY id LIMIT :n
), calc AS (
    SELECT id,
        {_SIC_TEXT} AS sic_text,
        NULLIF(upper(btrim({_k('RegAddress.PostCode')})), '') AS postcode,
        CASE WHEN incorporation_date ~ '^\d{{2}}/\d{{2}}/\d{{4}}$' THEN to_date(incorporation_date, 'DD/MM/YYYY')
             WHEN incorporation_date ~ '^\d{{4}}-\d{{2}}-\d{{2}}' THEN to_date(left(incorporation_date, 10), 'YYYY-MM-DD') END AS born,
        {_BAND_CASE} AS band
    FROM batch
)
"""

_PREVIEW = _CALC + """
SELECT c.id, c.sic_text, c.postcode, c.born, c.band FROM calc c WHERE c.sic_text IS NOT NULL LIMIT 5
"""

_UPDATE = _CALC + r"""
UPDATE business_records r SET
    sic_text = COALESCE(c.sic_text, r.sic_text),
    sic_codes = COALESCE((SELECT '|' || string_agg(DISTINCT m[1], '|') || '|'
                          FROM regexp_matches(c.sic_text, '(?<!\d)(\d{4,5})(?!\d)\s*-', 'g') AS m), r.sic_codes),
    postcode = COALESCE(c.postcode, r.postcode),
    incorporated_on = COALESCE(c.born, r.incorporated_on),
    size_band = COALESCE(NULLIF(c.band, 'unknown'), r.size_band, 'unknown')
FROM calc c WHERE r.id = c.id RETURNING r.id
"""

_INDEXES = (
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_sic_text_trgm ON business_records USING GIN (sic_text gin_trgm_ops)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_sic_codes_trgm ON business_records USING GIN (sic_codes gin_trgm_ops)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_postcode_prefix ON business_records (postcode varchar_pattern_ops)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_incorporated_on ON business_records (incorporated_on)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_size_band ON business_records (size_band)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_status_lower ON business_records (lower(status))",
)


async def remaining() -> int:
    async with engine.connect() as conn:
        return int((await conn.execute(text("SELECT count(*) FROM business_records WHERE size_band IS NULL"))).scalar() or 0)


async def backfill() -> None:
    todo = await remaining()
    print(f"{todo:,} records still to fill.")
    done, last, started = 0, "", time.time()
    while True:
        async with engine.begin() as conn:
            ids = [r[0] for r in (await conn.execute(text(_UPDATE), {"last": last, "n": BATCH})).all()]
        if not ids:
            break
        last, done = max(ids), done + len(ids)
        rate = done / max(time.time() - started, 1)
        print(f"  {done:,}/{todo:,} filled  ({rate:,.0f} rows/s, ~{max(todo - done, 0) / max(rate, 1) / 60:.0f} min left)", flush=True)
    print(f"Backfill finished: {done:,} records filled.")


async def build_indexes() -> None:
    async with engine.connect() as conn:
        conn = await conn.execution_options(isolation_level="AUTOCOMMIT")
        await conn.execute(text("SET maintenance_work_mem = '512MB'"))
        for statement in _INDEXES:
            name = statement.split("EXISTS ")[1].split(" ON")[0]
            started = time.time()
            print(f"Building {name} ...", flush=True)
            await conn.execute(text(statement))
            print(f"  done in {time.time() - started:.0f}s", flush=True)


async def main(args) -> None:
    if args.dry_run:
        async with engine.connect() as conn:
            rows = (await conn.execute(text(_PREVIEW), {"last": "", "n": 2000})).all()
        print(f"{await remaining():,} records still to fill. Sample of what would be written (nothing is written):")
        for r in rows:
            print(f"  {r.id}: sic_text={r.sic_text!r} postcode={r.postcode!r} incorporated_on={r.born} size_band={r.band}")
        return
    if not args.indexes_only:
        await backfill()
    if not args.skip_indexes:
        await build_indexes()
    print("All done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--indexes-only", action="store_true")
    parser.add_argument("--skip-indexes", action="store_true")
    asyncio.run(main(parser.parse_args()))
