"""TPS/CTPS screening: the vendor's answers are read correctly, a failed key or an empty balance stops a run, results are kept for 28 days,
only answered numbers are charged, and a repeat check inside 28 days is free."""
import pytest
from sqlalchemy import text

from app.api import tps_check as T
from app.core.tenancy import org_scope, system_scope
from app.services import call_permission as CP
from app.services import credits as K
from app.services import provero as P


def test_a_listed_number_is_read_from_the_answer():
    body = {"phone": "tel:+44-1234-567890", "onTps": True, "tpsRegisteredDate": "2024-03-22", "onCtps": False, "ctpsRegisteredDate": ""}
    assert P.parse(200, body) == {"tps": "listed", "ctps": False, "tps_date": "2024-03-22", "ctps_date": ""}
    assert P.parse(200, {"onTps": False, "onCtps": True, "ctpsRegisteredDate": "2023-05-08"})["ctps"] is True
    assert P.parse(200, {"onTps": False, "onCtps": False})["tps"] == "clear"


def test_each_failure_is_its_own_error():
    with pytest.raises(P.KeyRejected):
        P.parse(401, {"error": {"code": "401"}})
    with pytest.raises(P.OutOfBalance):
        P.parse(402, {"message": "Insufficient balance for validation request."})
    with pytest.raises(P.Unavailable):
        P.parse(429, {})
    with pytest.raises(P.Unavailable):
        P.parse(503, None)
    with pytest.raises(P.BadNumber):
        P.parse(422, {"message": "Invalid phone number for GB region", "errors": {"phone": ["x"]}})
    with pytest.raises(P.BadNumber):
        P.parse(200, {"unexpected": True})


async def test_a_run_skips_unusable_numbers_and_stops_on_a_refused_key(monkeypatch):
    async def fake(client, key, number):
        if number.endswith("0"):
            raise P.BadNumber("not a UK number")
        return {"tps": "listed" if number.endswith("1") else "clear", "ctps": number.endswith("2")}

    async def no_count():
        return None

    monkeypatch.setattr(P, "check_one", fake)
    monkeypatch.setattr(P, "_count_call", no_count)
    prov = P.ProveroProvider("k" * 12)
    got = await prov.screen(["+441000000010", "+441000000001", "+441000000002"])
    assert got == {"+441000000001": {"tps": "listed", "ctps": False}, "+441000000002": {"tps": "clear", "ctps": True}} and prov.error == ""

    async def refused(client, key, number):
        raise P.KeyRejected("no")

    monkeypatch.setattr(P, "check_one", refused)
    assert await prov.screen(["+441000000011"]) == {} and prov.error == "key"

    async def empty(client, key, number):
        raise P.OutOfBalance("no")

    monkeypatch.setattr(P, "check_one", empty)
    assert await prov.screen(["+441000000012"]) == {} and prov.error == "balance"


def test_the_credit_price_rounds_up_and_numbers_are_cleaned():
    assert T.credits_for(0, 2) == 0 and T.credits_for(5, 2) == 2 and T.credits_for(1, 2) == 0.4 and T.credits_for(12, 2) == 4.8
    assert T._clean(["07700 900001", "+44 7700 900001", "0 7700 900002", ""]) == ["+447700900001", "+447700900002"]
    row = T._row("+12125550101", {"tps_status": "clear", "ctps": False, "fresh": True, "screened_at": None})
    assert row["status"] == "not_uk"  # the registers cover UK numbers only, so nothing is asked or charged


async def test_the_screening_slot_uses_the_saved_key(monkeypatch):
    async def saved(db=None):
        return P.ProveroProvider("abcdefghijklmnop")

    monkeypatch.setattr(P, "provider", saved)
    prov = await CP.provider()
    assert prov.name == "provero" and prov.configured()

    async def none(db=None):
        return None

    monkeypatch.setattr(P, "provider", none)
    assert (await CP.provider()).configured() is False


class Fake:
    name = "provero"
    error = ""

    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def configured(self):
        return True

    async def screen(self, numbers):
        self.calls.append(list(numbers))
        return {n: self.answers[n] for n in numbers if n in self.answers}



@pytest.mark.db
async def test_estimate_run_charge_and_free_repeat(client, db, monkeypatch):
    nums = ["+447700900001", "+447700900002", "+447700900003", "+447700900004", "+447700900005", "+12125550101"]
    fake = Fake({n: {"tps": "listed" if n.endswith("1") else "clear", "ctps": n.endswith("2")} for n in nums[:4]})  # the fifth gets no answer

    async def provider():
        return fake

    monkeypatch.setattr(CP, "provider", provider)
    with org_scope("org_default"):
        await K.add_credits(db, "voice", 10, source="grant", note="Test")
        await db.commit()

    est = (await client.post("/api/tps-check/estimate", json={"numbers": nums})).json()
    assert est["ready"] is True and est["to_check"] == 5 and est["credits"] == 2 and est["balance"] == 10

    out = (await client.post("/api/tps-check/run", json={"numbers": nums})).json()
    by = {r["number"]: r for r in out["rows"]}
    assert by["+447700900001"]["status"] == "listed" and by["+447700900002"]["ctps"] is True and by["+447700900003"]["status"] == "clear"
    assert by["+447700900005"]["status"] == "unknown" and by["+12125550101"]["status"] == "not_uk"
    assert out["credits_charged"] == 2  # four answered numbers = 4/5 of a unit at 2 credits, rounded up once
    with system_scope():
        used = (await db.execute(text("SELECT coalesce(sum(-amount), 0) FROM credit_ledger WHERE item = 'tps_check'"))).scalar()
    assert used == 2

    again = (await client.post("/api/tps-check/estimate", json={"numbers": nums})).json()
    assert again["to_check"] == 1  # the four answered numbers are fresh for 28 days; only the one without an answer is still to do
    await client.post("/api/tps-check/run", json={"numbers": nums})
    assert len(fake.calls) == 2 and fake.calls[1] == ["+447700900005"]


@pytest.mark.db
async def test_nothing_is_screened_without_a_key_or_enough_credits(client, db, monkeypatch):
    class Off:
        name = "none"
        error = ""

        def configured(self):
            return False

    async def provider():
        return Off()

    monkeypatch.setattr(CP, "provider", provider)
    r = await client.post("/api/tps-check/run", json={"numbers": ["+447700900031"]})
    assert r.status_code == 503 and "not switched on" in r.text
    assert "provero" not in r.text.lower()  # clients never see the vendor's name


@pytest.mark.db
async def test_a_call_never_triggers_a_paid_screening(db, monkeypatch):
    prov = Fake({"+447700900041": {"tps": "listed", "ctps": False}})

    async def provider():
        return prov

    monkeypatch.setattr(CP, "provider", provider)
    out = await CP.decide(db, "+447700900041", "human")
    assert prov.calls == []  # nothing was looked up or charged
    assert out["allowed"] is True and out["flags"] == ["check_tps"] and out["warnings"] == [CP.CHECK_TPS]
