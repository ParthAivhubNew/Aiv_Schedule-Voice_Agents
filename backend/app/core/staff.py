"""Staff (admin portal) sign-in: password + mandatory TOTP two-factor, separate tokens.

Staff tokens have their own type ("staff"), so a client token can never open the admin API
and a staff token can never open the client app.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import struct
import time
from typing import Optional
from urllib.parse import quote

STAFF_TTL_S = 8 * 3600
SETUP_TTL_S = 10 * 60
ISSUER = "OutReach by Aivhub Staff"


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _hotp(secret_b32: str, counter: int) -> str:
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{code:06d}"


def totp_now(secret_b32: str, at: Optional[float] = None) -> str:
    return _hotp(secret_b32, int((at or time.time()) // 30))


def verify_totp(secret_b32: str, code: str, at: Optional[float] = None) -> bool:
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(code) != 6 or not secret_b32:
        return False
    step = int((at or time.time()) // 30)
    return any(hmac.compare_digest(_hotp(secret_b32, step + d), code) for d in (-1, 0, 1))


def otpauth_uri(secret_b32: str, email: str) -> str:
    return f"otpauth://totp/{quote(ISSUER)}:{quote(email)}?secret={secret_b32}&issuer={quote(ISSUER)}&digits=6&period=30"


def staff_token(staff_id: str, role: str) -> str:
    from app.core.security import _encode

    return _encode({"sub": staff_id, "role": role, "typ": "staff"}, STAFF_TTL_S)


def setup_ticket(staff_id: str) -> str:
    from app.core.security import _encode

    return _encode({"sub": staff_id, "typ": "staff_setup"}, SETUP_TTL_S)


async def ensure_bootstrap_staff() -> None:
    """First staff admin from STAFF_ADMIN_EMAIL / STAFF_ADMIN_PASSWORD when configured."""
    import uuid

    from sqlalchemy import func
    from sqlalchemy.future import select

    from app.core.security import hash_password, password_problem
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import StaffUser

    email = os.getenv("STAFF_ADMIN_EMAIL", "").strip().lower()
    password = os.getenv("STAFF_ADMIN_PASSWORD", "")
    if not email or not password or password_problem(password):
        return
    with system_scope():
        async with AsyncSessionLocal() as db:
            existing = (await db.execute(select(StaffUser).where(func.lower(StaffUser.email) == email))).scalars().first()
            if existing:
                existing.hashed_password = hash_password(password)
                existing.is_active = True
                await db.commit()
                return
            db.add(StaffUser(id=f"stf_{uuid.uuid4().hex[:10]}", email=email, name="Staff admin", role="staff_admin",
                             hashed_password=hash_password(password)))
            await db.commit()
