"""Number rent: when the month closes and which reminder goes out (pure date logic)."""
from datetime import datetime

from app.services import credits as K


def test_month_close_and_days_left():
    assert K.month_close(datetime(2026, 10, 12, 8)) == datetime(2026, 11, 1)
    assert K.month_close(datetime(2026, 12, 20)) == datetime(2027, 1, 1)
    assert K.days_until_close(datetime(2026, 10, 22, 0)) == 10
    assert K.days_until_close(datetime(2026, 10, 31, 12)) == 1


def test_reminders_go_out_at_7_5_3_1_days_once_each():
    assert K.rent_reminder_due(9, []) is None
    assert K.rent_reminder_due(7, []) == 7
    assert K.rent_reminder_due(6, [7]) is None
    assert K.rent_reminder_due(5, [7]) == 5
    assert K.rent_reminder_due(3, [7, 5]) == 3
    assert K.rent_reminder_due(1, [7, 5, 3]) == 1
    assert K.rent_reminder_due(1, [7, 5, 3, 1]) is None
    # a missed mark is caught up with one mail, not several
    assert K.rent_reminder_due(2, [7, 5]) == 3
