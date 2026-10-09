"""Check companies: is each saved company real, still trading, and are its contact details working?

For every company, cheapest first:
  A. Our own records (free): the shared company store.
  B. The company register, asked directly (1 credit): only when our own records can't settle it.
  C. Website, email and phone checks (free), run alongside the others.
  D. Deep web search (2 credits): only when no register or record knows the company.
  E. Contact email finder (optional, 2.5 credits when a verified email is found).

Nothing here overwrites what the user saved: the answer goes in LeadAccount.verification, with the
evidence and the stages that actually ran. A register answer is saved back to the shared store (at the
register's own trust tier) so the next organisation checking the same company gets it free.

Clients only ever see generic names ("our records", "the company register", "deep web search").
The pure decision rules (name matching, status reading, verdicts) have no network or database in
them so they can be tested on their own.
"""
from __future__ import annotations

import asyncio
import difflib
import logging
import re
import time
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("company_check")

FRESH_DAYS = 35  # the monthly register download is this recent: its answer is good enough to skip a live call
NAME_MATCH_MIN = 0.88  # how alike two company names must be to count as the same company
LINK_MATCH_MIN = 0.97  # only a (near) exact name is allowed to link or update a stored record
REGISTRY_MIN_GAP_S = 0.55  # the register allows about 600 questions per 5 minutes
THROTTLE_PAUSE_S = 60
WORKERS = 8
STALL_AFTER = timedelta(minutes=5)

VERDICTS = ("verified", "looks_ok", "not_found", "problem", "unclear")

_NAME_NOISE = {"ltd", "limited", "plc", "llp", "lp", "co", "company", "the", "inc", "uk", "group", "holdings"}
_ACTIVE_WORDS = ("active", "registered", "open", "operational", "trading")
_DEAD_WORDS = ("dissol", "closed", "removed", "liquidat", "administr", "receiv", "struck", "ceased", "insolven", "converted")
_PARKED = ("domain is for sale", "this domain may be for sale", "buy this domain", "domain for sale", "parked free",
           "this domain is parked", "domain parking", "sedoparking", "hugedomains", "is for sale!", "coming soon - this domain")
