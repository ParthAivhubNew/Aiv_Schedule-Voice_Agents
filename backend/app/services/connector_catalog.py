"""The Leads Connectors screen, served by the backend (plan 10, Phase 3; plan 11, step 6). GET /leadgen/connectors.

One list, built from what the platform really has. Nothing shows as connected unless something real stands behind it:
- **Official registers**: the DataSource rows. Paused or failing updates show as such; the records already loaded stay searchable.
- **Business data**: the bulk datasets loaded into the shared company records (source_catalog.DATASETS), and the data we don't have
  yet (Experian, Market Location) as "coming soon".
- **Look-ups we run for you**: the providers in app/providers (e-mail finders, phone number check, TPS / CTPS screening), the company
  websites we read, and postcode locations.
- **Provider keys**: ChatGPT, DeepSeek, web search, enrichment data and Google: the company's own key, the platform's, or none.
  A company's rules can switch Google, enrichment data and search engines off; a plan can leave a provider out.
- **Your own systems**: file import, web forms and the Salesforce update file, which are built in; CRMs and warehouses are "coming soon".

Counts: records each source holds in the shared company records (refresh_stats, once a day in the background, because it reads every
record), the company's saved companies that use each source, and the look-ups made for it in the last 30 days.
Clients see categories; the platform's own staff also see supplier names, each e-mail finder and the last error a register gave.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select, text

from app.services import source_catalog as SC

logger = logging.getLogger("connector_catalog")

STATS_KEY = "connector_stats"
STATS_EVERY = timedelta(hours=24)
TEST_GAP_SECONDS = 30
_LAST_TEST: Dict[str, float] = {}

GROUPS = [
    ("registers", "Official registers"),
    ("data", "Business data"),
    ("services", "Look-ups we run for you"),
    ("keys", "Provider keys"),
    ("yours", "Your own systems"),
]

# The kinds of data a connector gives, for the "Data they provide" filter.
KINDS = [
    ("company", "Company details"), ("people", "Directors & people"), ("address", "Addresses & places"), ("phone", "Phone numbers"),
    ("email", "Emails"), ("website", "Websites"), ("sole", "Sole traders"), ("credit", "Financial & credit"),
    ("screening", "Phone screening"), ("yours", "Your own files & records"),
]
_FIELD_KIND = {"name": "company", "registration_number": "company", "industry": "company", "status": "company", "address": "address",
               "postcode": "address", "region": "address", "phone": "phone", "email": "email", "website": "website"}

REGISTER_TEXT: Dict[str, Dict[str, Any]] = {
    "ds_companies_house": {"desc": "Every UK registered company: its number, status, address, industry codes, filed accounts and officers.",
                           "provides": ["company", "people", "address", "credit"], "logo": "companies_house"},
    "ds_charity_commission": {"desc": "Registered charities in England and Wales, with their contact details.",
                              "provides": ["company", "address", "phone", "email", "website"], "logo": "charity"},
    "ds_food_hygiene": {"desc": "Food businesses the councils have inspected, including sole traders, with their hygiene rating.",
                        "provides": ["company", "sole", "address"], "logo": "fsa"},
    "ds_cqc": {"desc": "Care services the Care Quality Commission registers in England, with their ratings and contact details.",
               "provides": ["company", "sole", "address", "phone", "people"], "logo": "cqc"},
    "ds_gender_pay_gap": {"desc": "Employers with 250 or more staff, from their gender pay gap reports: a sign of size.",
                          "provides": ["company", "address"], "logo": "gpg"},
}

COMING_SOON: List[Dict[str, Any]] = [
    {"id": "experian", "name": "Experian", "group": "data", "logo": "experian", "pricing": "experian",
     "desc": "Company credit and business data.", "provides": ["credit", "company", "sole", "people", "address"]},
    {"id": "market_location", "name": "Market Location", "group": "data", "logo": "market_location", "pricing": "market_location",
     "desc": "UK business data.", "provides": ["company", "sole", "people", "address", "phone", "email", "website"]},
    {"id": "salesforce_sync", "name": "Salesforce (live sync)", "group": "yours", "logo": "salesforce", "pricing": "salesforce",
     "desc": "Keep companies and contacts in step with Salesforce.", "provides": ["yours"]},
    {"id": "hubspot", "name": "HubSpot", "group": "yours", "logo": "hubspot", "pricing": "hubspot", "desc": "Sync companies and contacts with HubSpot.", "provides": ["yours"]},
    {"id": "dynamics365", "name": "Microsoft Dynamics 365", "group": "yours", "logo": "dynamics365", "pricing": "dynamics365",
     "desc": "Sync accounts and contacts with Dynamics 365.", "provides": ["yours"]},
    {"id": "zoho_crm", "name": "Zoho CRM", "group": "yours", "logo": "zoho_crm", "pricing": "zoho_crm", "desc": "Sync accounts and contacts with Zoho CRM.", "provides": ["yours"]},
    {"id": "pipedrive", "name": "Pipedrive", "group": "yours", "logo": "pipedrive", "pricing": "pipedrive", "desc": "Sync organisations and people with Pipedrive.", "provides": ["yours"]},
    {"id": "bigquery", "name": "Google BigQuery", "group": "yours", "logo": "bigquery", "pricing": "bigquery", "desc": "Read your own company lists from BigQuery.", "provides": ["yours"]},
    {"id": "postgres", "name": "PostgreSQL", "group": "yours", "logo": "postgres", "pricing": "postgres", "desc": "Read your own company lists from a PostgreSQL database.", "provides": ["yours"]},
    {"id": "snowflake", "name": "Snowflake", "group": "yours", "logo": "snowflake", "pricing": "snowflake", "desc": "Read your own company lists from Snowflake.", "provides": ["yours"]},
    {"id": "s3_lake", "name": "Amazon S3", "group": "yours", "logo": "s3_lake", "pricing": "s3_lake", "desc": "Read company files from an S3 bucket.", "provides": ["yours"]},
    {"id": "airtable", "name": "Airtable", "group": "yours", "logo": "airtable", "pricing": "airtable", "desc": "Read company lists from an Airtable base.", "provides": ["yours"]},
    {"id": "own_ai", "name": "Your own AI model", "group": "keys", "logo": "custom_ai",
     "desc": "Use an AI model your company runs or pays for (Azure, Bedrock, Vertex or self-hosted).", "provides": []},
]

# The provider keys a company can see. word: what connections.platform_provided() calls it; provider: its app/providers id, when it has
# one; rule: the company-rules source that can switch it off.
KEYS: List[Dict[str, Any]] = [
    {"id": "key_openai", "word": "openai", "name": "ChatGPT (OpenAI key)", "logo": "custom_ai", "desc": "The AI that writes, scores and researches.", "provides": []},
    {"id": "key_deepseek", "word": "deepseek", "name": "DeepSeek (API key)", "logo": "custom_ai", "desc": "A second AI model, used for some research steps.", "provides": []},
    {"id": "key_tavily", "word": "tavily", "provider": "tavily", "rule": "search_engines", "name": "Tavily (search key)", "logo": "web",
     "desc": "Searches the web for a company's site, phone and e-mail.", "provides": ["website", "phone", "email"]},
    {"id": "key_apollo", "word": "apollo", "provider": "apollo", "rule": "apollo", "name": "Apollo (key)", "logo": "people",
     "desc": "Enrichment data: people and company details. You can use it in Outreach, but it can't be downloaded.", "provides": ["people", "company", "email"]},
    {"id": "key_google_places", "word": "google_places", "provider": "google_places", "rule": "google", "name": "Google Places (key)",
     "logo": "google", "desc": "Google's business listings: phone, website and opening status. You can use them in Outreach, but they can't be downloaded.",
     "provides": ["phone", "website", "address"]},
]

STATUS_TEXT = {
    "connected": "Connected",
    "paused": "Updates paused",
    "error": "Last update failed",
    "off": "Switched off",
    "not_in_plan": "Not in your plan",
    "not_connected": "Not connected",
    "coming_soon": "Coming soon",
}


def _entry(id_: str, name: str, group: str, status: str, desc: str, **kw: Any) -> Dict[str, Any]:
    out = {"id": id_, "name": name, "group": group, "status": status, "statusLabel": STATUS_TEXT[status], "statusText": "", "desc": desc,
           "provides": [], "logo": "", "pricing": "", "records": None, "leads": None, "uses30d": None, "lastSyncedAt": None,
           "testable": False, "askable": status in ("coming_soon", "not_connected", "not_in_plan")}
    out.update({k: v for k, v in kw.items() if v is not None})
    return out


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() if d else None


# -- counts ---------------------------------------------------------------------------------------------------------------------
async def refresh_stats() -> Dict[str, Any]:
    """Counts each raw_data source over every shared company record, and the postcodes held. Slow on a full register (it reads every
    record), so it runs once a day in the background and the screen shows the last result."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services.credits import _put_doc

    started = time.monotonic()
    with system_scope():
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(text(
                "SELECT k, count(*) FROM business_records, LATERAL jsonb_object_keys(CASE WHEN json_typeof(raw_data) = 'object' "
                "THEN raw_data::jsonb ELSE '{}'::jsonb END) k GROUP BY k"))).all()
            postcodes = (await s.execute(text("SELECT count(*) FROM postcode_geo WHERE lat IS NOT NULL"))).scalar() or 0
            doc = {"at": datetime.utcnow().isoformat(), "records": {k: int(n) for k, n in rows}, "postcodes": int(postcodes),
                   "seconds": round(time.monotonic() - started, 1)}
            await _put_doc(s, STATS_KEY, doc)
            await s.commit()
    return doc


