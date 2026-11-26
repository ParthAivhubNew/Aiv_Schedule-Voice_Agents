"""Providers set up in the staff portal, with no code (plan 11, Part A: "a config-only generic_http entry").

The one place the app picks providers by type while it runs is the e-mail finder waterfall, so a settings-made provider is an e-mail
finder. Staff describe a plain JSON API: its address, where the key goes, what to send, and where the e-mail address (and, if it
says, how sure it is) is in the answer. They paste the key and press Test. It then joins the waterfall with its price, licence and
place in the order, like a provider file. Company data, number checks, TPS screening and web search are wired to their providers in
code, so a new one of those is still a file under app/providers.

The settings live in the app setting "custom_providers", each key sealed (secret_box). Every call goes through the provider wrapper
(gateway.py), so the plan, the cost cap, the circuit breaker and the log row apply as for every provider.
"""
from __future__ import annotations

import ipaddress
import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlsplit

import httpx

from app.providers.base import EmailFinder, Licence, Manifest, Pricing, ProviderError, TestResult, check_response

logger = logging.getLogger("providers.generic_http")

SETTING = "custom_providers"  # app_settings row: {"providers": [config, ...]}
FIELDS = ("first_name", "last_name", "full_name", "company", "domain")  # what a template may ask for: {first_name}, {domain}...
ID_RX = re.compile(r"[a-z][a-z0-9_]{1,40}")
NAME_RX = re.compile(r"[A-Za-z0-9_-]{1,60}")  # a header or query parameter name
PATH_RX = re.compile(r"[A-Za-z0-9_.-]{1,120}")  # a dotted path into the JSON answer
TEST_PERSON = {"first_name": "Alex", "last_name": "Example", "company": "Example Ltd", "domain": "example.com"}  # nobody real
BLOCKED_SUFFIXES = (".local", ".internal", ".localhost", ".lan", ".home", ".corp")


def url_problem(url: str) -> str:
    """Why the server mustn't call this address, or "": https only, a public host name, no user name in it, the normal port.
    Staff are trusted, but an address typed by mistake must never reach the server's own network."""
    try:
        parts = urlsplit(str(url or "").strip())
    except ValueError:
        return "That isn't a web address."
    host = (parts.hostname or "").lower().rstrip(".")
    if parts.scheme != "https":
        return "The address must start with https://."
    if not host or "." not in host:
        return "The address needs a public host name, such as api.example.com."
    if parts.username or parts.password:
        return "The address can't hold a user name or password. Put the key in its own field."
    if parts.port not in (None, 443):
        return "Use the normal https port."
    if host == "localhost" or host.endswith(BLOCKED_SUFFIXES):
        return "That address is on a private network."
    try:
        ipaddress.ip_address(host)
        return "Use the provider's host name, not an IP address."
    except ValueError:
        pass
    return ""


def _fill(template: Any, person: Dict[str, str], *, for_url: bool = False) -> Any:
    """A template with {first_name}, {domain}... replaced by the person's values (URL-encoded in an address). Dicts and lists are filled
    all the way down; anything else is left as it is."""
    if isinstance(template, dict):
        return {k: _fill(v, person, for_url=for_url) for k, v in template.items()}
    if isinstance(template, list):
        return [_fill(v, person, for_url=for_url) for v in template]
    if not isinstance(template, str):
        return template
    out = template
    for f in FIELDS:
        value = str(person.get(f) or "")
        out = out.replace("{" + f + "}", quote(value, safe="") if for_url else value)
    return out


def _words(raw: Any) -> List[str]:
    items = raw if isinstance(raw, list) else str(raw or "").split(",")
    return sorted({str(w).strip().lower() for w in items if str(w).strip()})[:20]


