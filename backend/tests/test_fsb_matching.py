"""FSB matching rules, the file reader and the test-file builder. No database."""
import importlib.util
import os
import random

import pytest

from app.services import fsb_import as FI
from app.services import fsb_matching as M
from app.services.change_report import rows_csv, summarise
from app.services.registry_health import STALE_HOURS, health_from


def look(register):
    """A tiny register as the three lookups match_row needs."""
    by_number = {c["company_number"]: c for c in register}

    def by_postcode(pc):
        return [c for c in register if M.norm_postcode(c["postcode"]) == pc]

    def by_district(d):
        return [c for c in register if M.district(c["postcode"]) == d]

    return dict(by_number=by_number, by_postcode=by_postcode, by_district=by_district)


REGISTER = [
    {"company_number": "00000001", "name": "Seaview Plumbing & Heating Limited", "postcode": "BN1 4AB"},
    {"company_number": "00000002", "name": "Harbour Bakery Ltd", "postcode": "BN1 4AB"},
    {"company_number": "00000003", "name": "Downland Joinery Limited", "postcode": "BN2 5CD"},
    {"company_number": "00000004", "name": "Acme Builders Brighton Limited", "postcode": "BN1 4AB"},
]


def run(name, number="", postcode="BN1 4AB", th=None):
    return M.match_row({"name": name, "company_number": number, "postcode": postcode}, th=th, **look(REGISTER))


@pytest.mark.parametrize("a,b", [
    ("Seaview Plumbing & Heating Limited", "SEAVIEW PLUMBING AND HEATING LTD"),
    ("The Harbour Bakery Ltd.", "harbour bakery limited"),
    ("Smith & Sons LLP", "Smith and Sons"),
    ("O'Neil Ltd", "ONeil Limited"),
])
def test_names_that_differ_only_in_form_are_identical(a, b):
    assert M.similarity(a, b) == 1.0


def test_typos_and_word_order_score_high_but_not_perfect():
    assert 0.9 < M.similarity("Seaview Plumbing Heating", "Seaveiw Plumbing Heating") < 1.0
    assert M.similarity("Plumbing Seaview", "Seaview Plumbing") > 0.9
    assert M.similarity("Sea View Plumbing", "Seaview Plumbing") > 0.9


def test_different_names_score_low():
    assert M.similarity("Harbour Bakery", "Downland Joinery") < 0.5
    assert M.similarity("", "Anything") == 0.0


def test_company_number_given_and_held_is_an_automatic_match():
    r = run("Totally different name", number="1")  # Salesforce dropped the leading zeros
    assert (r["match_status"], r["company_number"], r["score"]) == ("auto", "00000001", 1.0)


def test_company_number_not_held_falls_back_to_name_and_postcode():
    r = run("Harbour Bakery Limited", number="99999999")
    assert r["match_status"] == "auto" and r["company_number"] == "00000002" and "99999999" in r["reason"]


@pytest.mark.parametrize("name,status", [
    ("Harbour Bakery Limited", "auto"),
    ("Harbuor Bakery Ltd", "auto"),  # a typo
    ("Acme Builders Ltd", "review"),  # part of a longer name
    ("Completely Unrelated Trading", "none"),
])
def test_scoring_classes(name, status):
    assert run(name)["match_status"] == status


def test_postcode_district_is_the_fallback_when_the_exact_postcode_has_nothing_close():
    r = run("Downland Joinery Limited", postcode="BN2 9ZZ")  # right district, wrong postcode
    assert r["company_number"] == "00000003" and r["match_status"] == "auto"
    assert "district" in r["reason"]
    assert run("Downland Joinery Limited", postcode="BN9 1AA")["match_status"] == "none"  # another district: not looked at


