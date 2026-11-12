"""Phase 0 of the email rules, with the database: the free eligibility check when companies are saved, the one-click quick choice,
consent declarations (recorded, revocable, never waiting on staff) and the 12-month retention flag.

The rules themselves live in send_readiness.py (pure). Nothing here ever blocks a person or a journey: a contact that may not be
emailed is reached another way by the journey engine.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import and_, func, or_, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import BusinessRecord, ConsentDeclaration, LeadAccount
from app.services import send_readiness as SR

logger = logging.getLogger("eligibility")

GROUP_WORDS = {SR.READY: "Gets email", SR.QUICK: "Needs a quick choice", SR.OTHER: "Reached another way"}


class EligibilityError(ValueError):
    """Something the person can fix, in plain words."""


# ── The free check on save ──────────────────────────────────────────────────
async def _records(db: AsyncSession, accounts: Iterable[LeadAccount]) -> Dict[str, BusinessRecord]:
    ids = {a.business_record_id for a in accounts if a.business_record_id}
    if not ids:
        return {}
    return {b.id: b for b in (await db.execute(select(BusinessRecord).where(BusinessRecord.id.in_(ids)))).scalars().all()}


def _stamp(account: LeadAccount, group: str, reason: str, by: str = "auto") -> None:
    account.eligibility = group
    account.eligibility_note = {"reason": reason, "by": by, "at": datetime.utcnow().isoformat() + "Z"}


async def classify(db: AsyncSession, accounts: List[LeadAccount]) -> Dict[str, int]:
    """Puts each company in its group from its register link. Reads only our own store, so it is instant and free. A choice the
    person made is kept. The caller commits."""
    records = await _records(db, accounts)
    counts = {g: 0 for g in SR.GROUPS}
    for a in accounts:
        group, why = SR.group_of(a, records.get(a.business_record_id))
        note = a.eligibility_note or {}
        if note.get("by") != "user":
            _stamp(a, group, why)
        _verify_from_copy(a, records.get(a.business_record_id))
        counts[group] += 1
    return counts


def _verify_from_copy(account: LeadAccount, biz: Optional[BusinessRecord]) -> None:
    """A company with no check yet, linked to an active register record, reads "Verified" at once instead of "Not checked". Free:
    our own register copy. Any check that already ran (with its web, email and phone findings) is left exactly as it is."""
    if account.verification or biz is None or not (biz.registration_number or "").strip():
        return
    if str(biz.status or "").lower() not in ("active", "registered", "open"):
        return
    account.verification = {"verdict": "verified", "reasons": [f"Company register: {biz.status} (our register copy)"],
                            "checked_at": datetime.utcnow().isoformat() + "Z", "source": "register_copy", "pending_registry": False}


def _like(words: List[str]) -> str:
    return "%" + "%".join(re.sub(r"([%_\\])", r"\\\1", w) for w in words) + "%"


async def candidates(db: AsyncSession, account: LeadAccount, limit: int = 3) -> List[Dict[str, Any]]:
    """Register companies this saved company might be, best first: active ones with a company number whose name is close.
    The same postcode lifts a match. Free: our own store only."""
    from app.services import company_check

    key = company_check.name_key(account.name or "")
    words = [w for w in key.split() if len(w) > 1][:4]
    if not words:
        return []
    rows = []
    base = select(BusinessRecord).where(BusinessRecord.name.ilike(_like(words)), BusinessRecord.registration_number != "")
    # similarity() needs pg_trgm; where it is missing, take the same rows unordered and let name_score rank them below.
    for q in (base.order_by(func.similarity(BusinessRecord.name, account.name or "").desc()).limit(40), base.limit(40)):
        try:
            async with db.begin_nested():
                if db.get_bind().dialect.name == "postgresql":
                    await db.execute(text("SET LOCAL statement_timeout = '3s'"))
                rows = (await db.execute(q)).scalars().all()
            break
        except Exception as err:
            logger.warning("candidate lookup for %r failed: %s", account.name, err)
    pc = (account.postcode or "").upper().replace(" ", "")
    scored = []
    for b in rows:
        status = str(b.status or "").lower()
        if status and status not in ("active", "registered", "open"):
            continue
        score = company_check.name_score(account.name, b.name) + (0.2 if pc and (b.postcode or "").upper().replace(" ", "") == pc else 0)
        if score >= 0.6:
            scored.append((score, b))
    scored.sort(key=lambda x: -x[0])
    return [{"id": b.id, "name": b.name, "number": b.registration_number or "", "postcode": b.postcode or "", "category": b.company_category or "",
             "place": b.region or ""} for _, b in scored[:limit]]


async def choose(db: AsyncSession, account: LeadAccount, *, business_record_id: str = "", sole_trader: bool = False) -> Dict[str, Any]:
    """The quick choice: "Is this X Ltd?" links the register record and the group follows from it; "It's a sole trader" moves it to
    reach another way. The caller commits."""
    if sole_trader:
        _stamp(account, SR.OTHER, "You said it's a sole trader", by="user")
        return out(account)
    biz = await db.get(BusinessRecord, business_record_id) if business_record_id else None
    if biz is None:
        raise EligibilityError("That company isn't in the register copy any more. Pick another, or say it's a sole trader.")
    account.business_record_id = biz.id
    if not account.registration_number and biz.registration_number:
        account.registration_number = biz.registration_number
    account.eligibility_note = None
    group, why = SR.group_of(account, biz)
    _stamp(account, group, f"You picked {biz.name}. {why}", by="user")
    return out(account)


def out(account: LeadAccount, biz: Optional[Any] = None) -> Dict[str, Any]:
    d = SR.eligibility(account, biz)
    return {"lead_id": account.id, "name": account.name, "group": d["group"], "email": d["email"], "ok": d["ok"], "code": d["code"],
            "reason": d["reason"], "label": GROUP_WORDS.get(d["group"], ""), "consent": account.consent_basis or ""}


# ── Consent declarations ────────────────────────────────────────────────────
QUESTION = "How did these contacts agree to hear from you?"
BASES = {"opted_in": "They opted in to hear from us", "existing_customer": "They are existing customers", "enquiry": "They made an enquiry",
         "not_sure": "Not sure"}
CONFIRM = "I confirm these contacts agreed to hear from us in this way, and I can show proof if asked."
WORDING_VERSION = "2026-11-11"
PROOF_DIR = "data/consent_proof"
PROOF_TYPES = {"application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "text/csv": "csv", "text/plain": "txt", "message/rfc822": "eml",
               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
               "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx"}
MAX_PROOF_BYTES = 10 * 1024 * 1024


def _proof_root():
    from pathlib import Path

    return Path(__file__).resolve().parent.parent.parent / PROOF_DIR


async def store_proof(org_id: str, upload: Any, mime: str) -> str:
    """Keeps the customer's proof file privately (never under the public media folder). Returns the stored file name."""
    ext = PROOF_TYPES.get((mime or "").lower())
    if not ext:
        raise EligibilityError("Use a PDF, picture, CSV, text, email, Excel or Word file.")
    folder = _proof_root() / re.sub(r"[^A-Za-z0-9_-]", "", org_id or "org")
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex[:16]}.{ext}"
    path, size = folder / name, 0
    try:
        with path.open("wb") as f:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_PROOF_BYTES:
                    raise EligibilityError("That file is over 10 MB. Pick a smaller one.")
                f.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    if not size:
        path.unlink(missing_ok=True)
        raise EligibilityError("That file is empty.")
    return name


