"""Google content is never stored beyond the place ID, never exported, never returned to API callers, and the purge removes what was kept."""
import csv
import importlib.util
import io
import json
import os
import uuid

import httpx
import pytest
from sqlalchemy import select, text

from app.core.tenancy import org_scope
from app.main import app
from app.models.models import BusinessRecord, LeadAccount
from app.services import business_records as BR
from tests.conftest import make_user
from tests.test_find_leads_ranking import _row

GPHONE, GSITE = "0113 496 0101", "https://g-only.example"


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def _biz(db, number, name, **extra):
    await BR.bulk_upsert(db, source_id="ds_ch", rows=[_row(number, name, "01/01/2015", **extra)])
    await db.commit()
    return (await db.execute(select(BusinessRecord).where(BusinessRecord.registration_number == number))).scalars().first()


async def _account(db, org, name, **kw):
    with org_scope(org):
        a = LeadAccount(id=f"acc_{uuid.uuid4().hex[:12]}", name=name, **kw)
        db.add(a)
        await db.commit()
        return a.id


async def _coro(v):
    return v


def _purge():
    spec = importlib.util.spec_from_file_location("purge_google_values", os.path.join(os.path.dirname(__file__), "..", "scripts", "purge_google_values.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


async def _legacy_record(db, number, name):
    """A record as the old code left it: Google's phone in the shared column and Google's whole answer in raw_data."""
    biz = await _biz(db, number, name)
    biz.phone = GPHONE
    biz.raw_data = {**(biz.raw_data or {}), "google_places:g9": {"phone": GPHONE, "website": GSITE, "business_status": "OPERATIONAL", "place_id": "g9"}}
    await db.commit()
    return biz


@pytest.mark.db
async def test_a_google_place_is_filed_by_its_place_id_only(db):
    from app.api.lead_accounts import _keep_place, _vouched

    biz = await _biz(db, "GP1", "Place Only Ltd")
    place = {"place_id": "gp1", "phone": GPHONE, "website": GSITE, "postcode_match": True, "name_match": True, "business_status": "OPERATIONAL", "via": "google_places"}
    assert _vouched(place, {}) == {}  # Google's own values are not kept, even at the company's postcode
    await _keep_place(db, biz, place, {"website": "https://own.example", "sources": {"website": "website"}})
    await db.commit()
    await db.refresh(biz)
    assert biz.website == "https://own.example" and not biz.phone
    assert biz.raw_data["google_places:gp1"] == {"place_id": "gp1"}
    assert biz.raw_data["website_confirmed:gp1"]["website"] == "https://own.example"
    blob = json.dumps(biz.raw_data)
    assert GPHONE not in blob and GSITE not in blob and "OPERATIONAL" not in blob
    assert {s["source_id"] for s in biz.sources} >= {"google_places:gp1", "website_confirmed:gp1"}


@pytest.mark.db
async def test_a_google_source_entry_never_writes_a_shared_column(db):
    biz = await _biz(db, "GP2", "Columns Ltd")
    shared = await BR.upsert(db, source_id="google_places:gp2", source_type="google_places", confidence_tier="scraped",
                             data={"name": biz.name, "registration_number": "GP2", "postcode": "LS1 4AP", "raw": {"place_id": "gp2"}})
    await db.commit()
    await db.refresh(shared)
    assert shared.id == biz.id and not shared.phone and not shared.website
    assert shared.raw_data["google_places:gp2"] == {"place_id": "gp2"}


@pytest.mark.db
async def test_the_deep_search_saves_only_what_the_site_confirmed_and_marks_the_source(db, monkeypatch):
    from app.api import lead_accounts as LA
    from app.services import web_harness

    await _biz(db, "GP3", "Deep Ltd")
    acc_id = await _account(db, "org_default", "Deep Ltd", postcode="LS1 4AP")
    place = {"place_id": "gp3", "phone": GPHONE, "website": GSITE, "postcode_match": True, "name_match": True, "via": "google_places"}

    async def deeper(*a, **k):
        return place

    async def no_charge(*a, **k):
        return True

    async def fine(*a, **k):
        return None

    monkeypatch.setattr(LA, "search_deeper", deeper)
    monkeypatch.setattr(LA, "_charge_deep_search", no_charge)
    monkeypatch.setattr(LA, "_can_deep_search", fine)
    monkeypatch.setattr(web_harness, "confirm_place", lambda *a, **k: _coro({}))
    with org_scope("org_default"):
        await LA.deep_search_account(acc_id, db)
        row = await db.get(LeadAccount, acc_id)
        assert not row.phone and not row.website  # Google alone: nothing saved
        monkeypatch.setattr(web_harness, "confirm_place", lambda *a, **k: _coro({"website": "https://own.example", "phone": "0113 222 3333"}))
        await LA.deep_search_account(acc_id, db)
        await db.refresh(row)
        assert row.website == "https://own.example" and row.phone == "0113 222 3333"
        assert row.field_sources == {"phone": "website", "website": "website"}


@pytest.mark.db
async def test_export_blanks_restricted_values_and_counts_them(db):
    biz = await _legacy_record(db, "GP4", "Legacy Ltd")
    await _account(db, "org_exp", "Legacy Ltd", phone=GPHONE, website="https://mine.example", email="a@mine.example", business_record_id=biz.id)
    await _account(db, "org_exp", "Marked Ltd", phone="0113 111 2222", website=GSITE, field_sources={"website": "apollo", "phone": "user"})
    await _account(db, "org_exp", "Own Ltd", phone="0113 333 4444", field_sources={"phone": "website"})
    _, token = await make_user(db, "exp1", "Admin", org_id="org_exp")
    async with _client(token) as c:
        r = await c.get("/api/contacts/export.csv")
    assert r.status_code == 200, r.text
    assert r.headers["X-Withheld-Count"] == "2"
    by = {x["Company"]: x for x in csv.DictReader(io.StringIO(r.text))}
    assert by["Legacy Ltd"]["Phone"] == "" and by["Legacy Ltd"]["Website"] == "https://mine.example" and by["Legacy Ltd"]["restricted_values_withheld"] == "1"
    assert by["Marked Ltd"]["Website"] == "" and by["Marked Ltd"]["Phone"] == "0113 111 2222"
    assert by["Own Ltd"]["Phone"] == "0113 333 4444" and by["Own Ltd"]["restricted_values_withheld"] == "0"
    assert GPHONE not in r.text and GSITE not in r.text


@pytest.mark.db
async def test_the_public_api_card_masks_restricted_values(db):
    from app.public_api.leads import _company_card, _lead

    biz = await _legacy_record(db, "GP5", "Card Ltd")
    card = _company_card(biz, None)
    assert card["phone"] is None and card["restricted"] == {"phone": True}
    acc = LeadAccount(id="acc_card", name="Card Ltd", phone="0113 111 2222", website=GSITE, field_sources={"website": "google_places"})
    out = _lead(acc, biz, [], None)
    assert out["website"] is None and out["restricted"] == {"website": True} and out["phone"] == "0113 111 2222"


@pytest.mark.db
async def test_the_purge_counts_then_clears_google_only_values(db, tmp_path):
    from app.database import engine

    purge = _purge()
    biz = await _legacy_record(db, "GP6", "Purge Ltd")
    biz.website = GSITE
    biz.raw_data = {**biz.raw_data, "lookup_options": {"phone": [{"value": GPHONE, "label": "Google lists this for the company", "sources": []}]}}
    kept = await _biz(db, "GP7", "Confirmed Ltd")  # its website was also shown by the company's own site: that value stays
    kept.website = "https://own.example"
    kept.raw_data = {**(kept.raw_data or {}), "google_places:g7": {"website": "https://own.example", "place_id": "g7"},
                     "website_confirmed:g7": {"website": "https://own.example"}}
    await db.commit()
    a_legacy = await _account(db, "org_pg", "Purge Ltd", phone=GPHONE, website="https://mine.example", business_record_id=biz.id)
    a_marked = await _account(db, "org_pg", "Marked Ltd", website=GSITE, field_sources={"website": "google_places"})
    a_own = await _account(db, "org_pg", "Confirmed Ltd", website="https://own.example", field_sources={"website": "website"}, business_record_id=kept.id)
    await db.execute(text("INSERT INTO company_contact_points (id, business_record_id, kind, value, norm, source, confidence) VALUES "
                          "('cp1', :b, 'phone', :v, '1134960101', 'google_places', 'found'), ('cp2', :b, 'website', 'https://x.example', 'x.example', 'register', 'register')"),
                     {"b": biz.id, "v": GPHONE})
    await db.commit()
    report = str(tmp_path / "report.csv")

    dry = await purge.run(go=False, report=report, engine=engine)
    assert dry["lead_accounts.phone"] == 1 and dry["lead_accounts.website"] == 1 and dry["company_contact_points.phone"] == 1
    assert dry["business_records.phone"] == 1 and dry["business_records.website"] == 1 and dry["business_records.raw_data.lookup_options"] == 1
    assert dry["business_records.raw_data.google_places"] == 2  # both Google entries are cut to the place ID; the confirmed company keeps its own entry
    assert "would clear" in open(report, encoding="utf-8").read()
    with org_scope("org_pg"):
        assert (await db.get(LeadAccount, a_legacy)).phone == GPHONE  # a dry run writes nothing

    assert await purge.run(go=True, report=report, engine=engine) == dry
    await db.rollback()
    with org_scope("org_pg"):
        for acc_id in (a_legacy, a_marked, a_own):
            await db.refresh(await db.get(LeadAccount, acc_id))
        assert (await db.get(LeadAccount, a_legacy)).phone == "" and (await db.get(LeadAccount, a_legacy)).website == "https://mine.example"
        assert (await db.get(LeadAccount, a_marked)).website == ""
        assert (await db.get(LeadAccount, a_own)).website == "https://own.example"  # confirmed on its own site
    await db.refresh(biz)
    await db.refresh(kept)
    assert biz.phone == "" and biz.website == "" and biz.raw_data["google_places:g9"] == {"place_id": "g9"}
    assert biz.raw_data["lookup_options"]["phone"] == []
    assert kept.website == "https://own.example" and kept.raw_data["website_confirmed:g7"]["website"] == "https://own.example"
    assert (await db.execute(text("SELECT count(*) FROM company_contact_points WHERE source = 'google_places'"))).scalar() == 0
    assert (await db.execute(text("SELECT count(*) FROM company_contact_points WHERE source = 'register'"))).scalar() == 1
    assert await purge.run(go=True, report=report, engine=engine) == {}  # nothing left to clear: a second run changes nothing
