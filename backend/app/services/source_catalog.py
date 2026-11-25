"""Where leads and their details come from: one list, owned by the backend (plan 10, Phase 1.1). Screens read it from GET /leadgen/sources.

- **Origin**: how a company joined an account (LeadAccount.source). The stored keys stay as they are ("scout", "copilot"), so no data
  has to move; the newer names are accepted as aliases on the way in (origin_key).
- **Provenance**: where one detail came from: LeadAccount.field_sources[field], CompanyContactPoint.source, and the raw_data keys of a
  shared company record (a register, a bulk dataset, a research run).

Clients see a category ("Official register", "Licensed business data", "Web scrape"). The platform's own staff also see the supplier.

A bulk dataset can say which of its fields came from Google (google_fields). Those values are view-only, like any Google value
(services/data_policy.py): the BN file's phones and websites each come with a Google match (its GoogleName, MatchConfidence and
PhoneInternational columns; every row with a phone or a website has one), so they are treated as Google's.
"""
from __future__ import annotations

from typing import Any, Dict, FrozenSet, List, Optional

ORIGINS: List[Dict[str, str]] = [
    {"key": "scout", "label": "Find Leads", "words": "Found with Find Leads"},
    {"key": "copilot", "label": "AI Assistant", "words": "Found by the AI Assistant"},
    {"key": "import", "label": "Your file", "words": "Imported from your file"},
    {"key": "import_match", "label": "Import & match", "words": "Matched from your file"},
    {"key": "inbound_form", "label": "Web form", "words": "Sent through your web form"},
    {"key": "inbound_call", "label": "Inbound call", "words": "Called you"},
    {"key": "social", "label": "Social", "words": "Engaged on social media or booked through your page"},
    {"key": "api", "label": "API", "words": "Added through the API"},
    {"key": "crm_sync", "label": "CRM sync", "words": "Synced from your CRM"},
    {"key": "manual", "label": "Added by hand", "words": "Added by hand"},
]
ORIGIN_KEYS: FrozenSet[str] = frozenset(o["key"] for o in ORIGINS)
ALIASES = {"find_leads": "scout", "assistant": "copilot"}

# The registers the platform loads (DataSource ids) and what clients call them.
REGISTERS: Dict[str, Dict[str, str]] = {
    "ds_companies_house": {"key": "register:ch", "label": "Companies House"},
    "ds_charity_commission": {"key": "register:charity", "label": "Charity Commission"},
    "ds_food_hygiene": {"key": "register:fsa", "label": "Food Hygiene Rating Scheme"},
    "ds_cqc": {"key": "register:cqc", "label": "Care Quality Commission"},
    "ds_gender_pay_gap": {"key": "register:gpg", "label": "Gender Pay Gap Service"},
}

# Bulk datasets loaded into the shared company records (raw_data key -> what it is). "supplier" is for staff only.
DATASETS: Dict[str, Dict[str, Any]] = {
    "import_bn_leads": {"kind": "licensed", "label": "Licensed business data", "supplier": "BN leads file",
                        "provides": ("phone", "email", "website"), "google_fields": ("phone", "website")},
    "import_scrapegraph_bn": {"kind": "scrape", "label": "Web scrape", "supplier": "ScrapeGraph web scrape",
                              "provides": ("phone", "email", "website"), "google_fields": ()},
    # A research run on 500 companies: Google listing, web search, the company's own site and an e-mail finder. Its phones are
    # labelled "Google Places / company website", so they count as Google's unless an open source (the site crawl) also lists them.
    "fsb_sample_2026_11": {"kind": "research", "label": "Research", "supplier": "FSB sample research run (Nov 2026)",
                           "provides": ("phone", "email", "website"), "google_fields": ("phone",)},
}

