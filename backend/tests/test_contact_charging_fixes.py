"""Company contact lookups: a paid result is kept only when its charge went through, a repeat is not charged twice, a miss is remembered for a day,
and hidden contacts stay hidden."""
import gc
from datetime import datetime

import httpx
import pytest
from sqlalchemy import func, select

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import BusinessRecord, ContactReveal, CreditEntry
from app.services import business_records as BR, contact_points as CP, credits as K, reveals as RV
from tests.conftest import make_user
from tests.test_find_leads_ranking import _row


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def _biz(db, number, name, **extra):
    await BR.bulk_upsert(db, source_id="ds_ch", rows=[_row(number, name, "01/01/2015", **extra)])
    await db.commit()
    return (await db.execute(select(BusinessRecord).where(BusinessRecord.registration_number == number))).scalars().first()


async def _fund(db, org, amount=50):
    with org_scope(org):
        await K.add_credits(db, "leadgen", amount, source="grant", note="t")
        await db.commit()


async def _usage(db, org, ref):
    with org_scope(org):
        return await _count(db, ref)


async def _count(db, ref):
    return (await db.execute(select(func.count(CreditEntry.id)).where(CreditEntry.kind == "usage", CreditEntry.ref == ref))).scalar() or 0


# ── charge first, keep only what was paid for ───────────────────────────────
@pytest.mark.db
async def test_a_find_whose_charge_fails_keeps_nothing_and_says_so(db, monkeypatch):
    biz = await _biz(db, "CC1", "Charge Fail Ltd")
    biz_id = biz.id

    async def fake_web(_db, b, refresh=False, want="all", hint=""):
        found = {"found": True, "cached": False, "website": "chargefail.co.uk", "phones": [], "emails": [], "team": [], "guardrail": True}
        b.raw_data = {**(b.raw_data or {}), "contacts_web": found}
        return found

    async def broken(*a, **k):
        raise RuntimeError("ledger down")

    monkeypatch.setattr("app.services.company_contacts.web_contacts", fake_web)
    monkeypatch.setattr("app.services.credits.charge", broken)
    _, token = await make_user(db, "cc1", "Admin", org_id="org_cc1")
    await _fund(db, "org_cc1")
    async with _client(token) as c:
        r = await c.post(f"/api/leads/companies/{biz_id}/find-website")
        assert r.status_code == 502, r.text
    row = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == biz_id))).scalars().first()
    await db.refresh(row)
    assert not (row.raw_data or {}).get("contacts_web")  # the found site was rolled back with the failed charge


@pytest.mark.db
async def test_a_contacts_double_click_is_charged_once(db, monkeypatch):
    biz = await _biz(db, "CC2", "Double Click Ltd")
    biz_id = biz.id

    async def fake_web(_db, b, refresh=False, want="all", hint=""):
        found = {"found": True, "cached": False, "website": "dc.co.uk", "phones": [], "emails": [], "team": [], "guardrail": True}
        b.raw_data = {**(b.raw_data or {}), "contacts_web": found}
        return found

    monkeypatch.setattr("app.services.company_contacts.web_contacts", fake_web)
    _, token = await make_user(db, "cc2", "Admin", org_id="org_cc2")
    await _fund(db, "org_cc2")
    async with _client(token) as c:
        for _ in range(2):
            r = await c.post(f"/api/leads/companies/{biz_id}/contacts", json={"include_web": True})
            assert r.status_code == 200, r.text
    assert await _usage(db, "org_cc2", f"lead:{biz_id}:contacts") == 1


