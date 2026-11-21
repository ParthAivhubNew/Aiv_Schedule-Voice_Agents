"""The FSB demo account: its own organisation, linked to the "FSB" brand, with an Admin called fsbdemo.

Nothing here touches the platform's own organisation (org_default) or any other customer. The account is found by its organisation and
username, or (to move the one older versions created in org_default) by its id plus the demo e-mail address; no other operator is ever changed.
ensure_demo_account runs inside the startup transaction (see core/migrations.py); ensure_demo_data needs the tenancy setup and runs after it.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger("fsb_demo")

ORG_ID = "org_fsb_demo"
ORG_NAME = "Federation of Small Businesses (demo)"
ORG_SLUG = "fsb-demo"
BRAND_NAME = "FSB"
USERNAME = "fsbdemo"
EMAIL = "fsbdemo@outreach.com"
OPERATOR_NAME = "FSB Demo Outreach"
LEGACY_OPERATOR_IDS = ("op_fsboutreach", "op_fsbdemo")  # ids older versions gave the demo account
DEFAULT_PASSWORD = "Fsb@2026"
STARTER_CREDITS = 5000
STARTER_REF = "fsb_demo_starter"  # one grant per wallet, ever: the demo may spend them

BN_DISTRICTS: List[str] = (["BN1", "BN2", "BN3"] + [f"BN{n}" for n in range(5, 19)] + [f"BN{n}" for n in range(20, 28)]
                           + [f"BN{n}" for n in range(41, 45)] + ["BN50"])

DEMO_POLICY: Dict[str, Any] = {
    "exclusions": {"fsb": True, "extra": [], "locked": True},
    "member_suppression": True,
    "geo": {"districts": BN_DISTRICTS},
    "restricted_sources": {"google": True, "apollo": True, "search_engines": True},
    "signin": {"password": True, "google": False, "microsoft": True},
    "screening": {"block_unscreened": True},
}


def demo_password() -> str:
    """FSB_DEMO_PASSWORD, or the published default when the variable is unset (logged as a warning, never the value)."""
    pw = os.environ.get("FSB_DEMO_PASSWORD")
    if pw is None:
        logger.warning("FSB_DEMO_PASSWORD is not set: the FSB demo account uses the default demo password. Set the variable on any server that is not a throwaway.")
        return DEFAULT_PASSWORD
    return pw


async def _ensure_org(conn: AsyncConnection) -> None:
    if (await conn.execute(text("SELECT 1 FROM organizations WHERE id = :i"), {"i": ORG_ID})).first():
        return
    slug = ORG_SLUG
    if (await conn.execute(text("SELECT 1 FROM organizations WHERE slug = :s"), {"s": slug})).first():
        slug = f"{ORG_SLUG}-{uuid.uuid4().hex[:5]}"  # the slug is unique across organisations
    await conn.execute(text("INSERT INTO organizations (id, name, slug, status, created_at, updated_at) "
                            "VALUES (:i, :n, :s, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"), {"i": ORG_ID, "n": ORG_NAME, "s": slug})


async def _ensure_brand(conn: AsyncConnection) -> str:
    """The id of the brand named FSB (made if absent), and the demo organisation linked to it unless staff linked it elsewhere."""
    from app.services.tenant_policy import clean_policy

    brand_id = (await conn.execute(text("SELECT id FROM brands WHERE name = :n ORDER BY created_at LIMIT 1"), {"n": BRAND_NAME})).scalar()
    if not brand_id:
        brand_id = "brd_fsb"
        if (await conn.execute(text("SELECT 1 FROM brands WHERE id = :i"), {"i": brand_id})).first():
            brand_id = f"brd_{uuid.uuid4().hex[:12]}"
        await conn.execute(text(
            "INSERT INTO brands (id, name, display_name, logo_url, accent_color, theme, powered_by, hide_credits, status, policy, created_at, updated_at) "
            "VALUES (:i, :n, 'Federation of Small Businesses', '', '', CAST('{}' AS JSON), TRUE, TRUE, 'active', CAST(:p AS JSON), "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"), {"i": brand_id, "n": BRAND_NAME, "p": json.dumps(clean_policy(DEMO_POLICY))})
    await conn.execute(text("UPDATE organizations SET brand_id = :b WHERE id = :o AND (brand_id IS NULL OR brand_id = '')"), {"b": brand_id, "o": ORG_ID})
    return brand_id


async def _admin_role(conn: AsyncConnection) -> Optional[str]:
    """The demo organisation's Admin role id, made with the same starter roles every new organisation gets."""
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.core.accounts import ensure_system_roles

    try:
        async with AsyncSession(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False) as s:
            roles = await ensure_system_roles(s, ORG_ID)
            await s.commit()
    finally:
        await conn.execute(text("RESET ROLE"))  # once row-level security is on, an app session switches the connection to the app role
    return roles["Admin"].id if "Admin" in roles else None