PROOF_MIME = {ext: mime for mime, ext in PROOF_TYPES.items()}


def proof_mime(name: str) -> str:
    return PROOF_MIME.get(str(name or "").rsplit(".", 1)[-1].lower(), "application/octet-stream")


def proof_path(org_id: str, name: str):
    safe = re.fullmatch(r"[a-f0-9]{16}\.[a-z]{3,4}", name or "")
    if not safe:
        return None
    p = _proof_root() / re.sub(r"[^A-Za-z0-9_-]", "", org_id or "org") / name
    return p if p.exists() else None


def _agreed_on(raw: Any) -> str:
    s = str(raw or "").strip()[:10]
    try:
        d = date.fromisoformat(s)
    except ValueError:
        raise EligibilityError("Give the date they agreed, like 2026-03-31.")
    if d > date.today():
        raise EligibilityError("The date they agreed can't be in the future.")
    return d.isoformat()


def decl_out(d: ConsentDeclaration) -> Dict[str, Any]:
    return {"id": d.id, "basis": d.basis, "basis_text": BASES.get(d.basis, d.basis), "source": d.source or "", "agreed_on": d.agreed_on or "",
            "scope": d.scope, "list_id": d.list_id or "", "count": d.count or 0, "wording": d.wording or "", "wording_version": d.wording_version or "",
            "proof_name": d.proof_name or "", "has_proof_file": bool(d.proof_file), "proof_ref": d.proof_ref or "",
            "declared_by": d.declared_by_name or d.declared_by or "", "declared_at": d.declared_at.isoformat() + "Z" if d.declared_at else None,
            "revoked_at": d.revoked_at.isoformat() + "Z" if d.revoked_at else None, "revoke_reason": d.revoke_reason or "",
            "org_id": getattr(d, "org_id", "") or ""}


