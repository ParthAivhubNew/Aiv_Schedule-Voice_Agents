"""Numbered schema/data steps that run once each, in order, at startup.

Base.metadata.create_all creates new tables; these steps change existing ones (new columns,
data fixes). Each step is recorded in schema_migrations and never runs again. Steps only add:
no drops or renames while running code may still use the old shape.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Awaitable, Callable, List, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger("migrations")

Step = Callable[[AsyncConnection], Awaitable[None]]


async def _operators_auth_columns(conn: AsyncConnection) -> None:
    for col, typ in (
        ("is_active", "BOOLEAN DEFAULT TRUE"),
        ("must_change_password", "BOOLEAN DEFAULT FALSE"),
        ("password_changed_at", "TIMESTAMP"),
        ("last_login_at", "TIMESTAMP"),
    ):
        await conn.execute(text(f"ALTER TABLE operators ADD COLUMN IF NOT EXISTS {col} {typ}"))
    await conn.execute(text("UPDATE operators SET is_active = TRUE WHERE is_active IS NULL"))
    await conn.execute(text("UPDATE operators SET must_change_password = FALSE WHERE must_change_password IS NULL"))


async def _hash_plain_passwords(conn: AsyncConnection) -> None:
    """No password stays in plain text. Weak old defaults must be changed at next sign-in."""
    from app.core.security import hash_password, is_hashed, is_weak_legacy

    rows = (await conn.execute(text("SELECT id, hashed_password FROM operators"))).all()
    for op_id, stored in rows:
        if is_hashed(stored):
            continue
        weak = is_weak_legacy(stored)
        await conn.execute(
            text("UPDATE operators SET hashed_password = :h, must_change_password = :m WHERE id = :i"),
            {"h": hash_password(stored or "password"), "m": bool(weak), "i": op_id},
        )
    if rows:
        logger.info("Hashed any plain-text operator passwords.")


async def _system_roles(conn: AsyncConnection) -> None:
    """Starter roles for the default organisation and a role for every existing user."""
    from app.core.permissions import SYSTEM_ROLES
    import json

    now = datetime.utcnow()
    ids = {}
    for name, spec in SYSTEM_ROLES.items():
        role_id = f"role_default_{name.lower()}"
        ids[name] = role_id
        await conn.execute(
            text(
                "INSERT INTO roles (id, org_id, name, description, is_admin, is_system, levels, created_at, updated_at) "
                "VALUES (:id, 'org_default', :name, :d, :a, TRUE, CAST(:lv AS JSON), :now, :now) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": role_id, "name": name, "d": spec["description"], "a": spec["is_admin"], "lv": json.dumps(spec["levels"]), "now": now},
        )
    ops = (await conn.execute(text("SELECT id, role FROM operators"))).all()
    for op_id, role in ops:
        name = (role or "").strip().title()
        role_id = ids.get(name) or ids["Operator"]
        await conn.execute(
            text("INSERT INTO operator_roles (operator_id, role_id) VALUES (:o, :r) ON CONFLICT DO NOTHING"),
            {"o": op_id, "r": role_id},
        )


async def _meeting_lunch_columns(conn: AsyncConnection) -> None:
    await conn.execute(text("ALTER TABLE calcom_settings ADD COLUMN IF NOT EXISTS lunch_start VARCHAR DEFAULT '12:00'"))
    await conn.execute(text("ALTER TABLE calcom_settings ADD COLUMN IF NOT EXISTS lunch_end VARCHAR DEFAULT '13:00'"))


STEPS: List[Tuple[str, Step]] = [
    ("2026_10_01_operators_auth_columns", _operators_auth_columns),
    ("2026_10_01_hash_plain_passwords", _hash_plain_passwords),
    ("2026_10_01_system_roles", _system_roles),
    ("2026_10_02_meeting_lunch_columns", _meeting_lunch_columns),
]


async def run_migrations(conn: AsyncConnection) -> None:
    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR PRIMARY KEY, applied_at TIMESTAMP NOT NULL)"
    ))
    done = {r[0] for r in (await conn.execute(text("SELECT id FROM schema_migrations"))).all()}
    for step_id, step in STEPS:
        if step_id in done:
            continue
        logger.info(f"Applying migration {step_id}")
        await step(conn)
        await conn.execute(
            text("INSERT INTO schema_migrations (id, applied_at) VALUES (:i, :t)"),
            {"i": step_id, "t": datetime.utcnow()},
        )
