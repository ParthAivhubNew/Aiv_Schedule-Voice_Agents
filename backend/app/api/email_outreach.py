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
    EmailTemplate,
)
from app.services import mail_transport as T
from app.services.dns_verifier import setup_guide, verify_domain_dns
from app.services.email_dispatcher import mailbox_settings, read_unsubscribe_token, suppress
from app.services.enrichment_waterfall import lookup_person_waterfall
from app.services.llm_gateway import call_open_chat_llm
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


def _sending_blockers(mb: EmailMailbox) -> List[str]:
    """Why this mailbox cannot send yet, in plain words (empty when it can)."""
    out: List[str] = []
    if not mb.spf_verified:
        out.append("SPF is missing")
    if not mb.dkim_verified and not getattr(mb, "dkim_override", False):
        out.append("DKIM is missing")
    if mb.status in ("connected", "paused", "error"):
        out.append({"connected": "warm-up has not been started", "paused": "it is paused", "error": "its login is failing"}[mb.status])
    return out


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
        "spf_verified": mb.spf_verified, "dkim_verified": mb.dkim_verified, "dkim_override": bool(mb.dkim_override),
        "dmarc_verified": mb.dmarc_verified, "mx_verified": mb.mx_verified,
        "aliases": mb.aliases or [],
        "dns": mb.dns_check_details or {}, "last_sync_at": _iso(mb.last_sync_at),
        "can_send": not _sending_blockers(mb), "blockers": _sending_blockers(mb),
        "setup": setup_guide(mb.email.split("@")[-1], mb.provider, mb.dns_check_details or {
            "spf_verified": mb.spf_verified, "dkim_verified": mb.dkim_verified,
            "dmarc_verified": mb.dmarc_verified, "mx_verified": mb.mx_verified}),
        "dkim_selector": (mb.dns_check_details or {}).get("dkim_selector") or "",
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


class AliasBody(BaseModel):
    address: str
    name: str = ""


@router.post("/mailboxes/{mailbox_id}/aliases")
async def add_alias(mailbox_id: str, body: AliasBody, request: Request, db: AsyncSession = Depends(get_db)):
    """A second address this mailbox can send as (an alias set up at the email provider). It must be on the
    mailbox's own domain, so the mailbox's SPF, DKIM and DMARC records cover it."""
    current(request)
    mb = await _mailbox(db, mailbox_id)
    addr = body.address.strip().lower()
    if not _EMAIL.match(addr):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if addr.split("@")[-1] != mb.email.split("@")[-1]:
        raise HTTPException(status_code=400, detail=f"An alias must be on the same domain as the mailbox (@{mb.email.split('@')[-1]}).")
    if addr == mb.email:
        raise HTTPException(status_code=400, detail="That is the mailbox's own address.")
    aliases = list(mb.aliases or [])
    if any(a["address"] == addr for a in aliases):
        raise HTTPException(status_code=409, detail="That alias is already added.")
    if len(aliases) >= 10:
        raise HTTPException(status_code=400, detail="A mailbox can have up to 10 aliases.")
    aliases.append({"address": addr, "name": body.name.strip()[:80]})
    mb.aliases = aliases
    await db.commit()
    return {"mailbox": _mailbox_out(mb, None)}