def clean(raw: Dict[str, Any], *, taken: set, existing: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], List[str]]:
    """A settings-made provider's config, checked, and what is wrong with it ([] when it can be saved). `taken`: the ids of the provider
    files, which a settings-made one may not reuse. The key is handled by the caller (it is sealed, never returned)."""
    from app.providers.base import BILLING

    raw = raw if isinstance(raw, dict) else {}
    bad: List[str] = []
    pid = str(raw.get("id") or "").strip().lower()
    if not ID_RX.fullmatch(pid):
        bad.append("The id must be 2 to 41 lower-case letters, digits or _, starting with a letter.")
    elif pid in taken:
        bad.append(f"{pid!r} is already a provider built into the app.")
    name = str(raw.get("name") or "").strip()[:60]
    if not name:
        bad.append("Give it a name.")
    method = str(raw.get("method") or "GET").upper()
    if method not in ("GET", "POST"):
        bad.append("The method must be GET or POST.")
    url = str(raw.get("url") or "").strip()
    problem = url_problem(_fill(url, TEST_PERSON, for_url=True))
    if problem:
        bad.append(problem)
    key_in = str(raw.get("keyIn") or "header")
    key_name = str(raw.get("keyName") or "").strip()
    if key_in not in ("header", "query"):
        bad.append("The key goes in a header or in the query.")
    if not NAME_RX.fullmatch(key_name):
        bad.append("Say which header or query parameter carries the key (letters, digits, - or _).")
    key_prefix = str(raw.get("keyPrefix") or "")[:20]
    query = raw.get("query") or {}
    body = raw.get("body") or {}
    if not isinstance(query, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in query.items()):
        bad.append("The query must be a JSON object of text values.")
    if not isinstance(body, dict):
        bad.append("The body must be a JSON object.")
    if body and method == "GET":
        bad.append("A GET request has no body. Use POST, or move the values to the query.")
    email_path = str(raw.get("emailPath") or "").strip()
    status_path = str(raw.get("statusPath") or "").strip()
    if not PATH_RX.fullmatch(email_path):
        bad.append("Say where the e-mail address is in the answer, as a dotted path such as data.email.")
    if status_path and not PATH_RX.fullmatch(status_path):
        bad.append("The status path must be a dotted path such as data.status.")
    try:
        price = float(raw.get("priceUsd") or 0)
    except (TypeError, ValueError):
        price = -1
    if price < 0 or price > 100:
        bad.append("The price must be a number of US dollars from 0 to 100.")
    billing = str(raw.get("billing") or "per_find")
    if billing not in BILLING:
        bad.append("Billing is per find or per search.")
    try:
        order = int(raw.get("order") or 90)
    except (TypeError, ValueError):
        order = 90
    cfg = {
        "id": pid, "name": name, "method": method, "url": url, "keyIn": key_in, "keyName": key_name, "keyPrefix": key_prefix,
        "query": query if isinstance(query, dict) else {}, "body": body if isinstance(body, dict) else {},
        "emailPath": email_path, "statusPath": status_path,
        "verifiedValues": _words(raw.get("verifiedValues")), "catchAllValues": _words(raw.get("catchAllValues")),
        "trustAll": bool(raw.get("trustAll")),
        "priceUsd": round(max(price, 0.0), 6), "billing": billing, "exportable": bool(raw.get("exportable", True)),
        "clientLabel": str(raw.get("clientLabel") or "Licensed business data").strip()[:60],
        "order": max(1, min(order, 999)), "docsUrl": str(raw.get("docsUrl") or "").strip()[:300],
        "sealedKey": (existing or {}).get("sealedKey", ""),
    }
    return cfg, bad


