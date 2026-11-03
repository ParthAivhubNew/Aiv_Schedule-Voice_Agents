"""Inbound web forms: what a form may hold, how a public answer is checked and cleaned, and how an
approved answer becomes a company in the leads store.

Anyone on the internet can post to a published form, so nothing here trusts the answer: it is
checked against the published fields, stripped of markup, held as "pending", and only reaches the
leads store (and a list) after the email passes a check or the owner approves it.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from sqlalchemy import func, select

logger = logging.getLogger("inbound_forms")

FIELD_TYPES = ("name", "email", "phone", "text", "dropdown", "checkbox")
MAX_FIELDS = 20
MAX_OPTIONS = 30
MAX_VALUE = 500
MAX_BODY_KEYS = 40
# Where an answer may be stored on the saved company. Anything else is kept in `custom` under the field's own key.
LEAD_COLUMNS = ("contact_name", "email", "phone", "name", "website", "contact_title", "industry", "region", "notes")
DEFAULT_DAILY_LIMIT = 200
HONEYPOT = "hp_url"  # a field real visitors never see; bots fill it

# Free mailbox providers: a company cannot be read from these.
FREE_EMAIL = {
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "hotmail.com", "hotmail.co.uk", "outlook.com",
    "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.co.uk",
    "mail.com", "zoho.com", "yandex.com", "btinternet.com", "sky.com", "talktalk.net", "virginmedia.com",
}
_EMAIL = re.compile(r"^[A-Za-z0-9._%+\-']{1,64}@([A-Za-z0-9\-]+\.)+[A-Za-z]{2,24}$")
_TAGS = re.compile(r"<[^>]*>")
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_KEY = re.compile(r"[^a-z0-9_]+")


def new_key() -> str:
    return secrets.token_urlsafe(18)  # 24 characters of A-Z a-z 0-9 - _


def clean_text(value: Any, limit: int = MAX_VALUE, *, keep_plus: bool = False) -> str:
    """Plain text only: no markup, no control characters, one line, and nothing a spreadsheet would run
    as a formula when the owner exports it."""
    s = _CTRL.sub("", _TAGS.sub("", str(value if value is not None else "")))
    s = re.sub(r"\s+", " ", s).strip()[:limit]
    risky = s[:1] in ("=", "@", "+", "-") and not (keep_plus and re.fullmatch(r"\+?[\d][\d ()\-.]*", s))
    if s and risky:
        s = "'" + s
    return s


def host_of(url: str) -> str:
    try:
        h = (urlparse(url if "://" in url else f"//{url}").hostname or "").lower()
    except ValueError:
        return ""
    return h[4:] if h.startswith("www.") else h


def clean_origin_list(values: Any) -> List[str]:
    out: List[str] = []
    for v in values if isinstance(values, list) else []:
        h = host_of(str(v))
        if h and h not in out and len(out) < 30:
            out.append(h)
    return out


def clean_domain_list(values: Any) -> List[str]:
    out: List[str] = []
    for v in values if isinstance(values, list) else []:
        d = str(v).strip().lower().lstrip("@")
        d = d[4:] if d.startswith("www.") else d
        if re.fullmatch(r"([a-z0-9\-]+\.)+[a-z]{2,24}", d) and d not in out and len(out) < 100:
            out.append(d)
    return out


# ── The fields of a form ─────────────────────────────────────────────────────────────────────
def default_fields() -> List[Dict[str, Any]]:
    return [
        {"id": "name", "type": "name", "label": "Name", "placeholder": "Full name", "required": True, "maps_to": "contact_name", "options": []},
        {"id": "email", "type": "email", "label": "Email", "placeholder": "you@company.com", "required": True, "maps_to": "email", "options": []},
    ]


def _default_map(ftype: str, fid: str) -> str:
    return {"name": "contact_name", "email": "email", "phone": "phone"}.get(ftype, f"custom:{fid}")


def clean_fields(raw: Any) -> List[Dict[str, Any]]:
    """The owner's field list, made safe: known types only, unique ids, one required email, at most MAX_FIELDS."""
    if not isinstance(raw, list):
        raise ValueError("Fields must be a list.")
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for i, f in enumerate(raw[:MAX_FIELDS]):
        if not isinstance(f, dict):
            continue
        ftype = str(f.get("type") or "").lower()
        if ftype not in FIELD_TYPES:
            raise ValueError(f"Field {i + 1} has a type this form cannot use.")
        fid = _KEY.sub("_", str(f.get("id") or ftype).lower()).strip("_")[:30] or ftype
        base, n = fid, 2
        while fid in seen or fid == HONEYPOT:
            fid, n = f"{base}_{n}", n + 1
        seen.add(fid)
        maps = str(f.get("maps_to") or _default_map(ftype, fid))
        if maps.startswith("custom:"):
            maps = "custom:" + (_KEY.sub("_", maps[7:].lower()).strip("_")[:30] or fid)
        elif maps not in LEAD_COLUMNS:
            maps = _default_map(ftype, fid)
        if ftype == "email":
            maps = "email"
        elif maps == "email":  # only the Email field may set the lead's email
            maps = _default_map(ftype, fid)
        opts = [clean_text(o, 80) for o in (f.get("options") or [])[:MAX_OPTIONS] if clean_text(o, 80)] if ftype == "dropdown" else []
        if ftype == "dropdown" and not opts:
            raise ValueError(f"The dropdown \"{clean_text(f.get('label'), 60)}\" needs at least one option.")
        out.append({
            "id": fid, "type": ftype, "label": clean_text(f.get("label"), 80) or ftype.title(),
            "placeholder": clean_text(f.get("placeholder"), 120), "required": bool(f.get("required")) or ftype == "email",
            "maps_to": maps, "options": opts,
        })
    emails = [f for f in out if f["type"] == "email"]
    if len(emails) != 1:
        raise ValueError("A form needs exactly one Email field.")
    return out


