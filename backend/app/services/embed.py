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


_LEADS = "leads|enrichment|contacts|together|assistant/feedback"
_VOICE = "calls|prospects|missions|schedule|meetings|conversation-templates|voices|numbers|calcom|voice-studio|call-lists|call-schedules|meeting-links"
# screen -> what it may call, relative to /api. The Leads app loads its lists and its mail together, so each screen may also
# read (never change) the other's data; everything else is refused.
# "leadgen" is the whole Leads app (every page of it); "voice" and "social" are their whole apps. leads, campaigns and mail are
# smaller slices of Leads for a partner that wants only that. Whatever a screen may call, the account's own roles and plan still
# apply, and the actions that only an account admin may take (ordering phone numbers, billing, users and keys) stay with the
# admin in Outreach itself: an embedded screen is never an admin.
_LEADGEN = _LEADS + "|email|journeys|inbound|meetings|call-lists|calcom|profile|compliance|number-check|calls|prospects|missions|human-calls|assistant/voice"
_VOICE_ALL = _VOICE + "|profile|compliance|human-calls|wa|telnyx|number-check|diagnostics|analytics|leads|enrichment|assistant/(?:voice|feedback)|contacts"
_ACCOUNT = ("auth/(?:users|roles|sections)|numbers|billing/(?:access|overview|checkout|subscriptions|plan|cancel|portal)|credits$|credits/(?:usage|leads|wallet)|"
            "developer|telnyx/numbers|email/mailboxes|profile|assistant/feedback")
