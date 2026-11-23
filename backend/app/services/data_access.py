"""One person's own data limits inside their organisation's policy: which postcode districts they may see, and whether they may export or open Google details.

A missing row, or an empty district list, means no personal limit. Export and Google are allowed until an admin switches them off for that person.
Admins are never narrowed (decided here from the roles, not from the screen). The organisation's own policy (services/tenant_policy.py) is
unchanged and cached per organisation; the person's limits are read once per request and added to a per-request copy of it (Policy.for_user).

The same check (`visible`, `account_condition`, `guard`) is used by every by-id read, so a company outside the person's areas is refused with a
clear message instead of being quietly shown or quietly missing.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import and_, exists, func, or_, select

logger = logging.getLogger(__name__)

OUTSIDE_DETAIL = ("This company is outside the areas you have access to. You don't have the rights to view it. "
                  "Ask your administrator to give you access.")
OUTSIDE_NOTICE = ("Some of what you searched for is outside the areas you have access to, so it is not shown. "
                  "Ask your administrator to give you access.")
EXPORT_OFF = "Export is switched off for your account. Ask your administrator to turn it on."
GOOGLE_OFF = "Google details are switched off for your account. Ask your administrator to turn them on."
LOOKUP_FAILED = "Couldn't check your access. Try again."
OUT_OF_LOCK = "That area is outside the areas this organisation can use."
BAD_DISTRICT = "Use postcode districts such as BN1 or BN27."
MAX_DISTRICTS = 200
_DISTRICT = re.compile(r"[A-Z]{1,2}\d[A-Z\d]?")


class AccessDenied(Exception):
    """Answered by the app as {"detail": message, "code": code} with this status (see main.py)."""

    def __init__(self, status: int, detail: str, code: str):
        super().__init__(detail)
        self.status, self.detail, self.code = status, detail, code


def outside() -> AccessDenied:
    return AccessDenied(403, OUTSIDE_DETAIL, "outside_access")


@dataclass(frozen=True)
class Scope:
    districts: Tuple[str, ...] = ()
    allow_export: bool = True
    allow_google: bool = True
    admin: bool = False  # an admin sees every postcode: the organisation's own area lock is lifted for them

    @property
    def limited(self) -> bool:
        return bool(self.districts)

    def payload(self) -> Dict[str, Any]:
        return {"limited": self.limited, "districts": list(self.districts), "allow_export": self.allow_export, "allow_google": self.allow_google}


OPEN = Scope()
ADMIN = Scope(admin=True)


def clean_districts(raw: Any) -> List[str]:
    """Upper-case, no spaces, no duplicates; raises ValueError for anything that is not a postcode district."""
    if raw is None:
        return []
    if not isinstance(raw, (list, tuple)):
        raise ValueError(BAD_DISTRICT)
    out = []
    for v in raw:
        d = str(v or "").upper().replace(" ", "")
        if not _DISTRICT.fullmatch(d):
            raise ValueError(BAD_DISTRICT)
        out.append(d)
    out = sorted(set(out))
    if len(out) > MAX_DISTRICTS:
        raise ValueError(f"Pick up to {MAX_DISTRICTS} districts.")
    return out


def within(district: str, lock: Sequence[str]) -> bool:
    """True when a district sits inside one of the organisation's lock districts (EC1 covers EC1A, never EC10)."""
    for L in lock:
        if district == L or (district.startswith(L) and L[-1:].isdigit() and not district[len(L):len(L) + 1].isdigit()):
            return True
    return False


# -- reading one person's limits ----------------------------------------------------
async def _read(db, org_id: str, operator_id: str) -> Scope:
    from app.models.models import OperatorDataScope, OperatorRole, Role

    is_admin = (await db.execute(select(OperatorRole.operator_id).join(Role, Role.id == OperatorRole.role_id)
                                 .where(OperatorRole.operator_id == operator_id, Role.is_admin.is_(True)).limit(1))).first()
    if is_admin:
        return ADMIN
    row = (await db.execute(select(OperatorDataScope.districts, OperatorDataScope.allow_export, OperatorDataScope.allow_google)
                            .where(OperatorDataScope.operator_id == operator_id, OperatorDataScope.org_id == org_id))).first()
    if not row:
        return OPEN
    districts = row[0] if isinstance(row[0], list) else []
    return Scope(tuple(sorted({str(d).upper() for d in districts if str(d).strip()})), row[1] is not False, row[2] is not False)


