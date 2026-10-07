"""Admin portal API for Aivhub staff (/api/admin-api/...).

Staff sign in with their own accounts (password + mandatory two-factor code). Client tokens are
never accepted here. Requests run with every organisation visible; changes to one client run
inside that client's organisation. staff_support can look; staff_admin can also change things.
"""
from __future__ import annotations

import logging
import os
import re
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Any, Deque, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.future import select

from app.core import staff as S
from app.core.security import decode_token, hash_password, password_problem, verify_password
from app.database import AsyncSessionLocal

router = APIRouter(prefix="/admin-api", tags=["Admin portal"])
logger = logging.getLogger("admin_portal")

_FAILS: Dict[str, Deque[float]] = defaultdict(deque)


def _who(request: Request) -> Dict[str, Any]:
    staff = getattr(request.state, "staff", None) or (request.scope.get("state") or {}).get("staff")
    if not staff:
        raise HTTPException(status_code=401, detail="Staff sign-in required.")
    return staff


def _admin_only(request: Request) -> Dict[str, Any]:
    s = _who(request)
    if s["role"] != "staff_admin":
        raise HTTPException(status_code=403, detail="Only staff admins can change this.")
    return s


def _limited(key: str) -> bool:
    q = _FAILS[key]
    now = time.time()
    while q and now - q[0] > 900:
        q.popleft()
    return len(q) >= 6


# ── Sign-in with two-factor ─────────────────────────────────────────────────
class LoginBody(BaseModel):
    email: str
    password: str
    code: Optional[str] = None


@router.post("/login")
async def login(body: LoginBody, request: Request):
    from app.models.models import StaffUser
    from app.services.secret_box import open_secret, seal_secret

    key = f"{body.email.lower()}|{request.client.host if request.client else '?'}"
    if _limited(key):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in 15 minutes.")
    async with AsyncSessionLocal() as db:
        s = (await db.execute(select(StaffUser).where(func.lower(StaffUser.email) == body.email.strip().lower()))).scalars().first()
        ok = verify_password(body.password or "", s.hashed_password)[0] if s else False
        if not s or not ok or not s.is_active:
            _FAILS[key].append(time.time())
            raise HTTPException(status_code=401, detail="Wrong email or password.")
        if not s.totp_enabled:
            secret = S.new_totp_secret()
            s.totp_secret_sealed = seal_secret(secret)
            await db.commit()
            return {"setup": True, "ticket": S.setup_ticket(s.id), "secret": secret, "otpauth": S.otpauth_uri(secret, s.email)}
        if not body.code:
            return {"codeRequired": True}
        if not S.verify_totp(open_secret(s.totp_secret_sealed), body.code):
            _FAILS[key].append(time.time())
            raise HTTPException(status_code=401, detail="That code is not right. Use the current code from your authenticator app.")
        _FAILS.pop(key, None)
        s.last_login_at = datetime.utcnow()
        await db.commit()
        return {"token": S.staff_token(s.id, s.role), "staff": {"email": s.email, "name": s.name, "role": s.role}}


class ConfirmBody(BaseModel):
    ticket: str
    code: str


@router.post("/2fa/confirm")
async def confirm_2fa(body: ConfirmBody):
    from app.models.models import StaffUser
    from app.services.secret_box import open_secret

    claims = decode_token(body.ticket, "staff_setup")
    if not claims:
        raise HTTPException(status_code=401, detail="Setup expired. Sign in again.")
    key = f"setup|{claims['sub']}"
    if _limited(key):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in 15 minutes.")
    async with AsyncSessionLocal() as db:
        s = (await db.execute(select(StaffUser).where(StaffUser.id == claims["sub"]))).scalars().first()
        if not s or not s.is_active or not S.verify_totp(open_secret(s.totp_secret_sealed), body.code):
            _FAILS[key].append(time.time())
            raise HTTPException(status_code=401, detail="That code is not right. Check the time on your phone and try again.")
        _FAILS.pop(key, None)
        s.totp_enabled = True
        s.last_login_at = datetime.utcnow()
        await db.commit()
        return {"token": S.staff_token(s.id, s.role), "staff": {"email": s.email, "name": s.name, "role": s.role}}


@router.get("/me")
async def me(request: Request):
    return _who(request)


# ── Overview ────────────────────────────────────────────────────────────────
async def _count(db, sql: str, **params) -> int:
    return int((await db.execute(text(sql), params)).scalar() or 0)


@router.get("/dashboard")
async def dashboard(request: Request, include_aivhub: bool = True):
    _who(request)
    since = datetime.utcnow() - timedelta(days=30)
    async with AsyncSessionLocal() as db:
        if include_aivhub:
            return {
                "clients": await _count(db, "SELECT count(*) FROM organizations WHERE coalesce(status, 'active') <> 'platform'"),
                "suspended": await _count(db, "SELECT count(*) FROM organizations WHERE status = 'suspended'"),
                "users": await _count(db, "SELECT count(*) FROM operators WHERE coalesce(is_active, true)"),
                "numbers": await _count(db, "SELECT count(*) FROM org_phone_numbers WHERE status = 'active'"),
                "liveCalls": await _count(db, "SELECT count(*) FROM live_calls WHERE state NOT IN ('ended', 'completed', 'failed')") if await _has(db, "live_calls", "state") else 0,
                "pendingVerifications": await _count(db, "SELECT count(*) FROM verification_submissions WHERE status IN ('pending-approval', 'unapproved')"),
                "whatsappRequests": await _count(db, "SELECT count(*) FROM org_phone_numbers WHERE capabilities::text LIKE '%whatsapp_requested%'"),
                "callsLast30d": await _count(db, "SELECT count(*) FROM call_logs WHERE created_at >= :s", s=since),
                "creditsUsed30d": -await _count(db, "SELECT coalesce(sum(amount), 0) FROM credit_ledger WHERE kind = 'usage' AND created_at >= :s", s=since),
                "payments30d": await _count(db, "SELECT count(*) FROM stripe_events WHERE type IN ('invoice.paid', 'checkout.session.completed') AND created_at >= :s", s=since),
            }
        else:
            return {
                "clients": await _count(db, "SELECT count(*) FROM organizations WHERE coalesce(status, 'active') <> 'platform' AND id <> 'org_default'"),
                "suspended": await _count(db, "SELECT count(*) FROM organizations WHERE status = 'suspended' AND id <> 'org_default'"),
                "users": await _count(db, "SELECT count(*) FROM operators WHERE coalesce(is_active, true) AND org_id <> 'org_default'"),
                "numbers": await _count(db, "SELECT count(*) FROM org_phone_numbers WHERE status = 'active' AND org_id <> 'org_default'"),
                "liveCalls": await _count(db, "SELECT count(*) FROM live_calls WHERE state NOT IN ('ended', 'completed', 'failed') AND org_id <> 'org_default'") if await _has(db, "live_calls", "state") else 0,
                "pendingVerifications": await _count(db, "SELECT count(*) FROM verification_submissions WHERE status IN ('pending-approval', 'unapproved') AND org_id <> 'org_default'"),
                "whatsappRequests": await _count(db, "SELECT count(*) FROM org_phone_numbers WHERE capabilities::text LIKE '%whatsapp_requested%' AND org_id <> 'org_default'"),
                "callsLast30d": await _count(db, "SELECT count(*) FROM call_logs WHERE created_at >= :s AND org_id <> 'org_default'", s=since),
                "creditsUsed30d": -await _count(db, "SELECT coalesce(sum(amount), 0) FROM credit_ledger WHERE kind = 'usage' AND created_at >= :s AND org_id <> 'org_default'", s=since),
                # stripe_events has no org_id column (real Stripe webhooks only); nothing to
                # exclude here, same as the "include Aivhub" branch above.
                "payments30d": await _count(db, "SELECT count(*) FROM stripe_events WHERE type IN ('invoice.paid', 'checkout.session.completed') AND created_at >= :s", s=since),
            }


