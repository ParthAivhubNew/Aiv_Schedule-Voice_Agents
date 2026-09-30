"""Passwords, signed login tokens and the signing key.

- Passwords are stored as bcrypt hashes. Old rows that still hold a plain-text password are
  accepted once and upgraded to a hash on that login; a known weak one ("password", the old
  default) also forces the user to pick a new password before doing anything else.
- Access tokens are short-lived signed JWTs. Refresh tokens are long-lived JWTs whose id is
  stored in auth_sessions, so logging out (or an admin disabling a user) revokes them.
- The signing key comes from SECRET_KEY. When SECRET_KEY is missing or still the public
  default from the code, a random key is generated once and kept in the database, so tokens
  can never be forged from a key that is visible in the repository.
"""
from __future__ import annotations

import hmac
import logging
import os
import secrets
import time
import uuid
from typing import Any, Dict, Optional, Tuple

import bcrypt
from jose import JWTError, jwt

from app.config import settings

logger = logging.getLogger("security")

ALGORITHM = "HS256"
ACCESS_TTL_S = int(os.getenv("ACCESS_TOKEN_TTL_SECONDS", str(60 * 60)))  # 1 hour
REFRESH_TTL_S = int(os.getenv("REFRESH_TOKEN_TTL_SECONDS", str(30 * 24 * 3600)))  # 30 days
MIN_PASSWORD_LEN = 8

# Values that used to be written into operators.hashed_password by the old code.
WEAK_LEGACY_PASSWORDS = {"", "password", "mock_hashed_password"}
PUBLIC_DEFAULT_KEYS = {
    "",
    "outreachAI-secret-key-change-in-production-2026",
    "change-me",
    "changeme",
    "secret",
}

_signing_key: Optional[str] = None


# ── Passwords ──────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("ascii")


def is_hashed(stored: Optional[str]) -> bool:
    return bool(stored) and str(stored).startswith(("$2a$", "$2b$", "$2y$"))


def verify_password(password: str, stored: Optional[str]) -> Tuple[bool, bool]:
    """Returns (ok, needs_upgrade). needs_upgrade is True for a legacy plain-text match."""
    stored = stored or ""
    if is_hashed(stored):
        try:
            return bcrypt.checkpw(password.encode("utf-8"), stored.encode("ascii")), False
        except ValueError:
            return False, False
    # Legacy plain text: constant-time compare, then the caller re-hashes it.
    ok = hmac.compare_digest(password.encode("utf-8"), stored.encode("utf-8"))
    return ok, ok


def is_weak_legacy(stored: Optional[str]) -> bool:
    return not is_hashed(stored) and (stored or "") in WEAK_LEGACY_PASSWORDS


def password_problem(password: str) -> Optional[str]:
    """None when the password is acceptable, else a message for the user."""
    p = password or ""
    if len(p) < MIN_PASSWORD_LEN:
        return f"Use at least {MIN_PASSWORD_LEN} characters."
    if p.lower() in WEAK_LEGACY_PASSWORDS or p.lower() in ("12345678", "password1", "qwerty123"):
        return "That password is too easy to guess."
    return None


def temporary_password() -> str:
    return secrets.token_urlsafe(9)


# ── Signing key ────────────────────────────────────────────────────────────

def set_signing_key(key: str) -> None:
    global _signing_key
    _signing_key = key


def signing_key() -> str:
    if _signing_key:
        return _signing_key
    # Before startup has resolved the key (tests, scripts): fall back to SECRET_KEY.
    return settings.SECRET_KEY or "unset"


def configured_key_is_public() -> bool:
    return (settings.SECRET_KEY or "") in PUBLIC_DEFAULT_KEYS or len(settings.SECRET_KEY or "") < 16


async def resolve_signing_key() -> None:
    """Use SECRET_KEY when it is a real secret; otherwise a random key stored in app_settings."""
    if not configured_key_is_public():
        set_signing_key(settings.SECRET_KEY)
        return
    from sqlalchemy.future import select

    from app.database import AsyncSessionLocal
    from app.models.models import AppSetting

    async with AsyncSessionLocal() as db:
        row = (await db.execute(select(AppSetting).where(AppSetting.id == "auth_signing_key"))).scalars().first()
        if row and (row.data or {}).get("key"):
            set_signing_key(row.data["key"])
            return
        key = secrets.token_urlsafe(48)
        db.add(AppSetting(id="auth_signing_key", data={"key": key}))
        await db.commit()
        set_signing_key(key)
        logger.warning(
            "SECRET_KEY is missing or is the public default from the code. A random signing key "
            "was generated and stored in the database. Set SECRET_KEY in the environment."
        )


# ── Tokens ─────────────────────────────────────────────────────────────────

def _encode(claims: Dict[str, Any], ttl_s: int) -> str:
    now = int(time.time())
    body = {**claims, "iat": now, "exp": now + ttl_s}
    return jwt.encode(body, signing_key(), algorithm=ALGORITHM)


def create_access_token(operator_id: str, org_id: str, role: str, session_id: str) -> str:
    return _encode({"sub": operator_id, "org": org_id, "role": role, "sid": session_id, "typ": "access"}, ACCESS_TTL_S)


def create_refresh_token(operator_id: str, session_id: str) -> str:
    return _encode({"sub": operator_id, "sid": session_id, "typ": "refresh", "jti": uuid.uuid4().hex}, REFRESH_TTL_S)


def decode_token(token: str, expected_type: str) -> Optional[Dict[str, Any]]:
    try:
        claims = jwt.decode(token, signing_key(), algorithms=[ALGORITHM])
    except JWTError:
        return None
    if claims.get("typ") != expected_type or not claims.get("sub"):
        return None
    return claims
