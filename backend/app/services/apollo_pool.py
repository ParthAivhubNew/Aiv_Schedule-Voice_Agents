"""Apollo keys: the main one (Platform Keys) plus backups staff add in the admin portal.

Every Apollo request goes through call(). It tries the keys in order; a key that is out of credits,
rate limited or refused is set aside for a while and the next one is used for the same task. Each
request is logged (never the key) so staff can see when Apollo is hit and for what."""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger("apollo_pool")

BACKUPS_DOC = "apollo_backup_keys"  # app_settings row: {"keys": [{"id", "label", "sealed"}]}
# What Apollo's documentation says each answer means (docs.apollo.io: status codes, rate limits):
#   429  a per-minute, hourly or daily limit was hit; the Retry-After header says for how many seconds. Credits can also run out behind a 429.
#   401  the key is not valid: set the whole key aside.
#   403  the key may not use that endpoint (a standard key where a master key is needed): only that kind of request is set aside, the key still serves the rest.
#   402 / 422 "credit"  out of credits: set the whole key aside.
LONG = 1800  # seconds
_COOL: Dict[str, float] = {}
_OUTCOME = {429: "rate_limited", 401: "refused", 402: "key_exhausted", 403: "refused", 422: "key_exhausted"}


def _cooldown(status: int, headers: Any, text: str) -> int:
    if status == 429:
        try:
            wait = int(float((headers or {}).get("retry-after") or (headers or {}).get("Retry-After") or 0))
        except (TypeError, ValueError):
            wait = 0
        return min(max(wait, 30), 86400) if wait else (LONG if "credit" in text else 90)
    return LONG


def route_label(route: str) -> str:
    """The user-facing name of the action behind a request ("Find website"), or the request itself when it is not one we know."""
    import re

    if not route:
        return "Background job"
    if route.startswith("JOB "):
        return f"Background job ({route[4:].replace('_', ' ')})"
    if route.startswith("script "):
        return f"Script run by hand ({route[7:]})"
    path = route.split(" ", 1)[-1]
    path = re.sub(r"^/api", "", path)
    for pattern, label in _ROUTES:
        if re.search(pattern, path):
            return label
    return route


_ROUTES = [
    (r"^/leads/companies/[^/]+/find-website", "Find website (company)"),
    (r"^/leads/companies/[^/]+/contacts", "Find people at a company"),
    (r"^/leads/companies/[^/]+/person-email", "Find a person's email"),
    (r"^/leads/companies/(reveal-many|[^/]+/reveal)", "Reveal contact details"),
    (r"^/leads/companies/[^/]+/(find-linkedin|find-social)", "Find LinkedIn / social pages"),
    (r"^/leads/accounts/[^/]+/(quick-check|deep-search)", "Quick check / deep search (My List)"),
    (r"^/leads/accounts/[^/]+/research", "Research a company"),
    (r"^/leads/(accounts/check|company-check)", "Company check"),
    (r"^/leads/ask", "AI Assistant (Leads)"),
    (r"^/leads/", "Leads"),
    (r"^/email|^/outreach", "Email outreach"),
    (r"^/journeys", "Journeys"),
    (r"^/v1", "Partner API"),
]


def _tail(key: str) -> str:
    from app.providers.keypool import tail

    return tail(key)


def _row(entry, purpose, looked_for, status, outcome):
    from app.core.tenancy import current_actor, current_org, current_route
    from app.models.models import ApolloCall

    return ApolloCall(id=uuid.uuid4().hex, key_id=entry[0], key_label=entry[1], key_tail=_tail(entry[2]), purpose=purpose, looked_for=looked_for,
                      for_org=current_org() or "", actor=current_actor(), route=current_route(), status=status, outcome=outcome)


async def _main_key() -> str:
    from app.services import enrichment_service as E

    return await E.apollo_key()


def _pool():
    from app.providers.keypool import KeyPool

    return KeyPool(name="apollo", backups_doc=BACKUPS_DOC, main_key=_main_key, main_label="Apollo key", log_row=_row, cool=_COOL,
                   source="apollo", plan_provider="apollo")  # the organisation's rules can block Apollo: no key, so every lookup reports nothing found


async def backups() -> List[Dict[str, Any]]:
    return await _pool().backups()


async def keys(lead: str = "") -> List[Tuple[str, str, str]]:
    """[(id, label, key)] in the order they are tried: the main key (or `lead`, when the caller holds its own), then the backups."""
    return await _pool().keys(lead)


