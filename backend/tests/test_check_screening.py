"""TPS and CTPS screening when a company is checked: which numbers are asked about, and what happens when it cannot be done."""
import asyncio

from app.services import check_screening as CS


class Row:
    phone = "01273 000111"
    research = {}


class Prov:
    name = "test"

    def __init__(self, configured=True, error=""):
        self._configured, self.error, self.asked = configured, error, []

    def configured(self):
        return self._configured

    async def screen(self, numbers):
        self.asked.append(list(numbers))
        return {n: {"tps": "clear", "ctps": False} for n in numbers}


def run(coro):
    return asyncio.run(coro)


def setup(monkeypatch, *, numbers, fresh=(), prov=None, can=True):
    prov = prov or Prov()
    saved = []

    async def provider():
        return prov

    async def fresh_set(db, nums):
        return {n for n in nums if n in fresh}

    async def can_start(db, item, qty):
        return (can, "" if can else "no credits")

    async def keep(db, answers, name, label):
        saved.append(sorted(answers))
        return {"screened": len(answers), "charged": 1}

    monkeypatch.setattr(CS.CP, "provider", provider)
    monkeypatch.setattr(CS, "_fresh_set", fresh_set)
    monkeypatch.setattr(CS.K, "can_start", can_start)
    monkeypatch.setattr(CS, "_keep", keep)
    monkeypatch.setattr(CS, "account_numbers", lambda row: numbers)
    return prov, saved


def test_only_uk_numbers_without_a_fresh_result_are_asked_about(monkeypatch):
    prov, saved = setup(monkeypatch, numbers=["01273 000111", "+33 1 23 45 67 89", "01273 000222"], fresh={"+441273000222"})
    got = run(CS.screen_account(None, Row()))
    assert got == {"status": "done", "screened": 1, "charged": 1}
    assert prov.asked == [["+441273000111"]]


def test_nothing_to_screen_costs_and_asks_nothing(monkeypatch):
    prov, _ = setup(monkeypatch, numbers=["01273 000222"], fresh={"+441273000222"})
    assert run(CS.screen_account(None, Row()))["status"] == "nothing"
    assert prov.asked == []


def test_without_a_provider_key_nothing_is_asked_and_the_status_says_so(monkeypatch):
    prov, saved = setup(monkeypatch, numbers=["01273 000111"], prov=Prov(configured=False))
    assert run(CS.screen_account(None, Row()))["status"] == "no_key"
    assert prov.asked == [] and saved == []


def test_too_few_credits_asks_nothing(monkeypatch):
    prov, saved = setup(monkeypatch, numbers=["01273 000111"], can=False)
    assert run(CS.screen_account(None, Row()))["status"] == "no_credits"
    assert prov.asked == [] and saved == []


def test_a_service_problem_is_reported_and_never_raised(monkeypatch):
    class Down(Prov):
        async def screen(self, numbers):
            self.error = "timeout"
            return {}

    setup(monkeypatch, numbers=["01273 000111"], prov=Down())
    assert run(CS.screen_account(None, Row()))["status"] == "service"

    async def boom(*a, **k):
        raise RuntimeError("database gone")

    monkeypatch.setattr(CS, "screen_account", boom)
    assert run(CS.screen_account_safely(None, Row()))["status"] == "service"


def test_the_same_numbers_on_the_same_day_get_the_same_charge_ref():
    from datetime import datetime

    now = datetime(2026, 11, 24, 10)
    assert CS._ref(["+441", "+442"], now) == CS._ref(["+442", "+441"], now)
    assert CS._ref(["+441"], now) != CS._ref(["+442"], now)
