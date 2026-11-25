"""FSB bid: find rate on 500 random companies from the Appendix 1 population (developer note item 2). RESUMABLE version.

What it does for each company (normal enrichment, no Apollo): Google listing, web search, the company's own website, email finder.
Every company's result is saved in the database the moment it finishes (on the company, under raw_data["fsb_sample_2026_11"]), so nothing is
lost if this stops for any reason. Starting it again skips finished companies. Google's own phones and websites are never saved.

  python /tmp/bn_sample500_v2.py                    -> status only, spends nothing
  python /tmp/bn_sample500_v2.py --go               -> run, or resume
  python /tmp/bn_sample500_v2.py --go --limit 20    -> only the first 20 of the 500 (a trial; they count towards the 500)
  python /tmp/bn_sample500_v2.py --go --retry       -> also redo companies that errored or timed out
  python /tmp/bn_sample500_v2.py --summary          -> write the results so far (CSV, text and the database record), spends nothing
Control while it runs (from another terminal): python /tmp/bn_sample_ctl.py pause | resume | stop | workers N | status
Needs /tmp/bn_population_ids.txt.
"""
import asyncio, contextvars, csv, json, random, re, sys, time
from datetime import datetime

from sqlalchemy import text

from app.core.tenancy import DEFAULT_ORG, set_org
from app.database import AsyncSessionLocal
from app.models.models import AppSetting, BusinessRecord
from app.services import company_contacts as CC
from app.services import enrichment_service as ES
from app.services import tavily_pool as TP

GO = "--go" in sys.argv
RETRY = "--retry" in sys.argv
SUMMARY = "--summary" in sys.argv
LIMIT = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 500
N, SEED, KEY = 500, 2026, "fsb_sample_2026_11"
CTL, STATUS, RESULT = "fsb_bid:sample500:control", "fsb_bid:sample500:status", "fsb_bid:sample500"
PLACES_USD, TAVILY_USD, GBP_PER_USD = 0.035, 0.008, 0.79
PER_COMPANY_TIMEOUT, MAX_REDO = 180, 2

LAND = re.compile(r"^0[123][0-9]{8,9}$")
MOB = re.compile(r"^07[1-57-9][0-9]{8}$")
ROLE = {"info", "sales", "hello", "contact", "contactus", "enquiries", "enquiry", "support", "admin", "office", "accounts", "hr",
        "careers", "marketing", "press", "media", "team", "mail", "general"}
DIRS = re.compile(r"(facebook|linkedin|twitter|instagram|yell\.com|companieshouse|checkatrade|trustpilot|192\.com|google\.)", re.I)

# ---- Apollo is never used ----
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

# ---- one box per company: what it used, and whether Tavily refused anything ----
BOX = contextvars.ContextVar("box", default=None)

_orig_search = TP.search
async def _counted_search(client, body, *, purpose="search"):
    r = await _orig_search(client, body, purpose=purpose)
    box = BOX.get()
    if box is not None:
        status = int(getattr(r, "status_code", 0) or 0) if r is not None else 0
        if status == 200:
            try:
                box["tavily"] += float(((r.json().get("usage") or {}).get("credits")) or 1)
            except Exception:
                box["tavily"] += 1
        else:
            box["refused"] += 1
    return r
TP.search = _counted_search

# ---- this task's own rules, kept in this script ----
# no LinkedIn / social searches; at most 3 Tavily searches in flight; the same search is answered once
_cache = {}
_tav_gate = None
_orig_tavily = ES.search_tavily
async def _own_tavily(query, *a, **k):
    global _tav_gate
    if "linkedin" in str(query).lower():
        return []
    key = (str(query), tuple(k.get("include_domains") or ()), k.get("depth", "basic"), k.get("max_results", a[0] if a else 5))
    if key in _cache:
        return [dict(x) for x in _cache[key]]
    if _tav_gate is None:
        _tav_gate = asyncio.Semaphore(3)
    async with _tav_gate:
        res = await _orig_tavily(query, *a, **k)
    box = BOX.get()
    if res or not (box and box["refused"]):  # a refused search is not cached: it must be asked again when a key is available
        _cache[key] = [dict(x) for x in res]
    return res
ES.search_tavily = _own_tavily
for _name in ("search_web", "search_open_web"):
    def _wrap(orig):
        async def inner(query, *a, **k):
            return [] if "linkedin" in str(query).lower() else await orig(query, *a, **k)
        return inner
    setattr(ES, _name, _wrap(getattr(ES, _name)))
ES.search_duckduckgo = ES.search_open_web

_orig_places = ES.search_google_places
async def _counted_places(*a, **k):
    box = BOX.get()
    if box is not None:
        box["places"] += 1
    return await _orig_places(*a, **k)
