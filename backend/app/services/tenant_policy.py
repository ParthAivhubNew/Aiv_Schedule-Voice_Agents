"""The rules an organisation must follow: its brand's (a white-label reseller such as FSB, set by Aivhub staff) combined with the company's
own (Organization.policy, set by the company's admins).

organisation -> brand -> Brand.policy, plus organisation -> Organization.policy, combined by merge_policy(): the company level can only add
restrictions, never relax one its brand set. A person's own areas are added per request (effective()). An organisation with neither gets an
empty Policy: its methods add no conditions, its hash is "" and nothing about its searches changes.

If the rules cannot be read and none are remembered, the request is refused (PolicyUnavailable), never answered without rules.

Policy shape (Brand.policy, cleaned by clean_policy):
  {"exclusions": {"sets": [rule set ids], "fsb": bool, "extra": [exclusion items], "locked": bool},
   "member_suppression": bool,
   "geo": {"districts": ["BN1", "BN2"]},
   "restricted_sources": {"google": bool, "apollo": bool, "search_engines": bool},
   "signin": {"password": bool, "google": bool, "microsoft": bool},
   "screening": {"block_unscreened": bool}}

`exclusions.sets` names rule sets from services/exclusion_rules.PRESETS ("standard_b2b": the Standard B2B exclusions, FSB's rules).
`exclusions.fsb` is the older flag for that same set; cleaning keeps the two in step.

`exclusions.locked` true means the server enforces the exclusions on every search and a client filter cannot switch them off. With locked false
the exclusions are only a starting point for the screens and the server adds nothing.
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
_MAX_EXTRA = 300
_DISTRICT = re.compile(r"[A-Z]{1,2}\d[A-Z\d]?")


def default_policy() -> Dict[str, Any]:
    return {"exclusions": {"sets": [], "fsb": False, "extra": [], "locked": True}, "member_suppression": False, "geo": {"districts": []},
            "restricted_sources": {s: False for s in SOURCES}, "signin": {"password": True, "google": True, "microsoft": True},
            "screening": {"block_unscreened": False}}


def _flag(value: Any, default: bool) -> bool:
    return default if value is None else bool(value)


def clean_policy(raw: Any) -> Dict[str, Any]:
    """Fills the defaults and drops every key that is not part of the shape. Items that cannot be used (a postcode district that is not one) are dropped."""
    raw = raw if isinstance(raw, dict) else {}
    out = default_policy()
    ex = raw.get("exclusions") if isinstance(raw.get("exclusions"), dict) else {}
    from app.services import exclusion_rules as ER

    sets = ex.get("sets") if isinstance(ex.get("sets"), list) else []
    picked = {str(v) for v in sets if ER.known(v)} | ({ER.LEGACY} if _flag(ex.get("fsb"), False) else set())
    out["exclusions"]["sets"] = sorted(picked)
    out["exclusions"]["fsb"] = ER.LEGACY in picked
    out["exclusions"]["locked"] = _flag(ex.get("locked"), True)
    extra = ex.get("extra") if isinstance(ex.get("extra"), list) else []
    out["exclusions"]["extra"] = [t[:80] for t in dict.fromkeys(re.sub(r"\s+", " ", str(v)).strip() for v in extra) if len(re.sub(r"[^0-9A-Za-z]", "", t)) >= 2][:_MAX_EXTRA]
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


def _sets(ex: Dict[str, Any]) -> List[str]:
    """The rule sets a cleaned or merged exclusions block switches on (the old fsb flag counts as the Standard B2B set)."""
    from app.services import exclusion_rules as ER

    return sorted(set(ex.get("sets") or []) | ({ER.LEGACY} if ex.get("fsb") else set()))


def _has_exclusions(p: Dict[str, Any]) -> bool:
    return bool(_sets(p["exclusions"]) or p["exclusions"]["extra"])


def merge_policy(upper: Dict[str, Any], lower: Dict[str, Any]) -> Dict[str, Any]:
    """The brand's cleaned rules (upper) combined with the company's (lower). The lower level can only add restrictions:
    - exclusions and member lists: everything either level excludes; enforced when any level that has exclusions enforces them,
    - territory: the brand's districts are kept apart as geo.locked (they hold for everyone, admins included); the company's districts are
      the default area of its people and only count inside the brand's. No overlap at all leaves geo.none set: the search shows nothing,
    - blocked sources and "block unscreened numbers": on when either level turns them on,
    - sign-in methods: allowed only when both allow them. If that would leave none, the brand's methods are used.
    The result is not passed through clean_policy again (that would cap the lists and drop geo.locked)."""
    import copy

    u, l = upper, lower
    out = copy.deepcopy(default_policy())
    from app.services import exclusion_rules as ER

    out["exclusions"]["sets"] = sorted(set(_sets(u["exclusions"])) | set(_sets(l["exclusions"])))
    out["exclusions"]["fsb"] = ER.LEGACY in out["exclusions"]["sets"]
    out["exclusions"]["extra"] = list(dict.fromkeys(list(u["exclusions"]["extra"]) + list(l["exclusions"]["extra"])))
    locks = [p["exclusions"]["locked"] for p in (u, l) if _has_exclusions(p)]
    out["exclusions"]["locked"] = any(locks) if locks else True
    out["member_suppression"] = bool(u["member_suppression"] or l["member_suppression"])
    hard = sorted(set(u["geo"]["districts"]))
    mine = sorted(set(l["geo"]["districts"]))
    soft = sorted(set(mine) & set(hard)) if hard and mine else (mine or hard)
    out["geo"] = {"districts": soft, "locked": hard, "none": bool(hard and mine and not soft)}
    out["restricted_sources"] = {s: bool(u["restricted_sources"].get(s) or l["restricted_sources"].get(s)) for s in SOURCES}
    signin = {k: bool(u["signin"].get(k, True) and l["signin"].get(k, True)) for k in ("password", "google", "microsoft")}
    out["signin"] = signin if any(signin.values()) else dict(u["signin"])
    out["screening"] = {"block_unscreened": bool(u["screening"]["block_unscreened"] or l["screening"]["block_unscreened"])}
    return out


def company_policy_problems(brand: Dict[str, Any], company: Dict[str, Any]) -> List[str]:
    """Why a company's own rules (cleaned) cannot be saved under its brand's (cleaned), in words for the company admin; [] when they can."""
    out: List[str] = []
    hard = set(brand["geo"]["districts"])
    outside = sorted(set(company["geo"]["districts"]) - hard) if hard else []
    if outside:
        shown = ", ".join(outside[:10]) + (f" and {len(outside) - 10} more" if len(outside) > 10 else "")
        out.append(f"These areas are outside the areas your brand allows: {shown}.")
    signin = {k: brand["signin"].get(k, True) and company["signin"].get(k, True) for k in ("password", "google", "microsoft")}
    if not any(signin.values()):
        out.append("Keep at least one sign-in method on, or nobody can sign in.")
    return out


class PolicyUnavailable(Exception):
    """The rules of an organisation could not be read and none are remembered. Answered as 503 by the callers' handler."""


