"""Email outreach: mailboxes (SMTP/IMAP), warmup, campaigns with steps and leads, email
finding, replies and the do-not-email list. The unsubscribe link (/email/u/...) is public.

Every route runs inside the signed-in user's company (row-level security), so queries never
need an org filter except on the do-not-email list, whose platform-wide rows have no company.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import (
    EmailCampaign,
    EmailEnrollment,
    EmailMailbox,
    EmailMessage,
    EmailSendLog,
    EmailSequenceStep,
    EmailSuppression,
)
from app.services import mail_transport as T
from app.services.dns_verifier import verify_domain_dns
from app.services.email_dispatcher import mailbox_settings, read_unsubscribe_token, suppress
from app.services.enrichment_waterfall import lookup_person_waterfall
from app.services.secret_box import seal_secret

logger = logging.getLogger("email_outreach_api")

router = APIRouter(prefix="/email", tags=["Email outreach"])

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_HM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() + "Z" if d else None


async def _mailbox(db: AsyncSession, mailbox_id: str) -> EmailMailbox:
    mb = (await db.execute(select(EmailMailbox).where(EmailMailbox.id == mailbox_id))).scalars().first()
    if not mb:
        raise HTTPException(status_code=404, detail="Mailbox not found.")
    return mb


async def _campaign(db: AsyncSession, campaign_id: str) -> EmailCampaign:
    camp = (await db.execute(select(EmailCampaign).where(EmailCampaign.id == campaign_id))).scalars().first()
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    return camp


def _dns_fields(mb: EmailMailbox, dns: Dict[str, Any]) -> None:
    mb.spf_verified = dns["spf_verified"]
    mb.dkim_verified = dns["dkim_verified"]
    mb.dmarc_verified = dns["dmarc_verified"]
    mb.mx_verified = dns["mx_verified"]
    mb.last_dns_check_at = datetime.utcnow()
    mb.dns_check_details = dns


# ── Overview ────────────────────────────────────────────────────────────────
@router.get("/overview")
async def overview(request: Request, db: AsyncSession = Depends(get_db)):
    """What is set up, for the page's checklist."""
    from app.services import platform_mailbox
    from app.services.enrichment_waterfall import finder_keys

    current(request)
    boxes = (await db.execute(select(func.count(EmailMailbox.id)))).scalar() or 0
    camps = (await db.execute(select(func.count(EmailCampaign.id)))).scalar() or 0
    replies = (await db.execute(select(func.count(EmailMessage.id)).where(EmailMessage.status == "replied"))).scalar() or 0
    return {
        "mailboxes": boxes, "campaigns": camps, "replies": replies,
        "finderReady": bool(await finder_keys()),
        "warmupPartnerReady": bool(await platform_mailbox.get()),
        "presets": {k: v for k, v in T.PRESETS.items()},
    }


# ── Mailboxes ───────────────────────────────────────────────────────────────
class MailboxBody(BaseModel):
    email: str
    display_name: str = ""
    preset: str = ""
    smtp_host: str = ""
    smtp_port: Optional[int] = None
    smtp_security: str = ""
    imap_host: str = ""
    imap_port: Optional[int] = None
    username: str = ""
    password: str = ""
    max_daily_target: int = 40
    signature: str = ""


class MailboxPatch(BaseModel):
    display_name: Optional[str] = None
    max_daily_target: Optional[int] = None
    signature: Optional[str] = None
    password: Optional[str] = None