async def stats_due() -> bool:
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services.credits import _get_doc

    with system_scope():
        async with AsyncSessionLocal() as s:
            doc = await _get_doc(s, STATS_KEY)
    try:
        return datetime.utcnow() - datetime.fromisoformat(doc["at"]) >= STATS_EVERY
    except (KeyError, TypeError, ValueError):
        return True


async def _stats(db) -> Dict[str, Any]:
    from app.services.credits import _get_doc

    return await _get_doc(db, STATS_KEY)


async def _leads_by_raw_key(db) -> Dict[str, int]:
    """This company's saved companies, per source their shared company record holds (row-level security keeps it to the company)."""
    rows = (await db.execute(text(
        "SELECT k, count(DISTINCT la.id) FROM lead_accounts la JOIN business_records br ON br.id = la.business_record_id, "
        "LATERAL jsonb_object_keys(CASE WHEN json_typeof(br.raw_data) = 'object' THEN br.raw_data::jsonb ELSE '{}'::jsonb END) k "
        "WHERE la.business_record_id IS NOT NULL GROUP BY k"))).all()
    return {k: int(n) for k, n in rows}


async def _leads_by_origin(db) -> Dict[str, int]:
    rows = (await db.execute(text("SELECT coalesce(source, 'manual'), count(*) FROM lead_accounts GROUP BY 1"))).all()
    out: Dict[str, int] = {}
    for k, n in rows:
        key = SC.origin_key(k)
        out[key] = out.get(key, 0) + int(n)
    return out


