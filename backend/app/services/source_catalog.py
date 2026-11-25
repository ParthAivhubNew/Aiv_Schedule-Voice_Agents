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
