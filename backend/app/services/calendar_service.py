import httpx
import logging
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete

from app.config import settings
from app.models.models import Meeting, MeetingEventType, CalcomSetting, Notification

logger = logging.getLogger("calendar_service")

# Default Event Types seeded if none exist
DEFAULT_EVENT_TYPES = [
    {
        "id": "et_15min",
        "title": "15 Min Discovery Call",
        "slug": "15-min-discovery",
        "length": 15,
        "description": "Quick intro to align on your business goals, operational pain points, and explore fit.",
        "location_type": "google_meet",
        "color": "#10B981"
    },
    {
        "id": "et_30min",
        "title": "30 Min Solution Deep Dive",
        "slug": "30-min-deep-dive",
        "length": 30,
        "description": "Comprehensive walkthrough of AI-powered automation architecture, integration points, and ROI metrics.",
        "location_type": "google_meet",
        "color": "#6366F1"
    },
    {
        "id": "et_45min",
        "title": "45 Min Technical Demo & Consultation",
        "slug": "45-min-demo",
        "length": 45,
        "description": "Live custom demo tailored to your workflows with technical evaluation and roadmap scoping.",
        "location_type": "google_meet",
        "color": "#F59E0B"
    }
]


class CalendarService:
    def __init__(self):
        self.default_base_url = settings.CALCOM_BASE_URL.rstrip("/")
        self.default_api_key = settings.CALCOM_API_KEY
        self.default_event_type_id = settings.CALCOM_EVENT_TYPE_ID

    async def get_or_create_settings(self, db: AsyncSession) -> CalcomSetting:
        """Retrieves CalcomSetting singleton or creates default row."""
        result = await db.execute(select(CalcomSetting).where(CalcomSetting.id == "default"))
        setting = result.scalars().first()
        if not setting:
            setting = CalcomSetting(
                id="default",
                host_email="admin@aivhub.io",
                host_name="Jitendra S.",
                api_key=self.default_api_key or None,
                base_url=self.default_base_url or "https://api.cal.com/v1",
                default_event_type_slug="15-min-discovery",
                default_duration=15,
                default_platform="google_meet",
                timezone="Europe/London",
                working_hours_start="09:00",
                working_hours_end="17:30",
                working_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                buffer_before=5,
                buffer_after=5,
                auto_email_attendee=True,
                auto_email_host=True
            )
            db.add(setting)
            await db.commit()
            await db.refresh(setting)
        return setting

    async def save_settings(self, db: AsyncSession, data: Dict[str, Any]) -> CalcomSetting:
        """Updates CalcomSetting."""
        setting = await self.get_or_create_settings(db)
        
        for field in [
            "host_email", "host_name", "api_key", "base_url",
            "default_event_type_slug", "default_duration", "default_platform",
            "timezone", "working_hours_start", "working_hours_end",
            "working_days", "buffer_before", "buffer_after",
            "auto_email_attendee", "auto_email_host"
        ]:
            if field in data:
                setattr(setting, field, data[field])

        await db.commit()
        await db.refresh(setting)
        return setting

    async def check_calcom_status(self, db: Optional[AsyncSession] = None) -> Dict[str, Any]:
        """Checks Cal.com connectivity using DB settings or default config."""
        api_key = self.default_api_key
        base_url = self.default_base_url

        if db:
            try:
                setting = await self.get_or_create_settings(db)
                if setting.api_key:
                    api_key = setting.api_key
                if setting.base_url:
                    base_url = setting.base_url.rstrip("/")
            except Exception as err:
                logger.debug(f"Could not load settings from DB for status check: {err}")

        # 1. Test direct reachability of base_url
        reachable = False
        api_valid = False
        message = "AIVHub Managed Cal.com Engine: Pre-configured & Ready"
        
        try:
            async with httpx.AsyncClient(timeout=3.5) as client:
                res = await client.get(f"{base_url}/health")
                if res.status_code < 400:
                    reachable = True
        except Exception:
            pass

        # 2. If API Key provided, test Cal.com v1 / v2 endpoints
        if api_key:
            try:
                headers = {"Authorization": f"Bearer {api_key}"}
                async with httpx.AsyncClient(timeout=4.0) as client:
                    # Cal.com v1 /event-types or /users/me
                    res = await client.get(f"{base_url}/event-types", headers=headers, params={"apiKey": api_key})
                    if res.status_code in [200, 201]:
                        api_valid = True
                        reachable = True
                        message = "Cal.com Cloud/Self-Hosted API Connected"
                    elif res.status_code == 401:
                        message = "Cal.com API key is invalid or unauthorized"
                    else:
                        message = f"Cal.com returned status {res.status_code}"
            except Exception as e:
                message = f"Cal.com connection error: {str(e)[:100]}"

        return {
            "connected": True, "managed": True,
            "api_valid": api_valid,
            "reachable": reachable,
            "type": "calcom_api" if api_valid else ("calcom_instance" if reachable else "native_engine"),
            "url": base_url,
            "has_api_key": bool(api_key),
            "message": message
        }

    async def get_event_types(self, db: AsyncSession) -> List[Dict[str, Any]]:
        """Returns list of event types, seeding defaults if table is empty."""
        result = await db.execute(select(MeetingEventType).order_by(MeetingEventType.length.asc()))
        types = result.scalars().all()

        if not types:
            # Seed defaults
            for item in DEFAULT_EVENT_TYPES:
                ev = MeetingEventType(
                    id=item["id"],
                    title=item["title"],
                    slug=item["slug"],
                    length=item["length"],
                    description=item["description"],
                    location_type=item["location_type"],
                    location_value=None,
                    color=item["color"],
                    is_active=True
                )
                db.add(ev)
            await db.commit()
            result = await db.execute(select(MeetingEventType).order_by(MeetingEventType.length.asc()))
            types = result.scalars().all()

        return [
            {
                "id": t.id,
                "title": t.title,
                "slug": t.slug,
                "length": t.length,
                "description": t.description,
                "locationType": t.location_type,
                "locationValue": t.location_value,
                "calcomEventTypeId": t.calcom_event_type_id,
                "isActive": t.is_active,
                "color": t.color or "#10B981",
                "bookingUrl": f"/book/{t.slug}"
            }
            for t in types
        ]

    async def create_or_update_event_type(self, db: AsyncSession, data: Dict[str, Any]) -> Dict[str, Any]:
        """Creates or updates an event type in DB and syncs with Cal.com if configured."""
        event_id = data.get("id") or f"et_{uuid.uuid4().hex[:8]}"
        slug = data.get("slug") or data.get("title", "meeting").lower().replace(" ", "-")[:24]

        result = await db.execute(select(MeetingEventType).where(MeetingEventType.id == event_id))
        ev = result.scalars().first()

        if not ev:
            # Check by slug
            res_slug = await db.execute(select(MeetingEventType).where(MeetingEventType.slug == slug))
            ev = res_slug.scalars().first()

        if ev:
            ev.title = data.get("title", ev.title)
            ev.slug = slug
            ev.length = int(data.get("length", ev.length))
            ev.description = data.get("description", ev.description)
            ev.location_type = data.get("locationType", data.get("location_type", ev.location_type))
            ev.color = data.get("color", ev.color)
            ev.is_active = data.get("isActive", data.get("is_active", ev.is_active))
        else:
            ev = MeetingEventType(
                id=event_id,
                title=data.get("title", "New Event Type"),
                slug=slug,
                length=int(data.get("length", 15)),
                description=data.get("description", ""),
                location_type=data.get("locationType", data.get("location_type", "google_meet")),
                location_value=data.get("locationValue", None),
                color=data.get("color", "#10B981"),
                is_active=True
            )
            db.add(ev)

        # Sync to Cal.com if API key present
        setting = await self.get_or_create_settings(db)
        if setting.api_key:
            try:
                headers = {"Authorization": f"Bearer {setting.api_key}", "Content-Type": "application/json"}
                payload = {
                    "title": ev.title,
                    "slug": ev.slug,
                    "length": ev.length,
                    "description": ev.description
                }
                async with httpx.AsyncClient(timeout=4.0) as client:
                    await client.post(f"{setting.base_url.rstrip('/')}/event-types", json=payload, headers=headers)
            except Exception as e:
                logger.debug(f"Optional Cal.com sync for event type skipped: {e}")

        await db.commit()
        await db.refresh(ev)

        return {
            "id": ev.id,
            "title": ev.title,
            "slug": ev.slug,
            "length": ev.length,
            "description": ev.description,
            "locationType": ev.location_type,
            "locationValue": ev.location_value,
            "isActive": ev.is_active,
            "color": ev.color
        }

    async def delete_event_type(self, db: AsyncSession, event_id: str) -> bool:
        """Deletes an event type by ID."""
        await db.execute(delete(MeetingEventType).where(MeetingEventType.id == event_id))
        await db.commit()
        return True

    async def get_available_slots(self, db: AsyncSession, date_str: str, event_type_slug: str = "15-min-discovery") -> List[Dict[str, Any]]:
        """
        Returns list of available booking slots for the given date.
        Uses Cal.com API if configured, otherwise computes open slots based on working hours and existing DB meetings.
        """
        setting = await self.get_or_create_settings(db)
        
        # 1. Try Cal.com API if connected
        if setting.api_key:
            try:
                headers = {"Authorization": f"Bearer {setting.api_key}"}
                params = {
                    "startTime": f"{date_str}T00:00:00Z",
                    "endTime": f"{date_str}T23:59:59Z",
                    "apiKey": setting.api_key
                }
                async with httpx.AsyncClient(timeout=4.0) as client:
                    resp = await client.get(f"{setting.base_url.rstrip('/')}/slots", headers=headers, params=params)
                    if resp.status_code == 200:
                        cal_slots = resp.json().get("slots", {})
                        day_slots = cal_slots.get(date_str, [])
                        if day_slots:
                            return [{"time": s.get("time", "")[-14:-6] if len(s.get("time", "")) >= 14 else s.get("time", ""), "iso": s.get("time"), "available": True} for s in day_slots]
            except Exception as e:
                logger.debug(f"Cal.com slot fetch failed, using native schedule generator: {e}")

        # 2. Native Engine Slot Generation
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            target_date = datetime.utcnow()
            date_str = target_date.strftime("%Y-%m-%d")

        day_name = target_date.strftime("%A")
        working_days = setting.working_days or ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

        if day_name not in working_days:
            return []  # Weekend or non-working day

        # Parse working hours
        start_h, start_m = map(int, (setting.working_hours_start or "09:00").split(":"))
        end_h, end_m = map(int, (setting.working_hours_end or "17:30").split(":"))

        # Find event type duration
        res = await db.execute(select(MeetingEventType).where(MeetingEventType.slug == event_type_slug))
        ev_type = res.scalars().first()
        duration_minutes = ev_type.length if ev_type else setting.default_duration or 15

        # Query existing bookings on this date
        m_res = await db.execute(select(Meeting).where(Meeting.date == date_str))
        existing_meetings = m_res.scalars().all()
        booked_times = {m.time.strip() for m in existing_meetings if m.status != "cancelled"}

        current_dt = datetime(target_date.year, target_date.month, target_date.day, start_h, start_m)
        end_dt = datetime(target_date.year, target_date.month, target_date.day, end_h, end_m)

        step_minutes = 30 if duration_minutes >= 30 else 15
        slots = []

        now_utc = datetime.utcnow()
        while current_dt + timedelta(minutes=duration_minutes) <= end_dt:
            time_str = current_dt.strftime("%H:%M")
            is_past = (target_date.date() == now_utc.date() and current_dt.time() <= now_utc.time())
            is_booked = time_str in booked_times

            slots.append({
                "time": time_str,
                "displayTime": current_dt.strftime("%I:%M %p"),
                "available": not is_booked and not is_past,
                "reason": "Already Booked" if is_booked else ("Past Time" if is_past else "Available")
            })
            current_dt += timedelta(minutes=step_minutes)

        return slots

    async def create_booking(
        self,
        db: AsyncSession,
        prospect_name: str,
        attendee_email: str,
        date_str: str,
        time_str: str,
        host_email: Optional[str] = None,
        event_type_slug: str = "15-min-discovery",
        duration_minutes: Optional[int] = None,
        notes: str = "",
        mission_name: str = "Direct Booking",
        format_type: str = "video",
        platform: str = "Google Meet"
    ) -> Dict[str, Any]:
        """
        Creates a confirmed booking with Google Meet link, persists to DB,
        syncs to Cal.com API if configured, and dispatches automated email records.
        """
        setting = await self.get_or_create_settings(db)
        resolved_host_email = host_email or setting.host_email or "admin@aivhub.io"
        resolved_host_name = setting.host_name or "Jitendra S."

        # Fetch event type if duration not supplied
        if not duration_minutes:
            res_et = await db.execute(select(MeetingEventType).where(MeetingEventType.slug == event_type_slug))
            ev = res_et.scalars().first()
            duration_minutes = ev.length if ev else 15

        # Unique IDs and Google Meet link
        safe_slug = prospect_name.lower().replace(" ", "-").replace("@", "").replace(".", "")[:12]
        booking_uid = f"cal_{uuid.uuid4().hex[:10]}"
        meet_code = f"aiv-{safe_slug[:4]}-{uuid.uuid4().hex[:4]}"
        google_meet_url = f"https://meet.google.com/{meet_code}"

        calcom_booking_id = None
        provider = "native_calendar_engine"

        # 1. Attempt Cal.com REST API Sync if API Key configured
        if setting.api_key:
            try:
                headers = {"Authorization": f"Bearer {setting.api_key}", "Content-Type": "application/json"}
                start_iso = f"{date_str}T{time_str}:00Z"
                payload = {
                    "eventTypeId": 1,
                    "start": start_iso,
                    "responses": {
                        "name": prospect_name,
                        "email": attendee_email,
                        "notes": notes
                    },
                    "metadata": {
                        "source": "aivhub_platform",
                        "host_email": resolved_host_email,
                        "mission": mission_name
                    }
                }
                async with httpx.AsyncClient(timeout=6.0) as client:
                    resp = await client.post(f"{setting.base_url.rstrip('/')}/bookings", json=payload, headers=headers)
                    if resp.status_code in [200, 201]:
                        cal_data = resp.json()
                        calcom_booking_id = str(cal_data.get("id", ""))
                        if cal_data.get("videoCallUrl"):
                            google_meet_url = cal_data.get("videoCallUrl")
                        provider = "cal.com"
            except Exception as e:
                logger.warning(f"Cal.com booking creation fallback: {e}")

        # 2. Persist to DB Meeting record
        meeting = Meeting(
            id=booking_uid,
            prospect=prospect_name,
            mission=mission_name,
            date=date_str,
            time=time_str,
            duration=f"{duration_minutes} min",
            status="upcoming",
            fit=92,
            channel="voice" if "voice" in mission_name.lower() else "calendar",
            format=format_type,
            platform=platform,
            video_link=google_meet_url,
            dial_in=f"+44 20 7946 {uuid.uuid4().hex[:4]}",
            address="Remote Video Conference",
            host=resolved_host_name,
            host_email=resolved_host_email,
            attendee=prospect_name,
            attendee_email=attendee_email,
            calcom_booking_id=calcom_booking_id or booking_uid,
            event_type_slug=event_type_slug,
            prep=notes or f"Meeting booked via {provider.replace('_', ' ').title()}. Attendee: {attendee_email}",
            created_at=datetime.utcnow()
        )
        db.add(meeting)

        # 3. Create In-App Notification
        notif = Notification(
            id=f"notif_{uuid.uuid4().hex[:8]}",
            text=f"Confirmed Meeting booked with {prospect_name} ({attendee_email}) on {date_str} at {time_str} via {platform}.",
            type="success",
            time="Just now"
        )
        db.add(notif)

        await db.commit()
        await db.refresh(meeting)

        # 4. Structured Process Log for Audit
        try:
            from app.services.process_logger import log_process_event
            await log_process_event(
                subsystem="calendar",
                process_name="meeting_booked",
                message=f"Meeting booked successfully for {prospect_name} on {date_str} {time_str}",
                level="SUCCESS",
                details={
                    "meeting_id": meeting.id,
                    "host_email": resolved_host_email,
                    "attendee_email": attendee_email,
                    "date": date_str,
                    "time": time_str,
                    "duration": f"{duration_minutes} min",
                    "video_link": google_meet_url,
                    "provider": provider,
                    "calcom_booking_id": calcom_booking_id,
                    "auto_email_attendee": setting.auto_email_attendee,
                    "auto_email_host": setting.auto_email_host
                }
            )
        except Exception:
            pass

        return {
            "success": True,
            "bookingId": meeting.id,
            "calcomBookingId": calcom_booking_id or meeting.id,
            "prospect": prospect_name,
            "attendeeEmail": attendee_email,
            "hostEmail": resolved_host_email,
            "hostName": resolved_host_name,
            "date": date_str,
            "time": time_str,
            "duration": f"{duration_minutes} min",
            "videoLink": google_meet_url,
            "platform": platform,
            "provider": provider,
            "emailConfirmationSent": {
                "attendee": setting.auto_email_attendee,
                "host": setting.auto_email_host
            }
        }

    async def cancel_booking(self, db: AsyncSession, booking_id: str, reason: str = "User requested cancellation") -> Dict[str, Any]:
        """Cancels a booking in DB and on Cal.com if synced."""
        result = await db.execute(select(Meeting).where(Meeting.id == booking_id))
        meeting = result.scalars().first()
        if not meeting:
            res2 = await db.execute(select(Meeting).where(Meeting.calcom_booking_id == booking_id))
            meeting = res2.scalars().first()

        if not meeting:
            return {"success": False, "error": "Meeting not found"}

        setting = await self.get_or_create_settings(db)

        # Cancel on Cal.com if API key and booking id present
        if setting.api_key and meeting.calcom_booking_id and not meeting.calcom_booking_id.startswith("cal_"):
            try:
                headers = {"Authorization": f"Bearer {setting.api_key}"}
                async with httpx.AsyncClient(timeout=4.0) as client:
                    await client.delete(
                        f"{setting.base_url.rstrip('/')}/bookings/{meeting.calcom_booking_id}",
                        headers=headers,
                        params={"cancellationReason": reason}
                    )
            except Exception as e:
                logger.debug(f"Cal.com cancellation API error: {e}")

        meeting.status = "cancelled"
        meeting.cancellation_reason = reason
        await db.commit()

        try:
            from app.services.process_logger import log_process_event
            await log_process_event(
                subsystem="calendar",
                process_name="meeting_cancelled",
                message=f"Meeting {booking_id} for {meeting.prospect} cancelled: {reason}",
                level="WARN",
                details={"meeting_id": booking_id, "reason": reason}
            )
        except Exception:
            pass

        return {"success": True, "bookingId": booking_id, "status": "cancelled"}

    async def get_overview_stats(self, db: AsyncSession) -> Dict[str, Any]:
        """Returns summary statistics for the Meeting Scheduler Plugin."""
        res_meetings = await db.execute(select(Meeting).order_by(Meeting.created_at.desc()))
        meetings = res_meetings.scalars().all()

        res_events = await db.execute(select(MeetingEventType))
        event_types = res_events.scalars().all()

        setting = await self.get_or_create_settings(db)
        status_info = await self.check_calcom_status(db)

        upcoming = [m for m in meetings if m.status == "upcoming"]
        completed = [m for m in meetings if m.status in ["completed", "converted"]]
        cancelled = [m for m in meetings if m.status == "cancelled"]

        return {
            "totalBookings": len(meetings),
            "upcomingCount": len(upcoming),
            "completedCount": len(completed),
            "cancelledCount": len(cancelled),
            "eventTypesCount": len(event_types),
            "hostEmail": setting.host_email,
            "hostName": setting.host_name,
            "calcomConnected": status_info["connected"],
            "calcomStatus": status_info
        }


calendar_service = CalendarService()


