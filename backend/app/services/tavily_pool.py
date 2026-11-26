"""Tavily keys: the main one (Platform Keys) plus backups staff add in the admin portal.

Every Tavily search goes through search(). It tries the keys in order; a key that is out of credits, over its plan limit,
rate limited or refused is set aside for a while and the next one is used for the same search. Each request is logged
(never the key) so staff can see when Tavily is hit and for what. Same shape as apollo_pool."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("tavily_pool")

BACKUPS_DOC = "tavily_backup_keys"  # app_settings row: {"keys": [{"id", "label", "sealed"}]}
# Tavily's documentation: 401 the key is not valid; 429 too many requests (Retry-After says how long);
# 432 the key or plan usage limit is used up; 433 the pay-as-you-go limit is used up. 432 and 433 last until staff act or the month resets.
LONG = 1800  # seconds a key is set aside
_COOL: Dict[str, float] = {}
_OUTCOME = {401: "refused", 429: "rate_limited", 432: "key_exhausted", 433: "key_exhausted"}


def _cooldown(status: int, headers: Any) -> int:
    if status == 429:
        try:
            wait = int(float((headers or {}).get("retry-after") or (headers or {}).get("Retry-After") or 0))
        except (TypeError, ValueError):
            wait = 0
        return min(max(wait, 30), 86400) if wait else 90
    return LONG


def _tail(key: str) -> str:
    from app.providers.keypool import tail

    return tail(key)


def _row(entry, purpose, looked_for, status, outcome, credits: int = 0):
    from app.core.tenancy import current_actor, current_org, current_route
    from app.models.models import TavilyCall

    return TavilyCall(id=uuid.uuid4().hex, key_id=entry[0], key_label=entry[1], key_tail=_tail(entry[2]), purpose=purpose, looked_for=looked_for,
                      for_org=current_org() or "", actor=current_actor(), route=current_route(), status=status, outcome=outcome,
                      credits=int(credits or 0))


async def _main_key() -> str:
    from app.services import enrichment_service as E

    return await E.tavily_key()


def _pool():
    from app.providers.keypool import KeyPool

    return KeyPool(name="tavily", backups_doc=BACKUPS_DOC, main_key=_main_key, main_label="Tavily key", log_row=_row, cool=_COOL,
                    plan_provider="tavily")  # a plan without web search gets no key, so its lookups report nothing found


async def backups() -> List[Dict[str, Any]]:
    return await _pool().backups()


async def keys() -> List[Tuple[str, str, str]]:
    """[(id, label, key)] in the order they are tried: the main key (Platform Keys), then the backups."""
    return await _pool().keys()


def cooling_for(key_id: str) -> int:
    return max(0, int(_COOL.get(key_id, 0) - time.time()))


async def _log(key: Tuple[str, str, str], purpose: str, looked_for: str, status: Optional[int], outcome: str, credits: int = 0) -> None:
    await _pool().log(key, purpose, looked_for, status, outcome, credits=credits)


async def search(client: Any, body: Dict[str, Any], *, purpose: str = "search") -> Any:
    """POST one search, failing over to the next key when one is exhausted, over its limit or refused. Returns the last response
    (a refused one when every key was), or None when there is no key at all. A network error is raised: it is not the key's fault."""
    from app.providers.keypool import Verdict

    async def send(entry):
        headers = {"Authorization": f"Bearer {entry[2]}"}
        r = await client.post("https://api.tavily.com/search", headers=headers, json=body)
        if int(getattr(r, "status_code", 0) or 0) == 429:  # one polite retry after the wait Tavily asks for
            try:
                wait = float(r.headers.get("Retry-After") or 1)
            except (TypeError, ValueError):
                wait = 1.0
            await asyncio.sleep(min(max(wait, 0.2), 5.0))
            r = await client.post("https://api.tavily.com/search", headers=headers, json=body)
        return r

    def judge(entry, r) -> Verdict:
        status = int(getattr(r, "status_code", 0) or 0)
        if status in _OUTCOME:
            return Verdict(_OUTCOME[status], set_aside=True, seconds=_cooldown(status, getattr(r, "headers", None)))
        if status != 200:
            return Verdict("error")
        try:
            data = r.json()
            hit = bool(data.get("results"))
            credits = int(((data.get("usage") or {}).get("credits")) or (2 if body.get("search_depth") == "advanced" else 1))
        except Exception:
            hit, credits = False, 1
        return Verdict("found" if hit else "none", extra={"credits": credits})

    from app.providers.gateway import Answer, call_provider

    query = str(body.get("query") or "")

    async def ask(_client, _key) -> Answer:
        r = await _pool().run(send, judge, purpose=purpose, looked_for=query)
        if r is None:
            return Answer(None, outcome="none", units=0)  # no key at all (or the plan has no web search): nothing was sent
        status = int(getattr(r, "status_code", 0) or 0)
        if status == 200:
            try:
                data = r.json()
                hit = bool(data.get("results"))
                credits = int(((data.get("usage") or {}).get("credits")) or (2 if body.get("search_depth") == "advanced" else 1))
            except Exception:
                hit, credits = False, 1
            return Answer(r, outcome="found" if hit else "none", status=200, units=credits)
        # Every key refused, used up or rate limited, or Tavily failing: counts towards the circuit breaker. Not billed.
        bad = status in _OUTCOME or status >= 500
        return Answer(r, outcome="error" if bad else "none", status=status or None, units=0)

    # The key pool picks the key (pooled); the wrapper adds the cost cap, the circuit breaker and one log row (providers/gateway.py).
    res = await call_provider("tavily", purpose, ask, client=client, pooled=True, feature=purpose, looked_for=query[:200])
    return res.data
