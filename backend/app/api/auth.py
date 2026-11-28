"""Sign in, sessions, passwords, users and roles."""
from __future__ import annotations

import re
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Any, Deque, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.core import permissions as P
from app.core import profile as prof
from app.core.accounts import (
    admins_in,
    assign_roles,
    effective_access,
    ensure_role_for,
    ensure_system_roles,
    ACCESS_OFF_MESSAGE,
    is_switched_off,
    org_of,
    roles_of,
)
from app.core.auth_middleware import current, forget
from app.services import audit, session_policy
from app.services.data_access import AccessDenied
from app.core.security import (
    REFRESH_TTL_S,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    password_problem,
    temporary_password,
    verify_password,
)
from app.database import get_db
from app.models.models import AuthSession, Operator, OperatorGrant, OperatorRole, Organization, Role

router = APIRouter(prefix="/auth", tags=["Auth"])

# ── Brute-force protection ─────────────────────────────────────────────────
_FAILS: Dict[str, Deque[float]] = defaultdict(deque)
FAIL_WINDOW_S = 15 * 60
FAIL_LIMIT = 8


def _fail_key(username: str, request: Request) -> str:
    ip = request.client.host if request.client else "?"
    return f"{username.lower()}|{ip}"


def _locked(key: str) -> bool:
    q = _FAILS[key]
    now = time.time()
    while q and now - q[0] > FAIL_WINDOW_S:
        q.popleft()
    return len(q) >= FAIL_LIMIT


# ── Schemas ─────────────────────────────────────────────────────────────────
class LoginBody(BaseModel):
    username: str
    password: str = ""
    remember: bool = False  # "Keep me signed in" on a trusted device


class RefreshBody(BaseModel):
    refresh_token: str = ""


REFRESH_COOKIE = "outreach_rt"
ROTATION_GRACE_S = 30


def set_refresh_cookie(response: Response, token: str) -> None:
    """The refresh token also travels in a cookie scripts cannot read, so every tab of the browser shares one sign-in."""
    secure = str(getattr(settings, "PUBLIC_BASE_URL", "") or "").startswith("https")
    response.set_cookie(REFRESH_COOKIE, token, max_age=REFRESH_TTL_S, httponly=True, secure=secure, samesite="strict", path="/api/auth")


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")


class ChangePasswordBody(BaseModel):
    current_password: str = ""
    new_password: str


class UserBody(BaseModel):
    username: str
    name: str
    email: Optional[str] = None
    password: Optional[str] = None
    role_ids: Optional[List[str]] = None
    role: Optional[str] = None  # old clients send a role name