async def _has(db, table: str, column: str) -> bool:
    return bool((await db.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name = :t AND column_name = :c"), {"t": table, "c": column})).first())


def platform_status() -> Dict[str, Any]:
    from app.api.signup import signup_allowed
    from app.core import mailer
    from app.services import billing
    from app.services.telnyx_provisioning import account_mode, platform_ready

    return {
        "telnyx": platform_ready(), "telnyxMode": account_mode(),
        "telnyxWebhookKey": bool(os.getenv("TELNYX_ASSISTANT_PUBLIC_KEY")),
        "stripe": billing.configured(), "stripeTestMode": billing.test_mode(), "stripeWebhook": bool(billing.webhook_secret()),
        "mail": mailer.configured(), "google": bool(os.getenv("FIREBASE_API_KEY") and os.getenv("FIREBASE_PROJECT_ID")),
        "signup": signup_allowed(),
    }


@router.get("/platform")
async def platform(request: Request):
    _who(request)
    return platform_status()


# ── Clients ─────────────────────────────────────────────────────────────────
async def _in_org(org_id: str, fn):
    from app.core.tenancy import org_scope

    async with AsyncSessionLocal() as db:
        if not (await db.execute(text("SELECT 1 FROM organizations WHERE id = :i AND coalesce(status, 'active') <> 'platform'"), {"i": org_id})).first():
            raise HTTPException(status_code=404, detail="Client not found.")
    with org_scope(org_id):
        async with AsyncSessionLocal() as db:
            return await fn(db)


@router.get("/clients")
async def clients(request: Request, include_aivhub: bool = True, include_archived: bool = False):
    from app.services import credits as K
    from app.services.telnyx_provisioning import latest_verification

    _who(request)
    filter_sql = "coalesce(o.status, 'active') <> 'platform'"
    if not include_aivhub:
        filter_sql += " AND o.id <> 'org_default'"
    if not include_archived:
        filter_sql += " AND coalesce(o.status, 'active') <> 'suspended'"
    async with AsyncSessionLocal() as db:
        orgs = (await db.execute(text(
            f"SELECT o.id, o.name, o.status, o.created_at, "
            f"(SELECT count(*) FROM operators u WHERE u.org_id = o.id) AS users, "
            f"(SELECT count(*) FROM org_phone_numbers n WHERE n.org_id = o.id AND n.status = 'active') AS numbers "
            f"FROM organizations o WHERE {filter_sql} ORDER BY o.created_at DESC NULLS LAST"))).all()
    out = []
    for org_id, name, status, created, users, numbers in orgs:
        async def detail(db):
            ver = await latest_verification(db)
            sub = (await db.execute(text("SELECT status FROM billing_subscriptions WHERE id = :i"), {"i": org_id})).scalar()
            return {"wallets": {w["key"]: w["balance"] for w in await K.wallets(db)},
                    "enforce": (await K.org_settings(db, org_id))["enforce"],
                    "verification": ver.status if ver else None, "subscription": sub or "none"}
        out.append({"id": org_id, "name": name, "status": status or "active", "createdAt": created.isoformat() if created else None,
                    "users": users, "numbers": numbers, **(await _in_org(org_id, detail))})
    return out


@router.get("/clients/{org_id}")
async def client_detail(org_id: str, request: Request):
    from app.models.models import NumberOrder, Operator, OrgPhoneNumber, OrgTelnyx, VerificationSubmission
    from app.services import credits as K

    _who(request)
    async with AsyncSessionLocal() as db:
        org = (await db.execute(text("SELECT id, name, slug, status, created_at FROM organizations WHERE id = :i AND coalesce(status, 'active') <> 'platform'"), {"i": org_id})).first()
    if not org:
        raise HTTPException(status_code=404, detail="Client not found.")

    async def load(db):
        users = (await db.execute(select(Operator).where(Operator.org_id == org_id))).scalars().all()
        numbers = (await db.execute(select(OrgPhoneNumber))).scalars().all()
        orders = (await db.execute(select(NumberOrder).order_by(NumberOrder.created_at.desc()).limit(20))).scalars().all()
        vers = (await db.execute(select(VerificationSubmission).order_by(VerificationSubmission.created_at.desc()).limit(5))).scalars().all()
        tx = (await db.execute(select(OrgTelnyx).where(OrgTelnyx.id == org_id))).scalars().first()
        sub = (await db.execute(text("SELECT status, plans, current_period_end FROM billing_subscriptions WHERE id = :i"), {"i": org_id})).first()
        return {
            "users": [{"id": u.id, "name": u.name, "email": u.email, "username": u.username, "role": u.role,
                       "active": u.is_active is not False, "lastLoginAt": u.last_login_at.isoformat() if u.last_login_at else None} for u in users],
            "numbers": [{"id": n.id, "e164": n.e164, "status": n.status, "capabilities": n.capabilities or [], "provider": n.provider} for n in numbers],
            "orders": [{"phoneNumber": o.phone_number, "status": o.status, "error": o.error, "monthlyCost": o.monthly_cost,
                        "at": o.created_at.isoformat() if o.created_at else None} for o in orders],
            "verifications": [{"id": v.id, "status": v.status, "reason": v.reason, "entityType": v.entity_type,
                               "documents": [d.get("filename") for d in v.documents or []], "groupId": v.requirement_group_id,
                               "at": v.created_at.isoformat() if v.created_at else None} for v in vers],
            "telnyx": {"mode": tx.mode, "status": tx.status, "error": tx.last_error, "billingGroup": tx.billing_group_id,
                       "managedAccount": tx.managed_account_id} if tx else None,
            "subscription": {"status": sub[0], "plans": sub[1] or {}, "renewsAt": sub[2].isoformat() if sub[2] else None} if sub else None,
            "wallets": await K.wallets(db),
            "enforce": (await K.org_settings(db, org_id))["enforce"],
            "history": await K.history(db, 50),
        }

    return {"id": org[0], "name": org[1], "slug": org[2], "status": org[3] or "active",
            "createdAt": org[4].isoformat() if org[4] else None, **(await _in_org(org_id, load))}


class StatusBody(BaseModel):
    status: str


@router.post("/clients/{org_id}/status")
@router.patch("/clients/{org_id}/status")
async def set_status(org_id: str, body: StatusBody, request: Request):
    from app.core.auth_middleware import forget

    _admin_only(request)
    if body.status not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="Status is active or suspended.")
    async with AsyncSessionLocal() as db:
        res = await db.execute(text("UPDATE organizations SET status = :s, updated_at = now() "
                                    "WHERE id = :i AND coalesce(status, 'active') <> 'platform'"), {"s": body.status, "i": org_id})
        await db.commit()
    if not res.rowcount:
        raise HTTPException(status_code=404, detail="Client not found.")
    forget()  # everyone's cached access is re-checked at once
    return {"id": org_id, "status": body.status}


@router.delete("/clients/{org_id}")
async def delete_client(org_id: str, request: Request, confirm_name: str = ""):
    from app.core.auth_middleware import forget, platform_org
    from app.core.tenancy import system_scope

    _admin_only(request)
    if org_id in ("org_default", platform_org(), "default", ""):
        raise HTTPException(status_code=400, detail="Cannot delete the platform organisation.")

    async with AsyncSessionLocal() as db:
        org = (await db.execute(text("SELECT id, name, status FROM organizations WHERE id = :i"), {"i": org_id})).first()
        if not org:
            raise HTTPException(status_code=404, detail="Client not found.")
        if (org[2] or "").lower() == "platform":
            raise HTTPException(status_code=400, detail="Cannot delete the platform organisation.")
        if confirm_name.strip() != (org[1] or "").strip():
            raise HTTPException(status_code=400, detail=f"Please type the organisation's exact name ({org[1]}) to confirm deletion.")

        # Safety rail: reject if active paid Stripe subscription
        sub = (await db.execute(text("SELECT status, stripe_subscription_id FROM billing_subscriptions WHERE id = :i"), {"i": org_id})).first()
        if sub and sub[0] == "active" and sub[1]:
            raise HTTPException(status_code=400, detail="Cannot delete organisation with an active paid Stripe subscription. Cancel the subscription first.")

        # Ordered FK deletion across tenant and child tables
        tables_to_delete = [
            "email_enrollments", "email_sequence_steps", "email_send_logs", "email_messages", "email_campaigns",
            "enrichment_attempts", "prospects", "missions", "contact_registry",
            "call_briefs", "live_calls", "call_logs", "meetings", "meeting_event_types", "calcom_settings",
            "schedule_items", "notifications", "voices",
            "social_post_versions", "social_posts", "social_schedules", "social_gen_jobs", "social_emails",
            "social_oauth_states", "social_accounts", "scheduler_settings", "plan_chat_threads",
            "process_logs", "conversation_variables", "conversation_templates",
            "whatsapp_messages", "whatsapp_threads", "whatsapp_signups",
            "number_orders", "org_phone_numbers", "verification_submissions", "org_telnyx", "voice_assistants",
            "credit_grants", "credit_ledger", "billing_subscriptions", "email_mailboxes",
            "connections", "services", "faqs", "knowledge_chunks", "knowledge_sources", "company_profile",
        ]

        # No per-table try/except here on purpose: this must be all-or-nothing. If any DELETE
        # fails (e.g. an FK ordering mistake), the exception propagates, nothing commits, and the
        # whole operation rolls back cleanly rather than silently leaving some of the org's data
        # behind while reporting success.
        try:
            with system_scope():
                for t in tables_to_delete:
                    await db.execute(text(f"DELETE FROM {t} WHERE org_id = :o"), {"o": org_id})

                # Delete auth sessions and operators
                await db.execute(text("DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM operators WHERE org_id = :o)"), {"o": org_id})
                await db.execute(text("DELETE FROM operators WHERE org_id = :o"), {"o": org_id})
                await db.execute(text("DELETE FROM organizations WHERE id = :o"), {"o": org_id})
            await db.commit()
        except Exception as err:
            await db.rollback()
            logger.error(f"[delete_client] deletion of {org_id} failed and was rolled back: {err}")
            raise HTTPException(status_code=500, detail=f"Deletion failed and was fully rolled back (nothing was deleted): {err}")

    forget()
    return {"ok": True, "id": org_id, "deleted": True}


@router.post("/clients/{org_id}/users/{user_id}/reset-password")
async def reset_user_password(org_id: str, user_id: str, request: Request):
    """A temporary password for one of a client's users (shown once). They must choose a new
    one at their next sign-in, and every device they were signed in on is signed out."""
    from app.core.auth_middleware import forget
    from app.core.security import temporary_password
    from app.models.models import AuthSession, Operator

    _admin_only(request)
    temp = temporary_password()

    async def run(db):
        op = (await db.execute(select(Operator).where(Operator.id == user_id, Operator.org_id == org_id))).scalars().first()
        if not op:
            raise HTTPException(status_code=404, detail="User not found.")
        op.hashed_password = hash_password(temp)
        op.must_change_password = True
        now = datetime.utcnow()
        for ses in (await db.execute(select(AuthSession).where(AuthSession.operator_id == op.id, AuthSession.revoked_at.is_(None)))).scalars().all():
            ses.revoked_at = now
        await db.commit()
        return op.username

    username = await _in_org(org_id, run)
    forget()
    return {"username": username, "temporaryPassword": temp}


# Giving credits takes several confirmations (preview → approve → retype) and leaves a
# permanent record; see app.services.credit_awards. There is no instant add.
class AwardBody(BaseModel):
    wallet: str
    amount: int
    label: str
    reason: str = ""
    paymentRef: str = ""
    paidCents: int = 0
    currency: str = ""
    expiresInDays: int = 0


class ApproveBody(BaseModel):
    confirm: str = ""


@router.post("/clients/{org_id}/credit-awards/preview")
async def preview_award(org_id: str, body: AwardBody, request: Request):
    from app.services import credit_awards as A

    staff = _admin_only(request)
    async with AsyncSessionLocal() as db:
        if not (await db.execute(text("SELECT 1 FROM organizations WHERE id = :i AND coalesce(status, 'active') <> 'platform'"), {"i": org_id})).first():
            raise HTTPException(status_code=404, detail="Client not found.")
        try:
            return await A.preview(db, org_id, staff, body.model_dump())
        except A.AwardError as err:
            raise HTTPException(status_code=400, detail=str(err))


@router.post("/credit-awards/{pending_id}/approve")
async def approve_award(pending_id: str, body: ApproveBody, request: Request):
    from app.services import credit_awards as A

    staff = _admin_only(request)
    async with AsyncSessionLocal() as db:
        try:
            return await A.approve(db, pending_id, staff, body.confirm)
        except A.AwardError as err:
            raise HTTPException(status_code=400, detail=str(err))


@router.post("/credit-awards/{pending_id}/cancel")
async def cancel_award(pending_id: str, request: Request):
    from app.services import credit_awards as A

    staff = _admin_only(request)
    async with AsyncSessionLocal() as db:
        return {"cancelled": await A.cancel(db, pending_id, staff)}


@router.get("/credit-awards")
async def list_awards(request: Request, org_id: str = "", month: str = ""):
    """The permanent record of credits staff gave, newest first (one company, or one month)."""
    import re

    from app.services import credit_awards as A

    _who(request)
    if month and not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="Pick a month like 2026-09.")
    async with AsyncSessionLocal() as db:
        return await A.history(db, org_id, month)