ES.search_google_places = _counted_places


def digits(p):
    d = re.sub(r"\D", "", re.sub(r"\(0\)", "", str(p or "")))
    return re.sub(r"^(0044|44)", "0", d)


def local(e):
    return str(e or "").split("@")[0].lower()


# ---- small documents: control, status ----
async def get_doc(doc_id):
    async with AsyncSessionLocal() as s:
        row = await s.get(AppSetting, doc_id)
    return dict((row.data or {}) if row else {})


async def put_doc(doc_id, data):
    async with AsyncSessionLocal() as s:
        row = await s.get(AppSetting, doc_id)
        if row:
            row.data = data
        else:
            s.add(AppSetting(id=doc_id, data=data))
        await s.commit()


async def set_status(**fields):
    cur = await get_doc(STATUS)
    cur.update(fields, updated_at=datetime.utcnow().isoformat() + "Z")
    await put_doc(STATUS, cur)


# ---- the sample ----
async def pick():
    nums = sorted({l.strip() for l in open("/tmp/bn_population_ids.txt") if l.strip()})
    chosen = random.Random(SEED).sample(nums, min(N, len(nums)))
    json.dump(chosen, open("/tmp/sample_company_numbers.json", "w"))
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text("SELECT registration_number, id FROM business_records WHERE registration_number = ANY(:n)"), {"n": chosen})).all()
    by = {}
    for num, i in rows:
        by.setdefault(num, i)
    return [(n, by[n]) for n in chosen if n in by]


async def states(pairs):
    """{company number: status} for companies already worked on: done, weak (Tavily refused something), error."""
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(
            f"SELECT registration_number, raw_data::jsonb->'{KEY}'->>'status', COALESCE((raw_data::jsonb->'{KEY}'->>'redo')::int, 0) FROM business_records "
            f"WHERE registration_number = ANY(:n) AND jsonb_exists(raw_data::jsonb, '{KEY}')"), {"n": [n for n, _ in pairs]})).all()
    return {r[0]: (r[1], r[2]) for r in rows}


# ---- one company ----
async def one(db, biz):
    out = {"phones": [], "emails": [], "website": "", "team": [], "finder": "", "finder_verified": False, "place_phone": "", "place_site": ""}
    place = await ES.search_deeper(f"{biz.name} {biz.region or ''}".strip(), name=biz.name, postcode=biz.postcode or "", domain="", want="")
    if place:
        if place.get("phone"):
            out["phones"].append(place["phone"])
            out["place_phone"] = place["phone"]
        out["website"] = place.get("website") or ""
        out["place_site"] = out["website"]
    web = await CC.web_contacts(db, biz, want="all")
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
                out["finder_verified"] = True  # the finder only returns an address its verifier passed
        except Exception:
            pass
    return out


def row_of(num, name, r, secs, direct_usd):
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
        "named_contact": int(bool(named)), "named_contact_name_role": f"{named.get('name', '')} | {named.get('title', '')}" if named else "",
        "named_email_found": int(bool(named_em)), "named_email_verified": int(bool(r["finder_verified"])),
        "tps_ctps": "not screened", "seconds": round(secs, 1), "direct_usd": round(direct_usd, 5),
    }


def save_found(biz, r, status, row, box):
    """Saved on the company at once. Google's own phone and website are left out (Google's terms); everything else is kept with its source."""
    google_phone = digits(r["place_phone"])
    ph = [p for p in r["phones"] if (LAND.match(digits(p)) or MOB.match(digits(p))) and digits(p) != google_phone]
    em = sorted({e.lower() for e in r["emails"] if "@" in e} | {t["email"].lower() for t in r["team"] if t.get("email")})
    site = r["website"] if r["website"] and not DIRS.search(r["website"]) and r["website"] != r["place_site"] else ""
    raw = dict(biz.raw_data or {})
    prior = raw.get(KEY) or {}
    raw[KEY] = {
        "status": status, "redo": int(prior.get("redo") or 0) + (1 if status == "weak" else 0), "found_at": datetime.utcnow().isoformat() + "Z", "seed": SEED,
        "website": site, "phones": sorted(set(ph)), "emails": em, "team": [{"name": t.get("name", ""), "title": t.get("title", "")} for t in r["team"]],
        "sources": {"website": "Google Places" if r["place_site"] else "web search", "phones": "company website / web search",
                    "emails": "company website" + (" and email finder" if r["finder"] else "")},
        "finder_email_verified": bool(r["finder_verified"]), "row": row,
        "used": {"google_searches": box["places"], "tavily_credits": box["tavily"], "tavily_refused": box["refused"]},
    }
    biz.raw_data = raw
    if status == "done":
        if site and not (biz.website or biz.domain):
            biz.website = site
        if ph and not biz.phone:
            biz.phone = ph[0]