_WEBMAIL = {"gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "icloud.com", "aol.com", "btinternet.com", "msn.com"}
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-']+@([A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+)$")


# ── pure rules ───────────────────────────────────────────────────────────────────────────────────
def name_key(name: str) -> str:
    """A company name reduced to what identifies it: lower case, '&' as 'and', no punctuation, no
    'Ltd'/'Limited'/'The' noise."""
    s = re.sub(r"[^a-z0-9 ]+", " ", str(name or "").lower().replace("&", " and "))
    return " ".join(w for w in s.split() if w not in _NAME_NOISE)


def name_score(a: str, b: str) -> float:
    ka, kb = name_key(a), name_key(b)
    if not ka or not kb:
        return 0.0
    if ka == kb:
        return 1.0
    return difflib.SequenceMatcher(None, ka, kb).ratio()


def status_class(status: str) -> str:
    """'active', 'dead' or '' (unknown) from whatever word a source uses for a company's status."""
    s = str(status or "").strip().lower()
    if not s:
        return ""
    if any(w in s for w in _DEAD_WORDS):
        return "dead"
    if any(w in s for w in _ACTIVE_WORDS):
        return "active"
    return ""


def email_shape(email: str) -> Tuple[bool, str]:
    m = _EMAIL_RE.match((email or "").strip())
    return (True, m.group(1).lower()) if m else (False, "")


def email_matches_person(email: str, contact_name: str) -> bool:
    """Is this company address plainly one person's own -- ann@, ann.lee@, alee@, lee@ -- for the
    contact named? Generic boxes (info@, sales@) and personal webmail never count."""
    ok, domain = email_shape(email)
    parts = re.sub(r"[^a-z ]", "", str(contact_name or "").lower()).split()
    if not ok or domain in _WEBMAIL or len(parts) < 2:
        return False
    local = re.sub(r"[^a-z]", "", email.split("@")[0].lower())
    first, last = parts[0], parts[-1]
    return len(local) >= 3 and local in {first, last, first + last, last + first, first[0] + last, last + first[0]}


def phone_shape(raw: str) -> str:
    """'ok', 'invalid' or 'none' -- format only (no call is made)."""
    raw = (raw or "").strip()
    if not raw:
        return "none"
    from app.services.enrichment_service import _is_real_phone
    from app.services.timezone_service import normalize_phone

    e164 = normalize_phone(raw)
    digits = re.sub(r"\D", "", e164)
    if not _is_real_phone(raw) or not (10 <= len(digits) <= 15):
        return "invalid"
    if e164.startswith("+44") and not (10 <= len(digits) <= 12):
        return "invalid"
    return "ok"


def is_parked(html: str) -> bool:
    low = (html or "")[:60000].lower()
    return any(p in low for p in _PARKED)


def name_on_page(name: str, html: str) -> bool:
    words = [w for w in name_key(name).split() if len(w) > 2]
    if not words:
        return True
    low = re.sub(r"\s+", " ", (html or "")[:200000].lower())
    hits = sum(1 for w in words if w in low)
    return hits * 2 >= len(words)


def best_hit(hits: List[Dict[str, Any]], name: str, reg_no: str = "") -> Tuple[Optional[Dict[str, Any]], float]:
    """The search hit most like this company: an exact registration number wins, otherwise the
    closest name, preferring an active company when two names are equally close."""
    best, best_rank, best_score = None, (-1.0, -1), 0.0
    for h in hits:
        if reg_no and str(h.get("registration_number") or "").strip().upper() == reg_no.strip().upper():
            return h, 1.0
        score = name_score(name, h.get("name", ""))
        rank = (round(score, 3), 1 if status_class(h.get("status", "")) == "active" else 0)
        if rank > best_rank:
            best, best_rank, best_score = h, rank, score
    return (best, best_score) if best and best_score >= NAME_MATCH_MIN else (None, best_score)


def decide(ev: Dict[str, Any]) -> Dict[str, Any]:
    """The verdict for one company from the evidence the stages gathered.

    ev: store     -- {status, strong, fresh, ago} or None (what our own records say)
        registry  -- {status, found} (live register) | {"state": "pending"|"off"} | None (not asked)
        deep      -- {found, business_status} | {"state": "off"|"error"} | None (not run)
        website   -- {"state": live|dead|parked|none|unchecked, "name_seen": bool}
    Returns {verdict, reasons[]}. Live register beats our stored copy; the deep web search only
    decides when neither knows the company.
    """
    reasons: List[str] = []
    store, reg, deep, web = ev.get("store"), ev.get("registry"), ev.get("deep"), ev.get("website") or {}
    reg_state = (reg or {}).get("state", "")
    reg_class = status_class(reg.get("status", "")) if reg and reg.get("found") else ""
    store_class = status_class(store.get("status", "")) if store else ""

    if reg and reg.get("found"):
        label = (reg.get("status") or "").strip() or "listed"
        reasons.append(f"Company register: {label} (checked live)")
        if store and store_class and reg_class and store_class != reg_class:
            reasons.append(f"Our records said {store.get('status')}; the register is newer, so it decides")
    if store and not (reg and reg.get("found")):
        label = (store.get("status") or "").strip() or "listed"
        ago = f", updated {store['ago']}" if store.get("ago") else ""
        reasons.append(f"Our records: {label}{ago}")

    verdict = ""
    decided = reg_class or ("" if (reg and reg.get("found")) else store_class)
    if decided == "dead":
        verdict = "problem"
    elif decided == "active":
        verdict = "verified"
    elif (reg and reg.get("found")) or store:
        # On a register but its status isn't one we can read: it exists, nothing more.
        verdict = "looks_ok"
        reasons.append("Found on a register but its status isn't clear")

    if not verdict:
        if deep and deep.get("found"):
            bs = str(deep.get("business_status") or "").upper()
            if bs == "CLOSED_PERMANENTLY":
                verdict = "problem"
                reasons.append("Deep web search: permanently closed")
            else:
                verdict = "looks_ok"
                reasons.append("Deep web search: found as a working business" if bs in ("", "OPERATIONAL")
                               else "Deep web search: found, temporarily closed")
        elif reg_state == "pending":
            verdict = "unclear"
            reasons.append("Company register check pending (try again shortly)")
        elif web.get("state") == "live" and web.get("name_seen"):
            verdict = "looks_ok"
            reasons.append("Website works and shows the company name; no register or search match")
        elif deep and deep.get("state") in ("off", "error") and reg_state == "off":
            verdict = "unclear"
            reasons.append("No register or search could be reached just now")
        else:
            verdict = "not_found"
            reasons.append("No register, record or search result for this company")

    if web.get("state") in ("dead", "parked") and verdict != "problem":
        reasons.append("Website isn't working" if web["state"] == "dead" else "Website looks parked or for sale")
    return {"verdict": verdict, "reasons": reasons}


# ── checks that use the network ─────────────────────────────────────────────────────────────────
_mx_cache: Dict[str, str] = {}


async def email_domain_state(domain: str) -> str:
    """'ok' (can receive mail), 'invalid' (no such domain / no mail server), 'unchecked'."""
    if not domain:
        return "unchecked"
    if domain in _WEBMAIL:
        return "ok"
    if domain in _mx_cache:
        return _mx_cache[domain]
    state = "unchecked"
    try:
        import dns.asyncresolver
        import dns.exception
        import dns.resolver

        resolver = dns.asyncresolver.Resolver()
        resolver.timeout, resolver.lifetime = 3.0, 5.0
        try:
            await resolver.resolve(domain, "MX")
            state = "ok"
        except dns.resolver.NoAnswer:
            try:  # no MX: mail goes to the domain's own address if it has one
                await resolver.resolve(domain, "A")
                state = "ok"
            except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
                state = "invalid"
        except dns.resolver.NXDOMAIN:
            state = "invalid"
        except (dns.exception.Timeout, dns.resolver.NoNameservers):
            state = "unchecked"
    except Exception as err:
        logger.debug(f"[company_check] mail check skipped for {domain}: {err}")
    if state != "unchecked":
        _mx_cache[domain] = state
    return state


async def website_state(url: str, name: str) -> Dict[str, Any]:
    """Does the site load, is it a parked page, does it show the company's name?"""
    if not (url or "").strip():
        return {"state": "none"}
    from app.services.enrichment_service import SEARCH_HEADERS

    target = url if "://" in url else f"https://{url}"
    try:
        async with httpx.AsyncClient(headers=SEARCH_HEADERS, timeout=httpx.Timeout(8.0, connect=4.0), follow_redirects=True) as c:
            try:
                resp = await c.get(target)
            except httpx.HTTPError:
                if target.startswith("https://"):  # some small sites only answer on plain http
                    resp = await c.get("http://" + target[len("https://"):])
                else:
                    raise
    except Exception:
        return {"state": "dead"}
    if resp.status_code in (401, 403, 429):
        return {"state": "live", "name_seen": True, "note": "Site blocks automatic checks"}  # it answered, so it exists
    if resp.status_code >= 400:
        return {"state": "dead"}
    html = resp.text or ""
    if is_parked(html):
        return {"state": "parked"}
    return {"state": "live", "name_seen": name_on_page(name, html)}


class Pace:
    """Keeps questions to one register at a polite speed, and notices when it says 'slow down'."""

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.last = 0.0
        self.paused_until = 0.0

    async def wait(self, gap: float) -> None:
        async with self.lock:
            now = time.monotonic()
            delay = self.last + gap - now
            if delay > 0:
                await asyncio.sleep(delay)
            self.last = time.monotonic()


async def live_registry(sources: List[Any], paces: Dict[str, Pace], name: str) -> Dict[str, Any]:
    """Ask each register that can be searched live. Returns {found, ...match} when one knows the
    company, {"state": "pending"} if a register asked us to slow down, {"state": "off"} if none could
    be reached, or {"found": False, "asked": True} when it answered and the company isn't there."""
    from app.services import data_source_connector as connector

    answered = False
    throttled = False
    for src in sources:
        pace = paces[src.id]
        if time.monotonic() < pace.paused_until:
            throttled = True
            continue
        cfg = src.config or {}
        await pace.wait(max(REGISTRY_MIN_GAP_S, (getattr(src, "min_delay_ms", 0) or 0) / 1000.0))
        try:
            raw = await connector._raw_search(src, name, limit=5)
        except connector.ConnectorError as err:
            if str(err).startswith("429"):
                pace.paused_until = time.monotonic() + THROTTLE_PAUSE_S
                throttled = True
            else:
                logger.warning(f"[company_check] register {src.id}: {err}")
            continue
        except Exception as err:
            logger.warning(f"[company_check] register {src.id} failed: {err}")
            continue
        answered = True
        mapped = []
        for item in raw:
            row = connector.map_fields(item, cfg.get("search_field_map") or {})
            for k, v in (cfg.get("search_defaults") or {}).items():
                row.setdefault(k, v)
            if row.get("name"):
                mapped.append({**row, "_source": src.id, "_tier": cfg.get("trust_tier", "scraped")})
        hit, score = best_hit(mapped, name)
        if hit:
            return {"found": True, "score": round(score, 3), **hit}
    if answered:
        return {"found": False, "asked": True}
    return {"state": "pending" if throttled else "off"}


# ── the pipeline for one company ─────────────────────────────────────────────────────────────────
def _ago(when: Optional[datetime]) -> str:
    if not when:
        return ""
    days = max(0, (datetime.utcnow() - when).days)
    return "today" if days == 0 else f"{days} day{'s' if days != 1 else ''} ago"


async def store_check(db, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """What our own records say. Strong = linked to a stored record, same website, or one
    unambiguous registry record with exactly this name."""
    from sqlalchemy import func, select

    from app.models.models import BusinessRecord

    rec, strong = None, False
    if row.get("business_record_id"):
        rec = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == row["business_record_id"]))).scalars().first()
        strong = rec is not None
    if rec is None and row.get("domain"):
        rec = (await db.execute(select(BusinessRecord).where(BusinessRecord.domain == row["domain"]).limit(1))).scalars().first()
        strong = rec is not None and name_score(row["name"], rec.name) >= NAME_MATCH_MIN
        rec = rec if strong else None
    if rec is None and name_key(row["name"]):
        # Trigram search (indexed): the closest stored names, then only a (near) exact one is kept.
        wanted = row["name"].strip()
        cands = (await db.execute(
            select(BusinessRecord).where(BusinessRecord.name.op("%")(wanted))
            .order_by(func.similarity(BusinessRecord.name, wanted).desc()).limit(10))).scalars().all()
        cands = [c for c in cands if name_score(row["name"], c.name) >= LINK_MATCH_MIN]
        if cands:
            registry = [c for c in cands if c.confidence_tier == "verified_registry"]
            rec = (registry or cands)[0]
            strong = len(cands) == 1 and rec.confidence_tier == "verified_registry"
    if rec is None:
        return None
    when = rec.last_verified_at or rec.fetched_at or rec.updated_at
    fresh = bool(when and when >= datetime.utcnow() - timedelta(days=FRESH_DAYS))
    return {"id": rec.id, "name": rec.name, "status": rec.status or "", "tier": rec.confidence_tier or "",
            "strong": strong, "fresh": fresh, "ago": _ago(when), "registration_number": rec.registration_number or ""}


