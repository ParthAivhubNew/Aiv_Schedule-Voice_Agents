"""Which data may leave the app.

Google-sourced and Apollo-sourced values can be seen and used inside Outreach but are never exported or returned to API callers.
Only a phone number or website read from the company's own site (source "website") is ours to hand over.

A LeadAccount carries `field_sources` ({"phone": "website", ...}). Values saved before that column existed have none, so
`restricted_fields` falls back to a conservative value match against what the company record holds from each source.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, Optional, Set

NON_EXPORTABLE = frozenset({"google_places", "apollo"})
FIELDS = ("phone", "website", "email")

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


def _held_by(raw: Dict[str, Any]) -> Dict[str, Dict[str, Set[str]]]:
    """{"restricted": {kind: values}, "open": {kind: values}} for one company record's raw_data."""
    restricted: Dict[str, Set[str]] = {k: set() for k in FIELDS}
    open_: Dict[str, Set[str]] = {k: set() for k in FIELDS}
    for key, rec in (raw or {}).items():
        if key == "lookup_options" or not isinstance(rec, dict):
            continue
        if key == "contacts_web":
            vals = {k: set() for k in FIELDS}
            vals["website"] |= {_norm("website", rec.get("website"))} - {""}
            for ph in rec.get("phones") or []:
                vals["phone"] |= {_norm("phone", ph.get("value") if isinstance(ph, dict) else ph)} - {""}
            for em in rec.get("emails") or []:
                vals["email"] |= {_norm("email", em.get("value") if isinstance(em, dict) else em)} - {""}
            target = restricted if _key(rec.get("source")) in NON_EXPORTABLE else open_
        else:
            vals = _entry_values(rec)
            target = restricted if _key(key) in NON_EXPORTABLE else open_
        for kind in FIELDS:
            target[kind] |= vals[kind]
    for kind, vals in _option_values(raw or {}).items():
        restricted[kind] |= vals
    return {"restricted": restricted, "open": open_}


def record_source(rec: Any, field: str, value: Any = None, default: str = "register") -> str:
    """The source to record when a value is copied from a shared company record: the restricted source that lists it, "register" when
    an open source does, else `default`."""
    value = value if value is not None else getattr(rec, field, "")
    n = _norm(field, value)
    if not n:
        return ""
    raw = getattr(rec, "raw_data", None) or {}
    held = _held_by(raw)
    if n in held["open"][field]:
        return "register"
    google = _held_by({k: v for k, v in raw.items() if _key(k) == "google_places" or k == "lookup_options"})
    if n in google["restricted"][field]:
        return "google_places"
    return "apollo" if n in held["restricted"][field] else default


def restricted_fields(obj: Any, record: Any = None) -> Set[str]:
    """The phone, website and email on a LeadAccount or BusinessRecord that must not leave the app.

    With `field_sources` the recorded source decides. Without it, a value that a restricted source lists for the company and that
    nothing open (the company's own site, the register) lists is treated as restricted."""
    out: Set[str] = set()
    sources = getattr(obj, "field_sources", None)
    raw = getattr(obj, "raw_data", None) or getattr(record, "raw_data", None) or {}
    held: Optional[Dict[str, Dict[str, Set[str]]]] = None
    for field in FIELDS:
        value = getattr(obj, field, "") or ""
        if not str(value).strip():
            continue
        src = source_of_value(sources, field)
        if src:
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
