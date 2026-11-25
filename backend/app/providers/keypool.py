"""One key pool for every provider that has backup keys (plan 11, Part A): Apollo and Tavily today, any provider tomorrow.

A pool holds the provider's main key (Platform Keys) and the backups staff add in the admin portal (an app_settings row
{"keys": [{"id", "label", "sealed"}]}). run() tries the keys in order. A key the provider says is out of credits, over its limit,
rate limited or refused is set aside for a while (whole, or for one kind of request only) and the same request goes to the next key.
Every request writes one log row, never the key itself: its id, label and last four characters. The provider's own rules (which
status means what, how long to wait, what counts as found) stay in its module and are passed in as `judge`.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger("keypool")

Entry = Tuple[str, str, str]  # (id, label, key)


@dataclass
class Verdict:
    """What one answer means. set_aside: put `scope` (the key id, or "<id>:<kind>") aside for `seconds` and try the next key;
    otherwise the answer stands. outcome and extra go to the log row."""
    outcome: str
    set_aside: bool = False
    seconds: int = 0
    scope: str = ""
    extra: Optional[Dict[str, Any]] = None


def tail(key: str) -> str:
    return key[-4:] if len(key) >= 4 else ""


def retry_after(headers: Any, default: int, floor: int = 30, ceiling: int = 86400) -> int:
    """Seconds from a Retry-After header, kept between floor and ceiling; default when there is none."""
    try:
        wait = int(float((headers or {}).get("retry-after") or (headers or {}).get("Retry-After") or 0))
    except (TypeError, ValueError):
        wait = 0
    return min(max(wait, floor), ceiling) if wait else default


class KeyPool:
    def __init__(self, *, name: str, backups_doc: str, main_key: Callable[[], Awaitable[str]], main_label: str,
                 log_row: Callable[..., Any], cool: Optional[Dict[str, float]] = None, source: str = "", plan_provider: str = ""):
        self.name = name
        self.backups_doc = backups_doc
        self.main_key = main_key
        self.main_label = main_label
        self.log_row = log_row  # (entry, purpose, looked_for, status, outcome, **extra) -> a model row to add
        self.cool: Dict[str, float] = cool if cool is not None else {}
        self.source = source  # a tenant_policy source name: when the organisation's rules block it, the pool has no keys
        self.plan_provider = plan_provider  # a provider id: when the company's plan leaves it out, the pool has no keys (services/plan_rules.py)

    async def backups(self) -> List[Dict[str, Any]]:
        from app.database import AsyncSessionLocal
        from app.models.models import AppSetting

        try:
            async with AsyncSessionLocal() as s:
                row = await s.get(AppSetting, self.backups_doc)
            return list((row.data or {}).get("keys") or []) if row else []
        except Exception as err:
            logger.debug(f"[{self.name}] backup keys not read: {err}")
            return []

    async def keys(self, lead: str = "") -> List[Entry]:
        """[(id, label, key)] in the order they are tried: the main key (or `lead`, a key the caller holds itself), then the backups.
        [] when the organisation's rules block this provider: every request then reports nothing found."""
        from app.services.secret_box import open_secret

        if self.source:
            from app.services import tenant_policy

            if not await tenant_policy.source_allowed(None, self.source):
                return []
        if self.plan_provider:
            from app.services.plan_rules import provider_allowed

            if not await provider_allowed(self.plan_provider):
                return []
        out: List[Entry] = []
        main = (lead or await self.main_key() or "").strip()
        if main:
            out.append(("main", self.main_label, main))
        for b in await self.backups():
            k = open_secret(b.get("sealed") or "").strip()
            if k and all(k != x[2] for x in out):
                out.append((b.get("id") or "", b.get("label") or "Backup key", k))
        return out

    def cooling_for(self, scope: str) -> int:
        return max(0, int(self.cool.get(scope, 0) - time.time()))

    def set_aside(self, scope: str, seconds: int) -> None:
        self.cool[scope] = time.time() + max(0, int(seconds))

    async def log(self, entry: Entry, purpose: str, looked_for: str, status: Optional[int], outcome: str, **extra: Any) -> None:
        try:
            from app.database import AsyncSessionLocal

            async with AsyncSessionLocal() as s:
                s.add(self.log_row(entry, purpose, (looked_for or "")[:200], status, outcome, **extra))
                await s.commit()
        except Exception as err:
            logger.debug(f"[{self.name}] call not logged: {err}")

    async def run(self, send: Callable[[Entry], Awaitable[Any]], judge: Callable[[Entry, Any], Verdict], *, purpose: str,
                  looked_for: str = "", lead: str = "", skip_scopes: Callable[[Entry], List[str]] = lambda e: [e[0]]) -> Any:
        """Sends the request with each key in turn until one gives an answer that stands. Returns that answer, the last set-aside answer
        when every key was set aside, or None when there is no key. A network error is logged and raised (it isn't the key's fault)."""
        last = None
        for entry in await self.keys(lead):
            if any(self.cooling_for(s) for s in skip_scopes(entry)):
                continue
            try:
                r = await send(entry)
            except Exception:
                await self.log(entry, purpose, looked_for, None, "error")
                raise
            last = r
            v = judge(entry, r)
            await self.log(entry, purpose, looked_for, int(getattr(r, "status_code", 0) or 0), v.outcome, **(v.extra or {}))
            if v.set_aside:
                self.set_aside(v.scope or entry[0], v.seconds)
                logger.warning(f"[{self.name}] {entry[1]} answered {getattr(r, 'status_code', '?')}; trying the next key")
                continue
            return r
        return last
