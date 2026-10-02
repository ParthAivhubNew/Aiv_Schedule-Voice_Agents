"""Cold Email Outreach, Mailbox Warmup, DNS Verifier, and Lead Waterfall REST API."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
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
    PersonCache,
    Prospect,
)
from app.services.dns_verifier import verify_domain_dns
from app.services.email_dispatcher import send_cold_email, is_email_suppressed
from app.services.email_warmup_engine import (
    MailboxState,
    DayLog,
    plan_mailbox_day,
)
from app.services.enrichment_waterfall import lookup_person_waterfall
from app.services.secret_box import seal

logger = logging.getLogger("email_outreach_api")

router = APIRouter(prefix="/email", tags=["Cold Email & Warmup Plugin"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ConnectMailboxRequest(BaseModel):
    email: str
    display_name: str = ""
    provider: str = "google"  # google, microsoft, smtp
    auth_type: str = "oauth"
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    max_daily_target: int = 40


class DNSCheckRequest(BaseModel):
    domain: str
    dkim_selector: Optional[str] = None


class CreateCampaignRequest(BaseModel):
    name: str
    mailbox_ids: List[str] = []
    timezone_policy: str = "recipient"
    sending_window_start: str = "09:00"
    sending_window_end: str = "17:00"
    days_of_week: List[int] = [1, 2, 3, 4, 5]
    steps: List[Dict[str, Any]] = []


class EnrichLookupRequest(BaseModel):
    first_name: str = ""
    last_name: str = ""
    company_name: str = ""
    domain: str = ""
    pdl_person_id: Optional[str] = None


class AddSuppressionRequest(BaseModel):
    email: str
    reason: str = "manual"


# ── Mailbox & Warmup Endpoints ───────────────────────────────────────────────

@router.get("/mailboxes")
async def list_mailboxes(
    db: AsyncSession = Depends(get_db),
    user: Any = Depends(current)
):
    """Lists connected sending mailboxes with deliverability and warmup stats."""
    org_id = user.org_id
    stmt = select(EmailMailbox).where(EmailMailbox.org_id == org_id).order_by(EmailMailbox.created_at.desc())
    result = await db.execute(stmt)
    mailboxes = result.scalars().all()

    today_str = date.today().isoformat()
    items = []
    for mb in mailboxes:
        # Get today's log
        log_stmt = select(EmailSendLog).where(
            EmailSendLog.mailbox_id == mb.id,
            EmailSendLog.date == today_str
        )
        log_res = await db.execute(log_stmt)
        today_log = log_res.scalars().first()

        items.append({
            "id": mb.id,
            "email": mb.email,
            "display_name": mb.display_name,
            "provider": mb.provider,
            "status": mb.status,
            "pause_reason": mb.pause_reason,
            "daily_cap": mb.daily_cap,
            "max_daily_target": mb.max_daily_target,
            "consecutive_healthy_days": mb.consecutive_healthy_days,
            "bounce_rate_7d": mb.bounce_rate_7d,
            "spf_verified": mb.spf_verified,
            "dkim_verified": mb.dkim_verified,
            "dmarc_verified": mb.dmarc_verified,
            "mx_verified": mb.mx_verified,
            "today_sent": today_log.sent_count if today_log else 0,
            "today_warmup_sent": today_log.warmup_sent_count if today_log else 0,
            "today_campaign_sent": today_log.campaign_sent_count if today_log else 0,
            "today_bounced": today_log.bounced_count if today_log else 0,
        })

    return {"mailboxes": items}


@router.post("/mailboxes")
async def connect_mailbox(
    payload: ConnectMailboxRequest,
    db: AsyncSession = Depends(get_db),
    user: Any = Depends(current)
):
    """Connects a new Google Workspace, Microsoft 365, or SMTP/IMAP mailbox."""
    org_id = user.org_id
    email_clean = payload.email.strip().lower()
    domain = email_clean.split("@")[-1]

    # Initial DNS audit
    dns_result = await verify_domain_dns(domain)

    # Secure credentials sealing
    cred_json = "{}"
    if payload.provider == "smtp":
        import json
        cred_json = json.dumps({
            "host": payload.smtp_host,
            "port": payload.smtp_port,
            "username": payload.smtp_user or email_clean,
            "password": payload.smtp_password,
            "use_tls": True,
        })

    mailbox = EmailMailbox(
        id=f"mb_{uuid.uuid4().hex[:12]}",
        org_id=org_id,
        operator_id=user.operator_id or "",
        email=email_clean,
        display_name=payload.display_name or email_clean.split("@")[0],
        provider=payload.provider,
        auth_type=payload.auth_type,
        credentials_encrypted=seal(cred_json) if payload.provider == "smtp" else "",
        status="connected",
        daily_cap=5,
        max_daily_target=payload.max_daily_target,
        spf_verified=dns_result["spf_verified"],
        dkim_verified=dns_result["dkim_verified"],
        dmarc_verified=dns_result["dmarc_verified"],
        mx_verified=dns_result["mx_verified"],
        last_dns_check_at=datetime.utcnow(),
        dns_check_details=dns_result,
    )
    db.add(mailbox)
    await db.commit()

    return {
        "success": True,
        "mailbox_id": mailbox.id,
        "email": mailbox.email,
        "dns_verified": dns_result["all_passed"],
        "dns_details": dns_result,
    }


@router.post("/mailboxes/{mailbox_id}/dns-check")
async def audit_mailbox_dns(
    mailbox_id: str,
    db: AsyncSession = Depends(get_db),
    user: Any = Depends(current)
):
    """Runs a fresh real-time DNS check for SPF, DKIM, DMARC, and MX records."""
    stmt = select(EmailMailbox).where(EmailMailbox.id == mailbox_id, EmailMailbox.org_id == user.org_id)
    res = await db.execute(stmt)
    mb = res.scalars().first()
    if not mb:
        raise HTTPException(status_code=404, detail="Mailbox not found")

    domain = mb.email.split("@")[-1]
    dns_res = await verify_domain_dns(domain)

    mb.spf_verified = dns_res["spf_verified"]
    mb.dkim_verified = dns_res["dkim_verified"]
    mb.dmarc_verified = dns_res["dmarc_verified"]
    mb.mx_verified = dns_res["mx_verified"]
    mb.last_dns_check_at = datetime.utcnow()
    mb.dns_check_details = dns_res

    await db.commit()
    return {"mailbox_id": mb.id, "dns": dns_res}


@router.post("/mailboxes/{mailbox_id}/warmup/toggle")
async def toggle_warmup(
    mailbox_id: str,
    db: AsyncSession = Depends(get_db),
    user: Any = Depends(current)
):
    """Starts or pauses the automated deliverability warmup engine for a mailbox."""
    stmt = select(EmailMailbox).where(EmailMailbox.id == mailbox_id, EmailMailbox.org_id == user.org_id)
    res = await db.execute(stmt)
    mb = res.scalars().first()
    if not mb:
        raise HTTPException(status_code=404, detail="Mailbox not found")

    if mb.status in ("warming", "active", "graduated"):
        mb.status = "paused"
        mb.pause_reason = "Warmup paused by user."
    else:
        # Check DNS before starting warmup
        if not (mb.spf_verified and mb.dkim_verified and mb.dmarc_verified):
            # Run quick re-check
            domain = mb.email.split("@")[-1]
            dns_res = await verify_domain_dns(domain)
            mb.spf_verified = dns_res["spf_verified"]
            mb.dkim_verified = dns_res["dkim_verified"]
            mb.dmarc_verified = dns_res["dmarc_verified"]
            mb.mx_verified = dns_res["mx_verified"]
            if not (mb.spf_verified and mb.dkim_verified):
                raise HTTPException(
                    status_code=400,
                    detail="Cannot start warmup: SPF and DKIM DNS records must be configured first."
                )

        mb.status = "warming"
        mb.pause_reason = ""
        if not mb.warmup_started_at:
            mb.warmup_started_at = datetime.utcnow()

    await db.commit()
    return {"mailbox_id": mb.id, "status": mb.status, "daily_cap": mb.daily_cap}


# ── Lead Waterfall Enrichment Endpoint ───────────────────────────────────────

@router.post("/enrich/lookup")
async def enrich_lead(
    payload: EnrichLookupRequest,
    db: AsyncSession = Depends(get_db),
    user: Any = Depends(current)
):
    """Cascading lead enrichment waterfall with PECR classification & flat 1 credit charge."""
    result = await lookup_person_waterfall(
        db=db,
        org_id=user.org_id,
        first_name=payload.first_name,
        last_name=payload.last_name,
        company_name=payload.company_name,
        domain=payload.domain,
        pdl_person_id=payload.pdl_person_id,
    )
    if "error" in result:
        raise HTTPException(status_code=402, detail=result["detail"])
    return result


# ── Suppression & Compliance Endpoints ───────────────────────────────────────

@router.get("/suppression")
async def list_suppressions(
    db: AsyncSession = Depends(get_db),
    user: Any = Depends(current)
):
    """Lists suppressed emails for the organization."""
    stmt = select(EmailSuppression).where(
        (EmailSuppression.org_id == user.org_id) | (EmailSuppression.org_id == None)  # noqa: E711
    ).order_by(EmailSuppression.created_at.desc()).limit(200)
    res = await db.execute(stmt)
    entries = res.scalars().all()

    return {
        "suppressions": [
            {
                "id": s.id,
                "email": s.email,
                "reason": s.reason,
                "source": s.source,
                "is_global": s.org_id is None,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in entries
        ]
    }


@router.post("/suppression")
async def add_suppression(
    payload: AddSuppressionRequest,
    db: AsyncSession = Depends(get_db),
    user: Any = Depends(current)
):
    """Manually adds an email address to the organization's suppression list."""
    email_clean = payload.email.strip().lower()
    entry = EmailSuppression(
        id=str(uuid.uuid4()),
        org_id=user.org_id,
        email=email_clean,
        domain=email_clean.split("@")[-1] if "@" in email_clean else "",
        reason=payload.reason,
        source="manual",
    )
    db.add(entry)
    await db.commit()
    return {"success": True, "email": email_clean}


# ── Unified Inbox & Campaign Messages ───────────────────────────────────────

@router.get("/inbox")
async def get_unified_inbox(
    category: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: Any = Depends(current)
):
    """Retrieves replied cold outreach messages with AI intent categorization."""
    stmt = select(EmailMessage).where(
        EmailMessage.org_id == user.org_id,
        EmailMessage.status == "replied"
    )
    if category:
        stmt = stmt.where(EmailMessage.reply_category == category)
    
    stmt = stmt.order_by(EmailMessage.replied_at.desc()).limit(100)
    res = await db.execute(stmt)
    messages = res.scalars().all()

    return {
        "threads": [
            {
                "id": m.id,
                "recipient_email": m.recipient_email,
                "subject": m.subject,
                "reply_category": m.reply_category,
                "reply_snippet": m.reply_snippet,
                "replied_at": m.replied_at.isoformat() if m.replied_at else None,
            }
            for m in messages
        ]
    }
