"""Booking tools: slot times are spoken in the caller's timezone, stored in the account's."""
import pytest

from app.services import booking_tools as BT
from app.services import calendar_service as CS
from app.services import org_settings
from app.services.timezone_service import normalize_stated_timezone


@pytest.fixture
def london_account(monkeypatch):
    async def tz(_db):
        return "Europe/London"

    monkeypatch.setattr(org_settings, "org_timezone", tz)


def ctx(tz="America/New_York", policy=None):
    return {
        "direction": "outbound",
        "prospect": {"name": "Sam", "email": "sam@example.com", "phone": "+12125550123"},
        "temporal_context": {"timezone": tz, "today_iso": "2030-01-14"},
        "booking_policy": policy,
    }


def test_stated_timezones_are_understood():
    assert normalize_stated_timezone("America/New_York") == "America/New_York"
    assert normalize_stated_timezone("Eastern time") == "America/New_York"
    assert normalize_stated_timezone("IST") == "Asia/Kolkata"
    assert normalize_stated_timezone("nonsense") is None
    assert normalize_stated_timezone("") is None


def test_start_time_parsing():
    date, time, instant = BT._parse_start_time("2030-01-15T10:30:00-05:00", "2030-01-14")
    assert (date, time) == ("2030-01-15", "10:30") and instant is not None
    date, time, instant = BT._parse_start_time("2030-01-15 10:30", "2030-01-14")
    assert (date, time, instant) == ("2030-01-15", "10:30", None)
    assert BT._parse_start_time("14:00", "2030-01-14")[:2] == ("2030-01-14", "14:00")
    assert BT._parse_start_time("tomorrow", "2030-01-14") == (None, None, None)
    assert BT._parse_start_time("", "2030-01-14") == (None, None, None)


async def test_slots_are_offered_in_the_callers_zone(london_account, monkeypatch):
    # Account time 15:00 London is 10:00 in New York.
    async def slots(self, db, date_str, event_type_slug="15-min-discovery", prospect_tz=None):
        if date_str != "2030-01-15":
            return []
        return [{"time": "15:00", "available": True, "offerable": True, "prospectDate": "2030-01-15", "prospectTime": "10:00"}]

    monkeypatch.setattr(CS.CalendarService, "get_available_slots", slots)
    out = await BT.execute_smart_booking_tool(None, "check_availability", {"start_date": "2030-01-15"}, ctx())
    assert out["success"] and out["timezone"] == "America/New_York"
    assert out["available_slots"] == ["2030-01-15T10:00:00-05:00"]
    assert out["spoken_slots"] == ["Tuesday 15 January, 10:00 AM"]


async def test_a_zone_the_caller_states_wins(london_account, monkeypatch):
    seen = {}

    async def slots(self, db, date_str, event_type_slug="15-min-discovery", prospect_tz=None):
        seen["tz"] = prospect_tz
        return []

    monkeypatch.setattr(CS.CalendarService, "get_available_slots", slots)
    await BT.execute_smart_booking_tool(None, "check_availability",
                                        {"start_date": "2030-01-15", "caller_timezone": "Pacific"}, ctx())
    assert seen["tz"] == "America/Los_Angeles"


async def test_a_full_range_offers_the_next_open_days(london_account, monkeypatch):
    async def slots(self, db, date_str, event_type_slug="15-min-discovery", prospect_tz=None):
        if date_str == "2030-01-17":
            return [{"time": "09:00", "available": True, "offerable": True, "prospectDate": "2030-01-17", "prospectTime": "09:00"}]
        return []

    monkeypatch.setattr(CS.CalendarService, "get_available_slots", slots)
    out = await BT.execute_smart_booking_tool(None, "check_availability",
                                              {"start_date": "2030-01-15", "end_date": "2030-01-15"}, ctx("Europe/London"))
    assert out["available_slots"] == []
    assert out["next_spoken_slots"] == ["Thursday 17 January, 9:00 AM"]


async def test_booking_converts_an_exact_start_to_account_time(london_account, monkeypatch):
    got = {}

    async def create(self, db, **kw):
        got.update(kw)
        return {"success": True, "bookingId": "m1", "prospectDate": "2030-01-15", "prospectTime": "10:00"}

    monkeypatch.setattr(CS.CalendarService, "create_booking", create)
    out = await BT.execute_smart_booking_tool(
        None, "book_appointment",
        # The hosted assistant calls the fields email / name.
        {"start_time": "2030-01-15T10:00:00-05:00", "email": "sam@example.com", "name": "Sam"}, ctx())
    assert out["success"] and out["booking_id"] == "m1"
    assert (got["date_str"], got["time_str"]) == ("2030-01-15", "15:00")  # 10:00 New York = 15:00 London
    assert got["time_is_prospect_local"] is False
    assert got["attendee_email"] == "sam@example.com"
    assert got["prospect_timezone"] == "America/New_York"


async def test_a_bare_time_is_the_callers_wall_clock(london_account, monkeypatch):
    got = {}

    async def create(self, db, **kw):
        got.update(kw)
        return {"success": True}

    monkeypatch.setattr(CS.CalendarService, "create_booking", create)
    await BT.execute_smart_booking_tool(None, "book_appointment",
                                        {"start_time": "2030-01-15 10:00", "attendee_email": "a@b.co"}, ctx())
    assert got["time_is_prospect_local"] is True and got["time_str"] == "10:00"


async def test_a_refused_booking_is_never_reported_as_booked(london_account, monkeypatch):
    async def create(self, db, **kw):
        return {"success": False, "error": "outside_hours_or_taken", "availableSlots": ["15:30"]}

    monkeypatch.setattr(CS.CalendarService, "create_booking", create)
    out = await BT.execute_smart_booking_tool(None, "book_appointment",
                                              {"start_time": "2030-01-15T10:00:00-05:00", "attendee_email": "a@b.co"}, ctx())
    assert out["success"] is False and out["error"] == "outside_hours_or_taken"
    assert "not free" in out["message"]


async def test_a_time_that_is_not_a_slot_is_rejected(london_account):
    out = await BT.execute_smart_booking_tool(None, "book_appointment",
                                              {"start_time": "tomorrow", "attendee_email": "a@b.co"}, ctx())
    assert out["success"] is False and "available_slots" in out["error"]


async def test_timezone_is_spoken_only_when_the_business_asks(london_account, monkeypatch):
    async def create(self, db, **kw):
        return {"success": True}

    monkeypatch.setattr(CS.CalendarService, "create_booking", create)
    args = {"start_time": "2030-01-15T10:00:00-05:00", "attendee_email": "a@b.co"}
    off = await BT.execute_smart_booking_tool(None, "book_appointment", args, ctx(policy={"confirm_timezone": False}))
    on = await BT.execute_smart_booking_tool(None, "book_appointment", args, ctx(policy={"confirm_timezone": True}))
    assert "timezone" not in off["message"]
    assert "say the timezone once" in on["message"]