@pytest.mark.db
async def test_a_field_the_combined_search_held_back_is_charged_when_first_shown(db, monkeypatch):
    biz = await _biz(db, "CC3", "Held Back Ltd")
    biz_id = biz.id
    now = datetime.utcnow().isoformat() + "Z"
    biz.raw_data = {**(biz.raw_data or {}), "contacts_web_all": {"guardrail": True, "website": "heldback.co.uk", "phones": ["0113 496 0101"],
                                                                 "emails": ["hi@heldback.co.uk"], "fetched_at": now, "confidence": {}}}
    await db.commit()

    async def no_apollo(_db, _biz):
        return {}

    monkeypatch.setattr("app.services.apollo_first.record", no_apollo)
    _, token = await make_user(db, "cc3", "Admin", org_id="org_cc3")
    await _fund(db, "org_cc3")
    async with _client(token) as c:
        for kind in ("phone", "email"):
            r = await c.post(f"/api/leads/companies/{biz_id}/find-website", json={"kind": kind})
            assert r.status_code == 200, r.text
            assert r.json()["found"] and r.json()["charged"] == 1
        again = await c.post(f"/api/leads/companies/{biz_id}/find-website", json={"kind": "phone"})
        assert again.json()["found"] and again.json()["charged"] == 0  # already shown, so not charged again
    assert await _usage(db, "org_cc3", f"lead:{biz_id}:phone") == 1 and await _usage(db, "org_cc3", f"lead:{biz_id}:email") == 1


# ── misses and errors ───────────────────────────────────────────────────────
@pytest.mark.db
async def test_a_recent_miss_is_not_searched_again_unless_the_person_adds_words(db, monkeypatch):
    biz = await _biz(db, "CC4", "Missed Ltd")
    biz_id = biz.id
    biz.raw_data = {**(biz.raw_data or {}), "lookups_missed": {"email": datetime.utcnow().isoformat() + "Z"}}
    await db.commit()
    calls = []

    async def fake_web(_db, b, refresh=False, want="all", hint=""):
        calls.append(hint)
        return {"found": False, "cached": False, "website": "", "phones": [], "emails": [], "team": []}

    async def no_people(_db, _b):
        return None

    monkeypatch.setattr("app.services.company_contacts.web_contacts", fake_web)
    monkeypatch.setattr("app.api.lead_accounts._email_from_people", no_people)

    async def no_google(*a, **k):
        return None

    monkeypatch.setattr("app.api.lead_accounts.search_deeper", no_google)
    _, token = await make_user(db, "cc4", "Admin", org_id="org_cc4")
    await _fund(db, "org_cc4")
    async with _client(token) as c:
        r = await c.post(f"/api/leads/companies/{biz_id}/find-website", json={"kind": "email"})
        assert r.status_code == 200 and not r.json()["found"] and r.json()["charged"] == 0
        assert calls == []  # no new paid search
        await c.post(f"/api/leads/companies/{biz_id}/find-website", json={"kind": "email", "hint": "the dental one"})
        assert calls == ["the dental one"]


@pytest.mark.db
async def test_a_deeper_search_that_errors_is_a_note_not_a_500(db, monkeypatch):
    biz = await _biz(db, "CC5", "Vendor Error Ltd")
    biz_id = biz.id

    async def fake_web(_db, b, refresh=False, want="all", hint=""):
        return {"found": False, "cached": False, "website": "", "phones": [], "emails": [], "team": []}

    async def boom(*a, **k):
        raise RuntimeError("vendor timeout")

    monkeypatch.setattr("app.services.company_contacts.web_contacts", fake_web)
    monkeypatch.setattr("app.api.lead_accounts.search_deeper", boom)
    _, token = await make_user(db, "cc5", "Admin", org_id="org_cc5")
    await _fund(db, "org_cc5")
    async with _client(token) as c:
        for kind in ("website", "phone"):
            r = await c.post(f"/api/leads/companies/{biz_id}/find-website", json={"kind": kind})
            assert r.status_code == 200, r.text
            assert not r.json()["found"] and r.json()["charged"] == 0 and "didn't finish" in r.json()["note"]


