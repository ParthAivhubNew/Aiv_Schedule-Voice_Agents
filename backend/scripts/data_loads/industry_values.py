"""Reads the industry column of the whole database and saves what we need to design the industry search. READ ONLY: the session is
opened as a read-only transaction, so nothing can be written even by mistake.

Writes to /tmp/industry_out/ inside the container:
  summary.txt          counts: rows, empty values, distinct values, which separators are used, how many rows have a wrong main code, sources
  industry_values.csv  every distinct industry value (up to 20,000) with how many companies carry it, and how many of them are Active
  by_source.csv        the 25 most common values for each source
  baseline.json        the total and the first 25 company ids for 15 test searches, to compare before and after any change
Run:
  docker cp industry_values.py aivhub_backend:/tmp/industry_values.py
  docker exec -i -e PYTHONPATH=/app -w /app aivhub_backend python /tmp/industry_values.py
"""
import asyncio, csv, json, os, re, time

from sqlalchemy import text

from app.core.tenancy import DEFAULT_ORG, set_org
from app.database import AsyncSessionLocal
from app.services import business_records as BR

OUT = "/tmp/industry_out"
os.makedirs(OUT, exist_ok=True)
LINES = []
TESTS = ["accountants", "dentist", "plumber", "restaurant", "web design", "church", "cafe", "solicitors", "tax", "electrician",
         "care home", "hairdresser", "estate agent", "software", "builders"]


def say(s=""):
    print(s, flush=True)
    LINES.append(str(s))


async def one(db, sql, **p):
    try:
        return (await db.execute(text(sql), p)).all()
    except Exception as err:  # one failing question must not stop the others
        await db.rollback()
        await db.execute(text("SET TRANSACTION READ ONLY"))
        say(f"   (could not run: {str(err).splitlines()[0][:150]})")
        return []


async def main():
    set_org(DEFAULT_ORG)
    t0 = time.monotonic()
    async with AsyncSessionLocal() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        say("== Counts ==")
        for label, sql in [
            ("rows", "SELECT count(*) FROM business_records"),
            ("Active rows", "SELECT count(*) FROM business_records WHERE lower(status)='active'"),
            ("industry empty", "SELECT count(*) FROM business_records WHERE coalesce(industry,'')=''"),
            ("sic_text empty", "SELECT count(*) FROM business_records WHERE coalesce(sic_text,'')=''"),
            ("distinct industry values", "SELECT count(DISTINCT industry) FROM business_records WHERE coalesce(industry,'')<>''"),
            ("distinct after lower-case and trim", "SELECT count(DISTINCT lower(btrim(industry))) FROM business_records WHERE coalesce(industry,'')<>''"),
            ("industry identical to sic_text", "SELECT count(*) FROM business_records WHERE coalesce(industry,'')<>'' AND industry = sic_text"),
            ("industry is only codes (e.g. 62020, 69201)", "SELECT count(*) FROM business_records WHERE industry ~ '^[0-9 ,]+$'"),
        ]:
            r = await one(db, sql)
            say(f"{label}: {r[0][0]:,}" if r else f"{label}: n/a")
        say("\n== How activities are joined in sic_text ==")
        for label, sql in [
            ("joined with ' | '", "SELECT count(*) FROM business_records WHERE sic_text LIKE '% | %'"),
            ("joined with ', ' before a code (e.g. ', 69201 - ')", "SELECT count(*) FROM business_records WHERE sic_text ~ ', [0-9]{4,5} - '"),
            ("two or more activities, neither separator", "SELECT count(*) FROM business_records WHERE sic_codes ~ '^\\|[0-9]+\\|[0-9]+' AND sic_text NOT LIKE '% | %' AND sic_text !~ ', [0-9]{4,5} - '"),
        ]:
            r = await one(db, sql)
            say(f"{label}: {r[0][0]:,}" if r else f"{label}: n/a")
        say("\n== Is the first SIC code the main one? ==")
        r = await one(db, "SELECT count(*) FILTER (WHERE split_part(sic_codes,'|',2) <> substring(sic_text from '^[0-9]{4,5}')), count(*) "
                          "FROM business_records WHERE coalesce(sic_codes,'')<>'' AND substring(sic_text from '^[0-9]{4,5}') IS NOT NULL")
        if r:
            say(f"rows where the first code in sic_codes differs from the first code in sic_text: {r[0][0]:,} of {r[0][1]:,}")
        say("\n== Sources (how the 'sources' column looks, and rows per source) ==")
        for (s,) in await one(db, "SELECT left(cast(sources as text), 90) FROM business_records WHERE sources IS NOT NULL LIMIT 3"):
            say(f"sample: {s}")
        srcs = await one(db, "SELECT s, count(*), count(DISTINCT industry) FROM (SELECT industry, (regexp_matches(cast(sources as text), '\"(ds_[a-z0-9_]+)\"', 'g'))[1] AS s "
                             "FROM business_records) t GROUP BY s ORDER BY 2 DESC LIMIT 15")
        for s, n, d in srcs:
            say(f"{s}: {n:,} rows, {d:,} distinct industry values")
        none_src = await one(db, "SELECT count(*) FROM business_records WHERE cast(sources as text) !~ '\"ds_'")
        if none_src:
            say(f"rows with no ds_ source: {none_src[0][0]:,}")

        say("\n== industry_values.csv ==")
        rows = await one(db, "SELECT industry, count(*), count(*) FILTER (WHERE lower(status)='active') FROM business_records "
                             "GROUP BY industry ORDER BY 2 DESC LIMIT 20000")
        with open(f"{OUT}/industry_values.csv", "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            w.writerow(["industry", "companies", "active"])
            w.writerows(rows)
        say(f"{len(rows):,} values saved. Top 25:")
        for v, n, a in rows[:25]:
            say(f"  {n:>9,}  {str(v or '(empty)')[:110]}")

        with open(f"{OUT}/by_source.csv", "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            w.writerow(["source", "industry", "companies"])
            for s, _, _ in srcs[:12]:
                for v, n in await one(db, "SELECT industry, count(*) FROM business_records WHERE cast(sources as text) LIKE :p GROUP BY industry ORDER BY 2 DESC LIMIT 25", p=f'%"{s}"%'):
                    w.writerow([s, v, n])

        say("\n== baseline.json (15 test searches as they work today) ==")
        base = {}
        for word in TESTS:
            try:
                found = await BR.search_filtered(db, BR.normalize_filters({"keyword": [word]}), limit=25, exclude_ids=[], stats=False)
                base[word] = {"total": found.get("total"), "broadened": bool(found.get("broadened")), "first_25_ids": [r.id for r in found["rows"]]}
                say(f"  {word}: {found.get('total'):,}" + ("  (broadened)" if found.get("broadened") else ""))
            except Exception as err:
                await db.rollback()
                await db.execute(text("SET TRANSACTION READ ONLY"))
                base[word] = {"error": str(err)[:150]}
                say(f"  {word}: could not run ({str(err).splitlines()[0][:100]})")
        json.dump(base, open(f"{OUT}/baseline.json", "w"), indent=1)
    say(f"\nDone in {time.monotonic() - t0:.0f}s. Files are in {OUT}")
    open(f"{OUT}/summary.txt", "w", encoding="utf-8").write("\n".join(LINES))


asyncio.run(main())