COMPONENTS: Dict[str, Tuple] = {
    "leads": _screen(("leadgen",), _LEADS, ("email",), "email"),
    "campaigns": _screen(("leadgen", "email"), _LEADS + "|email|journeys"),  # its Journeys page calls /journeys
    "mail": _screen(("email",), "email", ("leadgen",), _LEADS),
    "leadgen": _screen(("leadgen", "email", "calcom", "company", "calling"), _LEADGEN, ("analytics",), "analytics"),
    "voice": _screen(("calling", "calcom", "analytics", "company", "leadgen"), _VOICE_ALL, ("connections",), "connections|together"),
    # "api" is no screen: one pass for a partner's own code to run the actions of every plugin (POST /v1/run) for the connected person.
    "api": _screen((), "api-pass-only"),
    # "account" is the admin screen: users, roles, phone numbers, plans and credits, API keys. Only for a partner staff switched on (see
    # account_blocked), only for a person who is a real admin of their own account, and only after a fresh sign-in (never the remembered one).
    "account": _screen((), _ACCOUNT),
    "social": _screen(("scheduler", "company"), "scheduler|social|profile|assistant/(?:feedback|social)|enrichment/chats/social_assistant|enrichment/chats/social_assistant_memory", ("calcom", "leadgen", "calling"), "calcom|meetings|leads/lists|together"),
}
ACCESS = ("full", "view")
# component -> the pages of the app it shows (the app hides every other page of its menu)
VIEWS: Dict[str, List[str]] = {
    "leads": ["find_leads", "lists"],
    "campaigns": ["lists", "outreach", "mailboxes"],
    "mail": ["mail", "mailboxes"],
    "leadgen": [],  # every page of the Leads app
    "account": [],
    "api": [],
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


# Page-only connect (no partner server): the page asks for a state, a popup of ours signs the person in, and the popup hands the
# opener a one-time code. The code is worth one embed token, and only to the page address it was made for.
CODE_TYPE = "embed_code"
CODE_TTL_S = 120
REMEMBER_TYPE = "embed_remember"
REMEMBER_TTL_S = 30 * 24 * 3600
REMEMBER_COOKIE = "outreach_popup"
_USED_CODES: Dict[str, float] = {}


def mint_state(partner_id: str, component: str, access: str, origin: str, ret: str = "") -> Tuple[str, int]:
    """Opens the connect screen for one page address (in a popup, in the page, or as the whole window; `ret` is where the whole
    window goes back to). The person's identity is not in it: we set that after they sign in."""
    claims = {"sub": partner_id, "ext": "popup", "pop": origin, "cmp": component, "acc": access, "typ": CONNECT_TYPE, "jti": secrets.token_hex(8)}
    if ret:
        claims["ret"] = ret
    token = _encode(claims, CONNECT_TTL_S)
    return token, int(time.time()) + CONNECT_TTL_S


def mint_code(link_id: str, partner_id: str, org_id: str, component: str, access: str, origin: str) -> str:
    return _encode({"sub": link_id, "ptr": partner_id, "org": org_id, "cmp": component, "acc": access, "pop": origin,
                    "jti": secrets.token_hex(12), "typ": CODE_TYPE}, CODE_TTL_S)


def take_code(code: str, origin: str) -> Optional[Dict[str, Any]]:
    """The claims of a one-time code, once, and only for the page address it was made for."""
    claims = decode_token(code, CODE_TYPE) if code else None
    if not claims or claims.get("pop") != origin or claims.get("cmp") not in COMPONENTS or claims.get("acc") not in ACCESS:
        return None
    now = time.time()
    for k in [k for k, exp in _USED_CODES.items() if exp < now]:
        _USED_CODES.pop(k, None)
    if claims["jti"] in _USED_CODES:
        return None
    _USED_CODES[claims["jti"]] = now + CODE_TTL_S + 5
    return claims


def mint_remember(operator_id: str, org_id: str) -> str:
    """For our own cookie: it lets a returning person skip the password in our popup, on this browser, for 30 days."""
    return _encode({"sub": operator_id, "org": org_id, "typ": REMEMBER_TYPE}, REMEMBER_TTL_S)


def read_remember(token: str) -> Optional[Dict[str, Any]]:
    return decode_token(token, REMEMBER_TYPE) if token else None


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
    _V1_CACHE.clear()


def account_blocked(partner: Any, component: str) -> str:
    """A reason (text) when this partner may not use the Account screen, else "". Staff switch it on per partner in the admin portal."""
    if component == "account" and not getattr(partner, "allow_admin_screens", False):
        return "The Account screen is not switched on for this integration. Ask the Outreach team to turn it on."
    return ""


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
            admin_perms = None
            if claims["cmp"] == "account":
                # Admin power is never taken from the partner's page: the screen must be switched on for the partner, and the connected person must
                # really be an admin of their own account right now (their roles are read again on every renewal).
                from app.core.accounts import effective_access
                from app.models.models import Operator

                if account_blocked(partner, "account"):
                    return None
                op = await db.get(Operator, link.operator_id) if link.operator_id else None
                if op is None or op.org_id != link.org_id:
                    return None
                is_admin_now, real_perms, _ = await effective_access(db, op)
                if not is_admin_now:
                    return None
                admin_perms = real_perms
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
    if admin_perms is not None:
        perms = dict(admin_perms)
    return {
        "type": "embed", "link_id": link.id, "partner_id": partner.id, "org_id": link.org_id, "component": component, "access": access,
        "test": partner.status != "live", "operator_id": link.operator_id or "embed_client", "username": f"embed:{partner.client_id}",
        "name": partner.name, "email": "", "is_admin": admin_perms is not None, "perms": perms, "roles": [], "must_change_password": False,
    }


# What a page may do through POST /v1/run for the person who connected: the actions of its own app, nothing else. The account's plan
# and the partner's granted scopes still decide the rest, exactly as for an API key.
RUN_SCOPE_PREFIXES: Dict[str, Tuple[str, ...]] = {
    "api": ("leads:", "email:", "voice:", "social:", "company:", "calendar:", "wallets:"),
    "leadgen": ("leads:", "email:", "company:", "calendar:", "wallets:"),
    "leads": ("leads:", "company:", "wallets:"),
    "campaigns": ("leads:", "email:", "company:", "wallets:"),
    "mail": ("email:", "company:", "wallets:"),
    "voice": ("voice:", "calendar:", "company:", "wallets:"),
    "social": ("social:", "company:", "wallets:"),
}
_V1_CACHE: Dict[Tuple[str, str], Tuple[float, Any]] = {}


async def v1_context(emb: Dict[str, Any], origin: str, method: str) -> Any:
    """The API context for a connected person's page calling /v1: a dict, or a short reason (text) it is refused.

    The page's own address must be one the partner listed (so a copied token is no use on another site), the pass must allow
    changes, and the account's API key for this partner is made on first use so the existing /v1 code treats the call like any key's."""
    from app.services import partners as PT

    if emb.get("access") != "full" and method not in ("GET", "HEAD"):
        return "This pass is view only, so it cannot make changes. Connect with full access."
    page = PT.page_origin(origin)
    if not page:
        return "Call this from your web page. The browser did not say which page this is."
    now = time.time()
    hit = _V1_CACHE.get((emb["link_id"], page))
    if hit and hit[0] > now:
        return hit[1]
    from sqlalchemy.future import select

    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import ApiKey, Partner, PartnerLink

    out: Any = "This integration is paused."
    with system_scope():
        async with AsyncSessionLocal() as db:
            partner = await db.get(Partner, emb["partner_id"])
            link = await db.get(PartnerLink, emb["link_id"])
            if partner is None or link is None or link.status != "active" or partner.status == "suspended":
                out = "This integration is paused."
            elif not PT.origin_allowed(partner, page):
                out = f"{page} is not in your list of web addresses."
            else:
                if not link.key_id:
                    await PT.issue_key(db, partner, link)  # the raw key is never shown: the page only ever holds its short pass
                    await db.commit()
                row = await db.get(ApiKey, link.key_id)
                prefixes = RUN_SCOPE_PREFIXES.get(emb["component"], ())
                scopes = [s for s in PT.expand_scopes(partner.scopes or []) if s.startswith(prefixes)]
                if row is None or not row.is_active:
                    out = "This connection has no key. Connect again."
                else:
                    out = {
                        "type": "api_key", "key_id": row.id, "org_id": row.org_id, "name": row.name, "scopes": scopes, "mailbox_ids": row.mailbox_ids,
                        "test": partner.status != "live", "operator_id": link.operator_id or "api_client", "username": f"key:{row.prefix}",
                        "is_admin": False, "partner_id": partner.id, "link_id": link.id, "via": "embed_pass",
                        "perms": {"team": "none", "calling": "full" if any(s.startswith("voice:") for s in scopes) else "none",
                                  "scheduler": "full" if any(s.startswith("social:") for s in scopes) else "none",
                                  "leadgen": "full" if any(s.startswith(("leads:", "email:")) for s in scopes) else "none"},
                        "must_change_password": False,
                    }
    _V1_CACHE[(emb["link_id"], page)] = (now + 5.0, out)
    if len(_V1_CACHE) > 2000:
        _V1_CACHE.clear()
    return out


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


def frame_ancestors(origins: Optional[List[str]], test: bool = False, extension: bool = False) -> str:
    """The Content-Security-Policy frame-ancestors value for a partner: its own web addresses, or nobody. While it is testing,
    pages on the partner's own computer may frame it as well."""
    clean = [o for o in (origins or []) if re.match(r"^https?://[A-Za-z0-9.\-]+(:\d+)?$", o or "")]
    if test:
        clean += ["http://localhost:*", "http://127.0.0.1:*", "https://localhost:*"]
    if extension:  # the Outreach side panel in Chrome frames the screen
        from app.services.partners import extension_ids

        clean += [f"chrome-extension://{i}" for i in extension_ids()]
        from app.config import settings

        if settings.ALLOW_FIREFOX_EXTENSION:
            clean.append("moz-extension:")
    return "frame-ancestors " + (" ".join(clean) if clean else "'none'")
