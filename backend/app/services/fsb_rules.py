"""The FSB starting list, as data. Nothing here is enforced.

Source: "FSB exclusion rules - for developers" (17 November 2026). It is copied once into the FSB organisation's own rows (org_exclusion_rules) by the
startup step 2026_12_05_seed_fsb_rules; from then on the organisation's admins edit those rows in Administration > Exclusions and the server
enforces whatever rows are switched on (services/org_rules.py). A company stays only when it is a Companies House company with status exactly
"Active" and none of these applies: its type is an excluded type, it is on the Charity Commission register, ANY of its SIC codes (up to four) is an
excluded code, or its name has an excluded word (a driving school or dance school stays in).
"""
from __future__ import annotations

from typing import Dict, List

TYPES = ("charitable incorporated organisation", "scottish charitable incorporated organisation", "registered society", "royal charter company",
         "other company type")
SIC = ("84110", "84120", "84130", "84210", "84220", "84230", "84240", "84250", "84300", "85100", "85200", "85310", "85320", "85410", "85421", "85422",
       "85510", "85520", "85590", "85600", "86101", "86102", "86210", "86220", "86230", "86900", "64110", "64191", "64192", "64910", "64921", "64922",
       "64929", "82911", "94110", "94120", "94200", "94910", "94920", "94990", "88910", "91011", "52230", "49100", "52212", "50100", "50300", "36000",
       "37000", "19201", "06100", "53100", "99000")
# A trailing * means any letters after it: charit* is charity, charities, charitable.
NAME_WORDS = ("charit*", "church", "parish", "mosque", "synagogue", "temple", "casino*", "credit union", "nhs", "hospital", "school", "college",
              "university", "academy trust", "shopping centre", "bureau de change", "tourist information", "weighbridge*")
KEEP_WORDS = ("driving school", "dance school")


def seed_rules(enabled: bool = True) -> List[Dict[str, object]]:
    """The rows copied into an organisation: [{kind, value, mode, enabled}]."""
    rows: List[Dict[str, object]] = [{"kind": k, "value": "", "mode": "exclude", "enabled": enabled} for k in ("status_only", "ch_number_only", "charity_register")]
    rows += [{"kind": "company_type", "value": t, "mode": "exclude", "enabled": enabled} for t in TYPES]
    rows += [{"kind": "sic", "value": c, "mode": "exclude", "enabled": enabled} for c in SIC]
    rows += [{"kind": "name_word", "value": w, "mode": "exclude", "enabled": enabled} for w in NAME_WORDS]
    rows += [{"kind": "name_word", "value": w, "mode": "keep", "enabled": enabled} for w in KEEP_WORDS]
    return rows
