"""Credits given by OutReach staff from the owner portal, with several confirmations.

1. preview: the staff admin picks the wallet, the amount, how it was paid for and a reason
   (a payment reference too when it was paid). Nothing changes yet; they get a summary
   ("<staff> is giving N <wallet> credits to <company>, balance before → after").
2. approve: they approve the summary and retype the amount (or their password).
3. The credits are added, a permanent record is written (credit_awards: the database refuses to
   change or delete it), and everyone concerned is emailed: the software owner
   (STAFF_ADMIN_EMAIL), every staff admin, the staff member who did it, and the company's admins.

Finance labels (credit_awards.label and the credit batch's source):
- given: no payment. Never counted as revenue.
- offline: paid outside Stripe (bank transfer, cash, invoice), with its reference and amount.
- paid: paid some other way we can point to (e.g. a Stripe payment link), with its reference and amount.
"""
from __future__ import annotations

import asyncio
import html
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Set

from sqlalchemy import text
from sqlalchemy.future import select

logger = logging.getLogger("credit_awards")

LABELS = {"given": "Given (no payment)", "offline": "Offline payment", "paid": "Paid"}
PENDING_KEY = "credit_awards_pending"
PENDING_TTL = timedelta(minutes=10)
MAX_TRIES = 3
MAX_AMOUNT = 10_000_000
MIN_REASON = 5
_tasks: Set[asyncio.Task] = set()  # emails being sent


class AwardError(ValueError):
    pass


def _clean(body: Dict[str, Any]) -> Dict[str, Any]:
    from app.services.credits import WALLETS

    wallet = str(body.get("wallet") or "")
    label = str(body.get("label") or "")
    reason = " ".join(str(body.get("reason") or "").split())[:500]
    ref = " ".join(str(body.get("paymentRef") or "").split())[:120]
    currency = str(body.get("currency") or "").strip().lower()[:3]
    try:
        amount = int(body.get("amount") or 0)
        paid_cents = int(body.get("paidCents") or 0)
        days = int(body.get("expiresInDays") or 0)
    except (TypeError, ValueError):
        raise AwardError("Amounts must be whole numbers.")
    if wallet not in WALLETS:
        raise AwardError("Pick a wallet.")
    if amount <= 0 or amount > MAX_AMOUNT:
        raise AwardError("Enter how many credits to give (above zero).")
    if label not in LABELS:
        raise AwardError("Pick how it was paid for: given (no payment), offline payment or paid.")
    if len(reason) < MIN_REASON:
        raise AwardError("Enter a reason.")
    if label == "given":
        ref, paid_cents, currency = "", 0, ""
    else:
        if not ref:
            raise AwardError("Enter the payment reference.")
        if paid_cents <= 0 or len(currency) != 3:
            raise AwardError("Enter what was paid and its currency.")
    if days < 0:
        raise AwardError("Expiry must be zero (never) or more days.")
    return {"wallet": wallet, "amount": amount, "label": label, "reason": reason, "paymentRef": ref,
            "paidCents": paid_cents, "currency": currency, "expiresInDays": days}


async def _pending(db) -> Dict[str, Any]:
    from app.services.credits import _get_doc

    doc = await _get_doc(db, PENDING_KEY)
    now = datetime.utcnow()
    return {k: v for k, v in doc.items() if isinstance(v, dict) and datetime.fromisoformat(v["expires"]) > now}


async def _save_pending(db, items: Dict[str, Any]) -> None:
    from app.services.credits import _put_doc

    await _put_doc(db, PENDING_KEY, items)


async def _org_name(db, org_id: str) -> str:
    return (await db.execute(text("SELECT name FROM organizations WHERE id = :i"), {"i": org_id})).scalar() or org_id


async def _balance(org_id: str, wallet: str) -> int:
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.services import credits as K

    with org_scope(org_id):
        async with AsyncSessionLocal() as db:
            return await K.wallet_balance(db, wallet)


def _summary(p: Dict[str, Any]) -> str:
    from app.services.credits import WALLETS

    paid = f", paid {p['paidCents'] / 100:.2f} {p['currency'].upper()} (ref {p['paymentRef']})" if p["label"] != "given" else ""
    return (f"{p['staffName']} is giving {p['amount']:,} {WALLETS[p['wallet']]} credits to {p['orgName']}: "
            f"{LABELS[p['label']]}{paid}. Balance {p['before']:,} → {p['before'] + p['amount']:,}.")


