"""Error codes for AI work: what users see, and what Outreach staff are told.

Users see the code and a plain message (never the provider, its key or its raw error). Staff
see the code with the full detail: an owner-portal banner and an email to STAFF_ADMIN_EMAIL,
for the codes only staff can fix (our key or provider account, a model that is gone, anything
unknown). Failed AI work is never charged.

USR-.. are on the user's side (they can fix it); AI-.. are ours.
"""
from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.future import select

logger = logging.getLogger("ai_errors")

CODES: Dict[str, str] = {
    "USR-01": "Not enough credits. Top up, or write fewer posts at once.",
    "USR-02": "Too many posts in one go. Split the plan into smaller batches.",
    "USR-03": "The AI's safety rules blocked this topic. Change the wording and try again.",
    "USR-04": "The brief is too long. Shorten it and try again.",
    "USR-05": "Your company profile is missing. Fill it in (name and what you do) so the AI can write for you.",
    "USR-06": "Too many AI jobs are running for your company. Wait for one to finish and try again.",
    "AI-01": "The AI service is busy right now. Nothing was charged; try again in a few minutes.",
    "AI-02": "The AI service is unavailable on our side. Nothing was charged; our team has been told.",
    "AI-03": "The AI model is unavailable. Nothing was charged; our team has been told.",
    "AI-04": "The AI took too long to answer. Nothing was charged; try again.",
    "AI-99": "Something went wrong. Nothing was charged; our team has been told.",
    # Staff only (never shown to customers).
    "BILL-01": "Call minutes we charged and Telnyx's billed minutes disagree for a month.",
}
STAFF_CODES = {"AI-02": "urgent", "AI-03": "alert", "AI-99": "alert"}
ALERTS_KEY = "staff_alerts"
MAX_ALERTS = 100
EMAIL_EVERY = timedelta(minutes=30)  # one email per code and company in this time

_RULES = [
    ("USR-03", r"safety|content[ _-]?policy|content_filter|moderation|flagged|refus|not allowed to generate|nsfw"),
    ("USR-04", r"context[ _-]?length|too many tokens|maximum context|prompt is too long|too long"),
    ("AI-04", r"timed? ?out|timeout|no reply within|no image within|deadline"),
    ("AI-02", r"\b401\b|\b403\b|invalid[ _-]?(api[ _-]?)?key|unauthori[sz]ed|authentication|incorrect api key|"
              r"insufficient[ _-]?quota|billing|credit balance|payment required|\b402\b|no key|not available right now"),
    ("AI-03", r"model.{0,40}(not found|does not exist|unavailable|deprecated|decommission|not supported)|unknown model|"
              r"model_not_found"),
    ("AI-01", r"\b429\b|\b5\d\d\b|rate[ _-]?limit|overloaded|busy|unavailable|temporar|connection|try again"),
]


def classify(detail: str) -> str:
    """The code for a provider error's text."""
    text = (detail or "").lower()
    for code, pattern in _RULES:
        if re.search(pattern, text):
            return code
    return "AI-99"


def message(code: str, ref: str = "") -> str:
    """What the user sees: "AI-01: The AI service is busy…" (AI-99 with its reference)."""
    text = f"{code}: {CODES.get(code, CODES['AI-99'])}"
    return f"{text} Reference {ref}." if ref else text


def code_of(text: Optional[str]) -> str:
    m = re.match(r"\s*((?:USR|AI)-\d\d)\b", text or "")
    return m.group(1) if m else ""


def new_ref() -> str:
    return f"ERR-{uuid.uuid4().hex[:8].upper()}"


async def failure(detail: str, what: str = "AI work") -> str:
    """The user's message for a failed AI job. An unknown error gets a reference the user can
    quote, and staff are told with it (provider key and model problems are reported as they
    happen, by provider_failed, even when the backup saves the job)."""
    code = classify(detail)
    ref = new_ref() if code == "AI-99" else ""
    logger.warning(f"[ai-errors] {code} {ref} {what}: {detail}")
    if code == "AI-99":
        await alert_staff(code, f"{what}: {detail}", ref=ref)
    return message(code, ref)


async def provider_failed(kind: str, slot: str, detail: str) -> None:
    """A provider slot failed (platform_ai.note): staff are told when it is a key, account or
    model problem, whether or not the backup then did the work."""
    code = classify(detail)
    if code in ("AI-02", "AI-03"):
        await alert_staff(code, f"{kind} AI ({slot}): {detail}")