class EnforceBody(BaseModel):
    enforce: bool


@router.put("/clients/{org_id}/enforce")
async def set_enforce(org_id: str, body: EnforceBody, request: Request):
    from app.services import credits as K

    _admin_only(request)

    async def run(db):
        s = await K.set_org_settings(db, {"enforce": body.enforce}, org_id)
        await db.commit()
        return s["enforce"]

    return {"enforce": await _in_org(org_id, run)}


class AttachNumberBody(BaseModel):
    e164: str


@router.get("/telnyx-account-numbers")
async def telnyx_account_numbers(request: Request):
    """List all phone numbers currently present on the main Telnyx account."""
    from app.services.telnyx_client import TelnyxClient, platform_key, refresh_saved_key

    _who(request)
    await refresh_saved_key()
    key = platform_key()
    if not key:
        return {"numbers": []}
    try:
        client = TelnyxClient(key)
        res = await client._req("GET", "/phone_numbers")
        raw = res.get("data") or []
        numbers = []
        for item in raw:
            phone = item.get("phone_number")
            if phone:
                numbers.append({
                    "id": str(item.get("id") or ""),
                    "e164": phone if phone.startswith("+") else f"+{phone}",
                    "status": item.get("status") or "active",
                    "billing_group_id": item.get("billing_group_id") or "",
                })
        return {"numbers": numbers}
    except Exception as err:
        return {"numbers": [], "error": str(err)}


@router.post("/clients/{org_id}/numbers/attach")
async def attach_number(org_id: str, body: AttachNumberBody, request: Request):
    """Give a company a number we already have on our Telnyx account (e.g. Aivhub's own line):
    it appears on its Numbers page, its incoming calls reach that company and, in billing-group
    mode, Telnyx bills it to the company's billing group. The number's call routing is kept."""
    import re
    from app.models.models import OrgPhoneNumber
    from app.services import telnyx_provisioning as TP
    from app.services.numbers import normalize, org_for_numbers
    from app.services.telnyx_client import TelnyxClient, TelnyxError, platform_key, refresh_saved_key

    _admin_only(request)
    e164 = normalize(body.e164 or "")
    if not e164.startswith("+") or len(e164) < 8:
        raise HTTPException(status_code=400, detail="Enter the number with its country code, like +447700900123 or +14302446060.")
    await refresh_saved_key()
    if not platform_key():
        raise HTTPException(status_code=400, detail="Save the Telnyx key in Platform keys first.")
    owner = await org_for_numbers(e164)
    if owner and owner != org_id:
        raise HTTPException(status_code=409, detail=f"{e164} already belongs to another company ({owner}).")
    try:
        found = await TelnyxClient(platform_key()).find_phone_number(e164)
        if not found:
            # Fallback scan in case Telnyx formatting differences
            res = await TelnyxClient(platform_key())._req("GET", "/phone_numbers")
            digits = re.sub(r"\D", "", e164)
            for item in (res.get("data") or []):
                item_digits = re.sub(r"\D", "", item.get("phone_number") or "")
                if item_digits == digits or item.get("phone_number") == e164:
                    found = item
                    item_p = item.get("phone_number") or ""
                    e164 = item_p if item_p.startswith("+") else f"+{item_digits}"
                    break
    except TelnyxError as err:
        raise HTTPException(status_code=502, detail=f"Telnyx: {err}")
    if not found:
        raise HTTPException(status_code=404, detail=f"{e164} was not found on your Telnyx account.")

    async def run(db):
        name = (await db.execute(text("SELECT name FROM organizations WHERE id = :i"), {"i": org_id})).scalar() or ""
        warning = ""
        setup = await TP.ensure_setup(db, name)
        if TP.account_mode() == "billing_group" and setup.billing_group_id and found.get("billing_group_id") != setup.billing_group_id:
            try:
                await TelnyxClient(platform_key()).update_phone_number(str(found.get("id")), billing_group_id=setup.billing_group_id)
            except TelnyxError as err:
                warning = f"Added, but Telnyx did not move it to the company's billing group: {err}"
        if (TP.account_mode() == "billing_group" and setup.messaging_profile_id
                and found.get("messaging_profile_id") != setup.messaging_profile_id):
            try:  # so WhatsApp and its verification text reach us
                await TelnyxClient(platform_key()).set_messaging_profile(str(found.get("id")), setup.messaging_profile_id)
            except TelnyxError as err:
                warning = warning or f"Added, but Telnyx did not link it for messages (WhatsApp): {err}"
        n = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.e164 == e164))).scalars().first()
        if n is None:
            has_default = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.is_default.is_(True)))).scalars().first()
            n = OrgPhoneNumber(id=f"num_{uuid.uuid4().hex[:10]}", e164=e164, label="", provider="telnyx",
                               capabilities=["voice"], is_default=not has_default)
            db.add(n)
        n.provider_ref, n.status = str(found.get("id") or ""), "active"
        await db.commit()
        return {"id": n.id, "e164": e164, "warning": warning}

    return await _in_org(org_id, run)


class WhatsappBody(BaseModel):
    enabled: bool


@router.post("/clients/{org_id}/numbers/{number_id}/whatsapp")
async def set_whatsapp(org_id: str, number_id: str, body: WhatsappBody, request: Request):
    """Switch WhatsApp on for a number once its Meta business signup is complete in Telnyx. Off
    also forgets the signup, so the company has to ask again before it can turn it back on."""
    from app.models.models import OrgPhoneNumber

    _admin_only(request)

    async def run(db):
        n = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.id == number_id))).scalars().first()
        if not n:
            raise HTTPException(status_code=404, detail="Number not found.")
        caps = [c for c in (n.capabilities or []) if c not in ("whatsapp", "whatsapp_requested", "whatsapp_ready")]
        if body.enabled:
            caps += ["whatsapp", "whatsapp_ready"]
        else:
            from app.services.whatsapp_signup import signup_for

            s = await signup_for(db, n.id)
            if s:
                await db.delete(s)
        n.capabilities = caps
        await db.commit()
        return caps

    caps = await _in_org(org_id, run)
    if body.enabled:
        try:
            from app.core.notify import notify
            from app.core.tenancy import org_scope

            with org_scope(org_id):
                await notify("numbers", "WhatsApp is live on your number", ["You can now reply to WhatsApp messages in the Voice plugin."])
        except Exception:
            pass
    return {"capabilities": caps}


