"""Sending and reading mail for outreach mailboxes over SMTP and IMAP.

Every mailbox (a client's own, or the platform's one.com mailbox) is a set of SMTP + IMAP
settings with one username and password. Nothing here touches the database: callers pass the
settings in and get plain results back, so the rest of the system can be tested with a fake.

The network work runs in a thread (smtplib / imaplib are blocking).
"""
from __future__ import annotations

import asyncio
import email
import imaplib
import logging
import re
import smtplib
import ssl
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from email.message import EmailMessage, Message
from email.utils import getaddresses, parseaddr
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("mail_transport")

WARMUP_HEADER = "X-OutReach-Warmup"
TIMEOUT = 25
SPAM_FOLDERS = ("Junk", "Spam", "INBOX.Spam", "INBOX.Junk", "[Gmail]/Spam", "Junk E-mail", "Junk Email", "Bulk Mail")

# Known providers: the server settings a user would otherwise have to look up.
PRESETS: Dict[str, Dict[str, Any]] = {
    "one.com": {"smtp_host": "send.one.com", "smtp_port": 465, "smtp_security": "ssl", "imap_host": "imap.one.com", "imap_port": 993},
    "gmail": {"smtp_host": "smtp.gmail.com", "smtp_port": 465, "smtp_security": "ssl", "imap_host": "imap.gmail.com", "imap_port": 993},
    "outlook": {"smtp_host": "smtp.office365.com", "smtp_port": 587, "smtp_security": "starttls", "imap_host": "outlook.office365.com", "imap_port": 993},
    "zoho": {"smtp_host": "smtp.zoho.eu", "smtp_port": 465, "smtp_security": "ssl", "imap_host": "imap.zoho.eu", "imap_port": 993},
}


class MailError(RuntimeError):
    """The mail server refused or could not be reached (message is safe to show)."""


def clean_settings(raw: Dict[str, Any], email_addr: str = "") -> Dict[str, Any]:
    """Normalised SMTP/IMAP settings; missing ports and security follow the usual defaults."""
    raw = raw or {}
    preset = PRESETS.get(str(raw.get("preset") or "").lower(), {})
    out = {**preset}
    for k in ("smtp_host", "imap_host", "username", "password", "smtp_security"):
        v = str(raw.get(k) or "").strip()
        if v:
            out[k] = v
    for k in ("smtp_port", "imap_port"):
        try:
            if raw.get(k):
                out[k] = int(raw[k])
        except (TypeError, ValueError):
            pass
    sec = str(out.get("smtp_security") or "").lower()
    port = int(out.get("smtp_port") or 0)
    if sec not in ("ssl", "starttls", "none"):
        sec = "ssl" if port == 465 else "starttls"
    out["smtp_security"] = sec
    out["smtp_port"] = port or (465 if sec == "ssl" else 587)
    out["imap_port"] = int(out.get("imap_port") or 993)
    out["username"] = out.get("username") or email_addr
    out.setdefault("smtp_host", "")
    out.setdefault("imap_host", "")
    out.setdefault("password", "")
    return out


def missing(settings: Dict[str, Any]) -> List[str]:
    return [k for k in ("smtp_host", "imap_host", "username", "password") if not settings.get(k)]


# ── SMTP ────────────────────────────────────────────────────────────────────
def _smtp(settings: Dict[str, Any]):
    ctx = ssl.create_default_context()
    host, port, sec = settings["smtp_host"], int(settings["smtp_port"]), settings["smtp_security"]
    if sec == "ssl":
        s = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT, context=ctx)
    else:
        s = smtplib.SMTP(host, port, timeout=TIMEOUT)
        s.ehlo()
        if sec == "starttls":
            s.starttls(context=ctx)
            s.ehlo()
    s.login(settings["username"], settings["password"])
    return s


def _send_sync(settings: Dict[str, Any], msg: EmailMessage) -> None:
    s = _smtp(settings)
    try:
        refused = s.send_message(msg)
        if refused:
            raise MailError(f"The server refused: {', '.join(refused)}")
    finally:
        try:
            s.quit()
        except Exception:
            pass


async def send(settings: Dict[str, Any], msg: EmailMessage) -> None:
    try:
        await asyncio.to_thread(_send_sync, settings, msg)
    except MailError:
        raise
    except smtplib.SMTPAuthenticationError:
        raise MailError("The mail server rejected the username or password.")
    except smtplib.SMTPRecipientsRefused as err:
        raise MailError(f"The server refused the recipient: {', '.join(err.recipients)}")
    except Exception as err:
        raise MailError(f"Could not send: {str(err)[:200]}")


# ── IMAP ────────────────────────────────────────────────────────────────────
def _imap(settings: Dict[str, Any]) -> imaplib.IMAP4_SSL:
    m = imaplib.IMAP4_SSL(settings["imap_host"], int(settings["imap_port"]), timeout=TIMEOUT)
    m.login(settings["username"], settings["password"])
    return m


