"""Unit tests for the scheduler, approval, schedule, endpoint and voice helpers (no database)."""
import asyncio
import time
from datetime import date, datetime
from types import SimpleNamespace

import pytest


# ── Organisation settings ──────────────────────────────────────────────────

def test_org_instant_uses_the_org_timezone_and_daylight_saving():
    from app.services.org_settings import org_instant_ms

    # 09:00 in Kolkata (UTC+5:30, no DST) is 03:30 UTC.
    ms = org_instant_ms("2026-10-05", "09:00", "Asia/Kolkata")
    assert datetime.utcfromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M") == "2026-10-05 03:30"
    # London is UTC+1 in summer and UTC+0 after the clocks go back.
    summer = org_instant_ms("2026-10-20", "09:00", "Europe/London")
    winter = org_instant_ms("2026-10-30", "09:00", "Europe/London")
    assert datetime.utcfromtimestamp(summer / 1000).hour == 8
    assert datetime.utcfromtimestamp(winter / 1000).hour == 9
    assert org_instant_ms("not-a-date", "09:00", "UTC") is None


def test_org_email_and_timezone_cleaning():
    from app.services.org_settings import clean_emails, valid_timezone

    assert clean_emails("A@x.com, bad, a@x.com; b@y.org") == ["a@x.com", "b@y.org"]
    assert valid_timezone("Asia/Kolkata") == "Asia/Kolkata"
    assert valid_timezone("Mars/Base") is None


# ── Signed approval links ──────────────────────────────────────────────────

def test_signed_links_reject_tampering_and_expiry():
    from app.services.approval_mail import sign, verify

    token = sign({"r": "apr_1", "m": "boss@x.com", "x": int(time.time()) + 60})
    assert verify(token)["m"] == "boss@x.com"
    body, mac = token.rsplit(".", 1)
    assert verify(body + "." + ("0" if mac[0] != "0" else "1") + mac[1:]) is None
    assert verify(sign({"r": "apr_1", "x": int(time.time()) - 1})) is None
    assert verify("garbage") is None


def test_review_state_only_allows_the_emailed_version():
    from app.services.approval_mail import _post_state

    stamp = datetime(2026, 9, 29, 8, 0, 0)
    post = SimpleNamespace(status="awaiting_approval", approval_requested_at=stamp)
    assert _post_state(post, stamp.isoformat()) == "waiting"
    assert _post_state(post, "2026-09-28T08:00:00") == "changed"
    assert _post_state(SimpleNamespace(status="approved", approval_requested_at=stamp), stamp.isoformat()) == "approved"
    assert _post_state(None, "") == "gone"


def test_approval_follows_content_changes():
    from app.api.scheduler import _after_status_change
    from app.models.models import SocialPost

    post = SocialPost(id="p", status="approved", approved_by="boss@x.com", approved_at=datetime.utcnow())
    _after_status_change(post, "approved", content_changed=True)
    assert post.status == "awaiting_approval" and post.approved_by is None

    rejected = SocialPost(id="r", status="rejected", review_note="tone")
    _after_status_change(rejected, "rejected", content_changed=True)
    assert rejected.status == "awaiting_approval"

    fresh = SocialPost(id="f", status="approved", publish_attempts=1, retry_at_ms=5.0)
    _after_status_change(fresh, "awaiting_approval", content_changed=False)
    assert fresh.approved_by == "app" and fresh.publish_attempts == 0 and fresh.retry_at_ms is None


# ── Schedules ───────────────────────────────────────────────────────────────

def _sched(**kw):
    from app.models.models import SocialSchedule

    base = dict(id="s", theme="T", focus="F", channels=["linkedin"], time="09:00", frequency="recurring",
                pattern="weekly", weekday="", start_date="2026-10-01", end_date="2026-10-31",
                month_day=None, custom_dates=[], status="active")
    base.update(kw)
    return SocialSchedule(**base)


