"""FSB bid item 2: find rate on 200 random BN companies that hold no contact data.
Runs inside the backend container. Nothing is saved to the company store (the session is rolled back).
  python /tmp/bn_sample.py            -> picks the sample, prints it, spends nothing
  python /tmp/bn_sample.py --go       -> runs the enrichment on the sample (spends money)
  python /tmp/bn_sample.py --go --n 20  -> a 20-company trial first
"""
import asyncio, json, random, re, sys, time
from datetime import datetime

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.core.tenancy import DEFAULT_ORG, set_org
from app.models.models import BusinessRecord
from app.services import enrichment_service as ES, company_contacts as CC

GO = "--go" in sys.argv
N = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 200
FSB_SIC = "0610|0620|1920|3600|4910|5010|5030|5221|5222|5223|5310|5320|641|6491|6492|8291|84|851|852|853|854|8559|856|86|9101|920|941|942|9491|9492"  # same as bn_counts.sh
SEED = "fsb-bid-2026"

LAND = re.compile(r"^0[12][0-9]{8,9}$")
MOB = re.compile(r"^07[1-57-9][0-9]{8}$")
ROLE = {"info", "sales", "hello", "contact", "contactus", "enquiries", "enquiry", "support", "admin", "office", "accounts", "hr",
        "careers", "marketing", "press", "media", "team", "mail", "general"}
DIRS = re.compile(r"(facebook|linkedin|twitter|instagram|yell\.com|companieshouse|checkatrade|trustpilot|192\.com|google\.)", re.I)

places_calls = 0
_orig_places = ES.search_google_places


async def _counted_places(*a, **k):
    global places_calls
    places_calls += 1
    return await _orig_places(*a, **k)


ES.search_google_places = _counted_places


def digits(p):
    d = re.sub(r"\D", "", re.sub(r"\(0\)", "", str(p or "")))
    return re.sub(r"^(0044|44)", "0", d)


def local(e):
    return str(e or "").split("@")[0].lower()


async def pick(db):
    rows = (await db.execute(text("""
        SELECT b.id FROM business_records b
        WHERE lower(b.status)='active' AND b.postcode LIKE 'BN%' AND b.postcode ~ '^BN([1-3]|[5-9]|1[0-8]|2[0-7]|4[1-5]) '
          AND NOT (COALESCE(b.company_category,'') ILIKE '%charit%' OR COALESCE(b.registration_number,'') LIKE 'CC-%'
                   OR b.sources::text LIKE '%"ds_charity_commission"%')
          AND split_part(btrim(COALESCE(b.sic_codes,''),'|'),'|',1) !~ ('^(' || :sic || ')')
          AND COALESCE(b.phone,'')='' AND COALESCE(b.email,'')='' AND COALESCE(b.website,'')='' AND COALESCE(b.domain,'')=''
          AND (b.raw_data IS NULL OR b.raw_data::jsonb->'contacts_web' IS NULL)
          AND b.shared_research IS NULL
          AND NOT EXISTS (SELECT 1 FROM company_contact_points p WHERE p.business_record_id=b.id AND p.kind IN ('phone','email','website'))
        ORDER BY md5(b.id || :seed) LIMIT :n"""), {"sic": FSB_SIC, "seed": SEED, "n": N})).all()
    return [r[0] for r in rows]


async def one(db, biz):
    """What a normal run finds for one company, as the same six facts counted in Appendix 1."""
    out = {"phones": [], "emails": [], "website": "", "team": [], "tavily": 0.0}
    place = await ES.search_deeper(f"{biz.name} {biz.region or ''}".strip(), name=biz.name, postcode=biz.postcode or "", domain="", want="")
    if place:
        if place.get("phone"):
            out["phones"].append(place["phone"])
        out["website"] = place.get("website") or ""
    web = await CC.web_contacts(db, biz, want="all")
    led = web.get("ledger") or {}
    out["tavily"] += float(led.get("tavily_credits") or 0)
    out["website"] = out["website"] or web.get("website") or ""
    out["phones"] += web.get("phones") or []
    out["emails"] += web.get("emails") or []
    if out["website"]:
        intel = await ES.enrich_prospect_intelligence(name=biz.name, company=biz.name, domain=out["website"], place=biz.region or None, db=db)
        out["phones"] += intel.get("phones") or []
        out["emails"] += intel.get("emails") or []
        for t in intel.get("team") or []:
            if t.get("name"):
                out["team"].append(t)
        if intel.get("primaryPhone"):
            out["phones"].append(intel["primaryPhone"])
        if intel.get("primaryEmail"):
            out["emails"].append(intel["primaryEmail"])
    # email finder: only for a named person with no email yet, and only when there is a site to search on
    out["finder"] = ""
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
        except Exception as err:
            out["finder"] = ""
            out["finder_err"] = str(err)[:100]
    return out


