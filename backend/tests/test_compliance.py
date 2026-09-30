"""Call gate before every outbound dial: opt-outs and call hours in the callee's time."""
from datetime import datetime

import pytest

pytestmark = pytest.mark.db


async def _profile(db, policy="respectful"):
    from app.models.models import CompanyProfile

    db.add(CompanyProfile(id="default", name="Acme", pitch="x", timezone="Europe/London", call_hours_policy=policy,
                          weekday_start="09:00", weekday_end="17:30", lunch_start="12:00", lunch_end="13:00"))
    await db.commit()


async def _mode(db, mode):
    from app.models.models import AppSetting

    db.add(AppSetting(id="compliance", data={"mode": mode}))
    await db.commit()


async def test_opted_out_number_is_always_refused(db):
    from app.models.models import ContactRegistry
    from app.services.compliance import check_call_allowed

    await _profile(db)
    await _mode(db, "off")
    db.add(ContactRegistry(id="r1", canonical_name="X", phones=["+44 7700 900123"], do_not_call=True))
    await db.commit()
    gate = await check_call_allowed(db, "07700900123", now_utc=datetime(2026, 10, 6, 10, 0))
    assert not gate.allowed and "opted out" in gate.reasons[0]


async def test_hours_block_mode(db):
    from app.services.compliance import check_call_allowed

    await _profile(db)
    await _mode(db, "block")
    # Tuesday 06 Oct 2026, 10:00 UTC = 11:00 London (BST): fine
    assert (await check_call_allowed(db, "+447700900123", now_utc=datetime(2026, 10, 6, 10, 0))).allowed
    # 11:30 UTC = 12:30 London: lunch
    g = await check_call_allowed(db, "+447700900123", now_utc=datetime(2026, 10, 6, 11, 30))
    assert not g.allowed and "lunch" in g.reasons[0]
    # 19:00 UTC = 20:00 London: after hours
    assert not (await check_call_allowed(db, "+447700900123", now_utc=datetime(2026, 10, 6, 19, 0))).allowed
    # Saturday
    assert not (await check_call_allowed(db, "+447700900123", now_utc=datetime(2026, 10, 10, 10, 0))).allowed


async def test_hours_use_the_callee_timezone(db):
    from app.services.compliance import check_call_allowed

    await _profile(db)
    await _mode(db, "block")
    # 15:00 UTC is 16:00 in London (ok) but 11:00 in New York (ok) / 08:00 in LA (too early)
    assert (await check_call_allowed(db, "+12125550100", now_utc=datetime(2026, 10, 6, 15, 0))).allowed
    g = await check_call_allowed(db, "+13105550100", now_utc=datetime(2026, 10, 6, 15, 0))
    assert g.callee_timezone.startswith("America/")


async def test_warn_mode_lets_the_call_through_with_a_warning(db):
    from app.services.compliance import check_call_allowed

    await _profile(db)
    await _mode(db, "warn")
    g = await check_call_allowed(db, "+447700900123", now_utc=datetime(2026, 10, 6, 21, 0))
    assert g.allowed and g.warnings


async def test_legal_policy_allows_weekends_until_nine(db):
    from app.services.compliance import check_call_allowed

    await _profile(db, policy="legal")
    await _mode(db, "block")
    assert (await check_call_allowed(db, "+447700900123", now_utc=datetime(2026, 10, 10, 18, 0))).allowed  # Sat 19:00
    assert not (await check_call_allowed(db, "+447700900123", now_utc=datetime(2026, 10, 10, 20, 30))).allowed  # 21:30