# ── opening a reveal twice, at the same time ────────────────────────────────
@pytest.mark.db
async def test_opening_a_contact_that_another_request_just_opened_is_not_an_error(db):
    biz = await _biz(db, "CC6", "Reveal Race Ltd", website="race.co.uk", phone="0113 222 0000")
    with org_scope("org_cc6"):
        await RV._insert(db, [(biz.id, "website")])
        await db.commit()
        await RV._insert(db, [(biz.id, "website")])  # the row a parallel click added a moment ago
        await RV._insert(db, [(biz.id, "website"), (biz.id, "phone")])  # a batch with one clash still opens the rest
        await db.commit()
        kinds = sorted((await db.execute(select(ContactReveal.kind).where(ContactReveal.business_id == biz.id))).scalars().all())
        assert kinds == ["phone", "website"]
        seen = await RV.open_many(db, [biz], set())  # stale `seen`: everything already open
        assert (biz.id, "phone") in seen


# ── contact points ──────────────────────────────────────────────────────────
@pytest.mark.db
async def test_contact_points_hide_source_values_and_do_not_confirm_a_hidden_phone_through_shared_with(db):
    phone = "0113 496 0101"
    mine = await _biz(db, "CC7", "Mine Ltd")
    other = await _biz(db, "CC8", "Other Ltd")
    mine.raw_data = {**(mine.raw_data or {}), "google_places:abc": {"phone": phone}}
    other.raw_data = {**(other.raw_data or {}), "google_places:def": {"phone": phone}}
    await db.commit()
    mine_id = mine.id
    await CP.sync_safely(db, mine)
    await CP.sync_safely(db, other)
    _, token = await make_user(db, "cc7", "Admin", org_id="org_cc7")
    async with _client(token) as c:
        r = await c.get(f"/api/leads/companies/{mine_id}/contact-points")
        assert r.status_code == 200, r.text
        out = r.json()
        row = [p for p in out["points"] if p["kind"] == "phone"][0]
        assert row["value"] == "" and row["hidden"] and out["hidden"] == 1
        assert out["shared_with"] == []  # naming the company that shares a hidden number would confirm it
        with org_scope("org_cc7"):
            await RV.open_one(db, mine_id, "phone")
        out = (await c.get(f"/api/leads/companies/{mine_id}/contact-points")).json()
        assert [p for p in out["points"] if p["kind"] == "phone"][0]["value"] == phone
        assert [x["kind"] for x in out["shared_with"]] == ["phone"]


def test_a_research_social_that_is_neither_text_nor_a_dict_does_not_crash():
    biz = type("B", (), {"id": "x", "website": "", "domain": "", "phone": "", "email": "", "confidence_tier": "", "raw_data": {},
                         "shared_research": {"socials": {"linkedin": ["https://linkedin.com/company/acme"], "x": 5, "facebook": {"url": "https://facebook.com/acme"}}}})()
    assert [p["kind"] for p in CP.points_of(biz)] == ["facebook"]


@pytest.mark.db
async def test_a_failed_contact_point_sync_does_not_roll_back_the_callers_work(db, monkeypatch):
    biz = await _biz(db, "CC9", "Keep Me Ltd")
    biz_id = biz.id
    biz.address = "caller's uncommitted change"

    async def broken(_db, _biz):
        raise RuntimeError("sync broke")

    monkeypatch.setattr(CP, "sync", broken)
    await CP.sync_safely(db, biz)
    row = (await db.execute(select(BusinessRecord.address).where(BusinessRecord.id == biz_id))).scalar()
    assert row == "caller's uncommitted change"


# ── the in-process lock table cleans itself ─────────────────────────────────
def test_the_once_lock_table_does_not_grow():
    from app.api import enrichment as EN

    with org_scope("org_lock"):
        with_lock = EN._once_lock("lead:x:website")
        assert EN._once_lock("lead:x:website") is with_lock  # one lock per organisation and thing while it is in use
        del with_lock
    gc.collect()
    assert len(EN._ONCE_LOCKS) == 0
