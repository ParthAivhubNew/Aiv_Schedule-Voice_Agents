"""How well one company fits the customer's ideal customer (ICP): a score from 0 to 100 and the reasons for it.

Pure: no database and no network. Every reason quotes a fact we hold (a register field, a stored date, a director on the
register, an email that passed a check). A part of the score with nothing stored behind it earns nothing and says
nothing, so a reason can never cite something we don't hold.

A part the ICP leaves open (no sizes picked, say) is left out of the total instead of counting as a match, so the score
is "how much of what you asked for is true", never inflated by criteria nobody set.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional

DEFAULT_WEIGHTS: Dict[str, int] = {"type_sic": 30, "size": 15, "area": 10, "director": 10, "email": 15, "signals": 20}
WEIGHT_LABELS = {
    "type_sic": "Company type and industry match", "size": "Size matches", "area": "In your area",
    "director": "Named active director", "email": "Verified email", "signals": "Reasons to get in touch now",
}

# Company types a customer can pick, and how each shows in the register's category text (lower-cased).
# (label, must contain one of, must contain none of)
COMPANY_TYPES: Dict[str, tuple] = {
    "ltd": ("Private limited company", ("private limited company",), ("guar",)),
    "plc": ("Public limited company", ("public limited",), ()),
    "llp": ("Limited liability partnership", ("limited liability partnership",), ()),
    "cic": ("Community interest company", ("community interest",), ()),
    "guarantee": ("Limited by guarantee", ("guar",), ()),
    "partnership": ("Partnership", ("partnership",), ("limited liability",)),
}
SIZE_BANDS = {"micro": "Micro", "small": "Small", "medium_large": "Medium or large", "dormant": "Dormant"}
CLOSED_WORDS = ("liquidation", "administration", "receiver", "dissolved", "removed", "voluntary arrangement")

DUE_SOON_DAYS = 60
NEW_DIRECTOR_DAYS = 90
NEW_COMPANY_DAYS = 365
MAX_RADIUS_MILES = 15


# ── The ICP ────────────────────────────────────────────────────────────────
def _codes(values: Any, limit: int = 40) -> List[str]:
    out: List[str] = []
    for v in values or []:
        code = re.sub(r"\D", "", str(v))
        if 2 <= len(code) <= 5 and code not in out:
            out.append(code)
    return out[:limit]


_AREA = re.compile(r"^[A-Z]{1,2}(\d[A-Z\d]?)?$")


def _outward(postcode: Any) -> str:
    """'ls6 2ab' -> 'LS6'; a bare district or area is returned as typed (upper-case)."""
    s = re.sub(r"\s+", " ", str(postcode or "").strip().upper())
    return s.split(" ")[0] if s else ""


def clean_icp(raw: Dict[str, Any]) -> Dict[str, Any]:
    """The ICP in its stored shape. Raises ValueError with words the person can act on."""
    raw = raw or {}
    areas_typed = [_outward(a) for a in raw.get("postcode_areas") or [] if str(a).strip()]
    bad = [a for a in areas_typed if not _AREA.match(a)]
    if bad:
        raise ValueError(f"{bad[0]} isn't a postcode area. Use the first part of a postcode, like LS or LS6.")
    areas: List[Dict[str, Any]] = []
    for a in (raw.get("areas") or [])[:5]:
        pc = re.sub(r"\s+", " ", str((a or {}).get("postcode") or "").strip().upper())
        if not pc:
            continue
        try:
            miles = float((a or {}).get("radius_miles") or 0)
        except (TypeError, ValueError):
            miles = 0
        if not 1 <= miles <= MAX_RADIUS_MILES:
            raise ValueError(f"Pick a distance from 1 to {MAX_RADIUS_MILES} miles around {pc}. For a wider area, add postcode areas instead.")
        areas.append({"postcode": pc, "radius_miles": round(miles, 1), "districts": [_outward(d) for d in (a.get("districts") or []) if _outward(d)][:200]})
    labels = raw.get("sic_labels") if isinstance(raw.get("sic_labels"), dict) else {}
    sic = _codes(raw.get("sic_codes"))
    return {
        "sic_codes": sic,
        "sic_labels": {c: str(labels.get(c) or "")[:160] for c in sic if labels.get(c)},
        "postcode_areas": list(dict.fromkeys(areas_typed))[:60],
        "areas": areas,
        "size_bands": [s for s in dict.fromkeys(raw.get("size_bands") or []) if s in SIZE_BANDS],
        "company_types": [t for t in dict.fromkeys(raw.get("company_types") or []) if t in COMPANY_TYPES],
        "exclude_charities": bool(raw.get("exclude_charities")),
    }


def icp_is_set(icp: Optional[Dict[str, Any]]) -> bool:
    """An ICP counts once it says something about who the customer is; excluding charities alone is not enough to score on."""
    i = icp or {}
    return bool(i.get("sic_codes") or i.get("postcode_areas") or i.get("areas") or i.get("size_bands") or i.get("company_types"))


def area_prefixes(icp: Dict[str, Any]) -> List[str]:
    out = list((icp or {}).get("postcode_areas") or [])
    for a in (icp or {}).get("areas") or []:
        out += [d for d in a.get("districts") or [] if d not in out]
    return out


def search_filters(icp: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The Find Leads filters an ICP opens on."""
    i = icp or {}
    f: Dict[str, Any] = {}
    if i.get("sic_codes"):
        f["sic_codes"] = list(i["sic_codes"])
    prefixes = area_prefixes(i)
    if prefixes:
        f["postcode_prefixes"] = prefixes
    if i.get("size_bands"):
        f["size_bands"] = list(i["size_bands"])
    if i.get("company_types"):
        f["company_types"] = list(i["company_types"])
    if i.get("exclude_charities"):
        f["exclude_charities"] = True
    return f


