"""Public pages for the people whose business contact details are in the shared data: who we are, where it came from, and how to opt out.

GET  /legal/business-data           the privacy notice for that data (UK GDPR Articles 13 and 14)
GET  /legal/opt-out                 the form
POST /legal/opt-out                 sends a confirmation link to the email address given; the page's answer never says whether we hold it
GET  /legal/opt-out/confirm/{token} a page with a button (mail scanners open links; only the button changes anything)
POST /legal/opt-out/confirm/{token} records the opt-out and clears the person's details in the background

Plain HTML with no scripts, the same way the unsubscribe page is built.
"""
from __future__ import annotations

import html
import logging
from typing import Dict, List
from urllib.parse import parse_qs

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import select

from app.config import settings
from app.core.mailer import send_account_email as send_system_email
from app.core.tenancy import system_scope
from app.database import AsyncSessionLocal
from app.models.models import DataSource
from app.public_api.core import check_rate
from app.services import data_sources as DS
from app.services import optouts as OO

logger = logging.getLogger("legal")
router = APIRouter(prefix="/legal", tags=["Legal"])

_PAGE = ('<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
         "<title>{title}</title><style>body{{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;"
         "line-height:1.6;color:#12141C}}h1{{font-size:24px}}h2{{font-size:18px;margin-top:28px}}label{{display:block;margin:14px 0 4px;font-weight:600}}"
         "input[type=text],input[type=email]{{width:100%;box-sizing:border-box;padding:10px;font-size:16px;border:1px solid #98A1AE;border-radius:6px}}"
         "button{{margin-top:18px;padding:11px 20px;font-size:16px;font-weight:600;border:0;border-radius:8px;background:#12141C;color:#fff;cursor:pointer}}"
         ".hp{{position:absolute;left:-9999px}}.note{{color:#5B6472;font-size:14px}}</style></head><body>{body}</body></html>")


