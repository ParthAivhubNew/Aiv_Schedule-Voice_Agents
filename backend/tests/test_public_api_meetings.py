"""Phase 6: meetings through the public API (open times, book, list, cancel, move), on the app's own calendar."""
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy.future import select

pytestmark = pytest.mark.db


def _http(token):
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def _next_tuesday(weeks=1) -> str:
    d = date.today() + timedelta(days=7 * weeks)
    return (d + timedelta(days=(1 - d.weekday()) % 7)).isoformat()


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    """No real emails go out."""
    from app.public_api import core
    from app.services.calendar_service import calendar_service

    core._WINDOWS.clear()

    async def no_mail(*a, **k):
        return {"ok": True, "from": "host@test", "to": "x"}

    monkeypatch.setattr(calendar_service, "send_outbound_email", no_mail)
    yield
    core._WINDOWS.clear()


async def _key(admin_token, scopes=("calendar:book",), live=True):
    async with _http(admin_token) as c:
        r = await c.post("/api/developer/keys", json={"name": "Meetings key", "scopes": list(scopes), "live": live})
    assert r.status_code == 200, r.text
    return r.json()["secret"]


async def test_open_times_for_a_few_days(db, admin_token):
    key = await _key(admin_token)
    day = _next_tuesday()
    async with _http(key) as c:
        r = await c.get(f"/v1/meetings/slots?date={day}&days=3")
        assert r.status_code == 200, r.text
        body = r.json()
        assert [d["date"] for d in body["data"]][0] == day and len(body["data"]) == 3
        first = body["data"][0]["slots"]
        assert first and all(set(s) == {"time", "their_time"} for s in first)
        assert (await c.get("/v1/meetings/slots?date=tomorrow")).json()["error"]["code"] == "invalid_date"
        assert (await c.get(f"/v1/meetings/slots?date={day}&days=30")).status_code == 422


async def test_book_list_move_and_cancel(db, admin_token, monkeypatch):
    from app.services import webhook_dispatcher as W

    sent = []
    monkeypatch.setattr(W, "dispatch_event", lambda org, event, data, test=False: sent.append((event, data)))
    key = await _key(admin_token)
    day = _next_tuesday()
    async with _http(key) as c:
        slots = (await c.get(f"/v1/meetings/slots?date={day}")).json()["data"][0]["slots"]
        t1, t2 = slots[0]["time"], slots[1]["time"]
        r = await c.post("/v1/meetings", json={"name": "Jo Bloggs", "email": "jo@bloggs.test", "date": day, "time": t1, "notes": "Demo"})
        assert r.status_code == 201, r.text
        m = r.json()
        assert m["name"] == "Jo Bloggs" and m["status"] == "scheduled" and m["booked_by"] == "api" and m["date"] == day and m["time"] == t1
        assert m["starts_at"].endswith("Z") and m["duration_minutes"] == 15 and m["video_link"]
        taken = await c.post("/v1/meetings", json={"name": "Sam", "email": "sam@x.test", "date": day, "time": t1})
        assert taken.status_code == 409 and taken.json()["error"]["code"] == "slot_unavailable"
        assert t2 in taken.json()["error"]["details"]["available_times"]  # it says what is free instead
        assert (await c.post("/v1/meetings", json={"name": "S", "email": "nope", "date": day, "time": t2})).json()["error"]["code"] == "invalid_email"
        assert (await c.post("/v1/meetings", json={"name": "S", "email": "s@x.test", "date": day, "time": "25:00"})).json()["error"]["code"] == "invalid_time"

        listed = (await c.get("/v1/meetings")).json()
        assert [x["id"] for x in listed["data"]] == [m["id"]] and listed["next_cursor"] is None
        assert (await c.get("/v1/meetings?booked_by=ai_call")).json()["data"] == []
        assert [x["id"] for x in (await c.get("/v1/meetings?when=upcoming")).json()["data"]] == [m["id"]]
        assert (await c.get("/v1/meetings?when=past")).json()["data"] == []

        moved = (await c.patch(f"/v1/meetings/{m['id']}", json={"action": "reschedule", "date": day, "time": t2, "reason": "Asked to move"})).json()
        assert moved["time"] == t2 and moved["status"] == "scheduled"
        busy = await c.patch(f"/v1/meetings/{m['id']}", json={"action": "reschedule", "date": day, "time": "03:00"})
        assert busy.status_code == 409 and busy.json()["error"]["code"] == "slot_unavailable"
        assert (await c.patch(f"/v1/meetings/{m['id']}", json={"action": "reschedule"})).json()["error"]["code"] == "invalid_request"

        gone = (await c.patch(f"/v1/meetings/{m['id']}", json={"action": "cancel", "reason": "No longer needed"})).json()
        assert gone["status"] == "cancelled" and gone["cancellation_reason"] == "No longer needed"
        assert (await c.patch(f"/v1/meetings/{m['id']}", json={"action": "cancel"})).json()["status"] == "cancelled"  # asking twice is fine
        again = await c.patch(f"/v1/meetings/{m['id']}", json={"action": "reschedule", "date": day, "time": t1})
        assert again.status_code == 409 and again.json()["error"]["code"] == "cancelled"
        assert (await c.get(f"/v1/meetings/{m['id']}")).json()["status"] == "cancelled"
        assert (await c.get("/v1/meetings/mtg_missing")).status_code == 404
    assert [e for e, _ in sent] == ["meeting.booked"] and sent[0][1]["meeting"]["id"] == m["id"]


