"""The saved-company payloads carry the shared TPS/CTPS result per phone (and nothing else of it)."""
from datetime import datetime

import httpx
import pytest

from app.main import app
from app.services import call_permission as CP
from tests.conftest import make_user

pytestmark = pytest.mark.db

WHEN = datetime(2026, 11, 20, 9, 30)


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def test_map_holds_only_screened_numbers_and_normalises(db):
    await CP.save_screening(db, "+441135500412", "clear", provider_name="secret-provider", now=WHEN)
    await CP.save_screening(db, "+442071234567", "listed", ctps=True, now=WHEN)
    await CP.save_screening(db, "+443031234567", "unknown", now=WHEN)  # no result: not "checked"
    await db.commit()
    got = await CP.screening_map(db, ["0113 550 0412", "020 7123 4567", "0303 123 4567", "07700 900999", "", None])
    assert set(got) == {"+441135500412", "+442071234567"}
    assert got["+441135500412"] == {"status": "clear", "ctps": False, "checked_at": "2026-11-20T09:30:00Z"}
    assert got["+442071234567"]["status"] == "listed" and got["+442071234567"]["ctps"] is True
    assert "provider" not in got["+441135500412"]


async def test_map_uses_one_query_for_many_numbers(db):
    seen = []
    real = db.execute

    async def counting(*a, **k):
        seen.append(1)
        return await real(*a, **k)

    db.execute = counting
    try:
        await CP.screening_map(db, [f"0113 550 {i:04d}" for i in range(200)])
    finally:
        db.execute = real
    assert len(seen) == 1


async def test_account_list_and_patch_carry_phone_screening(db):
    _, token = await make_user(db, "ps", "Admin", org_id="org_acme")
    await CP.save_screening(db, "+441135500412", "clear", now=WHEN)
    await CP.save_screening(db, "+442071234567", "listed", ctps=True, now=WHEN)
    await db.commit()
    async with _client(token) as c:
        r = await c.post("/api/leads/accounts", json={"accounts": [
            {"name": "Kirkgate Dental", "phone": "0113 550 0412"},
            {"name": "Headrow Lettings", "phone": "020 7123 4567"},
            {"name": "Unchecked Ltd", "phone": "07700 900999"},
            {"name": "No Phone Ltd"},
        ]})
        assert r.status_code == 200, r.text
        listed = {a["name"]: a for a in (await c.get("/api/leads/accounts")).json()["accounts"]}
        assert listed["Kirkgate Dental"]["phone_screening"] == {"status": "clear", "ctps": False, "checked_at": "2026-11-20T09:30:00Z"}
        assert listed["Headrow Lettings"]["phone_screening"]["status"] == "listed" and listed["Headrow Lettings"]["phone_screening"]["ctps"] is True
        assert listed["Unchecked Ltd"]["phone_screening"] is None
        assert listed["No Phone Ltd"]["phone_screening"] is None
        one = (await c.patch(f"/api/leads/accounts/{listed['Kirkgate Dental']['id']}", json={"notes": "x"})).json()
        assert one["phone_screening"]["status"] == "clear"


async def test_people_found_by_a_check_carry_their_own_screening(db):
    from app.api.lead_accounts import with_screening

    await CP.save_screening(db, "+441135500412", "clear", now=WHEN)
    await db.commit()
    card = {"phone": "", "research": {"team": [{"name": "Tom", "phone": "0113 550 0412"}, {"name": "Ann", "phone": "07700 900999"}, {"name": "Bo"}], "people": []}}
    (out,) = await with_screening(db, [card])
    team = out["research"]["team"]
    assert team[0]["phone_screening"]["status"] == "clear"
    assert team[1]["phone_screening"] is None and team[2]["phone_screening"] is None
    assert out["phone_screening"] is None


async def test_every_number_on_a_card_carries_its_own_result_in_one_query(db):
    from app.api.lead_accounts import card_numbers, with_screening

    await CP.save_screening(db, "+441135500412", "clear", now=WHEN)
    await CP.save_screening(db, "+442071234567", "listed", now=WHEN)
    await CP.save_screening(db, "+441619990000", "clear", ctps=True, now=WHEN)
    await db.commit()
    card = {"phone": "0113 550 0412", "research": {
        "phones": ["020 7123 4567", "+44 113 550 0412", "07700 900999"],
        "team": [{"name": "Tom", "phone": "0161 999 0000"}],
        "people": [{"name": "Ann", "role": "Owner"}],
        "other_offices": [{"town": "Leeds", "phone": "020 7123 4567"}, {"town": "York", "email": "y@x.test"}]}}
    assert len(card_numbers(card)) == 6
    seen = []
    real = db.execute

    async def counting(*a, **k):
        seen.append(1)
        return await real(*a, **k)

    db.execute = counting
    try:
        out, blank = await with_screening(db, [card, {"phone": "", "research": None}])
    finally:
        db.execute = real
    assert len(seen) == 1
    r = out["research"]
    assert out["phone_screening"]["status"] == "clear"
    assert [s and s["status"] for s in r["phones_screening"]] == ["listed", "clear", None]
    assert r["team"][0]["phone_screening"]["ctps"] is True
    assert r["other_offices"][0]["phone_screening"]["status"] == "listed" and r["other_offices"][1]["phone_screening"] is None
    assert r["people"][0]["phone_screening"] is None
    assert r["phones"] == ["020 7123 4567", "+44 113 550 0412", "07700 900999"]  # the numbers themselves are untouched


async def test_tps_check_by_account_ids_gathers_every_number_and_skips_fresh_ones(db):
    from app.api import tps_check as T
    from app.models.models import LeadAccount

    db.add(LeadAccount(id="la_wp14", name="Gather Ltd", phone="0113 550 0412", research={
        "phones": ["+44 113 550 0412", "020 7123 4567"], "team": [{"name": "Tom", "phone": "07700 900111"}]}))
    await db.commit()
    await CP.save_screening(db, "+442071234567", "clear")  # checked just now: free
    await db.commit()
    body = T.CheckBody(account_ids=["la_wp14", "la_missing"], numbers=["07700 900111"])
    gathered = await T._with_account_numbers(db, body)
    assert sorted(T._clean(gathered)) == ["+441135500412", "+442071234567", "+447700900111"]
    out = await T.estimate(body, db)
    assert out["to_check"] == 2  # the fresh one is not asked again
    assert {r["number"]: r["fresh"] for r in out["rows"]}["+442071234567"] is True
