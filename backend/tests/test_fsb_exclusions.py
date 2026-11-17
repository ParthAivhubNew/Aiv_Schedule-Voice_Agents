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
    assert any(c == "Exclusion list" for c in chips)
