"""The Social part of a company's rules (plan 12, B8): who may approve a post, which networks it may go to, and whether AI images and AI
video may be made. The rules are the brand's combined with the company's (services/tenant_policy.py, "social").

Where they are checked:
- a network the rules leave out: when a post is saved in the Social screens (api/scheduler.py), and again by the publisher for every
  channel (services/social_publisher.publish_post_to_accounts), which is the only place a post leaves;
- approval by admins only: when a post becomes approved or is published now in the Social screens, and on the approval e-mail's links
  (services/approval_mail.py). A partner's API key with the social:approve scope was granted by the company and is not a person, so it
  is not held to it;
- AI images and AI video: at the credit check every paid action passes (services/credits.py), and a batch of AI-written posts is
  written without pictures instead of being refused (services/generation_queue.py).

If the rules can't be read, nothing is posted and nothing AI is made (the answer says so); approvals wait.
"""
from __future__ import annotations

import logging
from typing import Iterable, List, Optional

logger = logging.getLogger("social_rules")

UNREADABLE = "Your company's rules couldn't be read just now, so this wasn't done. Try again in a minute."
AI_WORDS = {"ai_image": "AI images", "ai_video": "AI video"}


async def _policy(org_id: Optional[str] = None):
    from app.services import tenant_policy as TP

    return await TP.org_effective(None, org_id)


def _title(network: str) -> str:
    from app.services.social_publisher import TITLES

    return TITLES.get(network, network.title())


async def network_refusal(channels: Iterable[str], org_id: Optional[str] = None) -> str:
    """Why these networks can't be posted to under the company's rules; "" when they all can."""
    from app.services.social_publisher import normalize_platform

    wanted = [normalize_platform(c) for c in channels or [] if c]
    if not wanted:
        return ""
    try:
        pol = await _policy(org_id)
    except Exception as err:
        logger.warning(f"[social_rules] rules unread: {err}")
        return UNREADABLE
    off = [n for n in dict.fromkeys(wanted) if not pol.network_allowed(n)]
    if not off:
        return ""
    allowed = pol.social["networks"]
    also = f" It allows {', '.join(_title(n) for n in allowed)}." if allowed and not pol.social.get("networks_none") else ""
    return f"Your company's rules don't allow posting to {', '.join(_title(n) for n in off)}.{also}"


async def approval_refusal(is_admin: bool, org_id: Optional[str] = None) -> str:
    """Why this person can't approve (or publish straight away) under the company's rules; "" when they can."""
    if is_admin:
        return ""
    try:
        pol = await _policy(org_id)
    except Exception as err:
        logger.warning(f"[social_rules] rules unread: {err}")
        return UNREADABLE
    if pol.social["approver"] == "admin":
        return "Your company's rules say only an admin can approve posts. Send it for approval instead."
    return ""


async def email_approver_refusal(db, email: str, org_id: Optional[str]) -> str:
    """For an approval from the approval e-mail's page: under "only admins approve", the address must belong to an admin of the company.
    Approver addresses are set in Company Profile and need not be users at all."""
    try:
        pol = await _policy(org_id)
    except Exception as err:
        logger.warning(f"[social_rules] rules unread: {err}")
        return UNREADABLE
    if pol.social["approver"] != "admin":
        return ""
    from sqlalchemy import func, select

    from app.core.accounts import effective_access
    from app.models.models import Operator

    address = str(email or "").strip().lower()
    op = (await db.execute(select(Operator).where(func.lower(Operator.email) == address, Operator.org_id == org_id,
                                                  Operator.is_active.is_not(False)))).scalars().first() if address else None
    if op is not None and (await effective_access(db, op))[0]:
        return ""
    return "Nothing was approved: your company's rules say only an admin can approve posts. Ask an admin to approve them in Social."


async def ai_refusal(items: Iterable[str], org_id: Optional[str] = None) -> str:
    """Why AI images or AI video can't be made under the company's rules; "" when they can (or the items aren't AI pictures)."""
    asked = [i for i in dict.fromkeys(items or []) if i in AI_WORDS]
    if not asked:
        return ""
    try:
        pol = await _policy(org_id)
    except Exception as err:
        logger.warning(f"[social_rules] rules unread: {err}")
        return UNREADABLE
    off: List[str] = [AI_WORDS[i] for i in asked if not pol.social["ai_images" if i == "ai_image" else "ai_video"]]
    return f"Your company's rules don't allow {' or '.join(off)}." if off else ""


async def ai_images_allowed(org_id: Optional[str] = None) -> bool:
    return not await ai_refusal(["ai_image"], org_id)
