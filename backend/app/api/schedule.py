from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import ScheduleItem, Meeting, Notification, CompanyProfile
from app.schemas.schemas import ScheduleItemSchema
from app.services.whatsapp_notify import send_whatsapp, whatsapp_ready, digits_only, wa_me_url
from typing import Dict, Any, Optional
from pydantic import BaseModel
from urllib.parse import quote
import uuid
import re

router = APIRouter(prefix="/schedule", tags=["Schedule"])

KIND_LABELS = {
    "phone": "Phone callback",
    "video": "Video meeting",
    "in_person": "In person",
    # legacy fallback — map whatsapp notify to phone callback
    "whatsapp": "Phone callback",
}


def _slug(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", str(text or "").strip())
    return s.strip("-")[:64] or "room"


def _kind_label(kind: str) -> str:
    return KIND_LABELS.get(str(kind or "phone"), "Phone callback")


def _item_dict(i: ScheduleItem) -> dict:
    return {
        "id": i.id,
        "day": i.day,
        "time": i.time,
        "prospect": i.prospect,
        "mission": i.mission,
        "window": i.window,
        "status": i.status,
        "honored": i.honored,
        "deferred": i.deferred,
        "honoredQuote": i.honored_quote,
        "kind": i.kind or "phone",
        "phone": i.phone or i.honored_quote,
        "email": i.email,
        "videoLink": i.video_link,
        "platform": i.platform,
        "address": i.address,
        "notes": i.notes,
        "whatsappTo": i.whatsapp_to or i.phone or i.honored_quote,
        "notifyWhatsapp": bool(i.notify_whatsapp),
        "meetingId": i.meeting_id,
    }


def _video_link(req: ScheduleItemSchema, item_id: str) -> str:
    link = (req.video_link or req.videoLink or "").strip()
    if link:
        if not re.match(r"^https?://", link, re.I):
            link = "https://" + link.lstrip("/")
        return link
    kind = (req.kind or "phone").lower()
    if kind != "video":
        return ""
    platform = (req.platform or "").lower()
    if "zoom" in platform or "teams" in platform or "google" in platform or "cal.com" in platform:
        return ""
    prospect = (req.prospect or "Guest").strip() or "Guest"
    topic = (req.mission or "Intro call").strip() or "Intro call"
    if topic.lower().startswith("video"):
        topic = "Intro call"
    room = _slug(f"AIVHub-with-{prospect}-{topic}-{item_id[-4:]}")
    title = f"AIVHub × {prospect} — {topic}"
    enc = quote(title, safe="")
    return f"https://meet.jit.si/{room}#config.subject=%22{enc}%22&config.localSubject=%22{enc}%22"


def _compose_whatsapp(item: ScheduleItem, company_name: str = "AIVHub", caller: str = "") -> str:
    who = caller or company_name
    kind = _kind_label(item.kind)
    lines = [
        f"Hi {item.prospect.split()[0] if item.prospect else 'there'}, this is {who} from {company_name}.",
        f"Confirming your {kind.lower()} on {item.day} at {item.time}.",
    ]
    if item.kind == "video" and item.video_link:
        lines.append(f"Join: {item.video_link}")
    elif item.kind == "phone" and (item.phone or item.honored_quote):
        lines.append("We'll call you at the number we have.")
    elif item.kind == "in_person" and item.address:
        lines.append(f"Where: {item.address}")
    if item.notes:
        lines.append(item.notes[:280])
    lines.append("Reply here if you need to move it.")
    return "\n".join(lines)


@router.get("", response_model=list[dict])
async def list_schedule_items(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ScheduleItem).order_by(ScheduleItem.created_at.desc()))
    items = result.scalars().all()
    return [_item_dict(i) for i in items]


@router.get("/whatsapp-status")
async def get_whatsapp_status():
    return whatsapp_ready()


@router.get("/{item_id}")
async def get_schedule_item(item_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ScheduleItem).where(ScheduleItem.id == item_id))
    item = res.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found")
    return _item_dict(item)