def cooling_for(key_id: str) -> int:
    return max(0, int(_COOL.get(key_id, 0) - time.time()))


async def _log(key: Tuple[str, str, str], purpose: str, looked_for: str, status: Optional[int], outcome: str) -> None:
    await _pool().log(key, purpose, looked_for, status, outcome)


async def call(client: Any, method: str, url: str, *, purpose: str, looked_for: str = "", lead: str = "",
               found: Optional[Callable[[Any], bool]] = None, **kw: Any) -> Any:
    """Send one request, failing over to the next key when one is out of credits. Returns the last response
    (an exhausted one when every key was), or None when there is no key at all. A network error is raised: it is not the key's fault."""
    from app.providers.keypool import Verdict
    from app.services import enrichment_service as E

    async def send(entry):
        headers = {**(kw.get("headers") or {}), "x-api-key": entry[2], "Content-Type": "application/json"}
        return await getattr(client, method.lower())(url, **{**kw, "headers": headers})

    def judge(entry, r) -> Verdict:
        status = int(getattr(r, "status_code", 0) or 0)
        text = str(getattr(r, "text", "") or "").lower()
        if status in _OUTCOME and (status != 422 or "credit" in text):
            # 403: this key may not use this kind of request; only that kind is set aside, the key still serves the rest.
            return Verdict(_OUTCOME[status], set_aside=True, seconds=_cooldown(status, getattr(r, "headers", None), text),
                           scope=f"{entry[0]}:{purpose}" if status == 403 else entry[0])
        if status != 200:
            return Verdict("error")
        try:
            hit = found(r.json()) if found else True
        except Exception:
            hit = False
        return Verdict("found" if hit else "none")

    async def counted_send(entry):
        r = await send(entry)
        status = int(getattr(r, "status_code", 0) or 0)
        if not (status in _OUTCOME and (status != 422 or "credit" in str(getattr(r, "text", "") or "").lower())):
            await E._bump_vendor_call("apollo")  # an answer that stands is one Apollo call
        return r

    return await _pool().run(counted_send, judge, purpose=purpose, looked_for=looked_for, lead=lead,
                             skip_scopes=lambda e: [e[0], f"{e[0]}:{purpose}"])


# One company is asked about once. The answer (or the fact that Apollo had nothing) is kept for everyone, so no other button, screen or
# organisation sends the same question again. A failed or refused request is not kept: it was not an answer.
LOOKUP_HIT_DAYS, LOOKUP_MISS_DAYS = 30, 7


def lookup_key(name: str, postcode: str, domain: str) -> str:
    import hashlib
    import re

    squash = lambda v: re.sub(r"[^a-z0-9]", "", str(v or "").lower())  # noqa: E731
    return "apollo_lookup:" + hashlib.sha1(f"{(domain or '').strip().lower()}|{squash(name)}|{squash(postcode)}".encode()).hexdigest()[:24]


async def lookup_get(key: str) -> Optional[Dict[str, Any]]:
    """The kept answer: the company ({...}), {} when Apollo had nothing, None when there is no fresh answer."""
    from datetime import datetime

    from app.database import AsyncSessionLocal
    from app.models.models import AppSetting

    try:
        async with AsyncSessionLocal() as s:
            row = await s.get(AppSetting, key)
        data = (row.data or {}) if row else {}
        if not data:
            return None
        age = (datetime.utcnow() - datetime.fromisoformat(str(data.get("at", "")).rstrip("Z"))).days
        result = data.get("result") or {}
        return result if age <= (LOOKUP_HIT_DAYS if result else LOOKUP_MISS_DAYS) else None
    except Exception as err:
        logger.debug(f"[apollo] kept answer not read: {err}")
        return None


async def lookup_put(key: str, result: Dict[str, Any]) -> None:
    from datetime import datetime

    from app.database import AsyncSessionLocal
    from app.models.models import AppSetting

    try:
        async with AsyncSessionLocal() as s:
            row = await s.get(AppSetting, key)
            data = {"at": datetime.utcnow().isoformat() + "Z", "result": result or {}}
            if row:
                row.data = data
            else:
                s.add(AppSetting(id=key, data=data))
            await s.commit()
    except Exception as err:
        logger.debug(f"[apollo] answer not kept: {err}")
