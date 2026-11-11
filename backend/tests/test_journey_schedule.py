from datetime import datetime

from app.services.journeys import plan_schedule

MON_10 = datetime(2026, 11, 9, 10, 0)  # a Monday
FRI_18 = datetime(2026, 11, 13, 18, 0)
BOX = {"email": "a@x.com", "status": "active", "quota": 20}
BASE = dict(days=[1, 2, 3, 4, 5], start="09:00", end="17:00", tz="Europe/London", min_delay_s=120)


def test_it_says_the_hours_the_pace_and_when_everyone_has_had_the_first_email():
    out = plan_schedule(**BASE, local=MON_10, boxes=[BOX], waiting=45, daily_cap=0, steps=[])
    assert out["open_now"] and out["per_day"] == 20 and out["days_needed"] == 3
    assert out["finish"] == "Wednesday 11 November"
    assert "Mon to Fri, 09:00 to 17:00 (Europe/London)" in out["lines"][0]


def test_outside_the_hours_it_names_the_next_opening_and_skips_the_weekend():
    out = plan_schedule(**BASE, local=FRI_18, boxes=[BOX], waiting=25, daily_cap=0, steps=[])
    assert not out["open_now"] and out["next_opens"] == "Monday at 09:00"
    assert out["finish"] == "Tuesday 17 November"  # Monday and Tuesday, two days of 20


def test_the_journeys_daily_limit_and_the_window_length_cap_the_pace():
    assert plan_schedule(**BASE, local=MON_10, boxes=[BOX], waiting=10, daily_cap=5, steps=[])["per_day"] == 5
    assert plan_schedule(**{**BASE, "end": "09:10"}, local=MON_10, boxes=[BOX], waiting=3, daily_cap=0, steps=[])["per_day"] == 5  # 10 minutes at one every 2


def test_no_ready_mailbox_says_so_and_gives_no_finish_date():
    out = plan_schedule(**BASE, local=MON_10, boxes=[{**BOX, "status": "paused"}], waiting=5, daily_cap=0, steps=[])
    assert out["per_day"] == 0 and out["finish"] == "" and any("No mailbox is ready" in l for l in out["lines"])


def test_follow_ups_are_listed_with_their_waits():
    steps = [{"step": 1, "delay_days": 0, "delay_hours": 0}, {"step": 2, "delay_days": 3, "delay_hours": 0}]
    out = plan_schedule(**BASE, local=MON_10, boxes=[BOX], waiting=1, daily_cap=0, steps=steps)
    assert any("step 2 3 days after" in l for l in out["lines"])
