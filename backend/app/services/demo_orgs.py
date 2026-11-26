"""Demo organisations for sales (plan 12, B7): a real company made by staff, with an end date, joined through an invite link. They replace the
FSB logins the code used to make with passwords in the source.

create() makes the company exactly as sign-up does (signup._create_org: the company, its admin, its profile, no credits), links a brand
when one is picked, can switch the Standard B2B exclusions on, and gives credits only when staff ask for them (credit_awards). The admin
gets no password: an invite link (the reset-password link, valid INVITE_DAYS) lets them choose one. The link is shown to staff once and can
be e-mailed.

end_expired() suspends a demo the day after it ends (the auth middleware then signs everyone in it out); staff can extend it first. What
staff set is kept in the app setting DEMO_KEY: {org_id: {name, brandId, endsOn, adminEmail, createdBy, createdAt, endedAt}}.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select, text

logger = logging.getLogger("demo_orgs")

DEMO_KEY = "demo_orgs"
INVITE_DAYS = 7
MAX_DAYS = 90
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DemoProblem(ValueError):
    pass


async def _doc(db) -> Dict[str, Any]:
    from app.services.credits import _get_doc

    return await _get_doc(db, DEMO_KEY)


async def _save(db, doc: Dict[str, Any]) -> None:
    from app.services.credits import _put_doc

    await _put_doc(db, DEMO_KEY, doc)


def invite_link(op) -> str:
    """A one-time link for the demo's admin to choose a password (the reset link, valid INVITE_DAYS)."""
    from app.api.signup import _base_url, _pw_fingerprint, _sign

    token = _sign({"typ": "pw_reset", "sub": op.id, "fp": _pw_fingerprint(op)}, INVITE_DAYS * 86400)
    return f"{_base_url()}/reset-password?t={token}"


async def _email_invite(op, company: str, link: str) -> bool:
    from app.core.mailer import configured, render, send_account_email

    if not configured() or not op.email:
        return False
    subject = f"Your {company} demo of Outreach by Aivhub"
    msg = render(subject, [f"Hi {op.name or ''},", f"Your demo workspace for {company} is ready.",
                           f"Choose your password with the button below. The link works once, for {INVITE_DAYS} days."],
                 {"label": "Choose your password", "url": link})
    res = await send_account_email(op.email, subject, msg["html"], msg["text"])
    return bool(res.get("ok"))


SAMPLE_SIZE = 25
SAMPLE_LIST = "Sample: accountants and bookkeepers"


async def add_sample(org_id: str, owner: str) -> int:
    """A first saved list for a demo: up to SAMPLE_SIZE companies from the shared register, found by the demo company's own search
    (so its brand's rules and areas apply) and saved the way Find Leads saves them. How many were saved; 0 when none matched.
    Never raises: a demo without its sample is still a demo."""
    from app.api.lead_accounts import AccountIn, AccountsIn, save_accounts
    from app.api.signup import SAMPLE_SEARCH
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.services import business_records as BR

    try:
        with org_scope(org_id):
            async with AsyncSessionLocal() as s:
                found = await BR.search_filtered(s, dict(SAMPLE_SEARCH), limit=SAMPLE_SIZE, stats=False)
                rows = found.get("rows") or []  # register records; saving them fills each company from its record, as Find Leads does
                if not rows:
                    return 0
                accounts = [AccountIn(name=r.name or "", business_record_id=r.id, source="scout", registration_number=r.registration_number or "",
                                      postcode=r.postcode or "", industry=r.industry or "", region=r.region or "")
                            for r in rows if getattr(r, "id", None)]
                out = await save_accounts(s, AccountsIn(accounts=accounts, list_name=SAMPLE_LIST), owner)
                await s.commit()
                return int(out.get("added") or 0)
    except Exception as err:
        logger.warning(f"[demo] sample list not made for {org_id}: {err}")
        return 0