def _check_sync(settings: Dict[str, Any]) -> None:
    try:
        _smtp(settings).quit()
    except smtplib.SMTPAuthenticationError:
        raise MailError("Sending (SMTP) rejected the username or password.")
    except Exception as err:
        raise MailError(f"Sending (SMTP) failed: {str(err)[:200]}")
    try:
        m = _imap(settings)
        m.logout()
    except imaplib.IMAP4.error:
        raise MailError("Reading (IMAP) rejected the username or password.")
    except Exception as err:
        raise MailError(f"Reading (IMAP) failed: {str(err)[:200]}")


async def check_login(settings: Dict[str, Any]) -> None:
    """Logs in to SMTP and IMAP; raises MailError saying which failed."""
    gaps = missing(settings)
    if gaps:
        raise MailError("Fill in: " + ", ".join(g.replace("_", " ") for g in gaps) + ".")
    await asyncio.to_thread(_check_sync, settings)


@dataclass
class Incoming:
    uid: int
    from_addr: str = ""
    from_name: str = ""
    to_addrs: List[str] = field(default_factory=list)
    subject: str = ""
    message_id: str = ""
    in_reply_to: str = ""
    references: List[str] = field(default_factory=list)
    text: str = ""
    auto_submitted: bool = False
    warmup_id: str = ""
    is_bounce: bool = False
    failed_recipients: List[str] = field(default_factory=list)
    bounce_status: str = ""  # e.g. 5.1.1 (5.x.x = permanent)
    bounced_message_id: str = ""


_ID = re.compile(r"<[^<>\s]+>")
_EMAIL = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_STATUS = re.compile(r"\b([245]\.\d{1,3}\.\d{1,3})\b")
_BOUNCE_FROM = re.compile(r"(mailer-daemon|postmaster|mail delivery)", re.I)
_BOUNCE_SUBJECT = re.compile(
    r"(undeliver|delivery status notification|delivery failure|mail delivery failed|returned mail|"
    r"failure notice|could not be delivered|not delivered)", re.I)


def _text_of(msg: Message) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                try:
                    return part.get_content() if hasattr(part, "get_content") else part.get_payload(decode=True).decode(errors="ignore")
                except Exception:
                    payload = part.get_payload(decode=True) or b""
                    return payload.decode(part.get_content_charset() or "utf-8", errors="ignore")
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                payload = part.get_payload(decode=True) or b""
                return re.sub(r"<[^>]+>", " ", payload.decode(part.get_content_charset() or "utf-8", errors="ignore"))
        return ""
    payload = msg.get_payload(decode=True) or b""
    body = payload.decode(msg.get_content_charset() or "utf-8", errors="ignore")
    return re.sub(r"<[^>]+>", " ", body) if msg.get_content_type() == "text/html" else body


def reply_text(text: str, limit: int = 2000) -> str:
    """The new part of a reply: quoted history ("> ..." and "On ... wrote:") dropped."""
    out = []
    for line in (text or "").splitlines():
        s = line.strip()
        if s.startswith(">"):
            continue
        if re.match(r"^(On .+wrote:|-----\s*Original Message|From:\s.+|Sent from my )", s):
            break
        out.append(line)
    return "\n".join(out).strip()[:limit]