async def mark(bid, status, message):
    """A company that could not be finished is marked, so the run knows and a retry can pick it up."""
    async with AsyncSessionLocal() as s:
        biz = await s.get(BusinessRecord, bid)
        if biz:
            raw = dict(biz.raw_data or {})
            raw[KEY] = {**(raw.get(KEY) or {}), "status": status, "error": message[:200], "found_at": datetime.utcnow().isoformat() + "Z"}
            biz.raw_data = raw
            await s.commit()


async def process(num, bid, stats):
    box = {"places": 0, "tavily": 0.0, "refused": 0}
    BOX.set(box)
    t0 = time.monotonic()
    async with AsyncSessionLocal() as db:
        try:
            biz = await db.get(BusinessRecord, bid)
            r = await asyncio.wait_for(one(db, biz), timeout=PER_COMPANY_TIMEOUT)
            status = "weak" if box["refused"] else "done"
            direct = box["places"] * PLACES_USD + box["tavily"] * TAVILY_USD
            save_found(biz, r, status, row_of(num, biz.name, r, time.monotonic() - t0, direct), box)
            await db.commit()
            stats["done" if status == "done" else "weak"] += 1
            stats["last"] = biz.name
            return status
        except asyncio.TimeoutError:
            await db.rollback()
            await mark(bid, "error", f"timed out after {PER_COMPANY_TIMEOUT}s")
        except Exception as err:
            await db.rollback()
            await mark(bid, "error", str(err))
    stats["errors"] += 1
    return "error"


async def tavily_usable():
    ks = await TP.keys()
    return any(TP.cooling_for(k[0]) == 0 for k in ks)