async def resolve(db, org_id: str, operator_id: str) -> Scope:
    """The person's limits, read fresh. A failed read raises AccessDenied (503) and is never remembered."""
    try:
        if db is not None:
            async with db.begin_nested():  # a failed read must not poison the caller's transaction
                return await _read(db, org_id, operator_id)
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as s:
            return await _read(s, org_id, operator_id)
    except AccessDenied:
        raise
    except Exception as err:
        logger.warning(f"[data_access] could not read the limits of {operator_id}: {err}")
        raise AccessDenied(503, LOOKUP_FAILED, "access_check_failed")


async def current_scope(db=None) -> Scope:
    """The signed-in person's limits for this request (read once per request). OPEN outside a signed-in request and for developer API keys."""
    from app.core.tenancy import current_org, scope_holder, scope_operator

    op = scope_operator()
    if not op:
        return OPEN
    org = current_org()
    holder = scope_holder()
    if holder is not None and (org, op) in holder:
        return holder[(org, op)]
    scope = await resolve(db, org, op)
    if holder is not None:
        holder[(org, op)] = scope
    return scope


async def org_has_personal_limits(db, org_id: str) -> bool:
    """True when any person in the organisation has an area limit or a switch turned off (so a run with no known person must be refused)."""
    from app.models.models import OperatorDataScope

    try:
        async with db.begin_nested():
            rows = (await db.execute(select(OperatorDataScope.districts, OperatorDataScope.allow_export, OperatorDataScope.allow_google)
                                     .where(OperatorDataScope.org_id == org_id))).all()
    except Exception as err:
        logger.warning(f"[data_access] could not read the organisation's limits: {err}")
        raise AccessDenied(503, LOOKUP_FAILED, "access_check_failed")
    return any((r[0] or []) or r[1] is False or r[2] is False for r in rows)


# -- the one visibility check -------------------------------------------------------
def _in_district(postcode: Any, d: str) -> bool:
    """Same reading as business_records._postcode_match: LS1 is the LS1 district, never LS10 to LS19."""
    p = str(postcode or "").strip().upper()
    if not p.startswith(d):
        return False
    return not (d[-1:].isdigit() and p[len(d):len(d) + 1].isdigit())


def visible(scope: Scope, record_or_postcode: Any, *more: Any) -> bool:
    """True when the company (a BusinessRecord, a LeadAccount or a plain postcode) is inside the person's areas. With no limit everything is.
    Several postcodes (an account and its register record) count as visible when any of them is inside. No postcode at all cannot be shown
    to be inside, so it is not visible to a limited person."""
    if not scope.limited:
        return True
    items = [record_or_postcode, *more]
    postcodes = [x if isinstance(x, str) or x is None else getattr(x, "postcode", "") for x in items]
    return any(_in_district(pc, d) for pc in postcodes for d in scope.districts)


def district_sql(column: Any, d: str) -> Any:
    like = column.like(f"{d}%")
    return and_(like, ~column.op("~")("^" + re.escape(d) + "[0-9]")) if d[-1:].isdigit() else like


def record_condition(scope: Scope) -> Optional[Any]:
    """SQL for BusinessRecord rows inside the person's areas; None when there is no limit."""
    if not scope.limited:
        return None
    from app.models.models import BusinessRecord

    return or_(*[district_sql(BusinessRecord.postcode, d) for d in scope.districts])


