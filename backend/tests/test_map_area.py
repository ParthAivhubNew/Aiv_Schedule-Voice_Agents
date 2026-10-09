"""The Find Leads map: a drawn area is counted first, then read in steps until the user has as many as they asked for."""
import httpx
import pytest

from app.main import app
from app.models.models import BusinessRecord
from app.services import business_records as BR
from app.services import geocoding
from tests.conftest import make_user

SQUARE = [[51.40, -1.05], [51.40, -0.90], [51.50, -0.90], [51.50, -1.05]]  # around Reading


def test_edge_points_follow_the_outline_and_stay_bounded():
    poly = geocoding.clean_polygon(SQUARE)
    step = geocoding._grid_step_km(poly)
    edge = geocoding.edge_points(poly, step)
    assert 4 <= len(edge) <= 40
    assert all(min(p[0] for p in poly) - 1e-9 <= lat <= max(p[0] for p in poly) + 1e-9 for lat, _ in edge)
    assert len(geocoding.sample_points(poly)) <= geocoding.MAX_POINTS
    big = geocoding.clean_polygon([[51.0, -1.5], [51.0, -0.5], [51.8, -0.5], [51.8, -1.5]])
    assert len(geocoding.edge_points(big, 1.5)) == 40  # a long outline is thinned evenly, not cut short


@pytest.fixture
def reading(monkeypatch):
    """Five companies at three fake postcodes: two inside the square, one just outside it, one with no postcode centre."""
    centres = {"RG1 1AA": (51.45, -1.00), "RG1 2BB": (51.46, -0.95), "RG1 9ZZ": (51.60, -1.00)}

    async def outcodes(poly):
        return ["RG1"]

    async def geocode(db, postcodes, **kw):
        return {geocoding.norm_postcode(p): centres.get(geocoding.norm_postcode(p)) for p in postcodes}

    monkeypatch.setattr(geocoding, "outcodes_for_area", outcodes)
    monkeypatch.setattr(geocoding, "geocode", geocode)
    return centres


async def _seed(db):
    rows = [("Alpha Ltd", "RG1 1AA", "2024-01-01"), ("Beta Ltd", "RG1 2BB", "2023-01-01"), ("Gamma Ltd", "RG1 9ZZ", "2022-01-01"),
            ("Delta Ltd", "RG1 1AA", "2021-01-01"), ("Echo Ltd", "RG1 8XX", "2020-01-01")]
    from datetime import date

    for i, (name, pc, born) in enumerate(rows):
        y, m, d = (int(x) for x in born.split("-"))
        db.add(BusinessRecord(id=f"biz_{i}", identity_hash=f"h{i}", name=name, postcode=pc, status="Active", incorporated_on=date(y, m, d),
                              confidence_tier="verified_registry"))
    await db.commit()


@pytest.mark.db
async def test_area_search_reads_in_steps_and_keeps_only_what_is_inside(db, reading):
    await _seed(db)
    seen, scan = [], 0
    while True:
        out = await BR.search_in_area(db, {}, SQUARE, scan=scan, chunk=2)
        seen += [r.name for r in out["rows"]]
        assert set(out["points"]) == {r.id for r in out["rows"]}
        scan = out["next_scan"]
        if scan is None:
            break
    assert seen == ["Alpha Ltd", "Beta Ltd", "Delta Ltd"]  # newest first; Gamma is outside the shape, Echo has no centre
    whole = await BR.search_in_area(db, {}, SQUARE)
    assert [r.name for r in whole["rows"]] == seen and whole["next_scan"] is None


@pytest.mark.db
async def test_the_count_tells_the_user_how_many_before_anything_is_placed(db, reading):
    await _seed(db)
    out = await BR.area_candidates(db, {}, SQUARE)
    assert out == {"candidates": 5, "capped": False, "filters": out["filters"]}  # districts touched; the shape is applied as they are read

    async def none(poly):
        return []

    geocoding.outcodes_for_area = none  # the monkeypatch fixture restores the original afterwards
    assert (await BR.area_candidates(db, {}, SQUARE))["candidates"] == 0
    assert (await BR.search_in_area(db, {}, SQUARE))["rows"] == []


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


@pytest.mark.db
async def test_the_api_counts_then_steps_through_the_area(db, reading):
    await _seed(db)
    _, token = await make_user(db, "mapper", "Admin")
    async with _client(token) as c:
        r = await c.post("/api/leads/search/area-count", json={"filters": {}, "area": SQUARE})
        assert r.status_code == 200 and r.json() == {"candidates": 5, "capped": False}
        assert (await c.post("/api/leads/search/area-count", json={"filters": {}})).status_code == 422
        assert (await c.post("/api/leads/search/area-count", json={"area": [[1, 1], [2, 2]]})).status_code == 422
        r = await c.post("/api/leads/search", json={"filters": {}, "area": SQUARE, "scan": 0})
        body = r.json()
        assert [x["name"] for x in body["companies"]] == ["Alpha Ltd", "Beta Ltd", "Delta Ltd"] and body["next_scan"] is None
        assert set(body["points"]) == {x["id"] for x in body["companies"]}


@pytest.mark.db
async def test_the_postcode_index_is_created_once(db):
    from sqlalchemy import text

    from app.core import migrations
    from app.database import engine

    async with engine.begin() as conn:
        await migrations._business_record_postcode_index(conn)
        await migrations._business_record_postcode_index(conn)  # safe to run again
        found = (await conn.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_business_records_postcode_prefix'"))).scalar()
    assert found and "varchar_pattern_ops" in found
