"""Admin portal API for Aivhub staff (/api/admin-api/...).

Staff sign in with their own accounts (password + mandatory two-factor code). Client tokens are
never accepted here. Requests run with every organisation visible; changes to one client run
inside that client's organisation. staff_support can look; staff_admin can also change things.
"""
from __future__ import annotations

import os
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Any, Deque, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.future import select

from app.core import staff as S
from app.core.security import decode_token, hash_password, password_problem, verify_password
from app.database import AsyncSessionLocal

router = APIRouter(prefix="/admin-api", tags=["Admin portal"])

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
async def dashboard(request: Request):
    _who(request)
    since = datetime.utcnow() - timedelta(days=30)
    async with AsyncSessionLocal() as db:
        return {
            "clients": await _count(db, "SELECT count(*) FROM organizations"),
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


async def _has(db, table: str, column: str) -> bool:
    return bool((await db.execute(text(
        "SELECT 1 FROM information_schema.columns WHERE table_name = :t AND column_name = :c"), {"t": table, "c": column})).first())


def platform_status() -> Dict[str, Any]:
    from app.core import mailer
    from app.services import billing
    from app.services.telnyx_provisioning import account_mode, platform_ready

    return {
        "telnyx": platform_ready(), "telnyxMode": account_mode(),
        "telnyxWebhookKey": bool(os.getenv("TELNYX_ASSISTANT_PUBLIC_KEY")),
        "stripe": billing.configured(), "stripeTestMode": billing.test_mode(), "stripeWebhook": bool(billing.webhook_secret()),
        "mail": mailer.configured(), "google": bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET")),
        "signup": os.getenv("ALLOW_SIGNUP", "").lower() in ("1", "true", "yes"),
    }


@router.get("/platform")
async def platform(request: Request):
    _who(request)
    return platform_status()


# ── Clients ─────────────────────────────────────────────────────────────────
async def _in_org(org_id: str, fn):
    from app.core.tenancy import org_scope

    async with AsyncSessionLocal() as db:
        if not (await db.execute(text("SELECT 1 FROM organizations WHERE id = :i"), {"i": org_id})).first():
            raise HTTPException(status_code=404, detail="Client not found.")
    with org_scope(org_id):
        async with AsyncSessionLocal() as db:
            return await fn(db)


@router.get("/clients")
async def clients(request: Request):
    from app.services import credits as K
    from app.services.telnyx_provisioning import latest_verification

    _who(request)
    async with AsyncSessionLocal() as db:
        orgs = (await db.execute(text(
            "SELECT o.id, o.name, o.status, o.created_at, "
            "(SELECT count(*) FROM operators u WHERE u.org_id = o.id) AS users, "
            "(SELECT count(*) FROM org_phone_numbers n WHERE n.org_id = o.id AND n.status = 'active') AS numbers "
            "FROM organizations o ORDER BY o.created_at DESC NULLS LAST"))).all()
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
        org = (await db.execute(text("SELECT id, name, slug, status, created_at FROM organizations WHERE id = :i"), {"i": org_id})).first()
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
async def set_status(org_id: str, body: StatusBody, request: Request):
    from app.core.auth_middleware import forget

    _admin_only(request)
    if body.status not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="Status is active or suspended.")
    async with AsyncSessionLocal() as db:
        res = await db.execute(text("UPDATE organizations SET status = :s, updated_at = now() WHERE id = :i"), {"s": body.status, "i": org_id})
        await db.commit()
    if not res.rowcount:
        raise HTTPException(status_code=404, detail="Client not found.")
    forget()  # everyone's cached access is re-checked at once
    return {"id": org_id, "status": body.status}


class CreditBody(BaseModel):
    wallet: str
    amount: int
    expires_in_days: Optional[int] = None
    note: str = ""


@router.post("/clients/{org_id}/credits")
async def add_credits(org_id: str, body: CreditBody, request: Request):
    from app.services import credits as K

    staff = _admin_only(request)
    if body.wallet not in K.WALLETS or not body.amount or abs(body.amount) > 10_000_000:
        raise HTTPException(status_code=400, detail="Pick a wallet and a non-zero amount.")
    expires = datetime.utcnow() + timedelta(days=body.expires_in_days) if body.expires_in_days else None

    async def run(db):
        bal = await K.grant(db, body.amount, note=body.note or "Added by OutReach", by=staff["name"] or staff["email"],
                            wallet=body.wallet, expires_at=expires)
        await db.commit()
        return bal

    return {"wallet": body.wallet, "balance": await _in_org(org_id, run)}


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


class WhatsappBody(BaseModel):
    enabled: bool


@router.post("/clients/{org_id}/numbers/{number_id}/whatsapp")
async def set_whatsapp(org_id: str, number_id: str, body: WhatsappBody, request: Request):
    """Switch WhatsApp on for a number once its Meta business signup is complete in Telnyx."""
    from app.models.models import OrgPhoneNumber

    _admin_only(request)

    async def run(db):
        n = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.id == number_id))).scalars().first()
        if not n:
            raise HTTPException(status_code=404, detail="Number not found.")
        caps = [c for c in (n.capabilities or []) if c not in ("whatsapp", "whatsapp_requested")]
        if body.enabled:
            caps.append("whatsapp")
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
            "SELECT n.id, n.org_id, o.name, n.e164 FROM org_phone_numbers n LEFT JOIN organizations o ON o.id = n.org_id "
            "WHERE n.capabilities::text LIKE '%whatsapp_requested%'"))).all()
    return {
        "verifications": [{"id": r[0], "orgId": r[1], "orgName": r[2], "status": r[3], "reason": r[4], "entityType": r[5],
                           "groupId": r[6], "at": r[7].isoformat() if r[7] else None,
                           "waitingHours": round((datetime.utcnow() - r[7]).total_seconds() / 3600) if r[7] else None} for r in rows],
        "whatsappRequests": [{"numberId": r[0], "orgId": r[1], "orgName": r[2], "e164": r[3]} for r in wa],
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