async def test_a_meeting_the_ai_booked_on_a_call_shows_up_and_is_announced(db, admin_token):
    from app.models.models import Meeting

    key = await _key(admin_token)
    db.add(Meeting(id="mtg_ai", prospect="Pat Prospect", mission="Cold outreach", date="2030-01-15", time="10:00", channel="voice",
                   status="upcoming", attendee_email="pat@x.test"))
    await db.commit()
    async with _http(key) as c:
        got = (await c.get("/v1/meetings?booked_by=ai_call")).json()["data"]
        assert [m["id"] for m in got] == ["mtg_ai"] and got[0]["booked_by"] == "ai_call" and got[0]["status"] == "scheduled"


async def test_meetings_need_the_calendar_scope(db, admin_token):
    key = await _key(admin_token, ("wallets:read",))
    async with _http(key) as c:
        r = await c.get(f"/v1/meetings/slots?date={_next_tuesday()}")
        assert r.status_code == 403 and r.json()["error"]["code"] == "missing_scope"


async def test_test_keys_book_pretend_meetings(db, admin_token, monkeypatch):
    from app.models.models import Meeting
    from app.services import webhook_dispatcher as W

    sent = []
    monkeypatch.setattr(W, "dispatch_event", lambda org, event, data, test=False: sent.append((event, test)))
    key = await _key(admin_token, live=False)
    day = _next_tuesday()
    async with _http(key) as c:
        slots = (await c.get(f"/v1/meetings/slots?date={day}")).json()
        assert slots["test"] is True and slots["data"][0]["slots"]
        m = (await c.post("/v1/meetings", json={"name": "Jo", "email": "jo@x.test", "date": day, "time": "09:00"})).json()
        assert m["id"].startswith("mtg_test_") and m["status"] == "scheduled" and m["test"] is True
        assert (await c.patch(f"/v1/meetings/{m['id']}", json={"action": "reschedule", "date": day, "time": "10:30"})).json()["time"] == "10:30"
        assert (await c.patch(f"/v1/meetings/{m['id']}", json={"action": "cancel"})).json()["status"] == "cancelled"
        assert len((await c.get("/v1/meetings")).json()["data"]) == 1
    assert sent == [("meeting.booked", True)]
    db.expire_all()
    assert (await db.execute(select(Meeting))).scalars().all() == []
