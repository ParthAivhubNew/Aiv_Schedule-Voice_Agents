"""Which data may leave the app.

Google-sourced and Apollo-sourced values can be seen and used inside Outreach but are never exported or returned to API callers.
Only a phone number or website read from the company's own site (source "website") is ours to hand over.

A LeadAccount carries `field_sources` ({"phone": "website", ...}). Values saved before that column existed have none, so
`restricted_fields` falls back to a conservative value match against what the company record holds from each source.

A bulk dataset can hold some fields that came from Google (services/source_catalog.google_fields: the BN file's phones and websites).
Those values count as Google's, unless an open source (the company's own site, a register, a web scrape) also lists the same value.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

def _non_exportable() -> frozenset:
    """Sources whose values never leave the app in an export: every registered provider whose licence says so (app/providers, today
    Apollo), plus Google Places, which is not a provider file yet."""
    try:
        from app.providers import registry

        return frozenset({"google_places"} | registry.non_exportable())
    except Exception:  # the registry must never make an export rule disappear
        return frozenset({"google_places", "apollo"})


NON_EXPORTABLE = _non_exportable()
FIELDS = ("phone", "website", "email")
# Recorded sources that only say "copied from the shared company record": the record is checked again, because an older copy may
# have called a value from a bulk dataset's Google fields "register".
COPIED = frozenset({"register", "record"})

TOOLTIP = "From Google. You can see and use it in Outreach, but it can't be downloaded."
TOOLTIP_APOLLO = "From our enrichment data. You can see and use it in Outreach, but it can't be downloaded."
EXPORT_POPUP = ("Some of this data came from Google's API. Google's rules don't allow us to let you download it. "
                "You can see it and use it inside Outreach, but it is left out of the file.")


def _key(source: Any) -> str:
    return str(source or "").strip().lower().split(":")[0]


def is_restricted(source: Any) -> bool:
    return _key(source) in NON_EXPORTABLE


def exportable(source: Any) -> bool:
    return not is_restricted(source)


def tooltip(source: Any) -> str:
    key = _key(source)
    if key == "apollo":
        return TOOLTIP_APOLLO
    return TOOLTIP if key in NON_EXPORTABLE else ""


def source_of_value(field_sources: Optional[Dict[str, Any]], field: str) -> str:
    """Where a saved value came from, or "" when nothing was recorded (a value saved before provenance existed)."""
    if not isinstance(field_sources, dict):
        return ""
    return str(field_sources.get(field) or "")


def _norm(kind: str, value: Any) -> str:
    from app.services import contact_points as CP

    return CP.norm(kind, value)


def _entry_values(rec: Any) -> Dict[str, Set[str]]:
    """The phones, websites and emails one raw_data entry lists, comparable form."""
    from app.services import contact_points as CP

    out: Dict[str, Set[str]] = {k: set() for k in FIELDS}
    if not isinstance(rec, dict):
        return out
    pools = [rec]
    if isinstance(rec.get("raw"), dict):
        pools.append(rec["raw"])
    for pool in pools:
        for field, value in pool.items():
            kind = CP._SOURCE_KEYS.get(str(field).strip().lower())
            if kind in out and isinstance(value, str) and _norm(kind, value):
                out[kind].add(_norm(kind, value))
        pp = pool.get("primary_phone")
        if isinstance(pp, dict) and _norm("phone", pp.get("number") or pp.get("sanitized_number")):
            out["phone"].add(_norm("phone", pp.get("number") or pp.get("sanitized_number")))
        for list_key, kind in (("phones", "phone"), ("emails", "email"), ("websites", "website")):
            for item in pool.get(list_key) or [] if isinstance(pool.get(list_key), list) else []:
                v = item.get("value") if isinstance(item, dict) else item
                if isinstance(v, str) and _norm(kind, v):
                    out[kind].add(_norm(kind, v))
    return out


def _option_values(raw: Dict[str, Any]) -> Dict[str, Set[str]]:
    """Candidates the lookups offered that Google supplied (older records kept the text)."""
    out: Dict[str, Set[str]] = {k: set() for k in FIELDS}
    opts = raw.get("lookup_options")
    for kind, items in (opts.items() if isinstance(opts, dict) else []):
        if kind not in out:
            continue
        for o in items or []:
            if not isinstance(o, dict):
                continue
            text = " ".join([str(o.get("label") or ""), *[str(s) for s in (o.get("sources") or [])]]).lower()
            if "google" in text and _norm(kind, o.get("value")):
                out[kind].add(_norm(kind, o["value"]))
    return out


# How sure a source is, lowest first: when two sources list the same value, the first in this order is where it came from.
_RANK = {"register": 0, "website": 1, "licensed": 2, "scrape": 2, "research": 2, "web": 3, "apollo": 8, "google_places": 9}


def _claims(raw: Dict[str, Any]) -> List[Tuple[str, Dict[str, Set[str]]]]:
    """(provenance key, {field: values}) for every place a company record's raw_data lists phones, websites and e-mails. The keys are
    source_catalog's: "register:<x>" (or "register" for a register not named there), "website" (the company's own site), "licensed",
    "scrape" or "research" (a bulk dataset), "web" (a web search, and anything else), and the view-only "google_places" and "apollo".
    A dataset whose phones came from Google gives a "google_places" claim for them and its own claim for the rest."""
    from app.services import source_catalog as SC

    out: List[Tuple[str, Dict[str, Set[str]]]] = []
    for key, rec in (raw or {}).items():
        if key == "lookup_options" or not isinstance(rec, dict):
            continue
        if key == "contacts_web":
            vals: Dict[str, Set[str]] = {k: set() for k in FIELDS}
            vals["website"] |= {_norm("website", rec.get("website"))} - {""}
            for ph in rec.get("phones") or []:
                vals["phone"] |= {_norm("phone", ph.get("value") if isinstance(ph, dict) else ph)} - {""}
            for em in rec.get("emails") or []:
                vals["email"] |= {_norm("email", em.get("value") if isinstance(em, dict) else em)} - {""}
            src = _key(rec.get("source"))
            out.append((src if src in NON_EXPORTABLE else "website", vals))
            continue
        vals = _entry_values(rec)
        head = _key(key)
        if key in SC.REGISTERS:
            out.append((SC.REGISTERS[key]["key"], vals))
        elif head.startswith("ds_"):
            out.append(("register", vals))
        elif head in NON_EXPORTABLE:
            out.append((head, vals))
        elif key in SC.DATASETS:
            google = SC.google_fields(key, rec)
            out.append(("google_places", {k: (v if k in google else set()) for k, v in vals.items()}))
            out.append((SC.DATASETS[key]["kind"], {k: (set() if k in google else v) for k, v in vals.items()}))
        elif head == "website_confirmed":
            out.append(("website", vals))
        else:
            out.append(("web", vals))
    out.append(("google_places", _option_values(raw or {})))
    return out


def _held_by(raw: Dict[str, Any]) -> Dict[str, Dict[str, Set[str]]]:
    """{"restricted": {kind: values}, "open": {kind: values}, "google": {kind: values}} for one company record's raw_data.
    "google" is the part of "restricted" that came from Google (Google Places, the lookups' Google options, a dataset's Google fields)."""
    restricted: Dict[str, Set[str]] = {k: set() for k in FIELDS}
    open_: Dict[str, Set[str]] = {k: set() for k in FIELDS}
    google: Dict[str, Set[str]] = {k: set() for k in FIELDS}
    for prov, vals in _claims(raw):
        target = restricted if is_restricted(prov) else open_
        for kind in FIELDS:
            target[kind] |= vals[kind]
            if prov == "google_places":
                google[kind] |= vals[kind]
    return {"restricted": restricted, "open": open_, "google": google}


def value_source(rec: Any, field: str, value: Any = None) -> str:
    """Where a phone, website or e-mail on a shared company record came from, as a provenance key (see _claims), or "" when none of its
    sources lists it. An open source wins over a view-only one, so a value the company's own site also shows can be exported."""
    value = value if value is not None else getattr(rec, field, "")
    n = _norm(field, value)
    if not n:
        return ""
    best = ""
    for prov, vals in _claims(getattr(rec, "raw_data", None) or {}):
        if n in vals.get(field, ()) and (not best or _RANK.get(_key(prov), 5) < _RANK.get(_key(best), 5)):
            best = prov
    return best