class SettingsFinder(EmailFinder):
    """An e-mail finder described by staff in the portal instead of a file."""

    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.manifest = Manifest(
            id=cfg["id"], name=cfg["name"], category="email_finder", capabilities=("email_finder",), provides=("email",),
            key_group="Set up in the portal", key_names=(cfg["id"],),
            pricing=Pricing(usd=float(cfg.get("priceUsd") or 0), unit="find" if cfg.get("billing") == "per_find" else "call",
                            billing=cfg.get("billing") or "per_find"),
            licence=Licence(exportable=bool(cfg.get("exportable", True)), client_label=cfg.get("clientLabel") or "Licensed business data"),
            credit_item="lead_lookup", default_order=int(cfg.get("order") or 90), docs_url=cfg.get("docsUrl") or "",
            note="Set up in the staff portal, with no code. Its test asks for a made-up person, which uses one look-up.", test_spends=True)

    async def saved_key(self) -> str:
        from app.services.secret_box import open_blob

        try:
            return open_blob(self.cfg.get("sealedKey") or "") or ""
        except Exception:
            return ""

    async def find_email(self, client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
        from app.services.data_source_connector import _dig

        c = self.cfg
        person = {**p, "full_name": f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()}
        url = _fill(c["url"], person, for_url=True)
        problem = url_problem(url)
        if problem:
            raise ProviderError(f"{self.label()}: {problem}")
        headers = {"Accept": "application/json"}
        params = {k: v for k, v in _fill(c.get("query") or {}, person).items() if v != ""}
        if c.get("keyIn") == "query":
            params[c["keyName"]] = key
        else:
            headers[c["keyName"]] = f"{c.get('keyPrefix') or ''}{key}"
        body = _fill(c.get("body") or {}, person) if c.get("method") == "POST" else None
        res = await client.request(c.get("method") or "GET", url, params=params or None, json=body, headers=headers)
        data = check_response(res, self.label())
        email_addr = str(_dig(data, c["emailPath"]) or "").strip()
        if "@" not in email_addr or " " in email_addr:
            return "", ""
        if c.get("trustAll"):
            return email_addr, "verified"
        if not c.get("statusPath"):
            return email_addr, "catch_all"  # an address with no word on how sure: kept only if no finder verifies one
        status = str(_dig(data, c["statusPath"]) or "").strip().lower()
        if status in (c.get("verifiedValues") or []):
            return email_addr, "verified"
        if not c.get("catchAllValues") or status in c["catchAllValues"]:
            return email_addr, "catch_all"
        return "", ""

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        try:
            email_addr, _ = await self.find_email(client, key, TEST_PERSON)
        except ProviderError as err:
            return TestResult(False, str(err))
        found = "it even found an address for the made-up test person" if email_addr else "nothing was found for the made-up test person, as expected"
        return TestResult(True, f"The key works and the answer could be read: {found}. The test used one look-up.")


def view(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """A config for the staff screen: everything but the key, and whether one is saved."""
    return {**{k: v for k, v in cfg.items() if k != "sealedKey"}, "keySaved": bool(cfg.get("sealedKey"))}


async def configs(db=None) -> List[Dict[str, Any]]:
    from app.core.tenancy import system_scope
    from app.services.credits import _get_doc

    if db is not None:
        return list((await _get_doc(db, SETTING)).get("providers") or [])
    from app.database import AsyncSessionLocal

    with system_scope():
        async with AsyncSessionLocal() as s:
            return list((await _get_doc(s, SETTING)).get("providers") or [])


def apply(items: List[Dict[str, Any]]) -> None:
    """Puts the settings-made providers into the registry and the e-mail finder waterfall, straight away."""
    from app.providers import registry

    registry.set_settings_providers([SettingsFinder(c) for c in items if isinstance(c, dict) and c.get("id")])
    try:
        from app.services import enrichment_waterfall

        enrichment_waterfall.refresh_finders()
    except Exception as err:
        logger.warning(f"[providers] waterfall not refreshed: {err}")


async def load() -> int:
    """At start-up: read the settings-made providers and put them in place. Never stops the app."""
    try:
        items = await configs()
        apply(items)
        return len(items)
    except Exception as err:
        logger.warning(f"[providers] settings-made providers not loaded: {err}")
        return 0


async def save(db, raw: Dict[str, Any], *, key: str = "") -> Tuple[Optional[Dict[str, Any]], List[str]]:
    """Adds or changes one settings-made provider (and its price on Model Pricing). (config, []) when saved, (None, problems) when not.
    An empty key keeps the one saved before."""
    from app.providers import registry
    from app.services.ai_pricing import _price_row
    from app.services.credits import _get_doc, _put_doc
    from app.services.secret_box import seal_blob

    doc = await _get_doc(db, SETTING)
    items = [c for c in (doc.get("providers") or []) if isinstance(c, dict)]
    pid = str((raw or {}).get("id") or "").strip().lower()
    existing = next((c for c in items if c.get("id") == pid), None)
    cfg, bad = clean(raw, taken=set(registry.file_provider_ids()), existing=existing)
    if bad:
        return None, bad
    if key.strip():
        cfg["sealedKey"] = seal_blob(key.strip())
    items = [c for c in items if c.get("id") != pid] + [cfg]
    doc["providers"] = items
    await _put_doc(db, SETTING, doc)
    row = await _price_row(db, pid, "", "lookup")
    row.price_in_usd, row.billing, row.confirmed = cfg["priceUsd"], cfg["billing"], True
    await db.commit()
    apply(items)
    return cfg, []


async def remove(db, pid: str) -> bool:
    from app.services.credits import _get_doc, _put_doc

    doc = await _get_doc(db, SETTING)
    items = [c for c in (doc.get("providers") or []) if isinstance(c, dict)]
    left = [c for c in items if c.get("id") != pid]
    if len(left) == len(items):
        return False
    doc["providers"] = left
    await _put_doc(db, SETTING, doc)
    await db.commit()
    apply(left)
    return True
