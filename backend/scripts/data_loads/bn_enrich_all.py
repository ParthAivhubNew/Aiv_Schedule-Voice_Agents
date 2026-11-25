"""Checks and fills the BN company data with every source the software already has, EXCEPT Tavily. One script, no project code changed.
Resumable, with pause / resume / workers like the 500-company runner. Every value is saved on the company with its source and date.

For each company (stages; each can be re-run, and finished ones are skipped):
  website  : the website we hold is opened (live? parked? a directory? does it show the company name?). If missing or bad: web search (DeepSeek), then Apollo.
  phones   : numbers from the website, Apollo and earlier finds; each one format-checked and looked up with the carrier (line type, working or not).
  emails   : emails found on the website; the mail server of each domain checked, and Hunter's verifier when a key is saved.
  contacts : the company's current directors from Companies House (the correct named people), each with a verified work email from the email finders when
             one exists; people listed on the website only when the checks in bn_sample_fix.py pass.
  tps      : screened when a TPS provider is configured, otherwise "not screened".
Sources are labelled. Apollo values are marked internal only and are never in the bid-safe export. Google's own phones and websites are used only to
CONFIRM a value (a yes/no is kept), never stored.

  python /tmp/bn_enrich_all.py                          -> status only
  python /tmp/bn_enrich_all.py --go                     -> run or resume on the 500-company sample
  python /tmp/bn_enrich_all.py --go --limit 10          -> try 10 first
  python /tmp/bn_enrich_all.py --go --no-apollo --no-google --no-finder    -> switch sources off
  python /tmp/bn_enrich_all.py --apply                  -> copy checked values into the company's empty website / phone / email fields
  python /tmp/bn_enrich_all.py --export                 -> write /tmp/enriched_all.csv, /tmp/enriched_bid_safe.csv, /tmp/enriched_summary.txt
  Control from another terminal: python /tmp/bn_sample_ctl.py ... works on the sample run only; for this run use
  python /tmp/bn_enrich_all.py --control pause | resume | stop | workers N
  Whole BN set (needs the boss's written approval, see plan Gate A): --go --population 5000 --i-have-approval
"""
import asyncio, csv, json, random, re, sys, time
from datetime import datetime

import httpx
from sqlalchemy import text

from app.core.tenancy import DEFAULT_ORG, set_org
from app.database import AsyncSessionLocal
from app.models.models import AppSetting, BusinessRecord, DataSource
from app.services import company_check as cc
from app.services import company_contacts as CC
from app.services import enrichment_service as ES
from app.services import number_check as NC

A = sys.argv
GO, APPLY, EXPORT = "--go" in A, "--apply" in A, "--export" in A
USE_APOLLO, USE_GOOGLE, USE_FINDER = "--no-apollo" not in A, "--no-google" not in A, "--no-finder" not in A
LIMIT = int(A[A.index("--limit") + 1]) if "--limit" in A else 100000
POPULATION = int(A[A.index("--population") + 1]) if "--population" in A else 0
KEY, SAMPLE_KEY = "fsb_enrich", "fsb_sample_2026_11"
CTL, STATUS = "fsb_bid:enrich:control", "fsb_bid:enrich:status"
PER_COMPANY_TIMEOUT = 240
ROLE = {"info", "sales", "hello", "contact", "contactus", "enquiries", "enquiry", "support", "admin", "office", "accounts", "hr",
        "careers", "marketing", "press", "media", "team", "mail", "general"}
OK_EMAIL = {"valid", "accept_all"}
DIRS = re.compile(r"(facebook|linkedin|twitter|instagram|yell\.com|companieshouse|checkatrade|trustpilot|192\.com|google\.)", re.I)

# ---- no Tavily; Apollo only when asked for explicitly below; no social searches ----
async def _no_search(*a, **k):
    return []
ES.search_tavily = _no_search
from app.services import apollo_first as AF  # noqa: E402
AF.company_first = lambda: False  # Apollo is asked by this script on purpose, never as a side effect
for _n in ("search_web", "search_open_web"):
    def _wrap(orig):
        async def inner(query, *a, **k):
            return [] if "linkedin" in str(query).lower() else await orig(query, *a, **k)
        return inner
    setattr(ES, _n, _wrap(getattr(ES, _n)))
ES.search_duckduckgo = ES.search_open_web


def now():
    return datetime.utcnow().isoformat() + "Z"


