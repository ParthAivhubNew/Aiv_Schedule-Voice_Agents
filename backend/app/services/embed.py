"""Embedded Outreach screens inside a partner's own software.

A partner's server asks for an embed token with its secret key (psk_...). The token is tied to one partner link (one
partner, one Outreach account), one component and one access level, and lives a few minutes. Our own pages inside the
iframe send it as a Bearer token. The sign-in middleware turns it into a context that can reach only that component's API
paths, and only while the link is active and the partner is not suspended.
"""
from __future__ import annotations

import re
import secrets
import time
from contextvars import ContextVar
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import event

from app.core import permissions as P
from app.core.security import _encode, decode_token, hash_api_key
from app.models.models import CreditEntry

TOKEN_TYPE = "embed"
TOKEN_TTL_S = 900
SECRET_PREFIX = "psk_"

_SHARED = r"credits/(?:leads|wallet)|profile/org|billing/access|embed/session"  # what is left in a wallet, never the full credit ledger


def _screen(write_sections, write_paths, read_sections=(), read_paths=""):
    """(sections it may change, sections it may only read, API paths it may call, API paths it may only read)."""
    return (tuple(write_sections), tuple(read_sections), re.compile(rf"^/({write_paths}|{_SHARED})(/|$)"),
            re.compile(rf"^/({read_paths})(/|$)") if read_paths else None)


_LEADS = "leads|enrichment|contacts|together"
_VOICE = "calls|prospects|missions|schedule|meetings|conversation-templates|voices|numbers|calcom|voice-studio|call-lists|meeting-links"
# screen -> what it may call, relative to /api. The Leads app loads its lists and its mail together, so each screen may also
# read (never change) the other's data; everything else is refused.
COMPONENTS: Dict[str, Tuple] = {
    "leads": _screen(("leadgen",), _LEADS, ("email",), "email"),
    "campaigns": _screen(("leadgen", "email"), _LEADS + "|email"),
    "mail": _screen(("email",), "email", ("leadgen",), _LEADS),
    "voice": _screen(("calling", "calcom"), _VOICE, ("leadgen",), _LEADS),
    "social": _screen(("scheduler",), "scheduler|social", (), "together|profile/sources"),
}
ACCESS = ("full", "view")
# component -> the pages of the app it shows (the app hides every other page of its menu)
VIEWS: Dict[str, List[str]] = {
    "leads": ["find_leads", "lists"],
    "campaigns": ["lists", "outreach", "mailboxes"],
    "mail": ["mail", "mailboxes"],
    "voice": [],
    "social": [],
}
_PUBLIC_EMAIL = re.compile(r"^/email/(u|o)/")  # signed links keep their own rules and never come through an embed

_CACHE: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}
_CACHE_TTL_S = 5.0


def new_secret(live: bool) -> Tuple[str, str, str]:
    """(raw, prefix, hash) for a partner's secret key."""
    raw = f"{SECRET_PREFIX}{'live' if live else 'test'}_{secrets.token_hex(20)}"
    return raw, raw[:16], hash_api_key(raw)


def is_secret(token: str) -> bool:
    return (token or "").startswith(SECRET_PREFIX)


def mint(link_id: str, partner_id: str, org_id: str, component: str, access: str = "full", ttl_s: int = TOKEN_TTL_S) -> Tuple[str, int]:
    """(token, expires_at as a unix time)."""
    ttl = max(60, min(int(ttl_s or TOKEN_TTL_S), 3600))
    token = _encode({"sub": link_id, "ptr": partner_id, "org": org_id, "cmp": component, "acc": access, "typ": TOKEN_TYPE}, ttl)
    return token, int(time.time()) + ttl


CONNECT_TYPE = "embed_connect"
CONNECT_TTL_S = 900


def mint_connect(partner_id: str, external_id: str, component: str, access: str) -> Tuple[str, int]:
    """A token for the connect screen: it lets one person link their Outreach account to this partner, once, within 15 minutes."""
    token = _encode({"sub": partner_id, "ext": external_id, "cmp": component, "acc": access, "typ": CONNECT_TYPE, "jti": secrets.token_hex(8)},
                    CONNECT_TTL_S)
    return token, int(time.time()) + CONNECT_TTL_S


def read_connect(token: str) -> Optional[Dict[str, Any]]:
    claims = decode_token(token, CONNECT_TYPE) if token else None
    if not claims or claims.get("cmp") not in COMPONENTS or claims.get("acc") not in ACCESS or not claims.get("ext"):
        return None
    return claims


# The partner whose embedded screen is making this request: stamped on the credit lines it causes.
_partner_var: ContextVar[Optional[str]] = ContextVar("embed_partner", default=None)