def test_exact_postcode_beats_the_same_name_elsewhere_and_gets_a_bonus():
    assert M.score_candidate("Harbour Bakery Lt", "Harbour Bakery Ltd", True) > M.score_candidate("Harbour Bakery Lt", "Harbour Bakery Ltd", False) or \
        M.similarity("Harbour Bakery Lt", "Harbour Bakery Ltd") == 1.0
    assert M.score_candidate("Harbur Bakry", "Harbour Bakery", True) > M.score_candidate("Harbur Bakry", "Harbour Bakery", False)
    assert M.score_candidate("Zzz", "Qqq", True) == 0.0  # no bonus for unrelated names


def test_no_postcode_and_no_number_cannot_match():
    r = run("Harbour Bakery Ltd", postcode="")
    assert r["match_status"] == "none" and "postcode" in r["reason"]


def test_two_equally_good_companies_go_to_review():
    register = REGISTER + [{"company_number": "00000009", "name": "Harbour Bakery Limited", "postcode": "BN1 4AB"}]
    r = M.match_row({"name": "Harbour Bakery", "postcode": "BN1 4AB"}, **look(register))
    assert r["match_status"] == "review" and len(r["candidates"]) >= 2


def test_candidates_are_best_first_and_at_most_three():
    register = [{"company_number": f"0000010{i}", "name": f"Harbour Bakery {'x' * i}", "postcode": "BN1 4AB"} for i in range(6)]
    r = M.match_row({"name": "Harbour Bakery", "postcode": "BN1 4AB"}, **look(register))
    scores = [c["score"] for c in r["candidates"]]
    assert len(scores) == 3 and scores == sorted(scores, reverse=True)


def test_thresholds_are_the_organisations_to_change():
    strict = M.clean_thresholds(0.99, 0.9)
    assert run("Harbuor Bakery Ltd", th=strict)["match_status"] == "review"
    loose = M.clean_thresholds(0.7, 0.3)
    assert run("Acme Builders Ltd", th=loose)["match_status"] == "auto"
    for bad in [(0.5, 0.7), (1.2, 0.5), (0.9, 0), ("x", 0.5)]:
        with pytest.raises(ValueError):
            M.clean_thresholds(*bad)


def test_postcode_and_number_normalising():
    assert M.norm_postcode("bn1  4ab") == M.norm_postcode("BN14AB") == "BN1 4AB"
    assert M.norm_postcode("n/a") == "" and M.district("SW1A 1AA") == "SW1A"
    assert M.norm_number(" 1234567 ") == "01234567" and M.norm_number("sc123456") == "SC123456" and M.norm_number("1234567.0") == "01234567"


def test_duplicates_in_the_file():
    rows = [
        {"id": "r1", "name": "Harbour Bakery Ltd", "company_number": "02345678", "postcode": "BN1 4AB", "source_record_id": "A1"},
        {"id": "r2", "name": "Different name", "company_number": "2345678", "postcode": "BN9 9ZZ", "source_record_id": "A2"},  # same number
        {"id": "r3", "name": "HARBOUR BAKERY LIMITED", "company_number": "", "postcode": "bn14ab", "source_record_id": "A3"},  # same name and postcode
        {"id": "r4", "name": "Harbour Bakeries Ltd", "company_number": "", "postcode": "BN1 4AB", "source_record_id": "A4"},  # near
        {"id": "r5", "name": "Harbour Bakery Ltd", "company_number": "", "postcode": "BN2 5CD", "source_record_id": "A5"},  # other place: fine
        {"id": "r6", "name": "Other", "company_number": "", "postcode": "BN2 5CD", "source_record_id": "A1"},  # same Account ID
        {"id": "r7", "name": "Harbour Bakery Ltd", "company_number": "09999999", "postcode": "BN1 4AB", "source_record_id": "A7"},  # known different number
    ]
    exact, near = M.find_duplicates(rows)
    assert {k: v[0] for k, v in exact.items()} == {"r2": "r1", "r3": "r1", "r6": "r1"}
    assert {k: v[0] for k, v in near.items()} == {"r4": "r1", "r7": "r4"}  # r7 has a number but r4 has none, so it cannot be told apart from r4


