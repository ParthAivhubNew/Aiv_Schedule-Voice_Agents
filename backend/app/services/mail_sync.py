"""The Mail screen's copy of a connected mailbox: reading folders into the database, and sending changes
(read, star, move, delete) back to the mail server so the mailbox looks the same in every other mail app.

The IMAP work is in plain functions that take settings and return plain data (they run in a thread), so
tests replace them with fakes. Everything that touches the database is async and the caller commits.
"""
from __future__ import annotations

import asyncio
import email
import hashlib
import imaplib
import logging
import re
import uuid
from datetime import datetime, timedelta
from email.header import decode_header, make_header
from email.message import Message
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import EmailMailbox, MailMessage
from app.services import mail_transport as T

logger = logging.getLogger("mail_sync")

FOLDERS = ("inbox", "sent", "drafts", "archive", "spam", "trash")
STORE_DIR = Path(__file__).resolve().parent.parent / "mailstore"
FIRST_SYNC_DAYS = 30
FIRST_SYNC_MAX = 150
PER_SYNC_MAX = 120
MAX_ATTACHMENT = 15 * 1024 * 1024
MAX_BODY = 400_000

# IMAP "special use" flags and common names, per our folder.
_SPECIAL = {"\\sent": "sent", "\\drafts": "drafts", "\\junk": "spam", "\\trash": "trash", "\\archive": "archive", "\\all": "archive"}
_NAMES = {
    "sent": ("sent", "sent items", "sent mail", "[gmail]/sent mail", "inbox.sent", "sent messages"),
    "drafts": ("drafts", "[gmail]/drafts", "inbox.drafts"),
    "spam": ("junk", "spam", "junk e-mail", "junk email", "[gmail]/spam", "inbox.spam", "inbox.junk", "bulk mail"),
    "trash": ("trash", "deleted items", "deleted messages", "[gmail]/trash", "bin", "inbox.trash"),
    "archive": ("archive", "archives", "[gmail]/all mail", "inbox.archive"),
}


# ── Reading one message ─────────────────────────────────────────────────────
def _decode(value: Any) -> str:
    try:
        return str(make_header(decode_header(str(value or ""))))
    except Exception:
        return str(value or "")


def _people(msg: Message, *headers: str) -> List[Dict[str, str]]:
    values = [v for h in headers for v in msg.get_all(h, [])]
    return [{"name": _decode(name), "email": addr.lower()} for name, addr in getaddresses(values) if addr]


def _html_to_text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style).*?</\1>", " ", html or "")
    html = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", html)
    text = re.sub(r"<[^>]+>", " ", html)
    import html as _h

    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n\n", _h.unescape(text))).strip()


def thread_key_for(message_id: str, in_reply_to: str, references: List[str], subject: str) -> str:
    """Messages of one conversation share the id of its first message; with no ids, the subject stands in."""
    root = (references[0] if references else "") or in_reply_to or message_id
    if root:
        return hashlib.sha1(root.strip().lower().encode()).hexdigest()[:24]
    plain = re.sub(r"^((re|fwd?|aw|sv):\s*)+", "", (subject or "").strip(), flags=re.I).lower()
    return "s" + hashlib.sha1(plain.encode()).hexdigest()[:23]


