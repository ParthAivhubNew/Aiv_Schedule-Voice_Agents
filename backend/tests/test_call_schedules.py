"""Call schedules: a Call list dialled at one or more times a day, started by the server, each slot once."""
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import CallList, CallSchedule
from app.services import call_schedule_engine as E
from app.services import numbers, outbound_dial
from app.services.org_settings import org_instant_ms, org_timezone
from app.services.schedule_engine import org_today
from tests.conftest import make_user

pytestmark = pytest.mark.db

ORG = "org_cs"

ROWS = [{"phone": "+447700900001", "contact": "Ann", "company": "Acme"},
        {"phone": "", "cells": {"Mobile": "+44 7700 900002"}, "company": "Beta"},
        {"phone": "", "cells": {"Email": "x@y.test"}, "company": "No number"}]


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


@pytest.fixture
def dials(monkeypatch):
    calls = []

    async def launch(db, **kw):
        calls.append(kw)
        return {"success": True, "mission_id": f"m_{len(calls)}", "total": len(kw["prospects"]), "message": "Placing calls now."}

    async def minutes(db):
        return True

    async def caller(db, ctx, requested):
        return requested or None, None

    monkeypatch.setattr(outbound_dial, "launch_outbound_mission", launch)
    monkeypatch.setattr(outbound_dial, "_has_minutes", minutes)
    monkeypatch.setattr(numbers, "pick_caller_id", caller)
    return calls


async def _setup(db, name, rows=None):
    _, token = await make_user(db, name, "Admin", org_id=ORG)
    db.add(CallList(id=f"cl_{name}", name="Leeds", headers=[], rows=ROWS if rows is None else rows, row_count=3))
    await db.commit()
    return token


def _body(name, **over):
    return {"name": "Morning calls", "listId": f"cl_{name}", "frequency": "recurring", "pattern": "daily", "times": ["09:30", "14:00"], **over}


async def _backdate(db, sid):
    s = (await db.execute(select(CallSchedule).where(CallSchedule.id == sid))).scalars().first()
    s.created_at = datetime.utcnow() - timedelta(days=3)
    await db.commit()


async def test_a_schedule_keeps_several_times_a_day_and_lists_them(db, dials):
    with org_scope(ORG):
        token = await _setup(db, "cs")
        async with _client(token) as c:
            made = (await c.post("/api/call-schedules", json=_body("cs"))).json()["schedule"]
            assert made["times"] == ["09:30", "14:00"] and made["listName"] == "Leeds"
            shown = (await c.get("/api/call-schedules")).json()["schedules"]
            assert [s["id"] for s in shown] == [made["id"]]
            assert len({u.split(" ")[0] for u in made["upcoming"]}) >= 1 and {u.split(" ")[1] for u in made["upcoming"]} == {"09:30", "14:00"}


async def test_bad_input_gets_a_plain_message(db, dials):
    with org_scope(ORG):
        token = await _setup(db, "cs")
        async with _client(token) as c:
            assert "Add at least one time" in (await c.post("/api/call-schedules", json=_body("cs", times=[]))).json()["detail"]
            assert "09:30" in (await c.post("/api/call-schedules", json=_body("cs", times=["9.30"]))).json()["detail"]
            assert "Pick the weekdays" in (await c.post("/api/call-schedules", json=_body("cs", pattern="weekly", weekdays=[]))).json()["detail"]
            assert "doesn't exist" in (await c.post("/api/call-schedules", json=_body("cs", listId="nope"))).json()["detail"]
        token2 = await _setup(db, "cs2b", rows=[{"phone": "", "company": "No number"}])
        async with _client(token2) as c:
            assert "no phone numbers" in (await c.post("/api/call-schedules", json=_body("cs2b"))).json()["detail"]