@router.delete("/mailboxes/{mailbox_id}/aliases")
async def remove_alias(mailbox_id: str, address: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    mb = await _mailbox(db, mailbox_id)
    want = address.strip().lower()
    mb.aliases = [a for a in (mb.aliases or []) if a["address"] != want]
    for camp in (await db.execute(select(EmailCampaign))).scalars().all():
        if (camp.alias_map or {}).get(mailbox_id) == want:
            camp.alias_map = {k: v for k, v in camp.alias_map.items() if k != mailbox_id}
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


class DnsCheckBody(BaseModel):
    dkim_selector: Optional[str] = None  # a custom DKIM name, if the mail host did not use a common one


@router.post("/mailboxes/{mailbox_id}/dns-check")
async def audit_mailbox_dns(mailbox_id: str, request: Request, body: Optional[DnsCheckBody] = None,
                            db: AsyncSession = Depends(get_db)):
    current(request)
    mb = await _mailbox(db, mailbox_id)
    typed = re.sub(r"[^a-z0-9_-]", "", ((body.dkim_selector if body else "") or "").strip().lower().split("._domainkey")[0])
    selector = typed or (mb.dns_check_details or {}).get("dkim_selector_pref") or None
    dns = await verify_domain_dns(mb.email.split("@")[-1], selector)
    if selector and not dns.get("dkim_verified"):
        dns["recommendations"].append(f"No DKIM record found at {selector}._domainkey.{mb.email.split('@')[-1]} yet. DNS changes can take up to an hour.")
    if typed:
        dns["dkim_selector_pref"] = typed
    _dns_fields(mb, dns)
    await db.commit()
    return {"mailbox": _mailbox_out(mb, None)}


class DkimOverrideBody(BaseModel):
    allow: bool


@router.post("/mailboxes/{mailbox_id}/dkim-override")
async def set_dkim_override(mailbox_id: str, body: DkimOverrideBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Lets a mailbox send without a DKIM record, at the user's own risk (mail may be junked and the domain's
    reputation can suffer). SPF is still required: without it many receivers reject the mail outright.
    Bounces over 2% and the warm-up limits still protect the mailbox."""
    current(request)
    mb = await _mailbox(db, mailbox_id)
    if body.allow and not mb.spf_verified:
        raise HTTPException(status_code=400, detail="SPF is still missing, and mail without it is usually rejected outright. Add the SPF record first, then you can choose to send without DKIM.")
    mb.dkim_override = body.allow
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
        if not (mb.spf_verified and (mb.dkim_verified or mb.dkim_override)):
            pref = (mb.dns_check_details or {}).get("dkim_selector_pref")
            fresh = await verify_domain_dns(mb.email.split("@")[-1], pref)
            if pref:
                fresh["dkim_selector_pref"] = pref
            _dns_fields(mb, fresh)
            if not (mb.spf_verified and (mb.dkim_verified or mb.dkim_override)):
                await db.commit()
                missing = " and ".join(n for n, ok in (("SPF", mb.spf_verified), ("DKIM", mb.dkim_verified or mb.dkim_override)) if not ok)
                raise HTTPException(status_code=400, detail=f"Can't start yet: {missing} not found for {mb.email.split('@')[-1]}. "
                                                            "Add the record shown on this mailbox, wait a few minutes, then press Check DNS.")
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
    aliases: Dict[str, str] = {}  # {mailbox_id: alias address to send as}; leave a mailbox out to send as itself


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


async def _clean_aliases(db: AsyncSession, ids: List[str], wanted: Dict[str, str]) -> Dict[str, str]:
    """Only an alias the chosen mailbox really has is kept."""
    out: Dict[str, str] = {}
    for mid, addr in (wanted or {}).items():
        mb = (await db.execute(select(EmailMailbox).where(EmailMailbox.id == mid))).scalars().first()
        if mid in ids and mb and any(a["address"] == (addr or "").strip().lower() for a in (mb.aliases or [])):
            out[mid] = addr.strip().lower()
    return out


async def why_not_sending(db: AsyncSession, camp: EmailCampaign) -> List[Dict[str, str]]:
    """Every reason, in plain words, that this campaign has not sent yet. Mirrors the checks the sender makes, in order,
    so a person can see what is holding it back instead of guessing. `level`: red = must be fixed, amber = it will clear
    by itself or by a setting, green = nothing is wrong."""
    from datetime import date

    from app.services import credits as credit
    from app.services import email_worker as EW
    from app.services.org_settings import org_timezone

    now = datetime.utcnow()
    tz = await org_timezone(db)
    local = EW.local_now(tz, now)
    out: List[Dict[str, str]] = []

    def add(level: str, text: str) -> None:
        out.append({"level": level, "text": text})

    if camp.status != "running":
        add("amber", f"The campaign is {camp.status}, not running, so nothing sends. Press Start.")
        return out
    active = (await db.execute(select(func.count(EmailEnrollment.id)).where(
        EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active"))).scalar() or 0
    if not active:
        add("amber", "No one is waiting for an email. Everyone has already been sent to, or has replied, bounced, unsubscribed or been blocked.")
        return out
    due = (await db.execute(select(func.count(EmailEnrollment.id)).where(
        EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active", EmailEnrollment.next_action_at <= now))).scalar() or 0
    if not due:
        nxt = (await db.execute(select(func.min(EmailEnrollment.next_action_at)).where(
            EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active"))).scalar()
        add("amber", f"No one is due an email yet. The next one is due {nxt.strftime('%d %b %H:%M')} UTC." if nxt else "No one is due an email yet.")
    is_open, opens = EW.next_window(camp, local)
    if not is_open:
        days = ", ".join(n for d, n in [(1, "Mon"), (2, "Tue"), (3, "Wed"), (4, "Thu"), (5, "Fri"), (6, "Sat"), (7, "Sun")] if d in (camp.days_of_week or [1, 2, 3, 4, 5]))
        add("amber", f"It is outside the campaign's sending hours ({days}, {camp.sending_window_start}-{camp.sending_window_end}, {tz} time). "
                     f"The next window opens {opens}. Change the hours with Edit.")
    boxes = [m for m in (await db.execute(select(EmailMailbox))).scalars().all() if m.id in (camp.mailbox_ids or [])]
    if not boxes:
        add("red", "No mailbox is chosen for this campaign, or the chosen one was disconnected. Press Edit and tick a mailbox.")
    today = date.today().isoformat()
    for mb in boxes:
        if mb.last_error:
            add("red", f"{mb.email}: the mailbox reported an error: {mb.last_error}")
        if mb.status not in EW.SENDING:
            why = ", ".join(_sending_blockers(mb)) or mb.status
            add("red", f"{mb.email} can't send: {why}.")
            continue
        log = (await db.execute(select(EmailSendLog).where(EmailSendLog.mailbox_id == mb.id, EmailSendLog.date == today))).scalars().first()
        sent = (log.campaign_sent_count or 0) if log else 0
        quota = mb.campaign_quota or 0
        if mb.plan_date != today:
            add("amber", f"{mb.email} has not been planned for today yet, so it has no allowance. The sender plans each mailbox the first time it runs each day. "
                         "If this stays like this for more than a few minutes, the background sender is not running.")
        elif sent >= quota:
            add("red", f"{mb.email}: today's campaign allowance is used up ({sent} of {quota}). " + (
                "It is 0 because the mailbox is still in its first days of warm-up, or was planned before the day-one rule. Press Skip warm-up… on the mailbox to work it out again."
                if quota == 0 else "The rest will go out tomorrow. Press Skip warm-up… on the mailbox to raise the allowance."))
        elif mb.last_sent_at and (now - mb.last_sent_at).total_seconds() < (camp.min_delay_seconds or 60):
            add("amber", f"{mb.email} sent an email a moment ago and is waiting the {camp.min_delay_seconds or 60}-second gap before the next.")
    ok, why = await credit.can_start(db, "email_send")
    if not ok:
        add("red", f"Not enough Leads credits to send. {why}")
    if boxes and all((not m.last_sync_at) or (now - m.last_sync_at).total_seconds() > 900 for m in boxes):
        add("amber", "The background sender hasn't touched these mailboxes in the last 15 minutes. If this keeps showing, it is not running on the server.")
    if not out:
        add("green", "Nothing is holding it back. The next email goes out within a minute or two.")
    return out


async def _campaign_out(db: AsyncSession, camp: EmailCampaign, full: bool = False) -> Dict[str, Any]:
    counts = dict((await db.execute(select(EmailEnrollment.status, func.count(EmailEnrollment.id))
                                    .where(EmailEnrollment.campaign_id == camp.id).group_by(EmailEnrollment.status))).all())
    msgs = dict((await db.execute(select(EmailMessage.status, func.count(EmailMessage.id))
                                  .where(EmailMessage.campaign_id == camp.id).group_by(EmailMessage.status))).all())
    sent = sum(msgs.values())
    out = {
        "id": camp.id, "name": camp.name, "status": camp.status, "mailbox_ids": camp.mailbox_ids or [], "aliases": camp.alias_map or {},
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
        from app.services.email_worker import local_now, next_window
        from app.services.org_settings import org_timezone

        tz = await org_timezone(db)
        is_open, opens = next_window(camp, local_now(tz))
        out["send_window"] = {"open": is_open, "opens": opens, "timezone": tz}
        out["why"] = await why_not_sending(db, camp)
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
    known = await _known_mailboxes(db, body.mailbox_ids)
    camp = EmailCampaign(id=f"cp_{uuid.uuid4().hex[:12]}", name=body.name.strip()[:120], status="draft",
                         mailbox_ids=known, alias_map=await _clean_aliases(db, known, body.aliases), timezone_policy="org",
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
    camp.alias_map = await _clean_aliases(db, camp.mailbox_ids, body.aliases)
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
            why = "; ".join(f"{b.email}: {', '.join(_sending_blockers(b)) or 'not started'}" for b in boxes)
            raise HTTPException(status_code=400, detail=f"None of this campaign's mailboxes can send yet ({why}). Fix them on the Mailboxes page first.")
        has_leads = (await db.execute(select(EmailEnrollment.id).where(EmailEnrollment.campaign_id == camp.id,
                                                                        EmailEnrollment.status == "active").limit(1))).first()
        if not has_leads:
            raise HTTPException(status_code=400, detail="Add leads first.")
        camp.status = "running"
        try:  # pressing Start in the app is an approval too (for campaigns made through the API)
            from app.public_api.email import note_started_in_app

            note_started_in_app(camp.id)
        except Exception:
            pass
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
    personal_line: str = ""  # the opening sentence written for this person, if any (see /ai/personalise)
    facts: List[str] = []  # what the sender knows about this company, for writing its opening line
    company_number: str = ""  # lets us match the company register exactly
    website: str = ""


class LeadsBody(BaseModel):
    leads: List[LeadBody]


def _lead_vars(lead: "LeadBody") -> Optional[Dict[str, Any]]:
    """Per-person extras kept with the enrolment: the opening line, and the facts it can be written from."""
    out: Dict[str, Any] = {}
    if lead.personal_line.strip():
        out["personal_line"] = " ".join(lead.personal_line.split())[:400]
    facts = [" ".join(f.split())[:300] for f in lead.facts if f.strip()][:8]
    if facts:
        out["facts"] = facts
    if lead.company_number.strip():
        out["company_number"] = lead.company_number.strip()[:40]
    if lead.website.strip():
        out["website"] = lead.website.strip()[:200]
    return out or None


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
                               company=lead.company.strip()[:160], current_step=1, status="active", next_action_at=now,
                               vars=_lead_vars(lead)))
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
    mission_id: Optional[str] = None
    prospect_id: Optional[str] = None


@router.post("/find")
async def find_email(body: FindBody, request: Request, db: AsyncSession = Depends(get_db)):
    """1 credit when an email is found; nothing when it is not.

    mission_id/prospect_id are optional: pass them when this is called for a specific
    prospect (e.g. from a mission's lead row) so a found email can auto-enroll into that
    mission's linked email campaign (Mission.auto_enroll_campaign_id).
    """
    ctx = current(request)
    result = await lookup_person_waterfall(db=db, org_id=ctx["org_id"], first_name=body.first_name,
                                           last_name=body.last_name, company_name=body.company_name,
                                           domain=body.domain, mission_id=body.mission_id,
                                           prospect_id=body.prospect_id)
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


# ── Email Templates (Database-backed per company) ────────────────────────────

class TemplateIn(BaseModel):
    name: str
    subject: str = ""
    body_text: str = ""
    category: str = "Outbound"
    tags: List[str] = []


@router.get("/templates")
async def list_email_templates(request: Request, db: AsyncSession = Depends(get_db)):
    """Lists saved email templates for the company, seeding starter templates if empty."""
    ctx = current(request)
    org_id = ctx["org_id"]
    rows = (await db.execute(select(EmailTemplate).where(EmailTemplate.org_id == org_id).order_by(EmailTemplate.created_at.desc()))).scalars().all()

    if not rows:
        # Seed standard B2B starter templates in the database for the user
        starters = [
            EmailTemplate(
                id=f"tpl_{uuid.uuid4().hex[:10]}",
                org_id=org_id,
                name="Cold Value Proposition",
                category="Outbound",
                subject="Quick question regarding {{company}}'s operations",
                body_text="Hi {{firstName}},\n\nI noticed {{company}} is scaling rapidly. When volume grows, manual coordination eats hours.\n\nWe built an autonomous system that automates client confirmations and dispatch follow-ups.\n\nAre you open to a brief 7-minute briefing next week?\n\nBest,\n{{senderName}}",
                tags=["Cold", "Initial Hook", "Outbound"],
            ),
            EmailTemplate(
                id=f"tpl_{uuid.uuid4().hex[:10]}",
                org_id=org_id,
                name="Customer Proof & Case Study",
                category="Follow-up",
                subject="How similar teams cut response latency by 65%",
                body_text="Hi {{firstName}},\n\nQuick follow-up on my note regarding autonomous ops updates.\n\nOne of our logistics partners recently recovered 14 hours per week within 30 days of deployment.\n\nWould you like me to send over the 2-page implementation case study?\n\nBest,\n{{senderName}}",
                tags=["Follow-up", "Social Proof", "Metric"],
            ),
            EmailTemplate(
                id=f"tpl_{uuid.uuid4().hex[:10]}",
                org_id=org_id,
                name="Executive Breakup Note",
                category="Nudge",
                subject="Permission to close your file for now?",
                body_text="Hi {{firstName}},\n\nI assume your team's workflow tools are locked in for this quarter.\n\nIf this is no longer a priority, no problem at all — let me know if you'd like me to check back in Q3 instead.\n\nBest,\n{{senderName}}",
                tags=["Breakup", "Low Friction", "Clean-up"],
            ),
        ]
        for s in starters:
            db.add(s)
        await db.commit()
        rows = starters

    return {
        "templates": [
            {
                "id": t.id,
                "name": t.name,
                "subject": t.subject,
                "body_text": t.body_text,
                "category": t.category,
                "tags": t.tags or [],
                "created_at": _iso(t.created_at),
                "updated_at": _iso(t.updated_at),
            }
            for t in rows
        ]
    }


@router.post("/templates")
async def create_email_template(body: TemplateIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Saves a new custom email template in the database for the company."""
    ctx = current(request)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name is required.")

    tpl = EmailTemplate(
        id=f"tpl_{uuid.uuid4().hex[:10]}",
        org_id=ctx["org_id"],
        name=name,
        subject=body.subject or "",
        body_text=body.body_text or "",
        category=body.category or "Outbound",
        tags=body.tags or [],
    )
    db.add(tpl)
    await db.commit()
    return {
        "ok": True,
        "template": {
            "id": tpl.id,
            "name": tpl.name,
            "subject": tpl.subject,
            "body_text": tpl.body_text,
            "category": tpl.category,
            "tags": tpl.tags or [],
        }
    }


@router.put("/templates/{template_id}")
async def update_email_template(template_id: str, body: TemplateIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Updates an existing email template in the database."""
    ctx = current(request)
    tpl = (await db.execute(select(EmailTemplate).where(EmailTemplate.id == template_id,
                                                        EmailTemplate.org_id == ctx["org_id"]))).scalars().first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found.")

    if body.name:
        tpl.name = body.name.strip()
    tpl.subject = body.subject
    tpl.body_text = body.body_text
    tpl.category = body.category or tpl.category
    tpl.tags = body.tags
    tpl.updated_at = datetime.utcnow()
    await db.commit()
    return {"ok": True, "template": {"id": tpl.id, "name": tpl.name, "subject": tpl.subject, "body_text": tpl.body_text}}


@router.delete("/templates/{template_id}")
async def delete_email_template(template_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Deletes an email template from the company's library."""
    ctx = current(request)
    tpl = (await db.execute(select(EmailTemplate).where(EmailTemplate.id == template_id,
                                                        EmailTemplate.org_id == ctx["org_id"]))).scalars().first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found.")
    await db.delete(tpl)
    await db.commit()
    return {"ok": True}


# ── Real AI Email Copywriter & Drafter (with Test Run & Model Support) ──────

class AiDraftRequest(BaseModel):
    action_type: str = "generate"  # generate, concise, cta, executive, metric, custom
    topic: str = ""
    target_audience: str = ""
    objective: str = ""
    custom_prompt: str = ""
    current_subject: str = ""
    current_body: str = ""
    recipient_name: str = "Alex"
    company_name: str = "Target Account"
    sender_name: str = ""
    # Optional dedicated model & credentials override for test runs
    api_key: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None


@router.post("/ai/draft")
async def generate_or_refine_email_draft(body: AiDraftRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Generates or refines cold email copy using the platform or custom LLM."""
    ctx = current(request)
    sender = body.sender_name or ctx.get("name") or "Our Team"
    recipient = body.recipient_name or "{{firstName}}"
    company = body.company_name or "{{companyName}}"

    system_prompt = (
        "You are an expert enterprise B2B cold email copywriter with deep expertise in cold email deliverability. "
        "Rules: Never invent a statistic, customer, result or claim: use only facts the user gave you. "
        "Keep emails under 120 words, punchy, consultative, no spam trigger words (e.g. no 'guaranteed', '100% free', 'miracle'). "
        "Use natural tone, clear value proposition, and low-friction calls to action. "
        "Always respond in JSON format with two keys: 'subject' (concise subject line) and 'body' (the email text with greeting and sign-off)."
    )

    if body.action_type == "concise":
        user_prompt = (
            f"Rewrite the following email to be ultra-concise (<75 words), direct, and high-impact while preserving the core message:\n\n"
            f"Current Subject: {body.current_subject}\n"
            f"Current Body:\n{body.current_body}\n\n"
            f"Sender Name: {sender}\n"
            "Output JSON with 'subject' and 'body'."
        )
    elif body.action_type == "cta":
        user_prompt = (
            f"Rewrite the call-to-action in the following email to be extremely low friction (e.g. asking for interest or permission rather than demanding a 30m demo):\n\n"
            f"Current Subject: {body.current_subject}\n"
            f"Current Body:\n{body.current_body}\n\n"
            f"Sender Name: {sender}\n"
            "Output JSON with 'subject' and 'body'."
        )
    elif body.action_type == "executive":
        user_prompt = (
            f"Rewrite the following email in an authoritative, consultative executive tone suitable for VP and C-Level buyers:\n\n"
            f"Current Subject: {body.current_subject}\n"
            f"Current Body:\n{body.current_body}\n\n"
            f"Sender Name: {sender}\n"
            "Output JSON with 'subject' and 'body'."
        )
    elif body.action_type == "custom" and body.custom_prompt:
        user_prompt = (
            f"Modify the following email according to this specific instruction: '{body.custom_prompt}'\n\n"
            f"Current Subject: {body.current_subject}\n"
            f"Current Body:\n{body.current_body}\n\n"
            f"Sender Name: {sender}\n"
            "Output JSON with 'subject' and 'body'."
        )
    else:
        # Default fresh generation
        user_prompt = (
            f"Draft a high-converting cold email for B2B outreach.\n"
            f"Target Audience: {body.target_audience or 'the people who run small businesses'}\n"
            f"Topic / Value Prop: {body.topic or 'not given'}\n"
            f"Key Objective: {body.objective or 'start a conversation'}\n"
            f"Recipient: {recipient} at {company}\n"
            f"Sender: {sender}\n\n"
            "Output JSON with 'subject' and 'body'."
        )

    try:
        llm_result = await call_open_chat_llm(
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=system_prompt,
            temperature=0.3,
            db=db,
            api_key=body.api_key,
            provider=body.provider,
            model=body.model,
            base_url=body.base_url,
            scope="leadgen",
        )
        reply_raw = llm_result.get("reply") or ""

        # Parse JSON reply or format fallback
        subject_out = ""
        body_out = ""
        try:
            # Strip potential markdown fences
            clean = reply_raw.strip()
            if clean.startswith("```json"):
                clean = clean[7:]
            if clean.startswith("```"):
                clean = clean[3:]
            if clean.endswith("```"):
                clean = clean[:-3]
            data = json.loads(clean.strip())
            subject_out = data.get("subject", "")
            body_out = data.get("body", "")
        except Exception:
            # If plain text returned
            lines = reply_raw.strip().split("\n")
            if lines and lines[0].lower().startswith("subject:"):
                subject_out = lines[0].replace("Subject:", "").replace("subject:", "").strip()
                body_out = "\n".join(lines[1:]).strip()
            else:
                subject_out = body.current_subject or f"Quick note regarding {company}'s operations"
                body_out = reply_raw.strip()

        return {
            "ok": True,
            "subject": subject_out,
            "body": body_out,
            "provider": body.provider or "platform_ai",
            "model": body.model or "default",
        }
    except Exception as err:
        logger.warning(f"AI Email Draft generation error: {err}")
        # Never an invented email: the caller is told the AI could not write it and nothing is filled in.
        return {"ok": False, "error": str(err), "subject": body.current_subject, "body": body.current_body}


# ── Smart writing: knows the sender's business and each receiver's facts ────
class ProfileBody(BaseModel):
    company: str = ""
    website: str = ""
    sells: str = ""
    audience: str = ""
    offer: str = ""
    tone: str = ""
    sender_name: str = ""
    sender_title: str = ""
    proof: List[str] = []


def _profile_key(ctx: Dict[str, Any]) -> str:
    return f"leadprofile:{ctx['org_id']}"


# What a company profile holds before anyone has filled it in. These are not facts about the business, so the
# writer never treats them as such (otherwise a new account would get emails about someone else's product).
_UNFILLED = {
    "name": {"", "your company"},
    "pitch": {"", "ai-powered business intelligence dashboards for mid-market operations teams"},
    "website": {"", "https://aivhub.io"},
}


def _filled(key: str, value: Any) -> str:
    v = " ".join(str(value or "").split())
    return "" if v.lower() in _UNFILLED[key] else v


async def _company_profile(db: AsyncSession):
    from app.models.models import CompanyProfile

    return (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()


async def _profile(db: AsyncSession, ctx: Dict[str, Any], need: bool = True) -> Dict[str, Any]:
    """What the writer may say about the sender: the organisation's shared company profile (the same one the
    other tools use) and its services, plus what only email needs (proof, offer, sign-off)."""
    from app.models.models import Service
    from app.services import credits as credit
    from app.services import email_writer as W

    cp = await _company_profile(db)
    services = list((await db.execute(select(Service))).scalars().all())
    extra = await credit._get_doc(db, _profile_key(ctx))
    sells = _filled("pitch", getattr(cp, "pitch", ""))
    if services:
        sells = (sells + " " if sells else "") + "Services: " + "; ".join(f"{s.name}: {s.desc}" for s in services[:6])
    ideal = "; ".join(dict.fromkeys(s.ideal for s in services if s.ideal))[:400]
    p = W.clean_profile({
        "company": _filled("name", getattr(cp, "name", "")), "website": _filled("website", getattr(cp, "website", "")),
        "sells": sells[:700], "audience": extra.get("audience") or ideal, "offer": extra.get("offer", ""),
        "tone": getattr(cp, "tone", "") or "", "sender_name": extra.get("sender_name") or ctx.get("name") or "",
        "sender_title": extra.get("sender_title", ""), "proof": extra.get("proof") or [],
    })
    missing = W.profile_missing(p)
    if need and missing:
        raise HTTPException(status_code=400, detail="Tell us about your business first. Still needed: " + ", ".join(missing) + ".")
    return p


def _can_edit_company(ctx: Dict[str, Any]) -> bool:
    from app.core import permissions as P

    return bool(ctx.get("is_admin") or P.allows(ctx.get("perms") or {}, "company", P.FULL))


@router.get("/ai/profile")
async def get_writing_profile(request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.models import Service
    from app.services import email_writer as W

    from app.services import credits as credit

    ctx = current(request)
    p = await _profile(db, ctx, need=False)
    cp = await _company_profile(db)
    extra = await credit._get_doc(db, _profile_key(ctx))
    n = len((await db.execute(select(Service))).scalars().all())
    # `edit` is what the form shows and saves back; `profile` is what the writer reads (it also folds in services).
    edit = {"company": _filled("name", getattr(cp, "name", "")), "website": _filled("website", getattr(cp, "website", "")),
            "sells": _filled("pitch", getattr(cp, "pitch", "")), "tone": getattr(cp, "tone", "") or "",
            "audience": extra.get("audience", ""), "offer": extra.get("offer", ""), "sender_name": extra.get("sender_name") or ctx.get("name") or "",
            "sender_title": extra.get("sender_title", ""), "proof": extra.get("proof") or []}
    return {"profile": p, "edit": edit, "missing": W.profile_missing(p), "services": n, "can_edit": _can_edit_company(ctx)}


@router.put("/ai/profile")
async def save_writing_profile(body: ProfileBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Saves into the shared company profile (name, what you do, website, tone) so every tool reads the same
    facts, and keeps the email-only extras (proof, offer, sign-off, who it is for) beside it."""
    from app.models.models import CompanyProfile
    from app.services import credits as credit
    from app.services import email_writer as W

    ctx = current(request)
    if not _can_edit_company(ctx):
        raise HTTPException(status_code=403, detail="Only an admin can change the company profile, because every tool reads it. Ask an admin to update it.")
    p = W.clean_profile(body.model_dump())
    cp = await _company_profile(db)
    if not cp:
        cp = CompanyProfile(id="default")
        db.add(cp)
    cp.name = p["company"] or cp.name
    cp.website = p["website"] or cp.website
    cp.tone = p["tone"] or cp.tone
    if p["sells"]:
        cp.pitch = p["sells"]
    await credit._put_doc(db, _profile_key(ctx), {k: p[k] for k in ("audience", "offer", "sender_name", "sender_title", "proof")})
    await db.commit()
    return await get_writing_profile(request, db)


async def _accounts_and_records(db: AsyncSession, ids: List[str]):
    from app.models.models import BusinessRecord, LeadAccount

    accounts = list((await db.execute(select(LeadAccount).where(LeadAccount.id.in_(ids[:2000])))).scalars().all()) if ids else []
    rec_ids = [a.business_record_id for a in accounts if a.business_record_id]
    records = {r.id: r for r in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(rec_ids)))).scalars().all()} if rec_ids else {}
    return accounts, records


