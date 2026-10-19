"""Once a minute, per company: tell the customer's webhooks what happened to their API email campaigns
(ready, approved, replied, finished) and ask approvers to review a new draft."""
from __future__ import annotations

import html
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import EmailCampaign, EmailMessage, PublicObject
from app.public_api import email as E
from app.public_api import links

logger = logging.getLogger("public_api.email_events")
LOOKBACK = timedelta(days=60)


async def tick(db: AsyncSession) -> None:
    """Never raises: a problem here must not hold up anything else."""
    try:
        await _round(db)
    except Exception:
        logger.exception("[public-api] email events round failed")
        await db.rollback()


async def _round(db: AsyncSession) -> None:
    from app.core.tenancy import current_org
    from app.services.webhook_dispatcher import dispatch_event

    org = current_org()
    since = datetime.utcnow() - LOOKBACK
    apprs = (await db.execute(select(PublicObject).where(PublicObject.kind == "email_approval", PublicObject.created_at >= since))).scalars().all()
    if not apprs:
        return
    camps = {c.id: c for c in (await db.execute(select(EmailCampaign).where(
        EmailCampaign.id.in_([a.id.removeprefix("emailappr_") for a in apprs])))).scalars().all()}
    changed = False
    for appr in apprs:
        camp = camps.get(appr.id.removeprefix("emailappr_"))
        if camp is None:
            continue
        d: Dict[str, Any] = dict(appr.data or {})
        sent: List[str] = list(d.get("sent") or [])
        status = E.public_status(camp, appr)
        if status == "needs_approval" and "campaign.approved" in sent:
            sent = [x for x in sent if x not in ("campaign.ready", "campaign.approved")]  # edited after approval: a fresh round
        if status == "needs_approval" and "campaign.ready" not in sent:
            sent.append("campaign.ready")
            out = await E.view(db, camp, org)
            dispatch_event(org, "campaign.ready", {"campaign": out})
            await _email_approvers(db, camp, out, d.get("approvers") or await _org_approvers(db))
        if status in ("sending", "completed", "paused") and d.get("status") == "approved" and "campaign.approved" not in sent:
            sent.append("campaign.approved")
            dispatch_event(org, "campaign.approved", {"campaign": await E.view(db, camp, org)})
        if status in ("sending", "completed", "paused"):
            replies = (await db.execute(select(EmailMessage).where(EmailMessage.campaign_id == camp.id, EmailMessage.status == "replied"))).scalars().all()
            told = set(d.get("replies") or [])
            from app.services.connections import lead_for

            for m in replies:
                if m.id not in told:
                    told.add(m.id)
                    the_lead = await lead_for(db, email=m.reply_from or m.recipient_email)
                    dispatch_event(org, "campaign.reply", {"id": m.id, "lead_id": the_lead.id if the_lead else None, "campaign": {"id": camp.id, "name": camp.name}, "reply": {
                        "email": m.reply_from or m.recipient_email, "subject": m.subject, "category": m.reply_category,
                        "text": m.reply_snippet, "replied_at": m.replied_at.isoformat() + "Z" if m.replied_at else None}})
            if len(told) != len(d.get("replies") or []):
                d["replies"] = sorted(told)
                changed = True
        if status == "completed" and "campaign.completed" not in sent:
            sent.append("campaign.completed")
            dispatch_event(org, "campaign.completed", {"campaign": await E.view(db, camp, org)})
        if sent != list(d.get("sent") or []) or d.get("replies") != (appr.data or {}).get("replies"):
            appr.data = {**d, "sent": sent}
            changed = True
    if changed:
        await db.commit()


async def _org_approvers(db: AsyncSession) -> List[str]:
    from app.services.org_settings import load_org

    return list((await load_org(db)).get("approverEmails") or [])


async def _email_approvers(db: AsyncSession, camp: EmailCampaign, view: Dict[str, Any], emails: List[str]) -> None:
    """One email per approver with the preview link. Never raises."""
    try:
        from app.core.tenancy import current_org
        from app.services.approval_mail import _company_name, _excerpt, _send, company_mail

        company = await _company_name(db)
        link = links.preview_url("campaign", camp.id, current_org())
        first = view["steps"][0] if view["steps"] else {"subject": "", "body": ""}
        subject = f"{company}: an email campaign is waiting for your approval"
        body = company_mail(
            company, camp.name,
            [f'{view["leads"]} people, {len(view["steps"])} emails. Nothing is sent until you approve.',
             f'<b>{html.escape(first["subject"])}</b><br>{html.escape(_excerpt(first["body"], 400))}'],
            {"label": "Review, edit or approve", "url": link},
            note="This link works for 10 days and needs no sign-in.")["html"]
        text = f"{subject}\n\n{camp.name}: {view['leads']} people, {len(view['steps'])} emails.\nReview, edit or approve: {link}\n"
        for to in emails:
            await _send(db, to, subject, body, text)
    except Exception:
        logger.exception("[public-api] campaign approver email failed")
