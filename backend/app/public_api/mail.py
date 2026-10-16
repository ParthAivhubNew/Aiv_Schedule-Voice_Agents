"""Mail through the one endpoint: POST /v1/run {"plugin": "mail", "action": "...", "id": "...", "data": {...}}.

There is no URL of its own: run.py hands the request here and wraps it in the same rules as every other call (error shape,
safe retries, rate limits, audit). This module uses the same code as the Mail screen, so a message moved, starred or deleted here looks the same there. Three
permissions keep it safe: mail:read looks, mail:write sends and tidies (never erases), mail:delete erases what is
already in Trash or Drafts. A key can also be limited to some mailboxes."""
from __future__ import annotations

import base64
import binascii
import json
import uuid
from typing import Any, Dict, List, Optional

from fastapi import Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import mail_client as M
from app.public_api.core import authorize, fail, is_test, page_args

MAX_BULK = 100
MARKS = ("read", "unread", "star", "unstar")
MOVES = ("archive", "spam", "trash", "inbox")
READ, WRITE, DELETE = "mail:read", "mail:write", "mail:delete"

# action -> (permission, what it needs, what it does)
ACTIONS: Dict[str, Dict[str, str]] = {
    "mailboxes.list": {"scope": READ, "does": "Your mailboxes and their unread counts"},
    "folders.counts": {"scope": READ, "does": "How many emails are in each folder. data: mailbox_id?"},
    "messages.list": {"scope": READ, "does": "Conversations in a folder, newest first. data: folder, mailbox_id, q, unread, starred, attachments, limit, cursor"},
    "messages.get": {"scope": READ, "does": "One email in full. id: the message id"},
    "thread.get": {"scope": READ, "does": "A whole conversation. id: the thread_key from messages.list"},
    "attachment.get": {"scope": READ, "does": "One attachment as base64. id: the message id, data: index"},
    "sync": {"scope": READ, "does": "Check the mail server for new email now. data: mailbox_id?"},
    "send": {"scope": WRITE, "does": "Send an email. data: mailbox_id, to, cc, bcc, subject, body_html or body_text, from_address?, in_reply_to_id?, attachments?"},
    "draft.save": {"scope": WRITE, "does": "Save or update a draft. data: like send, plus id to update one"},
    "messages.mark": {"scope": WRITE, "does": "Mark emails read, unread, starred or unstarred. data: ids, mark"},
    "messages.move": {"scope": WRITE, "does": "Move emails to archive, spam, trash or back to inbox. data: ids, to"},
    "messages.delete": {"scope": DELETE, "does": "Erase emails for good, only from Trash or Drafts. data: ids"},
}


class MailIn(BaseModel):
    action: str = Field(..., description="What to do: " + ", ".join(ACTIONS))
    id: Optional[str] = Field(None, description="The email or conversation the action is about (see each action)")
    data: Dict[str, Any] = Field(default_factory=dict, description="The details of the action")


class _Upload:
    """A file from the request shaped like an uploaded form file, so sending reuses the Mail screen's code."""

    def __init__(self, name: str, ctype: str, blob: bytes):
        self.filename, self.content_type, self._blob = name, ctype, blob

    async def read(self) -> bytes:
        return self._blob


def _ids(body: MailIn) -> List[str]:
    ids = body.data.get("ids")
    ids = [str(i) for i in ids] if isinstance(ids, list) else ([body.id] if body.id else [])
    ids = [i for i in ids if i]
    if not ids:
        fail(422, "ids_required", "Say which emails: 'ids' in data (a list), or 'id'.")
    if len(ids) > MAX_BULK:
        fail(422, "too_many", f"Up to {MAX_BULK} emails at a time.")
    return ids


def _uploads(raw: Any) -> List[_Upload]:
    out = []
    for i, a in enumerate(raw or []):
        if not isinstance(a, dict) or not a.get("name") or not a.get("content_base64"):
            fail(422, "invalid_attachment", f"Attachment {i + 1} needs 'name' and 'content_base64'.")
        try:
            blob = base64.b64decode(str(a["content_base64"]), validate=True)
        except (binascii.Error, ValueError):
            fail(422, "invalid_attachment", f"Attachment '{a['name']}' is not valid base64.")
        out.append(_Upload(str(a["name"])[:120], str(a.get("type") or "application/octet-stream"), blob))
    return out