def _mailbox_out(mb: EmailMailbox, log: Optional[EmailSendLog]) -> Dict[str, Any]:
    s = mailbox_settings(mb)
    return {
        "id": mb.id, "email": mb.email, "display_name": mb.display_name, "provider": mb.provider,
        "status": mb.status, "pause_reason": mb.pause_reason, "last_error": mb.last_error or "",
        "daily_cap": mb.daily_cap, "max_daily_target": mb.max_daily_target, "signature": mb.signature or "",
        "warmup_quota": mb.warmup_quota or 0, "campaign_quota": mb.campaign_quota or 0,
        "consecutive_healthy_days": mb.consecutive_healthy_days, "bounce_rate_7d": mb.bounce_rate_7d,
        "warmup_started_at": _iso(mb.warmup_started_at), "graduated_at": _iso(mb.graduated_at),
        "spf_verified": mb.spf_verified, "dkim_verified": mb.dkim_verified,
        "dmarc_verified": mb.dmarc_verified, "mx_verified": mb.mx_verified,
        "dns": mb.dns_check_details or {}, "last_sync_at": _iso(mb.last_sync_at),
        "smtp_host": s["smtp_host"], "imap_host": s["imap_host"],
        "today_sent": log.sent_count if log else 0, "today_warmup_sent": log.warmup_sent_count if log else 0,
        "today_campaign_sent": log.campaign_sent_count if log else 0, "today_bounced": log.bounced_count if log else 0,
        "today_replies": log.reply_count if log else 0,
    }


