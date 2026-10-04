"""Find a person's work email: shared cache first, then each email-finder provider in turn.

Order: cache (free) -> Icypeas -> Hunter -> Findymail -> LeadMagic -> BetterContact. Only the
providers whose key staff saved in the owner portal (Platform keys -> Email Finder) are tried.
A provider is trusted only when it says the address is verified/deliverable; guesses are never
returned or stored. The company pays 1 credit (lead_lookup) only when an email is found.

Each provider adapter follows that provider's public API documentation; check them once with
the trial keys (a failing provider is skipped and logged, never charged).
Evaluates UK PECR entity status: corporate (Ltd/PLC/LLP/Public) vs individual vs unknown.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import PersonCache, EnrichmentAttempt
from app.services.credits import charge, can_start

logger = logging.getLogger("enrichment_waterfall")

# UK Corporate entity suffix detection
CORPORATE_SUFFIXES = [
    r"\bltd\b", r"\blimited\b", r"\bplc\b", r"\bllp\b", r"\binc\b", r"\bcorp\b",
    r"\bcorporation\b", r"\bgmbh\b", r"\bsas\b", r"\bsarl\b", r"\bco\b", r"\bcompany\b"
]
CORPORATE_REGEX = re.compile("|".join(CORPORATE_SUFFIXES), re.IGNORECASE)

# Circuit breaker state: provider -> failure_count
_PROVIDER_FAILS: Dict[str, int] = {}
_PROVIDER_BACKOFF_UNTIL: Dict[str, float] = {}
CIRCUIT_FAIL_LIMIT = 5
CIRCUIT_RESET_SECONDS = 300  # 5 min backoff on failing API


def classify_pecr_entity(company_name: str, email: str = "") -> str:
    """Classifies an entity for UK PECR B2B cold outreach compliance.
    
    Returns:
    - 'corporate': Ltd, PLC, LLP, Inc, Corp, or institutional domain -> Safe for B2B cold email
    - 'individual': Sole trader, personal webmail (@gmail, @yahoo, @hotmail) -> Consent required
    - 'unknown': Ambiguous -> Blocked from cold email by default
    """
    if not company_name and not email:
        return "unknown"

    # Check for consumer webmail domains
    if any(email.lower().endswith(f"@{domain}") for domain in ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"]):
        return "individual"

    # Check for corporate suffix in company name
    if company_name and CORPORATE_REGEX.search(company_name):
        return "corporate"

    # Default to corporate if it has a distinct custom company domain, otherwise unknown
    if email and "@" in email:
        domain = email.split("@")[1].lower()
        if "." in domain and not any(domain.startswith(p) for p in ["gmail", "yahoo", "hotmail", "outlook"]):
            return "corporate"

    return "unknown"


PROVIDERS = ["icypeas", "hunter", "findymail", "leadmagic", "bettercontact"]
LABELS = {"icypeas": "Icypeas", "hunter": "Hunter", "findymail": "Findymail", "leadmagic": "LeadMagic", "bettercontact": "BetterContact"}
# What one successful search costs us on each provider's entry plan (USD, for the margin report).
COST_USD = {"icypeas": 0.01, "hunter": 0.03, "findymail": 0.03, "leadmagic": 0.02, "bettercontact": 0.05}

# Other pay-as-you-go data providers billed per call rather than per verified result (open-web
# search and phone validation) — not part of the email-finder waterfall above, but priced here
# too so the admin portal's vendor-spend estimate has one place to read real per-call costs from.
OTHER_VENDOR_COST_USD = {"tavily": 0.008, "telnyx_lookup": 0.003}
OTHER_VENDOR_LABELS = {"tavily": "Tavily (web search)", "telnyx_lookup": "Telnyx (number lookup)"}
HTTP_TIMEOUT = httpx.Timeout(20.0, connect=8.0)


class ProviderError(RuntimeError):
    """The provider failed (bad key, out of credits, down); the next one is tried."""


async def finder_keys() -> Dict[str, str]:
    """{provider: key} for the Email Finder providers staff saved, in waterfall order."""
    from app.core.platform import platform_org_id
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import Connection
    from app.services.secret_box import config_get_secret, open_config

    found: Dict[str, str] = {}
    try:
        with org_scope(platform_org_id()):
            async with AsyncSessionLocal() as s:
                rows = (await s.execute(select(Connection).where(Connection.group_name == "Email Finder"))).scalars().all()
        for c in rows:
            name = re.sub(r"[^a-z]", "", (c.name or "").lower())
            prov = next((p for p in PROVIDERS if p in name), "")
            if prov and prov not in found:
                key = config_get_secret(open_config(c.config if isinstance(c.config, dict) else {}), "api_key", "auth_token")
                if key:
                    found[prov] = key.strip()
    except Exception as err:
        logger.warning(f"Email Finder keys not read: {err}")
    return {p: found[p] for p in PROVIDERS if p in found}


def _check(res: httpx.Response, provider: str) -> Any:
    if res.status_code in (401, 403):
        raise ProviderError(f"{LABELS[provider]}: key rejected ({res.status_code}).")
    if res.status_code == 402:
        raise ProviderError(f"{LABELS[provider]}: out of credits.")
    if res.status_code == 429:
        raise ProviderError(f"{LABELS[provider]}: rate limited.")
    if res.status_code == 404:
        return {}
    if res.status_code >= 400:
        raise ProviderError(f"{LABELS[provider]}: HTTP {res.status_code} {res.text[:160]}")
    try:
        return res.json()
    except Exception:
        raise ProviderError(f"{LABELS[provider]}: unreadable answer.")


# Each adapter: (key, person) -> (email, status). status is "verified", "catch_all" or "" (none).
async def _hunter(client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
    params = {"first_name": p["first_name"], "last_name": p["last_name"], "api_key": key}
    params["domain" if p["domain"] else "company"] = p["domain"] or p["company"]
    data = (_check(await client.get("https://api.hunter.io/v2/email-finder", params=params), "hunter") or {}).get("data") or {}
    email_addr = data.get("email") or ""
    status = ((data.get("verification") or {}).get("status") or "").lower()
    if email_addr and (status == "valid" or (not status and int(data.get("score") or 0) >= 90)):
        return email_addr, "verified"
    if email_addr and status == "accept_all":
        return email_addr, "catch_all"
    return "", ""


async def _findymail(client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
    body = {"name": f"{p['first_name']} {p['last_name']}".strip(), "domain": p["domain"] or p["company"]}
    res = await client.post("https://app.findymail.com/api/search/name", json=body,
                            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    contact = (_check(res, "findymail") or {}).get("contact") or {}
    email_addr = contact.get("email") or ""
    return (email_addr, "verified") if email_addr else ("", "")  # Findymail returns verified emails only


async def _leadmagic(client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
    body = {"first_name": p["first_name"], "last_name": p["last_name"], "domain": p["domain"], "company_name": p["company"]}
    res = await client.post("https://api.leadmagic.io/email-finder", json=body, headers={"X-API-Key": key})
    data = _check(res, "leadmagic") or {}
    email_addr = data.get("email") or ""
    status = str(data.get("status") or data.get("email_status") or "").lower()
    if email_addr and status in ("valid", "verified", "deliverable"):
        return email_addr, "verified"
    if email_addr and "catch" in status:
        return email_addr, "catch_all"
    return "", ""


async def _icypeas(client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
    headers = {"Authorization": key, "Content-Type": "application/json"}
    body = {"firstname": p["first_name"], "lastname": p["last_name"], "domainOrCompany": p["domain"] or p["company"]}
    started = _check(await client.post("https://app.icypeas.com/api/email-search", json=body, headers=headers), "icypeas") or {}
    search_id = ((started.get("item") or {}).get("_id")) or ""
    if not search_id:
        raise ProviderError("Icypeas: search not started.")
    for _ in range(10):  # the search runs in the background; it usually finishes in a few seconds
        await asyncio.sleep(1.5)
        read = _check(await client.post("https://app.icypeas.com/api/bulk-single-searchs/read",
                                         json={"id": search_id}, headers=headers), "icypeas") or {}
        item = (read.get("items") or [{}])[0]
        if item.get("status") in ("DEBITED", "FOUND", "NOT_FOUND", "DEBITED_NOT_FOUND", "BAD_INPUT", "INSUFFICIENT_FUNDS", "ABORTED"):
            emails = ((item.get("results") or {}).get("emails")) or []
            best = next((e for e in emails if str(e.get("certainty", "")).lower() in ("ultra_sure", "sure")), None)
            if best and best.get("email"):
                return best["email"], "verified"
            return "", ""
    return "", ""


async def _bettercontact(client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
    headers = {"X-API-Key": key, "Content-Type": "application/json"}
    body = {"data": [{"first_name": p["first_name"], "last_name": p["last_name"], "company": p["company"],
                      "company_domain": p["domain"]}], "enrich_email_address": True, "enrich_phone_number": False}
    started = _check(await client.post("https://app.bettercontact.rocks/api/v2/async", json=body, headers=headers), "bettercontact") or {}
    req_id = started.get("id") or ""
    if not req_id:
        raise ProviderError("BetterContact: request not started.")
    for _ in range(12):  # BetterContact runs its own waterfall; allow it up to ~30 seconds
        await asyncio.sleep(2.5)
        got = _check(await client.get(f"https://app.bettercontact.rocks/api/v2/async/{req_id}", headers=headers), "bettercontact") or {}
        if str(got.get("status") or "").lower() in ("terminated", "completed", "done"):
            row = (got.get("data") or [{}])[0]
            email_addr = row.get("contact_email_address") or ""
            status = str(row.get("contact_email_address_status") or "").lower()
            if email_addr and status in ("deliverable", "valid", "verified"):
                return email_addr, "verified"
            if email_addr and "catch" in status:
                return email_addr, "catch_all"
            return "", ""
    return "", ""


ADAPTERS = {"icypeas": _icypeas, "hunter": _hunter, "findymail": _findymail, "leadmagic": _leadmagic, "bettercontact": _bettercontact}


def _person_out(email_addr: str, p: Dict[str, str], entity: str, status: str, source: str) -> Dict[str, Any]:
    return {"found": True, "email": email_addr, "first_name": p["first_name"], "last_name": p["last_name"],
            "company_name": p["company"], "domain": p["domain"] or email_addr.split("@")[-1],
            "entity_type": entity, "verification_status": status, "source": source, "cost_credits": 1}


def _domain_of(raw: str) -> str:
    d = (raw or "").strip().lower()
    d = re.sub(r"^https?://", "", d).split("/")[0]
    return d[4:] if d.startswith("www.") else d


async def _auto_enroll_prospect(
    db: AsyncSession,
    org_id: str,
    email_addr: str,
    p: Dict[str, str],
    mission_id: Optional[str],
    prospect_id: Optional[str],
) -> None:
    """If mission has auto_enroll_campaign_id configured, enroll the found lead automatically."""
    if not (mission_id and email_addr):
        return
    try:
        from app.models.models import Mission, EmailEnrollment
        mission = (await db.execute(
            select(Mission).where(Mission.id == mission_id, Mission.org_id == org_id)
        )).scalars().first()
        if not (mission and mission.auto_enroll_campaign_id):
            return
        existing = (await db.execute(select(EmailEnrollment.id).where(
            EmailEnrollment.campaign_id == mission.auto_enroll_campaign_id,
            EmailEnrollment.email == email_addr.lower()
        ))).first()
        if not existing:
            db.add(EmailEnrollment(
                id=f"en_{uuid.uuid4().hex[:12]}",
                campaign_id=mission.auto_enroll_campaign_id,
                prospect_id=prospect_id or None,
                email=email_addr.lower(),
                first_name=p.get("first_name", "")[:80],
                last_name=p.get("last_name", "")[:80],
                company=p.get("company", "")[:160],
                current_step=1,
                status="active",
                next_action_at=datetime.utcnow(),
            ))
    except Exception as err:
        logger.warning(f"[auto_enroll] Auto-enrollment failed: {err}")


async def lookup_person_waterfall(
    db: AsyncSession,
    org_id: str,
    first_name: str,
    last_name: str,
    company_name: str,
    domain: str = "",
    pdl_person_id: Optional[str] = None,
    mission_id: Optional[str] = None,
    prospect_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Finds a verified work email; charges 1 credit only when one is found."""
    p = {"first_name": (first_name or "").strip(), "last_name": (last_name or "").strip(),
         "company": (company_name or "").strip(), "domain": _domain_of(domain)}
    if not (p["first_name"] and p["last_name"] and (p["domain"] or p["company"])):
        return {"found": False, "error": "bad_input", "detail": "Give a first name, last name and the company's website or name."}
    query = f"{p['first_name']} {p['last_name']} @ {p['domain'] or p['company']}"

    ok, why = await can_start(db, "lead_lookup")
    if not ok:
        return {"found": False, "error": "insufficient_credits", "detail": why}

    # 1. Shared cache: a verified address found earlier, for anyone.
    q = select(PersonCache).where(PersonCache.verification_status.in_(("verified", "catch_all")))
    if pdl_person_id:
        q = q.where(PersonCache.pdl_person_id == pdl_person_id)
    else:
        q = q.where(PersonCache.first_name.ilike(p["first_name"]), PersonCache.last_name.ilike(p["last_name"]))
        q = q.where(PersonCache.domain == p["domain"]) if p["domain"] else q.where(PersonCache.company_name.ilike(p["company"]))
    cached = (await db.execute(q.order_by(PersonCache.updated_at.desc()))).scalars().first()
    if cached and cached.email:
        db.add(EnrichmentAttempt(id=str(uuid.uuid4()), org_id=org_id, query=query, provider="cache",
                                 found_email=cached.email, cost_usd=0.0, latency_ms=0, hit=True))
        await charge(db, "lead_lookup", 1, f"lead:{uuid.uuid4().hex[:16]}", f"Email found: {query}")
        await _auto_enroll_prospect(db, org_id, cached.email, p, mission_id, prospect_id)
        await db.commit()
        return _person_out(cached.email, p, cached.entity_type, cached.verification_status, "cache")

    # 2. Providers, in order, until one finds a verified address.
    keys = await finder_keys()
    if not keys:
        return {"found": False, "error": "not_configured",
                "detail": "Email finding isn't set up yet. The Outreach team adds it in the owner portal."}
    found_email, status, winner, catch_all = "", "", "", None
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        for provider, key in keys.items():
            if _PROVIDER_BACKOFF_UNTIL.get(provider, 0) > time.time():
                continue
            started = time.time()
            try:
                email_addr, st = await ADAPTERS[provider](client, key, p)
                _PROVIDER_FAILS[provider] = 0
            except Exception as err:
                logger.warning(f"[Email Finder] {provider} failed: {err}")
                _PROVIDER_FAILS[provider] = _PROVIDER_FAILS.get(provider, 0) + 1
                if _PROVIDER_FAILS[provider] >= CIRCUIT_FAIL_LIMIT:
                    _PROVIDER_BACKOFF_UNTIL[provider] = time.time() + CIRCUIT_RESET_SECONDS
                continue
            db.add(EnrichmentAttempt(id=str(uuid.uuid4()), org_id=org_id, query=query, provider=provider,
                                     found_email=email_addr or "", cost_usd=COST_USD[provider] if email_addr else 0.0,
                                     latency_ms=int((time.time() - started) * 1000), hit=st == "verified"))
            if st == "verified":
                found_email, status, winner = email_addr, st, provider
                break
            if st == "catch_all" and not catch_all:
                catch_all = (email_addr, provider)  # kept in case nobody verifies it
    if not found_email and catch_all:
        found_email, winner = catch_all
        status = "catch_all"
    if not found_email:
        await db.commit()
        return {"found": False, "query": query, "detail": "No verified email found for this person."}

    entity = classify_pecr_entity(p["company"], found_email)
    db.add(PersonCache(id=str(uuid.uuid4()), pdl_person_id=pdl_person_id or None, email=found_email.lower(),
                       first_name=p["first_name"], last_name=p["last_name"], company_name=p["company"],
                       domain=p["domain"] or found_email.split("@")[-1].lower(), entity_type=entity,
                       entity_verified=False, verification_status=status, verified_at=datetime.utcnow(), source=winner))
    await charge(db, "lead_lookup", 1, f"lead:{uuid.uuid4().hex[:16]}", f"Email found: {query}")
    await _auto_enroll_prospect(db, org_id, found_email, p, mission_id, prospect_id)
    await db.commit()
    return _person_out(found_email.lower(), p, entity, status, winner)