def parse_full(raw: bytes) -> Dict[str, Any]:
    """Everything the Mail screen shows about one raw message (pure; tested directly)."""
    msg = email.message_from_bytes(raw)
    text, html, files = "", "", []
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = part.get_content_type()
        name = _decode(part.get_filename() or "")
        disp = str(part.get("Content-Disposition") or "").lower()
        payload = part.get_payload(decode=True) or b""
        if name or "attachment" in disp or (ctype not in ("text/plain", "text/html") and not ctype.startswith("multipart")):
            if not name:
                name = f"attachment-{len(files) + 1}"
            files.append({"name": name, "type": ctype, "size": len(payload), "data": payload if len(payload) <= MAX_ATTACHMENT else b""})
            continue
        charset = part.get_content_charset() or "utf-8"
        body = payload.decode(charset, errors="replace")
        if ctype == "text/plain" and not text:
            text = body
        elif ctype == "text/html" and not html:
            html = body
    if not text and html:
        text = _html_to_text(html)
    refs = re.findall(r"<[^<>\s]+>", msg.get("References", "") or "")
    mid = (msg.get("Message-ID") or "").strip()
    reply_to = " ".join(re.findall(r"<[^<>\s]+>", msg.get("In-Reply-To", "") or ""))
    try:
        when = datetime.utcfromtimestamp(parsedate_to_datetime(msg.get("Date")).timestamp())
    except Exception:
        when = datetime.utcnow()
    frm = _people(msg, "From")
    subject = _decode(msg.get("Subject", ""))
    return {
        "message_id": mid, "in_reply_to": reply_to,
        "thread_key": thread_key_for(mid, reply_to, refs, subject),
        "from_name": frm[0]["name"] if frm else "", "from_email": frm[0]["email"] if frm else "",
        "to": _people(msg, "To"), "cc": _people(msg, "Cc"), "subject": subject,
        "text": text[:MAX_BODY], "html": html[:MAX_BODY], "files": files, "sent_at": when,
    }


def snippet_of(text: str) -> str:
    return re.sub(r"\s+", " ", T.reply_text(text, 400) or text or "").strip()[:160]


# ── The mail server (thread functions) ──────────────────────────────────────
_LIST_LINE = re.compile(rb'^\((?P<flags>[^)]*)\)\s+(?:"[^"]*"|NIL)\s+(?P<name>.+)$')


def _list_folders(m: imaplib.IMAP4_SSL) -> Dict[str, str]:
    """Our folder names -> the server's names: special-use flags first, common names second."""
    typ, data = m.list()
    boxes = []
    for line in data or []:
        match = _LIST_LINE.match(line) if isinstance(line, bytes) else None
        if match:
            name = match.group("name").decode(errors="ignore").strip()
            if len(name) > 1 and name.startswith('"') and name.endswith('"'):
                name = name[1:-1]
            boxes.append((name, match.group("flags").decode(errors="ignore").lower().split()))
    found: Dict[str, str] = {"inbox": "INBOX"}
    for name, flags in boxes:
        mine = next((_SPECIAL[f] for f in flags if f in _SPECIAL), None)
        if mine and mine not in found:
            found[mine] = name
    for name, _ in boxes:
        for mine, names in _NAMES.items():
            if mine not in found and name.lower() in names:
                found[mine] = name
    return found


def _quote(folder: str) -> str:
    return '"' + folder.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _read_sync(settings: Dict[str, Any], state: Dict[str, Any], limit: int) -> Dict[str, Any]:
    """New mail in every folder above what was read before. Returns {"folders": map, "uids": new state, "items": [...]}."""
    m = T._imap(settings)
    try:
        folders = _list_folders(m)
        uids_state = dict((state or {}).get("uids") or {})
        items: List[Dict[str, Any]] = []
        for mine in FOLDERS:
            remote = folders.get(mine)
            if not remote:
                continue
            typ, _ = m.select(_quote(remote), readonly=True)
            if typ != "OK":
                continue
            validity = ""
            try:
                typ, vdata = m.response("UIDVALIDITY")
                validity = (vdata[0] or b"").decode() if vdata else ""
            except Exception:
                pass
            known = uids_state.get(mine) or {}
            last = int(known.get("last") or 0) if known.get("validity") == validity else 0
            if last > 0:
                typ, data = m.uid("search", None, f"UID {last + 1}:*")
            else:
                since = (datetime.utcnow() - timedelta(days=FIRST_SYNC_DAYS)).strftime("%d-%b-%Y")
                typ, data = m.uid("search", None, f"SINCE {since}")
            uids = sorted(int(u) for u in (data[0] or b"").split() if int(u) > last)
            if last == 0 and len(uids) > FIRST_SYNC_MAX:
                uids = uids[-FIRST_SYNC_MAX:]
            batch = uids[:limit]
            for uid in batch:
                typ, parts = m.uid("fetch", str(uid), "(FLAGS BODY.PEEK[])")
                raw, flags = None, ""
                for p in parts or []:
                    if isinstance(p, tuple) and len(p) > 1:
                        raw = p[1]
                        flags = p[0].decode(errors="ignore")
                if raw:
                    try:
                        items.append({"folder": mine, "remote": remote, "uid": uid, "seen": "\\Seen" in flags,
                                      "starred": "\\Flagged" in flags, "draft": "\\Draft" in flags, "parsed": parse_full(raw)})
                    except Exception as err:
                        logger.debug(f"unreadable message {uid} in {remote}: {err}")
            newest = batch[-1] if batch else last
            if not batch and uids == [] and last == 0:
                newest = 0
            uids_state[mine] = {"validity": validity, "last": newest, "more": len(uids) > len(batch)}
        return {"folders": folders, "uids": uids_state, "items": items}
    finally:
        try:
            m.logout()
        except Exception:
            pass