async def save_register_answer(db, reg: Dict[str, Any], store: Optional[Dict[str, Any]]) -> Optional[str]:
    """Keep a live register answer for everyone: only when it is a (near) exact name and it adds
    something (the company is new to us, or its status changed). Returns the record id."""
    from app.services import business_records

    if not reg.get("found") or reg.get("score", 0) < LINK_MATCH_MIN:
        return None
    if store and status_class(store.get("status", "")) == status_class(reg.get("status", "")) and store.get("tier") == "verified_registry":
        return store["id"]
    try:
        data = {k: v for k, v in reg.items() if not k.startswith("_") and k not in ("found", "score") and v}
        rec = await business_records.upsert(db, source_id=reg["_source"], source_type="api", confidence_tier=reg.get("_tier", "scraped"), data=data)
        return rec.id
    except Exception as err:
        logger.debug(f"[company_check] couldn't keep register answer: {err}")
        return None


async def check_row(row: Dict[str, Any], ctx: "Context") -> Dict[str, Any]:
    """Runs every stage for one company and returns the verification to save."""
    from app.database import AsyncSessionLocal

    stages: List[str] = []
    spent = {"registry": 0, "deep": 0, "email": 0}
    ev: Dict[str, Any] = {}
    free_task = asyncio.create_task(_free_checks(row, ctx))

    # A. our own records
    store = None
    try:
        async with AsyncSessionLocal() as db:
            store = await store_check(db, row)
    except Exception as err:
        logger.warning(f"[company_check] records lookup failed for {row['name']}: {err}")
    stages.append("our_records")
    ev["store"] = store

    # B. the register, asked directly -- skipped when our own copy is solid and recent
    settled_by_store = bool(store and store["strong"] and store["fresh"] and status_class(store["status"]))
    link_id = None
    if ctx.registry_sources and not settled_by_store:
        reg = await live_registry(ctx.registry_sources, ctx.paces, row["name"])
        ev["registry"] = reg
        if reg.get("found") or reg.get("asked"):
            stages.append("registry")
            spent["registry"] = 1
        if reg.get("found"):
            try:
                async with AsyncSessionLocal() as db:
                    link_id = await save_register_answer(db, reg, store)
                    await db.commit()
            except Exception as err:
                logger.debug(f"[company_check] save skipped: {err}")

    # D. deep web search -- only when neither our records nor the register know the company
    reg_ev = ev.get("registry")
    known = bool(store) or bool(reg_ev and reg_ev.get("found"))
    pending = bool(reg_ev and reg_ev.get("state") == "pending")
    if not known and not pending and ctx.deep_ready:
        async with ctx.deep_sem:
            from app.services.enrichment_service import search_google_places

            place = await search_google_places(f"{row['name']} {row.get('region', '')}".strip())
        stages.append("deep_search")
        spent["deep"] = 1 if place else 0
        ev["deep"] = ({"found": True, "business_status": place.get("business_status", ""), "phone": place.get("phone", ""),
                       "website": place.get("website", "")} if place else {"found": False})
    elif not known and not pending and not ctx.deep_ready:
        ev["deep"] = {"state": "off"}

    free = await free_task
    ev["website"] = free["website"]
    stages.extend(s for s in ("website", "email", "phone") if free.get(s) and free[s].get("state") not in (None, "none", "unchecked"))

    # E. contact email finder (optional)
    email = free["email"]
    if ctx.find_emails and len((row.get("contact_name") or "").split()) >= 2:
        # The address we already hold for this company is used first when it is plainly the contact's
        # own and its mail server is real: nothing is paid for it.
        if email.get("state") == "ok" and email_matches_person(row.get("email") or "", row["contact_name"]):
            email = {**email, "note": "On file, matches the contact and the mail server looks right"}
            found = ""
        else:
            found = await _find_email(row, ctx)
        if found:
            stages.append("email_finder")
            spent["email"] = 1
            email = {"state": "verified" if found.lower() == (row.get("email") or "").lower() else "found", "found": found,
                     "note": "Confirmed" if found.lower() == (row.get("email") or "").lower() else f"A verified address was found: {found}"}

    decision = decide(ev)
    out = {
        "verdict": decision["verdict"], "reasons": decision["reasons"], "stages": stages,
        "email": email, "phone": free["phone"], "website": dict(free["website"]),
        "pending_registry": pending, "spent": spent,
        "checked_at": datetime.utcnow().isoformat() + "Z", "job_id": ctx.job_id,
    }
    if link_id:
        out["record_id"] = link_id
    return out