def l10(v):
    return cc.last10(str(v or ""))


def host(url):
    return ES._host_of(url if "://" in str(url) else "https://" + str(url)) or ""


# ---- small documents ----
async def get_doc(i):
    async with AsyncSessionLocal() as s:
        row = await s.get(AppSetting, i)
    return dict((row.data or {}) if row else {})


async def put_doc(i, d):
    async with AsyncSessionLocal() as s:
        row = await s.get(AppSetting, i)
        if row:
            row.data = d
        else:
            s.add(AppSetting(id=i, data=d))
        await s.commit()


# ---- the sources ----
async def hunter_status(client, key, email):
    if not key:
        return ""
    for _ in range(3):
        r = await client.get("https://api.hunter.io/v2/email-verifier", params={"email": email, "api_key": key})
        if r.status_code == 429:
            await asyncio.sleep(8)
            continue
        if r.status_code == 202:
            await asyncio.sleep(3)
            continue
        if r.status_code != 200:
            return "error"
        return str(((r.json().get("data") or {}).get("status") or "unknown")).lower().replace("-", "_")
    return "error"


def director_name(raw):
    """'SMITH, Jane Mary' -> ('Jane', 'Smith')."""
    if "," in raw:
        last, first = [p.strip() for p in raw.split(",", 1)]
    else:
        parts = raw.split()
        first, last = (" ".join(parts[:-1]), parts[-1]) if len(parts) > 1 else ("", raw)
    return first.split(" ")[0].title(), last.title()


async def stage_website(biz, sample, opts):
    cands = []
    if sample.get("website"):
        cands.append((sample["website"], "company website / web search (earlier run)", True))
    elif biz.website or biz.domain:
        cands.append((biz.website or biz.domain, "our records", True))
    best = {"url": "", "source": "", "state": "none", "name_seen": False, "bid_safe": True}
    tried = set()

    async def try_site(url, source, safe):
        nonlocal best
        if not url or host(url) in tried or DIRS.search(url):
            return False
        tried.add(host(url))
        st = await cc.website_state(url, biz.name)
        entry = {"url": url, "source": source, "state": st.get("state"), "name_seen": bool(st.get("name_seen")), "bid_safe": safe,
                 "page_phones": st.get("phones") or [], "checked_at": now()}
        if st.get("state") == "live" and (st.get("name_seen") or source.startswith("Apollo")):
            best = entry
            return True
        if best["state"] == "none":
            best = entry
        return False

    for url, source, safe in cands:
        if await try_site(url, source, safe):
            return best
    try:  # web search through DeepSeek (Tavily is off)
        web = await CC.web_contacts(db=opts["db"], biz=biz, want="website")
        if await try_site(web.get("website"), "web search", True):
            return best
    except Exception as err:
        best["note"] = f"web search failed: {str(err)[:80]}"
    if opts["apollo"]:
        try:
            ap = await ES.search_apollo(biz.name, postcode=biz.postcode or "", domain="")
            if ap and await try_site(ap.get("website"), "Apollo (internal licence only)", False):
                best["apollo_phone"] = ap.get("phone") or ""
                return best
            best["apollo_phone"] = (ap or {}).get("phone") or ""
        except Exception as err:
            best["note"] = f"Apollo failed: {str(err)[:80]}"
    return best


async def stage_google_confirm(biz, site):
    """Opens Google's listing only to compare. Nothing from it is stored except yes/no answers."""
    out = {"phone": "", "site_host": "", "postcode_match": False}
    try:
        place = await ES.search_google_places(f"{biz.name} {biz.region or ''}".strip(), name=biz.name, postcode=biz.postcode or "")
    except Exception:
        place = None
    if place:
        out = {"phone": l10(place.get("phone")), "site_host": host(place.get("website") or ""), "postcode_match": bool(place.get("postcode_match"))}
    return out