def _find_uids(m: imaplib.IMAP4_SSL, message_id: str) -> List[str]:
    """The numbers of a message in the selected folder, looked up by its Message-ID."""
    if not message_id:
        return []
    typ, data = m.uid("search", None, "HEADER", "Message-ID", f'"{message_id}"')
    return [u.decode() for u in (data[0] or b"").split()] if typ == "OK" else []


def _apply_sync(settings: Dict[str, Any], ops: List[Dict[str, Any]]) -> None:
    """Sends changes to the server: {"folder": remote, "uid": n, "do": seen|unseen|star|unstar|move|delete, "to": remote}.
    A message that was moved here has no number in its new folder yet, so it is found there by its Message-ID."""
    m = T._imap(settings)
    try:
        current = ""
        for op in ops:
            if op["folder"] != current:
                typ, _ = m.select(_quote(op["folder"]))
                if typ != "OK":
                    continue
                current = op["folder"]
            found = [str(op["uid"])] if op.get("uid") else _find_uids(m, op.get("message_id") or "")
            do = op["do"]
            for u in found:
                if do in ("seen", "unseen"):
                    m.uid("store", u, "+FLAGS" if do == "seen" else "-FLAGS", r"(\Seen)")
                elif do in ("star", "unstar"):
                    m.uid("store", u, "+FLAGS" if do == "star" else "-FLAGS", r"(\Flagged)")
                elif do == "move" and op.get("to"):
                    typ, _ = m.uid("copy", u, _quote(op["to"]))
                    if typ == "OK":
                        m.uid("store", u, "+FLAGS", r"(\Deleted)")
                elif do == "delete":
                    m.uid("store", u, "+FLAGS", r"(\Deleted)")
        m.expunge()
    finally:
        try:
            m.logout()
        except Exception:
            pass


def _append_sync(settings: Dict[str, Any], folder: str, raw: bytes) -> None:
    m = T._imap(settings)
    try:
        m.append(_quote(folder), r"(\Seen)", imaplib.Time2Internaldate(datetime.utcnow().timetuple()), raw)
    finally:
        try:
            m.logout()
        except Exception:
            pass


async def server_read(settings, state, limit=PER_SYNC_MAX):
    try:
        return await asyncio.to_thread(_read_sync, settings, state, limit)
    except Exception as err:
        raise T.MailError(f"Could not read the mailbox: {str(err)[:200]}")


async def server_apply(settings, ops):
    try:
        await asyncio.to_thread(_apply_sync, settings, ops)
    except Exception as err:
        logger.warning(f"mail change not sent to the server: {err}")


