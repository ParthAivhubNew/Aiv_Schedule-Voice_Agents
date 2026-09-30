"""Analytics tab: real counts, previous-period change, and admin-only until shared."""
from datetime import datetime, timedelta

import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


def _log(i, outcome, days_ago, mission="Spring", duration="2:30"):
    from app.models.models import CallLog

    t = datetime.utcnow() - timedelta(days=days_ago, hours=1)
    return CallLog(id=f"cl_{i}", canonical_name=f"P{i}", listed_as=f"P{i}", started_at="", ended_at="",
                   duration=duration, outcome=outcome, mission=mission, created_at=t)


async def test_overview_counts_real_calls(client, db):
    rows = [
        _log(1, "meeting_booked", 1), _log(2, "contacted", 2), _log(3, "no_answer", 3),
        _log(4, "callback_requested", 4, mission=""), _log(5, "no_answer", 40), _log(6, "meeting_booked", 45),
    ]
    db.add_all(rows)
    await db.commit()
    r = await client.get("/api/analytics/overview?days=30")
    assert r.status_code == 200, r.text
    d = r.json()
    cur, prev = d["current"], d["previous"]
    assert cur["calls"] == 4 and cur["connected"] == 3 and cur["booked"] == 1 and cur["callbacks"] == 1
    assert cur["connectRate"] == 75.0 and cur["bookingRate"] == 33.3
    assert cur["talkMinutes"] == 7.5
    assert prev["calls"] == 2 and prev["booked"] == 1
    assert len(d["trend"]) == 31 and sum(x["calls"] for x in d["trend"]) == 4
    assert {o["key"] for o in d["outcomes"]} == {"meeting_booked", "contacted", "no_answer", "callback_requested"}
    names = {c["name"] for c in d["campaigns"]}
    assert names == {"Spring", "Direct calls"}
    assert sum(h["calls"] for h in d["heatmap"]) == 4


async def test_overview_is_admin_only_until_shared(client, anon, db):
    op, tok = await make_user(db, "mgr", "Manager")
    h = {"Authorization": f"Bearer {tok}"}
    assert (await anon.get("/api/analytics/overview", headers=h)).status_code == 403
    await client.put("/api/auth/share", json={"section": "analytics", "user_levels": {op.id: "view"}})
    assert (await anon.get("/api/analytics/overview", headers=h)).status_code == 200
    # The plugin hub usage cards stay visible to everyone signed in.
    assert (await anon.get("/api/analytics/usage", headers=h)).status_code == 200
