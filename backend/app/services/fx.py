"""Exchange rates, so costs in dollars can be compared with payments in pounds (plan 11, step 3).

Once a day the euro reference rates of the European Central Bank are read (a public file, no key) and kept per day in app_settings
("fx_rates"). A conversion uses the rate of that day, or the closest earlier day. Before any rate has been read, it uses a fixed
fallback and says so ("estimated"), so a report never silently mixes currencies.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Dict, Optional, Tuple

logger = logging.getLogger("fx")

ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
RATES_KEY = "fx_rates"
KEEP_DAYS = 800
# Units of each currency per euro: rough values, used only until the first real rates are read, and reported as "estimated".
FALLBACK_PER_EUR: Dict[str, float] = {"EUR": 1.0, "USD": 1.08, "GBP": 0.85}


def parse_ecb(xml: str) -> Tuple[str, Dict[str, float]]:
    """(day, {currency: units per euro}) from the ECB daily file. Raises ValueError when the file has no rates."""
    day = re.search(r"time=['\"](\d{4}-\d{2}-\d{2})['\"]", xml or "")
    rates = {c: float(r) for c, r in re.findall(r"currency=['\"]([A-Z]{3})['\"]\s+rate=['\"]([0-9.]+)['\"]", xml or "")}
    if not day or "USD" not in rates or "GBP" not in rates:
        raise ValueError("The ECB file holds no USD and GBP rates")
    return day.group(1), {"EUR": 1.0, **rates}


async def refresh(db) -> Optional[str]:
    """Reads today's ECB rates and stores them for their day. Returns the day stored, or None when it couldn't be read. Never raises."""
    import httpx

    from app.services.credits import _get_doc, _put_doc

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(ECB_URL)
            r.raise_for_status()
        day, rates = parse_ecb(r.text)
        doc = await _get_doc(db, RATES_KEY)
        days = dict(doc.get("days") or {})
        days[day] = {c: rates[c] for c in ("EUR", "USD", "GBP") if c in rates}
        keep = dict(sorted(days.items())[-KEEP_DAYS:])
        await _put_doc(db, RATES_KEY, {"days": keep, "source": "ECB", "read_at": datetime.utcnow().isoformat(timespec="seconds")})
        await db.commit()
        return day
    except Exception as err:
        logger.warning(f"[fx] rates not read: {err}")
        return None


async def rate(db, frm: str, to: str, on: Optional[date] = None) -> Tuple[float, str, bool]:
    """(units of `to` per unit of `frm`, the day the rate is from, estimated). The rate of `on` or the closest earlier day; the latest
    when `on` is before every stored day; the fixed fallback when nothing is stored (estimated is then True)."""
    from app.services.credits import _get_doc

    frm, to = frm.upper(), to.upper()
    if frm == to:
        return 1.0, (on or date.today()).isoformat(), False
    days = dict((await _get_doc(db, RATES_KEY)).get("days") or {})
    usable = {d: r for d, r in days.items() if frm in r and to in r}
    if usable:
        want = (on or date.today()).isoformat()
        earlier = [d for d in usable if d <= want]
        day = max(earlier) if earlier else min(usable)
        r = usable[day]
        return r[to] / r[frm], day, False
    return FALLBACK_PER_EUR[to] / FALLBACK_PER_EUR[frm], "", True


async def convert(db, amount: float, frm: str, to: str, on: Optional[date] = None) -> Tuple[float, bool]:
    """(amount in `to`, estimated)."""
    r, _day, estimated = await rate(db, frm, to, on)
    return amount * r, estimated
