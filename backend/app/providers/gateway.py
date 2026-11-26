"""The one way out to a paid provider (plan 11, Part A: the provider wrapper).

    res = await call_provider("google_places", "place_details", ask, feature="google_view", looked_for=place_id)

`ask(client, key)` makes the vendor request and returns an Answer. The wrapper does the rest, in this order:

1. **Plan:** a company whose plan leaves the provider out gets "not_in_plan" (plan_rules.provider_allowed).
2. **Shared cache:** with a cache_key, an answer bought before is reused while the licence allows (Licence.cache_days). One client's
   answer serves another only when the licence says share_across_clients; otherwise answers stay with the company that paid.
3. **Fair-use cost cap:** a company whose plan's cost cap is used up gets "cap_reached" (plan_rules.cap_refusal).
4. **Circuit breaker:** after BREAK_AFTER failures in a row, the provider is left alone for a while ("paused"), starting at a minute
   and doubling up to 15 minutes. Staff get a PRV-01 alert. The first call after the pause tests whether it is back.
5. **Key:** the provider's saved key (Provider.saved_key); "no_key" without one.
6. **The call, and one log row** in provider_call_log: who asked, what for, how it went and its cost at that day's price (Model
   Pricing). The cost ledger view (services/cost_ledger.provider_calls) includes those rows.

It never raises. Every result says what happened (Result.outcome), so a caller can treat a refusal the same as "nothing found".
Providers with backup keys keep their KeyPool (providers/keypool.py) inside `ask`.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable, Dict, Optional

import httpx

from app.providers.base import ProviderError

logger = logging.getLogger("providers.gateway")

BREAK_AFTER = 5           # failures in a row that pause a provider
PAUSE_FIRST_S = 60        # the first pause; each pause after it is twice as long
PAUSE_MAX_S = 15 * 60
NONE_CACHE_DAYS = 7       # "nothing found" is kept for a week at most, so new data shows up


@dataclass
class Answer:
    """What `ask` got back. outcome: "found", "none" (a real answer with nothing in it) or "error" (the provider failed: counts
    towards the circuit breaker). status is the HTTP status when there was one; units what the call used (credits, numbers)."""
    data: Any = None
    outcome: str = "found"
    status: Optional[int] = None
    units: float = 1.0


@dataclass
class Result:
    data: Any = None
    outcome: str = ""  # found | none | error | cached | not_in_plan | cap_reached | paused | no_key | unknown_provider
    cached: bool = False
    cost_usd: float = 0.0

    @property
    def ok(self) -> bool:
        return self.outcome in ("found", "cached") and self.data is not None


@dataclass
class _Breaker:
    failures: int = 0
    opened: int = 0  # how many times in a row it has paused
    until: float = 0.0
    last_error: str = ""


_BREAKERS: Dict[str, _Breaker] = {}


def _clock() -> float:
    return time.time()  # its own name, so tests can move the breaker's clock without moving everyone's


def breakers() -> Dict[str, Dict[str, Any]]:
    """{provider: {failures, paused, pausedFor, lastError}} for the staff Providers page."""
    now = _clock()
    return {pid: {"failures": b.failures, "paused": b.until > now, "pausedFor": max(0, int(b.until - now)), "lastError": b.last_error}
            for pid, b in _BREAKERS.items() if b.failures or b.until > now}


def reset_breakers() -> None:
    _BREAKERS.clear()


def _paused(pid: str) -> bool:
    b = _BREAKERS.get(pid)
    return bool(b and b.until > _clock())


async def _failed(pid: str, why: str) -> None:
    b = _BREAKERS.setdefault(pid, _Breaker())
    b.failures += 1
    b.last_error = why[:200]
    if b.failures >= BREAK_AFTER:
        seconds = min(PAUSE_MAX_S, PAUSE_FIRST_S * (2 ** b.opened))
        b.opened += 1
        b.failures = 0
        b.until = _clock() + seconds
        logger.warning(f"[gateway] {pid} paused for {seconds}s after {BREAK_AFTER} failures in a row: {b.last_error}")
        try:
            from app.services.ai_errors import alert_staff

            await alert_staff("PRV-01", f"{pid} failed {BREAK_AFTER} times in a row, so calls to it are paused for {seconds // 60 or 1} "
                                        f"minute(s). Last error: {b.last_error}", org_id="platform")
        except Exception:
            pass


def _worked(pid: str) -> None:
    b = _BREAKERS.get(pid)
    if b:
        b.failures, b.opened, b.until = 0, 0, 0.0


def _cache_id(pid: str, op: str, scope: str, key: str) -> str:
    return hashlib.sha256(f"{pid}\x1f{op}\x1f{scope}\x1f{key}".encode()).hexdigest()


async def _cached(pid: str, op: str, scope: str, key: str) -> Optional[Dict[str, Any]]:
    from app.database import AsyncSessionLocal
    from app.models.models import ProviderCache

    try:
        async with AsyncSessionLocal() as db:
            row = await db.get(ProviderCache, _cache_id(pid, op, scope, key))
            if row and row.expires_at and row.expires_at > datetime.utcnow():
                return {"data": row.data, "found": bool(row.found)}
    except Exception as err:
        logger.debug(f"[gateway] cache read skipped: {err}")
    return None


async def _keep(pid: str, op: str, scope: str, key: str, data: Any, found: bool, days: int) -> None:
    from app.database import AsyncSessionLocal
    from app.models.models import ProviderCache

    try:
        json.dumps(data)  # only what can be stored as JSON is kept
        now = datetime.utcnow()
        async with AsyncSessionLocal() as db:
            cid = _cache_id(pid, op, scope, key)
            row = await db.get(ProviderCache, cid)
            if row is None:
                row = ProviderCache(id=cid, provider=pid, op=op, scope=scope)
                db.add(row)
            row.data, row.found, row.created_at, row.expires_at = data, found, now, now + timedelta(days=days)
            await db.commit()
    except Exception as err:
        logger.debug(f"[gateway] cache write skipped: {err}")


async def _price(pid: str, units: float, found: bool) -> tuple:
    """(cost in USD, priced) for one call at today's price on Model Pricing; a per-find provider costs nothing when it found nothing."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services.ai_pricing import _cost, _price_row

    try:
        with system_scope():
            async with AsyncSessionLocal() as db:
                row = await _price_row(db, pid, "", "lookup")
                await db.commit()
        if (getattr(row, "billing", "") or "per_find") == "per_find" and not found:
            return 0.0, bool(row.confirmed or row.price_in_usd)
        return _cost(row, "lookup", 0, 0, units)
    except Exception as err:
        logger.debug(f"[gateway] price not read for {pid}: {err}")
        return 0.0, False


