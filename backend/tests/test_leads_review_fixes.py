"""Fixes from the EGM review of the Leads search: rows with empty columns, extreme ages, word edges, and filters the sentence box must keep."""
import asyncio

from sqlalchemy.dialects import postgresql

from app.services import business_records as BR
from app.services import lead_filters as LF


def sql(expr):
    return str(expr.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def test_charity_check_never_null_on_empty_sources():
    text = sql(BR._charity())
    assert "coalesce(CAST(business_records.sources AS VARCHAR), '')" in text


def test_postcode_leave_out_keeps_rows_without_a_postcode():
    conds = BR._exclusion_items(["BN45"])
    text = " ".join(sql(c) for c in conds)
    assert "coalesce(" in text and "false" in text.lower()
    assert "coalesce" not in sql(BR._postcode_match("BN45"))  # the plain postcode search stays index-friendly


def test_extreme_ages_are_dropped_not_crashed():
    for bad in ("inf", "nan", 3000, -1, "abc"):
        assert "min_age_years" not in BR.normalize_filters({"min_age_years": bad})
    assert BR.normalize_filters({"min_age_years": 5})["min_age_years"] == 5.0


def test_non_business_words_need_word_edges():
    assert not BR._wants_non_business({"keyword": ["healthcare"]})
    assert not BR._wants_non_business({"keyword": ["Templeton"]})
    assert BR._wants_non_business({"keyword": ["care homes"]}) or BR._wants_non_business({"keyword": ["school"]})
    assert BR._wants_non_business({"keyword": ["schools"]})


def test_type_pick_ignores_case_and_spaces_around_the_bar():
    conds = BR._trade_conditions(BR.normalize_filters({"industry_types": ["Charity"]}), False)
    text = sql(conds[0])
    assert "~*" in text and "\\s*" in text


def test_sentence_box_keeps_filters_the_model_has_no_field_for(monkeypatch):
    async def fake(**_kw):
        return {"action": "search", "keyword": ["churches"], "town": "Leeds"}

    monkeypatch.setattr(LF.llm_gateway, "extract_structured", lambda **kw: fake(**kw))
    current = {"near": {"postcode": "LS1 4AP", "miles": 5, "districts": ["LS1"]}, "signals": ["new_company"], "record_sources": ["food"], "status": "any"}
    out = asyncio.run(LF.interpret(None, "also churches", current))
    f = out["filters"]
    assert f["near"]["districts"] == ["LS1"] and f["signals"] == ["new_company"] and f["record_sources"] == ["food"]
    assert f["status"] == "any"


def test_sentence_box_asks_the_model_even_without_a_verb(monkeypatch):
    called = []

    async def fake(**_kw):
        called.append(1)
        return {"action": "search", "keyword": ["dentists"]}

    monkeypatch.setattr(LF.llm_gateway, "extract_structured", lambda **kw: fake(**kw))
    asyncio.run(LF.interpret(None, "dentists Leeds", {}))
    assert not called  # the chat assistant still needs a verb
    asyncio.run(LF.interpret(None, "dentists Leeds", {}, force=True))
    assert called
