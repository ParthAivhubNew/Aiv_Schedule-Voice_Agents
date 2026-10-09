"""Links a customer's people open without signing in (preview pages) and links that fix a setup problem."""
from __future__ import annotations

import time
from typing import Any, Dict, Optional

PREVIEW_TTL_S = 10 * 24 * 3600  # preview links work for 10 days


def public_base() -> str:
    from app.services.media_store import public_base_from_request

    return (public_base_from_request(None) or "").rstrip("/")


def make_token(kind: str, object_id: str, org_id: str, ttl_s: int = PREVIEW_TTL_S) -> str:
    """A signed, expiring token that stands for one object in one organisation."""
    from app.services import approval_mail

    return approval_mail.sign({"k": kind, "i": object_id, "o": org_id, "x": int(time.time()) + ttl_s})


def read_token(token: str, kind: str) -> Optional[Dict[str, Any]]:
    from app.services import approval_mail

    data = approval_mail.verify(token)
    if not data or data.get("k") != kind or not data.get("i") or not data.get("o"):
        return None
    return data


def preview_url(kind: str, object_id: str, org_id: str) -> str:
    return f"{public_base()}/api/p/{make_token(kind, object_id, org_id)}"


def fix_url(topic: str = "") -> str:
    """Where in the app a person can fix a setup problem (connect a channel, top up, add a mailbox)."""
    return f"{public_base()}/"
