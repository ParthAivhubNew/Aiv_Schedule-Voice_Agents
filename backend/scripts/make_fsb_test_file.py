"""Builds a test file in the shape of FSB's Salesforce Account export from companies we already hold, to try the FSB import end to end.
Read-only: it only reads business_records and registry_events and writes a CSV. Run it on the server like the scripts in scratch/fsb_bid_scripts:

  python backend/scripts/make_fsb_test_file.py --out /tmp/fsb_test_file.csv            (about 200 BN-area companies)
  python backend/scripts/make_fsb_test_file.py --seed 7 --expected /tmp/expected.csv   (the same seed gives the same file)

Columns: Account ID, Account Name, Company Number, Billing Street, Billing City, Billing Postal Code, Phone, Website.
On purpose the file holds: 20 dissolved companies, 20 with a changed name, 20 that moved, 20 look-alike pairs that should go to review, 10 sole
traders that must not match, and the rest ordinary companies. The company number is filled on about half of the ordinary rows and always on the
renamed and moved ones (a changed name or address cannot be matched on name and postcode). The optional --expected file says what each row is for.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import random
import re
import string
from typing import Any, Dict, List, Optional, Tuple

COLUMNS = ["Account ID", "Account Name", "Company Number", "Billing Street", "Billing City", "Billing Postal Code", "Phone", "Website"]
SCENARIOS = {"ordinary": 110, "dissolved": 20, "renamed": 20, "moved": 20, "near_duplicate": 20, "sole_trader": 10}
_ALNUM = string.ascii_uppercase + string.digits + string.ascii_lowercase
_FIRST = ["J", "A", "M", "S", "K", "D", "R", "L", "P", "T"]
_LAST = ["Smith", "Patel", "Jones", "Brown", "Khan", "Taylor", "Wilson", "Evans", "Clarke", "Hughes"]
_TRADE = ["Plumbing", "Decorating", "Gardening", "Electrical", "Joinery", "Cleaning", "Roofing", "Photography", "Tutoring", "Locksmith"]


def salesforce_id(rng: random.Random) -> str:
    """An 18-character Salesforce-style Account ID: the 001 object prefix and 15 letters and digits."""
    return "001" + "".join(rng.choice(_ALNUM) for _ in range(15))


def swap_suffix(name: str) -> str:
    """Ltd <-> Limited, either way; a name with neither gains "Ltd"."""
    if re.search(r"\bLIMITED$", name, re.I):
        return re.sub(r"\bLIMITED$", "Ltd", name, flags=re.I)
    if re.search(r"\bLTD\.?$", name, re.I):
        return re.sub(r"\bLTD\.?$", "Limited", name, flags=re.I)
    return name + " Ltd"


def swap_and(name: str) -> str:
    """"&" <-> "and". A name with neither is left as it is."""
    if "&" in name:
        return name.replace("&", "and")
    if re.search(r"\bAND\b", name, re.I):
        return re.sub(r"\bAND\b", "&", name, count=1, flags=re.I)
    return name


def add_typo(name: str, rng: random.Random) -> str:
    """Swaps two neighbouring letters inside the longest word (or drops one letter of a short word)."""
    words = name.split(" ")
    i = max(range(len(words)), key=lambda k: len(words[k])) if words else 0
    w = words[i] if words else ""
    if len(w) >= 5:
        j = rng.randrange(1, len(w) - 2)
        w = w[:j] + w[j + 1] + w[j] + w[j + 2:]
    elif len(w) >= 3:
        j = rng.randrange(1, len(w))
        w = w[:j] + w[j + 1:]
    words[i] = w
    return " ".join(words)


def vary_name(name: str, rng: random.Random) -> str:
    """How FSB's own system might spell the name: a changed suffix, "&" for "and", a typo, an all-capitals copy, or exactly as registered."""
    pick = rng.choice(["suffix", "and", "typo", "upper", "same"])
    out = {"suffix": swap_suffix(name), "and": swap_and(name), "typo": add_typo(name, rng), "upper": name.upper(), "same": name}[pick]
    return out if out != name or pick == "same" else swap_suffix(name)


def near_duplicate_name(name: str) -> str:
    """A look-alike of the same name: the longest word made plural (or a trailing "s" dropped), the rest unchanged."""
    words = name.split(" ")
    i = max(range(len(words)), key=lambda k: len(words[k]))
    words[i] = words[i][:-1] if words[i].lower().endswith("s") and len(words[i]) > 4 else words[i] + "s"
    return " ".join(words)


