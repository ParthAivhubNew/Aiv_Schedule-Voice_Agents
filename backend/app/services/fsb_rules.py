"""The FSB exclusion rule set: the one definition. business_records._fsb_exclusions, the tenant policy and the counting scripts all read it here.

Source: "FSB exclusion rules - for developers" (17 November 2026). A company stays only when it is a Companies House company with status
exactly "Active" and none of these applies: its type is an excluded type, it is on the Charity Commission register, ANY of its SIC codes
(up to four) is an excluded code, or its name has an excluded word (a driving school or dance school stays in).
"""
from __future__ import annotations

from typing import Any, Dict, List

from sqlalchemy import cast, func, or_, String

from app.models.models import BusinessRecord

STATUS = "Active"
CH_NUMBER = "^[A-Z0-9]{8}$"
TYPES = ("charitable incorporated organisation", "scottish charitable incorporated organisation", "registered society", "royal charter company",
         "other company type")
SIC = ("84110", "84120", "84130", "84210", "84220", "84230", "84240", "84250", "84300", "85100", "85200", "85310", "85320", "85410", "85421", "85422",
       "85510", "85520", "85590", "85600", "86101", "86102", "86210", "86220", "86230", "86900", "64110", "64191", "64192", "64910", "64921", "64922",
       "64929", "82911", "94110", "94120", "94200", "94910", "94920", "94990", "88910", "91011", "52230", "49100", "52212", "50100", "50300", "36000",
       "37000", "19201", "06100", "53100", "99000")
# Regex fragments (whole words, case-insensitive); the ones ending [a-z]* also match longer forms: charity, charitable, casinos.
NAME_WORDS = ("charit[a-z]*", "church", "parish", "mosque", "synagogue", "temple", "casino[a-z]*", "credit union", "nhs", "hospital", "school", "college",
              "university", "academy trust", "shopping centre", "bureau de change", "tourist information", "weighbridge[a-z]*")
NAME_KEEP_WORDS = ("driving school", "dance school")
NAME_WORDS_RX = r"\m(" + "|".join(NAME_WORDS) + r")\M"
NAME_KEEP_RX = "(" + "|".join(NAME_KEEP_WORDS) + ")"


def conditions(unregistered_too: bool = False) -> list:
    """The conditions that leave out everything on the exclusion list. The Companies-House-only rule is skipped
    when the person is looking at sole traders, who have no company number."""
    B = BusinessRecord
    return ([] if unregistered_too else [func.coalesce(B.registration_number, "").op("~")(CH_NUMBER)]) + [
        ~func.lower(func.btrim(func.coalesce(B.company_category, ""))).in_(TYPES),
        ~func.coalesce(cast(B.sources, String), "").like('%"ds_charity_commission"%'),  # a record with no sources is not on the charity register
        ~func.coalesce(B.sic_codes, "").op("~")(r"\|(" + "|".join(SIC) + r")\|"),
        or_(~B.name.op("~*")(NAME_WORDS_RX), B.name.op("~*")(NAME_KEEP_RX)),
    ]


def status_condition() -> Any:
    """Status exactly "Active" (a company that is dissolved, in liquidation or struck off is never a lead under these rules)."""
    return func.btrim(BusinessRecord.status) == STATUS


def rules_as_data() -> Dict[str, Any]:
    """The rule set as plain data, so a counting SQL script is generated from it instead of copying lists by hand."""
    return {"status": STATUS, "company_number_regex": CH_NUMBER, "company_types": list(TYPES), "sic_codes": list(SIC),
            "name_words": list(NAME_WORDS), "name_keep": list(NAME_KEEP_WORDS), "name_words_regex": NAME_WORDS_RX, "name_keep_regex": NAME_KEEP_RX,
            "exclude_charity_register": True}


def sql_script_vars() -> str:
    """The shell variables bn_appendix1.sh declares (SIC_LIST, TYPES, KW, KEEP), generated from the rule set above."""
    types = ",".join("'" + t + "'" for t in TYPES)
    return f"SIC_LIST=\"{','.join(SIC)}\"\nTYPES=\"{types}\"\nKW='{NAME_WORDS_RX}'\nKEEP='{NAME_KEEP_RX}'\n"
