"""Read phone numbers off each company's OWN website and keep the ones found (source "website", page URL, date).

Takes every company that has a website and has not been read yet (no raw_data.site_phones). Numbers come only from
the company's own pages (home page plus up to three contact/about pages); nothing from Google or any directory.

Dry run is the default: it reads sites and writes only the CSV, never the database. Add --apply to save.
Safe to stop (Ctrl+C) and start again: ids already done are listed in <out-dir>/done_<mode>.txt and skipped, the
database write for a company is one statement, and the CSV is appended to after every chunk.

Run on the server:
  docker cp backend/scripts/rerun_site_phones.py aivhub_backend:/tmp/rerun_site_phones.py
  docker exec -i -e PYTHONPATH=/app -w /app aivhub_backend python /tmp/rerun_site_phones.py --district BN14,BN15,BN16,BN17,BN18,BN20,BN22,BN26,BN27,BN43 --limit 200
  docker exec -i -e PYTHONPATH=/app -w /app aivhub_backend python /tmp/rerun_site_phones.py --district BN14,BN15,BN16,BN17,BN18,BN20,BN22,BN26,BN27,BN43 --apply
  docker exec -i -e PYTHONPATH=/app -w /app aivhub_backend python /tmp/rerun_site_phones.py --all-districts --apply
"""
import argparse
import asyncio
import csv
import json
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from sqlalchemy import text  # noqa: E402

from app.core.tenancy import DEFAULT_ORG, set_org  # noqa: E402
from app.database import AsyncSessionLocal  # noqa: E402
from app.services import site_phones as SP  # noqa: E402

FSB_DISTRICTS = "BN14,BN15,BN16,BN17,BN18,BN20,BN22,BN26,BN27,BN43"
COLUMNS = ["id", "company", "postcode", "website", "had_phone", "numbers", "kinds", "via", "source_page", "found_on", "error"]
PER_SITE_TIMEOUT = 75
# raw_data can be SQL NULL or a JSON null on older rows; either counts as empty
RAW = "(CASE WHEN jsonb_typeof(raw_data::jsonb) = 'object' THEN raw_data::jsonb ELSE '{}'::jsonb END)"


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--district", default="", help=f"comma list of postcode districts, e.g. {FSB_DISTRICTS}")
    ap.add_argument("--all-districts", action="store_true", help="every company with a website, whatever its postcode")
    ap.add_argument("--limit", type=int, default=0, help="stop after this many companies (0 = no limit)")
    ap.add_argument("--apply", action="store_true", help="save what is found (default is a dry run: report only)")
    ap.add_argument("--dry-run", action="store_true", help="the default; accepted for clarity")
    ap.add_argument("--concurrency", type=int, default=6, help="sites read at once (default 6)")
    ap.add_argument("--chunk", type=int, default=120, help="companies per chunk; progress is saved after each")
    ap.add_argument("--out-dir", default="/tmp/site_phones", help="progress, done list and CSV go here")
    args = ap.parse_args(argv)
    if args.apply and args.dry_run:
        ap.error("--apply and --dry-run exclude each other")
    if not args.district and not args.all_districts:
        ap.error("pick --district BN14,BN15 or --all-districts")
    args.districts = [d.strip().upper() for d in args.district.split(",") if d.strip()]
    return args


def load_done(path):
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


def write_progress(path, state):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, path)


async def read_chunk(rows, concurrency):
    sem = asyncio.Semaphore(concurrency)

    async def one(r):
        async with sem:
            try:
                return await asyncio.wait_for(SP.find_phones(r["website"]), PER_SITE_TIMEOUT), ""
            except Exception as err:
                return [], f"{type(err).__name__}: {str(err)[:80]}"

    return await asyncio.gather(*(one(r) for r in rows))


async def fetch_rows(db, args, after, size):
    where = ["COALESCE(NULLIF(trim(website), ''), NULLIF(trim(domain), '')) IS NOT NULL",
             f"NOT ({RAW} ? 'site_phones')", "id > :after"]
    params = {"after": after, "size": size}
    if args.districts:
        where.append("upper(split_part(trim(postcode), ' ', 1)) = ANY(:districts)")
        params["districts"] = args.districts
    sql = ("SELECT id, name, postcode, COALESCE(NULLIF(trim(website), ''), trim(domain)) AS website, COALESCE(phone, '') AS phone "
           f"FROM business_records WHERE {' AND '.join(where)} ORDER BY id LIMIT :size")
    return [dict(r._mapping) for r in (await db.execute(text(sql), params)).all()]


