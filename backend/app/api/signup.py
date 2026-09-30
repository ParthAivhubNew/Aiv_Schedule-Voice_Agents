"""New companies registering themselves, email verification, "Sign in with Google" and the
first-steps checklist.

Signup is off unless ALLOW_SIGNUP=true. It creates an organisation, its starter roles and the
owner (an admin). When the platform mailbox is set up, the organisation stays "pending" and
nobody can sign in until the owner clicks the link in the verification email.

Google sign-in (OpenID Connect, authorisation code + PKCE) appears once GOOGLE_CLIENT_ID and
GOOGLE_CLIENT_SECRET are set. It signs in an existing user by their Google account or verified
email; with signup on, an unknown Google account gets a new organisation. The browser never
sees tokens in a URL: the callback hands over a one-time code that the app exchanges.
"""
from __future__ import annotations

import base64
import hashlib
import html
import os
import re
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime
from typing import Any, Deque, Dict, Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.accounts import assign_roles, ensure_system_roles
from app.core.auth_middleware import current
from app.core.security import ALGORITHM, hash_password, password_problem, signing_key
from app.database import get_db
from app.models.models import Operator, Organization

router = APIRouter(prefix="/auth", tags=["Signup"])

VERIFY_TTL_S = 3 * 24 * 3600
EXCHANGE_TTL_S = 120
STATE_TTL_S = 10 * 60
PENDING = "pending_verification"

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")


def signup_allowed() -> bool:
    return os.getenv("ALLOW_SIGNUP", "").strip().lower() in ("1", "true", "yes")


def google_ready() -> bool:
    return bool(os.getenv("GOOGLE_CLIENT_ID", "").strip() and os.getenv("GOOGLE_CLIENT_SECRET", "").strip())


def _base_url() -> str:
    from app.config import settings

    return (settings.PUBLIC_BASE_URL or "").rstrip("/")


# ── Abuse limits (per IP, in memory) ────────────────────────────────────────
_HITS: Dict[str, Deque[float]] = defaultdict(deque)
LIMITS = {"signup": (5, 3600), "resend": (5, 3600)}


def _limit(kind: str, request: Request) -> None:
    n, window = LIMITS[kind]
    ip = request.client.host if request.client else "?"
    q = _HITS[f"{kind}|{ip}"]
    now = time.time()
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= n:
        raise HTTPException(status_code=429, detail="Too many attempts from this network. Try again later.")
    q.append(now)


# ── Small signed tokens for links and one-time codes ────────────────────────
_USED_JTI: Dict[str, float] = {}


def _sign(claims: Dict[str, Any], ttl_s: int) -> str:
    now = int(time.time())
    return jwt.encode({**claims, "iat": now, "exp": now + ttl_s, "jti": uuid.uuid4().hex}, signing_key(), algorithm=ALGORITHM)


def _read(token: str, typ: str, once: bool = False) -> Optional[Dict[str, Any]]:
    try:
        claims = jwt.decode(token or "", signing_key(), algorithms=[ALGORITHM])
    except JWTError:
        return None
    if claims.get("typ") != typ:
        return None
    if once:
        now = time.time()
        for k, exp in list(_USED_JTI.items()):
            if exp < now:
                _USED_JTI.pop(k, None)
        if claims.get("jti") in _USED_JTI:
            return None
        _USED_JTI[claims.get("jti")] = float(claims.get("exp") or now)
    return claims


# ── Creating an organisation ────────────────────────────────────────────────
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:40]
    return s or "company"


async def _email_taken(db: AsyncSession, email: str) -> bool:
    e = email.lower()
    q = select(Operator).where((func.lower(Operator.username) == e) | (func.lower(Operator.email) == e))
    return (await db.execute(q)).scalars().first() is not None


async def _create_org(db: AsyncSession, company: str, name: str, email: str, password: Optional[str],
                      status: str, google_sub: Optional[str] = None) -> Operator:
    org_id = f"org_{uuid.uuid4().hex[:12]}"
    slug = _slug(company)
    if (await db.execute(select(Organization).where(Organization.slug == slug))).scalars().first():
        slug = f"{slug}-{uuid.uuid4().hex[:5]}"
    db.add(Organization(id=org_id, name=company, slug=slug, status=status))
    await db.flush()
    roles = await ensure_system_roles(db, org_id)
    op = Operator(
        id=f"op_{uuid.uuid4().hex[:10]}",
        org_id=org_id,
        username=email.lower(),
        name=name,
        email=email,
        role="Admin",
        # Google-only owners get an unusable random password until they set one.
        hashed_password=hash_password(password or secrets.token_urlsafe(32)),
        must_change_password=False,
        is_active=True,
        email_verified=status == "active",
        google_sub=google_sub,
    )
    db.add(op)
    await db.flush()
    await assign_roles(db, op, [roles["Admin"].id])
    await db.commit()
    await _seed_company(org_id, company)
    await _starter_credits(org_id)
    return op


