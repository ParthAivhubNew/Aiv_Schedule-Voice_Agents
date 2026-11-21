"""Remove the Google content we stored. Only the place ID may stay (Google's terms).

Finds, and with --go clears:
  lead_accounts            phone / website a Google listing gave and nothing else confirms (field_sources says google_places, or, for a value
                           saved before provenance existed, it equals what the company record holds from Google and is not on the company's own site)
  business_records         phone / website columns whose only source is Google (a value another source also lists is left alone)
  business_records         raw_data["google_places:*"] entries cut down to the place ID (the source entry stays), Google's suggestions in
                           raw_data["lookup_options"], and a contacts_web block that Google filled
  company_contact_points   rows whose source is google_places

Dry run by default: counts per table and field, and the report file. Safe to repeat and to stop: a cleaned value is not found again, each chunk
commits on its own, and --after-<table> carries on from an id. Run it in this order (it already does): accounts first, then contact points, then
records, because the account check reads the record's Google entries.

    docker cp backend/scripts/purge_google_values.py <backend container>:/tmp/purge_google_values.py
    docker exec <backend container> python /tmp/purge_google_values.py            # dry run
    docker exec <backend container> python /tmp/purge_google_values.py --go       # apply
"""
import argparse
import asyncio
import csv
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from sqlalchemy import text  # noqa: E402

from app.services import data_policy as DP  # noqa: E402

REPORT = "/tmp/google_purge_report.csv"
FIELDS = ("phone", "website")


def _json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            return None
    return v


def _is_google_key(key) -> bool:
    return str(key).split(":")[0] == "google_places"


def _google_held(raw: dict) -> dict:
    """{kind: values} Google lists for the company, comparable form."""
    only = {k: v for k, v in (raw or {}).items() if _is_google_key(k) or k == "lookup_options"}
    return DP._held_by(only)["restricted"]


def _open_held(raw: dict, research: dict = None) -> dict:
    """{kind: values} that something other than Google or Apollo lists: the company's own site, the register, a web search."""
    held = DP._held_by(raw or {})["open"]
    for kind, key in (("phone", "phones"), ("email", "emails")):
        for v in (research or {}).get(key) or []:
            n = DP._norm(kind, v.get("value") if isinstance(v, dict) else v)
            if n:
                held[kind].add(n)
    return held


def clean_raw(raw: dict):
    """The record's raw_data with Google's content removed, and what changed: [(field, how many)]."""
    raw = dict(raw or {})
    changed = Counter()
    for key in list(raw):
        if _is_google_key(key):
            entry = raw[key]
            place_id = (entry.get("place_id") if isinstance(entry, dict) else "") or key.split(":", 1)[-1]
            if entry != {"place_id": place_id}:
                raw[key] = {"place_id": place_id}
                changed["raw_data.google_places"] += 1
    opts = raw.get("lookup_options")
    if isinstance(opts, dict):
        kept = {}
        for kind, items in opts.items():
            keep = []
            for o in items or []:
                text_ = " ".join([str((o or {}).get("label") or ""), *[str(s) for s in (o or {}).get("sources") or []]]).lower() if isinstance(o, dict) else ""
                if "google" in text_:
                    changed["raw_data.lookup_options"] += 1
                else:
                    keep.append(o)
            kept[kind] = keep
        if changed["raw_data.lookup_options"]:
            raw["lookup_options"] = kept
    cw = raw.get("contacts_web")
    if isinstance(cw, dict) and cw.get("source") == "google_places" and (cw.get("website") or cw.get("phones") or cw.get("emails")):
        raw["contacts_web"] = {**cw, "website": "", "phones": [], "emails": []}
        changed["raw_data.contacts_web"] += 1
    return raw, changed