# Provenance: key -> (client label, kind, exportable). A key may carry a detail after a colon ("register:ch", "email_finder:hunter").
PROVENANCE: Dict[str, Dict[str, Any]] = {
    "register": {"label": "Official register", "kind": "register", "exportable": True},
    "record": {"label": "Company record", "kind": "record", "exportable": True},
    "website": {"label": "Company website", "kind": "website", "exportable": True},
    "web": {"label": "Web search", "kind": "web", "exportable": True},
    "research": {"label": "Research", "kind": "web", "exportable": True},
    "linkedin": {"label": "Social profile", "kind": "social", "exportable": True},
    "social": {"label": "Social profile", "kind": "social", "exportable": True},
    "scrape": {"label": "Web scrape", "kind": "scrape", "exportable": True},
    "licensed": {"label": "Licensed business data", "kind": "licensed", "exportable": True},
    "email_finder": {"label": "E-mail finder", "kind": "email_finder", "exportable": True},
    "apollo": {"label": "Enrichment data", "kind": "licensed", "exportable": False},
    "google_places": {"label": "Google", "kind": "google", "exportable": False},
    "import": {"label": "Your file", "kind": "user", "exportable": True},
    "user": {"label": "You", "kind": "user", "exportable": True},
    "picked": {"label": "You", "kind": "user", "exportable": True},
    "check": {"label": "Number check", "kind": "check", "exportable": True},
}


def origin_key(value: Any, default: str = "manual") -> str:
    """The stored origin key for a value a caller sent: an alias becomes its key; anything unknown becomes `default`."""
    k = str(value or "").strip().lower()
    k = ALIASES.get(k, k)
    return k if k in ORIGIN_KEYS else default


def origin_label(value: Any) -> str:
    k = origin_key(value)
    return next(o["label"] for o in ORIGINS if o["key"] == k)


def origin_detail(source_url: Any) -> Dict[str, str]:
    """What a saved company's source_url says about how it joined, in words: {"text", "url"}. "file:<name>" is the file it was imported
    from, "form:<id>" a web form, "booking:<post>" the booking page, "api:<id>" the API; a web address is the post or profile it came from."""
    raw = str(source_url or "").strip()
    if not raw:
        return {"text": "", "url": ""}
    head, _, rest = raw.partition(":")
    if head == "file" and rest:
        return {"text": f"From the file {rest[:120]}", "url": ""}
    if head == "form":
        return {"text": "From one of your web forms", "url": ""}
    if head == "booking":
        return {"text": "Booked through your booking page", "url": ""}
    if head == "api":
        return {"text": "Added through the API", "url": ""}
    if head in ("http", "https"):
        return {"text": "From this post or profile", "url": raw[:500]}
    return {"text": "", "url": ""}


def registers_of(raw_data: Any) -> List[str]:
    """The registers a shared company record appears on, by name (Companies House, Charity Commission, ...)."""
    keys = raw_data.keys() if isinstance(raw_data, dict) else []
    return [REGISTERS[k]["label"] for k in REGISTERS if k in keys]


def google_fields(raw_key: str, entry: Any = None) -> FrozenSet[str]:
    """The fields of one raw_data entry that came from Google, for a bulk dataset that says so."""
    ds = DATASETS.get(str(raw_key or ""))
    if not ds:
        return frozenset()
    out = set(ds.get("google_fields") or ())
    if raw_key == "fsb_sample_2026_11" and isinstance(entry, dict):
        said = str(((entry.get("sources") or {}) if isinstance(entry.get("sources"), dict) else {}).get("website") or "")
        if "google" in said.lower():
            out.add("website")
    return frozenset(out)


def _exportable(key: str) -> bool:
    from app.services import data_policy

    return data_policy.exportable(key)


def provenance_label(source: Any, staff: bool = False) -> str:
    """What a screen calls the source of a value. Staff also see the supplier ("Licensed business data (BN leads file)")."""
    raw = str(source or "").strip()
    if not raw:
        return ""
    key, _, detail = raw.lower().partition(":")
    if raw in REGISTERS:
        return REGISTERS[raw]["label"]
    if raw in DATASETS:
        ds = DATASETS[raw]
        return f"{ds['label']} ({ds['supplier']})" if staff else ds["label"]
    if key == "register" and detail:
        reg = next((r["label"] for r in REGISTERS.values() if r["key"] == raw.lower()), "")
        return reg or PROVENANCE["register"]["label"]
    if key == "email_finder" and detail and staff:
        from app.providers import registry

        p = registry.get(detail)
        return f"E-mail finder ({p.label() if p else detail})"
    entry = PROVENANCE.get(key)
    if entry:
        return entry["label"]
    return "Other source"