async def _ensure_operator(conn: AsyncConnection, admin_role_id: Optional[str]) -> str:
    from app.core.security import hash_password, verify_password

    password = demo_password()
    own = (await conn.execute(text("SELECT id FROM operators WHERE org_id = :o AND lower(username) = :u"), {"o": ORG_ID, "u": USERNAME})).scalar()
    # An address another person holds is left alone: the demo account then signs in by username only.
    taken = (await conn.execute(text("SELECT 1 FROM operators WHERE lower(email) = :e AND id <> :me"), {"e": EMAIL, "me": own or ""})).first()
    legacy = None
    if not own:
        legacy = (await conn.execute(text(
            "SELECT id FROM operators WHERE lower(email) = :e AND (id = ANY(:ids) OR lower(username) = :u) "
            "ORDER BY (id = 'op_fsboutreach') DESC, id LIMIT 1"), {"e": EMAIL, "ids": list(LEGACY_OPERATOR_IDS), "u": USERNAME})).scalar()
    op_id = own or legacy
    held = (await conn.execute(text("SELECT hashed_password FROM operators WHERE id = :i"), {"i": op_id})).scalar() if op_id else None
    # A password that already matches is not re-hashed, so running this again changes nothing.
    pw = held if held and verify_password(password, held)[0] else hash_password(password)
    fields = {"pw": pw, "o": ORG_ID, "u": USERNAME, "n": OPERATOR_NAME}
    if op_id:
        # Moving the older demo account keeps its id and its e-mail, so the same login lands in the demo organisation.
        await conn.execute(text("UPDATE operators SET org_id = :o, username = :u, name = :n, role = 'Admin', hashed_password = :pw, is_active = TRUE, "
                                "must_change_password = FALSE, email_verified = TRUE WHERE id = :id"), {**fields, "id": op_id})
        if not own:
            await conn.execute(text("UPDATE operators SET email = :e WHERE id = :id"), {"e": EMAIL, "id": op_id})
    else:
        op_id = "op_fsbdemo"
        if (await conn.execute(text("SELECT 1 FROM operators WHERE id = :i"), {"i": op_id})).first():
            op_id = f"op_fsbdemo_{uuid.uuid4().hex[:8]}"
        await conn.execute(text(
            "INSERT INTO operators (id, org_id, username, email, name, role, hashed_password, is_active, must_change_password, email_verified, created_at) "
            "VALUES (:id, :o, :u, :e, :n, 'Admin', :pw, TRUE, FALSE, TRUE, CURRENT_TIMESTAMP)"),
            {**fields, "id": op_id, "e": None if taken else EMAIL})
        if taken:
            logger.warning("FSB demo account: the demo e-mail address belongs to another user, so the demo signs in by the username fsbdemo only.")
    if admin_role_id:
        await conn.execute(text("DELETE FROM operator_roles WHERE operator_id = :i"), {"i": op_id})
        await conn.execute(text("INSERT INTO operator_roles (operator_id, role_id) VALUES (:i, :r)"), {"i": op_id, "r": admin_role_id})
    return op_id


async def ensure_demo_account(conn: AsyncConnection) -> Dict[str, str]:
    """Creates what is missing: the organisation, the FSB brand and its link, the Admin role and the demo operator. Safe to repeat.
    The caller wraps it in a savepoint when a failure must not stop the caller's transaction."""
    await _ensure_org(conn)
    brand_id = await _ensure_brand(conn)
    role_id = await _admin_role(conn)
    op_id = await _ensure_operator(conn, role_id)
    return {"org_id": ORG_ID, "brand_id": brand_id, "operator_id": op_id}


async def ensure_demo_data() -> bool:
    """The demo organisation's company profile and starting credits (5,000 in each wallet, once: credits on a wallet are what opens its app,
    the same rule as for any customer). Needs the tenancy setup, so it runs after it. False when the organisation does not exist."""
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import CompanyProfile, Organization
    from app.services import credits as K

    with org_scope(ORG_ID):
        async with AsyncSessionLocal() as s:
            if not await s.get(Organization, ORG_ID):
                return False
            if not (await s.execute(select(CompanyProfile.id).where(CompanyProfile.id == "default"))).first():
                s.add(CompanyProfile(id="default", name=ORG_NAME, website="", social="", pitch="", industry="", send_approval=True))
                await s.flush()
            if not (await K._get_doc(s, K._settings_id(ORG_ID))).get("tracking_since"):
                from datetime import datetime

                await K.set_org_settings(s, {"enforce": True}, ORG_ID)
                doc = await K._get_doc(s, K._settings_id(ORG_ID))
                doc["tracking_since"] = datetime.utcnow().isoformat()
                await K._put_doc(s, K._settings_id(ORG_ID), doc)
            for wallet in K.WALLETS:
                await K.add_credits(s, wallet, STARTER_CREDITS, source="grant", note="FSB demo starting credits", by="Demo setup", ref=STARTER_REF)
            await s.commit()
    return True