def test_occurrences_for_each_pattern():
    from app.services.schedule_engine import occurrences

    first, last = date(2026, 10, 1), date(2026, 12, 31)
    weekly = occurrences(_sched(weekday="MO,TH"), first, last)
    assert [d.isoformat() for d in weekly[:3]] == ["2026-10-01", "2026-10-05", "2026-10-08"]
    assert all(d.weekday() in (0, 3) for d in weekly) and weekly[-1] <= date(2026, 10, 31)
    daily = occurrences(_sched(pattern="daily"), first, last)
    assert len(daily) == 31
    monthly = occurrences(_sched(pattern="monthly", month_day=31, end_date="2026-12-31"), first, last)
    assert [d.isoformat() for d in monthly] == ["2026-10-31", "2026-11-30", "2026-12-31"]
    custom = occurrences(_sched(pattern="dates", custom_dates=["2026-10-03", "2026-10-09"]), first, last)
    assert [d.isoformat() for d in custom] == ["2026-10-03", "2026-10-09"]
    once = occurrences(_sched(frequency="once", start_date="2026-11-02", end_date="2026-11-02"), first, last)
    assert once == [date(2026, 11, 2)]
    assert occurrences(_sched(frequency="now"), first, last) == []


def test_schedule_validation_and_defaults():
    from app.services.schedule_engine import add_months, clean

    today = date(2026, 9, 29)
    ok = clean({"name": "Tips", "plan": "Ops", "channels": ["LinkedIn", "twitter"], "pattern": "weekly",
                "weekdays": ["mo", "TH"], "time": "09:30"}, today)
    assert ok["channels"] == ["linkedin", "x"] and ok["weekday"] == "MO,TH"
    assert ok["end_date"] == add_months(today, 3).isoformat() == "2026-12-29"
    for bad, msg in [
        ({"name": "", "plan": "x", "channels": ["x"]}, "name"),
        ({"name": "a", "plan": "x", "channels": []}, "channel"),
        ({"name": "a", "plan": "x", "channels": ["x"], "pattern": "weekly"}, "weekdays"),
        ({"name": "a", "plan": "x", "channels": ["x"], "frequency": "once", "date": "2026-01-01"}, "passed"),
        ({"name": "a", "plan": "x", "channels": ["x"], "pattern": "daily", "endDate": "2028-01-01"}, "year"),
        ({"name": "a", "plan": "x", "channels": ["x"], "pattern": "daily", "retryCount": 9}, "3 times"),
        ({"name": "a", "plan": "x", "channels": ["x"], "pattern": "daily", "resultEmails": "nope"}, "not an email"),
    ]:
        with pytest.raises(ValueError, match=msg):
            clean(bad, today)


def test_custom_dates_can_each_have_their_own_topic():
    from app.services.schedule_engine import clean

    today = date(2026, 9, 29)
    base = {"name": "Launch week", "plan": "", "channels": ["linkedin"], "pattern": "dates",
            "customDates": ["2026-10-02", "2026-10-05"]}
    ok = clean({**base, "dateTopics": {"2026-10-02": " Onboarding checklist ", "2026-10-05": "Why spreadsheets break", "2026-12-01": "not a picked date"}}, today)
    assert ok["date_topics"] == {"2026-10-02": "Onboarding checklist", "2026-10-05": "Why spreadsheets break"}
    with pytest.raises(ValueError, match="every date a topic"):
        clean({**base, "dateTopics": {"2026-10-02": "Only one"}}, today)
    # With a brief, dates without a topic follow it.
    assert clean({**base, "plan": "Ops tips", "dateTopics": {"2026-10-02": "Only one"}}, today)["date_topics"] == {"2026-10-02": "Only one"}
    with pytest.raises(ValueError, match="what the posts should be about"):
        clean({**base, "frequency": "once", "date": "2026-10-02"}, today)