# ── Staff alerts ───────────────────────────────────────────────────────────
async def alert_staff(code: str, detail: str, *, ref: str = "", org_id: Optional[str] = None) -> None:
    """Record an alert for the owner portal banner and email STAFF_ADMIN_EMAIL (at most once per
    code and company every EMAIL_EVERY). Own session; never raises."""
    from app.core.tenancy import current_org, system_scope
    from app.database import AsyncSessionLocal
    from app.services.credits import _get_doc, _put_doc

    org = org_id or current_org()
    now = datetime.utcnow()
    send = False
    try:
        with system_scope():
            async with AsyncSessionLocal() as db:
                doc = await _get_doc(db, ALERTS_KEY)
                items: List[Dict[str, Any]] = list(doc.get("items") or [])
                last = (doc.get("emailed") or {}).get(f"{code}:{org}")
                send = not last or datetime.fromisoformat(last) < now - EMAIL_EVERY
                items.insert(0, {"id": uuid.uuid4().hex[:12], "code": code, "level": STAFF_CODES.get(code, "alert"),
                                 "org": org, "detail": str(detail)[:1000], "ref": ref, "at": now.isoformat(timespec="seconds"),
                                 "seen": False})
                doc["items"] = items[:MAX_ALERTS]
                if send:
                    doc.setdefault("emailed", {})[f"{code}:{org}"] = now.isoformat()
                await _put_doc(db, ALERTS_KEY, doc)
                await db.commit()
    except Exception as err:
        logger.warning(f"[ai-errors] could not record a staff alert: {err}")
    if send:
        await _email_staff(code, detail, ref, org)


async def _staff_emails() -> List[str]:
    """Every active staff_admin, plus the bootstrap STAFF_ADMIN_EMAIL if set -- the same owner
    list credit_awards.py emails for spend-limit notices, so a low-balance alert never depends
    on one person's inbox or one env var nobody rotates when staff changes."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import StaffUser

    out = [(os.getenv("STAFF_ADMIN_EMAIL") or "").strip()]
    try:
        with system_scope():
            async with AsyncSessionLocal() as db:
                out += [s.email for s in (await db.execute(select(StaffUser).where(
                    StaffUser.role == "staff_admin", StaffUser.is_active.is_not(False)))).scalars().all()]
    except Exception as err:
        logger.warning(f"[ai-errors] could not list staff admins: {err}")
    seen, uniq = set(), []
    for e in out:
        e = (e or "").strip().lower()
        if e and e not in seen:
            seen.add(e)
            uniq.append(e)
    return uniq


async def _email_staff(code: str, detail: str, ref: str, org: str) -> None:
    recipients = await _staff_emails()
    if not recipients:
        return
    try:
        from app.core.mailer import render, send_system_email

        level = "URGENT: " if STAFF_CODES.get(code) == "urgent" else ""
        subject = f"{level}Outreach {'AI ' if code.startswith('AI') else ''}{code} for {org}"
        lines = [f"<b>{code}</b>: {CODES.get(code, '')}", f"Company: {org}", f"Detail: {detail[:800]}"]
        if ref:
            lines.append(f"Reference: {ref}")
        lines.append("See the owner portal (Platform AI) for the provider's health." if code.startswith("AI")
                     else "See the owner portal (Plans & pricing → Telnyx costs).")
        msg = render(subject, lines, None)
        for to in recipients:
            await send_system_email(to, subject, msg["html"], msg["text"])
    except Exception as err:
        logger.warning(f"[ai-errors] staff email failed: {err}")


async def alerts(db) -> List[Dict[str, Any]]:
    from app.services.credits import _get_doc

    return list((await _get_doc(db, ALERTS_KEY)).get("items") or [])


async def dismiss(db, alert_id: str) -> int:
    """Mark one alert seen ("all": every alert). Returns how many."""
    from app.services.credits import _get_doc, _put_doc

    doc = await _get_doc(db, ALERTS_KEY)
    n = 0
    for a in doc.get("items") or []:
        if not a.get("seen") and (alert_id == "all" or a.get("id") == alert_id):
            a["seen"] = True
            n += 1
    if n:
        await _put_doc(db, ALERTS_KEY, doc)
    return n