async def _lead_ids(db: AsyncSession, lead_ids: Optional[List[str]], list_id: str) -> List[str]:
    if list_id:
        from app.api import lead_lists as LL

        lst = next((l for l in await LL._load(db) if l["id"] == list_id), None)
        if not lst:
            raise EligibilityError("That list isn't there any more.")
        lead_ids = list(lst.get("ids") or [])
    ids = list(dict.fromkeys(str(i) for i in (lead_ids or []) if i))[:5000]
    if not ids:
        raise EligibilityError("Choose the contacts this is about.")
    return ids


async def declare(db: AsyncSession, *, basis: str, source: str = "", agreed_on: str = "", lead_ids: Optional[List[str]] = None, list_id: str = "",
                  scope: str = "import", confirmed: bool = False, proof_file: str = "", proof_name: str = "", proof_ref: str = "",
                  operator_id: str = "", operator_name: str = "") -> Dict[str, Any]:
    """Records the customer's answer for a set of contacts, word for word, with who said it and when. For opted in, existing customers
    or an enquiry, those contacts may be emailed even if they are sole traders. "Not sure" is logged too and records no consent.
    The caller commits."""
    if basis not in BASES:
        raise EligibilityError("Pick how they agreed to hear from you.")
    if scope not in ("import", "list", "account"):
        scope = "import"
    ids = await _lead_ids(db, lead_ids, list_id)
    rows = (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(ids)))).scalars().all()
    if not rows:
        raise EligibilityError("None of those contacts are saved any more.")
    source = str(source or "").strip()[:500]
    day = ""
    if basis != "not_sure":
        if not confirmed:
            raise EligibilityError("Tick the box to confirm this is true.")
        if not source:
            raise EligibilityError("Say where they agreed, for example the sign-up form on your website.")
        day = _agreed_on(agreed_on)
    words = f"{QUESTION} Answer: {BASES[basis]}."
    if basis != "not_sure":
        words += f" Where: {source}. When: {day}. {CONFIRM}"
    decl = ConsentDeclaration(id=f"cd_{uuid.uuid4().hex[:14]}", basis=basis, source=source, agreed_on=day, scope=scope, list_id=list_id or "",
                              lead_ids=[r.id for r in rows], count=len(rows), wording=words, wording_version=WORDING_VERSION,
                              proof_file=str(proof_file or "")[:80], proof_name=str(proof_name or "")[:200], proof_ref=str(proof_ref or "").strip()[:500],
                              declared_by=operator_id or "", declared_by_name=operator_name or "", declared_at=datetime.utcnow())
    db.add(decl)
    if basis != "not_sure":
        at = datetime.fromisoformat(day)
        for r in rows:
            r.consent_basis, r.consent_at, r.consent_id = basis, at, decl.id
    await db.flush()
    return decl_out(decl)


async def revoke(db: AsyncSession, decl: ConsentDeclaration, *, by: str = "", reason: str = "") -> Dict[str, Any]:
    """Withdraws a declaration: the contacts it covered lose that consent (one that came from a later declaration is kept). The caller commits."""
    if decl.revoked_at is None:
        decl.revoked_at, decl.revoked_by, decl.revoke_reason = datetime.utcnow(), by or "", str(reason or "").strip()[:500]
        for r in (await db.execute(select(LeadAccount).where(LeadAccount.consent_id == decl.id))).scalars().all():
            r.consent_basis, r.consent_at, r.consent_id = "", None, ""
    return decl_out(decl)


async def declarations(db: AsyncSession, limit: int = 100) -> List[Dict[str, Any]]:
    rows = (await db.execute(select(ConsentDeclaration).order_by(ConsentDeclaration.declared_at.desc()).limit(max(1, min(limit, 500))))).scalars().all()
    return [decl_out(d) for d in rows]


# ── Retention ───────────────────────────────────────────────────────────────
RETENTION_DAYS = 365


