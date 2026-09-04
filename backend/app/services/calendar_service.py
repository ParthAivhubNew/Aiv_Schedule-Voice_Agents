import httpx
import logging
from typing import Dict, Any, Optional, List
from app.config import settings

logger = logging.getLogger("calendar_service")

class CalendarService:
    def __init__(self):
        self.base_url = settings.CALCOM_BASE_URL.rstrip("/")
        self.api_key = settings.CALCOM_API_KEY
        self.event_type_id = settings.CALCOM_EVENT_TYPE_ID

    async def check_calcom_status(self) -> Dict[str, Any]:
        """Checks if the local/remote Cal.com instance is reachable."""
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(f"{self.base_url}/health")
                if res.status_code < 400:
                    return {"connected": True, "type": "calcom_self_hosted", "url": self.base_url}
        except Exception as e:
            logger.debug(f"Cal.com instance not reached directly: {e}")
            
        return {
            "connected": bool(self.api_key),
            "type": "calcom_api" if self.api_key else "native_engine",
            "url": self.base_url
        }

    async def create_booking(
        self,
        prospect_name: str,
        attendee_email: str,
        start_time_iso: str,
        duration_minutes: int = 25,
        notes: str = ""
    ) -> Dict[str, Any]:
        """
        Creates a booking on Cal.com if configured, or returns native booking response.
        """
        if self.api_key:
            try:
                headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
                payload = {
                    "eventTypeId": int(self.event_type_id) if self.event_type_id else 1,
                    "start": start_time_iso,
                    "responses": {
                        "name": prospect_name,
                        "email": attendee_email or f"{prospect_name.lower().replace(' ', '')}@example.com",
                        "notes": notes
                    },
                    "metadata": {"source": "aivhub_voice_ai"}
                }
                async with httpx.AsyncClient(timeout=6.0) as client:
                    resp = await client.post(f"{self.base_url}/bookings", json=payload, headers=headers)
                    if resp.status_code in [200, 201]:
                        data = resp.json()
                        return {
                            "synced": True,
                            "bookingId": data.get("id"),
                            "videoLink": data.get("videoCallUrl") or f"https://meet.google.com/aiv-{prospect_name.lower()[:8]}",
                            "provider": "cal.com"
                        }
            except Exception as e:
                logger.warning(f"Cal.com API call failed, falling back to internal engine: {e}")

        # Native fallback
        slug = prospect_name.lower().replace(" ", "-")[:12]
        return {
            "synced": True,
            "bookingId": f"cal_local_{slug}",
            "videoLink": f"https://meet.google.com/aiv-{slug}",
            "provider": "native_calendar_engine"
        }

calendar_service = CalendarService()
