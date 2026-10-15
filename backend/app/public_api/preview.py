"""The preview page: a link that opens a post (later also an email campaign) with no sign-in.

Anyone holding the link can read it, and can approve, reject, edit or ask the AI to redo it, until the
link expires (10 days). It acts on the same record as the app, the approval emails and the API.
"""
from __future__ import annotations

import html
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.core.tenancy import org_scope
from app.database import AsyncSessionLocal
from app.public_api import links
from app.public_api.core import ApiError
from app.services.approval_mail import _page

logger = logging.getLogger("public_api.preview")
router = APIRouter(tags=["Preview pages"])

_GONE = _page("Link not valid", "<h1>This link is no longer valid</h1><div class='sub'>It has expired or was changed. "
              "Ask for a new link, or open the app.</div>")
_EDITABLE = ("needs_approval", "approval_closed", "rejected")


def _esc(v: Any) -> str:
    return html.escape(str(v if v is not None else ""))


def _when(ms: Optional[str], tz: str) -> str:
    if not ms:
        return "As soon as it is approved"
    try:
        import zoneinfo

        d = datetime.strptime(ms, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=zoneinfo.ZoneInfo("UTC")).astimezone(zoneinfo.ZoneInfo(tz))
        return d.strftime("%a %d %b %Y, %H:%M") + f" ({tz})"
    except Exception:
        return ms


