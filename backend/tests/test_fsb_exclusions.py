"""The FSB exclusion list filter: accepted, shown as a chip, and turned into the rules of "FSB exclusion rules - for developers"."""
from sqlalchemy import and_, select
from sqlalchemy.dialects import postgresql

from app.models.models import BusinessRecord as B
from app.services import business_records as BR
from app.services import lead_filters


def _sql(filters):
    conds = BR._filter_conditions(BR.normalize_filters(filters))
    return str(select(B.id).where(and_(*conds)).compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def test_filter_is_kept_and_off_by_default():
    assert BR.normalize_filters({"postcode_prefixes": ["BN"], "fsb_exclusions": True})["fsb_exclusions"] is True
    assert "fsb_exclusions" not in BR.normalize_filters({"postcode_prefixes": ["BN"]})


def test_rules_are_in_the_query():
    sql = _sql({"postcode_prefixes": ["BN"], "fsb_exclusions": True})
    assert "'registered society'" in sql and "ds_charity_commission" in sql
    assert "84110" in sql and "86230" in sql and "53100" in sql  # SIC codes from the rules document
    assert "53200" not in sql and "50200" not in sql  # couriers and freight are deliberately not excluded
    assert "driving school" in sql  # the exception that keeps those names in
    assert "[A-Z0-9]{8}" in sql  # Companies House companies only


def test_not_in_the_query_when_off():
    assert "ds_charity_commission" not in _sql({"postcode_prefixes": ["BN"]})


def test_chip_is_shown():
    chips = lead_filters.describe(BR.normalize_filters({"postcode_prefixes": ["BN"], "fsb_exclusions": True}))
    assert any(c == "Standard exclusions" for c in chips)


def test_sole_trader_filter_means_no_company_number():
    f = BR.normalize_filters({"postcode_prefixes": ["BN"], "legal_form": "sole", "record_sources": ["food", "bogus"]})
    assert f["legal_form"] == "sole" and f["record_sources"] == ["food"]
    sql = _sql({"postcode_prefixes": ["BN"], "legal_form": "sole"})
    assert "NOT (coalesce(business_records.registration_number, '') ~ '^[A-Z0-9]{8}$')" in sql and "CC-%" in sql
    assert "legal_form" not in BR.normalize_filters({"postcode_prefixes": ["BN"], "legal_form": "anything else"})


def test_registered_companies_and_sources():
    assert "~ '^[A-Z0-9]{8}$'" in _sql({"postcode_prefixes": ["BN"], "legal_form": "company"})
    sql = _sql({"postcode_prefixes": ["BN"], "legal_form": "sole", "record_sources": ["food", "other"]})
    assert "ds_food_hygiene" in sql and "ds_cqc" in sql  # "other" means none of the named registers


def test_exclusion_list_with_sole_traders_does_not_demand_a_company_number():
    sole = _sql({"postcode_prefixes": ["BN"], "legal_form": "sole", "fsb_exclusions": True})
    registered = _sql({"postcode_prefixes": ["BN"], "fsb_exclusions": True})
    assert sole.count("~ '^[A-Z0-9]{8}$'") == 1 and registered.count("~ '^[A-Z0-9]{8}$'") == 1
    assert "84110" in sole  # the SIC and name rules still apply


def test_chips():
    chips = lead_filters.describe(BR.normalize_filters({"postcode_prefixes": ["BN"], "legal_form": "sole", "record_sources": ["care"]}))
    assert "Sole traders (no company number)" in chips and any(c.startswith("Records from: Care") for c in chips)


def test_exclusion_box_sorts_what_was_typed():
    kinds = BR.classify_exclusions(["56101", "47", "BN45", "bn1 4", "01234567", "SC123456", "church", "take away", "x"])
    assert kinds["sic"] == ["56101", "47"] and kinds["postcodes"] == ["BN45", "BN1 4"]
    assert kinds["numbers"] == ["01234567", "SC123456"] and kinds["words"] == ["church", "take away"]  # "x" is too short to mean anything


def test_exclusion_box_is_in_the_query():
    sql = _sql({"postcode_prefixes": ["BN"], "exclude_items": ["56101", "BN45", "01234567", "church"]})
    assert "56101" in sql and "[0-9]*" in sql  # a SIC code, with codes that start with a shorter entry also left out
    assert "NOT IN ('01234567')" in sql
    assert "BN45" in sql and "church" in sql.lower()
    assert "exclude_items" not in BR.normalize_filters({"postcode_prefixes": ["BN"], "exclude_items": ["", "x"]})
    chips = lead_filters.describe(BR.normalize_filters({"postcode_prefixes": ["BN"], "exclude_items": ["56101", "church"]}))
    assert "Leaving out: 56101, church" in chips
