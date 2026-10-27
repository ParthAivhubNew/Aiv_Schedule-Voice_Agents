"""Fill BusinessRecord.rank_score for the companies already imported: the one number Find Leads sorts by, so
filled-in, well-known companies come first (see business_records.rank_score_of; this SQL uses the same weights).

Reads only ordinary columns (never raw_data), visits the table in disk order like backfill_business_records.py, and
writes only rows whose rank would go up -- so it is safe to stop, restart, or run again after an import.

    python scripts/rank_business_records.py --dry-run                 # show what the best 10 rows would get, write nothing
    python scripts/rank_business_records.py                          # rank every company, then build the index
    python scripts/rank_business_records.py --tranco top-1m.csv      # also add a bonus for companies whose own website
                                                                     # ranks high in the public Tranco list (rank,domain per line)
    python scripts/rank_business_records.py --indexes-only
"""
import argparse
import asyncio
import csv
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402

BLOCKS_PER_BATCH = 800

_FILLED = """(
    (CASE WHEN COALESCE(r.website, r.domain, '') <> '' THEN 1 ELSE 0 END)
  + (CASE WHEN COALESCE(r.phone, '') <> '' THEN 1 ELSE 0 END)
  + (CASE WHEN COALESCE(r.email, '') <> '' THEN 1 ELSE 0 END)
  + (CASE WHEN COALESCE(r.description, '') <> '' THEN 1 ELSE 0 END)
  + (CASE WHEN r.officers IS NOT NULL AND CASE WHEN json_typeof(r.officers) = 'array' THEN json_array_length(r.officers) > 0 ELSE false END THEN 1 ELSE 0 END)
  + (CASE WHEN r.shared_research IS NOT NULL AND json_typeof(r.shared_research) = 'object' THEN 1 ELSE 0 END))"""

_BONUS = r"""COALESCE((SELECT t.bonus FROM tranco_bonus t WHERE t.domain = regexp_replace(lower(r.domain), '^www\.', '')), 0)"""

_PROMINENCE = r"""(
    (CASE WHEN r.size_band = 'medium_large' THEN 40 ELSE 0 END)
  + (CASE WHEN lower(COALESCE(r.company_category, '')) ~ 'public limited|\mplc\M' THEN 20 ELSE 0 END)
  + 5 * LEAST(GREATEST(CASE WHEN r.sources IS NOT NULL AND json_typeof(r.sources) = 'array' THEN json_array_length(r.sources) ELSE 0 END - 1, 0), 3)
  + (CASE WHEN COALESCE(r.website, r.domain, '') <> '' THEN 5 ELSE 0 END)
  + @@BONUS@@)"""


def _rank_sql(with_tranco: bool) -> str:
    prom = _PROMINENCE.replace("@@BONUS@@", _BONUS if with_tranco else "0")
    return (f"((CASE WHEN {_FILLED} >= 4 THEN 2 WHEN {_FILLED} >= 2 THEN 1 ELSE 0 END) * 10000"
            f" + LEAST({prom}, 99) * 10 + LEAST({_FILLED}, 9))")


def _update(with_tranco: bool) -> str:
    rank = _rank_sql(with_tranco)
    return f"""
UPDATE business_records r SET rank_score = {rank}
WHERE r.ctid >= '({{lo}},0)'::tid AND r.ctid < '({{hi}},0)'::tid
  AND {rank} > COALESCE(r.rank_score, 0)
"""


async def load_tranco(path: str) -> None:
    """Rank 1-1000 +40, to 10,000 +30, to 100,000 +20, to 1,000,000 +10 (prominence points)."""
    async with engine.begin() as conn:
        await conn.execute(text("CREATE TABLE IF NOT EXISTS tranco_bonus (domain text PRIMARY KEY, bonus int NOT NULL)"))
        await conn.execute(text("TRUNCATE tranco_bonus"))
    batch, total = [], 0
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.reader(fh):
            if len(row) < 2 or not row[0].isdigit():
                continue
            rank = int(row[0])
            bonus = 40 if rank <= 1000 else 30 if rank <= 10000 else 20 if rank <= 100000 else 10 if rank <= 1000000 else 0
            if bonus:
                batch.append({"d": row[1].strip().lower(), "b": bonus})
            if len(batch) >= 5000:
                async with engine.begin() as conn:
                    await conn.execute(text("INSERT INTO tranco_bonus (domain, bonus) VALUES (:d, :b) ON CONFLICT DO NOTHING"), batch)
                total += len(batch)
                batch = []
    if batch:
        async with engine.begin() as conn:
            await conn.execute(text("INSERT INTO tranco_bonus (domain, bonus) VALUES (:d, :b) ON CONFLICT DO NOTHING"), batch)
        total += len(batch)
    print(f"Loaded {total:,} popular domains.")


async def has_tranco() -> bool:
    async with engine.connect() as conn:
        found = (await conn.execute(text("SELECT to_regclass('tranco_bonus') IS NOT NULL"))).scalar()
        return bool(found and (await conn.execute(text("SELECT EXISTS (SELECT 1 FROM tranco_bonus)"))).scalar())


async def rank_all(with_tranco: bool) -> None:
    update = _update(with_tranco)
    async with engine.connect() as conn:
        end = int((await conn.execute(text("SELECT pg_relation_size('business_records') / current_setting('block_size')::int"))).scalar() or 0)
    done, started = 0, time.time()
    for lo in range(0, end, BLOCKS_PER_BATCH):
        hi = min(lo + BLOCKS_PER_BATCH, end)
        async with engine.begin() as conn:
            await conn.execute(text("SET LOCAL enable_seqscan = off"))
            done += (await conn.execute(text(update.replace("{lo}", str(lo)).replace("{hi}", str(hi))))).rowcount or 0
        if (lo // BLOCKS_PER_BATCH) % 25 == 0:
            print(f"  block {lo:,}/{end:,}: {done:,} ranked so far ({time.time() - started:.0f}s)", flush=True)
    print(f"Ranked {done:,} companies.")


async def build_index() -> None:
    async with engine.connect() as conn:
        conn = await conn.execution_options(isolation_level="AUTOCOMMIT")
        started = time.time()
        print("Building ix_business_records_rank_order ...", flush=True)
        # The same columns, in the same order, as the "best match" sort, so a page is read straight off the index.
        await conn.execute(text("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_business_records_rank_order ON business_records "
                                "(rank_score DESC NULLS LAST, incorporated_on DESC NULLS LAST, id)"))
        await conn.execute(text("DROP INDEX CONCURRENTLY IF EXISTS ix_business_records_rank_score"))  # the first version of this index
        print(f"  done in {time.time() - started:.0f}s", flush=True)


async def main(args) -> None:
    if args.tranco:
        await load_tranco(args.tranco)
    use_tranco = await has_tranco()
    if args.dry_run:
        rank = _rank_sql(use_tranco)
        async with engine.connect() as conn:
            rows = (await conn.execute(text(f"SELECT r.name, {rank} AS score FROM business_records r ORDER BY score DESC LIMIT 10"))).all()
        print("Best 10 (nothing is written):")
        for r in rows:
            print(f"  {r.score:>6}  {r.name}")
        return
    if not args.indexes_only:
        await rank_all(use_tranco)
    await build_index()
    print("All done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--indexes-only", action="store_true")
    parser.add_argument("--tranco", help="a Tranco top-sites CSV (rank,domain per line) to add a popularity bonus")
    asyncio.run(main(parser.parse_args()))
