"""Opt-outs from the shared business data: record one, remove the person's details, and keep them out of later imports.

A person can object to us holding their contact details (UK GDPR Article 21). The request is confirmed from the
email address it names, so nobody can opt someone else out. A confirmed opt-out:
  * is kept as an email and/or phone entry (platform_optouts) so no later import puts the details back,
  * puts the email on the platform-wide do-not-email list (every organisation's sends check it),
  * clears the email and phone from the shared company records, and from the copy of the source's row we keep.
Organisations' own saved leads are theirs; the do-not-email and call checks still stop any contact with the person.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import time
import uuid
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.models import AppSetting, BusinessRecord, PlatformOptOut

logger = logging.getLogger("optouts")

TOKEN_TTL_S = 48 * 3600
NOTICE_KEY = "business_data_notice"
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def clean_email(raw: Any) -> str:
    addr = str(raw or "").strip().lower()
    return addr if len(addr) <= 254 and _EMAIL.match(addr) else ""


def phone_key(raw: Any) -> str:
    """The last ten digits, or "" when there are too few to mean a number."""
    digits = re.sub(r"\D", "", str(raw or ""))
    return digits[-10:] if len(digits) >= 7 else ""


# ── Confirmation link: signed, expires, carries the email and phone ─────────
def _secret() -> bytes:
    return hashlib.sha256(("business-opt-out:" + (settings.SECRET_KEY or "")).encode()).digest()


def make_token(email: str, phone: str, now: Optional[float] = None) -> str:
    body = base64.urlsafe_b64encode(json.dumps([email, phone, int(now or time.time())], separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{body}.{hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()[:32]}"


def read_token(token: str, now: Optional[float] = None) -> Optional[Tuple[str, str]]:
    try:
        body, mac = str(token or "").rsplit(".", 1)
        if not hmac.compare_digest(mac, hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()[:32]):
            return None
        email, phone, issued = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if (now or time.time()) - int(issued) > TOKEN_TTL_S:
            return None
        return str(email), str(phone)
    except Exception:
        return None


# ── The list ────────────────────────────────────────────────────────────────
async def record(db: AsyncSession, email: str, phone: str = "", source: str = "opt_out_page") -> PlatformOptOut:
    """Add the person (once) and put their email on the platform-wide do-not-email list. The caller commits, then calls scrub()."""
    from app.services.email_dispatcher import suppress

    email, key = clean_email(email), phone_key(phone)
    conds = ([PlatformOptOut.email == email] if email else []) + ([PlatformOptOut.phone_key == key] if key else [])
    hit = (await db.execute(select(PlatformOptOut).where(or_(*conds)))).scalars().first() if conds else None
    if hit is None:
        hit = PlatformOptOut(id=f"oo_{uuid.uuid4().hex[:12]}", email=email, phone_key=key, source=source)
        db.add(hit)
    else:
        hit.email, hit.phone_key = hit.email or email, hit.phone_key or key
    if email:
        await suppress(db, None, email, "objection", source)
    return hit


async def scrub(db: AsyncSession, email: str = "", phone: str = "") -> int:
    """Clear the email and phone from the shared company records and from the stored copy of each source's row.
    Runs a scan of the table, so it is meant for a background task. Returns how many records changed."""
    email, key = clean_email(email), phone_key(phone)
    if not (email or key):
        return 0
    found: Dict[str, Dict[str, str]] = {}
    if email:
        for rid, e in (await db.execute(select(BusinessRecord.id, BusinessRecord.email).where(text("lower(email) = :e")).params(e=email))).all():
            found.setdefault(rid, {})["email"] = e or email
    if key:
        q = select(BusinessRecord.id, BusinessRecord.phone).where(text("right(regexp_replace(phone, '\\D', '', 'g'), 10) = :k")).params(k=key)
        for rid, p in (await db.execute(q)).all():
            found.setdefault(rid, {})["phone"] = p or ""
    for rid, values in found.items():
        row = await db.get(BusinessRecord, rid)
        if row is None:
            continue
        for col, value in values.items():
            setattr(row, col, "")
            if value:
                row.raw_data = _redact(row.raw_data, value)
                row.shared_research = _redact(row.shared_research, value)
    await db.commit()
    logger.info(f"[optouts] cleared details from {len(found)} shared record(s)")
    return len(found)


def _redact(doc: Any, value: str) -> Any:
    """The document with every occurrence of `value` removed (case-insensitive), or the document unchanged when it has none."""
    if not doc or not value:
        return doc
    raw = json.dumps(doc)
    cleaned = re.sub(re.escape(json.dumps(value)[1:-1]), "", raw, flags=re.IGNORECASE)
    return json.loads(cleaned) if cleaned != raw else doc


async def blocked(db: AsyncSession, emails: Iterable[str], phones: Iterable[str]) -> Tuple[Set[str], Set[str]]:
    """Which of these emails and phone keys are opted out. One query, whatever the number of rows."""
    es = {e for e in (clean_email(x) for x in emails) if e}
    ks = {k for k in (phone_key(x) for x in phones) if k}
    conds = ([PlatformOptOut.email.in_(es)] if es else []) + ([PlatformOptOut.phone_key.in_(ks)] if ks else [])
    if not conds:
        return set(), set()
    rows = (await db.execute(select(PlatformOptOut.email, PlatformOptOut.phone_key).where(or_(*conds)))).all()
    return {e for e, _ in rows if e in es}, {k for _, k in rows if k in ks}


async def strip_blocked(db: AsyncSession, rows: List[Dict[str, Any]]) -> int:
    """Take the email and phone out of any incoming import row that belongs to an opted-out person, in place.
    The row's own raw copy is cleaned too. Returns how many details were removed."""
    emails = [r.get("email") for r in rows if r.get("email")]
    phones = [r.get("phone") for r in rows if r.get("phone")]
    bad_e, bad_k = await blocked(db, emails, phones)
    if not (bad_e or bad_k):
        return 0
    removed = 0
    for r in rows:
        for field, hit in (("email", clean_email(r.get("email")) in bad_e), ("phone", phone_key(r.get("phone")) in bad_k)):
            if r.get(field) and hit:
                value, r[field] = str(r[field]), ""
                if isinstance(r.get("raw"), (dict, list)):
                    r["raw"] = _redact(r["raw"], value)
                removed += 1
    return removed