def _input_time(ms: Optional[str], tz: str) -> str:
    try:
        import zoneinfo

        d = datetime.strptime(ms or "", "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=zoneinfo.ZoneInfo("UTC")).astimezone(zoneinfo.ZoneInfo(tz))
        return d.strftime("%Y-%m-%dT%H:%M")
    except Exception:
        return ""


_STATUS_TEXT = {
    "writing": ("The AI is writing this post. This page refreshes by itself.", ""),
    "waiting_for_credits": ("Waiting for credits. Top up in the app and writing carries on.", "bad"),
    "needs_approval": ("Waiting for your decision", ""),
    "approved": ("Approved", "good"),
    "publishing": ("Posting now", ""),
    "published": ("Posted", "good"),
    "failed": ("Something went wrong", "bad"),
    "rejected": ("Rejected", "bad"),
    "canceled": ("Cancelled", "bad"),
    "approval_closed": ("The publish time passed before anyone approved it. Pick a new time to approve it again.", "bad"),
}


def render(v: Dict[str, Any], token: str, company: str, tz: str, notice: str = "") -> str:
    st = v["status"]
    label, tone = _STATUS_TEXT.get(st, (st, ""))
    t = _esc(token)
    cards = ""
    for pc in v["per_channel"]:
        img = f'<img src="{_esc(v["image_url"])}" alt="">' if (v.get("image_url") or "").startswith(("http", "data:")) else ""
        cards += (f'<div class="card"><div class="meta">{_esc(pc["channel"]).title()}</div>'
                  f'<div class="head">{_esc(v["headline"] or "")}</div>{img}<div class="cap">{_esc(pc["caption"])}</div></div>')
    if not cards:
        cards = '<div class="card">Nothing to show yet.</div>'
    banner = f'<div class="card" style="border-color:#0F766E"><strong>{_esc(notice)}</strong></div>' if notice else ""
    test = '<div class="card" style="border-color:#B45309"><strong>Test post.</strong> Nothing real is posted or charged.</div>' if v.get("test") else ""
    pill = f'<span class="pill {tone}">{_esc(label)}</span>'
    extra = ""
    if v.get("note"):
        extra += f'<div class="meta" style="margin-top:8px">{_esc(v["note"])}</div>'
    if v.get("error"):
        extra += f'<div class="meta bad" style="margin-top:8px">{_esc(v["error"])}</div>'
    for r in v.get("results") or []:
        extra += (f'<div class="meta">{_esc(r["channel"])}: ' + (f'<a href="{_esc(r["url"])}">View post</a>' if r.get("url") else
                                                               ("Posted" if r["ok"] else f'Failed ({_esc(r["error"])})')) + "</div>")
    status_card = (f'<div class="card"><div class="meta">Goes live</div><div class="head">{_esc(_when(v["publish_at"], tz))}</div>'
                   f'{pill}{extra}</div>')

    def hidden(action: str) -> str:
        return f'<input type="hidden" name="action" value="{action}">'

    actions = ""
    if st == "needs_approval":
        actions += (f'<form method="post"><input type="hidden" name="t" value="{t}">{hidden("approve")}'
                    '<div class="row"><button class="ok" type="submit">Approve</button></div></form>'
                    f'<details><summary>Reject…</summary><form method="post" style="margin-top:8px">{hidden("reject")}'
                    '<textarea name="note" rows="2" placeholder="What should change? (optional)"></textarea>'
                    '<div class="row"><button class="no" type="submit">Reject</button></div></form></details>')
    if st in _EDITABLE and not v.get("test"):
        actions += (f'<div class="card" style="margin-top:14px"><div class="head">Edit</div><form method="post">{hidden("save")}'
                    f'<div class="meta">Headline</div><input name="headline" value="{_esc(v["headline"] or "")}" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #E6E3DC;border-radius:10px">'
                    f'<div class="meta" style="margin-top:8px">Text</div><textarea name="caption" rows="6">{_esc(v["caption"])}</textarea>'
                    f'<div class="meta" style="margin-top:8px">Publish time ({_esc(tz)})</div>'
                    f'<input type="datetime-local" name="publish_at" value="{_esc(_input_time(v["publish_at"], tz))}" style="padding:8px;border:1px solid #E6E3DC;border-radius:10px">'
                    '<div class="row"><button type="submit">Save changes</button></div></form></div>'
                    f'<div class="card"><div class="head">Ask the AI</div><form method="post">{hidden("rewrite")}'
                    '<input name="instruction" placeholder="What should change? e.g. shorter, friendlier" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #E6E3DC;border-radius:10px">'
                    '<div class="row"><button type="submit">Rewrite the text</button></div></form>'
                    f'<form method="post" style="margin-top:10px">{hidden("image")}'
                    '<input name="instruction" placeholder="New picture: what should it show? (optional)" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #E6E3DC;border-radius:10px">'
                    '<div class="row"><button type="submit">Draw a new picture</button></div></form></div>')
    if st == "approved":
        actions += (f'<form method="post">{hidden("cancel")}<div class="row"><button class="no" type="submit">Cancel this post</button></div></form>')
    refresh = '<meta http-equiv="refresh" content="6">' if st == "writing" else ""
    body = (f"<h1>Post preview</h1><div class='sub'>{_esc(company)} · this link works for 10 days and needs no sign-in</div>"
            f"{test}{banner}{status_card}{cards}{actions}")
    return _page("Post preview", body).replace("</head>", refresh + "</head>", 1)


async def _handle(request: Request, token: str, form: Optional[Dict[str, str]]) -> HTMLResponse:
    from app.public_api import social as S
    from app.services.approval_mail import _company_name
    from app.services.org_settings import org_timezone

    call_data = links.read_token(token, "call")
    if call_data:
        return await _handle_call(call_data["o"], call_data["i"], form)
    camp_data = links.read_token(token, "campaign")
    if camp_data:
        return await _handle_campaign(camp_data["o"], camp_data["i"], form)
    book_data = links.read_token(token, "book")
    if book_data:
        return await _handle_book(book_data["o"], book_data["i"], form)
    data = links.read_token(token, "post")
    if not data:
        return HTMLResponse(_GONE, status_code=404)
    org, post_id = data["o"], data["i"]
    notice = ""
    with org_scope(org):
        async with AsyncSessionLocal() as db:
            try:
                if form:
                    notice = await _act(db, request, org, post_id, form)
                v = await S.full_view(db, post_id, org)
            except ApiError as err:
                notice = err.message
                await db.rollback()
                v = await S.full_view(db, post_id, org)
            except HTTPException as err:
                notice = str(err.detail) if not isinstance(err.detail, dict) else str(err.detail.get("message") or err.detail)
                await db.rollback()
                v = await S.full_view(db, post_id, org)
            company = await _company_name(db)
            tz = await org_timezone(db)
    return HTMLResponse(render(v, token, company, tz, notice))


async def _handle_campaign(org: str, campaign_id: str, form: Optional[Dict[str, str]]) -> HTMLResponse:
    from app.public_api import campaign_page
    from app.public_api import email as E
    from app.services.approval_mail import _company_name

    notice = ""
    with org_scope(org):
        async with AsyncSessionLocal() as db:
            try:
                if form:
                    notice = await campaign_page.act(db, org, campaign_id, form)
                if campaign_id.startswith(E.SANDBOX):
                    o = await db.get(E.PublicObject, campaign_id)
                    if not o:
                        return HTMLResponse(_GONE, status_code=404)
                    v = E._sandbox_view(o, org)
                else:
                    v = await E.view(db, await E._campaign(db, campaign_id), org)
            except ApiError as err:
                return HTMLResponse(_GONE if err.status == 404 else _page("Campaign", f"<h1>Campaign</h1><div class='card'>{_esc(err.message)}</div>"),
                                    status_code=err.status)
            company = await _company_name(db)
    return HTMLResponse(campaign_page.render(v, company, notice))


async def _handle_book(org: str, ref_raw: str, form: Optional[Dict[str, str]]) -> HTMLResponse:
    from app.public_api import book_page
    from app.services.approval_mail import _company_name

    ref = book_page.decode(ref_raw)
    notice, done = "", None
    with org_scope(org):
        async with AsyncSessionLocal() as db:
            try:
                week, lead, tz = await book_page.view(db, ref)
                if form:
                    res = await book_page.act(db, org, ref, form, lead, tz)
                    if res.get("error"):
                        notice = res["error"]
                        await db.rollback()
                        week, lead, tz = await book_page.view(db, ref)
                    else:
                        done = res
            except Exception as err:
                logger.warning(f"booking page failed: {err}")
                return HTMLResponse(_page("Book a time", "<h1>Booking is not available right now</h1><div class='sub'>Please try again later or reply to the message you received.</div>"), status_code=503)
            company = await _company_name(db)
    name = (form or {}).get("name") or getattr(lead, "contact_name", "") or ""
    email = (form or {}).get("email") or getattr(lead, "email", "") or ""
    return HTMLResponse(book_page.render(week, company, tz, name, email, notice, done))


async def _handle_call(org: str, call_id: str, form: Optional[Dict[str, str]]) -> HTMLResponse:
    from app.public_api import call_page
    from app.public_api import voice as V
    from app.services.approval_mail import _company_name

    notice = ""
    with org_scope(org):
        async with AsyncSessionLocal() as db:
            try:
                if form:
                    notice = await call_page.act(db, org, call_id, form)
                v = await V.full_view(db, call_id, org)
            except ApiError as err:
                return HTMLResponse(_GONE if err.status == 404 else _page("Call", f"<h1>Call</h1><div class='card'>{_esc(err.message)}</div>"),
                                    status_code=err.status)
            company = await _company_name(db)
    return HTMLResponse(call_page.render(v, company, notice))


async def _act(db, request: Request, org: str, post_id: str, form: Dict[str, str]) -> str:
    from app.public_api import social as S
    from app.services.org_settings import org_timezone

    action = form.get("action", "")
    ctx = {"org_id": org, "key_id": "preview", "name": "preview link"}
    by = "preview link"
    if post_id.startswith(S.SANDBOX_PREFIX):
        o = await db.get(S.PublicObject, post_id)
        if action in ("approve", "reject", "cancel") and o:
            await S.sandbox_decide(db, o, org, action, by, form.get("note", ""), None)
            return {"approve": "Approved.", "reject": "Rejected.", "cancel": "Cancelled."}[action]
        return ""
    post = await S.get_post(db, post_id)
    if not post:
        return "That post no longer exists."
    if action in ("approve", "reject", "cancel"):
        await S.decide(db, post, action, by, form.get("note", ""))
        return {"approve": "Approved. It will go live at the time shown.", "reject": "Rejected.", "cancel": "Cancelled."}[action]
    if action == "save":
        when = None
        raw = (form.get("publish_at") or "").strip()
        if raw:
            try:
                when = datetime.fromisoformat(raw)
            except ValueError:
                return "That publish time is not valid."
        body = S.EditPostIn(headline=form.get("headline") or None, caption=form.get("caption"), publish_at=when)
        await S.edit_post(db, request, ctx, post, body)
        return "Saved. It needs approving again."
    if action in ("rewrite", "image"):
        await S.regenerate(db, ctx, post, "text" if action == "rewrite" else "image", (form.get("instruction") or "").strip())
        return "The AI is on it. This page refreshes when it is done."
    return ""


@router.get("/p/{token}", response_class=HTMLResponse)
async def preview_get(token: str, request: Request):
    return await _handle(request, token, None)


@router.post("/p/{token}", response_class=HTMLResponse)
async def preview_post(token: str, request: Request):
    form = {k: str(v) for k, v in (await request.form()).items()}
    return await _handle(request, token, form)