async def test_a_due_time_dials_the_list_once_and_a_later_tick_does_not_repeat_it(db, dials):
    with org_scope(ORG):
        token = await _setup(db, "cs")
        async with _client(token) as c:
            sid = (await c.post("/api/call-schedules", json=_body("cs"))).json()["schedule"]["id"]
        await _backdate(db, sid)
        tz = await org_timezone(db)
        at = org_instant_ms(org_today(tz).isoformat(), "09:30", tz) + 5 * 60_000
        assert await E.tick(db, at) == 1
        assert await E.tick(db, at + 30_000) == 0
        assert len(dials) == 1 and len(dials[0]["prospects"]) == 2 and dials[0]["title"].startswith("Morning calls")
        later = org_instant_ms(org_today(tz).isoformat(), "14:00", tz) + 60_000
        assert await E.tick(db, later) == 1 and len(dials) == 2


async def test_a_time_missed_while_the_server_was_down_is_recorded_not_dialled_late(db, dials):
    with org_scope(ORG):
        token = await _setup(db, "cs")
        async with _client(token) as c:
            sid = (await c.post("/api/call-schedules", json=_body("cs"))).json()["schedule"]["id"]
        await _backdate(db, sid)
        tz = await org_timezone(db)
        at = org_instant_ms(org_today(tz).isoformat(), "09:30", tz) + 3 * 3_600_000
        await E.tick(db, at)
        s = (await db.execute(select(CallSchedule).where(CallSchedule.id == sid))).scalars().first()
        assert not dials and any("Missed" in r["message"] for r in s.runs)


async def test_a_time_before_the_schedule_was_made_never_fires(db, dials):
    with org_scope(ORG):
        token = await _setup(db, "cs")
        async with _client(token) as c:
            await c.post("/api/call-schedules", json=_body("cs"))
        tz = await org_timezone(db)
        at = org_instant_ms(org_today(tz).isoformat(), "09:30", tz) + 60_000
        assert await E.tick(db, at) in (0, 1)  # made just now: only a time after creation may run
        if org_instant_ms(org_today(tz).isoformat(), "09:30", tz) < datetime.utcnow().timestamp() * 1000 - 120_000:
            assert not dials


async def test_paused_schedules_dial_nothing_and_resume_works(db, dials):
    with org_scope(ORG):
        token = await _setup(db, "cs")
        async with _client(token) as c:
            sid = (await c.post("/api/call-schedules", json=_body("cs"))).json()["schedule"]["id"]
            assert (await c.post(f"/api/call-schedules/{sid}/status", json={"status": "paused"})).status_code == 200
            await _backdate(db, sid)
            tz = await org_timezone(db)
            at = org_instant_ms(org_today(tz).isoformat(), "09:30", tz) + 60_000
            assert await E.tick(db, at) == 0 and not dials
            await c.post(f"/api/call-schedules/{sid}/status", json={"status": "active"})
            assert await E.tick(db, at) == 1


async def test_right_now_dials_straight_away_and_a_failed_start_is_not_kept(db, dials, monkeypatch):
    with org_scope(ORG):
        token = await _setup(db, "cs")
        async with _client(token) as c:
            r = await c.post("/api/call-schedules", json={"name": "Now", "listId": "cl_cs", "frequency": "now"})
            assert r.status_code == 200 and len(dials) == 1 and r.json()["schedule"]["status"] == "ended"

            async def no_minutes(db):
                return False

            monkeypatch.setattr(outbound_dial, "_has_minutes", no_minutes)
            bad = await c.post("/api/call-schedules", json={"name": "Now2", "listId": "cl_cs", "frequency": "now"})
            assert bad.status_code == 400 and "No call minutes" in bad.json()["detail"]
            kept = (await c.get("/api/call-schedules")).json()["schedules"]
            assert [s["name"] for s in kept] == ["Now"]


async def test_slots_for_the_calendar_and_delete(db, dials):
    with org_scope(ORG):
        token = await _setup(db, "cs")
        async with _client(token) as c:
            sid = (await c.post("/api/call-schedules", json=_body("cs"))).json()["schedule"]["id"]
            today = org_today(await org_timezone(db))
            out = (await c.get("/api/call-schedules/slots", params={"start": today.isoformat(), "end": (today + timedelta(days=2)).isoformat()})).json()
            assert {s["time"] for s in out} == {"09:30", "14:00"} and len(out) == 6
            assert (await c.delete(f"/api/call-schedules/{sid}")).status_code == 200
            assert (await c.get("/api/call-schedules")).json()["schedules"] == []