async def _free_checks(row: Dict[str, Any], ctx: "Context") -> Dict[str, Any]:
    async def web():
        async with ctx.web_sem:
            return await website_state(row.get("website") or row.get("domain") or "", row["name"])

    async def mail():
        addr = (row.get("email") or "").strip()
        if not addr:
            return {"state": "none"}
        ok, domain = email_shape(addr)
        if not ok:
            return {"state": "invalid", "note": "Not a valid email address"}
        async with ctx.dns_sem:
            st = await email_domain_state(domain)
        if st == "invalid":
            return {"state": "invalid", "note": "That email's domain can't receive mail"}
        if st == "ok":
            return {"state": "ok", "note": "Personal address" if domain in _WEBMAIL else "Format and mail server look right"}
        return {"state": "unchecked", "note": "Couldn't check the mail server"}

    w, m = await asyncio.gather(web(), mail())
    p = phone_shape(row.get("phone") or "")
    return {"website": w, "email": m, "phone": {"state": p, "note": "Not a usable number" if p == "invalid" else ""}}


async def _find_email(row: Dict[str, Any], ctx: "Context") -> str:
    from app.database import AsyncSessionLocal
    from app.services.enrichment_waterfall import lookup_person_waterfall

    parts = row["contact_name"].split()
    async with ctx.email_sem:
        try:
            async with AsyncSessionLocal() as db:
                res = await lookup_person_waterfall(db, ctx.org_id, parts[0], " ".join(parts[1:]), row["name"], row.get("domain") or "", bill=False)
        except Exception as err:
            logger.warning(f"[company_check] email finder failed for {row['name']}: {err}")
            return ""
    return res.get("email", "") if res.get("found") else ""


