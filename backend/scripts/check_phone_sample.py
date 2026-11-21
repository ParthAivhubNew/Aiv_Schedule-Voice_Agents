"""Check how well the website phone finder does, against what a person sees on the sites. Read-only: nothing is saved.

Step 1, make the sample (100 random companies with a website, the finder is run on each):
  docker cp backend/scripts/check_phone_sample.py aivhub_backend:/tmp/check_phone_sample.py
  docker exec -i -e PYTHONPATH=/app -w /app aivhub_backend python /tmp/check_phone_sample.py --out /tmp/phone_sample.csv
  docker cp aivhub_backend:/tmp/phone_sample.csv .

Step 2, a person opens each website and types the phone numbers they can see on it into the visible_on_site column
(several numbers separated by |; write none when the site shows no phone; leave blank to skip a row).

Step 3, score it (needs no database):
  python backend/scripts/check_phone_sample.py --score phone_sample.csv

Target: recall of at least 90% and no wrong numbers.
"""
import argparse
import asyncio
import csv
import os
import re
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

COLUMNS = ["company", "website", "numbers_found", "source_page", "visible_on_site"]
TARGET_RECALL = 0.90


def split_numbers(cell):
    """Phone numbers typed in one cell, as E.164 where they are valid UK numbers (anything else is kept as typed digits)."""
    from app.services.site_phones import normalise

    out = set()
    for part in re.split(r"[|;\n]+|,(?=\s*(?:\+|0))", cell or ""):
        part = part.strip()
        if not part or part.lower() in ("none", "no phone", "n/a", "-"):
            continue
        n = normalise(part)
        out.add(n["number"] if n else re.sub(r"\D", "", part))
    return out


def score(rows):
    """{reviewed, visible, found_of_visible, recall, wrong, wrong_rows} over the rows a person filled in."""
    visible = hit = wrong = reviewed = 0
    wrong_rows = []
    for r in rows:
        if not (r.get("visible_on_site") or "").strip():
            continue
        reviewed += 1
        seen, found = split_numbers(r["visible_on_site"]), split_numbers(r.get("numbers_found"))
        visible += len(seen)
        hit += len(seen & found)
        bad = found - seen
        wrong += len(bad)
        if bad:
            wrong_rows.append((r.get("company"), r.get("website"), sorted(bad)))
    return {"reviewed": reviewed, "visible": visible, "found_of_visible": hit, "recall": (hit / visible) if visible else None,
            "wrong": wrong, "wrong_rows": wrong_rows}


def run_score(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        res = score(list(csv.DictReader(f)))
    if not res["reviewed"]:
        print("No row has visible_on_site filled in yet.")
        return 1
    recall = res["recall"]
    print(f"Rows reviewed: {res['reviewed']}")
    print(f"Numbers visible on the sites: {res['visible']}, found by the finder: {res['found_of_visible']}")
    print("Recall: " + ("n/a (no visible numbers)" if recall is None else f"{recall:.1%}") + f" (target {TARGET_RECALL:.0%})")
    print(f"Wrong numbers (found but not visible on the site): {res['wrong']} (target 0)")
    for company, site, nums in res["wrong_rows"]:
        print(f"  {company} {site}: {', '.join(nums)}")
    ok = (recall is None or recall >= TARGET_RECALL) and res["wrong"] == 0
    print("PASS" if ok else "BELOW TARGET")
    return 0 if ok else 2


async def make_sample(out, count):
    from sqlalchemy import text

    from app.core.tenancy import DEFAULT_ORG, set_org
    from app.database import AsyncSessionLocal
    from app.services import site_phones as SP

    set_org(DEFAULT_ORG)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT name, COALESCE(NULLIF(trim(website), ''), trim(domain)) AS site FROM business_records "
            "WHERE COALESCE(NULLIF(trim(website), ''), NULLIF(trim(domain), '')) IS NOT NULL ORDER BY random() LIMIT :n"), {"n": count})).all()
    sem = asyncio.Semaphore(5)

    async def one(site):
        async with sem:
            try:
                return await SP.find_phones(site)
            except Exception:
                return []

    found = await asyncio.gather(*(one(r.site) for r in rows))
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        for r, nums in zip(rows, found):
            w.writerow([r.name, r.site, " | ".join(c["display"] for c in nums), " | ".join(sorted({c["source_url"] for c in nums})), ""])
    print(f"Wrote {len(rows)} companies to {out}; {sum(1 for n in found if n)} had a number found. Fill in visible_on_site by hand, then run with --score.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="phone_sample.csv", help="where to write the sample CSV")
    ap.add_argument("--count", type=int, default=100)
    ap.add_argument("--score", metavar="FILE", help="score a CSV whose visible_on_site column has been filled in")
    args = ap.parse_args()
    if args.score:
        sys.exit(run_score(args.score))
    asyncio.run(make_sample(args.out, args.count))


if __name__ == "__main__":
    main()
