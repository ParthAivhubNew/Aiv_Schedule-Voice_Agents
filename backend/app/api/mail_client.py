"""The Mail screen of Lead Gen: read, write and tidy the mail of the connected mailboxes.

A person sees the mailboxes they connected, and admins see all of the company's. Everything is kept in
mail_messages; changes are also sent to the mail server (see services/mail_sync.py).
"""
from __future__ import annotations

import html as html_lib
import json
import logging
import re
import uuid
from datetime import datetime, timedelta
from email.message import EmailMessage as Mime
from email.utils import formataddr, formatdate, make_msgid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import Integer, Text, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import EmailMailbox, EmailMessage, LeadAccount, MailMessage
from app.services import mail_sync as S
from app.services import mail_transport as T
from app.services.email_dispatcher import alias_for, day_log, mailbox_settings

logger = logging.getLogger("mail_client")
router = APIRouter(prefix="/email/mail", tags=["Mail"])

DAILY_LIMIT = 200  # hand-written mail per mailbox per day (a safety stop, well above normal use)
MAX_RECIPIENTS = 50
MAX_FILES = 10
MAX_TOTAL_BYTES = 20 * 1024 * 1024
ACTIONS = ("read", "unread", "star", "unstar", "archive", "spam", "trash", "inbox", "delete_forever")
_MOVES = {"archive": "archive", "spam": "spam", "trash": "trash", "inbox": "inbox"}
_EMAIL = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")
AUTO_SAVES_SENT = ("gmail", "office365", "outlook")  # these save what SMTP sends into Sent by themselves


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() if d else None


async def _boxes(db: AsyncSession, ctx: Dict[str, Any], mailbox_id: str = "") -> List[EmailMailbox]:
    rows = (await db.execute(select(EmailMailbox).order_by(EmailMailbox.created_at.asc()))).scalars().all()
    if ctx.get("type") == "api_key":  # a key reaches the company's mailboxes, or only the ones it was limited to
        allowed = ctx.get("mailbox_ids")
        rows = [m for m in rows if not allowed or m.id in allowed]
    else:
        rows = [m for m in rows if ctx.get("is_admin") or m.operator_id == ctx["operator_id"]]
    if mailbox_id:
        rows = [m for m in rows if m.id == mailbox_id]
        if not rows:
            raise HTTPException(status_code=404, detail="That mailbox is not available to you.")
    return rows


def clean_html(html: str) -> str:
    """Drops what could run or load things in an email's HTML. The page also shows it in a locked-down frame."""
    h = html or ""
    h = re.sub(r"(?is)<(script|iframe|object|embed|applet|form|link|base)\b.*?(</\1>|/>|>)", "", h)
    h = re.sub(r"(?is)<meta[^>]*http-equiv[^>]*>", "", h)
    h = re.sub(r"(?i)\son\w+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", "", h)
    h = re.sub(r"(?i)(href|src)\s*=\s*([\"']?)\s*javascript:[^\"'>\s]*\2", r"\1=\2#\2", h)
    return h


def _row(m: MailMessage, box: Optional[EmailMailbox], full: bool = False) -> Dict[str, Any]:
    out = {
        "id": m.id, "mailbox_id": m.mailbox_id, "mailbox": box.email if box else "", "folder": m.folder,
        "thread_key": m.thread_key, "from": {"name": m.from_name or "", "email": m.from_email or ""},
        "to": m.to_list or [], "subject": m.subject or "", "snippet": m.snippet or "",
        "is_read": bool(m.is_read), "is_starred": bool(m.is_starred), "has_attachments": bool(m.has_attachments),
        "sent_at": _iso(m.sent_at),
    }
    if full:
        out.update({
            "cc": m.cc_list or [], "bcc": m.bcc_list or [], "body_text": m.body_text or "",
            "body_html": clean_html(m.body_html or ""), "in_reply_to": m.in_reply_to or "", "message_id": m.message_id or "",
            "attachments": [{"index": i, "name": a.get("name"), "type": a.get("type"), "size": a.get("size"), "available": bool(a.get("file"))}
                            for i, a in enumerate(m.attachments or [])],
        })
    return out