class Context(SimpleNamespace):
    """What one run shares: which checks are available, who pays, and the polite-speed limits."""


# ── a run over a whole list ──────────────────────────────────────────────────────────────────────
def _account_row(a) -> Dict[str, Any]:
    return {"id": a.id, "name": a.name or "", "website": a.website or "", "domain": a.domain or "", "phone": a.phone or "",
            "email": a.email or "", "contact_name": a.contact_name or "", "region": a.region or "",
            "business_record_id": a.business_record_id or ""}


async def live_sources() -> List[Any]:
    """The registers that can be asked directly and are ready (a key saved where one is needed)."""
    from sqlalchemy import select

    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import DataSource

    with system_scope():
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(DataSource).where(DataSource.kind == "api", DataSource.status == "active"))).scalars().all()
    out = []
    for s in rows:
        cfg = s.config or {}
        if not (cfg.get("search_endpoint") and cfg.get("search_field_map")):
            continue
        if s.auth_type not in ("none", "", None) and not s.api_key:
            continue
        out.append(SimpleNamespace(id=s.id, name=s.name, kind=s.kind, base_url=s.base_url, auth_type=s.auth_type, api_key=s.api_key,
                                   config=dict(cfg), min_delay_ms=s.min_delay_ms or 0))
    out.sort(key=lambda s: (0 if "registration_number" in (s.config.get("search_field_map") or {}) else 1, s.id))
    return out


def price_parts(rates: Dict[str, Dict[str, Any]], rows: int, with_contact: int, *, registry: bool, deep: bool, email: bool) -> Dict[str, int]:
    """The most a run could cost, in whole credits, per paid step (a run is charged once per step,
    rounded up). Used for the cost shown before the run and for the credits held while it runs."""
    import math

    def cost(item: str, n: int) -> int:
        return int(math.ceil(n * float(rates[item]["credits"]))) if n > 0 and item in rates else 0

    out = {"registry": cost("check_registry", rows) if registry else 0,
           "deep": cost("google_deep_search", rows) if deep else 0,
           "email": cost("check_email", with_contact) if email else 0}
    out["total"] = out["registry"] + out["deep"] + out["email"]
    return out