async def _log(pid: str, capability: str, op: str, feature: str, looked_for: str, answer: Answer, cost: float, priced: bool, ms: int) -> None:
    from app.core.tenancy import current_actor, current_org, current_route
    from app.database import AsyncSessionLocal
    from app.models.models import ProviderCallLog

    try:
        async with AsyncSessionLocal() as db:
            db.add(ProviderCallLog(provider=pid, capability=capability, op=op, feature=feature, looked_for=str(looked_for or "")[:200],
                                   for_org=current_org() or "", actor=current_actor(), route=current_route(), status=answer.status,
                                   outcome=answer.outcome, units=float(answer.units or 0), cost_usd=round(cost, 6), priced=priced, ms=ms))
            await db.commit()
    except Exception as err:
        logger.warning(f"[gateway] call not logged for {pid}: {err}")
    try:
        from app.services.enrichment_service import _bump_vendor_call

        await _bump_vendor_call(pid)  # the admin portal's monthly vendor-spend estimate
    except Exception:
        pass


async def call_provider(provider_id: str, op: str, ask: Callable[[httpx.AsyncClient, str], Awaitable[Answer]], *,
                        cache_key: str = "", feature: str = "", looked_for: str = "", timeout: Any = 10.0) -> Result:
    """Plan, shared cache, cost cap, circuit breaker, key, then the call and its log row (see the module docstring). Never raises."""
    from app.providers import registry
    from app.services import plan_rules

    p = registry.get(provider_id)
    if p is None:
        logger.warning(f"[gateway] no provider file for {provider_id!r}")
        return Result(outcome="unknown_provider")
    m = p.manifest
    if not await plan_rules.provider_allowed(provider_id):
        return Result(outcome="not_in_plan")

    days = int(m.licence.cache_days or 0) if cache_key else 0
    scope = "*"
    if days:
        if not m.licence.share_across_clients:
            from app.core.tenancy import current_org

            scope = current_org() or ""
        hit = await _cached(provider_id, op, scope, cache_key) if scope else None
        if hit is not None:
            return Result(data=hit["data"], outcome="cached", cached=True)

    if m.credit_item and await plan_rules.cap_refusal([m.credit_item]):
        return Result(outcome="cap_reached")
    if _paused(provider_id):
        return Result(outcome="paused")
    try:
        key = await p.saved_key()
    except Exception as err:
        logger.debug(f"[gateway] key not read for {provider_id}: {err}")
        key = ""
    if not key:
        return Result(outcome="no_key")

    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            answer = await ask(client, key)
        if not isinstance(answer, Answer):
            answer = Answer(data=answer, outcome="found" if answer else "none")
    except (ProviderError, httpx.HTTPError, ValueError) as err:
        answer = Answer(outcome="error")
        why = str(err) if isinstance(err, ProviderError) else type(err).__name__
    except Exception as err:  # a bug in `ask`: logged, and the caller gets nothing rather than a crash
        logger.warning(f"[gateway] {provider_id}.{op} failed: {type(err).__name__}: {err}")
        answer = Answer(outcome="error")
        why = type(err).__name__
    else:
        why = f"HTTP {answer.status}" if answer.status else "no answer"
    ms = int((time.monotonic() - started) * 1000)

    if answer.outcome == "error":
        await _failed(provider_id, why)
    else:
        _worked(provider_id)
    # Every attempt is logged. One with no answer at all (a timeout, a dropped connection) is costed at nothing: we can't know.
    answered = answer.status is not None or answer.outcome != "error"
    cost, priced = await _price(provider_id, answer.units, answer.outcome == "found") if answered else (0.0, True)
    await _log(provider_id, m.category, op, feature, looked_for, answer, cost, priced, ms)
    if days and scope and answer.outcome in ("found", "none"):
        await _keep(provider_id, op, scope, cache_key, answer.data, answer.outcome == "found",
                    days if answer.outcome == "found" else min(days, NONE_CACHE_DAYS))
    return Result(data=answer.data if answer.outcome != "error" else None, outcome=answer.outcome, cost_usd=cost)
