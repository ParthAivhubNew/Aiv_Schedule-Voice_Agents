"""The FSB organisation (org_fsb_demo): once a demo that code made with its own logins, now FSB's real company.

Nothing here makes, changes or signs in a login any more. fsbadmin and fsbuser are ordinary users of the FSB company, managed by its admin under
Team like any other company's people. A new database gets no FSB organisation at all: staff create customers and demo organisations.

What is left are data steps for databases that once held the demo (each runs once, from core/migrations.py, and only touches the FSB
organisation and brand):
- open_up_postcodes: clears the first demo brand's BN-only postcode lock.
- remove_starter_credits: takes back the free credits the first demo setup gave.
- become_real_company: renames "Federation of Small Businesses (demo)" to the real company name. Users, roles, data and credits are left alone.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger("fsb_demo")

ORG_ID = "org_fsb_demo"  # kept: it is the key on every row of FSB's data, its credit wallets and the row-level security
DEMO_NAME = "Federation of Small Businesses (demo)"
DEMO_SLUG = "fsb-demo"
REAL_NAME = "Federation of Small Businesses"
REAL_SLUG = "fsb"
BRAND_NAME = "FSB"
STARTER_REF = "fsb_demo_starter"

BN_DISTRICTS: List[str] = (["BN1", "BN2", "BN3"] + [f"BN{n}" for n in range(5, 19)] + [f"BN{n}" for n in range(20, 28)]
                           + [f"BN{n}" for n in range(41, 45)] + ["BN50"])

# The rules the FSB brand was set up with. Reference only: the live rules are the brand's own (admin portal) and nothing writes this.
FSB_BRAND_POLICY: Dict[str, Any] = {
    "exclusions": {"fsb": True, "extra": [], "locked": True},
    "member_suppression": True,
    "geo": {"districts": []},  # FSB is national: no area lock. An admin limits a person to chosen districts in Data access
    "restricted_sources": {"google": True, "apollo": True, "search_engines": True},
    "signin": {"password": True, "google": False, "microsoft": True},
    "screening": {"block_unscreened": True},
}


async def open_up_postcodes(conn: AsyncConnection) -> None:
    """FSB covers every postcode. The first version of the demo brand locked it to the 30 BN districts: clear that lock, but only when it
    is still exactly that list (a lock staff chose themselves is left alone)."""
    row = (await conn.execute(text("SELECT id, policy FROM brands WHERE name = :n ORDER BY created_at LIMIT 1"), {"n": BRAND_NAME})).first()
    if not row:
        return
    policy = row[1] if isinstance(row[1], dict) else json.loads(row[1] or "{}")
    geo = (policy.get("geo") or {}).get("districts") or []
    if sorted(geo) == sorted(BN_DISTRICTS):
        policy["geo"] = {**(policy.get("geo") or {}), "districts": []}
        await conn.execute(text("UPDATE brands SET policy = CAST(:p AS JSON), updated_at = CURRENT_TIMESTAMP WHERE id = :i"), {"p": json.dumps(policy), "i": row[0]})


async def remove_starter_credits(conn: AsyncConnection) -> None:
    """The first demo setup gave each wallet 5,000 free credits, which opened every app without a purchase. Take back what is left of them
    (a grant nobody touched is removed from the history; a part-spent one is zeroed and the spending stays) and show the credit balance on the FSB brand."""
    import uuid

    rows = (await conn.execute(text(
        "SELECT id, wallet, remaining, amount FROM credit_grants WHERE org_id = :o AND ref = :r AND remaining > 0"), {"o": ORG_ID, "r": STARTER_REF})).all()
    for gid, wallet, remaining, amount in rows:
        if remaining == amount:
            # Never touched: remove it as if it had not been given, so the history starts clean.
            await conn.execute(text("DELETE FROM credit_grants WHERE id = :i"), {"i": gid})
            await conn.execute(text("DELETE FROM credit_ledger WHERE org_id = :o AND ref = :r AND wallet = :w AND kind = 'grant'"), {"o": ORG_ID, "r": STARTER_REF, "w": wallet})
            continue
        await conn.execute(text("UPDATE credit_grants SET remaining = 0 WHERE id = :i"), {"i": gid})
        await conn.execute(text(
            "INSERT INTO credit_ledger (org_id, id, kind, wallet, item, quantity, amount, ref, note, by, created_at, payer_org_id) "
            "VALUES (:o, :i, 'adjust', :w, '', 0, :a, NULL, 'FSB demo starting credits taken back', 'Demo setup', CURRENT_TIMESTAMP, :o)"),
            {"o": ORG_ID, "i": f"cr_{uuid.uuid4().hex[:14]}", "w": wallet, "a": -int(remaining)})
    await conn.execute(text("UPDATE brands SET hide_credits = FALSE WHERE name = :n AND hide_credits = TRUE"), {"n": BRAND_NAME})


async def become_real_company(conn: AsyncConnection) -> Dict[str, bool]:
    """The FSB organisation stops being a demo: its name loses "(demo)", its slug becomes "fsb" when no other organisation holds it, and its
    company profile is renamed the same way. Only a value that is still the demo's own is changed, so a name staff or FSB chose is kept.
    No login, role, lead, credit or setting is touched. Returns what changed."""
    out = {"name": False, "slug": False, "profile": False}
    row = (await conn.execute(text("SELECT name, slug FROM organizations WHERE id = :i"), {"i": ORG_ID})).first()
    if not row:
        return out
    if row[0] == DEMO_NAME:
        await conn.execute(text("UPDATE organizations SET name = :n, updated_at = CURRENT_TIMESTAMP WHERE id = :i"), {"n": REAL_NAME, "i": ORG_ID})
        out["name"] = True
    if row[1] == DEMO_SLUG and not (await conn.execute(text("SELECT 1 FROM organizations WHERE slug = :s AND id <> :i"), {"s": REAL_SLUG, "i": ORG_ID})).first():
        await conn.execute(text("UPDATE organizations SET slug = :s, updated_at = CURRENT_TIMESTAMP WHERE id = :i"), {"s": REAL_SLUG, "i": ORG_ID})
        out["slug"] = True
    res = await conn.execute(text("UPDATE company_profile SET name = :n WHERE org_id = :o AND name = :d"), {"n": REAL_NAME, "o": ORG_ID, "d": DEMO_NAME})
    out["profile"] = bool(res.rowcount)
    if any(out.values()):
        logger.info(f"FSB organisation is now a real company: {out}")
    return out
