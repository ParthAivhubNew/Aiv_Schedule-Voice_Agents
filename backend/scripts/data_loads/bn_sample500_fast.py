"""FSB bid item 2 (Developer note 16 Nov, item 2 / Appendix 1 Part B): find rate on 500 random companies from the Appendix 1 population.
Runs inside the backend container. Normal enrichment as a customer triggers it (Google Places, website research, email finders), NO Apollo.
Every sampled company is put back exactly as it was afterwards, so the Appendix 1 counts are not changed by the run.
  python /tmp/bn_sample500.py                -> picks and saves the sample, spends nothing
  python /tmp/bn_sample500.py --go           -> runs the 500 (spends money)
  python /tmp/bn_sample500.py --go --n 20    -> small trial
Needs /tmp/bn_population_ids.txt (company numbers, written by bn_appendix1.sh).
"""
import asyncio, contextvars, csv, json, random, re, sys, time
from datetime import datetime

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.core.tenancy import DEFAULT_ORG, set_org
from app.models.models import BusinessRecord
from app.services import enrichment_service as ES, company_contacts as CC

GO = "--go" in sys.argv
N = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 500
SEED = 2026
PLACES_USD, TAVILY_USD, GBP_PER_USD = 0.035, 0.008, 0.79  # Google $35 per 1,000 searches, Tavily $8 per 1,000 credits (from the vendor bills)

LAND = re.compile(r"^0[123][0-9]{8,9}$")
MOB = re.compile(r"^07[1-57-9][0-9]{8}$")
ROLE = {"info", "sales", "hello", "contact", "contactus", "enquiries", "enquiry", "support", "admin", "office", "accounts", "hr",
        "careers", "marketing", "press", "media", "team", "mail", "general"}
DIRS = re.compile(r"(facebook|linkedin|twitter|instagram|yell\.com|companieshouse|checkatrade|trustpilot|192\.com|google\.)", re.I)

# No Apollo anywhere: the deeper search, the Apollo-first lookups and the key pool all answer "nothing".
async def _no_apollo(*a, **k):
    return None
async def _no_keys(*a, **k):
    return []
async def _no_record(*a, **k):
    return {}
ES.search_apollo = _no_apollo
from app.services import apollo_first as AF, apollo_pool as AP  # noqa: E402
AF.company_first = lambda: False
AF.record = _no_record
AP.keys = _no_keys

# This task's own limits, kept in this script (no project code is touched):
# 1. Contacts only: a search for a LinkedIn / social page is not made or paid for.
# 2. Three Tavily searches at a time, so the per-minute limit is not tripped.
_orig_tavily = ES.search_tavily
_tav_gate = None
async def _own_tavily(query, *a, **k):
    global _tav_gate
    if "linkedin" in str(query).lower():
        return []
    if _tav_gate is None:
        _tav_gate = asyncio.Semaphore(3)
    async with _tav_gate:
        return await _orig_tavily(query, *a, **k)
ES.search_tavily = _own_tavily
_orig_web = ES.search_web
async def _own_web(query, *a, **k):
    if "linkedin" in str(query).lower():
        return []
    return await _orig_web(query, *a, **k)
ES.search_web = _own_web
_orig_open = ES.search_open_web
async def _own_open(query, *a, **k):
    if "linkedin" in str(query).lower():
        return []
    return await _orig_open(query, *a, **k)
ES.search_open_web = _own_open
ES.search_duckduckgo = _own_open

places = contextvars.ContextVar("places", default=None)
_orig_places = ES.search_google_places
async def _counted_places(*a, **k):
    box = places.get()
    if box is not None:
        box[0] += 1
    return await _orig_places(*a, **k)
ES.search_google_places = _counted_places


def digits(p):
    d = re.sub(r"\D", "", re.sub(r"\(0\)", "", str(p or "")))
    return re.sub(r"^(0044|44)", "0", d)


def local(e):
    return str(e or "").split("@")[0].lower()


async def pick():
    nums = sorted({l.strip() for l in open("/tmp/bn_population_ids.txt") if l.strip()})
    chosen = random.Random(SEED).sample(nums, min(N, len(nums)))
    json.dump(chosen, open("/tmp/sample_company_numbers.json", "w"))
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text("SELECT registration_number, id FROM business_records WHERE registration_number = ANY(:n)"), {"n": chosen})).all()
    by = {}
    for num, i in rows:
        by.setdefault(num, i)
    return nums, [(n, by[n]) for n in chosen if n in by]


