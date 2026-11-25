"""LeadMagic: finds a work address from a name and a domain or company."""
from __future__ import annotations

from typing import Dict, Tuple

import httpx

from app.providers.base import EmailFinder, Manifest, Pricing, TestResult, check_response, rejected


class LeadMagic(EmailFinder):
    manifest = Manifest(
        id="leadmagic", name="LeadMagic", category="email_finder", capabilities=("email_finder",), provides=("email",),
        key_group="Email Finder", pricing=Pricing(usd=0.02, unit="find", billing="per_find"), credit_item="lead_lookup",
        default_order=20, docs_url="https://leadmagic.io/docs")

    async def find_email(self, client: httpx.AsyncClient, key: str, p: Dict[str, str]) -> Tuple[str, str]:
        body = {"first_name": p["first_name"], "last_name": p["last_name"], "domain": p["domain"], "company_name": p["company"]}
        res = await client.post("https://api.leadmagic.io/email-finder", json=body, headers={"X-API-Key": key})
        data = check_response(res, self.label()) or {}
        email_addr = data.get("email") or ""
        status = str(data.get("status") or data.get("email_status") or "").lower()
        if email_addr and status in ("valid", "verified", "deliverable"):
            return email_addr, "verified"
        if email_addr and "catch" in status:
            return email_addr, "catch_all"
        return "", ""

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        res = await client.get("https://api.leadmagic.io/v1/credits", headers={"X-API-Key": key})
        bad = rejected(res, self.label())
        if bad:
            return bad
        if res.status_code != 200:
            return TestResult(False, f"LeadMagic answered {res.status_code}.")
        left = (res.json() if res.content else {}).get("credits")
        return TestResult(True, "Key works." + (f" {float(left):,.0f} credits left." if left is not None else ""),
                          float(left) if left is not None else None, "credits")


PROVIDER = LeadMagic()