@router.get("/verifications")
async def verification_queue(request: Request):
    _who(request)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT v.id, v.org_id, o.name, v.status, v.reason, v.entity_type, v.requirement_group_id, v.created_at, v.updated_at "
            "FROM verification_submissions v LEFT JOIN organizations o ON o.id = v.org_id ORDER BY v.created_at DESC LIMIT 200"))).all()
        wa = (await db.execute(text(
            "SELECT n.id, n.org_id, o.name, n.e164, s.status, s.telnyx_status, s.error, s.created_at "
            "FROM org_phone_numbers n LEFT JOIN organizations o ON o.id = n.org_id "
            "LEFT JOIN whatsapp_signups s ON s.number_id = n.id "
            "WHERE n.capabilities::text LIKE '%whatsapp_requested%'"))).all()
    from app.services.whatsapp_signup import automatic
    return {
        "verifications": [{"id": r[0], "orgId": r[1], "orgName": r[2], "status": r[3], "reason": r[4], "entityType": r[5],
                           "groupId": r[6], "at": r[7].isoformat() if r[7] else None,
                           "waitingHours": round((datetime.utcnow() - r[7]).total_seconds() / 3600) if r[7] else None} for r in rows],
        "whatsappRequests": [{"numberId": r[0], "orgId": r[1], "orgName": r[2], "e164": r[3], "signupStatus": r[4] or "",
                              "telnyxStatus": r[5] or "", "error": r[6] or "",
                              "since": r[7].isoformat() if r[7] else None} for r in wa],
        "whatsappAutomatic": await automatic(),
    }


# ── Plans and rate card ─────────────────────────────────────────────────────
class PlanBody(BaseModel):
    wallet: str
    kind: str = "plan"
    name: str
    description: str = ""
    priceUsdCents: int
    credits: int
    features: list = []
    active: bool = True
    sort: int = 0


def _check_plan(body: PlanBody) -> None:
    from app.services import credits as K

    if body.wallet not in K.WALLETS or body.kind not in ("plan", "topup"):
        raise HTTPException(status_code=400, detail="Pick an app and plan or top-up.")
    if body.priceUsdCents < 50 or body.credits <= 0 or not body.name.strip():
        raise HTTPException(status_code=400, detail="Name, a price of at least $0.50 and credits are required.")


@router.get("/plans")
async def list_plans(request: Request):
    from app.services import billing as B

    _who(request)
    async with AsyncSessionLocal() as db:
        return [B.plan_json(p) for p in await B.plans(db, active_only=False)]


@router.post("/plans")
async def create_plan(body: PlanBody, request: Request):
    from app.models.models import BillingPlan
    from app.services import billing as B

    _admin_only(request)
    _check_plan(body)
    async with AsyncSessionLocal() as db:
        p = BillingPlan(id=f"plan_{uuid.uuid4().hex[:10]}", wallet=body.wallet, kind=body.kind, name=body.name.strip()[:80],
                        description=body.description[:300], price_usd_cents=body.priceUsdCents, credits=body.credits,
                        features=body.features[:12], active=body.active, sort=body.sort)
        db.add(p)
        await db.commit()
        return B.plan_json(p)


@router.put("/plans/{plan_id}")
async def update_plan(plan_id: str, body: PlanBody, request: Request):
    from app.models.models import BillingPlan
    from app.services import billing as B

    _admin_only(request)
    _check_plan(body)
    async with AsyncSessionLocal() as db:
        p = (await db.execute(select(BillingPlan).where(BillingPlan.id == plan_id))).scalars().first()
        if not p:
            raise HTTPException(status_code=404, detail="Plan not found.")
        if (p.price_usd_cents != body.priceUsdCents or p.kind != body.kind) and p.stripe_price_id:
            p.stripe_price_id = ""  # needs a new Stripe price; current subscribers keep theirs
        p.wallet, p.kind, p.name, p.description = body.wallet, body.kind, body.name.strip()[:80], body.description[:300]
        p.price_usd_cents, p.credits, p.features, p.active, p.sort = body.priceUsdCents, body.credits, body.features[:12], body.active, body.sort
        await db.commit()
        return B.plan_json(p)


@router.get("/stripe-prices")
async def stripe_prices(request: Request):
    """Prices made in the Stripe Dashboard that are not on sale here yet. Opening this also
    refreshes the names and descriptions of the ones on sale from Stripe."""
    from app.services import billing as B

    _who(request)
    async with AsyncSessionLocal() as db:
        try:
            prices = await B.unlinked_prices(db)
        except B.StripeError as err:
            raise HTTPException(status_code=502, detail=str(err))
        await db.commit()
        return prices


class StripePriceBody(BaseModel):
    priceId: str = Field(pattern=r"^price_\w+$")
    wallet: str
    credits: int


@router.post("/plans/from-stripe")
async def plan_from_stripe(body: StripePriceBody, request: Request):
    """Put a price that already exists in Stripe on sale: staff say which app it is for and how
    many credits it gives; name, amount, currency and monthly/one-off come from Stripe."""
    from app.models.models import BillingPlan
    from app.services import billing as B
    from app.services import credits as K

    _admin_only(request)
    if body.wallet not in K.WALLETS or body.credits <= 0:
        raise HTTPException(status_code=400, detail="Pick an app and how many credits it gives.")
    async with AsyncSessionLocal() as db:
        if (await db.execute(select(BillingPlan).where(BillingPlan.stripe_price_id == body.priceId))).scalars().first():
            raise HTTPException(status_code=400, detail="That price is already on sale.")
        try:
            p = await B.plan_from_price(body.priceId, body.wallet, body.credits)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
        except B.StripeError as err:
            raise HTTPException(status_code=502, detail=str(err))
        db.add(p)
        await db.commit()
        return B.plan_json(p)


@router.get("/telnyx-costs")
async def telnyx_costs(request: Request, month: str = ""):
    """Per organisation on our Telnyx account: Telnyx's cost for its billing group this month,
    the minutes we billed, what it paid us, and the margin."""
    import re

    from app.services import telnyx_usage
    from app.services.telnyx_client import TelnyxError, platform_key

    _who(request)
    month = month or datetime.utcnow().strftime("%Y-%m")
    if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="Pick a month like 2026-09.")
    if not platform_key():
        raise HTTPException(status_code=503, detail="Telnyx is not connected on the platform yet.")
    try:
        return await telnyx_usage.margin_report(month)
    except TelnyxError as err:
        raise HTTPException(status_code=502, detail=str(err))


@router.get("/voice-reconciliation")
async def voice_reconciliation(request: Request, month: str = ""):
    """The saved monthly check of minutes charged against minutes Telnyx billed (None: not run)."""
    import re

    from app.services import telnyx_usage

    _who(request)
    month = month or telnyx_usage.previous_month()
    if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="Pick a month like 2026-09.")
    async with AsyncSessionLocal() as db:
        return {"month": month, "result": await telnyx_usage.saved_reconciliation(db, month)}


@router.post("/voice-reconciliation/run")
async def run_voice_reconciliation(request: Request, month: str = ""):
    """Check a month now (again), keep the result and alert staff about gaps."""
    import re

    from app.services import telnyx_usage
    from app.services.telnyx_client import TelnyxError, platform_key

    _admin_only(request)
    month = month or telnyx_usage.previous_month()
    if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="Pick a month like 2026-09.")
    if not platform_key():
        raise HTTPException(status_code=503, detail="Telnyx is not connected on the platform yet.")
    try:
        return {"month": month, "result": await telnyx_usage.reconcile(month)}
    except TelnyxError as err:
        raise HTTPException(status_code=502, detail=str(err))


@router.post("/plans/{plan_id}/sync-stripe")
async def sync_plan(plan_id: str, request: Request):
    from app.models.models import BillingPlan
    from app.services import billing as B

    _admin_only(request)
    async with AsyncSessionLocal() as db:
        p = (await db.execute(select(BillingPlan).where(BillingPlan.id == plan_id))).scalars().first()
        if not p:
            raise HTTPException(status_code=404, detail="Plan not found.")
        try:
            await B.sync_plan_to_stripe(p)
        except B.StripeError as err:
            raise HTTPException(status_code=502, detail=str(err))
        await db.commit()
        return B.plan_json(p)


@router.get("/rates")
async def get_rates(request: Request):
    from app.services import credits as K

    _who(request)
    async with AsyncSessionLocal() as db:
        return await K.rates(db)


class RatesBody(BaseModel):
    rates: Dict[str, int]


@router.put("/rates")
async def put_rates(body: RatesBody, request: Request):
    from app.services import credits as K

    _admin_only(request)
    async with AsyncSessionLocal() as db:
        out = await K.set_rates(db, body.rates)
        await db.commit()
        return out


# ── Platform keys (provider keys every company runs on) ─────────────────────
async def _as_platform(fn, *args):
    """Run a Connections handler inside the platform record, where Outreach's keys live."""
    from app.core.auth_middleware import platform_org
    from app.core.tenancy import org_scope

    with org_scope(platform_org()):
        async with AsyncSessionLocal() as db:
            return await fn(*args, db)


