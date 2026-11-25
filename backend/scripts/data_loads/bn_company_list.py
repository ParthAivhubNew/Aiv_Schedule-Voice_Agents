"""Lists the companies FSB's bid is about: every active Companies House company in the 30 BN districts that is left AFTER FSB's exclusion rules,
read straight from the software's database. Read-only: nothing is changed. Writes three files, with what the software holds about each company:
  /tmp/bn_companies.csv   one row per company (opens in Excel)
  /tmp/bn_companies.txt   a plain list, grouped by district
  /tmp/bn_companies.md    a Markdown list with a table per district
  python /tmp/bn_company_list.py                      -> all 30 districts
  python /tmp/bn_company_list.py --district BN1,BN3   -> only those districts
The exclusion rules are the ones in "FSB exclusion rules - for developers": status exactly Active; company type, Charity Commission register, any of the
53 SIC codes (any of a company's codes), and name keywords (with the driving school / dance school exception).
"""
import asyncio, csv, sys
from collections import defaultdict
from datetime import datetime

from sqlalchemy import text

from app.database import AsyncSessionLocal

DISTRICTS = ["BN1", "BN2", "BN3", "BN5", "BN6", "BN7", "BN8", "BN9", "BN10", "BN11", "BN12", "BN13", "BN14", "BN15", "BN16", "BN17", "BN18",
             "BN20", "BN21", "BN22", "BN23", "BN24", "BN25", "BN26", "BN27", "BN41", "BN42", "BN43", "BN44", "BN50"]  # BN50, not BN45
ONLY = set(sys.argv[sys.argv.index("--district") + 1].upper().split(",")) if "--district" in sys.argv else set()
SIC = ("84110,84120,84130,84210,84220,84230,84240,84250,84300,85100,85200,85310,85320,85410,85421,85422,85510,85520,85590,85600,86101,86102,86210,"
       "86220,86230,86900,64110,64191,64192,64910,64921,64922,64929,82911,94110,94120,94200,94910,94920,94990,88910,91011,52230,49100,52212,50100,"
       "50300,36000,37000,19201,06100,53100,99000").split(",")
TYPES = ["charitable incorporated organisation", "scottish charitable incorporated organisation", "registered society", "royal charter company", "other company type"]
KEYWORDS = r"\m(charit[a-z]*|church|parish|mosque|synagogue|temple|casino[a-z]*|credit union|nhs|hospital|school|college|university|academy trust|shopping centre|bureau de change|tourist information|weighbridge[a-z]*)\M"
KEEP = r"(driving school|dance school)"

SQL = """
WITH pop0 AS (
  SELECT b.*, split_part(upper(b.postcode),' ',1) AS district, string_to_array(btrim(COALESCE(b.sic_codes,''),'|'),'|') AS sics
  FROM business_records b
  WHERE b.postcode LIKE 'BN%' AND split_part(upper(b.postcode),' ',1) = ANY(CAST(:dists AS text[]))
    AND b.registration_number ~ '^[A-Z0-9]{8}$' AND btrim(b.status) = 'Active'
), ruled AS (
  SELECT p.*, CASE
     WHEN lower(btrim(COALESCE(company_category,''))) = ANY(CAST(:types AS text[])) THEN 'type'
     WHEN COALESCE(sources::text,'') LIKE '%"ds_charity_commission"%' THEN 'charity'
     WHEN sics && CAST(:sic AS text[]) THEN 'sic'
     WHEN name ~* :kw AND name !~* :keep THEN 'keyword'
     ELSE NULL END AS removed_by
  FROM pop0 p
)
SELECT district, registration_number, name, postcode, COALESCE(company_category,'') AS company_type, COALESCE(sic_codes,'') AS sic_codes,
       COALESCE(incorporation_date,'') AS incorporated, COALESCE(size_band,'') AS size_band,
       COALESCE(NULLIF(website,''), domain, '') AS website, COALESCE(phone,'') AS phone, COALESCE(email,'') AS email,
       jsonb_array_length(CASE WHEN jsonb_typeof(officers::jsonb) = 'array' THEN officers::jsonb ELSE '[]'::jsonb END) AS officers_held,
       jsonb_exists(COALESCE(raw_data::jsonb, '{}'::jsonb), 'fsb_sample_2026_11') AS in_sample,
       jsonb_exists(COALESCE(raw_data::jsonb, '{}'::jsonb), 'fsb_enrich') AS enriched
FROM ruled WHERE removed_by IS NULL
ORDER BY substring(district from '[0-9]+')::int, name, registration_number
"""
COLS = ["district", "company_number", "name", "postcode", "company_type", "sic_codes", "incorporated", "size_band", "website", "phone", "email",
        "directors_held", "in_500_sample", "enriched"]