def changed_name(name: str) -> str:
    """Stands in for an old name when the register events do not hold one: the first word replaced."""
    words = name.split(" ")
    words[0] = "Old" + words[0].title()
    return " ".join(words)


def address_parts(address: str, postcode: str) -> Tuple[str, str]:
    """(street, city) from a one-line register address. The postcode and a trailing country or county are left out."""
    parts = [p.strip() for p in str(address or "").split(",") if p.strip()]
    pc = re.sub(r"\s+", "", str(postcode or "")).upper()
    parts = [p for p in parts if re.sub(r"\s+", "", p).upper() != pc]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    city = parts[-2] if len(parts) >= 3 else parts[-1]
    return ", ".join(parts[:-2] if len(parts) >= 3 else parts[:-1]) or parts[0], city


def _row(rng: random.Random, name: str, number: str, address: str, postcode: str, phone: str, website: str) -> Dict[str, str]:
    street, city = address_parts(address, postcode)
    return {"Account ID": salesforce_id(rng), "Account Name": name, "Company Number": number, "Billing Street": street, "Billing City": city,
            "Billing Postal Code": postcode, "Phone": phone, "Website": website}


def _contact(c: Dict[str, Any], rng: random.Random) -> Tuple[str, str]:
    return (c.get("phone") or "" if rng.random() > 0.3 else "", c.get("website") or "" if rng.random() > 0.3 else "")


def build_rows(active: List[Dict[str, Any]], dissolved: List[Dict[str, Any]], renamed: List[Tuple[Dict[str, Any], str]], rng: random.Random,
               counts: Optional[Dict[str, int]] = None) -> Tuple[List[Dict[str, str]], List[Dict[str, str]], List[str]]:
    """Pure. `active` and `dissolved` are register companies ({number, name, postcode, address, phone, website}); `renamed` pairs a company with the
    name it had before (from the register's name-change events). Returns (rows, expected, warnings): expected says what each Account ID is for."""
    want = {**SCENARIOS, **(counts or {})}
    warnings: List[str] = []
    rows: List[Dict[str, str]] = []
    expected: List[Dict[str, str]] = []
    used = set()
    pairs_out: List[Tuple[Dict[str, str], Dict[str, str], Dict[str, str], Dict[str, str]]] = []

    def take(pool: List[Dict[str, Any]], n: int, label: str) -> List[Dict[str, Any]]:
        fresh = [c for c in pool if c["number"] not in used]
        rng.shuffle(fresh)
        got = fresh[:n]
        if len(got) < n:
            warnings.append(f"only {len(got)} of {n} wanted for {label}")
        used.update(c["number"] for c in got)
        return got

    def add(scenario: str, row: Dict[str, str], note: str = "") -> None:
        rows.append(row)
        expected.append({"Account ID": row["Account ID"], "scenario": scenario, "note": note})

    old = list(renamed)
    rng.shuffle(old)
    pairs = old[:want["renamed"]]  # reserved first so the ordinary rows do not use up the companies with a real old name
    used.update(c["number"] for c, _ in pairs)
    for c in take(active, want["ordinary"], "ordinary"):
        phone, site = _contact(c, rng)
        number = c["number"] if rng.random() < 0.5 else ""
        add("ordinary", _row(rng, vary_name(c["name"], rng), number, c.get("address", ""), c.get("postcode", ""), phone, site), "number given" if number else "name and postcode")
    for c in take(dissolved, want["dissolved"], "dissolved"):
        phone, site = _contact(c, rng)
        add("dissolved", _row(rng, c["name"], c["number"] if rng.random() < 0.5 else "", c.get("address", ""), c.get("postcode", ""), phone, site), "status dissolved")
    for c in take(active, want["renamed"] - len(pairs), "renamed (stored name changed instead)"):
        pairs.append((c, changed_name(c["name"])))
    for c, old_name in pairs:
        phone, site = _contact(c, rng)
        add("renamed", _row(rng, old_name, c["number"], c.get("address", ""), c.get("postcode", ""), phone, site), "FSB holds the old name")
    movers = take(active, want["moved"], "moved")
    places = [c for c in active if c.get("postcode")]
    for c in movers:
        far = [p for p in places if p["postcode"].split(" ")[0] != str(c.get("postcode", "")).split(" ")[0]] or places
        there = rng.choice(far) if far else c
        phone, site = _contact(c, rng)
        add("moved", _row(rng, c["name"], c["number"], there.get("address", ""), there.get("postcode", ""), phone, site), f"FSB holds an old address ({there.get('postcode', '')})")
    for c in take(active, want["near_duplicate"], "near duplicates"):
        phone, site = _contact(c, rng)
        first = _row(rng, c["name"], "", c.get("address", ""), c.get("postcode", ""), phone, site)
        second = _row(rng, near_duplicate_name(c["name"]), "", c.get("address", ""), c.get("postcode", ""), phone, site)
        pairs_out.append(({"Account ID": first["Account ID"], "scenario": "near_duplicate_first", "note": "the original of a look-alike pair"}, first,
                          {"Account ID": second["Account ID"], "scenario": "near_duplicate", "note": "similar name, same postcode: review"}, second))
    for _ in range(want["sole_trader"]):
        place = rng.choice(places) if places else {}
        name = f"{rng.choice(_FIRST)} {rng.choice(_LAST)} {rng.choice(_TRADE)}"
        add("sole_trader", _row(rng, name, "", place.get("address", ""), place.get("postcode", ""), "", ""), "not a registered company: no match")
    items = list(zip(rows, expected))
    rng.shuffle(items)
    for e1, r1, e2, r2 in pairs_out:  # a look-alike always comes after its original: the import keeps the first row it meets
        i = rng.randrange(len(items) + 1)
        items.insert(i, (r1, e1))
        items.insert(rng.randrange(i + 1, len(items) + 1), (r2, e2))
    return [r for r, _ in items], [e for _, e in items], warnings


