"""Unsubscribing from the emails our system sends (notifications, reports, alerts). Public: the signed link in each email is the sign-in.

GET  /mail/u/{token}   a page with a button (mail scanners open links, so only the button changes anything)
POST /mail/u/{token}   unsubscribes; also what mail apps' one-click Unsubscribe button posts (RFC 8058)
POST /mail/s/{token}   subscribes again

Emails a person asked for or needs to keep their account working (a password reset, a confirmation, a booking) are still sent.
"""
from __future__ import annotations

import html
import logging

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.core.mailer import read_unsubscribe_token
from app.database import AsyncSessionLocal
from app.models.models import SystemMailOptOut

logger = logging.getLogger("mail_prefs")
router = APIRouter(prefix="/mail", tags=["Email"])

_PAGE = ('<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title></head>'
         '<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 16px;line-height:1.6;color:#12141C">{}</body></html>')
_BUTTON = ('<form method="post" action="{action}"><button type="submit" style="background:#12141C;color:#fff;border:0;border-radius:10px;'
           'padding:11px 18px;font-size:16px;font-weight:700;cursor:pointer">{label}</button></form>')
_STILL = "You will still get emails you ask for or need to use your account, like a password reset or a booking confirmation."


def _page(body: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(_PAGE.format(body), status_code=status, headers={"Cache-Control": "no-store"})


def _invalid() -> HTMLResponse:
    return _page("<p>This link is not valid.</p>", 404)


@router.get("/u/{token}", response_class=HTMLResponse)
async def unsubscribe_page(token: str) -> HTMLResponse:
    addr = read_unsubscribe_token(token)
    if not addr:
        return _invalid()
    async with AsyncSessionLocal() as db:
        already = (await db.get(SystemMailOptOut, addr)) is not None
    if already:
        return _page(f"<h2 style=\"font-size:20px\">You are unsubscribed</h2><p><b>{html.escape(addr)}</b> no longer gets these emails. {_STILL}</p>"
                     + _BUTTON.format(action=f"/api/mail/s/{html.escape(token)}", label="Subscribe again"))
    return _page(f"<h2 style=\"font-size:20px\">Unsubscribe</h2><p>Stop sending notifications, reports and alerts to <b>{html.escape(addr)}</b>? {_STILL}</p>"
                 + _BUTTON.format(action=f"/api/mail/u/{html.escape(token)}", label="Unsubscribe"))


@router.post("/u/{token}", response_class=HTMLResponse)
async def unsubscribe(token: str) -> HTMLResponse:
    addr = read_unsubscribe_token(token)
    if not addr:
        return _invalid()
    async with AsyncSessionLocal() as db:
        if (await db.get(SystemMailOptOut, addr)) is None:
            db.add(SystemMailOptOut(email=addr))
            await db.commit()
    logger.info("[mail] %s unsubscribed from system emails", addr)
    return _page(f"<h2 style=\"font-size:20px\">You are unsubscribed</h2><p><b>{html.escape(addr)}</b> will not get these emails again. {_STILL}</p>"
                 + _BUTTON.format(action=f"/api/mail/s/{html.escape(token)}", label="Subscribe again"))


@router.post("/s/{token}", response_class=HTMLResponse)
async def subscribe_again(token: str) -> HTMLResponse:
    addr = read_unsubscribe_token(token)
    if not addr:
        return _invalid()
    async with AsyncSessionLocal() as db:
        row = await db.get(SystemMailOptOut, addr)
        if row is not None:
            await db.delete(row)
            await db.commit()
    return _page(f"<h2 style=\"font-size:20px\">You are subscribed again</h2><p><b>{html.escape(addr)}</b> will get these emails again.</p>")
