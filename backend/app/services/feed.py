"""In-app notes for the bell at the top right: what happened to posts, comments, videos, reports and bookings.

The caller's session commits them with the rest of its work, so a note never exists for something that
was rolled back. Email for the same events is separate (app.core.notify).
"""
from __future__ import annotations

import uuid

from app.models.models import Notification


def add(db, text: str, kind: str = "info") -> None:
    """kind: success, alert or info."""
    db.add(Notification(id=f"n_{uuid.uuid4().hex[:8]}", text=" ".join(str(text).split())[:300], type=kind, time="Just now"))


def plural(n: int, one: str, many: str = "") -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"
