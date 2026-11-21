"""Scoring for the FSB import: which Companies House company is this Salesforce Account row? No database in here, so every rule is a plain
function that can be tested on its own (services/fsb_import.py does the reading and writing).

Rules, in order:
  1. A company number on the row that exists in our register data is an automatic match, score 1.0.
  2. Otherwise the candidates are register companies at the same postcode, then (only if none is close enough) in the same postcode district,
     scored on how alike the names are, with a small bonus for the exact postcode.
  3. The score decides: at or above `auto` it is matched, from `review` up to `auto` a person decides, below `review` there is no match.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

DEFAULTS: Dict[str, float] = {"auto": 0.92, "review": 0.70}
POSTCODE_BONUS = 0.04  # added when the postcode is exactly the same and the names are at least roughly alike
BONUS_FROM = 0.60
NEAR_DUPLICATE = 0.80  # two rows of one file at the same postcode with names this alike are looked at by a person
TIE = 0.02  # two different companies this close to each other at the top are not an automatic match
MAX_CANDIDATES = 3

# Words that say nothing about which company it is. "AND" goes too, so "Smith & Sons" and "Smith and Sons" are the same.
_NOISE = {"LTD", "LIMITED", "LLP", "PLC", "LP", "THE", "AND"}


def clean_thresholds(auto: Any, review: Any) -> Dict[str, float]:
    """The two cut-offs as floats, or a ValueError a person can read."""
    try:
        a, r = float(auto), float(review)
    except (TypeError, ValueError):
        raise ValueError("The thresholds must be numbers between 0 and 1.")
    if not (0 < r < a <= 1):
        raise ValueError("The review threshold must be above 0 and below the automatic threshold, which can be 1 at most.")
    return {"auto": round(a, 4), "review": round(r, 4)}


def norm_number(value: Any) -> str:
    """A Companies House number: upper case, no spaces, and numbers Salesforce or Excel stripped zeros from get them back."""
    s = re.sub(r"\s+", "", str(value or "")).upper()
    if s.endswith(".0") and s[:-2].isdigit():  # a number that went through a spreadsheet as a float
        s = s[:-2]
    return s.zfill(8) if s.isdigit() and len(s) < 8 else s


def norm_postcode(value: Any) -> str:
    """"bn1 4ab", "BN14AB" and " BN1  4AB " all become "BN1 4AB". Anything that cannot be a postcode becomes empty."""
    s = re.sub(r"[^A-Za-z0-9]", "", str(value or "")).upper()
    if not 5 <= len(s) <= 7:
        return ""
    return f"{s[:-3]} {s[-3:]}"


def district(postcode: Any) -> str:
    pc = norm_postcode(postcode)
    return pc.split(" ")[0] if pc else ""


def name_tokens(name: Any) -> List[str]:
    s = str(name or "").upper().replace("&", " AND ").replace("+", " AND ")
    s = re.sub(r"['’`]", "", s)
    toks = [t for t in re.sub(r"[^A-Z0-9]+", " ", s).split() if t]
    kept = [t for t in toks if t not in _NOISE]
    return kept or toks


def norm_name(name: Any) -> str:
    return " ".join(name_tokens(name))


def _ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b, autojunk=False).ratio() if a and b else 0.0


def similarity(a: Any, b: Any) -> float:
    """0 to 1. Case, punctuation, Ltd/Limited, "&"/"and", word order, a missing space and small typos do not matter much."""
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return 0.0
    if ta == tb:
        return 1.0
    ja, jb = " ".join(ta), " ".join(tb)
    return round(max(_ratio(ja, jb), _ratio(" ".join(sorted(ta)), " ".join(sorted(tb))), _ratio(ja.replace(" ", ""), jb.replace(" ", ""))), 4)


def score_candidate(name: Any, cand_name: Any, same_postcode: bool) -> float:
    sim = similarity(name, cand_name)
    if same_postcode and sim >= BONUS_FROM:
        sim = min(1.0, sim + POSTCODE_BONUS)
    return round(sim, 4)


def classify(score: float, th: Dict[str, float]) -> str:
    return "auto" if score >= th["auto"] else "review" if score >= th["review"] else "none"


Lookup = Callable[[str], Iterable[Dict[str, Any]]]


def match_row(row: Dict[str, Any], *, by_number: Dict[str, Dict[str, Any]], by_postcode: Lookup, by_district: Lookup,
              th: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    """Decides one row. `row` has name, company_number, postcode. `by_number` maps a company number to {name, postcode, ...}; the two lookups
    give the register companies ({company_number, name, postcode}) at a postcode or in a district. Returns match_status (auto | review | none),
    company_number, name, score, reason and candidates ([{company_number, score}], best first, three at most)."""
    th = th or DEFAULTS
    out: Dict[str, Any] = {"match_status": "none", "company_number": "", "name": "", "score": 0.0, "reason": "", "candidates": []}
    num = norm_number(row.get("company_number"))
    note = ""
    if num:
        hit = by_number.get(num)
        if hit:
            return {"match_status": "auto", "company_number": num, "name": hit.get("name", ""), "score": 1.0,
                    "reason": "The company number on the record is on the register.", "candidates": [{"company_number": num, "score": 1.0}]}
        note = f"Company number {num} is not on the register we hold. "
    pc = norm_postcode(row.get("postcode"))
    if not pc:
        out["reason"] = note + "No usable postcode, so the name could not be checked against a place."
        return out
    name = row.get("name") or ""
    scored: Dict[str, Tuple[float, str, bool]] = {}
    for c in by_postcode(pc):
        scored[c["company_number"]] = (score_candidate(name, c["name"], True), c.get("name", ""), True)
    best = max((s[0] for s in scored.values()), default=0.0)
    if best < th["review"]:  # nothing close at the exact postcode: widen to the district
        for c in by_district(district(pc)):
            if c["company_number"] not in scored:
                scored[c["company_number"]] = (score_candidate(name, c["name"], False), c.get("name", ""), False)
    ranked = sorted(scored.items(), key=lambda kv: (-kv[1][0], kv[0]))[:MAX_CANDIDATES]
    ranked = [kv for kv in ranked if kv[1][0] > 0]
    out["candidates"] = [{"company_number": n, "score": s[0]} for n, s in ranked]
    if not ranked:
        out["reason"] = note + "No company on the register at this postcode or in its district."
        return out
    top_n, (top, top_name, exact) = ranked[0]
    status = classify(top, th)
    where = "at the same postcode" if exact else "in the same postcode district"
    out.update(match_status=status, company_number=top_n if status != "none" else "", name=top_name if status != "none" else "", score=top)
    if status == "auto" and len(ranked) > 1 and top - ranked[1][1][0] <= TIE and ranked[1][1][0] >= th["auto"]:
        out["match_status"] = "review"
        out["reason"] = note + f"Two companies {where} fit the name equally well ({top_name} and {ranked[1][1][1]})."
    elif status == "auto":
        out["reason"] = note + f"The name matches {top_name} {where} ({top:.2f})."
    elif status == "review":
        out["reason"] = note + f"The name is close to {top_name} {where} ({top:.2f}); a person should check."
    else:
        out["reason"] = note + f"The nearest name, {top_name}, is too different ({top:.2f})."
    return out


def find_duplicates(rows: List[Dict[str, Any]]) -> Tuple[Dict[str, Tuple[str, str]], Dict[str, Tuple[str, str]]]:
    """Duplicates inside one file. `rows` are in file order, each {id, name, company_number, postcode, source_record_id}; the first one is kept.
    Returns (exact, near), each {row id: (id of the row it repeats, reason)}. Exact: the same Account ID, the same company number, or the same normalised name at
    the same postcode. Near: similar names at the same postcode (a person decides). Two rows with different company numbers are never duplicates."""
    exact: Dict[str, Tuple[str, str]] = {}
    near: Dict[str, Tuple[str, str]] = {}
    by_num: Dict[str, str] = {}
    by_key: Dict[Tuple[str, str], str] = {}
    by_sf: Dict[str, str] = {}
    num_of = {r["id"]: norm_number(r.get("company_number")) for r in rows}
    kept: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        rid, num = r["id"], num_of[r["id"]]
        pc, nm = norm_postcode(r.get("postcode")), norm_name(r.get("name"))
        sf = str(r.get("source_record_id") or "").strip()
        if sf and sf in by_sf:
            exact[rid] = (by_sf[sf], "Same Account ID as an earlier row.")
            continue
        if sf:
            by_sf[sf] = rid
        if num and num in by_num:
            exact[rid] = (by_num[num], "Same company number as an earlier row.")
            continue
        twin = by_key.get((nm, pc)) if nm and pc else None
        if twin and not (num and num_of[twin] and num != num_of[twin]):
            exact[rid] = (twin, "Same name and postcode as an earlier row.")
            continue
        if num:
            by_num[num] = rid
        if nm and pc:
            by_key.setdefault((nm, pc), rid)
            group = kept.setdefault(pc, [])
            if rid not in near and len(group) < 300:  # a postcode with hundreds of rows is a block of flats or an office: skip the pairwise look
                for other in group:
                    if num and num_of[other["id"]] and num != num_of[other["id"]]:
                        continue
                    if similarity(r.get("name"), other.get("name")) >= NEAR_DUPLICATE:
                        near[rid] = (other["id"], f"Name is much like an earlier row ({other.get('name', '')}) at the same postcode.")
                        break
            group.append(r)
    return exact, near