async def stage_phones(biz, sample, site, google, opts):
    cands = {}

    def add(num, source, safe=True):
        k = l10(num)
        if len(k) != 10:
            return
        e = cands.setdefault(k, {"raw": str(num), "sources": [], "bid_safe": True})
        if source not in e["sources"]:
            e["sources"].append(source)
        e["bid_safe"] = e["bid_safe"] and safe

    for p in sample.get("phones") or []:
        add(p, "company website / web search (earlier run)")
    for p in site.get("page_phones") or []:
        add(p, "company website")
    if site.get("apollo_phone"):
        add(site["apollo_phone"], "Apollo (internal licence only)", False)
    page = [l10(p) for p in site.get("page_phones") or []]
    rows = NC.prepare([{"key": k, "phone": e["raw"], "names": [biz.name]} for k, e in cands.items()], set())
    todo = [r for r in rows if not r["status"]]
    if todo:
        await NC.look_up(todo)  # Telnyx carrier lookup: line type, carrier, working or not
    out = []
    for r in rows:
        k = l10(r["phone"] or r["key"])
        e = cands.get(r["key"]) or cands.get(k) or {"sources": [], "bid_safe": True}
        own = cc.phone_ownership(r["phone"] or r["key"], site=page, place=google.get("phone", ""), record="")
        confirmed = []
        if google.get("phone") and l10(r["phone"]) == google["phone"]:
            confirmed.append("Google listing")
        if own.get("match") == "website":
            confirmed.append("company website")
        out.append({"number": r["phone"] or r["key"], "status": r["status"] or "couldnt_check", "line_type": r["line_type"], "carrier": r["carrier"],
                    "sources": e["sources"], "confirmed_by": confirmed, "bid_safe": e["bid_safe"], "checked_at": now()})
    return out


async def stage_emails(biz, sample, opts, hunter_key, client):
    out = []
    for e in sample.get("emails") or []:
        domain = e.split("@")[-1].lower()
        mx = await cc.email_domain_state(domain)
        hs = await hunter_status(client, hunter_key, e) if hunter_key and mx != "invalid" else ""
        out.append({"email": e, "kind": "generic" if e.split("@")[0].lower() in ROLE else "personal", "source": "company website", "mail_server": mx,
                    "verifier": hs, "verified": hs in OK_EMAIL, "bid_safe": True, "checked_at": now()})
    return out


async def stage_contacts(db, biz, site, emails, opts):
    officers = biz.officers
    if not officers and opts["directors"] is not None:
        try:
            from app.services import company_contacts as _CC
            from app.services import data_source_connector as connector
            got = await connector.fetch_people(opts["directors"], biz.registration_number, owners=False)
            officers = got.get("officers") or []
            for o in officers:
                o["v"] = _CC.PEOPLE_V
            biz.officers = officers
            biz.people_checked_at = datetime.utcnow()
        except Exception as err:
            return [{"note": f"directors not read: {str(err)[:80]}"}]
    people = []
    for o in officers or []:
        role = str(o.get("role") or o.get("officer_role") or "").lower()
        if o.get("resigned_on") or not any(w in role for w in ("director", "secretary", "member")):
            continue
        first, last = director_name(str(o.get("name") or ""))
        if not last:
            continue
        people.append({"name": f"{first} {last}".strip(), "first": first, "last": last, "role": role.replace("-", " ").title() or "Director",
                       "appointed_on": o.get("appointed_on") or "", "source": "Companies House", "email": "", "email_source": "", "email_verified": False, "bid_safe": True})
        if len(people) >= 3:
            break
    domain = host(site.get("url") or "") if site.get("state") == "live" else ""
    for p in people:
        for e in emails:  # an email already found on the website that is clearly this person's
            local = e["email"].split("@")[0].lower()
            if p["last"].lower() in local and (p["first"][:1].lower() in local):
                p.update(email=e["email"], email_source="company website", email_verified=e["verified"])
                break
        if opts["finder"] and domain and p["first"] and not p["email"]:
            try:
                from app.services.enrichment_waterfall import lookup_person_waterfall
                res = await lookup_person_waterfall(db=db, org_id=DEFAULT_ORG, first_name=p["first"], last_name=p["last"], company_name=biz.name,
                                                    domain=domain, bill=False)
                if res.get("found") and res.get("email"):
                    src = str(res.get("source") or "provider")
                    p.update(email=res["email"], email_source=f"email finder ({src})", email_verified=True, bid_safe="apollo" not in src.lower())
            except Exception:
                pass
    return people


async def stage_tps(phones):
    try:
        from app.services import call_permission as CP
        prov = await CP.provider()
        if not prov.configured():
            return {"state": "not screened"}
        nums = [p["number"] for p in phones if p["status"] in ("good", "check")]
        res = await prov.screen(nums)
        return {"state": "screened", "results": res, "at": now()}
    except Exception as err:
        return {"state": "not screened", "note": str(err)[:80]}