async def _starter_credits(org_id: str) -> None:
    """New organisations pay as they go: credits are enforced, with a starter amount."""
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.services import credits as K

    try:
        with org_scope(org_id):
            async with AsyncSessionLocal() as s:
                await K.set_org_settings(s, {"enforce": True}, org_id)
                doc = await K._get_doc(s, K._settings_id(org_id))
                doc["tracking_since"] = datetime.utcnow().isoformat()
                await K._put_doc(s, K._settings_id(org_id), doc)
                if K.starter_credits():
                    await K.grant(s, K.starter_credits(), note="Starter credits")
                await s.commit()
    except Exception as err:
        import logging

        logging.getLogger("signup").warning(f"[signup] starter credits for {org_id} failed: {err}")


async def _seed_company(org_id: str, company: str) -> None:
    """The organisation's company profile starts with its own name, not the sample one."""
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import CompanyProfile

    try:
        with org_scope(org_id):
            async with AsyncSessionLocal() as s:
                s.add(CompanyProfile(id="default", name=company, website="", social="", pitch="", industry=""))
                await s.commit()
    except Exception as err:
        import logging

        logging.getLogger("signup").warning(f"[signup] starter credits for {org_id} failed: {err}")  # created lazily on first use otherwise


async def _send_verification(op: Operator) -> bool:
    from app.core.mailer import render, send_system_email

    token = _sign({"typ": "verify_email", "sub": op.id, "email": (op.email or "").lower()}, VERIFY_TTL_S)
    link = f"{_base_url()}/api/auth/verify-email?t={token}"
    subject = "Confirm your email for OutReach by Aivhub"
    msg = render(subject, [
        f"Hi {html.escape(op.name or '')},",
        "Confirm your email address to finish creating your OutReach by Aivhub account.",
        "The link works for 3 days. If you did not sign up, ignore this email.",
    ], {"label": "Confirm email", "url": link})
    res = await send_system_email(op.email or "", subject, msg["html"], msg["text"])
    return bool(res.get("ok"))


# ── Public: what the sign-in page offers ────────────────────────────────────
@router.get("/signup-config")
async def signup_config():
    return {"allowSignup": signup_allowed(), "google": google_ready()}


class SignupBody(BaseModel):
    company: str
    name: str
    email: str
    password: str
    website: Optional[str] = ""  # honeypot: people never fill it


