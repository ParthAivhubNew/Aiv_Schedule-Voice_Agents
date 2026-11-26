"""The same staff alert again, while the last one is unseen, updates that one instead of adding a row (plan 13). A restart used to add
an identical config-check alert (CFG-01) every time, until the banner said "36 alerts need a look" about one thing."""
import pytest

pytestmark = pytest.mark.db


async def test_a_repeated_alert_is_counted_not_added(db, monkeypatch):
    from app.services import ai_errors

    async def no_email(*a, **k):
        return None

    monkeypatch.setattr(ai_errors, "_email_staff", no_email)

    for _ in range(3):
        await ai_errors.alert_staff("CFG-01", "block: stripe_test; warn: staff_email", org_id="platform")
    items = await ai_errors.alerts(db)
    assert len(items) == 1
    one = items[0]
    assert one["count"] == 3 and one["first_at"] <= one["at"] and not one["seen"]

    # Something different is its own row, on top.
    await ai_errors.alert_staff("CFG-01", "warn: staff_email", org_id="platform")
    db.expire_all()
    items = await ai_errors.alerts(db)
    assert [a["detail"] for a in items] == ["warn: staff_email", "block: stripe_test; warn: staff_email"]

    # A new reference is a new incident: never merged into the last one.
    await ai_errors.alert_staff("AI-99", "KeyError", ref="ERR-1", org_id="acme")
    await ai_errors.alert_staff("AI-99", "KeyError", ref="ERR-2", org_id="acme")
    db.expire_all()
    assert len([a for a in await ai_errors.alerts(db) if a["code"] == "AI-99"]) == 2

    # Once dismissed, the same alert again starts a fresh row.
    first = next(a for a in await ai_errors.alerts(db) if a["detail"].startswith("block"))
    await ai_errors.dismiss(db, first["id"])
    await db.commit()
    await ai_errors.alert_staff("CFG-01", "block: stripe_test; warn: staff_email", org_id="platform")
    db.expire_all()
    rows = [a for a in await ai_errors.alerts(db) if a["detail"].startswith("block")]
    assert len(rows) == 2 and rows[0]["id"] != first["id"] and not rows[0].get("count")
