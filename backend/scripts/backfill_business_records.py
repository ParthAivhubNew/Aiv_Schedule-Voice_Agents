"""Fill the search columns (sic_text, sic_codes, postcode, incorporated_on, size_band) for the
company records already imported, straight from the original rows kept in raw_data -- nothing is
re-downloaded and no existing column is changed (every write is COALESCE(new, existing)).

Safe to stop and restart: a row counts as done once its size_band is set ('unknown' when the file
gave no usable accounts category), and each batch commits on its own. Then it builds the indexes
the filters need (CONCURRENTLY, so the app keeps working meanwhile).

    python scripts/backfill_business_records.py --dry-run     # show what 5 rows would become, write nothing
    python scripts/backfill_business_records.py               # backfill, then build the indexes
    python scripts/backfill_business_records.py --indexes-only   # rebuild the indexes only (also after an interrupted run)
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


_CH = f"(r.raw_data->'{SOURCE}')"


def _k(key: str) -> str:
    """A Companies House column, tolerating the stray leading space some of its headers carry."""
    return f"COALESCE({_CH}->>'{key}', {_CH}->>' {key}')"


_BAND_CASE = "CASE upper(btrim({k})) {whens} ELSE 'unknown' END".format(
    k=_k("Accounts.AccountCategory"),
    whens=" ".join(f"WHEN '{raw}' THEN '{band}'" for raw, band in SIZE_BANDS.items()),
)
_SIC_TEXT = "NULLIF(concat_ws(' | ', {}), '')".format(
    ", ".join(f"NULLIF(btrim({_k(f'SICCode.SicText_{i}')}), '')" for i in range(1, 5))
)
_POSTCODE = f"NULLIF(upper(btrim({_k('RegAddress.PostCode')})), '')"
_BORN = (r"CASE WHEN r.incorporation_date ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(r.incorporation_date, 'DD/MM/YYYY') "
         r"WHEN r.incorporation_date ~ '^\d{4}-\d{2}-\d{2}' THEN to_date(left(r.incorporation_date, 10), 'YYYY-MM-DD') END")

# One batch is chosen first (just the ids, cheap, in primary-key order), then updated by those ids.
# Updating "FROM a CTE that has a LIMIT" let Postgres plan a scan of the whole table for every batch.
_PICK = "SELECT id FROM business_records WHERE id > :last AND size_band IS NULL ORDER BY id LIMIT :n"

_PREVIEW = f"""
SELECT r.id, {_SIC_TEXT} AS sic_text, {_POSTCODE} AS postcode, {_BORN} AS born, {_BAND_CASE} AS band
FROM business_records r WHERE r.id = ANY(CAST(:ids AS text[])) AND {_SIC_TEXT} IS NOT NULL LIMIT 5
"""

_UPDATE = rf"""
UPDATE business_records r SET
    sic_text = COALESCE({_SIC_TEXT}, r.sic_text),
    sic_codes = COALESCE((SELECT '|' || string_agg(DISTINCT m[1], '|') || '|'
                          FROM regexp_matches(COALESCE({_SIC_TEXT}, ''), '(?<!\d)(\d{{4,5}})(?!\d)\s*-', 'g') AS m), r.sic_codes),
    postcode = COALESCE({_POSTCODE}, r.postcode),
    incorporated_on = COALESCE({_BORN}, r.incorporated_on),
    size_band = COALESCE(NULLIF({_BAND_CASE}, 'unknown'), r.size_band, 'unknown')
WHERE r.id = ANY(CAST(:ids AS text[])) RETURNING r.id
"""

# The text-search indexes that already exist. Every UPDATE of a row has to add entries to each of them,
# which turns a multi-million-row backfill into hours -- so they are dropped first and rebuilt after.
_TRGM_COLUMNS = ("name", "domain", "registration_number", "industry", "region", "email", "phone")

_INDEXES = (
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_sic_text_trgm ON business_records USING GIN (sic_text gin_trgm_ops)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_sic_codes_trgm ON business_records USING GIN (sic_codes gin_trgm_ops)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_postcode_prefix ON business_records (postcode varchar_pattern_ops)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_incorporated_on ON business_records (incorporated_on)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_size_band ON business_records (size_band)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_status_lower ON business_records (lower(status))",
) + tuple(
    f"CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_{col}_trgm ON business_records USING GIN ({col} gin_trgm_ops)"
    for col in _TRGM_COLUMNS
)


async def remaining() -> int:
    async with engine.connect() as conn:
        return int((await conn.execute(text("SELECT count(*) FROM business_records WHERE size_band IS NULL"))).scalar() or 0)


async def drop_slow_indexes() -> None:
    async with engine.begin() as conn:
        for col in _TRGM_COLUMNS:
            await conn.execute(text(f"DROP INDEX IF EXISTS ix_business_records_{col}_trgm"))
    print("Dropped the text-search indexes for now (rebuilt at the end). If this is interrupted, run with --indexes-only.", flush=True)


async def backfill() -> None:
    todo = await remaining()
    print(f"{todo:,} records still to fill.")
    done, last, started = 0, "", time.time()
    while True:
        async with engine.begin() as conn:
            await conn.execute(text("SET LOCAL enable_seqscan = off"))  # always reach rows through the primary key
            picked = [r[0] for r in (await conn.execute(text(_PICK), {"last": last, "n": BATCH})).all()]
            if not picked:
                break
            ids = [r[0] for r in (await conn.execute(text(_UPDATE), {"ids": picked})).all()]
        last, done = max(picked), done + len(ids)
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
            picked = [r[0] for r in (await conn.execute(text(_PICK), {"last": "", "n": 2000})).all()]
            rows = (await conn.execute(text(_PREVIEW), {"ids": picked})).all()
        print(f"{await remaining():,} records still to fill. Sample of what would be written (nothing is written):")
        for r in rows:
            print(f"  {r.id}: sic_text={r.sic_text!r} postcode={r.postcode!r} incorporated_on={r.born} size_band={r.band}")
        return
    if not args.indexes_only:
        if not args.keep_indexes:
            await drop_slow_indexes()
        await backfill()
    if not args.skip_indexes:
        await build_indexes()
    print("All done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--indexes-only", action="store_true")
    parser.add_argument("--skip-indexes", action="store_true")
    parser.add_argument("--keep-indexes", action="store_true", help="don't drop the existing text-search indexes first (much slower)")
    asyncio.run(main(parser.parse_args()))
