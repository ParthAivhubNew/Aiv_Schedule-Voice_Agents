"""Putting a company's own Telnyx number on WhatsApp with no work by the OutReach team.

Aivhub is a WhatsApp Tech Provider on Telnyx (our Meta app: WHATSAPP_META_APP_ID, or — since one
Meta app can hold Facebook/Instagram login and WhatsApp Tech Provider access side by side — the
same app already used for Facebook/Instagram OAuth, FACEBOOK_OAUTH_CLIENT_ID/FACEBOOK_APP_ID, once
that app also has the whatsapp_business_messaging/whatsapp_business_management permissions and
Tech Provider onboarding done on Meta's side). When an admin presses "Turn on WhatsApp", we ask
Telnyx for a hosted signup page and open it for them: they log in with Facebook, name their
business and pick the number; Telnyx does the rest with Meta. We then check Telnyx every few
minutes and switch WhatsApp on as soon as the number is registered, add our standard message
templates, and tell the company's admins.

Telnyx documents the Tech Provider calls only in its guide, so replies are read loosely here.
Without an app id configured, the old way stays: the OutReach team switches WhatsApp on by hand.

Reusing the Facebook/Instagram login app's id is not by itself proof that Telnyx has accepted
that app as a Tech Provider partner yet (that's a one-time step done by hand on Meta's and
Telnyx's side). Rather than a config flag staff would have to remember to flip, automatic() asks
Telnyx itself (GET /whatsapp/foreign_apps, cached briefly) whether our app id is on its accepted
list, and only then starts making live Telnyx calls; until Telnyx says yes, it falls back to the
safe staff-assisted path by itself, no file to edit.
"""
from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from sqlalchemy.future import select

from app.services.telnyx_client import TelnyxClient, TelnyxError, platform_key

logger = logging.getLogger("whatsapp_signup")

LINK_LIFE = timedelta(days=3)  # Telnyx's hosted signup links last up to 3 days
LIVE = {"verified", "connected", "registered", "active", "approved"}
BROKEN = {"failed", "rejected", "banned", "disconnected", "flagged", "restricted", "deleted"}

# Sent for every company once its number is live, so meeting confirmations work outside
# WhatsApp's 24-hour window. Meta needs example values for each placeholder.
TEMPLATES = [
    {"name": "outreach_meeting_confirmation", "category": "UTILITY", "language": "en_GB", "components": [{
        "type": "BODY",
        "text": "Hi {{1}}, this is {{2}}. Your {{3}} is booked for {{4}}. Reply here if you need to change it.",
        "example": {"body_text": [["Pat", "Acme Ltd", "video meeting", "Tue 14 Oct at 10:00"]]},
    }]},
    {"name": "outreach_follow_up", "category": "MARKETING", "language": "en_GB", "components": [{
        "type": "BODY",
        "text": "Hi {{1}}, it's {{2}}. Thanks for speaking with us today. Reply here any time with questions.",
        "example": {"body_text": [["Pat", "Acme Ltd"]]},
    }]},
]
CONFIRMATION = "outreach_meeting_confirmation"


def app_id() -> str:
    from app.config import settings

    return (os.getenv("WHATSAPP_META_APP_ID") or settings.FACEBOOK_OAUTH_CLIENT_ID or "").strip()


def _client() -> TelnyxClient:
    return TelnyxClient(platform_key())


_READY_TTL = 600  # seconds; avoid asking Telnyx on every status check/page load
_ready_cache: Dict[str, Any] = {}


async def automatic() -> bool:
    """True once we can actually start a live WhatsApp signup with Telnyx. A dedicated
    WHATSAPP_META_APP_ID is trusted immediately (it was set for exactly this). The reused
    Facebook-login app id is only trusted once Telnyx itself lists it as an accepted WhatsApp
    Tech Provider partner -- checked live against Telnyx, cached briefly, no flag to set by hand:
    Telnyx's own records are the one source of truth for whether that onboarding is done."""
    import time

    app, key = app_id(), platform_key()
    if not (app and key):
        return False
    if os.getenv("WHATSAPP_META_APP_ID", "").strip():
        return True
    now = time.time()
    cached = _ready_cache.get(app)
    if cached and now - cached[1] < _READY_TTL:
        return cached[0]
    ok = False
    try:
        apps = await _client().foreign_apps()
        ok = any(str(a.get("id") or a.get("app_id") or a.get("facebook_app_id") or "") == app for a in apps)
    except TelnyxError as err:
        logger.debug(f"[whatsapp] foreign_apps check failed: {err}")
    except Exception as err:
        logger.debug(f"[whatsapp] foreign_apps check failed: {err}")
    _ready_cache[app] = (ok, now)
    return ok


def _url(data: Dict[str, Any]) -> str:
    for key in ("url", "signup_url", "hosted_url", "link", "hosted_signup_url"):
        if str(data.get(key) or "").startswith("http"):
            return str(data[key])
    for v in data.values():
        if isinstance(v, str) and v.startswith("http"):
            return v
    return ""


def signup_json(s) -> Optional[Dict[str, Any]]:
    if not s:
        return None
    return {"status": s.status, "url": s.signup_url if s.status == "link_sent" and not expired(s) else "",
            "expired": expired(s), "telnyxStatus": s.telnyx_status, "error": s.error,
            "code": s.code if s.code_at and datetime.utcnow() - s.code_at < timedelta(minutes=15) else "",
            "templates": s.templates or {}}


def expired(s) -> bool:
    return bool(s.status == "link_sent" and s.expires_at and s.expires_at < datetime.utcnow())


