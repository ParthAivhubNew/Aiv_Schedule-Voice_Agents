"""How long a signed-in client session may sit idle and how long it may last in total.
Staff set both in the admin portal; they apply to every client sign-in."""
from __future__ import annotations

from typing import Any, Dict

from app.core.security import SESSION_MAX_S

DOC = "session_policy"
IDLE_RANGE = (5, 480)      # minutes
MAX_RANGE = (1, 168)       # hours
DEFAULT_IDLE_MINUTES = 30


def _clamp(value: Any, low: int, high: int, default: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, n))


def normalise(raw: Dict[str, Any] | None) -> Dict[str, int]:
    raw = raw or {}
    return {
        "idle_minutes": _clamp(raw.get("idle_minutes"), *IDLE_RANGE, DEFAULT_IDLE_MINUTES),
        "max_hours": _clamp(raw.get("max_hours"), *MAX_RANGE, max(1, SESSION_MAX_S // 3600)),
    }


async def platform_policy(db) -> Dict[str, int]:
    from app.services.credits import _get_doc

    return normalise(await _get_doc(db, DOC))


async def org_choice(db, org_id: str) -> Dict[str, int | None]:
    """What an organisation's admin picked, or None for a value they left to the platform."""
    from app.services.credits import _get_doc

    raw = await _get_doc(db, f"{DOC}:{org_id}")
    return {"idle_minutes": raw.get("idle_minutes"), "max_hours": raw.get("max_hours")}


async def get_policy(db, org_id: str | None = None) -> Dict[str, int]:
    """What applies: the platform's limits, made stricter (never looser) by the organisation's own choice."""
    base = await platform_policy(db)
    if not org_id:
        return base
    mine = await org_choice(db, org_id)
    return {
        "idle_minutes": min(base["idle_minutes"], int(mine["idle_minutes"])) if mine["idle_minutes"] else base["idle_minutes"],
        "max_hours": min(base["max_hours"], int(mine["max_hours"])) if mine["max_hours"] else base["max_hours"],
    }


async def save_policy(db, idle_minutes: int, max_hours: int) -> Dict[str, int]:
    from app.services.credits import _put_doc

    policy = normalise({"idle_minutes": idle_minutes, "max_hours": max_hours})
    await _put_doc(db, DOC, policy)
    return policy


async def save_org_choice(db, org_id: str, idle_minutes: int | None, max_hours: int | None) -> Dict[str, int | None]:
    """An organisation admin's own limits, held within the platform's. Empty means "use the platform's"."""
    from app.services.credits import _put_doc

    base = await platform_policy(db)
    choice = {
        "idle_minutes": _clamp(idle_minutes, IDLE_RANGE[0], base["idle_minutes"], base["idle_minutes"]) if idle_minutes else None,
        "max_hours": _clamp(max_hours, MAX_RANGE[0], base["max_hours"], base["max_hours"]) if max_hours else None,
    }
    await _put_doc(db, f"{DOC}:{org_id}", choice)
    return choice
