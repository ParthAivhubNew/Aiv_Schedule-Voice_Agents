"""Lists: named groups of saved companies; only real accounts go in, names are unique, removed companies drop out."""
import httpx
import pytest

from app.main import app
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


async def test_lists_hold_real_accounts_and_follow_removals(db):
    _, token = await make_user(db, "ll", "Admin", org_id="org_lists")
    async with _client(token) as c:
        saved = (await c.post("/api/leads/accounts", json={"accounts": [{"name": "Kirkgate Dental"}, {"name": "Headrow Lettings"}]})).json()["accounts"]
        ids = [a["id"] for a in saved]
        r = await c.post("/api/leads/lists", json={"name": " Leeds  dentists ", "ids": ids + ["nope", ids[0]]})
        assert r.status_code == 200, r.text
        made = r.json()["list"]
        assert made["name"] == "Leeds dentists" and made["ids"] == ids
        assert (await c.post("/api/leads/lists", json={"name": "leeds dentists"})).status_code == 409
        assert (await c.post("/api/leads/lists", json={"name": "  "})).status_code == 400

        r = await c.patch(f"/api/leads/lists/{made['id']}", json={"name": "Leeds", "remove": [ids[0]]})
        assert r.json()["list"]["ids"] == [ids[1]] and r.json()["list"]["name"] == "Leeds"

        await c.delete(f"/api/leads/accounts/{ids[1]}")
        assert (await c.get("/api/leads/lists")).json()["lists"][0]["ids"] == []

        assert (await c.delete(f"/api/leads/lists/{made['id']}")).status_code == 200
        assert (await c.delete(f"/api/leads/lists/{made['id']}")).status_code == 404


async def test_saving_into_a_list_reuses_the_same_company_but_not_one_in_another_town(db):
    _, token = await make_user(db, "ll2", "Admin", org_id="org_lists2")
    async with _client(token) as c:
        first = (await c.post("/api/leads/accounts", json={"accounts": [
            {"name": "Smith & Sons", "region": "Leeds"}, {"name": "Kirkgate Dental", "website": "kirkgate.example"}]})).json()
        r = await c.post("/api/leads/accounts", json={"list_name": "March file", "accounts": [
            {"name": "SMITH & SONS", "region": "leeds"},                      # same name, same town: the one we have
            {"name": "Smith & Sons", "region": "York"},                       # same name, other town: a different company
            {"name": "Kirkgate Dental Ltd", "website": "https://www.kirkgate.example/contact"},  # same website
            {"name": "Brand New Ltd"}]})
        out = r.json()
        assert out["added"] == 2 and out["matched"] == 2 and out["skipped"] == 2
        assert out["list"]["name"] == "March file" and out["list"]["count"] == 4
        old = {a["name"]: a["id"] for a in first["accounts"]}
        lst = (await c.get("/api/leads/lists")).json()["lists"][0]
        assert old["Smith & Sons"] in lst["ids"] and old["Kirkgate Dental"] in lst["ids"]
        # saving again into the same named list adds no second list
        await c.post("/api/leads/accounts", json={"list_name": "march FILE", "accounts": [{"name": "Another Co"}]})
        assert len((await c.get("/api/leads/lists")).json()["lists"]) == 1


def test_a_check_fills_blanks_and_only_offers_a_fix_for_a_value_the_user_gave():
    from app.services.check_fixes import accept, open_fixes
    from app.services.company_check import build_fixes
    from types import SimpleNamespace

    row = {"phone": "0113 000", "website": "https://old.example", "email": "", "domain": "old.example"}
    deep = {"found": True, "phone": "0113 496 0412", "website": "https://new.example"}
    free = {"phone": {"state": "invalid"}, "website": {"state": "dead"}}
    fixes = build_fixes(row, deep, free, "ann@new.example")
    kinds = {f["field"]: f["kind"] for f in fixes}
    assert kinds == {"phone": "fix", "website": "fix", "email": "fill"}
    # a working number or site is never offered a replacement
    assert build_fixes(row, deep, {"phone": {"state": "ok"}, "website": {"state": "live"}}, "") == []

    acc = SimpleNamespace(phone="0113 000", website="https://old.example", domain="old.example", email="", verification={"fixes": fixes})
    assert len(open_fixes(acc)) == 2
    assert accept(acc, ["website"]) == 1 and acc.website == "https://new.example" and acc.domain == "new.example"
    assert acc.phone == "0113 000"  # not accepted yet
    assert accept(acc) == 1 and acc.phone == "0113 496 0412" and open_fixes(acc) == []