def test_repeating_schedules_can_give_each_date_its_own_topic():
    from app.services.schedule_engine import clean

    today = date(2026, 9, 29)  # a Tuesday
    base = {"name": "Mondays", "plan": "", "channels": ["x"], "pattern": "weekly", "weekdays": ["MO"],
            "endDate": "2026-10-19"}
    with pytest.raises(ValueError, match=r"every date a topic \(3 still"):
        clean(base, today)
    topics = {"2026-10-05": "Pricing", "2026-10-12": "Hiring", "2026-10-19": "Roadmap", "2026-10-06": "a Tuesday"}
    ok = clean({**base, "dateTopics": topics}, today)
    assert ok["date_topics"] == {"2026-10-05": "Pricing", "2026-10-12": "Hiring", "2026-10-19": "Roadmap"}
    # A date already past the first open day needs no topic.
    assert clean({**base, "dateTopics": {"2026-10-12": "Hiring", "2026-10-19": "Roadmap"}}, today,
                 first_day=date(2026, 10, 6))["date_topics"] == {"2026-10-12": "Hiring", "2026-10-19": "Roadmap"}
    # Previews list dates before any topic is set.
    assert clean(base, today, require_topics=False)["date_topics"] == {}


def test_add_months_clamps_to_month_end():
    from app.services.schedule_engine import add_months

    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2026, 11, 30), 3) == date(2027, 2, 28)


# ── Plan AI outline parsing ────────────────────────────────────────────────

def test_plan_rule_expands_to_dates_and_keeps_edits_as_deltas():
    from app.api.scheduler import _extract_plan_from_text

    text = 'Planned.\n```plan\n{"channels": ["linkedin"], "rule": {"weekdays": ["MO"], "time": "10:00", "start": "2026-10-01", "weeks": 3}, "themes": [{"headline": "A", "angle": "a"}, {"headline": "B", "angle": "b"}]}\n```'
    plan = _extract_plan_from_text(text, "2026-10-01", set())
    assert [p["date"] for p in plan["posts"]] == ["2026-10-05", "2026-10-12", "2026-10-19"]
    assert [p["headline"] for p in plan["posts"]] == ["A", "B", "A"]

    edit = '```plan\n{"posts": [{"id": "v2_known", "revision": "shorter"}], "delete": ["v2_old", "v2_unknown"]}\n```'
    plan = _extract_plan_from_text(edit, "2026-10-01", {"v2_known", "v2_old"})
    assert plan["posts"] == [{"id": "v2_known", "existing": True, "revision": "shorter"}]
    assert plan["deleteIds"] == ["v2_old"]


# ── Generation queue limiter ───────────────────────────────────────────────

async def test_priority_limiter_caps_and_serves_interactive_first():
    from app.services.generation_queue import PriorityLimiter

    lim = PriorityLimiter(2)
    order, active, peak = [], 0, 0

    async def job(name, prio, hold):
        nonlocal active, peak
        async with lim.slot(prio):
            active += 1
            peak = max(peak, active)
            order.append(name)
            await asyncio.sleep(hold)
            active -= 1

    first = [asyncio.create_task(job(f"bg{i}", 0, 0.05)) for i in range(2)]
    await asyncio.sleep(0.01)
    later = [asyncio.create_task(job("bg_late", 0, 0.01)), asyncio.create_task(job("chat", 10, 0.01))]
    await asyncio.gather(*first, *later)
    assert peak == 2
    assert order.index("chat") < order.index("bg_late")


# ── Custom AI endpoints ────────────────────────────────────────────────────

def test_key_optional_only_for_custom_endpoints(monkeypatch):
    from app.services.endpoints import docker_host_alternative, is_self_hosted

    assert is_self_hosted("http://localhost:11434/v1")
    assert is_self_hosted("https://llm.mycorp.com/v1")
    assert not is_self_hosted("https://api.openai.com/v1")
    assert not is_self_hosted("https://eu.api.openai.com/v1")
    assert not is_self_hosted("")
    monkeypatch.setenv("RUNNING_IN_DOCKER", "1")
    assert docker_host_alternative("http://localhost:11434/v1") == "http://host.docker.internal:11434/v1"
    assert docker_host_alternative("https://api.x.ai") is None


# ── Voices ─────────────────────────────────────────────────────────────────