@router.get("/mailboxes")
async def list_mailboxes(request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    today = datetime.utcnow().date().isoformat()
    boxes = (await db.execute(select(EmailMailbox).order_by(EmailMailbox.created_at.desc()))).scalars().all()
    logs = {l.mailbox_id: l for l in (await db.execute(select(EmailSendLog).where(EmailSendLog.date == today))).scalars().all()}
    return {"mailboxes": [_mailbox_out(mb, logs.get(mb.id)) for mb in boxes]}


@router.post("/mailboxes")
async def connect_mailbox(body: MailboxBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Connects a mailbox after logging in to its SMTP and IMAP (the password is sealed)."""
    ctx = current(request)
    addr = body.email.strip().lower()
    if not _EMAIL.match(addr):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if (await db.execute(select(EmailMailbox.id).where(EmailMailbox.email == addr))).first():
        raise HTTPException(status_code=409, detail="That mailbox is already connected.")
    settings = T.clean_settings(body.model_dump(), addr)
    try:
        await T.check_login(settings)
    except T.MailError as err:
        raise HTTPException(status_code=400, detail=str(err))
    dns = await verify_domain_dns(addr.split("@")[-1])
    mb = EmailMailbox(
        id=f"mb_{uuid.uuid4().hex[:12]}", operator_id=ctx.get("operator_id") or "", email=addr,
        display_name=body.display_name.strip()[:80] or addr.split("@")[0], provider=body.preset or "smtp",
        auth_type="credentials", credentials_encrypted=seal_secret(json.dumps(settings)), status="connected",
        daily_cap=0, max_daily_target=max(5, min(int(body.max_daily_target or 40), 100)),
        signature=body.signature.strip()[:2000],
    )
    _dns_fields(mb, dns)
    db.add(mb)
    await db.commit()
    return {"mailbox": _mailbox_out(mb, None)}


@router.patch("/mailboxes/{mailbox_id}")
async def update_mailbox(mailbox_id: str, body: MailboxPatch, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    mb = await _mailbox(db, mailbox_id)
    if body.display_name is not None:
        mb.display_name = body.display_name.strip()[:80]
    if body.signature is not None:
        mb.signature = body.signature.strip()[:2000]
    if body.max_daily_target is not None:
        mb.max_daily_target = max(5, min(int(body.max_daily_target), 100))
        mb.plan_date = ""  # re-plan today with the new target
    if body.password:
        settings = mailbox_settings(mb)
        settings["password"] = body.password
        try:
            await T.check_login(settings)
        except T.MailError as err:
            raise HTTPException(status_code=400, detail=str(err))
        mb.credentials_encrypted = seal_secret(json.dumps(settings))
        mb.last_error = ""
        if mb.status == "error":
            mb.status = "connected"
    await db.commit()
    return {"mailbox": _mailbox_out(mb, None)}


@router.delete("/mailboxes/{mailbox_id}")
async def delete_mailbox(mailbox_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    mb = await _mailbox(db, mailbox_id)
    for camp in (await db.execute(select(EmailCampaign))).scalars().all():
        if mailbox_id in (camp.mailbox_ids or []):
            camp.mailbox_ids = [i for i in camp.mailbox_ids if i != mailbox_id]
    await db.delete(mb)
    await db.commit()
    return {"ok": True}


@router.post("/mailboxes/{mailbox_id}/test")
async def test_mailbox(mailbox_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    mb = await _mailbox(db, mailbox_id)
    try:
        await T.check_login(mailbox_settings(mb))
    except T.MailError as err:
        mb.last_error = str(err)
        await db.commit()
        raise HTTPException(status_code=400, detail=str(err))
    mb.last_error = ""
    await db.commit()
    return {"ok": True}


@router.post("/mailboxes/{mailbox_id}/dns-check")
async def audit_mailbox_dns(mailbox_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    mb = await _mailbox(db, mailbox_id)
    dns = await verify_domain_dns(mb.email.split("@")[-1])
    _dns_fields(mb, dns)
    await db.commit()
    return {"mailbox": _mailbox_out(mb, None)}


class WarmupBody(BaseModel):
    action: str  # start | pause | skip (already warm: send at full volume)


@router.post("/mailboxes/{mailbox_id}/warmup")
async def set_warmup(mailbox_id: str, body: WarmupBody, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    mb = await _mailbox(db, mailbox_id)
    if body.action == "pause":
        mb.status = "paused"
        mb.pause_reason = "Paused by you."
    elif body.action in ("start", "skip"):
        if not (mb.spf_verified and mb.dkim_verified):
            _dns_fields(mb, await verify_domain_dns(mb.email.split("@")[-1]))
            if not (mb.spf_verified and mb.dkim_verified):
                await db.commit()
                raise HTTPException(status_code=400, detail="Set up SPF and DKIM for this domain first (see DNS check).")
        if body.action == "skip":
            mb.status = "active"
        else:
            mb.status = "warming" if not mb.graduated_at else "active"
            mb.warmup_started_at = mb.warmup_started_at or datetime.utcnow()
        mb.pause_reason = ""
        mb.plan_date = ""
    else:
        raise HTTPException(status_code=400, detail="Say start, pause or skip.")
    await db.commit()
    return {"mailbox": _mailbox_out(mb, None)}


# ── Campaigns ───────────────────────────────────────────────────────────────
class StepBody(BaseModel):
    delay_days: int = 0
    delay_hours: int = 0
    subject: str = ""
    body: str = ""
    channel: str = "email"


class CampaignBody(BaseModel):
    name: str
    mailbox_ids: List[str] = []
    sending_window_start: str = "09:00"
    sending_window_end: str = "17:00"
    days_of_week: List[int] = [1, 2, 3, 4, 5]
    min_delay_seconds: int = 120
    steps: List[StepBody] = []


def _check_campaign(body: CampaignBody) -> None:
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name the campaign.")
    if not (_HM.match(body.sending_window_start) and _HM.match(body.sending_window_end)) or \
            body.sending_window_start >= body.sending_window_end:
        raise HTTPException(status_code=400, detail="Sending hours must be like 09:00 to 17:00.")
    if not body.days_of_week or any(d not in range(1, 8) for d in body.days_of_week):
        raise HTTPException(status_code=400, detail="Pick at least one sending day.")
    if not body.steps:
        raise HTTPException(status_code=400, detail="Add at least one email.")
    if not body.steps[0].subject.strip():
        raise HTTPException(status_code=400, detail="The first email needs a subject.")
    for i, s in enumerate(body.steps, 1):
        if not s.body.strip():
            raise HTTPException(status_code=400, detail=f"Email {i} is empty.")
        if i > 1 and (s.delay_days or 0) * 24 + (s.delay_hours or 0) <= 0:
            raise HTTPException(status_code=400, detail=f"Email {i} needs a wait after the one before it.")


async def _save_steps(db: AsyncSession, camp: EmailCampaign, steps: List[StepBody]) -> None:
    for old in (await db.execute(select(EmailSequenceStep).where(EmailSequenceStep.campaign_id == camp.id))).scalars().all():
        await db.delete(old)
    await db.flush()
    for n, s in enumerate(steps, 1):
        db.add(EmailSequenceStep(id=f"st_{uuid.uuid4().hex[:12]}", campaign_id=camp.id, step_number=n,
                                 channel="email", delay_days=max(0, s.delay_days if n > 1 else 0),
                                 delay_hours=max(0, s.delay_hours if n > 1 else 0),
                                 subject=s.subject.strip()[:300], body_template=s.body.strip()[:10000]))


async def _known_mailboxes(db: AsyncSession, ids: List[str]) -> List[str]:
    have = set((await db.execute(select(EmailMailbox.id))).scalars().all())
    return [i for i in dict.fromkeys(ids) if i in have]


async def _campaign_out(db: AsyncSession, camp: EmailCampaign, full: bool = False) -> Dict[str, Any]:
    counts = dict((await db.execute(select(EmailEnrollment.status, func.count(EmailEnrollment.id))
                                    .where(EmailEnrollment.campaign_id == camp.id).group_by(EmailEnrollment.status))).all())
    msgs = dict((await db.execute(select(EmailMessage.status, func.count(EmailMessage.id))
                                  .where(EmailMessage.campaign_id == camp.id).group_by(EmailMessage.status))).all())
    sent = sum(msgs.values())
    out = {
        "id": camp.id, "name": camp.name, "status": camp.status, "mailbox_ids": camp.mailbox_ids or [],
        "sending_window_start": camp.sending_window_start, "sending_window_end": camp.sending_window_end,
        "days_of_week": camp.days_of_week or [], "min_delay_seconds": camp.min_delay_seconds,
        "leads": sum(counts.values()), "lead_status": counts, "sent": sent,
        "replied": msgs.get("replied", 0), "bounced": msgs.get("bounced", 0),
        "reply_rate": round(100 * msgs.get("replied", 0) / sent, 1) if sent else 0.0,
        "created_at": _iso(camp.created_at),
    }
    steps = (await db.execute(select(EmailSequenceStep).where(EmailSequenceStep.campaign_id == camp.id)
                              .order_by(EmailSequenceStep.step_number))).scalars().all()
    out["steps"] = [{"step": s.step_number, "delay_days": s.delay_days, "delay_hours": s.delay_hours,
                     "subject": s.subject, "body": s.body_template, "channel": s.channel} for s in steps]
    if full:
        rows = (await db.execute(select(EmailEnrollment).where(EmailEnrollment.campaign_id == camp.id)
                                 .order_by(EmailEnrollment.created_at.desc()).limit(500))).scalars().all()
        out["lead_list"] = [{"id": e.id, "email": e.email, "first_name": e.first_name, "last_name": e.last_name,
                             "company": e.company, "status": e.status, "step": e.current_step,
                             "next_at": _iso(e.next_action_at)} for e in rows]
    return out


@router.get("/campaigns")
async def list_campaigns(request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    camps = (await db.execute(select(EmailCampaign).order_by(EmailCampaign.created_at.desc()))).scalars().all()
    return {"campaigns": [await _campaign_out(db, c) for c in camps]}


@router.post("/campaigns")
async def create_campaign(body: CampaignBody, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    _check_campaign(body)
    camp = EmailCampaign(id=f"cp_{uuid.uuid4().hex[:12]}", name=body.name.strip()[:120], status="draft",
                         mailbox_ids=await _known_mailboxes(db, body.mailbox_ids), timezone_policy="org",
                         sending_window_start=body.sending_window_start, sending_window_end=body.sending_window_end,
                         days_of_week=sorted(set(body.days_of_week)), min_delay_seconds=max(30, body.min_delay_seconds),
                         max_delay_seconds=max(30, body.min_delay_seconds))
    db.add(camp)
    await db.flush()
    await _save_steps(db, camp, body.steps)
    await db.commit()
    return {"campaign": await _campaign_out(db, camp, True)}


@router.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    return {"campaign": await _campaign_out(db, await _campaign(db, campaign_id), True)}


@router.put("/campaigns/{campaign_id}")
async def update_campaign(campaign_id: str, body: CampaignBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Edits settings and emails. Leads already part-way keep their place (step numbers)."""
    current(request)
    _check_campaign(body)
    camp = await _campaign(db, campaign_id)
    camp.name = body.name.strip()[:120]
    camp.mailbox_ids = await _known_mailboxes(db, body.mailbox_ids)
    camp.sending_window_start, camp.sending_window_end = body.sending_window_start, body.sending_window_end
    camp.days_of_week = sorted(set(body.days_of_week))
    camp.min_delay_seconds = camp.max_delay_seconds = max(30, body.min_delay_seconds)
    await _save_steps(db, camp, body.steps)
    await db.commit()
    return {"campaign": await _campaign_out(db, camp, True)}


class StatusBody(BaseModel):
    status: str  # running | paused


@router.post("/campaigns/{campaign_id}/status")
async def set_campaign_status(campaign_id: str, body: StatusBody, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    camp = await _campaign(db, campaign_id)
    if body.status == "running":
        if not camp.mailbox_ids:
            raise HTTPException(status_code=400, detail="Pick at least one mailbox to send from.")
        boxes = (await db.execute(select(EmailMailbox).where(EmailMailbox.id.in_(camp.mailbox_ids)))).scalars().all()
        if not any(b.status in ("warming", "active", "graduated") for b in boxes):
            raise HTTPException(status_code=400, detail="Start warmup (or mark as already warm) on one of its mailboxes first.")
        has_leads = (await db.execute(select(EmailEnrollment.id).where(EmailEnrollment.campaign_id == camp.id,
                                                                        EmailEnrollment.status == "active").limit(1))).first()
        if not has_leads:
            raise HTTPException(status_code=400, detail="Add leads first.")
        camp.status = "running"
    elif body.status == "paused":
        camp.status = "paused"
    else:
        raise HTTPException(status_code=400, detail="Say running or paused.")
    await db.commit()
    return {"campaign": await _campaign_out(db, camp)}


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    camp = await _campaign(db, campaign_id)
    for model in (EmailEnrollment, EmailSequenceStep):
        for row in (await db.execute(select(model).where(model.campaign_id == camp.id))).scalars().all():
            await db.delete(row)
    await db.delete(camp)
    await db.commit()
    return {"ok": True}


class LeadBody(BaseModel):
    email: str
    first_name: str = ""
    last_name: str = ""
    company: str = ""
    prospect_id: str = ""


class LeadsBody(BaseModel):
    leads: List[LeadBody]


@router.post("/campaigns/{campaign_id}/leads")
async def add_leads(campaign_id: str, body: LeadsBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Adds leads; skips bad addresses, ones already in the campaign and ones on the do-not-email list."""
    from app.services.email_dispatcher import is_email_suppressed

    ctx = current(request)
    camp = await _campaign(db, campaign_id)
    if len(body.leads) > 5000:
        raise HTTPException(status_code=400, detail="Add up to 5,000 leads at a time.")
    have = set((await db.execute(select(EmailEnrollment.email).where(EmailEnrollment.campaign_id == camp.id))).scalars().all())
    added, skipped = 0, {"invalid": 0, "duplicate": 0, "do_not_email": 0}
    now = datetime.utcnow()
    for lead in body.leads:
        addr = lead.email.strip().lower()
        if not _EMAIL.match(addr):
            skipped["invalid"] += 1
            continue
        if addr in have:
            skipped["duplicate"] += 1
            continue
        if (await is_email_suppressed(db, addr, ctx["org_id"]))[0]:
            skipped["do_not_email"] += 1
            continue
        have.add(addr)
        db.add(EmailEnrollment(id=f"en_{uuid.uuid4().hex[:12]}", campaign_id=camp.id, prospect_id=lead.prospect_id or None,
                               email=addr, first_name=lead.first_name.strip()[:80], last_name=lead.last_name.strip()[:80],
                               company=lead.company.strip()[:160], current_step=1, status="active", next_action_at=now))
        added += 1
    await db.commit()
    return {"added": added, "skipped": skipped}


@router.delete("/campaigns/{campaign_id}/leads/{lead_id}")
async def remove_lead(campaign_id: str, lead_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    row = (await db.execute(select(EmailEnrollment).where(EmailEnrollment.id == lead_id,
                                                          EmailEnrollment.campaign_id == campaign_id))).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Lead not found.")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


# ── Finding emails ──────────────────────────────────────────────────────────
class FindBody(BaseModel):
    first_name: str = ""
    last_name: str = ""
    company_name: str = ""
    domain: str = ""


@router.post("/find")
async def find_email(body: FindBody, request: Request, db: AsyncSession = Depends(get_db)):
    """1 credit when an email is found; nothing when it is not."""
    ctx = current(request)
    result = await lookup_person_waterfall(db=db, org_id=ctx["org_id"], first_name=body.first_name,
                                           last_name=body.last_name, company_name=body.company_name, domain=body.domain)
    if result.get("error") == "insufficient_credits":
        raise HTTPException(status_code=402, detail=result["detail"])
    if result.get("error") in ("bad_input", "not_configured"):
        raise HTTPException(status_code=400 if result["error"] == "bad_input" else 503, detail=result["detail"])
    return result


# ── Replies ─────────────────────────────────────────────────────────────────
@router.get("/replies")
async def list_replies(request: Request, category: str = "", db: AsyncSession = Depends(get_db)):
    current(request)
    q = select(EmailMessage).where(EmailMessage.status == "replied")
    if category:
        q = q.where(EmailMessage.reply_category == category)
    rows = (await db.execute(q.order_by(EmailMessage.replied_at.desc()).limit(200))).scalars().all()
    camps = {c.id: c.name for c in (await db.execute(select(EmailCampaign))).scalars().all()}
    leads = {e.id: e for e in (await db.execute(select(EmailEnrollment).where(
        EmailEnrollment.id.in_([m.enrollment_id for m in rows if m.enrollment_id])))).scalars().all()} if rows else {}
    out = []
    for m in rows:
        lead = leads.get(m.enrollment_id)
        out.append({"id": m.id, "email": m.reply_from or m.recipient_email, "subject": m.subject,
                    "category": m.reply_category, "text": m.reply_snippet, "replied_at": _iso(m.replied_at),
                    "campaign": camps.get(m.campaign_id, ""),
                    "name": f"{lead.first_name} {lead.last_name}".strip() if lead else "",
                    "company": lead.company if lead else ""})
    return {"replies": out}


class CategoryBody(BaseModel):
    category: str


@router.post("/replies/{message_id}/category")
async def set_reply_category(message_id: str, body: CategoryBody, request: Request, db: AsyncSession = Depends(get_db)):
    from app.services.inbox_reader import CATEGORIES

    ctx = current(request)
    if body.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown category.")
    m = (await db.execute(select(EmailMessage).where(EmailMessage.id == message_id))).scalars().first()
    if not m:
        raise HTTPException(status_code=404, detail="Reply not found.")
    m.reply_category = body.category
    if body.category == "unsubscribe":
        await suppress(db, ctx["org_id"], m.reply_from or m.recipient_email, "unsubscribe", "manual")
    await db.commit()
    return {"ok": True}


# ── Do-not-email list ───────────────────────────────────────────────────────
class SuppressionBody(BaseModel):
    email: str  # an address, or a whole domain (example.com)
    reason: str = "manual"


@router.get("/suppression")
async def list_suppressions(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    rows = (await db.execute(select(EmailSuppression).where(EmailSuppression.org_id == ctx["org_id"])
                             .order_by(EmailSuppression.created_at.desc()).limit(1000))).scalars().all()
    return {"suppressions": [{"id": s.id, "email": s.email or f"*@{s.domain}", "reason": s.reason,
                              "source": s.source, "created_at": _iso(s.created_at)} for s in rows]}


@router.post("/suppression")
async def add_suppression(body: SuppressionBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    raw = body.email.strip().lower().lstrip("*").lstrip("@")
    if _EMAIL.match(raw):
        await suppress(db, ctx["org_id"], raw, "manual", "manual")
    elif re.match(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$", raw):
        exists = (await db.execute(select(EmailSuppression.id).where(
            EmailSuppression.org_id == ctx["org_id"], EmailSuppression.email == "", EmailSuppression.domain == raw))).first()
        if not exists:
            db.add(EmailSuppression(id=str(uuid.uuid4()), org_id=ctx["org_id"], email="", domain=raw,
                                    reason="manual", source="manual"))
    else:
        raise HTTPException(status_code=400, detail="Enter an email address or a domain like example.com.")
    await db.commit()
    return {"ok": True}


@router.delete("/suppression/{entry_id}")
async def remove_suppression(entry_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    row = (await db.execute(select(EmailSuppression).where(EmailSuppression.id == entry_id,
                                                           EmailSuppression.org_id == ctx["org_id"]))).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found.")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


# ── Unsubscribe (public, signed link in every campaign email) ───────────────
_PAGE = ('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head>'
         '<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 16px;color:#12141C">{}</body></html>')


async def _unsubscribe(token: str) -> bool:
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal

    got = read_unsubscribe_token(token)
    if not got:
        return False
    org_id, addr = got
    with org_scope(org_id):
        async with AsyncSessionLocal() as db:
            await suppress(db, org_id, addr, "unsubscribe", "link")
            for enr in (await db.execute(select(EmailEnrollment).where(EmailEnrollment.email == addr,
                                                                       EmailEnrollment.status == "active"))).scalars().all():
                enr.status = "unsubscribed"
                enr.next_action_at = None
            await db.commit()
    return True


@router.get("/u/{token}", response_class=HTMLResponse)
async def unsubscribe_page(token: str):
    """Opening the link changes nothing (mail scanners open links); the button does."""
    import html

    if not read_unsubscribe_token(token):
        return HTMLResponse(_PAGE.format("<p>This unsubscribe link is not valid.</p>"), status_code=404)
    return HTMLResponse(_PAGE.format(
        '<h2 style="font-size:20px">Unsubscribe</h2><p>Stop receiving these emails?</p>'
        f'<form method="post" action="{html.escape(token)}"><button type="submit" style="background:#12141C;color:#fff;border:0;'
        'border-radius:10px;padding:11px 18px;font-weight:700;cursor:pointer">Unsubscribe</button></form>'))


@router.post("/u/{token}", response_class=HTMLResponse)
async def unsubscribe_post(token: str):
    """The button, and mail apps' one-click unsubscribe (RFC 8058 POST)."""
    if not await _unsubscribe(token):
        return HTMLResponse(_PAGE.format("<p>This unsubscribe link is not valid.</p>"), status_code=404)
    return HTMLResponse(_PAGE.format("<h2 style=\"font-size:20px\">You're unsubscribed</h2><p>You won't get these emails again.</p>"))
