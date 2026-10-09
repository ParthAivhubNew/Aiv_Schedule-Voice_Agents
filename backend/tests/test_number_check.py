"""Number check: free checks first, one lookup per new number, charge only for real answers."""
from datetime import datetime

import pytest

from app.services import number_check as NC
from app.services.telnyx_client import TelnyxError


def lookup(kind="mobile", carrier="Verizon", name="", country="US"):
    return {"country_code": country, "carrier": {"type": kind, "name": carrier}, "caller_name": {"caller_name": name}}


def test_line_types_and_status():
    assert NC.classify(lookup("mobile"))["status"] == "good"
    assert NC.classify(lookup("fixed line"))["line_type"] == "landline"
    assert NC.classify(lookup("fixed line or mobile"))["status"] == "good"
    assert NC.classify(lookup("voip"))["status"] == "check"
    assert NC.classify(lookup("toll free"))["line_type"] == "toll_free"
    assert NC.classify(lookup("mobile", carrier=""))["status"] == "check"  # no carrier on file
    assert NC.classify({})["status"] == "check"


def test_a_failed_name_lookup_is_not_a_name():
    data = lookup(name="Acme")
    data["caller_name"]["error_code"] = "10001"
    assert NC.classify(data)["found_name"] == ""


def test_name_matching():
    assert NC.name_match(["Acme Corp"], "ACME CORPORATION") == "match"
    assert NC.name_match(["Acme Inc."], "Acme") == "match"
    assert NC.name_match(["Sam Patel", "Acme"], "Patel, Sam") == "match"
    assert NC.name_match(["Acme Roofing"], "Acme Plumbing") == "partial"
    assert NC.name_match(["Acme"], "Zenith Dental") == "differs"
    assert NC.name_match(["Acme"], "") == "none"
    assert NC.name_match([], "Acme") == "none"


def test_free_checks_come_first():
    rows = NC.prepare([
        {"key": "a", "phone": "+1 (212) 555-0123"},
        {"key": "b", "phone": "12125550123"},       # same number again
        {"key": "c", "phone": "+121"},              # too short
        {"key": "d", "phone": ""},
        {"key": "e", "phone": "+14155550000"},      # on the do-not-call list
        {"key": "f", "phone": "+442079460000"},
    ], dnc={"+14155550000"})
    assert [r["status"] for r in rows] == ["", "duplicate", "bad_format", "bad_format", "do_not_call", ""]
    assert rows[0]["phone"] == "+12125550123"


class Hit:
    status, line_type, carrier, country, found_name = "good", "mobile", "Verizon", "US", "Acme Corporation"
    checked_at = datetime(2030, 1, 1)


def test_answers_we_already_have_are_free():
    rows = NC.prepare([{"key": "a", "phone": "+12125550123", "names": ["Acme Corp"]}, {"key": "b", "phone": "+442079460000"}], set())
    todo = NC.plan(rows, {"+12125550123": Hit()})
    assert [r["key"] for r in todo] == ["b"]
    assert rows[0]["status"] == "good" and rows[0]["cached"] and rows[0]["match"] == "match"
    assert rows[0]["checked_on"] == "2030-01-01"


def test_price_is_one_credit_per_five_numbers():
    assert [NC.credits_for(n) for n in (0, 1, 5, 6, 29, 480)] == [0, 1, 1, 2, 6, 96]
    assert NC.credits_for(10, 2) == 4


class Client:
    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    async def lookup_number(self, phone):
        self.calls.append(phone)
        out = self.answers[phone]
        if isinstance(out, Exception):
            raise out
        return out


async def test_lookups_set_each_status_and_unreachable_is_not_counted():
    rows = NC.prepare([{"key": str(i), "phone": p, "names": ["Acme"]} for i, p in enumerate(
        ["+12125550101", "+12125550102", "+12125550103", "+12125550104"])], set())
    client = Client({
        "+12125550101": lookup("mobile", name="Acme Corp"),
        "+12125550102": TelnyxError("not found", 404),
        "+12125550103": TelnyxError("down", 500),
        "+12125550104": lookup("voip"),
    })
    answered = await NC.look_up(rows, client=client)
    assert answered == 3
    assert [r["status"] for r in rows] == ["good", "not_working", "couldnt_check", "check"]
    assert rows[0]["match"] == "match" and rows[0]["found_name"] == "Acme Corp"
    assert len(client.calls) == 4


async def test_no_key_means_nothing_is_checked_or_charged(monkeypatch):
    from app.services import telnyx_client

    monkeypatch.setattr(telnyx_client, "platform_key", lambda: "")
    rows = NC.prepare([{"key": "a", "phone": "+12125550101"}], set())
    assert await NC.look_up(rows) == 0
    assert rows[0]["status"] == "couldnt_check"