def _list_context(accounts: List[Any], records: Dict[str, Any]) -> str:
    """What the receivers have in common, in plain words, from the list itself."""
    if not accounts:
        return ""
    acts: Dict[str, int] = {}
    towns: Dict[str, int] = {}
    for a in accounts:
        rec = records.get(a.business_record_id)
        act = ((getattr(rec, "sic_text", "") or "").split("|")[0] or a.industry or "").strip()
        town = (getattr(rec, "region", "") or a.region or "").strip()
        if act:
            acts[act[:80]] = acts.get(act[:80], 0) + 1
        if town:
            towns[town[:40]] = towns.get(town[:40], 0) + 1

    def top(d: Dict[str, int], n: int) -> str:
        return ", ".join(k for k, _ in sorted(d.items(), key=lambda kv: -kv[1])[:n])

    out = [f"A list of {len(accounts):,} UK businesses."]
    if acts:
        out.append(f"Their most common activities: {top(acts, 4)}.")
    if towns:
        out.append(f"Mostly in: {top(towns, 5)}.")
    return " ".join(out)


class SequenceBody(BaseModel):
    account_ids: List[str] = []
    steps: int = 3
    personalise: bool = True
    instruction: str = ""


@router.post("/ai/sequence")
async def write_sequence(body: SequenceBody, request: Request, db: AsyncSession = Depends(get_db)):
    """A whole email sequence written from the sender's profile and what the list has in common. Free; every
    email comes back checked, with `warnings` for anything the facts do not back up."""
    from app.services import email_writer as W

    ctx = current(request)
    profile = await _profile(db, ctx)
    accounts, records = await _accounts_and_records(db, body.account_ids)
    await W.spend_allowance(db, ctx["org_id"])
    await db.commit()
    context = _list_context(accounts, records)
    try:
        steps = await W.draft_sequence(db, profile, context, count=max(1, min(5, body.steps)), personalise=body.personalise,
                                       instruction=body.instruction.strip()[:400])
    except W.WriterUnavailable as err:
        raise HTTPException(status_code=502, detail="The writing AI isn't available right now, so nothing was written. Try again in a minute.") from err
    return {"steps": steps, "context": context}


