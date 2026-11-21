"""Is the Companies House live stream still delivering? The change report is only as good as this feed, so staff see it in the admin portal and
are emailed once when it goes quiet for a day.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

logger = logging.getLogger("registry_health")

STALE_HOURS = 24
ALERT_DOC = "registry_health_alert"  # app_settings: {"unhealthy": bool, "since": iso}
FEEDS = ("ch_companies", "ch_officers")


def _when(value: Any) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "").split("+")[0])
    except (TypeError, ValueError):
        return None


def health_from(state: Dict[str, Any], key_present: bool, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Pure: the answer from the saved feed state. lastEventAt is the newest of the two streams."""
    now = now or datetime.utcnow()
    times = [t for t in (_when((state.get(f) or {}).get("last_event_at")) for f in FEEDS) if t]
    last = max(times) if times else None
    hours = round((now - last).total_seconds() / 3600, 2) if last else None
    return {"keyPresent": bool(key_present), "lastEventAt": last.isoformat() + "Z" if last else None, "hoursSinceLastEvent": hours,
            "healthy": bool(key_present and hours is not None and hours < STALE_HOURS)}


async def registry_feed_health(now: Optional[datetime] = None) -> Dict[str, Any]:
    from app.services import registry_feeds as RF

    return health_from(await RF.get_state(), (await RF.keys_present()).get("ch_stream", False), now)


async def alert_if_unhealthy() -> Optional[str]:
    """Emails staff once when the feed turns unhealthy (a saved key, but nothing for a day); resets when it recovers. Returns "alerted" or "recovered"."""
    from app.database import AsyncSessionLocal
    from app.models.models import AppSetting
    from app.services.ai_errors import alert_staff

    h = await registry_feed_health()
    bad = bool(h["keyPresent"] and not h["healthy"])  # no key saved is a setup state, not a failure
    async with AsyncSessionLocal() as db:
        row = await db.get(AppSetting, ALERT_DOC)
        was = bool((row.data or {}).get("unhealthy")) if row else False
        if bad == was:
            return None
        data = {"unhealthy": bad, "since": datetime.utcnow().isoformat() + "Z"}
        if row:
            row.data = data
        else:
            db.add(AppSetting(id=ALERT_DOC, data=data))
        await db.commit()
    if bad:
        since = "since it was started" if h["lastEventAt"] is None else f"for {h['hoursSinceLastEvent']} hours"
        await alert_staff("REG-01", f"The Companies House live feed has delivered nothing {since}. The monthly change reports depend on it.", ref="registry_feeds")
        return "alerted"
    return "recovered"