def partner_scope(partner_id: str):
    class _Scope:
        def __enter__(self):
            self._t = _partner_var.set(partner_id)

        def __exit__(self, *exc):
            _partner_var.reset(self._t)

    return _Scope()


@event.listens_for(CreditEntry, "before_insert")
def _stamp_credit_line(mapper, connection, target):
    """Every credit line records who is charged. Today that is the organisation that used it; a line caused by a
    partner's embedded screen also names the partner."""
    from app.core.tenancy import current_org

    if target.partner_id is None:
        target.partner_id = _partner_var.get()
    if target.payer_org_id is None:
        target.payer_org_id = target.org_id or current_org()


def forget() -> None:
    """A link was revoked or a partner paused: stop honouring tokens at once on this server."""
    _CACHE.clear()


def may_use(ctx: Dict[str, Any], rel_path: str, method: str) -> bool:
    """Whether this embed token may call the path: only its component's paths, and only reads when the access is view."""
    _, _, writable, readable = COMPONENTS[ctx["component"]]
    if _PUBLIC_EMAIL.match(rel_path):
        return False
    read = method in ("GET", "HEAD")
    if writable.match(rel_path):
        return ctx["access"] == "full" or read
    return bool(read and readable is not None and readable.match(rel_path))


async def context(token: str) -> Optional[Dict[str, Any]]:
    """The sign-in context for an embed token, or None when it is invalid, expired, revoked or its partner is paused."""
    claims = decode_token(token, TOKEN_TYPE) if token and not is_secret(token) else None
    if not claims or claims.get("cmp") not in COMPONENTS:
        return None
    now = time.time()
    hit = _CACHE.get(token)
    if hit and hit[0] > now:
        return hit[1]
    ctx = await _load(claims)
    _CACHE[token] = (now + _CACHE_TTL_S, ctx)
    if len(_CACHE) > 5000:
        _CACHE.clear()
    return ctx


async def _load(claims: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    from sqlalchemy import text
    from sqlalchemy.future import select

    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import Partner, PartnerLink

    with system_scope():
        async with AsyncSessionLocal() as db:
            link = (await db.execute(select(PartnerLink).where(PartnerLink.id == claims["sub"]))).scalars().first()
            if link is None or link.status != "active" or link.partner_id != claims.get("ptr") or link.org_id != claims.get("org"):
                return None
            partner = await db.get(Partner, link.partner_id)
            if partner is None or partner.status == "suspended":
                return None
            org_status = (await db.execute(text("SELECT status FROM organizations WHERE id = :i"), {"i": link.org_id})).scalar()
            if org_status in ("suspended", "pending_verification"):  # a new account that has not confirmed its email is not usable yet
                return None
            link.last_login_at = datetime.utcnow()
            try:
                await db.commit()
            except Exception:
                await db.rollback()
    component, access = claims["cmp"], claims.get("acc") if claims.get("acc") in ACCESS else "view"
    level = P.FULL if access == "full" else P.VIEW
    perms = {section: P.NONE for section in P.SECTION_KEYS}
    perms.update({section: P.VIEW for section in COMPONENTS[component][1]})
    perms.update({section: level for section in COMPONENTS[component][0]})
    return {
        "type": "embed", "link_id": link.id, "partner_id": partner.id, "org_id": link.org_id, "component": component, "access": access,
        "test": partner.status != "live", "operator_id": link.operator_id or "embed_client", "username": f"embed:{partner.client_id}",
        "name": partner.name, "email": "", "is_admin": False, "perms": perms, "roles": [], "must_change_password": False,
    }


async def partner_for_secret(raw: str) -> Optional[Any]:
    """The partner that owns this secret key (a live key needs a live partner, a test key a sandbox one)."""
    from sqlalchemy.future import select

    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import Partner

    if not is_secret(raw):
        return None
    with system_scope():
        async with AsyncSessionLocal() as db:
            p = (await db.execute(select(Partner).where(Partner.secret_hash == hash_api_key(raw)))).scalars().first()
    if p is None or not p.secret_hash or (raw.startswith("psk_live_") and p.status != "live") or (raw.startswith("psk_test_") and p.status == "live"):
        return None
    return p


def frame_ancestors(origins: Optional[List[str]]) -> str:
    """The Content-Security-Policy frame-ancestors value for a partner: its own web addresses, or nobody."""
    clean = [o for o in (origins or []) if re.match(r"^https?://[A-Za-z0-9.\-]+(:\d+)?$", o or "")]
    return "frame-ancestors " + (" ".join(clean) if clean else "'none'")