def _sandbox(action: str, body: MailIn) -> Dict[str, Any]:
    """A test key never touches real mail: it gets the right shape of answer and nothing changes."""
    if action == "mailboxes.list":
        return {"data": [{"id": "mb_test", "email": "test@example.com", "name": "Test", "status": "active", "unread": 0}]}
    if action == "folders.counts":
        return {"folders": {f: {"total": 0, "unread": 0} for f in ("inbox", "sent", "drafts", "archive", "spam", "trash")}}
    if action == "messages.list":
        return {"data": [], "total": 0, "next_cursor": None}
    if action in ("messages.get", "thread.get", "attachment.get"):
        fail(404, "not_found", "A test key has no real mail to read.")
    if action in ("send", "draft.save"):
        return {"ok": True, "id": "mm_test_" + uuid.uuid4().hex[:10], "status": "sent" if action == "send" else "draft", "test": True}
    return {"ok": True, "changed": 0, "test": True}


async def handle(request: Request, db: AsyncSession, body: MailIn) -> Dict[str, Any]:
    """Does one mail action. Each needs its own permission (mail:read, mail:write or mail:delete) and the Leads plan."""
    spec = ACTIONS.get(body.action)
    if not spec:
        fail(422, "unknown_action", f"'{body.action}' is not a mail action. Use one of: " + ", ".join(ACTIONS) + ".", actions=list(ACTIONS))
    ctx = await authorize(request, db, spec["scope"], "leads")
    request.state.audit_action = f"#{body.action}"
    if is_test(ctx):
        return _sandbox(body.action, body)
    d, act = body.data, body.action

    if act == "mailboxes.list":
        return {"data": (await M.my_mailboxes(request, db))["mailboxes"]}
    if act == "folders.counts":
        return await M.counts(request, str(d.get("mailbox_id") or ""), db)
    if act == "sync":
        return await M.sync_now(M.SyncBody(mailbox_id=str(d.get("mailbox_id") or ""), force=bool(d.get("force"))), request, db)
    if act == "messages.list":
        lim, off = page_args(d.get("limit", 20), str(d.get("cursor") or ""))
        got = await M.list_messages(request, folder=str(d.get("folder") or "inbox"), mailbox_id=str(d.get("mailbox_id") or ""), q=str(d.get("q") or ""),
                                    unread=bool(d.get("unread")), starred=bool(d.get("starred")), attachments=bool(d.get("attachments")),
                                    limit=lim, offset=off, db=db)
        more = off + lim < got["total"]
        nxt = base64.urlsafe_b64encode(str(off + lim).encode()).decode() if more else None
        return {"data": got["threads"], "total": got["total"], "next_cursor": nxt}
    if act in ("messages.get", "thread.get", "attachment.get"):
        if not body.id:
            fail(422, "id_required", f"'{act}' needs the 'id' of the thing you are reading.")
        if act == "messages.get":
            return await M.one_message(body.id, request, db)
        if act == "thread.get":
            return await M.open_thread(body.id, request, str(d.get("folder") or ""), db)
        try:
            index = int(d.get("index", 0))
        except (TypeError, ValueError):
            fail(422, "invalid_request", "'index' must be a number (0 is the first attachment).")
        got = await M.attachment_bytes(db, request.state.auth, body.id, index)
        return {"name": got["name"], "type": got["type"], "size": len(got["data"]), "content_base64": base64.b64encode(got["data"]).decode()}
    if act == "send":
        sent = await M.send_mail(request, payload=json.dumps({k: v for k, v in d.items() if k != "attachments"}), files=_uploads(d.get("attachments")), db=db)
        return {"ok": True, "id": sent["message"]["id"], "status": "sent", "message": sent["message"]}
    if act == "draft.save":
        return await M.save_draft(request, db, data={k: v for k, v in d.items() if k != "attachments"})
    if act == "messages.mark":
        mark = str(d.get("mark") or "")
        if mark not in MARKS:
            fail(422, "invalid_request", "'mark' must be one of: " + ", ".join(MARKS) + ".")
        return await M.act(M.ActionBody(ids=_ids(body), action=mark), request, db)
    if act == "messages.move":
        to = str(d.get("to") or "")
        if to not in MOVES:
            fail(422, "invalid_request", "'to' must be one of: " + ", ".join(MOVES) + ".")
        return await M.act(M.ActionBody(ids=_ids(body), action=to), request, db)
    return await M.act(M.ActionBody(ids=_ids(body), action="delete_forever"), request, db)  # messages.delete