async def create(db, *, company: str, admin_name: str, admin_email: str, days: int, brand_id: str = "", standard_rules: bool = False,
                 email_invite: bool = False, staff: str = "staff", sample_data: bool = False) -> Dict[str, Any]:
    from app.api.signup import _create_org, _email_taken
    from app.models.models import Brand, Organization
    from app.services import tenant_policy as TP

    company, admin_name, admin_email = (company or "").strip()[:120], (admin_name or "").strip()[:120], (admin_email or "").strip().lower()
    if not company or not admin_name:
        raise DemoProblem("Give the company and its admin a name.")
    if not _EMAIL.match(admin_email):
        raise DemoProblem("Give the admin's e-mail address.")
    if await _email_taken(db, admin_email):
        raise DemoProblem("That e-mail address already has an account.")
    try:
        days = int(days)
    except (TypeError, ValueError):
        raise DemoProblem("Say how many days the demo runs.")
    if not 1 <= days <= MAX_DAYS:
        raise DemoProblem(f"A demo runs for 1 to {MAX_DAYS} days.")
    brand = None
    if brand_id:
        brand = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalars().first()
        if brand is None:
            raise DemoProblem("That brand doesn't exist.")
    op = await _create_org(db, company, admin_name, admin_email, None, "active")
    org = (await db.execute(select(Organization).where(Organization.id == op.org_id))).scalars().first()
    if brand is not None:
        org.brand_id = brand.id
    if standard_rules:
        org.policy = TP.clean_policy({"exclusions": {"sets": ["standard_b2b"], "locked": False}})  # a starting filter, as a new company would choose
    ends = (date.today() + timedelta(days=days)).isoformat()
    doc = await _doc(db)
    doc[op.org_id] = {"name": company, "brandId": brand.id if brand else "", "endsOn": ends, "adminEmail": admin_email,
                      "createdBy": staff, "createdAt": datetime.utcnow().isoformat(timespec="seconds"), "endedAt": None}
    await _save(db, doc)
    await db.commit()
    TP.invalidate(op.org_id)
    sample = await add_sample(op.org_id, admin_name) if sample_data else 0
    link = invite_link(op)
    emailed = await _email_invite(op, company, link) if email_invite else False
    return {"orgId": op.org_id, "endsOn": ends, "inviteLink": link, "emailed": emailed, "inviteDays": INVITE_DAYS,
            "sampleSaved": sample, "sampleList": SAMPLE_LIST if sample else ""}


async def listing(db) -> List[Dict[str, Any]]:
    from app.models.models import Organization

    doc = await _doc(db)
    if not doc:
        return []
    orgs = {o.id: o for o in (await db.execute(select(Organization).where(Organization.id.in_(list(doc))))).scalars().all()}
    today = date.today()
    out = []
    for org_id, d in doc.items():
        o = orgs.get(org_id)
        if o is None:
            continue  # deleted by staff
        left = (date.fromisoformat(d["endsOn"]) - today).days
        out.append({"orgId": org_id, "name": o.name, "status": o.status, "brandId": d.get("brandId") or "", "endsOn": d["endsOn"], "daysLeft": left,
                    "adminEmail": d.get("adminEmail") or "", "createdBy": d.get("createdBy") or "", "createdAt": d.get("createdAt"),
                    "endedAt": d.get("endedAt")})
    return sorted(out, key=lambda r: r["endsOn"])


async def extend(db, org_id: str, days: int) -> Dict[str, Any]:
    """Moves the end date to `days` from today, and brings a demo that had ended back."""
    from app.models.models import Organization

    doc = await _doc(db)
    if org_id not in doc:
        raise DemoProblem("That isn't a demo organisation.")
    if not 1 <= int(days) <= MAX_DAYS:
        raise DemoProblem(f"A demo runs for 1 to {MAX_DAYS} days.")
    doc[org_id]["endsOn"] = (date.today() + timedelta(days=int(days))).isoformat()
    if doc[org_id].get("endedAt"):
        o = (await db.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
        if o is not None and o.status == "suspended":
            o.status = "active"
        doc[org_id]["endedAt"] = None
    await _save(db, {**doc})
    await db.commit()
    return doc[org_id]


async def new_invite(db, org_id: str) -> Dict[str, Any]:
    """A fresh invite link for the demo's admin (the old one stops working once a password is chosen)."""
    from app.models.models import Operator

    doc = await _doc(db)
    if org_id not in doc:
        raise DemoProblem("That isn't a demo organisation.")
    op = (await db.execute(select(Operator).where(Operator.org_id == org_id, func.lower(Operator.email) == doc[org_id]["adminEmail"]))).scalars().first()
    if op is None:
        raise DemoProblem("The demo's admin isn't there any more.")
    return {"inviteLink": invite_link(op), "inviteDays": INVITE_DAYS}


async def end_expired(today: Optional[date] = None) -> List[str]:
    """Suspends every demo whose end date has passed. Returns the organisations it ended."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    today = today or date.today()
    ended: List[str] = []
    with system_scope():
        async with AsyncSessionLocal() as db:
            doc = await _doc(db)
            for org_id, d in doc.items():
                if d.get("endedAt") or date.fromisoformat(d["endsOn"]) >= today:
                    continue
                await db.execute(text("UPDATE organizations SET status = 'suspended' WHERE id = :o AND status = 'active'"), {"o": org_id})
                d["endedAt"] = datetime.utcnow().isoformat(timespec="seconds")
                ended.append(org_id)
            if ended:
                await _save(db, {**doc})
                await db.commit()
    for org_id in ended:
        logger.info(f"[demo_orgs] demo {org_id} ended")
    return ended