# ── Mailboxes, folders, sync ────────────────────────────────────────────────
@router.get("/mailboxes")
async def my_mailboxes(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    boxes = await _boxes(db, ctx)
    unread = dict((await db.execute(select(MailMessage.mailbox_id, func.count()).where(
        MailMessage.folder == "inbox", MailMessage.is_read.is_(False)).group_by(MailMessage.mailbox_id))).all())
    return {"mailboxes": [{
        "id": m.id, "email": m.email, "name": m.display_name or "", "signature": m.signature or "",
        "aliases": m.aliases or [], "status": m.status, "synced_at": _iso(m.mail_synced_at),
        "error": m.last_error or "", "unread": int(unread.get(m.id, 0)),
    } for m in boxes]}


@router.get("/counts")
async def counts(request: Request, mailbox_id: str = "", db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    ids = [m.id for m in await _boxes(db, ctx, mailbox_id)]
    out = {f: {"total": 0, "unread": 0} for f in S.FOLDERS}
    if ids:
        rows = (await db.execute(select(MailMessage.folder, func.count(), func.sum(func.cast(MailMessage.is_read.is_(False), Integer)))
                                 .where(MailMessage.mailbox_id.in_(ids)).group_by(MailMessage.folder))).all()
        for folder, total, unread in rows:
            if folder in out:
                out[folder] = {"total": int(total), "unread": int(unread or 0)}
    return {"folders": out}


class SyncBody(BaseModel):
    mailbox_id: str = ""
    force: bool = False


@router.post("/sync")
async def sync_now(body: SyncBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    added, errors = 0, []
    for mb in await _boxes(db, ctx, body.mailbox_id):
        if not body.force and mb.mail_synced_at and datetime.utcnow() - mb.mail_synced_at < timedelta(seconds=45):
            continue
        settings = mailbox_settings(mb)
        if T.missing(settings):
            continue
        try:
            res = await S.sync_mailbox(db, ctx["org_id"], mb, settings)
            added += res["added"]
            if mb.last_error and mb.last_error.startswith("Could not read"):
                mb.last_error = ""
        except T.MailError as err:
            mb.mail_synced_at = datetime.utcnow()
            mb.last_error = str(err)
            errors.append({"mailbox": mb.email, "error": str(err)})
    await db.commit()
    return {"added": added, "errors": errors}


# ── Lists and conversations ─────────────────────────────────────────────────
SCAN_CAP = 1500  # the newest messages one list reads; past this the total is shown as "1,234+"
SELECT_ALL_CAP = 500  # "Select all" ticks at most this many conversations, the most one bulk action takes
THREAD_MESSAGES_CAP = 5000  # a bulk action on whole conversations moves at most this many messages


def thread_heads(rows: List[Any]) -> List[Any]:
    """The newest message of each conversation, which stands for it in the list. Rows come newest first."""
    seen, heads = set(), []
    for m in rows:
        key = m.thread_key or m.id
        if key not in seen:
            seen.add(key)
            heads.append(m)
    return heads


def same_folder_thread(picked: List[Any], candidates: List[Any]) -> List[Any]:
    """The picked messages plus every other message of their conversations in the same mailbox and folder,
    so a bulk action on a conversation in the list moves all of it, not only its newest message."""
    keys = {(m.mailbox_id, m.folder, m.thread_key) for m in picked if m.thread_key}
    out = {m.id: m for m in picked}
    for m in candidates:
        if m.thread_key and (m.mailbox_id, m.folder, m.thread_key) in keys:
            out.setdefault(m.id, m)
    return list(out.values())


async def _matching_heads(db: AsyncSession, boxes: Dict[str, EmailMailbox], folder: str, q: str, unread: bool, starred: bool,
                          attachments: bool) -> tuple:
    cond = [MailMessage.mailbox_id.in_(list(boxes)), MailMessage.folder == folder]
    if unread:
        cond.append(MailMessage.is_read.is_(False))
    if starred:
        cond.append(MailMessage.is_starred.is_(True))
    if attachments:
        cond.append(MailMessage.has_attachments.is_(True))
    term = q.strip()
    if term:
        like = f"%{term.replace('%', '').replace('_', ' ')}%"
        cond.append(or_(MailMessage.subject.ilike(like), MailMessage.from_email.ilike(like), MailMessage.from_name.ilike(like),
                        MailMessage.body_text.ilike(like), func.cast(MailMessage.to_list, Text).ilike(like)))
    rows = (await db.execute(select(MailMessage).where(*cond).order_by(MailMessage.sent_at.desc()).limit(SCAN_CAP))).scalars().all()
    return thread_heads(rows), len(rows) >= SCAN_CAP


async def reply_categories(db: AsyncSession, senders: List[str]) -> Dict[str, tuple]:
    """{sender email: (reply category, saved company id)} for senders who answered a campaign email in the last 60 days.
    Two batched queries for the whole page; the newest reply wins."""
    addrs = {(a or "").strip().lower() for a in senders if a}
    if not addrs:
        return {}
    since = datetime.utcnow() - timedelta(days=60)
    rows = (await db.execute(select(EmailMessage.reply_from, EmailMessage.reply_category).where(
        func.lower(EmailMessage.reply_from).in_(list(addrs)), EmailMessage.status == "replied", EmailMessage.replied_at >= since)
        .order_by(EmailMessage.replied_at.asc()))).all()
    cat = {(f or "").strip().lower(): (c or "") for f, c in rows}
    if not cat:
        return {}
    leads = {(e or "").strip().lower(): i for i, e in (await db.execute(select(LeadAccount.id, LeadAccount.email).where(
        func.lower(LeadAccount.email).in_(list(cat))))).all()}
    return {a: (c, leads.get(a, "")) for a, c in cat.items() if c}


@router.get("/messages")
async def list_messages(request: Request, folder: str = "inbox", mailbox_id: str = "", q: str = "", unread: bool = False,
                        starred: bool = False, attachments: bool = False, limit: int = 40, offset: int = 0,
                        db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    if folder not in S.FOLDERS:
        raise HTTPException(status_code=400, detail="Unknown folder.")
    boxes = {m.id: m for m in await _boxes(db, ctx, mailbox_id)}
    if not boxes:
        return {"threads": [], "total": 0, "total_capped": False}
    heads, capped = await _matching_heads(db, boxes, folder, q, unread, starred, attachments)
    total = len(heads)
    page = heads[max(offset, 0): max(offset, 0) + max(1, min(limit, 100))]
    keys = [m.thread_key for m in page if m.thread_key]
    stats: Dict[str, Any] = {}
    if keys:
        for key, n, unread_n in (await db.execute(select(MailMessage.thread_key, func.count(), func.sum(func.cast(MailMessage.is_read.is_(False), Integer)))
                                                  .where(MailMessage.mailbox_id.in_(list(boxes)), MailMessage.thread_key.in_(keys), MailMessage.folder.notin_(("trash", "spam")))
                                                  .group_by(MailMessage.thread_key))).all():
            stats[key] = (int(n), int(unread_n or 0))
    cats = await reply_categories(db, [m.from_email for m in page if m.folder != "sent"])
    out = []
    for m in page:
        row = _row(m, boxes.get(m.mailbox_id))
        n, unread_n = stats.get(m.thread_key, (1, 0 if m.is_read else 1))
        row["count"], row["unread_count"] = max(n, 1), unread_n
        row["reply_category"], row["lead_id"] = cats.get((m.from_email or "").strip().lower(), ("", ""))
        out.append(row)
    return {"threads": out, "total": total, "total_capped": capped}


class SelectAllBody(BaseModel):
    folder: str = "inbox"
    mailbox_id: str = ""
    q: str = ""
    unread: bool = False
    starred: bool = False
    attachments: bool = False


@router.post("/messages/ids")
async def select_all(body: SelectAllBody, request: Request, db: AsyncSession = Depends(get_db)):
    """Every conversation the open folder, filters and search match, newest first, up to SELECT_ALL_CAP: what "Select all" ticks.
    Each id is the conversation's newest message, the same id the list shows; send them back with threads=true."""
    ctx = current(request)
    if body.folder not in S.FOLDERS:
        raise HTTPException(status_code=400, detail="Unknown folder.")
    boxes = {m.id: m for m in await _boxes(db, ctx, body.mailbox_id)}
    if not boxes:
        return {"ids": [], "total": 0, "total_capped": False, "limit": SELECT_ALL_CAP}
    heads, capped = await _matching_heads(db, boxes, body.folder, body.q, body.unread, body.starred, body.attachments)
    return {"ids": [m.id for m in heads[:SELECT_ALL_CAP]], "total": len(heads), "total_capped": capped, "limit": SELECT_ALL_CAP}


@router.get("/messages/{message_id}")
async def one_message(message_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    boxes = {m.id: m for m in await _boxes(db, ctx)}
    m = (await db.execute(select(MailMessage).where(MailMessage.id == message_id, MailMessage.mailbox_id.in_(list(boxes) or [""])))).scalars().first()
    if not m:
        raise HTTPException(status_code=404, detail="That message is not here any more.")
    return {"message": _row(m, boxes.get(m.mailbox_id), full=True)}


@router.get("/threads/{thread_key}")
async def open_thread(thread_key: str, request: Request, folder: str = "", db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    boxes = {m.id: m for m in await _boxes(db, ctx)}
    cond = [MailMessage.mailbox_id.in_(list(boxes) or [""]), MailMessage.thread_key == thread_key]
    if folder != "trash":
        cond.append(MailMessage.folder != "trash")
    rows = (await db.execute(select(MailMessage).where(*cond).order_by(MailMessage.sent_at.asc()))).scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="That conversation is not here any more.")
    return {"messages": [_row(m, boxes.get(m.mailbox_id), full=True) for m in rows]}


# ── Tidying up ──────────────────────────────────────────────────────────────
class ActionBody(BaseModel):
    ids: List[str]
    action: str
    threads: bool = False  # the ids stand for conversations in the list: act on each one's messages in that folder too


@router.post("/actions")
async def act(body: ActionBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    if body.action not in ACTIONS:
        raise HTTPException(status_code=400, detail="Unknown action.")
    if not body.ids or len(body.ids) > SELECT_ALL_CAP:
        raise HTTPException(status_code=400, detail=f"Pick between 1 and {SELECT_ALL_CAP} messages.")
    boxes = {m.id: m for m in await _boxes(db, ctx)}
    rows = (await db.execute(select(MailMessage).where(MailMessage.id.in_(body.ids), MailMessage.mailbox_id.in_(list(boxes) or [""])))).scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="Those messages are not available to you.")
    if body.threads:
        keys = list({m.thread_key for m in rows if m.thread_key})
        if keys:
            near = (await db.execute(select(MailMessage).where(
                MailMessage.mailbox_id.in_(list({m.mailbox_id for m in rows})), MailMessage.thread_key.in_(keys),
                MailMessage.folder.in_(list({m.folder for m in rows}))).limit(THREAD_MESSAGES_CAP + 1))).scalars().all()
            if len(near) > THREAD_MESSAGES_CAP:
                raise HTTPException(status_code=400, detail="Those conversations hold too many emails for one go. Pick fewer.")
            rows = same_folder_thread(rows, near)
    if body.action == "delete_forever" and any(m.folder not in ("trash", "drafts") for m in rows):
        raise HTTPException(status_code=400, detail="Move it to Trash first, then delete it for good.")
    ops: Dict[str, List[Dict[str, Any]]] = {}
    for m in rows:
        mb = boxes[m.mailbox_id]
        server = {"folder": m.remote_folder, "uid": m.uid, "message_id": m.message_id} if (m.remote_folder and (m.uid or m.message_id)) else None
        if body.action in ("read", "unread"):
            m.is_read = body.action == "read"
            if server:
                ops.setdefault(mb.id, []).append({**server, "do": "seen" if m.is_read else "unseen"})
        elif body.action in ("star", "unstar"):
            m.is_starred = body.action == "star"
            if server:
                ops.setdefault(mb.id, []).append({**server, "do": "star" if m.is_starred else "unstar"})
        elif body.action in _MOVES:
            target = _MOVES[body.action]
            if m.folder == target:
                continue
            to_remote = S.remote_of(mb, target)
            if server and to_remote:
                ops.setdefault(mb.id, []).append({**server, "do": "move", "to": to_remote})
                m.remote_folder, m.uid = to_remote, 0  # it gets a new number there; reading it again is matched by its Message-ID
            m.folder = target
        else:  # delete_forever
            if server:
                ops.setdefault(mb.id, []).append({**server, "do": "delete"})
            S.drop_files(ctx["org_id"], m.id)
            await db.delete(m)
    await db.commit()
    for box_id, items in ops.items():
        await S.server_apply(mailbox_settings(boxes[box_id]), items)
    return {"ok": True, "changed": len(rows)}


# ── Writing ─────────────────────────────────────────────────────────────────
def _addresses(raw: Any, label: str) -> List[str]:
    items = raw if isinstance(raw, list) else re.split(r"[,;\n]+", str(raw or ""))
    out: List[str] = []
    for item in items:
        a = str(item or "").strip()
        m = re.search(r"<([^<>]+)>", a)
        a = (m.group(1) if m else a).strip().lower()
        if not a:
            continue
        if not _EMAIL.match(a):
            raise HTTPException(status_code=400, detail=f"“{a}” in {label} is not an email address.")
        if a not in out:
            out.append(a)
    return out


def _people_list(addrs: List[str]) -> List[Dict[str, str]]:
    return [{"name": "", "email": a} for a in addrs]


async def _draft_fields(payload: Dict[str, Any], boxes: Dict[str, EmailMailbox], db: AsyncSession) -> Dict[str, Any]:
    mb = boxes.get(str(payload.get("mailbox_id") or ""))
    if not mb:
        raise HTTPException(status_code=400, detail="Pick the mailbox to send from.")
    parent = None
    if payload.get("in_reply_to_id"):
        parent = (await db.execute(select(MailMessage).where(MailMessage.id == str(payload["in_reply_to_id"]), MailMessage.mailbox_id.in_(list(boxes))))).scalars().first()
    html = clean_html(str(payload.get("body_html") or ""))
    return {"mb": mb, "parent": parent, "html": html, "text": str(payload.get("body_text") or "") or S._html_to_text(html),
            "to": _addresses(payload.get("to"), "To"), "cc": _addresses(payload.get("cc"), "Cc"), "bcc": _addresses(payload.get("bcc"), "Bcc"),
            "subject": str(payload.get("subject") or "").strip()[:300], "from_address": str(payload.get("from_address") or "").strip().lower()}


@router.post("/send")
async def send_mail(request: Request, payload: str = Form(...), files: List[UploadFile] = File(default=[]), db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    try:
        data = json.loads(payload)
    except ValueError:
        raise HTTPException(status_code=400, detail="That message could not be read.")
    boxes = {m.id: m for m in await _boxes(db, ctx)}
    f = await _draft_fields(data, boxes, db)
    mb, parent = f["mb"], f["parent"]
    if not f["to"]:
        raise HTTPException(status_code=400, detail="Add at least one person in To.")
    if len(f["to"]) + len(f["cc"]) + len(f["bcc"]) > MAX_RECIPIENTS:
        raise HTTPException(status_code=400, detail=f"That is more than {MAX_RECIPIENTS} people. Send it in smaller groups.")
    if mb.status == "disabled":
        raise HTTPException(status_code=400, detail="This mailbox is switched off.")
    settings = mailbox_settings(mb)
    if T.missing(settings):
        raise HTTPException(status_code=400, detail="This mailbox is not fully set up to send yet.")
    log = await day_log(db, mb.id)
    if (log.sent_count or 0) >= DAILY_LIMIT:
        raise HTTPException(status_code=429, detail=f"This mailbox has sent {DAILY_LIMIT} emails today. Try again tomorrow.")

    alias = alias_for(mb, f["from_address"]) if f["from_address"] and f["from_address"] != mb.email.lower() else None
    from_addr = alias["address"] if alias else mb.email
    msg = Mime()
    msg["From"] = formataddr(((alias.get("name") if alias else "") or mb.display_name or "", from_addr))
    msg["To"] = ", ".join(f["to"])
    if f["cc"]:
        msg["Cc"] = ", ".join(f["cc"])
    if f["bcc"]:
        msg["Bcc"] = ", ".join(f["bcc"])
    msg["Subject"] = f["subject"] or "(no subject)"
    msg["Date"] = formatdate(localtime=False, usegmt=True)
    msg["Message-ID"] = make_msgid(domain=mb.email.split("@")[-1])
    if parent and parent.message_id:
        msg["In-Reply-To"] = parent.message_id
        msg["References"] = f"{parent.in_reply_to} {parent.message_id}".strip()
    msg.set_content(f["text"] or " ")
    if f["html"]:
        msg.add_alternative(f["html"], subtype="html")
    kept, total = [], 0
    for up in files[:MAX_FILES]:
        blob = await up.read()
        total += len(blob)
        if total > MAX_TOTAL_BYTES:
            raise HTTPException(status_code=400, detail="The attachments are over 20 MB together. Send fewer or smaller files.")
        main, _, sub = (up.content_type or "application/octet-stream").partition("/")
        msg.add_attachment(blob, maintype=main or "application", subtype=sub or "octet-stream", filename=up.filename or "file")
        kept.append({"name": up.filename or "file", "type": up.content_type or "application/octet-stream", "size": len(blob), "data": blob})
    try:
        await T.send(settings, msg)
    except T.MailError as err:
        raise HTTPException(status_code=502, detail=str(err))

    mid = f"mm_{uuid.uuid4().hex[:16]}"
    thread = parent.thread_key if parent else S.thread_key_for(msg["Message-ID"], "", [], f["subject"])
    stored = MailMessage(
        id=mid, mailbox_id=mb.id, folder="sent", message_id=msg["Message-ID"], in_reply_to=parent.message_id if parent else "",
        thread_key=thread, from_name=(alias.get("name") if alias else "") or mb.display_name or "", from_email=from_addr.lower(),
        to_list=_people_list(f["to"]), cc_list=_people_list(f["cc"]), bcc_list=_people_list(f["bcc"]),
        subject=f["subject"] or "(no subject)", snippet=S.snippet_of(f["text"]), body_text=f["text"], body_html=f["html"],
        attachments=S.save_files(ctx["org_id"], mid, kept), has_attachments=bool(kept), is_read=True, sent_at=datetime.utcnow(),
    )
    db.add(stored)
    log.sent_count = (log.sent_count or 0) + 1
    mb.last_sent_at = datetime.utcnow()
    draft_id = str(data.get("draft_id") or "")
    if draft_id:
        d = (await db.execute(select(MailMessage).where(MailMessage.id == draft_id, MailMessage.folder == "drafts", MailMessage.mailbox_id.in_(list(boxes))))).scalars().first()
        if d:
            await db.delete(d)
    await db.commit()
    if not any(k in (settings.get("smtp_host") or "").lower() for k in AUTO_SAVES_SENT) and S.remote_of(mb, "sent"):
        await S.server_append(settings, S.remote_of(mb, "sent"), msg.as_bytes())
    return {"ok": True, "message": _row(stored, mb, full=True)}


@router.post("/drafts")
async def save_draft(request: Request, db: AsyncSession = Depends(get_db), data: Optional[Dict[str, Any]] = None):
    ctx = current(request)
    if data is None:
        data = await request.json()
    boxes = {m.id: m for m in await _boxes(db, ctx)}
    f = await _draft_fields(data, boxes, db)
    row = None
    if data.get("id"):
        row = (await db.execute(select(MailMessage).where(MailMessage.id == str(data["id"]), MailMessage.folder == "drafts", MailMessage.mailbox_id.in_(list(boxes))))).scalars().first()
    if not row:
        row = MailMessage(id=f"mm_{uuid.uuid4().hex[:16]}", mailbox_id=f["mb"].id, folder="drafts", uid=0, is_read=True)
        db.add(row)
    parent = f["parent"]
    row.mailbox_id = f["mb"].id
    row.from_email = f["mb"].email.lower()
    row.to_list, row.cc_list, row.bcc_list = _people_list(f["to"]), _people_list(f["cc"]), _people_list(f["bcc"])
    row.subject, row.body_html, row.body_text = f["subject"], f["html"], f["text"]
    row.snippet = S.snippet_of(f["text"])
    row.in_reply_to = parent.message_id if parent else ""
    row.thread_key = parent.thread_key if parent else (row.thread_key or f"d{row.id}")
    row.sent_at = datetime.utcnow()
    await db.commit()
    return {"ok": True, "message": _row(row, f["mb"], full=True)}


@router.get("/messages/{message_id}/attachments/{index}")
async def download(message_id: str, index: int, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    boxes = {m.id: m for m in await _boxes(db, ctx)}
    m = (await db.execute(select(MailMessage).where(MailMessage.id == message_id, MailMessage.mailbox_id.in_(list(boxes) or [""])))).scalars().first()
    files = (m.attachments if m else None) or []
    if not m or index < 0 or index >= len(files):
        raise HTTPException(status_code=404, detail="That attachment is not here.")
    path = S.file_path(ctx["org_id"], m.id, files[index].get("file") or "")
    if not path:
        raise HTTPException(status_code=404, detail="That attachment was too large to keep.")
    return FileResponse(path, media_type="application/octet-stream", filename=files[index].get("name") or "file",
                        headers={"X-Content-Type-Options": "nosniff"})


async def attachment_bytes(db: AsyncSession, ctx: Dict[str, Any], message_id: str, index: int) -> Dict[str, Any]:
    """One attachment as bytes, for callers that cannot take a file download (the public API)."""
    boxes = {m.id: m for m in await _boxes(db, ctx)}
    m = (await db.execute(select(MailMessage).where(MailMessage.id == message_id, MailMessage.mailbox_id.in_(list(boxes) or [""])))).scalars().first()
    files = (m.attachments if m else None) or []
    if not m or index < 0 or index >= len(files):
        raise HTTPException(status_code=404, detail="That attachment is not here.")
    path = S.file_path(ctx["org_id"], m.id, files[index].get("file") or "")
    if not path:
        raise HTTPException(status_code=404, detail="That attachment was too large to keep.")
    return {"name": files[index].get("name") or "file", "type": files[index].get("type") or "application/octet-stream", "data": path.read_bytes()}
