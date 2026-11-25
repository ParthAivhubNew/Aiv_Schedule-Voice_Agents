"""Hunter: finds a work address from a name and a domain or company."""
from __future__ import annotations

from typing import Dict, Tuple

import httpx

from app.providers.base import EmailFinder, Manifest, Pricing, TestResult, check_response, rejected


class Hunter(EmailFinder):
    manifest = Manifest(
        id="hunter", name="Hunter", category="email_finder", capabilities=("email_finder",), provides=("email",),
        key_group="Email Finder", pricing=Pricing(usd=0.03, unit="find", billing="per_find"), credit_item="lead_lookup",
        default_order=30, docs_url="https://hunter.io/api-documentation/v2")

    async def find_email(self, client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
        params = {"first_name": p["first_name"], "last_name": p["last_name"], "api_key": key}
        params["domain" if p["domain"] else "company"] = p["domain"] or p["company"]
        data = (check_response(await client.get("https://api.hunter.io/v2/email-finder", params=params), self.label()) or {}).get("data") or {}
        email_addr = data.get("email") or ""
        status = ((data.get("verification") or {}).get("status") or "").lower()
        if email_addr and (status == "valid" or (not status and int(data.get("score") or 0) >= 90)):
            return email_addr, "verified"
        if email_addr and status == "accept_all":
            return email_addr, "catch_all"
        return "", ""

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        res = await client.get("https://api.hunter.io/v2/account", params={"api_key": key})
        bad = rejected(res, self.label())
        if bad:
            return bad
        if res.status_code != 200:
            return TestResult(False, f"Hunter answered {res.status_code}.")
        left = (((res.json().get("data") or {}).get("requests") or {}).get("searches") or {}).get("available")
        return TestResult(True, "Key works." + (f" {int(left):,} searches left." if left is not None else ""),
                          float(left) if left is not None else None, "searches")


PROVIDER = Hunter()