def _page(title: str, body: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(_PAGE.format(title=html.escape(title), body=body), status_code=status, headers={"Cache-Control": "no-store"})


def _base() -> str:
    return (settings.PUBLIC_BASE_URL or "").rstrip("/")


def _ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?")


async def _form(request: Request) -> Dict[str, str]:
    raw = (await request.body())[:4000].decode("utf-8", "ignore")
    return {k: v[0].strip() for k, v in parse_qs(raw).items() if v}


async def _sources() -> List[DataSource]:
    with system_scope():
        async with AsyncSessionLocal() as db:
            return list((await db.execute(select(DataSource).where(DataSource.status == "active").order_by(DataSource.name))).scalars().all())


def _e(value: str) -> str:
    return html.escape(value or "")


@router.get("/business-data", response_class=HTMLResponse)
async def notice() -> HTMLResponse:
    with system_scope():
        async with AsyncSessionLocal() as db:
            n = await OO.load_notice(db)
    sources = [s for s in await _sources() if (s.config or {}).get("licence") or (s.config or {}).get("attribution")]
    who = _e(n["controller"]) or "The operator of this service"
    where = f"<p>{_e(n['address'])}</p>" if n["address"] else ""
    contact = f'<a href="mailto:{_e(n["contact_email"])}">{_e(n["contact_email"])}</a>' if n["contact_email"] else "the opt-out form below"
    ico = f"<p>Registered with the Information Commissioner's Office, number {_e(n['ico_number'])}.</p>" if n["ico_number"] else ""
    keep = _e(n["retention"]) or "We refresh company records when a source updates them and remove a record when its source no longer lists it."
    rows = "".join(
        f"<li><b>{_e(s.name)}</b>" + (f": {_e((s.config or {}).get('attribution') or '')}" if (s.config or {}).get("attribution") else "")
        + (f" <span class='note'>({_e((s.config or {}).get('licence'))})</span>" if (s.config or {}).get("licence") else "") + "</li>"
        for s in sources)
    body = f"""<h1>How we use business contact details</h1>
<p>{who} keeps a database of UK businesses and the people who run them, to help other businesses find and contact suitable customers.</p>{where}{ico}
<h2>What we hold</h2>
<p>For a company: its name, address, registration number, industry, size, website, phone number and email address. For some companies, the names and roles of its officers and owners as published in public registers, and a business phone number or email address that the company or a public register has published.</p>
<h2>Where it comes from</h2>
<p>You did not give us this directly. It comes from public registers and open data, and from a company's own public website:</p>
<ul>{rows or "<li>Public registers and company websites.</li>"}</ul>
<h2>Why we hold it, and our legal basis</h2>
<p>To let businesses that use our service find other businesses and contact them about relevant products and services. Our legal basis is legitimate interests (UK GDPR Article 6(1)(f)). We contact corporate addresses (such as info@company.co.uk) for business purposes, and we do not email individual subscribers such as sole traders and partnerships without their consent, as the Privacy and Electronic Communications Regulations require.</p>
<h2>Who sees it</h2>
<p>Customers of our service, who use it to find businesses, and the suppliers that host our systems. We do not sell the database as a file.</p>
<h2>How long we keep it</h2>
<p>{keep}</p>
<h2>Your rights</h2>
<p>You can ask for a copy of your details, ask us to correct them, or ask us to remove them and stop contacting you. You can object to us holding them at any time and we will act on it. Write to {contact}, or use the form: <a href="{_base()}/api/legal/opt-out">opt out</a>. If you are not happy with how we handle your details, you can complain to the Information Commissioner's Office at ico.org.uk.</p>"""
    return _page("How we use business contact details", body)


_FORM = """<h1>Opt out</h1>
<p>Tell us the email address (and phone number, if you like) you want removed. We will send a link to that address to confirm it is yours. Then we remove those details from our data, and neither will be used to contact you again.</p>
<form method="post" action="{base}/api/legal/opt-out">
<label for="email">Your email address</label><input id="email" name="email" type="email" required autocomplete="email">
<label for="phone">Phone number (optional)</label><input id="phone" name="phone" type="text" autocomplete="tel">
<div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
<button type="submit">Send me the confirmation link</button></form>
<p class="note"><a href="{base}/api/legal/business-data">How we use business contact details</a></p>"""


@router.get("/opt-out", response_class=HTMLResponse)
async def opt_out_form() -> HTMLResponse:
    return _page("Opt out", _FORM.format(base=_base()))


_SENT = ("<h1>Check your email</h1><p>If that address is valid, a confirmation link is on its way. It works for two days. "
         "Opening it and pressing the button removes your details.</p>")


@router.post("/opt-out", response_class=HTMLResponse)
async def opt_out_request(request: Request) -> HTMLResponse:
    form = await _form(request)
    if form.get("website"):  # a trap field people leave empty
        return _page("Check your email", _SENT)
    if check_rate(f"optout:{_ip(request)}", True):
        return _page("Too many requests", "<h1>Too many requests</h1><p>Please try again in a few minutes.</p>", 429)
    email, phone = OO.clean_email(form.get("email")), form.get("phone", "")[:40]
    if not email:
        return _page("Opt out", "<p>Enter a valid email address.</p>" + _FORM.format(base=_base()), 422)
    if not check_rate(f"optoutmail:{email}", True):
        link = f"{_base()}/api/legal/opt-out/confirm/{OO.make_token(email, phone)}"
        await send_system_email(
            email, "Confirm your opt-out",
            f'<p>Someone asked for this email address to be removed from our business data.</p><p><a href="{html.escape(link)}">Confirm the opt-out</a></p>'
            "<p>If it was not you, ignore this email. Nothing happens until the link is confirmed.</p>",
            f"Someone asked for this email address to be removed from our business data.\nConfirm it here: {link}\nIf it was not you, ignore this email.")
    return _page("Check your email", _SENT)


_CONFIRM = ('<h1>Confirm your opt-out</h1><p>Remove <b>{email}</b>{phone} from our business data, and stop all contact?</p>'
            '<form method="post"><button type="submit">Yes, remove my details</button></form>')


@router.get("/opt-out/confirm/{token}", response_class=HTMLResponse)
async def opt_out_confirm_page(token: str) -> HTMLResponse:
    got = OO.read_token(token)
    if not got:
        return _page("Link not valid", "<h1>This link is not valid or has expired</h1><p>Start again from the <a href=\"" + _base() + "/api/legal/opt-out\">opt-out form</a>.</p>", 404)
    email, phone = got
    return _page("Confirm your opt-out", _CONFIRM.format(email=_e(email), phone=f" and {_e(phone)}" if OO.phone_key(phone) else ""))


@router.post("/opt-out/confirm/{token}", response_class=HTMLResponse)
async def opt_out_confirm(token: str) -> HTMLResponse:
    got = OO.read_token(token)
    if not got:
        return _page("Link not valid", "<h1>This link is not valid or has expired</h1>", 404)
    email, phone = got
    with system_scope():
        async with AsyncSessionLocal() as db:
            await OO.record(db, email, phone)
            await db.commit()

    async def clean() -> None:
        try:
            with system_scope():
                async with AsyncSessionLocal() as db:
                    await OO.scrub(db, email, phone)
        except Exception as err:
            logger.error(f"[legal] could not clear an opted-out person's details: {err}")

    DS.spawn(clean())
    return _page("Done", "<h1>Done</h1><p>Your details are being removed, and we will not contact you again. You do not need to do anything else.</p>")
