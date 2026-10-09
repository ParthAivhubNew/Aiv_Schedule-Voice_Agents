"""The once-a-minute round for the public API (runs inside the app's publish round, per company)."""
from __future__ import annotations


async def tick(db, now_ms: float, due_of) -> None:
    from app.public_api import email_events, social_events

    await social_events.tick(db, now_ms, due_of)
    await email_events.tick(db)
