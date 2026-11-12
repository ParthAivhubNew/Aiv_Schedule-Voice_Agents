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
    return key[-4:] if len(key) >= 4 else ""


async def backups() -> List[Dict[str, Any]]:
    from app.database import AsyncSessionLocal
    from app.models.models import AppSetting

    try:
        async with AsyncSessionLocal() as s:
            row = await s.get(AppSetting, BACKUPS_DOC)
        return list((row.data or {}).get("keys") or []) if row else []
    except Exception as err:
        logger.debug(f"[apollo] backup keys not read: {err}")
        return []


async def keys(lead: str = "") -> List[Tuple[str, str, str]]:
    """[(id, label, key)] in the order they are tried: the main key (or `lead`, when the caller holds its own), then the backups."""
    from app.services import enrichment_service as E
    from app.services.secret_box import open_secret

    out: List[Tuple[str, str, str]] = []
    main = (lead or await E.apollo_key() or "").strip()
    if main:
        out.append(("main", "Apollo key", main))
    for b in await backups():
        k = open_secret(b.get("sealed") or "").strip()
        if k and all(k != x[2] for x in out):
            out.append((b.get("id") or "", b.get("label") or "Backup key", k))
    return out


def cooling_for(key_id: str) -> int:
    return max(0, int(_COOL.get(key_id, 0) - time.time()))


async def _log(key: Tuple[str, str, str], purpose: str, looked_for: str, status: Optional[int], outcome: str) -> None:
    try:
        from app.core.tenancy import current_actor, current_org, current_route
        from app.database import AsyncSessionLocal
        from app.models.models import ApolloCall

        async with AsyncSessionLocal() as s:
            s.add(ApolloCall(id=uuid.uuid4().hex, key_id=key[0], key_label=key[1], key_tail=_tail(key[2]), purpose=purpose,
                             looked_for=(looked_for or "")[:200], for_org=current_org() or "", actor=current_actor(), route=current_route(),
                             status=status, outcome=outcome))
            await s.commit()
    except Exception as err:
        logger.debug(f"[apollo] call not logged: {err}")


async def call(client: Any, method: str, url: str, *, purpose: str, looked_for: str = "", lead: str = "",
               found: Optional[Callable[[Any], bool]] = None, **kw: Any) -> Any:
    """Send one request, failing over to the next key when one is out of credits. Returns the last response
    (an exhausted one when every key was), or None when there is no key at all. A network error is raised: it is not the key's fault."""
    from app.services import enrichment_service as E

    last = None
    for entry in await keys(lead):
        if cooling_for(entry[0]) or cooling_for(f"{entry[0]}:{purpose}"):
            continue
        headers = {**(kw.get("headers") or {}), "x-api-key": entry[2], "Content-Type": "application/json"}
        try:
            r = await getattr(client, method.lower())(url, **{**kw, "headers": headers})
        except Exception:
            await _log(entry, purpose, looked_for, None, "error")
            raise
        last = r
        status = int(getattr(r, "status_code", 0) or 0)
        text = str(getattr(r, "text", "") or "").lower()
        if status in _OUTCOME and (status != 422 or "credit" in text):
            _COOL[f"{entry[0]}:{purpose}" if status == 403 else entry[0]] = time.time() + _cooldown(status, getattr(r, "headers", None), text)
            await _log(entry, purpose, looked_for, status, _OUTCOME[status])
            logger.warning(f"[apollo] {entry[1]} answered {status}; trying the next key")
            continue
        await E._bump_vendor_call("apollo")
        if status == 200:
            try:
                hit = found(r.json()) if found else True
            except Exception:
                hit = False
            await _log(entry, purpose, looked_for, status, "found" if hit else "none")
        else:
            await _log(entry, purpose, looked_for, status, "error")
        return r
    return last
