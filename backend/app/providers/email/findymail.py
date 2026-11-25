"""Findymail: returns verified work addresses only."""
from __future__ import annotations

from typing import Dict, Tuple

import httpx

from app.providers.base import EmailFinder, Manifest, Pricing, TestResult, check_response, rejected


class Findymail(EmailFinder):
    manifest = Manifest(
        id="findymail", name="Findymail", category="email_finder", capabilities=("email_finder",), provides=("email",),
        key_group="Email Finder", pricing=Pricing(usd=0.03, unit="find", billing="per_find"), credit_item="lead_lookup",
        default_order=50, docs_url="https://app.findymail.com/docs")

    async def find_email(self, client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
        body = {"name": f"{p['first_name']} {p['last_name']}".strip(), "domain": p["domain"] or p["company"]}
        res = await client.post("https://app.findymail.com/api/search/name", json=body,
                                headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
        contact = (check_response(res, self.label()) or {}).get("contact") or {}
        email_addr = contact.get("email") or ""
        return (email_addr, "verified") if email_addr else ("", "")  # Findymail returns verified emails only

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        res = await client.get("https://app.findymail.com/api/credits", headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
        bad = rejected(res, self.label())
        if bad:
            return bad
        if res.status_code != 200:
            return TestResult(False, f"Findymail answered {res.status_code}.")
        data = res.json() if res.content else {}
        left = data.get("credits", data.get("credits_left", data.get("balance")))
        return TestResult(True, "Key works." + (f" {float(left):,.0f} credits left." if left is not None else ""),
                          float(left) if left is not None else None, "credits")


PROVIDER = Findymail()