async def save(db, row, found):
    patch, phone = SP.record_patch(found, row["phone"])
    await db.execute(
        text(f"UPDATE business_records SET raw_data = ({RAW} || CAST(:patch AS jsonb))::json, "
             "phone = CASE WHEN COALESCE(phone, '') = '' AND :phone <> '' THEN :phone ELSE phone END WHERE id = :id"),
        {"patch": json.dumps(patch), "phone": phone, "id": row["id"]})


async def main(argv=None):
    from app.services.enrichment_service import _is_directory_host

    args = parse_args(argv)
    mode = "apply" if args.apply else "dry"
    os.makedirs(args.out_dir, exist_ok=True)
    done_path = os.path.join(args.out_dir, f"done_{mode}.txt")
    csv_path = os.path.join(args.out_dir, f"results_{mode}.csv")
    prog_path = os.path.join(args.out_dir, f"progress_{mode}.json")
    done = load_done(done_path)
    state = {"mode": mode, "districts": args.districts or "all", "started": datetime.utcnow().isoformat() + "Z", "read": 0,
             "with_numbers": 0, "numbers": 0, "errors": 0, "skipped_directory": 0, "resumed_from": len(done)}
    if os.path.exists(prog_path):  # carry the counts over on a restart
        try:
            old = json.load(open(prog_path, encoding="utf-8"))
            for k in ("read", "with_numbers", "numbers", "errors", "skipped_directory"):
                state[k] = old.get(k, 0)
        except ValueError:
            pass
    new_csv = not os.path.exists(csv_path)
    set_org(DEFAULT_ORG)
    handled, after, t0 = 0, "", time.time()
    print(f"{'APPLY' if args.apply else 'DRY RUN (nothing is saved)'}: districts={state['districts']} already done={len(done)}", flush=True)
    with open(csv_path, "a", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        if new_csv:
            writer.writerow(COLUMNS)
        while not args.limit or handled < args.limit:
            size = args.chunk if not args.limit else min(args.chunk, args.limit - handled)
            async with AsyncSessionLocal() as db:
                rows = await fetch_rows(db, args, after, size)
            if not rows:
                break
            after = rows[-1]["id"]
            rows = [r for r in rows if r["id"] not in done]  # the keyset keeps moving even when a whole chunk was done before
            todo = []
            for r in rows:
                if _is_directory_host(r["website"] if "://" in r["website"] else "https://" + r["website"]):
                    state["skipped_directory"] += 1
                    done.add(r["id"])
                    continue
                todo.append(r)
            results = await read_chunk(todo, args.concurrency)
            async with AsyncSessionLocal() as db:
                for r, (found, err) in zip(todo, results):
                    writer.writerow([r["id"], r["name"], r["postcode"], r["website"], "yes" if r["phone"] else "", " | ".join(c["display"] for c in found),
                                     " | ".join(c["kind"] for c in found), " | ".join(c["via"] for c in found),
                                     " | ".join(sorted({c["source_url"] for c in found})), found[0]["found_on"] if found else "", err])
                    state["read"] += 1
                    state["errors"] += 1 if err else 0
                    state["with_numbers"] += 1 if found else 0
                    state["numbers"] += len(found)
                    if args.apply and not err:  # a failed read is retried next run; a clean "nothing found" is marked
                        await save(db, r, found)
                    if not err:
                        done.add(r["id"])
                if args.apply:
                    await db.commit()
            fh.flush()
            with open(done_path, "w", encoding="utf-8") as f:
                f.write("\n".join(sorted(done)))
            handled += len(rows)
            state["updated"] = datetime.utcnow().isoformat() + "Z"
            write_progress(prog_path, state)
            rate = handled / max(time.time() - t0, 1)
            print(f"  {handled} companies this run | {state['with_numbers']}/{state['read']} with a number | {state['errors']} errors | {rate:.1f}/s", flush=True)
    print(f"Done. {json.dumps(state)}\nCSV: {csv_path}", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Stopped. Run the same command again to carry on.", flush=True)