# How far a saved company got, for "results by origin": each stage counts the companies at it or past it.
REACHED = {"contacted": ("contacted", "interested", "meeting", "won", "lost"), "interested": ("interested", "meeting", "won"),
           "meeting": ("meeting", "won"), "won": ("won",)}


async def summary(db) -> Dict[str, Any]:
    """GET /leadgen/sources/summary for the company in scope (row-level security keeps it to its own saved companies):
    companies by origin with how far they got, and for each of phone, e-mail and website how many have one and where it came from."""
    from sqlalchemy import text

    from app.services import data_policy as DP

    from app.core.tenancy import current_org

    org = {"o": current_org()}  # row-level security keeps it to the company too; the filter says so plainly
    by: Dict[str, Dict[str, Any]] = {}
    for src, stage, n in (await db.execute(text("SELECT coalesce(source, 'manual'), coalesce(stage, 'new'), count(*) FROM lead_accounts WHERE org_id = :o GROUP BY 1, 2"), org)).all():
        key = origin_key(src)
        row = by.setdefault(key, {"key": key, "label": origin_label(key), "count": 0, "reached": {k: 0 for k in REACHED}})
        row["count"] += int(n)
        for k, stages in REACHED.items():
            if stage in stages:
                row["reached"][k] += int(n)
    fields = ("phone", "email", "website")
    coverage: Dict[str, Dict[str, Any]] = {f: {"with": 0, "bySource": {}} for f in fields}
    total = 0
    for phone, email, website, sources in (await db.execute(text("SELECT phone, email, website, field_sources FROM lead_accounts WHERE org_id = :o"), org)).all():
        total += 1
        values = {"phone": phone, "email": email, "website": website}
        for f in fields:
            if not str(values[f] or "").strip():
                continue
            src = DP.public_source((sources or {}).get(f) if isinstance(sources, dict) else "")
            label = PROVENANCE[src]["label"] if src in PROVENANCE else "Not recorded"
            coverage[f]["with"] += 1
            coverage[f]["bySource"][label] = coverage[f]["bySource"].get(label, 0) + 1
    credits = await credits_by_origin(db)
    for key, n in credits["byOrigin"].items():
        row = by.setdefault(key, {"key": key, "label": origin_label(key), "count": 0, "reached": {k: 0 for k in REACHED}})
        row["credits"] = n
    for row in by.values():
        row.setdefault("credits", 0)
    order = {o["key"]: i for i, o in enumerate(ORIGINS)}
    return {"total": total, "origins": sorted(by.values(), key=lambda r: (-r["count"], order.get(r["key"], 99))),
            "credits": {"searches": credits["searches"], "removed": credits["removed"], "total": credits["total"]},
            "coverage": [{"field": f, "with": coverage[f]["with"], "bySource": sorted(({"label": k, "count": v} for k, v in coverage[f]["bySource"].items()),
                                                                                      key=lambda x: -x["count"])} for f in fields]}