def test_only_paid_answers_are_remembered():
    class Db:
        def __init__(self):
            self.added = []

        def add(self, row):
            self.added.append(row)

    rows = [{"status": s, "cached": c, "phone": "+1", "line_type": "", "carrier": "", "country": "", "found_name": ""}
            for s, c in [("good", False), ("good", True), ("couldnt_check", False), ("not_working", False), ("duplicate", False)]]
    db = Db()
    import asyncio
    asyncio.run(NC.remember(db, rows))
    assert [r.status for r in db.added] == ["good", "not_working"]


def test_the_rate_card_lists_the_check():
    from app.services.credits import DEFAULT_RATES

    assert DEFAULT_RATES["number_check"]["credits"] == 1 and DEFAULT_RATES["number_check"]["wallet"] == "voice"


# ── The endpoints, with the database and the carrier stood in ───────────────
class FakeDb:
    def __init__(self):
        self.added, self.commits, self.rollbacks = [], 0, 0

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


@pytest.fixture
def wired(monkeypatch):
    from app.api import number_check as API
    from app.services import credits as K

    state = {"charged": [], "allowed": (True, ""), "dnc": set(), "cache": {}}

    async def dnc(_db):
        return state["dnc"]

    async def cache(_db, phones):
        return {p: state["cache"][p] for p in phones if p in state["cache"]}

    async def rates(_db):
        return {"number_check": {"credits": 1}}

    async def settings(_db):
        return {"enforce": True}

    async def balance(_db, _wallet):
        return 50

    async def can_start(_db, item, quantity=1, extra=None):
        state["asked"] = quantity
        return state["allowed"]

    async def charge(_db, item, quantity, ref, note=""):
        import math
        state["charged"].append((item, quantity))
        return int(math.ceil(quantity))

    monkeypatch.setattr(NC, "do_not_call_numbers", dnc)
    monkeypatch.setattr(NC, "cached_answers", cache)
    monkeypatch.setattr(K, "rates", rates)
    monkeypatch.setattr(K, "org_settings", settings)
    monkeypatch.setattr(K, "wallet_balance", balance)
    monkeypatch.setattr(K, "can_start", can_start)
    monkeypatch.setattr(K, "charge", charge)
    return API, state


def body(API, *phones):
    return API.CheckBody(items=[API.Item(key=f"k{i}", phone=p, names=["Acme"]) for i, p in enumerate(phones)])


async def test_estimate_prices_only_what_needs_a_lookup(wired):
    API, state = wired
    state["dnc"] = {"+14155550000"}
    state["cache"] = {"+442079460000": Hit()}
    out = await API.estimate(body(API, "+12125550101", "+442079460000", "+14155550000", "12", "+12125550101"), FakeDb())
    assert [r["status"] for r in out["rows"]] == ["", "good", "do_not_call", "bad_format", "duplicate"]
    assert out["to_check"] == ["k0"] and out["credits"] == 1 and out["balance"] == 50


async def test_run_looks_up_saves_and_charges_for_answers_only(wired, monkeypatch):
    API, state = wired
    client = Client({"+12125550101": lookup("mobile"), "+12125550102": TelnyxError("down", 500), "+12125550103": TelnyxError("nf", 404)})

    async def look_up(rows, client=client):
        return await real(rows, client=client)

    real = NC.look_up
    monkeypatch.setattr(NC, "look_up", look_up)
    db = FakeDb()
    out = await API.run(body(API, "+12125550101", "+12125550102", "+12125550103"), db)
    assert [r["status"] for r in out["rows"]] == ["good", "couldnt_check", "not_working"]
    assert state["charged"] == [("number_check", 2 / 5)] and out["credits_charged"] == 1  # two answers = 1 credit
    assert [r.phone for r in db.added] == ["+12125550101", "+12125550103"]  # the unanswered one is not kept
    assert db.commits == 1


async def test_run_refuses_when_credits_are_short_and_calls_nothing(wired, monkeypatch):
    from fastapi import HTTPException

    API, state = wired
    state["allowed"] = (False, "Out of voice credits.")
    called = []

    async def look_up(rows, client=None):
        called.append(rows)
        return 0

    monkeypatch.setattr(NC, "look_up", look_up)
    with pytest.raises(HTTPException) as err:
        await API.run(body(API, "+12125550101"), FakeDb())
    assert err.value.status_code == 402 and not called


async def test_a_lookup_that_cannot_run_is_free(wired, monkeypatch):
    from app.services import telnyx_client

    monkeypatch.setattr(telnyx_client, "platform_key", lambda: "")  # never reach the real carrier from a test
    API, state = wired
    db = FakeDb()
    out = await API.run(body(API, "12", "+12125550101", "+12125550101"), db)
    assert out["rows"][1]["status"] == "couldnt_check"
    assert out["credits_charged"] == 0 and state["charged"] == []