async def enrich_one(num, bid, opts):
    async with AsyncSessionLocal() as db:
        biz = await db.get(BusinessRecord, bid)
        opts = {**opts, "db": db}
        raw = dict(biz.raw_data or {})
        sample = raw.get(SAMPLE_KEY) or {}
        prior = raw.get(KEY) or {}
        res = {"started_at": prior.get("started_at") or now(), "errors": []}
        try:
            res["website"] = await asyncio.wait_for(stage_website(biz, sample, opts), 90)
        except Exception as err:
            res["website"] = {"state": "none"}
            res["errors"].append(f"website: {str(err)[:80]}")
        site = res["website"]
        google = {}
        if opts["google"]:
            google = await stage_google_confirm(biz, site)
            res["google_confirmed"] = {"website": bool(google.get("site_host") and google["site_host"] == host(site.get("url") or "")),
                                       "postcode": google.get("postcode_match", False)}
        try:
            res["phones"] = await stage_phones(biz, sample, site, google, opts)
        except Exception as err:
            res["phones"], _ = [], res["errors"].append(f"phones: {str(err)[:80]}")
        async with httpx.AsyncClient(timeout=40) as client:
            try:
                res["emails"] = await stage_emails(biz, sample, opts, opts["hunter"], client)
            except Exception as err:
                res["emails"], _ = [], res["errors"].append(f"emails: {str(err)[:80]}")
        try:
            res["contacts"] = await stage_contacts(db, biz, site, res["emails"], opts)
        except Exception as err:
            res["contacts"], _ = [], res["errors"].append(f"contacts: {str(err)[:80]}")
        res["tps"] = await stage_tps(res["phones"])
        res["status"] = "done"
        res["finished_at"] = now()
        raw[KEY] = res
        biz.raw_data = raw
        await db.commit()
    return "done"


# ---- which companies ----
async def targets():
    async with AsyncSessionLocal() as db:
        if POPULATION:
            if "--i-have-approval" not in A:
                raise SystemExit("The whole-area load needs the boss's written approval (Gate A). Add --i-have-approval once you have it.")
            nums = sorted({l.strip() for l in open("/tmp/bn_population_ids.txt") if l.strip()})
            chosen = random.Random(2026).sample(nums, min(POPULATION, len(nums)))
            rows = (await db.execute(text("SELECT registration_number, id FROM business_records WHERE registration_number = ANY(:n)"), {"n": chosen})).all()
        else:
            rows = (await db.execute(text(f"SELECT registration_number, id FROM business_records WHERE jsonb_exists(raw_data::jsonb, '{SAMPLE_KEY}') ORDER BY registration_number"))).all()
        done = {r[0] for r in (await db.execute(text(
            f"SELECT registration_number FROM business_records WHERE raw_data::jsonb->'{KEY}'->>'status' = 'done'"))).all()}
    return [(n, i) for n, i in rows if n not in done][:LIMIT], len(done)


async def run():
    todo, ndone = await targets()
    print(f"{ndone} already enriched; {len(todo)} to do now.", flush=True)
    if not GO:
        print("Nothing started. Add --go.")
        return
    from app.services.enrichment_waterfall import finder_keys
    keys = await finder_keys()
    async with AsyncSessionLocal() as db:
        ch = await db.get(DataSource, "ds_companies_house")
    opts = {"apollo": USE_APOLLO, "google": USE_GOOGLE, "finder": USE_FINDER, "hunter": keys.get("hunter", ""),
            "directors": ch if (ch and ch.api_key) else None}
    from app.services.telnyx_client import platform_key
    print(f"Carrier phone lookup: {'key found' if platform_key() else 'NO Telnyx key found, phones will be format-checked only'}.", flush=True)
    print(f"Sources: Apollo={'on' if USE_APOLLO else 'off'}, Google confirm={'on' if USE_GOOGLE else 'off'}, email finders={'on' if USE_FINDER else 'off'}, "
          f"Hunter verifier={'key saved' if opts['hunter'] else 'no key (mail-server check only)'}, Companies House directors={'on' if opts['directors'] else 'no key'}.", flush=True)
    if not await get_doc(CTL):
        await put_doc(CTL, {"state": "run", "workers": 3})
    pending, running, done, errors = list(todo), {}, 0, 0
    t0, last = time.monotonic(), 0.0

    async def one(num, bid):
        nonlocal done, errors
        try:
            await asyncio.wait_for(enrich_one(num, bid, opts), PER_COMPANY_TIMEOUT)
            done += 1
        except Exception as err:
            errors += 1
            print("error", num, str(err)[:100], flush=True)

    while pending or running:
        ctl = await get_doc(CTL)
        state, workers = ctl.get("state", "run"), max(1, min(int(ctl.get("workers") or 3), 10))
        if state == "stop" and not running:
            break
        if state == "run":
            while pending and len(running) < workers:
                n, b = pending.pop(0)
                running[asyncio.create_task(one(n, b))] = n
        if running:
            fin, _ = await asyncio.wait(list(running), timeout=3, return_when=asyncio.FIRST_COMPLETED)
            for t in fin:
                running.pop(t)
        else:
            await asyncio.sleep(5)
        if time.monotonic() - last > 10:
            last = time.monotonic()
            print(f"progress: {ndone + done} enriched, {errors} errors, {len(pending)} waiting, {time.monotonic() - t0:.0f}s" + (f"  [{state}]" if state != "run" else ""), flush=True)
            await put_doc(STATUS, {"done": ndone + done, "errors": errors, "waiting": len(pending), "state": state, "updated_at": now()})
    print("Run ended.", flush=True)