async def one(db, biz):
    out = {"phones": [], "emails": [], "website": "", "team": [], "tavily": 0.0, "finder": "", "finder_verified": False}
    place = await ES.search_deeper(f"{biz.name} {biz.region or ''}".strip(), name=biz.name, postcode=biz.postcode or "", domain="", want="")
    if place:
        if place.get("phone"):
            out["phones"].append(place["phone"])
        out["website"] = place.get("website") or ""
    web = await CC.web_contacts(db, biz, want="all")
    out["tavily"] += float((web.get("ledger") or {}).get("tavily_credits") or 0)
    out["website"] = out["website"] or web.get("website") or ""
    out["phones"] += web.get("phones") or []
    out["emails"] += web.get("emails") or []
    if out["website"]:
        intel = await ES.enrich_prospect_intelligence(name=biz.name, company=biz.name, domain=out["website"], place=biz.region or None, db=db)
        out["phones"] += intel.get("phones") or []
        out["emails"] += intel.get("emails") or []
        out["team"] += [t for t in intel.get("team") or [] if t.get("name")]
        if intel.get("primaryPhone"):
            out["phones"].append(intel["primaryPhone"])
        if intel.get("primaryEmail"):
            out["emails"].append(intel["primaryEmail"])
    person = next((t for t in out["team"] if not t.get("email") and len(str(t["name"]).split()) >= 2), None)
    if person and out["website"]:
        try:
            from app.services.enrichment_waterfall import lookup_person_waterfall
            f, *l = str(person["name"]).split()
            res = await lookup_person_waterfall(db=db, org_id=DEFAULT_ORG, first_name=f, last_name=" ".join(l), company_name=biz.name,
                                                domain=out["website"], bill=False)
            if res.get("found") and res.get("email"):
                person["email"] = res["email"]
                out["finder"] = res["email"]
                out["finder_verified"] = True  # the finder only returns an address its verifier passed (valid or accept-all)
        except Exception:
            pass
    return out


def row_of(num, name, r, secs):
    ph = {digits(p) for p in r["phones"]}
    em = {e.lower() for e in r["emails"] if "@" in e}
    named = next((t for t in r["team"] if t.get("name") and t.get("title")), None) or next(iter(r["team"]), None)
    named_em = {t["email"].lower() for t in r["team"] if t.get("email")} | {e for e in em if local(e) not in ROLE and re.match(r"^[a-z]{2,}[._-][a-z]{2,}$", local(e))}
    return {
        "company_number": num, "company": name,
        "website": int(bool(r["website"]) and not DIRS.search(r["website"])),
        "landline": int(any(LAND.match(p) for p in ph)), "mobile": int(any(MOB.match(p) for p in ph)),
        "generic_email_found": int(any(local(e) in ROLE for e in em)),
        "generic_email_verified": 0,  # website emails are not run through a verifier in the normal flow
        "named_contact": int(bool(named)), "named_contact_name_role": f"{named.get('name','')} | {named.get('title','')}" if named else "",
        "named_email_found": int(bool(named_em)), "named_email_verified": int(bool(r["finder_verified"])),
        "tps_ctps": "not screened", "seconds": round(secs, 1),
        "_direct_usd": r.get("direct_usd", 0.0),
    }


SNAP_COLS = "id, raw_data::text AS raw, shared_research::text AS sr, website, domain, phone, email, rank_score, updated_at"


async def snapshot(ids):
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(f"SELECT {SNAP_COLS} FROM business_records WHERE id = ANY(:ids)"), {"ids": ids})).mappings().all()
    snap = [dict(r) for r in rows]
    json.dump(snap, open("/tmp/bn_sample500_backup.json", "w"), default=str)
    return snap


async def restore(snap, ids, start):
    async with AsyncSessionLocal() as db:
        for r in snap:
            await db.execute(text(
                "UPDATE business_records SET raw_data = CAST(:raw AS json), shared_research = CAST(:sr AS json), website = :website, "
                "domain = :domain, phone = :phone, email = :email, rank_score = :rank_score, updated_at = :updated_at WHERE id = :id"),
                {k: r[k] for k in ("raw", "sr", "website", "domain", "phone", "email", "rank_score", "updated_at", "id")})
        gone = await db.execute(text("DELETE FROM company_contact_points WHERE business_record_id = ANY(:ids) AND found_at >= :s"), {"ids": ids, "s": start})
        await db.commit()
    print(f"Restored {len(snap)} sample companies to how they were before the run; removed {gone.rowcount} contact points the run added.")


