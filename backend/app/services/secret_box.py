"""Encrypt secrets at rest in Connection.config (and similar JSON blobs).

Uses Fernet (AES) keyed from settings.SECRET_KEY. Values are stored as
`enc:v1:<token>`. Plaintext leftovers still open for migration; new writes seal.
API responses must use public_config() so raw secrets never leave the server.
"""
from __future__ import annotations

import base64
import hashlib
import logging
from typing import Any, Dict, Iterable, Optional

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

logger = logging.getLogger("secret_box")

_PREFIX = "enc:v1:"

# Fields sealed inside Connection.config / provider blobs
SECRET_FIELD_NAMES = frozenset({
    "api_key", "apiKey", "auth_token", "authToken",
    "signing_secret", "signingSecret", "webhook_secret", "webhookSecret",
    "smtp_password", "smtpPassword", "password",
    "client_secret", "clientSecret", "token_secret", "tokenSecret",
    "access_token", "accessToken", "refresh_token", "refreshToken",
    "secret", "private_key", "privateKey",
    "consumerSecret", "accessTokenSecret",
})


def _fernet() -> Fernet:
    raw = (settings.SECRET_KEY or "aivhub-secret-key-change-in-production-2026").encode("utf-8")
    digest = hashlib.sha256(raw).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def is_sealed(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(_PREFIX)


def is_masked(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    t = value.strip()
    if not t:
        return False
    return "•" in t or "…" in t or t.lower() in ("redacted", "masked")


def mask_secret(plain: Optional[str]) -> str:
    text = (plain or "").strip()
    if not text:
        return ""
    if is_masked(text):
        return text
    opened = open_secret(text) if is_sealed(text) else text
    if not opened:
        return "••••••••"
    if len(opened) > 12:
        return opened[:4] + "••••••••" + opened[-4:]
    if len(opened) > 8:
        return opened[:3] + "••••••••" + opened[-4:]
    return "••••••••"


def reject_if_masked(value: Optional[str]) -> str:
    """Drop browser placeholders / ciphertext so callers fall back to DB secrets."""
    text = (value or "").strip()
    if not text or is_masked(text) or is_sealed(text):
        return ""
    return text


def seal_secret(plain: Optional[str]) -> str:
    text = (plain or "").strip()
    if not text:
        return ""
    if is_sealed(text) or is_masked(text):
        return text
    token = _fernet().encrypt(text.encode("utf-8")).decode("ascii")
    return _PREFIX + token


def open_secret(value: Optional[str]) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    if is_masked(text):
        return ""
    if not is_sealed(text):
        return text
    blob = text[len(_PREFIX):]
    try:
        return _fernet().decrypt(blob.encode("ascii")).decode("utf-8")
    except (InvalidToken, Exception) as err:
        logger.warning("Failed to decrypt sealed secret: %s", err)
        return ""


def seal_config(cfg: Optional[Dict[str, Any]], extra_keys: Iterable[str] = ()) -> Dict[str, Any]:
    data = dict(cfg or {})
    keys = set(SECRET_FIELD_NAMES) | {k for k in extra_keys if k}
    for k in list(data.keys()):
        if k not in keys:
            continue
        v = data.get(k)
        if isinstance(v, str) and v.strip() and not is_masked(v):
            data[k] = seal_secret(v)
    return data


def open_config(cfg: Optional[Dict[str, Any]], extra_keys: Iterable[str] = ()) -> Dict[str, Any]:
    data = dict(cfg or {})
    keys = set(SECRET_FIELD_NAMES) | {k for k in extra_keys if k}
    for k in list(data.keys()):
        if k not in keys:
            continue
        v = data.get(k)
        if isinstance(v, str) and v.strip():
            data[k] = open_secret(v)
    return data


def public_config(cfg: Optional[Dict[str, Any]], extra_keys: Iterable[str] = ()) -> Dict[str, Any]:
    """Strip or mask secrets for any response that might reach a browser."""
    data = dict(cfg or {})
    keys = set(SECRET_FIELD_NAMES) | {k for k in extra_keys if k}
    out: Dict[str, Any] = {}
    for k, v in data.items():
        if k in keys:
            if isinstance(v, str) and v.strip():
                plain = open_secret(v) if is_sealed(v) else ("" if is_masked(v) else v)
                if plain:
                    out[k] = mask_secret(plain)
                    out[f"has_{k}"] = True
                else:
                    out[k] = "••••••••" if v else None
                    if v:
                        out[f"has_{k}"] = True
            else:
                out[k] = None
            continue
        out[k] = v
    return out


def config_get_secret(cfg: Optional[Dict[str, Any]], *names: str) -> str:
    data = cfg if isinstance(cfg, dict) else {}
    for name in names:
        if name in data and data.get(name):
            return open_secret(str(data.get(name) or ""))
    return ""


async def migrate_seal_all_connections(db) -> int:
    """Re-seal any plaintext secrets still sitting in Connection.config rows."""
    from sqlalchemy.future import select
    from app.models.models import Connection

    res = await db.execute(select(Connection))
    rows = list(res.scalars().all())
    changed = 0
    for c in rows:
        cfg = c.config if isinstance(c.config, dict) else None
        if not cfg:
            continue
        sealed = seal_config(cfg)
        if sealed != cfg:
            c.config = sealed
            changed += 1
            if not c.api_key_masked:
                plain = config_get_secret(sealed, "api_key", "auth_token", "signing_secret")
                if plain:
                    c.api_key_masked = mask_secret(plain)
    if changed:
        await db.commit()
    return changed


async def migrate_seal_column_secrets(db) -> int:
    """Seal plaintext secrets stored in dedicated columns (Cal.com, OAuth, social)."""
    from sqlalchemy.future import select
    from app.models.models import CalcomSetting, SocialAccount, SocialOAuthApp

    changed = 0

    try:
        st = (await db.execute(select(CalcomSetting))).scalars().first()
        if st and st.api_key and not is_sealed(st.api_key) and not is_masked(st.api_key):
            st.api_key = seal_secret(st.api_key)
            changed += 1
    except Exception as err:
        logger.debug("Calcom seal migrate skip: %s", err)

    try:
        for app in (await db.execute(select(SocialOAuthApp))).scalars().all():
            if app.client_secret and not is_sealed(app.client_secret) and not is_masked(app.client_secret):
                app.client_secret = seal_secret(app.client_secret)
                changed += 1
    except Exception as err:
        logger.debug("OAuth seal migrate skip: %s", err)

    try:
        for acc in (await db.execute(select(SocialAccount))).scalars().all():
            dirty = False
            for attr in ("access_token", "refresh_token", "token_secret"):
                val = getattr(acc, attr, None) or ""
                if val and not is_sealed(val) and not is_masked(val):
                    setattr(acc, attr, seal_secret(val))
                    dirty = True
            extra = acc.extra if isinstance(acc.extra, dict) else {}
            if extra:
                sealed_extra = seal_config(extra)
                if sealed_extra != extra:
                    acc.extra = sealed_extra
                    dirty = True
            if dirty:
                changed += 1
    except Exception as err:
        logger.debug("Social account seal migrate skip: %s", err)

    if changed:
        await db.commit()
    return changed