@router.get("/social-oauth-apps")
async def list_social_oauth_apps(request: Request):
    """The one shared developer-app registration per social network (Client ID/Secret/Config
    ID) that every organisation's "Connect LinkedIn/Facebook/..." button relies on -- staff
    only. Secrets are never returned, only a hint and whether one is saved."""
    from app.services.social_oauth import PLATFORMS, default_redirect_uri, get_oauth_app, public_app_dict

    _who(request)
    async with AsyncSessionLocal() as db:
        apps = [public_app_dict(await get_oauth_app(db, plat)) for plat in PLATFORMS]
    return {"apps": apps, "platforms": list(PLATFORMS),
            "defaultCallback": {p: default_redirect_uri(p) for p in PLATFORMS}}


class SocialOAuthAppBody(BaseModel):
    clientId: str = ""
    clientSecret: str = ""
    configId: str = ""
    redirectUri: str = ""


@router.put("/social-oauth-apps/{platform}")
async def put_social_oauth_app(platform: str, body: SocialOAuthAppBody, request: Request):
    from app.services.social_oauth import PLATFORMS, normalize_platform, public_app_dict, save_oauth_app

    _admin_only(request)
    plat = normalize_platform(platform)
    if plat not in PLATFORMS:
        raise HTTPException(status_code=400, detail="Unsupported platform.")
    async with AsyncSessionLocal() as db:
        app_row = await save_oauth_app(db, plat, body.clientId, body.clientSecret, body.redirectUri, config_id=body.configId)
    return {"app": public_app_dict(app_row)}


@router.get("/platform-keys")
async def platform_keys(request: Request):
    """Provider groups with masked keys (never the keys themselves) and the Telnyx assistant."""
    from app.api import connections as C

    _who(request)
    from app.core.tenancy import SHARED_PROVIDER_GROUPS

    groups = await _as_platform(C.list_connections)
    have = {g["group"] for g in groups}
    groups += [{"group": g, "desc": "", "items": []} for g in SHARED_PROVIDER_GROUPS
               if g not in have and g != "Telnyx AI Assistant"]
    # Email Finder: the providers the waterfall knows, in its order, so staff see what to fill.
    from app.services.enrichment_waterfall import LABELS, PROVIDERS

    for g in groups:
        if g["group"] == "Email Finder":
            g["desc"] = g.get("desc") or "Finds work emails. Tried top to bottom; only providers with a key are used."
            saved = {re.sub(r"[^a-z]", "", (it.get("name") or "").lower()) for it in g["items"]}
            g["items"] += [{"id": f"new:{p}", "name": LABELS[p], "status": "not_set"}
                           for p in PROVIDERS if not any(p in n for n in saved)]
        if g["group"] == "Business Discovery" and not any("tavily" in (it.get("name") or "").lower() for it in g["items"]):
            g["items"].append({"id": "new:tavily", "name": "Tavily", "status": "not_set"})
    assistant = await _as_platform(C.get_telnyx_assistant_settings)
    voice_stack = await _voice_stack_status()
    return {"groups": groups, "assistant": assistant, "voiceStack": voice_stack}


async def _voice_stack_status() -> Dict[str, Any]:
    """What the Voice plugin's Telnyx setup is actually doing right now, read live from the
    running config -- not a description someone has to remember to update by hand. Shows up as
    a status panel on the Voice tab of Platform Keys."""
    from app.core.tenancy import system_scope
    from app.models.models import OrgTelnyx, VoiceAssistant
    from app.services import voice_assistants as VA
    from app.services import telnyx_provisioning as TP
    from sqlalchemy import func

    with system_scope():
        async with AsyncSessionLocal() as db:
            assistants_created = (await db.execute(
                select(func.count()).select_from(VoiceAssistant).where(VoiceAssistant.telnyx_assistant_id.isnot(None))
            )).scalar() or 0
            orgs_provisioned = (await db.execute(
                select(func.count()).select_from(OrgTelnyx).where(OrgTelnyx.status == "ready")
            )).scalar() or 0
            orgs_on_managed_account = (await db.execute(
                select(func.count()).select_from(OrgTelnyx).where(OrgTelnyx.mode == "managed_account")
            )).scalar() or 0
    return {
        "managedAssistants": VA.enabled(),
        "accountMode": TP.account_mode(),
        "platformReady": TP.platform_ready(),
        "assistantsCreated": int(assistants_created),
        "orgsProvisioned": int(orgs_provisioned),
        "orgsOnManagedAccount": int(orgs_on_managed_account),
    }


@router.post("/platform-keys/save")
async def platform_keys_save(body: Dict[str, Any], request: Request):
    from app.api import connections as C

    _admin_only(request)
    # Every connection here is brought by the admin -- provider, model, key, URL -- nothing is
    # guessed, so testing must always hit exactly the URL given. Telnyx is Aivhub's own managed
    # stack, not a bring-your-own connection, so it alone is exempt from needing a URL.
    is_telnyx = "telnyx" in str(body.get("provider") or "").lower()
    if not is_telnyx and not (body.get("base_url") or body.get("baseUrl")):
        raise HTTPException(status_code=400, detail="Base URL is required.")
    body = {**body, "always_custom": True}
    try:
        req = C.TestKeyRequest(**body)
    except Exception:
        raise HTTPException(status_code=400, detail="Check the provider and key.")
    out = await _as_platform(C.test_and_save_connection, req)
    from app.services.telnyx_client import refresh_saved_key

    await refresh_saved_key()
    return out


@router.post("/platform-keys/clear")
async def platform_keys_clear(body: Dict[str, Any], request: Request):
    from app.api import connections as C

    _admin_only(request)
    try:
        req = C.ClearKeyRequest(**body)
    except Exception:
        raise HTTPException(status_code=400, detail="Say which key to remove.")
    out = await _as_platform(C.clear_connection_key, req)
    from app.services.telnyx_client import refresh_saved_key

    await refresh_saved_key()
    return out


class CopyKeyBody(BaseModel):
    from_group: str
    to_group: str
    provider_name: str


@router.post("/platform-keys/copy")
async def platform_keys_copy(body: CopyKeyBody, request: Request):
    """Explicit, one-click opt-in: duplicate an already-saved key from one plugin's group into
    another plugin's group, when the admin asks for it -- never automatic. The real secret never
    passes through the browser; it's copied directly between rows on the server."""
    from app.models.models import Connection
    from app.core.auth_middleware import platform_org
    from app.core.tenancy import org_scope

    _admin_only(request)
    if body.from_group == body.to_group:
        raise HTTPException(status_code=400, detail="Pick a different plugin to copy from.")
    with org_scope(platform_org()):
        async with AsyncSessionLocal() as db:
            src = (await db.execute(select(Connection).where(
                Connection.group_name == body.from_group, Connection.name == body.provider_name
            ))).scalars().first()
            if not src or not src.config:
                raise HTTPException(status_code=404, detail=f"No saved {body.provider_name} key found to copy.")
            dest = (await db.execute(select(Connection).where(
                Connection.group_name == body.to_group, Connection.name == body.provider_name
            ))).scalars().first()
            if dest:
                dest.config = dict(src.config)
                dest.status = src.status
                dest.api_key_masked = src.api_key_masked
            else:
                db.add(Connection(id=f"{body.to_group}_{body.provider_name}_{uuid.uuid4().hex[:8]}",
                                  group_name=body.to_group, name=body.provider_name,
                                  status=src.status, api_key_masked=src.api_key_masked,
                                  config=dict(src.config)))
            await db.commit()
    return {"ok": True}


@router.post("/platform-keys/assistant")
async def platform_keys_assistant(body: Dict[str, Any], request: Request):
    from app.api import connections as C

    _admin_only(request)
    try:
        req = C.TelnyxAssistantSettingsRequest(**body)
    except Exception:
        raise HTTPException(status_code=400, detail="Check the assistant ID and public key.")
    return await _as_platform(C.save_telnyx_assistant_settings, req)


# ── Platform mailbox (system email + warmup partner) ────────────────────────
@router.get("/platform-mailbox")
async def get_platform_mailbox(request: Request):
    from app.core.tenancy import system_scope
    from app.services import platform_mailbox as PM
    from app.services.mail_transport import PRESETS

    _who(request)
    with system_scope():
        async with AsyncSessionLocal() as db:
            saved = await PM.load(db)
    return {**PM.public(saved), "presets": PRESETS}


@router.put("/platform-mailbox")
async def put_platform_mailbox(body: Dict[str, Any], request: Request):
    """Logs in to SMTP and IMAP first; a blank password keeps the saved one."""
    from app.core.tenancy import system_scope
    from app.services import mail_transport as T
    from app.services import platform_mailbox as PM

    _admin_only(request)
    with system_scope():
        async with AsyncSessionLocal() as db:
            try:
                out = await PM.save(db, body or {})
            except T.MailError as err:
                raise HTTPException(status_code=400, detail=str(err))
            await db.commit()
    return out


