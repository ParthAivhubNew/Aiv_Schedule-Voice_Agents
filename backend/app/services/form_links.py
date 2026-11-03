"""A link to one of the customer's inbound forms, written into an email for one person.

The email text holds the tag {{form_link:FORM_ID}}. When the email is sent it becomes
<site>/api/f/<form key>/page?t=<token>, where the token names the organisation, the form, the lead, the journey
enrolment and the email address, is signed, and stops working after 30 days. The form page reads it to pre-fill
the person's details and say who sent it; the answer then goes to that lead, ends their journey (when the journey
has that rule on), and, for questions the customer marked, adds what the business confirmed to its company record.

A link without the token still works as before: it is the public form.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from app.config import settings

logger = logging.getLogger("form_links")

TTL_S = 30 * 24 * 3600
TAG = re.compile(r"\{\{\s*form_link\s*:\s*([A-Za-z0-9_\-]{1,64})\s*\}\}", re.I)
BARE = re.compile(r"\{\{\s*form_?link\s*\}\}", re.I)  # a form link with no form chosen: it can never become a working link


def _key() -> bytes:
    return hashlib.sha256(("form-link:" + (settings.SECRET_KEY or "")).encode("utf-8")).digest()


def make_token(org_id: str, form_id: str, lead_id: str, enrollment_id: str, email: str, now: Optional[float] = None) -> str:
    exp = int((now if now is not None else time.time()) + TTL_S)
    body = base64.urlsafe_b64encode(json.dumps([org_id, form_id, lead_id or "", enrollment_id or "", (email or "").lower(), exp],
                                               separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{body}.{hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()[:32]}"


def read_token(token: str, now: Optional[float] = None) -> Optional[Dict[str, str]]:
    """The token's contents, or None when it was altered, is malformed or has expired."""
    try:
        body, mac = str(token or "").rsplit(".", 1)
        if not hmac.compare_digest(mac, hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()[:32]):
            return None
        org_id, form_id, lead_id, enr_id, email, exp = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if int(exp) < int(now if now is not None else time.time()):
            return None
        return {"org_id": str(org_id), "form_id": str(form_id), "lead_id": str(lead_id), "enrollment_id": str(enr_id), "email": str(email)}
    except Exception:
        return None


def tags_in(text: str) -> List[str]:
    return list(dict.fromkeys(m.group(1) for m in TAG.finditer(text or "")))


def has_bare_tag(text: str) -> bool:
    return bool(BARE.search(text or ""))


def link_for(public_key: str, token: str) -> str:
    return f"{settings.PUBLIC_BASE_URL.rstrip('/')}/api/f/{public_key}/page?t={token}"


async def resolve(db, org_id: str, enr: Any, text: str) -> str:
    """The text with each form tag replaced by this person's own link. A form that is not published (or not this
    organisation's) leaves nothing, so no broken link is ever sent."""
    ids = tags_in(text)
    if not ids and not has_bare_tag(text):
        return text
    from app.models.models import InboundForm

    keys: Dict[str, str] = {}
    if ids:
        rows = (await db.execute(select(InboundForm).where(InboundForm.id.in_(ids)))).scalars().all()
        keys = {f.id: f.public_key for f in rows if f.status == "published" and f.published_fields}
    for fid in ids:
        if fid not in keys:
            logger.warning("form link %s is not a published form of %s: left out of the email", fid, org_id)
    urls = {fid: link_for(key, make_token(org_id, fid, getattr(enr, "lead_id", "") or "", getattr(enr, "id", "") or "", getattr(enr, "email", "") or ""))
            for fid, key in keys.items()}
    out = TAG.sub(lambda m: urls.get(m.group(1), ""), text)
    return BARE.sub("", out)


# What a form answer may add to the shared company record, and nothing else.
SHAREABLE = ("phone", "website")


def shared_values(fields: List[Dict[str, Any]], answers: Dict[str, str]) -> Dict[str, str]:
    """The answers the customer marked "add to the company's details", for the two fields a company record holds."""
    out: Dict[str, str] = {}
    for f in fields or []:
        if f.get("share_to_company") and f.get("maps_to") in SHAREABLE:
            val = str(answers.get(f["id"]) or "").strip()
            if val:
                out.setdefault(f["maps_to"], val)
    return out


async def attach(db, sub: Any, form: Any, tok: Dict[str, str]) -> Optional[str]:
    """Save a form answer that came through a personal link: onto the lead the email was sent to (filling only what is empty),
    ending their journeys that have the rule on, and adding the shared answers to the company record. The caller commits."""
    from datetime import datetime

    from app.models.models import BusinessRecord, EmailCampaign, EmailEnrollment, LeadAccount
    from app.services import inbound_forms as IF
    from app.services import journeys as J
    from app.services import optouts as OO

    lead = await db.get(LeadAccount, tok["lead_id"]) if tok.get("lead_id") else None
    if lead is None:
        return await IF.approve(db, sub, form, how="email link")  # no lead behind the email: same as a normal answer
    fields = form.published_fields or form.fields or []
    cols = IF.lead_fields(fields, sub.payload or {})
    for col in ("contact_name", "phone", "website", "contact_title", "industry", "region"):
        if cols.get(col) and not (getattr(lead, col, "") or "").strip():
            setattr(lead, col, cols[col])
    if cols.get("notes"):
        lead.notes = f"{lead.notes}\n{cols['notes']}".strip()[:2000] if lead.notes else cols["notes"]
    if cols.get("custom"):
        lead.custom = {**(lead.custom or {}), **cols["custom"]}
    sub.status, sub.reason, sub.lead_id = "approved", "email link", lead.id

    for enr in (await db.execute(select(EmailEnrollment).where(EmailEnrollment.status == "active", EmailEnrollment.lead_id == lead.id))).scalars().all():
        camp = await db.get(EmailCampaign, enr.campaign_id)
        if camp is not None and J.rules_of(camp).get("on_form", True):
            await J.exit_enrollment(db, enr, "form_returned", status="form_returned")

    shared = shared_values(fields, sub.payload or {})
    biz = await db.get(BusinessRecord, lead.business_record_id) if getattr(lead, "business_record_id", None) and shared else None
    if biz is not None:
        if shared.get("phone") and await OO.phone_blocked(db, shared["phone"]):
            shared.pop("phone")  # a person who opted out is never put back
        if shared:
            raw = dict(biz.raw_data or {})
            raw["business_confirmed"] = {**(raw.get("business_confirmed") or {}), **shared, "confirmed_at": datetime.utcnow().isoformat() + "Z"}
            biz.raw_data = raw
    return lead.id
