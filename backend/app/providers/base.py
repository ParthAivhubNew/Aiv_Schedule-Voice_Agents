"""The shared parts of every outside data provider (plan 11, Part A: the provider registry).

A provider is one file under app/providers/<kind>/ holding a Provider subclass and `PROVIDER = TheClass()`. Its Manifest says
everything the rest of the app needs, so nothing else has to be edited by hand:
- what it is and offers: id, name, category, capabilities, provides,
- where its key is saved: key_group and the words key_names matches in the saved key's name,
- what it costs us: pricing (seeds the provider_prices row, which staff can change),
- what we may do with its data: licence (export rule, cache days, reuse across clients, the label clients see),
- what the client pays: credit_item, a rate-card item,
- its default position in its routing order.
Its test() makes the vendor's cheapest call that proves a key works, and reports the balance when the vendor gives one.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple

import httpx

CATEGORIES: Dict[str, str] = {
    "email_finder": "E-mail finder",
    "company_data": "Company data",
    "web_search": "Web search",
    "phone_lookup": "Phone number check",
    "tps_screening": "TPS / CTPS screening",
    "llm": "AI model",
}
CAPABILITIES = frozenset(CATEGORIES)
UNITS = ("call", "find", "credit", "record", "month")
BILLING = ("per_find", "per_search")


class ProviderError(RuntimeError):
    """The provider failed (bad key, out of credits, down): the next provider in the order is tried."""


@dataclass(frozen=True)
class Pricing:
    usd: float = 0.0  # what one unit costs us, in US dollars; 0 until known
    unit: str = "call"  # call | find | credit | record | month
    billing: str = "per_find"  # per_find: the vendor charges only when it finds something; per_search: every call


@dataclass(frozen=True)
class Licence:
    exportable: bool = True  # may values from it leave the app in a client's export
    cache_days: int = 90  # how long an answer is reused before it is asked again
    share_across_clients: bool = True  # may an answer bought for one client be reused for another
    client_label: str = "Licensed business data"  # what clients see as the source (supplier names are never shown to clients)


@dataclass(frozen=True)
class Manifest:
    id: str
    name: str
    category: str
    capabilities: Tuple[str, ...]
    provides: Tuple[str, ...] = ()
    key_group: str = ""  # the Platform Keys group its key is saved under, e.g. "Email Finder"
    key_names: Tuple[str, ...] = ()  # words of the saved key's name that mean this provider (default: the id)
    pricing: Pricing = field(default_factory=Pricing)
    licence: Licence = field(default_factory=Licence)
    credit_item: str = ""  # the rate-card item a client pays for what it finds
    default_order: int = 100  # lower is tried first within its capability
    docs_url: str = ""
    note: str = ""
    test_spends: bool = False  # its test uses a paid lookup, so only staff may run it

    def names(self) -> Tuple[str, ...]:
        return self.key_names or (self.id,)


@dataclass
class TestResult:
    ok: bool
    detail: str
    balance: Optional[float] = None
    unit: str = ""

    def as_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"ok": self.ok, "detail": self.detail}
        if self.balance is not None:
            out.update(balance=self.balance, unit=self.unit)
        return out


def check_response(res: httpx.Response, label: str) -> Any:
    """The JSON of a vendor answer, or ProviderError for a rejected key, no credits, a rate limit or a failure; {} for 404 (not found)."""
    if res.status_code in (401, 403):
        raise ProviderError(f"{label}: key rejected ({res.status_code}).")
    if res.status_code == 402:
        raise ProviderError(f"{label}: out of credits.")
    if res.status_code == 429:
        raise ProviderError(f"{label}: rate limited.")
    if res.status_code == 404:
        return {}
    if res.status_code >= 400:
        raise ProviderError(f"{label}: HTTP {res.status_code} {res.text[:160]}")
    try:
        return res.json()
    except Exception:
        raise ProviderError(f"{label}: unreadable answer.")


def rejected(res: httpx.Response, label: str) -> Optional[TestResult]:
    """The failed TestResult for a key the vendor refused or an account out of credits, else None."""
    if res.status_code in (401, 403):
        return TestResult(False, f"{label} rejected the key ({res.status_code}).")
    if res.status_code == 402:
        return TestResult(False, f"{label}: the account is out of credits.")
    return None


class Provider:
    manifest: Manifest

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        """The vendor's cheapest call that proves the key works. Never spends a paid lookup."""
        raise NotImplementedError

    def label(self) -> str:
        return self.manifest.name

    async def saved_key(self) -> str:
        """The key staff saved for this provider, "" when none. E-mail finders read theirs from Platform Keys -> Email Finder; a provider
        whose key lives elsewhere overrides this."""
        if self.manifest.key_group == "Email Finder":
            from app.services.enrichment_waterfall import finder_keys

            return (await finder_keys()).get(self.manifest.id, "")
        return ""


class EmailFinder(Provider):
    async def find_email(self, client: httpx.AsyncClient, key: str, person: Dict[str, str]) -> Tuple[str, str]:
        """(email, status) for a person {first_name, last_name, company, domain}. status is "verified", "catch_all" or "" (none).
        Raises ProviderError when the provider can't answer."""
        raise NotImplementedError