def md(v):
    return str(v or "").replace("|", "/").replace("\n", " ")


async def main():
    dists = [d for d in DISTRICTS if not ONLY or d in ONLY]
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(SQL), {"dists": dists, "types": TYPES, "sic": SIC, "kw": KEYWORDS, "keep": KEEP})).all()
    by = defaultdict(list)
    for r in rows:
        by[r[0]].append(r)
    stamp = f"{datetime.utcnow():%Y-%m-%d %H:%M} UTC"
    n = len(rows)
    has = lambda i: sum(1 for r in rows if r[i])  # noqa: E731

    with open("/tmp/bn_companies.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(COLS)
        for r in rows:
            w.writerow([r[0], r[1], r[2], r[3], r[4], r[5].strip("|").replace("|", " "), r[6], r[7], r[8], r[9], r[10], r[11], "yes" if r[12] else "", "yes" if r[13] else ""])

    head = [f"FSB bid companies: active Companies House companies in the BN districts after FSB's exclusion rules.",
            f"Read from the software database on {stamp}. {n:,} companies in {len(by)} districts.",
            f"Held today: website {has(8):,}, phone {has(9):,}, email {has(10):,}, directors loaded for {sum(1 for r in rows if r[11]):,}, in the 500-company sample {sum(1 for r in rows if r[12]):,}."]
    with open("/tmp/bn_companies.txt", "w", encoding="utf-8") as fh:
        fh.write("\n".join(head) + "\n")
        for d in dists:
            items = by.get(d, [])
            fh.write(f"\n=== {d}: {len(items):,} companies ===\n")
            for r in items:
                fh.write(f"{r[1]:8s}  {r[2][:55]:55s}  {r[3]:9s}  {r[8][:30]:30s} {r[9]:13s} {r[10][:34]}\n")
    with open("/tmp/bn_companies.md", "w", encoding="utf-8") as fh:
        fh.write("# FSB bid companies\n\n" + "\n\n".join(head[1:]) + "\n\n")
        fh.write("| District | Companies |\n|---|---:|\n" + "\n".join(f"| {d} | {len(by.get(d, [])):,} |" for d in dists) + f"\n| **Total** | **{n:,}** |\n")
        for d in dists:
            items = by.get(d, [])
            fh.write(f"\n## {d} ({len(items):,})\n\n| Company number | Name | Postcode | Type | SIC | Website | Phone | Email |\n|---|---|---|---|---|---|---|---|\n")
            for r in items:
                fh.write(f"| {r[1]} | {md(r[2])} | {r[3]} | {md(r[4])} | {md(r[5].strip('|').replace('|', ' '))} | {md(r[8])} | {md(r[9])} | {md(r[10])} |\n")
    print("\n".join(head))
    print("\nPer district:", ", ".join(f"{d} {len(by.get(d, [])):,}" for d in dists))
    print("\nWritten: /tmp/bn_companies.csv, /tmp/bn_companies.txt, /tmp/bn_companies.md")
    print("Check: after FSB's rules the count should be close to 59,366 (the boss's figure); ours was 59,349 on 17 November.")


asyncio.run(main())