async def _uses_30d(db, org_id: str) -> Dict[str, int]:
    """{provider id or ledger source: look-ups} for the company in the last 30 days, from the cost ledger. {} when it can't be read."""
    try:
        async with db.begin_nested():
            rows = (await db.execute(text("SELECT source, provider, count(*) FROM provider_calls WHERE org_id = :o AND at >= :s GROUP BY 1, 2"),
                                     {"o": org_id, "s": datetime.utcnow() - timedelta(days=30)})).all()
    except Exception as err:
        logger.info(f"[connectors] no usage counts: {err}")
        return {}
    out: Dict[str, int] = {}
    for source, provider, n in rows:
        for k in {source, provider} - {""}:
            out[k] = out.get(k, 0) + int(n)
    return out


# -- the catalogue ----------------------------------------------------------------------------------------------------------------
async def _registers(db, records: Dict[str, int], leads: Dict[str, int], staff: bool) -> List[Dict[str, Any]]:
    from app.models.models import DataSource

    runs: Dict[str, List[Any]] = {}
    for r in (await db.execute(text("SELECT source_id, status, error_message, started_at, finished_at FROM data_source_runs ORDER BY started_at DESC"))).all():
        runs.setdefault(r[0], []).append(r)
    out = []
    for ds in (await db.execute(select(DataSource).order_by(DataSource.name))).scalars().all():
        mine = runs.get(ds.id, [])
        done = [r[4] for r in mine if r[1] == "done" and r[4]]
        synced = max([d for d in [ds.last_synced_at, *done] if d], default=None)
        latest = mine[0] if mine else None
        failed = (ds.run_state in ("error", "stuck")) or (latest is not None and latest[1] in ("error", "stuck") and ds.run_state != "paused")
        if ds.status == "disabled":
            status, why = "off", "Switched off by Aivhub. Its records already loaded stay searchable."
        elif ds.run_state == "paused":
            status, why = "paused", "Its records are searchable. New updates are paused."
        elif failed:
            status, why = "error", "Its records are searchable. The last update didn't finish, so recent changes may be missing."
        else:
            status, why = "connected", "Its records are searchable."
        info = REGISTER_TEXT.get(ds.id, {})
        provides = info.get("provides") or sorted({_FIELD_KIND[f] for f in (ds.provides_fields or []) if f in _FIELD_KIND})
        e = _entry(ds.id, ds.name, "registers", status, info.get("desc") or f"Records from {ds.name}.", statusText=why, provides=provides,
                   logo=info.get("logo") or "register", records=records.get(ds.id), leads=leads.get(ds.id, 0),
                   lastSyncedAt=_iso(synced))
        if staff:
            e["lastError"] = (latest[2] if latest is not None and latest[1] in ("error", "stuck") else "") or ds.last_error or ""
            e["runState"] = ds.run_state
        out.append(e)
    return out