@router.delete("/platform-mailbox")
async def delete_platform_mailbox(request: Request):
    from app.core.tenancy import system_scope
    from app.services import platform_mailbox as PM

    _admin_only(request)
    with system_scope():
        async with AsyncSessionLocal() as db:
            await PM.clear(db)
            await db.commit()
    return {"configured": False}


@router.post("/platform-mailbox/test")
async def test_platform_mailbox(request: Request):
    """Sends a test email from the platform mailbox to the signed-in staff member."""
    from app.core.mailer import render, send_system_email

    to = _who(request).get("email") or ""
    parts = render("Platform mailbox works", ["This test was sent from Outreach's platform mailbox."])
    res = await send_system_email(to, "Outreach platform mailbox test", parts["html"], parts["text"])
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error") or "Not sent.")
    return {"ok": True, "to": to}


# ── Staff alerts (AI errors only staff can fix) ─────────────────────────────
@router.get("/alerts")
async def get_alerts(request: Request):
    """Recent AI alerts for the banner: code, company, full detail, reference."""
    from app.core.tenancy import system_scope
    from app.services import ai_errors

    _who(request)
    with system_scope():
        async with AsyncSessionLocal() as db:
            items = await ai_errors.alerts(db)
    return {"items": items, "unseen": sum(1 for a in items if not a.get("seen"))}


@router.post("/alerts/{alert_id}/seen")
async def alert_seen(alert_id: str, request: Request):
    """Dismiss one alert from the banner ("all" for every one)."""
    from app.core.tenancy import system_scope
    from app.services import ai_errors

    _who(request)
    with system_scope():
        async with AsyncSessionLocal() as db:
            n = await ai_errors.dismiss(db, alert_id)
            await db.commit()
    return {"dismissed": n}


# ── Platform AI (Post scheduler, Voice, Leadgen) ───────────────────────────
@router.get("/platform-ai")
@router.get("/platform-ai/{scope}")
async def get_platform_ai(request: Request, scope: str = "scheduler"):
    """The writing and image AI (main and backup) every company uses, which
    providers Outreach has keys for, and how each one did last time."""
    from app.api.scheduler import _saved_ai_keys
    from app.core.auth_middleware import platform_org
    from app.core.tenancy import org_scope
    from app.services import platform_ai

    _who(request)
    async with AsyncSessionLocal() as db:
        chosen = await platform_ai.get(db, scope=scope)
        health = await platform_ai.health(db, scope=scope)
    with org_scope(platform_org()):
        async with AsyncSessionLocal() as db:
            keys = await _saved_ai_keys(db, scope=scope)
    # Main/backup only ever pick from keys actually saved for this plugin -- never a fixed
    # provider list, so there is nothing here that isn't already a stored connection.
    return {"scope": scope, "chosen": chosen, "health": health,
            "textProviders": [k["name"] for k in keys["text"]], "imageProviders": [k["name"] for k in keys["image"]],
            "keys": {"text": [k["provider"] for k in keys["text"]], "image": [k["provider"] for k in keys["image"]]}}


class PlatformAiBody(BaseModel):
    textProvider: Optional[str] = None
    textModel: Optional[str] = None
    imageProvider: Optional[str] = None
    imageModel: Optional[str] = None
    textBackupProvider: Optional[str] = None
    textBackupModel: Optional[str] = None
    imageBackupProvider: Optional[str] = None
    imageBackupModel: Optional[str] = None


@router.put("/platform-ai")
@router.put("/platform-ai/{scope}")
async def put_platform_ai(body: PlatformAiBody, request: Request, scope: str = "scheduler"):
    from app.services import platform_ai

    _admin_only(request)
    async with AsyncSessionLocal() as db:
        try:
            out = await platform_ai.put(db, body.model_dump(), scope=scope)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
        await db.commit()
    return out


class PlatformAiTestBody(BaseModel):
    kind: str
    slot: str = "main"


@router.post("/platform-ai/test")
@router.post("/platform-ai/{scope}/test")
async def test_platform_ai(body: PlatformAiTestBody, request: Request, scope: str = "scheduler"):
    """A tiny live call with the saved main or backup choice. Staff see the real error."""
    from app.api.scheduler import _resolve_image_prefs, _resolve_text_ai
    from app.core.auth_middleware import platform_org
    from app.core.tenancy import org_scope
    from app.services import platform_ai
    from app.services.llm_gateway import call_open_chat_llm
    from app.services.post_writer import generate_image_with_provider

    _admin_only(request)
    if body.kind not in platform_ai.KINDS or body.slot not in platform_ai.SLOTS:
        raise HTTPException(status_code=400, detail="Say text or image, main or backup.")
    with org_scope(platform_org()):
        async with AsyncSessionLocal() as db:
            provider, model = await platform_ai.choice(db, body.kind, body.slot, scope=scope)
            if body.slot == "backup" and not provider:
                return {"ok": False, "error": "No backup is set."}
            error = None
            try:
                if body.kind == "text":
                    ai = await _resolve_text_ai(db, None, body.slot)
                    if ai["error"]:
                        raise platform_ai.AIUnavailable(f"No key saved for {provider or 'any writing provider'}.")
                    res = await call_open_chat_llm(
                        messages=[{"role": "user", "content": "Reply with the single word OK."}],
                        system_prompt="You are a connectivity check.", api_key=ai["api_key"], provider=ai["provider"],
                        model=ai["model"], base_url=ai["base_url"], max_tokens=5, db=db)
                    if not res.get("success", True) or res.get("error"):
                        raise platform_ai.AIUnavailable(res.get("error") or "No reply.")
                    provider, model = res.get("provider") or ai["provider"], res.get("model") or ai["model"]
                else:
                    p = await _resolve_image_prefs(db, {}, body.slot)
                    img = await generate_image_with_provider(
                        prompt="A small blue circle on a white background", provider=p["provider"], model=p["model"],
                        style=p["style"], aspect_ratio="1:1", width=256, height=256, db=db)
                    if not img.get("imageUrl") or (img.get("status") or "ok") != "ok":
                        raise platform_ai.AIUnavailable(img.get("warning") or "No image returned.")
                    provider, model = img.get("provider") or provider, img.get("model") or model
            except Exception as err:
                error = str(err) or err.__class__.__name__
    await platform_ai.note(body.kind, body.slot, error, scope=scope)
    return {"ok": not error, "error": error, "provider": provider, "model": model}


@router.get("/voice-catalogue")
async def get_voice_catalogue(request: Request):
    """Voices and models clients may pick for their call assistant in Agent Studio."""
    from app.services import platform_ai

    _who(request)
    async with AsyncSessionLocal() as db:
        return await platform_ai.catalogue(db)


class CatalogueBody(BaseModel):
    voices: list = []
    models: list = []


@router.put("/voice-catalogue")
async def put_voice_catalogue(body: CatalogueBody, request: Request):
    from app.services import platform_ai

    _admin_only(request)
    async with AsyncSessionLocal() as db:
        out = await platform_ai.put_catalogue(db, body.voices, body.models)
        await db.commit()
    return out


# ── Revenue and costs ───────────────────────────────────────────────────────
@router.get("/revenue")
async def revenue(request: Request, month: str = "", include_aivhub: bool = False):
    """A month's payments, usage, our estimated cost, margin per client, and subscriptions.
    Aivhub's own house account is excluded by default so its internally-granted credits and
    manually-set-up subscription never skew real revenue/margin numbers."""
    import re

    from app.services import revenue as R

    _who(request)
    month = month or datetime.utcnow().strftime("%Y-%m")
    if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="Pick a month like 2026-09.")
    async with AsyncSessionLocal() as db:
        return await R.report(db, month, include_aivhub)


@router.get("/vendor-costs")
async def vendor_costs(request: Request, month: str = ""):
    """Real/estimated spend this month at the data-provider vendors behind Leadgen (Icypeas,
    Hunter, Findymail, LeadMagic, BetterContact, Tavily, Telnyx number lookup) — so staff know
    roughly how much to keep funded in each vendor's own account. No auto top-up."""
    import re

    from app.services import revenue as R

    _who(request)
    month = month or datetime.utcnow().strftime("%Y-%m")
    if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="Pick a month like 2026-09.")
    async with AsyncSessionLocal() as db:
        return await R.vendor_spend(db, month)


@router.get("/model-pricing")
async def get_model_pricing(request: Request):
    """Every provider/model that has actually been used, with its $ price if staff have set one
    yet. Nothing here is a fixed list: a new model just shows up the first time it's called."""
    from app.services.ai_pricing import list_prices

    _who(request)
    async with AsyncSessionLocal() as db:
        return {"items": await list_prices(db)}


class ModelPriceBody(BaseModel):
    priceIn: float
    priceOut: float = 0.0


@router.put("/model-pricing/{price_id}")
async def put_model_pricing(price_id: str, body: ModelPriceBody, request: Request):
    from app.services.ai_pricing import set_price

    who = _admin_only(request)
    async with AsyncSessionLocal() as db:
        try:
            out = await set_price(db, price_id, body.priceIn, body.priceOut, who.get("name") or who.get("email") or "")
        except ValueError as err:
            raise HTTPException(status_code=404, detail=str(err))
        await db.commit()
    return out