def tally(r):
    ph = {digits(p) for p in r["phones"]}
    em = {e.lower() for e in r["emails"] if "@" in e}
    em |= {t["email"].lower() for t in r["team"] if t.get("email")}
    return {
        "landline": any(LAND.match(p) for p in ph),
        "mobile": any(MOB.match(p) for p in ph),
        "generic_email": any(local(e) in ROLE for e in em),
        "named_email": any(local(e) not in ROLE and (re.match(r"^[a-z]{2,}[._-][a-z]{2,}$", local(e))) for e in em)
                       or any(t.get("email") for t in r["team"]),
        "named_with_title": any(t.get("name") and t.get("title") for t in r["team"]),
        "website": bool(r["website"]) and not DIRS.search(r["website"]),
    }


SNAP_COLS = "id, raw_data::text AS raw, shared_research::text AS sr, website, domain, phone, email, rank_score, updated_at"


async def snapshot(ids):
    """The sample companies exactly as they are now, so the run can put every one back."""
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(f"SELECT {SNAP_COLS} FROM business_records WHERE id = ANY(:ids)"), {"ids": ids})).mappings().all()
    snap = [dict(r) for r in rows]
    json.dump(snap, open("/tmp/bn_sample_backup.json", "w"), default=str)
    return snap


async def restore(snap, ids, start):
    """Some lookup steps save on their own session, so the rollback is not enough: put the saved values back."""
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
    async with AsyncSessionLocal() as db:
        ids = await pick(db)
    print(f"Sample: {len(ids)} BN companies with no contact data (seed {SEED}).")
    json.dump(ids, open("/tmp/bn_sample_ids.json", "w"))
    if not GO:
        print("Dry run: nothing spent. Re-run with --go to enrich them. Ids saved to /tmp/bn_sample_ids.json")
        return
    snap = await snapshot(ids)
    start = datetime.utcnow()
    t0 = time.monotonic()
    totals = {k: 0 for k in ("landline", "mobile", "generic_email", "named_email", "named_with_title", "website")}
    tavily, errors, finder_hits = 0.0, 0, 0
    sem = asyncio.Semaphore(4)

    async def work(i):
        nonlocal tavily, errors, finder_hits
        async with sem:
            async with AsyncSessionLocal() as db:
                try:
                    biz = await db.get(BusinessRecord, i)
                    r = await one(db, biz)
                    tavily += r["tavily"]
                    finder_hits += 1 if r.get("finder") else 0
                    for k, v in tally(r).items():
                        totals[k] += 1 if v else 0
                except Exception as err:
                    errors += 1
                    print("error", i, str(err)[:120])
                finally:
                    await db.rollback()  # nothing from the sample is kept in the company store

    try:
        await asyncio.gather(*(work(i) for i in ids))
    finally:
        await restore(snap, ids, start)
    n = len(ids)
    print(f"\nRun took {time.monotonic() - t0:.0f}s. Companies that errored: {errors}")
    print("Found on demand (a-f), % of the sample:")
    for k, v in totals.items():
        print(f"  {k:18s} {v:4d}  {100 * v / n:5.1f}%")
    print(f"Email-finder hits: {finder_hits}")
    async with AsyncSessionLocal() as db:
        q = lambda sql: db.execute(text(sql), {"s": start})
        ai = (await q("SELECT plugin, count(*), coalesce(sum(cost_usd),0) FROM ai_usage WHERE created_at >= :s GROUP BY 1")).all()
        en = (await q("SELECT provider, count(*), coalesce(sum(cost_usd),0) FROM enrichment_attempts WHERE created_at >= :s GROUP BY 1")).all()
        ap = (await q("SELECT count(*) FROM apollo_calls WHERE at >= :s")).scalar()
    print("\nCost recorded by the app (USD):")
    for r in ai:
        print(f"  AI models [{r[0]}]: {r[1]} calls, ${r[2]:.4f}")
    for r in en:
        print(f"  Email finder [{r[0]}]: {r[1]} attempts, ${r[2]:.4f}")
    print(f"  Apollo: {ap} calls (priced by plan, not per call)")
    print(f"  Google Places: {places_calls} searches (price each from your Google invoice / vendor price table)")
    print(f"  Tavily: {tavily:.0f} credits (price each from your Tavily plan)")
    print(f"  Recorded total (AI + finders): ${sum(r[2] for r in ai) + sum(r[2] for r in en):.4f}; add Places, Tavily, Apollo above.")


asyncio.run(main())