@router.post("/signup")
async def signup(body: SignupBody, request: Request, db: AsyncSession = Depends(get_db)):
    if not signup_allowed():
        raise HTTPException(status_code=404, detail="Not found")
    _limit("signup", request)
    if (body.website or "").strip():
        raise HTTPException(status_code=400, detail="Could not create the account.")
    company, name, email = body.company.strip()[:120], body.name.strip()[:120], body.email.strip()
    if not company or not name:
        raise HTTPException(status_code=400, detail="Company and your name are required.")
    if not _EMAIL_RE.match(email) or len(email) > 254:
        raise HTTPException(status_code=400, detail="That email address does not look right.")
    problem = password_problem(body.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if await _email_taken(db, email):
        raise HTTPException(status_code=400, detail={"message": "You already have an account with this email. Sign in instead.", "code": "account_exists"})

    from app.core.mailer import configured

    verify = configured()
    op = await _create_org(db, company, name, email, body.password, PENDING if verify else "active")
    sent = await _send_verification(op) if verify else False
    return {"ok": True, "username": op.username, "verifyEmail": verify, "emailed": sent}


@router.get("/verify-email")
async def verify_email(t: str = "", db: AsyncSession = Depends(get_db)):
    claims = _read(t, "verify_email")
    if not claims:
        return RedirectResponse(f"{_base_url()}/?verified=expired", status_code=303)
    op = (await db.execute(select(Operator).where(Operator.id == claims["sub"]))).scalars().first()
    if not op or (op.email or "").lower() != claims.get("email"):
        return RedirectResponse(f"{_base_url()}/?verified=expired", status_code=303)
    op.email_verified = True
    org = (await db.execute(select(Organization).where(Organization.id == op.org_id))).scalars().first()
    if org and org.status == PENDING:
        org.status = "active"
    await db.commit()
    return RedirectResponse(f"{_base_url()}/?verified=1", status_code=303)


class ResendBody(BaseModel):
    email: str


@router.post("/resend-verification")
async def resend_verification(body: ResendBody, request: Request, db: AsyncSession = Depends(get_db)):
    _limit("resend", request)
    e = body.email.strip().lower()
    op = (await db.execute(select(Operator).where(func.lower(Operator.email) == e))).scalars().first()
    if op and not op.email_verified:
        org = (await db.execute(select(Organization).where(Organization.id == op.org_id))).scalars().first()
        if org and org.status == PENDING:
            await _send_verification(op)
    return {"ok": True}  # same answer either way: does not reveal who has an account


# ── Forgotten password (by email) ───────────────────────────────────────────
RESET_TTL_S = 60 * 60
LIMITS["forgot"] = (5, 3600)


def _pw_fingerprint(op: Operator) -> str:
    # Ties a reset link to the current password: once used (or the password changes) it stops working.
    return hashlib.sha256((op.hashed_password or "").encode()).hexdigest()[:16]


class ForgotBody(BaseModel):
    email: str


@router.post("/forgot-password")
async def forgot_password(body: ForgotBody, request: Request, db: AsyncSession = Depends(get_db)):
    from app.core.mailer import configured, render, send_system_email

    _limit("forgot", request)
    if not configured():
        return {"ok": True, "mailboxReady": False}
    e = body.email.strip().lower()
    op = (await db.execute(select(Operator).where(
        (func.lower(Operator.email) == e) | (func.lower(Operator.username) == e)))).scalars().first()
    if op and op.is_active is not False and op.email:
        token = _sign({"typ": "pw_reset", "sub": op.id, "fp": _pw_fingerprint(op)}, RESET_TTL_S)
        link = f"{_base_url()}/reset-password?t={token}"
        subject = "Reset your OutReach by Aivhub password"
        msg = render(subject, [
            f"Hi {html.escape(op.name or '')},",
            "Someone asked to reset the password for your OutReach by Aivhub account.",
            "The link works for 1 hour and only once. If this was not you, ignore this email: your password stays the same.",
        ], {"label": "Choose a new password", "url": link})
        await send_system_email(op.email, subject, msg["html"], msg["text"])
    return {"ok": True, "mailboxReady": True}  # same answer either way


class ResetBody(BaseModel):
    token: str
    password: str


@router.post("/reset-password")
async def reset_password_with_link(body: ResetBody, db: AsyncSession = Depends(get_db)):
    from app.core.auth_middleware import forget
    from app.models.models import AuthSession

    claims = _read(body.token, "pw_reset")
    op = None
    if claims:
        op = (await db.execute(select(Operator).where(Operator.id == claims["sub"]))).scalars().first()
    if not op or op.is_active is False or claims.get("fp") != _pw_fingerprint(op):
        raise HTTPException(status_code=400, detail={"message": "This reset link has expired or was already used. Ask for a new one.", "code": "reset_expired"})
    problem = password_problem(body.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    op.hashed_password = hash_password(body.password)
    op.must_change_password = False
    op.password_changed_at = datetime.utcnow()
    for ses in (await db.execute(select(AuthSession).where(AuthSession.operator_id == op.id, AuthSession.revoked_at.is_(None)))).scalars().all():
        ses.revoked_at = datetime.utcnow()
    await db.commit()
    forget(op.id)
    return {"ok": True, "username": op.username}


# ── Sign in with Google ─────────────────────────────────────────────────────
def _redirect_uri() -> str:
    return f"{_base_url()}/api/auth/google/callback"


def _pkce_pair() -> tuple:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


@router.get("/google/start")
async def google_start():
    if not google_ready():
        raise HTTPException(status_code=404, detail="Google sign-in is not set up.")
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    verifier, challenge = _pkce_pair()
    params = {
        "client_id": os.getenv("GOOGLE_CLIENT_ID", "").strip(),
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    resp = RedirectResponse(f"{GOOGLE_AUTH}?{urlencode(params)}", status_code=302)
    cookie = _sign({"typ": "google_state", "state": state, "nonce": nonce, "v": verifier}, STATE_TTL_S)
    resp.set_cookie("g_state", cookie, max_age=STATE_TTL_S, httponly=True, secure=_base_url().startswith("https"),
                    samesite="lax", path="/api/auth/google")
    return resp


async def _google_identity(code: str, verifier: str, nonce: str) -> Dict[str, Any]:
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    async with httpx.AsyncClient(timeout=10.0) as client:
        tok = await client.post(GOOGLE_TOKEN, data={
            "code": code,
            "client_id": client_id,
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", "").strip(),
            "redirect_uri": _redirect_uri(),
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        })
        tok.raise_for_status()
        id_token = tok.json().get("id_token") or ""
        certs = (await client.get(GOOGLE_CERTS)).json()
    claims = jwt.decode(id_token, certs, algorithms=["RS256"], audience=client_id,
                        options={"verify_at_hash": False})
    if claims.get("iss") not in GOOGLE_ISSUERS or claims.get("nonce") != nonce:
        raise ValueError("id token issuer or nonce mismatch")
    return claims


def _back(reason: str) -> RedirectResponse:
    resp = RedirectResponse(f"{_base_url()}/?google_error={reason}", status_code=303)
    resp.delete_cookie("g_state", path="/api/auth/google")
    return resp


@router.get("/google/callback")
async def google_callback(request: Request, code: str = "", state: str = "", error: str = "",
                          db: AsyncSession = Depends(get_db)):
    if not google_ready():
        raise HTTPException(status_code=404, detail="Google sign-in is not set up.")
    saved = _read(request.cookies.get("g_state", ""), "google_state", once=True)
    if error or not code or not saved or not secrets.compare_digest(saved.get("state", ""), state or ""):
        return _back("cancelled" if error else "expired")
    try:
        g = await _google_identity(code, saved["v"], saved["nonce"])
    except Exception:
        return _back("failed")
    sub, email = str(g.get("sub") or ""), str(g.get("email") or "").strip()
    verified = g.get("email_verified") in (True, "true")
    if not sub:
        return _back("failed")

    op = (await db.execute(select(Operator).where(Operator.google_sub == sub))).scalars().first()
    if not op and email and verified:
        op = (await db.execute(select(Operator).where(func.lower(Operator.email) == email.lower()))).scalars().first()
        if op:
            op.google_sub = sub
            op.email_verified = True
    if not op:
        if not (signup_allowed() and email and verified):
            return _back("no_account")
        name = str(g.get("name") or email.split("@")[0])
        domain = email.split("@")[1]
        company = name + "'s company" if domain in ("gmail.com", "googlemail.com") else domain.split(".")[0].title()
        op = await _create_org(db, company, name, email, None, "active", google_sub=sub)
    if op.is_active is False:
        return _back("disabled")
    org = (await db.execute(select(Organization).where(Organization.id == op.org_id))).scalars().first()
    if org and org.status == PENDING and verified and (op.email or "").lower() == email.lower():
        org.status = "active"  # Google already confirmed this email
    await db.commit()
    one_time = _sign({"typ": "google_exchange", "sub": op.id}, EXCHANGE_TTL_S)
    resp = RedirectResponse(f"{_base_url()}/?google={one_time}", status_code=303)
    resp.delete_cookie("g_state", path="/api/auth/google")
    return resp


class ExchangeBody(BaseModel):
    code: str


@router.post("/google/exchange")
async def google_exchange(body: ExchangeBody, request: Request, db: AsyncSession = Depends(get_db)):
    from app.api.auth import sign_in_as

    claims = _read(body.code, "google_exchange", once=True)
    if not claims:
        raise HTTPException(status_code=401, detail="That sign-in link has expired. Try again.")
    op = (await db.execute(select(Operator).where(Operator.id == claims["sub"]))).scalars().first()
    if not op:
        raise HTTPException(status_code=401, detail="That sign-in link has expired. Try again.")
    return await sign_in_as(db, op, request)


# ── First steps checklist (signed in) ───────────────────────────────────────
@router.get("/onboarding")
async def onboarding(request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.models import CallLog, CompanyProfile, OrgPhoneNumber
    from app.services.calendar_service import calendar_service
    from app.services.compliance import load_rules

    ctx = current(request)
    profile = (await db.execute(select(CompanyProfile))).scalars().first()
    numbers = (await db.execute(select(func.count()).select_from(OrgPhoneNumber))).scalar() or 0
    team = (await db.execute(select(func.count()).select_from(Operator).where(Operator.org_id == ctx["org_id"]))).scalar() or 0
    try:
        mailbox = bool(await calendar_service._mail_accounts_ready(db))
    except Exception:
        mailbox = False
    rules = await load_rules(db)
    calls = (await db.execute(select(func.count()).select_from(CallLog))).scalar() or 0
    steps = [
        {"key": "company", "label": "Describe your company", "done": bool(profile and (profile.pitch or "").strip() and profile.name not in ("", "Your company")), "go": "#/voice/company"},
        {"key": "hours", "label": "Set your working hours", "done": bool(rules.get("schedule") or rules.get("policy")), "go": "#/voice/hours"},
        {"key": "number", "label": "Add a phone number", "done": numbers > 0, "go": "team:numbers"},
        {"key": "team", "label": "Invite your team", "done": team > 1, "go": "team:users"},
        {"key": "mailbox", "label": "Connect a mailbox", "done": mailbox, "go": "#/emailoutreach"},
        {"key": "call", "label": "Make your first call", "done": calls > 0, "go": "#/voice/list"},
    ]
    return {"steps": steps, "done": sum(s["done"] for s in steps), "total": len(steps)}
