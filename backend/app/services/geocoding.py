"""Postcode -> map point, for the Find Leads map and its draw-an-area search.

The company store holds a postcode for each company, not coordinates. A postcode's centre is public
geography, so it is looked up once from postcodes.io (free, UK, no key) and cached for every
organisation in PostcodeGeo. Nothing is guessed: a postcode that cannot be found is simply not on the map.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import PostcodeGeo

logger = logging.getLogger("geocoding")

API = "https://api.postcodes.io"
BULK = 100          # postcodes.io accepts at most 100 per bulk request
MAX_POINTS = 100
MAX_VERTICES = 300
MAX_STEP_KM = 4.0   # a drawn area wider than ~40 km would need a coarser sample than we trust
MIN_STEP_KM = 1.5

Point = Tuple[float, float]  # (lat, lng)


def norm_postcode(value: Any) -> str:
    """'sw1a1aa' / 'SW1A  1AA' -> 'SW1A 1AA'; '' when it is not a full UK postcode."""
    raw = re.sub(r"\s+", "", str(value or "").upper())
    m = re.match(r"^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$", raw)
    return f"{m.group(1)} {m.group(2)}" if m else ""


def clean_polygon(area: Any) -> List[Point]:
    """The drawn area as [(lat, lng), ...]; raises ValueError for anything that is not a usable polygon."""
    pts: List[Point] = []
    try:
        for item in area or []:
            lat, lng = float(item[0]), float(item[1])
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                raise ValueError
            pts.append((lat, lng))
    except (TypeError, ValueError, IndexError):
        raise ValueError("The drawn area is not valid. Draw it again.")
    if len(pts) < 3:
        raise ValueError("Draw an area with at least three corners.")
    if len(pts) > MAX_VERTICES:
        raise ValueError("The drawn area is too detailed. Draw it with fewer corners.")
    return pts


def point_in_polygon(lat: float, lng: float, poly: List[Point]) -> bool:
    """Ray casting; the polygon is small and flat enough (UK-sized) that plain lat/lng is exact enough."""
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def sample_points(poly: List[Point]) -> List[Point]:
    """A grid of points inside the polygon (plus its corners), dense enough that every outcode the
    area touches is near one. Raises ValueError when the area is too large to cover reliably."""
    lats = [p[0] for p in poly]
    lngs = [p[1] for p in poly]
    south, north, west, east = min(lats), max(lats), min(lngs), max(lngs)
    mid = (south + north) / 2
    height_km = (north - south) * 111.0
    width_km = (east - west) * 111.0 * math.cos(math.radians(mid))
    step = max(MIN_STEP_KM, math.sqrt(max(height_km * width_km, 0.01) / 60))
    if step > MAX_STEP_KM:
        raise ValueError("That area is too large to search. Draw a smaller one, around a town or a few postcodes.")
    dlat = step / 111.0
    dlng = step / (111.0 * max(math.cos(math.radians(mid)), 0.1))
    out: List[Point] = []
    lat = south + dlat / 2
    while lat < north:
        lng = west + dlng / 2
        while lng < east:
            if point_in_polygon(lat, lng, poly):
                out.append((lat, lng))
            lng += dlng
        lat += dlat
    out = out[: MAX_POINTS - 20] + poly[:20]
    return out


async def _post(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(f"{API}{path}", json=payload)
        r.raise_for_status()
        return r.json()


async def outcodes_for_area(poly: List[Point]) -> List[str]:
    """The postcode districts (e.g. 'RG1', 'RG30') the drawn area touches, from postcodes.io's reverse lookup."""
    points = sample_points(poly)
    try:
        data = await _post("/postcodes", {"geolocations": [
            {"latitude": lat, "longitude": lng, "radius": 2000, "limit": 10} for lat, lng in points]})
    except Exception as err:
        logger.warning(f"[geocoding] area lookup failed: {err}")
        raise ValueError("The map service didn't answer, so the area couldn't be searched. Try again in a moment.")
    found: List[str] = []
    for item in data.get("result") or []:
        for hit in (item or {}).get("result") or []:
            code = str(hit.get("outcode") or "").upper()
            if code and code not in found:
                found.append(code)
    return found


async def geocode(db: AsyncSession, postcodes: Iterable[Any], *, max_lookups: int = 1500) -> Dict[str, Optional[Point]]:
    """{normalised postcode: (lat, lng) or None}. Cached ones come from the database; the rest are
    fetched from postcodes.io in bulk (at most `max_lookups` new ones per call) and cached.
    A postcodes.io outage just leaves the uncached ones out -- never an error for the search."""
    wanted = list(dict.fromkeys(pc for pc in (norm_postcode(p) for p in postcodes) if pc))
    out: Dict[str, Optional[Point]] = {}
    if not wanted:
        return out
    for i in range(0, len(wanted), 5000):
        rows = (await db.execute(select(PostcodeGeo).where(PostcodeGeo.postcode.in_(wanted[i:i + 5000])))).scalars().all()
        for r in rows:
            out[r.postcode] = (r.lat, r.lng) if r.lat is not None and r.lng is not None else None
    missing = [pc for pc in wanted if pc not in out][:max_lookups]
    if not missing:
        return out
    sem = asyncio.Semaphore(4)

    async def fetch(chunk: List[str]) -> List[Tuple[str, Optional[Point]]]:
        async with sem:
            try:
                data = await _post("/postcodes", {"postcodes": chunk})
            except Exception as err:
                logger.warning(f"[geocoding] postcodes.io lookup failed: {err}")
                return []
        res: List[Tuple[str, Optional[Point]]] = []
        for item in data.get("result") or []:
            hit = (item or {}).get("result")
            query = norm_postcode((item or {}).get("query"))
            if not query:
                continue
            ok = hit and hit.get("latitude") is not None and hit.get("longitude") is not None
            res.append((query, (float(hit["latitude"]), float(hit["longitude"])) if ok else None))
        return res

    chunks = [missing[i:i + BULK] for i in range(0, len(missing), BULK)]
    new: List[Tuple[str, Optional[Point]]] = [x for part in await asyncio.gather(*(fetch(c) for c in chunks)) for x in part]
    if new:
        values = [{"postcode": pc, "lat": pt[0] if pt else None, "lng": pt[1] if pt else None} for pc, pt in new]
        if db.get_bind().dialect.name == "postgresql":
            await db.execute(pg_insert(PostcodeGeo).values(values).on_conflict_do_nothing(index_elements=["postcode"]))
        else:
            for v in values:
                await db.merge(PostcodeGeo(**v))
        await db.flush()
        out.update(dict(new))
    return out