async def preview(db, org_id: str, staff: Dict[str, Any], body: Dict[str, Any]) -> Dict[str, Any]:
    """Step 1: check the request and hold it for approval (10 minutes). Changes no balance.
    db runs with every organisation visible."""
    p = _clean(body)
    before = await _balance(org_id, p["wallet"])
    pid = f"ca_{uuid.uuid4().hex[:14]}"
    p.update({"id": pid, "orgId": org_id, "orgName": await _org_name(db, org_id), "before": before,
              "staffId": staff["staff_id"], "staffEmail": staff.get("email") or "",
              "staffName": staff.get("name") or staff.get("email") or "Staff", "tries": 0,
              "expires": (datetime.utcnow() + PENDING_TTL).isoformat()})
    items = await _pending(db)
    items[pid] = p
    await _save_pending(db, items)
    await db.commit()
    return {**_public(p), "summary": _summary(p)}


def _public(p: Dict[str, Any]) -> Dict[str, Any]:
    return {k: p[k] for k in ("id", "orgId", "orgName", "wallet", "amount", "label", "reason", "paymentRef",
                              "paidCents", "currency", "expiresInDays", "before", "staffName", "expires")} | {
        "after": p["before"] + p["amount"], "labelText": LABELS[p["label"]]}


async def cancel(db, pending_id: str, staff: Dict[str, Any]) -> bool:
    items = await _pending(db)
    p = items.get(pending_id)
    if not p or p["staffId"] != staff["staff_id"]:
        return False
    items.pop(pending_id)
    await _save_pending(db, items)
    await db.commit()
    return True


async def _password_ok(db, staff_id: str, password: str) -> bool:
    from app.core.security import verify_password
    from app.models.models import StaffUser

    s = (await db.execute(select(StaffUser).where(StaffUser.id == staff_id))).scalars().first()
    return bool(s and password and verify_password(password, s.hashed_password)[0])


async def approve(db, pending_id: str, staff: Dict[str, Any], confirm: str) -> Dict[str, Any]:
    """Steps 2-3: the staff member who asked approves it and retypes the amount (or their
    password). Three wrong tries cancel it. Adds the credits, writes the permanent record and
    sends the emails."""
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import CreditAward, Notification
    from app.services import credits as K

    items = await _pending(db)
    p = items.get(pending_id)
    if not p or p["staffId"] != staff["staff_id"]:
        raise AwardError("This request has expired or is not yours. Start again.")
    typed = (confirm or "").strip()
    how = ""
    if typed.replace(",", "").replace(" ", "") == str(p["amount"]):
        how = "amount"
    elif await _password_ok(db, staff["staff_id"], typed):
        how = "password"
    if not how:
        p["tries"] += 1
        if p["tries"] >= MAX_TRIES:
            items.pop(pending_id)
            await _save_pending(db, items)
            await db.commit()
            raise AwardError("That did not match three times, so the request was cancelled. Start again.")
        await _save_pending(db, items)
        await db.commit()
        raise AwardError("That does not match. Retype the number of credits (or your password).")
    items.pop(pending_id)
    await _save_pending(db, items)
    await db.commit()

    expires = datetime.utcnow() + timedelta(days=p["expiresInDays"]) if p["expiresInDays"] else None
    note = f"{LABELS[p['label']]}: {p['reason']}"[:200]
    with org_scope(p["orgId"]):
        async with AsyncSessionLocal() as odb:
            # One transaction: the credits and their permanent record exist together or not at all.
            await K._lock(odb)
            before = await K.wallet_balance(odb, p["wallet"])
            after = await K.add_credits(odb, p["wallet"], p["amount"], source=p["label"], expires_at=expires,
                                        note=note, by=p["staffName"], ref=p["id"], paid_cents=p["paidCents"],
                                        paid_currency=p["currency"])
            odb.add(Notification(id=f"n_{uuid.uuid4().hex[:6]}", type="success",
                                 text=f"OutReach added {p['amount']:,} {K.WALLETS[p['wallet']]} credits. New balance {after:,}."))
            award = CreditAward(id=p["id"], org_id=p["orgId"], org_name=p["orgName"], wallet=p["wallet"],
                                amount=p["amount"], label=p["label"], reason=p["reason"], payment_ref=p["paymentRef"],
                                paid_cents=p["paidCents"], paid_currency=p["currency"], expires_at=expires,
                                balance_before=before, balance_after=after, confirmed_with=how, staff_id=p["staffId"],
                                staff_email=p["staffEmail"], staff_name=p["staffName"], created_at=datetime.utcnow())
            odb.add(award)
            await odb.commit()
            record = row(award)
    if p["wallet"] == "voice":
        from app.services import voice_access

        voice_access.kick(p["orgId"])
    task = asyncio.get_running_loop().create_task(_email_everyone(record))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return record