def write_csv(path: str, rows: List[Dict[str, str]]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)


def write_expected(path: str, expected: List[Dict[str, str]]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["Account ID", "scenario", "note"])
        w.writeheader()
        w.writerows(expected)


async def _load(area: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Tuple[Dict[str, Any], str]]]:
    from sqlalchemy import text

    from app.database import AsyncSessionLocal

    cols = "registration_number, name, postcode, address, COALESCE(status,''), COALESCE(phone,''), COALESCE(website,'')"
    base = f"FROM business_records WHERE postcode LIKE :p AND registration_number ~ '^[A-Z0-9]{{8}}$' AND name <> ''"

    def co(r) -> Dict[str, Any]:
        return {"number": r[0], "name": r[1], "postcode": r[2] or "", "address": r[3] or "", "status": r[4], "phone": r[5], "website": r[6]}

    async with AsyncSessionLocal() as db:
        active = [co(r) for r in (await db.execute(text(f"SELECT {cols} {base} AND lower(COALESCE(status,'')) LIKE 'active%' ORDER BY random() LIMIT 600"), {"p": area + "%"})).all()]
        dissolved = [co(r) for r in (await db.execute(text(f"SELECT {cols} {base} AND lower(COALESCE(status,'')) LIKE 'dissolved%' ORDER BY random() LIMIT 100"), {"p": area + "%"})).all()]
        ev = (await db.execute(text("SELECT company_number, old_value FROM registry_events WHERE kind = 'name_changed' AND old_value <> '' ORDER BY event_date DESC LIMIT 200"))).all()
        old = {n: o for n, o in ev}
        renamed: List[Tuple[Dict[str, Any], str]] = []
        if old:
            for r in (await db.execute(text(f"SELECT {cols} {base} AND registration_number = ANY(:n)"), {"p": area + "%", "n": list(old)})).all():
                renamed.append((co(r), old[r[0]]))
    return active, dissolved, renamed


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default="/tmp/fsb_test_file.csv")
    ap.add_argument("--expected", default="")
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--area", default="BN")
    a = ap.parse_args()
    active, dissolved, renamed = await _load(a.area.upper())
    rng = random.Random(a.seed)
    rows, expected, warnings = build_rows(active, dissolved, renamed, rng)
    write_csv(a.out, rows)
    if a.expected:
        write_expected(a.expected, expected)
    print(f"{len(rows)} rows written to {a.out}")
    for w in warnings:
        print("note:", w)


if __name__ == "__main__":
    import os
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    asyncio.run(main())