async def run(go: bool = False, report: str = REPORT, chunk: int = 500, after_accounts: str = "", after_points: str = "", after_records: str = "", engine=None) -> dict:
    if engine is None:
        from app.database import engine as app_engine

        engine = app_engine
    counts: Counter = Counter()
    lines = []

    def note(table: str, row_id: str, field: str, how: str) -> None:
        counts[(table, field)] += 1
        lines.append([table, row_id, field, how, "cleared" if go else "would clear"])

    # 1. saved companies
    async for rows in _chunks_in(engine, """
        SELECT a.id, a.phone, a.website, a.domain, a.field_sources, a.research, b.raw_data AS record_raw
        FROM lead_accounts a LEFT JOIN business_records b ON b.id = a.business_record_id
        WHERE a.id > :after AND (a.field_sources::text LIKE '%google_places%' OR b.raw_data::text LIKE '%google_places%'
                                  OR b.raw_data::text LIKE '%lookup_options%')""", after_accounts, chunk, go):
        for r, conn in rows:
            sources = dict(_json(r["field_sources"]) or {})
            raw = _json(r["record_raw"]) or {}
            google, open_ = _google_held(raw), _open_held(raw, _json(r["research"]) or {})
            sets, new_sources = {}, dict(sources)
            for field in FIELDS:
                value = r[field] or ""
                if not value.strip():
                    continue
                if sources.get(field):
                    clear = sources[field] == "google_places"
                    how = "field_sources says google_places"
                else:
                    n = DP._norm(field, value)
                    clear = bool(n) and n in google[field] and n not in open_[field]
                    how = "equals Google's value, not on the company's own site"
                if clear:
                    sets[field] = ""
                    new_sources.pop(field, None)
                    note("lead_accounts", r["id"], field, how)
                    if field == "website" and r["domain"] and r["domain"] == DP._norm("website", value):
                        sets["domain"] = ""
            if sets and go:
                await conn.execute(text("UPDATE lead_accounts SET " + ", ".join(f"{k} = :{k}" for k in sets) + ", field_sources = CAST(:fs AS json) WHERE id = :id"),
                                   {**sets, "fs": json.dumps(new_sources) if new_sources else None, "id": r["id"]})

    # 2. contact list rows Google supplied
    async for rows in _chunks_in(engine, "SELECT id, kind FROM company_contact_points WHERE id > :after AND source = 'google_places'", after_points, chunk, go):
        for r, conn in rows:
            note("company_contact_points", r["id"], r["kind"], "source is google_places")
            if go:
                await conn.execute(text("DELETE FROM company_contact_points WHERE id = :id"), {"id": r["id"]})

    # 3. shared company records
    async for rows in _chunks_in(engine, """
        SELECT id, phone, website, raw_data FROM business_records
        WHERE id > :after AND (raw_data::text LIKE '%google_places%' OR raw_data::text LIKE '%lookup_options%')""", after_records, chunk, go):
        for r, conn in rows:
            raw = _json(r["raw_data"]) or {}
            google, open_ = _google_held(raw), _open_held(raw)
            sets = {}
            for field in FIELDS:
                value = (r[field] or "").strip()
                n = DP._norm(field, value) if value else ""
                if n and n in google[field] and n not in open_[field]:
                    sets[field] = ""
                    note("business_records", r["id"], field, "only Google lists it")
            cleaned, changed = clean_raw(raw)
            for field, k in changed.items():
                for _ in range(k):
                    note("business_records", r["id"], field, "Google content cut to the place ID")
            if go and (sets or changed):
                sets_sql = "".join(f"{k} = :{k}, " for k in sets)
                await conn.execute(text(f"UPDATE business_records SET {sets_sql}raw_data = CAST(:raw AS json) WHERE id = :id"), {**sets, "raw": json.dumps(cleaned), "id": r["id"]})

    with open(report, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["table", "id", "field", "why", "action"])
        w.writerows(lines)
    return {f"{t}.{f}": n for (t, f), n in sorted(counts.items())}


async def _chunks_in(engine, sql: str, after: str, size: int, go: bool):
    """Yields [(row, connection)] per chunk; the chunk's writes commit when the consumer moves on."""
    while True:
        async with engine.begin() as conn:
            rows = (await conn.execute(text(sql + " ORDER BY id LIMIT :n"), {"after": after, "n": size})).mappings().all()
            if not rows:
                return
            yield [(r, conn) for r in rows]
        after = rows[-1]["id"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--go", action="store_true", help="apply the changes (without it nothing is written)")
    ap.add_argument("--report", default=REPORT)
    ap.add_argument("--chunk", type=int, default=500)
    ap.add_argument("--after-accounts", default="")
    ap.add_argument("--after-points", default="")
    ap.add_argument("--after-records", default="")
    a = ap.parse_args()
    out = asyncio.run(run(a.go, a.report, a.chunk, a.after_accounts, a.after_points, a.after_records))
    print("APPLIED" if a.go else "DRY RUN (nothing written; add --go to apply)")
    for k, n in out.items():
        print(f"  {k}: {n}")
    if not out:
        print("  nothing to clear")
    print(f"report: {a.report}")


if __name__ == "__main__":
    main()
