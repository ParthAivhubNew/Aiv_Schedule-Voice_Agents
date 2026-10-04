"""Sign in, sessions, passwords, users and roles."""
from __future__ import annotations

import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Any, Deque, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core import permissions as P
from app.core.accounts import (
    admins_in,
    assign_roles,
    effective_access,
    ensure_role_for,
    ensure_system_roles,
    org_of,
    roles_of,
)
from app.core.auth_middleware import current, forget
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
from app.models.models import AuthSession, Operator, OperatorGrant, OperatorRole, Role

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


class RefreshBody(BaseModel):
    refresh_token: str


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


# ── Helpers ─────────────────────────────────────────────────────────────────
async def _operator_json(db: AsyncSession, op: Operator) -> Dict[str, Any]:
    is_admin, perms, roles = await effective_access(db, op)
    grants = {g.section: g.level for g in (await db.execute(select(OperatorGrant).where(OperatorGrant.operator_id == op.id))).scalars().all()}
    return {
        "id": op.id,
        "username": op.username,
        "name": op.name,
        "email": op.email,
        "role": "Admin" if is_admin else (roles[0].name if roles else (op.role or "Operator")),
        "roles": [{"id": r.id, "name": r.name, "is_admin": bool(r.is_admin)} for r in roles],
        "is_admin": is_admin,
        "permissions": perms,
        "grants": grants,
        "is_active": op.is_active is not False,
        "must_change_password": bool(op.must_change_password),
        "last_login_at": op.last_login_at.isoformat() if op.last_login_at else None,
        "org_id": org_of(op),
        # Outreach's own organisation runs the AI/telephony provider settings; clients never see them.
        "is_platform_org": org_of(op) == __import__("app.core.platform", fromlist=["x"]).platform_org_id(),
    }


async def _start_session(db: AsyncSession, op: Operator, request: Request) -> Dict[str, str]:
    sid = f"ses_{uuid.uuid4().hex}"
    refresh = create_refresh_token(op.id, sid)
    claims = decode_token(refresh, "refresh")
    db.add(AuthSession(
        id=sid,
        operator_id=op.id,
        refresh_jti=claims["jti"],
        user_agent=(request.headers.get("user-agent") or "")[:300],
        ip=request.client.host if request.client else "",
        expires_at=datetime.utcnow() + timedelta(seconds=REFRESH_TTL_S),
    ))
    is_admin, _, roles = await effective_access(db, op)
    role = "Admin" if is_admin else (roles[0].name if roles else "Operator")
    return {"access_token": create_access_token(op.id, org_of(op), role, sid), "refresh_token": refresh, "token_type": "bearer"}


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
    from app.core.mailer import render, send_system_email
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
@router.post("/login")
async def login(body: LoginBody, request: Request, db: AsyncSession = Depends(get_db)):
    username = (body.username or "").strip()
    key = _fail_key(username, request)
    if _locked(key):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")
    op = (await db.execute(
        select(Operator).where(func.lower(Operator.username) == username.lower())
    )).scalars().first()
    if not op and "@" in username:
        op = (await db.execute(select(Operator).where(func.lower(Operator.email) == username.lower()))).scalars().first()
    ok, upgrade = verify_password(body.password or "", op.hashed_password if op else None) if op else (False, False)
    if not op or not ok:
        _FAILS[key].append(time.time())
        raise HTTPException(status_code=401, detail={"message": "Wrong email or password.", "code": "bad_credentials"})
    if op.is_active is False:
        raise HTTPException(status_code=403, detail="This account is disabled. Ask your admin.")
    _FAILS.pop(key, None)
    if upgrade:
        op.hashed_password = hash_password(body.password)
        from app.core.security import WEAK_LEGACY_PASSWORDS
        if body.password in WEAK_LEGACY_PASSWORDS:
            op.must_change_password = True
    return await sign_in_as(db, op, request)


