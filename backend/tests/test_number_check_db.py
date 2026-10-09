"""Number check through the real API and database: the answer is kept, only answers are charged,
the same number is free next time, and another organisation never sees it."""
import pytest
from sqlalchemy import text

from app.core.tenancy import org_scope, system_scope
from app.services import credits as K
from app.services import number_check as NC
from app.services.telnyx_client import TelnyxError

pytestmark = pytest.mark.db


class Carrier:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    async def lookup_number(self, phone):
        self.calls.append(phone)
        out = self.answers[phone]
        if isinstance(out, Exception):
            raise out
        return out


def mobile(name=""):
    return {"country_code": "US", "carrier": {"type": "mobile", "name": "Verizon"}, "caller_name": {"caller_name": name}}


@pytest.fixture
def carrier(monkeypatch):
    c = Carrier({"+12125550101": mobile("Acme Corporation"), "+12125550102": TelnyxError("nf", 404),
                 "+12125550103": TelnyxError("down", 500), "+12125550104": {"country_code": "US", "carrier": {"type": "voip", "name": "Acme VoIP"}}})
    real = NC.look_up

    async def look_up(rows, client=None):
        return await real(rows, client=c)

    monkeypatch.setattr(NC, "look_up", look_up)
    return c


async def grant(db, amount):
    with org_scope("org_default"):
        await K.add_credits(db, "voice", amount, source="grant", note="Test")
        await db.commit()


async def usage(db):
    with system_scope():
        return (await db.execute(text("SELECT coalesce(sum(-amount), 0) FROM credit_ledger WHERE item = 'number_check'"))).scalar()


def items(*phones):
    return {"items": [{"key": f"k{i}", "phone": p, "names": ["Acme Corp"]} for i, p in enumerate(phones)]}


async def test_estimate_run_and_free_repeat(client, db, carrier):
    await grant(db, 10)
    phones = ["+12125550101", "+12125550102", "+12125550103", "+12125550104", "+12125550104", "12"]
    est = (await client.post("/api/number-check/estimate", json=items(*phones))).json()
    assert est["to_check"] == ["k0", "k1", "k2", "k3"] and est["credits"] == 1 and est["balance"] == 10

    out = (await client.post("/api/number-check/run", json=items(*phones))).json()
    assert [r["status"] for r in out["rows"]] == ["good", "not_working", "couldnt_check", "check", "duplicate", "bad_format"]
    assert out["rows"][0]["match"] == "match" and out["rows"][0]["found_name"] == "Acme Corporation"
    assert out["credits_charged"] == 1 and await usage(db) == 1  # three answers = 1 credit; the failed one is free
    assert len(carrier.calls) == 4

    again = (await client.post("/api/number-check/estimate", json=items(*phones))).json()
    assert again["to_check"] == ["k2"]  # only the one that failed is still to do
    assert [r["cached"] for r in again["rows"][:2]] == [True, True] and again["rows"][0]["status"] == "good"
    await client.post("/api/number-check/run", json=items(*phones))
    assert len(carrier.calls) == 5 and await usage(db) == 1  # answered numbers were not looked up or charged again


async def test_without_credits_nothing_is_looked_up(client, db, carrier):
    r = await client.post("/api/number-check/run", json=items("+12125550101"))
    assert r.status_code == 402 and not carrier.calls
    assert await usage(db) == 0


async def test_another_organisation_does_not_see_the_cache(client, db, carrier):
    await grant(db, 10)
    await client.post("/api/number-check/run", json=items("+12125550101"))
    with org_scope("org_other"):
        assert await NC.cached_answers(db, ["+12125550101"]) == {}
    await db.rollback()  # a session keeps the organisation it started its transaction with
    with org_scope("org_default"):
        assert "+12125550101" in await NC.cached_answers(db, ["+12125550101"])


async def test_do_not_call_numbers_are_skipped_free(client, db, carrier):
    await grant(db, 10)
    from app.services.compliance import add_do_not_call

    with org_scope("org_default"):
        await add_do_not_call(db, "+12125550101", "Acme")
        await db.commit()
    out = (await client.post("/api/number-check/run", json=items("+12125550101"))).json()
    assert out["rows"][0]["status"] == "do_not_call" and not carrier.calls and await usage(db) == 0