async def server_append(settings, folder, raw):
    try:
        await asyncio.to_thread(_append_sync, settings, folder, raw)
    except Exception as err:
        logger.warning(f"sent copy not saved on the server: {err}")


# ── Files ───────────────────────────────────────────────────────────────────
def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._ -]", "_", name or "file")[:80] or "file"


def save_files(org_id: str, message_id: str, files: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Attachments go to disk under mailstore/<org>/<message>/; the list kept on the message points at them."""
    out = []
    folder = STORE_DIR / re.sub(r"[^A-Za-z0-9_-]", "_", org_id or "org") / message_id
    for n, f in enumerate(files):
        stored = ""
        if f.get("data"):
            folder.mkdir(parents=True, exist_ok=True)
            stored = f"{n}_{_safe(f['name'])}"
            (folder / stored).write_bytes(f["data"])
        out.append({"name": f["name"], "type": f.get("type") or "application/octet-stream", "size": f.get("size") or 0, "file": stored})
    return out


def file_path(org_id: str, message_id: str, stored: str) -> Optional[Path]:
    if not stored or "/" in stored or "\\" in stored or ".." in stored:
        return None
    p = STORE_DIR / re.sub(r"[^A-Za-z0-9_-]", "_", org_id or "org") / message_id / stored
    return p if p.is_file() else None


def drop_files(org_id: str, message_id: str) -> None:
    import shutil

    shutil.rmtree(STORE_DIR / re.sub(r"[^A-Za-z0-9_-]", "_", org_id or "org") / message_id, ignore_errors=True)


# ── Database side ───────────────────────────────────────────────────────────
async def store_items(db: AsyncSession, org_id: str, mb: EmailMailbox, items: List[Dict[str, Any]]) -> int:
    """Adds what was read. A message already here (same server number, or same Message-ID in that folder) is skipped."""
    added = 0
    for it in items:
        p = it["parsed"]
        dupe = (await db.execute(select(MailMessage.id).where(
            MailMessage.mailbox_id == mb.id, MailMessage.folder == it["folder"],
            ((MailMessage.uid == it["uid"]) & (MailMessage.remote_folder == it["remote"]))
            | ((MailMessage.message_id == p["message_id"]) & (p["message_id"] != "")),
        ).limit(1))).first()
        if dupe:
            continue
        mid = f"mm_{uuid.uuid4().hex[:16]}"
        files = save_files(org_id, mid, p["files"])
        db.add(MailMessage(
            id=mid, mailbox_id=mb.id, folder=it["folder"], remote_folder=it["remote"], uid=it["uid"],
            message_id=p["message_id"], in_reply_to=p["in_reply_to"], thread_key=p["thread_key"],
            from_name=p["from_name"], from_email=p["from_email"], to_list=p["to"], cc_list=p["cc"],
            subject=p["subject"], snippet=snippet_of(p["text"]), body_text=p["text"], body_html=p["html"],
            attachments=files, has_attachments=bool(files), is_read=bool(it["seen"]) or it["folder"] in ("sent", "drafts"),
            is_starred=bool(it["starred"]), sent_at=p["sent_at"],
        ))
        added += 1
    await db.flush()
    return added


async def sync_mailbox(db: AsyncSession, org_id: str, mb: EmailMailbox, settings: Dict[str, Any], limit: int = PER_SYNC_MAX) -> Dict[str, Any]:
    """Reads new mail for one mailbox into the database. Raises T.MailError when the server cannot be read."""
    res = await server_read(settings, mb.mail_state or {}, limit)
    added = await store_items(db, org_id, mb, res["items"])
    mb.mail_state = {"folders": res["folders"], "uids": res["uids"]}
    mb.mail_synced_at = datetime.utcnow()
    more = any((v or {}).get("more") for v in res["uids"].values())
    return {"added": added, "more": more}


def remote_of(mb: EmailMailbox, folder: str) -> str:
    return ((mb.mail_state or {}).get("folders") or {}).get(folder, "")