def _datasets(records: Dict[str, int], leads: Dict[str, int], staff: bool) -> List[Dict[str, Any]]:
    out = []
    for key, ds in SC.DATASETS.items():
        n = records.get(key, 0)
        if not n:
            continue  # not loaded on this platform, or not counted yet
        view_only = list(ds.get("google_fields") or ())
        note = ""
        if view_only:
            words = " and ".join({"phone": "phone numbers", "website": "websites", "email": "e-mails"}[f] for f in view_only)
            note = f"Its {words} came from Google: you can use them in Outreach, but they can't be downloaded."
        desc = {"licensed": "Business data we licensed and loaded into the company records: phones, e-mails and websites.",
                "scrape": "Phones, e-mails and websites read from company websites in bulk and loaded into the company records.",
                "research": "Phones, e-mails and websites our research found for a sample of companies."}[ds["kind"]]
        e = _entry(key, f"{ds['label']} ({ds['supplier']})" if staff else ds["label"], "data", "connected", desc,
                   statusText=" ".join(x for x in ("Loaded. Its values show in Find Leads and on company pages.", note) if x),
                   provides=list(ds.get("provides") or ()), logo=ds["kind"], records=n, leads=leads.get(key, 0), viewOnly=view_only)
        out.append(e)
    return out


async def _services(org_id: str, records: Dict[str, int], stats: Dict[str, Any], uses: Dict[str, int], staff: bool) -> List[Dict[str, Any]]:
    from app.providers import registry
    from app.services import plan_rules

    out = []
    parts = []
    for p in registry.email_finders():
        if p.manifest.id == "apollo":
            continue  # Apollo is under Provider keys
        has_key = bool(await p.saved_key())
        allowed = await plan_rules.provider_allowed(p.manifest.id, org_id)
        parts.append({"id": p.manifest.id, "name": p.label(), "connected": has_key, "inPlan": allowed})
    live = [x for x in parts if x["connected"] and x["inPlan"]]
    if live:
        status, why = "connected", f"{len(live)} verified e-mail finder{'s' if len(live) != 1 else ''} ready. Each is asked in turn until one finds the address."
    elif any(x["connected"] for x in parts):
        status, why = "not_in_plan", "Your plan doesn't include the e-mail finders."
    else:
        status, why = "not_connected", "No e-mail finder is set up yet."
    e = _entry("email_finders", "E-mail finder (verified)", "services", status,
               "Finds a named person's work e-mail and checks it can receive mail. You pay only when it finds one.",
               statusText=why, provides=["email"], logo="email", uses30d=uses.get("email_finder", 0), testable=bool(live))
    if staff:
        e["parts"] = parts
    out.append(e)

    for pid, name, desc, kind, logo, pricing in (
            ("telnyx_lookup", "Phone number check", "Checks a number is live and whether it's a mobile or a landline.", "phone", "phone", ""),
            ("provero_tps", "TPS & CTPS screening", "Checks numbers against the Telephone Preference Service and Corporate TPS registers before you call.",
             "screening", "tps", "")):
        p = registry.get(pid)
        if p is None:
            continue
        has_key = bool(await p.saved_key())
        allowed = await plan_rules.provider_allowed(pid, org_id)
        status = "connected" if has_key and allowed else ("not_in_plan" if has_key else "not_connected")
        why = {"connected": "Ready.", "not_in_plan": "Your plan doesn't include it.", "not_connected": "Not set up yet."}[status]
        out.append(_entry(pid, (f"{name} ({p.label()})" if staff else name), "services", status, desc, statusText=why, provides=[kind], logo=logo,
                          pricing=pricing, uses30d=uses.get(pid, 0) if pid == "telnyx_lookup" else None,  # TPS checks aren't in the cost ledger yet
                          testable=has_key and allowed and (staff or not p.manifest.test_spends)))

    sites = (records.get("contacts_web") or 0) + (records.get("contacts_web_all") or 0) if records else None
    out.append(_entry("company_websites", "Company websites", "services", "connected",
                      "We read each company's own website for its phone numbers, e-mails and social pages, and check the site works.",
                      statusText="Built in.", provides=["website", "phone", "email"], logo="web", records=sites))
    out.append(_entry("postcodes", "UK postcode locations", "services", "connected",
                      "Postcode centre points from the national postcode directory, for the map and drawn-area search.",
                      statusText="Built in.", provides=["address"], logo="postcode", records=stats.get("postcodes")))
    return out


