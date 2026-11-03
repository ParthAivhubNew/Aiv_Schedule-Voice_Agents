"""Designed emails: the brand, which campaigns use it, a preview that is the real message, and a test send to the person's own mailbox.

Every route runs inside the signed-in user's company (row-level security). The preview and the test send build the message with the
same `build()` the campaign runner uses, so what is shown is what goes out.
"""
from __future__ import annotations

import logging
import time
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import EmailCampaign, EmailMailbox
from app.services import email_design as D
from app.services import mail_transport as T

logger = logging.getLogger("email_design")
router = APIRouter(prefix="/email/design", tags=["Email design"])

MAX_BODY = 20_000
TEST_SENDS_PER_HOUR = 10
_test_sends: Dict[str, List[float]] = {}  # org id -> when its recent test sends went out


class BrandIn(BaseModel):
    brand: Dict[str, Any] = {}


class CampaignSwitch(BaseModel):
    on: bool = False


class Sample(BaseModel):
    first_name: str = "Alex"
    last_name: str = ""
    company: str = "Example Ltd"
    email: str = "alex@example.com"


class PreviewIn(BaseModel):
    subject: str = ""
    body: str = ""
    sample: Sample = Sample()
    brand: Optional[Dict[str, Any]] = None  # the brand as it is on screen now, saved or not
    mailbox_id: str = ""  # whose signature to show


class TestIn(BaseModel):
    mailbox_id: str
    subject: str = ""
    body: str = ""
    brand: Optional[Dict[str, Any]] = None


def _state(doc: Dict[str, Any]) -> Dict[str, Any]:
    brand = doc["brand"]
    return {"brand": brand, "campaigns": doc["campaigns"], "problems": D.brand_problems(brand), "warnings": D.brand_warnings(brand),
            "fonts": list(D.FONTS.keys())}


@router.get("")
async def get_design(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = current(request)
    return _state(await D.load(db, ctx["org_id"]))


@router.put("/brand")
async def put_brand(body: BrandIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = current(request)
    doc = await D.save(db, ctx["org_id"], brand=body.brand)
    await db.commit()
    return _state(doc)


@router.put("/campaigns/{campaign_id}")
async def put_campaign(campaign_id: str, body: CampaignSwitch, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Turn the designed layout on or off for one campaign. Needs a brand with an address: every designed email carries it.
    Turning it off always works, even for a campaign that has since been deleted, so a stale switch can be cleared."""
    ctx = current(request)
    doc = await D.load(db, ctx["org_id"])
    if body.on:
        camp = (await db.execute(select(EmailCampaign).where(EmailCampaign.id == campaign_id))).scalars().first()
        if not camp:
            raise HTTPException(status_code=404, detail="Campaign not found.")
        problems = D.brand_problems(doc["brand"])
        if problems:
            raise HTTPException(status_code=400, detail=problems[0])
    campaigns = dict(doc["campaigns"])
    campaigns[campaign_id] = bool(body.on)
    doc = await D.save(db, ctx["org_id"], campaigns=campaigns)
    await db.commit()
    return _state(doc)


def _filled(text: str, sample: Sample) -> str:
    """The merge words filled the way the campaign runner fills them, so the preview matches the send."""
    from app.services.email_worker import render

    enr = SimpleNamespace(first_name=sample.first_name, last_name=sample.last_name, company=sample.company, email=sample.email, vars={})
    return render(text, enr, "")


async def _signature(db: AsyncSession, mailbox_id: str) -> str:
    if not mailbox_id:
        return ""
    mb = (await db.execute(select(EmailMailbox).where(EmailMailbox.id == mailbox_id))).scalars().first()
    return (mb.signature or "") if mb else ""


@router.post("/preview")
async def preview(body: PreviewIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """The email as it will arrive, for one sample recipient. Nothing is sent, charged or saved."""
    ctx = current(request)
    if len(body.body) > MAX_BODY:
        raise HTTPException(status_code=400, detail="That email is too long to preview.")
    doc = await D.load(db, ctx["org_id"])
    brand = D.clean_brand(body.brand) if body.brand is not None else doc["brand"]
    text = _filled(body.body, body.sample)
    subject = _filled(body.subject, body.sample).strip()
    sig = await _signature(db, body.mailbox_id)
    page = D.render(text, brand, subject=subject, signature=sig, unsubscribe_link="#", why_link="#")
    plain = D.plain_of(text + (f"\n\n{sig.strip()}" if sig.strip() else ""))
    return {"subject": subject, "html": page, "text": plain, "warnings": D.lint(page, brand), "problems": D.brand_problems(brand)}


@router.post("/test-send")
async def test_send(body: TestIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Send the designed email to the mailbox's own address, so it can be seen in a real mail app.
    Only ever the mailbox's own address, never one typed in. It costs nothing, does not count toward the mailbox's sending limits,
    carries no real unsubscribe link and writes no open or click events."""
    from app.services.email_dispatcher import build, mailbox_settings

    ctx = current(request)
    org_id = ctx["org_id"]
    if len(body.body) > MAX_BODY:
        raise HTTPException(status_code=400, detail="That email is too long.")
    mb = (await db.execute(select(EmailMailbox).where(EmailMailbox.id == body.mailbox_id))).scalars().first()
    if not mb:
        raise HTTPException(status_code=404, detail="Mailbox not found.")
    now = time.time()
    recent = [t for t in _test_sends.get(org_id, []) if now - t < 3600]
    if len(recent) >= TEST_SENDS_PER_HOUR:
        raise HTTPException(status_code=429, detail="You have sent several test emails in the last hour. Try again later.")
    doc = await D.load(db, org_id)
    brand = D.clean_brand(body.brand) if body.brand is not None else doc["brand"]
    problems = D.brand_problems(brand)
    if problems:
        raise HTTPException(status_code=400, detail=problems[0])
    sample = Sample()
    subject = "[Test] " + (_filled(body.subject, sample).strip() or "Your designed email")
    msg = build(mb, mb.email, subject, _filled(body.body, sample), org_id=org_id, brand=brand, unsubscribe_override="#")
    try:
        await T.send(mailbox_settings(mb), msg)
    except T.MailError as err:
        raise HTTPException(status_code=502, detail=f"The test email could not be sent: {str(err)[:200]}")
    _test_sends[org_id] = recent + [now]
    return {"sent_to": mb.email}