_GEN: Dict[str, int] = {}  # org -> how many times its policy or member list changed: part of every cache key, so an edit is seen at once
_GEN_ALL = [0]


class Policy:
    def __init__(self, org_id: str = "", brand_id: str = "", data: Optional[Dict[str, Any]] = None, merged: Optional[Dict[str, Any]] = None):
        """data: one level's rules, cleaned here (used with a brand id). merged: rules already combined by merge_policy, used as they are."""
        self.org_id = org_id
        self.brand_id = brand_id
        if merged is not None:
            self.data = merged
        else:
            self.data = clean_policy(data) if brand_id else default_policy()
        self.data["geo"].setdefault("locked", [])
        self.data["geo"].setdefault("none", False)
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

    # -- what changes a search --------------------------------------------------
    @property
    def _exclusions_on(self) -> bool:
        ex = self.data["exclusions"]
        return bool(ex["locked"] and (_sets(ex) or ex["extra"]))

    @property
    def geo_districts(self) -> List[str]:
        """The default area of the organisation's people: the company's districts inside its brand's, else the brand's."""
        return list(self.data["geo"]["districts"])

    @property
    def locked_districts(self) -> List[str]:
        """The brand's area: it holds for everyone in the organisation, admins and people with their own areas included."""
        return list(self.data["geo"]["locked"])

    @property
    def geo_none(self) -> bool:
        """True when the company's areas and its brand's have nothing in common: searches then show nothing, never everything."""
        return bool(self.data["geo"]["none"])

    @property
    def suppression_on(self) -> bool:
        return bool(self.data["member_suppression"])

    @property
    def is_empty(self) -> bool:
        """True when this policy adds nothing to a search (the case for every organisation without a brand)."""
        return not (self._exclusions_on or self.geo_districts or self.locked_districts or self.geo_none or self.suppression_on or self.user_districts)

    def exclusion_conditions(self) -> list:
        if not self._exclusions_on:
            return []
        from app.services import business_records as BR
        from app.services import exclusion_rules as ER

        ex = self.data["exclusions"]
        conds: list = []
        for set_id in _sets(ex):
            conds += ER.all_conditions(set_id, False)  # the Companies-House-only rule is never relaxed for a locked policy
        if ex["extra"]:
            conds += BR._exclusion_items(ex["extra"])
        return conds

    def geo_conditions(self) -> list:
        """The organisation's area: its default area (always inside the brand's), or the brand's area once that default is lifted for an
        admin or a person with their own areas. Nothing at all when the two levels' areas do not meet."""
        if self.geo_none:
            from sqlalchemy import false

            return [false()]
        districts = self.geo_districts or self.locked_districts
        if not districts:
            return []
        from app.services import business_records as BR

        return [or_(*[BR._postcode_match(d) for d in districts])]

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
        ex = self.data["exclusions"]
        from app.services import exclusion_rules as ER

        sets = _sets(ex) if self._exclusions_on else []
        basis = {"fsb": ER.LEGACY in sets, "extra": sorted(ex["extra"]) if self._exclusions_on else [], "geo": self.geo_districts,
                 "members": self.suppression_on, "gen": list(self.gen), "user": self.user_districts}
        others = [x for x in sets if x != ER.LEGACY]
        if others:  # only when set, so every existing key stays the same
            basis["sets"] = others
        if self.locked_districts or self.geo_none:  # only when set, so every existing key stays the same
            basis["locked"], basis["none"] = self.locked_districts, self.geo_none
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
        return {"brandId": self.brand_id or None, "standingExclusions": self._exclusions_on,
                "fsbRules": bool(self.data["exclusions"]["fsb"]) and self._exclusions_on,
                "ruleSets": _sets(self.data["exclusions"]) if self._exclusions_on else [],
                "extraExclusions": len(self.data["exclusions"]["extra"]) if self._exclusions_on else 0, "locked": bool(self.data["exclusions"]["locked"]),
                "memberSuppression": self.suppression_on, "geoDistricts": len(self.geo_districts), "geoLocked": len(self.locked_districts),
                "geoNone": self.geo_none,
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


async def _load(db, org_id: str) -> Policy:
    from app.models.models import Brand, Organization

    row = (await db.execute(select(Organization.brand_id, Organization.policy).where(Organization.id == org_id))).first()
    brand_id, own = (row[0], row[1]) if row else (None, None)
    brand = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalars().first() if brand_id else None
    if not brand and not own:
        return Policy(org_id)
    # A suspended brand keeps its policy: suspending must never relax what an organisation has to follow.
    upper = clean_policy(brand.policy) if brand else default_policy()
    return Policy(org_id, brand.id if brand else "", merged=merge_policy(upper, clean_policy(own)))


async def levels(db, org_id: str) -> Dict[str, Any]:
    """The rules of each level, cleaned, for the company's rules screen: {"brand": {...} or None, "brandId", "brandName", "company": {...}}. Not cached."""
    from app.models.models import Brand, Organization

    row = (await db.execute(select(Organization.brand_id, Organization.policy).where(Organization.id == org_id))).first()
    brand = (await db.execute(select(Brand).where(Brand.id == row[0]))).scalars().first() if row and row[0] else None
    return {"brand": clean_policy(brand.policy) if brand else None, "brandId": brand.id if brand else "",
            "brandName": (brand.display_name or brand.name) if brand else "",
            "company": clean_policy(row[1] if row else None)}


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
    """The Policy of an organisation (default: the current one), remembered for 60 seconds. If it cannot be read the last known policy is used,
    else an empty one is returned unremembered and the problem is logged."""
    if not org_id:
        from app.core.tenancy import current_org

        org_id = current_org()
    hit = _CACHE.get(org_id)
    if hit and time.monotonic() - hit[0] < _TTL:
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
            return hit[1]  # the last known rules, however old: never fewer rules than before
        # Never answer without the rules: a company's member list, exclusions or blocked sources must not vanish because a read failed.
        raise PolicyUnavailable(f"The rules of {org_id} could not be read") from err
    if len(_CACHE) > 2000:
        _CACHE.clear()
    _CACHE[org_id] = (time.monotonic(), pol)
    return pol


async def source_allowed(org_id: Optional[str], source: str, db=None) -> bool:
    """False when the organisation's policy restricts this source ("google", "apollo", "search_engines"): the caller then reports nothing found.
    Also False when the rules cannot be read: a source is never used on a guess."""
    try:
        return not (await effective(db, org_id or None)).restricted(source)
    except PolicyUnavailable:
        return False


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