@router.post("", response_model=dict)
async def create_schedule_item(req: ScheduleItemSchema, db: AsyncSession = Depends(get_db)):
    from app.services.calendar_service import calendar_service
    from app.services.booking_policy import normalize_booking_policy, is_valid_meeting_type, enabled_meeting_types

    kind = (req.kind or "phone").lower()
    # Notify channels are never meeting types
    if kind == "whatsapp":
        kind = "phone"
        if req.notify_whatsapp is None and req.notifyWhatsapp is None:
            req.notifyWhatsapp = True

    setting = await calendar_service.get_or_create_settings(db)
    policy = normalize_booking_policy(getattr(setting, "booking_policy", None))
    if not is_valid_meeting_type(policy, kind):
        enabled = enabled_meeting_types(policy)
        kind = (policy.get("default_meeting_type")
                or (enabled[0]["id"] if enabled else "phone"))
    if kind not in ("phone", "video", "in_person") and not is_valid_meeting_type(policy, kind):
        kind = "phone"
    item_id = f"s_{uuid.uuid4().hex[:8]}"
    phone = (req.phone or req.honored_quote or "").strip() or None
    email = (req.email or "").strip() or None
    platform = (req.platform or ("Google Meet" if kind == "video" else None))
    video_link = _video_link(req, item_id)
    address = (req.address or "").strip() or None
    notes = (req.notes or "").strip() or None
    whatsapp_to = (req.whatsapp_to or req.whatsappTo or phone or "").strip() or None
    notify = bool(req.notify_whatsapp if req.notify_whatsapp is not None else req.notifyWhatsapp)
    kind_label = _kind_label(kind)
    extra = phone or video_link or address or ""
    mission = (req.mission or "").strip() or (f"{kind_label} · {extra}".strip(" ·") if extra else kind_label)

    meeting_id = None
    if kind in ("video", "in_person"):
        meeting_id = f"m_{uuid.uuid4().hex[:8]}"
        meeting = Meeting(
            id=meeting_id,
            prospect=req.prospect,
            mission=mission,
            date=req.day,
            time=req.time,
            duration="15 min",
            status="upcoming",
            channel="whatsapp" if notify else "calendar",
            format="video" if kind == "video" else "in_person",
            platform=platform or ("Google Meet" if kind == "video" else "In person"),
            video_link=video_link or None,
            address=address or ("Remote video" if kind == "video" else None),
            attendee=req.prospect,
            attendee_email=email,
            prep=notes or "",
        )
        db.add(meeting)

    item = ScheduleItem(
        id=item_id,
        day=req.day,
        time=req.time,
        prospect=req.prospect,
        mission=mission,
        window=req.window,
        status=req.status or "queued",
        honored=req.honored,
        deferred=req.deferred,
        honored_quote=phone or req.honored_quote,
        kind=kind,
        phone=phone,
        email=email,
        video_link=video_link or None,
        platform=platform,
        address=address,
        notes=notes,
        whatsapp_to=whatsapp_to,
        notify_whatsapp=notify,
        meeting_id=meeting_id,
    )
    db.add(item)

    db.add(Notification(
        id=f"n_{uuid.uuid4().hex[:8]}",
        text=f"Scheduled {kind_label.lower()} with {req.prospect} · {req.day} {req.time}",
        type="success",
        time="Just now",
    ))
    await db.commit()

    wa = None
    if notify and whatsapp_to:
        prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
        company = (prof.name if prof and prof.name else "AIVHub")
        caller = (prof.caller_name if prof and getattr(prof, "caller_name", None) else "")
        body = _compose_whatsapp(item, company, caller)
        wa = await send_whatsapp(whatsapp_to, body)

    out = _item_dict(item)
    out["whatsapp"] = wa
    return out


class SchedulePatch(BaseModel):
    day: Optional[str] = None
    time: Optional[str] = None
    prospect: Optional[str] = None
    mission: Optional[str] = None
    status: Optional[str] = None
    kind: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    video_link: Optional[str] = None
    videoLink: Optional[str] = None
    platform: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    whatsapp_to: Optional[str] = None
    whatsappTo: Optional[str] = None
    notify_whatsapp: Optional[bool] = None
    notifyWhatsapp: Optional[bool] = None
    honored: Optional[bool] = None


@router.patch("/{item_id}")
async def patch_schedule_item(item_id: str, req: SchedulePatch, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ScheduleItem).where(ScheduleItem.id == item_id))
    item = res.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found")
    if req.day is not None:
        item.day = req.day
    if req.time is not None:
        item.time = req.time
    if req.prospect is not None:
        item.prospect = req.prospect
    if req.mission is not None:
        item.mission = req.mission
    if req.status is not None:
        item.status = req.status
        if req.status == "completed":
            item.honored = True
    if req.kind is not None:
        item.kind = req.kind
    if req.phone is not None:
        item.phone = req.phone
        item.honored_quote = req.phone
    if req.email is not None:
        item.email = req.email
    link = req.video_link if req.video_link is not None else req.videoLink
    if link is not None:
        item.video_link = link
    if req.platform is not None:
        item.platform = req.platform
    if req.address is not None:
        item.address = req.address
    if req.notes is not None:
        item.notes = req.notes
    wa_to = req.whatsapp_to if req.whatsapp_to is not None else req.whatsappTo
    if wa_to is not None:
        item.whatsapp_to = wa_to
    notify = req.notify_whatsapp if req.notify_whatsapp is not None else req.notifyWhatsapp
    if notify is not None:
        item.notify_whatsapp = notify
    if req.honored is not None:
        item.honored = req.honored

    if item.meeting_id:
        mres = await db.execute(select(Meeting).where(Meeting.id == item.meeting_id))
        meeting = mres.scalars().first()
        if meeting:
            meeting.prospect = item.prospect
            meeting.date = item.day
            meeting.time = item.time
            meeting.video_link = item.video_link
            meeting.platform = item.platform or meeting.platform
            meeting.address = item.address
            meeting.attendee_email = item.email
            if item.status == "completed":
                meeting.status = "converted"
            elif item.status in ("cancelled", "canceled"):
                meeting.status = "not_fit"

    await db.commit()
    return _item_dict(item)


@router.delete("/{item_id}")
async def delete_schedule_item(item_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ScheduleItem).where(ScheduleItem.id == item_id))
    item = res.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found")
    await db.delete(item)
    await db.commit()
    return {"status": "deleted", "id": item_id}


class WhatsAppSendRequest(BaseModel):
    to: Optional[str] = None
    message: Optional[str] = None


@router.post("/{item_id}/whatsapp")
async def send_schedule_whatsapp(item_id: str, req: Optional[WhatsAppSendRequest] = None, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ScheduleItem).where(ScheduleItem.id == item_id))
    item = res.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found")
    to = (req.to if req else None) or item.whatsapp_to or item.phone or item.honored_quote
    if not digits_only(to or ""):
        raise HTTPException(status_code=400, detail="Add a WhatsApp / mobile number first.")
    prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
    company = (prof.name if prof and prof.name else "AIVHub")
    caller = (prof.caller_name if prof and getattr(prof, "caller_name", None) else "")
    body = (req.message if req and req.message else None) or _compose_whatsapp(item, company, caller)
    result = await send_whatsapp(to, body)
    result["to"] = to
    result["message"] = body
    if not result.get("waMeUrl"):
        result["waMeUrl"] = wa_me_url(to, body)
    return result
