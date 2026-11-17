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
    return key[-4:] if len(key) >= 4 else ""


async def backups() -> List[Dict[str, Any]]:
    from app.database import AsyncSessionLocal
    from app.models.models import AppSetting

    try:
        async with AsyncSessionLocal() as s:
            row = await s.get(AppSetting, BACKUPS_DOC)
        return list((row.data or {}).get("keys") or []) if row else []
    except Exception as err:
        logger.debug(f"[tavily] backup keys not read: {err}")
        return []


async def keys() -> List[Tuple[str, str, str]]:
    """[(id, label, key)] in the order they are tried: the main key (Platform Keys), then the backups."""
    from app.services import enrichment_service as E
    from app.services.secret_box import open_secret

    out: List[Tuple[str, str, str]] = []
    main = (await E.tavily_key() or "").strip()
    if main:
        out.append(("main", "Tavily key", main))
    for b in await backups():
        k = open_secret(b.get("sealed") or "").strip()
        if k and all(k != x[2] for x in out):
            out.append((b.get("id") or "", b.get("label") or "Backup key", k))
    return out


def cooling_for(key_id: str) -> int:
    return max(0, int(_COOL.get(key_id, 0) - time.time()))


async def _log(key: Tuple[str, str, str], purpose: str, looked_for: str, status: Optional[int], outcome: str, credits: int = 0) -> None:
    try:
        from app.core.tenancy import current_actor, current_org, current_route
        from app.database import AsyncSessionLocal
        from app.models.models import TavilyCall

        async with AsyncSessionLocal() as s:
            s.add(TavilyCall(id=uuid.uuid4().hex, key_id=key[0], key_label=key[1], key_tail=_tail(key[2]), purpose=purpose,
                             looked_for=(looked_for or "")[:200], for_org=current_org() or "", actor=current_actor(), route=current_route(),
                             status=status, outcome=outcome, credits=int(credits or 0)))
            await s.commit()
    except Exception as err:
        logger.debug(f"[tavily] call not logged: {err}")


async def search(client: Any, body: Dict[str, Any], *, purpose: str = "search") -> Any:
    """POST one search, failing over to the next key when one is exhausted, over its limit or refused. Returns the last response
    (a refused one when every key was), or None when there is no key at all. A network error is raised: it is not the key's fault."""
    last = None
    query = str(body.get("query") or "")
    for entry in await keys():
        if cooling_for(entry[0]):
            continue
        headers = {"Authorization": f"Bearer {entry[2]}"}
        try:
            r = await client.post("https://api.tavily.com/search", headers=headers, json=body)
            if int(getattr(r, "status_code", 0) or 0) == 429:  # one polite retry after the wait Tavily asks for
                try:
                    wait = float(r.headers.get("Retry-After") or 1)
                except (TypeError, ValueError):
                    wait = 1.0
                await asyncio.sleep(min(max(wait, 0.2), 5.0))
                r = await client.post("https://api.tavily.com/search", headers=headers, json=body)
        except Exception:
            await _log(entry, purpose, query, None, "error")
            raise
        last = r
        status = int(getattr(r, "status_code", 0) or 0)
        if status in _OUTCOME:
            _COOL[entry[0]] = time.time() + _cooldown(status, getattr(r, "headers", None))
            await _log(entry, purpose, query, status, _OUTCOME[status])
            logger.warning(f"[tavily] {entry[1]} answered {status}; trying the next key")
            continue
        if status == 200:
            try:
                data = r.json()
                hit = bool(data.get("results"))
                credits = int(((data.get("usage") or {}).get("credits")) or (2 if body.get("search_depth") == "advanced" else 1))
            except Exception:
                hit, credits = False, 1
            await _log(entry, purpose, query, status, "found" if hit else "none", credits)
        else:
            await _log(entry, purpose, query, status, "error")
        return r
    return last