def clean_weights(raw: Dict[str, Any]) -> Dict[str, int]:
    """Staff-set weights. Each part is a whole number from 0 to 100 and together they make 100, so a score stays out of 100."""
    out: Dict[str, int] = {}
    for key in DEFAULT_WEIGHTS:
        try:
            v = (raw or {}).get(key, DEFAULT_WEIGHTS[key])
            n = int(v)
            if n != float(v):
                raise ValueError
        except (TypeError, ValueError):
            raise ValueError(f"{WEIGHT_LABELS[key]}: use a whole number.")
        if not 0 <= n <= 100:
            raise ValueError(f"{WEIGHT_LABELS[key]}: use a number from 0 to 100.")
        out[key] = n
    unknown = [k for k in (raw or {}) if k not in DEFAULT_WEIGHTS]
    if unknown:
        raise ValueError(f"Unknown part: {unknown[0]}.")
    total = sum(out.values())
    if total != 100:
        raise ValueError(f"The parts add up to {total}. Make them add up to 100.")
    return out


# ── Facts about one company ────────────────────────────────────────────────
def type_of(category: Any) -> str:
    s = str(category or "").lower()
    for key, (_, want, never) in COMPANY_TYPES.items():
        if any(w in s for w in want) and not any(n in s for n in never):
            return key
    return ""


def is_charity(category: Any, registration_number: Any = "", source_ids: Iterable[str] = ()) -> bool:
    return ("charit" in str(category or "").lower() or str(registration_number or "").upper().startswith("CC-")
            or any(str(s) == "ds_charity_commission" for s in source_ids or ()))


def is_closed(status: Any) -> bool:
    s = str(status or "").lower()
    return any(w in s for w in CLOSED_WORDS)


def _date(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value or "").strip()[:10]
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _human(d: date) -> str:
    return d.strftime("%d %b %Y").lstrip("0")


def _register_row(raw_data: Any) -> Dict[str, Any]:
    for source in (raw_data or {}).values() if isinstance(raw_data, dict) else []:
        if isinstance(source, dict) and any(str(k).strip() == "CompanyNumber" for k in source):
            return {str(k).strip(): v for k, v in source.items()}
    return {}


def register_dates(biz: Any) -> Dict[str, Optional[date]]:
    """The register's due dates and incorporation date: the stored columns, or (before the backfill has reached this row) the
    register's own file kept in raw_data. Never anything else."""
    row = None

    def pick(attr: str, key: str) -> Optional[date]:
        nonlocal row
        got = _date(getattr(biz, attr, None))
        if got:
            return got
        if row is None:
            row = _register_row(getattr(biz, "raw_data", None))
        return _date(row.get(key))
    return {
        "accounts_due_on": pick("accounts_due_on", "Accounts.NextDueDate"),
        "confstmt_due_on": pick("confstmt_due_on", "ConfStmtNextDueDate"),
        "incorporated_on": _date(getattr(biz, "incorporated_on", None)) or _date(getattr(biz, "incorporation_date", None)),
    }


