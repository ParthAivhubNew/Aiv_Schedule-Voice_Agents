"""Once a minute, per company: tell the customer's webhooks what happened to their API posts, and
remind approvers about posts that will miss their slot. Runs inside the existing publish round."""
from __future__ import annotations

import html
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import PublicObject, SocialPost
from app.public_api import links, social as S
from app.services import approval_mail

logger = logging.getLogger("public_api.social_events")

REMIND_BEFORE_MS = 60 * 60 * 1000  # remind an hour before the slot
LOOKBACK = timedelta(days=30)
# public status -> the event it announces (once)
EVENT_OF = {"needs_approval": "post.ready", "approved": "post.approved", "rejected": "post.rejected", "canceled": "post.rejected",
            "published": "post.published", "failed": "post.failed", "approval_closed": "post.failed"}


async def tick(db: AsyncSession, now_ms: float, due_of) -> None:
    """Never raises: a problem here must not hold up publishing."""
    try:
        await _events_and_reminders(db, now_ms, due_of)
    except Exception:
        logger.exception("[public-api] social events round failed")
        await db.rollback()


async def _events_and_reminders(db: AsyncSession, now_ms: float, due_of) -> None:
    from app.core.tenancy import current_org
    from app.services.webhook_dispatcher import dispatch_event

    org = current_org()
    since = datetime.utcnow() - LOOKBACK
    posts: List[SocialPost] = (await db.execute(
        select(SocialPost).where(SocialPost.source == "api", SocialPost.created_at >= since))).scalars().all()
    if not posts:
        return
    metas = {m.id: m for m in (await db.execute(
        select(PublicObject).where(PublicObject.id.in_([f"pev_{p.id}" for p in posts])))).scalars().all()}
    changed = False
    for p in posts:
        meta = metas.get(f"pev_{p.id}")
        if meta is None:
            meta = PublicObject(id=f"pev_{p.id}", kind="post_meta", data={"sent": []})
            db.add(meta)
            metas[meta.id] = meta
        data: Dict[str, Any] = dict(meta.data or {})
        sent = list(data.get("sent") or [])
        status = S.status_of(p)
        event = EVENT_OF.get(status)
        if status == "needs_approval" and ("post.approved" in sent or "post.rejected" in sent):
            sent = [x for x in sent if x not in ("post.ready", "post.approved", "post.rejected", "reminded")]  # edited: a fresh round
        if event and event not in sent:
            sent.append(event)
            dispatch_event(org, event, {"post": S.view(p, org, status)})
            if event == "post.ready" and data.get("approvers"):
                await _email_approvers(db, p, org, data["approvers"], reminder=False)
            changed = True
        if (status == "needs_approval" and not p.asap and "reminded" not in sent
                and 0 < (due_of(p) or 0) - now_ms <= REMIND_BEFORE_MS):
            sent.append("reminded")
            await _email_approvers(db, p, org, data.get("approvers") or (await _org_approvers(db)), reminder=True)
            changed = True
        if sent != list(data.get("sent") or []):
            meta.data = {**data, "sent": sent}
    if changed:
        await db.commit()


async def _org_approvers(db: AsyncSession) -> List[str]:
    from app.services.org_settings import load_org

    return list((await load_org(db)).get("approverEmails") or [])


async def _email_approvers(db: AsyncSession, p: SocialPost, org: str, emails: List[str], reminder: bool) -> None:
    """One email per approver with the preview link. Never raises."""
    try:
        from app.services.approval_mail import _brand_name, _company_name, _send
        from app.services.org_settings import load_org

        company = await _company_name(db)
        cfg = await load_org(db)
        when = approval_mail._when(p.due_at_ms or 0, cfg["timezone"], cfg["timeFormat"])
        link = links.preview_url("post", p.id, org)
        if reminder:
            subject = f"{company}: a post goes out at {when} unless it is approved"
            lead = f"This post is due at {html.escape(when)} and has not been approved yet. Posts not approved by their time are skipped."
        else:
            subject = f"{company}: a post is waiting for your approval"
            lead = "Nothing goes live until it is approved."
        excerpt = html.escape(approval_mail._excerpt(p.copy, 400))
        body = (f'<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#12141C;max-width:620px">'
                f'<h2 style="font-size:18px;margin:0 0 6px">{html.escape(p.title or "Post")}</h2>'
                f'<p style="font-size:14px;color:#5B6170;margin:0 0 14px">{lead}</p>'
                f'<p style="font-size:13px;color:#333">{excerpt}</p>'
                f'<p><a href="{html.escape(link)}" style="display:inline-block;background:#12141C;color:#fff;text-decoration:none;'
                f'font-weight:700;padding:11px 18px;border-radius:10px">Review, edit or approve</a></p>'
                f'<p style="font-size:12px;color:#8A8F9C">This link works for 10 days and needs no sign-in. Sent for {html.escape(_brand_name(company))}.</p></div>')
        text = f"{subject}\n\n{lead}\n\n{approval_mail._excerpt(p.copy, 400)}\n\nReview, edit or approve: {link}\n"
        for to in emails:
            await _send(db, to, subject, body, text)
        if not reminder:
            p.approval_requested_at = datetime.utcnow().replace(microsecond=0)  # the batch email must not ask them again
    except Exception:
        logger.exception("[public-api] approver email failed")
