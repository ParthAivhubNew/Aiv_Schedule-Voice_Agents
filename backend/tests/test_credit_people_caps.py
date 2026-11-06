"""Per-person credit limits and the actor that credit lines are stamped with. These run without a database:
the lookups are replaced with small stand-ins."""
import asyncio
from types import SimpleNamespace

from app.core import tenancy
from app.services import credits as K


class FakeDb:
    def __init__(self, cap):
        self.op = SimpleNamespace(monthly_cap=cap)

    async def get(self, _model, _id):
        return self.op


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def with_used(monkeypatch, used):
    async def fake(_db, _uid, now=None):
        return used
    monkeypatch.setattr(K, "person_month_used", fake)


def test_no_limit_allows(monkeypatch):
    with_used(monkeypatch, 10_000)
    assert run(K._cap_check(FakeDb(None), "op1", 50, {})) == (True, "")


def test_limit_blocks_when_spend_would_pass_it(monkeypatch):
    with_used(monkeypatch, 90)
    ok, why = run(K._cap_check(FakeDb(100), "op1", 11, {}))
    assert not ok and "100" in why and "limit" in why
    assert run(K._cap_check(FakeDb(100), "op1", 10, {}))[0]  # exactly reaching it is allowed


def test_credits_held_by_the_same_person_count(monkeypatch):
    with_used(monkeypatch, 50)
    holds = {"a": {"credits": 30, "actor": "op1"}, "b": {"credits": 500, "actor": "someone_else"}}
    assert not run(K._cap_check(FakeDb(100), "op1", 25, holds))[0]
    assert run(K._cap_check(FakeDb(100), "op1", 20, holds))[0]  # the other person's hold is not theirs


def test_jobs_and_unknown_people_are_not_limited(monkeypatch):
    with_used(monkeypatch, 10_000)
    assert run(K._cap_check(FakeDb(1), "system", 5, {}))[0]
    assert run(K._cap_check(FakeDb(1), "", 5, {}))[0]


def test_a_failed_check_refuses_once_a_limit_exists(monkeypatch):
    async def boom(_db, _uid, now=None):
        raise RuntimeError("db down")
    monkeypatch.setattr(K, "person_month_used", boom)
    ok, why = run(K._cap_check(FakeDb(100), "op1", 1, {}))
    assert not ok and "Try again" in why
    assert run(K._cap_check(FakeDb(None), "op1", 1, {}))[0]  # no limit: nothing to fail closed on


def test_room_left_under_the_limit(monkeypatch):
    with_used(monkeypatch, 60)
    assert run(K.cap_room(FakeDb(100), "op1", {"a": {"credits": 10, "actor": "op1"}})) == 30
    assert run(K.cap_room(FakeDb(None), "op1", {})) is None
    with_used(monkeypatch, 500)
    assert run(K.cap_room(FakeDb(100), "op1", {})) == 0


def test_actor_scope_sets_and_restores():
    assert tenancy.current_actor() == ""
    with tenancy.actor_scope("op9"):
        assert tenancy.current_actor() == "op9"
        with tenancy.actor_scope("op2"):
            assert tenancy.current_actor() == "op2"
        assert tenancy.current_actor() == "op9"
    assert tenancy.current_actor() == ""


def test_credit_line_is_stamped_with_the_acting_person():
    from app.models.models import CreditEntry
    from app.services import embed as EM

    line = CreditEntry(id="x", kind="usage", wallet="leadgen", amount=-5, org_id="o1")
    with tenancy.actor_scope("op7"):
        EM._stamp_credit_line(None, None, line)
    assert line.user_id == "op7"
    job = CreditEntry(id="y", kind="usage", wallet="leadgen", amount=-5, org_id="o1")
    EM._stamp_credit_line(None, None, job)
    assert job.user_id == "system"
    grant = CreditEntry(id="z", kind="grant", wallet="leadgen", amount=5, org_id="o1")
    EM._stamp_credit_line(None, None, grant)
    assert grant.user_id is None  # only usage is attributed to a person
