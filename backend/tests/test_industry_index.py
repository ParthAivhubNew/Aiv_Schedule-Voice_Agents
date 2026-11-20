"""The industry picker: the values below are the real kinds found in the live industry column (6.7M rows)."""
import asyncio

from sqlalchemy.dialects import postgresql

from app.services import business_records as BR
from app.services import industry_index as II
from app.services import lead_filters

ROWS = [
    ("68209 - Other letting and operating of own or leased real estate", 284608),
    ("69201 - Accounting activities", 24000),
    ("Charity", 368403),
    ("None Supplied", 231737),
    ("", 1807),
    ("99999 - Dormant Company", 104504),
    ("Restaurant/Cafe/Canteen", 140778),
    ("Doctors/GPs|Doctors/GPs", 8185),
    ("Doctors/GPs", 336),
    ("Doctors/GPs|Doctors/GPs|Mobile doctors", 137),
    ("Homecare agencies|Supported living", 3676),
    ("69201", 24),
    ("49320", 6),
]


def by_label(terms, label):
    return next(t for t in terms if t.get("label") == label)


def test_values_become_clean_terms():
    terms = II.build_terms(ROWS)
    labels = [t["label"] for t in terms]
    assert "None Supplied" not in labels and "" not in [t["label"] for t in terms if t["k"] == "type"]
    # the care register's lists become one term per service, repeats counted once per row, counts added up
    assert by_label(terms, "Doctors/GPs")["n"] == 8185 + 336 + 137
    assert by_label(terms, "Mobile doctors")["n"] == 137
    assert by_label(terms, "Supported living")["n"] == 3676
    assert not any("|" in t["label"] for t in terms)


def test_sic_terms_carry_their_code_and_bare_codes_join_them():
    terms = II.build_terms(ROWS)
    acc = next(t for t in terms if t.get("code") == "69201")
    assert acc["label"] == "Accounting activities" and acc["n"] == 24000 + 24  # the bare "69201" rows are added to it
    bare = next(t for t in terms if t.get("code") == "49320")
    assert bare["label"] == "" and bare["k"] == "sic"


def test_dormant_is_hidden_and_the_biggest_come_first():
    terms = II.build_terms(ROWS)
    assert next(t for t in terms if t.get("code") == "99999").get("hidden") is True
    sizes = [t["n"] for t in terms]
    assert sizes == sorted(sizes, reverse=True)


def test_type_filter_matches_one_exact_type_in_a_list():
    conds = BR._filter_conditions(BR.normalize_filters({"industry_types": ["Doctors/GPs", "Pub/bar/nightclub"]}))
    sql = " ".join(str(c.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})) for c in conds)
    assert "~* '(^|" in sql and "Doctors/GPs" in sql and "Pub/bar/nightclub" in sql  # an exact element of the "|" list, not a contains match
    assert "ILIKE '%%Doctors" not in sql


def test_a_sic_pick_and_a_type_pick_are_ored_not_anded():
    """Both come from one Industry control: choosing "Dental practice activities" and "Dentist" must give either, not neither."""
    conds = BR._trade_conditions(BR.normalize_filters({"sic_codes": ["86230"], "industry_types": ["Dentist"]}), False)
    assert len(conds) == 1
    sql = str(conds[0].compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert " OR " in sql and "86230" in sql and "Dentist" in sql
    assert len(BR._trade_conditions(BR.normalize_filters({"sic_codes": ["86230"]}), False)) == 1  # only SIC codes: as before
    assert BR._trade_conditions(BR.normalize_filters({"keyword": ["dentist"]}), False)  # the keyword box is separate, still ANDed


def test_type_filter_is_kept_cleaned_and_described():
    f = BR.normalize_filters({"industry_types": ["Dentist", "a|b", "x", "Dentist", "  Clinic  "]})
    assert f["industry_types"] == ["Dentist", "Clinic"]  # no "|" in a pick, no one-letter values, no repeats
    assert "industry_types" in BR.FILTER_KEYS
    assert "Industry type: Dentist, Clinic" in lead_filters.describe(f)
    assert "industry_types" not in BR.normalize_filters({"industry_types": ["", "|"]})


def test_the_assistant_keeps_a_picked_type_when_the_model_returns_the_rest(monkeypatch):
    async def fake(**kwargs):
        return {"action": "search", "sector": ["dental"]}

    monkeypatch.setattr(lead_filters.llm_gateway, "extract_structured", fake)
    out = asyncio.run(lead_filters.interpret(None, "only dental please", {"industry_types": ["Dentist"], "towns": ["leeds"]}))
    assert out["filters"]["industry_types"] == ["Dentist"]
    assert out["filters"]["sector"] == ["dental"]


def test_families_list_the_trade_words_with_their_codes():
    fams = II.families()
    acc = next(f for f in fams if "accountant" in f["words"])
    assert "69201" in acc["codes"] and acc["name"] == "accounting"