class RefineBody(BaseModel):
    subject: str = ""
    body: str
    action: str = "custom"  # shorter | softer | formal | clearer | custom
    instruction: str = ""


@router.post("/ai/refine")
async def refine_email(body: RefineBody, request: Request, db: AsyncSession = Depends(get_db)):
    from app.services import email_writer as W

    ctx = current(request)
    profile = await _profile(db, ctx)
    await W.spend_allowance(db, ctx["org_id"])
    await db.commit()
    try:
        return await W.refine(db, profile, body.subject, body.body, body.action, body.instruction[:400])
    except W.WriterUnavailable as err:
        raise HTTPException(status_code=502, detail="The writing AI isn't available right now, so nothing was changed.") from err


class PersonaliseBody(BaseModel):
    account_ids: List[str]


@router.post("/ai/personalise")
async def personalise_lines(body: PersonaliseBody, request: Request, db: AsyncSession = Depends(get_db)):
    """One opening sentence per company, written only from what we hold about it and shown with the facts it
    used. A line that fails the fact check is dropped, and only lines actually written are charged."""
    from app.services import credits as credit
    from app.services import email_writer as W

    ctx = current(request)
    profile = await _profile(db, ctx)
    if len(body.account_ids) > 300:
        raise HTTPException(status_code=400, detail="Write up to 300 opening lines at a time.")
    accounts, records = await _accounts_and_records(db, body.account_ids)
    rows = [(a, W.recipient_facts(a, records.get(a.business_record_id))) for a in accounts]
    todo = [(a, f) for a, f in rows if f]
    ref = f"email_write:{uuid.uuid4().hex[:12]}"
    if todo:
        ok, why = await credit.hold(db, [{"item": "lead_email_write", "quantity": len(todo) / W.PER_CREDIT, "ref": ref,
                                          "note": "Personalised email lines (held)"}])
        if not ok:
            await db.commit()
            raise HTTPException(status_code=402, detail=why)
        await W.spend_allowance(db, ctx["org_id"], len(todo))
        await db.commit()
    written = await W.personalise_many(db, profile, todo) if todo else []
    by_id = {a.id: r for (a, _), r in zip(todo, written)}
    made = sum(1 for r in written if r["line"])
    charged = 0
    if todo:
        await credit.release(db, [ref])
        charged = await credit.charge(db, "lead_email_write", made / W.PER_CREDIT, ref, f"Personalised email lines: {made}")
        await db.commit()
    lines = []
    for a, _ in rows:
        r = by_id.get(a.id) or {"line": "", "facts": [], "reason": "We hold no facts about this company to write from."}
        lines.append({"account_id": a.id, "name": a.name, "line": r["line"], "facts": r["facts"], "reason": r["reason"]})
    return {"lines": lines, "written": made, "charged": charged}


