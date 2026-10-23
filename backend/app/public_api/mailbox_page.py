"""The page a partner's popup opens to connect a mailbox.

The user types their mailbox login here, on our own page, so the partner never sees the password. The link is signed,
names the organisation, works for 30 minutes, and ends at the partner's registered return address.
"""
from __future__ import annotations

import html
import json
import logging
import urllib.parse
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.approval_mail import _page

logger = logging.getLogger("public_api.mailbox_page")
e = html.escape

PRESET_LABELS = (("", "Other (enter the server details)"), ("gmail", "Gmail or Google Workspace"), ("outlook", "Outlook or Microsoft 365"),
                 ("zoho", "Zoho Mail"), ("one.com", "one.com"))
_STYLE = """<style>
label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}
input,select{width:100%;box-sizing:border-box;height:40px;border:1px solid #E6E3DC;border-radius:10px;padding:0 12px;font:inherit;background:#fff}
.hint{font-size:12px;color:#5B6170;margin-top:4px}
.err{background:#FDECEA;border:1px solid #F3C4BE;color:#8A1F11;border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:12px}
button.go{margin-top:18px;background:#12141C;color:#fff;border-color:#12141C;width:100%}
details{margin-top:12px}summary{cursor:pointer;font-size:13px;font-weight:600}
</style>"""


def render(company: str, notice: str = "", values: Optional[Dict[str, str]] = None, locked_email: str = "") -> str:
    v = values or {}
    opts = "".join(f'<option value="{e(k)}"{" selected" if v.get("preset", "") == k else ""}>{e(label)}</option>' for k, label in PRESET_LABELS)
    email = locked_email or v.get("email", "")
    err = f'<div class="err" role="alert">{e(notice)}</div>' if notice else ""
    body = (f"{_STYLE}<h1>Connect your mailbox</h1>"
            f"<div class='sub'>{e(company)} · you are signing in to your own email account. The login is kept sealed and is never shown to anyone, including the app that sent you here.</div>"
            f"{err}<form method='post' class='card' autocomplete='off'>"
            f"<label for='email'>Email address</label><input id='email' name='email' type='email' required value='{e(email)}'>"
            f"<label for='name'>Name on your emails (optional)</label><input id='name' name='display_name' value='{e(v.get('display_name', ''))}'>"
            f"<label for='preset'>Email provider</label><select id='preset' name='preset'>{opts}</select>"
            f"<label for='password'>Password or app password</label><input id='password' name='password' type='password' required>"
            f"<div class='hint'>Gmail and Microsoft 365 usually need an app password: create one in your account's security settings.</div>"
            f"<details><summary>Server details (only if your provider is not listed)</summary>"
            f"<label for='sh'>Sending server (SMTP)</label><input id='sh' name='smtp_host' value='{e(v.get('smtp_host', ''))}' placeholder='smtp.example.com'>"
            f"<label for='ih'>Receiving server (IMAP)</label><input id='ih' name='imap_host' value='{e(v.get('imap_host', ''))}' placeholder='imap.example.com'>"
            f"<label for='un'>Username (if not the email address)</label><input id='un' name='username' value='{e(v.get('username', ''))}'></details>"
            f"<button class='go' type='submit'>Connect mailbox</button></form>"
            f"<div class='sub' style='margin-top:12px'>This link works for 30 minutes.</div>")
    return _page("Connect your mailbox", body)


def done(return_url: str, mailbox_id: str, email: str) -> str:
    """The page after success: tells the page that opened this popup (only at the return address's own origin) and goes back to it."""
    parts = urllib.parse.urlparse(return_url)
    origin = f"{parts.scheme}://{parts.netloc}"
    q = urllib.parse.urlencode({"status": "connected", "provider": "mailbox", "mailbox_id": mailbox_id})
    dest = return_url + ("&" if parts.query else "?") + q
    msg = json.dumps({"type": "outreach.mailbox", "status": "connected", "mailbox_id": mailbox_id, "email": email}).replace("</", "<\\/")
    body = (f"<h1>Mailbox connected</h1><div class='sub'>{e(email)} is ready. You can close this window.</div>"
            f"<script>try{{if(window.opener)window.opener.postMessage({msg},{json.dumps(origin)});}}catch(x){{}}"
            f"setTimeout(function(){{window.location.replace({json.dumps(dest)});}},500);</script>")
    return _page("Mailbox connected", body)


async def act(db: AsyncSession, data: Dict[str, Any], form: Dict[str, str]) -> Dict[str, Any]:
    """Connect the mailbox the form describes. Returns {ok, mailbox_id, email} or {ok: False, error}."""
    from app.api.email_outreach import MailboxBody, create_mailbox

    body = MailboxBody(email=form.get("email", ""), display_name=form.get("display_name", ""), preset=form.get("preset", ""),
                       smtp_host=form.get("smtp_host", ""), imap_host=form.get("imap_host", ""),
                       username=form.get("username", ""), password=form.get("password", ""))
    if not body.password.strip():
        return {"ok": False, "error": "Enter the password or app password."}
    if data.get("e") and body.email.strip().lower() != str(data["e"]).strip().lower():
        return {"ok": False, "error": f"Connect the address this was opened for: {data['e']}."}
    try:
        mb = await create_mailbox(db, str(data.get("op") or ""), body)
    except HTTPException as err:
        await db.rollback()
        return {"ok": False, "error": str(err.detail)}
    except Exception as err:  # a mail server that times out or answers oddly
        logger.warning(f"mailbox connect failed: {err}")
        await db.rollback()
        return {"ok": False, "error": "The mail server could not be reached. Check the details and try again."}
    return {"ok": True, "mailbox_id": mb.id, "email": mb.email}
