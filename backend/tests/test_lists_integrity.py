"""Lists: removing a company sticks, reading writes nothing, writes are serialised, big requests are capped."""
import httpx
import pytest

from app.main import app
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                             headers={"Authorization": f"Bearer {token}"})


async def test_removed_from_last_list_stays_out_and_unsorted_is_a_view(db):
    from sqlalchemy import select
    from app.models.models import AppSetting

    _, token = await make_user(db, "li1", "Admin", org_id="org_li1")
    async with _client(token) as c:
        ids = [a["id"] for a in (await c.post("/api/leads/accounts", json={"accounts": [{"name": "Alpha Co"}, {"name": "Beta Co"}]})).json()["accounts"]]
        made = (await c.post("/api/leads/lists", json={"name": "Mine", "ids": ids})).json()["list"]
        await c.patch(f"/api/leads/lists/{made['id']}", json={"remove": [ids[0]]})
        stored = (await c.get("/api/leads/lists")).json()["lists"]
        mine = next(l for l in stored if l["id"] == made["id"])
        assert mine["ids"] == [ids[1]]
        view = next(l for l in stored if l.get("virtual"))
        assert view["ids"] == [ids[0]]
        # reading changed nothing: still no stored list called Unsorted
        row = (await db.execute(select(AppSetting).where(AppSetting.id == "leadlists:org_li1"))).scalars().first()
        assert [l["name"] for l in row.data["lists"]] == ["Mine"]
        # deleting the list keeps the companies, shown in the view, and no stored Unsorted appears
        assert (await c.delete(f"/api/leads/lists/{made['id']}")).status_code == 200
        after = (await c.get("/api/leads/lists")).json()["lists"]
        assert len(after) == 1 and after[0]["virtual"] and sorted(after[0]["ids"]) == sorted(ids)
        assert (await c.delete(f"/api/leads/lists/{after[0]['id']}")).status_code == 200  # nothing stored to delete


async def test_list_requests_are_capped(db):
    _, token = await make_user(db, "li2", "Admin", org_id="org_li2")
    async with _client(token) as c:
        r = await c.post("/api/leads/lists", json={"name": "Big", "ids": [f"x{i}" for i in range(5001)]})
        assert r.status_code == 422


async def test_bulk_delete_reports_the_cap(db, monkeypatch):
    from app.api import lead_accounts

    monkeypatch.setattr(lead_accounts, "BULK_DELETE_CAP", 2)
    _, token = await make_user(db, "li3", "Admin", org_id="org_li3")
    async with _client(token) as c:
        ids = [a["id"] for a in (await c.post("/api/leads/accounts", json={"accounts": [{"name": "A One"}, {"name": "B Two"}, {"name": "C Three"}]})).json()["accounts"]]
        out = (await c.post("/api/leads/accounts/bulk-delete", json={"ids": ids})).json()
        assert out["deleted"] == 2 and out["over_cap"] == 1 and out["not_found"] == 0