def parse_message(raw: bytes, uid: int = 0) -> Incoming:
    """Reads one raw message into what the outreach system needs (pure; tested directly)."""
    msg = email.message_from_bytes(raw)
    name, addr = parseaddr(msg.get("From", ""))
    inc = Incoming(uid=uid, from_addr=(addr or "").lower(), from_name=name or "")
    inc.to_addrs = [a.lower() for _, a in getaddresses(msg.get_all("To", []) + msg.get_all("Cc", [])) if a]
    inc.subject = str(msg.get("Subject", "") or "")
    try:
        inc.subject = str(email.header.make_header(email.header.decode_header(inc.subject)))
    except Exception:
        pass
    inc.message_id = (msg.get("Message-ID") or "").strip()
    inc.in_reply_to = " ".join(_ID.findall(msg.get("In-Reply-To", "") or ""))
    inc.references = _ID.findall(msg.get("References", "") or "")
    inc.warmup_id = (msg.get(WARMUP_HEADER) or "").strip()
    auto = (msg.get("Auto-Submitted") or "").lower()
    inc.auto_submitted = bool(auto and auto != "no") or bool(msg.get("X-Autoreply") or msg.get("X-Autorespond"))
    inc.text = _text_of(msg)

    is_report = msg.get_content_type() == "multipart/report"
    if is_report or _BOUNCE_FROM.search(msg.get("From", "")) and _BOUNCE_SUBJECT.search(inc.subject):
        inc.is_bounce = True
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype == "message/delivery-status":
                for block in part.get_payload() or []:
                    if not isinstance(block, Message):
                        continue
                    rcpt = block.get("Final-Recipient") or block.get("Original-Recipient") or ""
                    if ";" in rcpt:
                        rcpt = rcpt.split(";", 1)[1]
                    rcpt = rcpt.strip().lower()
                    if rcpt and rcpt not in inc.failed_recipients:
                        inc.failed_recipients.append(rcpt)
                    status = (block.get("Status") or "").strip()
                    if status and not inc.bounce_status:
                        inc.bounce_status = status
            elif ctype in ("message/rfc822", "text/rfc822-headers"):
                inner = part.get_payload()
                if isinstance(inner, list) and inner:
                    inner = inner[0]
                if isinstance(inner, Message):
                    inc.bounced_message_id = (inner.get("Message-ID") or "").strip()
                else:
                    m = re.search(r"^Message-ID:\s*(<[^>]+>)", str(inner or ""), re.I | re.M)
                    if m:
                        inc.bounced_message_id = m.group(1)
        if not inc.failed_recipients:
            own = {inc.from_addr}
            inc.failed_recipients = [e.lower() for e in dict.fromkeys(_EMAIL.findall(inc.text)) if e.lower() not in own][:3]
        if not inc.bounce_status:
            m = _STATUS.search(inc.text)
            inc.bounce_status = m.group(1) if m else ("5.0.0" if re.search(r"\b55\d\b", inc.text) else "")
        if not inc.bounced_message_id:
            m = re.search(r"^Message-ID:\s*(<[^>]+>)", inc.text, re.I | re.M)
            if m:
                inc.bounced_message_id = m.group(1)
    return inc


def _fetch_sync(settings: Dict[str, Any], last_uid: int, limit: int) -> Tuple[List[Incoming], int]:
    m = _imap(settings)
    try:
        m.select("INBOX")
        if last_uid > 0:
            typ, data = m.uid("search", None, f"UID {last_uid + 1}:*")
        else:
            since = (datetime.utcnow() - timedelta(days=3)).strftime("%d-%b-%Y")
            typ, data = m.uid("search", None, f"SINCE {since}")
        uids = sorted(int(u) for u in (data[0] or b"").split() if int(u) > last_uid)
        newest = max([last_uid, *uids]) if uids else last_uid
        out: List[Incoming] = []
        for uid in uids[:limit]:
            typ, parts = m.uid("fetch", str(uid), "(BODY.PEEK[])")
            raw = next((p[1] for p in parts or [] if isinstance(p, tuple) and len(p) > 1), None)
            if raw:
                try:
                    out.append(parse_message(raw, uid))
                except Exception as err:
                    logger.debug(f"unreadable message {uid}: {err}")
        if len(uids) > limit:
            newest = uids[limit - 1]
        return out, newest
    finally:
        try:
            m.logout()
        except Exception:
            pass


async def fetch_new(settings: Dict[str, Any], last_uid: int, limit: int = 100) -> Tuple[List[Incoming], int]:
    """New INBOX messages above last_uid (the last 3 days on the first read) and the new high mark.
    Messages are read without marking them as read."""
    try:
        return await asyncio.to_thread(_fetch_sync, settings, int(last_uid or 0), limit)
    except Exception as err:
        raise MailError(f"Could not read the inbox: {str(err)[:200]}")


def _rescue_sync(settings: Dict[str, Any], seen_uids: List[int]) -> int:
    """Warmup emails that landed in spam go back to the inbox; warmup emails are marked read."""
    m = _imap(settings)
    moved = 0
    try:
        for folder in SPAM_FOLDERS:
            try:
                typ, _ = m.select(f'"{folder}"')
            except Exception:
                continue
            if typ != "OK":
                continue
            typ, data = m.uid("search", None, f'HEADER {WARMUP_HEADER} ""')
            uids = (data[0] or b"").split() if typ == "OK" else []
            for uid in uids:
                u = uid.decode()
                typ, _ = m.uid("copy", u, "INBOX")
                if typ == "OK":
                    m.uid("store", u, "+FLAGS", r"(\Deleted)")
                    moved += 1
            if uids:
                m.expunge()
        if seen_uids:
            m.select("INBOX")
            m.uid("store", ",".join(str(u) for u in seen_uids), "+FLAGS", r"(\Seen)")
        return moved
    finally:
        try:
            m.logout()
        except Exception:
            pass


async def rescue_warmup(settings: Dict[str, Any], seen_uids: Optional[List[int]] = None) -> int:
    try:
        return await asyncio.to_thread(_rescue_sync, settings, list(seen_uids or []))
    except Exception as err:
        logger.debug(f"warmup rescue skipped: {err}")
        return 0