# ---- results from the database (works at any point, even half way) ----
async def summary():
    pairs = await pick()
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(
            f"SELECT registration_number, raw_data::jsonb->'{KEY}' FROM business_records WHERE registration_number = ANY(:n) AND jsonb_exists(raw_data::jsonb, '{KEY}')"),
            {"n": [n for n, _ in pairs]})).all()
    done = [r[1]["row"] for r in rows if r[1].get("status") == "done" and r[1].get("row")]
    weak = sum(1 for r in rows if r[1].get("status") == "weak")
    err = sum(1 for r in rows if r[1].get("status") == "error")
    status = await get_doc(STATUS)
    since = status.get("started_at") or "1970-01-01T00:00:00"
    async with AsyncSessionLocal() as db:
        ai = float((await db.execute(text("SELECT coalesce(sum(cost_usd),0) FROM ai_usage WHERE created_at >= :s"), {"s": datetime.fromisoformat(since.rstrip("Z"))})).scalar() or 0)
        fn = float((await db.execute(text("SELECT coalesce(sum(cost_usd),0) FROM enrichment_attempts WHERE created_at >= :s"), {"s": datetime.fromisoformat(since.rstrip("Z"))})).scalar() or 0)
        ap = (await db.execute(text("SELECT count(*) FROM apollo_calls WHERE at >= :s"), {"s": datetime.fromisoformat(since.rstrip("Z"))})).scalar()
    n = len(done)
    shared = (ai + fn) / n if n else 0
    for r in done:
        r["cost_pence"] = round((r.pop("direct_usd", 0) + shared) * GBP_PER_USD * 100, 2)
    cols = ["company_number", "company", "website", "landline", "mobile", "generic_email_found", "generic_email_verified", "named_contact",
            "named_contact_name_role", "named_email_found", "named_email_verified", "tps_ctps", "cost_pence", "seconds"]
    done.sort(key=lambda r: r["company_number"])
    with open("/tmp/sample_500_rows.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(done)
    total = sum(r["cost_pence"] for r in done)
    lines = [f"FSB Appendix 1 Part B: {n} of {len(pairs)} sampled companies finished ({weak} awaiting redo, {err} errors), random seed {SEED}, report written {datetime.utcnow():%Y-%m-%d %H:%M} UTC.",
             f"Normal enrichment: Google Places, website research, email finders. Apollo not used (Apollo calls recorded since the run began: {ap}).",
             f"Average {sum(r['seconds'] for r in done) / max(n, 1):.1f}s per company.", ""]
    for k, label in (("website", "Website"), ("landline", "Landline (01/02/03)"), ("mobile", "Mobile (07)"), ("generic_email_found", "Generic email found"),
                     ("generic_email_verified", "Generic email verified"), ("named_contact", "Named contact (name + role)"),
                     ("named_email_found", "Named-contact email found"), ("named_email_verified", "Named-contact email verified")):
        v = sum(r[k] for r in done)
        lines.append(f"{label:32s} {v:4d}  {100 * v / max(n, 1):5.1f}%  of {n}")
    lines += ["TPS/CTPS: not screened (no Data Soap account yet).", "",
              f"Total cost: GBP {total / 100:.2f} (about USD {total / 100 / GBP_PER_USD:.2f}); average {total / max(n, 1):.1f}p per company.",
              f"Built from: Google searches and Tavily credits counted per company at USD {PLACES_USD} and {TAVILY_USD} each; AI models USD {ai:.2f} and email finders USD {fn:.2f} recorded by the app, shared equally.",
              "Website emails are not run through an email verifier in the normal flow; only finder emails are verified."]
    open("/tmp/sample_500_summary.txt", "w").write("\n".join(lines) + "\n")
    await put_doc(RESULT, {"saved_at": datetime.utcnow().isoformat() + "Z", "seed": SEED, "complete": n >= len(pairs), "summary": lines, "rows": done})
    print("\n".join(lines))
    print("\nWritten: /tmp/sample_500_rows.csv, /tmp/sample_500_summary.txt; stored as app_settings 'fsb_bid:sample500'.")


async def main():
    set_org(DEFAULT_ORG)
    if SUMMARY:
        await summary()
        return
    pairs = await pick()
    st = await states(pairs)
    done = [n for n, (s, _) in st.items() if s == "done"]
    todo = [(n, i) for n, i in pairs if st.get(n, ("", 0))[0] != "done" and (st.get(n, ("", 0))[0] != "error" or RETRY)]
    todo = todo[: max(0, LIMIT - len(done))] if LIMIT < N else todo
    print(f"Sample {len(pairs)}: {len(done)} done, {sum(1 for s, _ in st.values() if s == 'weak')} to redo, {sum(1 for s, _ in st.values() if s == 'error')} errored. To process now: {len(todo)}.", flush=True)
    if not GO:
        print("Nothing started. Add --go to run or resume.")
        return
    ctl = await get_doc(CTL)
    if not ctl.get("state"):
        await put_doc(CTL, {"state": "run", "workers": 3})
    cur = await get_doc(STATUS)
    await set_status(started_at=cur.get("started_at") or datetime.utcnow().isoformat() + "Z", total=len(pairs), state="running", finished=False)
    stats = {"done": 0, "weak": 0, "errors": 0, "last": ""}
    pending = list(todo)
    running = {}  # task -> (num, bid)
    redo_count = {n: c for n, (_, c) in st.items()}
    t0 = time.monotonic()
    last_report = 0.0
    while pending or running:
        ctl = await get_doc(CTL)
        state, workers = ctl.get("state", "run"), max(1, min(int(ctl.get("workers") or 3), 12))
        reason = ""
        if state == "stop":
            reason = "stopped by you"
        elif state == "pause":
            reason = "paused by you"
        elif pending and not await tavily_usable():
            reason = "waiting: every Tavily key is over its limit (add a key in the admin portal, or wait)"
        if reason:
            if not running:
                await set_status(state="paused" if state != "stop" else "stopped", paused_reason=reason)
                if state == "stop":
                    break
        else:
            while pending and len(running) < workers:
                num, bid = pending.pop(0)
                running[asyncio.create_task(process(num, bid, stats))] = (num, bid)
        if running:
            finished, _ = await asyncio.wait(list(running), timeout=3, return_when=asyncio.FIRST_COMPLETED)
            for task in finished:
                num, bid = running.pop(task)
                if task.result() == "weak" and redo_count.get(num, 0) < MAX_REDO:
                    redo_count[num] = redo_count.get(num, 0) + 1
                    pending.append((num, bid))  # Tavily refused something: try this company again later
        else:
            await asyncio.sleep(5)
        if time.monotonic() - last_report > 10:
            last_report = time.monotonic()
            finished_n = len(done) + stats["done"]
            await set_status(state="running" if not reason else "paused", paused_reason=reason, done=finished_n, weak=stats["weak"], errors=stats["errors"],
                             last_company=stats["last"], workers=workers)
            print(f"progress: {finished_n} of {len(pairs)} done, {stats['weak']} redo, {stats['errors']} errors, {time.monotonic() - t0:.0f}s"
                  + (f"  [{reason}]" if reason else ""), flush=True)
    await set_status(state="finished" if not pending else "stopped", done=len(done) + stats["done"], finished=not pending)
    print("Run ended. Writing the results.", flush=True)
    await summary()


asyncio.run(main())
