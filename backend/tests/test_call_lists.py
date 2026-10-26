"""Saved Call lists: counts, name rules and size limits (the database side runs on real Postgres elsewhere)."""
import pytest
from fastapi import HTTPException

from app.api import call_lists as L
from app.models.models import CallList


def test_called_counts_only_rows_with_a_call():
    rows = [{"callTimes": 2}, {"callTimes": 0}, {"callTimes": "1"}, {}, {"callTimes": "x"}]
    assert L._called(rows) == 2


def test_name_is_tidied_and_required():
    assert L._name("  Leeds   dentists ") == "Leeds dentists"
    with pytest.raises(HTTPException):
        L._name("   ")
    assert len(L._name("x" * 200)) == L.MAX_NAME


def test_too_many_rows_is_refused():
    with pytest.raises(HTTPException):
        L._check_rows([{}] * (L.MAX_ROWS + 1))


def test_fill_sets_the_counts_the_cards_show():
    made = CallList(id="cl_1", name="A")
    L._fill(made, ["name", "phone"], [{"callTimes": 1}, {"callTimes": 0}])
    assert (made.row_count, made.called_count, made.headers) == (2, 1, ["name", "phone"])
    assert L._summary(made)["count"] == 2


def test_name_clash_ignores_case_and_the_list_itself():
    a, b = CallList(id="1", name="Leeds"), CallList(id="2", name="Bath")
    assert L._clash([a, b], "leeds")
    assert not L._clash([a, b], "leeds", own="1")