# ---- apply, export ----
def good_site(w):
    return w.get("state") == "live" and (w.get("name_seen") or str(w.get("source", "")).startswith("Apollo"))


async def apply_values():
    n = 0
    async with AsyncSessionLocal() as db:
        ids = (await db.execute(text(f"SELECT id FROM business_records WHERE raw_data::jsonb->'{KEY}'->>'status' = 'done'"))).scalars().all()
        for bid in ids:
            biz = await db.get(BusinessRecord, bid)
            r = (biz.raw_data or {}).get(KEY) or {}
            w = r.get("website") or {}
            changed = False
            if good_site(w) and w.get("bid_safe") and not (biz.website or biz.domain):
                biz.website, changed = w["url"], True
            ph = next((p for p in r.get("phones") or [] if p["status"] == "good" and p["bid_safe"] and p["line_type"] in ("landline", "mobile")), None)
            if ph and not biz.phone:
                biz.phone, changed = ph["number"], True
            em = next((e for e in r.get("emails") or [] if e["verified"] and e["bid_safe"]), None)
            if em and not biz.email:
                biz.email, changed = em["email"], True
            n += 1 if changed else 0
        await db.commit()
    print(f"Filled empty website / phone / email fields on {n} companies, using checked, bid-safe values only.")


async def export():
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(
            f"SELECT registration_number, name, postcode, raw_data::jsonb->'{KEY}', raw_data::jsonb->'{SAMPLE_KEY}'->'row' FROM business_records "
            f"WHERE raw_data::jsonb->'{KEY}'->>'status' = 'done' ORDER BY registration_number"))).all()
    cols = ["company_number", "company", "postcode", "website", "website_check", "website_source", "phones", "phone_checks", "emails", "email_checks",
            "directors", "director_emails", "confirmed_by_google", "tps", "sources_include_apollo"]
    out_all, out_safe = [], []
    for num, name, pc, r, old in rows:
        w = r.get("website") or {}
        phones = r.get("phones") or []
        emails = r.get("emails") or []
        people = [c for c in r.get("contacts") or [] if c.get("name")]

        def make(safe):
            ph = [p for p in phones if p["bid_safe"] or not safe]
            em = [e for e in emails if e["bid_safe"] or not safe]
            site_ok = good_site(w) and (w.get("bid_safe") or not safe)
            return {"company_number": num, "company": name, "postcode": pc, "website": w.get("url", "") if site_ok else "",
                    "website_check": (w.get("state") or "") + ("+name seen" if w.get("name_seen") else "") if site_ok else (w.get("state") or ""),
                    "website_source": w.get("source", "") if site_ok else "",
                    "phones": " | ".join(p["number"] for p in ph if p["status"] == "good"),
                    "phone_checks": " | ".join(f"{p['number']}: {p['status']} {p['line_type']} {p['carrier']} [{', '.join(p['sources'])}]" for p in ph),
                    "emails": " | ".join(e["email"] for e in em),
                    "email_checks": " | ".join(f"{e['email']}: server {e['mail_server']}, verifier {e['verifier'] or 'not run'}" for e in em),
                    "directors": " | ".join(f"{p['name']} ({p['role']}, Companies House)" for p in people),
                    "director_emails": " | ".join(f"{p['name']}: {p['email']} [{p['email_source']}, {'verified' if p['email_verified'] else 'unverified'}]" for p in people if p.get("email") and (p.get("bid_safe", True) or not safe)),
                    "confirmed_by_google": "yes" if (r.get("google_confirmed") or {}).get("website") else "",
                    "tps": (r.get("tps") or {}).get("state", ""),
                    "sources_include_apollo": "yes" if any(not p["bid_safe"] for p in phones) or not w.get("bid_safe", True) or any(not c.get("bid_safe", True) for c in people) else ""}
        out_all.append(make(False))
        out_safe.append(make(True))
    for path, data in (("/tmp/enriched_all.csv", out_all), ("/tmp/enriched_bid_safe.csv", out_safe)):
        with open(path, "w", newline="") as fh:
            w_ = csv.DictWriter(fh, fieldnames=cols)
            w_.writeheader()
            w_.writerows(data)
    n = len(rows)

    def count(data, f):
        return sum(1 for d in data if f(d))
    lines = [f"Enrichment of {n} companies, written {now()}.", "Sources: company website, web search (DeepSeek), Companies House, email finders, Hunter verifier, carrier lookup; Apollo kept internal.",
             "Tavily was not used. Google was used only to confirm values; none of its values are stored.", "",
             f"{'':34s}{'all sources':>14s}{'bid-safe':>12s}"]
    for label, f in (("Website, live and company name seen", lambda d: bool(d["website"])), ("At least one working phone (carrier-checked)", lambda d: bool(d["phones"])),
                     ("At least one email", lambda d: bool(d["emails"])),
                     ("At least one director (Companies House)", lambda d: bool(d["directors"])),
                     ("A director with an email", lambda d: bool(d["director_emails"]))):
        lines.append(f"{label:44s}{count(out_all, f):6d} ({100 * count(out_all, f) / max(n, 1):4.1f}%){count(out_safe, f):6d} ({100 * count(out_safe, f) / max(n, 1):4.1f}%)")
    valid = sum(1 for _, _, _, r, _ in rows if any(e["verifier"] == "valid" for e in r.get("emails") or []))
    acc = sum(1 for _, _, _, r, _ in rows if any(e["verifier"] == "accept_all" for e in r.get("emails") or []) and not any(e["verifier"] == "valid" for e in r.get("emails") or []))
    lines += [f"Companies with a website email Hunter says is VALID: {valid} ({100 * valid / max(n, 1):.1f}%); only ACCEPT-ALL (server takes any address, not proof): {acc}", "TPS/CTPS: " + ("screened" if any((r.get('tps') or {}).get('state') == 'screened' for _, _, _, r, _ in rows) else "not screened (no provider configured)")]
    open("/tmp/enriched_summary.txt", "w").write("\n".join(lines) + "\n")
    await put_doc("fsb_bid:enrich", {"saved_at": now(), "summary": lines, "rows_bid_safe": out_safe})
    print("\n".join(lines))
    print("\nWritten: /tmp/enriched_all.csv (internal), /tmp/enriched_bid_safe.csv (no Apollo), /tmp/enriched_summary.txt; stored as app_settings 'fsb_bid:enrich'.")


async def control():
    cmd = A[A.index("--control") + 1]
    ctl = await get_doc(CTL)
    if cmd in ("pause", "resume", "stop"):
        ctl["state"] = {"pause": "pause", "resume": "run", "stop": "stop"}[cmd]
    elif cmd == "workers":
        ctl["workers"] = max(1, min(int(A[A.index("--control") + 2]), 10))
    await put_doc(CTL, ctl)
    print("control:", ctl, "status:", await get_doc(STATUS))


async def main():
    set_org(DEFAULT_ORG)
    try:  # the carrier lookup needs the Telnyx key staff saved in the admin portal; the running app loads it at start-up, a script has to ask
        from app.services.telnyx_client import refresh_saved_key
        await refresh_saved_key()
    except Exception:
        pass
    if "--control" in A:
        await control()
    elif APPLY:
        await apply_values()
    elif EXPORT:
        await export()
    else:
        await run()


asyncio.run(main())