async def sign_in_as(db: AsyncSession, op: Operator, request: Request) -> Dict[str, Any]:
    """Start a session for a user who proved who they are (password or Google)."""
    from app.models.models import Organization

    if op.is_active is False:
        raise HTTPException(status_code=403, detail="This account is disabled. Ask your admin.")
    org = (await db.execute(select(Organization).where(Organization.id == org_of(op)))).scalars().first()
    if org and org.status == "pending_verification":
        raise HTTPException(status_code=403, detail="Confirm your email first: open the link we sent you.")
    if org and org.status == "suspended":
        raise HTTPException(status_code=403, detail="This organisation is suspended. Contact support.")
    await ensure_role_for(db, op)
    op.last_login_at = datetime.utcnow()
    tokens = await _start_session(db, op, request)
    await db.commit()
    return {**tokens, "operator": await _operator_json(db, op)}


@router.post("/refresh")
async def refresh(body: RefreshBody, db: AsyncSession = Depends(get_db)):
    claims = decode_token(body.refresh_token or "", "refresh")
    if not claims:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    ses = (await db.execute(select(AuthSession).where(AuthSession.id == claims.get("sid")))).scalars().first()
    if not ses or ses.revoked_at or ses.expires_at < datetime.utcnow() or ses.refresh_jti != claims.get("jti"):
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    op = (await db.execute(select(Operator).where(Operator.id == ses.operator_id))).scalars().first()
    if not op or op.is_active is False:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    # Rotate the refresh token: the old one stops working.
    new_refresh = create_refresh_token(op.id, ses.id)
    ses.refresh_jti = decode_token(new_refresh, "refresh")["jti"]
    ses.last_used_at = datetime.utcnow()
    is_admin, _, roles = await effective_access(db, op)
    access = create_access_token(op.id, org_of(op), "Admin" if is_admin else (roles[0].name if roles else "Operator"), ses.id)
    await db.commit()
    return {"access_token": access, "refresh_token": new_refresh, "token_type": "bearer", "operator": await _operator_json(db, op)}


@router.post("/logout")
async def logout(request: Request, db: AsyncSession = Depends(get_db)):
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


@router.get("/me")
async def me(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    op = await _get_user(db, ctx["operator_id"], ctx["org_id"])
    return await _operator_json(db, op)


class MePatch(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


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
    await db.commit()
    forget(op.id)
    return await _operator_json(db, op)


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
            "users": int(counts.get(r.id, 0)),
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
    await db.commit()
    forget()
    return {"id": role.id}


@router.put("/roles/{role_id}")
async def update_role(role_id: str, body: RoleBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    role = (await db.execute(select(Role).where(Role.id == role_id, Role.org_id == ctx["org_id"]))).scalars().first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found.")
    if (role.is_admin or body.is_admin) and not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can change admin roles.")
    if role.is_admin and not body.is_admin:
        holders = [o.id for o in await admins_in(db, ctx["org_id"])]
        still = [h for h in holders if any(r.is_admin and r.id != role.id for r in await roles_of(db, h))]
        if not still:
            raise HTTPException(status_code=400, detail="This is the last admin role in use. Keep it admin.")
    if not role.is_system:
        role.name = body.name.strip() or role.name
    role.description = body.description
    role.is_admin = body.is_admin
    role.levels = _clean_levels(body.levels)
    await db.commit()
    forget()
    return {"ok": True}


@router.delete("/roles/{role_id}")
async def delete_role(role_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await _require_admin_or_team(request)
    role = (await db.execute(select(Role).where(Role.id == role_id, Role.org_id == ctx["org_id"]))).scalars().first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found.")
    if role.is_system:
        raise HTTPException(status_code=400, detail="Starter roles cannot be deleted. Change their access instead.")
    in_use = (await db.execute(select(func.count()).select_from(OperatorRole).where(OperatorRole.role_id == role.id))).scalar()
    if in_use:
        raise HTTPException(status_code=400, detail=f"{in_use} user(s) still have this role. Move them first.")
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
    if (await db.execute(select(Operator).where(func.lower(Operator.username) == username))).scalars().first():
        raise HTTPException(status_code=400, detail="This username is taken.")
    roles_by_name = await ensure_system_roles(db, ctx["org_id"])
    role_ids = body.role_ids or [roles_by_name.get((body.role or "Operator").title(), roles_by_name["Operator"]).id]
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
    if body.name is not None and body.name.strip():
        op.name = body.name.strip()
    if body.email is not None:
        op.email = body.email.strip() or None
    if body.role_ids is not None:
        roles = await _check_role_ids(db, body.role_ids, ctx["org_id"])
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
        op.is_active = body.is_active
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