def account_condition(scope: Scope) -> Optional[Any]:
    """SQL for saved companies (LeadAccount) inside the person's areas, by their own postcode or the register record's; None when no limit."""
    if not scope.limited:
        return None
    from app.models.models import BusinessRecord, LeadAccount

    mine = or_(*[district_sql(LeadAccount.postcode, d) for d in scope.districts])
    theirs = exists().where(BusinessRecord.id == LeadAccount.business_record_id,
                            or_(*[district_sql(BusinessRecord.postcode, d) for d in scope.districts]))
    return or_(mine, theirs)


async def guard(db, record_or_postcode: Any, *more: Any) -> None:
    """Refuses (403 outside_access) a by-id read of a company outside the person's areas."""
    scope = await current_scope(db)
    if not visible(scope, record_or_postcode, *more):
        raise outside()


async def guard_account(db, account: Any, biz: Any = None) -> None:
    """The same for a saved company: its own postcode or its register record's postcode may put it inside."""
    scope = await current_scope(db)
    if not scope.limited:
        return
    if biz is None and getattr(account, "business_record_id", None):
        from app.models.models import BusinessRecord

        biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == account.business_record_id))).scalars().first()
    if not visible(scope, account, *([biz] if biz is not None else [])):
        raise outside()


async def visible_account_ids(db, ids: Iterable[str]) -> Tuple[List[str], int]:
    """(the ids the person may see, in the order given; how many were dropped). Ids that are not saved accounts are kept as they are."""
    ids = list(ids)
    scope = await current_scope(db)
    cond = account_condition(scope)
    if cond is None or not ids:
        return ids, 0
    from app.models.models import LeadAccount

    ok: set = set()
    for i in range(0, len(ids), 500):
        ok |= set((await db.execute(select(LeadAccount.id).where(LeadAccount.id.in_(ids[i:i + 500]), cond))).scalars().all())
    every = set()
    for i in range(0, len(ids), 500):
        every |= set((await db.execute(select(LeadAccount.id).where(LeadAccount.id.in_(ids[i:i + 500])))).scalars().all())
    kept = [i for i in ids if i in ok or i not in every]
    return kept, len(ids) - len(kept)


# -- messages for searches ----------------------------------------------------------
def _overlaps(prefix: str, d: str) -> bool:
    return d.startswith(prefix) or prefix.startswith(d)


def search_notice(scope: Scope, filters: Dict[str, Any], total: Optional[int]) -> str:
    """OUTSIDE_NOTICE when the person narrowed the search to a place and some or all of it is outside their areas; "" otherwise (also for
    people with no personal limit)."""
    if not scope.limited:
        return ""
    f = filters or {}
    prefixes = [str(p).upper().replace(" ", "") for p in (f.get("postcode_prefixes") or []) if str(p).strip()]
    near = f.get("near") if isinstance(f.get("near"), dict) else {}
    prefixes += [str(p).upper().replace(" ", "") for p in (near.get("districts") or []) if str(p).strip()]
    if any(not any(_overlaps(p, d) for d in scope.districts) for p in prefixes):
        return OUTSIDE_NOTICE
    if (f.get("towns") or prefixes) and not total:
        return OUTSIDE_NOTICE  # a place was asked for and the person's areas hold nothing of it
    return ""


async def with_notice(db, answer: Dict[str, Any], filters: Dict[str, Any], total: Optional[int]) -> Dict[str, Any]:
    scope = await current_scope(db)
    note = search_notice(scope, filters, total)
    if note:
        answer = {**answer, "access_notice": note}
    return answer


async def payload_for(db, org_id: str, operator_id: str) -> Dict[str, Any]:
    return (await resolve(db, org_id, operator_id)).payload()


async def require_export(db) -> None:
    """403 export_off when the signed-in person's export switch is off. Admins and API keys pass (an API key has no person here)."""
    if not (await current_scope(db)).allow_export:
        raise AccessDenied(403, EXPORT_OFF, "export_off")


async def require_google(db) -> None:
    if not (await current_scope(db)).allow_google:
        raise AccessDenied(403, GOOGLE_OFF, "google_off")
