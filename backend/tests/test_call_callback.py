from datetime import datetime

from app.services.call_callback import _json, plan

NOW = datetime(2026, 11, 13, 15, 0)  # a Friday


def test_window_and_next_working_day():
    p = plan({"callback": True, "name": "Hammond", "phone": "07890994407", "from": "12:00", "to": "16:00"}, NOW)
    assert p["day"] == "2026-11-16" and p["time"] == "12:00" and p["window"] == "12:00–16:00" and p["name"] == "Hammond"


def test_said_day_kept_and_past_day_replaced():
    assert plan({"callback": True, "date": "2026-11-18"}, NOW)["day"] == "2026-11-18"
    assert plan({"callback": True, "date": "2026-11-01"}, NOW)["day"] == "2026-11-16"


def test_no_callback_no_entry():
    assert plan({"callback": False}, NOW) is None and plan({}, NOW) is None


def test_json_is_pulled_out_of_chatter():
    assert _json('Sure: {"callback": true} done')["callback"] is True and _json("nothing") == {}
