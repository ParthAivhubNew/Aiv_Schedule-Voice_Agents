"""The audit log: one short row for every action a customer may have to prove (who, what, when).

    await audit.record(db, "policy.changed", target="brd_fsb", detail={"locked": True}, actor_id=op_id, actor_name=name)

The caller commits. A failure to write the row is logged and never breaks the action it describes.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from app.models.models import AuditLog

logger = logging.getLogger(__name__)

_SECRET_WORDS = ("password", "secret", "token", "api_key", "apikey", "authorization")


def _clean(detail: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Small facts only: secrets are dropped and long text is cut."""
    out: Dict[str, Any] = {}
    for k, v in (detail or {}).items():
        if any(w in str(k).lower() for w in _SECRET_WORDS):
            continue
        out[str(k)[:60]] = v[:300] if isinstance(v, str) else v
    return out


async def record(db, action: str, *, target: str = "", detail: Optional[Dict[str, Any]] = None, actor_id: str = "", actor_name: str = "") -> None:
    try:
        db.add(AuditLog(action=str(action)[:80], target=str(target or "")[:200], detail=_clean(detail), actor_id=str(actor_id or "")[:80],
                        actor_name=str(actor_name or "")[:120]))
        await db.flush()
    except Exception as err:
        logger.warning(f"[audit] could not write {action}: {err}")


async def recent(db, *, action: str = "", limit: int = 100) -> List[Dict[str, Any]]:
    q = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(max(1, min(int(limit), 500)))
    if action:
        q = q.where(AuditLog.action.like(f"{action}%"))
    return [{"id": r.id, "action": r.action, "target": r.target, "detail": r.detail or {}, "actor_id": r.actor_id, "actor_name": r.actor_name,
             "at": r.created_at.isoformat() + "Z" if r.created_at else None} for r in (await db.execute(q)).scalars().all()]
