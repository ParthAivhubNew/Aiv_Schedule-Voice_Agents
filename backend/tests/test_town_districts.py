"""The town's postcode-area picker: counts per district, in postcode order, never the companies themselves."""
from datetime import date

import httpx
import pytest

from app.main import app
from app.models.models import BusinessRecord
from app.services import business_records
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _co(i, name, postcode, region="LEEDS", status="Active"):
    return BusinessRecord(id=f"biz_d{i}", identity_hash=f"hd{i}", name=name, postcode=postcode, region=region, status=status,
                          incorporated_on=date(2020, 1, 1), confidence_tier="verified_registry")


async def test_a_town_lists_its_postcode_districts_with_counts_in_order(db):
    business_records._DISTRICTS.clear()
    db.add_all([_co(1, "A Ltd", "LS1 4AP"), _co(2, "B Ltd", "LS1 5AB"), _co(3, "C Ltd", "LS10 2XX"), _co(4, "D Ltd", "LS6 1AA"),
                _co(5, "E Ltd", "ls6 2bb"), _co(6, "Closed Ltd", "LS1 9ZZ", status="Dissolved"), _co(7, "Elsewhere", "M1 1AA", region="MANCHESTER"),
                _co(8, "No postcode", None)])
    await db.commit()
    _, token = await make_user(db, "dist", "Admin")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as c:
        r = await c.get("/api/leads/districts", params={"town": "Leeds"})
        assert r.status_code == 200, r.text
        assert r.json()["districts"] == [{"district": "LS1", "count": 2}, {"district": "LS6", "count": 2}, {"district": "LS10", "count": 1}]
        assert r.json()["total"] == 5
        assert "Ltd" not in r.text  # counts only: no company is listed
        # closed companies count when asked for; another town is its own list
        assert {"district": "LS1", "count": 3} in (await c.get("/api/leads/districts", params={"town": "leeds", "include_closed": True})).json()["districts"]
        assert (await c.get("/api/leads/districts", params={"town": "Manchester"})).json()["districts"] == [{"district": "M1", "count": 1}]
        assert (await c.get("/api/leads/districts", params={"town": "Nowhere"})).json()["districts"] == []
        assert (await c.get("/api/leads/districts", params={"town": "L"})).status_code == 422