async def _keys(org_id: str, uses: Dict[str, int], staff: bool) -> List[Dict[str, Any]]:
    from app.api.connections import platform_provided
    from app.services import plan_rules
    from app.services import tenant_policy as TP

    try:
        where = await platform_provided()
    except Exception as err:
        logger.warning(f"[connectors] provider keys unread: {err}")
        where = {}
    try:
        pol = await TP.effective(None, org_id)
    except Exception:
        pol = None
    out = []
    for k in KEYS:
        source = where.get(k["word"], "none")
        if pol is not None and k.get("rule") and pol.restricted(k["rule"]):
            status, why = "off", "Switched off in your company's rules."
        elif source == "none":
            status, why = "not_connected", "No key yet."
        elif k.get("provider") and not await plan_rules.provider_allowed(k["provider"], org_id):
            status, why = "not_in_plan", "Your plan doesn't include it."
        else:
            status, why = "connected", "Your own key." if source == "own" else "Provided by Aivhub."
        out.append(_entry(k["id"], k["name"], "keys", status, k["desc"], statusText=why, provides=list(k["provides"]), logo=k["logo"],
                          pricing=k["id"], keySource=source, uses30d=uses.get(k["provider"]) if k.get("provider") else None,
                          testable=status == "connected" and bool(k.get("provider"))))
    return out


async def _yours(by_origin: Dict[str, int]) -> List[Dict[str, Any]]:
    return [
        _entry("file_import", "File import (CSV / Excel)", "yours", "connected",
               "Bring your own company lists. Columns are matched for you, duplicates are found and companies are matched to the register.",
               statusText="Built in.", provides=["yours"], logo="csv", leads=by_origin.get("import", 0) + by_origin.get("import_match", 0)),
        _entry("web_forms", "Web forms", "yours", "connected", "Forms on your own website that turn visitors into leads.",
               statusText="Built in.", provides=["yours"], logo="form", leads=by_origin.get("inbound_form", 0)),
        _entry("salesforce_file", "Salesforce update file", "yours", "connected",
               "From Import & match: a file of the new phones, websites and e-mails found for your records, ready to load into Salesforce.",
               statusText="Built in. Values from Google or enrichment data are left out of the file.", provides=["yours"], logo="salesforce"),
    ]