# ── Sent emails: what actually went out, and what became of it ──────────────
def _sent_status(m: EmailMessage) -> str:
    return m.status if m.status in ("replied", "bounced", "failed") else "sent"


async def sent_rows(db: AsyncSession, *, mailbox_id: str = "", campaign_id: str = "", status: str = "", kind: str = "", q: str = "",
                    limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    """Emails this organisation sent (warm-up traffic is left out), newest first, with who they went to and what happened."""
    from sqlalchemy import or_

    where = [EmailMessage.is_warmup.is_(False)]
    if mailbox_id:
        where.append(EmailMessage.mailbox_id == mailbox_id)
    if campaign_id:
        where.append(EmailMessage.campaign_id == campaign_id)
    if kind == "one_to_one":
        where.append(EmailMessage.campaign_id == "")
    elif kind == "campaign":
        where.append(EmailMessage.campaign_id != "")
    if status == "sent":
        where.append(EmailMessage.status.notin_(["replied", "bounced", "failed"]))
    elif status in ("replied", "bounced", "failed"):
        where.append(EmailMessage.status == status)
    if q.strip():
        like = f"%{q.strip()}%"
        where.append(or_(EmailMessage.recipient_email.ilike(like), EmailMessage.subject.ilike(like)))
    total = (await db.execute(select(func.count(EmailMessage.id)).where(*where))).scalar() or 0
    rows = (await db.execute(select(EmailMessage).where(*where).order_by(func.coalesce(EmailMessage.sent_at, EmailMessage.created_at).desc())
                             .limit(max(1, min(limit, 201))).offset(max(0, offset)))).scalars().all()
    return {"messages": await _present(db, rows), "total": total}


async def _present(db: AsyncSession, rows: List[EmailMessage]) -> List[Dict[str, Any]]:
    boxes = {b.id: b.email for b in (await db.execute(select(EmailMailbox))).scalars().all()}
    camps = {c.id: c.name for c in (await db.execute(select(EmailCampaign))).scalars().all()}
    leads = {e.id: e for e in (await db.execute(select(EmailEnrollment).where(
        EmailEnrollment.id.in_([m.enrollment_id for m in rows if m.enrollment_id])))).scalars().all()} if rows else {}
    out = []
    for m in rows:
        lead = leads.get(m.enrollment_id)
        out.append({"id": m.id, "to": m.recipient_email, "name": f"{lead.first_name} {lead.last_name}".strip() if lead else "",
                    "company": lead.company if lead else "", "subject": m.subject or "", "status": _sent_status(m),
                    "sent_at": _iso(m.sent_at or m.created_at), "mailbox_id": m.mailbox_id or "", "mailbox": boxes.get(m.mailbox_id or "", ""),
                    "campaign_id": m.campaign_id or "", "campaign": camps.get(m.campaign_id, "") if m.campaign_id else "",
                    "kind": "campaign" if m.campaign_id else "one_to_one"})
    return out


async def sent_detail(db: AsyncSession, message_id: str) -> Optional[Dict[str, Any]]:
    m = (await db.execute(select(EmailMessage).where(EmailMessage.id == message_id, EmailMessage.is_warmup.is_(False)))).scalars().first()
    if not m:
        return None
    base = (await _present(db, [m]))[0]
    return {**base, "body": m.body_text or "", "bounce_reason": m.bounce_reason or "", "reply": m.reply_snippet or "", "reply_from": m.reply_from or "",
            "reply_category": m.reply_category or "", "replied_at": _iso(m.replied_at)}


@router.get("/messages")
async def list_sent(request: Request, mailbox_id: str = "", campaign_id: str = "", status: str = "", kind: str = "", q: str = "",
                    limit: int = 50, offset: int = 0, db: AsyncSession = Depends(get_db)):
    current(request)
    return await sent_rows(db, mailbox_id=mailbox_id, campaign_id=campaign_id, status=status, kind=kind, q=q, limit=limit, offset=offset)


@router.get("/messages/{message_id}")
async def get_sent(message_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    found = await sent_detail(db, message_id)
    if not found:
        raise HTTPException(status_code=404, detail="That email wasn't found.")
    return {"message": found}
