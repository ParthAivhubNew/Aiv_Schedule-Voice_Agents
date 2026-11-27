"""The policy an organisation must follow: the brand it belongs to (white-label customers such as FSB) and its own exclusion rules.

organisation -> brand -> Brand.policy. An organisation with no brand and no rules (every normal customer) gets an empty Policy: its methods add no
conditions, its hash is "" and nothing about its searches changes.

Brand policy shape (Brand.policy, cleaned by clean_policy), set by platform staff:
  {"member_suppression": bool,
   "geo": {"districts": ["BN1", "BN2"]},
   "restricted_sources": {"google": bool, "apollo": bool, "search_engines": bool},
   "signin": {"password": bool, "google": bool, "microsoft": bool},
   "screening": {"block_unscreened": bool}}

Exclusions are not part of the brand any more: each organisation's admins keep their own rules (org_exclusion_rules, see services/org_rules.py), read
for every organisation whether or not it has a brand, and enforced by the server on every search. If the rules cannot be read the request fails
(AccessDenied 503); it never falls back to showing everything.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_, select

logger = logging.getLogger(__name__)

SOURCES = ("google", "apollo", "search_engines")
_TTL = 60.0
_RULES_TTL = 10.0  # an organisation with rules re-reads them this often, so another server sees an edit quickly
RULES_UNREADABLE = "Couldn't check what your organisation leaves out. Try again."
_DISTRICT = re.compile(r"[A-Z]{1,2}\d[A-Z\d]?")


def default_policy() -> Dict[str, Any]:
    return {"member_suppression": False, "geo": {"districts": []},
            "restricted_sources": {s: False for s in SOURCES}, "signin": {"password": True, "google": True, "microsoft": True},
            "screening": {"block_unscreened": False}}


def _flag(value: Any, default: bool) -> bool:
    return default if value is None else bool(value)


def clean_policy(raw: Any) -> Dict[str, Any]:
    """Fills the defaults and drops every key that is not part of the shape. Items that cannot be used (a postcode district that is not one) are dropped."""
    raw = raw if isinstance(raw, dict) else {}
    out = default_policy()
    out["member_suppression"] = _flag(raw.get("member_suppression"), False)
    geo = raw.get("geo") if isinstance(raw.get("geo"), dict) else {}
    districts = geo.get("districts") if isinstance(geo.get("districts"), list) else []
    out["geo"]["districts"] = sorted({d for d in (str(v).upper().replace(" ", "") for v in districts) if _DISTRICT.fullmatch(d)})
    rs = raw.get("restricted_sources") if isinstance(raw.get("restricted_sources"), dict) else {}
    out["restricted_sources"] = {s: _flag(rs.get(s), False) for s in SOURCES}
    si = raw.get("signin") if isinstance(raw.get("signin"), dict) else {}
    out["signin"] = {k: _flag(si.get(k), True) for k in ("password", "google", "microsoft")}
    sc = raw.get("screening") if isinstance(raw.get("screening"), dict) else {}
    out["screening"] = {"block_unscreened": _flag(sc.get("block_unscreened"), False)}
    return out


def normalize_company_number(value: Any) -> str:
    """Companies House form: 8 characters, upper case, numbers padded with zeros (1234567 is 01234567). "" when it cannot be one."""
    t = re.sub(r"[\s-]", "", str(value or "")).upper()
    if t.isdigit() and 1 <= len(t) <= 8:
        t = t.zfill(8)
    return t if re.fullmatch(r"[A-Z0-9]{8}", t) else ""


_GEN: Dict[str, int] = {}  # org -> how many times its policy or member list changed: part of every cache key, so an edit is seen at once
_GEN_ALL = [0]


class Policy:
    def __init__(self, org_id: str = "", brand_id: str = "", data: Optional[Dict[str, Any]] = None, rules: Optional[List[Dict[str, Any]]] = None):
        self.org_id = org_id
        self.brand_id = brand_id
        self.data = clean_policy(data) if brand_id else default_policy()
        self.org_rules: List[Dict[str, Any]] = list(rules or [])  # the organisation's enabled exclusion rows: {kind, value, mode}
        self.gen = (_GEN_ALL[0], _GEN.get(org_id, 0))
        self.user_districts: List[str] = []  # one person's own area limit (services/data_access.py); only ever set on a per-request copy

    def for_user(self, districts: List[str], lift_geo: bool = False) -> "Policy":
        """A copy of this policy with one person's areas added. The shared (cached) policy object is never changed.
        lift_geo drops the organisation's own area lock on the copy: an admin sees every postcode, and a person with their own list of areas
        gets exactly those (the admin chose them, wherever they are)."""
        import copy

        mine = copy.copy(self)
        mine.data = copy.deepcopy(self.data)
        mine.user_districts = sorted(set(districts))
        if lift_geo:
            mine.data["geo"]["districts"] = []
        return mine

    def with_rules(self, rules: List[Dict[str, Any]]) -> "Policy":
        """A copy with these rules instead of the saved ones (a preview of an edit nobody has saved yet). Never cached."""
        import copy

        mine = copy.copy(self)
        mine.org_rules = list(rules)
        return mine

    # -- what changes a search --------------------------------------------------
    @property
    def _exclusions_on(self) -> bool:
        return bool(self.org_rules)

    @property
    def geo_districts(self) -> List[str]:
        return list(self.data["geo"]["districts"])

    @property
    def suppression_on(self) -> bool:
        return bool(self.data["member_suppression"])

    @property
    def is_empty(self) -> bool:
        """True when this policy adds nothing to a search (the case for every organisation without a brand)."""
        return not (self._exclusions_on or self.geo_districts or self.suppression_on or self.user_districts)

    def exclusion_conditions(self) -> list:
        if not self._exclusions_on:
            return []
        from app.services import org_rules

        return org_rules.conditions(self.org_rules)

    def geo_conditions(self) -> list:
        if not self.geo_districts:
            return []
        from app.services import business_records as BR

        return [or_(*[BR._postcode_match(d) for d in self.geo_districts])]

    def user_conditions(self) -> list:
        """The person's own areas, ANDed with the organisation's geography lock (both must hold)."""
        if not self.user_districts:
            return []
        from app.services import business_records as BR

        from app.models.models import BusinessRecord

        # a whole area (LS) is LS1 to LS99 only: a bare prefix would also take LE1 for the area L
        return [or_(*[BusinessRecord.postcode.op("~")("^" + d + "[0-9]") if d.isalpha() else BR._postcode_match(d) for d in self.user_districts])]

    def suppression_condition(self, org_id: Optional[str] = None) -> Any:
        """Leaves out the company numbers this organisation uploaded as its member list; None when the policy has no member suppression."""
        if not self.suppression_on:
            return None
        from app.models.models import BusinessRecord, SuppressedCompany

        mine = select(SuppressedCompany.company_number).where(SuppressedCompany.org_id == (org_id or self.org_id))
        return func.coalesce(BusinessRecord.registration_number, "").notin_(mine)

    def conditions(self, org_id: Optional[str] = None) -> list:
        """Every search condition of this policy, ready to AND in. [] for an empty policy."""
        if self.is_empty:
            return []
        out = self.exclusion_conditions() + self.geo_conditions() + self.user_conditions()
        sup = self.suppression_condition(org_id)
        if sup is not None:
            out.append(sup)
        return out

    def hash(self) -> str:
        """A short stable string of everything that changes a search result; "" when nothing does."""
        if self.is_empty:
            return ""
        from app.services import org_rules

        basis = {"rules": org_rules.signature(self.org_rules) if self.org_rules else "", "geo": self.geo_districts,
                 "members": self.suppression_on, "gen": list(self.gen), "user": self.user_districts}
        return hashlib.sha1(json.dumps(basis, sort_keys=True).encode()).hexdigest()[:12]

    def cache_key(self) -> str:
        """What a cache that keeps results or counts must add to its key: "" for an empty policy, else organisation and hash, so two
        organisations never share an entry."""
        h = self.hash()
        return f"{self.org_id}:{h}" if h else ""

    @property
    def block_unscreened(self) -> bool:
        """True when exports must leave out phone numbers without a fresh clear TPS/CTPS result."""
        return bool(self.data["screening"]["block_unscreened"])

    def restricted(self, source: str) -> bool:
        return bool(self.data["restricted_sources"].get(source))

    def summary(self) -> Dict[str, Any]:
        """What is on for this account, for its own people to read. No lists of numbers and nothing secret."""
        return {"brandId": self.brand_id or None, "standingExclusions": self._exclusions_on, "exclusionRules": len(self.org_rules),
                "memberSuppression": self.suppression_on, "geoDistricts": len(self.geo_districts),
                "restrictedSources": [s for s in SOURCES if self.restricted(s)], "signin": dict(self.data["signin"])}


# -- resolution and cache ---------------------------------------------------------
_CACHE: Dict[str, Any] = {}  # org -> (when, Policy)


def invalidate(org_id: Optional[str] = None) -> None:
    """Forget what is remembered: for one organisation, or for all of them (a brand's policy or links changed)."""
    if org_id:
        _CACHE.pop(org_id, None)
        _GEN[org_id] = _GEN.get(org_id, 0) + 1
    else:
        _CACHE.clear()
        _GEN_ALL[0] += 1


async def _read_rules(db, org_id: str) -> List[Dict[str, Any]]:
    """The organisation's enabled exclusion rules, read with an explicit organisation filter. When the open session already belongs to this
    organisation it is used; otherwise (a public API call, a job, an admin looking at another account) a session of its own is opened in that
    organisation's scope, because row-level security would otherwise return no rows and "no rows" must never be read as "no exclusions"."""
    from app.core.tenancy import current_org, org_scope
    from app.models.models import OrgExclusionRule

    q = (select(OrgExclusionRule.kind, OrgExclusionRule.value, OrgExclusionRule.mode)
         .where(OrgExclusionRule.org_id == org_id, OrgExclusionRule.enabled.is_(True)).order_by(OrgExclusionRule.id))
    if db is not None and current_org() == org_id:
        async with db.begin_nested():
            rows = (await db.execute(q)).all()
    else:
        from app.database import AsyncSessionLocal

        with org_scope(org_id):
            async with AsyncSessionLocal() as s:
                rows = (await s.execute(q)).all()
    return [{"kind": r[0], "value": r[1] or "", "mode": r[2]} for r in rows]


async def _load(db, org_id: str) -> Policy:
    from app.models.models import Brand, Organization

    brand_id = (await db.execute(select(Organization.brand_id).where(Organization.id == org_id))).scalar() if db is not None else None
    rules = await _read_rules(db, org_id)
    if not brand_id:
        return Policy(org_id, rules=rules)
    brand = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalars().first()
    # A suspended brand keeps its policy: suspending must never relax what an organisation has to follow.
    return Policy(org_id, brand_id, brand.policy if brand else None, rules) if brand else Policy(org_id, rules=rules)


async def effective(db_or_none=None, org_id: Optional[str] = None) -> Policy:
    """The Policy for the current request: the organisation's (see org_effective, cached) with the signed-in person's own areas added when they
    have a personal limit. The per-person copy is built per request and never stored in the cache. It raises data_access.AccessDenied (503)
    when the person's limits cannot be read: a failed lookup never falls back to showing everything."""
    pol = await org_effective(db_or_none, org_id)
    from app.core.tenancy import current_org, scope_operator

    if scope_operator() and (not org_id or org_id == current_org()):
        from app.services import data_access as DA

        scope = await DA.current_scope(db_or_none)
        if scope.admin:
            return pol.for_user([], lift_geo=True) if pol.geo_districts else pol
        if scope.limited:
            return pol.for_user(list(scope.districts), lift_geo=True)
    return pol


async def org_effective(db_or_none=None, org_id: Optional[str] = None) -> Policy:
    """The Policy of an organisation (default: the current one), remembered for 60 seconds (10 when it has exclusion rules). If it cannot be read the
    last known policy is used; with none known the request fails with AccessDenied 503, because an empty policy would show what the organisation
    has chosen to leave out."""
    if not org_id:
        from app.core.tenancy import current_org

        org_id = current_org()
    hit = _CACHE.get(org_id)
    if hit and time.monotonic() - hit[0] < (_RULES_TTL if hit[1].org_rules else _TTL):
        return hit[1]
    try:
        if db_or_none is not None:
            async with db_or_none.begin_nested():  # a failed read must not poison the caller's transaction
                pol = await _load(db_or_none, org_id)
        else:
            from app.database import AsyncSessionLocal

            async with AsyncSessionLocal() as db:
                pol = await _load(db, org_id)
    except Exception as err:
        logger.warning(f"[tenant_policy] could not read the policy of {org_id}: {err}")
        if hit:
            return hit[1]
        from app.services.data_access import AccessDenied

        raise AccessDenied(503, RULES_UNREADABLE, "exclusion_check_failed")
    if len(_CACHE) > 2000:
        _CACHE.clear()
    _CACHE[org_id] = (time.monotonic(), pol)
    return pol


async def source_allowed(org_id: Optional[str], source: str, db=None) -> bool:
    """False when the organisation's policy restricts this source ("google", "apollo", "search_engines"): the caller then reports nothing found."""
    return not (await effective(db, org_id or None)).restricted(source)


async def brand_for_host(db, host: str):
    """(Brand, BrandDomain) for a host name, or (None, None)."""
    from app.models.models import Brand, BrandDomain

    h = str(host or "").strip().lower().split(":")[0]
    if not h:
        return None, None
    dom = (await db.execute(select(BrandDomain).where(BrandDomain.host == h))).scalars().first()
    if not dom:
        return None, None
    brand = (await db.execute(select(Brand).where(Brand.id == dom.brand_id))).scalars().first()
    return (brand, dom) if brand and brand.status == "active" else (None, None)