def clean_settings(raw: Any) -> Dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    try:
        limit = int(raw.get("daily_limit") or DEFAULT_DAILY_LIMIT)
    except (TypeError, ValueError):
        limit = DEFAULT_DAILY_LIMIT
    return {
        "list_id": clean_text(raw.get("list_id"), 60),
        "list_name": clean_text(raw.get("list_name"), 80) or "Web form leads",
        "allowed_origins": clean_origin_list(raw.get("allowed_origins")),
        "allowed_email_domains": clean_domain_list(raw.get("allowed_email_domains")),
        "block_free_email": bool(raw.get("block_free_email")),
        "daily_limit": max(1, min(limit, 5000)),
        "thanks": clean_text(raw.get("thanks"), 300) or "Thanks, we got your details.",
    }


# ── Checking a public answer ─────────────────────────────────────────────────────────────────
def validate_answer(fields: List[Dict[str, Any]], settings: Dict[str, Any], data: Any) -> Tuple[Dict[str, str], Dict[str, str]]:
    """(clean answers by field id, errors by field id). Unknown keys are an error, not silently kept."""
    if not isinstance(data, dict) or len(data) > MAX_BODY_KEYS:
        return {}, {"_": "That answer could not be read."}
    known = {f["id"] for f in fields} | {HONEYPOT}
    errors: Dict[str, str] = {k: "Not part of this form." for k in data if k not in known}
    clean: Dict[str, str] = {}
    for f in fields:
        raw = data.get(f["id"])
        if f["type"] == "checkbox":
            val = "yes" if raw in (True, "true", "on", "yes", "1", 1) else ""
        else:
            val = clean_text(raw, 254 if f["type"] == "email" else MAX_VALUE, keep_plus=f["type"] == "phone")
        if f["required"] and not val:
            errors[f["id"]] = "Please fill this in."
            continue
        if not val:
            continue
        if f["type"] == "email":
            val = val.lower()
            if not _EMAIL.match(val):
                errors[f["id"]] = "That email address does not look right."
                continue
            domain = val.split("@", 1)[1]
            allow = settings.get("allowed_email_domains") or []
            if settings.get("block_free_email") and domain in FREE_EMAIL:
                errors[f["id"]] = "Please use your work email address."
            elif allow and domain not in allow:
                errors[f["id"]] = "That email domain is not accepted by this form."
        elif f["type"] == "phone" and not re.fullmatch(r"[+\d][\d ()\-.]{5,24}", val):
            errors[f["id"]] = "That phone number does not look right."
        elif f["type"] == "dropdown" and val not in f["options"]:
            errors[f["id"]] = "Choose one of the options."
        clean[f["id"]] = val
    return clean, errors


def email_of(fields: List[Dict[str, Any]], answers: Dict[str, str]) -> str:
    f = next((x for x in fields if x["type"] == "email"), None)
    return answers.get(f["id"], "") if f else ""


def ip_hash(ip: str) -> str:
    """A keyed, daily-rotating hash: enough to count repeats from one address today, useless for tracking a person."""
    day = datetime.utcnow().strftime("%Y-%m-%d")
    secret = (os.getenv("SECRET_KEY") or "dev").encode()
    return hmac.new(secret, f"{day}|{ip}".encode(), hashlib.sha256).hexdigest()[:24]


def frame_ancestors(settings: Dict[str, Any]) -> str:
    allowed = settings.get("allowed_origins") or []
    return "frame-ancestors " + (" ".join(f"https://{h} http://{h}" for h in allowed) if allowed else "*")


