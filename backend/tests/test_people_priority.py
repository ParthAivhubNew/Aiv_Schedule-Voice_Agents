import pytest
from sqlalchemy.dialects import postgresql

from app.services import data_sources as DS


def sql(q):
    return str(q.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def test_districts_are_cleaned_and_bad_ones_refused():
    assert DS.parse_priority("bn1, BN3  sw1a;BN1") == ["BN1", "BN3", "SW1A"]
    assert DS.parse_priority("") == []
    for bad in ("BN", "12", "BN1X9", "hello"):
        with pytest.raises(ValueError):
            DS.parse_priority(bad)
    with pytest.raises(ValueError):
        DS.parse_priority(",".join(f"AB{i}" for i in range(1, 62)))


def test_priority_query_is_limited_to_the_districts_and_the_normal_one_is_not():
    plain = sql(DS._people_todo(set()))
    first = sql(DS._people_todo(set(), ["BN1", "BN3"]))
    assert "split_part" not in plain
    assert "split_part(upper(business_records.postcode), ' ', 1) IN ('BN1', 'BN3')" in first
    assert "postcode LIKE 'BN%%'" in first
    assert "people_checked_at IS NULL" in first  # companies already read are still skipped