def last_touch():
    """The latest real contact with each saved company, as a SQL expression on LeadAccount. The stamped columns alone are not
    enough: journey emails and some calls never write last_contact_at, so the email log, the call log and the timeline are read
    too. Postgres GREATEST skips NULLs, so this is NULL only when nothing was ever sent, called or replied."""
    from app.models.models import CallLog, ContactEvent, EmailEnrollment, EmailMessage, LiveCall

    acc = LeadAccount
    sent_or_replied = func.greatest(EmailMessage.sent_at, EmailMessage.replied_at)
    by_enrolment = (select(func.max(sent_or_replied)).select_from(EmailMessage)
                    .join(EmailEnrollment, EmailEnrollment.id == EmailMessage.enrollment_id)
                    .where(EmailEnrollment.lead_id == acc.id, EmailMessage.is_warmup.is_(False))
                    .correlate(acc).scalar_subquery())
    # Older campaigns linked people by address only.
    by_address = (select(func.max(sent_or_replied)).where(acc.email != "", EmailMessage.recipient_email == acc.email,
                                                          EmailMessage.is_warmup.is_(False))
                  .correlate(acc).scalar_subquery())
    calls = select(func.max(LiveCall.created_at)).where(LiveCall.lead_id == acc.id).correlate(acc).scalar_subquery()
    logged = select(func.max(CallLog.created_at)).where(CallLog.lead_id == acc.id).correlate(acc).scalar_subquery()
    events = (select(func.max(ContactEvent.at)).where(ContactEvent.lead_id == acc.id, ContactEvent.kind.in_(("email", "call", "meeting")))
              .correlate(acc).scalar_subquery())
    return func.greatest(acc.last_contact_at, acc.last_called_at, by_enrolment, by_address, calls, logged, events)


def _due(cutoff: datetime):
    last = last_touch()
    return or_(and_(last.isnot(None), last < cutoff), and_(last.is_(None), LeadAccount.created_at < cutoff))


async def retention_sweep(db: AsyncSession, now: Optional[datetime] = None) -> Dict[str, int]:
    """Flags companies 12 months after the last contact, or 12 months after they were added when never contacted; clears the flag
    from any that were contacted again. Nothing is deleted. The caller commits."""
    now = now or datetime.utcnow()
    cutoff = now - timedelta(days=RETENTION_DAYS)
    async with db.begin_nested():
        if db.get_bind().dialect.name == "postgresql":
            await db.execute(text("SET LOCAL statement_timeout = '60s'"))
        flagged = (await db.execute(update(LeadAccount).where(_due(cutoff), LeadAccount.retention_flagged_at.is_(None))
                                    .values(retention_flagged_at=now).execution_options(synchronize_session=False))).rowcount or 0
        cleared = (await db.execute(update(LeadAccount).where(LeadAccount.retention_flagged_at.isnot(None), ~_due(cutoff))
                                    .values(retention_flagged_at=None).execution_options(synchronize_session=False))).rowcount or 0
    return {"flagged": flagged, "cleared": cleared}


async def last_touches(db: AsyncSession, ids: List[str]) -> Dict[str, Optional[datetime]]:
    if not ids:
        return {}
    rows = (await db.execute(select(LeadAccount.id, last_touch()).where(LeadAccount.id.in_(ids)))).all()
    return {r[0]: r[1] for r in rows}


def retention_reason(a: LeadAccount, last: Optional[datetime] = None) -> str:
    last = last or max([d for d in (a.last_contact_at, a.last_called_at) if d], default=None)
    if last:
        return f"Last contacted {last:%d %B %Y}, over 12 months ago"
    return f"Added {a.created_at:%d %B %Y} and never contacted" if a.created_at else "Never contacted"


async def retention_delete(db: AsyncSession, ids: Optional[List[str]] = None, now: Optional[datetime] = None) -> Dict[str, int]:
    """Deletes flagged companies (all of them, or the ones given). Anyone on the do-not-email list stays on it: those rows are
    never touched, so a deleted contact is still never written to again. The caller commits."""
    from app.services import company_check_job
    from app.services import journeys as J

    locked_ids = await company_check_job.locked_ids()
    cutoff = (now or datetime.utcnow()) - timedelta(days=RETENTION_DAYS)
    # The flag is set nightly; a company contacted since then is still due-checked here so it is never deleted.
    q = select(LeadAccount).where(LeadAccount.retention_flagged_at.isnot(None), _due(cutoff))
    if ids:
        q = q.where(LeadAccount.id.in_(ids[:2000]))
    deleted = locked = 0
    for row in (await db.execute(q.limit(2000))).scalars().all():
        if row.id in locked_ids:  # being checked right now: left flagged for the next delete
            locked += 1
            continue
        await J.exit_for_lead(db, row, "", "deleted")
        await db.delete(row)
        deleted += 1
    return {"deleted": deleted, "locked": locked}


_swept: Dict[str, str] = {}


async def nightly(db: AsyncSession, org_id: str, now: Optional[datetime] = None) -> Optional[Dict[str, int]]:
    """Runs the retention sweep once a day per organisation (called from the connections job every minute)."""
    now = now or datetime.utcnow()
    day = now.date().isoformat()
    if _swept.get(org_id) == day:
        return None
    _swept[org_id] = day
    try:
        return await retention_sweep(db, now)
    except Exception as err:
        logger.warning("retention sweep failed for %s: %s", org_id, err)
        return None