def _active_directors(officers: Any) -> List[Dict[str, Any]]:
    out = []
    for o in officers or []:
        if not isinstance(o, dict) or not o.get("name") or o.get("resigned_on"):
            continue
        role = str(o.get("role") or "").lower()
        if "director" not in role or role.startswith("corporate"):
            continue
        out.append(o)
    return out


def director_name(officers: Any) -> str:
    """The first active director the register names, as a person reads it ("SMITH, Jane" -> "Jane Smith")."""
    for o in _active_directors(officers):
        name = str(o["name"]).strip()
        if "," in name:
            last, first = [p.strip() for p in name.split(",", 1)]
            name = f"{first} {last}".strip()
        return " ".join(w.capitalize() if w.isupper() else w for w in name.split())
    return ""


def signals(biz: Any, today: Optional[date] = None) -> List[Dict[str, str]]:
    """"Why now" tags from the register: accounts or confirmation statement due within 60 days, a director appointed in the last
    90 days, a company incorporated in the last 12 months. Closed companies get none."""
    today = today or datetime.utcnow().date()
    if is_closed(getattr(biz, "status", "")):
        return []
    d = register_dates(biz)
    out: List[Dict[str, str]] = []
    due = d["accounts_due_on"]
    if due and 0 <= (due - today).days <= DUE_SOON_DAYS:
        out.append({"key": "accounts_due", "label": f"Accounts due {_human(due)}", "detail": f"The register says its next accounts are due on {_human(due)}."})
    cs = d["confstmt_due_on"]
    if cs and 0 <= (cs - today).days <= DUE_SOON_DAYS:
        out.append({"key": "confstmt_due", "label": f"Confirmation statement due {_human(cs)}",
                    "detail": f"The register says its next confirmation statement is due on {_human(cs)}."})
    newest = None
    for o in _active_directors(getattr(biz, "officers", None)):
        on = _date(o.get("appointed_on"))
        if on and 0 <= (today - on).days <= NEW_DIRECTOR_DAYS and (newest is None or on > newest[0]):
            newest = (on, o)
    if newest:
        out.append({"key": "new_director", "label": "New director", "detail": f"{director_name([newest[1]])} was appointed on {_human(newest[0])}."})
    late = [x for x in (d["accounts_due_on"], d["confstmt_due_on"]) if x and x < today]
    if late and not is_closed(getattr(biz, "status", "")):
        out.append({"key": "filed_late", "label": "Accounts overdue", "detail": f"The register shows a filing that was due on {_human(min(late))}."})
    born = d["incorporated_on"]
    if born and 0 <= (today - born).days < NEW_COMPANY_DAYS:
        out.append({"key": "new_company", "label": "New company", "detail": f"Incorporated on {_human(born)}."})
    # Phase 7d: what its own website said when we read it
    site = (getattr(biz, "raw_data", None) or {}).get("site_signals") if isinstance(getattr(biz, "raw_data", None), dict) else None
    if isinstance(site, dict):
        if site.get("mtd"):
            out.append({"key": "site_mtd", "label": "Website mentions Making Tax Digital", "detail": "Its website talks about Making Tax Digital."})
        if site.get("hiring"):
            out.append({"key": "site_hiring", "label": "Hiring", "detail": "Its website has a careers or vacancies page."})
        if site.get("software"):
            out.append({"key": "site_software", "label": "Uses " + ", ".join(site["software"][:2]), "detail": "Its website names " + ", ".join(site["software"]) + "."})
    return out


# ── The score ──────────────────────────────────────────────────────────────
def _sic_pairs(biz: Any) -> List[tuple]:
    pairs = []
    for part in str(getattr(biz, "sic_text", "") or getattr(biz, "industry", "") or "").split(" | "):
        m = re.match(r"^\s*(\d{4,5})\s*-\s*(.+)$", part)
        if m:
            pairs.append((m.group(1), m.group(2).strip()))
    if not pairs:
        pairs = [(c, "") for c in str(getattr(biz, "sic_codes", "") or "").strip("|").split("|") if c]
    return pairs


def _area_match(postcode: str, icp: Dict[str, Any]) -> str:
    """The reason the registered office is inside the area, or ''."""
    out = _outward(postcode)
    if not out:
        return ""
    letters = re.match(r"^[A-Z]+", out)
    for a in icp.get("postcode_areas") or []:
        if a == out or (a.isalpha() and letters and letters.group(0) == a):
            return f"Registered office in {out}, inside {a}"
    for a in icp.get("areas") or []:
        if out in (a.get("districts") or []):
            return f"Registered office in {out}, within {a['radius_miles']:g} miles of {a['postcode']}"
    return ""