def test_csv_reader_maps_salesforce_columns_and_keeps_extras():
    data = ("Account ID,Account Name,Company Number,Billing Street,Billing City,Billing Postal Code,Phone,Website,Owner\n"
            "001ABC,Harbour Bakery Ltd,2345678,1 High St,Brighton,BN1 4AB,01273 000000,harbour.example,Sam\n"
            ",,,,,,,,\n").encode()
    rows, dropped = FI.parse_csv(data)
    assert dropped == 1 and len(rows) == 1
    r = rows[0]
    assert (r["source_record_id"], r["name"], r["company_number_given"], r["postcode"], r["address"]) == ("001ABC", "Harbour Bakery Ltd", "2345678", "BN1 4AB", "1 High St, Brighton")
    assert r["raw"]["Owner"] == "Sam"


def test_csv_reader_rejects_bad_files():
    with pytest.raises(FI.UploadProblem, match="Account Name"):
        FI.parse_csv(b"Account ID,Phone\n1,2\n")
    with pytest.raises(FI.UploadProblem):
        FI.parse_csv(b"Account ID,Account Name\n")
    with pytest.raises(FI.UploadProblem):
        FI.parse_json_rows([])
    with pytest.raises(FI.UploadProblem, match="100,000"):
        FI.parse_json_rows([{"Account ID": str(i), "Account Name": "x"} for i in range(FI.MAX_ROWS + 1)])


def test_csv_cells_never_run_as_formulas():
    assert FI.csv_safe("=HYPERLINK(1)") == "'=HYPERLINK(1)" and FI.csv_safe("Plain") == "Plain" and FI.csv_safe(None) == ""


def test_change_summary_and_csv():
    rows = [{"company_number": "1", "company_name": "A", "change": "status_changed", "field": "f", "old_value": "x", "new_value": "=y", "source": "s",
             "date": "2026-10-01", "link": "", "fsb_record_id": "001"},
            {"company_number": "1", "company_name": "A", "change": "name_changed", "field": "f", "old_value": "", "new_value": "", "source": "s",
             "date": "2026-10-02", "link": "", "fsb_record_id": "001"},
            {"company_number": "2", "company_name": "B", "change": "name_changed", "field": "f", "old_value": "", "new_value": "", "source": "s",
             "date": "2026-10-03", "link": "", "fsb_record_id": ""}]
    s = summarise(rows)
    assert s["by_kind"] == {"status_changed": 1, "name_changed": 2} and s["companies"] == 2 and s["total"] == 3
    assert s["text"].startswith("3 changes at 2 companies: 2 name changed")
    assert summarise([])["text"] == "No changes in this period."
    out = rows_csv(rows)
    assert out.splitlines()[0].startswith("company_number,company_name,change") and "'=y" in out


def test_registry_health_from_state():
    from datetime import datetime, timedelta

    now = datetime(2026, 11, 20, 12, 0, 0)
    fresh = {"ch_companies": {"last_event_at": (now - timedelta(hours=2)).isoformat() + "Z"}, "ch_officers": {"last_event_at": (now - timedelta(hours=30)).isoformat() + "Z"}}
    h = health_from(fresh, True, now)
    assert h["healthy"] is True and h["hoursSinceLastEvent"] == 2.0 and h["keyPresent"] is True
    stale = {"ch_companies": {"last_event_at": (now - timedelta(hours=STALE_HOURS + 1)).isoformat() + "Z"}}
    assert health_from(stale, True, now)["healthy"] is False
    assert health_from(fresh, False, now)["healthy"] is False  # no key saved
    never = health_from({}, True, now)
    assert never["healthy"] is False and never["lastEventAt"] is None and never["hoursSinceLastEvent"] is None


# ---------- the test-file builder ----------

