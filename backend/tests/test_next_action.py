"""The one next step for a company: a fixed order, plain words."""
from datetime import datetime, timedelta

from app.services.next_action import decide

NOW = datetime(2026, 11, 11, 12, 0)


def test_order_closed_beats_everything():
    got = decide({"status": "Liquidation", "open_picks": 2, "email_ok": True, "has_phone": True, "stage": "won"}, NOW)
    assert got["key"] == "skip" and got["label"] == "Leave this one out"
    assert decide({"verdict": "problem", "email_ok": True}, NOW)["key"] == "skip"
    assert decide({"stage": "do_not_contact", "email_ok": True}, NOW)["key"] == "none"


def test_picks_before_email():
    assert decide({"open_picks": 1, "email_ok": True, "has_phone": True}, NOW)["key"] == "choose"
    assert decide({"email_ok": True, "has_phone": True}, NOW)["key"] == "email"


def test_recent_contact_waits():
    recent = (NOW - timedelta(days=3)).isoformat() + "Z"
    old = (NOW - timedelta(days=20)).isoformat() + "Z"
    assert decide({"last_contact_at": recent, "email_ok": True}, NOW)["key"] == "wait"
    assert decide({"last_contact_at": old, "email_ok": True}, NOW)["key"] == "email"


def test_phone_only_says_call_director():
    assert decide({"has_phone": True, "director": "Jane Smith"}, NOW)["label"] == "Call Jane Smith"
    assert decide({"has_phone": True}, NOW)["label"] == "Call them"
    assert decide({}, NOW)["key"] == "find"
