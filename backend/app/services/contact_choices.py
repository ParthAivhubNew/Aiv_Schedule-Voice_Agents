"""What users pick when a lookup is not sure, and how that makes the next lookup better.

A lookup that cannot tell which candidate is right shows the best few. Each pick is stored once per organisation. When enough different
organisations picked the same value for a company, it is trusted for everyone after them: shown first, and used straight away."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import current_org
from app.models.models import ContactChoice

TRUSTED_PICKS = 3  # picks from this many different organisations make a value trusted
FLOOR = 30  # a candidate under this score is not worth showing
MAX_OPTIONS = 3  # the three closest matches
BOOST_PER_ORG = 25  # points added to a candidate for each organisation that confirmed it as the correct one
BOOST_CAP = 100


def label_of(score: int) -> str:
    return "Likely" if score >= 55 else "Possible"


def options_from(cands: List[Dict[str, Any]], sources: List[Dict[str, Any]], winner: Optional[Dict[str, Any]], limit: int = MAX_OPTIONS) -> List[Dict[str, Any]]:
    """The few candidates worth showing when there is no clear winner: not rejected, scored over the floor, best first. Empty when there is a winner."""
    if winner:
        return []
    live = sorted((c for c in cands if not c.get("rejected") and c.get("score", 0) >= FLOOR), key=lambda c: -c["score"])[:limit]
    return [{"value": c["value"], "score": c["score"], "label": label_of(c["score"]),
             "sources": list(dict.fromkeys(sources[i]["url"] for i in c["sources"]))[:3]} for c in live]


def boost_of(rows: List[ContactChoice]) -> Dict[str, int]:
    """value -> points the lookup adds to that candidate: more confirmations, higher score, until it wins on its own."""
    return {r.value: min(BOOST_CAP, BOOST_PER_ORG * len(r.orgs or [])) for r in rows if r.orgs}


async def boosts_for(db: AsyncSession, business_id: str, kinds: List[str]) -> Dict[str, Dict[str, int]]:
    return {k: boost_of(await rows_for(db, business_id, k)) for k in kinds}


async def rows_for(db: AsyncSession, business_id: str, kind: str) -> List[ContactChoice]:
    return list((await db.execute(select(ContactChoice).where(ContactChoice.business_id == business_id, ContactChoice.kind == kind))).scalars().all())


def trusted(rows: List[ContactChoice]) -> Optional[str]:
    """The value enough organisations agree on, or None."""
    best = max(rows, key=lambda r: len(r.orgs or []), default=None)
    return best.value if best and len(best.orgs or []) >= TRUSTED_PICKS else None


def annotate(options: List[Dict[str, Any]], rows: List[ContactChoice]) -> List[Dict[str, Any]]:
    """Add how many organisations picked each option, and put the most picked first (score breaks ties)."""
    count = {r.value: len(r.orgs or []) for r in rows}
    out = [{**o, "picks": count.get(o["value"], 0)} for o in options]
    return sorted(out, key=lambda o: (-o["picks"], -o["score"]))


async def record(db: AsyncSession, business_id: str, kind: str, value: str) -> int:
    """One organisation's pick. The same organisation picking again changes nothing. Returns how many organisations have picked this value."""
    org = current_org()
    row = (await db.execute(select(ContactChoice).where(ContactChoice.business_id == business_id, ContactChoice.kind == kind, ContactChoice.value == value))).scalars().first()
    if not row:
        row = ContactChoice(business_id=business_id, kind=kind, value=value, picks=0, orgs=[])
        db.add(row)
    if org not in (row.orgs or []):
        row.orgs = [*(row.orgs or []), org]
        row.picks = len(row.orgs)
        row.updated_at = datetime.utcnow()
    await db.commit()
    return len(row.orgs)