def fit(biz: Any, icp: Optional[Dict[str, Any]], signals_found: Optional[List[Dict[str, str]]] = None,
        contacts: Optional[Dict[str, Any]] = None, weights: Optional[Dict[str, int]] = None) -> Optional[Dict[str, Any]]:
    """{score 0-100, reasons[], parts{}} or None when no ICP is set (no score is shown then).

    biz: the stored company (BusinessRecord or anything with its attributes). contacts: {"director": name or "",
    "email": "verified" | "register" | ""} -- only what we hold. weights: the staff-set weights (defaults when None)."""
    if not icp_is_set(icp):
        return None
    w = weights or DEFAULT_WEIGHTS
    contacts = contacts or {}
    status = str(getattr(biz, "status", "") or "")
    if is_closed(status):
        return {"score": 0, "reasons": [f"The register lists it as {status.lower()}"], "parts": {}}
    sources = [s.get("source_id") for s in (getattr(biz, "sources", None) or []) if isinstance(s, dict)]
    if icp.get("exclude_charities") and is_charity(getattr(biz, "company_category", ""), getattr(biz, "registration_number", ""), sources):
        return {"score": 0, "reasons": ["A charity, and you chose to leave charities out"], "parts": {}}
    reasons: List[str] = []
    parts: Dict[str, float] = {}
    total = 0.0

    def earn(key: str, points: float) -> None:
        parts[key] = round(parts.get(key, 0) + points, 2)

    want_sic, want_types = icp.get("sic_codes") or [], icp.get("company_types") or []
    if want_sic or want_types:
        total += w["type_sic"]
        share = w["type_sic"] / (2 if want_sic and want_types else 1)
        if want_sic:
            hit = next(((c, t) for c, t in _sic_pairs(biz) if any(c.startswith(x) for x in want_sic)), None)
            if hit:
                earn("type_sic", share)
                reasons.append(f"Industry on the register: {hit[1] or 'SIC'} ({hit[0]})" if hit[1] else f"Industry on the register: SIC {hit[0]}")
        if want_types:
            kind = type_of(getattr(biz, "company_category", ""))
            if kind and kind in want_types:
                earn("type_sic", share)
                reasons.append(f"{getattr(biz, 'company_category', '')} on the register")
    if icp.get("size_bands"):
        total += w["size"]
        band = getattr(biz, "size_band", "") or ""
        if band in icp["size_bands"]:
            earn("size", w["size"])
            reasons.append(f"Files {SIZE_BANDS[band].lower()} company accounts" if band != "dormant" else "Files dormant accounts")
    if icp.get("postcode_areas") or icp.get("areas"):
        total += w["area"]
        why = _area_match(getattr(biz, "postcode", "") or "", icp)
        if why:
            earn("area", w["area"])
            reasons.append(why)
    total += w["director"]
    if contacts.get("director"):
        earn("director", w["director"])
        reasons.append(f"Director on the register: {contacts['director']}")
    total += w["email"]
    if contacts.get("email") == "verified":
        earn("email", w["email"])
        reasons.append("Email checked and verified")
    elif contacts.get("email") == "register":
        earn("email", w["email"])
        reasons.append("Email published by the register")
    total += w["signals"]
    found = signals_found or []
    if found:
        earn("signals", w["signals"] * (1.0 if len(found) >= 2 else 0.7))
        reasons += [s["detail"] for s in found]
    score = round(100 * sum(parts.values()) / total) if total else 0
    return {"score": max(0, min(100, score)), "reasons": reasons, "parts": parts}


# Registers that publish a contact email themselves. Any other record's email was collected elsewhere, whatever its tier.
REGISTER_EMAIL_SOURCES = frozenset({"ds_charity_commission"})


def source_ids_of(biz: Any) -> list:
    return [str(x.get("source_id") if isinstance(x, dict) else x) for x in (getattr(biz, "sources", None) or [])]


def contacts_of(biz: Any, *, verified_email: bool = False) -> Dict[str, str]:
    """What the score may count about reaching the company: a director the register names, and an email that passed a check
    (or one an official register itself publishes; an email collected from a website is not counted)."""
    official = (getattr(biz, "confidence_tier", "") == "verified_registry" and (getattr(biz, "email", "") or "").strip()
                and bool(REGISTER_EMAIL_SOURCES & set(source_ids_of(biz))))
    email = "verified" if verified_email else ("register" if official else "")
    return {"director": director_name(getattr(biz, "officers", None)), "email": email}
