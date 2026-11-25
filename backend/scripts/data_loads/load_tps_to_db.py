"""Puts Provero's TPS/CTPS answers into the software database (table phone_screenings), where call permission reads them.
Run inside the backend container, like the company loader:
  python /tmp/load_tps_to_db.py --file /tmp/provero_results.csv            -> report only
  python /tmp/load_tps_to_db.py --file /tmp/provero_results.csv --go       -> save
Reads the columns by name: phone, onTps, onCtps (any capitalisation). TPS listed -> 'listed', else 'clear'; CTPS -> ctps true.
Answers are stamped today; the software treats a screening as fresh for 28 days, then asks to screen again."""
import asyncio, csv, re, sys
from app.database import AsyncSessionLocal
from app.services.call_permission import save_screening

A = sys.argv
GO = "--go" in A
PATH = A[A.index("--file") + 1] if "--file" in A else "/tmp/provero_results.csv"
TRUE = {"true", "yes", "y", "1", "listed", "on", "t"}


def truthy(v):
    return str(v or "").strip().lower() in TRUE


async def main():
    rows = list(csv.DictReader(open(PATH, encoding="utf-8-sig", newline="")))
    cols = {re.sub(r"[^a-z0-9]", "", re.sub(r"\[.*?\]", "", c).lower()): c for c in rows[0]}
    err = cols.get("error")
    pc = next((cols[k] for k in ("phone", "number", "msisdn", "phonenumber") if k in cols), None)
    tc = next((cols[k] for k in ("ontps", "tps") if k in cols), None)
    cc = next((cols[k] for k in ("onctps", "ctps") if k in cols), None)
    if not (pc and tc):
        sys.exit(f"Could not find phone / onTps columns. Columns are: {list(rows[0])}")
    todo = []
    for r in rows:
        n = re.sub(r"\D", "", r[pc] or "")
        if n.startswith("44"):
            n = "0" + n[2:]
        if err and r.get(err):
            continue  # invalid number: no answer, never saved as clear
        if len(n) == 11 and str(r[tc]).strip():
            todo.append((n, truthy(r[tc]), truthy(r[cc]) if cc else False))
    t = sum(1 for _, a, _b in todo if a)
    c = sum(1 for _, _a, b in todo if b)
    print(f"File: {len(rows):,} rows, {len(todo):,} usable numbers. On TPS: {t:,}. On CTPS: {c:,}. Clear of both: {sum(1 for _, a, b in todo if not a and not b):,}.")
    if not GO:
        print("Nothing saved. Re-run with --go.")
        return
    for i in range(0, len(todo), 200):
        async with AsyncSessionLocal() as db:
            for n, tps, ctps in todo[i:i + 200]:
                await save_screening(db, n, "listed" if tps else "clear", ctps, "provero")
            await db.commit()
        print(f"saved {min(i + 200, len(todo)):,} of {len(todo):,}", flush=True)
    print("Done.")


asyncio.run(main())