class UserPatch(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None
    role_ids: Optional[List[str]] = None
    grants: Optional[Dict[str, str]] = None  # section -> none | view | full


class RoleBody(BaseModel):
    name: str
    description: str = ""
    is_admin: bool = False
    levels: Dict[str, str] = {}


class RolePatch(BaseModel):
    """Any subset of the role's fields; is_active switches the role on or off (admins only)."""
    name: Optional[str] = None
    description: Optional[str] = None
    is_admin: Optional[bool] = None
    levels: Optional[Dict[str, str]] = None
    is_active: Optional[bool] = None


# ── Helpers ─────────────────────────────────────────────────────────────────
async def _operator_json(db: AsyncSession, op: Operator) -> Dict[str, Any]:
    is_admin, perms, roles = await effective_access(db, op)
    grants = {g.section: g.level for g in (await db.execute(select(OperatorGrant).where(OperatorGrant.operator_id == op.id))).scalars().all()}
    return {
        "id": op.id,
        "username": op.username,
        "name": op.name,
        "email": op.email,
        "phone": op.phone or "",
        "avatar_url": prof.avatar_url(op),
        "profile": prof.details(op),
        "org_name": (await db.execute(select(Organization.name).where(Organization.id == org_of(op)))).scalar() or "",
        "member_since": op.created_at.isoformat() if op.created_at else None,
        "role": "Admin" if is_admin else (roles[0].name if roles else (op.role or "Operator")),
        "roles": [{"id": r.id, "name": r.name, "is_admin": bool(r.is_admin)} for r in roles],
        "is_admin": is_admin,
        "permissions": perms,
        "grants": grants,
        "is_active": op.is_active is not False,
        "must_change_password": bool(op.must_change_password),
        "last_login_at": op.last_login_at.isoformat() if op.last_login_at else None,
        "first_visit": bool((op.profile or {}).get("first_visit")),
        "org_id": org_of(op),
        # Outreach's own organisation runs the AI/telephony provider settings; clients never see them.
        "is_platform_org": org_of(op) == __import__("app.core.platform", fromlist=["x"]).platform_org_id(),
    }


async def _may_remember(db: AsyncSession, op: Operator) -> bool:
    """A remembered sign-in is allowed unless the organisation's admin set a maximum of their own: that choice is never loosened."""
    return not (await session_policy.org_choice(db, org_of(op))).get("max_hours")


METHOD_NAMES = {"password": "a password", "google": "Google", "microsoft": "Microsoft"}


async def signin_refusal(db: AsyncSession, op: Operator, method: str) -> str:
    """Why this person may not sign in this way under their company's rules (the brand's combined with the company's, plan 12, B9), or ""
    when they may. The sign-in page's own check by web address stays as well; this one holds on every address."""
    from app.services import tenant_policy as TP

    if not method:
        return ""
    allowed = (await TP.effective(db, org_of(op))).data["signin"]
    if allowed.get(method, True):
        return ""
    others = [METHOD_NAMES[k] for k in ("password", "google") if allowed.get(k, True) and k != method]
    how = f" Sign in with {' or '.join(others)}." if others else " Ask your administrator how to sign in."
    return f"Your company's rules don't allow signing in with {METHOD_NAMES.get(method, method)}.{how}"


async def _start_session(db: AsyncSession, op: Operator, request: Request, remember: bool = False, method: str = "") -> Dict[str, Any]:
    remember = bool(remember and await _may_remember(db, op))
    sid = f"ses_{uuid.uuid4().hex}"
    refresh = create_refresh_token(op.id, sid)
    claims = decode_token(refresh, "refresh")
    db.add(AuthSession(
        id=sid,
        operator_id=op.id,
        refresh_jti=claims["jti"],
        user_agent=(request.headers.get("user-agent") or "")[:300],
        ip=request.client.host if request.client else "",
        expires_at=datetime.utcnow() + timedelta(seconds=REFRESH_TTL_S if remember else min(REFRESH_TTL_S, (await session_policy.get_policy(db, org_of(op)))["max_hours"] * 3600)),
        remember=remember,
        method=method or "",
    ))
    is_admin, _, roles = await effective_access(db, op)
    role = "Admin" if is_admin else (roles[0].name if roles else "Operator")
    return {"access_token": create_access_token(op.id, org_of(op), role, sid), "refresh_token": refresh, "token_type": "bearer", "remember": remember}


async def _require_admin_or_team(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if not (ctx["is_admin"] or P.allows(ctx["perms"], "team", P.FULL)):
        raise HTTPException(status_code=403, detail="Only admins can manage users and roles.")
    return ctx


async def _get_user(db: AsyncSession, user_id: str, org_id: str) -> Operator:
    op = (await db.execute(select(Operator).where(Operator.id == user_id))).scalars().first()
    if not op or org_of(op) != org_id:
        raise HTTPException(status_code=404, detail="User not found.")
    return op


async def _check_role_ids(db: AsyncSession, role_ids: List[str], org_id: str) -> List[Role]:
    if not role_ids:
        raise HTTPException(status_code=400, detail="Pick at least one role.")
    roles = (await db.execute(select(Role).where(Role.id.in_(role_ids), Role.org_id == org_id))).scalars().all()
    if len(roles) != len(set(role_ids)):
        raise HTTPException(status_code=400, detail="Unknown role.")
    return list(roles)


async def _keep_one_admin(db: AsyncSession, org_id: str, losing: str) -> None:
    if not await admins_in(db, org_id, exclude=losing):
        raise HTTPException(status_code=400, detail="The organisation needs at least one active admin. Make someone else admin first.")


async def _email_temp_password(op: Operator, password: str, welcome: bool, by: str = "") -> bool:
    """Send the sign-in details from the platform mailbox. Never fails the request."""
    from app.config import settings
    from app.core.mailer import render, send_account_email as send_system_email
    import html as _h

    link = (settings.PUBLIC_BASE_URL or "").rstrip("/") + "/"
    who = _h.escape(by) if by else "Your admin"
    if welcome:
        subject = "Your Outreach by Aivhub account"
        lines = [f"{who} added you to Outreach by Aivhub.", f"Username: <b>{_h.escape(op.username)}</b><br>Temporary password: <b>{_h.escape(password)}</b>",
                 "You will choose your own password when you first sign in."]
    else:
        subject = "Your Outreach by Aivhub password was reset"
        lines = [f"{who} reset your password.", f"Username: <b>{_h.escape(op.username)}</b><br>Temporary password: <b>{_h.escape(password)}</b>",
                 "You will choose a new password when you sign in. If you did not expect this, tell your admin."]
    msg = render(subject, lines, {"label": "Sign in", "url": link})
    res = await send_system_email(op.email or "", subject, msg["html"], msg["text"])
    return bool(res.get("ok"))


async def _security_notice(db: AsyncSession, ctx: Dict[str, Any], line: str, skip: str = "") -> None:
    """Tell the organisation's other admins about a security change. Never fails the request."""
    from app.core.notify import notify

    try:
        ids = [a.id for a in await admins_in(db, ctx["org_id"]) if a.id not in (ctx["operator_id"], skip)]
        if ids:
            await notify("security", "Security change in Outreach by Aivhub", [line], only_user_ids=ids)
    except Exception:
        pass


# ── Sign in / out ───────────────────────────────────────────────────────────
async def check_credentials(db: AsyncSession, username: str, password: str, request: Request) -> Operator:
    """The user behind a username (or email) and password, or the sign-in error. Counts failures and locks after too many."""
    username = (username or "").strip()
    key = _fail_key(username, request)
    uname = (username or "").strip().lower()
    if _locked(key):  # no account is exempt: an exemption let one Admin password be guessed without limit
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")
    # A sign-in name must point at exactly one account. If two accounts ever share it (usernames are unique everywhere, but older data
    # or an import could break that), nobody is signed in to "the first one found": the person is asked to use the other name.
    named = (await db.execute(select(Operator).where(func.lower(Operator.username) == uname).limit(2))).scalars().all()
    if len(named) > 1:
        raise HTTPException(status_code=409, detail={"message": "More than one account uses this username. Sign in with your e-mail address.",
                                                     "code": "ambiguous_login"})
    op = named[0] if named else None
    if not op and "@" in uname:
        mailed = (await db.execute(select(Operator).where(func.lower(Operator.email) == uname).limit(2))).scalars().all()
        if len(mailed) > 1:
            raise HTTPException(status_code=409, detail={"message": "More than one account uses this e-mail address. Sign in with your username.",
                                                         "code": "ambiguous_login"})
        op = mailed[0] if mailed else None
    ok, upgrade = verify_password(password or "", op.hashed_password if op else None) if op else (False, False)
    if not op or not ok:
        _FAILS[key].append(time.time())
        raise HTTPException(status_code=401, detail={"message": "Wrong email or password.", "code": "bad_credentials"})
    if op.is_active is False:
        raise HTTPException(status_code=403, detail="This account is disabled. Ask your admin.")
    _FAILS.pop(key, None)
    if upgrade:
        op.hashed_password = hash_password(password)
        from app.core.security import WEAK_LEGACY_PASSWORDS
        if password in WEAK_LEGACY_PASSWORDS:
            op.must_change_password = True
    return op


async def assert_can_sign_in(db: AsyncSession, op: Operator) -> None:
    """Raises the sign-in error when the user's account or organisation is switched off or not confirmed yet."""
    from app.models.models import Organization

    if op.is_active is False:
        raise HTTPException(status_code=403, detail="This account is disabled. Ask your admin.")
    org = (await db.execute(select(Organization).where(Organization.id == org_of(op)))).scalars().first()
    if org and org.status == "pending_verification":
        raise HTTPException(status_code=403, detail={"message": "Confirm your email first: open the link we sent you.", "code": "email_not_verified"})
    if org and org.status == "suspended":
        raise HTTPException(status_code=403, detail="This organisation is suspended. Contact support.")
    if await is_switched_off(db, op):
        raise AccessDenied(403, ACCESS_OFF_MESSAGE, "access_off")


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    from app.api.signup import brand_signin

    branded = await brand_signin(request)
    if branded is not None and not branded.get("password"):
        raise HTTPException(status_code=403, detail="Password sign-in is not available on this address. Use the sign-in method your administrator gave you.")
    op = await check_credentials(db, body.username, body.password, request)
    out = await sign_in_as(db, op, request, remember=body.remember, method="password")
    set_refresh_cookie(response, out["refresh_token"])
    return out


async def sign_in_as(db: AsyncSession, op: Operator, request: Request, remember: bool = False, method: str = "") -> Dict[str, Any]:
    """Start a session for a user who proved who they are (password or Google). `method` is checked against the company's rules."""
    from app.models.models import Organization

    if op.is_active is False:
        raise HTTPException(status_code=403, detail="This account is disabled. Ask your admin.")
    org = (await db.execute(select(Organization).where(Organization.id == org_of(op)))).scalars().first()
    if org and org.status == "pending_verification":
        raise HTTPException(status_code=403, detail="Confirm your email first: open the link we sent you.")
    if org and org.status == "suspended":
        raise HTTPException(status_code=403, detail="This organisation is suspended. Contact support.")
    await ensure_role_for(db, op)
    if await is_switched_off(db, op):
        raise AccessDenied(403, ACCESS_OFF_MESSAGE, "access_off")
    refused = await signin_refusal(db, op, method)
    if refused:
        raise HTTPException(status_code=403, detail={"message": refused, "code": "signin_method_off"})
    # The very first sign-in is marked so the home screen can greet them as new; the next sign-in clears it.
    stored = dict(op.profile or {})
    if op.last_login_at is None:
        op.profile = {**stored, "first_visit": True}
    elif stored.pop("first_visit", None):
        op.profile = stored
    op.last_login_at = datetime.utcnow()
    tokens = await _start_session(db, op, request, remember, method)
    await db.commit()
    return {**tokens, "operator": await _operator_json(db, op)}


@router.post("/refresh")
async def refresh(request: Request, response: Response, body: Optional[RefreshBody] = None, db: AsyncSession = Depends(get_db)):
    token = (body.refresh_token if body else "") or ""
    from_cookie = False
    if not token:
        token = request.cookies.get(REFRESH_COOKIE, "")
        from_cookie = bool(token)
        # A cookie is sent by the browser on its own, so a page of ours must say it is asking (SameSite=Strict does the rest).
        if from_cookie and request.headers.get("x-requested-with", "").lower() != "outreach":
            raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    claims = decode_token(token, "refresh")
    if not claims:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    ses = (await db.execute(select(AuthSession).where(AuthSession.id == claims.get("sid")))).scalars().first()
    just_rotated = bool(ses and ses.prev_refresh_jti == claims.get("jti") and ses.rotated_at
                        and (datetime.utcnow() - ses.rotated_at).total_seconds() <= ROTATION_GRACE_S)
    if not ses or ses.revoked_at or ses.expires_at < datetime.utcnow() or (ses.refresh_jti != claims.get("jti") and not just_rotated):
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    op = (await db.execute(select(Operator).where(Operator.id == ses.operator_id))).scalars().first()
    if not op or op.is_active is False:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    if await is_switched_off(db, op):
        raise AccessDenied(403, ACCESS_OFF_MESSAGE, "access_off")
    # A sign-in method the company switched off also ends the sessions it began (plan 12, B9).
    if await signin_refusal(db, op, getattr(ses, "method", "") or ""):
        ses.revoked_at = datetime.utcnow()
        await db.commit()
        raise HTTPException(status_code=401, detail="Your company's sign-in rules changed. Sign in again.")
    # A shortened maximum applies to sign-ins already open, not only new ones.
    max_s = (await session_policy.get_policy(db, org_of(op)))["max_hours"] * 3600
    if not ses.remember and ses.created_at and (datetime.utcnow() - ses.created_at).total_seconds() > max_s:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    is_admin, _, roles = await effective_access(db, op)
    access = create_access_token(op.id, org_of(op), "Admin" if is_admin else (roles[0].name if roles else "Operator"), ses.id)
    if just_rotated:
        # Another tab rotated a moment ago and its new token is already in the shared cookie: only a fresh access token is needed.
        await db.commit()
        return {"access_token": access, "token_type": "bearer", "operator": await _operator_json(db, op)}
    # Rotate the refresh token: the old one keeps working for a few seconds, then stops.
    new_refresh = create_refresh_token(op.id, ses.id)
    ses.prev_refresh_jti, ses.rotated_at = ses.refresh_jti, datetime.utcnow()
    ses.refresh_jti = decode_token(new_refresh, "refresh")["jti"]
    ses.last_used_at = datetime.utcnow()
    await db.commit()
    set_refresh_cookie(response, new_refresh)
    return {"access_token": access, "refresh_token": new_refresh, "token_type": "bearer", "operator": await _operator_json(db, op)}


@router.post("/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    clear_refresh_cookie(response)
    ctx = current(request)
    auth = request.headers.get("authorization", "")
    claims = decode_token(auth[7:], "access") if auth.lower().startswith("bearer ") else None
    if claims:
        ses = (await db.execute(select(AuthSession).where(AuthSession.id == claims.get("sid")))).scalars().first()
        if ses and not ses.revoked_at:
            ses.revoked_at = datetime.utcnow()
            await db.commit()
    forget(ctx["operator_id"])
    return {"ok": True}


@router.get("/session-policy")
async def get_session_policy(request: Request, db: AsyncSession = Depends(get_db)):
    """What applies to this user's organisation (the app signs people out by it), the platform's limits,
    what the organisation chose, and whether this user can change it."""
    ctx = current(request)
    op = await _get_user(db, ctx["operator_id"], ctx["org_id"])
    org = org_of(op)
    is_admin, _, _ = await effective_access(db, op)
    return {**await session_policy.get_policy(db, org), "platform": await session_policy.platform_policy(db),
            "mine": await session_policy.org_choice(db, org), "can_edit": bool(is_admin)}


class OrgSessionBody(BaseModel):
    idle_minutes: Optional[int] = None  # empty: use the platform's
    max_hours: Optional[int] = None


@router.put("/session-policy")
async def put_session_policy(body: OrgSessionBody, request: Request, db: AsyncSession = Depends(get_db)):
    """An organisation admin sets how long their team may sit idle and how long one sign-in lasts,
    within the platform's limits."""
    ctx = current(request)
    op = await _get_user(db, ctx["operator_id"], ctx["org_id"])
    is_admin, _, _ = await effective_access(db, op)
    if not is_admin:
        raise HTTPException(status_code=403, detail="Only an admin can change this.")
    await session_policy.save_org_choice(db, org_of(op), body.idle_minutes, body.max_hours)
    await db.commit()
    return await get_session_policy(request, db)


@router.get("/me")
async def me(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    op = await _get_user(db, ctx["operator_id"], ctx["org_id"])
    from app.services import data_access as DA

    out = await _operator_json(db, op)
    out["data_access"] = (await DA.resolve(db, ctx["org_id"], op.id)).payload()  # what this person's own limits are, so screens can explain
    return out


class MePatch(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    # first_name, last_name, job_title, timezone and the rest of app.core.profile
    profile: Optional[Dict[str, Any]] = None


@router.patch("/me")
async def update_me(body: MePatch, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    op = await _get_user(db, ctx["operator_id"], ctx["org_id"])
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=400, detail="Name cannot be empty.")
        op.name = body.name.strip()[:120]
    if body.email is not None:
        email = body.email.strip()
        if email and ("@" not in email or " " in email or len(email) > 254):
            raise HTTPException(status_code=400, detail="That email address does not look right.")
        if (email or None) != op.email:
            op.email = email or None
            op.email_verified = False
    if body.phone is not None:
        phone = body.phone.strip()
        problem = prof.phone_problem(phone)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        op.phone = phone
    if body.profile:
        try:
            fresh = prof.clean(body.profile)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        merged = {**(op.profile or {}), **prof.details(op), **fresh}  # keeps first_visit while they fill in their details
        op.profile = merged
        if ("first_name" in fresh or "last_name" in fresh) and body.name is None:
            full = f"{merged['first_name']} {merged['last_name']}".strip()
            if not full:
                raise HTTPException(status_code=400, detail="Name cannot be empty.")
            op.name = full[:120]
    await db.commit()
    forget(op.id)
    return await _operator_json(db, op)


@router.post("/me/avatar")
async def upload_my_avatar(request: Request, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    op = await _get_user(db, ctx["operator_id"], ctx["org_id"])
    raw = await file.read(prof.AVATAR_MAX_BYTES + 1)
    try:
        data = prof.make_avatar(raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    old = op.avatar_file
    op.avatar_file = prof.save_avatar(data)
    await db.commit()
    prof.delete_avatar(old)
    forget(op.id)
    return await _operator_json(db, op)


@router.delete("/me/avatar")
async def remove_my_avatar(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    op = await _get_user(db, ctx["operator_id"], ctx["org_id"])
    old, op.avatar_file = op.avatar_file, None
    await db.commit()
    prof.delete_avatar(old)
    forget(op.id)
    return await _operator_json(db, op)


def _my_session_id(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    claims = decode_token(auth[7:], "access") if auth.lower().startswith("bearer ") else None
    return (claims or {}).get("sid", "")


@router.get("/me/sessions")
async def my_sessions(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    mine = _my_session_id(request)
    rows = (await db.execute(
        select(AuthSession).where(
            AuthSession.operator_id == ctx["operator_id"],
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > datetime.utcnow(),
        ).order_by(AuthSession.last_used_at.desc())
    )).scalars().all()
    return [{
        "id": r.id,
        "device": r.user_agent or "Unknown device",
        "ip": r.ip or "",
        "signed_in_at": r.created_at.isoformat() if r.created_at else None,
        "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
        "current": r.id == mine,
    } for r in rows]


@router.delete("/me/sessions/{session_id}")
async def end_my_session(session_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    ses = (await db.execute(select(AuthSession).where(AuthSession.id == session_id, AuthSession.operator_id == ctx["operator_id"]))).scalars().first()
    if not ses:
        raise HTTPException(status_code=404, detail="That device is not signed in any more.")
    ses.revoked_at = ses.revoked_at or datetime.utcnow()
    await db.commit()
    forget(ctx["operator_id"])
    return {"ok": True}


@router.post("/me/sessions/sign-out-others")
async def end_my_other_sessions(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    mine = _my_session_id(request)
    rows = (await db.execute(select(AuthSession).where(
        AuthSession.operator_id == ctx["operator_id"], AuthSession.revoked_at.is_(None), AuthSession.id != mine,
    ))).scalars().all()
    now = datetime.utcnow()
    for r in rows:
        r.revoked_at = now
    await db.commit()
    forget(ctx["operator_id"])
    return {"ok": True, "signed_out": len(rows)}


@router.post("/change-password")
async def change_password(body: ChangePasswordBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    op = await _get_user(db, ctx["operator_id"], ctx["org_id"])
    ok, _ = verify_password(body.current_password or "", op.hashed_password)
    if not ok:
        raise HTTPException(status_code=400, detail="Your current password is not right.")
    problem = password_problem(body.new_password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="Pick a password different from the current one.")
    op.hashed_password = hash_password(body.new_password)
    op.must_change_password = False
    op.password_changed_at = datetime.utcnow()
    await db.commit()
    forget(op.id)
    return await _operator_json(db, op)


class NotifyBody(BaseModel):
    events: Dict[str, bool]


async def _notify_state(db: AsyncSession, op: Operator) -> Dict[str, Any]:
    from app.core import mailer, notify

    is_admin, _, _ = await effective_access(db, op)
    prefs = notify.effective_prefs(op.notify_prefs, is_admin)
    return {
        "email": op.email or "",
        "mailboxReady": mailer.configured(),
        "events": [{"key": k, "label": label, "on": prefs[k]} for k, label, _ in notify.EVENTS],
    }


@router.get("/me/notifications")
async def my_notifications(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    op = await _get_user(db, ctx["operator_id"], ctx["org_id"])
    return await _notify_state(db, op)


@router.put("/me/notifications")
async def set_my_notifications(body: NotifyBody, request: Request, db: AsyncSession = Depends(get_db)):
    from app.core import notify

    ctx = current(request)
    op = await _get_user(db, ctx["operator_id"], ctx["org_id"])
    op.notify_prefs = {k: bool(v) for k, v in body.events.items() if k in notify.EVENT_KEYS}
    await db.commit()
    return await _notify_state(db, op)


# ── Sections, roles ─────────────────────────────────────────────────────────
@router.get("/sections")
async def sections(request: Request):
    current(request)
    return [{"key": k, "label": label, "group": group, "description": desc} for k, label, group, desc in P.SECTIONS]


@router.get("/roles")
async def list_roles(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    await ensure_system_roles(db, ctx["org_id"])
    await db.commit()
    roles = (await db.execute(select(Role).where(Role.org_id == ctx["org_id"]).order_by(Role.is_admin.desc(), Role.name))).scalars().all()
    counts = dict((await db.execute(
        select(OperatorRole.role_id, func.count()).group_by(OperatorRole.role_id)
    )).all())
    return [
        {
            "id": r.id, "name": r.name, "description": r.description or "", "is_admin": bool(r.is_admin),
            "is_system": bool(r.is_system), "levels": P.merge([r.levels or {}], bool(r.is_admin)),
            "users": int(counts.get(r.id, 0)), "is_active": r.is_active is not False,
        }
        for r in roles
    ]


def _clean_levels(levels: Dict[str, str]) -> Dict[str, str]:
    return {k: P.clean_level((levels or {}).get(k)) for k in P.SECTION_KEYS}


@router.post("/roles")
async def create_role(body: RoleBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Give the role a name.")
    if (await db.execute(select(Role).where(Role.org_id == ctx["org_id"], func.lower(Role.name) == name.lower()))).scalars().first():
        raise HTTPException(status_code=400, detail="A role with this name already exists.")
    if body.is_admin and not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can create admin roles.")
    role = Role(id=f"role_{uuid.uuid4().hex[:12]}", org_id=ctx["org_id"], name=name, description=body.description,
                is_admin=body.is_admin, is_system=False, levels=_clean_levels(body.levels))
    db.add(role)
    await audit.record(db, "role.created", target=role.id,
                       detail={"name": name, "description": body.description or "", "is_admin": bool(body.is_admin),
                               "levels": {k: v for k, v in (role.levels or {}).items() if v != P.NONE}},
                       actor_id=ctx["operator_id"], actor_name=ctx.get("name", ""))
    await db.commit()
    forget()
    return {"id": role.id}


async def _active_roles(db: AsyncSession, operator_id: str, without: str = "") -> List[Role]:
    return [r for r in await roles_of(db, operator_id) if r.is_active is not False and r.id != without]


async def _check_role_switch_off(db: AsyncSession, ctx: Dict[str, Any], role: Role) -> None:
    """Refuses a switch-off that would leave the organisation, or the person doing it, without a way in as admin."""
    if role.is_system and role.is_admin:
        raise HTTPException(status_code=400, detail="You can't switch this off: the Admin role must stay on.")
    if role.is_admin:
        left = [o for o in await admins_in(db, ctx["org_id"])
                if any(r.is_admin for r in await _active_roles(db, o.id, without=role.id))]
        if not left:
            raise HTTPException(status_code=400, detail="You can't switch this off: it would leave no active admin.")
        if not any(r.is_admin for r in await _active_roles(db, ctx["operator_id"], without=role.id)):
            raise HTTPException(status_code=400, detail="You can't switch this off: it is your only way in as an admin.")
    if not await _active_roles(db, ctx["operator_id"], without=role.id):
        raise HTTPException(status_code=400, detail="You can't switch this off: it would lock you out.")


@router.put("/roles/{role_id}")
async def update_role(role_id: str, body: RolePatch, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    role = (await db.execute(select(Role).where(Role.id == role_id, Role.org_id == ctx["org_id"]))).scalars().first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found.")
    # Only the provided fields change, so {"is_active": false} alone switches a role off.
    is_admin_new = role.is_admin if body.is_admin is None else body.is_admin
    if (role.is_admin or is_admin_new) and not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can change admin roles.")
    if body.is_active is not None and not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can switch roles on or off.")
    if role.is_admin and not is_admin_new:
        holders = [o.id for o in await admins_in(db, ctx["org_id"])]
        still = [h for h in holders if any(r.is_admin and r.id != role.id for r in await _active_roles(db, h))]
        if not still:
            raise HTTPException(status_code=400, detail="This is the last admin role in use. Keep it admin.")
    old_active = role.is_active is not False
    old_description, old_is_admin = role.description, bool(role.is_admin)
    if body.is_active is not None and old_active and not body.is_active:
        await _check_role_switch_off(db, ctx, role)
    changes: Dict[str, Any] = {}
    old_name = role.name
    if body.name is not None and not role.is_system:
        role.name = body.name.strip() or role.name
    if body.description is not None:
        role.description = body.description
    role.is_admin = is_admin_new
    if body.levels is not None:
        old_levels = P.merge([role.levels or {}], False)
        role.levels = _clean_levels(body.levels)
        moved = {k: {"from": old_levels.get(k, P.NONE), "to": v} for k, v in role.levels.items() if old_levels.get(k, P.NONE) != v}
        if moved:
            changes["levels"] = moved
    if role.name != old_name:
        changes["name"] = {"from": old_name, "to": role.name}
    if body.description is not None and (body.description or "") != (old_description or ""):
        changes["description"] = {"from": old_description or "", "to": body.description or ""}
    if bool(role.is_admin) != old_is_admin:
        changes["is_admin"] = {"from": old_is_admin, "to": bool(role.is_admin)}
    if changes:
        await audit.record(db, "role.updated", target=role.id, detail={"name": role.name, "changes": changes},
                           actor_id=ctx["operator_id"], actor_name=ctx.get("name", ""))
    if body.is_active is not None and old_active != bool(body.is_active):
        role.is_active = bool(body.is_active)
        await audit.record(db, "role.activated" if body.is_active else "role.deactivated", target=role.id,
                           detail={"name": role.name, "old": old_active, "new": bool(body.is_active)},
                           actor_id=ctx["operator_id"], actor_name=ctx.get("name", ""))
    await db.commit()
    forget()
    return {"ok": True, "is_active": role.is_active is not False}


@router.delete("/roles/{role_id}")
async def delete_role(role_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    role = (await db.execute(select(Role).where(Role.id == role_id, Role.org_id == ctx["org_id"]))).scalars().first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found.")
    if role.is_system and role.is_admin:
        raise HTTPException(status_code=400, detail="The Admin role cannot be deleted: every account keeps one.")
    in_use = (await db.execute(select(func.count()).select_from(OperatorRole).where(OperatorRole.role_id == role.id))).scalar()
    if in_use:
        raise HTTPException(status_code=400, detail=f"{in_use} user(s) still have this role. Move them first.")
    await audit.record(db, "role.deleted", target=role.id, detail={"name": role.name},
                       actor_id=ctx["operator_id"], actor_name=ctx.get("name", ""))
    await db.delete(role)
    await db.commit()
    return {"ok": True}


# ── Users ───────────────────────────────────────────────────────────────────
@router.get("/users")
async def list_users(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    ops = (await db.execute(select(Operator).order_by(Operator.created_at.asc()))).scalars().all()
    return [await _operator_json(db, o) for o in ops if org_of(o) == ctx["org_id"]]


@router.post("/users")
async def create_user(body: UserBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    username = body.username.strip().lower()
    if not username or not body.name.strip():
        raise HTTPException(status_code=400, detail="Name and username are required.")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", (body.email or "").strip()):
        raise HTTPException(status_code=400, detail="An email address is required: it is where their sign-in details are sent.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,31}", username):
        raise HTTPException(status_code=400, detail="Username: 3 to 32 letters, numbers, dots, dashes or underscores. No spaces.")
    if (await db.execute(select(Operator).where(func.lower(Operator.username) == username))).scalars().first():
        raise HTTPException(status_code=400, detail="This username is taken.")
    email = (body.email or "").strip().lower()
    if email and (await db.execute(select(Operator).where((func.lower(Operator.email) == email) | (func.lower(Operator.username) == email)))).scalars().first():
        raise HTTPException(status_code=400, detail="This e-mail address is already used by another account.")
    from app.services import plan_rules

    seats = await plan_rules.limit("users", ctx["org_id"])
    if seats:
        active = (await db.execute(select(func.count()).select_from(Operator).where(Operator.org_id == ctx["org_id"], Operator.is_active.is_not(False)))).scalar() or 0
        if active >= seats:
            raise HTTPException(status_code=403, detail=plan_rules.limit_message("users", seats))
    roles_by_name = await ensure_system_roles(db, ctx["org_id"])
    if body.role_ids:
        role_ids = body.role_ids
    else:  # the role the label names, else the Operator starter role if it still exists; an account that deleted it must choose
        named = next((r for r in roles_by_name.values() if r.name.lower() == (body.role or "Operator").strip().lower()), None) or roles_by_name.get("Operator")
        if named is None:
            raise HTTPException(status_code=400, detail="Choose a role for this user.")
        role_ids = [named.id]
    roles = await _check_role_ids(db, role_ids, ctx["org_id"])
    if any(r.is_admin for r in roles) and not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can create admins.")
    temp = None
    if body.password:
        problem = password_problem(body.password)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        pw = body.password
    else:
        temp = pw = temporary_password()
    op = Operator(
        id=f"op_{uuid.uuid4().hex[:10]}",
        org_id=ctx["org_id"],
        username=username,
        name=body.name.strip(),
        email=(body.email or "").strip() or None,
        role="Admin" if any(r.is_admin for r in roles) else roles[0].name,
        hashed_password=hash_password(pw),
        must_change_password=True,
        is_active=True,
    )
    db.add(op)
    await db.flush()
    await assign_roles(db, op, role_ids)
    await audit.record(db, "user.created", target=op.id,
                       detail={"name": op.name, "username": op.username, "email": op.email or "", "roles": [r.name for r in roles]},
                       actor_id=ctx["operator_id"], actor_name=ctx.get("name", ""))
    await db.commit()
    out = await _operator_json(db, op)
    out["temporary_password"] = temp  # shown once to the admin
    out["emailed"] = await _email_temp_password(op, pw, welcome=True, by=ctx.get("name", "")) if op.email else False
    return out


@router.patch("/users/{user_id}")
async def update_user(user_id: str, body: UserPatch, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    op = await _get_user(db, user_id, ctx["org_id"])
    disabled_notice = False
    was_admin, _, _ = await effective_access(db, op)
    if was_admin and not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can change an admin.")
    changes: Dict[str, Any] = {}
    if body.name is not None and body.name.strip():
        if op.name != body.name.strip():
            changes["name"] = {"from": op.name, "to": body.name.strip()}
        op.name = body.name.strip()
    if body.email is not None:
        if (op.email or "") != (body.email.strip() or ""):
            changes["email"] = {"from": op.email or "", "to": body.email.strip()}
        op.email = body.email.strip() or None
    if body.role_ids is not None:
        roles = await _check_role_ids(db, body.role_ids, ctx["org_id"])
        before = [r.name for r in await roles_of(db, op.id)]
        after = [r.name for r in roles]
        if set(before) != set(after):
            changes["roles"] = {"added": [n for n in after if n not in before], "removed": [n for n in before if n not in after]}
        becomes_admin = any(r.is_admin for r in roles)
        if becomes_admin and not ctx["is_admin"]:
            raise HTTPException(status_code=403, detail="Only admins can make someone admin.")
        if was_admin and not becomes_admin:
            await _keep_one_admin(db, ctx["org_id"], op.id)
        await assign_roles(db, op, body.role_ids)
        op.role = "Admin" if becomes_admin else roles[0].name
    if body.is_active is not None:
        if not body.is_active:
            if op.id == ctx["operator_id"]:
                raise HTTPException(status_code=400, detail="You cannot disable your own account.")
            if was_admin:
                await _keep_one_admin(db, ctx["org_id"], op.id)
            # Signing out everywhere.
            for ses in (await db.execute(select(AuthSession).where(AuthSession.operator_id == op.id, AuthSession.revoked_at.is_(None)))).scalars().all():
                ses.revoked_at = datetime.utcnow()
        if op.is_active is not False and not body.is_active:
            disabled_notice = True
        if (op.is_active is not False) != bool(body.is_active):
            await audit.record(db, "user.activated" if body.is_active else "user.deactivated", target=op.id,
                               detail={"username": op.username, "old": op.is_active is not False, "new": bool(body.is_active)},
                               actor_id=ctx["operator_id"], actor_name=ctx.get("name", ""))
        op.is_active = body.is_active
    if changes:
        await audit.record(db, "user.updated", target=op.id, detail={"name": op.name, "username": op.username, "changes": changes},
                           actor_id=ctx["operator_id"], actor_name=ctx.get("name", ""))
    if body.grants is not None:
        await db.execute(delete(OperatorGrant).where(OperatorGrant.operator_id == op.id))
        for section, level in body.grants.items():
            level = P.clean_level(level)
            if section in P.SECTION_KEYS and level != P.NONE:
                db.add(OperatorGrant(operator_id=op.id, section=section, level=level, granted_by=ctx["operator_id"]))
    await db.commit()
    forget(op.id)
    if disabled_notice:
        await _security_notice(db, ctx, f"{op.name} ({op.username}) was disabled by {ctx.get('name') or 'an admin'}.")
    return await _operator_json(db, op)


@router.post("/users/{user_id}/reset-password")
async def reset_password(user_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    op = await _get_user(db, user_id, ctx["org_id"])
    is_admin, _, _ = await effective_access(db, op)
    if is_admin and not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can reset an admin's password.")
    temp = temporary_password()
    op.hashed_password = hash_password(temp)
    op.must_change_password = True
    for ses in (await db.execute(select(AuthSession).where(AuthSession.operator_id == op.id, AuthSession.revoked_at.is_(None)))).scalars().all():
        ses.revoked_at = datetime.utcnow()
    await db.commit()
    forget(op.id)
    emailed = await _email_temp_password(op, temp, welcome=False, by=ctx.get("name", "")) if op.email else False
    await _security_notice(db, ctx, f"The password of {op.name} ({op.username}) was reset by {ctx.get('name') or 'an admin'}.", skip=op.id)
    return {"temporary_password": temp, "emailed": emailed}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    op = await _get_user(db, user_id, ctx["org_id"])
    if op.id == ctx["operator_id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    was_admin, _, _ = await effective_access(db, op)
    if was_admin:
        if not ctx["is_admin"]:
            raise HTTPException(status_code=403, detail="Only admins can delete an admin.")
        await _keep_one_admin(db, ctx["org_id"], op.id)
    name, username = op.name, op.username
    await audit.record(db, "user.deleted", target=op.id, detail={"name": name, "username": username, "roles": [r.name for r in await roles_of(db, op.id)]},
                       actor_id=ctx["operator_id"], actor_name=ctx.get("name", ""))
    for model in (AuthSession, OperatorGrant, OperatorRole):
        await db.execute(delete(model).where(model.operator_id == op.id))
    await db.delete(op)
    await db.commit()
    forget(op.id)
    await _security_notice(db, ctx, f"{name} ({username}) was deleted by {ctx.get('name') or 'an admin'}.", skip=user_id)
    return {"ok": True}


# ── Sharing one section (e.g. Analytics) ────────────────────────────────────
class ShareBody(BaseModel):
    section: str
    user_levels: Dict[str, str] = {}  # user id -> none | view | full


@router.get("/share/{section}")
async def share_state(section: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    if section not in P.SECTION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown section.")
    out = []
    for op in (await db.execute(select(Operator).order_by(Operator.name))).scalars().all():
        if org_of(op) != ctx["org_id"]:
            continue
        is_admin, perms, roles = await effective_access(db, op)
        direct = (await db.execute(select(OperatorGrant).where(OperatorGrant.operator_id == op.id, OperatorGrant.section == section))).scalars().first()
        out.append({
            "id": op.id, "name": op.name, "username": op.username, "is_admin": is_admin,
            "is_active": op.is_active is not False, "level": perms.get(section, P.NONE),
            "direct": direct.level if direct else P.NONE, "roles": [r.name for r in roles],
        })
    return out


@router.put("/share")
async def share(body: ShareBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    if body.section not in P.SECTION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown section.")
    for user_id, level in body.user_levels.items():
        op = await _get_user(db, user_id, ctx["org_id"])
        await db.execute(delete(OperatorGrant).where(OperatorGrant.operator_id == op.id, OperatorGrant.section == body.section))
        level = P.clean_level(level)
        if level != P.NONE:
            db.add(OperatorGrant(operator_id=op.id, section=body.section, level=level, granted_by=ctx["operator_id"]))
        forget(op.id)
    await db.commit()
    return {"ok": True}
