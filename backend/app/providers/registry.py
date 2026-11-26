"""Every provider file under app/providers, found automatically (plan 11, Part A).

Adding a provider is one file: app/providers/<kind>/<name>.py with a Provider subclass and `PROVIDER = TheClass()`. Once it's
there, the provider:
- shows on Platform Keys in its key group (staff paste the key and press Test, which runs its real test()),
- joins the routing order of its capability (for e-mail finders, the waterfall in services/enrichment_waterfall.py),
- gets its price row on Model Pricing (seed_prices; staff can change it), and its licence decides whether its data may be exported.

Manifests are checked when they are loaded: a file with a broken manifest is left out and logged, and never stops the app.
"""
from __future__ import annotations

import importlib
import logging
import pkgutil
import re
from typing import Dict, List, Optional

from app.providers.base import BILLING, CAPABILITIES, CATEGORIES, UNITS, EmailFinder, Provider

logger = logging.getLogger("providers")

_LOADED: Optional[Dict[str, Provider]] = None
_PROBLEMS: Dict[str, str] = {}


def problems_of(p: Provider) -> List[str]:
    """What is wrong with a provider's manifest; [] when it can be used."""
    m = getattr(p, "manifest", None)
    if m is None:
        return ["no manifest"]
    out = []
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,40}", m.id or ""):
        out.append(f"id {m.id!r} must be lower case letters, digits or _")
    if not (m.name or "").strip():
        out.append("no name")
    if m.category not in CATEGORIES:
        out.append(f"unknown category {m.category!r}")
    if not m.capabilities or any(c not in CAPABILITIES for c in m.capabilities):
        out.append(f"unknown capabilities {m.capabilities!r}")
    if m.pricing.unit not in UNITS or m.pricing.billing not in BILLING or m.pricing.usd < 0:
        out.append("pricing must have a known unit and billing and a price of 0 or more")
    if "email_finder" in m.capabilities and not isinstance(p, EmailFinder):
        out.append("an e-mail finder must be an EmailFinder")
    if m.credit_item:
        from app.services.credits import DEFAULT_RATES

        if m.credit_item not in DEFAULT_RATES:
            out.append(f"credit_item {m.credit_item!r} is not on the rate card")
    return out


def _load() -> Dict[str, Provider]:
    global _LOADED
    if _LOADED is not None:
        return _LOADED
    import app.providers as pkg

    found: Dict[str, Provider] = {}
    for info in pkgutil.walk_packages(pkg.__path__, pkg.__name__ + "."):
        if info.ispkg or info.name.rsplit(".", 1)[-1] in ("base", "registry", "gateway", "keypool"):
            continue
        try:
            mod = importlib.import_module(info.name)
        except Exception as err:
            _PROBLEMS[info.name] = f"could not be loaded: {err}"
            logger.warning(f"[providers] {info.name} could not be loaded: {err}")
            continue
        p = getattr(mod, "PROVIDER", None)
        if p is None:
            continue
        bad = problems_of(p)
        if not bad and p.manifest.id in found:
            bad = [f"id {p.manifest.id!r} is already used by another provider"]
        if bad:
            _PROBLEMS[info.name] = "; ".join(bad)
            logger.warning(f"[providers] {info.name} left out: {'; '.join(bad)}")
            continue
        found[p.manifest.id] = p
    _LOADED = found
    return found


def reload() -> Dict[str, Provider]:
    """Forget what was loaded and look again (tests, or after adding a file in development)."""
    global _LOADED
    _LOADED = None
    _PROBLEMS.clear()
    return _load()


def all_providers() -> List[Provider]:
    return sorted(_load().values(), key=lambda p: (p.manifest.category, p.manifest.default_order, p.manifest.id))


def get(provider_id: str) -> Optional[Provider]:
    return _load().get((provider_id or "").strip().lower())


def by_capability(capability: str) -> List[Provider]:
    """The providers offering a capability, in their default order."""
    return sorted((p for p in _load().values() if capability in p.manifest.capabilities),
                  key=lambda p: (p.manifest.default_order, p.manifest.id))


def email_finders() -> List[EmailFinder]:
    return [p for p in by_capability("email_finder") if isinstance(p, EmailFinder)]


def match_key_name(name: str, group: str = "") -> Optional[Provider]:
    """The provider a saved key's name means ("Hunter main key" is Hunter), within a key group when given. The longest matching word
    wins, so a name holding two providers' words goes to the more specific one."""
    flat = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    best, best_len = None, 0
    for p in _load().values():
        if group and p.manifest.key_group and p.manifest.key_group != group:
            continue
        for word in p.manifest.names():
            w = re.sub(r"[^a-z0-9]", "", word.lower())
            if w and w in flat and len(w) > best_len:
                best, best_len = p, len(w)
    return best


def non_exportable() -> set:
    """Ids of the providers whose data may not leave the app in a client's export (licence.exportable is false)."""
    return {p.manifest.id for p in _load().values() if not p.manifest.licence.exportable}


def problems() -> Dict[str, str]:
    _load()
    return dict(_PROBLEMS)


def manifest_view(p: Provider) -> Dict:
    """A provider's manifest for the staff screens (no keys, nothing secret)."""
    m = p.manifest
    return {"id": m.id, "name": m.name, "category": m.category, "categoryLabel": CATEGORIES[m.category], "capabilities": list(m.capabilities),
            "provides": list(m.provides), "keyGroup": m.key_group, "pricing": {"usd": m.pricing.usd, "unit": m.pricing.unit, "billing": m.pricing.billing},
            "licence": {"exportable": m.licence.exportable, "cacheDays": m.licence.cache_days, "shareAcrossClients": m.licence.share_across_clients,
                        "clientLabel": m.licence.client_label},
            "creditItem": m.credit_item, "defaultOrder": m.default_order, "docsUrl": m.docs_url, "note": m.note}


async def seed_prices(db) -> int:
    """Gives every provider with a known price a Model Pricing row ("lookup") the first time it is loaded. A row that already exists is
    never changed, so a price staff typed always wins. Returns how many rows were made. Caller commits."""
    from sqlalchemy import select

    from app.models.models import ProviderPrice

    made = 0
    for p in _load().values():
        m = p.manifest
        if m.category == "llm":
            continue
        row = (await db.execute(select(ProviderPrice).where(ProviderPrice.provider == m.id, ProviderPrice.kind == "lookup",
                                                            ProviderPrice.model == ""))).scalars().first()
        if row is None and m.pricing.usd > 0:
            import uuid

            db.add(ProviderPrice(id=f"pp_{uuid.uuid4().hex[:12]}", provider=m.id, model="", kind="lookup", price_in_usd=m.pricing.usd,
                                 price_out_usd=0.0, confirmed=False, billing=m.pricing.billing))
            made += 1
    if made:
        await db.flush()
    return made


async def test_key(provider_id: str, key: str) -> Dict:
    """Runs a provider's real test with a key: {"ok", "detail", maybe "balance", "unit"}. Never raises."""
    p = get(provider_id)
    if p is None:
        return {"ok": False, "detail": f"No provider called {provider_id!r}."}
    if not (key or "").strip():
        return {"ok": False, "detail": "No key given."}
    import httpx

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=6.0)) as client:
            return (await p.test(client, key.strip())).as_dict()
    except Exception as err:
        return {"ok": False, "detail": f"{p.label()} could not be reached: {err}"}
