"""Words people use for the same trade, and the register's SIC codes for it.

Searching "accountancy", "accounting" or "accountants" must give the same companies. A typed word that is in a group
matches any word of the group, and any company carrying one of the group's SIC codes. Fixed list, no AI call per search.
"""
from __future__ import annotations

import re
from typing import Dict, List, Tuple

# group name -> (words, SIC codes)
GROUPS: Dict[str, Tuple[Tuple[str, ...], Tuple[str, ...]]] = {
    "accounting": (("accountancy", "accounting", "accountant", "accountants", "bookkeeping", "bookkeeper", "bookkeepers", "tax", "taxation"), ("69201", "69202", "69203")),
    "plumbing": (("plumber", "plumbers", "plumbing", "heating engineer", "heating engineers"), ("43220",)),
    "dental": (("dentist", "dentists", "dental", "dentistry", "orthodontist", "orthodontics"), ("86230",)),
    "legal": (("solicitor", "solicitors", "legal", "law firm", "conveyancing"), ("69101", "69102")),
    "electrical": (("electrician", "electricians", "electrical"), ("43210",)),
    "estate agents": (("estate agent", "estate agents", "letting agent", "letting agents", "property agent"), ("68310", "68320")),
    "hairdressing": (("hairdresser", "hairdressers", "hairdressing", "barber", "barbers"), ("96020",)),
    "restaurants": (("restaurant", "restaurants", "cafe", "cafes", "takeaway", "takeaways"), ("56101", "56102", "56103")),
    "architecture": (("architect", "architects", "architectural"), ("71111",)),
    "builders": (("builder", "builders", "building contractor", "construction"), ("41201", "41202", "43999")),
    "recruitment": (("recruiter", "recruiters", "recruitment", "employment agency"), ("78109", "78200")),
    "physiotherapy": (("physio", "physiotherapist", "physiotherapists", "physiotherapy"), ("86900",)),
}
_BY_WORD: Dict[str, str] = {w: g for g, (words, _) in GROUPS.items() for w in words}


def _norm(term: str) -> str:
    return re.sub(r"\s+", " ", str(term or "").strip().lower())


def _group_of(t: str) -> str:
    """The group a word belongs to. A near-miss of a longer trade word ("accoutants") counts too."""
    group = _BY_WORD.get(t)
    if group or len(t) < 6:
        return group or ""
    import difflib

    near = difflib.get_close_matches(t, [w for w in _BY_WORD if len(w) >= 6], n=1, cutoff=0.85)
    return _BY_WORD[near[0]] if near else ""


def expand(term: str) -> Tuple[List[str], List[str]]:
    """(words, SIC codes) a typed term stands for: itself, plus its group when it has one."""
    t = _norm(term)
    group = _group_of(t)
    if not group:
        return [t], []
    words, sics = GROUPS[group]
    return [t] + [w for w in words if w != t], list(sics)