@router.get("/model-pricing/monthly-cost")
async def get_model_pricing_monthly_cost(request: Request, month: str = ""):
    """Real $ this month cost us across every AI call, by provider/model -- from recorded
    usage, not a guess. Compare against the rate-card credits actually charged for the margin."""
    import re

    from app.services.ai_pricing import monthly_cost

    _who(request)
    month = month or datetime.utcnow().strftime("%Y-%m")
    if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="Pick a month like 2026-09.")
    async with AsyncSessionLocal() as db:
        return await monthly_cost(db, month)


@router.get("/unit-costs")
async def get_unit_costs(request: Request):
    from app.services import revenue as R
    from app.services.credits import DEFAULT_RATES

    _who(request)
    async with AsyncSessionLocal() as db:
        out = await R.unit_costs(db)
    return {**out, "items": [{"key": k, "label": v["label"], "unit": v["unit"]} for k, v in DEFAULT_RATES.items()]}


class UnitCostsBody(BaseModel):
    currency: str = "gbp"
    costs: Dict[str, Any] = {}


@router.put("/unit-costs")
async def put_unit_costs(body: UnitCostsBody, request: Request):
    """Our own cost per unit (e.g. a call minute, an AI post), in pence/cents, for the margins."""
    from app.services import revenue as R

    _admin_only(request)
    async with AsyncSessionLocal() as db:
        try:
            out = await R.set_unit_costs(db, body.currency.lower(), body.costs)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
        await db.commit()
    return out


# ── Data Sources (shared business-data scraping/lookup, staff only) ─────────
def _data_source_out(row) -> Dict[str, Any]:
    return {
        "id": row.id, "name": row.name, "kind": row.kind, "baseUrl": row.base_url,
        "authType": row.auth_type, "hasKey": bool(row.api_key), "config": row.config or {},
        "providesFields": row.provides_fields or [], "maxConcurrentRequests": row.max_concurrent_requests,
        "minDelayMs": row.min_delay_ms, "runState": row.run_state, "status": row.status,
        "lastError": row.last_error or "", "lastSyncedAt": row.last_synced_at.isoformat() + "Z" if row.last_synced_at else None,
        "updatedAt": row.updated_at.isoformat() + "Z" if row.updated_at else None,
    }


@router.get("/data-sources")
async def list_data_sources(request: Request):
    """Every website/API the platform can pull public business data from -- staff only. Keys are
    never returned, only whether one is saved (same convention as Social OAuth Apps/Platform Keys)."""
    from app.models.models import DataSource

    _who(request)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(DataSource).order_by(DataSource.created_at))).scalars().all()
    return {"sources": [_data_source_out(r) for r in rows]}


class DataSourceBody(BaseModel):
    name: str
    kind: str  # api | scrape
    baseUrl: str = ""
    authType: str = "none"
    apiKey: str = ""  # blank on an edit keeps the existing key
    config: Dict[str, Any] = {}
    providesFields: List[str] = []
    maxConcurrentRequests: int = 2
    minDelayMs: int = 1000
    status: str = "active"


@router.post("/data-sources")
async def create_data_source(body: DataSourceBody, request: Request):
    from app.models.models import DataSource

    who = _admin_only(request)
    if body.kind not in ("api", "scrape"):
        raise HTTPException(status_code=400, detail="kind must be 'api' or 'scrape'.")
    async with AsyncSessionLocal() as db:
        row = DataSource(
            id=f"ds_{uuid.uuid4().hex[:16]}", name=body.name.strip(), kind=body.kind, base_url=body.baseUrl.strip(),
            auth_type=body.authType, api_key=body.apiKey.strip(), config=body.config, provides_fields=body.providesFields,
            max_concurrent_requests=max(1, body.maxConcurrentRequests), min_delay_ms=max(0, body.minDelayMs),
            run_state="idle", status=body.status, updated_by=who.get("name") or who.get("email") or "",
        )
        db.add(row)
        await db.commit()
        return _data_source_out(row)


async def _get_data_source(db, source_id: str):
    from app.models.models import DataSource

    row = (await db.execute(select(DataSource).where(DataSource.id == source_id))).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="That data source doesn't exist.")
    return row


@router.put("/data-sources/{source_id}")
async def update_data_source(source_id: str, body: DataSourceBody, request: Request):
    who = _admin_only(request)
    async with AsyncSessionLocal() as db:
        row = await _get_data_source(db, source_id)
        row.name, row.kind, row.base_url = body.name.strip(), body.kind, body.baseUrl.strip()
        row.auth_type, row.config = body.authType, body.config
        row.provides_fields, row.status = body.providesFields, body.status
        row.max_concurrent_requests, row.min_delay_ms = max(1, body.maxConcurrentRequests), max(0, body.minDelayMs)
        if body.apiKey.strip():
            row.api_key = body.apiKey.strip()
        row.updated_by = who.get("name") or who.get("email") or ""
        await db.commit()
        return _data_source_out(row)


@router.delete("/data-sources/{source_id}")
async def delete_data_source(source_id: str, request: Request):
    _admin_only(request)
    async with AsyncSessionLocal() as db:
        row = await _get_data_source(db, source_id)
        await db.delete(row)
        await db.commit()
    return {"ok": True}


MAX_IMPORT_BYTES = int(float(os.getenv("DATA_IMPORT_MAX_GB", "20")) * (1 << 30))


def _import_file_name(name: str) -> str:
    from pathlib import Path

    from app.services.data_source_connector import FILE_EXTENSIONS

    safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(name or "").name)[:120].lstrip(".")
    if not safe or not safe.lower().endswith(FILE_EXTENSIONS):
        raise HTTPException(status_code=400, detail=f"Upload one of: {', '.join(FILE_EXTENSIONS)}.")
    return safe


def _file_out(path) -> Dict[str, Any]:
    stat = path.stat()
    return {"name": path.name, "size": stat.st_size, "modifiedAt": datetime.utcfromtimestamp(stat.st_mtime).isoformat() + "Z"}


@router.put("/data-sources/{source_id}/files")
async def upload_data_source_file(source_id: str, request: Request, name: str):
    """Receives one file as the raw request body (streamed straight to disk, never held in memory, so
    a multi-gigabyte register file is fine) into this source's uploads folder. The first upload on a
    source that has no bulk setup yet switches it to 'folder' mode, so Start imports what was uploaded."""
    from app.services import data_source_connector as connector

    _admin_only(request)
    safe = _import_file_name(name)
    async with AsyncSessionLocal() as db:
        source = await _get_data_source(db, source_id)
        if not connector.is_bulk(source):
            source.config = {**(source.config or {}), "bulk_mode": "folder"}
            await db.commit()
    folder = connector.upload_dir(source_id)
    folder.mkdir(parents=True, exist_ok=True)
    part, final, written = folder / f".{safe}.part", folder / safe, 0
    try:
        with open(part, "wb") as out:
            async for chunk in request.stream():
                written += len(chunk)
                if written > MAX_IMPORT_BYTES:
                    raise HTTPException(status_code=413, detail=f"That file is over the {MAX_IMPORT_BYTES >> 30} GB upload limit. Put it in the server's imports folder instead.")
                out.write(chunk)
        if not written:
            raise HTTPException(status_code=400, detail="The upload was empty.")
        part.replace(final)
    finally:
        if part.exists():
            part.unlink()
    return _file_out(final)


@router.get("/data-sources/{source_id}/files")
async def list_data_source_files(source_id: str, request: Request):
    from app.services import data_source_connector as connector

    _who(request)
    async with AsyncSessionLocal() as db:
        source = await _get_data_source(db, source_id)
    return {"files": [_file_out(f) for f in connector.local_files(source)], "uploadFolder": str(connector.upload_dir(source_id)),
            "importRoot": str(connector.IMPORT_ROOT)}


@router.delete("/data-sources/{source_id}/files/{file_name}")
async def delete_data_source_file(source_id: str, file_name: str, request: Request):
    from app.services import data_source_connector as connector

    _admin_only(request)
    target = connector.upload_dir(source_id) / _import_file_name(file_name)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="That file isn't uploaded.")
    target.unlink()
    return {"ok": True}