async def main():
    set_org(DEFAULT_ORG)
    nums, pairs = await pick()
    print(f"Population {len(nums)} company numbers; sample {len(pairs)} (seed {SEED}). List saved to /tmp/sample_company_numbers.json")
    if not GO:
        print("Dry run: nothing spent. Re-run with --go.")
        return
    ids = [i for _, i in pairs]
    snap = await snapshot(ids)
    start = datetime.utcnow()
    t0 = time.monotonic()
    rows, errors = [], 0
    sem = asyncio.Semaphore(6)

    async def work(num, i):
        nonlocal errors
        async with sem:
            async with AsyncSessionLocal() as db:
                t = time.monotonic()
                box = [0]
                places.set(box)
                try:
                    biz = await db.get(BusinessRecord, i)
                    r = await asyncio.wait_for(one(db, biz), timeout=150)  # one hanging website cannot hold up the run
                    r["direct_usd"] = box[0] * PLACES_USD + r["tavily"] * TAVILY_USD
                    rows.append(row_of(num, biz.name, r, time.monotonic() - t))
                    if len(rows) % 10 == 0:
                        print(f"progress: {len(rows)} of {len(pairs)} done, {time.monotonic() - t0:.0f}s elapsed", flush=True)
                    if len(rows) % 25 == 0:
                        with open("/tmp/sample_500_rows_partial.csv", "w", newline="") as pf:
                            pw = csv.writer(pf)
                            pw.writerow(["company_number", "website", "landline", "mobile", "generic_email_found", "named_email_found"])
                            for q in rows:
                                pw.writerow([q["company_number"], q["website"], q["landline"], q["mobile"], q["generic_email_found"], q["named_email_found"]])
                except asyncio.TimeoutError:
                    errors += 1
                    print("timed out after 150s:", num, flush=True)
                except Exception as err:
                    errors += 1
                    print("error", num, str(err)[:120])
                finally:
                    await db.rollback()

    try:
        await asyncio.gather(*(work(n, i) for n, i in pairs))
    finally:
        await restore(snap, ids, start)

    async with AsyncSessionLocal() as db:
        q = lambda sql: db.execute(text(sql), {"s": start})
        ai = float((await q("SELECT coalesce(sum(cost_usd),0) FROM ai_usage WHERE created_at >= :s")).scalar() or 0)
        fn = float((await q("SELECT coalesce(sum(cost_usd),0) FROM enrichment_attempts WHERE created_at >= :s")).scalar() or 0)
        ap = (await q("SELECT count(*) FROM apollo_calls WHERE at >= :s")).scalar()
    n = len(rows)
    shared = (ai + fn) / n if n else 0
    for r in rows:
        r["cost_pence"] = round((r.pop("_direct_usd") + shared) * GBP_PER_USD * 100, 2)
    cols = ["company_number", "company", "website", "landline", "mobile", "generic_email_found", "generic_email_verified", "named_contact",
            "named_contact_name_role", "named_email_found", "named_email_verified", "tps_ctps", "cost_pence", "seconds"]
    with open("/tmp/sample_500_rows.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: r["company_number"]))
    total_places = sum(r["cost_pence"] for r in rows)
    lines = [f"FSB Appendix 1 Part B: sample of {n} companies (asked for {len(pairs)}; {errors} errored), random seed {SEED}, run {start:%Y-%m-%d}.",
             "Normal enrichment: Google Places, website research, email finders. Apollo not used (Apollo calls recorded in the run: %d)." % ap,
             f"Run time {time.monotonic() - t0:.0f}s; average {sum(r['seconds'] for r in rows) / max(n, 1):.1f}s per company (6 run at a time).", ""]
    for k, label in (("website", "Website"), ("landline", "Landline (01/02/03)"), ("mobile", "Mobile (07)"), ("generic_email_found", "Generic email found"),
                     ("generic_email_verified", "Generic email verified"), ("named_contact", "Named contact (name + role)"),
                     ("named_email_found", "Named-contact email found"), ("named_email_verified", "Named-contact email verified")):
        v = sum(r[k] for r in rows)
        lines.append(f"{label:32s} {v:4d}  {100 * v / max(n, 1):5.1f}%")
    lines += ["TPS/CTPS: not screened (no Data Soap account yet).", "",
              f"Total cost: GBP {total_places / 100:.2f} (about USD {total_places / 100 / GBP_PER_USD:.2f}); average {total_places / max(n, 1):.1f}p per company.",
              f"Built from: Google Places and Tavily counted per company at USD {PLACES_USD}/{TAVILY_USD} each; AI models USD {ai:.2f} and email finders USD {fn:.2f} recorded by the app, shared equally.",
              "Generic and named emails from websites are not run through an email verifier in the normal flow; only finder emails are verified."]
    open("/tmp/sample_500_summary.txt", "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


asyncio.run(main())
