"""Puts enriched_for_import.csv (scraped website, phones and emails) into the software database, using business_records.upsert, matched on company number.

For each company in the file that is already in the database:
  * website, phone and email are saved in the company's own fields WHEN THEY ARE EMPTY (an existing value is never replaced);
  * every phone and email in the file is added to the company's contact list through raw_data["import_scrapegraph_bn"] (the keys the contact list reads);
  * the whole CSV row is kept under raw_data["import_scrapegraph_bn"].
Companies not in the database are NOT created: they are written to /tmp/import_not_in_database.csv.
Safe to run again. Resumable.
  python /tmp/load_scrapegraph.py                   -> report only, changes nothing
  python /tmp/load_scrapegraph.py --go --limit 20   -> try 20 first
  python /tmp/load_scrapegraph.py --go              -> load everything
"""
import asyncio, csv, re, sys, time
from urllib.parse import unquote

from sqlalchemy import text

from app.core.tenancy import DEFAULT_ORG, set_org
from app.database import AsyncSessionLocal
from app.services import business_records as BR

A = sys.argv
GO = "--go" in A
LIMIT = int(A[A.index("--limit") + 1]) if "--limit" in A else 10 ** 9
PATH = A[A.index("--file") + 1] if "--file" in A else "/tmp/enriched_for_import.csv"
SOURCE = "import_scrapegraph_bn"
EMAIL = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")


def number(v):
    v = str(v or "").strip().upper().replace(" ", "")
    return v.zfill(8) if v.isdigit() else v


def emails_of(row):
    found = EMAIL.findall(unquote(f"{row.get('generic_email', '')} {row.get('named_email', '')}"))
    return list(dict.fromkeys(e.lower() for e in found))[:3]


def phones_of(row):
    ph = [str(row.get(k) or "").strip() for k in ("landline", "mobile")]
    return [p for p in ph if p]


def build(row):
    ems, phs = emails_of(row), phones_of(row)
    site = str(row.get("website") or "").strip()
    raw = {k: v for k, v in row.items()}
    raw.update({"website": site, "phone": phs[0] if phs else "", "email": ems[0] if ems else ""})
    if len(phs) > 1:
        raw["phone number"] = phs[1]
    if len(ems) > 1:
        raw["email address"] = ems[1]
    if len(ems) > 2:
        raw["email_address"] = ems[2]
    return {"name": row.get("company") or "", "registration_number": number(row["company_number"]), "postcode": row.get("postcode") or "",
            "website": site, "phone": phs[0] if phs else "", "email": ems[0] if ems else "", "raw": raw}


async def main():
    set_org(DEFAULT_ORG)
    rows = list(csv.DictReader(open(PATH, encoding="utf-8-sig", newline="")))
    by_no = {number(r["company_number"]): r for r in rows if r.get("company_number")}
    async with AsyncSessionLocal() as db:
        have = {r[0]: r[1:] for r in (await db.execute(text(
            "SELECT registration_number, COALESCE(website,''), COALESCE(domain,''), COALESCE(phone,''), COALESCE(email,'') FROM business_records "
            "WHERE registration_number = ANY(:n)"), {"n": list(by_no)})).all()}
    carry = lambda f: sum(1 for r in by_no.values() if f(r))  # noqa: E731
    would = {"website": 0, "phone": 0, "email": 0}
    for num, r in by_no.items():
        if num in have:
            site, dom, ph, em = have[num]
            would["website"] += 1 if (str(r.get("website") or "").strip() and not (site or dom)) else 0
            would["phone"] += 1 if (phones_of(r) and not ph) else 0
            would["email"] += 1 if (emails_of(r) and not em) else 0
    print(f"File: {len(by_no):,} companies. In the database: {len(have):,}. Not in the database: {len(by_no) - len(have):,}.")
    print(f"The file lists: website {carry(lambda r: str(r.get('website') or '').strip()):,}, phone {carry(phones_of):,}, email {carry(emails_of):,}.")
    print(f"Fields that would be filled (empty today): website {would['website']:,}, phone {would['phone']:,}, email {would['email']:,}.")
    if not GO:
        print("\nNothing changed. Re-run with --go to load.")
        return
    missing = [r for n, r in by_no.items() if n not in have]
    if missing:
        with open("/tmp/import_not_in_database.csv", "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.DictWriter(fh, fieldnames=list(missing[0].keys()))
            w.writeheader()
            w.writerows(missing)
    todo = [(n, by_no[n]) for n in by_no if n in have][:LIMIT]
    done = skipped = 0
    t0 = time.monotonic()
    for i in range(0, len(todo), 50):
        async with AsyncSessionLocal() as db:
            for num, r in todo[i:i + 50]:
                if await BR.find(db, registration_number=num) is None:
                    skipped += 1
                    continue
                await BR.upsert(db, source_id=SOURCE, source_type="import", confidence_tier="scraped", data=build(r))
                done += 1
            await db.commit()
        print(f"progress: {done:,} of {len(todo):,} loaded, {time.monotonic() - t0:.0f}s", flush=True)
    print(f"Done: {done:,} companies loaded, {skipped} skipped, {len(missing)} not in the database (listed in /tmp/import_not_in_database.csv).")


asyncio.run(main())