def row(a) -> Dict[str, Any]:
    from app.services.credits import WALLETS

    return {"id": a.id, "orgId": a.org_id, "orgName": a.org_name, "wallet": a.wallet, "walletName": WALLETS.get(a.wallet, a.wallet),
            "amount": a.amount, "label": a.label, "labelText": LABELS.get(a.label, a.label), "reason": a.reason,
            "paymentRef": a.payment_ref, "paidCents": a.paid_cents, "currency": a.paid_currency,
            "expiresAt": a.expires_at.isoformat() if a.expires_at else None, "before": a.balance_before,
            "after": a.balance_after, "confirmedWith": a.confirmed_with, "staffName": a.staff_name,
            "staffEmail": a.staff_email, "at": a.created_at.isoformat() if a.created_at else None}


async def history(db, org_id: str = "", month: str = "", limit: int = 500) -> List[Dict[str, Any]]:
    from app.models.models import CreditAward

    q = select(CreditAward).order_by(CreditAward.created_at.desc()).limit(limit)
    if org_id:
        q = q.where(CreditAward.org_id == org_id)
    if month:
        from app.services.revenue import month_range

        start, end = month_range(month)
        q = q.where(CreditAward.created_at >= start, CreditAward.created_at < end)
    return [row(a) for a in (await db.execute(q)).scalars().all()]


# ── Emails ──────────────────────────────────────────────────────────────────
async def _staff_emails(actor: str) -> List[str]:
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import StaffUser

    out = [(os.getenv("STAFF_ADMIN_EMAIL") or "").strip(), actor]
    with system_scope():
        async with AsyncSessionLocal() as db:
            out += [s.email for s in (await db.execute(select(StaffUser).where(
                StaffUser.role == "staff_admin", StaffUser.is_active.is_not(False)))).scalars().all()]
    return _unique(out)


async def _company_admins(org_id: str) -> List[str]:
    """Every active admin of the company (always told; not a notification they can switch off)."""
    from app.core.accounts import effective_access, org_of
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import Operator

    out = []
    with org_scope(org_id):
        async with AsyncSessionLocal() as db:
            for op in (await db.execute(select(Operator))).scalars().all():
                if org_of(op) != org_id or op.is_active is False or not (op.email or "").strip():
                    continue
                if (await effective_access(db, op))[0]:
                    out.append(op.email.strip())
    return _unique(out)


def _unique(emails: List[str]) -> List[str]:
    seen, out = set(), []
    for e in emails:
        k = (e or "").strip().lower()
        if "@" in k and k not in seen:
            seen.add(k)
            out.append(e.strip())
    return out


async def _email_everyone(r: Dict[str, Any]) -> None:
    """Runs in the background; never raises: the credits are already given and recorded."""
    try:
        from app.core.mailer import render, send_system_email

        e = html.escape
        paid = f"{r['paidCents'] / 100:.2f} {r['currency'].upper()}, reference {e(r['paymentRef'])}" if r["label"] != "given" else "No payment"
        subject = f"Credits given: {r['amount']:,} {r['walletName']} to {r['orgName']}"
        staff_lines = [
            f"<b>{e(r['staffName'])}</b> ({e(r['staffEmail'])}) gave <b>{r['amount']:,} {e(r['walletName'])}</b> credits "
            f"to <b>{e(r['orgName'])}</b> ({e(r['orgId'])}).",
            f"Finance label: <b>{e(r['labelText'])}</b>. {paid}.",
            f"Reason: {e(r['reason'])}",
            f"Balance {r['before']:,} → {r['after']:,}. Confirmed by retyping the {r['confirmedWith']}.",
            f"Record {e(r['id'])} at {r['at']} UTC. This record cannot be changed or deleted.",
        ]
        msg = render(subject, staff_lines, None)
        for to in await _staff_emails(r["staffEmail"]):
            await send_system_email(to, subject, msg["html"], msg["text"])

        client_subject = f"OutReach added {r['amount']:,} {r['walletName']} credits"
        client_lines = [
            f"OutReach added <b>{r['amount']:,} {e(r['walletName'])}</b> credits to {e(r['orgName'])}.",
            f"New balance: {r['after']:,} (was {r['before']:,}).",
            (f"Payment: {paid}." if r["label"] != "given" else "These credits are free of charge."),
            f"Reference {e(r['id'])}. Questions? Reply to this email.",
        ]
        msg = render(client_subject, client_lines, None)
        for to in await _company_admins(r["orgId"]):
            await send_system_email(to, client_subject, msg["html"], msg["text"])
    except Exception as err:
        logger.warning(f"[credit-awards] emails for {r.get('id')} failed: {err}")
