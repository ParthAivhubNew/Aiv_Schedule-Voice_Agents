"""A company sees its credits month by month; staff see the margin per app and a monthly check
of call minutes against Telnyx's, with gaps flagged."""
from datetime import datetime

import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


async def test_admins_see_a_month_of_usage_operators_do_not(client, db):
    from app.services import credits as K

    await K.add_credits(db, "voice", 100, source="topup")
    await K.add_credits(db, "scheduler", 50, source="topup")
    await K.charge(db, "voice_minute", 3, "call:cl_1", "Call with Ann")
    await K.charge(db, "voice_minute", 2, "call:cl_2", "Call with Bob")
    await K.charge(db, "ai_post", 1, "post:p1", "AI post")
    await db.commit()
    month = f"{datetime.utcnow():%Y-%m}"

    u = (await client.get(f"/api/credits/usage?month={month}")).json()
    assert u["totals"] == {"used": 7, "added": 150, "expired": 0, "adjusted": 0}
    assert [(i["item"], i["units"], i["credits"]) for i in u["items"]] == [("voice_minute", 5, 5), ("ai_post", 1, 2)]
    assert u["days"][0]["credits"] == 7 and len(u["entries"]) == 5
    only_voice = (await client.get(f"/api/credits/usage?month={month}&wallet=voice")).json()
    assert only_voice["totals"]["used"] == 5
    assert (await client.get("/api/credits/usage?month=2026-13")).status_code == 400
    assert (await client.get("/api/credits/usage?month=2001-01")).json()["entries"] == []

    _, tok = await make_user(db, "olly", "Operator")
    import httpx

    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                 headers={"Authorization": f"Bearer {tok}"}) as c:
        assert (await c.get(f"/api/credits/usage?month={month}")).status_code == 403


async def test_revenue_shows_the_margin_per_app(staff, db):
    from app.services import credits as K
    from app.services import revenue as R

    await R.set_unit_costs(db, "gbp", {"voice_minute": 2})
    await K.add_credits(db, "voice", 100, source="topup", paid_cents=1000, paid_currency="gbp")
    await K.add_credits(db, "voice", 30, source="given")
    await K.charge(db, "voice_minute", 10, "call:cl_1")
    await db.commit()
    rep = (await staff.get(f"/api/admin-api/revenue?month={datetime.utcnow():%Y-%m}&include_aivhub=true")).json()
    voice = next(a for a in rep["apps"] if a["wallet"] == "voice")
    assert (voice["paid"], voice["credits"], voice["given"], voice["costCents"], voice["marginCents"]) == ({"gbp": 1000}, 10, 30, 20, 980)


async def test_monthly_voice_check_flags_gaps_once_and_keeps_the_result(staff, db, monkeypatch):
    from app.services import ai_errors
    from app.services import telnyx_usage as U

    def row(org, ours, theirs):
        return {"orgId": org, "name": org.title(), "billingGroupId": "bg", "minutesBilled": ours, "telnyxMinutes": theirs,
                "telnyxCost": 1.0, "telnyxCurrency": "usd", "paid": 5.0, "paidCurrency": "gbp", "margin": None, "marginPct": None}

    async def report(month):
        return {"month": month, "rows": [row("org_ok", 100, 103), row("org_gap", 100, 140)], "unattributed": [], "errors": []}

    alerts = []

    async def alert(code, detail, *, ref="", org_id=None):
        alerts.append((code, org_id))

    monkeypatch.setattr(U, "margin_report", report)
    monkeypatch.setattr(ai_errors, "alert_staff", alert)
    monkeypatch.setattr(U, "platform_key", lambda: "KEY")
    monkeypatch.setattr("app.services.telnyx_client.platform_key", lambda: "KEY")
    assert U.previous_month(datetime(2026, 1, 5)) == "2025-12" and U.previous_month(datetime(2026, 10, 2)) == "2026-09"

    assert (await staff.get("/api/admin-api/voice-reconciliation?month=2026-09")).json()["result"] is None
    monkeypatch.setattr(U, "previous_month", lambda now=None: "2026-09")
    monkeypatch.setattr(U, "RECON_FROM_DAY", 1)
    assert await U.reconcile_due() == "2026-09"
    assert await U.reconcile_due() is None  # once a month
    assert alerts == [("BILL-01", "org_gap")]

    saved = (await staff.get("/api/admin-api/voice-reconciliation?month=2026-09")).json()["result"]
    assert saved["flagged"] == 1 and [r["gapMinutes"] for r in saved["rows"]] == [3, 40]
    r = await staff.post("/api/admin-api/voice-reconciliation/run?month=2026-09")
    assert r.status_code == 200 and len(alerts) == 2  # staff can check again