@router.post("/data-sources/{source_id}/preview")
async def preview_data_source(source_id: str, request: Request):
    """Reads the first few rows the way an import would and shows what each would become -- the
    columns the file really has, which mapped columns were NOT found, and each row's mapped fields
    plus the derived search fields (SIC codes, postcode, size, date). Writes nothing."""
    from app.services import business_records
    from app.services import data_source_connector as connector

    _who(request)
    async with AsyncSessionLocal() as db:
        source = await _get_data_source(db, source_id)
    if not connector.is_bulk(source):
        raise HTTPException(status_code=400, detail="Preview is for bulk sources. Upload a file or set a file link, folder or paged API in the config first.")
    cfg = source.config or {}
    columns: List[str] = []
    files = connector.local_files(source) if connector.bulk_mode(source) == "folder" else []
    if files:
        try:
            columns = connector.file_columns(files[0])
        except Exception:
            columns = []
    try:
        rows = [row async for row in connector.stream_bulk_rows(source, preview_rows=5)]
    except connector.ConnectorError as err:
        return {"ok": False, "error": str(err), "columns": columns}
    except Exception as err:
        return {"ok": False, "error": f"Couldn't read it: {err}", "columns": columns}
    alias_map = cfg.get("bulk_field_map") or connector.DEFAULT_ALIAS_MAP
    have = {connector._normalize_header(c) for c in columns}
    unmatched = {}
    if columns:
        for field, aliases in alias_map.items():
            missing = [a for a in (aliases if isinstance(aliases, list) else [aliases]) if connector._normalize_header(a) not in have]
            if missing:
                unmatched[field] = missing
    out_rows = []
    for row in rows:
        mapped = {k: v for k, v in row.items() if k != "raw"}
        out_rows.append({"mapped": mapped, "derived": {k: str(v) for k, v in business_records.derive_search_fields(mapped).items()}})
    note = "" if rows else "The file was read but no row had a company name. Check the mapping below against these columns."
    return {"ok": True, "columns": columns, "unmatched": unmatched, "rows": out_rows, "note": note,
            "mode": connector.bulk_mode(source)}


class StartRunBody(BaseModel):
    queries: List[str] = []  # one search term per item -- empty/unused for a bulk-file source


@router.post("/data-sources/{source_id}/start")
async def start_data_source_run(source_id: str, body: StartRunBody, request: Request):
    """Actually begins fetching. A source with bulk_index_url configured needs no `queries` at
    all -- key + URL set once is the whole setup -- and streams its provider's full published
    dataset in the background (see data_sources.run_bulk). Any other source works through
    `queries` one at a time (data_sources.run_batch). Refuses to start a second run while one is
    already active."""
    from app.services import data_sources as DS
    from app.services.data_source_connector import is_bulk

    _admin_only(request)
    async with AsyncSessionLocal() as db:
        source = await _get_data_source(db, source_id)
        bulk = is_bulk(source)
        try:
            run = await DS.start_run(db, source, body.queries)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
        await db.commit()
        run_id = run.id
    DS.spawn(DS.run_bulk(run_id) if bulk else DS.run_batch(run_id))
    async with AsyncSessionLocal() as db:
        return _data_source_out(await _get_data_source(db, source_id))


@router.post("/data-sources/{source_id}/{action}")
async def control_data_source(source_id: str, action: str, request: Request):
    """pause/resume/stop drive the run started above (see data_sources.py); test does a live
    one-off search right now, so staff can confirm a key/config actually works without starting
    a full run."""
    _admin_only(request)
    if action not in ("pause", "resume", "stop", "test"):
        raise HTTPException(status_code=404, detail="Unknown action.")
    async with AsyncSessionLocal() as db:
        row = await _get_data_source(db, source_id)
        if action == "test":
            from app.services import data_source_connector as connector

            return await connector.test_connection(row)
        from app.services import data_sources as DS

        fn = {"pause": DS.pause_run, "resume": DS.resume_run, "stop": DS.stop_run}[action]
        run = await fn(db, row)
        if not run:
            raise HTTPException(status_code=400, detail=f"No run to {action} for this source.")
        if action != "resume":
            row.last_error = ""
        await db.commit()
        return _data_source_out(row)


@router.get("/business-records")
async def list_business_records(request: Request, q: str = "", limit: int = 100, offset: int = 0):
    """The shared store's own table view -- search by name, domain, registration number,
    industry, region, email or phone, to check whether a company is actually in there (and from
    which source/confidence tier) when a user says they didn't get an answer for it. `total` is
    how many match the current search (not the whole table), for paging through it."""
    from app.services import business_records

    _who(request)
    async with AsyncSessionLocal() as db:
        limit = max(1, min(limit, 500))
        rows = await business_records.admin_search(db, q, limit=limit, offset=max(0, offset))
        total = await business_records.admin_count(db, q)
    return {"records": [business_records.as_dict(r) for r in rows], "total": total, "limit": limit, "offset": max(0, offset)}


@router.get("/data-sources/{source_id}/runs")
async def list_data_source_runs(source_id: str, request: Request, limit: int = 20):
    from app.models.models import DataSourceRun

    _who(request)
    async with AsyncSessionLocal() as db:
        await _get_data_source(db, source_id)
        rows = (await db.execute(
            select(DataSourceRun).where(DataSourceRun.source_id == source_id)
            .order_by(DataSourceRun.started_at.desc()).limit(max(1, min(limit, 100)))
        )).scalars().all()
    return {"runs": [{
        "id": r.id, "status": r.status, "recordsFound": r.records_found, "recordsNew": r.records_new,
        "recordsUpdated": r.records_updated, "errorMessage": r.error_message or "",
        "total": (r.cursor or {}).get("total") or 0, "currentQuery": (r.cursor or {}).get("current") or "",
        "startedAt": r.started_at.isoformat() + "Z" if r.started_at else None,
        "finishedAt": r.finished_at.isoformat() + "Z" if r.finished_at else None,
    } for r in rows]}


# ── Logs ────────────────────────────────────────────────────────────────────
@router.get("/logs")
async def logs(request: Request, org_id: str = "", limit: int = 200):
    _who(request)
    limit = max(1, min(limit, 500))
    async with AsyncSessionLocal() as db:
        cols = "id, org_id, subsystem, process_name, level, message, created_at"
        if not await _has(db, "process_logs", "created_at"):
            return []
        q = f"SELECT {cols} FROM process_logs " + ("WHERE org_id = :o " if org_id else "") + "ORDER BY created_at DESC LIMIT :l"
        rows = (await db.execute(text(q), {"o": org_id, "l": limit})).all()
    return [{"id": r[0], "orgId": r[1], "subsystem": r[2], "process": r[3], "level": r[4], "message": r[5],
             "at": r[6].isoformat() if r[6] else None} for r in rows]


# ── Staff users ─────────────────────────────────────────────────────────────
class StaffBody(BaseModel):
    email: str
    name: str = ""
    role: str = "staff_support"
    password: str


@router.get("/staff")
async def list_staff(request: Request):
    from app.models.models import StaffUser

    _who(request)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(StaffUser).order_by(StaffUser.created_at))).scalars().all()
    return [{"id": s.id, "email": s.email, "name": s.name, "role": s.role, "active": bool(s.is_active),
             "twoFactor": bool(s.totp_enabled), "lastLoginAt": s.last_login_at.isoformat() if s.last_login_at else None} for s in rows]


@router.post("/staff")
async def add_staff(body: StaffBody, request: Request):
    from app.models.models import StaffUser

    _admin_only(request)
    email = body.email.strip().lower()
    if "@" not in email or body.role not in ("staff_admin", "staff_support"):
        raise HTTPException(status_code=400, detail="Enter an email and a role.")
    problem = password_problem(body.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    async with AsyncSessionLocal() as db:
        if (await db.execute(select(StaffUser).where(func.lower(StaffUser.email) == email))).scalars().first():
            raise HTTPException(status_code=400, detail="That email is already staff.")
        s = StaffUser(id=f"stf_{uuid.uuid4().hex[:10]}", email=email, name=body.name.strip()[:80], role=body.role,
                      hashed_password=hash_password(body.password))
        db.add(s)
        await db.commit()
    return {"id": s.id, "email": s.email, "role": s.role}


class StaffPatch(BaseModel):
    active: Optional[bool] = None
    role: Optional[str] = None
    reset2fa: bool = False


@router.patch("/staff/{staff_id}")
async def patch_staff(staff_id: str, body: StaffPatch, request: Request):
    from app.models.models import StaffUser

    me_ = _admin_only(request)
    async with AsyncSessionLocal() as db:
        s = (await db.execute(select(StaffUser).where(StaffUser.id == staff_id))).scalars().first()
        if not s:
            raise HTTPException(status_code=404, detail="Staff user not found.")
        if s.id == me_["staff_id"] and (body.active is False or (body.role and body.role != "staff_admin")):
            raise HTTPException(status_code=400, detail="You cannot remove your own admin access.")
        if body.active is not None:
            s.is_active = body.active
        if body.role in ("staff_admin", "staff_support"):
            s.role = body.role
        if body.reset2fa:
            s.totp_enabled, s.totp_secret_sealed = False, ""
        await db.commit()
    return {"ok": True}


# ── Platform Balances ───────────────────────────────────────────────────────
class ChecklistItem(BaseModel):
    id: str
    name: str
    alert_configured: bool = False
    threshold: str = ""
    notes: str = ""


class ChecklistBody(BaseModel):
    checklist: List[ChecklistItem]


@router.get("/platform-balances")
async def get_platform_balances(request: Request):
    """Live provider balances (Telnyx, DeepSeek) and manual spend-alert status."""
    from app.services.platform_balances import get_platform_balances_overview

    _who(request)
    async with AsyncSessionLocal() as db:
        return await get_platform_balances_overview(db)


@router.post("/platform-balances/checklist")
async def update_balance_checklist(body: ChecklistBody, request: Request):
    """Save staff updates to non-pollable spend alerts checklist."""
    from app.services.platform_balances import save_checklist_state

    _admin_only(request)
    async with AsyncSessionLocal() as db:
        return await save_checklist_state(db, [item.model_dump() for item in body.checklist])