def _builder():
    path = os.path.join(os.path.dirname(__file__), "..", "scripts", "make_fsb_test_file.py")
    spec = importlib.util.spec_from_file_location("make_fsb_test_file", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _synthetic(n, status="Active"):
    return [{"number": f"{status[0]}{i:07d}", "name": f"{w} Trading & Services Limited", "postcode": f"BN{1 + i % 9} {1 + i % 7}AB",
             "address": f"{i} High Street, Hove, East Sussex, BN{1 + i % 9} {1 + i % 7}AB", "phone": "01273 000000", "website": "x.example"}
            for i, w in enumerate(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"] * (n // 8 + 1))][:n]


def test_builder_makes_the_scenarios_in_salesforce_shape():
    b = _builder()
    active, dissolved = _synthetic(400), _synthetic(40, "Dissolved")
    renamed = [(active[i], f"Old Name {i} Ltd") for i in range(5)]
    rows, expected, warnings = b.build_rows(active, dissolved, renamed, random.Random(1))
    assert warnings == []
    kinds = {}
    for e in expected:
        kinds[e["scenario"]] = kinds.get(e["scenario"], 0) + 1
    assert kinds == {"ordinary": 110, "dissolved": 20, "renamed": 20, "moved": 20, "near_duplicate": 20, "near_duplicate_first": 20, "sole_trader": 10}
    assert len(rows) == len(expected) == 220 and all(list(r) == b.COLUMNS for r in rows)
    assert all(len(r["Account ID"]) == 18 and r["Account ID"].startswith("001") for r in rows) and len({r["Account ID"] for r in rows}) == len(rows)
    ordinary = [r for r, e in zip(rows, expected) if e["scenario"] == "ordinary"]
    assert 35 <= sum(1 for r in ordinary if r["Company Number"]) <= 75  # about half
    assert any(not r["Phone"] for r in rows) and any(not r["Website"] for r in rows)
    assert all(r["Company Number"] for r, e in zip(rows, expected) if e["scenario"] in ("renamed", "moved"))
    assert not any(r["Company Number"] for r, e in zip(rows, expected) if e["scenario"] in ("sole_trader", "near_duplicate"))
    pos = {e["Account ID"]: i for i, e in enumerate(expected)}
    by_pc = {}
    for r, e in zip(rows, expected):
        if e["scenario"] in ("near_duplicate", "near_duplicate_first"):
            by_pc.setdefault(r["Billing Postal Code"], []).append((pos[r["Account ID"]], e["scenario"]))
    assert any(sorted(v)[0][1] == "near_duplicate_first" for v in by_pc.values())
    renamed_rows = [r for r, e in zip(rows, expected) if e["scenario"] == "renamed"]
    assert sum(1 for r in renamed_rows if r["Account Name"].startswith("Old Name")) == 5


def test_builder_name_variations():
    b = _builder()
    rng = random.Random(3)
    assert b.swap_suffix("Acme Ltd") == "Acme Limited" and b.swap_suffix("Acme Limited") == "Acme Ltd" and b.swap_suffix("Acme") == "Acme Ltd"
    assert b.swap_and("Smith & Sons Ltd") == "Smith and Sons Ltd" and b.swap_and("Smith and Sons") == "Smith & Sons"
    typo = b.add_typo("Harbour Bakery Ltd", rng)
    assert typo != "Harbour Bakery Ltd" and M.similarity(typo, "Harbour Bakery Ltd") > 0.85
    assert 0.8 <= M.similarity(b.near_duplicate_name("Harbour Bakery Ltd"), "Harbour Bakery Ltd") < 1.0
    assert b.address_parts("1 High Street, Hove, East Sussex, BN3 1AA", "BN3 1AA") == ("1 High Street, Hove", "Hove") or b.address_parts("1 High Street, Hove, East Sussex, BN3 1AA", "BN3 1AA")[1]
    assert len(b.salesforce_id(rng)) == 18


def test_builder_warns_when_the_register_is_short_of_a_scenario():
    b = _builder()
    rows, expected, warnings = b.build_rows(_synthetic(300), [], [], random.Random(2))
    assert any("dissolved" in w for w in warnings) and len(rows) < 220