def test_placeholder_text_is_never_a_voice():
    from app.services.voice_plugin_plan import _strip_voice, is_voice_placeholder, looks_like_external_voice_id

    assert is_voice_placeholder("Not configured")
    assert _strip_voice(" none ") == ""
    assert not looks_like_external_voice_id("Not configured")
    assert not looks_like_external_voice_id("sk_car_123456")
    assert not looks_like_external_voice_id("rex-uk")
    assert looks_like_external_voice_id("a0e99841-438c-4a64-b679-ae501e7d6091")


def test_engine_row_pick_matches_the_active_engine():
    from app.services.voice_plugin_plan import engine_of_conn, pick_engine_conn

    rows = [
        SimpleNamespace(id="a", group_name="Voice Orchestration", name="xAI Voice Agent", config={}),
        SimpleNamespace(id="c_telnyx_assistant_settings", group_name="Voice Orchestration", name="Telnyx", config={}),
        SimpleNamespace(id="b", group_name="Voice Orchestration", name="LiveKit (self-hosted)", config={}),
    ]
    assert engine_of_conn(rows[2]) == "livekit"
    assert pick_engine_conn(rows, "livekit").id == "b"
    assert pick_engine_conn(rows, "openai").id == "a"  # none for that engine: first real row
    assert pick_engine_conn(rows[1:2], "xai") is None


def test_voice_provider_keys_and_engine_fit():
    from app.services.voice_library import _fits, guess_provider, provider_of

    assert provider_of("Cartesia") == "cartesia"
    assert provider_of("Kokoro-82M (Self-Hosted)") == "kokoro-82m-self-hosted"
    assert guess_provider("a0e99841-438c-4a64-b679-ae501e7d6091") == "cartesia"
    assert guess_provider("Telnyx.NaturalHD.astra") == "telnyx"
    assert guess_provider("abcd1234") == "xai"
    assert _fits("livekit", "library", "cartesia")
    assert _fits("xai", "library", "cartesia")
    assert not _fits("openai", "library", "cartesia")
    assert _fits("xai", "library", "xai") and not _fits("livekit", "library", "xai")
    assert not _fits("vapi", "library", "cartesia")


# ── Find Leads map: postcodes and drawn areas ──────────────────────────────

def test_postcodes_are_normalised_and_partial_ones_rejected():
    from app.services.geocoding import norm_postcode

    assert norm_postcode("sw1a1aa") == "SW1A 1AA"
    assert norm_postcode(" RG1  1AB ") == "RG1 1AB"
    assert norm_postcode("M1") == ""
    assert norm_postcode("") == ""


def test_drawn_area_is_validated_and_matched():
    from app.services.geocoding import clean_polygon, point_in_polygon, sample_points

    square = clean_polygon([[51.40, -1.05], [51.40, -0.90], [51.50, -0.90], [51.50, -1.05]])
    assert point_in_polygon(51.45, -0.97, square)
    assert not point_in_polygon(51.55, -0.97, square)
    assert 3 < len(sample_points(square)) <= 100
    with pytest.raises(ValueError):
        clean_polygon([[51.4, -1.0], [51.5, -1.0]])
    with pytest.raises(ValueError):
        clean_polygon([[951.4, -1.0], [51.5, -1.0], [51.5, -0.9]])
    with pytest.raises(ValueError):  # roughly the whole of England
        sample_points(clean_polygon([[50.0, -4.0], [50.0, 1.0], [55.0, 1.0], [55.0, -4.0]]))


def test_outcodes_come_from_the_reverse_lookup(monkeypatch):
    from app.services import geocoding

    async def fake_post(path, payload):
        assert path == "/postcodes" and payload["geolocations"]
        return {"result": [{"result": [{"outcode": "rg1"}, {"outcode": "RG30"}]}, {"result": None}, {"result": [{"outcode": "RG1"}]}]}

    monkeypatch.setattr(geocoding, "_post", fake_post)
    poly = geocoding.clean_polygon([[51.40, -1.05], [51.40, -0.90], [51.50, -0.90], [51.50, -1.05]])
    assert asyncio.run(geocoding.outcodes_for_area(poly)) == ["RG1", "RG30"]