# ── From answer to company ───────────────────────────────────────────────────────────────────
def company_name_from(domain: str) -> str:
    stem = domain.split(".")[0] if domain else ""
    return re.sub(r"[-_]+", " ", stem).strip().title()


async def has_mail_server(domain: str) -> bool:
    """Whether the email's domain can receive mail (an MX record, or else an address record). A free check
    that catches typos and made-up domains; it does not prove the mailbox exists."""
    if not domain:
        return False
    import dns.asyncresolver
    import dns.exception

    res = dns.asyncresolver.Resolver()
    res.lifetime = 4.0
    for rtype in ("MX", "A"):
        try:
            if await res.resolve(domain, rtype):
                return True
        except (dns.exception.DNSException, OSError):
            continue
    return False


def lead_fields(fields: List[Dict[str, Any]], answers: Dict[str, str]) -> Dict[str, Any]:
    """The answers laid out as LeadAccount columns, plus `custom` for the form's own questions."""
    cols: Dict[str, Any] = {}
    custom: Dict[str, str] = {}
    for f in fields:
        val = answers.get(f["id"], "")
        if not val:
            continue
        if f["type"] == "checkbox":
            val = f"{f['label']}: yes"
        m = f["maps_to"]
        if m.startswith("custom:"):
            custom[m[7:] or f["id"]] = val
        elif m in cols and m in ("notes",):
            cols[m] = f"{cols[m]}\n{val}"[:2000]
        else:
            cols.setdefault(m, val)
    cols["custom"] = custom or None
    return cols


async def approve(db, sub, form, *, how: str) -> Optional[str]:
    """Turn a pending answer into a saved company (or attach it to the one already saved for this email),
    and put it in the form's list. Returns the lead id. The caller commits."""
    from app.api.lead_accounts import _domain
    from app.api.lead_lists import put_in_list
    from app.models.models import LeadAccount

    fields = form.published_fields or form.fields or []
    cols = lead_fields(fields, sub.payload or {})
    email = (cols.get("email") or sub.email or "").lower()
    existing = (await db.execute(select(LeadAccount).where(func.lower(LeadAccount.email) == email))).scalars().first() if email else None
    if existing:
        lead_id = existing.id
    else:
        edomain = email.split("@", 1)[1] if "@" in email else ""
        site = cols.get("website") or ("" if edomain in FREE_EMAIL else edomain)
        domain = _domain(site) if site else ""
        name = cols.get("name") or company_name_from(domain) or cols.get("contact_name") or email
        row = LeadAccount(
            id=f"acc_{uuid.uuid4().hex[:16]}", name=clean_text(name, 200), domain=domain,
            website=(site if "://" in site or not site else f"https://{site}"),
            phone=cols.get("phone", ""), email=email, contact_name=cols.get("contact_name", ""),
            contact_title=cols.get("contact_title", ""), industry=cols.get("industry", ""), region=cols.get("region", ""),
            notes=cols.get("notes", ""), source="inbound_form", source_url=f"form:{form.id}", custom=cols.get("custom"),
        )
        db.add(row)
        await db.flush()
        lead_id = row.id
    st = form.settings or {}
    try:
        await put_in_list(db, st.get("list_id", ""), st.get("list_name") or "Web form leads", [lead_id])
    except Exception as exc:  # the list was deleted: the lead is still saved
        logger.warning("form %s: could not add to its list: %s", form.id, exc)
    sub.status, sub.reason, sub.lead_id = "approved", how, lead_id
    return lead_id


async def auto_review(org_id: str, submission_id: str) -> None:
    """Background step after a submit: approve the answer when its email's domain can receive mail, else block it."""
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import InboundForm, InboundSubmission

    try:
        with org_scope(org_id):
            async with AsyncSessionLocal() as db:
                sub = await db.get(InboundSubmission, submission_id)
                if not sub or sub.status != "pending":
                    return
                form = await db.get(InboundForm, sub.form_id)
                domain = sub.email.split("@", 1)[1] if "@" in sub.email else ""
                if not form:
                    return
                if await has_mail_server(domain):
                    await approve(db, sub, form, how="auto")
                else:
                    sub.status, sub.reason = "blocked", "The email's domain cannot receive mail."
                await db.commit()
    except Exception:
        logger.exception("form submission %s: review failed", submission_id)


def start_review(org_id: str, submission_id: str) -> None:
    try:
        asyncio.get_running_loop().create_task(auto_review(org_id, submission_id))
    except RuntimeError:
        pass


async def submissions_today(db, form_id: str) -> int:
    from app.models.models import InboundSubmission

    since = datetime.utcnow() - timedelta(hours=24)
    return (await db.execute(select(func.count()).select_from(InboundSubmission).where(
        InboundSubmission.form_id == form_id, InboundSubmission.created_at >= since))).scalar() or 0
