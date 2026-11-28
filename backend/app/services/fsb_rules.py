"""The FSB exclusion rule set, now the Standard B2B preset in services/exclusion_rules.py (plan 12, B2). The tenant policy and the counting scripts
read it here, and seed_rules() turns it into an organisation's own editable rows (org_exclusion_rules, services/org_rules.py): the FSB
organisation got its starting list that way (startup step 2026_12_06_seed_fsb_rules).

Source: "FSB exclusion rules - for developers" (17 November 2026). A company stays only when it is a Companies House company with status
exactly "Active" and none of these applies: its type is an excluded type, it is on the Charity Commission register, ANY of its SIC codes
(up to four) is an excluded code, or its name has an excluded word (a driving school or dance school stays in).
"""
from __future__ import annotations

from typing import Any, Dict, List

from app.services import exclusion_rules as ER

# The rule set itself is data now (services/exclusion_rules.PRESETS["standard_b2b"]); these names stay for existing callers and scripts.
_P = ER.PRESETS[ER.LEGACY]
STATUS = _P["status"]
CH_NUMBER = _P["company_number_regex"]
TYPES = tuple(_P["company_types"])
SIC = tuple(_P["sic_codes"])
NAME_WORDS = tuple(_P["name_words"])
NAME_KEEP_WORDS = tuple(_P["name_keep"])
KEEP_WORDS = NAME_KEEP_WORDS
NAME_WORDS_RX = ER.name_words_rx(ER.LEGACY)
NAME_KEEP_RX = ER.name_keep_rx(ER.LEGACY)


def conditions(unregistered_too: bool = False) -> list:
    """The conditions that leave out everything on the exclusion list. The Companies-House-only rule is skipped
    when the person is looking at sole traders, who have no company number."""
    return ER.conditions(ER.LEGACY, unregistered_too)


def status_condition() -> Any:
    """Status exactly "Active" (a company that is dissolved, in liquidation or struck off is never a lead under these rules)."""
    return ER.status_condition(ER.LEGACY)


def rules_as_data() -> Dict[str, Any]:
    """The rule set as plain data, so a counting SQL script is generated from it instead of copying lists by hand."""
    return {"status": STATUS, "company_number_regex": CH_NUMBER, "company_types": list(TYPES), "sic_codes": list(SIC),
            "name_words": list(NAME_WORDS), "name_keep": list(NAME_KEEP_WORDS), "name_words_regex": NAME_WORDS_RX, "name_keep_regex": NAME_KEEP_RX,
            "exclude_charity_register": True}


def sql_script_vars() -> str:
    """The shell variables bn_appendix1.sh declares (SIC_LIST, TYPES, KW, KEEP), generated from the rule set above."""
    types = ",".join("'" + t + "'" for t in TYPES)
    return f"SIC_LIST=\"{','.join(SIC)}\"\nTYPES=\"{types}\"\nKW='{NAME_WORDS_RX}'\nKEEP='{NAME_KEEP_RX}'\n"


def seed_rules(enabled: bool = True) -> List[Dict[str, object]]:
    """The rule set as rows for an organisation's own list: [{kind, value, mode, enabled}]. The preset's regex wildcard ("charit[a-z]*") is
    written the way an admin types it in Administration > Exclusions ("charit*")."""
    rows: List[Dict[str, object]] = [{"kind": k, "value": "", "mode": "exclude", "enabled": enabled} for k in ("status_only", "ch_number_only", "charity_register")]
    rows += [{"kind": "company_type", "value": t, "mode": "exclude", "enabled": enabled} for t in TYPES]
    rows += [{"kind": "sic", "value": c, "mode": "exclude", "enabled": enabled} for c in SIC]
    rows += [{"kind": "name_word", "value": w.replace("[a-z]*", "*"), "mode": "exclude", "enabled": enabled} for w in NAME_WORDS]
    rows += [{"kind": "name_word", "value": w, "mode": "keep", "enabled": enabled} for w in KEEP_WORDS]
    return rows
