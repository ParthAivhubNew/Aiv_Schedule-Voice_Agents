"""How long personal data and supplier logs are kept (plan 11, C.4; services/data_retention.py)."""
import os
import time
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

from app.services import data_retention as DR

NOW = datetime.utcnow()
OLD = NOW - timedelta(days=500)
MID = NOW - timedelta(days=120)


async def _seed(db, tmp_path, monkeypatch):
    from app.core.tenancy import org_scope, system_scope
    from app.models.models import ApolloCall, ProviderCallLog, TavilyCall

    monkeypatch.setattr(DR, "recordings_folder", lambda: str(tmp_path))
    (tmp_path / "browser").mkdir()
    for name, age_days in (("old_call.wav", 200), ("new_call.mp3", 10), ("notes.txt", 400)):
        p = tmp_path / name
        p.write_bytes(b"x")
        t = time.time() - age_days * 86400
        os.utime(p, (t, t))
    (tmp_path / "browser" / "old.mp3").write_bytes(b"x")  # browser-call audio: its own delete date, never touched here
    os.utime(tmp_path / "browser" / "old.mp3", (time.time() - 400 * 86400,) * 2)
    with system_scope():
        db.add_all([TavilyCall(id="t_old", at=OLD), TavilyCall(id="t_new", at=NOW), ApolloCall(id="a_old", at=OLD),
                    ProviderCallLog(id="g_first", provider="tavily", at=OLD - timedelta(days=30)),  # the switch to the wrapper: always kept
                    ProviderCallLog(id="g_old", provider="tavily", at=OLD), ProviderCallLog(id="g_new", provider="tavily", at=NOW)])
        await db.commit()
    with org_scope("org_r"):
        await db.execute(text("INSERT INTO enrichment_attempts (org_id, id, query, provider, found_email, cost_usd, latency_ms, hit, created_at) VALUES "
                              "('org_r', 'e_old', 'Ann Lee @ acme.co.uk', 'hunter', 'ann@acme.co.uk', 0.03, 1, TRUE, :o), "
                              "('org_r', 'e_mid', 'Bo Lee @ acme.co.uk', 'hunter', 'bo@acme.co.uk', 0.03, 1, TRUE, :m), "
                              "('org_r', 'e_new', 'Cy Lee @ acme.co.uk', 'hunter', '', 0.0, 1, FALSE, :n)"), {"o": OLD, "m": MID, "n": NOW})
        await db.execute(text("INSERT INTO number_checks (org_id, id, phone, status, checked_at) VALUES ('org_r', 'n_old', '+44', 'good', :o), "
                              "('org_r', 'n_new', '+44', 'good', :n)"), {"o": OLD, "n": NOW})
        await db.commit()


@pytest.mark.db
async def test_nothing_is_deleted_until_retention_is_switched_on_but_the_dry_run_shows_what_would_go(db, tmp_path, monkeypatch):
    from app.core.tenancy import system_scope

    await _seed(db, tmp_path, monkeypatch)
    with system_scope():
        out = await DR.overview(db)
        assert out["on"] is False
        due = {r["id"]: r["dueNow"] for r in out["rules"]}
        assert due == {"call_recordings": 1, "finder_searches": 2, "supplier_logs": 4, "number_checks": 1}
        assert (await DR.run(db)) == {"ran": False}
    assert (tmp_path / "old_call.wav").exists()


@pytest.mark.db
async def test_when_on_each_rule_removes_only_what_is_past_its_period(db, tmp_path, monkeypatch):
    from app.core.tenancy import system_scope

    await _seed(db, tmp_path, monkeypatch)
    with system_scope():
        await DR.save(db, on=True, days={})
        await db.commit()
        out = await DR.run(db)
        await db.commit()
    assert out["ran"] is True and out["done"] == {"call_recordings": 1, "finder_searches": 2, "supplier_logs": 4, "number_checks": 1}
    assert not (tmp_path / "old_call.wav").exists() and (tmp_path / "new_call.mp3").exists()
    assert (tmp_path / "notes.txt").exists() and (tmp_path / "browser" / "old.mp3").exists()  # not audio / not this rule's folder
    with system_scope():
        q = lambda sql: db.execute(text(sql))  # noqa: E731
        assert {r[0] for r in (await q("SELECT id FROM tavily_calls")).all()} == {"t_new"}
        assert (await q("SELECT count(*) FROM apollo_calls")).scalar() == 0
        assert {r[0] for r in (await q("SELECT id FROM provider_call_log")).all()} == {"g_first", "g_new"}  # the switch stays
        rows = {r[0]: (r[1], r[2]) for r in (await q("SELECT id, query, found_email FROM enrichment_attempts")).all()}
        assert rows == {"e_mid": ("", ""), "e_new": ("Cy Lee @ acme.co.uk", "")}  # the old row deleted, the 120-day one blanked
        assert {r[0] for r in (await q("SELECT id FROM number_checks")).all()} == {"n_new"}


@pytest.mark.db
async def test_periods_can_be_changed_within_limits(db):
    from app.core.tenancy import system_scope

    with system_scope():
        doc = await DR.save(db, on=False, days={"call_recordings": 5, "supplier_logs": 99999})
        assert DR.days_of(doc) == {"call_recordings": 30, "finder_searches": 90, "supplier_logs": 3650, "number_checks": 396}
        with pytest.raises(ValueError):
            await DR.save(db, on=False, days={"everything": 1})


@pytest.mark.db
async def test_only_staff_admins_change_it_and_a_run_needs_it_switched_on(db, staff):
    r = await staff.get("/api/admin-api/retention")
    assert r.status_code == 200 and r.json()["on"] is False and "rawRegister" in r.json()
    assert (await staff.post("/api/admin-api/retention/run")).status_code == 409
    r = await staff.put("/api/admin-api/retention", json={"on": True, "days": {"call_recordings": 60}})
    assert r.status_code == 200 and r.json()["on"] is True
    assert next(x for x in r.json()["rules"] if x["id"] == "call_recordings")["days"] == 60
    r = await staff.post("/api/admin-api/retention/run")
    assert r.status_code == 200 and r.json()["ran"] is True
    from app.core.tenancy import system_scope

    await db.commit()  # a new transaction, so the system scope applies to the read
    with system_scope():
        log = (await db.execute(text("SELECT action FROM audit_log WHERE action LIKE 'retention.%' ORDER BY created_at"))).all()
    assert [a[0] for a in log] == ["retention.saved", "retention.run"]