async def signup_for(db, number_id: str):
    from app.models.models import WhatsappSignup

    return (await db.execute(select(WhatsappSignup).where(WhatsappSignup.number_id == number_id))).scalars().first()


async def start(db, number) -> Any:
    """A signup page link for this number (reused while still valid). Caller commits."""
    from app.models.models import WhatsappSignup

    s = await signup_for(db, number.id)
    if s and s.status == "link_sent" and s.signup_url and not expired(s):
        return s
    data = await _client().create_hosted_signup(app_id())
    link = _url(data)
    if not link:
        raise TelnyxError("Telnyx did not return a signup link.")
    if not s:
        s = WhatsappSignup(id=f"ws_{uuid.uuid4().hex[:12]}", number_id=number.id, e164=number.e164)
        db.add(s)
    s.signup_url, s.expires_at, s.status, s.error = link, datetime.utcnow() + LINK_LIFE, "link_sent", ""
    return s


def _state(reg: Dict[str, Any]) -> str:
    return str(reg.get("status") or reg.get("state") or "").lower()


async def check(db, s, number) -> bool:
    """Ask Telnyx whether the number is on WhatsApp now; switch it on when it is. Caller commits.
    True when it went live on this check."""
    s.checked_at = datetime.utcnow()
    try:
        reg = await _client().get_whatsapp_number(s.e164)
    except TelnyxError as err:
        logger.warning(f"[whatsapp] could not check {s.e164}: {err}")
        return False
    if not reg:
        return False
    state = _state(reg)
    s.telnyx_status = state[:60]
    s.waba_id = str(reg.get("waba_id") or reg.get("whatsapp_business_account_id") or s.waba_id or "")
    if state in BROKEN:
        s.status, s.error = "failed", str(reg.get("error") or reg.get("reason") or f"WhatsApp shows this number as {state}.")[:300]
        caps = [c for c in (number.capabilities or []) if c not in ("whatsapp", "whatsapp_requested", "whatsapp_ready")]
        number.capabilities = caps
        return False
    if not (state in LIVE or reg.get("enabled") is True):
        return False
    went_live = s.status != "live"
    s.status, s.error = "live", ""
    caps = [c for c in (number.capabilities or []) if c not in ("whatsapp", "whatsapp_requested", "whatsapp_ready")]
    number.capabilities = caps + ["whatsapp", "whatsapp_ready"]
    return went_live


async def add_templates(s) -> None:
    """Submit our standard templates once, then keep their Meta status up to date."""
    if not s.waba_id:
        return
    have = dict(s.templates or {})
    client = _client()
    for t in TEMPLATES:
        if t["name"] in have:
            continue
        try:
            res = await client.create_whatsapp_template(s.waba_id, t)
            have[t["name"]] = str(res.get("status") or "PENDING").upper()
        except TelnyxError as err:
            if "exist" in str(err).lower():
                have[t["name"]] = "PENDING"
            else:
                logger.warning(f"[whatsapp] template {t['name']} for {s.e164}: {err}")
    if any(v in ("PENDING", "") for v in have.values()):
        try:
            for row in await client.list_whatsapp_templates(s.waba_id):
                if row.get("name") in have:
                    have[row["name"]] = str(row.get("status") or "").upper()
        except TelnyxError as err:
            logger.warning(f"[whatsapp] template status for {s.e164}: {err}")
    s.templates = have


async def tell_live(e164: str) -> None:
    try:
        from app.core.notify import notify

        await notify("numbers", "WhatsApp is live on your number",
                     [f"WhatsApp is on for {e164}. Messages show in Voice → Conversations → WhatsApp."])
    except Exception:
        pass


async def check_org(db) -> int:
    """Check every number of this organisation that is waiting for WhatsApp. Commits."""
    from app.models.models import OrgPhoneNumber, WhatsappSignup

    went = 0
    rows = (await db.execute(select(WhatsappSignup).where(WhatsappSignup.status.in_(["link_sent", "live"])))).scalars().all()
    for s in rows:
        number = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.id == s.number_id))).scalars().first()
        if not number or number.status != "active":
            continue
        if s.status == "link_sent":
            if await check(db, s, number):
                went += 1
                await db.commit()
                await tell_live(s.e164)
        if s.status == "live" and any(v not in ("APPROVED", "REJECTED", "DISABLED") for v in (s.templates or {"": ""}).values()):
            await add_templates(s)
        await db.commit()
    return went


async def check_all() -> None:
    """Every few minutes, for every organisation (see main)."""
    if not await automatic():
        return
    from app.core.orgs import active_org_ids
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal

    for org_id in await active_org_ids():
        with org_scope(org_id):
            async with AsyncSessionLocal() as db:
                try:
                    await check_org(db)
                except Exception as err:
                    logger.warning(f"[whatsapp] signup check for {org_id} failed: {err}")


# WhatsApp's verification code. With the number on Telnyx nobody would see the text, so we catch
# it on our messaging webhook and show it next to the number while the signup is open.
_CODE = re.compile(r"\b(\d{3}[- ]\d{3}|\d{6})\b")


async def catch_code(db, our: str, text: str) -> bool:
    from app.models.models import WhatsappSignup

    if "whatsapp" not in (text or "").lower():
        return False
    m = _CODE.search(text or "")
    if not m:
        return False
    s = (await db.execute(select(WhatsappSignup).where(WhatsappSignup.e164 == our, WhatsappSignup.status == "link_sent"))).scalars().first()
    if not s:
        return False
    s.code, s.code_at = m.group(1), datetime.utcnow()
    return True