async def catalogue(db, org_id: str, staff: bool = False) -> Dict[str, Any]:
    """Every connector the company can see, with its real status and counts."""
    stats = await _stats(db)
    records = stats.get("records") or {}
    leads = await _leads_by_raw_key(db)
    by_origin = await _leads_by_origin(db)
    uses = await _uses_30d(db, org_id)
    items: List[Dict[str, Any]] = []
    items += await _registers(db, records, leads, staff)
    items += _datasets(records, leads, staff)
    items += await _services(org_id, records, stats, uses, staff)
    items += await _keys(org_id, uses, staff)
    items += await _yours(by_origin)
    for c in COMING_SOON:
        items.append(_entry(c["id"], c["name"], c["group"], "coming_soon", c["desc"], statusText="Not built yet. Ask for it and we'll let you know.",
                            provides=list(c["provides"]), logo=c["logo"], pricing=c.get("pricing") or ""))
    return {"connectors": items, "groups": [{"id": g, "label": l} for g, l in GROUPS], "kinds": [{"id": k, "label": l} for k, l in KINDS],
            "countsAt": stats.get("at"), "staff": staff}


# -- the test button ---------------------------------------------------------------------------------------------------------------
async def test(org_id: str, connector_id: str, staff: bool = False) -> Dict[str, Any]:
    """Runs the connector's real check: {"ok", "detail", "checkedAt", maybe "parts"}. A refusal (too soon, not testable) is ok: False with
    the reason. Never raises."""
    from app.providers import registry
    from app.services import plan_rules

    now = time.monotonic()
    gate = f"{org_id}:{connector_id}"
    if now - _LAST_TEST.get(gate, -1e9) < TEST_GAP_SECONDS:
        return {"ok": False, "detail": "This was checked a moment ago. Try again in half a minute.", "checkedAt": None, "refused": True}
    at = datetime.utcnow().isoformat()

    async def one(pid: str, key: str) -> Dict[str, Any]:
        res = await registry.test_key(pid, key)
        return {"ok": bool(res.get("ok")), "detail": str(res.get("detail") or "")}

    if connector_id == "email_finders":
        _LAST_TEST[gate] = now
        parts = []
        for p in registry.email_finders():
            if p.manifest.id == "apollo" or not await plan_rules.provider_allowed(p.manifest.id, org_id):
                continue
            key = await p.saved_key()
            if key:
                r = await one(p.manifest.id, key)
                parts.append({"name": p.label(), **r})
        if not parts:
            return {"ok": False, "detail": "No e-mail finder is set up to check.", "checkedAt": at}
        good = sum(1 for x in parts if x["ok"])
        out: Dict[str, Any] = {"ok": good > 0, "checkedAt": at,
                               "detail": f"{good} of {len(parts)} e-mail finders answered." + ("" if good else " None of them is working, so no e-mails can be found.")}
        if staff:
            out["parts"] = parts
        return out

    key_entry = next((k for k in KEYS if k["id"] == connector_id), None)
    pid = key_entry.get("provider") if key_entry else connector_id
    p = registry.get(pid or "")
    if p is None:
        return {"ok": False, "detail": "This connector has nothing to check: its status comes from the server.", "checkedAt": None, "refused": True}
    if p.manifest.test_spends and not staff:
        return {"ok": False, "detail": "Checking this uses a paid look-up, so Aivhub runs it for you. Ask us if it isn't working.", "checkedAt": None, "refused": True}
    if not await plan_rules.provider_allowed(p.manifest.id, org_id):
        return {"ok": False, "detail": "Your plan doesn't include it.", "checkedAt": at}
    key = ""
    if key_entry:
        from app.api.connections import provider_key
        from app.core.platform import platform_org_id

        if org_id != platform_org_id():
            key = await provider_key(key_entry["word"])
    key = key or await p.saved_key()
    if not key:
        return {"ok": False, "detail": "There's no key to check.", "checkedAt": at}
    _LAST_TEST[gate] = now
    r = await one(p.manifest.id, key)
    if not r["ok"] and not staff:
        from app.services.ai_errors import alert_staff

        await alert_staff("CON-01", f"{connector_id} failed its check for {org_id}: {r['detail']}", org_id=org_id)  # never raises
    if not staff:  # balances and the vendor's own wording are for staff
        r["detail"] = "It answered: it's working." if r["ok"] else "It didn't answer properly, so it isn't working right now. Aivhub has been told."
    return {**r, "checkedAt": at}