async def credits_by_origin(db) -> Dict[str, Any]:
    """The Leads credits the company used, by how the companies they were spent on joined (plan 10, Phase 2: cost per source). Worked
    out from what each charge already names (credit_ledger.ref):
    - "lead:<company record>:<what>" and "deepsearch:<company record>:<what>": a look-up for one company;
    - "chk_<run>:<step>": a company check run, split evenly over the companies it checked (kept under "checkids:<org>:<run>");
    - "email:<message>": an e-mail, through its journey enrolment's saved company (or the company with that address);
    - anything else ("lead:<random>": a search, the assistant): "searches", not tied to one company.
    A company that was removed since counts under "removed". Row-level security keeps it to the company's own lines."""
    from collections import defaultdict

    from sqlalchemy import text

    from app.core.tenancy import current_org
    from app.services.credits import _get_doc

    org = current_org()
    leads = (await db.execute(text("SELECT id, source, business_record_id, lower(coalesce(email, '')) FROM lead_accounts WHERE org_id = :o"), {"o": org})).all()
    by_lead = {lid: origin_key(src) for lid, src, _b, _e in leads}
    by_biz: Dict[str, List[str]] = defaultdict(list)
    by_email: Dict[str, str] = {}
    for lid, src, biz, email in leads:
        if biz:
            by_biz[biz].append(origin_key(src))
        if email:
            by_email.setdefault(email, origin_key(src))
    rows = (await db.execute(text("SELECT coalesce(ref, ''), -amount FROM credit_ledger WHERE org_id = :o AND kind = 'usage' AND wallet = 'leadgen' AND amount < 0"),
                             {"o": org})).all()
    out: Dict[str, float] = defaultdict(float)
    searches = removed = 0.0
    jobs: Dict[str, List[str]] = {}
    mail_refs: Dict[str, float] = defaultdict(float)

    def spread(origins: List[str], n: float) -> None:
        nonlocal removed
        if not origins:
            removed += n
            return
        for o in origins:
            out[o] += n / len(origins)

    for ref, n in rows:
        head, _, rest = ref.partition(":")
        if head in ("lead", "deepsearch") and ":" in rest:
            spread(by_biz.get(rest.split(":")[0], []), n)
        elif head.startswith("chk_"):
            if head not in jobs:
                jobs[head] = list((await _get_doc(db, f"checkids:{org}:{head}")).get("ids") or [])
            ids = jobs[head]
            spread([by_lead[i] for i in ids if i in by_lead] if ids else [], n)
        elif head == "email" and rest:
            mail_refs[rest] += n
        else:
            searches += n
    if mail_refs:
        prefixes = list(mail_refs)
        sent: Dict[str, Any] = {}
        for i in range(0, len(prefixes), 500):
            part = prefixes[i:i + 500]
            for mid, lead_id, email in (await db.execute(text(
                    "SELECT left(m.id, 16), e.lead_id, lower(coalesce(m.recipient_email, '')) FROM email_messages m "
                    "LEFT JOIN email_enrollments e ON e.id = m.enrollment_id AND e.org_id = :o WHERE m.org_id = :o AND left(m.id, 16) = ANY(:p)"),
                    {"p": part, "o": org})).all():
                sent[mid] = by_lead.get(lead_id or "") or by_email.get(email)
        for prefix, n in mail_refs.items():
            spread([sent[prefix]] if sent.get(prefix) else [], n)
    total = sum(n for _r, n in rows)
    return {"byOrigin": {k: round(v) for k, v in out.items() if round(v)}, "searches": round(searches), "removed": round(removed), "total": round(total)}


def catalog(staff: bool = False) -> Dict[str, Any]:
    """GET /leadgen/sources: every origin and provenance key a screen may meet, with its label and whether its values may be exported."""
    prov: List[Dict[str, Any]] = []
    for key, p in PROVENANCE.items():
        prov.append({"key": key, "label": p["label"], "kind": p["kind"], "exportable": _exportable(key)})
    for ds_id, r in REGISTERS.items():
        prov.append({"key": r["key"], "label": r["label"], "kind": "register", "exportable": True, "rawKey": ds_id})
    for ds_id, ds in DATASETS.items():
        row: Dict[str, Any] = {"key": ds_id, "label": ds["label"], "kind": ds["kind"], "exportable": True,
                               "viewOnlyFields": sorted(ds.get("google_fields") or ())}
        if staff:
            row["supplier"] = ds["supplier"]
        prov.append(row)
    return {"origins": [dict(o) for o in ORIGINS], "aliases": dict(ALIASES), "provenance": prov}


def register_or_dataset(raw_key: str) -> Optional[Dict[str, Any]]:
    """What a raw_data key is: {"kind": "register" | "licensed" | ..., "label": ...}, or None for an internal key (lookup_options, ...)."""
    if raw_key in REGISTERS:
        return {"kind": "register", "label": REGISTERS[raw_key]["label"]}
    if raw_key in DATASETS:
        return {"kind": DATASETS[raw_key]["kind"], "label": DATASETS[raw_key]["label"]}
    return None
