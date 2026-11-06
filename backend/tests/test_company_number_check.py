"""N1: a company is Verified only when its number (or postcode) agrees, never on a name alone."""
from types import SimpleNamespace

import pytest

from app.services import company_check as cc


def _decide(**ev):
    return cc.decide({"website": {"state": "live", "name_seen": True}, **ev})


def test_number_and_name_agree_is_verified():
    out = _decide(number={"state": "match", "regno": "08233371", "status": "Active", "name": "Wilkinson Accountancy Ltd"}, identity=True)
    assert out["verdict"] == "verified"


def test_number_that_belongs_to_another_company_is_a_mismatch():
    out = _decide(number={"state": "mismatch", "regno": "08233371", "name": "WILKINSON ACCOUNTANCY LTD", "status": "Active"})
    assert out["verdict"] == "mismatch"
    assert "belongs to WILKINSON ACCOUNTANCY LTD" in " ".join(out["reasons"])


def test_a_number_nobody_has_is_a_mismatch():
    assert _decide(number={"state": "unknown", "regno": "99999999"})["verdict"] == "mismatch"


def test_dissolved_company_with_matching_number_is_a_problem():
    out = _decide(number={"state": "match", "regno": "12345678", "status": "Dissolved", "name": "Mega Corp"}, identity=True)
    assert out["verdict"] == "problem"


def test_name_only_match_is_not_verified():
    out = _decide(registry={"found": True, "status": "Active"}, identity=False)
    assert out["verdict"] == "looks_ok"
    assert any("name only" in r for r in out["reasons"])


def test_name_plus_postcode_or_link_is_verified():
    assert _decide(registry={"found": True, "status": "Active"}, identity=True)["verdict"] == "verified"


class FakePace:
    paused_until = 0.0

    async def wait(self, gap):
        return None


async def test_number_check_uses_the_register_and_compares_names(monkeypatch):
    from app.services import data_source_connector as connector

    async def fake(src, number):
        return {"found": True, "name": "WILKINSON ACCOUNTANCY LTD", "status": "active", "postcode": "LS1 4AP"} if number == "08233371" else {"found": False}

    monkeypatch.setattr(connector, "fetch_by_number", fake)
    src = SimpleNamespace(id="s1", min_delay_ms=0)
    paces = {"s1": FakePace()}
    bad = await cc.number_check({"name": "Northway Accountants Ltd", "registration_number": "8233371"}, [src], paces)
    assert bad["state"] == "mismatch" and bad["regno"] == "08233371" and "WILKINSON" in bad["name"]
    good = await cc.number_check({"name": "Wilkinson Accountancy Limited", "registration_number": "08233371"}, [src], paces)
    assert good["state"] == "match"
    none = await cc.number_check({"name": "Ghost Ltd", "registration_number": "99999999"}, [src], paces)
    assert none["state"] == "unknown"
    assert await cc.number_check({"name": "No Number Ltd", "registration_number": ""}, [src], paces) is None
