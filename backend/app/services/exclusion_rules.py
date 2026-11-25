"""Exclusion rule sets as data (plan 12, B2): a company switches a named set on in its rules (exclusions.sets), and the search conditions are
built here from the set's data, so a new set is a new entry, not new code.

"standard_b2b" is the FSB exclusion rule set ("FSB exclusion rules - for developers", 17 November 2026), offered to every company as the
Standard B2B exclusions. A company stays only when it is a Companies House company with status exactly "Active" and none of these applies:
its type is an excluded type, it is on the Charity Commission register, ANY of its SIC codes (up to four) is an excluded code, or its name has
an excluded word (a driving school or dance school stays in). The FSB brand's old flag (exclusions.fsb) means this set.

A company's own extra exclusions (SIC codes, company numbers, postcode districts, words) stay in exclusions.extra (business_records.
_exclusion_items).
"""
from __future__ import annotations

from typing import Any, Dict, List

from sqlalchemy import cast, func, or_, String

PRESETS: Dict[str, Dict[str, Any]] = {
    "standard_b2b": {
        "label": "Standard B2B exclusions",
        "desc": ("Active Companies House companies only. Leaves out charities and other non-trading company types, anything on the Charity "
                 "register, public bodies, schools, health, banking, religious and similar activities (by SIC code), and names with words such "
                 "as church, school or casino (driving and dance schools stay in)."),
        "status": "Active",
        "company_number_regex": "^[A-Z0-9]{8}$",
        "company_types": ["charitable incorporated organisation", "scottish charitable incorporated organisation", "registered society",
                          "royal charter company", "other company type"],
        "sic_codes": ["84110", "84120", "84130", "84210", "84220", "84230", "84240", "84250", "84300", "85100", "85200", "85310", "85320", "85410",
                      "85421", "85422", "85510", "85520", "85590", "85600", "86101", "86102", "86210", "86220", "86230", "86900", "64110", "64191",
                      "64192", "64910", "64921", "64922", "64929", "82911", "94110", "94120", "94200", "94910", "94920", "94990", "88910", "91011",
                      "52230", "49100", "52212", "50100", "50300", "36000", "37000", "19201", "06100", "53100", "99000"],
        # Regex fragments (whole words, case-insensitive); the ones ending [a-z]* also match longer forms: charity, charitable, casinos.
        "name_words": ["charit[a-z]*", "church", "parish", "mosque", "synagogue", "temple", "casino[a-z]*", "credit union", "nhs", "hospital", "school",
                       "college", "university", "academy trust", "shopping centre", "bureau de change", "tourist information", "weighbridge[a-z]*"],
        "name_keep": ["driving school", "dance school"],
        "exclude_charity_register": True,
    },
}
LEGACY = "standard_b2b"  # what the brand flag exclusions.fsb stands for


def known(set_id: Any) -> bool:
    return str(set_id or "") in PRESETS


def name_words_rx(set_id: str) -> str:
    return r"\m(" + "|".join(PRESETS[set_id]["name_words"]) + r")\M"


def name_keep_rx(set_id: str) -> str:
    return "(" + "|".join(PRESETS[set_id]["name_keep"]) + ")"


def conditions(set_id: str, unregistered_too: bool = False) -> list:
    """The conditions that leave out everything a rule set excludes. The Companies-House-only rule is skipped when the person is looking at
    sole traders, who have no company number."""
    from app.models.models import BusinessRecord as B

    p = PRESETS[set_id]
    out: list = [] if unregistered_too or not p.get("company_number_regex") else [func.coalesce(B.registration_number, "").op("~")(p["company_number_regex"])]
    if p.get("company_types"):
        out.append(~func.lower(func.btrim(func.coalesce(B.company_category, ""))).in_(p["company_types"]))
    if p.get("exclude_charity_register"):
        out.append(~func.coalesce(cast(B.sources, String), "").like('%"ds_charity_commission"%'))  # no sources is not on the charity register
    if p.get("sic_codes"):
        out.append(~func.coalesce(B.sic_codes, "").op("~")(r"\|(" + "|".join(p["sic_codes"]) + r")\|"))
    if p.get("name_words"):
        keep = [B.name.op("~*")(name_keep_rx(set_id))] if p.get("name_keep") else []
        out.append(or_(~B.name.op("~*")(name_words_rx(set_id)), *keep))
    return out


def status_condition(set_id: str) -> Any:
    """The status a rule set keeps (exactly "Active" for the Standard B2B set: dissolved, in liquidation or struck off is never a lead)."""
    from app.models.models import BusinessRecord as B

    status = PRESETS[set_id].get("status")
    return func.btrim(B.status) == status if status else None


def all_conditions(set_id: str, unregistered_too: bool = False) -> list:
    st = status_condition(set_id)
    return ([st] if st is not None else []) + conditions(set_id, unregistered_too)


def view(set_id: str) -> Dict[str, Any]:
    """A rule set for the Rules screen: what it is, and how much it holds."""
    p = PRESETS[set_id]
    return {"id": set_id, "label": p["label"], "desc": p["desc"], "sicCodes": len(p.get("sic_codes") or []),
            "companyTypes": len(p.get("company_types") or []), "nameWords": len(p.get("name_words") or []),
            "keeps": list(p.get("name_keep") or [])}


def catalogue() -> List[Dict[str, Any]]:
    return [view(k) for k in PRESETS]
