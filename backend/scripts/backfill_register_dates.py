"""Fill the register's filing dates (accounts_due_on, last_accounts_on, confstmt_due_on, last_confstmt_on) for the company
records already imported, straight from the Companies House row kept in raw_data. Nothing is re-downloaded, and a column
that already holds a date is left alone (new imports keep them current).

Safe on the full register, and safe to run while the app is live:
  * rows are read in the order they sit on disk, a block range per batch, and each batch commits on its own;
  * the new columns have no index while this runs, so an update that fits on its page is done in place (HOT) without
    adding index entries; nothing is dropped, so search keeps working throughout;
  * the indexes are built at the end with CREATE INDEX CONCURRENTLY, which never locks the table.
Stop it any time; run it again and it carries on (a row that already has its dates is skipped), or pass --from-block.

    python scripts/backfill_register_dates.py --dry-run        # show what 5 rows would get, write nothing
    python scripts/backfill_register_dates.py                  # backfill, then build the indexes
    python scripts/backfill_register_dates.py --indexes-only   # build the indexes only
"""
import argparse
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402
from app.services.business_records import REGISTER_DATES  # noqa: E402

SOURCE = "ds_companies_house"
BLOCKS_PER_BATCH = 800
_CH = f"(r.raw_data->'{SOURCE}')"


def _k(key: str) -> str:
    """A Companies House column, tolerating the stray leading space some of its headers carry."""
    return f"btrim(COALESCE({_CH}->>'{key}', {_CH}->>' {key}'))"


def _date(key: str) -> str:
    v = _k(key)
    return (rf"CASE WHEN {v} ~ '^\d{{2}}/\d{{2}}/\d{{4}}$' THEN to_date({v}, 'DD/MM/YYYY') "
            rf"WHEN {v} ~ '^\d{{4}}-\d{{2}}-\d{{2}}' THEN to_date(left({v}, 10), 'YYYY-MM-DD') END")


_COLS = {col: _date(header) for col, (header, _) in REGISTER_DATES.items()}
_TODO = (f"{_CH} IS NOT NULL AND r.accounts_due_on IS NULL AND r.confstmt_due_on IS NULL "
         f"AND (({_COLS['accounts_due_on']}) IS NOT NULL OR ({_COLS['confstmt_due_on']}) IS NOT NULL)")

_UPDATE = ("UPDATE business_records r SET " + ", ".join(f"{c} = COALESCE(r.{c}, {expr})" for c, expr in _COLS.items())
           + " WHERE r.ctid >= '({lo},0)'::tid AND r.ctid < '({hi},0)'::tid AND " + _TODO)

_PREVIEW = ("SELECT r.id, " + ", ".join(f"{expr} AS {c}" for c, expr in _COLS.items())
            + " FROM business_records r WHERE r.ctid < '(2000,0)'::tid AND " + _TODO + " LIMIT 5")

_INDEXES = (
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_accounts_due_on ON business_records (accounts_due_on)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_confstmt_due_on ON business_records (confstmt_due_on)",
)


_UPDATE_ONE = ("UPDATE business_records r SET " + ", ".join(f"{c} = COALESCE(r.{c}, {expr})" for c, expr in _COLS.items())
               + " WHERE r.id = :id AND " + _TODO)
# Which rows to try one by one: a cheap test only, because the full _TODO test parses the dates and would fail on the bad one again.
_IDS_IN_RANGE = (f"SELECT r.id FROM business_records r WHERE r.ctid >= '({{lo}},0)'::tid AND r.ctid < '({{hi}},0)'::tid AND {_CH} IS NOT NULL "
                 "AND r.accounts_due_on IS NULL AND r.confstmt_due_on IS NULL")


async def _run(sql: str, params: dict = None) -> int:
    async with engine.begin() as conn:
        await conn.execute(text("SET LOCAL statement_timeout = '120s'"))
        return (await conn.execute(text(sql), params or {})).rowcount or 0


async def fill_range(lo: int, hi: int) -> int:
    """One block range in one statement. A date the register wrote that does not exist (31/02/2026) makes Postgres refuse the whole
    statement, so on any error the range is redone block by block, and a failing block row by row, leaving just the bad row empty."""
    try:
        return await _run(_UPDATE.replace("{lo}", str(lo)).replace("{hi}", str(hi)))
    except Exception as err:
        if hi - lo > 1:
            print(f"  blocks {lo:,}-{hi:,} hit a bad value ({str(err).splitlines()[0][:80]}); redoing them one block at a time", flush=True)
            return sum([await fill_range(b, b + 1) for b in range(lo, hi)])
    async with engine.connect() as conn:
        ids = (await conn.execute(text(_IDS_IN_RANGE.replace("{lo}", str(lo)).replace("{hi}", str(hi))))).scalars().all()
    n = 0
    for rid in ids:
        try:
            n += await _run(_UPDATE_ONE, {"id": rid})
        except Exception as err:
            print(f"  skipped {rid}: {str(err).splitlines()[0][:80]}", flush=True)
    return n


async def backfill(start: int) -> None:
    done, started = 0, time.time()
    while True:
        async with engine.connect() as conn:
            end = int((await conn.execute(text("SELECT pg_relation_size('business_records') / current_setting('block_size')::int"))).scalar() or 0)
        if end <= start:
            break
        # Rows added while this runs sit past `end`; the next pass picks them up.
        for lo in range(start, end, BLOCKS_PER_BATCH):
            hi = min(lo + BLOCKS_PER_BATCH, end)
            n = await fill_range(lo, hi)
            done += n
            if n or lo % (BLOCKS_PER_BATCH * 50) == 0:
                rate = done / max(time.time() - started, 1)
                print(f"  block {hi:,}/{end:,}: {done:,} filled ({rate:,.0f} rows/s)", flush=True)
        start = end
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
            rows = (await conn.execute(text(_PREVIEW))).all()
        print("Sample of what would be written from the first blocks (nothing is written):")
        for r in rows:
            print("  " + r.id + ": " + ", ".join(f"{c}={getattr(r, c)}" for c in _COLS))
        if not rows:
            print("  (none to fill near the start of the table)")
        return
    if not args.indexes_only:
        await backfill(args.from_block)
    if not args.skip_indexes:
        await build_indexes()
    print("All done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--indexes-only", action="store_true")
    parser.add_argument("--skip-indexes", action="store_true")
    parser.add_argument("--from-block", type=int, default=0, help="carry on an interrupted run from this block")
    asyncio.run(main(parser.parse_args()))