def public_source(source: Any) -> str:
    """A provenance key without its detail ("register:ch" -> "register"), for files and answers that leave the app."""
    return _key(source)


def record_source(rec: Any, field: str, value: Any = None, default: str = "register") -> str:
    """The source to record when a value is copied from a shared company record (value_source), or `default` when none of its sources
    lists it. A scraped or licensed value is "scrape" / "licensed", never "register"."""
    value = value if value is not None else getattr(rec, field, "")
    if not _norm(field, value):
        return ""
    return value_source(rec, field, value) or default


def restricted_fields(obj: Any, record: Any = None) -> Set[str]:
    """The phone, website and email on a LeadAccount or BusinessRecord that must not leave the app.

    With `field_sources` the recorded source decides, except "register" / "record" (a copy from the shared company record), which is
    checked against the record again. Without it, a value that a restricted source lists for the company and that nothing open (the
    company's own site, the register) lists is treated as restricted."""
    out: Set[str] = set()
    sources = getattr(obj, "field_sources", None)
    raw = getattr(obj, "raw_data", None) or getattr(record, "raw_data", None) or {}
    held: Optional[Dict[str, Dict[str, Set[str]]]] = None
    for field in FIELDS:
        value = getattr(obj, field, "") or ""
        if not str(value).strip():
            continue
        src = source_of_value(sources, field)
        if src and _key(src) not in COPIED:
            if is_restricted(src):
                out.add(field)
            continue
        if held is None:
            held = _held_by(raw)
        n = _norm(field, value)
        if n and n in held["restricted"][field] and n not in held["open"][field]:
            out.add(field)
    return out


def withheld_count(objs: Iterable[Any], records: Optional[Dict[str, Any]] = None) -> int:
    return sum(len(restricted_fields(o, (records or {}).get(getattr(o, "business_record_id", "") or ""))) for o in objs)


def payload_flags(obj: Any, record: Any = None) -> Dict[str, Dict[str, Any]]:
    """What a screen needs to label a value that is view-only: {"restricted": {field: bool}, "note": {field: tooltip}}.

    A field the account leaves blank but shows from its company record is judged on the record. The value itself is still returned
    by the API (in-app use is allowed); only exports and the public API leave it out."""
    own = restricted_fields(obj, record)
    from_record = restricted_fields(record) if record is not None else set()
    flags: Dict[str, bool] = {}
    notes: Dict[str, str] = {}
    for field in FIELDS:
        has_own = bool(str(getattr(obj, field, "") or "").strip())
        hit = field in own or (not has_own and field in from_record)
        flags[field] = hit
        if not hit:
            continue
        src = source_of_value(getattr(obj, "field_sources", None), field) if has_own else ""
        if not is_restricted(src):
            holder = obj if has_own and record is None else (record if record is not None else obj)
            src = record_source(holder, field, default="google_places")
        notes[field] = tooltip(src) or TOOLTIP
    return {"restricted": flags, "note": notes}