async def phone_blocked(db: AsyncSession, number: str) -> bool:
    key = phone_key(number)
    return bool(key) and (await db.execute(select(PlatformOptOut.id).where(PlatformOptOut.phone_key == key).limit(1))).first() is not None


# ── What the public notice says ─────────────────────────────────────────────
NOTICE_FIELDS = ("controller", "address", "contact_email", "ico_number", "retention")


async def load_notice(db: AsyncSession) -> Dict[str, str]:
    row = await db.get(AppSetting, NOTICE_KEY)
    data = row.data if row and isinstance(row.data, dict) else {}
    return {k: str(data.get(k) or "").strip()[:500] for k in NOTICE_FIELDS}


async def save_notice(db: AsyncSession, patch: Dict[str, Any]) -> Dict[str, str]:
    row = await db.get(AppSetting, NOTICE_KEY)
    merged = {**(await load_notice(db)), **{k: str(patch.get(k) or "").strip()[:500] for k in NOTICE_FIELDS if k in patch}}
    if row is None:
        db.add(AppSetting(id=NOTICE_KEY, data=merged))
    else:
        row.data = merged
    return merged


def notice_gaps(notice: Dict[str, str]) -> List[str]:
    """What staff still have to fill in before the notice can be relied on."""
    names = {"controller": "who is responsible for the data", "address": "a postal address", "contact_email": "a contact email",
             "ico_number": "the ICO registration number"}
    return [label for key, label in names.items() if not notice.get(key)]
